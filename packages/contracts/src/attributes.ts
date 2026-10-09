import { z } from 'zod';
import { AttributeSourceSchema, AttributeStateSchema, ScoreSchema, UuidSchema } from './enums.ts';

/** Conservative bootstrap taxonomy, not a claim of calibrated category coverage. */
export const ATTRIBUTE_TAXONOMY_VERSION = 'attribute-taxonomy-v3-bootstrap-1';
export const ATTRIBUTE_VOCABULARY = {
  category: ['SWEATSHIRT', 'HOODIE', 'T_SHIRT', 'SHIRT', 'BLOUSE', 'KNITWEAR', 'CARDIGAN', 'JACKET', 'COAT', 'VEST', 'PANTS', 'JEANS', 'SHORTS', 'SKIRT', 'DRESS', 'SUIT', 'OTHER_CLOTHING'],
  fit: ['OVERSIZED', 'RELAXED', 'REGULAR', 'SLIM', 'FITTED', 'WIDE', 'STRAIGHT', 'TAPERED', 'FLARED'],
  shoulder: ['DROP_SHOULDER', 'SET_IN', 'RAGLAN', 'SLEEVELESS'],
  length: ['CROPPED', 'REGULAR', 'LONG', 'HIP_LENGTH', 'KNEE_LENGTH', 'MIDI', 'MAXI', 'SHORT'],
  color: ['BLACK', 'CHARCOAL', 'GRAY', 'MELANGE_GRAY', 'WHITE', 'IVORY', 'BEIGE', 'BROWN', 'RED', 'PINK', 'ORANGE', 'YELLOW', 'GREEN', 'KHAKI', 'BLUE', 'NAVY', 'PURPLE', 'MULTICOLOR'],
  neck: ['CREW_NECK', 'V_NECK', 'HOOD', 'POLO_COLLAR', 'SHIRT_COLLAR', 'TURTLENECK', 'MOCK_NECK', 'BOAT_NECK', 'SQUARE_NECK', 'HALTER', 'NONE'],
  closure: ['NONE', 'FULL_ZIP', 'HALF_ZIP', 'QUARTER_ZIP', 'BUTTON', 'SNAP', 'DRAWSTRING', 'WRAP'],
  graphic: ['NONE', 'SMALL_LETTERING', 'LARGE_LETTERING', 'SMALL_LOGO', 'LARGE_LOGO', 'SMALL_PRINT', 'LARGE_PRINT', 'ALL_OVER_PRINT', 'EMBROIDERY'],
  graphicPlacement: ['NONE', 'LEFT_CHEST', 'RIGHT_CHEST', 'CENTER_CHEST', 'FULL_FRONT', 'BACK', 'SLEEVE', 'HEM', 'ALL_OVER', 'MULTIPLE'],
  graphicScale: ['NONE', 'SMALL', 'MEDIUM', 'LARGE', 'ALL_OVER'],
  pattern: ['NONE', 'STRIPED', 'CHECKED', 'PLAID', 'POLKA_DOT', 'FLORAL', 'CAMOUFLAGE', 'GEOMETRIC', 'ANIMAL', 'ABSTRACT'],
  pocket: ['NONE', 'KANGAROO', 'CHEST', 'SIDE', 'PATCH', 'CARGO', 'WELT', 'MULTIPLE'],
  detail: ['NONE', 'RIBBED_CUFF_HEM', 'DRAWSTRING', 'PLEATS', 'RUFFLES', 'DISTRESSED', 'CONTRAST_STITCH', 'PANELLED', 'MULTIPLE'],
  wash: ['NONE', 'MELANGE', 'FADED', 'WASHED', 'ACID_WASH', 'DISTRESSED', 'TEXTURED'],
  materialAppearance: ['SWEATSHIRT_LIKE', 'KNIT_LIKE', 'DENIM_LIKE', 'WOVEN_LIKE', 'FLEECE_LIKE', 'LEATHER_LIKE', 'SATIN_LIKE', 'SHEER_LIKE', 'PADDED_LIKE'],
  material: ['COTTON', 'POLYESTER', 'WOOL', 'LINEN', 'SILK', 'NYLON', 'LEATHER', 'BLEND'],
} as const;

export type AttributeKey = keyof typeof ATTRIBUTE_VOCABULARY;
export type AttributeValue<K extends AttributeKey = AttributeKey> = typeof ATTRIBUTE_VOCABULARY[K][number];
function attributeSchema<K extends AttributeKey>(key: K) {
  return z.object({
    value: z.enum(ATTRIBUTE_VOCABULARY[key] as unknown as [string, ...string[]]).nullable(),
    state: AttributeStateSchema, source: AttributeSourceSchema.nullable(),
    confidence: ScoreSchema.optional(), evidenceIds: z.array(UuidSchema).max(20).optional(),
  }).strict().superRefine((value, context) => {
    if (value.state === 'OBSERVED' && (value.value === null || value.source === null))
      context.addIssue({ code: 'custom', message: 'OBSERVED requires a controlled value and source' });
    if (value.state !== 'OBSERVED' && value.value !== null)
      context.addIssue({ code: 'custom', message: 'Unknown and inapplicable attributes must have null values' });
    if (key === 'material' && (value.source === 'INPUT_IMAGE' || value.source === 'MERCHANT_IMAGE') && value.state === 'OBSERVED')
      context.addIssue({ code: 'custom', message: 'Material composition cannot be verified from the input photograph' });
  });
}
export const TargetAnalysisSchema = z.object({
  category: attributeSchema('category'), fit: attributeSchema('fit'),
  shoulder: attributeSchema('shoulder').optional(), length: attributeSchema('length').optional(),
  color: attributeSchema('color'), neck: attributeSchema('neck').optional(),
  closure: attributeSchema('closure').optional(), graphic: attributeSchema('graphic').optional(),
  graphicPlacement: attributeSchema('graphicPlacement').optional(), graphicScale: attributeSchema('graphicScale').optional(),
  pattern: attributeSchema('pattern').optional(), pocket: attributeSchema('pocket').optional(),
  detail: attributeSchema('detail').optional(), wash: attributeSchema('wash').optional(),
  materialAppearance: attributeSchema('materialAppearance').optional(), material: attributeSchema('material').optional(),
}).strict();
export type TargetAnalysis = z.infer<typeof TargetAnalysisSchema>;
export type AttributeObservation = TargetAnalysis['category'];

export const VisualAxisSchema = z.object({
  targetApplicable: z.boolean(), ordinal: z.number().int().min(0).max(4).nullable(),
  observation: z.string().max(500),
}).strict();
export const VisualRubricSchema = z.object({
  silhouette: VisualAxisSchema, color: VisualAxisSchema, graphic: VisualAxisSchema, detail: VisualAxisSchema,
}).strict();
export type VisualRubric = z.infer<typeof VisualRubricSchema>;
export const GeneratedQueriesSchema = z.array(z.string().trim().min(2).max(200)).min(4).max(8)
  .refine((queries) => new Set(queries.map((q) => q.normalize('NFC').toLocaleLowerCase('en-US'))).size === queries.length, 'Duplicate queries');
export const AnalysisOutputSchema = z.object({
  supported: z.boolean(), ambiguousTarget: z.boolean(), targetAnalysis: TargetAnalysisSchema,
  generatedQueries: GeneratedQueriesSchema,
}).strict().superRefine((analysis, context) => {
  for (const attribute of Object.values(analysis.targetAnalysis)) {
    if (attribute?.state === 'OBSERVED' && attribute.source !== 'INPUT_IMAGE')
      context.addIssue({ code: 'custom', message: 'Input-photo analysis cannot claim merchant metadata evidence' });
  }
});
export const ComparisonOutputSchema = z.object({
  candidates: z.array(z.object({
    candidateId: UuidSchema, attributes: TargetAnalysisSchema, visual: VisualRubricSchema,
    matchedAttributes: z.array(z.string().max(200)).max(20),
    differentAttributes: z.array(z.string().max(200)).max(20),
    unknownAttributes: z.array(z.string().max(200)).max(20),
  }).strict()).min(1).max(5),
}).strict().refine((value) => new Set(value.candidates.map((c) => c.candidateId)).size === value.candidates.length, 'Duplicate comparison candidate IDs')
  .superRefine((comparison, context) => {
    for (const candidate of comparison.candidates) {
      if (candidate.attributes.material?.state === 'OBSERVED')
        context.addIssue({ code: 'custom', message: 'Image comparison cannot verify material composition' });
      for (const attribute of Object.values(candidate.attributes)) {
        if (attribute?.state === 'OBSERVED' && attribute.source !== 'MERCHANT_IMAGE')
          context.addIssue({ code: 'custom', message: 'Candidate image comparison cannot claim input or merchant text evidence' });
      }
    }
  });
