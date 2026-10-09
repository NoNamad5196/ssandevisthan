import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const hash = data => createHash('sha256').update(data).digest('hex');
const manifest = JSON.parse(await readFile('design/asset-manifest.json', 'utf8'));
const original = await readFile(manifest.source.path);
assert.equal(hash(original), manifest.source.sha256, 'Original PNG integrity');
const metadata = await sharp(original).metadata();
assert.equal(metadata.width, 1586);
assert.equal(metadata.height, 992);
for (const asset of manifest.assets) {
  const data = await readFile(asset.path);
  assert.equal(hash(data), asset.sha256, `${asset.path} integrity`);
  let source = sharp(original).extract(asset.sourceRect);
  if (asset.transform === 'adjacent original texture resized for accessible UI text backdrop') {
    const dimensions = await sharp(data).metadata();
    source = source.resize(dimensions.width, dimensions.height, { fit: 'fill' });
  }
  const expected = await source.ensureAlpha().raw().toBuffer();
  const actual = await sharp(data).ensureAlpha().raw().toBuffer();
  if (asset.cutouts) {
    const { width, height } = asset.sourceRect;
    assert.equal(actual.length, expected.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const pixel = (y * width + x) * 4;
      const cleared = asset.cutouts.some(([left, top, w, h]) => x >= left && x < left + w && y >= top && y < top + h);
      if (cleared) assert.equal(actual[pixel + 3], 0, `${asset.path}: functional region alpha at ${x},${y}`);
      else for (let channel = 0; channel < 4; channel++) assert.equal(actual[pixel + channel], expected[pixel + channel], `${asset.path}: original pixel at ${x},${y}`);
    }
  } else assert.deepEqual(actual, expected, `${asset.path} must match its declared original crop/resize`);
}

// SFNT name records preserve the original font vendor's exact notices.
function sfntNames(bytes) {
  let offset;
  for (let i = 0; i < bytes.readUInt16BE(4); i++) {
    const p = 12 + i * 16;
    if (bytes.toString('ascii', p, p + 4) === 'name') offset = bytes.readUInt32BE(p + 8);
  }
  assert.notEqual(offset, undefined, 'Font name table exists');
  const strings = offset + bytes.readUInt16BE(offset + 4);
  const records = [];
  for (let i = 0; i < bytes.readUInt16BE(offset + 2); i++) {
    const p = offset + 6 + i * 12;
    const platform = bytes.readUInt16BE(p);
    if (platform !== 3) continue;
    const start = strings + bytes.readUInt16BE(p + 10);
    const text = Buffer.from(bytes.subarray(start, start + bytes.readUInt16BE(p + 8))).swap16().toString('utf16le');
    records.push({ nameId: bytes.readUInt16BE(p + 6), language: bytes.readUInt16BE(p + 4), text });
  }
  return records;
}
const gmarket = await readFile('apps/web/public/fonts/GmarketSansBold.ttf');
assert.equal(hash(gmarket), 'ff7c354dd1a324e4cecc1223c4f71e74fa81be7027e0c7f6324c475909cacefc', 'Gmarket file is the verified official unmodified TTF');
const names = sfntNames(gmarket);
const licenses = names.filter(record => record.nameId === 13);
assert(licenses.some(record => record.text.includes('SIL Open Font License')));
// Git normalizes text checkouts to LF on Linux while the vendor's embedded
// SFNT records contain CRLF. Compare all content with only line endings normalized.
const normalizeLineEndings = value => value.replaceAll('\r\n', '\n');
assert.equal(normalizeLineEndings(await readFile('design/font-license/GmarketSans-OFL.txt', 'utf8')), normalizeLineEndings(licenses.map(record => record.text).join('\n\n') + '\n'), 'Committed Gmarket notice preserves every embedded license record');
assert.deepEqual(JSON.parse(await readFile('design/font-license/GmarketSans-metadata.json', 'utf8')), {
  source: 'https://corp.gmarket.com/fonts/GmarketSansTTF.zip',
  informationPage: 'https://corp.gmarket.com/fonts/',
  checkedAt: '2026-10-09',
  sha256: hash(gmarket),
  records: names.filter(record => [0, 1, 5, 13, 14].includes(record.nameId)),
}, 'Committed Gmarket provenance matches the official font records');
for (const font of manifest.fonts) {
  assert.equal(hash(await readFile(font.path)), font.sha256, `${font.path} integrity`);
  assert((await readFile(font.license, 'utf8')).includes('SIL Open Font License'), `${font.path} includes a license notice`);
}
console.log(`Verified original PNG, ${manifest.assets.length} source-derived assets including all transparent cutouts, 2 font hashes and original license notices.`);
