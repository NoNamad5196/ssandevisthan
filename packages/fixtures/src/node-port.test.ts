import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { createHash } from 'node:crypto';

// SYNTHETIC ONLY: real local codecs and SQL construction, without DB, S3, AI or network calls.
const port = '../../../apps/api/src/';
const { sqlFilter } = await import(`${port}database.ts`);
const { normalizeImage, validateImage, NORMALIZER_VERSION } = await import(`${port}images.ts`);
const query = (entries: Record<string, string>) => new URLSearchParams(entries).toString();

describe('Neon SQL adapter — SYNTHETIC, no database connection', () => {
  it('binds attacker-controlled values instead of interpolating SQL', () => {
    const value = "x' OR 1=1; DROP TABLE search_runs; --";
    const f = sqlFilter(query({ owner_id: `eq.${value}`, status: 'in.(QUEUED,RUNNING)', input_deleted_at: 'is.null', order: 'created_at.desc,id.desc', limit: '10' }));
    expect(f.where).toBe(' WHERE "owner_id"=$1 AND "status" IN ($2,$3) AND "input_deleted_at" IS NULL');
    expect(f.tail).toBe(' ORDER BY "created_at" desc,"id" desc LIMIT 10');
    expect(f.values).toEqual([value, 'QUEUED', 'RUNNING']);
    expect(f.where + f.tail).not.toContain(value);
  });
  it('continues parameter numbering after update values and preserves null predicates', () => {
    const f = sqlFilter(query({ id: 'eq.synthetic-id', finished_at: 'not.is.null', attempts: 'lt.3' }), ['CANCELLED', null]);
    expect(f.where).toBe(' WHERE "id"=$3 AND "finished_at" IS NOT NULL AND "attempts"<$4');
    expect(f.values).toEqual(['CANCELLED', null, 'synthetic-id', '3']);
    expect(f.tail).toBe('');
  });
  it('binds all keyset pagination values without interpolating timestamps', () => {
    const at = '2026-10-09T01:02:03.000Z', id = '00000000-0000-4000-8000-000000000001';
    const f = sqlFilter(query({ or: `(created_at.lt.${at},and(created_at.eq.${at},id.lt.${id}))`, order: 'created_at.desc,id.desc', limit: '100' }));
    expect(f.where).toBe(' WHERE (created_at<$1 OR (created_at=$2 AND id<$3))');
    expect(f.values).toEqual([at, at, id]);
    expect(f.tail).toBe(' ORDER BY "created_at" desc,"id" desc LIMIT 100');
  });
  it.each([
    { 'id;DELETE FROM search_runs': 'eq.x' }, { id: 'like.%' },
    { order: 'id.desc;DROP TABLE search_runs' }, { order: 'id;DROP.asc' },
    { limit: '101' }, { limit: '-1' }, { limit: '1;DROP' },
    { or: '(id.eq.1,id.eq.2)' },
  ] as Record<string, string>[])('rejects unsupported query syntax %j before execution', (entries) => {
    expect(() => sqlFilter(query(entries))).toThrow('INVALID_INPUT');
  });
});

afterEach(() => vi.unstubAllEnvs());
const pixels = (width: number, height: number, alpha = 1) => sharp({ create: { width, height, channels: 4, background: { r: 24, g: 70, b: 160, alpha } } });

describe('Sharp normalization — SYNTHETIC pixels, actual local decode', () => {
  it.each(['jpeg', 'png', 'webp'] as const)('decodes %s and produces a bounded WebP with matching hash', async (format) => {
    vi.stubEnv('NORMALIZER_VERIFIED', 'true');
    const input = await pixels(120, 80)[format]().toBuffer();
    await expect(validateImage(input)).resolves.toBeUndefined();
    const output = await normalizeImage(input, `image/${format}`);
    const metadata = await sharp(output.bytes).metadata();
    expect(metadata.format).toBe('webp');
    expect([metadata.width, metadata.height]).toEqual([120, 80]);
    expect([output.width, output.height]).toEqual([120, 80]);
    expect(output.sha256).toBe(createHash('sha256').update(output.bytes).digest('hex'));
    expect(output.version).toBe(NORMALIZER_VERSION);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    await expect(validateImage(output.bytes)).resolves.toBeUndefined();
  });
  it('applies EXIF orientation before removing camera metadata', async () => {
    vi.stubEnv('NORMALIZER_VERIFIED', 'true');
    const input = await pixels(80, 40).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    expect((await sharp(input).metadata()).orientation).toBe(6);
    const output = await normalizeImage(input, 'image/jpeg');
    const metadata = await sharp(output.bytes).metadata();
    expect([output.width, output.height]).toEqual([40, 80]);
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
  });
  it('limits longest side to 1600 without changing aspect ratio or enlarging small images', async () => {
    vi.stubEnv('NORMALIZER_VERIFIED', 'true');
    const large = await normalizeImage(await pixels(2200, 1100).png().toBuffer(), 'image/png');
    const small = await normalizeImage(await pixels(13, 7).png().toBuffer(), 'image/png');
    expect([large.width, large.height]).toEqual([1600, 800]);
    expect([small.width, small.height]).toEqual([13, 7]);
  });
  it('preserves transparency instead of inventing an opaque background', async () => {
    vi.stubEnv('NORMALIZER_VERIFIED', 'true');
    const output = await normalizeImage(await pixels(20, 10, 0).png().toBuffer(), 'image/png');
    const decoded = await sharp(output.bytes).raw().toBuffer({ resolveWithObject: true });
    expect(decoded.info.channels).toBe(4);
    expect(decoded.data[3]).toBe(0);
  });
  it('fails closed when normalization verification is not configured or declared MIME disagrees', async () => {
    const input = await pixels(10, 10).png().toBuffer();
    vi.stubEnv('NORMALIZER_VERIFIED', 'false');
    await expect(normalizeImage(input, 'image/png')).rejects.toThrow('TEMPORARILY_UNAVAILABLE');
    vi.stubEnv('NORMALIZER_VERIFIED', 'true');
    await expect(normalizeImage(input, 'image/jpeg')).rejects.toThrow('INVALID_IMAGE');
  });
  it('rejects payload corruption even when image geometry is readable', async () => {
    vi.stubEnv('NORMALIZER_VERIFIED', 'true');
    const input = await pixels(120, 80).png().toBuffer();
    const corrupted = Buffer.from(input);
    const payload = corrupted.indexOf(Buffer.from('IDAT')) + 4;
    expect(payload).toBeGreaterThan(4);
    corrupted.fill(0, payload, payload + 8);
    await expect(validateImage(corrupted)).rejects.toThrow();
    await expect(normalizeImage(corrupted, 'image/png')).rejects.toThrow('INVALID_IMAGE');
  });
});
