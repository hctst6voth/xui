const { db } = require('../config/database');

class Inbound {

  static create(data) {
    const port = parseInt(data.port);
    if (!port || port < 1 || port > 65535) throw new Error('پورت نامعتبر');

    const dup = db.prepare('SELECT id FROM inbounds WHERE port = ?').get(port);
    if (dup) throw new Error('پورت ' + port + ' قبلاً استفاده شده');

    const protocol = data.protocol || 'vless';
    const tag = data.tag || protocol + '-' + port + '-' + Date.now();

    const realityEnabled = data.reality_enabled ? 1 : 0;
    const tlsEnabled = (!realityEnabled && data.tls_enabled) ? 1 : 0;
    let security = 'none';
    if (realityEnabled) security = 'reality';
    else if (tlsEnabled) security = 'tls';

    const stmt = db.prepare(`
      INSERT INTO inbounds (
        tag, remark, protocol, listen, port, enabled,
        network, security, tls_enabled, sni, fingerprint, alpn,
        reality_enabled, reality_dest, reality_server_names,
        reality_private_key, reality_public_key, reality_short_ids,
        ws_path, ws_host, grpc_service_name, http_path,
        tcp_header_type, ss_method, ss_network, sniffing_enabled
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `);

    const info = stmt.run(
      tag,
      data.remark || tag,
      protocol,
      data.listen || '0.0.0.0',
      port,
      1,
      data.network || 'tcp',
      security,
      tlsEnabled,
      data.sni || '',
      data.fingerprint || 'chrome',
      data.alpn || 'h2,http/1.1',
      realityEnabled,
      data.reality_dest || '',
      data.reality_server_names || '',
      data.reality_private_key || '',
      data.reality_public_key || '',
      data.reality_short_ids || '',
      data.ws_path || '/',
      data.ws_host || '',
      data.grpc_service_name || '',
      data.http_path || '/',
      data.tcp_header_type || 'none',
      data.ss_method || 'chacha20-ietf-poly1305',
      data.ss_network || 'tcp,udp',
      1
    );

    return this.getById(info.lastInsertRowid);
  }

  static getAll() {
    const rows = db.prepare('SELECT * FROM inbounds ORDER BY created_at DESC').all();
    return rows.map(r => {
      const cc = db.prepare('SELECT COUNT(*) as c FROM clients WHERE inbound_id = ?').get(r.id);
      const ac = db.prepare('SELECT COUNT(*) as c FROM clients WHERE inbound_id = ? AND enabled = 1').get(r.id);
      return { ...r, client_count: cc.c, active_client_count: ac.c };
    });
  }

  static getById(id) {
    return db.prepare('SELECT * FROM inbounds WHERE id = ?').get(id);
  }

  static update(id, data) {
    const old = this.getById(id);
    if (!old) return null;

    const fields = [];
    const vals = [];

    const allow = [
      'remark', 'protocol', 'listen', 'port', 'enabled', 'network',
      'tls_enabled', 'sni', 'fingerprint', 'alpn',
      'reality_enabled', 'reality_dest', 'reality_server_names',
      'reality_private_key', 'reality_public_key', 'reality_short_ids',
      'ws_path', 'ws_host', 'grpc_service_name', 'http_path',
      'tcp_header_type', 'ss_method', 'ss_network', 'sniffing_enabled'
    ];

    for (const f of allow) {
      if (data[f] !== undefined) {
        fields.push(f + ' = ?');
        vals.push(data[f]);
      }
    }

    if (fields.length === 0) return old;

    // Recalculate security
    const re = data.reality_enabled !== undefined ? (data.reality_enabled ? 1 : 0) : old.reality_enabled;
    const te = data.tls_enabled !== undefined ? (data.tls_enabled ? 1 : 0) : old.tls_enabled;
    let sec = 'none';
    if (re) sec = 'reality';
    else if (te) sec = 'tls';
    fields.push('security = ?');
    vals.push(sec);

    fields.push("updated_at = datetime('now')");
    vals.push(id);

    db.prepare('UPDATE inbounds SET ' + fields.join(', ') + ' WHERE id = ?').run(...vals);
    return this.getById(id);
  }

  static delete(id) {
    return db.prepare('DELETE FROM inbounds WHERE id = ?').run(id);
  }

  static toggleEnable(id) {
    db.prepare("UPDATE inbounds SET enabled = CASE WHEN enabled=1 THEN 0 ELSE 1 END, updated_at = datetime('now') WHERE id = ?").run(id);
    return this.getById(id);
  }

  static getClientsByInbound(id) {
    return db.prepare('SELECT * FROM clients WHERE inbound_id = ? ORDER BY created_at DESC').all(id);
  }
}

module.exports = Inbound;
