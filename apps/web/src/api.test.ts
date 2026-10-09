import { describe, expect, it, vi } from 'vitest';
import { createApiClient, normalizeApiBase, sessionStorageKey, type SessionLocks, type SessionStorage } from './api.ts';
import type { AuthSessionData } from '../../../packages/contracts/src/index.ts';

// All auth responses and tokens in this file are SYNTHETIC. No external requests run.
const NOW = Date.parse('2026-10-09T03:00:00Z');
const API_ORIGIN = 'https://api.example.com';
const API = `${API_ORIGIN}/functions/v1/api/v3`;
const STORAGE_KEY = sessionStorageKey(API);
const OWNER_A = '10000000-0000-4000-8000-000000000001';
const OWNER_B = '10000000-0000-4000-8000-000000000002';
const jwt = (name: string) => `synthetic_header.synthetic_payload_${name}.synthetic_signature_${name}`;
const session = (name = 'one', expires = NOW + 3_600_000, userId = OWNER_A): AuthSessionData => ({ accessToken: jwt(name), refreshToken: `synthetic_refresh_${name}_${'x'.repeat(32)}`, expiresAt: new Date(expires).toISOString(), userId });
const meta = { requestId: '10000000-0000-4000-8000-000000000003', schemaVersion: 3, createdAt: new Date(NOW).toISOString() };
const success = (data: unknown, status = 200) => Response.json({ ok: true, data, meta }, { status });
const failure = (status = 401, code = 'TOKEN_EXPIRED') => Response.json({ ok: false, error: { code, message: '합성 테스트 오류', retryable: false }, meta }, { status });
const history = () => success({ items: [], nextCursor: null });
const createdSearch = () => success({ searchId: '10000000-0000-4000-8000-000000000004', mode: 'IMAGE_SIMILAR', status: 'QUEUED', stage: null, statusUrl: '/functions/v1/api/v3/searches/10000000-0000-4000-8000-000000000004', resultsUrl: '/functions/v1/api/v3/searches/10000000-0000-4000-8000-000000000004/results', deadlineAt: new Date(NOW + 90_000).toISOString(), reused: false }, 202);
class MemoryStorage implements SessionStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
class SharedLocks implements SessionLocks {
  private readonly tails = new Map<string, Promise<void>>();
  request<T>(name: string, callback: () => Promise<T>): Promise<T> {
    const run = (this.tails.get(name) ?? Promise.resolve()).then(callback);
    this.tails.set(name, run.then(() => undefined, () => undefined));
    return run;
  }
}
function seed(storage: MemoryStorage, value: AuthSessionData) {
  storage.setItem(STORAGE_KEY, JSON.stringify(value)); storage.setItem(`${STORAGE_KEY}:owner`, value.userId);
}
const requestUrl = (input: RequestInfo | URL) => typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

describe('API anonymous session coordination — SYNTHETIC mocked fetch', () => {
  it('singleflights first-use authentication and persists identity before protected requests', async () => {
    const storage = new MemoryStorage(), locks = new SharedLocks();
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      if (requestUrl(input).endsWith('/auth/anonymous')) {
        expect(init?.body).toBe(JSON.stringify({ schemaVersion: 3 }));
        return success(session(), 201);
      }
      expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${session().accessToken}`);
      expect(new Headers(init?.headers).has('apikey')).toBe(false);
      expect(init?.redirect).toBe('error'); expect(init?.credentials).toBe('omit');
      return history();
    });
    const client = createApiClient({ baseUrl: API_ORIGIN, storage, locks, fetch: transport, now: () => NOW });
    await Promise.all(Array.from({ length: 8 }, () => client.request('/searches')));
    expect(transport.mock.calls.filter(([url]) => requestUrl(url).endsWith('/auth/anonymous'))).toHaveLength(1);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(session());
  });
  it('serializes separate tab clients through navigator-lock-compatible coordination', async () => {
    const storage = new MemoryStorage(), locks = new SharedLocks();
    const transport = vi.fn<typeof fetch>(async (input) => requestUrl(input).endsWith('/auth/anonymous') ? success(session(), 201) : history());
    const options = { baseUrl: API, storage, locks, fetch: transport, now: () => NOW };
    const tabA = createApiClient(options), tabB = createApiClient(options);
    await Promise.all([tabA.request('/searches'), tabB.request('/searches')]);
    expect(transport.mock.calls.filter(([url]) => requestUrl(url).includes('/auth/'))).toHaveLength(1);
  });
  it('refreshes an expired saved owner once across concurrent tabs without anonymous replacement', async () => {
    const storage = new MemoryStorage(), locks = new SharedLocks(); seed(storage, session('old', NOW - 1));
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      if (requestUrl(input).endsWith('/auth/refresh')) {
        expect(JSON.parse(String(init?.body))).toEqual({ schemaVersion: 3, refreshToken: session('old').refreshToken });
        return success(session('new'));
      }
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${jwt('new')}`);
      return history();
    });
    const options = { baseUrl: API_ORIGIN, storage, locks, fetch: transport, now: () => NOW };
    await Promise.all([createApiClient(options).request('/searches'), createApiClient(options).request('/searches')]);
    expect(transport.mock.calls.filter(([url]) => requestUrl(url).endsWith('/auth/refresh'))).toHaveLength(1);
    expect(transport.mock.calls.some(([url]) => requestUrl(url).endsWith('/auth/anonymous'))).toBe(false);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).userId).toBe(OWNER_A);
  });
  it('refreshes a protected 401 once while preserving original body and Idempotency-Key', async () => {
    const storage = new MemoryStorage(), locks = new SharedLocks(); seed(storage, session('old'));
    const protectedCalls: RequestInit[] = [];
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      if (requestUrl(input).endsWith('/auth/refresh')) return success(session('new'));
      protectedCalls.push(init!);
      return protectedCalls.length === 1 ? failure() : createdSearch();
    });
    const client = createApiClient({ baseUrl: API_ORIGIN, storage, locks, fetch: transport, now: () => NOW });
    const body = { schemaVersion: 3, uploadId: '10000000-0000-4000-8000-000000000005', resultLimit: 10 };
    await client.request('/searches', { method: 'POST', key: 'same-idempotency-key', body });
    expect(protectedCalls).toHaveLength(2);
    expect(protectedCalls.map((call) => call.body)).toEqual([JSON.stringify(body), JSON.stringify(body)]);
    expect(protectedCalls.map((call) => new Headers(call.headers).get('Idempotency-Key'))).toEqual(['same-idempotency-key', 'same-idempotency-key']);
    expect(protectedCalls.map((call) => new Headers(call.headers).get('Authorization'))).toEqual([`Bearer ${jwt('old')}`, `Bearer ${jwt('new')}`]);
  });
  it('never loops after a second protected 401', async () => {
    const storage = new MemoryStorage(), locks = new SharedLocks(); seed(storage, session());
    const transport = vi.fn<typeof fetch>(async (input) => requestUrl(input).endsWith('/auth/refresh') ? success(session('new')) : failure());
    const client = createApiClient({ baseUrl: API_ORIGIN, storage, locks, fetch: transport, now: () => NOW });
    await expect(client.request('/searches')).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(transport).toHaveBeenCalledTimes(3);
  });
  it('retries an uncertain refresh with exactly the same token and preserves server-rotated identity', async () => {
    const storage = new MemoryStorage(), locks = new SharedLocks(); seed(storage, session('old', NOW - 1));
    const bodies: string[] = [];
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      if (requestUrl(input).endsWith('/auth/refresh')) {
        bodies.push(String(init?.body));
        if (bodies.length === 1) throw new TypeError('synthetic lost response after server rotation');
        return success(session('same-rotated-token'));
      }
      return history();
    });
    const client = createApiClient({ baseUrl: API_ORIGIN, storage, locks, fetch: transport, now: () => NOW });
    await client.request('/searches');
    expect(bodies).toHaveLength(2); expect(bodies[0]).toBe(bodies[1]);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(session('same-rotated-token'));
  });
  it('leaves expired owner tokens intact after refresh rejection', async () => {
    const storage = new MemoryStorage(), locks = new SharedLocks(); const old = session('old', NOW - 1); seed(storage, old);
    const transport = vi.fn<typeof fetch>(async () => failure());
    const client = createApiClient({ baseUrl: API_ORIGIN, storage, locks, fetch: transport, now: () => NOW });
    await expect(client.request('/searches')).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(old);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(requestUrl(transport.mock.calls[0]![0])).toBe(`${API}/auth/refresh`);
  });
  it('retries a refresh body-stream transport failure, while keeping malformed JSON fail-closed', async () => {
    const storage = new MemoryStorage(), locks = new SharedLocks(); seed(storage, session('old', NOW - 1));
    const broken = new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('synthetic connection closed')); } }));
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(broken).mockResolvedValueOnce(success(session('new'))).mockResolvedValueOnce(history());
    const client = createApiClient({ baseUrl: API_ORIGIN, storage, locks, fetch: transport, now: () => NOW });
    await client.request('/searches');
    expect(transport.mock.calls[0]![1]?.body).toBe(transport.mock.calls[1]![1]?.body);
    seed(storage, session('old', NOW - 1));
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(new Response('{invalid', { status: 200 }));
    await expect(createApiClient({ baseUrl: API_ORIGIN, storage, locks, fetch: malformed, now: () => NOW }).request('/searches')).rejects.toMatchObject({ code: 'SESSION_RECOVERY_REQUIRED' });
    expect(malformed).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...session('new'), userId: OWNER_B },
    { ...session('new'), accessToken: 'malformed' },
    { ...session('new'), expiresAt: new Date(NOW - 1).toISOString() },
    { ...session('new'), ownerId: OWNER_A },
  ])('rejects malformed or changed-owner auth responses without overwriting old tokens', async (response) => {
    const storage = new MemoryStorage(), locks = new SharedLocks(); const old = session('old', NOW - 1); seed(storage, old);
    const transport = vi.fn<typeof fetch>(async () => success(response));
    const client = createApiClient({ baseUrl: API_ORIGIN, storage, locks, fetch: transport, now: () => NOW });
    await expect(client.request('/searches')).rejects.toMatchObject({ code: 'SESSION_RECOVERY_REQUIRED' });
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(old);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('does not create a new owner for corrupt stored sessions or missing tokens with an owner marker', async () => {
    const storage = new MemoryStorage(), locks = new SharedLocks(); storage.setItem(STORAGE_KEY, '{corrupt');
    const transport = vi.fn<typeof fetch>();
    const client = createApiClient({ baseUrl: API_ORIGIN, storage, locks, fetch: transport, now: () => NOW });
    await expect(client.request('/searches')).rejects.toMatchObject({ code: 'SESSION_RECOVERY_REQUIRED' });
    storage.removeItem(STORAGE_KEY); storage.setItem(`${STORAGE_KEY}:owner`, OWNER_A);
    await expect(client.request('/searches')).rejects.toMatchObject({ code: 'SESSION_RECOVERY_REQUIRED' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('fails before network access when localStorage cannot be used', async () => {
    const transport = vi.fn<typeof fetch>();
    const client = createApiClient({ baseUrl: API_ORIGIN, storage: () => { throw new DOMException('blocked', 'SecurityError'); }, locks: new SharedLocks(), fetch: transport, now: () => NOW });
    await expect(client.request('/searches')).rejects.toMatchObject({ code: 'SESSION_STORAGE_UNAVAILABLE' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('retains an accepted owner in memory if persistence fails, then saves it without creating another', async () => {
    const storage = new MemoryStorage(), locks = new SharedLocks(); let failSessionWrite = true;
    const original = storage.setItem.bind(storage);
    storage.setItem = (key, value) => { if (key === STORAGE_KEY && failSessionWrite) throw new DOMException('quota', 'QuotaExceededError'); original(key, value); };
    const transport = vi.fn<typeof fetch>(async (input) => requestUrl(input).endsWith('/auth/anonymous') ? success(session(), 201) : history());
    const client = createApiClient({ baseUrl: API_ORIGIN, storage, locks, fetch: transport, now: () => NOW });
    await expect(client.request('/searches')).rejects.toMatchObject({ code: 'SESSION_STORAGE_UNAVAILABLE' });
    failSessionWrite = false;
    await client.request('/searches');
    expect(transport.mock.calls.filter(([url]) => requestUrl(url).endsWith('/auth/anonymous'))).toHaveLength(1);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).userId).toBe(OWNER_A);
  });
  it('strictly validates the full response envelope and honors an explicit GET history method', async () => {
    const storage = new MemoryStorage(), locks = new SharedLocks(); seed(storage, session());
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(history()).mockResolvedValueOnce(Response.json({ ok: true, data: { items: [], nextCursor: null }, meta, internalSecret: 'synthetic-rejected-extra' }));
    const client = createApiClient({ baseUrl: API_ORIGIN, storage, locks, fetch: transport, now: () => NOW });
    await expect(client.request('/searches?limit=20', { method: 'GET' })).resolves.toEqual({ items: [], nextCursor: null });
    await expect(client.request('/searches')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('never sends authentication to an arbitrary absolute URL or path outside the API', async () => {
    const transport = vi.fn<typeof fetch>();
    const client = createApiClient({ baseUrl: API_ORIGIN, storage: new MemoryStorage(), locks: new SharedLocks(), fetch: transport, now: () => NOW });
    await expect(client.request('//attacker.example.com/steal')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(client.request('/../../../../steal')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('Production HTTPS API configuration', () => {
  it('accepts HTTPS origin and exact API base', () => {
    expect(normalizeApiBase(API_ORIGIN)).toBe(API);
    expect(normalizeApiBase(`${API}/`)).toBe(API);
  });
  it.each(['http://api.example.com', 'https://user:secret@api.example.com', 'https://api.example.com?token=secret', 'https://api.example.com/arbitrary', 'http://localhost:3000', 'https://localhost:3000'])('rejects production configuration %s', (url) => {
    expect(() => normalizeApiBase(url)).toThrow();
  });
  it('allows localhost only through the explicit development switch', () => {
    expect(normalizeApiBase('http://localhost:3000', true)).toBe('http://localhost:3000/functions/v1/api/v3');
    expect(() => normalizeApiBase('http://api.example.com', true)).toThrow();
  });
});
