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
  karnataka: ['belagavi', 'belgaum', 'bagalkot', 'dharwad', 'hubballi', 'bengaluru', 'bangalore', 'mysuru', 'mangaluru', 'surathkal', 'vtu', 'kle', 'git', 'rvce', 'bmsce', 'pes', 'msrit'],
  maharashtra: ['mumbai', 'pune', 'nagpur', 'nashik', 'aurangabad', 'thane', 'iit bombay', 'coep', 'vjti', 'vnit', 'pict'],
  'tamil nadu': ['chennai', 'vellore', 'tiruchirappalli', 'trichy', 'coimbatore', 'madurai', 'iit madras', 'vit', 'srm', 'anna university'],
  delhi: ['new delhi', 'delhi', 'dtu', 'nsut', 'iiit delhi', 'iit delhi', 'jnu'],
  telangana: ['hyderabad', 'warangal', 'secunderabad', 'iit hyderabad', 'iiit hyderabad', 'nit warangal'],
  'uttar pradesh': ['kanpur', 'lucknow', 'noida', 'allahabad', 'prayagraj', 'varanasi', 'iit kanpur', 'iit bhu', 'mnnit'],
  'west bengal': ['kolkata', 'kharagpur', 'durgapur', 'shibpur', 'iit kharagpur', 'jadavpur'],
  rajasthan: ['jaipur', 'pilani', 'jodhpur', 'kota', 'udaipur', 'bits pilani', 'mnit'],
  gujarat: ['ahmedabad', 'gandhinagar', 'surat', 'vadodara', 'rajkot', 'iit gandhinagar', 'svnit', 'daiict'],
  kerala: ['kochi', 'calicut', 'kozhikode', 'trivandrum', 'thiruvananthapuram', 'palakkad', 'nit calicut'],
  goa: ['panaji', 'vasco', 'mormugao', 'bits goa', 'nit goa'],
  punjab: ['amritsar', 'jalandhar', 'ludhiana', 'patiala', 'ropar', 'thapar', 'nit jalandhar'],
  haryana: ['gurugram', 'gurgaon', 'faridabad', 'kurukshetra', 'nit kurukshetra'],
  uttarakhand: ['roorkee', 'dehradun', 'iit roorkee'],
  assam: ['guwahati', 'silchar', 'iit guwahati', 'nit silchar'],
  odisha: ['bhubaneswar', 'rourkela', 'cuttack', 'nit rourkela', 'iit bhubaneswar', 'kiit'],
  'madhya pradesh': ['indore', 'bhopal', 'gwalior', 'jabalpur', 'iit indore', 'manit'],
  'andhra pradesh': ['visakhapatnam', 'vizag', 'vijayawada', 'tirupati', 'guntur', 'iit tirupati'],
  bihar: ['patna', 'gaya', 'iit patna', 'nit patna'],
  jharkhand: ['ranchi', 'dhanbad', 'jamshedpur', 'iit ism', 'bit mesra', 'nit jamshedpur']
};

function matchesStateOrLocation(locationText = '', selectedState = '') {
  if (!selectedState || selectedState === 'All') return true;
  const target = String(selectedState).trim().toLowerCase();
  const hay = String(locationText || '').toLowerCase();
  if (hay.includes(target)) return true;
  const keywords = STATE_CITY_KEYWORDS[target] || [];
  return keywords.some((k) => hay.includes(k));
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

    const students = rawUsers
      .filter((u) => u.role !== 'organizer') // Keep directory focused on student builders
      .map((u) => {
        const uid = String(u._id);
        const isSelf = currentUserId === uid;
        return sanitizeUser(u, { isSelf });
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

        if (collegeFilter) {
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

    return res.json({ students });
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
