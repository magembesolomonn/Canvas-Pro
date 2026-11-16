const fs = require('node:fs');
const path = require('node:path');

// Publish prebuilt release assets with a GitHub personal access token.
// Usage: GITHUB_TOKEN=... node scripts/publish-release.cjs v1.1.6 dist/release/*
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!token) {
  console.error('Set GITHUB_TOKEN (or GH_TOKEN) to a token with "repo" scope.');
  process.exit(1);
}
const tag = process.argv[2];
const files = process.argv.slice(3).filter(file => fs.existsSync(file) && fs.statSync(file).isFile());
if (!tag || !files.length) {
  console.error('Usage: GITHUB_TOKEN=... node scripts/publish-release.cjs <tag> <asset>...');
  process.exit(1);
}
const repo = 'magembesolomonn/Canvas-Pro';
const api = 'https://api.github.com/repos/' + repo;
const headers = {
  Authorization: 'Bearer ' + token,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'Canvas-Pro-release'
};

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!response.ok) throw new Error((response.status || '') + ' ' + (body?.message || String(body).slice(0, 200)));
  return body;
}

(async () => {
  let release;
  try {
    release = await request(api + '/releases/tags/' + encodeURIComponent(tag));
    console.log('Using existing release ' + tag);
  } catch (error) {
    if (!String(error.message).startsWith('404')) throw error;
    release = await request(api + '/releases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        name: tag,
        body: 'Security, accessibility and performance fixes from the 2026-11-16 audit.\n\n- Pinned and verified yt-dlp/ffmpeg downloads\n- Optional signed release checksums (no Apple ID required)\n- Fixed DNS/SSRF guards and capture fetches\n- Accessibility fixes in gallery, menus, popup and theme preferences\n- Cached/batched database work and scoped browser reinjection\n',
        draft: false,
        prerelease: false
      })
    });
    console.log('Created release ' + tag);
  }
  const existing = new Set((release.assets || []).map(asset => asset.name));
  for (const file of files) {
    const name = path.basename(file);
    if (existing.has(name)) { console.log('Skipping existing asset ' + name); continue; }
    const asset = await request('https://uploads.github.com/repos/' + repo + '/releases/' + release.id + '/assets?name=' + encodeURIComponent(name), {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: fs.readFileSync(file)
    });
    console.log('Uploaded ' + name + ' (' + asset.size + ' bytes)');
  }
  console.log('Release: ' + release.html_url);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
