import { describe, expect, it } from 'vitest';
import {
  AnalysisOutputSchema, ComparisonOutputSchema, CreateDealRequestSchema, CreateSearchRequestSchema,
  CreateUploadRequestSchema, IdempotencyKeySchema, ImageRecommendationSchema,
  SearchStatusDataSchema, TargetAnalysisSchema,
  createOpenApiDocument,
} from './index.ts';
import { fixtureCandidate, fixtureTarget, fixtureMerchantAttributes, fixtureUuid, fixtureVisual, observed } from '../../fixtures/src/index.ts';
import { rankImageCandidates, projectSnapshot } from '../../search-core/src/index.ts';
import { FIXTURE_TIME } from '../../fixtures/src/index.ts';

describe('v3 wire contracts — synthetic offline fixtures', () => {
  it('exports OpenAPI 3.1 from strict shared schemas without losing required authentication', () => {
    const specification = createOpenApiDocument();
    expect(specification.openapi).toBe('3.1.0');
    expect(specification.paths['/searches'].post.parameters[0].name).toBe('Idempotency-Key');
    expect(specification.security).toEqual([{ BearerSessionJWT: [] }]);
    expect(specification.components.schemas.CreateSearchRequest.additionalProperties).toBe(false);
  });
  it('accepts exactly the 10,000,000-byte boundary and rejects one extra byte', () => {
    const request = { schemaVersion: 3, declaredMimeType: 'image/jpeg', declaredBytes: 10_000_000 };
    expect(CreateUploadRequestSchema.safeParse(request).success).toBe(true);
    expect(CreateUploadRequestSchema.safeParse({ ...request, declaredBytes: 10_000_001 }).success).toBe(false);
  });
  it.each(['owner', 'model', 'referencePrice', 'provider', 'url'])('rejects client-controlled %s fields', (field) => {
    expect(CreateSearchRequestSchema.safeParse({ schemaVersion: 3, uploadId: fixtureUuid(1), [field]: 'injection' }).success).toBe(false);
  });
  it('rejects old schema and unsupported image MIME types', () => {
    expect(CreateSearchRequestSchema.safeParse({ schemaVersion: 2, uploadId: fixtureUuid(1) }).success).toBe(false);
    expect(CreateUploadRequestSchema.safeParse({ schemaVersion: 3, declaredMimeType: 'image/svg+xml', declaredBytes: 100 }).success).toBe(false);
  });
  it('normalizes query Unicode and controls, defaults category and result limit', () => {
    expect(CreateDealRequestSchema.parse({ schemaVersion: 3, query: '  회색\u0000 맨투맨  ' })).toEqual({ schemaVersion: 3, query: '회색 맨투맨', category: 'ALL', resultLimit: 10 });
    expect(CreateDealRequestSchema.safeParse({ schemaVersion: 3, query: '\u0000 a ' }).success).toBe(false);
  });
  it('bounds idempotency keys separately from request trace IDs', () => {
    expect(IdempotencyKeySchema.safeParse('x'.repeat(16)).success).toBe(true);
    expect(IdempotencyKeySchema.safeParse('x'.repeat(129)).success).toBe(false);
    expect(IdempotencyKeySchema.safeParse('token-with newline\n').success).toBe(false);
  });
  it('does not turn unknown attributes into observed values or infer material composition', () => {
    expect(TargetAnalysisSchema.safeParse({ ...fixtureTarget, material: observed('COTTON') }).success).toBe(false);
    expect(TargetAnalysisSchema.safeParse({ ...fixtureTarget, fit: { value: 'OVERSIZED', state: 'UNKNOWN', source: null } }).success).toBe(false);
    expect(TargetAnalysisSchema.safeParse({ ...fixtureTarget, category: observed('IMAGINED_CATEGORY') }).success).toBe(false);
    expect(TargetAnalysisSchema.safeParse({ ...fixtureTarget, material: { ...observed('COTTON'), source: 'MERCHANT_IMAGE' } }).success).toBe(false);
    expect(AnalysisOutputSchema.safeParse({ supported: true, ambiguousTarget: false, targetAnalysis: { ...fixtureTarget, material: { ...observed('COTTON'), source: 'MERCHANT_METADATA' } }, generatedQueries: ['회색 맨투맨', '오버핏 맨투맨', '작은 레터링 맨투맨', '크루넥 맨투맨'] }).success).toBe(false);
  });
  it('rejects duplicate generated queries and fabricated ordinal precision', () => {
    expect(AnalysisOutputSchema.safeParse({ supported: true, ambiguousTarget: false, targetAnalysis: fixtureTarget, generatedQueries: ['맨투맨', '맨투맨', '회색 맨투맨', '큰 맨투맨'] }).success).toBe(false);
    const entry = { candidateId: fixtureUuid(1), attributes: fixtureMerchantAttributes, visual: { ...fixtureVisual, color: { ...fixtureVisual.color, ordinal: 3.8 } }, matchedAttributes: [], differentAttributes: [], unknownAttributes: [] };
    expect(ComparisonOutputSchema.safeParse({ candidates: [entry] }).success).toBe(false);
  });
  it('rejects duplicate provider candidate IDs', () => {
    const entry = { candidateId: fixtureUuid(1), attributes: fixtureMerchantAttributes, visual: fixtureVisual, matchedAttributes: [], differentAttributes: [], unknownAttributes: [] };
    expect(ComparisonOutputSchema.safeParse({ candidates: [entry] }).success).toBe(true);
    expect(ComparisonOutputSchema.safeParse({ candidates: [entry, entry] }).success).toBe(false);
  });
  it('requires run failures, true terminal times, and bounded deadlines', () => {
    const status = { searchId: fixtureUuid(1), mode: 'IMAGE_SIMILAR', status: 'FAILED', stage: 'ANALYZING', createdAt: '2026-10-09T03:00:00Z', deadlineAt: '2026-10-09T03:01:30Z', completedAt: null, pollAfterMs: 0, progress: { discoveredUrls: 0, deduplicatedUrls: 0, extractedCandidates: 0, comparedCandidates: 0 }, failure: null };
    expect(SearchStatusDataSchema.safeParse(status).success).toBe(false);
    expect(SearchStatusDataSchema.safeParse({ ...status, status: 'RUNNING', deadlineAt: '2026-10-09T04:00:00Z' }).success).toBe(false);
  });
  it('rejects unknown shipping fabricated as free delivery and thumbnail purchase cards', () => {
    const result = projectSnapshot(rankImageCandidates([fixtureCandidate(1)], FIXTURE_TIME)).results[0]!;
    expect(ImageRecommendationSchema.safeParse({ ...result, priceBasis: 'ITEM_PRICE_ONLY', shippingFee: 0 }).success).toBe(false);
    expect(ImageRecommendationSchema.safeParse({ ...result, imageSource: 'search_thumbnail' }).success).toBe(false);
  });
});
