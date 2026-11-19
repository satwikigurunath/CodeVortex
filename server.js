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
        senderId: { type: String, required: true },
        senderName: { type: String, required: true },
        text: { type: String, required: true },
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
        senderId: { type: String, required: true },
        senderName: { type: String, required: true },
        text: { type: String, required: true, trim: true },
        isSystem: { type: Boolean, default: false },
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

// POST /api/team-requests/:id/messages - Send a direct chat message in an accepted teammate thread
app.post('/api/team-requests/:id/messages', requireAuth, async (req, res) => {
  try {
    const reqId = String(req.params.id);
    const { text } = req.body;
    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: 'Message text cannot be empty.' });
    }

    const uid = String(req.user.id);
    const msgObj = {
      senderId: uid,
      senderName: req.user.username,
      text: String(text).trim(),
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

    if (typeof tr.save === 'function') {
      await tr.save().catch(() => {});
    }
    await syncTeamRequestToLocal(tr);

    return res.status(201).json({ messages: tr.messages });
  } catch (err) {
    return res.status(500).json({ error: 'Could not send message: ' + err.message });
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

// POST /api/chat-groups/:id/messages - Send a message in a Group Chat
app.post('/api/chat-groups/:id/messages', requireAuth, async (req, res) => {
  try {
    const groupId = String(req.params.id);
    const { text } = req.body;
    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: 'Message text cannot be empty.' });
    }

    const uid = String(req.user.id);
    const grp = await findChatGroupById(groupId);
    if (!grp) return res.status(404).json({ error: 'Group chat not found.' });

    const memberIds = (grp.members || []).map(String);
    if (!memberIds.includes(uid)) {
      return res.status(403).json({ error: 'You are not a member of this group.' });
    }

    const msgObj = {
      senderId: uid,
      senderName: req.user.username,
      text: String(text).trim(),
      isSystem: false,
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

    if (typeof grp.save === 'function') {
      await grp.save().catch(() => {});
    }
    await syncChatGroupToLocal(grp);

    return res.status(201).json({ messages: grp.messages });
  } catch (err) {
    return res.status(500).json({ error: 'Could not send group message: ' + err.message });
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
