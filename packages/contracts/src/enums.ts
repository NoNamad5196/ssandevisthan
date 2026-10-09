import { z } from 'zod';

export const SCHEMA_VERSION = 3 as const;
export const API_BASE = '/functions/v1/api/v3';
export const LIMITS = Object.freeze({
  uploadBytes: 10_000_000, uploadPixels: 24_000_000, normalizedLongestEdge: 1600,
  runDeadlineMs: 90_000, workerLeaseMs: 20_000, commitMarginMs: 2_000,
  queriesMin: 4, queriesMax: 8, rawUrls: 150, dedupUrls: 60,
  extractionCandidates: 30, comparisonCandidates: 20, comparisonBatch: 5,
  results: 10, references: 5, analyzeExpandRequests: 2, discoveryRequests: 8,
  comparisonRequests: 4, totalPaidRequests: 14, attemptsPerOperation: 2,
  normalizedImageTtlMs: 3_600_000, terminalCleanupMs: 300_000,
  snapshotTtlMs: 604_800_000, priceFreshnessMs: 300_000,
  htmlBytes: 2_000_000, fetchTimeoutMs: 8_000, redirects: 3,
  globalActiveSearches: 2, ownerActiveSearches: 1, createsPerTenMinutes: 5,
  pilotBudgetMicroUsd: 20_000_000,
});

export const SearchModeSchema = z.enum(['IMAGE_SIMILAR', 'DEAL_TEXT']);
export const SearchStatusSchema = z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'NO_RELIABLE_MATCH', 'FAILED', 'CANCELED', 'EXPIRED']);
export const TerminalStatusSchema = z.enum(['COMPLETED', 'PARTIAL', 'NO_RELIABLE_MATCH', 'FAILED', 'CANCELED', 'EXPIRED']);
export const SearchStageSchema = z.enum(['VALIDATING', 'ANALYZING', 'DISCOVERING', 'EXTRACTING', 'COMPARING', 'RANKING']);
export const UploadStatusSchema = z.enum(['PENDING', 'PROCESSING', 'STORED', 'READY', 'CONSUMED', 'DELETING', 'DELETED', 'EXPIRED']);
export const JobStateSchema = z.enum(['READY', 'LEASED', 'DONE', 'FAILED', 'CANCELED']);
export const SortSchema = z.enum(['RECOMMENDED', 'MOST_SIMILAR', 'LOWEST_PRICE']);
export const DealCategorySchema = z.enum(['FASHION', 'LIVING', 'ALL']);
export const PriceBasisSchema = z.enum(['TOTAL_PRICE', 'ITEM_PRICE_ONLY', 'UNKNOWN']);
export const ImageSourceSchema = z.enum(['merchant_page', 'merchant_cdn', 'merchant_metadata', 'search_thumbnail', 'fallback_same_product', 'placeholder']);
export const ImageExtractionStageSchema = z.enum(['STATIC_HTML', 'METADATA', 'BROWSER_DOM', 'BROWSER_NETWORK', 'SEARCH_THUMBNAIL', 'FALLBACK_SEARCH', 'PLACEHOLDER']);
export const AttributeStateSchema = z.enum(['OBSERVED', 'UNKNOWN', 'NOT_APPLICABLE']);
export const AttributeSourceSchema = z.enum(['INPUT_IMAGE', 'MERCHANT_IMAGE', 'MERCHANT_PAGE', 'MERCHANT_METADATA']);
export const EvidenceSourceKindSchema = z.enum(['MERCHANT_PAGE', 'MERCHANT_METADATA', 'MERCHANT_IMAGE', 'SEARCH_RESULT', 'COMMUNITY_POST', 'MODEL_INFERENCE']);
export const EvidenceConfidenceSchema = z.enum(['VERIFIED', 'PROBABLE', 'UNKNOWN']);
export const StockStatusSchema = z.enum(['IN_STOCK', 'OUT_OF_STOCK', 'UNKNOWN']);
export const ConditionSchema = z.enum(['NEW', 'USED', 'UNKNOWN']);
export const DomesticShippingSchema = z.enum(['CONFIRMED', 'REJECTED', 'UNKNOWN']);
export const MimeTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);
export const RejectReasonSchema = z.enum([
  'NOT_CLOTHING', 'CATEGORY_MISMATCH', 'NOT_NEW', 'OVERSEAS_DIRECT', 'RENTAL',
  'OUT_OF_STOCK', 'ELIGIBILITY_UNKNOWN', 'PRODUCT_PAGE_UNVERIFIED', 'IMAGE_UNVERIFIED',
  'VARIANT_MISMATCH', 'LOW_VISUAL_SIMILARITY', 'LOW_ATTRIBUTE_SIMILARITY',
  'LOW_TOTAL_SIMILARITY', 'LOW_VISUAL_COVERAGE', 'LOW_ATTRIBUTE_COVERAGE',
  'INSUFFICIENT_VISUAL_EVIDENCE', 'COMPARISON_FAILED',
]);
export const ApiErrorCodeSchema = z.enum([
  'INVALID_INPUT', 'INVALID_SCHEMA_VERSION', 'INVALID_IMAGE', 'UNAUTHENTICATED',
  'TOKEN_EXPIRED', 'NOT_FOUND', 'IDEMPOTENCY_KEY_REUSED', 'UPLOAD_ALREADY_CONSUMED',
  'UPLOAD_NOT_READY', 'UPLOAD_CONTENT_CHANGED', 'UPLOAD_PROCESSING', 'UPLOAD_IN_USE',
  'UPLOAD_EXPIRED', 'SEARCH_DELETED', 'SEARCH_EXPIRED', 'IMAGE_TOO_LARGE',
  'IMAGE_DIMENSIONS_EXCEEDED', 'UNSUPPORTED_MEDIA_TYPE', 'UNSUPPORTED_CATEGORY',
  'UNSUPPORTED_SORT_FOR_MODE', 'RATE_LIMITED', 'BUDGET_LIMITED', 'FREE_QUOTA_EXHAUSTED',
  'INTERNAL_ERROR', 'TEMPORARILY_UNAVAILABLE',
]);
// Provider and extraction failures are run diagnostics, not new public run states.
export const RunFailureCodeSchema = z.enum([
  ...ApiErrorCodeSchema.options, 'OPERATOR_STOP', 'AMBIGUOUS_TARGET',
  'INSUFFICIENT_VISUAL_EVIDENCE', 'PROVIDER_UNAVAILABLE', 'PROVIDER_TIMEOUT',
  'PROVIDER_REFUSAL', 'PROVIDER_OUTPUT_INVALID', 'COMPARISON_FAILED',
  'DISCOVERY_FAILED', 'EXTRACTION_FAILED', 'DEADLINE_EXCEEDED',
]);
export const ExtractionFailureCodeSchema = z.enum(['BLOCKED', 'RATE_LIMITED', 'PAGE_NOT_PRODUCT', 'VARIANT_AMBIGUOUS', 'NO_RELIABLE_PRODUCT_IMAGE', 'AMBIGUOUS_IMAGE', 'IMAGE_DOWNLOAD_FAILED', 'QUOTA_EXHAUSTED', 'TIMEOUT']);
export const UuidSchema = z.string().uuid();
export const TimestampSchema = z.string().datetime({ offset: false });
export const ScoreSchema = z.number().finite().min(0).max(1);
export const MoneySchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const ShippingFeeSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export type SearchMode = z.infer<typeof SearchModeSchema>;
export type SearchStatus = z.infer<typeof SearchStatusSchema>;
export type TerminalStatus = z.infer<typeof TerminalStatusSchema>;
export type SearchStage = z.infer<typeof SearchStageSchema>;
export type Sort = z.infer<typeof SortSchema>;
export type PriceBasis = z.infer<typeof PriceBasisSchema>;
export type ImageSource = z.infer<typeof ImageSourceSchema>;
export type ImageExtractionStage = z.infer<typeof ImageExtractionStageSchema>;
export type RejectReason = z.infer<typeof RejectReasonSchema>;
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type DealCategory = z.infer<typeof DealCategorySchema>;
export const isTerminalStatus = (status: SearchStatus): status is TerminalStatus => status !== 'QUEUED' && status !== 'RUNNING';
