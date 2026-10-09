import { z } from 'zod';

const id = z.string().trim().min(1).max(500);
const time = z.iso.datetime();
const nullableText = id.nullable();
export const SplitSchema = z.enum(['tune', 'holdout']);
export const GradeSchema = z.enum(['GOOD', 'ACCEPTABLE', 'BAD']);
export const REQUIRED_SLICES = ['BASIC', 'PRINT_LETTERING', 'SILHOUETTE', 'WASH_TEXTURE', 'SMALL_DETAIL', 'MODEL_BACKGROUND_ANGLE', 'OCCLUDED', 'MULTIPLE_GARMENTS', 'LOW_RESOLUTION', 'MANY_ALTERNATIVES', 'SCARCE_ALTERNATIVES', 'NON_CLOTHING', 'UNDETERMINABLE', 'OVERSEAS_TRAP', 'USED_TRAP', 'RENTAL_TRAP', 'CONDITIONAL_PRICE_TRAP', 'OUT_OF_STOCK_TRAP'] as const;
const rights = z.object({ status: z.enum(['CONFIRMED', 'PENDING', 'REJECTED']), basis: nullableText, reviewedBy: nullableText }).strict();
const adjudication = z.object({ reviewedBy: id, reason: id, resolvedAt: time }).strict().nullable();
export const TargetLabelsSchema = z.object({
  support: z.enum(['SUPPORTED', 'UNSUPPORTED', 'UNDETERMINED']).nullable(), category: nullableText,
  requiredVisualAttributes: z.array(id).nullable(), optionalAttributes: z.array(id).nullable(), unobservableAttributes: z.array(id).nullable(),
  polarity: z.enum(['positive', 'negative']).nullable(), polarityRationale: nullableText,
  availableAlternativeCount: z.number().int().nonnegative().nullable(),
}).strict();
export const CandidateLabelsSchema = z.object({
  grade: GradeSchema.nullable(), reason: nullableText, domesticNewEligibility: z.enum(['ELIGIBLE', 'EXCLUDED', 'UNKNOWN']).nullable(),
}).strict();
const review = <T extends z.ZodType>(judgment: T) => z.object({ reviewerId: id, independent: z.boolean(), blindedToPrice: z.boolean(), blindedToSystemScore: z.boolean(), completedAt: time, judgment }).strict();
export const CandidateSchema = z.object({
  candidateId: id, canonicalProductId: nullableText, canonicalOfferId: nullableText, productGroupId: nullableText, merchant: nullableText,
  productUrl: z.url().nullable(), observedAt: time.nullable(), productEvidence: nullableText, imageEvidence: nullableText, priceEvidence: nullableText,
  rights, labels: CandidateLabelsSchema, reviews: z.array(review(CandidateLabelsSchema)), adjudication,
}).strict();
export const TargetSchema = z.object({
  targetId: id, targetGroupId: id, split: SplitSchema, imageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  source: nullableText, rights,
  groupKeys: z.object({ productId: nullableText, pageImageUrl: z.url().nullable(), shootingSessionId: nullableText, parentImageSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable() }).strict(),
  slices: z.array(z.enum(REQUIRED_SLICES)), labels: TargetLabelsSchema,
  reviews: z.array(review(TargetLabelsSchema)), adjudication, candidates: z.array(CandidateSchema),
}).strict();
export const ManifestSchema = z.object({
  schemaVersion: z.literal(1), datasetVersion: id, createdAt: time,
  provenance: z.enum(['REAL', 'SYNTHETIC']), mode: z.enum(['IMAGE_SIMILAR', 'DEAL_TEXT']),
  categoryMinimums: z.record(id, z.number().int().nonnegative()),
  crossDistributionMinimums: z.array(z.object({ category: id, slice: z.enum(REQUIRED_SLICES), minimum: z.number().int().nonnegative() }).strict()),
  groupingAudit: z.object({ confirmed: z.boolean(), reviewedBy: nullableText, evidence: nullableText }).strict(),
  holdout: z.object({ sealedAt: time.nullable(), sealSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(), tuningCompletedAt: time.nullable(), unsealedAt: time.nullable(), usedForTuningAfterExposure: z.boolean() }).strict(),
  targets: z.array(TargetSchema),
}).strict();
export const ResultSchema = z.object({
  candidateId: id, itemPrice: z.number().nullable(), currency: id, unconditionalPriceVerified: z.boolean(),
  shippingFee: z.number().nullable(), shippingFeeVerified: z.boolean(), priceObservedAt: time.nullable(),
  priceBasis: z.enum(['TOTAL_PRICE', 'ITEM_PRICE_ONLY', 'UNKNOWN']),
  displayed: z.object({ price: z.boolean(), source: z.boolean(), observedAt: z.boolean(), comparisonBasis: z.boolean() }).strict(),
}).strict();
export const AttemptSchema = z.object({
  attemptId: id, targetId: id, attempt: z.number().int().positive(), startedAt: time, finishedAt: time,
  status: z.enum(['COMPLETED', 'PARTIAL', 'NO_RELIABLE_MATCH', 'FAILED', 'CANCELED', 'EXPIRED']),
  sourceStatus: z.enum(['SUCCESS', 'PARTIAL', 'FAILED', 'NOT_RUN']),
  results: z.array(ResultSchema).max(10), references: z.array(id).max(5),
  gateDecisions: z.array(z.object({ candidateId: id, passed: z.boolean(), reasons: z.array(id) }).strict()).max(60),
  discoveredDomains: z.array(id).max(150),
  sourceExtractions: z.array(z.object({ domain: id, attempted: z.number().int().nonnegative().max(30), succeeded: z.number().int().nonnegative().max(30) }).strict()).max(30),
  failureReasons: z.array(id),
}).strict();
export const RunBundleSchema = z.object({
  schemaVersion: z.literal(1), evaluationId: id, executedAt: time, gitSha: z.string().regex(/^[a-f0-9]{40}$/), environment: id,
  datasetVersion: id, split: SplitSchema, kind: z.enum(['LIVE', 'REPLAY']), provider: id, model: id,
  versions: z.object({ pipeline: id, prompt: id, extractor: id, ranker: id, pricePolicy: id, sourcePolicy: id }).strict(),
  budget: z.object({ reservedMicrousd: z.number().int().nonnegative().nullable(), actualMicrousd: z.number().int().nonnegative().nullable() }).strict(),
  author: id, reviewer: nullableText, hardFailAudit: z.object({ status: z.enum(['PENDING', 'COMPLETE']), reviewedBy: nullableText, evidence: nullableText, findings: z.array(z.object({ code: id, targetId: nullableText, detail: id }).strict()) }).strict(),
  // Baseline targets require a separately approved definition; no numerical
  // Fixed P@5 / nDCG / source coverage threshold is invented by this harness.
  baselineReview: z.object({ approved: z.boolean(), evaluationId: nullableText, sameDatasetSplitFixtureCriteria: z.boolean(), noRegression: z.boolean(), fixedPrecisionTargetMet: z.boolean(), ndcgTargetMet: z.boolean(), sourceCoverageTargetMet: z.boolean(), approvedBy: nullableText, evidence: nullableText }).strict(),
  attempts: z.array(AttemptSchema),
}).strict();
export type Manifest = z.infer<typeof ManifestSchema>;
export type Target = z.infer<typeof TargetSchema>;
export type Candidate = z.infer<typeof CandidateSchema>;
export type Attempt = z.infer<typeof AttemptSchema>;
export type RunBundle = z.infer<typeof RunBundleSchema>;
