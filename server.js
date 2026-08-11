require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', true);

app.use('/auth/login', rateLimit({
  windowMs: 900000, max: 10,
  message: { error: 'Too many requests' },
  standardHeaders: true, legacyHeaders: false
}));

// DB init
const { initialize } = require('./config/database');
try { initialize(); } catch (e) { console.error('DB FATAL:', e.message); process.exit(1); }

// Routes — inbounds MUST be before api
app.use('/auth', require('./routes/auth'));
app.use('/api/inbounds', require('./routes/inbound'));
app.use('/api', require('./routes/api'));
app.use('/sub', require('./routes/subscription'));

app.use('/public', express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'login.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'login.html')));
app.get('/panel', (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Server error' });
});

// Xray
const XrayService = require('./services/xray');
if (XrayService.isInstalled()) {
  console.log('Xray: ' + XrayService.getVersion());
  setTimeout(() => { try { XrayService.start(); } catch (e) { console.error('Xray:', e.message); } }, 3000);
} else {
  console.log('Xray not installed — panel-only mode');
}

// Cron: disable expired every 5 min
const Client = require('./models/Client');
cron.schedule('*/5 * * * *', () => {
  try {
    const n = Client.disableExpired();
    if (n > 0) {
      console.log('[Cron] Disabled ' + n + ' expired');
      if (XrayService.isRunning()) XrayService.restart().catch(() => {});
    }
  } catch {}
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('=================================');
  console.log('  VPN Panel Pro v3.2');
  console.log('  http://localhost:' + PORT);
  console.log('  Xray: ' + (XrayService.isInstalled() ? 'YES' : 'NO'));
  console.log('=================================');
  console.log('');
});

const shutdown = () => { XrayService.stop(); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('uncaughtException', e => console.error('Uncaught:', e));
process.on('unhandledRejection', e => console.error('Unhandled:', e));
