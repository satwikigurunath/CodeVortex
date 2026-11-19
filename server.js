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
