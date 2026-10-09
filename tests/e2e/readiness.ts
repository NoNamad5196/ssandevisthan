import type { Page } from '@playwright/test';

/** CSS background images are absent from document.images, but are essential artwork. */
export async function waitForArtwork(page: Page) {
  await page.evaluate(async () => {
    const backgrounds = new Set<string>();
    for (const element of document.querySelectorAll('*')) {
      for (const pseudo of [null, '::before', '::after']) {
        const value = getComputedStyle(element, pseudo).backgroundImage;
        for (const match of value.matchAll(/url\(["']?([^"')]+)["']?\)/g)) backgrounds.add(match[1]);
      }
    }
    await Promise.all([
      document.fonts.load('700 24px "Gmarket Sans"'),
      document.fonts.load('500 16px Pretendard'),
      ...Array.from(document.images, image => image.decode()),
      ...Array.from(backgrounds, async url => {
        const image = new Image();
        image.src = url;
        await image.decode();
      }),
    ]);
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}
