import { createHash } from 'node:crypto';
import { ManifestSchema, RunBundleSchema, REQUIRED_SLICES, type Manifest, type Target, type Candidate, type RunBundle } from './schema.ts';
import { boundedMean, metrics, type ScoredRun } from './metrics.ts';
export * from './schema.ts';

export interface Issue { code: string; path: string; detail: string; holdsMetrics: boolean }
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
};
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
/** This detects changes against a separately retained seal; a caller-supplied
 * hash alone cannot prove when sealing occurred or who performed the reviews. */
export function holdoutDigest(manifest: Manifest): string {
  return digest({ datasetVersion: manifest.datasetVersion, provenance: manifest.provenance, mode: manifest.mode, categoryMinimums: manifest.categoryMinimums, crossDistributionMinimums: manifest.crossDistributionMinimums, targets: manifest.targets.filter(t => t.split === 'holdout').sort((a, b) => a.targetId.localeCompare(b.targetId)) });
}
const unique = <T>(values: T[]) => [...new Set(values)];
const instant = (value: string) => Date.parse(value);
const countBy = (values: string[]) => Object.fromEntries(unique(values).sort().map(value => [value, values.filter(v => v === value).length]));
const nullFields = (value: object) => Object.entries(value).filter(([, item]) => item === null).map(([key]) => key);
const validRights = (rights: Target['rights']) => rights.status === 'CONFIRMED' && !!rights.basis && !!rights.reviewedBy;
const normalizeImageUrl = (value: string) => {
  const url = new URL(value); url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key) || /^(gclid|fbclid)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort(); return url.toString();
};
const hostnameValid = (value: string) => /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(value) && value.includes('.') && !value.includes('..');
const LIMITATIONS = [
  'Offline calculation only: the harness performs no provider, merchant, image, deployment, or human-review verification.',
  'REAL/LIVE flags, reviewer identities, rights, blind review, budget, seals, baseline approval and audits are supplied attestations. Two IDs do not prove two real people. Retain independently auditable evidence.',
  'REPLAY does not establish current stock, current price or current source coverage. SYNTHETIC never establishes actual search quality.',
  'Point estimates include every first target attempt, including failure, expiry and empty results. References and retries never increase primary scores.',
  'Intervals assume independence between declared target groups, not within groups. Group weights equal target counts divided by target count; sum(weight^2) preserves target-weighted point estimates. Unknown dependence cannot be detected from hashes alone.',
  'Wilson 95% is used only for independent Bernoulli target groups. Bounded metrics use conservative weighted Hoeffding 95%; ratios use joint 97.5% mean bounds with a union bound. Intervals are pointwise, not simultaneous across all reported metrics. One independent group or no denominator has a null interval.',
  'This report cannot authorize a product release. Security, design, operations and actual LIVE integration evidence remain separate release requirements.',
] as const;

export function noDataReport() {
  return { schemaVersion: 1, status: 'NOT_MEASURED', evidence: null, metrics: null, byCategory: null, scarcity: null, release: { status: 'BLOCKED', blockers: ['MISSING_EVALUATION_MANIFEST_AND_RUNS'], provisionalContractTargets: { independentTargets: 100, tuneGroups: 50, holdoutGroups: 50, holdoutPositiveGroups: 40, holdoutNegativeGroups: 10, hitAt5: 0.85, maximumBadAt5: 0.10 }, authorizesProductRelease: false }, limitations: LIMITATIONS };
}

export function evaluateQuality(manifestInput: unknown, runsInput: unknown) {
  const parsedManifest = ManifestSchema.safeParse(manifestInput), parsedRun = RunBundleSchema.safeParse(runsInput);
  if (!parsedManifest.success || !parsedRun.success) {
    const issues: Issue[] = [
      ...(!parsedManifest.success ? parsedManifest.error.issues.map(issue => ({ code: 'INVALID_MANIFEST', path: `manifest.${issue.path.join('.')}`, detail: issue.code, holdsMetrics: true })) : []),
      ...(!parsedRun.success ? parsedRun.error.issues.map(issue => ({ code: 'INVALID_RUN_BUNDLE', path: `runs.${issue.path.join('.')}`, detail: issue.code, holdsMetrics: true })) : []),
    ];
    return { ...noDataReport(), status: 'INVALID_INPUT' as const, issues, release: { ...noDataReport().release, blockers: unique(issues.map(issue => issue.code)) } };
  }
  const manifest = parsedManifest.data, runs = parsedRun.data;
  const issues: Issue[] = [];
  const issue = (code: string, path: string, detail: string, holdsMetrics = false) => issues.push({ code, path, detail, holdsMetrics });
  const selected = manifest.targets.filter(target => target.split === runs.split);
  const targetMap = new Map(manifest.targets.map(target => [target.targetId, target]));
  if (targetMap.size !== manifest.targets.length) issue('DUPLICATE_TARGET_ID', 'manifest.targets', 'Target IDs must be unique.', true);
  if (manifest.datasetVersion !== runs.datasetVersion) issue('DATASET_VERSION_MISMATCH', 'runs.datasetVersion', 'Run and manifest versions differ.', true);
  if (!selected.length) issue('EMPTY_SELECTED_SPLIT', 'manifest.targets', 'There are no selected targets.', true);
  if (manifest.provenance !== 'REAL') issue('SYNTHETIC_NOT_RELEASE_EVIDENCE', 'manifest.provenance', 'Synthetic inputs test calculations only.');
  if (runs.kind !== 'LIVE') issue('REPLAY_NOT_CURRENT_LIVE_EVIDENCE', 'runs.kind', 'Replay cannot establish current external availability.');
  if (runs.split !== 'holdout') issue('HOLDOUT_NOT_EVALUATED', 'runs.split', 'Tune results cannot replace sealed holdout evaluation.');
  if (!manifest.groupingAudit.confirmed || !manifest.groupingAudit.evidence || !manifest.groupingAudit.reviewedBy) issue('GROUPING_AUDIT_PENDING', 'manifest.groupingAudit', 'Hashes do not detect every crop, color variant or related shooting session.');
  if (!runs.reviewer) issue('REPORT_REVIEWER_PENDING', 'runs.reviewer', 'Report review is not attested.');
  if (runs.budget.actualMicrousd === null || runs.budget.reservedMicrousd === null) issue('BUDGET_MEASUREMENT_PENDING', 'runs.budget', 'Unknown cost is not zero.');
  if (runs.budget.actualMicrousd !== null && runs.budget.reservedMicrousd !== null && runs.budget.actualMicrousd > runs.budget.reservedMicrousd) issue('SPEND_EXCEEDS_RESERVATION', 'runs.budget', 'Reported actual spend exceeds reservation.');

  // Group identity is checked independently of the caller's target_group_id.
  // Repeated members within a correctly declared group remain in point estimates.
  const identities = new Map<string, Target[]>();
  for (const target of manifest.targets) {
    const keys = [`group:${target.targetGroupId}`, `hash:${target.imageSha256}`];
    if (target.groupKeys.parentImageSha256) keys.push(`hash:${target.groupKeys.parentImageSha256}`);
    if (target.groupKeys.productId) keys.push(`product:${target.groupKeys.productId}`);
    if (target.groupKeys.shootingSessionId) keys.push(`session:${target.groupKeys.shootingSessionId}`);
    if (target.groupKeys.pageImageUrl) keys.push(`image-url:${normalizeImageUrl(target.groupKeys.pageImageUrl)}`);
    for (const key of unique(keys)) identities.set(key, [...(identities.get(key) ?? []), target]);
  }
  for (const [key, targets] of identities) {
    if (unique(targets.map(t => t.split)).length > 1) issue('SPLIT_LEAKAGE', 'manifest.targets', `${key.split(':')[0]} identity crosses tune/holdout: ${targets.map(t => t.targetId).join(', ')}`, true);
    if (unique(targets.map(t => t.targetGroupId)).length > 1) issue('GROUP_IDENTITY_MISMATCH', 'manifest.targets', `${key.split(':')[0]} identity is assigned multiple groups: ${targets.map(t => t.targetId).join(', ')}`, true);
  }
  const distribution = Object.fromEntries((['tune', 'holdout'] as const).map(split => {
    const targets = manifest.targets.filter(t => t.split === split);
    const groupCount = (subset: Target[]) => unique(subset.map(t => t.targetGroupId)).length;
    const categoryGroups = Object.fromEntries(unique(targets.map(t => t.labels.category ?? 'UNLABELED')).sort().map(category => [category, groupCount(targets.filter(t => (t.labels.category ?? 'UNLABELED') === category))]));
    const sliceGroups = Object.fromEntries(REQUIRED_SLICES.map(slice => [slice, groupCount(targets.filter(t => t.slices.includes(slice)))]));
    if (groupCount(targets) < 50) issue('INSUFFICIENT_INDEPENDENT_SPLIT_SAMPLE', `manifest.${split}`, `Need at least 50 independent groups; found ${groupCount(targets)}.`);
    for (const [category, minimum] of Object.entries(manifest.categoryMinimums)) if ((categoryGroups[category] ?? 0) < minimum) issue('CATEGORY_MINIMUM_UNMET', `manifest.${split}.${category}`, `Declared minimum ${minimum}; found ${categoryGroups[category] ?? 0} groups.`);
    for (const [slice, count] of Object.entries(sliceGroups)) if (!count) issue('REQUIRED_SLICE_MISSING', `manifest.${split}.${slice}`, 'Required distribution is absent.');
    for (const cross of manifest.crossDistributionMinimums) if (groupCount(targets.filter(t => t.labels.category === cross.category && t.slices.includes(cross.slice))) < cross.minimum) issue('CROSS_DISTRIBUTION_MINIMUM_UNMET', `manifest.${split}.${cross.category}.${cross.slice}`, `Declared minimum ${cross.minimum} not met.`);
    return [split, { targets: targets.length, independentGroups: groupCount(targets), uniqueImageHashes: unique(targets.map(t => t.imageSha256)).length, positiveGroups: groupCount(targets.filter(t => t.labels.polarity === 'positive')), negativeGroups: groupCount(targets.filter(t => t.labels.polarity === 'negative')), categoryTargets: countBy(targets.map(t => t.labels.category ?? 'UNLABELED')), categoryGroups, sliceGroups }];
  }));
  if (unique(manifest.targets.map(t => t.targetGroupId)).length < 100) issue('INSUFFICIENT_TOTAL_INDEPENDENT_SAMPLE', 'manifest.targets', 'At least 100 independent groups required by the provisional initial target.');
  if (distribution.holdout.positiveGroups < 40 || distribution.holdout.negativeGroups < 10) issue('HOLDOUT_POLARITY_MINIMUM_UNMET', 'manifest.holdout', 'Need at least 40 independent positive and 10 negative groups.');
  if (!Object.keys(manifest.categoryMinimums).length || !manifest.crossDistributionMinimums.length) issue('DISTRIBUTION_PLAN_MISSING', 'manifest', 'Category minima and cross-distribution minima must be declared before evaluation.');

  const seal = manifest.holdout, computedSeal = holdoutDigest(manifest);
  if (!seal.sealedAt || !seal.sealSha256 || !seal.tuningCompletedAt || !seal.unsealedAt) issue('HOLDOUT_SEAL_PENDING', 'manifest.holdout', 'Seal and tuning/unseal chronology are incomplete.');
  if (seal.sealSha256 && seal.sealSha256 !== computedSeal) issue('HOLDOUT_CONTENT_CHANGED', 'manifest.holdout.sealSha256', 'Current holdout differs from the supplied seal.', true);
  if (seal.sealedAt && seal.tuningCompletedAt && seal.unsealedAt && !(instant(seal.sealedAt) <= instant(seal.tuningCompletedAt) && instant(seal.tuningCompletedAt) <= instant(seal.unsealedAt) && instant(seal.unsealedAt) <= instant(runs.executedAt))) issue('HOLDOUT_CHRONOLOGY_INVALID', 'manifest.holdout', 'Require sealing ≤ tuning completion ≤ unsealing ≤ evaluation.', true);
  if (seal.usedForTuningAfterExposure) issue('HOLDOUT_CONTAMINATED', 'manifest.holdout', 'Exposed holdout used for tuning requires a new holdout.', true);

  const reviewPairs: { agreement: boolean; group: string }[] = [];
  let reviewedItems = 0, singleReviewerItems = 0, pendingReviewItems = 0, adjudicatedItems = 0;
  function inspectReviews(entity: Target | Candidate, path: string, target: Target) {
    if (target.split !== 'holdout') return;
    reviewedItems++;
    const reviewers = unique(entity.reviews.map(review => review.reviewerId));
    if (reviewers.length === 1) singleReviewerItems++;
    if (reviewers.length !== entity.reviews.length) issue('DUPLICATE_REVIEWER', path, 'Repeated reviewer IDs cannot supply independent votes.');
    const eligible = entity.reviews.filter(review => review.independent && review.blindedToPrice && review.blindedToSystemScore && !nullFields(review.judgment).length);
    if (unique(eligible.map(review => review.reviewerId)).length < 2) { pendingReviewItems++; issue('INDEPENDENT_BLIND_REVIEW_PENDING', path, 'Need at least two distinct complete independent blind review attestations.'); }
    if (entity.reviews.length >= 2) reviewPairs.push({ agreement: canonical(entity.reviews[0].judgment) === canonical(entity.reviews[1].judgment), group: target.targetGroupId });
    const disagreement = entity.reviews.some(review => canonical(review.judgment) !== canonical(entity.reviews[0].judgment));
    const finalChanged = entity.reviews.some(review => canonical(review.judgment) !== canonical(entity.labels));
    if ((disagreement || finalChanged) && !entity.adjudication) issue('ADJUDICATION_PENDING', path, 'Disagreement or a changed final label needs a recorded resolution.', true);
    if (entity.adjudication) {
      adjudicatedItems++;
      if (entity.reviews.some(review => instant(review.completedAt) > instant(entity.adjudication!.resolvedAt))) issue('ADJUDICATION_CHRONOLOGY_INVALID', path, 'Resolution predates an independent review.', true);
    }
  }
  for (const target of manifest.targets) {
    const path = `targets.${target.targetId}`, selectedTarget = target.split === runs.split;
    if (!target.source || !validRights(target.rights)) issue('TARGET_PROVENANCE_OR_RIGHTS_PENDING', path, 'Source and confirmed usage rights with reviewer/basis required.');
    if (nullFields(target.labels).length) issue('TARGET_LABELS_MISSING', path, `Missing fields: ${nullFields(target.labels).join(', ')}`, selectedTarget);
    if ((target.labels.polarity === 'positive' && target.labels.availableAlternativeCount === 0) || (target.labels.polarity === 'negative' && target.labels.availableAlternativeCount !== null && target.labels.availableAlternativeCount > 0)) issue('POLARITY_ALTERNATIVE_COUNT_CONFLICT', path, 'Positive/negative rationale conflicts with verified alternatives.', selectedTarget);
    inspectReviews(target, path, target);
    const candidateIds = target.candidates.map(c => c.candidateId);
    if (unique(candidateIds).length !== candidateIds.length) issue('DUPLICATE_CANDIDATE_ID', path, 'Candidate IDs must be unique per target.', selectedTarget);
    for (const candidate of target.candidates) {
      const candidatePath = `${path}.candidates.${candidate.candidateId}`;
      if (nullFields(candidate.labels).length || candidate.labels.domesticNewEligibility === 'UNKNOWN') issue('CANDIDATE_LABELS_MISSING', candidatePath, 'Every fixed-pool candidate needs a complete grade, reason and eligibility judgment.', selectedTarget);
      if (!candidate.canonicalProductId || !candidate.canonicalOfferId || !candidate.productGroupId || !candidate.merchant || !candidate.productUrl || !candidate.observedAt || !candidate.productEvidence || !candidate.imageEvidence || !candidate.priceEvidence) issue('CANDIDATE_EVIDENCE_MISSING', candidatePath, 'Canonical identity, source, observation and product/image/price evidence required.', selectedTarget);
      if (candidate.productUrl && new URL(candidate.productUrl).protocol !== 'https:') issue('CANDIDATE_HTTPS_SOURCE_REQUIRED', candidatePath, 'Evidence URL must use HTTPS.', selectedTarget);
      if (!validRights(candidate.rights)) issue('CANDIDATE_RIGHTS_PENDING', candidatePath, 'Candidate evidence usage rights remain unverified.');
      inspectReviews(candidate, candidatePath, target);
    }
    const goodGroups = unique(target.candidates.filter(c => c.labels.domesticNewEligibility === 'ELIGIBLE' && c.labels.grade !== null && c.labels.grade !== 'BAD').map(c => c.productGroupId));
    if (target.labels.polarity === 'positive' && !goodGroups.length) issue('POSITIVE_IDEAL_POOL_EMPTY', path, 'Positive target requires a verified GOOD/ACCEPTABLE alternative in the fixed ideal pool.', selectedTarget);
    if (target.labels.availableAlternativeCount !== null && goodGroups.length > target.labels.availableAlternativeCount) issue('ALTERNATIVE_COUNT_BELOW_LABELED_POOL', path, 'Verified distinct labeled alternatives exceed declared availability.', selectedTarget);
  }

  const hardFindings = [...runs.hardFailAudit.findings];
  const hard = (code: string, targetId: string, detail: string) => hardFindings.push({ code, targetId, detail });
  const attemptIds = runs.attempts.map(a => a.attemptId);
  if (unique(attemptIds).length !== attemptIds.length) issue('DUPLICATE_ATTEMPT_ID', 'runs.attempts', 'Attempt IDs must be unique.', true);
  for (const attempt of runs.attempts) {
    const target = targetMap.get(attempt.targetId), path = `attempts.${attempt.attemptId}`;
    if (!target || target.split !== runs.split) { issue('UNKNOWN_OR_WRONG_SPLIT_TARGET', path, 'Attempt target must belong to selected split.', true); continue; }
    if (instant(attempt.startedAt) > instant(attempt.finishedAt) || instant(attempt.finishedAt) > instant(runs.executedAt)) issue('ATTEMPT_CHRONOLOGY_INVALID', path, 'Attempt timestamps are inconsistent.', true);
    if (runs.split === 'holdout' && seal.unsealedAt && instant(attempt.startedAt) < instant(seal.unsealedAt)) issue('ATTEMPT_PRECEDES_UNSEAL', path, 'Holdout run started before declared unsealing.', true);
    if ((['COMPLETED', 'PARTIAL'].includes(attempt.status)) !== (attempt.results.length > 0)) issue('TERMINAL_RESULTS_CONFLICT', path, 'Only COMPLETED/PARTIAL contain purchase results.', true);
    const candidateMap = new Map(target.candidates.map(c => [c.candidateId, c]));
    const usedIds = [...attempt.results.map(r => r.candidateId), ...attempt.references, ...attempt.gateDecisions.map(g => g.candidateId)];
    if (usedIds.some(id => !candidateMap.has(id))) issue('UNLABELED_OUTPUT_CANDIDATE', path, 'Output or evaluated Gate candidate is outside the fixed labeled pool.', true);
    const resultGroups = attempt.results.map(r => candidateMap.get(r.candidateId)?.productGroupId).filter(Boolean);
    if (unique(resultGroups).length !== resultGroups.length) issue('DUPLICATE_RECOMMENDED_PRODUCT_GROUP', path, 'Multiple offers of one product cannot inflate independent alternatives.', true);
    if (unique(attempt.gateDecisions.map(g => g.candidateId)).length !== attempt.gateDecisions.length) issue('DUPLICATE_GATE_DECISION', path, 'A candidate may have only one final Gate decision per attempt.', true);
    if (unique(attempt.references).length !== attempt.references.length || attempt.references.some(id => attempt.results.some(result => result.candidateId === id))) issue('REFERENCE_RESULT_OVERLAP', path, 'References must be distinct and separate from recommendations.', true);
    if (attempt.discoveredDomains.some(domain => !hostnameValid(domain) || domain !== domain.toLowerCase()) || unique(attempt.discoveredDomains).length !== attempt.discoveredDomains.length) issue('INVALID_DISCOVERED_DOMAINS', path, 'Use distinct lowercase hostnames, without URL paths.', true);
    if (attempt.sourceExtractions.some(source => source.succeeded > source.attempted || !hostnameValid(source.domain)) || attempt.sourceExtractions.reduce((sum, s) => sum + s.attempted, 0) > 30 || unique(attempt.sourceExtractions.map(s => s.domain)).length !== attempt.sourceExtractions.length) issue('INVALID_SOURCE_EXTRACTION_COUNTS', path, 'Extraction attempts cap at 30; successes cannot exceed attempts.', true);
    for (const result of attempt.results) {
      if (candidateMap.get(result.candidateId)?.labels.domesticNewEligibility === 'EXCLUDED') hard('EXCLUDED_SOURCE_RECOMMENDED', target.targetId, `${attempt.attemptId}: excluded candidate ${result.candidateId}`);
      if (!result.unconditionalPriceVerified || result.currency !== 'KRW' || !Number.isSafeInteger(result.itemPrice) || result.itemPrice! <= 0) hard('INVALID_GENERAL_PRICE', target.targetId, `${attempt.attemptId}: ${result.candidateId}`);
      if ((result.shippingFee !== null && (!result.shippingFeeVerified || !Number.isSafeInteger(result.shippingFee) || result.shippingFee < 0)) || (result.priceBasis === 'TOTAL_PRICE' && (result.shippingFee === null || !result.shippingFeeVerified))) hard('UNVERIFIED_SHIPPING_OR_TOTAL', target.targetId, `${attempt.attemptId}: ${result.candidateId}`);
      if (!result.priceObservedAt || !Object.values(result.displayed).every(Boolean) || result.priceBasis === 'UNKNOWN') hard('REQUIRED_PRICE_DISPLAY_MISSING', target.targetId, `${attempt.attemptId}: ${result.candidateId}`);
      if (attempt.gateDecisions.find(g => g.candidateId === result.candidateId)?.passed !== true) hard('RESULT_WITHOUT_PASSED_GATE', target.targetId, `${attempt.attemptId}: ${result.candidateId}`);
    }
  }
  const firstRows: ScoredRun[] = [];
  for (const target of selected) {
    const attempts = runs.attempts.filter(attempt => attempt.targetId === target.targetId).sort((a, b) => a.attempt - b.attempt);
    if (!attempts.length) { issue('MISSING_FIRST_ATTEMPT', `targets.${target.targetId}`, 'Unexecuted target cannot be silently excluded from the denominator.', true); continue; }
    if (attempts.some((attempt, index) => attempt.attempt !== index + 1 || (index > 0 && instant(attempt.startedAt) < instant(attempts[index - 1].finishedAt)))) issue('ATTEMPT_SEQUENCE_INVALID', `targets.${target.targetId}`, 'Preserve first attempt and ordered, distinct retry numbers.', true);
    firstRows.push({ target, attempt: attempts[0] });
  }
  const held = issues.some(item => item.holdsMetrics);
  const overall = held ? null : metrics(firstRows);
  if (!overall) issue('CONFIRMED_METRICS_HELD', 'metrics', 'Missing labels, incomplete attempts or integrity issues prevent a complete confirmed aggregate.');
  if (overall?.hitAt5.value === null || overall?.hitAt5.value === undefined || overall.hitAt5.value < 0.85) issue('HIT_AT5_TARGET_UNMET', 'metrics.hitAt5', 'Provisional target ≥0.85 is not established.');
  if (overall?.badAt5.value === null || overall?.badAt5.value === undefined || overall.badAt5.value > 0.10) issue('BAD_AT5_TARGET_UNMET', 'metrics.badAt5', 'Provisional target ≤0.10 is not established; empty denominator never passes.');
  if (!overall || !overall.negativeCount || overall.negativeForcedResultCount > 0 || overall.negativeRejection.value !== 1) issue('NEGATIVE_REJECTION_NOT_ESTABLISHED', 'metrics.negativeRejection', 'No forced negative results and successful source-backed rejection required.');
  if (!overall || overall.gateFalsePositive.value === null || overall.gateFalseNegative.value === null) issue('GATE_ERROR_RATES_NOT_MEASURED', 'metrics', 'Both evaluated BAD and evaluated GOOD denominators required.');
  if (!overall?.diversity.casesWithAtLeastThreeDiscoveredSources) issue('THREE_SOURCE_SMOKE_MISSING', 'metrics.diversity', 'No first attempt demonstrates at least three discovered domains.');
  if (runs.hardFailAudit.status !== 'COMPLETE' || !runs.hardFailAudit.reviewedBy || !runs.hardFailAudit.evidence) issue('HARD_FAIL_AUDIT_PENDING', 'runs.hardFailAudit', 'Absence of findings is not evidence that all hard-fail classes were audited.');
  if (hardFindings.length) issue('HARD_FAIL_FOUND', 'hardFails', `${hardFindings.length} supplied or automatically detected hard failures.`);
  const baseline = runs.baselineReview;
  if (!baseline.approved || !baseline.evaluationId || !baseline.sameDatasetSplitFixtureCriteria || !baseline.noRegression || !baseline.fixedPrecisionTargetMet || !baseline.ndcgTargetMet || !baseline.sourceCoverageTargetMet || !baseline.approvedBy || !baseline.evidence) issue('APPROVED_BASELINE_COMPARISON_PENDING', 'runs.baselineReview', 'Fixed P@5, nDCG and source coverage targets require an approved baseline comparison; no threshold is invented.');
  const status: 'HELD' | 'MEASURED_WITH_BLOCKERS' | 'READY_FOR_HUMAN_REVIEW' = held ? 'HELD' : issues.length ? 'MEASURED_WITH_BLOCKERS' : 'READY_FOR_HUMAN_REVIEW';
  const auditComplete = runs.hardFailAudit.status === 'COMPLETE' && !!runs.hardFailAudit.reviewedBy && !!runs.hardFailAudit.evidence;
  return {
    schemaVersion: 1, status,
    evidence: { provenance: manifest.provenance, executionKind: runs.kind, actualLiveQualityClaim: false, classification: `${manifest.provenance}_${runs.kind}` },
    metadata: { evaluationId: runs.evaluationId, executedAt: runs.executedAt, gitSha: runs.gitSha, environment: runs.environment, datasetVersion: manifest.datasetVersion, mode: manifest.mode, split: runs.split, versions: runs.versions, provider: runs.provider, model: runs.model, budget: runs.budget, author: runs.author, reviewer: runs.reviewer, manifestSha256: digest(manifest), runsSha256: digest(runs), computedHoldoutSeal: computedSeal },
    distribution,
    metrics: overall,
    byCategory: held ? null : Object.fromEntries(unique(firstRows.map(row => row.target.labels.category!)).sort().map(category => [category, metrics(firstRows.filter(row => row.target.labels.category === category))])),
    scarcity: held ? null : metrics(firstRows.filter(row => row.target.labels.polarity === 'positive' && row.target.labels.availableAlternativeCount! < 5)),
    attempts: { selectedTargets: selected.length, recordedFirstAttempts: firstRows.length, firstStatusCounts: countBy(firstRows.map(row => row.attempt.status)), totalRecorded: runs.attempts.length, retries: runs.attempts.filter(a => a.attempt > 1).map(a => ({ attemptId: a.attemptId, targetId: a.targetId, attempt: a.attempt, status: a.status, results: a.results.length, excludedFromPrimaryMetrics: true })), referenceCounts: { firstAttempts: firstRows.reduce((sum, row) => sum + row.attempt.references.length, 0), retries: runs.attempts.filter(a => a.attempt > 1).reduce((sum, a) => sum + a.references.length, 0), includedInRecommendationMetrics: false } },
    failures: runs.attempts.filter(a => a.failureReasons.length || ['FAILED', 'EXPIRED', 'CANCELED'].includes(a.status)).map(a => ({ attemptId: a.attemptId, targetId: a.targetId, attempt: a.attempt, status: a.status, sourceStatus: a.sourceStatus, reasons: a.failureReasons })),
    gateReasons: runs.attempts.map(a => ({ attemptId: a.attemptId, targetId: a.targetId, primary: a.attempt === 1, decisions: a.gateDecisions })),
    humanReview: { provenance: manifest.provenance, identityAndIndependenceVerifiedByHarness: false, holdoutItems: reviewedItems, singleReviewerItems, pendingReviewItems, adjudicatedItems, preAdjudicationAgreement: boundedMean(reviewPairs.map(pair => Number(pair.agreement)), 1, 'FIRST_TWO_RECORDED_REVIEWS_PER_HOLDOUT_ITEM', reviewPairs.map(pair => pair.group)) },
    hardFails: { status: hardFindings.length ? 'FAILED' : auditComplete ? 'COMPLETE' : 'PENDING', attestedZero: auditComplete && !hardFindings.length, verification: 'SUPPLIED_ATTESTATION_AND_AUTOMATIC_INPUT_CHECKS_ONLY', count: auditComplete ? hardFindings.length : null, detectedOrReportedCount: hardFindings.length, findings: hardFindings },
    issues, release: { status: issues.length ? 'BLOCKED' : 'READY_FOR_HUMAN_REVIEW', blockers: unique(issues.map(item => item.code)), provisionalContractTargets: noDataReport().release.provisionalContractTargets, authorizesProductRelease: false }, limitations: LIMITATIONS,
  };
}
