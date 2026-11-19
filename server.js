const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');
const dns = require('dns');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Use reliable public DNS resolvers (Google & Cloudflare) to resolve MongoDB Atlas cluster shard hostnames
try {
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch {}

// Load .env file automatically (never overwrite cloud provider PORT like Render/Railway)
const ENV_PATH = path.join(__dirname, '.env');
function loadEnvFile(overwrite = false) {
  if (!fs.existsSync(ENV_PATH)) return;
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key === 'PORT' && process.env.PORT) continue;
      if (key && (overwrite || !process.env[key])) {
        process.env[key] = val;
      }
    }
  }
}
loadEnvFile(true);

let mongoose;
try {
  mongoose = require('mongoose');
} catch {
  mongoose = null;
}

let seedDataModule = null;
try {
  seedDataModule = require('./seed/sampleData');
} catch {
  try {
    seedDataModule = require('./sampleData');
  } catch {
    seedDataModule = null;
  }
}

const ALLOWED_DISTRICTS = seedDataModule?.ALLOWED_DISTRICTS || ['All India'];
const REGIONAL_COLLEGES = seedDataModule?.REGIONAL_COLLEGES || [
  { name: 'IIT Bombay (Indian Institute of Technology Bombay), Mumbai', district: 'Maharashtra', officialUrl: 'https://iitb.ac.in' },
  { name: 'IIT Delhi (Indian Institute of Technology Delhi)', district: 'Delhi', officialUrl: 'https://iitd.ac.in' },
  { name: 'IIT Madras (Indian Institute of Technology Madras), Chennai', district: 'Tamil Nadu', officialUrl: 'https://iitm.ac.in' },
  { name: 'IIT Dharwad (Indian Institute of Technology Dharwad)', district: 'Karnataka', officialUrl: 'https://iitdh.ac.in' },
  { name: 'NITK Surathkal (National Institute of Technology Karnataka)', district: 'Karnataka', officialUrl: 'https://nitk.ac.in' },
  { name: 'IIIT Hyderabad (International Institute of Information Technology)', district: 'Telangana', officialUrl: 'https://iiit.ac.in' },
  { name: 'BITS Pilani (Birla Institute of Technology & Science), Pilani', district: 'Rajasthan', officialUrl: 'https://bits-pilani.ac.in' },
  { name: 'VIT Vellore (Vellore Institute of Technology)', district: 'Tamil Nadu', officialUrl: 'https://vit.ac.in' },
  { name: 'RV College of Engineering (RVCE), Bengaluru', district: 'Karnataka', officialUrl: 'https://rvce.edu.in' },
  { name: 'KLS Gogte Institute of Technology (GIT), Belagavi', district: 'Karnataka', officialUrl: 'https://git.edu' },
  { name: 'KLE Technological University (BVBCET), Hubballi-Dharwad', district: 'Karnataka', officialUrl: 'https://kletech.ac.in' },
  { name: 'KLE Technological University (MSSCET Campus), Belagavi', district: 'Karnataka', officialUrl: 'https://belagavi.kletech.ac.in' }
];
const sampleUsers = seedDataModule?.sampleUsers || [];
const sampleEvents = seedDataModule?.sampleEvents || [];
const sampleTeamPosts = seedDataModule?.sampleTeamPosts || [];
const sampleTeamRequests = seedDataModule?.sampleTeamRequests || [];
const seedMongoIfNeeded =
  seedDataModule?.seedMongoIfNeeded ||
  (async function () {
    return true;
  });

let User, Event, TeamPost, TeamRequest, ChatGroup;
if (mongoose) {
  try {
    User = require('./models/User');
  } catch {
    const UserPostSchema = new mongoose.Schema(
      {
        id: { type: String, required: true },
        type: { type: String, enum: ['post', 'reel', 'upload'], default: 'post' },
        title: { type: String, default: '', trim: true },
        caption: { type: String, default: '', trim: true },
        mediaUrl: { type: String, default: '', trim: true },
        tags: { type: [String], default: [] },
        likes: { type: [String], default: [] },
        createdAt: { type: Date, default: Date.now }
      },
      { _id: false }
    );
    const UserSchema = new mongoose.Schema(
      {
        collegeId: { type: String, required: true, unique: true, trim: true },
        username: { type: String, required: true, unique: true, trim: true },
        name: { type: String, required: true, trim: true },
        avatarUrl: { type: String, default: '' },
        userNumber: { type: String, default: '', trim: true },
        privacy: {
          showRealName: { type: Boolean, default: true },
          showUserNumber: { type: Boolean, default: false }
        },
        passwordHash: { type: String, required: true },
        role: { type: String, enum: ['student', 'organizer'], default: 'student' },
        college: { type: String, required: true, trim: true },
        city: { type: String, default: '', trim: true },
        branch: { type: String, default: 'CSE', trim: true },
        year: { type: Number, default: 2, min: 1, max: 5 },
        bio: { type: String, default: '' },
        skills: { type: [String], default: [] },
        interests: { type: [String], default: [] },
        achievements: { type: [String], default: [] },
        portfolioUrl: { type: String, default: '' },
        resumeUrl: { type: String, default: '' },
        hostelOrCampus: { type: String, default: '' },
        lookingForTeam: { type: Boolean, default: true },
        followers: { type: [String], default: [] },
        following: { type: [String], default: [] },
        posts: { type: [UserPostSchema], default: [] },
        bookmarkedEvents: { type: [String], default: [] },
        contactLinks: {
          github: { type: String, default: '' },
          linkedin: { type: String, default: '' },
          discord: { type: String, default: '' },
          whatsapp: { type: String, default: '' }
        }
      },
      { timestamps: true }
    );
    User = mongoose.models.User || mongoose.model('User', UserSchema);
  }

  try {
    Event = require('./models/Event');
  } catch {
    const EventSchema = new mongoose.Schema(
      {
        title: { type: String, required: true, trim: true },
        organizerCollege: { type: String, required: true, trim: true },
        city: { type: String, required: true, trim: true },
        mode: { type: String, enum: ['Offline', 'Online', 'Hybrid'], default: 'Offline' },
        category: {
          type: String,
          enum: ['Hackathon', 'Tech Fest', 'Robotics', 'Coding Contest', 'Paper/Project'],
          default: 'Hackathon'
        },
        isOfficial: { type: Boolean, default: false },
        startDate: { type: Date, required: true },
        registrationDeadline: { type: Date, required: true },
        teamSize: { type: String, default: '2 - 4 Members' },
        entryFee: { type: String, default: 'Free' },
        prizePool: { type: String, default: 'TBA' },
        registrationUrl: { type: String, default: '' },
        tags: { type: [String], default: [] },
        description: { type: String, default: '' },
        interestedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        bookmarkedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
      },
      { timestamps: true }
    );
    Event = mongoose.models.Event || mongoose.model('Event', EventSchema);
  }

  try {
    TeamPost = require('./models/TeamPost');
  } catch {
    const TeamPostSchema = new mongoose.Schema(
      {
        teamName: { type: String, required: true, trim: true },
        eventTitle: { type: String, required: true, trim: true },
        leader: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        currentMembers: { type: Number, default: 1, min: 1 },
        maxMembers: { type: Number, default: 4, min: 2 },
        neededRoles: { type: [String], default: [] },
        description: { type: String, required: true }
      },
      { timestamps: true }
    );
    TeamPost = mongoose.models.TeamPost || mongoose.model('TeamPost', TeamPostSchema);
  }

  try {
    TeamRequest = require('./models/TeamRequest');
  } catch {
    const MessageSchema = new mongoose.Schema(
      {
        msgId: { type: String, default: () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` },
        senderId: { type: String, required: true },
        senderName: { type: String, required: true },
        text: { type: String, default: '' },
        isForwarded: { type: Boolean, default: false },
        attachments: { type: [mongoose.Schema.Types.Mixed], default: [] },
        createdAt: { type: Date, default: Date.now }
      },
      { _id: false }
    );
    const TeamRequestSchema = new mongoose.Schema(
      {
        fromUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        toUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        eventTitle: { type: String, required: true, trim: true },
        note: { type: String, required: true },
        status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
        messages: { type: [MessageSchema], default: [] },
        lastReadAt: { type: Map, of: Date, default: {} }
      },
      { timestamps: true }
    );
    TeamRequest = mongoose.models.TeamRequest || mongoose.model('TeamRequest', TeamRequestSchema);
  }

  try {
    ChatGroup = require('./models/ChatGroup');
  } catch {
    const groupMessageSchema = new mongoose.Schema(
      {
        msgId: { type: String, default: () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` },
        senderId: { type: String, required: true },
        senderName: { type: String, required: true },
        text: { type: String, default: '', trim: true },
        isSystem: { type: Boolean, default: false },
        isForwarded: { type: Boolean, default: false },
        attachments: { type: [mongoose.Schema.Types.Mixed], default: [] },
        createdAt: { type: Date, default: Date.now }
      },
      { _id: false }
    );
    const chatGroupSchema = new mongoose.Schema(
      {
        name: { type: String, required: true, trim: true },
        description: { type: String, default: '', trim: true },
        avatarEmoji: { type: String, default: '👥' },
        inviteCode: { type: String, default: '', trim: true },
        admin: { type: String, required: true },
        members: [{ type: String }],
        messages: [groupMessageSchema],
        lastReadAt: { type: Map, of: Date, default: {} }
      },
      { timestamps: true }
    );
    ChatGroup = mongoose.models.ChatGroup || mongoose.model('ChatGroup', chatGroupSchema);
  }
}

const app = express();
const PORT = process.env.PORT || 5000;
let MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb+srv://sparrowcode597_db_user:is30gPZmmze4u4HI@cluster0.xoulbzp.mongodb.net/codevortex?retryWrites=true&w=majority';
const JWT_SECRET = process.env.JWT_SECRET || 'codevortex_cyberpunk_secret_2026';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Prevent browser caching on all API routes so real-time messages, followers, and groups always stay fresh
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Serve custom tornado logo from public/logo-tornado.png (unpacked from embedded bundle)
const TORNADO_DEST = path.join(__dirname, 'public', 'logo-tornado.png');

app.get('/logo-tornado.png', (req, res) => {
  if (fs.existsSync(TORNADO_DEST)) {
    return res.sendFile(TORNADO_DEST);
  }
  const svgLogo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
    <defs>
      <linearGradient id="cvGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#38bdf8"/>
        <stop offset="50%" stop-color="#6366f1"/>
        <stop offset="100%" stop-color="#a855f7"/>
      </linearGradient>
    </defs>
    <rect width="120" height="120" rx="28" fill="#0f172a"/>
    <path d="M22 30 C45 18, 85 18, 98 30 C82 38, 38 38, 28 48 C48 44, 82 44, 90 54 C74 62, 42 62, 36 72 C52 68, 76 68, 80 78 C66 85, 48 86, 46 95 C54 93, 64 95, 58 104" fill="none" stroke="url(#cvGrad)" stroke-width="8" stroke-linecap="round"/>
  </svg>`;
  res.type('image/svg+xml').send(svgLogo);
});

// --- BEGIN SELF-EXTRACTING PUBLIC BUNDLE ---
const EMBEDDED_PUBLIC_BUNDLE_GZ = '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';
function ensurePublicAssetsOnDisk() {
  try {
    const payload = JSON.parse(
      zlib.gunzipSync(Buffer.from(EMBEDDED_PUBLIC_BUNDLE_GZ, 'base64')).toString('utf8')
    );
    for (const [relPath, b64Data] of Object.entries(payload)) {
      const targetPath = path.join(__dirname, relPath);
      const nextBuf = Buffer.from(b64Data, 'base64');
      let shouldWrite = !fs.existsSync(targetPath) || Boolean(process.env.RENDER || process.env.RAILWAY_ENVIRONMENT);
      if (!shouldWrite) {
        try {
          const curBuf = fs.readFileSync(targetPath);
          if (!curBuf.equals(nextBuf)) shouldWrite = true;
        } catch {
          shouldWrite = true;
        }
      }
      if (shouldWrite) {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, nextBuf);
      }
    }
  } catch (err) {
    console.warn('[CodeVortex] Public asset unpack notice:', err.message);
  }
}
ensurePublicAssetsOnDisk();
// --- END SELF-EXTRACTING PUBLIC BUNDLE ---

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Fallback static routes in case files were uploaded flat to GitHub root instead of inside public/ subfolders
const FLAT_FILE_FALLBACKS = {
  '/': ['public/index.html', 'index.html'],
  '/index.html': ['public/index.html', 'index.html'],
  '/arena.html': ['public/arena.html', 'arena.html'],
  '/style.css': ['public/style.css', 'style.css'],
  '/css/styles.css': ['public/css/styles.css', 'css/styles.css', 'public/styles.css', 'styles.css'],
  '/js/app.js': ['public/js/app.js', 'js/app.js', 'public/app.js', 'app.js'],
  '/js/indiaCollegesData.js': ['public/js/indiaCollegesData.js', 'js/indiaCollegesData.js', 'public/indiaCollegesData.js', 'indiaCollegesData.js'],
  '/pages/login.html': ['public/pages/login.html', 'pages/login.html', 'public/login.html', 'login.html'],
  '/pages/register.html': ['public/pages/register.html', 'pages/register.html', 'public/register.html', 'register.html'],
  '/logo-tornado.png': ['public/logo-tornado.png', 'logo-tornado.png']
};

for (const [routePath, candidates] of Object.entries(FLAT_FILE_FALLBACKS)) {
  app.get(routePath, (req, res, next) => {
    for (const rel of candidates) {
      const full = path.join(__dirname, rel);
      if (fs.existsSync(full)) {
        return res.sendFile(full);
      }
    }
    next();
  });
}

// Smart Database State: MongoDB Atlas with Persistent Disk Backup Store
const LOCAL_STORE_PATH = path.join(__dirname, 'data', 'localStore.json');

function loadLocalStore() {
  try {
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(LOCAL_STORE_PATH, 'utf8'));
      const users = Array.isArray(parsed.users) ? parsed.users : [];
      for (const u of users) {
        if (u.demoPassword) {
          u.passwordHash = bcrypt.hashSync(String(u.demoPassword), 10);
          delete u.demoPassword;
        }
      }
      return {
        festDemoSyncedToMongo: Boolean(parsed.festDemoSyncedToMongo),
        users,
        events: Array.isArray(parsed.events) ? parsed.events : [],
        teamPosts: Array.isArray(parsed.teamPosts) ? parsed.teamPosts : [],
        teamRequests: Array.isArray(parsed.teamRequests) ? parsed.teamRequests : [],
        chatGroups: Array.isArray(parsed.chatGroups) ? parsed.chatGroups : []
      };
    }
  } catch (err) {
    console.error('[CodeVortex] Could not load local store backup:', err.message);
  }
  return {
    festDemoSyncedToMongo: false,
    users: JSON.parse(JSON.stringify(sampleUsers)),
    events: JSON.parse(JSON.stringify(sampleEvents)),
    teamPosts: JSON.parse(JSON.stringify(sampleTeamPosts)),
    teamRequests: JSON.parse(JSON.stringify(sampleTeamRequests)),
    chatGroups: []
  };
}

const initialLocal = loadLocalStore();
const dbState = {
  useMongo: false,
  festDemoSyncedToMongo: initialLocal.festDemoSyncedToMongo,
  users: initialLocal.users,
  events: initialLocal.events,
  teamPosts: initialLocal.teamPosts,
  teamRequests: initialLocal.teamRequests,
  chatGroups: initialLocal.chatGroups
};

function saveLocalStore() {
  try {
    const dir = path.dirname(LOCAL_STORE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      LOCAL_STORE_PATH,
      JSON.stringify(
        {
          festDemoSyncedToMongo: dbState.festDemoSyncedToMongo,
          users: dbState.users,
          events: dbState.events,
          teamPosts: dbState.teamPosts,
          teamRequests: dbState.teamRequests,
          chatGroups: dbState.chatGroups
        },
        null,
        2
      ),
      'utf8'
    );
  } catch (err) {
    console.error('[CodeVortex] Could not save local store backup:', err.message);
  }
}

async function cleanupOrphanRecords() {
  try {
    if (dbState.useMongo && mongoose && mongoose.connection.readyState === 1) {
      const allUsers = await User.find().lean();
      const validUserIds = new Set(allUsers.map((u) => String(u._id)));

      // Clean dead follower/following IDs from every user in MongoDB
      for (const u of allUsers) {
        const uid = String(u._id);
        const origFollowers = Array.isArray(u.followers) ? u.followers.map(String) : [];
        const origFollowing = Array.isArray(u.following) ? u.following.map(String) : [];
        const cleanFollowers = Array.from(
          new Set(origFollowers.filter((id) => validUserIds.has(id) && id !== uid))
        );
        const cleanFollowing = Array.from(
          new Set(origFollowing.filter((id) => validUserIds.has(id) && id !== uid))
        );
        if (
          cleanFollowers.length !== origFollowers.length ||
          cleanFollowing.length !== origFollowing.length
        ) {
          await User.findByIdAndUpdate(u._id, {
            followers: cleanFollowers,
            following: cleanFollowing
          }).catch(() => {});
          u.followers = cleanFollowers;
          u.following = cleanFollowing;
        }
      }

      // Prune any deleted users from dbState.users so memory and local backup never retain ghost users
      dbState.users = allUsers.map((u) => ({ ...u, _id: String(u._id) }));

      // Remove team requests where fromUser or toUser was deleted
      const allReqs = await TeamRequest.find().lean();
      const deadReqIds = allReqs
        .filter((r) => !validUserIds.has(String(r.fromUser)) || !validUserIds.has(String(r.toUser)))
        .map((r) => r._id);

      if (deadReqIds.length > 0) {
        await TeamRequest.deleteMany({ _id: { $in: deadReqIds } });
      }

      // Remove team posts where leader was deleted
      const allPosts = await TeamPost.find().lean();
      const deadPostIds = allPosts
        .filter((p) => !validUserIds.has(String(p.leader)))
        .map((p) => p._id);

      if (deadPostIds.length > 0) {
        await TeamPost.deleteMany({ _id: { $in: deadPostIds } });
      }

      // Clean chat groups in MongoDB (remove legacy/orphan groups or dead member IDs)
      if (ChatGroup) {
        const allGroups = await ChatGroup.find().lean();
        for (const g of allGroups) {
          const validMembers = Array.from(
            new Set((g.members || []).map(String).filter((id) => validUserIds.has(id)))
          );
          const isLegacyDemoGroup =
            g.name === 'All-India Hackathon Squad Hub' ||
            [
              '6af78f993fb296690c206f01',
              '6afc6628fbdcddf7080f62e4',
              '6afc6627fbdcddf7080f62df',
              '6afc6626fbdcddf7080f62d7',
              '6afc6624fbdcddf7080f62d1'
            ].includes(String(g._id)) ||
            !validUserIds.has(String(g.admin)) ||
            validMembers.length === 0;

          if (isLegacyDemoGroup) {
            await ChatGroup.findByIdAndDelete(g._id).catch(() => {});
          } else if (validMembers.length !== (g.members || []).length) {
            await ChatGroup.findByIdAndUpdate(g._id, { members: validMembers }).catch(() => {});
          }
        }
        const survivingGroups = await ChatGroup.find().sort({ updatedAt: -1 }).lean();
        dbState.chatGroups = survivingGroups.map((g) => ({ ...g, _id: String(g._id) }));
      }
    }

    // Also clean local store memory & file
    const localUserIds = new Set(dbState.users.map((u) => String(u._id)));
    for (const u of dbState.users) {
      const uid = String(u._id);
      u.followers = Array.from(
        new Set((u.followers || []).map(String).filter((id) => localUserIds.has(id) && id !== uid))
      );
      u.following = Array.from(
        new Set((u.following || []).map(String).filter((id) => localUserIds.has(id) && id !== uid))
      );
    }
    dbState.teamRequests = dbState.teamRequests.filter(
      (r) => localUserIds.has(String(r.fromUser)) && localUserIds.has(String(r.toUser))
    );
    dbState.teamPosts = dbState.teamPosts.filter(
      (p) => localUserIds.has(String(p.leader))
    );
    dbState.chatGroups = (dbState.chatGroups || [])
      .map((g) => ({
        ...g,
        members: Array.from(
          new Set((g.members || []).map(String).filter((id) => localUserIds.has(id)))
        )
      }))
      .filter(
        (g) =>
          g.name !== 'All-India Hackathon Squad Hub' &&
          localUserIds.has(String(g.admin)) &&
          g.members.length > 0
      );

    saveLocalStore();
  } catch (err) {
    console.warn('[CodeVortex] Orphan records cleanup notice:', err.message);
  }
}

async function initDatabase() {
  if (!mongoose) {
    console.log('[CodeVortex] Mongoose not found, running with Local Fallback Store.');
    return;
  }
  loadEnvFile(true);
  MONGO_URI =
    process.env.MONGO_URI ||
    'mongodb+srv://sparrowcode597_db_user:is30gPZmmze4u4HI@cluster0.xoulbzp.mongodb.net/codevortex?retryWrites=true&w=majority';
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    const isAtlas = MONGO_URI.startsWith('mongodb+srv://');
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: isAtlas ? 4500 : 2500
    });
    dbState.useMongo = true;
    const maskedUri = MONGO_URI.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:****@');
    console.log(
      `[CodeVortex] Connected to ${isAtlas ? 'MongoDB Atlas Cloud' : 'MongoDB'} at ${maskedUri}`
    );
    await seedMongoIfNeeded({ User, Event, TeamPost, TeamRequest });

    // Sync live collections from MongoDB Atlas directly into dbState so local backup is 100% aligned
    const [liveUsers, liveEvents, liveTeamPosts, liveTeamReqs, liveChatGroups] = await Promise.all([
      User.find().lean(),
      Event.find().sort({ startDate: 1 }).lean(),
      TeamPost.find().sort({ createdAt: -1 }).lean(),
      TeamRequest.find().sort({ updatedAt: -1 }).lean(),
      ChatGroup ? ChatGroup.find().sort({ updatedAt: -1 }).lean() : Promise.resolve([])
    ]);
    if (Array.isArray(liveUsers)) {
      dbState.users = liveUsers.map((u) => ({ ...u, _id: String(u._id) }));
    }
    if (Array.isArray(liveEvents)) {
      dbState.events = liveEvents.map((e) => ({ ...e, _id: String(e._id) }));
    }
    if (Array.isArray(liveTeamPosts)) {
      dbState.teamPosts = liveTeamPosts.map((p) => ({ ...p, _id: String(p._id), leader: String(p.leader) }));
    }
    if (Array.isArray(liveTeamReqs)) {
      dbState.teamRequests = liveTeamReqs.map((r) => ({
        ...r,
        _id: String(r._id),
        fromUser: String(r.fromUser),
        toUser: String(r.toUser)
      }));
    }
    if (Array.isArray(liveChatGroups)) {
      dbState.chatGroups = liveChatGroups.map((g) => ({ ...g, _id: String(g._id) }));
    }

    await cleanupOrphanRecords();
    saveLocalStore();
  } catch (err) {
    dbState.useMongo = false;
    await cleanupOrphanRecords();
    console.log(
      `[CodeVortex] Persistent Local Database Active (${dbState.users.length} users, ${dbState.teamPosts.length} squads, ${dbState.chatGroups.length} groups synced).`
    );
  }
}

// Auto-reconnect whenever .env is edited & saved
fs.watchFile(ENV_PATH, { interval: 1500 }, () => {
  const prevUri = MONGO_URI;
  loadEnvFile(true);
  if (process.env.MONGO_URI && process.env.MONGO_URI !== prevUri) {
    console.log('[CodeVortex] Detected updated MONGO_URI in .env — reconnecting to MongoDB...');
    initDatabase();
  }
});

// ============================================================================
// HELPER FUNCTIONS & JWT AUTH MIDDLEWARE (DAY 2)
// ============================================================================

function createToken(user) {
  return jwt.sign(
    { id: String(user._id), collegeId: user.collegeId, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// Optional auth middleware (populates req.user if Bearer token is present)
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch {
      req.user = null;
    }
  }
  next();
}

// Required auth middleware
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Please log in with your College ID.' });
  }
  const token = authHeader.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token. Please log in again.' });
  }
}

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Robust Dual-Store User Helpers (handles MongoDB Atlas network/DNS timeouts and non-ObjectIds gracefully)
async function findUserById(id) {
  if (!id) return null;
  const uid = String(id);
  if (
    dbState.useMongo &&
    mongoose &&
    mongoose.connection.readyState === 1 &&
    mongoose.Types.ObjectId.isValid(uid)
  ) {
    try {
      const u = await User.findById(uid);
      // Connected to MongoDB: return whatever MongoDB returns (null if deleted)
      return u;
    } catch (err) {
      console.warn(`[CodeVortex] MongoDB read failed (${err.message}), using persistent local backup.`);
    }
  }
  return dbState.users.find((u) => String(u._id) === uid) || null;
}

async function persistUserData(userObj) {
  if (!userObj) return;
  const uid = String(userObj._id);

  // 1. Attempt save to MongoDB if active
  if (dbState.useMongo && mongoose && mongoose.connection.readyState === 1) {
    try {
      if (typeof userObj.save === 'function') {
        await userObj.save();
      } else {
        await User.findByIdAndUpdate(uid, userObj, { upsert: true });
      }
    } catch (err) {
      console.warn(`[CodeVortex] MongoDB save encountered network issue (${err.message}). Data safely preserved in persistent local store.`);
    }
  }

  // 2. Always persist to disk backup store so changes are never lost
  const plain = userObj.toObject ? userObj.toObject() : { ...userObj };
  const idx = dbState.users.findIndex((u) => String(u._id) === uid);
  if (idx !== -1) {
    dbState.users[idx] = { ...dbState.users[idx], ...plain };
  } else {
    dbState.users.push(plain);
  }
  saveLocalStore();
}

/**
 * Formats a user object according to privacy settings:
 * - If isSelf === true: returns all fields (except passwordHash)
 * - Otherwise: hides collegeId, hides name unless privacy.showRealName is true,
 *   hides userNumber unless privacy.showUserNumber is true.
 */
function sanitizeUser(rawUser, { isSelf = false } = {}) {
  if (!rawUser) return null;
  const u = rawUser.toObject ? rawUser.toObject() : { ...rawUser };
  delete u.passwordHash;

  const uid = String(u._id);
  const validUserIdSet = new Set((dbState.users || []).map((usr) => String(usr._id)));
  const privacy = u.privacy || { showRealName: true, showUserNumber: false };
  const followers = Array.from(
    new Set(
      (Array.isArray(u.followers) ? u.followers.map(String) : []).filter(
        (id) => id !== uid && (validUserIdSet.size === 0 || validUserIdSet.has(id))
      )
    )
  );
  const following = Array.from(
    new Set(
      (Array.isArray(u.following) ? u.following.map(String) : []).filter(
        (id) => id !== uid && (validUserIdSet.size === 0 || validUserIdSet.has(id))
      )
    )
  );
  const posts = Array.isArray(u.posts) ? u.posts : [];
  const bookmarkedEvents = Array.isArray(u.bookmarkedEvents) ? u.bookmarkedEvents.map(String) : [];

  if (isSelf) {
    return {
      ...u,
      avatarUrl: u.avatarUrl || '',
      privacy,
      followers,
      following,
      followersCount: followers.length,
      followingCount: following.length,
      posts,
      bookmarkedEvents
    };
  }

  return {
    _id: u._id,
    username: u.username,
    name: privacy.showRealName ? u.name : u.username,
    avatarUrl: u.avatarUrl || '',
    userNumber: privacy.showUserNumber ? u.userNumber : 'Hidden',
    privacy,
    role: u.role,
    college: u.college,
    city: u.city,
    branch: u.branch,
    year: u.year,
    bio: u.bio,
    skills: u.skills || [],
    interests: u.interests || [],
    achievements: u.achievements || [],
    portfolioUrl: u.portfolioUrl || '',
    resumeUrl: u.resumeUrl || '',
    hostelOrCampus: u.hostelOrCampus || '',
    lookingForTeam: Boolean(u.lookingForTeam),
    followers,
    following,
    followersCount: followers.length,
    followingCount: following.length,
    posts,
    contactLinks: u.contactLinks || { github: '', linkedin: '', discord: '', whatsapp: '' }
  };
}

function parseListField(val) {
  if (Array.isArray(val)) return val.map((s) => String(s).trim()).filter(Boolean);
  if (typeof val === 'string') {
    return val
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

// Health & Status Check Endpoint
app.get('/api/health', async (req, res) => {
  let userCount = dbState.users.length;
  let customEventCount = dbState.events.length;
  let teamPostCount = dbState.teamPosts.length;
  let teamRequestCount = dbState.teamRequests.length;

  if (dbState.useMongo) {
    try {
      [userCount, customEventCount, teamPostCount, teamRequestCount] = await Promise.all([
        User.countDocuments(),
        Event.countDocuments(),
        TeamPost.countDocuments(),
        TeamRequest.countDocuments()
      ]);
    } catch {}
  }

  const isAtlas = MONGO_URI.startsWith('mongodb+srv://');
  res.json({
    status: 'ok',
    project: 'CodeVortex',
    region: 'All India Engineering Network',
    storageMode: dbState.useMongo
      ? isAtlas
        ? 'MongoDB Atlas (Cloud Database)'
        : 'MongoDB (Connected)'
      : 'In-Memory Fallback Store',
    liveCompetitionApis: {
      sources: liveApiCache.apiSources,
      lastSyncedAt: liveApiCache.lastSyncedAt,
      liveEventCount: liveApiCache.events.length
    },
    counts: {
      users: userCount,
      events: customEventCount + liveApiCache.events.length,
      teamPosts: teamPostCount,
      teamRequests: teamRequestCount
    }
  });
});

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
  'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu & Kashmir', 'Chandigarh', 'Puducherry', 'Ladakh'
];

// GET /api/region-info - Returns All-India states & engineering colleges
app.get('/api/region-info', (req, res) => {
  res.json({
    country: 'India',
    allowedStates: INDIAN_STATES,
    colleges: REGIONAL_COLLEGES
  });
});

function isAllowedRegionalLocation(collegeName = '', cityOrDistrict = '') {
  return Boolean(String(collegeName).trim() || String(cityOrDistrict).trim());
}

const STATE_CITY_KEYWORDS = {
  karnataka: ['belagavi', 'belgaum', 'bagalkot', 'dharwad', 'hubballi', 'hubli', 'bengaluru', 'bangalore', 'mysuru', 'mysore', 'mangaluru', 'mangalore', 'surathkal', 'tumakuru', 'tumkur', 'davangere', 'shivamogga', 'shimoga', 'kalaburagi', 'gulbarga', 'vijayapura', 'bijapur', 'ballari', 'bellary', 'udupi', 'manipal', 'hassan', 'mandya', 'bidar', 'raichur', 'gadag', 'haveri', 'karwar', 'vtu', 'kle', 'git', 'rvce', 'bmsce', 'pes', 'msrit', 'sdmcet', 'bec'],
  'belagavi': ['belagavi', 'belgaum', 'msscet', 'gogte', 'git', 'vtu'],
  'hubballi-dharwad': ['hubballi', 'hubli', 'dharwad', 'bvbcet', 'sdmcet', 'iit dharwad', 'iiit dharwad'],
  'bengaluru': ['bengaluru', 'bangalore', 'rvce', 'bmsce', 'pes', 'msrit', 'iiit bangalore', 'iisc'],
  'mangaluru': ['mangaluru', 'mangalore', 'surathkal', 'nitk'],
  'mysuru': ['mysuru', 'mysore', 'sjce', 'nie'],
  'bagalkot': ['bagalkot', 'basaveshwar', 'bec'],
  'udupi': ['udupi', 'manipal', 'mit manipal', 'nmamit'],
  maharashtra: ['mumbai', 'pune', 'nagpur', 'nashik', 'aurangabad', 'thane', 'kolhapur', 'sangli', 'solapur', 'iit bombay', 'coep', 'vjti', 'vnit', 'pict'],
  'tamil nadu': ['chennai', 'vellore', 'tiruchirappalli', 'trichy', 'coimbatore', 'madurai', 'salem', 'iit madras', 'vit', 'srm', 'anna university', 'psg'],
  delhi: ['new delhi', 'delhi', 'dtu', 'nsut', 'iiit delhi', 'iit delhi', 'jnu', 'nit delhi'],
  telangana: ['hyderabad', 'warangal', 'secunderabad', 'nizamabad', 'karimnagar', 'iit hyderabad', 'iiit hyderabad', 'nit warangal', 'bits hyderabad', 'cbit'],
  'uttar pradesh': ['kanpur', 'lucknow', 'noida', 'allahabad', 'prayagraj', 'varanasi', 'agra', 'meerut', 'iit kanpur', 'iit bhu', 'mnnit', 'iiit allahabad'],
  'west bengal': ['kolkata', 'kharagpur', 'durgapur', 'shibpur', 'howrah', 'siliguri', 'iit kharagpur', 'jadavpur', 'nit durgapur', 'iiest'],
  rajasthan: ['jaipur', 'pilani', 'jodhpur', 'kota', 'udaipur', 'ajmer', 'bits pilani', 'mnit', 'iit jodhpur', 'lnmiit'],
  gujarat: ['ahmedabad', 'gandhinagar', 'surat', 'vadodara', 'rajkot', 'anand', 'iit gandhinagar', 'svnit', 'daiict', 'nirma'],
  kerala: ['kochi', 'ernakulam', 'calicut', 'kozhikode', 'trivandrum', 'thiruvananthapuram', 'palakkad', 'thrissur', 'kottayam', 'nit calicut', 'iit palakkad', 'cet'],
  goa: ['panaji', 'ponda', 'vasco', 'mormugao', 'margao', 'bits goa', 'nit goa', 'iit goa'],
  punjab: ['amritsar', 'jalandhar', 'ludhiana', 'patiala', 'ropar', 'mohali', 'thapar', 'nit jalandhar', 'iit ropar'],
  haryana: ['gurugram', 'gurgaon', 'faridabad', 'kurukshetra', 'sonipat', 'hisar', 'rohtak', 'nit kurukshetra'],
  uttarakhand: ['roorkee', 'dehradun', 'haldwani', 'pantnagar', 'iit roorkee', 'nit uttarakhand'],
  assam: ['guwahati', 'silchar', 'dibrugarh', 'jorhat', 'tezpur', 'iit guwahati', 'nit silchar'],
  odisha: ['bhubaneswar', 'rourkela', 'cuttack', 'berhampur', 'sambalpur', 'nit rourkela', 'iit bhubaneswar', 'kiit'],
  'madhya pradesh': ['indore', 'bhopal', 'gwalior', 'jabalpur', 'ujjain', 'iit indore', 'manit', 'iiit gwalior'],
  'andhra pradesh': ['visakhapatnam', 'vizag', 'vijayawada', 'tirupati', 'guntur', 'kakinada', 'nellore', 'kurnool', 'anantapur', 'iit tirupati', 'nit andhra'],
  bihar: ['patna', 'gaya', 'muzaffarpur', 'bhagalpur', 'darbhanga', 'iit patna', 'nit patna'],
  jharkhand: ['ranchi', 'dhanbad', 'jamshedpur', 'bokaro', 'iit ism', 'bit mesra', 'nit jamshedpur']
};

function matchesStateOrLocation(locationText = '', selectedState = '') {
  if (!selectedState || selectedState === 'All') return true;
  const target = String(selectedState).trim().toLowerCase();
  const hay = String(locationText || '').toLowerCase();
  if (hay.includes(target)) return true;
  const keywords = STATE_CITY_KEYWORDS[target] || [];
  if (keywords.some((k) => hay.includes(k))) return true;
  // Also match if selectedState is a college name or partial district name (e.g. "Belagavi (Belgaum)")
  const parts = target
    .split(/[(),\/\-]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3);
  return parts.length > 0 && parts.some((p) => hay.includes(p));
}

// ============================================================================
// DAY 2 ROUTES: COLLEGE ID AUTH, CUSTOM @USERNAME & PRIVACY CONTROLS
// ============================================================================

// ============================================================================
// MOBILE OTP AUTHENTICATION (SIMULATED SMS / DEMO MODE) & PASSWORD RESET
// ============================================================================
const otpStore = new Map(); // key: `${purpose}:${digits10}` -> { code, expiresAt, attempts, userId?, username? }
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes

function normalizeIndianMobile(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  return '';
}

function maskMobile(digits10) {
  if (!digits10 || digits10.length < 4) return '+91 **********';
  return `+91 ${digits10.slice(0, 2)}****${digits10.slice(-4)}`;
}

function cleanupExpiredOtps() {
  const now = Date.now();
  for (const [k, v] of otpStore.entries()) {
    if (!v || v.expiresAt < now) otpStore.delete(k);
  }
}

async function findUserForReset(rawInput) {
  const cleaned = String(rawInput || '').trim();
  const digits10 = normalizeIndianMobile(cleaned);
  const idClean = cleaned.replace(/^@/, '');

  let user = null;
  if (dbState.useMongo && mongoose && mongoose.connection.readyState === 1) {
    try {
      if (digits10) {
        const allCandidates = await User.find({
          userNumber: { $regex: digits10.slice(-6) }
        });
        user = allCandidates.find((u) => normalizeIndianMobile(u.userNumber) === digits10) || null;
      }
      if (!user && idClean) {
        user = await User.findOne({
          $or: [
            { collegeId: new RegExp(`^${escapeRegex(idClean)}$`, 'i') },
            { username: new RegExp(`^${escapeRegex(idClean)}$`, 'i') }
          ]
        });
      }
    } catch (err) {
      console.warn('[CodeVortex] MongoDB reset lookup error, falling back to local store:', err.message);
    }
  }

  if (!user) {
    if (digits10) {
      user = dbState.users.find((u) => normalizeIndianMobile(u.userNumber) === digits10) || null;
    }
    if (!user && idClean) {
      user =
        dbState.users.find(
          (u) =>
            (u.collegeId && u.collegeId.toLowerCase() === idClean.toLowerCase()) ||
            (u.username && u.username.toLowerCase() === idClean.toLowerCase())
        ) || null;
    }
  }
  return user;
}

async function sendFast2SmsOtp(digits10, code, purpose) {
  const apiKey = String(process.env.FAST2SMS_API_KEY || '').trim();
  if (!apiKey || apiKey === 'YOUR_FAST2SMS_API_KEY_HERE') {
    throw new Error(
      'Fast2SMS API key is not configured. Please add FAST2SMS_API_KEY to your .env file (or Render Environment Variables).'
    );
  }

  const preferredRoute = String(process.env.FAST2SMS_ROUTE || 'otp').trim().toLowerCase();
  const routesToTry = preferredRoute === 'q' ? ['q'] : [preferredRoute, 'q'];
  let lastError = 'Fast2SMS failed to send SMS.';

  for (const route of routesToTry) {
    const payload =
      route === 'otp'
        ? {
            variables_values: code,
            route: 'otp',
            numbers: digits10
          }
        : {
            message:
              purpose === 'reset'
                ? `Your CodeVortex Password Reset OTP is ${code}. Valid for 5 minutes. Do not share this code.`
                : `Your CodeVortex Sign-Up OTP is ${code}. Valid for 5 minutes. Do not share this code.`,
            language: 'english',
            route: 'q',
            numbers: digits10
          };

    const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    if (response.ok && data && data.return === true) {
      return { ok: true, route, requestId: data.request_id || '' };
    }

    const msg = Array.isArray(data?.message)
      ? data.message.join(' ')
      : String(data?.message || `HTTP ${response.status}`);
    lastError = `Fast2SMS (${route}): ${msg}`;

    // If API key itself is invalid or wallet balance is insufficient, stop retrying
    if (/invalid|authentication|balance|insufficient/i.test(msg)) {
      break;
    }
  }

  throw new Error(lastError);
}

// POST /api/auth/send-otp - Generate & dispatch real 6-digit SMS OTP via Fast2SMS
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    cleanupExpiredOtps();
    const purpose = req.body.purpose === 'reset' ? 'reset' : 'register';
    let digits10 = normalizeIndianMobile(req.body.phone);
    let targetUser = null;

    if (purpose === 'reset') {
      const lookupInput = req.body.identifier || req.body.phone;
      if (!lookupInput || !String(lookupInput).trim()) {
        return res.status(400).json({ error: 'Please enter your registered mobile number, USN, or @username.' });
      }
      targetUser = await findUserForReset(lookupInput);
      if (!targetUser) {
        return res.status(404).json({
          error: 'No CodeVortex account found matching that mobile number, College USN, or @username.'
        });
      }
      digits10 = normalizeIndianMobile(targetUser.userNumber);
      if (!digits10) {
        return res.status(400).json({
          error: `Account @${targetUser.username} does not have a valid 10-digit mobile number linked.`
        });
      }
    } else {
      if (!digits10) {
        return res.status(400).json({ error: 'Please enter a valid 10-digit Indian mobile number (e.g. 9876543210).' });
      }
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const key = `${purpose}:${digits10}`;

    // Dispatch real SMS via Fast2SMS before accepting the OTP session
    const smsResult = await sendFast2SmsOtp(digits10, code, purpose);

    otpStore.set(key, {
      code,
      expiresAt: Date.now() + OTP_TTL_MS,
      attempts: 0,
      userId: targetUser ? String(targetUser._id) : null,
      username: targetUser ? targetUser.username : null
    });

    const maskedPhone = maskMobile(digits10);
    console.log(
      `[CodeVortex Fast2SMS] Real OTP sent | Purpose: ${purpose.toUpperCase()} | To: ${maskedPhone} | Route: ${smsResult.route}`
    );

    return res.json({
      ok: true,
      purpose,
      phone: digits10,
      maskedPhone,
      username: targetUser ? targetUser.username : undefined,
      expiresInSec: Math.round(OTP_TTL_MS / 1000),
      message: `Real 6-digit SMS OTP sent to ${maskedPhone}. Please check your phone messages.`
    });
  } catch (err) {
    console.error('[CodeVortex Fast2SMS Error]:', err.message);
    const isConfigErr = /not configured/i.test(err.message);
    return res.status(isConfigErr ? 503 : 502).json({ error: err.message });
  }
});

// POST /api/auth/verify-otp - Verify 6-digit Mobile OTP and return a signed short-lived otpToken
app.post('/api/auth/verify-otp', (req, res) => {
  try {
    cleanupExpiredOtps();
    const purpose = req.body.purpose === 'reset' ? 'reset' : 'register';
    const digits10 = normalizeIndianMobile(req.body.phone);
    const enteredOtp = String(req.body.otp || '').replace(/\D/g, '');

    if (!digits10 || enteredOtp.length !== 6) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number and 6-digit OTP.' });
    }

    const key = `${purpose}:${digits10}`;
    const record = otpStore.get(key);
    if (!record) {
      return res.status(400).json({ error: 'OTP expired or not requested. Please click Send OTP again.' });
    }
    if (Date.now() > record.expiresAt) {
      otpStore.delete(key);
      return res.status(400).json({ error: 'OTP has expired. Please request a new OTP.' });
    }
    if (record.attempts >= 5) {
      otpStore.delete(key);
      return res.status(429).json({ error: 'Too many incorrect OTP attempts. Please request a new OTP.' });
    }

    if (record.code !== enteredOtp) {
      record.attempts += 1;
      return res.status(400).json({
        error: `Invalid OTP. Please check the 6-digit code (${5 - record.attempts} attempts left).`
      });
    }

    const otpToken = jwt.sign(
      {
        otpVerified: true,
        purpose,
        phone: digits10,
        userId: record.userId || null,
        username: record.username || null
      },
      JWT_SECRET,
      { expiresIn: '10m' }
    );

    otpStore.delete(key);
    return res.json({
      ok: true,
      otpToken,
      phone: digits10,
      maskedPhone: maskMobile(digits10),
      username: record.username || undefined,
      message: 'Mobile number verified successfully!'
    });
  } catch (err) {
    return res.status(500).json({ error: 'OTP verification failed: ' + err.message });
  }
});

// POST /api/auth/reset-password - Reset password after verifying Mobile OTP
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { otpToken, newPassword } = req.body;
    if (!otpToken) {
      return res.status(400).json({ error: 'OTP verification is required before resetting your password.' });
    }
    if (!newPassword || String(newPassword).length < 4) {
      return res.status(400).json({ error: 'New password must be at least 4 characters long.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(otpToken, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'OTP verification session expired. Please request a new OTP.' });
    }

    if (!decoded.otpVerified || decoded.purpose !== 'reset' || !decoded.phone) {
      return res.status(401).json({ error: 'Invalid password reset token.' });
    }

    const newHash = bcrypt.hashSync(String(newPassword), 10);
    let updatedUser = null;

    if (dbState.useMongo && mongoose && mongoose.connection.readyState === 1) {
      try {
        if (decoded.userId && mongoose.Types.ObjectId.isValid(decoded.userId)) {
          updatedUser = await User.findByIdAndUpdate(
            decoded.userId,
            { $set: { passwordHash: newHash } },
            { new: true }
          );
        }
        if (!updatedUser && decoded.username) {
          updatedUser = await User.findOneAndUpdate(
            { username: new RegExp(`^${escapeRegex(decoded.username)}$`, 'i') },
            { $set: { passwordHash: newHash } },
            { new: true }
          );
        }
      } catch (err) {
        console.warn('[CodeVortex] MongoDB password reset update error:', err.message);
      }
    }

    const localIdx = dbState.users.findIndex(
      (u) =>
        (decoded.userId && String(u._id) === String(decoded.userId)) ||
        (decoded.username && u.username && u.username.toLowerCase() === decoded.username.toLowerCase()) ||
        normalizeIndianMobile(u.userNumber) === decoded.phone
    );
    if (localIdx !== -1) {
      dbState.users[localIdx].passwordHash = newHash;
      if (!updatedUser) updatedUser = dbState.users[localIdx];
      saveLocalStore();
    }

    if (!updatedUser) {
      return res.status(404).json({ error: 'Account not found for password reset.' });
    }

    return res.json({
      ok: true,
      username: updatedUser.username,
      message: `Password updated for @${updatedUser.username}! You can now log in with your new password.`
    });
  } catch (err) {
    return res.status(500).json({ error: 'Password reset failed: ' + err.message });
  }
});

// POST /api/auth/register - Create a new student or organizer account
app.post('/api/auth/register', async (req, res) => {
  try {
    const {
      collegeId,
      username,
      name,
      userNumber = '',
      otpToken = '',
      password,
      role = 'student',
      college,
      city = '',
      branch = 'CSE',
      year = 2,
      bio = '',
      skills = [],
      interests = [],
      achievements = [],
      portfolioUrl = '',
      resumeUrl = '',
      hostelOrCampus = '',
      showRealName = false,
      showUserNumber = false,
      contactLinks = {}
    } = req.body;

    if (!collegeId || !username || !name || !password || !college) {
      return res.status(400).json({
        error: 'College ID, custom @username, full name, college name, and password are required.'
      });
    }

    const normalizedPhone = normalizeIndianMobile(userNumber);
    if (!normalizedPhone) {
      return res.status(400).json({
        error: 'A valid 10-digit mobile number is required for OTP verification.'
      });
    }
    if (!otpToken) {
      return res.status(400).json({
        error: 'Please verify your mobile number with the 6-digit OTP before creating your account.'
      });
    }
    let decodedOtp;
    try {
      decodedOtp = jwt.verify(otpToken, JWT_SECRET);
    } catch {
      return res.status(401).json({
        error: 'Mobile OTP verification expired. Please click Send OTP and verify again.'
      });
    }
    if (!decodedOtp.otpVerified || decodedOtp.purpose !== 'register' || decodedOtp.phone !== normalizedPhone) {
      return res.status(401).json({
        error: 'Verified OTP does not match the entered mobile number. Please verify your mobile number again.'
      });
    }

    if (!isAllowedRegionalLocation(college, city)) {
      return res.status(400).json({
        error:
          'CodeVortex is exclusively for engineering colleges in Belagavi, Bagalkot, and Dharwad districts of Karnataka.'
      });
    }

    const cleanCollegeId = String(collegeId).trim().toUpperCase();
    const cleanUsername = String(username).trim().replace(/^@/, '').toLowerCase();

    const passwordHash = bcrypt.hashSync(password, 10);
    const newUserDoc = {
      collegeId: cleanCollegeId,
      username: cleanUsername,
      name: String(name).trim(),
      avatarUrl: req.body.avatarUrl ? String(req.body.avatarUrl).trim() : '',
      userNumber: `+91-${normalizedPhone}`,
      privacy: {
        showRealName: showRealName !== undefined ? Boolean(showRealName) : true,
        showUserNumber: Boolean(showUserNumber)
      },
      passwordHash,
      role: role === 'organizer' ? 'organizer' : 'student',
      college: String(college).trim(),
      city: String(city).trim(),
      branch: String(branch).trim(),
      year: Number(year) || 2,
      bio: String(bio).trim(),
      skills: parseListField(skills),
      interests: parseListField(interests),
      achievements: parseListField(achievements),
      portfolioUrl: String(portfolioUrl).trim(),
      resumeUrl: String(resumeUrl).trim(),
      hostelOrCampus: String(hostelOrCampus).trim(),
      lookingForTeam: true,
      followers: [],
      following: [],
      posts: [],
      bookmarkedEvents: [],
      contactLinks: {
        github: contactLinks.github || '',
        linkedin: contactLinks.linkedin || '',
        discord: contactLinks.discord || '',
        whatsapp: contactLinks.whatsapp || ''
      }
    };

    let existing = null;
    if (dbState.useMongo && mongoose && mongoose.connection.readyState === 1) {
      try {
        existing = await User.findOne({
          $or: [
            { collegeId: new RegExp(`^${escapeRegex(cleanCollegeId)}$`, 'i') },
            { username: new RegExp(`^${escapeRegex(cleanUsername)}$`, 'i') }
          ]
        }).lean();
      } catch (err) {
        console.warn('[CodeVortex] MongoDB findOne error, falling back to local store check:', err.message);
        existing = dbState.users.find(
          (u) =>
            (u.collegeId && u.collegeId.toUpperCase() === cleanCollegeId) ||
            (u.username && u.username.toLowerCase() === cleanUsername)
        );
      }
    } else {
      existing = dbState.users.find(
        (u) =>
          (u.collegeId && u.collegeId.toUpperCase() === cleanCollegeId) ||
          (u.username && u.username.toLowerCase() === cleanUsername)
      );
    }

    if (existing) {
      const isIdTaken = existing.collegeId && existing.collegeId.toUpperCase() === cleanCollegeId;
      const isUserTaken = existing.username && existing.username.toLowerCase() === cleanUsername;
      let msg = 'An account with this College ID or @username already exists.';
      if (isIdTaken && isUserTaken) {
        msg = `Both College ID "${cleanCollegeId}" and @${cleanUsername} are already registered. Please log in instead.`;
      } else if (isIdTaken) {
        msg = `College ID "${cleanCollegeId}" is already registered. If this is your account, please log in with your password.`;
      } else if (isUserTaken) {
        msg = `@${cleanUsername} is already taken. Please choose a different @username handle.`;
      }
      return res.status(400).json({ error: msg });
    }

    let created = {
      _id: `u_${Date.now()}`,
      ...newUserDoc
    };

    if (dbState.useMongo && mongoose && mongoose.connection.readyState === 1) {
      try {
        const mongoCreated = await User.create(newUserDoc);
        created = mongoCreated;
      } catch (err) {
        if (err.code === 11000) {
          const keyPattern = err.keyPattern || {};
          const field = Object.keys(keyPattern)[0] || 'College ID or username';
          const label = field === 'collegeId' ? 'College ID' : field === 'username' ? '@username handle' : field;
          return res.status(400).json({
            error: `That ${label} is already in use in the database. Please enter a different one.`
          });
        }
        console.warn('[CodeVortex] MongoDB register create failed, saving locally:', err.message);
      }
    }

    const plain = created.toObject ? created.toObject() : created;
    const existingIdx = dbState.users.findIndex((u) => String(u._id) === String(plain._id));
    if (existingIdx !== -1) {
      dbState.users[existingIdx] = plain;
    } else {
      dbState.users.push(plain);
    }
    saveLocalStore();
    const token = createToken(created);
    return res.status(201).json({
      token,
      user: sanitizeUser(created, { isSelf: true })
    });
  } catch (err) {
    return res.status(500).json({ error: 'Registration failed: ' + err.message });
  }
});

// POST /api/auth/login - Login with College ID (or @username) + password
app.post('/api/auth/login', async (req, res) => {
  try {
    const { collegeId, password } = req.body;
    if (!collegeId) {
      return res.status(400).json({ error: 'Please enter your College ID (or @username).' });
    }
    if (!password) {
      return res.status(400).json({ error: 'Password is required.' });
    }

    const identifier = String(collegeId).trim().replace(/^@/, '');
    let user = null;

    if (dbState.useMongo && mongoose && mongoose.connection.readyState === 1) {
      try {
        user = await User.findOne({
          $or: [
            { collegeId: new RegExp(`^${identifier}$`, 'i') },
            { username: new RegExp(`^${identifier}$`, 'i') }
          ]
        });
      } catch (err) {
        console.warn('[CodeVortex] MongoDB login query failed, checking local store:', err.message);
        user = null;
      }
    }

    if (!user) {
      user = dbState.users.find(
        (u) =>
          u.collegeId.toLowerCase() === identifier.toLowerCase() ||
          u.username.toLowerCase() === identifier.toLowerCase()
      );
    }

    if (!user) {
      return res.status(404).json({ error: 'No account found with that College ID or @username. Please Sign Up first.' });
    }

    const valid = bcrypt.compareSync(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid password.' });
    }

    const token = createToken(user);
    return res.json({
      token,
      user: sanitizeUser(user, { isSelf: true })
    });
  } catch (err) {
    return res.status(500).json({ error: 'Login failed: ' + err.message });
  }
});

// GET /api/auth/me - Fetch current logged-in user's full profile & privacy settings
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const user = await findUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User profile not found.' });
    }
    return res.json({ user: sanitizeUser(user, { isSelf: true }) });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load profile: ' + err.message });
  }
});

// PUT /api/users/profile - Update custom @username, privacy toggles, skills, achievements, portfolio & contact links
app.put('/api/users/profile', requireAuth, async (req, res) => {
  try {
    const updates = req.body;
    let user = await findUserById(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Check username uniqueness if changing @username
    if (updates.username !== undefined) {
      const cleanUsername = String(updates.username).trim().replace(/^@/, '').toLowerCase();
      if (cleanUsername && cleanUsername !== user.username.toLowerCase()) {
        let conflict = null;
        if (dbState.useMongo && mongoose && mongoose.connection.readyState === 1) {
          try {
            conflict = await User.findOne({
              username: new RegExp(`^${escapeRegex(cleanUsername)}$`, 'i'),
              _id: { $ne: user._id }
            }).lean();
          } catch {}
        }
        if (!conflict) {
          conflict = dbState.users.find(
            (u) => u.username.toLowerCase() === cleanUsername && String(u._id) !== String(user._id)
          );
        }
        if (conflict) {
          return res.status(400).json({ error: 'That @username is already taken by another student.' });
        }
        user.username = cleanUsername;
      }
    }

    if (updates.name !== undefined) user.name = String(updates.name).trim();
    if (updates.avatarUrl !== undefined) user.avatarUrl = String(updates.avatarUrl).trim();
    if (updates.userNumber !== undefined) user.userNumber = String(updates.userNumber).trim();
    if (updates.college !== undefined || updates.city !== undefined) {
      const nextCollege = updates.college !== undefined ? String(updates.college).trim() : user.college;
      const nextCity = updates.city !== undefined ? String(updates.city).trim() : user.city;
      if (!isAllowedRegionalLocation(nextCollege, nextCity)) {
        return res.status(400).json({
          error: 'Please enter a valid engineering college and state.'
        });
      }
      user.college = nextCollege;
      user.city = nextCity;
    }
    if (updates.branch !== undefined) user.branch = String(updates.branch).trim();
    if (updates.year !== undefined) user.year = Number(updates.year) || user.year;
    if (updates.bio !== undefined) user.bio = String(updates.bio).trim();
    if (updates.skills !== undefined) user.skills = parseListField(updates.skills);
    if (updates.interests !== undefined) user.interests = parseListField(updates.interests);
    if (updates.achievements !== undefined) user.achievements = parseListField(updates.achievements);
    if (updates.portfolioUrl !== undefined) user.portfolioUrl = String(updates.portfolioUrl).trim();
    if (updates.resumeUrl !== undefined) user.resumeUrl = String(updates.resumeUrl).trim();
    if (updates.hostelOrCampus !== undefined) user.hostelOrCampus = String(updates.hostelOrCampus).trim();
    if (updates.lookingForTeam !== undefined) user.lookingForTeam = Boolean(updates.lookingForTeam);

    if (updates.privacy !== undefined) {
      user.privacy = {
        showRealName: Boolean(updates.privacy.showRealName),
        showUserNumber: Boolean(updates.privacy.showUserNumber)
      };
    }

    if (updates.contactLinks !== undefined) {
      user.contactLinks = {
        github: updates.contactLinks.github ?? user.contactLinks?.github ?? '',
        linkedin: updates.contactLinks.linkedin ?? user.contactLinks?.linkedin ?? '',
        discord: updates.contactLinks.discord ?? user.contactLinks?.discord ?? '',
        whatsapp: updates.contactLinks.whatsapp ?? user.contactLinks?.whatsapp ?? ''
      };
    }

    if (typeof user.markModified === 'function') {
      user.markModified('privacy');
      user.markModified('contactLinks');
      user.markModified('skills');
      user.markModified('interests');
      user.markModified('achievements');
    }

    await persistUserData(user);

    return res.json({
      message: 'Profile updated successfully!',
      user: sanitizeUser(user, { isSelf: true }),
      publicPreview: sanitizeUser(user, { isSelf: false })
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not update profile: ' + err.message });
  }
});

// DELETE /api/auth/account - Delete current logged-in user account and cleanup associated requests
app.delete('/api/auth/account', requireAuth, async (req, res) => {
  try {
    const uid = String(req.user.id);
    if (dbState.useMongo && mongoose && mongoose.connection.readyState === 1) {
      await User.findByIdAndDelete(uid).catch(() => {});
      await User.updateMany(
        { $or: [{ followers: uid }, { following: uid }] },
        { $pull: { followers: uid, following: uid } }
      ).catch(() => {});
      await TeamRequest.deleteMany({ $or: [{ fromUser: uid }, { toUser: uid }] }).catch(() => {});
      await TeamPost.deleteMany({ leader: uid }).catch(() => {});
    }

    dbState.users = dbState.users
      .filter((u) => String(u._id) !== uid)
      .map((u) => ({
        ...u,
        followers: Array.isArray(u.followers) ? u.followers.filter((id) => String(id) !== uid) : [],
        following: Array.isArray(u.following) ? u.following.filter((id) => String(id) !== uid) : []
      }));
    dbState.teamRequests = dbState.teamRequests.filter(
      (r) => String(r.fromUser) !== uid && String(r.toUser) !== uid
    );
    dbState.teamPosts = dbState.teamPosts.filter((p) => String(p.leader) !== uid);
    saveLocalStore();

    return res.json({ message: 'Account deleted successfully.' });
  } catch (err) {
    return res.status(500).json({ error: 'Could not delete account: ' + err.message });
  }
});

// POST /api/users/posts - Add a new Post, Reel/Video, or Upload to the user's profile
app.post('/api/users/posts', requireAuth, async (req, res) => {
  try {
    const { type = 'post', title = '', caption = '', mediaUrl = '', tags = [] } = req.body;
    if (!title && !caption && !mediaUrl) {
      return res.status(400).json({ error: 'Please provide a title, caption, or media URL.' });
    }

    let user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const generatedPostId = `post_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newPost = {
      _id: generatedPostId,
      id: generatedPostId,
      type: ['post', 'reel', 'upload'].includes(type) ? type : 'post',
      title: String(title || '').trim(),
      caption: String(caption || '').trim(),
      mediaUrl: String(mediaUrl || '').trim(),
      tags: parseListField(tags),
      likes: [],
      createdAt: new Date()
    };

    user.posts = Array.isArray(user.posts) ? user.posts : [];
    user.posts.unshift(newPost);

    if (typeof user.markModified === 'function') {
      user.markModified('posts');
    }
    await persistUserData(user);

    return res.status(201).json({
      message: 'Published to your profile!',
      post: newPost,
      user: sanitizeUser(user, { isSelf: true })
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not create post: ' + err.message });
  }
});

// DELETE /api/users/posts/:postId - Delete a post/reel/upload from the user's profile
app.delete('/api/users/posts/:postId', requireAuth, async (req, res) => {
  try {
    const postId = String(req.params.postId);
    let user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    user.posts = (user.posts || []).filter(
      (p) => String(p.id || '') !== postId && String(p._id || '') !== postId
    );

    if (typeof user.markModified === 'function') {
      user.markModified('posts');
    }
    await persistUserData(user);

    return res.json({
      message: 'Post removed from your profile.',
      user: sanitizeUser(user, { isSelf: true })
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not delete post: ' + err.message });
  }
});

// POST /api/users/:userId/posts/:postId/like - Toggle Like on any user's profile post or reel
app.post('/api/users/:userId/posts/:postId/like', requireAuth, async (req, res) => {
  try {
    const ownerId = String(req.params.userId);
    const postId = String(req.params.postId);
    const likerId = String(req.user.id);

    let owner = await findUserById(ownerId);
    if (!owner) {
      return res.status(404).json({ error: 'User not found.' });
    }

    owner.posts = Array.isArray(owner.posts) ? owner.posts : [];
    const targetPost = owner.posts.find(
      (p) => String(p.id || '') === postId || String(p._id || '') === postId
    );
    if (!targetPost) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    targetPost.likes = Array.isArray(targetPost.likes) ? targetPost.likes.map(String) : [];
    let liked = false;
    if (targetPost.likes.includes(likerId)) {
      targetPost.likes = targetPost.likes.filter((id) => id !== likerId);
      liked = false;
    } else {
      targetPost.likes.push(likerId);
      liked = true;
    }

    if (typeof owner.markModified === 'function') {
      owner.markModified('posts');
    }
    await persistUserData(owner);

    const isSelf = ownerId === likerId;
    return res.json({
      liked,
      likesCount: targetPost.likes.length,
      likes: targetPost.likes,
      profile: sanitizeUser(owner, { isSelf })
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not toggle like: ' + err.message });
  }
});

// POST /api/users/:targetId/follow - Toggle Follow / Unfollow a user
app.post('/api/users/:targetId/follow', requireAuth, async (req, res) => {
  try {
    const targetId = String(req.params.targetId);
    const currentId = String(req.user.id);
    if (targetId === currentId) {
      return res.status(400).json({ error: 'You cannot follow yourself.' });
    }

    let me = await findUserById(currentId);
    let target = await findUserById(targetId);

    if (!me) {
      return res.status(404).json({ error: 'Your user session was not found. Please log in again.' });
    }

    me.following = Array.isArray(me.following) ? me.following.map(String) : [];
    if (target) {
      target.followers = Array.isArray(target.followers) ? target.followers.map(String) : [];
    }

    let isFollowing = false;
    if (me.following.includes(targetId)) {
      me.following = me.following.filter((id) => id !== targetId);
      if (target) {
        target.followers = target.followers.filter((id) => id !== currentId);
      }
      isFollowing = false;
    } else {
      me.following.push(targetId);
      if (target && !target.followers.includes(currentId)) {
        target.followers.push(currentId);
      }
      isFollowing = true;
    }

    if (typeof me.markModified === 'function') me.markModified('following');
    await persistUserData(me);
    if (target) {
      if (typeof target.markModified === 'function') target.markModified('followers');
      await persistUserData(target);
    }

    return res.json({
      following: isFollowing,
      isFollowing,
      myFollowingCount: me.following.length,
      targetFollowersCount: target ? target.followers.length : 0,
      user: sanitizeUser(me, { isSelf: true }),
      targetUser: target ? sanitizeUser(target, { isSelf: false }) : null
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not update follow status: ' + err.message });
  }
});

// GET /api/users/profile/:identifier - Fetch any user's public Instagram-style profile by ID or @username
app.get('/api/users/profile/:identifier', optionalAuth, async (req, res) => {
  try {
    const rawId = String(req.params.identifier || '').trim().replace(/^@/, '');
    if (!rawId) {
      return res.status(400).json({ error: 'User identifier is required.' });
    }

    let target = null;
    let allUsers = [];

    if (dbState.useMongo && mongoose && mongoose.connection.readyState === 1) {
      try {
        allUsers = await User.find().lean();
      } catch {
        allUsers = dbState.users;
      }
    } else {
      allUsers = dbState.users;
    }

    target = allUsers.find(
      (u) =>
        String(u._id) === rawId ||
        String(u.username || '').toLowerCase() === rawId.toLowerCase()
    );

    if (!target) {
      return res.status(404).json({ error: 'User profile not found.' });
    }

    const viewerId = req.user ? String(req.user.id) : null;
    const targetId = String(target._id);
    const isSelf = Boolean(viewerId && viewerId === targetId);

    const userMap = new Map(allUsers.map((u) => [String(u._id), u]));
    const toMiniUser = (uid) => {
      const u = userMap.get(String(uid));
      if (!u) return null;
      const showReal = u.privacy?.showRealName !== false;
      return {
        _id: String(u._id),
        username: u.username,
        name: showReal ? u.name : u.username,
        avatarUrl: u.avatarUrl || '',
        college: u.college || '',
        branch: u.branch || ''
      };
    };

    const followersList = (target.followers || []).map(toMiniUser).filter(Boolean);
    const followingList = (target.following || []).map(toMiniUser).filter(Boolean);

    return res.json({
      isSelf,
      profile: sanitizeUser(target, { isSelf }),
      followersList,
      followingList
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load user profile: ' + err.message });
  }
});

// ============================================================================
// DAY 3 ROUTES: REAL-TIME COMPETITION DATA APIs (UNSTOP + CODEFORCES) & FESTS HUB
// ============================================================================

const liveApiCache = {
  events: [],
  lastSyncedAt: null,
  apiSources: [],
  interactions: new Map() // eventId -> { interestedUsers: Set, bookmarkedBy: Set }
};

function getInteractionSets(eventId, initialInterested = [], initialBookmarked = []) {
  const key = String(eventId);
  if (!liveApiCache.interactions.has(key)) {
    liveApiCache.interactions.set(key, {
      interestedUsers: new Set((initialInterested || []).map(String)),
      bookmarkedBy: new Set((initialBookmarked || []).map(String))
    });
  }
  return liveApiCache.interactions.get(key);
}

function stripHtmlTags(str = '') {
  return String(str)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseValidDate(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

async function fetchUnstopOpportunityDetail(oppId) {
  if (!oppId) return null;
  try {
    const res = await fetch(`https://unstop.com/api/public/opportunity/${oppId}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CodeVortex/1.0'
      },
      signal: AbortSignal.timeout(3500)
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data?.competition || json?.data || null;
  } catch {
    return null;
  }
}

function extractUnstopCompetitionDates(item, detailComp = null) {
  const nowMs = Date.now();
  const regStart =
    parseValidDate(detailComp?.regnRequirements?.start_regn_dt) ||
    parseValidDate(item?.regnRequirements?.start_regn_dt);

  let regDeadline =
    parseValidDate(detailComp?.regnRequirements?.end_regn_dt) ||
    parseValidDate(item?.regnRequirements?.end_regn_dt) ||
    parseValidDate(detailComp?.regn_end_date) ||
    parseValidDate(item?.regn_end_date);

  const oppEndDate =
    parseValidDate(detailComp?.end_date) ||
    parseValidDate(item?.end_date);

  if (!regDeadline && oppEndDate) {
    regDeadline = oppEndDate;
  }

  let eventStartDate = null;
  let eventEndDate = null;

  const rounds =
    Array.isArray(detailComp?.rounds) && detailComp.rounds.length > 0
      ? detailComp.rounds
      : Array.isArray(item?.rounds)
      ? item.rounds
      : [];

  if (rounds.length > 0) {
    const parsedRounds = rounds
      .map((r) => ({
        start: parseValidDate(r?.start_date),
        end: parseValidDate(r?.end_date)
      }))
      .filter((r) => r.start || r.end);

    // Prefer a round whose start date is distinct from the listing's registration opening date
    const distinctRound =
      parsedRounds.find(
        (r) =>
          r.start &&
          r.start.getTime() >= nowMs - 24 * 3600 * 1000 &&
          (!regStart || Math.abs(r.start.getTime() - regStart.getTime()) > 12 * 3600 * 1000)
      ) ||
      parsedRounds.find(
        (r) =>
          r.start &&
          (!regStart || Math.abs(r.start.getTime() - regStart.getTime()) > 12 * 3600 * 1000)
      ) ||
      parsedRounds[parsedRounds.length - 1];

    if (distinctRound) {
      eventStartDate = distinctRound.start || distinctRound.end;
      eventEndDate = distinctRound.end || distinctRound.start;
    }
  }

  if (!eventStartDate) {
    const festStart =
      parseValidDate(detailComp?.festival?.start_date) ||
      parseValidDate(item?.festival?.start_date);
    const festEnd =
      parseValidDate(detailComp?.festival?.end_date) ||
      parseValidDate(item?.festival?.end_date);
    if (festStart && festStart.getTime() >= nowMs - 7 * 86400000) {
      eventStartDate = festStart;
      eventEndDate = festEnd || festStart;
    }
  }

  if (!eventStartDate) {
    const rawStart =
      parseValidDate(detailComp?.start_date) ||
      parseValidDate(item?.start_date);
    // Only use rawStart if it is genuinely in the future and not equal to when registration opened
    if (
      rawStart &&
      rawStart.getTime() > nowMs + 3600 * 1000 &&
      (!regStart || Math.abs(rawStart.getTime() - regStart.getTime()) > 12 * 3600 * 1000)
    ) {
      eventStartDate = rawStart;
      eventEndDate = oppEndDate || rawStart;
    }
  }

  // On Unstop, end_date is the scheduled competition/finale date when start_date is absent or equals regStart
  if (!eventStartDate && oppEndDate) {
    eventStartDate = oppEndDate;
    eventEndDate = oppEndDate;
  }

  if (!eventStartDate && regDeadline) {
    eventStartDate = regDeadline;
  }
  if (!regDeadline && eventStartDate) {
    regDeadline = eventStartDate;
  }

  const fmt = (d) =>
    d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'TBA';

  let eventDateLabel = fmt(eventStartDate);
  if (
    eventStartDate &&
    eventEndDate &&
    fmt(eventStartDate) !== fmt(eventEndDate) &&
    eventEndDate.getTime() > eventStartDate.getTime()
  ) {
    const startDayMonth = eventStartDate.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short'
    });
    eventDateLabel = `${startDayMonth} – ${fmt(eventEndDate)}`;
  }

  return {
    startDate: eventStartDate,
    registrationDeadline: regDeadline,
    eventDateLabel,
    regDeadlineLabel: fmt(regDeadline)
  };
}

async function fetchUnstopOpportunities(opportunityType = 'hackathons', perPage = 12) {
  const url = `https://unstop.com/api/public/opportunity/search-result?opportunity=${opportunityType}&page=1&per_page=${perPage}&oppstatus=open`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CodeVortex/1.0'
    },
    signal: AbortSignal.timeout(7000)
  });
  if (!res.ok) throw new Error(`Unstop API HTTP ${res.status}`);
  const json = await res.json();
  const rows = (json?.data?.data || []).filter(
    (item) => item && item.title && (item.seo_url || item.public_url)
  );

  const detailResults = await Promise.allSettled(
    rows.map((item) => fetchUnstopOpportunityDetail(item.id))
  );

  return rows.map((item, idx) => {
    const detailComp =
      detailResults[idx]?.status === 'fulfilled' ? detailResults[idx].value : null;

    const seoUrl = item.seo_url
      ? item.seo_url.startsWith('http')
        ? item.seo_url
        : `https://unstop.com/${String(item.seo_url).replace(/^\//, '')}`
      : `https://unstop.com/o/${item.public_url}`;

    const orgName =
      item.organisation?.name ||
      detailComp?.organisation?.name ||
      item.Soundex_name ||
      item.festival?.title ||
      'Verified Unstop Host Institution';

    const rawCity =
      item.address_with_country_logo?.city ||
      item.address_with_country_logo?.state ||
      (String(item.region || '').toLowerCase() === 'online' ? 'Online (National)' : 'India');

    const minTeam =
      item.regnRequirements?.min_team_size || detailComp?.regnRequirements?.min_team_size || 1;
    const maxTeam =
      item.regnRequirements?.max_team_size || detailComp?.regnRequirements?.max_team_size || 4;
    const teamSize =
      minTeam === maxTeam
        ? `${minTeam} Member${minTeam === 1 ? '' : 's'}`
        : `${minTeam} - ${maxTeam} Members`;

    let prizeText = 'Official Unstop Verified Prizes & Certificates';
    const prizesArr =
      Array.isArray(item.prizes) && item.prizes.length > 0
        ? item.prizes
        : Array.isArray(detailComp?.prizes)
        ? detailComp.prizes
        : [];
    if (prizesArr.length > 0) {
      const totalCash = prizesArr.reduce((acc, p) => acc + (Number(p.cash) || 0), 0);
      if (totalCash > 0) {
        prizeText = `₹${totalCash.toLocaleString('en-IN')} Prize Pool`;
      }
    } else if (item.jobDetail?.max_salary) {
      prizeText = `₹${Number(item.jobDetail.max_salary).toLocaleString('en-IN')} / Stipend`;
    }

    const rawTags = [];
    if (Array.isArray(item.filters)) {
      for (const f of item.filters.slice(0, 5)) {
        if (f?.name) rawTags.push(f.name);
      }
    }
    if (rawTags.length === 0) {
      rawTags.push(opportunityType === 'hackathons' ? 'Hackathon' : 'Engineering Competition');
    }

    const subtype = String(item.subtype || item.type || '').toLowerCase();
    let category = opportunityType === 'hackathons' ? 'Hackathon' : 'Tech Fest';
    if (subtype.includes('coding') || subtype.includes('code')) category = 'Coding Contest';
    else if (subtype.includes('robot') || subtype.includes('hardware')) category = 'Robotics';
    else if (subtype.includes('paper') || subtype.includes('case') || subtype.includes('project'))
      category = 'Paper/Project';

    const mode =
      String(item.region || '').toLowerCase() === 'online'
        ? 'Online'
        : String(item.region || '').toLowerCase() === 'offline'
        ? 'Offline'
        : 'Hybrid';

    const dates = extractUnstopCompetitionDates(item, detailComp);

    const rawLogo =
      item.logoUrl2 ||
      item.organisation?.logoUrl2 ||
      item.organisation?.logoUrl ||
      detailComp?.logoUrl2 ||
      '';
    const logoUrl =
      rawLogo && String(rawLogo).startsWith('http')
        ? String(rawLogo)
        : '';

    const rawBanner =
      item.banner_mobile?.image_url ||
      detailComp?.banner_mobile?.image_url ||
      '';
    const bannerUrl =
      rawBanner && String(rawBanner).startsWith('http')
        ? String(rawBanner)
        : '';

    const registerCount = Number(
      item.registerCount ||
        detailComp?.registerCount ||
        item.regnRequirements?.registerCount ||
        0
    );

    const roundsRaw =
      Array.isArray(detailComp?.rounds) && detailComp.rounds.length > 0
        ? detailComp.rounds
        : Array.isArray(item?.rounds)
        ? item.rounds
        : [];
    const roundsSummary = roundsRaw.slice(0, 4).map((r, i) => ({
      title: String(r?.title || `Round ${i + 1}`).trim(),
      startDate: parseValidDate(r?.start_date),
      endDate: parseValidDate(r?.end_date),
      description: stripHtmlTags(r?.details || r?.description || '').slice(0, 140)
    }));

    return {
      _id: `unstop_${item.id}`,
      title: String(item.title).trim(),
      organizerCollege: String(orgName).trim(),
      city: String(rawCity).trim(),
      mode,
      category,
      isOfficial: true,
      apiSource: 'Unstop Live API',
      logoUrl,
      bannerUrl,
      registerCount,
      roundsSummary,
      startDate: dates.startDate,
      registrationDeadline: dates.registrationDeadline,
      eventDateLabel: dates.eventDateLabel,
      regDeadlineLabel: dates.regDeadlineLabel,
      teamSize,
      entryFee: item.is_paid ? 'Paid' : 'Free',
      prizePool: prizeText,
      registrationUrl: seoUrl,
      tags: rawTags,
      description:
        stripHtmlTags(item.details || item.seo_details || detailComp?.details || '')
          .slice(0, 220) ||
        `Official competition hosted by ${orgName} (${
          registerCount ? registerCount.toLocaleString('en-IN') + ' registered' : 'Open for registration'
        }).`,
      interestedUsers: [],
      bookmarkedBy: []
    };
  });
}

async function fetchCodeforcesContests(limit = 8) {
  const url = 'https://codeforces.com/api/contest.list?gym=false';
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'CodeVortex/1.0' },
    signal: AbortSignal.timeout(7000)
  });
  if (!res.ok) throw new Error(`Codeforces API HTTP ${res.status}`);
  const json = await res.json();
  if (json.status !== 'OK' || !Array.isArray(json.result)) {
    throw new Error('Unexpected Codeforces API response');
  }

  const upcoming = json.result
    .filter((c) => (c.phase === 'BEFORE' || c.phase === 'CODING') && c.startTimeSeconds)
    .sort((a, b) => (a.startTimeSeconds || 0) - (b.startTimeSeconds || 0))
    .slice(0, limit);

  return upcoming.map((c) => {
    const startMs = c.startTimeSeconds * 1000;
    const startDateObj = new Date(startMs);
    const regDeadlineObj = new Date(startMs - 15 * 60 * 1000);
    const durationHrs = Math.round(((c.durationSeconds || 7200) / 3600) * 10) / 10;
    const dateFmt = startDateObj.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
    return {
      _id: `cf_${c.id}`,
      title: c.name,
      organizerCollege: 'Codeforces Official Competitive Programming Arena',
      city: 'Online (All India)',
      mode: 'Online',
      category: 'Coding Contest',
      isOfficial: true,
      apiSource: 'Codeforces Live API',
      startDate: startDateObj,
      registrationDeadline: regDeadlineObj,
      eventDateLabel: dateFmt,
      regDeadlineLabel: dateFmt,
      teamSize: c.type === 'ICPC' ? '1 - 3 Members (ICPC Rules)' : 'Individual / Squad Practice',
      entryFee: 'Free',
      prizePool: `Official Rating + Global Leaderboard (${durationHrs} hrs)`,
      registrationUrl: `https://codeforces.com/contests/${c.id}`,
      tags: ['Competitive Programming', c.type || 'CF', 'Algorithms'],
      description: `Official ${c.type} algorithmic coding contest on Codeforces. Duration: ${durationHrs} hours.`,
      interestedUsers: [],
      bookmarkedBy: []
    };
  });
}

async function syncRealTimeCompetitions(force = false) {
  const now = Date.now();
  // Refresh cache every 5 minutes unless force === true
  if (
    !force &&
    liveApiCache.lastSyncedAt &&
    now - new Date(liveApiCache.lastSyncedAt).getTime() < 5 * 60 * 1000 &&
    liveApiCache.events.length > 0
  ) {
    return liveApiCache;
  }

  const sources = [];
  const aggregated = [];

  const [unstopHackRes, unstopCompRes, cfRes] = await Promise.allSettled([
    fetchUnstopOpportunities('hackathons', 12),
    fetchUnstopOpportunities('competitions', 10),
    fetchCodeforcesContests(8)
  ]);

  if (unstopHackRes.status === 'fulfilled' && unstopHackRes.value.length > 0) {
    aggregated.push(...unstopHackRes.value);
    sources.push(`Unstop Hackathons API (${unstopHackRes.value.length})`);
  }
  if (unstopCompRes.status === 'fulfilled' && unstopCompRes.value.length > 0) {
    aggregated.push(...unstopCompRes.value);
    sources.push(`Unstop Competitions API (${unstopCompRes.value.length})`);
  }
  if (cfRes.status === 'fulfilled' && cfRes.value.length > 0) {
    aggregated.push(...cfRes.value);
    sources.push(`Codeforces Contests API (${cfRes.value.length})`);
  }

  // Deduplicate by _id
  const seen = new Set();
  const uniqueEvents = [];
  for (const ev of aggregated) {
    if (!seen.has(ev._id)) {
      seen.add(ev._id);
      uniqueEvents.push(ev);
    }
  }

  if (uniqueEvents.length > 0) {
    liveApiCache.events = uniqueEvents;
    liveApiCache.lastSyncedAt = new Date().toISOString();
    liveApiCache.apiSources = sources;
  }

  return liveApiCache;
}

function formatEventForClient(rawEvent, currentUserId = null) {
  const ev = rawEvent.toObject ? rawEvent.toObject() : { ...rawEvent };
  const sets = getInteractionSets(ev._id, ev.interestedUsers, ev.bookmarkedBy);
  const interestedIds = Array.from(sets.interestedUsers);
  const bookmarkedIds = Array.from(sets.bookmarkedBy);

  return {
    ...ev,
    apiSource: ev.apiSource || (ev.isOfficial ? 'Official Verified Portal' : 'Verified Submission'),
    interestedCount: interestedIds.length,
    bookmarkCount: bookmarkedIds.length,
    isInterested: currentUserId ? interestedIds.includes(String(currentUserId)) : false,
    isBookmarked: currentUserId ? bookmarkedIds.includes(String(currentUserId)) : false
  };
}

// POST /api/events/sync - Force real-time sync with external competition APIs
app.post('/api/events/sync', optionalAuth, async (req, res) => {
  try {
    const synced = await syncRealTimeCompetitions(true);
    return res.json({
      message: `Feed refreshed with ${synced.events.length} competitions.`,
      lastSyncedAt: synced.lastSyncedAt,
      totalLiveEvents: synced.events.length
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not refresh feed: ' + err.message });
  }
});

// GET /api/events - Fetch real-time API competitions + verified official events
app.get('/api/events', optionalAuth, async (req, res) => {
  try {
    const {
      q = '',
      state = 'All',
      district = 'All',
      college = 'All',
      category = 'All',
      mode = 'All',
      fee = 'All',
      source = 'All',
      bookmarked = 'false',
      refresh = 'false'
    } = req.query;

    const currentUserId = req.user ? String(req.user.id) : null;
    await syncRealTimeCompetitions(refresh === 'true');

    let customEventsList = [];
    if (dbState.useMongo && mongoose && mongoose.connection.readyState === 1) {
      try {
        customEventsList = await Event.find().sort({ startDate: 1 });
      } catch {
        customEventsList = [...dbState.events];
      }
    } else {
      customEventsList = [...dbState.events];
    }

    // Only include events that have an official registration URL
    const validCustomEvents = customEventsList.filter(
      (e) => e.registrationUrl && String(e.registrationUrl).trim().startsWith('http')
    );

    const combinedEvents = [...validCustomEvents, ...liveApiCache.events];
    const queryText = String(q).trim().toLowerCase();

    const filtered = combinedEvents
      .map((ev) => formatEventForClient(ev, currentUserId))
      .filter((ev) => {
        if (queryText) {
          const hay = [
            ev.title,
            ev.organizerCollege,
            ev.city,
            ev.category,
            ev.apiSource,
            ...(ev.tags || []),
            ev.description
          ]
            .join(' ')
            .toLowerCase();
          if (!hay.includes(queryText)) return false;
        }

        if (state && state !== 'All') {
          const locText = `${ev.organizerCollege} ${ev.city}`;
          if (!matchesStateOrLocation(locText, state)) return false;
        }

        if (district && district !== 'All') {
          const locText = `${ev.organizerCollege} ${ev.city}`;
          if (!matchesStateOrLocation(locText, district)) return false;
        }

        if (college && college !== 'All') {
          const colTarget = String(college).trim().toLowerCase();
          const colHay = `${ev.organizerCollege || ''} ${ev.title || ''}`.toLowerCase();
          if (!matchesStateOrLocation(colHay, colTarget)) return false;
        }

        if (category && category !== 'All' && ev.category !== category) {
          return false;
        }

        if (mode && mode !== 'All' && ev.mode !== mode) {
          return false;
        }

        if (source === 'unstop' && !String(ev.apiSource || '').toLowerCase().includes('unstop')) return false;
        if (source === 'codeforces' && !String(ev.apiSource || '').toLowerCase().includes('codeforces'))
          return false;
        if (source === 'official' && !ev.isOfficial) return false;

        const isFree =
          !ev.entryFee ||
          String(ev.entryFee).trim().toLowerCase() === 'free' ||
          String(ev.entryFee).trim() === '0';
        if (fee === 'free' && !isFree) return false;
        if (fee === 'paid' && isFree) return false;

        if (bookmarked === 'true') {
          if (!currentUserId || !ev.isBookmarked) return false;
        }

        return true;
      });

    return res.json({
      events: filtered,
      lastSyncedAt: liveApiCache.lastSyncedAt,
      apiSources: liveApiCache.apiSources
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load live competitions: ' + err.message });
  }
});

// POST /api/events - Post a new Verified Official Competition (requires official registrationUrl)
app.post('/api/events', requireAuth, async (req, res) => {
  try {
    const {
      title,
      organizerCollege,
      city,
      mode = 'Offline',
      category = 'Hackathon',
      startDate,
      registrationDeadline,
      teamSize = '2 - 4 Members',
      entryFee = 'Free',
      prizePool = 'TBA',
      registrationUrl = '',
      tags = [],
      description = ''
    } = req.body;

    if (!title || !organizerCollege || !city || !startDate || !registrationDeadline || !registrationUrl) {
      return res.status(400).json({
        error:
          'Title, organizer college, state, dates, and an Official Registration URL (https://...) are required.'
      });
    }

    if (!String(registrationUrl).trim().startsWith('http')) {
      return res.status(400).json({
        error: 'An official external URL starting with http:// or https:// is required (no unofficial feeds).'
      });
    }

    if (!isAllowedRegionalLocation(organizerCollege, city)) {
      return res.status(400).json({
        error: 'Please enter a valid host engineering college and state.'
      });
    }

    const newEventData = {
      title: String(title).trim(),
      organizerCollege: String(organizerCollege).trim(),
      city: String(city).trim(),
      mode: ['Offline', 'Online', 'Hybrid'].includes(mode) ? mode : 'Offline',
      category: ['Hackathon', 'Tech Fest', 'Robotics', 'Coding Contest', 'Paper/Project'].includes(
        category
      )
        ? category
        : 'Hackathon',
      isOfficial: true,
      apiSource: 'Official Portal',
      startDate: new Date(startDate),
      registrationDeadline: new Date(registrationDeadline),
      teamSize: String(teamSize || '2 - 4 Members').trim(),
      entryFee: String(entryFee || 'Free').trim(),
      prizePool: String(prizePool || 'TBA').trim(),
      registrationUrl: String(registrationUrl).trim(),
      tags: parseListField(tags),
      description: String(description || '').trim(),
      interestedUsers: [req.user.id],
      bookmarkedBy: [],
      postedBy: req.user.id
    };

    let created = {
      _id: `e_${Date.now()}`,
      ...newEventData
    };
    if (dbState.useMongo && mongoose && mongoose.connection.readyState === 1) {
      try {
        const mongoEv = await Event.create(newEventData);
        created = mongoEv.toObject ? mongoEv.toObject() : mongoEv;
        created._id = String(created._id);
      } catch (err) {
        console.warn('[CodeVortex] Event MongoDB save fallback:', err.message);
      }
    }
    dbState.events.unshift(created);
    saveLocalStore();
    return res.status(201).json({
      message: 'Competition published!',
      event: formatEventForClient(created, req.user.id)
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not create event: ' + err.message });
  }
});

function findEventAnywhere(eventId) {
  const fromLive = liveApiCache.events.find((e) => String(e._id) === String(eventId));
  if (fromLive) return fromLive;
  const fromMem = dbState.events.find((e) => String(e._id) === String(eventId));
  return fromMem || null;
}

// POST /api/events/:id/interest - Toggle "Interested / Looking for Teammates" on any live API or DB event
app.post('/api/events/:id/interest', requireAuth, async (req, res) => {
  try {
    const eventId = req.params.id;
    const userId = String(req.user.id);

    let targetEvent = findEventAnywhere(eventId);
    if (!targetEvent && dbState.useMongo && /^[0-9a-fA-F]{24}$/.test(eventId)) {
      targetEvent = await Event.findById(eventId);
    }
    if (!targetEvent) return res.status(404).json({ error: 'Competition not found.' });

    const sets = getInteractionSets(eventId, targetEvent.interestedUsers, targetEvent.bookmarkedBy);
    let interested = false;
    if (sets.interestedUsers.has(userId)) {
      sets.interestedUsers.delete(userId);
    } else {
      sets.interestedUsers.add(userId);
      interested = true;
    }

    return res.json({
      interested,
      event: formatEventForClient(targetEvent, userId)
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not update interest: ' + err.message });
  }
});

// POST /api/events/:id/bookmark - Toggle Bookmark/Save event on any live API or DB event
app.post('/api/events/:id/bookmark', requireAuth, async (req, res) => {
  try {
    const eventId = req.params.id;
    const userId = String(req.user.id);

    let targetEvent = findEventAnywhere(eventId);
    if (!targetEvent && dbState.useMongo && /^[0-9a-fA-F]{24}$/.test(eventId)) {
      targetEvent = await Event.findById(eventId);
    }
    if (!targetEvent) return res.status(404).json({ error: 'Competition not found.' });

    const sets = getInteractionSets(eventId, targetEvent.interestedUsers, targetEvent.bookmarkedBy);
    let bookmarked = false;
    if (sets.bookmarkedBy.has(userId)) {
      sets.bookmarkedBy.delete(userId);
    } else {
      sets.bookmarkedBy.add(userId);
      bookmarked = true;
    }

    // Also persist bookmarkedEvents on the User record
    const userDoc = await findUserById(userId);
    if (userDoc) {
      userDoc.bookmarkedEvents = Array.isArray(userDoc.bookmarkedEvents)
        ? userDoc.bookmarkedEvents.map(String)
        : [];
      if (bookmarked) {
        if (!userDoc.bookmarkedEvents.includes(String(eventId))) {
          userDoc.bookmarkedEvents.push(String(eventId));
        }
      } else {
        userDoc.bookmarkedEvents = userDoc.bookmarkedEvents.filter((id) => id !== String(eventId));
      }
      if (typeof userDoc.markModified === 'function') {
        userDoc.markModified('bookmarkedEvents');
      }
      await persistUserData(userDoc);
    }

    return res.json({
      bookmarked,
      event: formatEventForClient(targetEvent, userId)
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not toggle bookmark: ' + err.message });
  }
});

// ============================================================================
// DAY 4 ROUTES: STUDENT SKILL & ACHIEVEMENT DIRECTORY (/api/students)
// ============================================================================

// GET /api/students - Search & filter the multi-college Student Skill & Achievement Directory
app.get('/api/students', optionalAuth, async (req, res) => {
  try {
    const {
      q = '',
      state = 'All',
      district = 'All',
      skill = 'All',
      interest = 'All',
      college = '',
      branch = 'All',
      year = 'All',
      lookingForTeam = 'false'
    } = req.query;

    const currentUserId = req.user ? String(req.user.id) : null;

    let rawUsers = [];
    if (dbState.useMongo && mongoose && mongoose.connection.readyState === 1) {
      try {
        rawUsers = await User.find().sort({ createdAt: -1 });
      } catch {
        rawUsers = [...dbState.users];
      }
    } else {
      rawUsers = [...dbState.users];
    }

    const queryText = String(q).trim().toLowerCase();
    const collegeFilter = String(college).trim().toLowerCase();

    const availableCollegesSet = new Set();
    const availableDistrictsSet = new Set();
    for (const u of rawUsers) {
      if (u.college && String(u.college).trim()) {
        availableCollegesSet.add(String(u.college).trim());
      }
      if (u.city && String(u.city).trim()) {
        availableDistrictsSet.add(String(u.city).trim());
      }
    }

    const students = rawUsers
      .filter((u) => {
        if (u.role === 'organizer') return false;
        // Exclude the currently logged-in user's own profile from the Discover People directory
        if (currentUserId && String(u._id) === currentUserId) return false;
        if (req.user?.username && String(u.username || '').toLowerCase() === String(req.user.username).toLowerCase()) {
          return false;
        }
        return true;
      })
      .map((u) => {
        return sanitizeUser(u, { isSelf: false });
      })
      .filter((stu) => {
        if (queryText) {
          const searchableFields = [
            stu.username,
            stu.privacy?.showRealName ? stu.name : '',
            stu.college,
            stu.city,
            stu.branch,
            stu.bio,
            ...(stu.skills || []),
            ...(stu.interests || []),
            ...(stu.achievements || [])
          ]
            .join(' ')
            .toLowerCase();
          if (!searchableFields.includes(queryText)) return false;
        }

        if (state && state !== 'All') {
          const stuLoc = `${stu.college} ${stu.city}`;
          if (!matchesStateOrLocation(stuLoc, state)) return false;
        }

        if (district && district !== 'All') {
          const stuLoc = `${stu.college} ${stu.city}`;
          if (!matchesStateOrLocation(stuLoc, district)) return false;
        }

        if (skill && skill !== 'All') {
          const hasSkill = (stu.skills || []).some(
            (s) => s.toLowerCase() === String(skill).toLowerCase()
          );
          if (!hasSkill) return false;
        }

        if (interest && interest !== 'All') {
          const hasInterest = (stu.interests || []).some(
            (i) => i.toLowerCase() === String(interest).toLowerCase()
          );
          if (!hasInterest) return false;
        }

        if (collegeFilter && collegeFilter !== 'all') {
          if (!String(stu.college || '').toLowerCase().includes(collegeFilter)) {
            return false;
          }
        }

        if (branch && branch !== 'All') {
          if (String(stu.branch || '').toLowerCase() !== String(branch).toLowerCase()) {
            return false;
          }
        }

        if (year && year !== 'All') {
          if (Number(stu.year) !== Number(year)) return false;
        }

        if (lookingForTeam === 'true' && !stu.lookingForTeam) {
          return false;
        }

        return true;
      });

    return res.json({
      students,
      availableColleges: Array.from(availableCollegesSet),
      availableDistricts: Array.from(availableDistrictsSet)
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load student directory: ' + err.message });
  }
});

// ============================================================================
// DAY 5 ROUTE: UNIFIED OMNI-SEARCH (COLLEGE, @USERNAME, COMPETITION, TEAM, SKILL)
// ============================================================================

// GET /api/search?q=... - Searches across Colleges, @usernames, Competitions, Teams & Skills simultaneously
app.get('/api/search', optionalAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    if (!q) {
      return res.json({
        query: '',
        events: [],
        students: [],
        teamPosts: [],
        colleges: []
      });
    }

    const currentUserId = req.user ? String(req.user.id) : null;
    await syncRealTimeCompetitions(false);

    let rawUsers = [];
    let rawEvents = [];
    let rawTeamPosts = [];

    if (dbState.useMongo && mongoose && mongoose.connection.readyState === 1) {
      try {
        rawUsers = await User.find();
        rawEvents = await Event.find().sort({ startDate: 1 });
        rawTeamPosts = await TeamPost.find().populate('leader');
      } catch {
        rawUsers = [...dbState.users];
        rawEvents = [...dbState.events];
        rawTeamPosts = dbState.teamPosts.map((tp) => ({
          ...tp,
          leaderObj: dbState.users.find((u) => String(u._id) === String(tp.leader))
        }));
      }
    } else {
      rawUsers = [...dbState.users];
      rawEvents = [...dbState.events];
      rawTeamPosts = dbState.teamPosts.map((tp) => ({
        ...tp,
        leaderObj: dbState.users.find((u) => String(u._id) === String(tp.leader))
      }));
    }

    const allEvents = [
      ...rawEvents.filter((e) => e.registrationUrl && String(e.registrationUrl).trim().startsWith('http')),
      ...liveApiCache.events
    ];

    // 1. Match Tech Fests & Competitions
    const matchedEvents = allEvents
      .map((ev) => formatEventForClient(ev, currentUserId))
      .filter((ev) => {
        const hay = [
          ev.title,
          ev.organizerCollege,
          ev.city,
          ev.category,
          ev.mode,
          ev.apiSource,
          ...(ev.tags || []),
          ev.description
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });

    // 2. Match Students (respecting Privacy Shield)
    const matchedStudents = rawUsers
      .filter((u) => u.role !== 'organizer')
      .map((u) => {
        const uid = String(u._id);
        return sanitizeUser(u, {
          isSelf: currentUserId === uid
        });
      })
      .filter((stu) => {
        const hay = [
          stu.username,
          stu.privacy?.showRealName ? stu.name : '',
          stu.college,
          stu.city,
          stu.branch,
          ...(stu.skills || []),
          ...(stu.interests || []),
          ...(stu.achievements || [])
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });

    // 3. Match Open Group Team Posts
    const matchedTeams = rawTeamPosts
      .map((tp) => {
        const obj = tp.toObject ? tp.toObject() : { ...tp };
        const leaderRaw = obj.leaderObj || obj.leader;
        const leaderUser =
          leaderRaw && typeof leaderRaw === 'object'
            ? leaderRaw
            : rawUsers.find((u) => String(u._id) === String(obj.leader));
        return {
          _id: obj._id,
          teamName: obj.teamName,
          eventTitle: obj.eventTitle,
          currentMembers: obj.currentMembers,
          maxMembers: obj.maxMembers,
          neededRoles: obj.neededRoles || [],
          description: obj.description,
          leaderUsername: leaderUser ? leaderUser.username : 'team_leader',
          leaderCollege: leaderUser ? leaderUser.college : ''
        };
      })
      .filter((tp) => {
        const hay = [
          tp.teamName,
          tp.eventTitle,
          tp.leaderUsername,
          tp.leaderCollege,
          ...(tp.neededRoles || []),
          tp.description
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });

    // 4. Match Engineering Colleges Summary
    const collegeMap = new Map();
    for (const rc of REGIONAL_COLLEGES) {
      collegeMap.set(rc.name, {
        college: rc.name,
        city: rc.district,
        officialUrl: rc.officialUrl || '',
        studentCount: 0,
        eventCount: 0
      });
    }
    for (const u of rawUsers) {
      if (!u.college) continue;
      const key = u.college.trim();
      if (!collegeMap.has(key)) {
        collegeMap.set(key, { college: key, city: u.city || '', studentCount: 0, eventCount: 0 });
      }
      if (u.role !== 'organizer') {
        collegeMap.get(key).studentCount += 1;
      }
    }
    for (const ev of allEvents) {
      for (const [colName, info] of collegeMap.entries()) {
        if (String(ev.organizerCollege || '').toLowerCase().includes(colName.toLowerCase())) {
          info.eventCount += 1;
        }
      }
    }

    const matchedColleges = Array.from(collegeMap.values()).filter(
      (c) => c.college.toLowerCase().includes(q) || c.city.toLowerCase().includes(q)
    );

    return res.json({
      query: req.query.q,
      colleges: matchedColleges,
      events: matchedEvents,
      students: matchedStudents,
      teamPosts: matchedTeams,
      totalMatches:
        matchedColleges.length +
        matchedEvents.length +
        matchedStudents.length +
        matchedTeams.length
    });
  } catch (err) {
    return res.status(500).json({ error: 'Omni-search failed: ' + err.message });
  }
});

// ============================================================================
// DAY 6 & DAY 7 ROUTES: GROUP TEAM LOBBY, 1-ON-1 REQUESTS, CONTACT UNLOCKS & CHAT
// ============================================================================

async function findUserByIdAny(id) {
  return await findUserById(id);
}

async function syncTeamRequestToLocal(trDoc) {
  if (!trDoc) return;
  const plain = trDoc.toObject ? trDoc.toObject() : { ...trDoc };
  plain._id = String(plain._id);
  plain.fromUser = String(plain.fromUser);
  plain.toUser = String(plain.toUser);
  if (plain.lastReadAt instanceof Map) {
    plain.lastReadAt = Object.fromEntries(plain.lastReadAt);
  }
  const idx = dbState.teamRequests.findIndex((r) => String(r._id) === plain._id);
  if (idx !== -1) {
    dbState.teamRequests[idx] = plain;
  } else {
    dbState.teamRequests.unshift(plain);
  }
  saveLocalStore();
}

async function upsertTeamRequestBetweenUsers({ fromId, fromUsername, toId, eventTitle, note }) {
  const fId = String(fromId);
  const tId = String(toId);
  const cleanEvent = String(eventTitle).trim();
  const cleanNote = String(note).trim();

  let existing = null;
  if (
    dbState.useMongo &&
    mongoose &&
    mongoose.connection.readyState === 1 &&
    mongoose.Types.ObjectId.isValid(fId) &&
    mongoose.Types.ObjectId.isValid(tId)
  ) {
    try {
      existing = await TeamRequest.findOne({
        $or: [
          { fromUser: fId, toUser: tId },
          { fromUser: tId, toUser: fId }
        ],
        status: { $in: ['accepted', 'pending'] }
      }).sort({ updatedAt: -1 });
    } catch {}
  }

  if (!existing) {
    existing = dbState.teamRequests.find(
      (r) =>
        ((String(r.fromUser) === fId && String(r.toUser) === tId) ||
          (String(r.fromUser) === tId && String(r.toUser) === fId)) &&
        ['accepted', 'pending'].includes(r.status)
    );
  }

  if (existing) {
    // Case 1: Already connected (accepted) -> append message directly to chat
    if (existing.status === 'accepted') {
      const msgObj = {
        senderId: fId,
        senderName: fromUsername,
        text: `[${cleanEvent}] ${cleanNote}`,
        createdAt: new Date()
      };
      existing.messages = existing.messages || [];
      existing.messages.push(msgObj);
      if (existing.lastReadAt instanceof Map) {
        existing.lastReadAt.set(fId, new Date());
      } else {
        existing.lastReadAt = existing.lastReadAt || {};
        existing.lastReadAt[fId] = new Date().toISOString();
      }
      existing.updatedAt = new Date();
      if (typeof existing.save === 'function') {
        await existing.save().catch(() => {});
      }
      await syncTeamRequestToLocal(existing);
      return {
        alreadyConnected: true,
        message: 'You are already connected! Sent your message directly in Chat.',
        teamRequest: existing
      };
    }

    // Case 2: Pending request in same direction -> update note & eventTitle instead of duplicating
    if (String(existing.fromUser) === fId) {
      existing.eventTitle = cleanEvent;
      existing.note = cleanNote;
      existing.updatedAt = new Date();
      if (typeof existing.save === 'function') {
        await existing.save().catch(() => {});
      }
      await syncTeamRequestToLocal(existing);
      return {
        updatedExisting: true,
        message: 'Updated your pending Team-Up Request!',
        teamRequest: existing
      };
    }

    // Case 3: Pending request in reverse direction -> mutual interest! Auto-accept
    existing.status = 'accepted';
    existing.messages = existing.messages || [];
    existing.messages.push({
      senderId: fId,
      senderName: fromUsername,
      text: `🎉 Mutual Team-Up! ${cleanNote}`,
      createdAt: new Date()
    });
    if (existing.lastReadAt instanceof Map) {
      existing.lastReadAt.set(fId, new Date());
    } else {
      existing.lastReadAt = existing.lastReadAt || {};
      existing.lastReadAt[fId] = new Date().toISOString();
    }
    existing.updatedAt = new Date();
    if (typeof existing.save === 'function') {
      await existing.save().catch(() => {});
    }
    await syncTeamRequestToLocal(existing);
    return {
      alreadyConnected: true,
      message: '🤝 Mutual Team-Up! You both requested each other — Chat is now unlocked!',
      teamRequest: existing
    };
  }

  // Otherwise create a brand new pending request
  const reqData = {
    fromUser: fId,
    toUser: tId,
    eventTitle: cleanEvent,
    note: cleanNote,
    status: 'pending',
    messages: []
  };

  let created = {
    _id: `tr_${Date.now()}`,
    ...reqData,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (
    dbState.useMongo &&
    mongoose &&
    mongoose.connection.readyState === 1 &&
    mongoose.Types.ObjectId.isValid(fId) &&
    mongoose.Types.ObjectId.isValid(tId)
  ) {
    try {
      const mongoCreated = await TeamRequest.create(reqData);
      created = mongoCreated;
    } catch (err) {
      console.warn('[CodeVortex] TeamRequest MongoDB create fallback:', err.message);
    }
  }

  await syncTeamRequestToLocal(created);
  return {
    alreadyConnected: false,
    message: 'Team-Up Request sent!',
    teamRequest: created
  };
}

// GET /api/team-posts - Browse Open Group Team Lobby posts with optional search & role filter
app.get('/api/team-posts', optionalAuth, async (req, res) => {
  try {
    const { q = '', role = 'All' } = req.query;
    const queryText = String(q).trim().toLowerCase();
    const roleFilter = String(role).trim().toLowerCase();

    let rawPosts = [];
    if (dbState.useMongo && mongoose && mongoose.connection.readyState === 1) {
      try {
        rawPosts = await TeamPost.find().sort({ createdAt: -1 });
      } catch {
        rawPosts = [...dbState.teamPosts];
      }
    } else {
      rawPosts = [...dbState.teamPosts];
    }

    const formatted = [];
    for (const tp of rawPosts) {
      const obj = tp.toObject ? tp.toObject() : { ...tp };
      const leaderUser = await findUserByIdAny(obj.leader);
      if (!leaderUser || !leaderUser.username) {
        // Leader was deleted, skip orphan squad post
        continue;
      }
      const item = {
        _id: obj._id,
        teamName: obj.teamName,
        eventTitle: obj.eventTitle,
        leaderId: String(leaderUser._id),
        leaderUsername: leaderUser.username,
        leaderCollege: leaderUser.college,
        leaderCity: leaderUser.city || '',
        leaderBranch: leaderUser.branch || '',
        currentMembers: Number(obj.currentMembers) || 1,
        maxMembers: Number(obj.maxMembers) || 4,
        neededRoles: obj.neededRoles || [],
        description: obj.description || ''
      };

      if (queryText) {
        const hay = [
          item.teamName,
          item.eventTitle,
          item.leaderUsername,
          item.leaderCollege,
          item.leaderCity,
          ...(item.neededRoles || []),
          item.description
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(queryText)) continue;
      }

      if (role && role !== 'All') {
        const matchesRole = (item.neededRoles || []).some((r) =>
          r.toLowerCase().includes(roleFilter)
        );
        if (!matchesRole) continue;
      }

      formatted.push(item);
    }

    return res.json({ teamPosts: formatted });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load team lobby: ' + err.message });
  }
});

// POST /api/team-posts - Create a new Group Team Lobby recruitment post
app.post('/api/team-posts', requireAuth, async (req, res) => {
  try {
    const {
      teamName,
      eventTitle,
      currentMembers = 1,
      maxMembers = 4,
      neededRoles = [],
      description
    } = req.body;

    if (!teamName || !eventTitle || !description) {
      return res.status(400).json({
        error: 'Team name, target competition, and project pitch description are required.'
      });
    }

    const maxMem = Math.max(2, Number(maxMembers) || 4);
    const curMem = Math.min(maxMem - 1, Math.max(1, Number(currentMembers) || 1));

    const newPostData = {
      teamName: String(teamName).trim(),
      eventTitle: String(eventTitle).trim(),
      leader: req.user.id,
      currentMembers: curMem,
      maxMembers: maxMem,
      neededRoles: parseListField(neededRoles),
      description: String(description).trim()
    };

    let created = {
      _id: `tp_${Date.now()}`,
      ...newPostData
    };

    if (
      dbState.useMongo &&
      mongoose &&
      mongoose.connection.readyState === 1 &&
      mongoose.Types.ObjectId.isValid(String(req.user.id))
    ) {
      try {
        const mongoPost = await TeamPost.create(newPostData);
        created = mongoPost.toObject ? mongoPost.toObject() : mongoPost;
        created._id = String(created._id);
        created.leader = String(created.leader);
      } catch (err) {
        console.warn('[CodeVortex] TeamPost MongoDB create fallback:', err.message);
      }
    }

    dbState.teamPosts.unshift(created);
    saveLocalStore();
    return res.status(201).json({
      message: 'Squad posted to the Group Team Lobby!',
      teamPost: created
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not create team post: ' + err.message });
  }
});

// DELETE /api/team-posts/:id - Delete/close a Squad Lobby post (only by the squad leader)
app.delete('/api/team-posts/:id', requireAuth, async (req, res) => {
  try {
    const postId = String(req.params.id);
    const uid = String(req.user.id);

    let post = null;
    if (
      dbState.useMongo &&
      mongoose &&
      mongoose.connection.readyState === 1 &&
      mongoose.Types.ObjectId.isValid(postId)
    ) {
      try {
        post = await TeamPost.findById(postId);
      } catch {}
    }
    if (!post) {
      post = dbState.teamPosts.find((p) => String(p._id) === postId);
    }
    if (!post) {
      return res.status(404).json({ error: 'Squad post not found.' });
    }
    if (String(post.leader) !== uid) {
      return res.status(403).json({ error: 'Only the squad leader can delete this squad post.' });
    }

    if (
      dbState.useMongo &&
      mongoose &&
      mongoose.connection.readyState === 1 &&
      mongoose.Types.ObjectId.isValid(postId)
    ) {
      await TeamPost.findByIdAndDelete(postId).catch(() => {});
    }
    dbState.teamPosts = dbState.teamPosts.filter((p) => String(p._id) !== postId);
    saveLocalStore();

    return res.json({ message: 'Squad post removed from the lobby.' });
  } catch (err) {
    return res.status(500).json({ error: 'Could not delete squad post: ' + err.message });
  }
});

// POST /api/team-posts/:id/apply - Apply to join an open Group Team (creates a TeamRequest to the leader)
app.post('/api/team-posts/:id/apply', requireAuth, async (req, res) => {
  try {
    const postId = req.params.id;
    const { note = '' } = req.body;

    let post = null;
    if (
      dbState.useMongo &&
      mongoose &&
      mongoose.connection.readyState === 1 &&
      mongoose.Types.ObjectId.isValid(String(postId))
    ) {
      try {
        post = await TeamPost.findById(postId);
      } catch {}
    }
    if (!post) {
      post = dbState.teamPosts.find((p) => String(p._id) === String(postId));
    }

    if (!post) {
      return res.status(404).json({ error: 'Team lobby post not found.' });
    }

    if (String(post.leader) === String(req.user.id)) {
      return res.status(400).json({ error: 'You are the leader of this squad!' });
    }

    if (Number(post.currentMembers) >= Number(post.maxMembers)) {
      return res.status(400).json({ error: 'This squad is already full!' });
    }

    const pitchNote =
      String(note).trim() ||
      `Hi! I would love to join squad "${post.teamName}" for ${post.eventTitle}.`;

    const result = await upsertTeamRequestBetweenUsers({
      fromId: req.user.id,
      fromUsername: req.user.username,
      toId: post.leader,
      eventTitle: `${post.eventTitle} (Squad: ${post.teamName})`,
      note: pitchNote
    });

    return res.status(201).json({
      message: result.alreadyConnected
        ? result.message
        : `Application sent to squad "${post.teamName}"!`,
      alreadyConnected: result.alreadyConnected,
      teamRequest: result.teamRequest
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not apply to squad: ' + err.message });
  }
});

// GET /api/team-requests - Fetch Incoming, Sent & Accepted Teammate Requests + Unlocked Contacts & Chat
app.get('/api/team-requests', requireAuth, async (req, res) => {
  try {
    const uid = String(req.user.id);
    let rawReqs = [];

    if (
      dbState.useMongo &&
      mongoose &&
      mongoose.connection.readyState === 1 &&
      mongoose.Types.ObjectId.isValid(uid)
    ) {
      try {
        rawReqs = await TeamRequest.find({
          $or: [{ fromUser: uid }, { toUser: uid }]
        }).sort({ updatedAt: -1 });
      } catch {
        rawReqs = dbState.teamRequests.filter(
          (r) => String(r.fromUser) === uid || String(r.toUser) === uid
        );
      }
    } else {
      rawReqs = dbState.teamRequests.filter(
        (r) => String(r.fromUser) === uid || String(r.toUser) === uid
      );
    }

    const incoming = [];
    const sent = [];
    const accepted = [];
    const orphanReqIds = [];

    for (const r of rawReqs) {
      const obj = r.toObject ? r.toObject() : { ...r };
      const fromRaw = await findUserByIdAny(obj.fromUser);
      const toRaw = await findUserByIdAny(obj.toUser);

      // If either user no longer exists in the database (deleted account), treat request as dead orphan
      if (!fromRaw || !toRaw || !fromRaw.username || !toRaw.username) {
        orphanReqIds.push(obj._id);
        continue;
      }

      const isIncoming = String(obj.toUser) === uid;
      const isAccepted = obj.status === 'accepted';
      const peerRaw = isIncoming ? fromRaw : toRaw;
      const msgs = isAccepted ? obj.messages || [] : [];
      const lastReadMap =
        obj.lastReadAt instanceof Map
          ? Object.fromEntries(obj.lastReadAt)
          : obj.lastReadAt || {};
      const myLastRead = lastReadMap[uid] ? new Date(lastReadMap[uid]).getTime() : 0;
      const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      const hasUnreadMessage = Boolean(
        isAccepted &&
          lastMsg &&
          String(lastMsg.senderId) !== uid &&
          new Date(lastMsg.createdAt || obj.updatedAt || Date.now()).getTime() > myLastRead
      );

      const formattedReq = {
        _id: obj._id,
        eventTitle: obj.eventTitle,
        note: obj.note,
        status: obj.status,
        isIncoming,
        hasUnreadMessage,
        updatedAt: obj.updatedAt || (lastMsg && lastMsg.createdAt) || obj.createdAt,
        fromUser: sanitizeUser(fromRaw, {
          isSelf: String(obj.fromUser) === uid
        }),
        toUser: sanitizeUser(toRaw, {
          isSelf: String(obj.toUser) === uid
        }),
        peer: sanitizeUser(peerRaw, {
          isSelf: false
        }),
        messages: msgs
      };

      if (isAccepted) {
        accepted.push(formattedReq);
      }
      if (isIncoming) {
        incoming.push(formattedReq);
      } else {
        sent.push(formattedReq);
      }
    }

    // Clean up orphan requests from the database so they never appear again
    if (orphanReqIds.length > 0) {
      if (dbState.useMongo && mongoose && mongoose.connection.readyState === 1) {
        TeamRequest.deleteMany({ _id: { $in: orphanReqIds } }).catch(() => {});
      }
      dbState.teamRequests = dbState.teamRequests.filter(
        (r) => !orphanReqIds.some((oid) => String(oid) === String(r._id))
      );
      saveLocalStore();
    }

    const groups = await getFormattedGroupsForUser(uid);

    return res.json({
      incoming,
      sent,
      accepted,
      groups,
      pendingIncomingCount: incoming.filter((i) => i.status === 'pending').length,
      unreadMessagesCount:
        accepted.filter((a) => a.hasUnreadMessage).length +
        groups.filter((g) => g.hasUnreadMessage).length
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load team requests: ' + err.message });
  }
});

// POST /api/team-requests - Send a 1-on-1 Team-Up Request with pitch note & target competition
app.post('/api/team-requests', requireAuth, async (req, res) => {
  try {
    const { toUser, eventTitle, note } = req.body;
    if (!toUser || !eventTitle || !note) {
      return res.status(400).json({
        error: 'Target student, target competition name, and pitch note are required.'
      });
    }

    if (String(toUser) === String(req.user.id)) {
      return res.status(400).json({ error: 'You cannot send a Team-Up request to yourself.' });
    }

    const result = await upsertTeamRequestBetweenUsers({
      fromId: req.user.id,
      fromUsername: req.user.username,
      toId: toUser,
      eventTitle,
      note
    });

    return res.status(201).json({
      message: result.message,
      alreadyConnected: result.alreadyConnected,
      teamRequest: result.teamRequest
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not send request: ' + err.message });
  }
});

// PUT /api/team-requests/:id - Accept or Decline an incoming Team-Up Request (unlocks contacts & chat)
app.put('/api/team-requests/:id', requireAuth, async (req, res) => {
  try {
    const reqId = String(req.params.id);
    const { status } = req.body;
    if (!['accepted', 'declined'].includes(status)) {
      return res.status(400).json({ error: 'Status must be "accepted" or "declined".' });
    }

    const uid = String(req.user.id);
    let tr = null;

    if (
      dbState.useMongo &&
      mongoose &&
      mongoose.connection.readyState === 1 &&
      mongoose.Types.ObjectId.isValid(reqId)
    ) {
      try {
        tr = await TeamRequest.findById(reqId);
      } catch {}
    }

    if (!tr) {
      tr = dbState.teamRequests.find((r) => String(r._id) === reqId);
    }

    if (!tr) return res.status(404).json({ error: 'Team request not found.' });
    if (String(tr.toUser) !== uid) {
      return res.status(403).json({ error: 'Only the recipient can accept or decline this request.' });
    }

    const wasAlreadyAccepted = tr.status === 'accepted';
    tr.status = status;

    if (status === 'accepted') {
      tr.messages = tr.messages || [];
      if (tr.messages.length === 0) {
        tr.messages.push({
          senderId: uid,
          senderName: req.user.username,
          text: `🎉 Team-Up Request accepted for "${tr.eventTitle}"! Contact links and direct chat are now unlocked.`,
          createdAt: new Date()
        });
      }

      // If this request was for a Squad Lobby post, increment currentMembers on the matching Squad Post
      if (!wasAlreadyAccepted && tr.eventTitle && tr.eventTitle.includes('(Squad:')) {
        const squadMatch = tr.eventTitle.match(/\(Squad:\s*([^)]+)\)/i);
        const squadName = squadMatch ? squadMatch[1].trim().toLowerCase() : '';
        if (squadName) {
          if (dbState.useMongo && mongoose && mongoose.connection.readyState === 1) {
            try {
              const tp = await TeamPost.findOne({ leader: uid });
              if (
                tp &&
                String(tp.teamName).trim().toLowerCase() === squadName &&
                tp.currentMembers < tp.maxMembers
              ) {
                tp.currentMembers += 1;
                await tp.save();
              }
            } catch {}
          }
          const localTp = dbState.teamPosts.find(
            (p) =>
              String(p.leader) === uid &&
              String(p.teamName).trim().toLowerCase() === squadName
          );
          if (localTp && Number(localTp.currentMembers) < Number(localTp.maxMembers)) {
            localTp.currentMembers = Number(localTp.currentMembers) + 1;
          }
        }
      }
    }

    if (tr.lastReadAt instanceof Map) {
      tr.lastReadAt.set(uid, new Date());
    } else {
      tr.lastReadAt = tr.lastReadAt || {};
      tr.lastReadAt[uid] = new Date().toISOString();
    }
    tr.updatedAt = new Date();

    if (typeof tr.save === 'function') {
      await tr.save().catch(() => {});
    }
    await syncTeamRequestToLocal(tr);

    return res.json({
      message:
        status === 'accepted'
          ? '🤝 Request Accepted! Direct Chat is now open!'
          : 'Request declined.',
      teamRequest: tr
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not update request: ' + err.message });
  }
});

// POST /api/team-requests/:id/messages - Send a direct chat message (text, images, code files, project folders, or forwarded message)
app.post('/api/team-requests/:id/messages', requireAuth, async (req, res) => {
  try {
    const reqId = String(req.params.id);
    const { text = '', attachments = [], isForwarded = false } = req.body;
    const cleanText = String(text || '').trim();
    const cleanAttachments = Array.isArray(attachments) ? attachments : [];

    if (!cleanText && cleanAttachments.length === 0) {
      return res.status(400).json({ error: 'Message text or attachment is required.' });
    }

    const uid = String(req.user.id);
    const msgObj = {
      msgId: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      senderId: uid,
      senderName: req.user.username,
      text: cleanText,
      isForwarded: Boolean(isForwarded),
      attachments: cleanAttachments,
      createdAt: new Date()
    };

    let tr = null;
    if (
      dbState.useMongo &&
      mongoose &&
      mongoose.connection.readyState === 1 &&
      mongoose.Types.ObjectId.isValid(reqId)
    ) {
      try {
        tr = await TeamRequest.findById(reqId);
      } catch {}
    }
    if (!tr) {
      tr = dbState.teamRequests.find((r) => String(r._id) === reqId);
    }

    if (!tr) return res.status(404).json({ error: 'Chat thread not found.' });
    if (String(tr.fromUser) !== uid && String(tr.toUser) !== uid) {
      return res.status(403).json({ error: 'Not authorized for this chat thread.' });
    }
    if (tr.status !== 'accepted') {
      return res.status(400).json({ error: 'Chat unlocks once the Team-Up Request is accepted.' });
    }

    tr.messages = tr.messages || [];
    tr.messages.push(msgObj);
    if (tr.lastReadAt instanceof Map) {
      tr.lastReadAt.set(uid, new Date());
    } else {
      tr.lastReadAt = tr.lastReadAt || {};
      tr.lastReadAt[uid] = new Date().toISOString();
    }
    tr.updatedAt = new Date();
    if (typeof tr.markModified === 'function') {
      tr.markModified('messages');
    }

    if (typeof tr.save === 'function') {
      await tr.save().catch(() => {});
    }
    await syncTeamRequestToLocal(tr);

    return res.status(201).json({ messages: tr.messages });
  } catch (err) {
    return res.status(500).json({ error: 'Could not send message: ' + err.message });
  }
});

// DELETE /api/team-requests/:id/messages/:msgKey - Delete an individual sent message in a 1-on-1 chat
app.delete('/api/team-requests/:id/messages/:msgKey', requireAuth, async (req, res) => {
  try {
    const reqId = String(req.params.id);
    const msgKey = String(req.params.msgKey || '');
    const uid = String(req.user.id);

    let tr = null;
    if (
      dbState.useMongo &&
      mongoose &&
      mongoose.connection.readyState === 1 &&
      mongoose.Types.ObjectId.isValid(reqId)
    ) {
      try {
        tr = await TeamRequest.findById(reqId);
      } catch {}
    }
    if (!tr) {
      tr = dbState.teamRequests.find((r) => String(r._id) === reqId);
    }

    if (!tr) return res.status(404).json({ error: 'Chat thread not found.' });
    if (String(tr.fromUser) !== uid && String(tr.toUser) !== uid) {
      return res.status(403).json({ error: 'Not authorized for this chat thread.' });
    }

    const msgs = Array.isArray(tr.messages) ? [...tr.messages] : [];
    let targetIdx = msgs.findIndex((m) => m && String(m.msgId || '') === msgKey);
    if (targetIdx === -1 && /^\d+$/.test(msgKey)) {
      const idxNum = Number(msgKey);
      if (idxNum >= 0 && idxNum < msgs.length) targetIdx = idxNum;
    }
    if (targetIdx === -1) {
      return res.status(404).json({ error: 'Message not found.' });
    }

    const targetMsg = msgs[targetIdx];
    if (
      String(targetMsg.senderId) !== uid &&
      String(targetMsg.senderName) !== String(req.user.username)
    ) {
      return res.status(403).json({ error: 'You can only delete messages sent by you.' });
    }

    msgs.splice(targetIdx, 1);
    tr.messages = msgs;
    tr.updatedAt = new Date();
    if (typeof tr.markModified === 'function') {
      tr.markModified('messages');
    }

    if (typeof tr.save === 'function') {
      await tr.save().catch(() => {});
    }
    await syncTeamRequestToLocal(tr);

    return res.json({ message: '🗑️ Message deleted.', messages: tr.messages });
  } catch (err) {
    return res.status(500).json({ error: 'Could not delete message: ' + err.message });
  }
});

// POST /api/team-requests/:id/read - Mark a conversation as read for the current user
app.post('/api/team-requests/:id/read', requireAuth, async (req, res) => {
  try {
    const reqId = String(req.params.id);
    const uid = String(req.user.id);

    let tr = null;
    if (
      dbState.useMongo &&
      mongoose &&
      mongoose.connection.readyState === 1 &&
      mongoose.Types.ObjectId.isValid(reqId)
    ) {
      try {
        tr = await TeamRequest.findById(reqId);
      } catch {}
    }
    if (!tr) {
      tr = dbState.teamRequests.find((r) => String(r._id) === reqId);
    }

    if (!tr) return res.status(404).json({ error: 'Conversation not found.' });
    if (String(tr.fromUser) !== uid && String(tr.toUser) !== uid) {
      return res.status(403).json({ error: 'Not authorized.' });
    }

    if (tr.lastReadAt instanceof Map) {
      tr.lastReadAt.set(uid, new Date());
    } else {
      tr.lastReadAt = tr.lastReadAt || {};
      tr.lastReadAt[uid] = new Date().toISOString();
    }

    if (typeof tr.save === 'function') {
      await tr.save().catch(() => {});
    }
    await syncTeamRequestToLocal(tr);

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Could not mark read: ' + err.message });
  }
});

// DELETE /api/team-requests/:id/messages - Clear message history in a 1-on-1 chat while staying teamed up
app.delete('/api/team-requests/:id/messages', requireAuth, async (req, res) => {
  try {
    const reqId = String(req.params.id);
    const uid = String(req.user.id);

    let tr = null;
    if (
      dbState.useMongo &&
      mongoose &&
      mongoose.connection.readyState === 1 &&
      mongoose.Types.ObjectId.isValid(reqId)
    ) {
      try {
        tr = await TeamRequest.findById(reqId);
      } catch {}
    }
    if (!tr) {
      tr = dbState.teamRequests.find((r) => String(r._id) === reqId);
    }

    if (!tr) return res.status(404).json({ error: 'Chat thread not found.' });
    if (String(tr.fromUser) !== uid && String(tr.toUser) !== uid) {
      return res.status(403).json({ error: 'Not authorized for this chat thread.' });
    }

    tr.messages = [];
    tr.updatedAt = new Date();

    if (typeof tr.save === 'function') {
      await tr.save().catch(() => {});
    }
    await syncTeamRequestToLocal(tr);

    return res.json({ message: '🧹 Chat messages cleared!', messages: [] });
  } catch (err) {
    return res.status(500).json({ error: 'Could not clear chat messages: ' + err.message });
  }
});

// DELETE /api/team-requests/:id - Leave a person after team-up and delete them & their chat from Messages
app.delete('/api/team-requests/:id', requireAuth, async (req, res) => {
  try {
    const reqId = String(req.params.id);
    const uid = String(req.user.id);

    let tr = null;
    if (
      dbState.useMongo &&
      mongoose &&
      mongoose.connection.readyState === 1 &&
      mongoose.Types.ObjectId.isValid(reqId)
    ) {
      try {
        tr = await TeamRequest.findById(reqId);
      } catch {}
    }
    if (!tr) {
      tr = dbState.teamRequests.find((r) => String(r._id) === reqId);
    }

    if (!tr) return res.status(404).json({ error: 'Team-up / chat not found.' });
    const fromId = String(tr.fromUser);
    const toId = String(tr.toUser);
    if (fromId !== uid && toId !== uid) {
      return res.status(403).json({ error: 'Not authorized to delete this team-up.' });
    }

    const peerId = fromId === uid ? toId : fromId;

    // If this request was for a Squad Lobby post, decrement currentMembers on the matching Squad Post
    if (tr.status === 'accepted' && tr.eventTitle && tr.eventTitle.includes('(Squad:')) {
      const squadMatch = tr.eventTitle.match(/\(Squad:\s*([^)]+)\)/i);
      const squadName = squadMatch ? squadMatch[1].trim().toLowerCase() : '';
      if (squadName) {
        if (dbState.useMongo && mongoose && mongoose.connection.readyState === 1) {
          try {
            const tp = await TeamPost.findOne({ leader: toId });
            if (
              tp &&
              String(tp.teamName).trim().toLowerCase() === squadName &&
              tp.currentMembers > 1
            ) {
              tp.currentMembers -= 1;
              await tp.save();
            }
          } catch {}
        }
        const localTp = dbState.teamPosts.find(
          (p) =>
            String(p.leader) === toId &&
            String(p.teamName).trim().toLowerCase() === squadName
        );
        if (localTp && Number(localTp.currentMembers) > 1) {
          localTp.currentMembers = Number(localTp.currentMembers) - 1;
        }
      }
    }

    if (dbState.useMongo && mongoose && mongoose.connection.readyState === 1 && TeamRequest) {
      try {
        await TeamRequest.deleteMany({
          $or: [
            ...(mongoose.Types.ObjectId.isValid(reqId) ? [{ _id: reqId }] : []),
            { fromUser: fromId, toUser: toId },
            { fromUser: toId, toUser: fromId }
          ]
        });
      } catch {}
    }

    dbState.teamRequests = (dbState.teamRequests || []).filter((r) => {
      if (String(r._id) === reqId) return false;
      const rf = String(r.fromUser);
      const rt = String(r.toUser);
      if ((rf === uid && rt === peerId) || (rf === peerId && rt === uid)) return false;
      return true;
    });
    saveLocalStore();

    return res.json({
      message: '🚪 Left team-up and deleted chat from Messages.',
      deletedId: reqId,
      peerId
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not leave team-up / delete chat: ' + err.message });
  }
});

// ============================================================================
// WHATSAPP-STYLE GROUP CHATS IN MESSAGES SECTION
// ============================================================================

function generateGroupInviteCode(seed = '') {
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  const tail = String(seed || Date.now())
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-4)
    .toUpperCase();
  return `CV-${rand}${tail}`;
}

function ensureGroupInviteCode(grp) {
  if (!grp) return '';
  if (!grp.inviteCode || !String(grp.inviteCode).trim()) {
    grp.inviteCode = generateGroupInviteCode(grp._id);
  }
  return String(grp.inviteCode).trim();
}

async function getTeamedUpPeerIdsForUser(uid) {
  const userIdStr = String(uid);
  const peerSet = new Set();

  for (const r of dbState.teamRequests || []) {
    if (r.status === 'accepted') {
      if (String(r.fromUser) === userIdStr) peerSet.add(String(r.toUser));
      if (String(r.toUser) === userIdStr) peerSet.add(String(r.fromUser));
    }
  }

  if (
    dbState.useMongo &&
    mongoose &&
    mongoose.connection.readyState === 1 &&
    TeamRequest &&
    mongoose.Types.ObjectId.isValid(userIdStr)
  ) {
    try {
      const acceptedReqs = await TeamRequest.find({
        $or: [{ fromUser: userIdStr }, { toUser: userIdStr }],
        status: 'accepted'
      }).lean();
      for (const r of acceptedReqs) {
        if (String(r.fromUser) === userIdStr) peerSet.add(String(r.toUser));
        if (String(r.toUser) === userIdStr) peerSet.add(String(r.fromUser));
      }
    } catch {}
  }

  peerSet.delete(userIdStr);
  return peerSet;
}

async function syncChatGroupToLocal(groupDoc) {
  if (!groupDoc) return;
  const plain = groupDoc.toObject ? groupDoc.toObject() : { ...groupDoc };
  plain._id = String(plain._id);
  plain.admin = String(plain.admin);
  plain.inviteCode = ensureGroupInviteCode(plain);
  plain.members = (plain.members || []).map(String);
  if (plain.lastReadAt instanceof Map) {
    plain.lastReadAt = Object.fromEntries(plain.lastReadAt);
  }
  const idx = dbState.chatGroups.findIndex((g) => String(g._id) === plain._id);
  if (idx !== -1) {
    dbState.chatGroups[idx] = plain;
  } else {
    dbState.chatGroups.unshift(plain);
  }
  saveLocalStore();
}

async function findChatGroupById(groupId) {
  const gid = String(groupId);
  let grp = null;
  if (
    dbState.useMongo &&
    mongoose &&
    mongoose.connection.readyState === 1 &&
    ChatGroup &&
    mongoose.Types.ObjectId.isValid(gid)
  ) {
    try {
      grp = await ChatGroup.findById(gid);
    } catch {}
  }
  if (!grp) {
    grp = dbState.chatGroups.find((g) => String(g._id) === gid) || null;
  }
  if (grp) {
    ensureGroupInviteCode(grp);
  }
  return grp;
}

async function findChatGroupByInviteCode(codeRaw) {
  const clean = String(codeRaw || '').trim();
  if (!clean) return null;
  const upper = clean.toUpperCase();

  let grp =
    dbState.chatGroups.find(
      (g) =>
        String(g.inviteCode || '').toUpperCase() === upper ||
        String(g._id) === clean
    ) || null;

  if (
    !grp &&
    dbState.useMongo &&
    mongoose &&
    mongoose.connection.readyState === 1 &&
    ChatGroup
  ) {
    try {
      grp = await ChatGroup.findOne({
        $or: [
          { inviteCode: new RegExp(`^${clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
          ...(mongoose.Types.ObjectId.isValid(clean) ? [{ _id: clean }] : [])
        ]
      });
    } catch {}
  }

  if (grp) {
    ensureGroupInviteCode(grp);
  }
  return grp;
}

async function getFormattedGroupsForUser(uid) {
  const userIdStr = String(uid);
  let rawGroups = [];

  if (
    dbState.useMongo &&
    mongoose &&
    mongoose.connection.readyState === 1 &&
    ChatGroup
  ) {
    try {
      rawGroups = await ChatGroup.find({ members: userIdStr }).sort({ updatedAt: -1 });
      dbState.chatGroups = rawGroups.map((mg) => {
        const plain = mg.toObject ? mg.toObject() : { ...mg };
        plain._id = String(plain._id);
        return plain;
      });
    } catch {
      rawGroups = dbState.chatGroups.filter((g) =>
        (g.members || []).map(String).includes(userIdStr)
      );
    }
  } else {
    rawGroups = dbState.chatGroups.filter((g) =>
      (g.members || []).map(String).includes(userIdStr)
    );
  }

  let needsSave = false;
  const formatted = [];
  for (const g of rawGroups) {
    if (!g.inviteCode) {
      g.inviteCode = generateGroupInviteCode(g._id);
      needsSave = true;
    }
    const obj = g.toObject ? g.toObject() : { ...g };
    const inviteCode = ensureGroupInviteCode(obj);
    const memberProfiles = [];
    for (const mid of obj.members || []) {
      const u = await findUserByIdAny(mid);
      if (u && u.username) {
        memberProfiles.push({
          _id: String(u._id),
          username: u.username,
          name: u.name,
          college: u.college,
          avatarUrl: u.avatarUrl || ''
        });
      }
    }
    if (memberProfiles.length === 0) continue;

    const msgs = obj.messages || [];
    const lastReadMap =
      obj.lastReadAt instanceof Map
        ? Object.fromEntries(obj.lastReadAt)
        : obj.lastReadAt || {};
    const myLastRead = lastReadMap[userIdStr] ? new Date(lastReadMap[userIdStr]).getTime() : 0;
    const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
    const hasUnreadMessage = Boolean(
      lastMsg &&
        String(lastMsg.senderId) !== userIdStr &&
        new Date(lastMsg.createdAt || obj.updatedAt || Date.now()).getTime() > myLastRead
    );

    formatted.push({
      _id: String(obj._id),
      isGroup: true,
      name: obj.name,
      description: obj.description || '',
      avatarEmoji: obj.avatarEmoji || '👥',
      inviteCode,
      admin: String(obj.admin),
      members: memberProfiles,
      messages: msgs,
      hasUnreadMessage,
      updatedAt: obj.updatedAt || (lastMsg && lastMsg.createdAt) || obj.createdAt || new Date().toISOString()
    });
  }

  if (needsSave) {
    saveLocalStore();
  }

  return formatted.sort(
    (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
  );
}

// GET /api/chat-groups - Fetch all group chats the logged-in user belongs to
app.get('/api/chat-groups', requireAuth, async (req, res) => {
  try {
    const groups = await getFormattedGroupsForUser(req.user.id);
    return res.json({ groups });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load groups: ' + err.message });
  }
});

// POST /api/chat-groups - Create a new WhatsApp-style Group Chat (only teamed-up members can be directly added, or 0 members to invite via Link / QR)
app.post('/api/chat-groups', requireAuth, async (req, res) => {
  try {
    const {
      name,
      description = '',
      avatarEmoji = '👥',
      memberIds = []
    } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Please enter a Group Name.' });
    }

    const uid = String(req.user.id);
    const teamedUpSet = await getTeamedUpPeerIdsForUser(uid);
    const requestedIds = Array.from(
      new Set((Array.isArray(memberIds) ? memberIds.map(String) : []).filter((id) => id && id !== uid))
    );

    const unteamedIds = requestedIds.filter((id) => !teamedUpSet.has(id));
    if (unteamedIds.length > 0) {
      return res.status(400).json({
        error:
          'You can only directly add builders you have teamed up with! For others, share the Group Invite Link or QR Code.'
      });
    }

    const uniqueMembers = [uid, ...requestedIds];
    const nowIso = new Date().toISOString();
    const inviteCode = generateGroupInviteCode();
    const groupData = {
      name: String(name).trim().slice(0, 60),
      description: String(description || '').trim().slice(0, 160),
      avatarEmoji: String(avatarEmoji || '👥').trim().slice(0, 4),
      inviteCode,
      admin: uid,
      members: uniqueMembers,
      messages: [
        {
          senderId: uid,
          senderName: req.user.username,
          text: `👥 @${req.user.username} created group "${String(name).trim()}" • Share Invite Link or QR Code to add builders!`,
          isSystem: true,
          createdAt: new Date()
        }
      ],
      lastReadAt: {
        [uid]: nowIso
      }
    };

    let created = {
      _id: `grp_${Date.now()}`,
      ...groupData,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    if (
      dbState.useMongo &&
      mongoose &&
      mongoose.connection.readyState === 1 &&
      ChatGroup
    ) {
      try {
        const mongoGrp = await ChatGroup.create(groupData);
        created = mongoGrp;
      } catch (err) {
        console.warn('[CodeVortex] ChatGroup MongoDB create fallback:', err.message);
      }
    }

    await syncChatGroupToLocal(created);
    const groups = await getFormattedGroupsForUser(uid);
    const createdFormatted = groups.find((g) => String(g._id) === String(created._id)) || created;

    return res.status(201).json({
      message: `🎉 Group "${groupData.name}" created! Share the Invite Link or QR Code anytime.`,
      group: createdFormatted
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not create group: ' + err.message });
  }
});

// GET /api/chat-groups/invite/:code - Preview Group Chat info from a shared Invite Link or QR Code
app.get('/api/chat-groups/invite/:code', requireAuth, async (req, res) => {
  try {
    const code = String(req.params.code || '').trim();
    const uid = String(req.user.id);
    const grp = await findChatGroupByInviteCode(code);
    if (!grp) {
      return res.status(404).json({ error: 'Invalid or expired Group Invite Link / Code.' });
    }

    const memberIds = (grp.members || []).map(String);
    return res.json({
      group: {
        _id: String(grp._id),
        name: grp.name,
        description: grp.description || '',
        avatarEmoji: grp.avatarEmoji || '👥',
        inviteCode: ensureGroupInviteCode(grp),
        memberCount: memberIds.length,
        alreadyMember: memberIds.includes(uid)
      }
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not verify group invite: ' + err.message });
  }
});

// POST /api/chat-groups/join/:code - Join a Group Chat via shared Invite Link or QR Code (WhatsApp Style)
app.post('/api/chat-groups/join/:code', requireAuth, async (req, res) => {
  try {
    const code = String(req.params.code || '').trim();
    const uid = String(req.user.id);
    const grp = await findChatGroupByInviteCode(code);
    if (!grp) {
      return res.status(404).json({ error: 'Invalid or expired Group Invite Link / Code.' });
    }

    const currentMembers = (grp.members || []).map(String);
    const alreadyMember = currentMembers.includes(uid);

    if (!alreadyMember) {
      currentMembers.push(uid);
      grp.members = currentMembers;
      grp.messages = grp.messages || [];
      grp.messages.push({
        senderId: uid,
        senderName: req.user.username,
        text: `🔗 @${req.user.username} joined via Group Invite Link / QR Code`,
        isSystem: true,
        createdAt: new Date()
      });
      if (grp.lastReadAt instanceof Map) {
        grp.lastReadAt.set(uid, new Date());
      } else {
        grp.lastReadAt = grp.lastReadAt || {};
        grp.lastReadAt[uid] = new Date().toISOString();
      }
      grp.updatedAt = new Date();

      if (typeof grp.save === 'function') {
        await grp.save().catch(() => {});
      }
      await syncChatGroupToLocal(grp);
    }

    const groups = await getFormattedGroupsForUser(uid);
    const joinedFormatted = groups.find((g) => String(g._id) === String(grp._id)) || grp;

    return res.json({
      message: alreadyMember
        ? `You are already in "${grp.name}"! Opening group chat...`
        : `🎉 Joined "${grp.name}" via Invite Link!`,
      alreadyMember,
      group: joinedFormatted
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not join group: ' + err.message });
  }
});

// POST /api/chat-groups/:id/reset-invite - Reset/regenerate the Group Invite Link & QR Code (Admin only)
app.post('/api/chat-groups/:id/reset-invite', requireAuth, async (req, res) => {
  try {
    const groupId = String(req.params.id);
    const uid = String(req.user.id);
    const grp = await findChatGroupById(groupId);
    if (!grp) return res.status(404).json({ error: 'Group chat not found.' });

    if (String(grp.admin) !== uid) {
      return res.status(403).json({ error: 'Only the Group Admin can reset the invite link.' });
    }

    grp.inviteCode = generateGroupInviteCode(Date.now());
    grp.updatedAt = new Date();
    if (typeof grp.save === 'function') {
      await grp.save().catch(() => {});
    }
    await syncChatGroupToLocal(grp);

    return res.json({
      message: '🔄 Group Invite Link & QR Code reset!',
      inviteCode: grp.inviteCode
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not reset invite link: ' + err.message });
  }
});

// POST /api/chat-groups/:id/messages - Send a message in a Group Chat (text, images, code files, project folders, or forwarded message)
app.post('/api/chat-groups/:id/messages', requireAuth, async (req, res) => {
  try {
    const groupId = String(req.params.id);
    const { text = '', attachments = [], isForwarded = false } = req.body;
    const cleanText = String(text || '').trim();
    const cleanAttachments = Array.isArray(attachments) ? attachments : [];

    if (!cleanText && cleanAttachments.length === 0) {
      return res.status(400).json({ error: 'Message text or attachment is required.' });
    }

    const uid = String(req.user.id);
    const grp = await findChatGroupById(groupId);
    if (!grp) return res.status(404).json({ error: 'Group chat not found.' });

    const memberIds = (grp.members || []).map(String);
    if (!memberIds.includes(uid)) {
      return res.status(403).json({ error: 'You are not a member of this group.' });
    }

    const msgObj = {
      msgId: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      senderId: uid,
      senderName: req.user.username,
      text: cleanText,
      isSystem: false,
      isForwarded: Boolean(isForwarded),
      attachments: cleanAttachments,
      createdAt: new Date()
    };

    grp.messages = grp.messages || [];
    grp.messages.push(msgObj);
    if (grp.lastReadAt instanceof Map) {
      grp.lastReadAt.set(uid, new Date());
    } else {
      grp.lastReadAt = grp.lastReadAt || {};
      grp.lastReadAt[uid] = new Date().toISOString();
    }
    grp.updatedAt = new Date();
    if (typeof grp.markModified === 'function') {
      grp.markModified('messages');
    }

    if (typeof grp.save === 'function') {
      await grp.save().catch(() => {});
    }
    await syncChatGroupToLocal(grp);

    return res.status(201).json({ messages: grp.messages });
  } catch (err) {
    return res.status(500).json({ error: 'Could not send group message: ' + err.message });
  }
});

// DELETE /api/chat-groups/:id/messages/:msgKey - Delete an individual sent message in a Group Chat
app.delete('/api/chat-groups/:id/messages/:msgKey', requireAuth, async (req, res) => {
  try {
    const groupId = String(req.params.id);
    const msgKey = String(req.params.msgKey || '');
    const uid = String(req.user.id);

    const grp = await findChatGroupById(groupId);
    if (!grp) return res.status(404).json({ error: 'Group chat not found.' });

    const memberIds = (grp.members || []).map(String);
    if (!memberIds.includes(uid)) {
      return res.status(403).json({ error: 'You are not a member of this group.' });
    }

    const msgs = Array.isArray(grp.messages) ? [...grp.messages] : [];
    let targetIdx = msgs.findIndex((m) => m && String(m.msgId || '') === msgKey);
    if (targetIdx === -1 && /^\d+$/.test(msgKey)) {
      const idxNum = Number(msgKey);
      if (idxNum >= 0 && idxNum < msgs.length) targetIdx = idxNum;
    }
    if (targetIdx === -1) {
      return res.status(404).json({ error: 'Message not found.' });
    }

    const targetMsg = msgs[targetIdx];
    const isAdmin = String(grp.admin) === uid;
    const isSender =
      String(targetMsg.senderId) === uid ||
      String(targetMsg.senderName) === String(req.user.username);

    if (!isSender && !isAdmin) {
      return res.status(403).json({ error: 'You can only delete your own messages.' });
    }

    msgs.splice(targetIdx, 1);
    grp.messages = msgs;
    grp.updatedAt = new Date();
    if (typeof grp.markModified === 'function') {
      grp.markModified('messages');
    }

    if (typeof grp.save === 'function') {
      await grp.save().catch(() => {});
    }
    await syncChatGroupToLocal(grp);

    return res.json({ message: '🗑️ Message deleted.', messages: grp.messages });
  } catch (err) {
    return res.status(500).json({ error: 'Could not delete group message: ' + err.message });
  }
});

// POST /api/chat-groups/:id/members - Add member(s) to an existing Group Chat
app.post('/api/chat-groups/:id/members', requireAuth, async (req, res) => {
  try {
    const groupId = String(req.params.id);
    const { memberIds = [] } = req.body;
    const uid = String(req.user.id);

    const grp = await findChatGroupById(groupId);
    if (!grp) return res.status(404).json({ error: 'Group chat not found.' });

    const currentMembers = (grp.members || []).map(String);
    if (!currentMembers.includes(uid)) {
      return res.status(403).json({ error: 'Only group members can add new members.' });
    }

    const toAdd = (Array.isArray(memberIds) ? memberIds.map(String) : []).filter(
      (id) => id && !currentMembers.includes(id)
    );
    if (toAdd.length === 0) {
      return res.status(400).json({ error: 'Selected builders are already in this group.' });
    }

    const teamedUpSet = await getTeamedUpPeerIdsForUser(uid);
    const unteamedIds = toAdd.filter((id) => !teamedUpSet.has(id));
    if (unteamedIds.length > 0) {
      return res.status(400).json({
        error:
          'You can only directly add builders you have teamed up with! Share the Group Invite Link or QR Code for others to join.'
      });
    }

    const addedNames = [];
    for (const mid of toAdd) {
      const u = await findUserByIdAny(mid);
      if (u && u.username) {
        currentMembers.push(String(u._id));
        addedNames.push(`@${u.username}`);
      }
    }

    grp.members = currentMembers;
    grp.messages = grp.messages || [];
    if (addedNames.length > 0) {
      grp.messages.push({
        senderId: uid,
        senderName: req.user.username,
        text: `➕ @${req.user.username} added ${addedNames.join(', ')} to the group`,
        isSystem: true,
        createdAt: new Date()
      });
    }
    grp.updatedAt = new Date();

    if (typeof grp.save === 'function') {
      await grp.save().catch(() => {});
    }
    await syncChatGroupToLocal(grp);

    return res.json({
      message: `Added ${addedNames.join(', ')} to the group!`,
      group: grp
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not add members: ' + err.message });
  }
});

// POST /api/chat-groups/:id/leave - Leave a Group Chat
app.post('/api/chat-groups/:id/leave', requireAuth, async (req, res) => {
  try {
    const groupId = String(req.params.id);
    const uid = String(req.user.id);

    const grp = await findChatGroupById(groupId);
    if (!grp) return res.status(404).json({ error: 'Group chat not found.' });

    const remaining = (grp.members || []).map(String).filter((id) => id !== uid);
    if (remaining.length === 0) {
      if (
        dbState.useMongo &&
        mongoose &&
        mongoose.connection.readyState === 1 &&
        ChatGroup &&
        mongoose.Types.ObjectId.isValid(groupId)
      ) {
        await ChatGroup.findByIdAndDelete(groupId).catch(() => {});
      }
      dbState.chatGroups = dbState.chatGroups.filter((g) => String(g._id) !== groupId);
      saveLocalStore();
      return res.json({ message: 'Left and closed empty group.' });
    }

    grp.members = remaining;
    if (String(grp.admin) === uid) {
      grp.admin = remaining[0];
    }
    grp.messages = grp.messages || [];
    grp.messages.push({
      senderId: uid,
      senderName: req.user.username,
      text: `🚪 @${req.user.username} left the group`,
      isSystem: true,
      createdAt: new Date()
    });
    grp.updatedAt = new Date();

    if (typeof grp.save === 'function') {
      await grp.save().catch(() => {});
    }
    await syncChatGroupToLocal(grp);

    return res.json({ message: `You left "${grp.name}".` });
  } catch (err) {
    return res.status(500).json({ error: 'Could not leave group: ' + err.message });
  }
});

// DELETE /api/chat-groups/:id - Delete a Group Chat completely (Group Admin only)
app.delete('/api/chat-groups/:id', requireAuth, async (req, res) => {
  try {
    const groupId = String(req.params.id);
    const uid = String(req.user.id);

    const grp = await findChatGroupById(groupId);
    if (!grp) return res.status(404).json({ error: 'Group chat not found.' });

    if (String(grp.admin) !== uid) {
      return res.status(403).json({ error: 'Only the Group Admin can delete this group.' });
    }

    if (
      dbState.useMongo &&
      mongoose &&
      mongoose.connection.readyState === 1 &&
      ChatGroup &&
      mongoose.Types.ObjectId.isValid(groupId)
    ) {
      await ChatGroup.findByIdAndDelete(groupId).catch(() => {});
    }
    dbState.chatGroups = dbState.chatGroups.filter((g) => String(g._id) !== groupId);
    saveLocalStore();

    return res.json({ message: `🗑️ Group "${grp.name}" deleted.` });
  } catch (err) {
    return res.status(500).json({ error: 'Could not delete group: ' + err.message });
  }
});

// POST /api/chat-groups/:id/read - Mark a Group Chat as read for the current user
app.post('/api/chat-groups/:id/read', requireAuth, async (req, res) => {
  try {
    const groupId = String(req.params.id);
    const uid = String(req.user.id);

    const grp = await findChatGroupById(groupId);
    if (!grp) return res.status(404).json({ error: 'Group chat not found.' });

    if (grp.lastReadAt instanceof Map) {
      grp.lastReadAt.set(uid, new Date());
    } else {
      grp.lastReadAt = grp.lastReadAt || {};
      grp.lastReadAt[uid] = new Date().toISOString();
    }

    if (typeof grp.save === 'function') {
      await grp.save().catch(() => {});
    }
    await syncChatGroupToLocal(grp);

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Could not mark group read: ' + err.message });
  }
});

function getLocalNetworkIp() {
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
  } catch {}
  return null;
}

app.get('/api/network-info', (req, res) => {
  const lanIp = getLocalNetworkIp();
  return res.json({
    lanIp,
    port: PORT,
    lanOrigin: lanIp ? `http://${lanIp}:${PORT}` : null
  });
});

// Always return JSON for unknown /api routes or payload/body-parser errors (prevents HTML <!DOCTYPE> responses)
app.use('/api', (req, res) => {
  res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
});

app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({
      error: 'Uploaded media file is too large. Please select a smaller file or paste an external media link.'
    });
  }
  if (req.path && req.path.startsWith('/api')) {
    return res.status(err.status || 500).json({
      error: err.message || 'Internal server error'
    });
  }
  next(err);
});

(function startServer() {
  const srv = app.listen(PORT, '0.0.0.0', () => {
    const lanIp = getLocalNetworkIp();
    console.log(`[CodeVortex] Server listening on port ${PORT} (http://localhost:${PORT})`);
    if (lanIp) {
      console.log(
        `[CodeVortex] 📱 Mobile & Other Devices (Same Wi-Fi / Hotspot): http://${lanIp}:${PORT}`
      );
    }
  });
  srv.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[CodeVortex] Port ${PORT} is already in use by another terminal window. Run "taskkill /F /IM node.exe" in cmd or close the other terminal.`
      );
    }
  });

  Promise.all([initDatabase(), syncRealTimeCompetitions(true)])
    .then(() => {
      console.log(
        `[CodeVortex] Ready | Live Competitions synced: ${liveApiCache.events.length}`
      );
    })
    .catch((err) => {
      console.warn('[CodeVortex] Startup sync notice:', err.message);
    });
})();

module.exports = { app, dbState, optionalAuth, requireAuth, sanitizeUser };
