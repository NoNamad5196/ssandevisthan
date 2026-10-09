import { test, expect, type Page, type Route } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  API_BASE, ApiFailureEnvelopeSchema, AuthSessionDataSchema, SearchCreatedDataSchema,
  SearchResultsDataSchema, SearchStatusDataSchema, UploadCreatedDataSchema,
  UploadReadyDataSchema, UploadStoredDataSchema, successEnvelopeSchema,
  type SearchStatus, type Sort, type TerminalStatus,
} from '../../packages/contracts/src/index.ts';
import { fixtureCandidate, fixtureDeal, fixtureMetrics, fixtureTarget, fixtureUuid, FIXTURE_TIME } from '../../packages/fixtures/src/index.ts';
import { projectSnapshot, rankDealCandidates, rankImageCandidates } from '../../packages/search-core/src/index.ts';

// MOCK ONLY: validates browser integration and contract states. Every remote
// request is intercepted. Synthetic merchant names/URLs are never LIVE evidence.
test.describe('MOCK API browser integration @mock', () => {
  test.skip(!!process.env.E2E_BASE_URL, 'MOCK flows require the isolated Vite test server, never a live deployment');
  const origin = 'https://mock-api.ssandevisthan.test';
  const base = `${origin}${API_BASE}`;
  const runId = fixtureUuid(9001), uploadId = fixtureUuid(9002), owner = fixtureUuid(9003);
  const accessToken = 'mock_header.mock_payload.mock_signature';
  const session = (userId = owner) => AuthSessionDataSchema.parse({ userId, accessToken, refreshToken: 'mock_refresh_token_'.padEnd(48, 'x'), expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  const meta = () => ({ requestId: fixtureUuid(9004), schemaVersion: 3 as const, createdAt: new Date().toISOString() });
  const failure = { code: 'PROVIDER_UNAVAILABLE' as const, message: 'MOCK: 상품 판매처 확인에 실패했어요.', retryable: true };
  const candidates = [
    fixtureCandidate(1, { title: 'MOCK 높은 유사도 배송비 포함', itemPrice: 30_000, comparison: fixtureMetrics(.94, .94) }),
    fixtureCandidate(2, { title: 'MOCK 저렴한 배송비 포함', itemPrice: 12_000, shippingFee: 3_000, comparison: fixtureMetrics(.82, .82) }),
    fixtureCandidate(3, { title: 'MOCK 배송비 미확인', itemPrice: 5_000, shippingFee: null, price: { variantPriceVerified: true, unconditionalPriceVerified: true, shippingFeeVerified: false }, comparison: fixtureMetrics(.98, .98) }),
    fixtureCandidate(4, { title: 'MOCK 유사도 탈락 상품', itemPrice: 100, comparison: fixtureMetrics(.3, .3) }),
    fixtureCandidate(5, { title: 'MOCK 가격 미확인 참고', itemPrice: null, priceObservedAt: null }),
  ];
  const snapshot = rankImageCandidates(candidates, FIXTURE_TIME);
  const dealSnapshot = rankDealCandidates([fixtureDeal(6, { title: 'MOCK 핫딜 가격 비교' })], FIXTURE_TIME);
  const createdAt = new Date().toISOString();
  async function capture(page: Page, name: string) {
    await mkdir('test-results/visual', { recursive: true });
    await page.screenshot({ path: `test-results/visual/MOCK-${name}.png`, fullPage: true, animations: 'disabled' });
  }
  function state(status: SearchStatus, mode: 'IMAGE_SIMILAR' | 'DEAL_TEXT' = 'IMAGE_SIMILAR') {
    return SearchStatusDataSchema.parse({ searchId: runId, mode, status, stage: status === 'RUNNING' ? 'COMPARING' : null,
      createdAt, deadlineAt: new Date(Date.parse(createdAt) + 90_000).toISOString(), completedAt: ['QUEUED', 'RUNNING'].includes(status) ? null : new Date().toISOString(),
      pollAfterMs: 2000, progress: { discoveredUrls: 5, deduplicatedUrls: 5, extractedCandidates: 5, comparedCandidates: 5 }, failure: status === 'FAILED' ? failure : null });
  }
  function results(status: TerminalStatus, sort: Sort = 'RECOMMENDED', deal = false) {
    const projected = projectSnapshot(deal ? dealSnapshot : snapshot, sort);
    const common = { searchId: runId, status, stage: null, sort, completedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 604_800_000).toISOString(),
      references: ['COMPLETED', 'PARTIAL'].includes(status) ? projected.references : [],
      results: ['COMPLETED', 'PARTIAL'].includes(status) ? projected.results : [],
      warnings: status === 'PARTIAL' ? [{ code: 'SOURCE_TIMEOUT', message: 'MOCK: 일부 판매처 응답이 늦었어요.' }] : [], failure: status === 'FAILED' ? failure : null };
    return SearchResultsDataSchema.parse(deal ? { ...common, mode: 'DEAL_TEXT', query: '오버핏 맨투맨', category: 'FASHION' }
      : { ...common, mode: 'IMAGE_SIMILAR', targetAnalysis: fixtureTarget, generatedQueries: ['MOCK 오버핏 맨투맨'], identifiedOriginal: null });
  }
  async function reply(route: Route, data: unknown, schema: Parameters<typeof successEnvelopeSchema>[0], status = 200) {
    const envelope = successEnvelopeSchema(schema).parse({ ok: true, data, meta: meta() });
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(envelope), headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
  }
  async function fail(route: Route, status = 503) {
    const envelope = ApiFailureEnvelopeSchema.parse({ ok: false, error: { code: 'TEMPORARILY_UNAVAILABLE', message: 'MOCK: 잠시 후 다시 시도해 주세요.', retryable: true }, meta: meta() });
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(envelope), headers: { 'Access-Control-Allow-Origin': '*' } });
  }
  type Seen = { path: string; method: string; authorization?: string; idempotency?: string; body: unknown };
  async function setup(page: Page, options: { statuses?: SearchStatus[]; terminal?: TerminalStatus; failFirstCreate?: boolean; refreshOtherOwner?: boolean; deal?: boolean; malformed?: boolean } = {}) {
    const seen: Seen[] = [], unexpected: string[] = [];
    let polls = 0, creates = 0, canceled = false;
    const statuses = options.statuses ?? [options.terminal ?? 'COMPLETED'];
    const terminal = options.terminal ?? 'COMPLETED';
    const picture = await readFile(resolve('apps/web/public/artwork/hero-collage.png'));
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === 'http://127.0.0.1:4175') return route.continue();
      if (url.hostname === 'cdn.example.invalid') return route.fulfill({ status: 200, contentType: 'image/png', body: picture });
      if (url.origin !== origin || !url.pathname.startsWith(API_BASE)) {
        unexpected.push(request.url()); return route.abort('blockedbyclient');
      }
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type,idempotency-key', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' } });
      const path = url.pathname.slice(API_BASE.length), headers = request.headers();
      const body = headers['content-type']?.includes('application/json') ? request.postDataJSON() : request.postDataBuffer()?.length;
      seen.push({ path, method: request.method(), authorization: headers.authorization, idempotency: headers['idempotency-key'], body });
      if (path === '/auth/anonymous') return reply(route, session(), AuthSessionDataSchema, 201);
      if (path === '/auth/refresh') return reply(route, session(options.refreshOtherOwner ? fixtureUuid(9099) : owner), AuthSessionDataSchema);
      if (headers.authorization !== `Bearer ${accessToken}`) { unexpected.push(`missing bearer ${path}`); return fail(route, 401); }
      if (path === '/uploads' && request.method() === 'POST') return reply(route, { uploadId, status: 'PENDING', contentUrl: `${API_BASE}/uploads/${uploadId}/content`, expiresAt: new Date(Date.now() + 3600_000).toISOString(), maxBytes: 10_000_000, maxPixels: 24_000_000 }, UploadCreatedDataSchema, 201);
      if (path === `/uploads/${uploadId}/content`) return reply(route, { uploadId, status: 'STORED', mimeType: 'image/webp', width: 826, height: 766, normalizedBytes: 100_000, expiresAt: new Date(Date.now() + 3600_000).toISOString() }, UploadStoredDataSchema);
      if (path === `/uploads/${uploadId}/finalize`) return reply(route, { uploadId, status: 'READY', mimeType: 'image/webp', width: 826, height: 766, expiresAt: new Date(Date.now() + 3600_000).toISOString() }, UploadReadyDataSchema);
      if (path === '/searches' || path === '/deals') {
        creates++;
        if (options.failFirstCreate && creates === 1) return fail(route);
        return reply(route, { searchId: runId, mode: options.deal ? 'DEAL_TEXT' : 'IMAGE_SIMILAR', status: 'QUEUED', stage: null, statusUrl: `${API_BASE}/searches/${runId}`, resultsUrl: `${API_BASE}/searches/${runId}/results`, deadlineAt: state('QUEUED').deadlineAt, reused: creates > 1 }, SearchCreatedDataSchema, 202);
      }
      if (path === `/searches/${runId}/cancel`) { canceled = true; return reply(route, state('CANCELED'), SearchStatusDataSchema); }
      if (path === `/searches/${runId}` && request.method() === 'DELETE') return route.fulfill({ status: 204 });
      if (path === `/searches/${runId}`) return reply(route, state(canceled ? 'CANCELED' : statuses[Math.min(polls++, statuses.length - 1)], options.deal ? 'DEAL_TEXT' : 'IMAGE_SIMILAR'), SearchStatusDataSchema);
      if (path === `/searches/${runId}/results`) {
        const data = results(canceled ? 'CANCELED' : terminal, (url.searchParams.get('sort') ?? 'RECOMMENDED') as Sort, options.deal);
        if (options.malformed) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { ...data, results: [{ ...data.results[0], priceBasis: 'TOTAL_PRICE', effectivePrice: -1 }] }, meta: meta() }) });
        return reply(route, data, SearchResultsDataSchema);
      }
      unexpected.push(`${request.method()} ${path}`); return fail(route, 500);
    });
    return { seen, unexpected };
  }

  test('upload retries retain the request key and poll queued/running into contract-validated results', async ({ page }) => {
    const mock = await setup(page, { failFirstCreate: true, statuses: ['QUEUED', 'RUNNING', 'COMPLETED'] });
    await page.goto('/');
    await page.locator('#clothes-photo').setInputFiles(resolve('apps/web/public/artwork/hero-collage.png'));
    const start = page.getByRole('button', { name: '비슷한 옷 찾기', exact: true });
    await start.click();
    await expect(page.locator('#upload-error')).toContainText('MOCK: 잠시 후 다시');
    await start.click();
    await expect(page).toHaveURL(`/search/${runId}`);
    await expect(page.getByRole('heading', { name: '검색을 준비하고 있어요.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '디자인이 충분히 비슷한지 비교하고 있어요.' })).toBeVisible({ timeout: 7000 });
    await expect(page.locator('.product')).toHaveCount(3, { timeout: 10_000 });
    expect(mock.seen.filter(r => r.path === '/auth/anonymous')).toHaveLength(1);
    expect(mock.seen.slice(0, 5).map(r => r.path)).toEqual(['/auth/anonymous', '/uploads', `/uploads/${uploadId}/content`, `/uploads/${uploadId}/finalize`, '/searches']);
    expect(mock.seen[0].body).toEqual({ schemaVersion: 3 });
    expect(mock.seen.filter(r => r.path === '/uploads')).toHaveLength(1);
    expect(mock.seen.find(r => r.path.endsWith('/content'))).toMatchObject({ method: 'PUT', body: expect.any(Number) });
    expect(mock.seen.filter(r => r.path.endsWith('/finalize'))).toHaveLength(1);
    const creates = mock.seen.filter(r => r.path === '/searches');
    expect(creates).toHaveLength(2);
    expect(creates[0].idempotency).toBeTruthy();
    expect(creates[1].idempotency).toBe(creates[0].idempotency);
    expect(creates[1].body).toEqual({ schemaVersion: 3, uploadId, resultLimit: 10 });
    await expect(page.getByText('MOCK 유사도 탈락 상품', { exact: true })).toHaveCount(0);
    expect(mock.unexpected).toEqual([]);
  });

  test('stored result sorts retain shipping cohorts and keep unknown prices in references', async ({ page }) => {
    await page.setViewportSize({ width: 1586, height: 992 });
    const mock = await setup(page);
    await page.goto(`/search/${runId}`);
    await expect(page.locator('.product')).toHaveCount(3);
    await page.getByRole('combobox', { name: '정렬' }).selectOption('LOWEST_PRICE');
    const total = page.locator('.cohort').filter({ has: page.getByRole('heading', { name: '배송비 포함 확인', exact: true }) });
    await expect(total.locator('h3')).toHaveText(['MOCK 저렴한 배송비 포함', 'MOCK 높은 유사도 배송비 포함']);
    await expect(page.locator('.cohort').last().getByRole('heading', { name: '배송비 미확인', exact: true })).toBeVisible();
    await expect(page.locator('.cohort').last().locator('.price')).toHaveText('5,000원');
    await page.getByText('가격을 확인하지 못한 참고 상품 1개', { exact: true }).click();
    await expect(page.locator('.references')).toContainText('MOCK 가격 미확인 참고');
    await page.getByRole('combobox', { name: '정렬' }).selectOption('MOST_SIMILAR');
    await expect(page.locator('.cohort')).toHaveCount(1);
    await expect(page.locator('.product h3')).toHaveText(['MOCK 배송비 미확인', 'MOCK 높은 유사도 배송비 포함', 'MOCK 저렴한 배송비 포함']);
    await expect(page.locator('.purchase').first()).toHaveAttribute('rel', 'noopener noreferrer');
    await capture(page, 'results-desktop');
    expect(mock.seen.filter(r => r.path === '/searches')).toHaveLength(0);
    expect(mock.unexpected).toEqual([]);
  });

  for (const [terminal, heading] of [
    ['NO_RELIABLE_MATCH', '충분히 비슷한 상품을 찾지 못했어요.'],
    ['FAILED', '검색을 완료하지 못했어요.'],
    ['EXPIRED', '검색 시간이 초과되었어요.'],
  ] as const) test(`${terminal} shows an honest empty state without purchase links`, async ({ page }) => {
    const mock = await setup(page, { terminal });
    await page.goto(`/search/${runId}`);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '이 검색과 사진 삭제', exact: true })).toBeVisible();
    await expect.poll(() => mock.seen.some(r => r.path.endsWith('/results'))).toBe(true);
    await expect(page.locator('.purchase')).toHaveCount(0);
    if (terminal === 'FAILED') await expect(page.getByText(failure.message, { exact: true })).toBeVisible();
    expect(mock.unexpected).toEqual([]);
  });

  test('PARTIAL preserves verified results and displays missing-source warnings', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const mock = await setup(page, { terminal: 'PARTIAL' });
    await page.goto(`/search/${runId}`);
    await expect(page.getByText('일부 판매처를 확인하지 못했어요. 검증된 상품만 보여드려요.', { exact: true })).toBeVisible();
    await expect(page.getByText('MOCK: 일부 판매처 응답이 늦었어요.', { exact: true })).toBeVisible();
    await expect(page.locator('.product')).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await capture(page, 'partial-mobile');
    expect(mock.unexpected).toEqual([]);
  });

  test('cancel establishes a terminal state and deletion returns home', async ({ page }) => {
    const mock = await setup(page, { statuses: ['RUNNING'] });
    await page.goto(`/search/${runId}`);
    await page.getByRole('button', { name: '검색 취소', exact: true }).click();
    await expect(page.getByRole('heading', { name: '검색을 취소했어요.', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '검색 취소', exact: true })).toHaveCount(0);
    await expect(page.locator('.purchase')).toHaveCount(0);
    expect(mock.seen.filter(r => r.path.endsWith('/cancel'))).toHaveLength(1);
    await page.getByRole('button', { name: '이 검색과 사진 삭제', exact: true }).click();
    await expect(page.getByRole('button', { name: '사진 올리기', exact: true })).toBeVisible();
    expect(mock.seen.filter(r => r.path === `/searches/${runId}` && r.method === 'DELETE')).toHaveLength(1);
    expect(mock.unexpected).toEqual([]);
  });

  test('a refreshed different owner cannot silently replace the original anonymous session', async ({ page }) => {
    const saved = { ...session(), expiresAt: new Date(Date.now() - 1000).toISOString() };
    const key = `ssandevisthan.auth.v3:${base}`;
    await page.addInitScript(({ key, saved }) => { localStorage.setItem(key, JSON.stringify(saved)); localStorage.setItem(`${key}:owner`, saved.userId); }, { key, saved });
    const mock = await setup(page, { refreshOtherOwner: true });
    await page.goto(`/search/${runId}`);
    await expect(page.getByText('기존 검색 세션을 복구하지 못했어요. 새 세션으로 자동 변경하지 않았습니다.', { exact: true })).toBeVisible();
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).userId, key)).toBe(owner);
    expect(mock.seen.some(r => r.path === '/auth/anonymous' || r.path.startsWith('/searches'))).toBe(false);
    expect(mock.unexpected).toEqual([]);
  });

  test('malformed priced results are rejected rather than rendered as purchase offers', async ({ page }) => {
    const mock = await setup(page, { malformed: true });
    await page.goto(`/search/${runId}`);
    await expect(page.getByText('검색 응답의 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.', { exact: false })).toBeVisible();
    await expect(page.locator('.purchase')).toHaveCount(0);
    expect(mock.unexpected).toEqual([]);
  });

  test('hot-deal submission uses DEAL_TEXT and never offers visual similarity sorting', async ({ page }) => {
    const mock = await setup(page, { deal: true });
    await page.goto('/');
    await page.getByRole('textbox', { name: '핫딜 상품 검색' }).fill('오버핏 맨투맨');
    await page.getByRole('button', { name: '검색하기', exact: true }).click();
    await expect(page.locator('.product h3')).toHaveText('MOCK 핫딜 가격 비교');
    await expect(page.getByRole('option', { name: '더 비슷한 순' })).toHaveCount(0);
    expect(mock.seen.find(r => r.path === '/deals')?.body).toEqual({ schemaVersion: 3, query: '오버핏 맨투맨', category: 'FASHION', resultLimit: 10 });
    expect(mock.unexpected).toEqual([]);
  });
});
