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
