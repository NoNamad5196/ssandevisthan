#!/usr/bin/env node
// Offline only. Uses the repository's existing esbuild; installs nothing and
// deliberately has no credential loading or provider/merchant client imports.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, resolve, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(repo, '.cache');
const args = process.argv.slice(2), options = {};
const help = `Offline SSANDEVISTHAN quality evaluation (no external calls)
  node scripts/evaluate-quality.mjs --manifest manifest.json --runs attempts.json [--output report.json]
  node scripts/evaluate-quality.mjs --schema manifest|runs
  node scripts/evaluate-quality.mjs --seal manifest.json
  node scripts/evaluate-quality.mjs
No arguments => NOT_MEASURED, release BLOCKED. --seal prints a content digest;
retain it independently BEFORE holdout exposure, not as retroactive approval.
Exit 0: schema/seal/help or ready for human review; 1: release blockers; 2: invalid input.`;

let temporaryDirectory;
try {
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--help') { process.stdout.write(`${help}\n`); process.exit(0); }
    if (!['--manifest', '--runs', '--output', '--schema', '--seal'].includes(flag) || options[flag] !== undefined || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Invalid arguments. Use --help.');
    options[flag] = args[++index];
  }
  if ((options['--schema'] || options['--seal']) && Object.keys(options).length !== 1) throw new Error('Schema/seal modes cannot be combined with evaluation arguments.');
  if (!!options['--manifest'] !== !!options['--runs']) throw new Error('Both --manifest and --runs are required.');
  await mkdir(cache, { recursive: true });
  temporaryDirectory = await mkdtemp(join(cache, 'quality-harness-'));
  const compiled = await build({ entryPoints: [join(repo, 'packages/quality/src/index.ts')], bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false, logLevel: 'silent' });
  const modulePath = join(temporaryDirectory, 'harness.mjs');
  await writeFile(modulePath, compiled.outputFiles[0].contents);
  const harness = await import(pathToFileURL(modulePath).href);
  const input = async path => {
    const bytes = await readFile(resolve(path));
    if (bytes.length > 32_000_000) throw new Error('Input exceeds offline 32 MB limit.');
    return JSON.parse(bytes.toString('utf8'));
  };
  let report;
  if (options['--schema']) {
    if (!['manifest', 'runs'].includes(options['--schema'])) throw new Error('Schema must be manifest or runs.');
    report = z.toJSONSchema(options['--schema'] === 'manifest' ? harness.ManifestSchema : harness.RunBundleSchema);
  } else if (options['--seal']) {
    const parsed = harness.ManifestSchema.safeParse(await input(options['--seal']));
    if (!parsed.success) throw new Error('Manifest schema invalid; evaluate it to obtain field diagnostics.');
    report = { holdoutSha256: harness.holdoutDigest(parsed.data), establishesHistoricalSealOrHumanReview: false };
  } else {
    report = options['--manifest'] ? harness.evaluateQuality(await input(options['--manifest']), await input(options['--runs'])) : harness.noDataReport();
    process.exitCode = report.status === 'INVALID_INPUT' ? 2 : report.release.status === 'BLOCKED' ? 1 : 0;
  }
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (options['--output']) {
    const destination = resolve(options['--output']);
    if ([options['--manifest'], options['--runs']].filter(Boolean).some(path => resolve(path).toLowerCase() === destination.toLowerCase())) throw new Error('Output must not overwrite evaluation input.');
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, serialized, { flag: 'wx' });
    process.stdout.write(`Quality report saved; status=${report.status}; release=${report.release.status}.\n`);
  } else process.stdout.write(serialized);
} catch (error) {
  // Do not print input contents or a JSON parser excerpt containing private data.
  process.stderr.write(`${error instanceof SyntaxError ? 'Invalid JSON input.' : error instanceof Error && /^(Invalid arguments|Both --|Schema|Output must|Input exceeds|Manifest schema)/.test(error.message) ? error.message : 'Quality evaluation failed; check input paths, schema, and a new output path.'}\n`);
  process.exitCode = 2;
} finally {
  if (temporaryDirectory) {
    const resolved = resolve(temporaryDirectory);
    if (!resolved.startsWith(`${resolve(cache)}${sep}quality-harness-`)) throw new Error('Unexpected temporary directory.');
    await rm(resolved, { recursive: true, force: true });
  }
}
