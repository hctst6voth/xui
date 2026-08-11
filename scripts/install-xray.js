const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const XRAY_DIR = path.join(__dirname, '..', 'xray');
const XRAY_BIN = path.join(XRAY_DIR, 'xray');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const go = (u, redirects) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      const mod = u.startsWith('https') ? https : require('http');
      mod.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return go(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
        const ws = fs.createWriteStream(dest);
        res.pipe(ws);
        ws.on('finish', () => ws.close(resolve));
        ws.on('error', reject);
      }).on('error', reject);
    };
    go(url, 0);
  });
}

async function main() {
  console.log('[Xray] Checking...');

  if (fs.existsSync(XRAY_BIN)) {
    console.log('[Xray] Already installed ✅');
    return;
  }

  if (process.platform !== 'linux') {
    console.log('[Xray] Not Linux — skipping');
    return;
  }

  fs.mkdirSync(XRAY_DIR, { recursive: true });

  const arch = process.arch === 'x64' ? '64' : 'arm64-v8a';
  const url = `https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-${arch}.zip`;
  const zip = path.join(XRAY_DIR, 'xray.zip');

  console.log('[Xray] Downloading...');

  let downloaded = false;

  // Method 1: wget
  if (!downloaded) {
    try {
      execSync(`which wget && wget -q --timeout=60 -O "${zip}" "${url}"`, { timeout: 90000, stdio: 'pipe' });
      downloaded = true;
      console.log('[Xray] Downloaded via wget');
    } catch (e) { /* try next */ }
  }

  // Method 2: curl
  if (!downloaded) {
    try {
      execSync(`which curl && curl -sL --connect-timeout 30 --max-time 60 -o "${zip}" "${url}"`, { timeout: 90000, stdio: 'pipe' });
      downloaded = true;
      console.log('[Xray] Downloaded via curl');
    } catch (e) { /* try next */ }
  }

  // Method 3: Node.js
  if (!downloaded) {
    try {
      await download(url, zip);
      downloaded = true;
      console.log('[Xray] Downloaded via Node.js');
    } catch (e) {
      console.log('[Xray] Download failed:', e.message);
      return;
    }
  }

  if (!fs.existsSync(zip)) {
    console.log('[Xray] Zip file missing');
    return;
  }

  // Extract
  try {
    execSync(`cd "${XRAY_DIR}" && unzip -o "${zip}" 2>/dev/null; true`, { timeout: 30000, stdio: 'pipe' });
  } catch (e) {
    console.log('[Xray] Unzip error (might be ok):', e.message);
  }

  // Cleanup zip
  try { fs.unlinkSync(zip); } catch (e) { /* ok */ }

  // Make executable
  if (fs.existsSync(XRAY_BIN)) {
    try { fs.chmodSync(XRAY_BIN, 0o755); } catch (e) { /* ok */ }
    console.log('[Xray] Installed ✅');
  } else {
    console.log('[Xray] Binary not found after extract');
  }
}

main().catch(e => console.log('[Xray] Error:', e.message));
