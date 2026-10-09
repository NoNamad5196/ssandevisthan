import {
  API_BASE, ApiFailureEnvelopeSchema, AuthSessionDataSchema, AuthSessionEnvelopeSchema,
  SearchCreatedDataSchema, SearchStatusDataSchema, SearchResultsDataSchema, SearchHistoryDataSchema,
  UploadCreatedDataSchema, UploadStoredDataSchema, UploadReadyDataSchema, successEnvelopeSchema,
  type AuthSessionData, type SearchStatusData, type SearchResultsData, type ImageRecommendation,
  type DealRecommendation, type SearchStage, type SearchStatus, type Sort as SearchSort,
} from '../../../packages/contracts/src/index.ts';

export type Stage = SearchStage;
export type Status = SearchStatus;
export type Sort = SearchSort;
export type SearchState = SearchStatusData;
export type Result = ImageRecommendation | DealRecommendation;
export type Results = SearchResultsData;
export class ApiError extends Error {
  constructor(message: string, public code: string, public status = 0) { super(message); this.name = 'ApiError'; }
}
export interface RequestOptions { method?: string; body?: unknown; key?: string; signal?: AbortSignal }
export interface SessionStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface SessionLocks { request<T>(name: string, callback: () => Promise<T>): Promise<T> }
export interface ApiClientOptions {
  baseUrl: string;
  /** Development callers must explicitly opt into localhost. Never enabled in a production build. */
  allowLocalhost?: boolean;
  fetch?: typeof fetch;
  storage?: SessionStorage | (() => SessionStorage);
  locks?: SessionLocks;
  now?: () => number;
}
const storageFailure = () => new ApiError('브라우저에서 세션을 안전하게 저장하지 못했어요. 저장 공간과 개인정보 설정을 확인한 뒤 다시 시도해 주세요.', 'SESSION_STORAGE_UNAVAILABLE');
const recoveryFailure = () => new ApiError('기존 검색 세션을 복구하지 못했어요. 새 세션으로 자동 변경하지 않았습니다.', 'SESSION_RECOVERY_REQUIRED', 401);
const unavailable = () => new ApiError('검색 서버 연결을 준비하고 있어요. 잠시 후 다시 시도해 주세요.', 'TEMPORARILY_UNAVAILABLE', 503);

export function normalizeApiBase(input: string, allowLocalhost = false): string {
  let url: URL;
  try { url = new URL(input); } catch { throw unavailable(); }
  const localhost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const localDevelopment = allowLocalhost && localhost && (url.protocol === 'http:' || url.protocol === 'https:');
  if (url.username || url.password || url.search || url.hash || (!localDevelopment && (url.protocol !== 'https:' || localhost || !!url.port))) throw unavailable();
  const path = url.pathname.replace(/\/$/, '');
  if (path !== '' && path !== API_BASE) throw unavailable();
  return `${url.origin}${API_BASE}`;
}
export const sessionStorageKey = (baseUrl: string) => `ssandevisthan.auth.v3:${baseUrl}`;

/** The factory permits deterministic offline testing without replacing browser globals. */
export function createApiClient(options: ApiClientOptions) {
  const base = normalizeApiBase(options.baseUrl, options.allowLocalhost);
  const key = sessionStorageKey(base), ownerKey = `${key}:owner`, lockName = `${key}:refresh`;
  const send = options.fetch ?? globalThis.fetch.bind(globalThis), now = options.now ?? Date.now;
  let sessionFlight: Promise<AuthSessionData> | null = null;
  let expectedOwner: string | null = null;
  let unsavedSession: AuthSessionData | null = null;

  function storage(): SessionStorage {
    try {
      const result = typeof options.storage === 'function' ? options.storage() : options.storage ?? globalThis.localStorage;
      if (!result) throw new Error('unavailable');
      const probe = `${key}:probe`;
      result.setItem(probe, '1');
      if (result.getItem(probe) !== '1') throw new Error('unavailable');
      result.removeItem(probe);
      return result;
    } catch { throw storageFailure(); }
  }
  function readSaved(store: SessionStorage): AuthSessionData | null {
    let raw: string | null, owner: string | null;
    try { raw = store.getItem(key); owner = store.getItem(ownerKey); } catch { throw storageFailure(); }
    if (!raw) {
      if ((owner || expectedOwner) && !unsavedSession) throw recoveryFailure();
      return null;
    }
    let json: unknown;
    try { json = JSON.parse(raw); } catch { throw recoveryFailure(); }
    const parsed = AuthSessionDataSchema.safeParse(json);
    if (!parsed.success || (owner && owner !== parsed.data.userId) || (expectedOwner && expectedOwner !== parsed.data.userId)) throw recoveryFailure();
    expectedOwner = parsed.data.userId;
    return parsed.data;
  }
  function save(store: SessionStorage, session: AuthSessionData): AuthSessionData {
    if (expectedOwner && expectedOwner !== session.userId) throw recoveryFailure();
    expectedOwner = session.userId;
    unsavedSession = session;
    try {
      store.setItem(ownerKey, session.userId);
      const serialized = JSON.stringify(session);
      store.setItem(key, serialized);
      if (store.getItem(key) !== serialized || store.getItem(ownerKey) !== session.userId) throw new Error('write mismatch');
    } catch { throw storageFailure(); }
    unsavedSession = null;
    return session;
  }
  async function authCall(path: '/auth/anonymous' | '/auth/refresh', refreshToken?: string): Promise<AuthSessionData> {
    const body = JSON.stringify(refreshToken ? { schemaVersion: 3, refreshToken } : { schemaVersion: 3 });
    // A retry of a rotated refresh token is safe within the server's 15-second grace.
    // Anonymous creation is never automatically repeated after an unknown outcome.
    const attempts = refreshToken ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      let response: Response;
      try {
        response = await send(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000) });
      } catch {
        if (attempt + 1 < attempts) continue;
        throw unavailable();
      }
      if (response.status >= 500 && attempt + 1 < attempts) continue;
      let envelope: unknown;
      try { envelope = await response.json(); }
      catch (error) {
        if (attempt + 1 < attempts && error instanceof Error && ['TypeError', 'AbortError', 'TimeoutError'].includes(error.name)) continue;
        throw recoveryFailure();
      }
      if (!response.ok) {
        const failure = ApiFailureEnvelopeSchema.safeParse(envelope);
        throw new ApiError(failure.success ? failure.data.error.message : '기존 검색 세션을 갱신하지 못했어요. 다시 시도해 주세요.', failure.success ? failure.data.error.code : 'TOKEN_EXPIRED', response.status);
      }
      const parsed = AuthSessionEnvelopeSchema.safeParse(envelope);
      if (!parsed.success || Date.parse(parsed.data.data.expiresAt) <= now()) throw recoveryFailure();
      if (expectedOwner && parsed.data.data.userId !== expectedOwner) throw recoveryFailure();
      return parsed.data.data;
    }
    throw recoveryFailure();
  }
  async function resolveSession(rejectedAccessToken?: string): Promise<AuthSessionData> {
    const locks = options.locks ?? globalThis.navigator?.locks;
    if (!locks) throw new ApiError('이 브라우저에서는 안전한 세션 동기화를 사용할 수 없어요. 최신 브라우저에서 다시 시도해 주세요.', 'SESSION_LOCK_UNAVAILABLE');
    return locks.request(lockName, async () => {
      const store = storage();
      const saved = readSaved(store);
      if (unsavedSession) return save(store, unsavedSession);
      if (saved) {
        // Another tab may already have rotated the token while this tab awaited the lock.
        const fresh = Date.parse(saved.expiresAt) > now() + 30_000;
        if (fresh && (!rejectedAccessToken || saved.accessToken !== rejectedAccessToken)) return saved;
        return save(store, await authCall('/auth/refresh', saved.refreshToken));
      }
      return save(store, await authCall('/auth/anonymous'));
    });
  }
  async function session(rejectedAccessToken?: string): Promise<AuthSessionData> {
    if (sessionFlight) {
      const pending = await sessionFlight;
      if (!rejectedAccessToken || pending.accessToken !== rejectedAccessToken) return pending;
    }
    const flight = resolveSession(rejectedAccessToken);
    sessionFlight = flight;
    try { return await flight; } finally { if (sessionFlight === flight) sessionFlight = null; }
  }
  async function request<T>(path: string, requestOptions: RequestOptions = {}): Promise<T> {
    // Only the configured API origin receives the bearer token. Redirects are errors.
    if (!path.startsWith('/') || path.startsWith('//') || /[\\\r\n]/.test(path)) throw new ApiError('요청 주소가 올바르지 않아요.', 'INVALID_INPUT', 400);
    const url = new URL(`${base}${path}`);
    if (url.origin !== new URL(base).origin || !url.pathname.startsWith(`${API_BASE}/`)) throw new ApiError('요청 주소가 올바르지 않아요.', 'INVALID_INPUT', 400);
    const method = (requestOptions.method ?? 'GET').toUpperCase();
    let current = await session();
    for (let attempt = 0; attempt < 2; attempt++) {
      requestOptions.signal?.throwIfAborted();
      const binary = typeof Blob !== 'undefined' && requestOptions.body instanceof Blob;
      const hasBody = requestOptions.body !== undefined;
      const headers: Record<string, string> = { Authorization: `Bearer ${current.accessToken}` };
      if (hasBody) headers['Content-Type'] = binary ? (requestOptions.body as Blob).type : 'application/json';
      if (requestOptions.key) headers['Idempotency-Key'] = requestOptions.key;
      let response: Response;
      try {
        response = await send(url.href, { method, headers, body: hasBody ? binary ? requestOptions.body as Blob : JSON.stringify(requestOptions.body) : undefined, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: requestOptions.signal ?? AbortSignal.timeout(binary ? 45_000 : 20_000) });
      } catch (error) { if (requestOptions.signal?.aborted) throw error; throw unavailable(); }
      if (response.status === 401 && attempt === 0) { current = await session(current.accessToken); continue; }
      if (response.status === 204 && method === 'DELETE') return undefined as T;
      const envelope: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const failure = ApiFailureEnvelopeSchema.safeParse(envelope);
        throw new ApiError(failure.success ? failure.data.error.message : '서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.', failure.success ? failure.data.error.code : 'TEMPORARILY_UNAVAILABLE', response.status);
      }
      const route = url.pathname.slice(API_BASE.length);
      const schema = route === '/uploads' && method === 'POST' ? UploadCreatedDataSchema
        : route.endsWith('/content') ? UploadStoredDataSchema : route.endsWith('/finalize') ? UploadReadyDataSchema
        : (route === '/searches' || route === '/deals') && method === 'POST' ? SearchCreatedDataSchema
        : route === '/searches' && method === 'GET' ? SearchHistoryDataSchema
        : route.endsWith('/results') && response.status !== 202 ? SearchResultsDataSchema : SearchStatusDataSchema;
      const checked = successEnvelopeSchema(schema).safeParse(envelope);
      if (!checked.success) throw new ApiError('검색 응답의 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.', 'INVALID_INPUT', response.status);
      return checked.data.data as T;
    }
    throw recoveryFailure();
  }
  return { request, session };
}

let client: ReturnType<typeof createApiClient> | undefined;
export function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    client ??= createApiClient({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? '', allowLocalhost: import.meta.env.DEV });
    return client.request<T>(path, options);
  } catch (error) { return Promise.reject(error); }
}
export const active = (state?: SearchState) => state?.status === 'QUEUED' || state?.status === 'RUNNING';
export const stageLabel: Record<Stage, string> = { VALIDATING: '사진을 확인하고 있어요.', ANALYZING: '옷의 디자인 특징을 분석하고 있어요.', DISCOVERING: '비슷한 국내 상품을 찾고 있어요.', EXTRACTING: '상품 사진과 실제 가격을 확인하고 있어요.', COMPARING: '디자인이 충분히 비슷한지 비교하고 있어요.', RANKING: '확인된 가격으로 결과를 정리하고 있어요.' };
export function errorMessage(error: unknown) { return error instanceof ApiError ? error.message : '연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.'; }
