const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
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

// POST /api/auth/register - Create a new student or organizer account
app.post('/api/auth/register', async (req, res) => {
  try {
    const {
      collegeId,
      username,
      name,
      userNumber = '',
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
      userNumber: String(userNumber).trim(),
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
