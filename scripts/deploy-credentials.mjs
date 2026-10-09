// One-time local form for transferring user-authorized deployment credentials
// from the provider's visible UI into an ignored file, without terminal output.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const target = resolve('.secrets/neon.json');
const nonce = randomBytes(24).toString('hex');
const allowed = ['NEON_API_KEY', 'DATABASE_URL', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
let origin;
const server = http.createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.url !== `/${nonce}` || request.headers.host !== new URL(origin).host) { response.writeHead(404).end(); return; }
  if (request.method === 'GET') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<title>SSANDEVISTHAN local deployment secrets</title><h1>SSANDEVISTHAN deployment credentials</h1><p>Stores only in the ignored .secrets/neon.json file on this computer. No value is printed.</p><form method="post"><label>Credential name<select name="name">${allowed.map(name => `<option>${name}</option>`).join('')}</select></label><label>Credential value<input name="value" type="password" autocomplete="off" required></label><button>Save local secret</button></form>`);
    return;
  }
  if (request.method !== 'POST' || request.headers.origin !== origin || !request.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) {
    response.writeHead(403).end(); return;
  }
  let raw = '';
  for await (const chunk of request) { raw += chunk; if (raw.length > 32768) { response.writeHead(413).end(); return; } }
  const fields = new URLSearchParams(raw);
  const name = fields.get('name');
  const value = fields.get('value');
  if (!allowed.includes(name) || !value || value.includes('\n') || value.length > 16000) { response.writeHead(400).end(); return; }
  try {
    await mkdir(resolve('.secrets'), { recursive: true });
    let current = {};
    try { current = JSON.parse(await readFile(target, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    current[name] = value;
    await writeFile(target, JSON.stringify(current, null, 2) + '\n', { mode: 0o600 });
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<title>Local secret saved</title><h1>${escape(name)} saved</h1><p>The value was not displayed or logged. This one-time intake is now closed.</p>`);
    console.log(`Saved ${name} locally; value omitted.`);
    server.close();
    response.once('finish', () => server.closeAllConnections());
  } catch { response.writeHead(500).end('Unable to save credential.'); }
});
server.listen(0, '127.0.0.1', () => { origin = `http://127.0.0.1:${server.address().port}`; console.log(`Local credential intake: ${origin}/${nonce}`); });
setTimeout(() => server.close(), 30 * 60 * 1000).unref();
