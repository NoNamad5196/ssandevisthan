import { z } from 'zod';
import {
  ApiFailureEnvelopeSchema, CreateDealRequestSchema, CreateSearchRequestSchema, CreateUploadRequestSchema,
  FinalizeUploadRequestSchema, SearchCreatedDataSchema, SearchHistoryDataSchema, SearchResultsDataSchema,
  SearchStatusDataSchema, UploadCreatedDataSchema, UploadReadyDataSchema, UploadStoredDataSchema, successEnvelopeSchema,
  AnonymousAuthRequestSchema, RefreshAuthRequestSchema, AuthSessionEnvelopeSchema,
} from './api.ts';

/** Generated from the same strict runtime schemas. Cross-field refinements remain enforced by Zod. */
export function createOpenApiDocument() {
  const definitions = {
    CreateUploadRequest: CreateUploadRequestSchema, FinalizeUploadRequest: FinalizeUploadRequestSchema,
    CreateSearchRequest: CreateSearchRequestSchema, CreateDealRequest: CreateDealRequestSchema,
    UploadCreated: successEnvelopeSchema(UploadCreatedDataSchema), UploadStored: successEnvelopeSchema(UploadStoredDataSchema),
    UploadReady: successEnvelopeSchema(UploadReadyDataSchema), SearchCreated: successEnvelopeSchema(SearchCreatedDataSchema),
    SearchStatus: successEnvelopeSchema(SearchStatusDataSchema), SearchResults: successEnvelopeSchema(SearchResultsDataSchema),
    SearchHistory: successEnvelopeSchema(SearchHistoryDataSchema), Error: ApiFailureEnvelopeSchema,
    AnonymousAuthRequest: AnonymousAuthRequestSchema, RefreshAuthRequest: RefreshAuthRequestSchema,
    AuthSession: AuthSessionEnvelopeSchema,
  };
  const schemas = Object.fromEntries(Object.entries(definitions).map(([name, schema]) => [name, z.toJSONSchema(schema, { io: name.endsWith('Request') ? 'input' : 'output', target: 'draft-2020-12' })]));
  const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
  const json = (name: string) => ({ 'application/json': { schema: ref(name) } });
  const response = (name: string, description: string) => ({ description, content: json(name) });
  const body = (name: string) => ({ required: true, content: json(name) });
  const errors = { default: response('Error', 'Safe v3 error envelope; provider failures after acceptance are run states, not polling gateway errors.') };
  const idParameter = (name: string) => ({ name, in: 'path', required: true, schema: { type: 'string', format: 'uuid' } });
  const idempotency = { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9._~:-]+$' } };
  return {
    openapi: '3.1.0', info: { title: 'SSANDEVISTHAN Edge API', version: '3.0.0', description: 'Runtime schemas enforce ownership-independent structure. JWT ownership, RLS, lease fencing, evidence and price invariants are additionally enforced server-side. Synthetic fixtures are never LIVE evidence.' },
    servers: [{ url: '/functions/v1/api/v3' }], security: [{ BearerSessionJWT: [] }],
    components: { securitySchemes: { BearerSessionJWT: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } }, schemas },
    paths: {
      '/auth/anonymous': { post: { operationId: 'createAnonymousSession', security: [], requestBody: body('AnonymousAuthRequest'), responses: { 201: response('AuthSession', 'Anonymous owner established. Persist the session before creating user data; access token 1 hour, refresh token 30 days.'), ...errors } } },
      '/auth/refresh': { post: { operationId: 'refreshAnonymousSession', security: [], requestBody: body('RefreshAuthRequest'), responses: { 200: response('AuthSession', 'Same-owner token rotation. Previous refresh token has a 15-second retry grace and returns the same current refresh token.'), ...errors } } },
      '/uploads': { post: { operationId: 'createUpload', requestBody: body('CreateUploadRequest'), responses: { 201: response('UploadCreated', 'Private upload session created; no public object URL.'), ...errors } } },
      '/uploads/{uploadId}/content': { put: { operationId: 'putUploadContent', parameters: [idParameter('uploadId')], requestBody: { required: true, content: Object.fromEntries(['image/jpeg', 'image/png', 'image/webp'].map((mime) => [mime, { schema: { type: 'string', format: 'binary' } }])) }, responses: { 200: response('UploadStored', 'Server-verified single frame normalized WebP stored privately.'), ...errors } } },
      '/uploads/{uploadId}/finalize': { post: { operationId: 'finalizeUpload', parameters: [idParameter('uploadId')], requestBody: body('FinalizeUploadRequest'), responses: { 200: response('UploadReady', 'Private object independently verified and READY.'), ...errors } } },
      '/uploads/{uploadId}': { delete: { operationId: 'deleteUpload', parameters: [idParameter('uploadId')], responses: { 204: { description: 'Unused upload deleted; an in-use upload returns UPLOAD_IN_USE.' }, ...errors } } },
      '/searches': {
        post: { operationId: 'createImageSearch', parameters: [idempotency], requestBody: body('CreateSearchRequest'), responses: { 202: response('SearchCreated', 'Durable run accepted or existing run reused; Retry-After: 2.'), ...errors } },
        get: { operationId: 'listSearches', parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 } }, { name: 'cursor', in: 'query', schema: { type: 'string', maxLength: 500 } }], responses: { 200: response('SearchHistory', 'Owner-only history of unexpired snapshots.'), ...errors } },
      },
      '/deals': { post: { operationId: 'createDealSearch', parameters: [idempotency], requestBody: body('CreateDealRequest'), responses: { 202: response('SearchCreated', 'Durable DEAL_TEXT run accepted or reused.'), ...errors } } },
      '/searches/{searchId}': {
        get: { operationId: 'getSearchStatus', parameters: [idParameter('searchId')], responses: { 200: response('SearchStatus', 'No-store run status. A failed run remains HTTP 200.'), ...errors } },
        delete: { operationId: 'deleteSearch', parameters: [idParameter('searchId')], responses: { 204: { description: 'Immediately hidden; cleanup queued; repeat deletion remains 204.' }, ...errors } },
      },
      '/searches/{searchId}/results': { get: { operationId: 'getSearchResults', parameters: [idParameter('searchId'), { name: 'sort', in: 'query', schema: { type: 'string', enum: ['RECOMMENDED', 'MOST_SIMILAR', 'LOWEST_PRICE'], default: 'RECOMMENDED' } }], responses: { 200: response('SearchResults', 'Immutable snapshot projection. DEAL_TEXT rejects MOST_SIMILAR.'), 202: response('SearchStatus', 'Run still active; no partial scores exposed.'), ...errors } } },
      '/searches/{searchId}/cancel': { post: { operationId: 'cancelSearch', parameters: [idParameter('searchId')], responses: { 200: response('SearchStatus', 'Cancellation persisted, leases invalidated; terminal state unchanged.'), ...errors } } },
    },
  };
}
