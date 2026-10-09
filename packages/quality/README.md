# Offline quality evaluation

Implements measurement and evidence checks from [operations contract §§2–5](../../docs/contracts/operations.md). It makes **no network or paid API calls**. No REAL evaluation dataset or actual human reviews are supplied by this package. The tests are explicitly SYNTHETIC and cannot demonstrate LIVE search success.

```sh
node scripts/evaluate-quality.mjs
node scripts/evaluate-quality.mjs --schema manifest > manifest.schema.json
node scripts/evaluate-quality.mjs --schema runs > runs.schema.json
node scripts/evaluate-quality.mjs --seal path/to/manifest.json
node scripts/evaluate-quality.mjs --manifest path/to/manifest.json --runs path/to/attempts.json --output path/to/new-report.json
npx vitest run packages/quality/src/quality.test.ts
```

The no-input command returns `NOT_MEASURED`, null metrics and `release: BLOCKED` (exit 1). Exit 2 means invalid input or an I/O error. An existing output file is never overwritten. A result ready for human review exits 0; it **does not authorize a product release**. JSON schemas are generated from the strict runtime schemas, so unknown fields are rejected. Input JSON is capped at 32 MB. The CLI uses the repository's existing esbuild and deletes its temporary compiled module under `.cache`.

## Inputs and sealing

`schema.ts` defines two separate documents. The manifest declares `REAL|SYNTHETIC` provenance, IMAGE_SIMILAR or DEAL_TEXT mode, target/group identities, tune/holdout split, usage rights, source evidence, attributes, positive/negative rationale, fixed candidate pool, eligibility, GOOD/ACCEPTABLE/BAD labels and blind independent review attestations. Runs declare `LIVE|REPLAY`, immutable version/budget/report metadata, all terminal attempts, actual returned purchase results, separate references, final Gate decisions and attempted/successful source extraction counts. Mode-specific evaluations must use separate manifests; IMAGE_SIMILAR and DEAL_TEXT are never pooled.

Every target requires an attempt numbered 1, even when FAILED, EXPIRED, canceled or empty. Add retries with increasing numbers and new IDs; retain the original. Missing attempts or labels hold the complete confirmed aggregate instead of silently removing difficult targets. Every output/Gate/reference candidate must belong to the declared labeled pool. Fix and review the pool before publishing a confirmed nDCG evaluation; newly found unlabeled candidates keep that evaluation on hold.

Retain the digest from `--seal` in an independently controlled record before unsealing. It covers dataset version/provenance/mode, declared distribution minima and all holdout targets, candidate pools, labels and reviews. It excludes lifecycle fields so the seal digest can be recorded in the manifest. Changing sealed content requires an explicitly new dataset version and review; generating a replacement digest after exposure does not undo contamination. The CLI cannot prove historical sealing, identity, independence, copyright rights, or that two reviewer IDs are two real humans. Such fields are **attestations requiring external evidence**, recorded as such in every report.

Exact image hashes, parent/crop hashes, original product ID, normalized page-image URL, shooting-session ID and declared target group detect cross-split leakage and inconsistent group assignment. Tracking parameters and fragments are ignored for page-image identity; option-bearing URL parameters are preserved. Visual near-duplicates and unrecorded related sessions require the declared grouping audit. Multiple targets in one group are retained in point estimates; they do not count as independent samples toward the unchanged provisional 100 / tune 50 / holdout 50 / positive 40 / negative 10 targets. Category and category×slice minima are declared per split in the manifest; required slices must occur in both splits.

## Metric meaning

Only the first attempt's `results` contributes to recommendation metrics. References, successful retries and failed sources are reported separately. Primary means include failures and empty output. Every metric includes its scope, numerator/denominator, target count, independent group count and 95% interval. Category and positive scarcity (<5 alternatives) reports accompany the overall report.

- Hit@5 and Fixed P@5 use all positive targets. Fixed P@5 always allocates five slots per positive target; empty slots score zero.
- Filled P@5 and Bad@5 use all actually returned top-five slots. A zero filled denominator is null, never success. Negative rejection requires NO_RELIABLE_MATCH, no recommendations and successful sources; a source-failed empty run is not a correct rejection.
- Gate FP is passed BAD / evaluated BAD; Gate FN is rejected GOOD / evaluated GOOD. Decisions and reasons remain in the report, including retries separately.
- nDCG uses linear gain GOOD=2, ACCEPTABLE=1, BAD=0 and log2 position discount. Its ideal ranking is the best grade per product group across the entire fixed labeled candidate pool, sorted by gain. Multiple merchant offers of one product cannot inflate alternatives. Commercial eligibility is a separate hard-fail check and does not change the ideal pool after seeing output.
- Diversity reports distinct product groups, merchants and domains, plus maximum domain share for nonempty top-five results. Source extraction success uses attempted extractions as denominator. Price validity, known shipping and observation-time display are distinct; unknown shipping stays null.

Intervals account for all correlation within a target group. Point estimates stay target-weighted: group weight is its target count divided by the evaluated target count. Bounded means use radius `range * sqrt(log(40) * sum(groupWeight²) / 2)`. Ratios use joint 97.5% bounds on bounded per-target numerator/denominator means, then a union bound for a conservative 95% interval. Fixed ranges are 5 result slots, 10 result count, 60 Gate decisions, 150 discovered domains and 30 page extractions. Distinct independent Bernoulli targets use Wilson 95%; repeated groups use the weighted bound instead. Intervals assume independence between groups, are pointwise rather than family-wise, and are null for one independent group or zero denominator. Conservative wide intervals are retained rather than tuned to show a pass.

## Release interpretation

The contract's provisional Hit@5 ≥85%, Bad@5 ≤10%, independent sample counts, complete source-backed negative rejection, complete independent review attestations and zero audited hard failures remain unchanged. Fixed P@5 / nDCG / source-coverage numerical targets are **not invented**: approval and comparison against a baseline using the same dataset/split/fixtures/criteria remain a separately evidenced requirement. A pending hard-fail audit has a null count, even if automatic checks found nothing. Detected invalid price/eligibility/shipping/display/Gate outputs are separately enumerated.

SYNTHETIC, REPLAY-only, tune-only, missing rights, incomplete labels, leakage, insufficient independent samples, missing baseline, pending human review and unmeasured criteria block release review. A complete REAL/LIVE input is still a supplied evidence declaration, not a network verification by this harness. Source availability, actual provider usage, design, security, operational checks and human approval remain independently required.
