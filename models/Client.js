const { db } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const CLIENT_JOIN = `
  SELECT c.*,
    i.protocol, i.port, i.tag as inbound_tag, i.remark as inbound_name,
    i.network, i.security, i.tls_enabled, i.sni, i.fingerprint, i.alpn,
    i.reality_enabled, i.reality_public_key, i.reality_short_ids,
    i.reality_dest, i.reality_server_names,
    i.ws_path, i.ws_host, i.grpc_service_name, i.http_path,
    i.ss_method, i.tcp_header_type
  FROM clients c
  LEFT JOIN inbounds i ON c.inbound_id = i.id
`;

class Client {

  static create(data) {
    const inbId = parseInt(data.inbound_id);
    if (!inbId) throw new Error('اینباند انتخاب نشده');

    const inb = db.prepare('SELECT id FROM inbounds WHERE id = ?').get(inbId);
    if (!inb) throw new Error('اینباند یافت نشد');

    const uuid = data.uuid || uuidv4();
    const subUuid = crypto.randomBytes(8).toString('hex');

    let expireDate = '';
    const days = parseInt(data.expire_days);
    if (days > 0) {
      const d = new Date();
      d.setDate(d.getDate() + days);
      expireDate = d.toISOString();
    } else if (data.expire_date && String(data.expire_date).trim()) {
      expireDate = new Date(data.expire_date).toISOString();
    }

    const trafGB = parseFloat(data.traffic_limit) || 0;
    const trafBytes = Math.floor(trafGB * 1073741824);

    const info = db.prepare(`
      INSERT INTO clients (
        inbound_id, uuid, name, email, enabled,
        traffic_limit, expire_date, max_connections,
        ss_password, sub_uuid, flow, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      inbId, uuid,
      data.name || 'Client',
      data.email || '',
      1,
      trafBytes,
      expireDate,
      parseInt(data.max_connections) || 0,
      data.ss_password || crypto.randomBytes(16).toString('base64'),
      subUuid,
      data.flow || '',
      data.note || ''
    );

    return this.getById(info.lastInsertRowid);
  }

  static getAll(filters = {}) {
    let where = ' WHERE 1=1';
    const p = [];

    if (filters.inbound_id) {
      where += ' AND c.inbound_id = ?';
      p.push(parseInt(filters.inbound_id));
    }
    if (filters.enabled !== undefined) {
      where += ' AND c.enabled = ?';
      p.push(parseInt(filters.enabled));
    }
    if (filters.search) {
      where += ' AND (c.name LIKE ? OR c.email LIKE ? OR c.uuid LIKE ?)';
      const s = '%' + filters.search + '%';
      p.push(s, s, s);
    }

    return db.prepare(CLIENT_JOIN + where + ' ORDER BY c.created_at DESC').all(...p);
  }

  static getById(id) {
    return db.prepare(CLIENT_JOIN + ' WHERE c.id = ?').get(id);
  }

  static getBySubUuid(sub) {
    return db.prepare(CLIENT_JOIN + ' WHERE c.sub_uuid = ?').get(sub);
  }

  static update(id, data) {
    const old = this.getById(id);
    if (!old) return null;

    const sets = [];
    const vals = [];

    if (data.name !== undefined) { sets.push('name = ?'); vals.push(data.name); }
    if (data.email !== undefined) { sets.push('email = ?'); vals.push(data.email); }
    if (data.enabled !== undefined) { sets.push('enabled = ?'); vals.push(data.enabled ? 1 : 0); }
    if (data.note !== undefined) { sets.push('note = ?'); vals.push(data.note); }
    if (data.flow !== undefined) { sets.push('flow = ?'); vals.push(data.flow); }
    if (data.max_connections !== undefined) { sets.push('max_connections = ?'); vals.push(parseInt(data.max_connections) || 0); }
    if (data.ss_password !== undefined) { sets.push('ss_password = ?'); vals.push(data.ss_password); }

    if (data.traffic_limit !== undefined) {
      sets.push('traffic_limit = ?');
      vals.push(Math.floor((parseFloat(data.traffic_limit) || 0) * 1073741824));
    }

    if (data.expire_date !== undefined) {
      const ed = String(data.expire_date).trim();
      sets.push('expire_date = ?');
      vals.push(ed ? new Date(ed).toISOString() : '');
    }

    if (sets.length === 0) return old;

    sets.push("updated_at = datetime('now')");
    vals.push(id);

    db.prepare('UPDATE clients SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
    return this.getById(id);
  }

  static delete(id) { return db.prepare('DELETE FROM clients WHERE id = ?').run(id); }

  static toggleEnable(id) {
    db.prepare("UPDATE clients SET enabled = CASE WHEN enabled=1 THEN 0 ELSE 1 END, updated_at = datetime('now') WHERE id = ?").run(id);
    return this.getById(id);
  }

  static resetTraffic(id) {
    db.prepare("UPDATE clients SET traffic_used=0, traffic_up=0, traffic_down=0, updated_at=datetime('now') WHERE id = ?").run(id);
    return this.getById(id);
  }

  static getStats() {
    const total = db.prepare('SELECT COUNT(*) as c FROM clients').get().c;
    const active = db.prepare('SELECT COUNT(*) as c FROM clients WHERE enabled = 1').get().c;
    const expired = db.prepare("SELECT COUNT(*) as c FROM clients WHERE expire_date != '' AND expire_date < datetime('now')").get().c;
    const trafficExceeded = db.prepare('SELECT COUNT(*) as c FROM clients WHERE traffic_limit > 0 AND traffic_used >= traffic_limit').get().c;
    const totalTraffic = db.prepare('SELECT COALESCE(SUM(traffic_used), 0) as t FROM clients').get().t;
    const byProtocol = db.prepare(
      "SELECT i.protocol, COUNT(*) as count FROM clients c LEFT JOIN inbounds i ON c.inbound_id = i.id WHERE i.protocol IS NOT NULL GROUP BY i.protocol"
    ).all();
    return { total, active, expired, trafficExceeded, totalTraffic, byProtocol };
  }

  static disableExpired() {
    return db.prepare(`
      UPDATE clients SET enabled = 0
      WHERE enabled = 1 AND (
        (expire_date != '' AND expire_date < datetime('now'))
        OR (traffic_limit > 0 AND traffic_used >= traffic_limit)
      )
    `).run().changes;
  }
}

module.exports = Client;
