const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
require('dotenv').config();

const db = require('./config/db');
const { requireAuth, requirePage } = require('./middleware/auth');
const authService = require('./services/authService');

const app = express();
app.set('trust proxy', true);
const server = http.createServer(app);

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const corsOptions = {
  origin: allowedOrigins.length
    ? (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin))
    : true,
  credentials: true,
};

const io = socketIo(server, { cors: corsOptions });

app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

app.set('io', io);

app.get('/health', async (_req, res) => {
  try {
    await db.ping();
    res.json({ status: 'OK', db: 'up', ts: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: 'ERROR', db: 'down', error: err.message });
  }
});

// Routes
app.use('/media', require('./routes/media'));              // public reads, authenticated uploads
app.use('/webhook', require('./routes/webhook'));          // twilio-signed, public
app.use('/api/outbound', require('./routes/outbound'));    // bearer-token (server-to-server)
app.use('/api/bots', require('./routes/bots'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/broadcast', require('./routes/broadcast'));
app.use('/api/settings', require('./routes/settings'));
app.use('/auth', require('./routes/auth'));

// Expose current user (used by SPA)
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.get('/login', (_req, res) => {
  res.sendFile(path.join(__dirname, '../views/login.html'));
});

// HTML pages protected by application-level sessions and roles.
app.get('/', requirePage('chat:read'), (_req, res) => {
  res.sendFile(path.join(__dirname, '../views/dashboard.html'));
});
app.get('/admin', requirePage('admin'), (_req, res) => {
  res.sendFile(path.join(__dirname, '../views/admin.html'));
});
app.get('/broadcast', requirePage('broadcast:read'), (_req, res) => {
  res.sendFile(path.join(__dirname, '../views/broadcast.html'));
});
app.get('/settings', requirePage('admin'), (_req, res) => {
  res.sendFile(path.join(__dirname, '../views/settings.html'));
});

io.use(async (socket, next) => {
  try {
    const development = process.env.DEV_ADMIN_EMAIL
      ? { permissions: ['*'] }
      : await authService.userFromSession(authService.readSessionCookie(socket.handshake.headers.cookie || ''));
    if (!development || !authService.can(development, 'chat:read')) return next(new Error('unauthorized'));
    socket.user = development;
    next();
  } catch (error) { next(error); }
});

io.on('connection', (socket) => {
  socket.on('join-bot', (botId) => {
    if (typeof botId === 'string' && botId.length) {
      socket.join(`bot:${botId}`);
    }
  });
});

const PORT = process.env.PORT || 8080;

async function start() {
  try {
    await db.ping();
    console.log('✅ Postgres reachable');
    const bootstrapped = await authService.ensureBootstrapAdmin();
    if (bootstrapped) console.log('🔐 Bootstrap administrator created');
    const resumed = await require('./services/broadcastService').resumePending();
    if (resumed) console.log(`↻ ${resumed} broadcast ripresi`);
  } catch (err) {
    console.error('❌ Postgres not reachable:', err.message);
    process.exit(1);
  }
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server listening on :${PORT}`);
  });
}
start();

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    console.log(`🛑 ${sig}, shutting down`);
    server.close(() => process.exit(0));
    try { await db.pool.end(); } catch {}
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
