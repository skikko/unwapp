const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
require('dotenv').config();

const db = require('./config/db');
const { requireAuth, requirePage } = require('./middleware/auth');
const authService = require('./services/authService');
const broadcastService = require('./services/broadcastService');
const emailService = require('./services/emailService');
const encryptionKeyGuard = require('./services/encryptionKeyGuard');
const objectStorageService = require('./services/objectStorageService');

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
app.get('/design-system/tokens.css', (_req, res) => {
  res.sendFile(path.join(__dirname, '../design-system/tokens.css'));
});
app.get('/design-system/components.css', (_req, res) => {
  res.sendFile(path.join(__dirname, '../design-system/components/bundle.css'));
});
app.get('/favicon.ico', (_req, res) => res.status(204).end());
app.use(express.static(path.join(__dirname, '../public')));

app.set('io', io);
broadcastService.setSocketServer(io);

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
app.use('/api/crm', require('./routes/crm'));
app.use('/api/ingest', require('./routes/crmIngest'));
app.use('/api/settings', require('./routes/settings'));
app.use('/auth', require('./routes/auth'));
app.use('/unsubscribe', require('./routes/unsubscribe'));

// Expose current user (used by SPA)
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.get('/login', (_req, res) => {
  res.sendFile(path.join(__dirname, '../views/login.html'));
});

// Pagine HTML protette da sessione e permessi applicativi.
app.get('/', requirePage('authenticated'), (_req, res) => {
  res.sendFile(path.join(__dirname, '../views/home.html'));
});
app.get('/whatsapp', requirePage('chat:read'), (_req, res) => {
  res.sendFile(path.join(__dirname, '../views/dashboard.html'));
});
app.get('/whatsapp/bots', requirePage('admin'), (_req, res) => {
  res.sendFile(path.join(__dirname, '../views/admin.html'));
});
app.get('/whatsapp/broadcast', requirePage('broadcast:read'), (_req, res) => {
  res.sendFile(path.join(__dirname, '../views/broadcast.html'));
});
app.get('/crm', requirePage('crm:read'), (_req, res) => {
  res.sendFile(path.join(__dirname, '../views/crm.html'));
});
app.get('/whatsapp/settings', requirePage('admin'), (_req, res) => {
  res.sendFile(path.join(__dirname, '../views/settings.html'));
});
app.get('/crm/settings', requirePage('admin'), (_req, res) => {
  res.sendFile(path.join(__dirname, '../views/crm-settings.html'));
});
app.get('/users', requirePage('admin'), (_req, res) => {
  res.sendFile(path.join(__dirname, '../views/users.html'));
});

app.get('/admin', requirePage('admin'), (_req, res) => res.redirect('/whatsapp/bots'));
app.get('/broadcast', requirePage('broadcast:read'), (_req, res) => res.redirect('/whatsapp/broadcast'));
app.get('/settings', requirePage('admin'), (_req, res) => res.redirect('/whatsapp/settings'));

app.use((error, req, res, _next) => {
  console.error('Request error:', error.message);
  let databaseStatus = null;
  let databaseMessage = null;
  if (error.code === '23505') {
    databaseStatus = 409;
    databaseMessage = 'Esiste già un contatto con questa email o questo telefono';
  } else if (error.code === '23503') {
    databaseStatus = 409;
    databaseMessage = 'La risorsa è ancora utilizzata e non può essere eliminata';
  }
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(error.status || databaseStatus || 500).json({ error: databaseMessage || error.message });
  }
  return res.status(error.status || 500).send('Internal server error');
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
    console.log('OK Postgres reachable');
    const encryptionKeyStatus = await encryptionKeyGuard.verifyEncryptionKey();
    console.log(`OK APP_ENCRYPTION_KEY ${encryptionKeyStatus}`);
    console.log(`OK Media storage ${objectStorageService.validateConfiguration()}`);
    const bootstrapped = await authService.ensureBootstrapAdmin();
    if (bootstrapped) console.log('OK Bootstrap administrator created');
    const resumed = await broadcastService.resumePending();
    if (resumed) console.log(`OK ${resumed} broadcast resumed`);
    emailService.startWorker();
  } catch (err) {
    console.error('ERROR Application startup failed:', err.message);
    process.exit(1);
  }
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`OK Server listening on :${PORT}`);
  });
}
start();

let shutdownStarted = false;

function closeHttpServer() {
  io.disconnectSockets(true);
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function shutdown(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  console.log(`WARN ${signal}, graceful shutdown started`);
  broadcastService.beginShutdown();

  const timeoutMs = 50_000;
  let timeout;
  const deadline = new Promise((resolve) => {
    timeout = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const drained = Promise.all([
    closeHttpServer(),
    broadcastService.waitForIdle(),
    emailService.stopWorker(),
  ]).then(() => 'drained');

  try {
    const result = await Promise.race([drained, deadline]);
    if (result === 'timeout') {
      console.error('ERROR Graceful shutdown timed out');
      process.exit(1);
    }
    clearTimeout(timeout);
    await db.pool.end();
    console.log('OK Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    console.error('ERROR Graceful shutdown failed:', error.message);
    process.exit(1);
  }
}

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => shutdown(sig));
}
