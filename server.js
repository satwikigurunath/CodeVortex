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

// POST /api/auth/send-otp - Generate & dispatch 6-digit Mobile OTP (Simulated SMS / Demo Mode)
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
        return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number (e.g. 9876543210).' });
      }
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const key = `${purpose}:${digits10}`;
    otpStore.set(key, {
      code,
      expiresAt: Date.now() + OTP_TTL_MS,
      attempts: 0,
      userId: targetUser ? String(targetUser._id) : null,
      username: targetUser ? targetUser.username : null
    });

    const maskedPhone = maskMobile(digits10);
    console.log(
      `[CodeVortex OTP - Demo SMS] Purpose: ${purpose.toUpperCase()} | Phone: +91-${digits10} | OTP: ${code} (Valid 5 min)`
    );

    return res.json({
      ok: true,
      purpose,
      phone: digits10,
      maskedPhone,
      username: targetUser ? targetUser.username : undefined,
      expiresInSec: Math.round(OTP_TTL_MS / 1000),
      demoOtp: code,
      mode: 'simulated_sms',
      message: `6-digit OTP sent to ${maskedPhone} (Simulated SMS Demo Mode)`
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to send OTP: ' + err.message });
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
