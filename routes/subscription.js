const express = require('express');
const Client = require('../models/Client');
const ProtocolService = require('../services/protocols');

const router = express.Router();

router.get('/:subUuid', (req, res) => {
  try {
    const subUuid = String(req.params.subUuid).trim();
    if (!subUuid || subUuid.length < 8) {
      return res.status(404).type('text').send('Not Found');
    }

    const client = Client.getBySubUuid(subUuid);

    if (!client) {
      return res.status(404).type('text').send('Not Found');
    }

    if (!client.enabled) {
      return res.status(403).type('text').send('Disabled');
    }

    if (client.expire_date && client.expire_date.trim() && new Date(client.expire_date) < new Date()) {
      return res.status(403).type('text').send('Expired');
    }

    if (client.traffic_limit > 0 && client.traffic_used >= client.traffic_limit) {
      return res.status(403).type('text').send('Traffic Exceeded');
    }

    const link = ProtocolService.generateLink(client);
    if (!link) {
      return res.status(500).type('text').send('Error generating link');
    }

    const encoded = Buffer.from(link).toString('base64');

    // Subscription headers
    const expireTS = client.expire_date && client.expire_date.trim()
      ? Math.floor(new Date(client.expire_date).getTime() / 1000)
      : 0;

    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Profile-Title': Buffer.from(client.name || 'VPN').toString('base64'),
      'Subscription-Userinfo': `upload=${client.traffic_up || 0}; download=${client.traffic_down || 0}; total=${client.traffic_limit || 0}; expire=${expireTS}`,
      'Profile-Update-Interval': '12',
      'Cache-Control': 'no-cache, no-store'
    });

    res.send(encoded);
  } catch (err) {
    console.error('Subscription error:', err);
    res.status(500).type('text').send('Server Error');
  }
});

module.exports = router;
