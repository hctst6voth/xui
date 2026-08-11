const crypto = require('crypto');

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return '0 B';
  bytes = Math.abs(Number(bytes));
  if (bytes === 0) return '0 B';
  const k = 1024;
  const s = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const idx = Math.min(i, s.length - 1);
  return parseFloat((bytes / Math.pow(k, idx)).toFixed(2)) + ' ' + s[idx];
}

function generateRealityKeys() {
  return {
    privateKey: crypto.randomBytes(32).toString('base64url').substring(0, 43),
    publicKey: crypto.randomBytes(32).toString('base64url').substring(0, 43),
    shortId: crypto.randomBytes(4).toString('hex')
  };
}

function generateSSPassword() {
  return crypto.randomBytes(16).toString('base64');
}

module.exports = { formatBytes, generateRealityKeys, generateSSPassword };
