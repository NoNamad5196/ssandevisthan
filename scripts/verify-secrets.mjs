import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

// Print only affected paths and detector names, never matching secret values.
const root = process.cwd();
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const files = new Set(tracked);
async function includeTree(path) {
  let entries;
  try { entries = await readdir(path, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await includeTree(child);
    else if (entry.isFile()) files.add(relative(root, child));
  }
}
await includeTree(join(root, 'apps/web/dist'));
const known = new Set();
for (const name of ['neon.json', 'backend.env.json', 'cloudflare.json']) {
  try {
    const values = JSON.parse((await readFile(join(root, '.secrets', name), 'utf8')).replace(/^\uFEFF/, ''));
    for (const [key, value] of Object.entries(values)) {
      if (/(?:SECRET|TOKEN|API.?KEY|DATABASE.?URL|ACCESS.?KEY.?ID)/i.test(key) && typeof value === 'string' && value.length >= 16) known.add(value);
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
try {
  const env = await readFile(join(root, '.secrets/openai.env'), 'utf8');
  const value = env.match(/^OPENAI_API_KEY=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
  if (value?.length >= 16) known.add(value);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const patterns = [
  ['OpenAI credential', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,}\b/],
  ['GitHub credential', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['database password URL', /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]{12,}@/],
];
let scanned = 0;
const failures = [];
for (const path of files) {
  if (/(^|[\\/])(?:\.secrets|\.env(?:\.|$))/.test(path) && !path.endsWith('.example')) failures.push({ path, detector: 'secret file tracked' });
  let bytes;
  try { bytes = await readFile(join(root, path)); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  if (bytes.includes(0)) continue;
  const text = bytes.toString('utf8');
  scanned++;
  for (const [detector, expression] of patterns) if (expression.test(text)) failures.push({ path, detector });
  if ([...known].some(value => text.includes(value))) failures.push({ path, detector: 'configured server credential' });
}
if (failures.length) {
  for (const failure of failures) console.error(`${failure.path}: ${failure.detector}`);
  process.exitCode = 1;
} else console.log(`Credential scan passed: ${scanned} tracked/build text files; ${known.size} local server credentials checked without printing values.`);
