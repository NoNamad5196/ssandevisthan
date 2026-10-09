import { readFile, writeFile } from 'node:fs/promises';
const file = (await readFile('.secrets/openai.env', 'utf8')).replace(/^\uFEFF/, '');
const key = file.match(/^OPENAI_API_KEY=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
if (!key) throw new Error('OPENAI_API_KEY_REQUIRED');
const endpoint = 'https://api.openai.com/v1/models/gpt-6.1-sol';
const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
let data; try { data = await response.json(); } catch { data = {}; }
const report = {
  checkedAt: new Date().toISOString(),
  method: 'GET', endpoint, httpStatus: response.status,
  accessibleModel: response.ok && data.id === 'gpt-6.1-sol' ? data.id : null,
  paidInferencePerformed: false,
  limitations: ['Model access only; vision, structured output and web search are not verified by this read-only request.'],
};
await writeFile('docs/deployment/openai-model-access.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.accessibleModel) process.exitCode = 1;
