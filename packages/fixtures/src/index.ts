import type { FieldEvidence, TargetAnalysis, VisualRubric } from '@ssandevisthan/contracts';
import type { Candidate, DealCandidate, SimilarityMetrics } from '@ssandevisthan/search-core';

/** SYNTHETIC, offline-only regression fixtures. Never evidence of LIVE search or merchant support. */
export const FIXTURE_MODE = 'SYNTHETIC' as const;
export const FIXTURE_TIME = Date.parse('2026-10-09T03:00:00Z');
export const fixtureUuid = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
export const observed = (value: string) => ({ value, state: 'OBSERVED' as const, source: 'INPUT_IMAGE' as const });
export const unknown = () => ({ value: null, state: 'UNKNOWN' as const, source: null });
export const fixtureTarget: TargetAnalysis = {
  category: observed('SWEATSHIRT'), fit: observed('OVERSIZED'), color: observed('MELANGE_GRAY'),
  shoulder: observed('DROP_SHOULDER'), length: observed('REGULAR'), neck: observed('CREW_NECK'),
  closure: observed('NONE'), graphic: observed('SMALL_LETTERING'), graphicPlacement: observed('LEFT_CHEST'),
  graphicScale: observed('SMALL'), pattern: observed('NONE'), pocket: observed('NONE'),
  detail: observed('RIBBED_CUFF_HEM'), wash: observed('MELANGE'), materialAppearance: observed('SWEATSHIRT_LIKE'), material: unknown(),
};
export const fixtureMerchantAttributes: TargetAnalysis = Object.fromEntries(Object.entries(fixtureTarget).map(([key, attribute]) => [key, {
  ...attribute, source: attribute.state === 'OBSERVED' ? 'MERCHANT_IMAGE' : null,
}])) as TargetAnalysis;
export const fixtureVisual: VisualRubric = {
  silhouette: { targetApplicable: true, ordinal: 4, observation: 'Synthetic equal silhouette.' },
  color: { targetApplicable: true, ordinal: 4, observation: 'Synthetic equal color.' },
  graphic: { targetApplicable: true, ordinal: 4, observation: 'Synthetic equal graphic.' },
  detail: { targetApplicable: true, ordinal: 4, observation: 'Synthetic equal detail.' },
};
export const fixtureMetrics = (visual = .9, attribute = .88): SimilarityMetrics => ({ visualSimilarity: visual, attributeSimilarity: attribute, visualCoverage: 1, attributeCoverage: 1, totalSimilarity: .625 * visual + .375 * attribute, categoryCompatible: true });
export function fixtureCandidate(index: number, overrides: Partial<Candidate> = {}): Candidate {
  const time = new Date(FIXTURE_TIME).toISOString();
  const candidate: Candidate = {
    productId: fixtureUuid(index * 10 + 1), offerId: fixtureUuid(index * 10 + 2), variantId: fixtureUuid(index * 10 + 3), resultGroupKey: `synthetic-${index}`,
    title: `합성 회귀 상품 ${index}`, merchant: 'SYNTHETIC_FIXTURE', source: 'synthetic_fixture',
    productUrl: `https://merchant.example.invalid/product/${index}?variant=gray`, imageUrl: `https://cdn.example.invalid/${index}.webp`,
    imageSource: 'merchant_cdn', imageSourceUrl: `https://merchant.example.invalid/product/${index}?variant=gray`, imageExtractionStage: 'METADATA',
    variant: { color: '멜란지 그레이', size: 'M', availability: 'IN_STOCK', selectionRequired: false },
    currency: 'KRW', itemPrice: 20_000, shippingFee: 0, conditionalPrices: [], priceObservedAt: time, imageObservedAt: time, stockObservedAt: time,
    evidenceIds: [], fieldEvidence: [], matchedAttributes: ['합성 fixture: 오버핏'], differentAttributes: [], unknownAttributes: ['소재 함량'], warnings: [],
    eligibility: { isClothing: true, condition: 'NEW', domesticShipping: 'CONFIRMED', domesticSales: true, overseasDirect: false, rental: false, stockStatus: 'IN_STOCK', productPageVerified: true, imageVerifiedSameProduct: true, imageVerifiedSameVariant: true, isMerchantImage: true, variantVerified: true },
    price: { variantPriceVerified: true, unconditionalPriceVerified: true, shippingFeeVerified: true }, comparison: fixtureMetrics(), ...overrides,
  };
  const evidence = (fieldPath: string, value: unknown, offset: number, observedAt: string): FieldEvidence => ({
    id: fixtureUuid(index * 10 + offset), searchId: fixtureUuid(9999), candidateId: candidate.productId,
    productId: candidate.productId, offerId: candidate.offerId, variantId: candidate.variantId,
    fieldPath, value, sourceUrl: candidate.productUrl, sourceKind: 'MERCHANT_METADATA', extractionMethod: 'SYNTHETIC_ONLY',
    evidenceExcerpt: 'Synthetic test data; not a real merchant observation.', contentSha256: null,
    observedAt, confidence: 'VERIFIED', extractorVersion: 'synthetic-extractor-v1',
  });
  if (!overrides.fieldEvidence) candidate.fieldEvidence = [
    evidence('/imageUrl', candidate.imageUrl, 4, candidate.imageObservedAt),
    evidence('/itemPrice', candidate.itemPrice, 5, candidate.priceObservedAt ?? time),
    evidence('/shippingFee', candidate.shippingFee, 6, candidate.priceObservedAt ?? time),
  ];
  if (!overrides.evidenceIds) candidate.evidenceIds = candidate.fieldEvidence.map((e) => e.id);
  return candidate;
}
export function fixtureDeal(index: number, overrides: Partial<DealCandidate> = {}): DealCandidate {
  return {
    ...fixtureCandidate(index), comparison: null,
    relevance: { category: { query: '맨투맨', candidate: '스웨트셔츠' }, model: null, modifiers: [{ query: '오버핏', candidate: 'oversized' }] },
    dealEvidence: { normalPrice: 20_000, verifiedMerchantPrice: 20_000, claimedCommunityPrice: 1000, conditionalPrices: [], conditions: [], verifiedAt: new Date(FIXTURE_TIME).toISOString(), dealLabel: 'PRICE_DISCOVERY' },
    ...overrides,
  };
}
