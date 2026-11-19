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

// Ensure custom vector tornado logo image is available in public/logo-tornado.png
const TORNADO_SRC =
  'C:\\Users\\Satwik I G\\.gemini\\antigravity\\brain\\5ef42217-461e-406c-aa62-97aa040fc1da\\tornado_vector_clean.png';
const TORNADO_DEST = path.join(__dirname, 'public', 'logo-tornado.png');
try {
  if (fs.existsSync(TORNADO_SRC)) {
    fs.copyFileSync(TORNADO_SRC, TORNADO_DEST);
  }
} catch {}

app.get('/logo-tornado.png', (req, res) => {
  if (fs.existsSync(TORNADO_DEST)) {
    return res.sendFile(TORNADO_DEST);
  }
  if (fs.existsSync(TORNADO_SRC)) {
    return res.sendFile(TORNADO_SRC);
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
      district = 'All',
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

        if (district && district !== 'All') {
          const locText = `${ev.organizerCollege} ${ev.city}`;
          if (!matchesStateOrLocation(locText, district)) return false;
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
