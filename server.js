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
      if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, Buffer.from(b64Data, 'base64'));
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
