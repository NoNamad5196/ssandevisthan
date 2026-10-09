import type { Attempt, Target } from './schema.ts';

export interface Metric { value: number | null; numerator: number; denominator: number; samples: number; independentGroups: number; interval95: [number, number] | null; method: string; scope: string }
const total = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0);
function weights(length: number, groups?: string[]) {
  const counts = new Map<string, number>();
  for (let i = 0; i < length; i++) { const key = groups?.[i] ?? String(i); counts.set(key, (counts.get(key) ?? 0) + 1); }
  return { independentGroups: counts.size, squared: total([...counts.values()].map(count => (count / length) ** 2)) };
}
/** Distribution-free two-sided Hoeffding bounds for independent target groups.
 * Unlike percentile bootstrap, n=1/all-equal samples do not imply certainty.
 * The bound is deliberately conservative; these are not slot-independent CIs. */
export function boundedMean(values: number[], maximum = 1, scope = 'ALL_TARGETS', groups?: string[]): Metric {
  if (!values.length) return { value: null, numerator: 0, denominator: 0, samples: 0, independentGroups: 0, interval95: null, method: 'HOEFFDING_GROUP_WEIGHTED_95', scope };
  const weight = weights(values.length, groups), value = total(values) / values.length, radius = maximum * Math.sqrt(Math.log(40) * weight.squared / 2);
  return { value, numerator: total(values), denominator: values.length, samples: values.length, independentGroups: weight.independentGroups, interval95: weight.independentGroups < 2 ? null : [Math.max(0, value - radius), Math.min(maximum, value + radius)], method: 'HOEFFDING_GROUP_WEIGHTED_95', scope };
}
/** Ratio of bounded per-target counts. Joint 95% confidence rectangle uses two
 * 97.5% Hoeffding intervals and a union bound; correlation within a run is kept.
 * Zero returned slots => undefined, never perfect precision or zero BAD rate. */
export function clusteredRatio(numerators: number[], denominators: number[], maximum: number, scope: string, groups?: string[]): Metric {
  const numerator = total(numerators), denominator = total(denominators), samples = numerators.length;
  const weight = weights(samples, groups);
  if (!denominator || !samples) return { value: null, numerator, denominator, samples, independentGroups: weight.independentGroups, interval95: null, method: 'HOEFFDING_GROUP_WEIGHTED_RATIO_95', scope };
  const radius = Math.sqrt(Math.log(80) * weight.squared / 2), n = numerator / samples / maximum, d = denominator / samples / maximum;
  const low = Math.max(0, n - radius) / Math.min(1, d + radius), high = d - radius <= 0 ? 1 : Math.min(1, (n + radius) / (d - radius));
  return { value: numerator / denominator, numerator, denominator, samples, independentGroups: weight.independentGroups, interval95: weight.independentGroups < 2 ? null : [Math.max(0, low), high], method: 'HOEFFDING_GROUP_WEIGHTED_RATIO_95', scope };
}
export function proportion(success: number, count: number, scope: string): Metric {
  if (!count) return { value: null, numerator: success, denominator: count, samples: count, independentGroups: count, interval95: null, method: 'WILSON_95', scope };
  const z = 1.959963984540054, p = success / count, factor = 1 + z * z / count;
  const center = (p + z * z / (2 * count)) / factor, radius = z * Math.sqrt(p * (1 - p) / count + z * z / (4 * count * count)) / factor;
  return { value: p, numerator: success, denominator: count, samples: count, independentGroups: count, interval95: count < 2 ? null : [Math.max(0, center - radius), Math.min(1, center + radius)], method: 'WILSON_95', scope };
}
export function groupedProportion(outcomes: boolean[], groups: string[], scope: string): Metric {
  return new Set(groups).size === groups.length ? proportion(outcomes.filter(Boolean).length, outcomes.length, scope) : boundedMean(outcomes.map(Number), 1, scope, groups);
}
export interface ScoredRun { target: Target; attempt: Attempt }
export const gain = (grade: string | null) => grade === 'GOOD' ? 2 : grade === 'ACCEPTABLE' ? 1 : 0;
const dcg = (gains: number[]) => total(gains.slice(0, 5).map((value, index) => value / Math.log2(index + 2)));
export function metrics(rows: ScoredRun[]) {
  const positive = rows.filter(row => row.target.labels.polarity === 'positive');
  const negative = rows.filter(row => row.target.labels.polarity === 'negative');
  const groupIds = rows.map(row => row.target.targetGroupId), positiveGroups = positive.map(row => row.target.targetGroupId), negativeGroups = negative.map(row => row.target.targetGroupId);
  const mean = (values: number[], maximum = 1, scope = 'ALL_TARGETS') => boundedMean(values, maximum, scope, groupIds);
  const ratio = (num: number[], den: number[], maximum: number, scope: string) => clusteredRatio(num, den, maximum, scope, groupIds);
  const top = (row: ScoredRun) => row.attempt.results.slice(0, 5);
  const label = (row: ScoredRun, candidateId: string) => row.target.candidates.find(c => c.candidateId === candidateId)!;
  const good = (row: ScoredRun) => top(row).filter(result => gain(label(row, result.candidateId).labels.grade) > 0).length;
  const bad = (row: ScoredRun) => top(row).filter(result => label(row, result.candidateId).labels.grade === 'BAD').length;
  const filled = rows.map(row => top(row).length);
  const nDCG = positive.map(row => {
    // One product family is one alternative in the ideal pool, even when the
    // labeled candidate pool contains multiple offers/URLs for it.
    const groups = new Map<string, number>();
    // The entire declared, fully labeled pool is fixed for nDCG. Commercial
    // eligibility is audited separately; it must not alter the ideal pool after
    // seeing which candidates were returned.
    for (const candidate of row.target.candidates) groups.set(candidate.productGroupId!, Math.max(groups.get(candidate.productGroupId!) ?? 0, gain(candidate.labels.grade)));
    const ideal = dcg([...groups.values()].sort((a, b) => b - a));
    return ideal > 0 ? dcg(top(row).map(result => gain(label(row, result.candidateId).labels.grade))) / ideal : null;
  });
  const gateBadDen = rows.map(row => row.attempt.gateDecisions.filter(g => label(row, g.candidateId).labels.grade === 'BAD').length);
  const gateGoodDen = rows.map(row => row.attempt.gateDecisions.filter(g => label(row, g.candidateId).labels.grade === 'GOOD').length);
  // A predeclared bound, never a sample-dependent maximum.
  const maxGate = 60;
  const domains = (row: ScoredRun) => top(row).map(result => new URL(label(row, result.candidateId).productUrl!).hostname);
  const uniqueCount = (values: (string | null)[]) => new Set(values).size;
  const sourceCounts = rows.map(row => new Set(row.attempt.discoveredDomains).size);
  const extractionDomains = [...new Set(rows.flatMap(row => row.attempt.sourceExtractions.map(source => source.domain)))].sort();
  return {
    sampleCount: rows.length, independentGroupCount: new Set(groupIds).size, positiveCount: positive.length, negativeCount: negative.length,
    hitAt5: groupedProportion(positive.map(row => good(row) > 0), positiveGroups, 'POSITIVE_TARGETS'),
    fixedPrecisionAt5: { ...boundedMean(positive.map(row => good(row) / 5), 1, 'POSITIVE_TARGETS', positiveGroups), numerator: total(positive.map(good)), denominator: positive.length * 5 },
    filledPrecisionAt5: ratio(rows.map(good), filled, 5, 'ALL_FILLED_TOP5_SLOTS'),
    badAt5: ratio(rows.map(bad), filled, 5, 'ALL_FILLED_TOP5_SLOTS'),
    ndcgAt5: nDCG.some(value => value === null) ? null : boundedMean(nDCG as number[], 1, 'POSITIVE_TARGETS_FIXED_LABELED_POOL_LINEAR_GAIN_2_1_0', positiveGroups),
    meanResultCount: mean(rows.map(row => row.attempt.results.length), 10),
    emptyResultRate: groupedProportion(rows.map(row => !row.attempt.results.length), groupIds, 'ALL_TARGETS'),
    negativeRejection: groupedProportion(negative.map(row => !row.attempt.results.length && row.attempt.status === 'NO_RELIABLE_MATCH' && row.attempt.sourceStatus === 'SUCCESS'), negativeGroups, 'NEGATIVE_TARGETS_SOURCE_SUCCESS_REQUIRED'),
    negativeForcedResultCount: negative.filter(row => row.attempt.results.length > 0).length,
    negativeSourceFailureCount: negative.filter(row => row.attempt.sourceStatus !== 'SUCCESS').length,
    gateFalsePositive: ratio(rows.map(row => row.attempt.gateDecisions.filter(g => g.passed && label(row, g.candidateId).labels.grade === 'BAD').length), gateBadDen, maxGate, 'EVALUATED_BAD_CANDIDATES'),
    gateFalseNegative: ratio(rows.map(row => row.attempt.gateDecisions.filter(g => !g.passed && label(row, g.candidateId).labels.grade === 'GOOD').length), gateGoodDen, maxGate, 'EVALUATED_GOOD_CANDIDATES'),
    diversity: {
      distinctProductGroups: mean(rows.map(row => uniqueCount(top(row).map(result => label(row, result.candidateId).productGroupId))), 5),
      distinctMerchants: mean(rows.map(row => uniqueCount(top(row).map(result => label(row, result.candidateId).merchant))), 5),
      distinctDomains: mean(rows.map(row => uniqueCount(domains(row))), 5),
      maximumDomainShare: boundedMean(rows.filter(row => top(row).length).map(row => Math.max(...domains(row).map(domain => domains(row).filter(d => d === domain).length)) / top(row).length), 1, 'NONEMPTY_TOP5_TARGETS', rows.filter(row => top(row).length).map(row => row.target.targetGroupId)),
      discoveredDomainsPerTarget: mean(sourceCounts, 150), casesWithAtLeastThreeDiscoveredSources: sourceCounts.filter(count => count >= 3).length,
    },
    sourceExtraction: {
      overall: ratio(rows.map(row => total(row.attempt.sourceExtractions.map(source => source.succeeded))), rows.map(row => total(row.attempt.sourceExtractions.map(source => source.attempted))), 30, 'ALL_ATTEMPTED_EXTRACTIONS'),
      byDomain: Object.fromEntries(extractionDomains.map(domain => [domain, ratio(rows.map(row => row.attempt.sourceExtractions.find(source => source.domain === domain)?.succeeded ?? 0), rows.map(row => row.attempt.sourceExtractions.find(source => source.domain === domain)?.attempted ?? 0), 30, 'ALL_ATTEMPTED_EXTRACTIONS_FOR_DOMAIN')])),
    },
    priceQuality: {
      generalPriceValid: ratio(rows.map(row => top(row).filter(result => result.unconditionalPriceVerified && result.currency === 'KRW' && Number.isSafeInteger(result.itemPrice) && result.itemPrice! > 0).length), filled, 5, 'ALL_FILLED_TOP5_SLOTS'),
      shippingFeeKnown: ratio(rows.map(row => top(row).filter(result => result.shippingFeeVerified && Number.isSafeInteger(result.shippingFee) && result.shippingFee! >= 0).length), filled, 5, 'ALL_FILLED_TOP5_SLOTS'),
      observationTimestampDisplayed: ratio(rows.map(row => top(row).filter(result => result.priceObservedAt && result.displayed.observedAt).length), filled, 5, 'ALL_FILLED_TOP5_SLOTS'),
      missingRequiredDisplayCount: total(rows.map(row => row.attempt.results.filter(result => !Object.values(result.displayed).every(Boolean) || !result.priceObservedAt).length)),
    },
  };
}
