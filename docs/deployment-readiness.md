# Deployment readiness

Checked on 2026-10-09 (Asia/Seoul). This records verified deployment access, not a completed release.

## Current state

- Repository created: https://github.com/NoNamad5196/ssandevisthan. The new repository was empty when created; no existing repository was modified. It is now private because its design assets and internal Notion contracts are not authorized for unrestricted source distribution.
- GitHub CLI authentication works outside the restricted network sandbox. The initial sandboxed `gh auth status` failure was not an expired credential. Existing keyring authentication includes `repo` and `workflow` scope. Never print or copy its credential.
- Cloudflare Pages project `ssandevisthan` was created on the existing account. The first frontend deployment is live at https://ssandevisthan.pages.dev (immutable deployment https://12e0f061.ssandevisthan.pages.dev). External Chromium verified HTTP 200, the upload control, and no page errors. This initial deployment does not yet contain a configured live search backend.
- Supabase dashboard login works for organization **NoNamad / Free**. New-project creation is blocked because the owner has reached the **2 active free project** limit. No existing project was paused, deleted, upgraded, or reused.
- The user declined pausing existing Supabase services and authorized an alternative free backend. A new dedicated Neon Free organization `org-cool-smoke-12777013` and project `lucky-sun-06718695` (`ssandevisthan`, AWS Singapore) were created with Postgres, Functions, and private `search-images` object storage. Neon Auth and AI Gateway are disabled because the application implements the contract's anonymous sessions itself and calls OpenAI directly. Existing Neon and Supabase resources were left unchanged.
- OpenAI secret configuration and cumulative pilot budget reconciliation are handled separately. No live provider test is implied by this file.

## CI and frontend deployment

`ci.yml` runs `npm ci`, type checking, deterministic tests, the Vite build, original-asset and font-license verification, and Playwright desktop/mobile UI checks on main and pull requests. It retains the exact built frontend artifact for seven days. `deploy-pages.yml` consumes only the artifact of a successful push to main in this repository. It does not deploy artifacts from pull-request runs.

Configure GitHub **production** environment or repository secrets:

- `CLOUDFLARE_API_TOKEN`: configured as an encrypted repository secret. Account token has only Pages Write permission and expires on 2027-01-08. Renew before expiry without broadening scope.
- `CLOUDFLARE_ACCOUNT_ID`: configured as an encrypted repository secret.

Configure repository variables:

- `CLOUDFLARE_PAGES_PROJECT=ssandevisthan`: configured and verified.
- `CLOUDFLARE_DEPLOY_ENABLED=true`: configured after the free-tier project and deployment secrets were verified.
- `VITE_API_BASE_URL`: pending the actual deployed backend HTTPS origin. The build uses this origin for its Content Security Policy. No database, storage, OpenAI, or session signing credential may use the `VITE_` prefix or enter frontend artifacts.

The first frontend can be deployed using Pages Direct Upload. Subsequent GitHub Actions runs can use Wrangler against the same Direct Upload project. Cloudflare does not allow converting a Direct Upload project to built-in Git integration; GitHub Actions direct upload is a supported continuous-deployment path.

The initial frontend preview does not authorize enabling LIVE searches before backend checks pass. Production backend order remains schema/RLS → worker/API → contract smoke → frontend integration → budgeted live canary → cleanup/cost verification. Existing databases require non-destructive migrations and rollback evidence.

## Cloud prerequisites still requiring action

1. Push the completed CI/deployment workflows and verify a successful GitHub-triggered Pages deployment. Deployment credentials and project variables are ready; a successful workflow run has not yet been observed.
2. Authenticate Neon CLI to the dedicated Free project and apply the backend's non-destructive schema, RLS, server-only secrets, private storage credentials, functions, dispatcher/cleanup schedules, and permitted frontend origin.
3. Configure `VITE_API_BASE_URL` and rebuild/redeploy the frontend once the actual backend endpoint is available.
4. Reconcile prior OpenAI pilot expenditure/reservations before enabling any paid call. Unknown historical spend must fail closed under the Notion USD 20 cumulative ceiling.
5. Verify the issued HTTPS deployment with real anonymous-user A/B isolation, upload, persisted queue execution, cancellation, trustworthy product evidence, live OpenAI behavior, and retention cleanup. Report REPLAY fixtures separately from LIVE tests.

## Official sources checked

- [Cloudflare Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)
- [Cloudflare Direct Upload with GitHub Actions](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)
- [Cloudflare Pages free limits](https://developers.cloudflare.com/pages/platform/limits/): 500 builds/month, 20,000 files/site, 25 MiB per asset. Account usage remains unverified until login.
- [Supabase billing FAQ](https://supabase.com/docs/guides/platform/billing-faq): two active free projects; paused projects do not count. Dashboard quota confirmation takes precedence over assumptions.
- [Operations/release contract v3](https://app.notion.com/p/3ec7cdef782d8146917ec72af0ef8d89)

No paid infrastructure, automatic billing, or additional paid services were enabled during this readiness check.
