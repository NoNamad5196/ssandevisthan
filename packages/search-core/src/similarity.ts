import { TargetAnalysisSchema, VisualRubricSchema, type AttributeKey, type TargetAnalysis, type VisualRubric, type RejectReason } from '@ssandevisthan/contracts';
import { ATTRIBUTE_GROUPS, GATE, VISUAL_WEIGHTS } from './config.ts';

export interface SimilarityMetrics {
  visualSimilarity: number | null;
  visualCoverage: number | null;
  attributeSimilarity: number | null;
  attributeCoverage: number | null;
  totalSimilarity: number | null;
  categoryCompatible: boolean;
}
export function calculateVisualSimilarity(input: VisualRubric): Pick<SimilarityMetrics, 'visualSimilarity' | 'visualCoverage'> {
  const rubric = VisualRubricSchema.parse(input);
  let denominator = 0, observed = 0, score = 0;
  for (const key of Object.keys(VISUAL_WEIGHTS) as (keyof VisualRubric)[]) {
    const axis = rubric[key], weight = VISUAL_WEIGHTS[key];
    if (!axis.targetApplicable) continue;
    denominator += weight;
    if (axis.ordinal !== null) { observed += weight; score += weight * axis.ordinal / 4; }
  }
  return denominator === 0 ? { visualSimilarity: null, visualCoverage: null } : {
    visualSimilarity: score / denominator, visualCoverage: observed / denominator,
  };
}
/** Compatibility remains deterministic. No free-form model-produced fractional match scores. */
export function attributeCompatibility(key: AttributeKey, target: string, candidate: string): 0 | .5 | 1 {
  if (target === candidate) return 1;
  const pair = [target, candidate].sort().join('|');
  if (key === 'color' && pair === 'BLACK|CHARCOAL') return .5;
  if (key === 'fit' && pair === 'REGULAR|RELAXED') return .5;
  return 0;
}
export function calculateAttributeSimilarity(targetInput: TargetAnalysis, candidateInput: TargetAnalysis): Pick<SimilarityMetrics, 'attributeSimilarity' | 'attributeCoverage' | 'categoryCompatible'> {
  const target = TargetAnalysisSchema.parse(targetInput), candidate = TargetAnalysisSchema.parse(candidateInput);
  const categoryCompatible = target.category.state === 'OBSERVED' && candidate.category.state === 'OBSERVED' && target.category.value === candidate.category.value;
  if (target.category.state !== 'OBSERVED') return { attributeSimilarity: null, attributeCoverage: null, categoryCompatible: false };
  let denominator = 0, observed = 0, score = 0;
  for (const group of ATTRIBUTE_GROUPS) {
    const fields = group.fields.filter((key) => target[key]?.state === 'OBSERVED');
    if (!fields.length) continue;
    const fieldWeight = group.weight / fields.length;
    for (const key of fields) {
      denominator += fieldWeight;
      const a = target[key], b = candidate[key];
      if (a?.value && b?.state === 'OBSERVED' && b.value !== null) {
        observed += fieldWeight;
        score += fieldWeight * attributeCompatibility(key, a.value, b.value);
      }
    }
  }
  return { attributeSimilarity: denominator ? score / denominator : null, attributeCoverage: denominator ? observed / denominator : null, categoryCompatible };
}
export function combineSimilarity(visual: Pick<SimilarityMetrics, 'visualSimilarity' | 'visualCoverage'>, attribute: Pick<SimilarityMetrics, 'attributeSimilarity' | 'attributeCoverage' | 'categoryCompatible'>): SimilarityMetrics {
  return { ...visual, ...attribute, totalSimilarity: visual.visualSimilarity === null || attribute.attributeSimilarity === null ? null : .625 * visual.visualSimilarity + .375 * attribute.attributeSimilarity };
}
export function compareAttributesAndVisual(target: TargetAnalysis, candidate: TargetAnalysis, visual: VisualRubric): SimilarityMetrics {
  // Applicability belongs to the target. A candidate comparison cannot hide a hard
  // axis (e.g. large print) by declaring an observed target graphic inapplicable.
  const requiredAxes = {
    silhouette: target.category.state === 'OBSERVED',
    color: target.color.state === 'OBSERVED',
    graphic: [target.graphic, target.graphicPlacement, target.graphicScale, target.pattern].some((value) => value?.state === 'OBSERVED'),
    detail: [target.neck, target.closure, target.pocket, target.detail].some((value) => value?.state === 'OBSERVED'),
  };
  for (const axis of Object.keys(requiredAxes) as (keyof VisualRubric)[]) {
    if (requiredAxes[axis] && visual[axis].targetApplicable !== true) throw new Error('INVALID_VISUAL_TARGET_APPLICABILITY');
  }
  return combineSimilarity(calculateVisualSimilarity(visual), calculateAttributeSimilarity(target, candidate));
}
export function evaluateSimilarityGate(metrics: SimilarityMetrics | null, sourceEligibility: boolean | { pass: boolean; reasons: RejectReason[] }): { pass: boolean; reasons: RejectReason[] } {
  const reasons: RejectReason[] = typeof sourceEligibility === 'boolean' ? sourceEligibility ? [] : ['ELIGIBILITY_UNKNOWN'] : [...sourceEligibility.reasons];
  if (typeof sourceEligibility !== 'boolean' && !sourceEligibility.pass && !reasons.length) reasons.push('ELIGIBILITY_UNKNOWN');
  if (!metrics) reasons.push('COMPARISON_FAILED');
  else {
    if (!metrics.categoryCompatible) reasons.push('CATEGORY_MISMATCH');
    const valid = (value: number | null) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
    if (!valid(metrics.visualSimilarity) || !valid(metrics.visualCoverage)) reasons.push('INSUFFICIENT_VISUAL_EVIDENCE');
    if (!valid(metrics.attributeSimilarity) || !valid(metrics.attributeCoverage) || !valid(metrics.totalSimilarity)) reasons.push('COMPARISON_FAILED');
    // Total similarity is independently checked against its formula to reject tampered provider output.
    if (valid(metrics.visualSimilarity) && valid(metrics.attributeSimilarity) && valid(metrics.totalSimilarity)
      // DB numeric(6,5) may round a persisted S by at most half its final digit.
      && Math.abs(metrics.totalSimilarity! - (.625 * metrics.visualSimilarity! + .375 * metrics.attributeSimilarity!)) > .00000501) reasons.push('COMPARISON_FAILED');
    const rules = [
      ['visualCoverage', 'LOW_VISUAL_COVERAGE'], ['attributeCoverage', 'LOW_ATTRIBUTE_COVERAGE'],
      ['visualSimilarity', 'LOW_VISUAL_SIMILARITY'], ['attributeSimilarity', 'LOW_ATTRIBUTE_SIMILARITY'],
      ['totalSimilarity', 'LOW_TOTAL_SIMILARITY'],
    ] as const;
    for (const [field, reason] of rules) if (valid(metrics[field]) && metrics[field]! < GATE[field]) reasons.push(reason);
  }
  return { pass: reasons.length === 0, reasons: [...new Set(reasons)] };
}
