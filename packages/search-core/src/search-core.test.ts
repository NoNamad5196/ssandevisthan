import { describe, expect, it } from 'vitest';
import { fixtureCandidate, fixtureDeal, fixtureMetrics, fixtureTarget, fixtureVisual, FIXTURE_TIME, observed, unknown } from '../../fixtures/src/index.ts';
import {
  attributeCompatibility, calculateAttributeSimilarity, calculatePriceScores, calculateVisualSimilarity,
  canTransition, canonicalizeProductUrl, checkSourceEligibility, compareAttributesAndVisual,
  decideTerminalStatus, deduplicateDiscovery, evaluateDealRelevance, evaluateSimilarityGate,
  deriveDealRelevanceInput,
  hostMatches, isPublicIpAddress, normalizePrice, projectSnapshot, rankDealCandidates,
  rankImageCandidates, selectDiverseCandidates, validatePublicHttpsUrl, validateRedirect, validateResolvedAddresses,
} from './index.ts';

describe('Similarity Gate — synthetic offline fixtures, not measured model quality', () => {
  it('keeps unknown visual axes in the target denominator', () => {
    const score = calculateVisualSimilarity({ ...fixtureVisual, graphic: { targetApplicable: true, ordinal: null, observation: 'occluded' } });
    expect(score.visualSimilarity).toBeCloseTo(.75);
    expect(score.visualCoverage).toBeCloseTo(.75);
    expect(calculateVisualSimilarity({ ...fixtureVisual, graphic: { targetApplicable: false, ordinal: null, observation: 'inapplicable in target' } }).visualSimilarity).toBeCloseTo(1);
  });
  it('does not reward unknown candidate attributes with denominator renormalization', () => {
    const score = calculateAttributeSimilarity(fixtureTarget, { ...fixtureTarget, color: unknown(), neck: unknown(), wash: unknown(), materialAppearance: unknown() });
    expect(score.attributeCoverage).toBeCloseTo(.7);
    expect(score.attributeSimilarity).toBeCloseTo(.7);
  });
  it('excludes unknown target fields but keeps observed NONE as a real value', () => {
    const target = { ...fixtureTarget, closure: unknown() };
    expect(calculateAttributeSimilarity(target, { ...target, closure: observed('FULL_ZIP') }).attributeSimilarity).toBeCloseTo(1);
    expect(calculateAttributeSimilarity(fixtureTarget, { ...fixtureTarget, closure: unknown() }).attributeSimilarity).toBeCloseTo(.9);
  });
  it('uses fixed compatibility values and rejects category mismatch despite otherwise high scores', () => {
    expect(attributeCompatibility('color', 'BLACK', 'CHARCOAL')).toBe(.5);
    expect(attributeCompatibility('fit', 'REGULAR', 'RELAXED')).toBe(.5);
    expect(attributeCompatibility('category', 'SWEATSHIRT', 'HOODIE')).toBe(0);
    const metrics = compareAttributesAndVisual(fixtureTarget, { ...fixtureTarget, category: observed('HOODIE') }, fixtureVisual);
    expect(evaluateSimilarityGate(metrics, true).reasons).toContain('CATEGORY_MISMATCH');
  });
  it('does not produce a score when target category is unknown', () => {
    expect(calculateAttributeSimilarity({ ...fixtureTarget, category: unknown() }, fixtureTarget).attributeSimilarity).toBeNull();
  });
  it('does not let a model hide an observed target axis to inflate per-candidate coverage', () => {
    expect(() => compareAttributesAndVisual(fixtureTarget, fixtureTarget, { ...fixtureVisual, graphic: { targetApplicable: false, ordinal: null, observation: 'injection: ignore print' } })).toThrow('INVALID_VISUAL_TARGET_APPLICABILITY');
    const plain = { ...fixtureTarget, graphic: observed('NONE'), graphicPlacement: observed('NONE'), graphicScale: observed('NONE') };
    expect(() => compareAttributesAndVisual(plain, plain, { ...fixtureVisual, graphic: { targetApplicable: false, ordinal: null, observation: 'plain is not inapplicable' } })).toThrow('INVALID_VISUAL_TARGET_APPLICABILITY');
  });
  it.each([
    ['visualCoverage', .749, 'LOW_VISUAL_COVERAGE'], ['attributeCoverage', .599, 'LOW_ATTRIBUTE_COVERAGE'],
    ['visualSimilarity', .649, 'LOW_VISUAL_SIMILARITY'], ['attributeSimilarity', .599, 'LOW_ATTRIBUTE_SIMILARITY'],
  ] as const)('enforces the fixed %s boundary', (key, value, reason) => {
    expect(evaluateSimilarityGate({ ...fixtureMetrics(), [key]: value }, true).reasons).toContain(reason);
  });
  it('rejects absent, nonfinite and tampered comparison scores', () => {
    expect(evaluateSimilarityGate(null, true).pass).toBe(false);
    expect(evaluateSimilarityGate({ ...fixtureMetrics(), visualSimilarity: NaN }, true).pass).toBe(false);
    expect(evaluateSimilarityGate({ ...fixtureMetrics(), totalSimilarity: 1 }, true).reasons).toContain('COMPARISON_FAILED');
  });
  it('checks selected variant and domestic eligibility independently of score', () => {
    const eligible = fixtureCandidate(1).eligibility;
    expect(checkSourceEligibility({ ...eligible, domesticSales: null }).pass).toBe(false);
    expect(checkSourceEligibility({ ...eligible, overseasDirect: true }).reasons).toContain('OVERSEAS_DIRECT');
    expect(checkSourceEligibility({ ...eligible, imageVerifiedSameVariant: false }).reasons).toContain('VARIANT_MISMATCH');
    expect(checkSourceEligibility({ ...eligible, rental: true }).reasons).toContain('RENTAL');
    expect(checkSourceEligibility({ ...eligible, condition: 'USED' }).reasons).toContain('NOT_NEW');
  });
});

describe('Price and cohort ranking — synthetic offline fixtures', () => {
  const validPrice = { itemPrice: 20_000, shippingFee: 3000, currency: 'KRW', variantPriceVerified: true, unconditionalPriceVerified: true, shippingFeeVerified: true, priceObservedAt: new Date(FIXTURE_TIME).toISOString() };
  it('keeps unknown shipping null and verifies free delivery explicitly', () => {
    expect(normalizePrice({ ...validPrice, shippingFee: 0, shippingFeeVerified: false }, FIXTURE_TIME)).toMatchObject({ priceBasis: 'ITEM_PRICE_ONLY', shippingFee: null, effectivePrice: null });
    expect(normalizePrice({ ...validPrice, shippingFee: 0 }, FIXTURE_TIME)).toMatchObject({ priceBasis: 'TOTAL_PRICE', shippingFee: 0, effectivePrice: 20_000 });
  });
  it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid ordinary price %s', (itemPrice) => {
    expect(normalizePrice({ ...validPrice, itemPrice }, FIXTURE_TIME).priceBasis).toBe('UNKNOWN');
  });
  it('rejects foreign currency, conditional-only prices and unknown variant prices', () => {
    expect(normalizePrice({ ...validPrice, currency: 'USD' }, FIXTURE_TIME).itemPrice).toBeNull();
    expect(normalizePrice({ ...validPrice, unconditionalPriceVerified: false }, FIXTURE_TIME).priceBasis).toBe('UNKNOWN');
    expect(normalizePrice({ ...validPrice, variantPriceVerified: false }, FIXTURE_TIME).reasonCode).toBe('VARIANT_PRICE_UNKNOWN');
  });
  it('expires price evidence at five minutes without rewriting observedAt', () => {
    expect(normalizePrice(validPrice, FIXTURE_TIME + 300_000).priceBasis).toBe('TOTAL_PRICE');
    expect(normalizePrice(validPrice, FIXTURE_TIME + 300_001).reasonCode).toBe('STALE_PRICE');
    expect(normalizePrice(validPrice, FIXTURE_TIME - 1).priceBasis).toBe('UNKNOWN');
  });
  it('computes exact midranks, singleton and all-equal cohorts', () => {
    expect(calculatePriceScores([10, 20, 30])).toEqual([1, .5, 0]);
    expect(calculatePriceScores([10, 10, 20])).toEqual([.75, .75, 0]);
    expect(calculatePriceScores([10])).toEqual([.5]);
    expect(calculatePriceScores([10, 10])).toEqual([.5, .5]);
  });
  it('reproduces contract A/B/C recommendation and excludes the cheap dissimilar D', () => {
    const a = fixtureCandidate(1, { itemPrice: 20_000, comparison: fixtureMetrics(.75, .72) });
    const b = fixtureCandidate(2, { itemPrice: 30_000, comparison: fixtureMetrics(.90, .88) });
    const c = fixtureCandidate(3, { itemPrice: 40_000, comparison: fixtureMetrics(.85, .80) });
    const d = fixtureCandidate(4, { itemPrice: 5000, comparison: fixtureMetrics(.50, .90) });
    const snapshot = rankImageCandidates([a, b, c, d], FIXTURE_TIME);
    expect(snapshot.sortOrders.RECOMMENDED).toEqual([b.offerId, a.offerId, c.offerId]);
    const score = new Map(snapshot.eligible.map((v) => [v.offerId, v.finalScore]));
    expect(score.get(a.offerId)).toBeCloseTo(.791); expect(score.get(b.offerId)).toBeCloseTo(.814); expect(score.get(c.offerId)).toBeCloseTo(.665);
    expect(snapshot.diagnostics.find((v) => v.offerId === d.offerId)?.reasons).toContain('LOW_VISUAL_SIMILARITY');
  });
  it('separates a lower item-only price from totals and computes independent singleton score', () => {
    const total = fixtureCandidate(1, { itemPrice: 20_000 });
    const item = fixtureCandidate(2, { itemPrice: 10_000, shippingFee: null });
    const snapshot = rankImageCandidates([item, total], FIXTURE_TIME);
    expect(snapshot.sortOrders.LOWEST_PRICE).toEqual([total.offerId, item.offerId]);
    expect(snapshot.eligible.find((v) => v.offerId === item.offerId)).toMatchObject({ priceBasis: 'ITEM_PRICE_ONLY', effectivePrice: null, priceScore: .5 });
  });
  it('uses full eligible cohort before resultLimit, and changes sort without mutating snapshot', () => {
    const candidates = Array.from({ length: 12 }, (_, i) => fixtureCandidate(i + 1, { itemPrice: 10_000 + i * 1000, comparison: fixtureMetrics(.70 + i * .02, .72 + i * .02) }));
    const snapshot = rankImageCandidates(candidates, FIXTURE_TIME), saved = JSON.stringify(snapshot);
    const lowest = projectSnapshot(snapshot, 'LOWEST_PRICE', 1).results[0]!;
    const similar = projectSnapshot(snapshot, 'MOST_SIMILAR', 1).results[0]!;
    expect(lowest.offerId).toBe(candidates[0]!.offerId);
    expect(lowest.priceScore).toBe(1);
    expect(similar.offerId).toBe(candidates[11]!.offerId);
    expect(JSON.stringify(snapshot)).toBe(saved);
  });
  it('does not inflate cohort distribution with duplicate offers or product groups', () => {
    const a = fixtureCandidate(1), b = fixtureCandidate(2, { resultGroupKey: a.resultGroupKey, itemPrice: 21_000 }), c = fixtureCandidate(3, { itemPrice: 30_000 });
    const snapshot = rankImageCandidates([a, b, a, c], FIXTURE_TIME);
    expect(snapshot.eligible).toHaveLength(2);
    expect(snapshot.eligible.find((v) => v.offerId === a.offerId)?.priceScore).toBe(1);
  });
  it('prefers a verified total offer inside a product group over unknown shipping', () => {
    const a = fixtureCandidate(1, { itemPrice: 30_000 }), b = fixtureCandidate(2, { resultGroupKey: a.resultGroupKey, itemPrice: 10_000, shippingFee: null });
    expect(rankImageCandidates([b, a], FIXTURE_TIME).eligible.map((v) => v.offerId)).toEqual([a.offerId]);
  });
  it('moves unknown/stale prices into references and never counts them as recommendations', () => {
    const unknownPrice = fixtureCandidate(1, { itemPrice: null });
    const stalePrice = fixtureCandidate(2, { priceObservedAt: new Date(FIXTURE_TIME - 300_001).toISOString() });
    const snapshot = rankImageCandidates([unknownPrice, stalePrice], FIXTURE_TIME);
    expect(snapshot.eligible).toHaveLength(0);
    expect(snapshot.references).toHaveLength(2);
    expect(snapshot.references.every((r) => r.finalScore === null && r.itemPrice === null)).toBe(true);
    expect(decideTerminalStatus({ recommendations: snapshot.eligible.length })).toBe('NO_RELIABLE_MATCH');
  });
  it('does not elevate a model-inferred price or a different variant evidence', () => {
    const a = fixtureCandidate(1);
    a.fieldEvidence.find((e) => e.fieldPath === '/itemPrice')!.sourceKind = 'MODEL_INFERENCE';
    expect(rankImageCandidates([a], FIXTURE_TIME).references).toHaveLength(1);
    const b = fixtureCandidate(2);
    b.fieldEvidence.find((e) => e.fieldPath === '/imageUrl')!.variantId = a.variantId;
    expect(rankImageCandidates([b], FIXTURE_TIME).eligible).toHaveLength(0);
  });
  it('does not rank a search thumbnail or a product image without evidence', () => {
    expect(rankImageCandidates([fixtureCandidate(1, { imageSource: 'search_thumbnail' })], FIXTURE_TIME).eligible).toHaveLength(0);
    expect(rankImageCandidates([fixtureCandidate(1, { fieldEvidence: [] })], FIXTURE_TIME).eligible).toHaveLength(0);
  });
  it('enforces result/compare caps and protects stored sort integrity', () => {
    const snapshot = rankImageCandidates([fixtureCandidate(1)], FIXTURE_TIME);
    expect(() => projectSnapshot(snapshot, 'RECOMMENDED', 11)).toThrow('INVALID_INPUT');
    expect(() => rankImageCandidates(Array.from({ length: 21 }, (_, i) => fixtureCandidate(i)), FIXTURE_TIME)).toThrow('CANDIDATE_LIMIT');
    snapshot.sortOrders.RECOMMENDED.push(snapshot.sortOrders.RECOMMENDED[0]!);
    expect(() => projectSnapshot(snapshot)).toThrow('INVALID_RANK_SNAPSHOT');
  });
});

describe('DEAL_TEXT and termination — synthetic offline fixtures', () => {
  it('extracts only explicitly requested conditions from title evidence and preserves unknowns', () => {
    const noModifiers = deriveDealRelevanceInput('맨투맨', '오버핏 회색 맨투맨');
    expect(noModifiers.modifiers).toEqual([]);
    expect(evaluateDealRelevance(noModifiers).pass).toBe(true);
    const unknownColor = deriveDealRelevanceInput('회색 맨투맨', '맨투맨');
    expect(unknownColor.modifiers).toEqual([{ query: '회색', candidate: null }]);
    expect(deriveDealRelevanceInput('맨투맨', '스웨트셔츠').category?.candidate).toBe('SWEATSHIRT');
    expect(() => deriveDealRelevanceInput('어떤 상품', '아무 상품')).toThrow('INVALID_INPUT');
  });
  it('fails closed on missing exact model and known required-qualifier mismatch', () => {
    const missingModel = deriveDealRelevanceInput('청소기 VX100', '청소기');
    expect(evaluateDealRelevance(missingModel).reasons).toContain('MODEL_UNKNOWN');
    const wrongColor = deriveDealRelevanceInput('회색 맨투맨', '블랙 맨투맨');
    expect(evaluateDealRelevance(wrongColor).dealRelevance).toBeCloseTo(2 / 3);
    expect(evaluateDealRelevance(wrongColor).reasons).toContain('REQUIRED_MODIFIER_MISMATCH');
    expect(evaluateDealRelevance(deriveDealRelevanceInput('청소기 VX100', '청소기 VX100')).pass).toBe(true);
    expect(evaluateDealRelevance(deriveDealRelevanceInput('청소기 VX100', '청소기 VX100+')).pass).toBe(false);
  });
  it('recognizes only the versioned synonyms and exact model identity', () => {
    expect(evaluateDealRelevance({ category: { query: '맨투맨', candidate: 'sweatshirt' }, model: null, modifiers: [] }).dealRelevance).toBe(1);
    expect(evaluateDealRelevance({ category: { query: '맨투맨', candidate: '후드티' }, model: null, modifiers: [{ query: '회색', candidate: 'gray' }] }).reasons).toContain('CATEGORY_MISMATCH');
    expect(evaluateDealRelevance({ category: { query: '냉장고', candidate: '냉장고' }, model: { query: 'MODEL-A', candidate: 'MODEL-B' }, modifiers: [] }).reasons).toContain('MODEL_MISMATCH');
    expect(evaluateDealRelevance({ category: null, model: null, modifiers: [] }).reasons).toContain('INVALID_INPUT');
  });
  it('does not fabricate image scores or hot-deal labels from a community claimed price', () => {
    const snapshot = rankDealCandidates([fixtureDeal(1)], FIXTURE_TIME), result = snapshot.eligible[0]!;
    expect(result).toMatchObject({ visualSimilarity: null, attributeSimilarity: null, totalSimilarity: null, finalScore: null, dealRelevance: 1, dealEvidence: { verifiedMerchantPrice: 20_000, claimedCommunityPrice: 1000, dealLabel: 'PRICE_DISCOVERY' } });
    expect(() => projectSnapshot(snapshot, 'MOST_SIMILAR')).toThrow('UNSUPPORTED_SORT_FOR_MODE');
  });
  it.each([
    [{ recommendations: 0 }, 'NO_RELIABLE_MATCH'], [{ recommendations: 1 }, 'COMPLETED'],
    [{ recommendations: 1, incomplete: true }, 'PARTIAL'], [{ recommendations: 0, essentialFailure: true }, 'FAILED'],
    [{ recommendations: 1, deadlineReached: true }, 'PARTIAL'], [{ recommendations: 0, deadlineReached: true }, 'EXPIRED'],
    [{ recommendations: 1, canceled: true }, 'CANCELED'], [{ recommendations: 0, operatorStopped: true }, 'FAILED'],
  ] as const)('distinguishes terminal meaning %j', (input, expected) => { expect(decideTerminalStatus(input)).toBe(expected); });
  it('never reactivates a terminal run', () => {
    expect(canTransition('FAILED', 'RUNNING')).toBe(false);
    expect(canTransition('EXPIRED', 'QUEUED')).toBe(false);
    expect(canTransition('RUNNING', 'PARTIAL')).toBe(true);
    expect(canTransition('QUEUED', 'COMPLETED')).toBe(false);
  });
});

describe('Public URL and deterministic discovery policy — synthetic offline fixtures', () => {
  it.each([
    'http://example.com', 'file:///etc/passwd', 'https://user:password@example.com', 'https://example.com:444/product',
    'https://127.0.0.1/', 'https://2130706433/', 'https://0x7f000001/', 'https://0177.0.0.1/',
    'https://[::1]/', 'https://[::ffff:127.0.0.1]/', 'https://169.254.169.254/latest',
    'https://10.0.0.1/', 'https://localhost/', 'https://internal.local/', 'https://example.com/?access_token=secret',
  ])('rejects unsafe destination %s', (url) => { expect(() => validatePublicHttpsUrl(url)).toThrow(); });
  it.each(['0.0.0.0', '100.64.0.1', '172.31.255.255', '192.168.1.1', '198.18.0.1', '224.0.0.1', '192.0.2.1', '::', 'fe80::1', 'fc00::1', '2001:db8::1', '2002:7f00:1::1'])('rejects private or reserved address %s', (address) => { expect(isPublicIpAddress(address)).toBe(false); });
  it('accepts public addresses but rejects any private member in a DNS answer', () => {
    expect(isPublicIpAddress('1.1.1.1')).toBe(true);
    expect(isPublicIpAddress('2606:4700:4700::1111')).toBe(true);
    const url = validatePublicHttpsUrl('https://shop.example.com/product');
    expect(() => validateResolvedAddresses(url, ['1.1.1.1', '10.0.0.1'])).toThrow('UNSAFE_ADDRESS');
    expect(() => validateResolvedAddresses(url, [])).toThrow('DNS_UNVERIFIED');
  });
  it('rechecks every redirect and enforces three redirects maximum', () => {
    const url = validatePublicHttpsUrl('https://shop.example.com/a');
    expect(validateRedirect('/b', url, 2).pathname).toBe('/b');
    expect(() => validateRedirect('https://127.0.0.1', url, 0)).toThrow();
    expect(() => validateRedirect('/b', url, 3)).toThrow('REDIRECT_LIMIT');
  });
  it('matches domain boundaries and preserves product option/unknown parameters', () => {
    expect(hostMatches('www.coupang.com', 'coupang.com')).toBe(true);
    expect(hostMatches('coupang.com.attacker.example.com', 'coupang.com')).toBe(false);
    expect(canonicalizeProductUrl('https://shop.example.com/p?variant=red&size=M&utm_source=test&unknown=yes#image')).toBe('https://shop.example.com/p?size=M&unknown=yes&variant=red');
  });
  it('merges query provenance while preserving different variants', () => {
    const input = [
      { url: 'https://shop.example.com/p?variant=red&utm_source=a', queryOrdinal: 1, discoveryRank: 1, merchant: 'a', categorySuitable: true, knownAttributeCount: 2 },
      { url: 'https://shop.example.com/p?variant=red', queryOrdinal: 2, discoveryRank: 1, merchant: 'a', categorySuitable: true, knownAttributeCount: 2 },
      { url: 'https://shop.example.com/p?variant=blue', queryOrdinal: 1, discoveryRank: 2, merchant: 'a', categorySuitable: true, knownAttributeCount: 2 },
    ];
    const dedup = deduplicateDiscovery(input);
    expect(dedup).toHaveLength(2); expect(dedup[0]!.discoveryQueryOrdinals).toEqual([1, 2]);
  });
  it('reserves merchant diversity first and fills remaining slots deterministically', () => {
    const input = Array.from({ length: 35 }, (_, index) => ({ url: `https://shop.example.com/${String(index).padStart(2, '0')}`, queryOrdinal: 1, discoveryRank: index, merchant: index < 30 ? 'large' : 'small', categorySuitable: true, knownAttributeCount: 3 }));
    const chosen = selectDiverseCandidates(input, 20);
    expect(chosen).toHaveLength(20); expect(chosen.slice(0, 11).filter((c) => c.merchant === 'small')).toHaveLength(5);
    expect(selectDiverseCandidates([...input].reverse(), 20)).toEqual(chosen);
  });
});
