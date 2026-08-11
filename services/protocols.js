const { getConfig } = require('../config/database');

class ProtocolService {

  static getAddress() {
    return getConfig('server_domain') || process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost';
  }

  static generateLink(c) {
    if (!c || !c.protocol) return '';
    try {
      switch (c.protocol) {
        case 'vless': return this._vless(c);
        case 'vmess': return this._vmess(c);
        case 'trojan': return this._trojan(c);
        case 'shadowsocks': return this._ss(c);
        default: return '';
      }
    } catch (e) { return ''; }
  }

  static _vless(c) {
    const a = this.getAddress();
    const p = new URLSearchParams();
    p.set('type', c.network || 'tcp');
    p.set('encryption', 'none');

    if (c.reality_enabled) {
      p.set('security', 'reality');
      if (c.reality_public_key) p.set('pbk', c.reality_public_key);
      const sid = (c.reality_short_ids || '').split(',')[0];
      if (sid && sid.trim()) p.set('sid', sid.trim());
      const sn = (c.reality_server_names || '').split(',')[0];
      p.set('sni', c.sni || (sn ? sn.trim() : ''));
      p.set('fp', c.fingerprint || 'chrome');
      if (c.flow) p.set('flow', c.flow);
    } else if (c.tls_enabled) {
      p.set('security', 'tls');
      if (c.sni) p.set('sni', c.sni);
      p.set('fp', c.fingerprint || 'chrome');
      if (c.alpn) p.set('alpn', c.alpn);
    } else {
      p.set('security', 'none');
    }

    this._transport(p, c);
    return 'vless://' + c.uuid + '@' + a + ':' + (c.port || 443) + '?' + p.toString() + '#' + encodeURIComponent(c.name || 'vless');
  }

  static _vmess(c) {
    const a = this.getAddress();
    const j = {
      v: '2', ps: c.name || 'vmess', add: a, port: String(c.port || 443),
      id: c.uuid, aid: '0', scy: 'auto',
      net: c.network || 'tcp', type: c.tcp_header_type || 'none',
      host: c.ws_host || c.sni || '',
      path: c.ws_path || c.http_path || c.grpc_service_name || '',
      tls: c.tls_enabled ? 'tls' : '',
      sni: c.sni || '', alpn: c.alpn || '', fp: c.fingerprint || 'chrome'
    };
    return 'vmess://' + Buffer.from(JSON.stringify(j)).toString('base64');
  }

  static _trojan(c) {
    const a = this.getAddress();
    const p = new URLSearchParams();
    p.set('type', c.network || 'tcp');

    if (c.reality_enabled) {
      p.set('security', 'reality');
      if (c.reality_public_key) p.set('pbk', c.reality_public_key);
      const sid = (c.reality_short_ids || '').split(',')[0];
      if (sid && sid.trim()) p.set('sid', sid.trim());
      if (c.sni) p.set('sni', c.sni);
      p.set('fp', c.fingerprint || 'chrome');
    } else if (c.tls_enabled) {
      p.set('security', 'tls');
      if (c.sni) p.set('sni', c.sni);
      p.set('fp', c.fingerprint || 'chrome');
      if (c.alpn) p.set('alpn', c.alpn);
    } else {
      p.set('security', 'none');
    }

    this._transport(p, c);
    return 'trojan://' + c.uuid + '@' + a + ':' + (c.port || 443) + '?' + p.toString() + '#' + encodeURIComponent(c.name || 'trojan');
  }

  static _ss(c) {
    const a = this.getAddress();
    const m = c.ss_method || 'chacha20-ietf-poly1305';
    const pw = c.ss_password || c.uuid;
    // Standard base64 for SS (NOT base64url)
    const ui = Buffer.from(m + ':' + pw).toString('base64');
    return 'ss://' + ui + '@' + a + ':' + (c.port || 443) + '#' + encodeURIComponent(c.name || 'ss');
  }

  static _transport(p, c) {
    switch (c.network) {
      case 'ws':
        if (c.ws_path) p.set('path', c.ws_path);
        if (c.ws_host) p.set('host', c.ws_host);
        break;
      case 'grpc':
        if (c.grpc_service_name) p.set('serviceName', c.grpc_service_name);
        p.set('mode', 'gun');
        break;
      case 'http': case 'h2':
        if (c.http_path) p.set('path', c.http_path);
        if (c.ws_host) p.set('host', c.ws_host);
        break;
    }
  }

  static generateSubscription(clients) {
    if (!Array.isArray(clients)) return '';
    const links = clients.filter(c => c && c.enabled && c.protocol).map(c => this.generateLink(c)).filter(Boolean);
    return Buffer.from(links.join('\n')).toString('base64');
  }
}

module.exports = ProtocolService;
