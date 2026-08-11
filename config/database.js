const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const DB_PATH = path.join(dataDir, 'panel.db');
let db;

try {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
} catch (err) {
  console.error('DB open error:', err.message);
  process.exit(1);
}

function initialize() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    );

    CREATE TABLE IF NOT EXISTS inbounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag TEXT UNIQUE NOT NULL,
      remark TEXT NOT NULL DEFAULT '',
      protocol TEXT NOT NULL DEFAULT 'vless',
      listen TEXT DEFAULT '0.0.0.0',
      port INTEGER NOT NULL,
      enabled INTEGER DEFAULT 1,
      network TEXT DEFAULT 'tcp',
      security TEXT DEFAULT 'none',
      tls_enabled INTEGER DEFAULT 0,
      sni TEXT DEFAULT '',
      fingerprint TEXT DEFAULT 'chrome',
      alpn TEXT DEFAULT 'h2,http/1.1',
      reality_enabled INTEGER DEFAULT 0,
      reality_dest TEXT DEFAULT '',
      reality_server_names TEXT DEFAULT '',
      reality_private_key TEXT DEFAULT '',
      reality_public_key TEXT DEFAULT '',
      reality_short_ids TEXT DEFAULT '',
      ws_path TEXT DEFAULT '/',
      ws_host TEXT DEFAULT '',
      grpc_service_name TEXT DEFAULT '',
      http_path TEXT DEFAULT '/',
      tcp_header_type TEXT DEFAULT 'none',
      ss_method TEXT DEFAULT 'chacha20-ietf-poly1305',
      ss_network TEXT DEFAULT 'tcp,udp',
      sniffing_enabled INTEGER DEFAULT 1,
      total_up INTEGER DEFAULT 0,
      total_down INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inbound_id INTEGER NOT NULL,
      uuid TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT DEFAULT '',
      enabled INTEGER DEFAULT 1,
      traffic_limit INTEGER DEFAULT 0,
      traffic_used INTEGER DEFAULT 0,
      traffic_up INTEGER DEFAULT 0,
      traffic_down INTEGER DEFAULT 0,
      expire_date TEXT DEFAULT '',
      max_connections INTEGER DEFAULT 0,
      ss_password TEXT DEFAULT '',
      sub_uuid TEXT UNIQUE NOT NULL,
      flow TEXT DEFAULT '',
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (inbound_id) REFERENCES inbounds(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS server_config (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS login_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT DEFAULT '',
      ip_address TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      success INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_clients_uuid ON clients(uuid);
    CREATE INDEX IF NOT EXISTS idx_clients_inbound ON clients(inbound_id);
    CREATE INDEX IF NOT EXISTS idx_clients_sub ON clients(sub_uuid);
    CREATE INDEX IF NOT EXISTS idx_clients_enabled ON clients(enabled);
  `);

  // Admin user
  const admin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!admin) {
    const pw = process.env.ADMIN_PASSWORD || 'admin';
    db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)')
      .run('admin', bcrypt.hashSync(pw, 12), 'superadmin');
    console.log('Admin created → admin / ' + pw);
  }

  // Default configs
  const stmt = db.prepare('INSERT OR IGNORE INTO server_config (key, value) VALUES (?, ?)');
  stmt.run('server_domain', process.env.RAILWAY_PUBLIC_DOMAIN || process.env.SERVER_DOMAIN || '');
  stmt.run('panel_title', 'VPN Panel Pro');
  stmt.run('default_traffic_gb', '50');
  stmt.run('default_expire_days', '30');

  console.log('Database ready ✅');
}

function getConfig(key) {
  const r = db.prepare('SELECT value FROM server_config WHERE key = ?').get(key);
  return r ? r.value : '';
}

function setConfig(key, value) {
  db.prepare(
    'INSERT INTO server_config (key, value, updated_at) VALUES (?, ?, datetime(\'now\')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime(\'now\')'
  ).run(key, String(value));
}

function getAllConfig() {
  const rows = db.prepare('SELECT key, value FROM server_config').all();
  const o = {};
  for (const r of rows) o[r.key] = r.value;
  return o;
}

module.exports = { db, initialize, getConfig, setConfig, getAllConfig };
