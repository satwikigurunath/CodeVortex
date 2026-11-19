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
