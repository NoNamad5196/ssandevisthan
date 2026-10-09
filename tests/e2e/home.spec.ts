import { test, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { waitForArtwork } from './readiness';

const captures = resolve('test-results/visual');
const viewports = [
  { width: 1586, height: 992 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
  { width: 360, height: 800 },
];

for (const viewport of viewports) {
  test(`home renders functional controls without overflow at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    const missingAssets: string[] = [];
    page.on('response', response => {
      if (/\/(artwork|fonts)\//.test(response.url()) && !response.ok()) missingAssets.push(response.url());
    });
    await page.goto('/');
    await waitForArtwork(page);
    await expect(page.getByRole('button', { name: '사진 올리기', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '찾고 싶은 옷 사진을 올려주세요' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: '핫딜 상품 검색' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    expect(await page.evaluate(() => document.fonts.check('700 24px "Gmarket Sans"') && document.fonts.check('500 16px Pretendard'))).toBe(true);
    expect(pageErrors).toEqual([]);
    expect(missingAssets).toEqual([]);
    if (viewport.width === 1586) {
      const positions = await page.evaluate(() => Object.fromEntries(['.hero-logo', '.hero-collage', '.upload-wrap', '.deals'].map(selector => {
        const { x, y, width, height } = document.querySelector(selector)!.getBoundingClientRect();
        return [selector, { x, y, width, height }];
      })));
      expect(positions['.hero-logo']).toEqual({ x: 40, y: 85, width: 776, height: 205 });
      if (positions['.hero-collage'].width) expect(positions['.hero-collage']).toEqual({ x: 760, y: 55, width: 826, height: 766 });
      else expect(await page.locator('.hero').evaluate(hero => getComputedStyle(hero).backgroundImage)).toContain('hero-surface.png');
      expect(positions['.upload-wrap']).toEqual({ x: 60, y: 404, width: 700, height: 310 });
      expect(positions['.deals']).toEqual({ x: 0, y: 821, width: 1586, height: 171 });
    }
    await mkdir(captures, { recursive: true });
    await page.screenshot({ path: resolve(captures, `home-${viewport.width}x${viewport.height}.png`), fullPage: true, animations: 'disabled' });
  });
}

test('upload validation and replacement work without invoking a provider', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const input = page.locator('#clothes-photo');
  await input.setInputFiles({ name: 'not-clothing.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
  await expect(page.locator('#upload-error')).toContainText('JPG, PNG, WEBP');
  await input.setInputFiles({ name: 'corrupt.png', mimeType: 'image/png', buffer: Buffer.from('not a decoded PNG') });
  await expect(page.locator('#upload-error')).toContainText('사진을 읽을 수 없어요');
  await input.setInputFiles({ name: 'oversized.png', mimeType: 'image/png', buffer: Buffer.alloc(10_000_001) });
  await expect(page.locator('#upload-error')).toContainText('최대 10MB');
  // An original mockup crop is a deterministic UI input, not a LIVE search fixture.
  await input.setInputFiles(resolve('apps/web/public/artwork/hero-collage.png'));
  await expect(page.getByRole('img', { name: '선택한 의류 사진 미리보기' })).toBeVisible();
  await expect(page.getByRole('button', { name: '비슷한 옷 찾기', exact: true })).toBeVisible();
  await expect(page.getByText('검색할 때 사진을 OpenAI에 전달해요.')).toBeVisible();
  await page.getByRole('button', { name: '사진 처리 안내', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('외부 제공자의 기록 삭제를 의미하지 않습니다');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: '사진 처리 안내', exact: true })).toBeFocused();
  await page.screenshot({ path: resolve(captures, 'upload-selected-390x844.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.getByRole('button', { name: '사진 올리기', exact: true })).toBeVisible();
});

test('hot-deal validation, keyboard focus, and reduced motion are usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const search = page.getByRole('textbox', { name: '핫딜 상품 검색' });
  await search.fill('옷');
  await page.getByRole('button', { name: '검색하기', exact: true }).click();
  await expect(page.locator('.deal-error')).toContainText('두 글자 이상');
  const category = page.getByRole('button', { name: '생활용품', exact: true });
  await category.click();
  await expect(category).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '의류', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await search.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '검색하기', exact: true })).toBeFocused();
  expect(await page.getByRole('button', { name: '사진 올리기', exact: true }).evaluate(button => getComputedStyle(button).transitionDuration)).toBe('0s');
});

test('a late image decode cannot replace the most recently selected photo', async ({ page }) => {
  await page.addInitScript(() => {
    const native = window.createImageBitmap.bind(window);
    window.createImageBitmap = async (...args: any[]) => {
      const bitmap = await (native as any)(...args);
      if (args[0] instanceof File && args[0].name === 'slow.png') {
        await new Promise<void>(resolve => { (window as any).releaseOldPhoto = resolve; });
      }
      return bitmap;
    };
  });
  await page.goto('/');
  const buffer = await readFile(resolve('apps/web/public/artwork/hero-collage.png'));
  await page.locator('#clothes-photo').setInputFiles({ name: 'slow.png', mimeType: 'image/png', buffer });
  await page.waitForFunction(() => typeof (window as any).releaseOldPhoto === 'function');
  await page.locator('#clothes-photo').setInputFiles({ name: 'current.png', mimeType: 'image/png', buffer });
  const preview = page.getByRole('img', { name: '선택한 의류 사진 미리보기' });
  await expect(preview).toBeVisible();
  const currentUrl = await preview.getAttribute('src');
  await page.evaluate(async () => { (window as any).releaseOldPhoto(); await new Promise(resolve => setTimeout(resolve, 100)); });
  await expect(preview).toHaveAttribute('src', currentUrl!);
});
