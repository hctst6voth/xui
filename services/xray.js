const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, getConfig } = require('../config/database');

const XRAY_DIR = path.join(__dirname, '..', 'xray');
const XRAY_BIN = path.join(XRAY_DIR, 'xray');
const XRAY_CONFIG = path.join(XRAY_DIR, 'config.json');

let xrayProcess = null;
let xrayRunning = false;
let manualStop = false;
let logs = [];

function log(msg) {
  logs.push({ t: new Date().toISOString(), m: msg });
  if (logs.length > 200) logs.shift();
}

class XrayService {

  static isInstalled() {
    return fs.existsSync(XRAY_BIN);
  }

  static getVersion() {
    if (!this.isInstalled()) return 'Not installed';
    try {
      const o = execSync(`"${XRAY_BIN}" version 2>&1 || true`, { timeout: 5000 }).toString();
      const m = o.match(/Xray\s+([\d.]+)/i);
      return m ? 'v' + m[1] : o.split('\n')[0].substring(0, 40);
    } catch { return 'unknown'; }
  }

  static isRunning() {
    if (!xrayRunning || !xrayProcess) return false;
    try { return !xrayProcess.killed; } catch { return false; }
  }

  static generateConfig() {
    let inbounds = [];
    try {
      inbounds = db.prepare('SELECT * FROM inbounds WHERE enabled = 1').all();
    } catch (e) {
      log('DB error: ' + e.message);
    }

    const cfg = {
      log: { loglevel: 'warning' },
      api: { tag: 'api', services: ['StatsService'] },
      stats: {},
      policy: {
        levels: { '0': { statsUserUplink: true, statsUserDownlink: true } },
        system: { statsInboundUplink: true, statsInboundDownlink: true }
      },
      inbounds: [
        {
          tag: 'api',
          listen: '127.0.0.1',
          port: 10085,
          protocol: 'dokodemo-door',
          settings: { address: '127.0.0.1' }
        }
      ],
      outbounds: [
        { tag: 'direct', protocol: 'freedom', settings: {} },
        { tag: 'blocked', protocol: 'blackhole', settings: {} }
      ],
      routing: {
        rules: [
          { inboundTag: ['api'], outboundTag: 'api', type: 'field' },
          { type: 'field', ip: ['geoip:private'], outboundTag: 'blocked' }
        ]
      }
    };

    for (const inb of inbounds) {
      try {
        const x = this._buildInbound(inb);
        if (x) cfg.inbounds.push(x);
      } catch (e) {
        log('Build inbound error [' + inb.tag + ']: ' + e.message);
      }
    }

    return cfg;
  }

  static _buildInbound(inb) {
    let clients = [];
    try {
      clients = db.prepare('SELECT * FROM clients WHERE inbound_id = ? AND enabled = 1').all(inb.id);
    } catch { clients = []; }

    if (clients.length === 0) {
      log('Skip ' + inb.tag + ': no clients');
      return null;
    }

    const o = {
      tag: inb.tag,
      listen: inb.listen || '0.0.0.0',
      port: inb.port,
      protocol: inb.protocol,
      settings: {},
      streamSettings: {},
      sniffing: {
        enabled: inb.sniffing_enabled === 1,
        destOverride: ['http', 'tls', 'quic']
      }
    };

    // Protocol settings
    switch (inb.protocol) {
      case 'vless':
        o.settings = {
          clients: clients.map(c => {
            const cl = { id: c.uuid, email: c.email || c.name + '@panel', level: 0 };
            if (c.flow && c.flow.length > 0) cl.flow = c.flow;
            return cl;
          }),
          decryption: 'none',
          fallbacks: []
        };
        break;

      case 'vmess':
        o.settings = {
          clients: clients.map(c => ({
            id: c.uuid,
            email: c.email || c.name + '@panel',
            alterId: 0,
            level: 0
          }))
        };
        break;

      case 'trojan':
        o.settings = {
          clients: clients.map(c => ({
            password: c.uuid,
            email: c.email || c.name + '@panel',
            level: 0
          })),
          fallbacks: []
        };
        break;

      case 'shadowsocks':
        o.settings = {
          method: inb.ss_method || 'chacha20-ietf-poly1305',
          password: clients[0].ss_password || clients[0].uuid,
          network: inb.ss_network || 'tcp,udp'
        };
        // Multi-user SS (Xray 1.8+)
        if (clients.length > 0) {
          o.settings.clients = clients.map(c => ({
            password: c.ss_password || c.uuid,
            email: c.email || c.name + '@panel',
            level: 0
          }));
        }
        break;

      default:
        log('Unknown protocol: ' + inb.protocol);
        return null;
    }

    // Stream settings
    const st = {};
    const net = inb.network || 'tcp';
    st.network = net;

    switch (net) {
      case 'tcp':
        st.tcpSettings = { header: { type: inb.tcp_header_type || 'none' } };
        break;
      case 'ws':
        st.wsSettings = { path: inb.ws_path || '/', headers: {} };
        if (inb.ws_host) st.wsSettings.headers.Host = inb.ws_host;
        break;
      case 'grpc':
        st.grpcSettings = { serviceName: inb.grpc_service_name || 'grpc', multiMode: false };
        break;
      case 'http':
      case 'h2':
        st.network = 'http';
        st.httpSettings = { path: inb.http_path || '/', host: inb.ws_host ? [inb.ws_host] : [] };
        break;
    }

    // Security
    if (inb.reality_enabled === 1) {
      st.security = 'reality';
      const sn = (inb.reality_server_names || '').split(',').map(s => s.trim()).filter(Boolean);
      const si = (inb.reality_short_ids || '').split(',').map(s => s.trim()).filter(Boolean);
      st.realitySettings = {
        show: false,
        dest: inb.reality_dest || 'yahoo.com:443',
        xver: 0,
        serverNames: sn.length > 0 ? sn : ['yahoo.com'],
        privateKey: inb.reality_private_key || '',
        shortIds: si.length > 0 ? si : ['']
      };
    } else if (inb.tls_enabled === 1) {
      st.security = 'tls';
      st.tlsSettings = {
        serverName: inb.sni || '',
        fingerprint: inb.fingerprint || 'chrome',
        alpn: (inb.alpn || 'h2,http/1.1').split(',').map(s => s.trim()).filter(Boolean)
      };
    } else {
      st.security = 'none';
    }

    o.streamSettings = st;
    return o;
  }

  static saveConfig() {
    const cfg = this.generateConfig();
    fs.mkdirSync(path.dirname(XRAY_CONFIG), { recursive: true });
    fs.writeFileSync(XRAY_CONFIG, JSON.stringify(cfg, null, 2), 'utf8');
    log('Config saved');
    return cfg;
  }

  static start() {
    if (!this.isInstalled()) { log('Not installed'); return false; }
    if (this.isRunning()) { log('Already running'); return true; }

    manualStop = false;

    try { this.saveConfig(); }
    catch (e) { log('Config error: ' + e.message); return false; }

    try {
      xrayProcess = spawn(XRAY_BIN, ['run', '-config', XRAY_CONFIG], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, XRAY_LOCATION_ASSET: XRAY_DIR }
      });

      xrayRunning = true;
      log('Started PID=' + xrayProcess.pid);

      xrayProcess.stdout.on('data', d => {
        d.toString().trim().split('\n').forEach(l => { if (l) log(l); });
      });

      xrayProcess.stderr.on('data', d => {
        d.toString().trim().split('\n').forEach(l => { if (l) log('[ERR] ' + l); });
      });

      xrayProcess.on('close', code => {
        log('Exited code=' + code);
        xrayRunning = false;
        xrayProcess = null;
        if (code !== 0 && !manualStop) {
          log('Auto-restart in 5s');
          setTimeout(() => { if (!xrayRunning && !manualStop) this.start(); }, 5000);
        }
      });

      xrayProcess.on('error', e => {
        log('Error: ' + e.message);
        xrayRunning = false;
        xrayProcess = null;
      });

      return true;
    } catch (e) {
      log('Start failed: ' + e.message);
      xrayRunning = false;
      xrayProcess = null;
      return false;
    }
  }

  static stop() {
    manualStop = true;
    if (xrayProcess) {
      try { xrayProcess.kill('SIGTERM'); } catch {}
      xrayProcess = null;
    }
    xrayRunning = false;
    log('Stopped');
    return true;
  }

  static restart() {
    this.stop();
    manualStop = false;
    return new Promise(resolve => {
      setTimeout(() => resolve(this.start()), 1000);
    });
  }

  static getStatus() {
    return {
      installed: this.isInstalled(),
      running: this.isRunning(),
      version: this.isInstalled() ? this.getVersion() : 'Not installed',
      pid: xrayProcess ? xrayProcess.pid : null
    };
  }

  static getCurrentConfig() {
    try {
      if (fs.existsSync(XRAY_CONFIG)) return JSON.parse(fs.readFileSync(XRAY_CONFIG, 'utf8'));
    } catch {}
    return null;
  }

  static getLogs(n) { return logs.slice(-(n || 50)); }

  static generateRealityKeysWithXray() {
    if (this.isInstalled()) {
      try {
        const out = execSync(`"${XRAY_BIN}" x25519 2>&1`, { timeout: 5000 }).toString();
        const pri = out.match(/Private key:\s*(\S+)/);
        const pub = out.match(/Public key:\s*(\S+)/);
        if (pri && pub) {
          return {
            privateKey: pri[1],
            publicKey: pub[1],
            shortId: crypto.randomBytes(4).toString('hex')
          };
        }
      } catch {}
    }
    // Fallback
    return {
      privateKey: crypto.randomBytes(32).toString('base64url').substring(0, 43),
      publicKey: crypto.randomBytes(32).toString('base64url').substring(0, 43),
      shortId: crypto.randomBytes(4).toString('hex')
    };
  }
}

module.exports = XrayService;
