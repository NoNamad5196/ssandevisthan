import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';

const referencePath = 'design/reference/original.png';
const capturePath = process.argv[2] ?? 'test-results/visual/home-1586x992.png';
const reference = await sharp(referencePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const actual = await sharp(capturePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
if (reference.info.width !== actual.info.width || reference.info.height !== actual.info.height) throw new Error('Visual comparison requires the original 1586×992 dimensions');
const { width, height, channels } = reference.info;
const regions = {
  full: [0, 0, width, height], header: [0, 0, 1586, 55], logo: [40, 85, 776, 205],
  collage: [816, 55, 770, 766], upload: [60, 404, 700, 310], headline: [55, 288, 730, 97], deals: [0, 821, 1586, 171],
};
const metrics = {};
for (const [name, [left, top, regionWidth, regionHeight]] of Object.entries(regions)) {
  let absoluteError = 0, changed = 0;
  for (let y = top; y < top + regionHeight; y++) for (let x = left; x < left + regionWidth; x++) {
    let pixelMax = 0;
    for (let c = 0; c < channels; c++) {
      const p = (y * width + x) * channels + c;
      const error = Math.abs(reference.data[p] - actual.data[p]);
      absoluteError += error; pixelMax = Math.max(pixelMax, error);
    }
    if (pixelMax > 24) changed++;
  }
  const pixels = regionWidth * regionHeight;
  metrics[name] = { meanAbsoluteChannelDifference: Number((absoluteError / (pixels * channels)).toFixed(3)), pixelsOver24DifferencePercent: Number((changed * 100 / pixels).toFixed(3)) };
}
const overlay = Buffer.alloc(reference.data.length), difference = Buffer.alloc(reference.data.length);
for (let i = 0; i < overlay.length; i++) { overlay[i] = Math.round((reference.data[i] + actual.data[i]) / 2); difference[i] = Math.min(255, Math.abs(reference.data[i] - actual.data[i]) * 3); }
await sharp(overlay, { raw: { width, height, channels } }).png().toFile('test-results/visual/overlay.png');
await sharp(difference, { raw: { width, height, channels } }).png().toFile('test-results/visual/difference-amplified.png');
const report = { reference: referencePath, capture: capturePath, viewport: { width, height }, masks: [], note: 'Difference metrics are diagnostic, not a release acceptance threshold. No regions are masked. Visual reviewer approval is still required.', metrics };
await writeFile('test-results/visual/metrics.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
