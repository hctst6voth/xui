const express = require('express');
const { verifyToken } = require('../middleware/auth');
const Inbound = require('../models/Inbound');
const XrayService = require('../services/xray');

const router = express.Router();
router.use(verifyToken);

router.get('/', (req, res) => {
  try { res.json({ success: true, inbounds: Inbound.getAll() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID نامعتبر' });
    const inbound = Inbound.getById(id);
    if (!inbound) return res.status(404).json({ error: 'یافت نشد' });
    const clients = Inbound.getClientsByInbound(id);
    res.json({ success: true, inbound, clients });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', (req, res) => {
  try {
    const inbound = Inbound.create(req.body);
    restartXray();
    res.status(201).json({ success: true, inbound });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID نامعتبر' });
    const inbound = Inbound.update(id, req.body);
    if (!inbound) return res.status(404).json({ error: 'یافت نشد' });
    restartXray();
    res.json({ success: true, inbound });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID نامعتبر' });
    Inbound.delete(id);
    restartXray();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/toggle', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID نامعتبر' });
    const inbound = Inbound.toggleEnable(id);
    restartXray();
    res.json({ success: true, inbound });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function restartXray() {
  if (XrayService.isRunning()) XrayService.restart().catch(() => {});
}

module.exports = router;
