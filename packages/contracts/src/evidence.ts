import { z } from 'zod';
import { EvidenceConfidenceSchema, EvidenceSourceKindSchema, TimestampSchema, UuidSchema } from './enums.ts';
import { PublicHttpsUrlSchema } from './api.ts';

export const FieldEvidenceSchema = z.object({
  id: UuidSchema, searchId: UuidSchema, candidateId: UuidSchema.nullable(),
  productId: UuidSchema.nullable(), offerId: UuidSchema.nullable(), variantId: UuidSchema.nullable(),
  fieldPath: z.string().startsWith('/').max(200), value: z.unknown(), sourceUrl: PublicHttpsUrlSchema,
  sourceKind: EvidenceSourceKindSchema, extractionMethod: z.string().min(1).max(200),
  evidenceExcerpt: z.string().max(1000).nullable(), contentSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  observedAt: TimestampSchema, confidence: EvidenceConfidenceSchema, extractorVersion: z.string().min(1).max(100),
}).strict();
export type FieldEvidence = z.infer<typeof FieldEvidenceSchema>;
