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

// Stats
router.get('/stats', (req, res) => {
  try {
    const s = Client.getStats();
    res.json({
      success: true,
      clients: s,
      traffic: { total: s.totalTraffic, formatted: formatBytes(s.totalTraffic) },
      xray: XrayService.getStatus()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Xray
router.get('/xray/status', (req, res) => {
  res.json({ success: true, status: XrayService.getStatus() });
});
router.post('/xray/start', (req, res) => {
  res.json({ success: XrayService.start(), status: XrayService.getStatus() });
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
    res.json({ success: true, config: XrayService.getCurrentConfig() || XrayService.generateConfig() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/xray/logs', (req, res) => {
  res.json({ success: true, logs: XrayService.getLogs(parseInt(req.query.count) || 50) });
});

// Clients
router.get('/clients', (req, res) => {
  try {
    const { inbound_id, search, enabled } = req.query;
    const clients = Client.getAll({
      inbound_id: inbound_id || undefined,
      search: search || undefined,
      enabled: enabled !== undefined ? parseInt(enabled) : undefined
    });

    const out = clients.map(c => {
      const isExp = c.expire_date && c.expire_date.length > 0 && new Date(c.expire_date) < new Date();
      const isTraf = c.traffic_limit > 0 && c.traffic_used >= c.traffic_limit;
      const dl = c.expire_date && c.expire_date.length > 0
        ? Math.max(0, Math.ceil((new Date(c.expire_date) - new Date()) / 86400000))
        : null;
      const tp = c.traffic_limit > 0 ? Math.min(100, Math.round(c.traffic_used / c.traffic_limit * 100)) : 0;

      return {
        ...c,
        traffic_used_fmt: formatBytes(c.traffic_used),
        traffic_limit_fmt: c.traffic_limit > 0 ? formatBytes(c.traffic_limit) : 'نامحدود',
        traffic_up_fmt: formatBytes(c.traffic_up),
        traffic_down_fmt: formatBytes(c.traffic_down),
        traffic_percent: tp,
        is_expired: !!isExp,
        is_traffic_exceeded: !!isTraf,
        days_left: dl,
        link: ProtocolService.generateLink(c)
      };
    });

    res.json({ success: true, clients: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/clients/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID نامعتبر' });
    const c = Client.getById(id);
    if (!c) return res.status(404).json({ error: 'یافت نشد' });
    c.link = ProtocolService.generateLink(c);
    res.json({ success: true, client: c });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/clients', (req, res) => {
  try {
    const c = Client.create(req.body);
    if (XrayService.isRunning()) XrayService.restart().catch(() => {});
    const full = Client.getById(c.id);
    if (full) full.link = ProtocolService.generateLink(full);
    res.status(201).json({ success: true, client: full || c });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/clients/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID نامعتبر' });
    const c = Client.update(id, req.body);
    if (!c) return res.status(404).json({ error: 'یافت نشد' });
    if (XrayService.isRunning()) XrayService.restart().catch(() => {});
    res.json({ success: true, client: c });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/clients/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID نامعتبر' });
    Client.delete(id);
    if (XrayService.isRunning()) XrayService.restart().catch(() => {});
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/clients/:id/toggle', (req, res) => {
  try {
    const c = Client.toggleEnable(parseInt(req.params.id));
    if (XrayService.isRunning()) XrayService.restart().catch(() => {});
    res.json({ success: true, client: c });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/clients/:id/reset-traffic', (req, res) => {
  try {
    const c = Client.resetTraffic(parseInt(req.params.id));
    res.json({ success: true, client: c });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/clients/:id/qrcode', async (req, res) => {
  try {
    const c = Client.getById(parseInt(req.params.id));
    if (!c) return res.status(404).json({ error: 'یافت نشد' });
    const link = ProtocolService.generateLink(c);
    if (!link) return res.status(400).json({ error: 'لینک تولید نشد' });
    const qr = await QRCode.toDataURL(link, { width: 280, margin: 2 });
    res.json({ success: true, qrcode: qr, link: link, subUrl: c.sub_uuid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Tools
router.get('/tools/reality-keys', (req, res) => {
  res.json({ success: true, keys: XrayService.generateRealityKeysWithXray() });
});
router.get('/tools/ss-password', (req, res) => {
  res.json({ success: true, password: require('../utils/generator').generateSSPassword() });
});

// Config
router.get('/config', (req, res) => {
  res.json({ success: true, config: getAllConfig() });
});
router.put('/config', (req, res) => {
  try {
    for (const [k, v] of Object.entries(req.body)) setConfig(String(k), String(v));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// System
router.get('/system', (req, res) => {
  const m = process.memoryUsage();
  const u = process.uptime();
  res.json({
    success: true,
    system: {
      platform: process.platform, arch: process.arch, node: process.version,
      memory: { rss: formatBytes(m.rss), heap: formatBytes(m.heapUsed) },
      uptime: Math.floor(u / 3600) + 'h ' + Math.floor((u % 3600) / 60) + 'm'
    }
  });
});

// Logs
router.get('/logs', (req, res) => {
  try {
    res.json({ success: true, logs: db.prepare('SELECT * FROM login_logs ORDER BY created_at DESC LIMIT 100').all() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Export
router.get('/export', (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        version: '3.2',
        exported_at: new Date().toISOString(),
        inbounds: db.prepare('SELECT * FROM inbounds').all(),
        clients: db.prepare('SELECT * FROM clients').all(),
        config: getAllConfig()
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
