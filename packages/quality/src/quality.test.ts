import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { evaluateQuality, holdoutDigest, noDataReport, type Manifest, type RunBundle, type Target, type Candidate, type Attempt } from './index.ts';
import { boundedMean, clusteredRatio, groupedProportion } from './metrics.ts';

// SYNTHETIC fixtures only. Names, domains, reviews, stock/price attestations and
// outputs below are invented test inputs, NEVER actual people or LIVE searches.
const time = '2026-01-04T00:00:00.000Z';
const rights = { status: 'CONFIRMED' as const, basis: 'SYNTHETIC test fixture', reviewedBy: 'SYNTHETIC_R1' };
const review = <T>(judgment: T) => ['SYNTHETIC_R1', 'SYNTHETIC_R2'].map(reviewerId => ({ reviewerId, independent: true, blindedToPrice: true, blindedToSystemScore: true, completedAt: '2026-01-01T00:00:00.000Z', judgment: structuredClone(judgment) }));
function candidate(id: string, grade: 'GOOD' | 'ACCEPTABLE' | 'BAD'): Candidate {
  const labels = { grade, reason: 'SYNTHETIC label for arithmetic test', domesticNewEligibility: 'ELIGIBLE' as const };
  return { candidateId: id, canonicalProductId: id, canonicalOfferId: `${id}-offer`, productGroupId: id, merchant: 'SYNTHETIC merchant', productUrl: `https://shop.example/${id}`, observedAt: time, productEvidence: 'SYNTHETIC fixture path', imageEvidence: 'SYNTHETIC fixture path', priceEvidence: 'SYNTHETIC fixture path', rights: { ...rights }, labels, reviews: review(labels), adjudication: null };
}
function target(id: string, polarity: 'positive' | 'negative', category = 'TOP'): Target {
  const labels: Target['labels'] = { support: 'SUPPORTED', category, requiredVisualAttributes: ['black'], optionalAttributes: [], unobservableAttributes: ['fiber'], polarity, polarityRationale: 'SYNTHETIC pool deliberately constructed', availableAlternativeCount: polarity === 'positive' ? 1 : 0 };
  return { targetId: id, targetGroupId: id, split: 'holdout', imageSha256: createHash('sha256').update(id).digest('hex'), source: 'SYNTHETIC generated test input', rights: { ...rights }, groupKeys: { productId: id, pageImageUrl: null, shootingSessionId: null, parentImageSha256: null }, slices: ['BASIC'], labels, reviews: review(labels), adjudication: null, candidates: [candidate(`${id}-g`, polarity === 'positive' ? 'GOOD' : 'BAD')] };
}
const result = (candidateId: string): Attempt['results'][number] => ({ candidateId, itemPrice: 25000, currency: 'KRW', unconditionalPriceVerified: true, shippingFee: null, shippingFeeVerified: false, priceObservedAt: time, priceBasis: 'ITEM_PRICE_ONLY', displayed: { price: true, source: true, observedAt: true, comparisonBasis: true } });
function attempt(targetId: string, status: Attempt['status']): Attempt {
  return { attemptId: `${targetId}-1`, targetId, attempt: 1, startedAt: time, finishedAt: time, status, sourceStatus: status === 'FAILED' ? 'FAILED' : 'SUCCESS', results: [], references: [], gateDecisions: [], discoveredDomains: [], sourceExtractions: [], failureReasons: status === 'FAILED' || status === 'EXPIRED' ? ['SYNTHETIC_SOURCE_FAILURE'] : [] };
}
function fixture() {
  const p1 = target('p1', 'positive'), p2 = target('p2', 'positive'), p3 = target('p3', 'positive', 'PANTS'), n1 = target('n1', 'negative', 'OTHER'), n2 = target('n2', 'negative', 'OTHER');
  p1.candidates.push(candidate('p1-g2', 'GOOD'), candidate('p1-a', 'ACCEPTABLE'), candidate('p1-b', 'BAD'));
  p1.labels.availableAlternativeCount = 3; p1.reviews = review(p1.labels);
  const manifest: Manifest = { schemaVersion: 1, datasetVersion: 'SYNTHETIC-v1', createdAt: '2026-01-01T00:00:00.000Z', provenance: 'SYNTHETIC', mode: 'IMAGE_SIMILAR', categoryMinimums: { TOP: 1 }, crossDistributionMinimums: [{ category: 'TOP', slice: 'BASIC', minimum: 1 }], groupingAudit: { confirmed: true, reviewedBy: 'SYNTHETIC_R1', evidence: 'SYNTHETIC attestation' }, holdout: { sealedAt: '2026-01-01T00:00:00.000Z', sealSha256: null, tuningCompletedAt: '2026-01-02T00:00:00.000Z', unsealedAt: '2026-01-03T00:00:00.000Z', usedForTuningAfterExposure: false }, targets: [p1, p2, p3, n1, n2] };
  const first = attempt('p1', 'PARTIAL');
  first.results = [result('p1-g'), result('p1-a'), result('p1-b')];
  first.gateDecisions = [{ candidateId: 'p1-g', passed: true, reasons: [] }, { candidateId: 'p1-a', passed: true, reasons: [] }, { candidateId: 'p1-b', passed: true, reasons: ['SYNTHETIC_GATE_FP'] }, { candidateId: 'p1-g2', passed: false, reasons: ['SYNTHETIC_GATE_FN'] }];
  first.discoveredDomains = ['one.example', 'two.example', 'three.example'];
  first.sourceExtractions = [{ domain: 'one.example', attempted: 3, succeeded: 2 }, { domain: 'two.example', attempted: 2, succeeded: 0 }];
  const runs: RunBundle = { schemaVersion: 1, evaluationId: 'SYNTHETIC-eval', executedAt: time, gitSha: '0'.repeat(40), environment: 'SYNTHETIC_OFFLINE_TEST', datasetVersion: manifest.datasetVersion, split: 'holdout', kind: 'REPLAY', provider: 'SYNTHETIC_PROVIDER', model: 'SYNTHETIC_MODEL', versions: { pipeline: 'test', prompt: 'test', extractor: 'test', ranker: 'test', pricePolicy: 'test', sourcePolicy: 'test' }, budget: { reservedMicrousd: 0, actualMicrousd: 0 }, author: 'SYNTHETIC_AUTHOR', reviewer: 'SYNTHETIC_REVIEWER', hardFailAudit: { status: 'PENDING', reviewedBy: null, evidence: null, findings: [] }, baselineReview: { approved: false, evaluationId: null, sameDatasetSplitFixtureCriteria: false, noRegression: false, fixedPrecisionTargetMet: false, ndcgTargetMet: false, sourceCoverageTargetMet: false, approvedBy: null, evidence: null }, attempts: [first, attempt('p2', 'FAILED'), attempt('p3', 'EXPIRED'), attempt('n1', 'NO_RELIABLE_MATCH'), attempt('n2', 'FAILED')] };
  manifest.holdout.sealSha256 = holdoutDigest(manifest);
  return { manifest, runs };
}
function report(input = fixture(), reseal = false) {
  if (reseal) input.manifest.holdout.sealSha256 = holdoutDigest(input.manifest);
  const output = evaluateQuality(input.manifest, input.runs);
  if (output.status === 'INVALID_INPUT') throw new Error(`Unexpected invalid fixture: ${JSON.stringify(output)}`);
  return output;
}

describe('offline quality evaluation — all inputs are SYNTHETIC', () => {
  it('retains FAILED, EXPIRED and source-failed empty targets in primary denominators', () => {
    const output = report(), m = output.metrics!;
    expect(m.sampleCount).toBe(5); expect(m.positiveCount).toBe(3);
    expect(m.hitAt5.value).toBeCloseTo(1 / 3);
    expect(m.fixedPrecisionAt5.value).toBeCloseTo(2 / 15);
    expect(m.fixedPrecisionAt5.denominator).toBe(15);
    expect(m.filledPrecisionAt5.value).toBeCloseTo(2 / 3);
    expect(m.badAt5.value).toBeCloseTo(1 / 3);
    expect(m.meanResultCount.value).toBe(0.6); expect(m.emptyResultRate.value).toBe(0.8);
    expect(m.negativeRejection.value).toBe(0.5); expect(m.negativeSourceFailureCount).toBe(1);
    expect(m.gateFalsePositive.value).toBe(1); expect(m.gateFalseNegative.value).toBe(0.5);
    const ideal = 2 + 2 / Math.log2(3) + 1 / Math.log2(4), actual = 2 + 1 / Math.log2(3);
    expect(m.ndcgAt5?.value).toBeCloseTo(actual / ideal / 3);
    expect(m.sourceExtraction.overall.value).toBe(0.4);
    expect(m.sourceExtraction.byDomain['two.example'].value).toBe(0);
    expect(output.byCategory?.PANTS.hitAt5.value).toBe(0);
    expect(output.byCategory?.PANTS.hitAt5.interval95).toBeNull();
    expect(output.scarcity?.positiveCount).toBe(3);
    expect(output.failures).toHaveLength(3);
  });
  it('keeps a successful retry and references separate from first-attempt quality', () => {
    const input = fixture();
    input.runs.attempts[1].references = ['p2-g'];
    const retry = attempt('p2', 'COMPLETED'); retry.attempt = 2; retry.attemptId = 'p2-2'; retry.results = [result('p2-g')]; retry.gateDecisions = [{ candidateId: 'p2-g', passed: true, reasons: [] }];
    input.runs.attempts.push(retry);
    const output = report(input);
    expect(output.metrics?.hitAt5.value).toBeCloseTo(1 / 3);
    expect(output.attempts.retries).toHaveLength(1);
    expect(output.attempts.referenceCounts.firstAttempts).toBe(1);
    expect(output.attempts.recordedFirstAttempts).toBe(5);
    expect(output.failures.some(item => item.attemptId === 'p2-1')).toBe(true);
  });
  it('holds the complete aggregate for a missing pool label instead of dropping a hard case', () => {
    const input = fixture(); input.manifest.targets[2].candidates[0].labels.grade = null;
    const output = report(input, true);
    expect(output.status).toBe('HELD'); expect(output.metrics).toBeNull(); expect(output.byCategory).toBeNull();
    expect(output.issues.some(item => item.code === 'CANDIDATE_LABELS_MISSING')).toBe(true);
  });
  it('holds an unexecuted target, unknown result candidate, and missing initial attempt', () => {
    const missing = fixture(); missing.runs.attempts.pop(); expect(report(missing).metrics).toBeNull();
    const unknown = fixture(); unknown.runs.attempts[0].results[0].candidateId = 'UNKNOWN'; expect(report(unknown).metrics).toBeNull();
    const noFirst = fixture(); noFirst.runs.attempts[0].attempt = 2; expect(report(noFirst).issues.some(i => i.code === 'ATTEMPT_SEQUENCE_INVALID')).toBe(true);
  });
  it.each(['hash', 'parent', 'product', 'session', 'url', 'group'])('detects cross-split %s leakage without trusting declared group IDs', kind => {
    const input = fixture(), existing = input.manifest.targets[0], related = target('tune-copy', 'positive'); related.split = 'tune';
    if (kind === 'hash') related.imageSha256 = existing.imageSha256;
    if (kind === 'parent') related.groupKeys.parentImageSha256 = existing.imageSha256;
    if (kind === 'product') related.groupKeys.productId = existing.groupKeys.productId;
    if (kind === 'session') { existing.groupKeys.shootingSessionId = 'SYNTHETIC_SESSION'; related.groupKeys.shootingSessionId = 'SYNTHETIC_SESSION'; }
    if (kind === 'url') { existing.groupKeys.pageImageUrl = 'https://img.example/a.jpg?utm_source=a#first'; related.groupKeys.pageImageUrl = 'https://img.example/a.jpg?utm_source=b#second'; }
    if (kind === 'group') related.targetGroupId = existing.targetGroupId;
    input.manifest.targets.push(related);
    expect(report(input, true).issues.some(i => i.code === 'SPLIT_LEAKAGE' && i.holdsMetrics)).toBe(true);
  });
  it('keeps unequal-size target groups in point estimates and uses group-weighted intervals', () => {
    const input = fixture(), copy = structuredClone(input.manifest.targets[0]); copy.targetId = 'p1-crop'; copy.imageSha256 = createHash('sha256').update('crop').digest('hex'); copy.groupKeys.parentImageSha256 = input.manifest.targets[0].imageSha256;
    input.manifest.targets.push(copy);
    const copyAttempt = structuredClone(input.runs.attempts[0]); copyAttempt.targetId = copy.targetId; copyAttempt.attemptId = 'p1-crop-1'; input.runs.attempts.push(copyAttempt);
    const output = report(input, true), m = output.metrics!;
    expect(m.sampleCount).toBe(6); expect(m.independentGroupCount).toBe(5);
    expect(m.hitAt5.value).toBe(0.5); expect(m.hitAt5.method).toBe('HOEFFDING_GROUP_WEIGHTED_95');
    expect(m.fixedPrecisionAt5.value).toBe(0.2);
    expect(output.distribution.holdout.targets).toBe(6); expect(output.distribution.holdout.independentGroups).toBe(5);
    const estimated = boundedMean([1, 1, 0, 0], 1, 'test', ['a', 'a', 'b', 'c']);
    const radius = Math.sqrt(Math.log(40) / 2 * (0.5 ** 2 + 0.25 ** 2 + 0.25 ** 2));
    expect(estimated.value).toBe(0.5); expect(estimated.interval95?.[0]).toBe(Math.max(0, 0.5 - radius));
  });
  it('never calls synthetic or replay data actual LIVE release evidence', () => {
    const output = report(); expect(output.evidence.actualLiveQualityClaim).toBe(false); expect(output.release.status).toBe('BLOCKED');
    expect(output.release.blockers).toContain('SYNTHETIC_NOT_RELEASE_EVIDENCE'); expect(output.release.blockers).toContain('REPLAY_NOT_CURRENT_LIVE_EVIDENCE');
    const input = fixture(); input.runs.kind = 'LIVE'; expect(report(input).release.blockers).toContain('SYNTHETIC_NOT_RELEASE_EVIDENCE');
  });
  it('marks one reviewer, nonblind review and missing rights as unmet without certifying IDs', () => {
    const input = fixture(); input.manifest.targets[0].reviews.pop(); input.manifest.targets[1].reviews[1].blindedToPrice = false; input.manifest.targets[2].rights.status = 'PENDING';
    const output = report(input, true);
    expect(output.humanReview.singleReviewerItems).toBe(1); expect(output.humanReview.pendingReviewItems).toBe(2);
    expect(output.humanReview.identityAndIndependenceVerifiedByHarness).toBe(false);
    expect(output.release.blockers).toContain('TARGET_PROVENANCE_OR_RIGHTS_PENDING');
    expect(output.metrics).not.toBeNull(); // Explicitly provisional arithmetic, not release evidence.
  });
  it('reports pre-adjudication disagreement after resolution and holds unresolved labels', () => {
    const input = fixture(), c = input.manifest.targets[0].candidates[0]; c.reviews[1].judgment.grade = 'BAD';
    expect(report(input, true).metrics).toBeNull();
    c.adjudication = { reviewedBy: 'SYNTHETIC_ADJUDICATOR', reason: 'SYNTHETIC retained GOOD based on fixture', resolvedAt: '2026-01-01T01:00:00.000Z' };
    const output = report(input, true);
    expect(output.metrics).not.toBeNull(); expect(output.humanReview.adjudicatedItems).toBe(1);
    expect(output.humanReview.preAdjudicationAgreement.value).toBeLessThan(1);
  });
  it('detects post-seal mutation, tuning after exposure and invalid unseal chronology', () => {
    const changed = fixture(); changed.manifest.targets[0].labels.category = 'CHANGED'; expect(report(changed).release.blockers).toContain('HOLDOUT_CONTENT_CHANGED');
    const contaminated = fixture(); contaminated.manifest.holdout.usedForTuningAfterExposure = true; expect(report(contaminated).metrics).toBeNull();
    const order = fixture(); order.manifest.holdout.unsealedAt = '2026-01-01T01:00:00.000Z'; expect(report(order).release.blockers).toContain('HOLDOUT_CHRONOLOGY_INVALID');
  });
  it('orders valid timestamps numerically when fractional-second precision differs', () => {
    const input = fixture();
    input.manifest.holdout.sealedAt = '2026-01-01T00:00:00Z';
    input.manifest.holdout.tuningCompletedAt = '2026-01-01T00:00:00.100Z';
    input.manifest.holdout.unsealedAt = '2026-01-01T00:00:00.20Z';
    input.runs.attempts[0].startedAt = '2026-01-04T00:00:00Z';
    input.runs.attempts[0].finishedAt = '2026-01-04T00:00:00.100Z';
    input.runs.executedAt = '2026-01-04T00:00:00.2Z';
    const c = input.manifest.targets[0].candidates[0];
    c.reviews[0].completedAt = '2026-01-01T00:00:00Z';
    c.adjudication = { reviewedBy: 'SYNTHETIC_ADJUDICATOR', reason: 'SYNTHETIC resolution', resolvedAt: '2026-01-01T00:00:00.050Z' };
    const output = report(input, true);
    expect(output.metrics).not.toBeNull();
    expect(output.issues.some(i => i.code.includes('CHRONOLOGY'))).toBe(false);
  });
  it('rejects a true backwards timestamp despite its lexically greater Z suffix', () => {
    const input = fixture(); input.runs.attempts[0].startedAt = '2026-01-04T00:00:00.100Z'; input.runs.attempts[0].finishedAt = '2026-01-04T00:00:00Z';
    expect(report(input).release.blockers).toContain('ATTEMPT_CHRONOLOGY_INVALID');
    const seal = fixture(); seal.manifest.holdout.sealedAt = '2026-01-01T00:00:00.100Z'; seal.manifest.holdout.tuningCompletedAt = '2026-01-01T00:00:00Z';
    expect(report(seal).release.blockers).toContain('HOLDOUT_CHRONOLOGY_INVALID');
  });
  it('keeps zero returned slots undefined and source failures out of successful negative rejection', () => {
    const input = fixture(); input.runs.attempts[0].results = []; input.runs.attempts[0].status = 'FAILED'; input.runs.attempts[0].sourceStatus = 'FAILED';
    const output = report(input);
    expect(output.metrics?.badAt5.value).toBeNull(); expect(output.metrics?.filledPrecisionAt5.value).toBeNull();
    expect(output.metrics?.fixedPrecisionAt5.value).toBe(0); expect(output.metrics?.negativeRejection.value).toBe(0.5);
    expect(output.release.blockers).toContain('BAD_AT5_TARGET_UNMET');
  });
  it('audits invalid prices, unknown shipping reported as zero and excluded recommendations', () => {
    const input = fixture(); input.runs.attempts[0].results[0].itemPrice = 0; input.runs.attempts[0].results[1].shippingFee = 0;
    const bad = input.manifest.targets[0].candidates[3]; bad.labels.domesticNewEligibility = 'EXCLUDED'; bad.reviews = review(bad.labels);
    const output = report(input, true);
    expect(output.hardFails.findings.map(item => item.code)).toEqual(expect.arrayContaining(['INVALID_GENERAL_PRICE', 'UNVERIFIED_SHIPPING_OR_TOTAL', 'EXCLUDED_SOURCE_RECOMMENDED']));
    expect(output.hardFails.count).toBeNull(); expect(output.hardFails.attestedZero).toBe(false);
    expect(output.metrics?.priceQuality.generalPriceValid.value).toBeCloseTo(2 / 3);
  });
  it('does not equate an absent audit with zero hard failures or invent baseline thresholds', () => {
    const output = report(); expect(output.hardFails.count).toBeNull(); expect(output.hardFails.status).toBe('PENDING');
    expect(output.release.blockers).toContain('APPROVED_BASELINE_COMPARISON_PENDING'); expect(output.release.authorizesProductRelease).toBe(false);
  });
  it('deduplicates the nDCG ideal pool by product family, but rejects duplicated result slots', () => {
    const input = fixture(), duplicate = candidate('duplicate-offer', 'GOOD'); duplicate.productGroupId = 'p1-g'; input.manifest.targets[0].candidates.push(duplicate);
    expect(report(input, true).metrics?.ndcgAt5?.value).toBeCloseTo(report().metrics!.ndcgAt5!.value!);
    input.runs.attempts[0].results.push(result('duplicate-offer'));
    expect(report(input, true).metrics).toBeNull();
  });
  it('validates source count caps, malformed envelopes and version mismatch without guessing', () => {
    const counts = fixture(); counts.runs.attempts[0].sourceExtractions[0].succeeded = 4; expect(report(counts).metrics).toBeNull();
    const version = fixture(); version.runs.datasetVersion = 'wrong'; expect(report(version).metrics).toBeNull();
    const strict = fixture(); expect(evaluateQuality({ ...strict.manifest, undeclared: true }, strict.runs).status).toBe('INVALID_INPUT');
  });
  it('uses null intervals for singleton groups and zero denominators; no false certainty', () => {
    expect(boundedMean([1]).interval95).toBeNull();
    expect(boundedMean([1, 1], 1, 'one group', ['a', 'a']).interval95).toBeNull();
    expect(clusteredRatio([0, 0], [0, 0], 5, 'empty').value).toBeNull();
    expect(groupedProportion([true, true], ['a', 'b'], 'test').interval95?.[0]).toBeLessThan(1);
    expect(boundedMean(Array(50).fill(1)).interval95?.[0]).toBeLessThan(1);
  });
  it('returns NOT_MEASURED with no data and provides a usable offline CLI and strict JSON schemas', () => {
    expect(noDataReport().metrics).toBeNull(); expect(noDataReport().release.status).toBe('BLOCKED');
    const cli = spawnSync(process.execPath, ['scripts/evaluate-quality.mjs'], { encoding: 'utf8' });
    expect(cli.status, cli.stderr).toBe(1); expect(JSON.parse(cli.stdout).status).toBe('NOT_MEASURED');
    const schema = JSON.parse(execFileSync(process.execPath, ['scripts/evaluate-quality.mjs', '--schema', 'manifest'], { encoding: 'utf8' }));
    expect(schema.additionalProperties).toBe(false); expect(schema.required).toContain('provenance');
  });
});
