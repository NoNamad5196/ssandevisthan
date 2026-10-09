import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { waitForArtwork } from './readiness';

// Opt-in real infrastructure smoke only. This cannot demonstrate LIVE product
// search: its safety precondition requires provider execution to remain disabled.
test.use({ trace: 'off', screenshot: 'off', video: 'off' }); // Never persist auth responses/tokens in traces.
test.describe('PUBLIC HTTPS infrastructure smoke @cloud', () => {
  test.skip(process.env.E2E_LIVE_SMOKE !== 'paid-disabled', 'Explicit opt-in required for real cloud writes');
  test('public frontend authenticates, normalizes/uploads, and displays disabled-search failure honestly', async ({ page, request }) => {
    test.setTimeout(100_000);
    expect(process.env.E2E_BASE_URL).toBe('https://ssandevisthan.pages.dev');
    const apiOrigin = 'https://br-polished-resonance-az03nnva-api.compute.c-3.ap-southeast-1.aws.neon.tech';
    const apiBase = `${apiOrigin}/functions/v1/api/v3`;
    const health = await request.get(`${apiOrigin}/health`);
    expect(health.status()).toBe(200);
    expect(await health.json()).toMatchObject({ service: 'SSANDEVISTHAN', backend: 'neon', searchEnabled: false });
    const calls: { path: string; method: string; status: number }[] = [];
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('response', response => {
      if (response.url().startsWith(apiBase) && response.request().method() !== 'OPTIONS') calls.push({ path: new URL(response.url()).pathname.replace('/functions/v1/api/v3', ''), method: response.request().method(), status: response.status() });
    });
    await page.setViewportSize({ width: 1586, height: 992 });
    const home = await page.goto('/');
    expect(home?.status()).toBe(200);
    expect(home?.headers()['content-security-policy']).toContain(`connect-src 'self' ${apiOrigin}`);
    await waitForArtwork(page);
    await mkdir('.cache/deployment/production', { recursive: true });
    await page.screenshot({ path: '.cache/deployment/production/home-1586x992.png', fullPage: true, animations: 'disabled' });
    await page.locator('#clothes-photo').setInputFiles(resolve('apps/web/public/artwork/hero-collage.png'));
    await page.getByRole('button', { name: '비슷한 옷 찾기', exact: true }).click();
    await expect(page.locator('#upload-error')).toContainText('서비스 연결을 준비하고 있어요.', { timeout: 60_000 });
    expect(calls.filter(call => call.path === '/auth/anonymous')).toEqual([{ path: '/auth/anonymous', method: 'POST', status: 200 }]);
    expect(calls.find(call => call.path === '/uploads')).toMatchObject({ method: 'POST', status: 201 });
    expect(calls.find(call => call.path.endsWith('/content'))).toMatchObject({ method: 'PUT', status: 200 });
    expect(calls.find(call => call.path.endsWith('/finalize'))).toMatchObject({ method: 'POST', status: 200 });
    expect(calls.find(call => call.path === '/searches')).toMatchObject({ method: 'POST', status: 503 });
    await expect(page.locator('.purchase')).toHaveCount(0);
    await page.screenshot({ path: '.cache/deployment/production/disabled-search-upload.png', fullPage: true, animations: 'disabled' });
    const deleted = page.waitForResponse(response => response.url().startsWith(`${apiBase}/uploads/`) && response.request().method() === 'DELETE', { timeout: 30_000 });
    await page.getByRole('button', { name: '삭제', exact: true }).click();
    expect((await deleted).status()).toBe(204);
    await expect(page.getByRole('button', { name: '사진 올리기', exact: true })).toBeVisible();
    expect(pageErrors).toEqual([]);
    await writeFile('.cache/deployment/production/browser-smoke.json', JSON.stringify({ mode: 'REAL_INFRASTRUCTURE_PAID_DISABLED', url: page.url(), testedAt: new Date().toISOString(), liveProductSearch: false, uploadDeletionAccepted: true, calls, pageErrors }, null, 2));
  });
});
