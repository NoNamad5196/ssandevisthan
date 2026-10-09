# Deterministic search core

This package implements the v3 bootstrap policy without external calls:

- Unknown-aware visual ordinal and controlled attribute scores; source eligibility and all fixed Similarity Gate thresholds.
- Verified field evidence bound to product, offer, variant, observation time and merchant source; model/search/community claims cannot establish ordinary prices.
- Five-minute fresh price eligibility, explicit unknown shipping, full-cohort midrank price score and product-group representative offers.
- Immutable snapshot sort projections after scoring the full eligible population. Sorting never repeats a provider request or changes thresholds. TOTAL_PRICE and ITEM_PRICE_ONLY remain separate price cohorts.
- Separate DEAL_TEXT relevance rules and price sort; V/A/S/finalScore remain null. No HOT_DEAL claim is inferred from a community price.
- HTTPS host, IPv4/IPv6, redirect and DNS-answer policy; variant-preserving canonical URLs; deterministic query round-robin and merchant diversity selection.
- Terminal outcome meanings and one-way state-transition policy.

`rankImageCandidates(candidates, now)` / `rankDealCandidates(candidates, now)` return a `RankingSnapshot`. Persist it atomically with the run's terminal state. `projectSnapshot(snapshot, sort, resultLimit)` projects the already stored order. Candidate commerce facts must already have adapter evidence; source-policy booleans cannot be guesses from Korean text or a `.kr` domain.

The network helpers do not fetch or prove DNS pinning. Calling code must validate every resolved IP and connect only to a validated destination, including each redirect. Unsupported or unverified transport must fail closed. Browser fallback after access denial is forbidden.

All tests are labeled SYNTHETIC. Bootstrap thresholds and taxonomy have not been measured on the required human-labeled holdout; their tests verify computation and boundaries, not real-world recommendation quality.

DEAL_TEXT policy reconciliation: backend §8 names category/model hard mismatches, whereas operations §6.4 also forbids required qualifier mismatches. The implementation uses the conservative intersection: known mismatches of query-specified qualifiers reject regardless of score, and an exact requested model must be observed. The documented 0.50/0.25/0.25 weights and 0.60 threshold are unchanged. Unspecified qualifiers are not added as requirements; unobserved non-model modifiers stay unknown and are scored as zero. A deterministic versioned title parser is deliberately limited; unrecognized query categories return INVALID_INPUT rather than invented semantic evidence. These implementation choices do not modify the Notion documents.
