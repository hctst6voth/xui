const express = require('express');
const QRCode = require('qrcode');
const { verifyToken } = require('../middleware/auth');
const { db, getAllConfig, setConfig } = require('../config/database');
const Client = require('../models/Client');
const ProtocolService = require('../services/protocols');
const XrayService = require('../services/xray');
const { formatBytes } = require('../utils/generator');

const router = express.Router();
router.use(verifyToken);

// ===== آمار =====
router.get('/stats', (req, res) => {
  try {
    const stats = Client.getStats();
    const xray = XrayService.getStatus();

    res.json({
      success: true,
      clients: stats,
      traffic: {
        total: stats.totalTraffic,
        formatted: formatBytes(stats.totalTraffic)
      },
      xray
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Xray =====
router.get('/xray/status', (req, res) => {
  res.json({ success: true, status: XrayService.getStatus() });
});

router.post('/xray/start', (req, res) => {
  const ok = XrayService.start();
  res.json({ success: ok, status: XrayService.getStatus() });
});

router.post('/xray/stop', (req, res) => {
  XrayService.stop();
  res.json({ success: true, status: XrayService.getStatus() });
});

router.post('/xray/restart', async (req, res) => {
  await XrayService.restart();
  res.json({ success: true, status: XrayService.getStatus() });
});

router.get('/xray/config', (req, res) => {
  try {
    const config = XrayService.getCurrentConfig() || XrayService.generateConfig();
    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/xray/logs', (req, res) => {
  const count = parseInt(req.query.count) || 50;
  res.json({ success: true, logs: XrayService.getLogs(count) });
});

// ===== کلاینت‌ها =====
router.get('/clients', (req, res) => {
  try {
    const { inbound_id, search, enabled } = req.query;
    const clients = Client.getAll({
      inbound_id: inbound_id || undefined,
      search: search || undefined,
      enabled: enabled !== undefined ? parseInt(enabled) : undefined
    });

    const enriched = clients.map(c => {
      const isExpired = c.expire_date && c.expire_date.trim() && new Date(c.expire_date) < new Date();
      const isTrafficExceeded = c.traffic_limit > 0 && c.traffic_used >= c.traffic_limit;
      const daysLeft = c.expire_date && c.expire_date.trim()
        ? Math.max(0, Math.ceil((new Date(c.expire_date) - new Date()) / 86400000))
        : null;
      const trafficPercent = c.traffic_limit > 0
        ? Math.min(100, Math.round((c.traffic_used / c.traffic_limit) * 100))
        : 0;

      return {
        ...c,
        traffic_used_fmt: formatBytes(c.traffic_used),
        traffic_limit_fmt: c.traffic_limit > 0 ? formatBytes(c.traffic_limit) : 'نامحدود',
        traffic_up_fmt: formatBytes(c.traffic_up),
        traffic_down_fmt: formatBytes(c.traffic_down),
        traffic_percent: trafficPercent,
        is_expired: isExpired,
        is_traffic_exceeded: isTrafficExceeded,
        days_left: daysLeft,
        link: ProtocolService.generateLink(c)
      };
    });

    res.json({ success: true, clients: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/clients/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID نامعتبر' });

    const c = Client.getById(id);
    if (!c) return res.status(404).json({ error: 'یافت نشد' });

    c.link = ProtocolService.generateLink(c);
    res.json({ success: true, client: c });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/clients', (req, res) => {
  try {
    const client = Client.create(req.body);

    // Restart xray to apply new client
    if (XrayService.isRunning()) {
      XrayService.restart().catch(() => {});
    }

    const full = Client.getById(client.id);
    if (full) full.link = ProtocolService.generateLink(full);

    res.status(201).json({ success: true, client: full || client });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/clients/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID نامعتبر' });

    const client = Client.update(id, req.body);
    if (!client) return res.status(404).json({ error: 'یافت نشد' });

    if (XrayService.isRunning()) {
      XrayService.restart().catch(() => {});
    }

    res.json({ success: true, client });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/clients/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID نامعتبر' });

    Client.delete(id);

    if (XrayService.isRunning()) {
      XrayService.restart().catch(() => {});
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/clients/:id/toggle', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const c = Client.toggleEnable(id);

    if (XrayService.isRunning()) {
      XrayService.restart().catch(() => {});
    }

    res.json({ success: true, client: c });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/clients/:id/reset-traffic', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const c = Client.resetTraffic(id);
    res.json({ success: true, client: c });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/clients/:id/qrcode', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const c = Client.getById(id);
    if (!c) return res.status(404).json({ error: 'یافت نشد' });

    const link = ProtocolService.generateLink(c);
    if (!link) return res.status(400).json({ error: 'لینک قابل تولید نیست' });

    const qr = await QRCode.toDataURL(link, { width: 280, margin: 2 });
    res.json({ success: true, qrcode: qr, link, subUrl: c.sub_uuid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Tools =====
router.get('/tools/reality-keys', (req, res) => {
  const keys = XrayService.generateRealityKeysWithXray();
  res.json({ success: true, keys });
});

router.get('/tools/ss-password', (req, res) => {
  const { generateSSPassword } = require('../utils/generator');
  res.json({ success: true, password: generateSSPassword() });
});

// ===== Config =====
router.get('/config', (req, res) => {
  res.json({ success: true, config: getAllConfig() });
});

router.put('/config', (req, res) => {
  try {
    const body = req.body;
    if (typeof body !== 'object') return res.status(400).json({ error: 'Invalid data' });

    for (const [k, v] of Object.entries(body)) {
      setConfig(String(k), String(v));
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== System =====
router.get('/system', (req, res) => {
  try {
    const mem = process.memoryUsage();
    const up = process.uptime();
    res.json({
      success: true,
      system: {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        memory: {
          rss: formatBytes(mem.rss),
          heap: formatBytes(mem.heapUsed)
        },
        uptime: `${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m`
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Logs =====
router.get('/logs', (req, res) => {
  try {
    const logs = db.prepare('SELECT * FROM login_logs ORDER BY created_at DESC LIMIT 100').all();
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Export =====
router.get('/export', (req, res) => {
  try {
    const inbounds = db.prepare('SELECT * FROM inbounds').all();
    const clients = db.prepare('SELECT * FROM clients').all();
    const config = getAllConfig();
    res.json({
      success: true,
      data: { version: '3.1', exported_at: new Date().toISOString(), inbounds, clients, config }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
