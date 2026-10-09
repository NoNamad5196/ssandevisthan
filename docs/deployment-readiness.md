# Deployment readiness

Checked on 2026-10-09 (Asia/Seoul). This records verified deployment access, not a completed release.

## Current state

- Repository created: https://github.com/NoNamad5196/ssandevisthan. The new repository was empty when created; no existing repository was modified. It is now private because its design assets and internal Notion contracts are not authorized for unrestricted source distribution.
- GitHub CLI authentication works outside the restricted network sandbox. The initial sandboxed `gh auth status` failure was not an expired credential. Existing keyring authentication includes `repo` and `workflow` scope. Never print or copy its credential.
- Cloudflare Pages project `ssandevisthan` was created on the existing account. The frontend is live at https://ssandevisthan.pages.dev. GitHub Actions successfully deployed both the frontend and backend from commit `f095991f621e437bcc6ba2e2f2fb12d0533ba04c`. External Chromium verified HTTP 200, production backend communication, the upload flow, and no page errors. Paid product search remains disabled pending its separate release gates.
- Supabase dashboard login works for organization **NoNamad / Free**. New-project creation is blocked because the owner has reached the **2 active free project** limit. No existing project was paused, deleted, upgraded, or reused.
- The user declined pausing existing Supabase services and authorized an alternative free backend. A new dedicated Neon Free organization `org-cool-smoke-12777013` and project `lucky-sun-06718695` (`ssandevisthan`, AWS Singapore) were created with Postgres, Functions, and private `search-images` object storage. Neon Auth and AI Gateway are disabled because the application implements the contract's anonymous sessions itself and calls OpenAI directly. Existing Neon and Supabase resources were left unchanged.
- A project-scoped Neon API key is stored only in ignored local deployment configuration and the encrypted GitHub `NEON_API_KEY` secret. Broad account-wide CLI OAuth was rejected by automatic approval review and was not granted; the narrower project key solved deployment access. The database connection and branch-only storage read/write credentials are kept in ignored `.secrets/neon.json` and passed only to server tooling.
- OpenAI secret configuration and cumulative pilot budget reconciliation are handled separately. No live provider test is implied by this file.

## CI and frontend deployment

`ci.yml` runs `npm ci`, type checking, deterministic tests, the Vite build, original-asset and font-license verification, and Playwright desktop/mobile UI checks on main and pull requests. It retains the exact built frontend artifact for seven days. `deploy-pages.yml` consumes only the artifact of a successful push to main in this repository. It does not deploy artifacts from pull-request runs.

Configure GitHub **production** environment or repository secrets:

- `CLOUDFLARE_API_TOKEN`: configured as an encrypted repository secret. Account token has only Pages Write permission and expires on 2027-01-08. Renew before expiry without broadening scope.
- `CLOUDFLARE_ACCOUNT_ID`: configured as an encrypted repository secret.

Configure repository variables:

- `CLOUDFLARE_PAGES_PROJECT=ssandevisthan`: configured and verified.
- `CLOUDFLARE_DEPLOY_ENABLED=true`: configured after the free-tier project and deployment secrets were verified.
- `VITE_API_BASE_URL=https://br-polished-resonance-az03nnva-api.compute.c-3.ap-southeast-1.aws.neon.tech`: configured and verified as a GitHub repository variable. The build uses only this origin for its Content Security Policy. No database, storage, OpenAI, or session signing credential may use the `VITE_` prefix or enter frontend artifacts.

The first frontend can be deployed using Pages Direct Upload. Subsequent GitHub Actions runs can use Wrangler against the same Direct Upload project. Cloudflare does not allow converting a Direct Upload project to built-in Git integration; GitHub Actions direct upload is a supported continuous-deployment path.

The initial frontend preview does not authorize enabling LIVE searches before backend checks pass. Production backend order remains schema/RLS → worker/API → contract smoke → frontend integration → budgeted live canary → cleanup/cost verification. Existing databases require non-destructive migrations and rollback evidence.

## Cloud prerequisites still requiring action

1. Obtain the user's historical OpenAI pilot expenditure, then reconcile the cumulative ledger. Unknown historical spend must fail closed under the Notion USD 20 ceiling. The safe budget bootstrap defaults to a dry run and preserves disabled execution even when explicitly applied.
2. After rates, model capabilities, cost bounds, and remaining free quotas pass their release gates, run a budgeted real OpenAI canary and actual product-search tests. Verify persisted execution, cancellation, quality holdouts, and at least ten cost smoke cases within the remaining cumulative budget. Public upload, owner isolation, cleanup, and scheduling have passed; they do not establish LIVE product-search success.
3. Secure sufficient trustworthy product evidence from permitted sources. Musinsa is blocked pending an authorized data path, and the inspected 11st samples produced no eligible candidates. Keep zero-results and partial failures honest. Complete the remaining functional-control visual review and distinguish all REPLAY fixtures from LIVE evidence.

## Official sources checked

- [Cloudflare Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)
- [Cloudflare Direct Upload with GitHub Actions](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)
- [Cloudflare Pages free limits](https://developers.cloudflare.com/pages/platform/limits/): 500 builds/month, 20,000 files/site, 25 MiB per asset. Actual dashboard observations and their limits are recorded below.
- [Supabase billing FAQ](https://supabase.com/docs/guides/platform/billing-faq): two active free projects; paused projects do not count. Dashboard quota confirmation takes precedence over assumptions.
- [Operations/release contract v3](https://app.notion.com/p/3ec7cdef782d8146917ec72af0ef8d89)

No paid infrastructure, automatic billing, or additional paid services were enabled during this readiness check.

## Phase B visual and UI evidence

The 1586×992 desktop and 390×844 mobile screenshots were inspected directly. Desktop logo, industrial background, clothing collage, and the distinctive main headline preserve the source image. The upload form and hot-deal controls remain real, keyboard-operable HTML controls. Mobile keeps the yellow/black palette, cut corners, original logo, and layered clothing artwork.

`node scripts/verify-assets.mjs` passes for all 19 source-derived artwork files, exact source PNG SHA-256, two official font hashes, and the committed font notices. The check derives every crop, transparent cutout, and explicitly declared adjacent-texture resize from the original PNG. It does not depend on ignored download files or rewrite license notices. Gmarket's embedded English/Korean license text is preserved, including the vendor's additional promotion clause.

The unmasked desktop comparison reports 3.696% of pixels with at least one channel differing by more than 24/255, with mean channel difference 3.944/255. Logo and clothing collage regions have zero difference. Remaining differences are chiefly the functional UI text, icons, reconstructed text backdrops, header navigation, and hot-deal controls. These diagnostics are **not** an automatic visual acceptance threshold, and do not mean every rendered pixel matches the reference.

Reproduce the evidence with `npm run test:e2e`, then `node scripts/verify-visual.mjs test-results/visual/home-1586x992.png`. An optional third argument chooses a durable evidence directory. Inspected local copies are under ignored `.cache/deployment/phase-b/`. The current production capture is `.cache/deployment/production/home-1586x992.png`; its unmasked report under `.cache/deployment/production/verified/` matches the local metrics above. The capture waits for font, DOM-image, and CSS-background decoding, including pseudo-elements, before recording pixels. An earlier capture before CSS artwork loaded was discarded as invalid evidence.

The eight deterministic home Playwright tests cover five viewport sizes (1586, 1440, 1280, 390, and 360 pixels wide), missing/undecoded assets and fonts including CSS backgrounds, overflow, upload MIME/size/decode validation, image replacement, hot-deal minimum-length validation, keyboard focus, privacy-dialog focus restoration, reduced motion, and concurrent image decoding. These tests do not call paid providers and do not establish LIVE search success.

Ten additional `@mock` browser tests exercise the real frontend against contract-validated synthetic API responses. They cover anonymous authentication, binary content upload/finalization, retained idempotency key after a failed search submission, queued/running/result polling, shipping-cohort sort behavior using the actual Gate/ranker fixtures, all empty/error/partial/cancel states, deletion, owner mismatch on refresh, malformed-price rejection, and text deals. The combined local suite passed **17/17** in 50.2 seconds on 2026-10-09. All remote requests are intercepted and unrecognized destinations fail closed; the mock suite is skipped when `E2E_BASE_URL` is supplied so it cannot masquerade as a LIVE deployment test. Its isolated Vite server receives a synthetic `.test` API origin, and its screenshots are prefixed `MOCK-`.

## Verified automated deployment and public smoke

- [Verify application run 37903786309](https://github.com/NoNamad5196/ssandevisthan/actions/runs/37903786309) passed the Linux build, type checks, deterministic tests, asset/font verification, and 17 Playwright checks. The first Linux run exposed CRLF-versus-LF differences in the saved font notice; verification now normalizes line endings without altering license content.
- [Deploy frontend run 37903985288](https://github.com/NoNamad5196/ssandevisthan/actions/runs/37903985288), attempt 2, successfully deployed the same tested commit. A malformed token value in the first attempt was corrected using an exact-byte CLI secret update. Any token exposed during the failed configuration flow was subsequently rotated, retaining the same scope and expiry. The active token is stored only in ignored configuration and encrypted GitHub secrets.
- At **2026-10-09 17:34 KST**, the opt-in `@cloud` Playwright test passed in 6.7 seconds against the actual public URL. Health reported `searchEnabled:false`; anonymous auth returned 200, upload creation 201, binary content 200, finalize 200, search submission the expected honest 503, and fixture deletion 204. No purchase result was fabricated. The page reported no JavaScript errors. The sanitized report is `.cache/deployment/production/browser-smoke.json`; auth responses and tokens are excluded from traces and reports.
- The public desktop screenshot was independently compared with `design/reference/original.png`. Original logo and clothing collage regions match exactly. Main source lettering, industrial texture, yellow/black palette, panel silhouette, and region positions are retained. Functional UI caption widths, font rasterization, small button/icon details and hot-deal controls still differ; the 3.696% full-image diagnostic is not a claim of complete pixel identity or human design approval.
- Five read-only production viewport tests subsequently passed in 8.2 seconds at 1586, 1440, 1280, 390, and 360 pixels wide, with no overflow, missing artwork/fonts, or page errors. The inspected mobile captures are `.cache/deployment/production/home-390x844.png` and `home-360x800.png`. Mobile preserves the original logo and collage; clipped filter-border corners remain a minor visual difference.

Run the public smoke only with `E2E_BASE_URL=https://ssandevisthan.pages.dev` and `E2E_LIVE_SMOKE=paid-disabled`. It refuses to proceed if health says paid search is enabled, uses a repository-owned fixture, and requests deletion afterwards. This is a **real infrastructure** test with **no LIVE product-search success**.

## Actual free-tier dashboard observations

Read-only account checks on **2026-10-09, approximately 17:27–17:35 KST** showed:

| Service / counter | Observed usage | Interpretation |
| --- | --- | --- |
| Dedicated Neon organization plan | Free, $0/month | No upgrade or automatic billing enabled |
| Neon compute | 0.15 CU-hours of 100 included | About 99.85 CU-hours remaining at the displayed timestamp |
| Neon database storage | 0.03 GB of 1 GB | About 0.97 GB remaining at the displayed timestamp |
| Neon history / network transfer | 0.01 GB / 0 GB | Dashboard-reported rounded usage |
| Neon project / branch count | 1 project, 1 of 10 branches | Existing unrelated resources were not reused |
| Neon object storage | `search-images`, Private | Actual byte usage was not displayed; remaining object-storage quota is unverified |
| Neon Functions | `api` deployment Completed, `search-sweep` trigger present | Active-hour consumption was not displayed; remaining Functions quota is unverified |
| Cloudflare Workers account requests | 0 / 100,000 today | This is the Workers counter, not static Pages visitors |
| Cloudflare observability events | 0 / 200,000 today | Dashboard counter |
| Cloudflare CPU / Workers build minutes | 0 ms / 0 minutes | Dashboard counter; does not establish monthly Pages build allowance |
| Cloudflare Pages deployments | 2 visible deployments | Initial direct upload and verified GitHub Actions upload |
| Pages Metrics, last 24 hours | Requests success 0, errors 0; no data available | Function-oriented metrics; static Web Analytics is disabled and was left unchanged |

Neon explicitly warns that metrics may lag by one hour and may not update for inactive projects. These rounded values are observations, not instantaneous metering. Cloudflare did not expose a verified remaining monthly Pages-build count in the inspected dashboards; no zero-usage or 500-build-remaining assumption is made. OpenAI historical expenditure and LIVE search cost remain separately tracked release prerequisites.

## Latest unpaid checkpoint

At 2026-10-09 18:02 KST, all 292 deterministic unit/integration tests in 14 files passed, including the disabled budget bootstrap and merchant-policy regressions. Root and API TypeScript checking and the production Vite build also passed. The full local browser suite passed 18 tests in 40.9 seconds; the opt-in cloud test was intentionally skipped in that local run and has its separate real-infrastructure evidence above. Original artwork/font verification and the tracked-source/frontend credential scan also pass. The mobile filter corner outlines were visually corrected without changing the desktop original.

Both automated deployments for commit `f095991f621e437bcc6ba2e2f2fb12d0533ba04c` succeeded: [backend](https://github.com/NoNamad5196/ssandevisthan/actions/runs/37907036832) and [frontend](https://github.com/NoNamad5196/ssandevisthan/actions/runs/37907036883). The backend workflow independently checked the successful current main, built ARM64 on Linux, applied checksummed additive migrations, deployed, and checked HTTPS health. Pre-existing anonymous access and refresh credentials still resolved to the same owner after deployment. Paid execution stayed disabled.

The supplied OpenAI credential can read `gpt-6.1-sol` model metadata: GET returned HTTP 200 at 08:48 UTC, recorded in `docs/deployment/openai-model-access.json`. This confirms model access only. No paid image analysis, structured output, web search, product-search canary, ten-run cost smoke or quality holdout has yet succeeded or been claimed. Historical pilot expenditure remains unverified, so available budget is explicitly unknown rather than assumed to be USD 20.

Public merchant inspections are recorded separately from LIVE search. All 12 inspected 11st pages were excluded. The Musinsa cached page and public stock response support a precise price/option observation, but its source policy restricts automated collection. Its runtime GET/POST and generic fallbacks are blocked; the parser remains offline technical validation only. This source is not counted as a live eligible recommendation.
