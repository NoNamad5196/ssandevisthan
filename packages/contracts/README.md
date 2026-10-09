# v3 contracts

Source: `docs/contracts/database.md`, `ranking.md`, `backend.md` (Notion snapshots dated 2026-10-09).

All public input schemas are strict, require `schemaVersion: 3`, and reject owner, provider, arbitrary URL, model and reference-price overrides. DTO enums preserve the contract's exact spelling and case. Runtime refinements additionally check price cohorts, observed attributes, selected-variant stock and terminal-state semantics. `createOpenApiDocument()` produces an OpenAPI 3.1 document directly from these schemas.

The Notion contract gives controlled-vocabulary examples but does not supply a complete taxonomy, optional diagnostics vocabulary, or conditional-price object layout. This implementation fixes these as conservative, explicitly versioned bootstrap choices. `attribute-taxonomy-v3-bootstrap-1` uses exact category matching; `attribute-compatibility-v3-bootstrap-1` permits only the documented BLACK/CHARCOAL and REGULAR/RELAXED partial matches. There is no asserted calibrated accuracy. `identifiedOriginal` remains null while original-product identification is not implemented; it is never a prerequisite for search.

Dates are UTC RFC3339. All prices are safe integer KRW; 10 MB means 10,000,000 bytes. Zod URL validation is structural, not a network authorization mechanism. Server fetches must use the search-core URL/DNS policy and a transport that pins the validated address to prevent DNS rebinding.

`packages/fixtures` and `*.test.ts` contain synthetic offline cases only. They cannot establish actual provider, merchant, cloud, image, price, holdout or production correctness.
