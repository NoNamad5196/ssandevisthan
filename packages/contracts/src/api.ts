import { z } from 'zod';
import {
  API_BASE, ApiErrorCodeSchema, DealCategorySchema, ImageExtractionStageSchema,
  ImageSourceSchema, LIMITS, MimeTypeSchema, MoneySchema, RunFailureCodeSchema,
  ScoreSchema, SearchModeSchema, SearchStageSchema, SearchStatusSchema,
  ShippingFeeSchema, SortSchema, StockStatusSchema, TerminalStatusSchema,
  TimestampSchema, UuidSchema, isTerminalStatus,
} from './enums.ts';
import { TargetAnalysisSchema } from './attributes.ts';

export const PublicHttpsUrlSchema = z.string().url().max(4096).refine((input) => {
  const url = new URL(input);
  return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443');
}, 'Public HTTPS URL without credentials required');
export const IdempotencyKeySchema = z.string().min(16).max(128).regex(/^[A-Za-z0-9._~:-]+$/);
export const WarningSchema = z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(80), message: z.string().min(1).max(500) }).strict();
export type Warning = z.infer<typeof WarningSchema>;
export const ApiMetaSchema = z.object({
  requestId: UuidSchema, schemaVersion: z.literal(3), createdAt: TimestampSchema,
  pipelineVersion: z.string().optional(), visionPromptVersion: z.string().optional(),
  queryExpanderVersion: z.string().optional(), extractorVersion: z.string().optional(),
  rankerVersion: z.string().optional(), gateVersion: z.string().optional(),
  pricePolicyVersion: z.string().optional(), sourcePolicyVersion: z.string().optional(),
  dealRankerVersion: z.string().optional(),
  providerFailures: z.array(z.object({ provider: z.string().max(80), code: z.string().max(80), stage: SearchStageSchema.optional() }).strict()).optional(),
  sourceStats: z.object({
    rawUrls: z.number().int().min(0).max(150), dedupUrls: z.number().int().min(0).max(60),
    extractedProducts: z.number().int().min(0).max(30), comparedProducts: z.number().int().min(0).max(20),
    passedSimilarityGate: z.number().int().min(0).max(20), rankableProducts: z.number().int().min(0).max(30),
    countsByPriceBasis: z.object({ TOTAL_PRICE: z.number().int().nonnegative(), ITEM_PRICE_ONLY: z.number().int().nonnegative(), UNKNOWN: z.number().int().nonnegative() }).strict(),
  }).strict().optional(),
}).strict();
export type ApiMeta = z.infer<typeof ApiMetaSchema>;
export const ApiErrorSchema = z.object({
  code: ApiErrorCodeSchema, message: z.string().min(1).max(500), retryable: z.boolean(),
  details: z.object({ field: z.string().max(100).optional(), retryAt: TimestampSchema.optional() }).strict().optional(),
}).strict();
export const RunFailureSchema = z.object({ code: RunFailureCodeSchema, message: z.string().min(1).max(500), retryable: z.boolean() }).strict();
export const ApiFailureEnvelopeSchema = z.object({ ok: z.literal(false), error: ApiErrorSchema, meta: ApiMetaSchema }).strict();
export const successEnvelopeSchema = <T extends z.ZodTypeAny>(data: T) => z.object({ ok: z.literal(true), data, meta: ApiMetaSchema }).strict();
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type ApiSuccess<T> = { ok: true; data: T; meta: ApiMeta };
export type ApiFailure = z.infer<typeof ApiFailureEnvelopeSchema>;
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

// Portable anonymous auth adapter. Server JWT ownership remains authoritative.
export const AccessTokenSchema = z.string().min(20).max(8192).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
export const RefreshTokenSchema = z.string().min(32).max(2048).regex(/^[A-Za-z0-9_-]+$/);
export const AnonymousAuthRequestSchema = z.object({ schemaVersion: z.literal(3) }).strict();
export const RefreshAuthRequestSchema = z.object({ schemaVersion: z.literal(3), refreshToken: RefreshTokenSchema }).strict();
export const AuthSessionDataSchema = z.object({ accessToken: AccessTokenSchema, refreshToken: RefreshTokenSchema, expiresAt: TimestampSchema, userId: UuidSchema }).strict();
export const AuthSessionEnvelopeSchema = successEnvelopeSchema(AuthSessionDataSchema);
export type AuthSessionData = z.infer<typeof AuthSessionDataSchema>;

export const CreateUploadRequestSchema = z.object({ schemaVersion: z.literal(3), declaredMimeType: MimeTypeSchema, declaredBytes: z.number().int().min(1).max(LIMITS.uploadBytes) }).strict();
export const FinalizeUploadRequestSchema = z.object({ schemaVersion: z.literal(3) }).strict();
export const CreateSearchRequestSchema = z.object({ schemaVersion: z.literal(3), uploadId: UuidSchema, resultLimit: z.number().int().min(1).max(10).default(10) }).strict();
export const QUERY_NORMALIZATION_VERSION = 'query-nfc-controls-v3-1';
export const normalizeDealQuery = (query: string) => query.normalize('NFC').replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
export const CreateDealRequestSchema = z.object({
  schemaVersion: z.literal(3), query: z.string().transform(normalizeDealQuery).pipe(z.string().min(2).max(200)),
  category: DealCategorySchema.default('ALL'), resultLimit: z.number().int().min(1).max(10).default(10),
}).strict();
export const ResultQuerySchema = z.object({ sort: SortSchema.default('RECOMMENDED') }).strict();
export const HistoryQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), cursor: z.string().max(500).optional() }).strict();
const RelativeApiUrlSchema = z.string().startsWith(`${API_BASE}/`).max(300);
export const UploadCreatedDataSchema = z.object({ uploadId: UuidSchema, status: z.literal('PENDING'), contentUrl: RelativeApiUrlSchema, expiresAt: TimestampSchema, maxBytes: z.literal(10_000_000), maxPixels: z.literal(24_000_000) }).strict();
export const UploadStoredDataSchema = z.object({ uploadId: UuidSchema, status: z.literal('STORED'), mimeType: z.literal('image/webp'), width: z.number().int().min(1).max(1600), height: z.number().int().min(1).max(1600), normalizedBytes: z.number().int().positive(), expiresAt: TimestampSchema }).strict();
export const UploadReadyDataSchema = z.object({ uploadId: UuidSchema, status: z.literal('READY'), width: z.number().int().min(1).max(1600), height: z.number().int().min(1).max(1600), mimeType: z.literal('image/webp'), expiresAt: TimestampSchema }).strict();
export const SearchCreatedDataSchema = z.object({ searchId: UuidSchema, mode: SearchModeSchema, status: SearchStatusSchema, stage: SearchStageSchema.nullable(), statusUrl: RelativeApiUrlSchema, resultsUrl: RelativeApiUrlSchema, deadlineAt: TimestampSchema, reused: z.boolean() }).strict();
export const ProgressSchema = z.object({ discoveredUrls: z.number().int().min(0).max(150), deduplicatedUrls: z.number().int().min(0).max(60), extractedCandidates: z.number().int().min(0).max(30), comparedCandidates: z.number().int().min(0).max(20) }).strict();
export const SearchStatusDataSchema = z.object({
  searchId: UuidSchema, mode: SearchModeSchema, status: SearchStatusSchema, stage: SearchStageSchema.nullable(),
  createdAt: TimestampSchema, deadlineAt: TimestampSchema, completedAt: TimestampSchema.nullable(),
  pollAfterMs: z.number().int().min(0).max(60_000), progress: ProgressSchema, failure: RunFailureSchema.nullable(),
}).strict().superRefine((data, context) => {
  if (data.status === 'QUEUED' && data.stage !== null) context.addIssue({ code: 'custom', message: 'QUEUED stage must be null' });
  if (data.status === 'RUNNING' && data.stage === null) context.addIssue({ code: 'custom', message: 'RUNNING must have a stage' });
  if (data.status === 'FAILED' && data.failure === null) context.addIssue({ code: 'custom', message: 'FAILED requires failure' });
  if (isTerminalStatus(data.status) && data.completedAt === null) context.addIssue({ code: 'custom', message: 'Terminal status requires completedAt' });
  if (Date.parse(data.deadlineAt) - Date.parse(data.createdAt) > LIMITS.runDeadlineMs) context.addIssue({ code: 'custom', message: 'Deadline exceeds 90 seconds' });
});
export const ConditionalPriceSchema = z.object({ amount: MoneySchema, condition: z.string().min(1).max(300), evidenceIds: z.array(UuidSchema).min(1).max(20) }).strict();
export type ConditionalPrice = z.infer<typeof ConditionalPriceSchema>;
export const VariantSchema = z.object({ color: z.string().max(100).nullable(), size: z.string().max(100).nullable(), availability: StockStatusSchema, selectionRequired: z.boolean() }).strict();
const recommendationShape = {
  productId: UuidSchema, offerId: UuidSchema, variantId: UuidSchema, title: z.string().min(1).max(500),
  merchant: z.string().min(1).max(200), source: z.string().min(1).max(100),
  productUrl: PublicHttpsUrlSchema, imageUrl: PublicHttpsUrlSchema, imageSource: ImageSourceSchema,
  imageSourceUrl: PublicHttpsUrlSchema, imageExtractionStage: ImageExtractionStageSchema, variant: VariantSchema,
  currency: z.literal('KRW'), itemPrice: MoneySchema, shippingFee: ShippingFeeSchema.nullable(),
  effectivePrice: MoneySchema.nullable(), priceBasis: z.enum(['TOTAL_PRICE', 'ITEM_PRICE_ONLY']),
  conditionalPrices: z.array(ConditionalPriceSchema).max(20), cohortRank: z.number().int().min(1).max(30),
  matchedAttributes: z.array(z.string().max(300)).max(30), differentAttributes: z.array(z.string().max(300)).max(30),
  unknownAttributes: z.array(z.string().max(300)).max(30), warnings: z.array(WarningSchema).max(30),
  evidenceIds: z.array(UuidSchema).min(1).max(100), priceObservedAt: TimestampSchema,
  imageObservedAt: TimestampSchema, stockObservedAt: TimestampSchema.nullable(),
};
type OfferPrice = { itemPrice: number; shippingFee: number | null; effectivePrice: number | null; priceBasis: string; imageSource: string; variant: { availability: string } };
function validateOffer(data: OfferPrice, context: z.RefinementCtx) {
  if (data.priceBasis === 'TOTAL_PRICE' && (data.shippingFee === null || data.effectivePrice !== data.itemPrice + data.shippingFee)) context.addIssue({ code: 'custom', message: 'TOTAL_PRICE requires verified shipping and sum' });
  if (data.priceBasis === 'ITEM_PRICE_ONLY' && (data.shippingFee !== null || data.effectivePrice !== null)) context.addIssue({ code: 'custom', message: 'Unknown shipping must remain null' });
  if (data.imageSource === 'placeholder' || data.imageSource === 'search_thumbnail') context.addIssue({ code: 'custom', message: 'Unverified images cannot be recommendations' });
  if (data.variant.availability !== 'IN_STOCK') context.addIssue({ code: 'custom', message: 'Selected variant must be purchasable' });
}
export const ImageRecommendationSchema = z.object({
  ...recommendationShape, visualSimilarity: ScoreSchema, attributeSimilarity: ScoreSchema,
  visualCoverage: ScoreSchema, attributeCoverage: ScoreSchema, totalSimilarity: ScoreSchema,
  priceScore: ScoreSchema, finalScore: ScoreSchema,
}).strict().superRefine(validateOffer);
export const DealEvidenceSchema = z.object({
  normalPrice: MoneySchema.nullable(), verifiedMerchantPrice: MoneySchema.nullable(), claimedCommunityPrice: MoneySchema.nullable(),
  conditionalPrices: z.array(ConditionalPriceSchema).max(20), conditions: z.array(z.string().max(300)).max(20),
  verifiedAt: TimestampSchema.nullable(), dealLabel: z.enum(['PRICE_DISCOVERY', 'HOT_DEAL']),
}).strict();
export const DealRecommendationSchema = z.object({
  ...recommendationShape, visualSimilarity: z.null(), visualCoverage: z.null(),
  attributeSimilarity: z.null(), attributeCoverage: z.null(), totalSimilarity: z.null(),
  finalScore: z.null(), priceScore: z.null(), dealRelevance: ScoreSchema,
  dealRankerVersion: z.string().min(1), dealEvidence: DealEvidenceSchema,
}).strict().superRefine(validateOffer);
export const ReferenceSchema = z.object({
  productId: UuidSchema, title: z.string().min(1).max(500), merchant: z.string().min(1).max(200),
  productUrl: PublicHttpsUrlSchema, imageUrl: PublicHttpsUrlSchema,
  reasonCode: z.enum(['PRICE_UNKNOWN', 'STALE_PRICE', 'VARIANT_PRICE_UNKNOWN']),
  matchedAttributes: z.array(z.string().max(300)).max(30), differentAttributes: z.array(z.string().max(300)).max(30),
  unknownAttributes: z.array(z.string().max(300)).max(30), imageObservedAt: TimestampSchema,
  priceObservedAt: TimestampSchema.nullable(), evidenceIds: z.array(UuidSchema).min(1).max(100),
  itemPrice: z.null(), priceBasis: z.literal('UNKNOWN'), priceScore: z.null(), finalScore: z.null(), cohortRank: z.null(),
}).strict();
const resultsCommon = {
  searchId: UuidSchema, status: TerminalStatusSchema, stage: SearchStageSchema.nullable(),
  references: z.array(ReferenceSchema).max(5), warnings: z.array(WarningSchema).max(30),
  completedAt: TimestampSchema, expiresAt: TimestampSchema, sort: SortSchema,
  failure: RunFailureSchema.nullable().optional(),
};
export const SearchResultsDataSchema = z.discriminatedUnion('mode', [
  z.object({ ...resultsCommon, mode: z.literal('IMAGE_SIMILAR'), targetAnalysis: TargetAnalysisSchema.nullable(), generatedQueries: z.array(z.string().max(200)).max(8), identifiedOriginal: z.null(), results: z.array(ImageRecommendationSchema).max(10) }).strict(),
  z.object({ ...resultsCommon, mode: z.literal('DEAL_TEXT'), results: z.array(DealRecommendationSchema).max(10), query: z.string().min(2).max(200), category: DealCategorySchema }).strict(),
]).superRefine((data, context) => {
  const success = data.status === 'COMPLETED' || data.status === 'PARTIAL';
  if (success !== (data.results.length > 0)) context.addIssue({ code: 'custom', message: 'Only COMPLETED/PARTIAL may contain purchase recommendations' });
  if (data.status === 'FAILED' && !data.failure) context.addIssue({ code: 'custom', message: 'FAILED requires failure' });
  if (data.mode === 'DEAL_TEXT' && data.sort === 'MOST_SIMILAR') context.addIssue({ code: 'custom', message: 'UNSUPPORTED_SORT_FOR_MODE' });
});
export const SearchHistoryDataSchema = z.object({ items: z.array(SearchStatusDataSchema).max(50), nextCursor: z.string().max(500).nullable() }).strict();

export type CreateUploadRequest = z.infer<typeof CreateUploadRequestSchema>;
export type CreateSearchRequest = z.infer<typeof CreateSearchRequestSchema>;
export type CreateDealRequest = z.infer<typeof CreateDealRequestSchema>;
export type UploadCreatedData = z.infer<typeof UploadCreatedDataSchema>;
export type UploadStoredData = z.infer<typeof UploadStoredDataSchema>;
export type UploadReadyData = z.infer<typeof UploadReadyDataSchema>;
export type SearchCreatedData = z.infer<typeof SearchCreatedDataSchema>;
export type SearchStatusData = z.infer<typeof SearchStatusDataSchema>;
export type SearchResultsData = z.infer<typeof SearchResultsDataSchema>;
export type ImageRecommendation = z.infer<typeof ImageRecommendationSchema>;
export type DealRecommendation = z.infer<typeof DealRecommendationSchema>;
export type Reference = z.infer<typeof ReferenceSchema>;
export type DealEvidence = z.infer<typeof DealEvidenceSchema>;
