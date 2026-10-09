import {
  ImageRecommendationSchema, DealRecommendationSchema, ReferenceSchema, LIMITS,
  type ConditionalPrice, type DealEvidence, type DealRecommendation, type FieldEvidence,
  type ImageExtractionStage, type ImageRecommendation, type ImageSource, type Reference,
  type SearchMode, type Sort, type Warning,
} from '@ssandevisthan/contracts';
import { SEARCH_VERSIONS } from './config.ts';
import { checkSourceEligibility, hasVerifiedFieldEvidence, type SourceEligibility } from './eligibility.ts';
import { evaluateSimilarityGate, type SimilarityMetrics } from './similarity.ts';
import { calculatePriceScores, normalizePrice, type NormalizedPrice } from './price.ts';
import { evaluateDealRelevance, type DealRelevanceInput } from './deals.ts';

export interface Candidate {
  productId: string; offerId: string; variantId: string; resultGroupKey: string;
  title: string; merchant: string; source: string; productUrl: string; imageUrl: string;
  imageSource: ImageSource; imageSourceUrl: string; imageExtractionStage: ImageExtractionStage;
  variant: { color: string | null; size: string | null; availability: 'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN'; selectionRequired: boolean };
  currency: 'KRW'; itemPrice: number | null; shippingFee: number | null;
  conditionalPrices: ConditionalPrice[]; priceObservedAt: string | null;
  imageObservedAt: string; stockObservedAt: string | null; evidenceIds: string[];
  fieldEvidence: FieldEvidence[];
  matchedAttributes: string[]; differentAttributes: string[]; unknownAttributes: string[]; warnings: Warning[];
  eligibility: SourceEligibility;
  price: { variantPriceVerified: boolean; unconditionalPriceVerified: boolean; shippingFeeVerified: boolean };
  comparison: SimilarityMetrics | null;
}
export interface DealCandidate extends Candidate { relevance: DealRelevanceInput; dealEvidence: DealEvidence }
export type Recommendation = ImageRecommendation | DealRecommendation;
export interface RankingSnapshot {
  mode: SearchMode;
  eligible: Recommendation[];
  references: Reference[];
  sortOrders: { RECOMMENDED: string[]; LOWEST_PRICE: string[]; MOST_SIMILAR?: string[] };
  versions: typeof SEARCH_VERSIONS;
  countsByPriceBasis: { TOTAL_PRICE: number; ITEM_PRICE_ONLY: number; UNKNOWN: number };
  diagnostics: { offerId: string; reasons: string[] }[];
}
type Prepared = { candidate: Candidate; price: NormalizedPrice; relevance: number | null };
const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const comparablePrice = (value: { priceBasis: string; effectivePrice: number | null; itemPrice: number | null }) => value.priceBasis === 'TOTAL_PRICE' ? value.effectivePrice! : value.itemPrice!;
const basisPriority = (basis: string) => basis === 'TOTAL_PRICE' ? 0 : basis === 'ITEM_PRICE_ONLY' ? 1 : 2;
function prepare(candidate: Candidate, now: number, mode: SearchMode): { value: Prepared | null; reasons: string[] } {
  const eligibility = checkSourceEligibility(candidate.eligibility, mode, candidate.imageSource);
  if (candidate.variant.availability !== 'IN_STOCK') eligibility.reasons.push('OUT_OF_STOCK');
  if (!hasVerifiedFieldEvidence(candidate.fieldEvidence, candidate, '/imageUrl', candidate.imageUrl, candidate.imageObservedAt)) eligibility.reasons.push('IMAGE_UNVERIFIED');
  eligibility.pass = eligibility.reasons.length === 0;
  let relevance: number | null = null;
  const gate = mode === 'IMAGE_SIMILAR' ? evaluateSimilarityGate(candidate.comparison, eligibility) : eligibility;
  if (!gate.pass) return { value: null, reasons: gate.reasons };
  if (mode === 'DEAL_TEXT') {
    const textGate = evaluateDealRelevance((candidate as DealCandidate).relevance);
    if (!textGate.pass) return { value: null, reasons: textGate.reasons };
    relevance = textGate.dealRelevance;
  }
  const verifiedPrice = hasVerifiedFieldEvidence(candidate.fieldEvidence, candidate, '/itemPrice', candidate.itemPrice, candidate.priceObservedAt);
  const verifiedShipping = hasVerifiedFieldEvidence(candidate.fieldEvidence, candidate, '/shippingFee', candidate.shippingFee);
  const price = normalizePrice({
    itemPrice: candidate.itemPrice, shippingFee: candidate.shippingFee, currency: candidate.currency,
    variantPriceVerified: candidate.price.variantPriceVerified,
    unconditionalPriceVerified: candidate.price.unconditionalPriceVerified && verifiedPrice,
    shippingFeeVerified: candidate.price.shippingFeeVerified && verifiedShipping,
    priceObservedAt: candidate.priceObservedAt,
  }, now);
  return { value: { candidate, price, relevance }, reasons: price.reasonCode ? [price.reasonCode] : [] };
}
function representativeOrder(a: Prepared, b: Prepared): number {
  return basisPriority(a.price.priceBasis) - basisPriority(b.price.priceBasis)
    || (a.price.priceBasis !== 'UNKNOWN' && b.price.priceBasis !== 'UNKNOWN' ? comparablePrice(a.price) - comparablePrice(b.price) : 0)
    || Date.parse(b.candidate.priceObservedAt ?? '1970-01-01T00:00:00Z') - Date.parse(a.candidate.priceObservedAt ?? '1970-01-01T00:00:00Z')
    || lexical(a.candidate.offerId, b.candidate.offerId);
}
function prepareCandidates(candidates: readonly Candidate[], now: number, mode: SearchMode) {
  if (candidates.length > LIMITS.extractionCandidates || (mode === 'IMAGE_SIMILAR' && candidates.filter((c) => c.comparison !== null).length > LIMITS.comparisonCandidates)) throw new Error('CANDIDATE_LIMIT_EXCEEDED');
  const groups = new Map<string, Prepared>();
  const diagnostics: RankingSnapshot['diagnostics'] = [];
  for (const candidate of candidates) {
    const { value, reasons } = prepare(candidate, now, mode);
    if (reasons.length) diagnostics.push({ offerId: candidate.offerId, reasons });
    if (!value) continue;
    // A missing identity never merges unrelated products merely because their images look similar.
    const key = candidate.resultGroupKey || candidate.offerId;
    const existing = groups.get(key);
    if (!existing || representativeOrder(value, existing) < 0) groups.set(key, value);
  }
  // Repeated discovery of one offer cannot inflate the percentile distribution.
  const offers = new Map<string, Prepared>();
  for (const value of groups.values()) {
    const existing = offers.get(value.candidate.offerId);
    if (!existing || representativeOrder(value, existing) < 0) offers.set(value.candidate.offerId, value);
  }
  return { values: [...offers.values()], diagnostics };
}
function commonOffer({ candidate: c, price }: Prepared) {
  return {
    productId: c.productId, offerId: c.offerId, variantId: c.variantId, title: c.title,
    merchant: c.merchant, source: c.source, productUrl: c.productUrl, imageUrl: c.imageUrl,
    imageSource: c.imageSource, imageSourceUrl: c.imageSourceUrl, imageExtractionStage: c.imageExtractionStage,
    variant: c.variant, currency: c.currency, itemPrice: price.itemPrice!, shippingFee: price.shippingFee,
    effectivePrice: price.effectivePrice, priceBasis: price.priceBasis as 'TOTAL_PRICE' | 'ITEM_PRICE_ONLY',
    conditionalPrices: c.conditionalPrices, cohortRank: 1,
    matchedAttributes: c.matchedAttributes, differentAttributes: c.differentAttributes, unknownAttributes: c.unknownAttributes,
    warnings: [...c.warnings, ...(price.priceBasis === 'ITEM_PRICE_ONLY' ? [{ code: 'SHIPPING_UNKNOWN', message: '배송비를 확인하지 못해 상품가끼리 비교했어요.' }] : [])],
    evidenceIds: c.evidenceIds, priceObservedAt: c.priceObservedAt!, imageObservedAt: c.imageObservedAt, stockObservedAt: c.stockObservedAt,
  };
}
function makeReference(value: Prepared): Reference {
  const c = value.candidate;
  return ReferenceSchema.parse({
    productId: c.productId, title: c.title, merchant: c.merchant, productUrl: c.productUrl, imageUrl: c.imageUrl,
    reasonCode: value.price.reasonCode ?? 'PRICE_UNKNOWN', matchedAttributes: c.matchedAttributes,
    differentAttributes: c.differentAttributes, unknownAttributes: c.unknownAttributes,
    imageObservedAt: c.imageObservedAt, priceObservedAt: c.priceObservedAt, evidenceIds: c.evidenceIds,
    itemPrice: null, priceBasis: 'UNKNOWN', priceScore: null, finalScore: null, cohortRank: null,
  });
}
function orderImage(a: ImageRecommendation, b: ImageRecommendation, sort: Sort): number {
  const basis = basisPriority(a.priceBasis) - basisPriority(b.priceBasis);
  if (sort === 'MOST_SIMILAR') return b.totalSimilarity - a.totalSimilarity || b.visualSimilarity - a.visualSimilarity
    || basis || comparablePrice(a) - comparablePrice(b) || lexical(a.offerId, b.offerId);
  if (sort === 'LOWEST_PRICE') return basis || comparablePrice(a) - comparablePrice(b)
    || b.totalSimilarity - a.totalSimilarity || lexical(a.offerId, b.offerId);
  return basis || b.finalScore - a.finalScore || b.totalSimilarity - a.totalSimilarity
    || comparablePrice(a) - comparablePrice(b) || Date.parse(b.priceObservedAt) - Date.parse(a.priceObservedAt)
    || lexical(a.offerId, b.offerId);
}
function orderDeal(a: DealRecommendation, b: DealRecommendation): number {
  return basisPriority(a.priceBasis) - basisPriority(b.priceBasis) || comparablePrice(a) - comparablePrice(b)
    || b.dealRelevance - a.dealRelevance || Date.parse(b.priceObservedAt) - Date.parse(a.priceObservedAt)
    || lexical(a.offerId, b.offerId);
}
function countBases(values: readonly Prepared[]): RankingSnapshot['countsByPriceBasis'] {
  const counts = { TOTAL_PRICE: 0, ITEM_PRICE_ONLY: 0, UNKNOWN: 0 };
  for (const value of values) counts[value.price.priceBasis]++;
  return counts;
}
export function rankImageCandidates(candidates: readonly Candidate[], now: number): RankingSnapshot {
  const { values, diagnostics } = prepareCandidates(candidates, now, 'IMAGE_SIMILAR');
  const eligible: ImageRecommendation[] = [];
  for (const basis of ['TOTAL_PRICE', 'ITEM_PRICE_ONLY'] as const) {
    const cohort = values.filter((v) => v.price.priceBasis === basis);
    const prices = calculatePriceScores(cohort.map((v) => comparablePrice(v.price)));
    cohort.forEach((value, index) => {
      const metrics = value.candidate.comparison!;
      eligible.push(ImageRecommendationSchema.parse({
        ...commonOffer(value), visualSimilarity: metrics.visualSimilarity, visualCoverage: metrics.visualCoverage,
        attributeSimilarity: metrics.attributeSimilarity, attributeCoverage: metrics.attributeCoverage,
        totalSimilarity: metrics.totalSimilarity, priceScore: prices[index],
        finalScore: .50 * metrics.visualSimilarity! + .30 * metrics.attributeSimilarity! + .20 * prices[index]!,
      }));
    });
  }
  const sortOrders = {
    RECOMMENDED: [...eligible].sort((a, b) => orderImage(a, b, 'RECOMMENDED')).map((v) => v.offerId),
    LOWEST_PRICE: [...eligible].sort((a, b) => orderImage(a, b, 'LOWEST_PRICE')).map((v) => v.offerId),
    MOST_SIMILAR: [...eligible].sort((a, b) => orderImage(a, b, 'MOST_SIMILAR')).map((v) => v.offerId),
  };
  const references = values.filter((v) => v.price.priceBasis === 'UNKNOWN')
    .sort((a, b) => b.candidate.comparison!.totalSimilarity! - a.candidate.comparison!.totalSimilarity! || lexical(a.candidate.offerId, b.candidate.offerId))
    .slice(0, LIMITS.references).map(makeReference);
  return makeSnapshot({ mode: 'IMAGE_SIMILAR', eligible, references, sortOrders, versions: SEARCH_VERSIONS, countsByPriceBasis: countBases(values), diagnostics });
}
export function rankDealCandidates(candidates: readonly DealCandidate[], now: number): RankingSnapshot {
  const { values, diagnostics } = prepareCandidates(candidates, now, 'DEAL_TEXT');
  const eligible = values.filter((v) => v.price.priceBasis !== 'UNKNOWN').map((value) => {
    const evidence = (value.candidate as DealCandidate).dealEvidence;
    // A HOT_DEAL assertion requires separate historical comparison evidence, which v1 does not infer.
    const safeEvidence = { ...evidence, normalPrice: value.price.itemPrice, verifiedMerchantPrice: value.price.itemPrice, verifiedAt: value.candidate.priceObservedAt, dealLabel: 'PRICE_DISCOVERY' as const };
    return DealRecommendationSchema.parse({
      ...commonOffer(value), visualSimilarity: null, visualCoverage: null, attributeSimilarity: null,
      attributeCoverage: null, totalSimilarity: null, finalScore: null, priceScore: null,
      dealRelevance: value.relevance, dealRankerVersion: SEARCH_VERSIONS.dealRankerVersion, dealEvidence: safeEvidence,
    });
  }).sort(orderDeal);
  const ordered = eligible.map((v) => v.offerId);
  const references = values.filter((v) => v.price.priceBasis === 'UNKNOWN').sort((a, b) => b.relevance! - a.relevance! || lexical(a.candidate.offerId, b.candidate.offerId)).slice(0, LIMITS.references).map(makeReference);
  return makeSnapshot({ mode: 'DEAL_TEXT', eligible, references, sortOrders: { RECOMMENDED: ordered, LOWEST_PRICE: [...ordered] }, versions: SEARCH_VERSIONS, countsByPriceBasis: countBases(values), diagnostics });
}
function makeSnapshot(snapshot: RankingSnapshot): RankingSnapshot {
  const counts = { TOTAL_PRICE: 0, ITEM_PRICE_ONLY: 0 };
  const byOffer = new Map(snapshot.eligible.map((result) => [result.offerId, result]));
  snapshot.eligible = snapshot.sortOrders.RECOMMENDED.map((id) => {
    const result = byOffer.get(id)!;
    return { ...result, cohortRank: ++counts[result.priceBasis] };
  });
  // Detach nested objects from mutable extraction buffers. Persistence provides the immutable DB boundary.
  return structuredClone(snapshot);
}
/** No provider, clock, Gate or score calculation is used when projecting a stored sort order. */
export function projectSnapshot(snapshot: RankingSnapshot, sort: Sort = 'RECOMMENDED', resultLimit = 10): { results: Recommendation[]; references: Reference[]; countsByPriceBasis: RankingSnapshot['countsByPriceBasis'] } {
  if (!Number.isInteger(resultLimit) || resultLimit < 1 || resultLimit > 10) throw new Error('INVALID_INPUT');
  if (snapshot.mode === 'DEAL_TEXT' && sort === 'MOST_SIMILAR') throw new Error('UNSUPPORTED_SORT_FOR_MODE');
  const order = snapshot.sortOrders[sort];
  if (!order || order.length !== snapshot.eligible.length || new Set(order).size !== order.length) throw new Error('INVALID_RANK_SNAPSHOT');
  const byOffer = new Map(snapshot.eligible.map((result) => [result.offerId, result]));
  if (byOffer.size !== snapshot.eligible.length || order.some((id) => !byOffer.has(id))) throw new Error('INVALID_RANK_SNAPSHOT');
  const counts = { TOTAL_PRICE: 0, ITEM_PRICE_ONLY: 0 };
  const results = order.map((id) => {
    const result = byOffer.get(id)!;
    return { ...result, cohortRank: ++counts[result.priceBasis] };
  }).slice(0, resultLimit);
  return structuredClone({ results, references: snapshot.references, countsByPriceBasis: snapshot.countsByPriceBasis });
}
