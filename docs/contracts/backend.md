Here is the result of "fetch" for the Page with URL https://app.notion.com/p/3ec7cdef782d81f4948ed3a2597f9b6b as of 2026-10-09T05:52:49.088Z:
<page url="https://app.notion.com/p/3ec7cdef782d81f4948ed3a2597f9b6b" icon="🛠️">
<ancestor-path>
<parent-page url="https://app.notion.com/p/3ea7cdef782d8127ae12ebad49065f19" title="싼데비슷한 / SSANDEVISTHAN — AI 유사 저가 상품 검색"/>
<ancestor-2-data-source url="collection://4a1725c4-940c-470a-b663-d0e89ff7ef4f" name="💡 아이디어 일지"/>
<ancestor-3-database url="https://app.notion.com/p/df70dbe7750447ecab7e58a27e891f58" title="💡 아이디어 일지"/>
</ancestor-path>
<properties>
{"title":"SSANDEVISTHAN — 백엔드 구현 아키텍처 v3"}
</properties>
<iconMetadata>{"type":"emoji","emoji":"🛠️"}</iconMetadata>
<content>
<callout icon="🛠️" color="yellow_bg">
	**SSANDEVISTHAN — 실사용 백엔드 구현 계약 v3**
	사진 특징 → 검색어 확장 → 국내 상품 후보 → 실제 판매 이미지/가격/옵션 근거 → 유사도 Gate → 가격 반영 순위가 핵심이다. 원본 상품을 먼저 식별하는 시스템으로 바꾸지 않는다.
	시각 구현은 기존 목업이 최상위 기준이다. 기술 편의·라이브러리 기본값·개발 시간 때문에 글꼴·색상·레이아웃·모션·디자인을 바꾸지 않는다.
</callout>
개정일: <mention-date start="2026-10-09"/>. **문서·계약 개정 완료이며 서비스 구현/연결/성능 검증 완료가 아니다.** 5시간 데모를 위한 owner 생략·RLS 연기·무근거 fallback·품질 축소는 폐기한다.
# 1. 영역별 정본과 결정 상태
- 제품 범위/명칭: <mention-page url="https://app.notion.com/p/3ea7cdef782d8127ae12ebad49065f19">싼데비슷한 / SSANDEVISTHAN — AI 유사 저가 상품 검색</mention-page>.
- 실제 디자인·타이포그래피·재구성 모션/반응형: <mention-page url="https://app.notion.com/p/3f47cdef782d8145b2a8ee2543d43d7c"/>.
- 검색·유사도·가격 정책은 Search & Ranking, wire schema·DB·상태는 API·데이터, 평가·운영·릴리스는 검증 계약이 정본이다. 이 문서가 목업보다 우선한다는 전역 순위는 없다.
- **POLICY**: 사용자 확정과 데이터·비용·디자인 불변 원칙. **IMPLEMENTATION**: 이번에 채택한 구현 설계. **PROVISIONAL**: threshold·timeout 하위 예산·동시성 등 실측 후 버전 변경할 초기값. **DEFERRED**: 지금 만들지 않는 기능.
# 2. 기술 구성과 책임
- Frontend: React + Vite + TypeScript, React Router, TanStack Query, Zod. 기존 목업 자산과 프로젝트 CSS token을 중심으로 구축한다. Tailwind/Motion은 구현 수단이며 기본 스타일이 디자인 정본을 대체하지 않는다.
- API/worker: Supabase Edge Functions의 Deno/TypeScript. HTTP router는 입력/권한/접수/조회만 담당하고 검색은 영속 job의 작은 step으로 실행한다.
- 데이터: Supabase PostgreSQL, anonymous Auth JWT, RLS, private Storage의 정규화 임시 이미지. Redis·별도 유료 queue·vector DB를 전제하지 않는다.
- 작업 실행: PostgreSQL `search_jobs` + lease + checkpoint. 서버 wake-up과 주기 recovery를 조합한다. DB가 실행 상태의 정본이다.
- 모델: 서버 설정 `OPENAI_MODEL=gpt-6.1-sol`, Responses API. structured output을 schema 검증한 뒤 사용한다. 모델 문자열을 프론트에서 받지 않는다.
- 검색: Responses `web_search`의 출처를 URL 후보로 사용. 이미지 검색은 선택적 발견·보강 경로이며 판매처 이미지 대응 검증을 대신하지 않는다.
- 추출: 일반 HTTPS fetch + JSON-LD/OG/공개 상품 state + 필요한 merchant adapter. Chromium을 Supabase 함수 안에서 실행하지 않는다.
- 브라우저 보강: 무료 Cloudflare Browser Run은 검증된 정상 동적 페이지에만, feature flag 기본 OFF. 차단된 페이지 우회 수단이 아니다.
- 호스팅: Cloudflare Pages Free, CI: GitHub Actions 무료 사용 범위. Free 계정 설정과 실제 한도는 배포 시 확인한다.
- 비용: OpenAI API만 유료 허용. 다른 서비스는 무료 한도를 넘기면 제한/중단한다.
## 공식 기능과 별도 실측의 경계
- [GPT-6.1 Sol 공식 모델 문서](https://developers.openai.com/api/docs/models/gpt-6.1-sol): Responses tool calling·web search·structured outputs 지원을 확인했다. 계정 권한·요율·rate limit은 해당 프로젝트에서 별도 확인한다.
- [Web search 공식 문서](https://developers.openai.com/api/docs/guides/tools-web-search): `web_search_call.action.sources`와 `web_search_call.results`를 요청해 출처/결과를 읽는다. 이미지 결과는 `search_content_types`에 image를 포함한다. assistant의 prose만 파싱해 URL을 복원하지 않는다.
- [Supabase Edge 제한](https://supabase.com/docs/guides/functions/limits): 확인 시점 Free wall150초, CPU2초, 메모리256MB. 90초 검색 설계가 CPU·메모리 적합성을 자동 보장하지 않는다. sharp/libvips 기반 이미지를 Edge에서 전제하지 않는다.
- [Supabase 예약 실행](https://supabase.com/docs/guides/functions/schedule-functions): pg_cron + pg_net 및 Vault를 이용한 서버 wake-up/recovery를 구성할 수 있다. 실제 설정·권한·주기·부하는 별도 smoke로 검증한다.
- [Supabase 익명 인증](https://supabase.com/docs/guides/auth/auth-anonymous): 회원가입 폼 없이 사용자 ID를 만든다. 공개 anon key와 익명 로그인 사용자를 혼동하지 않는다.
- [Cloudflare Browser Run 가격/무료 한도](https://developers.cloudflare.com/browser-run/pricing/): 확인 시점 Free10분/일·동시3 browser. 앱은 8분/일·동시1로 더 낮게 차단한다. 플랫폼·계정 조건 확인 없이는 활성화하지 않는다.
위 외부 정보 확인일은 2026-10-09다. 공식 지원과 이 프로젝트의 통합 테스트 성공은 별개다.
# 3. 저장소와 모듈 경계
```plain text
apps/web/                   원본 디자인 자산, routes, feature UI
packages/contracts/         schemaVersion3 DTO, Zod, enum, OpenAPI export
packages/search-core/       pure gate/rank/price/url logic, versioned config
packages/fixtures/          synthetic provider/merchant snapshots, labels
supabase/functions/api/     auth, validation, upload, accept/poll/cancel/delete
supabase/functions/worker/  internal-auth dispatcher, bounded job execution
supabase/functions/sweep/   expiry, cleanup, recovery, stale leases
supabase/migrations/        schema, constraints, RLS, transactions, indexes
supabase/shared/providers/  OpenAI wrapper, budget, timeout, usage
supabase/shared/extractors/ generic extractor, merchant adapter registry
design/                    original PNG, asset/font manifest, visual baselines
docs/decisions/             accepted version changes and measured tradeoffs
```
모듈은 다음처럼 입력/출력·실패를 제한한다.
- InputNormalizer: bytes → validated normalized image metadata/storage reference. 이미지 데이터가 아닌 해시·크기·normalizer version을 다른 모듈에 전달. 손상·과대·멀티프레임은 명시적 오류.
- VisionAnalyzer: signed private input → 관측 속성/UNKNOWN/근거. 속성 schema 실패는 1회 이내 재시도 후 FAILED. 사진에서 가격·소재 비율·브랜드를 만들어내지 않는다.
- QueryExpander: 관측 속성 → 4–8개 질의/타입. 중복 질의 제거·순번 고정. model이 만든 URL을 후보로 받지 않는다.
- SearchAggregator: query → 실제 search tool URL/source 결과. 응답 type별 parsing 후 최대150개 발견 record. source 실패를 개별 기록.
- URLNormalizer/SourcePolicy: URL→canonical/merchant/variant-sensitive key; 새상품/국내/재고 판정. 미확인을 true로 변환하지 않는다.
- ProductPageExtractor: 후보 URL→상품·variant·offer·image 후보와 필드별 evidence. 페이지 본문 지시를 실행하지 않는다.
- ImageResolver: 페이지가 실제 참조한 상품 이미지→safe decoded reference. 광고·리뷰·추천 카드·다른 옵션 이미지는 거절.
- SimilarityService: 원본·후보 이미지/속성→rubric V/A/coverage/근거. raw similarity와 user-facing 설명을 구분.
- Gate/PriceNormalizer/Ranker: 순수 함수. 외부 네트워크 없이 버전 설정과 후보 snapshot을 받아 PASS/REJECT·가격집단·cohortRank를 계산.
- SearchRepository: owner·run·operation key로 read/write. 트랜잭션·lease fencing·snapshot 불변성을 담당.
- BudgetGuard: 유료 외부 호출 전 비용 예약, 완료/불명확 응답 정산, 새 호출 차단.
- EvidenceService: 필드별 출처·추출 시각·옵션·hash·confidence를 관리. 모델 추정과 판매 페이지 확인값을 구별.
# 4. 영속 비동기 검색
## 4.1 접수와 실행
1. 익명 JWT 검증 후 업로드 create → binary 검증/정규화 → finalize. 업로드 자체에서 paid model 호출하지 않는다.
2. owner+Idempotency-Key+서버 입력 digest 확인. 예산·동시 작업 슬롯·업로드 단일 사용을 원자적으로 예약하고 run/job을 저장한다.
3. API는 `202 + searchId + poll URL`을 반환. 응답 후 메모리 background task만 존재하는 구조는 사용하지 않는다.
4. commit된 job에 서버 wake-up을 요청. worker는 내부 자격 증명으로만 호출 가능하며 PUBLIC 사용자에게 stage 실행권을 주지 않는다.
5. worker는 DB claim을 통해 최대20초 lease와 attempt token을 얻는다. provider 호출→checkpoint→다음 job→현재 DONE을 원자적으로 commit한다.
6. stage 진행: VALIDATING→ANALYZING→DISCOVERING→EXTRACTING→COMPARING→RANKING. 각 stage는 여러 bounded job으로 나눌 수 있다.
7. 프론트는 2–5초 polling. stage를 실제 진행 문구 하나로 표시. 탭 닫힘은 취소가 아니며 90초 deadline 내 DB job은 유효하다.
8. 최종 snapshot과 terminal status를 같은 transaction으로 확정한다. 재조회는 새 모델 호출이나 재랭킹을 유발하지 않는다.
## 4.2 wake-up·recovery의 구체 규칙
- 최초/다음 단계 commit 후 내부 dispatcher가 worker를 깨운다. durable outbox/job row가 먼저 기록되어야 한다. wake-up 응답 유실로 job이 사라지지 않는다.
- pg_cron recovery는 매분 READY/expired lease/기한 경과 run을 조회하고 누락 wake-up·cleanup을 복구한다. 빠른 일반 경로는 즉시 wake-up이며 매분 poll만으로 낮은 latency를 약속하지 않는다.
- 매번 dispatcher는 active run·job·budget을 다시 확인하고 job별 1개 lease만 허용한다. lease 재발급은 attempt가 증가하고 새 token을 만든다.
- 늦은 worker는 token 또는 attempt 불일치 시 commit을 버린다. lease TTL20초와 worker wall20초의 경계에서 commit 여유를 위해 외부 요청은 step 잔여시간보다 최소2초 일찍 중단한다.
- queued/active deadline은 접수 후90초. recovery가 늦게 도착해도 이후 paid 작업을 시작하지 않는다. 조회 API도 deadline 경과를 검사하고 idempotent finalize를 요청한다.
- provider는 exactly-once를 보장한다고 가정하지 않는다. 외부 결과 유실로 비용이 불명확하면 해당 예약을 유지하고 불필요한 중복 유료 재시도를 하지 않는다.
## 4.3 초기 동시성·재시도
- 앱 전체 active search2, 사용자별 active search1, 검색 생성 사용자당5회/10분을 초기 상한으로 둔다. 익명 ID 재생성 우회는 별도 IP 해시 rate cap과 전역 예산으로 제한한다. rate 값은 PROVISIONAL이며 측정 후 버전 변경.
- HTTP 추출 동시4, merchant별1, 유료 모델/검색 요청 앱 전체2, browser1. stage/계정 quota가 더 낮으면 낮은 값을 따른다.
- HTTP 연결+읽기 기본8초, browser 최대12초, 모델/web search 최대16초, 현재 step 잔여시간−2초보다 길게 설정하지 않는다.
- operation 최대2 attempts(최초+1 retry). 네트워크 transient/5xx만 jitter backoff. 429는 Retry-After가 전체deadline 안에 들어오면 재시도, 아니면 해당 경로 중단. 400/401/403/CAPTCHA/AccessDenied/schema 오염은 무작정 재시도하지 않는다.
- 정상 HTML에 데이터가 없고 JS 렌더링이 필요한 경우만 browser 승격. 403/429/차단 뒤 browser·프록시·IP 변경으로 재시도하지 않는다.
- query≤8, raw≤150, dedup≤60, extract 후보≤30, compare 후보≤20, purchase results≤10, references≤5. attempts와 tool call 비용은 별도 원장에도 모두 집계한다.
- 단계별 목표는 analysis10s, discovery25s, extraction25s, comparison20s, rank/write5s+여유5s. 고정 순차 대기를 뜻하지 않으며 총90초가 최종 상한이다. 실측이 느리면 결과 수를 정직하게 줄이고 PARTIAL을 낸다.
# 5. OpenAI adapter 계약
## 5.1 호출 구분
- analyze: 원본 정규화 image + 속성 schema. `store:false`, 서버 versioned prompt, output schema, bounded output tokens. 원본 바이트/전체 prompt는 로그 제외.
- expand: 관측 속성 기반 query 목록. 가능하면 analyze 결과에서 함께 받아 별도 호출을 줄이되 두 schema 검증 책임을 분리한다.
- discover: 질의와 web_search 도구. sources/results에서 받은 URL을 추출. assistant summary의 가격은 판매가 증거가 아니다.
- compare: 후보별 ID와 원본/후보 이미지를 명시한 소규모 묶음. 후보 ID 누락·중복·잘못된 연결은 실패. 점수는 검색 계약 rubric을 따른다.
- explain: 별도 생성 호출을 기본 사용하지 않는다. matched/different/unknown 배열을 템플릿으로 표시한다.
## 5.2 도구 호출과 근거
```typescript
// 실제 배포 전 SDK/계정 smoke가 필요한 연결 형태 예시
const response = await client.responses.create({
  model: config.model,
  store: false,
  reasoning: { effort: "low" },
  tools: [{ type: "web_search" }],
  include: ["web_search_call.action.sources", "web_search_call.results"],
  input: versionedDiscoveryPrompt(query),
  max_output_tokens: config.discoveryOutputCap
});
// prose에 등장하는 모든 링크가 아니라 실제 tool item의 출처를 검증한다.
```
- image 보강 옵션은 공식 문서의 `search_content_types:["image","text"]`, `image_settings`로 구성하되 account smoke를 통과한 feature flag에서만 켠다.
- 모든 호출은 model/prompt/schema/tool configuration version, provider request ID, input/output/캐시 usage, 호출시간, budget reservation key를 기록한다.
- 출력은 strict Zod/schema에서 unknown key·invalid enum·범위 밖 점수·가짜 URL을 차단한다. provider refusal/비어 있음/incomplete/truncated output과 정상 결과0건을 구분한다.
- 모델이 반환한 점수 confidence는 확률 보장이 아니다. 가격/배송/재고는 명시적인 판매 정보 출처 없이 모델로 채우지 않는다.
- 외부 콘텐츠가 시스템 지시를 가장해도 경계 밖 data로만 전달한다. tool allowlist·URL 정책·가격 규칙을 모델이 바꾸지 못하게 서버에서 enforce한다.
# 6. 추출·어댑터·보안
## 6.1 Generic extractor
1. URL normalize 후 공개 HTTPS·허용 포트443·userinfo 없음·호스트 검증.
2. DNS A/AAAA가 사설/loopback/link-local/metadata 주소인지 검사. redirect는 최대3번이며 매번 동일 검사. DNS 검증과 실제 연결 목적지가 달라질 수 있는 구현은 fail-closed 또는 검증된 egress 경로 사용.
3. 응답 stream 최대2MB HTML, 읽기8초. text/html 외 형식은 경로에 맞게 거절. 압축 해제 후 byte 상한도 검사한다.
4. JSON-LD Product/Offer → 공개 embedded product JSON → OG/DOM 대조. 임의 JS 실행은 금지, JSON 데이터만 parse.
5. product/variant ID와 title/image/price/stock/shipping 대응을 확인. 서로 충돌하는 옵션은 unknown.
6. 이미지 최대10MB·24MP·안전 decode, 원본 요청과 같은 SSRF 정책. 로고/리뷰/광고/추천 이미지 제외.
7. confidence가 부족하면 정상 실패 코드로 남긴다. placeholder로 similarity를 계산하지 않는다.
## 6.2 Adapter interface
```typescript
type ExtractionResult = {
  status: "VERIFIED" | "PARTIAL" | "BLOCKED" | "UNSUPPORTED" | "FAILED";
  canonicalUrl: string;
  productKey: string | null;
  variantKey: string | null;
  fields: Record<string, {
    value: unknown;
    evidenceId: string | null;
    state: "VERIFIED" | "UNKNOWN" | "CONFLICTING";
  }>;
  errorCode: string | null;
  extractorVersion: string;
};
```
- adapters는 `canHandle(host)`, `extract(validatedContext)`, `normalizeOffer`, `selectProductImage`를 제공한다. arbitrary fetch 권한을 따로 만들지 않고 공통 SafeFetcher를 사용한다.
- matcher는 정확한 registrable domain·허용 subdomain으로 검사한다. `example.com.attacker.test`를 contains 검사로 허용하지 않는다.
- selector/schema 변경은 고정 fixture→shadow extraction→오탐0 확인 뒤 버전 교체. generic 결과보다 자신 없는 adapter가 값을 덮어쓰지 않는다.
- 쿠팡은 개별 feasibility 기준을 통과한 경우만 채택. 사용자 수동 CDN 사례1개를 자동 추출 성공률 근거로 삼지 않는다.
# 7. 데이터·캐시·보존
- 핵심 관계: search_run→queries/jobs/candidates/evidence/results, product→variants/images/offers→price_observations. 구체 types/constraints/RLS/SQL은 API·데이터 계약에 있다.
- imageSource는 `merchant_page/merchant_cdn/merchant_metadata/search_thumbnail/fallback_same_product/placeholder`, extractionStage는 별도 enum. 최종 구매 추천은 검증된 같은 상품 이미지가 있어야 한다.
- 상품·옵션·offer를 구별한다. URL tracking 제거로 옵션 parameter를 지우지 않으며 같은 이미지를 쓴 다른 상품을 자동 병합하지 않는다.
- 금액은 KRW integer, 배송비는 known0과 unknown null 구분. original referencePrice는 필수 필드가 아니다.
- run snapshot은 생성 후7일, 정규화 이미지 생성 후최대1시간/terminal5분 내삭제. cleanup은 호출·queue·cron·orphan sweep을 통해 검증한다.
- user-upload hash를 다른 사용자와 공유 cache key로 사용하지 않는다. 원본·prompt·full HTML·signed URL·secret을 로그에 저장하지 않는다.
- PROVISIONAL cache TTL: 공개 발견 URL1시간, 정적 상품 metadata15분, 가격/재고5분. 같은 owner/run 범위에서만 재사용하고 observe시각은 최초 확인 시각을 유지한다. 캐시 조회 시각으로 freshness를 위조하지 않는다.
- 5분 초과 가격 cache는 새 추천 계산 전에 재확인한다. 실패하면 price unknown/reference로 처리. 이미 완료한 snapshot은 재조회 시 당시 확인시각을 보여주고 현재가를 보장하지 않는다.
- snapshot 정렬 토글은 고정된 eligible 결과 집합에서만 처리하며 신규 provider 호출을 만들지 않는다. 원래 검색에서 탈락한 후보를 UI에서 되살리지 않는다.
# 8. 가격·랭킹과 텍스트 핫딜
- 이미지: 국내 새상품/판매근거/유사도 Gate→가격집단→rank. UNKNOWN coverage·score formula·순서는 검색 계약 한 곳에서 정의한다.
- TOTAL_PRICE와 ITEM_PRICE_ONLY는 코호트 내 순위만 제공. 가격 UNKNOWN은 references 전용, 전체 최저가1위 표현 없음.
- DEAL_TEXT: FASHION/LIVING/ALL. query relevance를 통과한 새상품에 일반 가격 정렬을 적용한다. 이미지 V/A/S/finalScore는 null이고 별도 `dealRelevance`·`dealRankerVersion`을 쓴다.
- text relevance 초기 규칙: query의 상품군/모델/필수수식어를 추출하여 필수 category 불일치 reject, 정확 모델 입력 시 모델 불일치 reject, 나머지 토큰 일치/동의어 근거를 점수화. relevance0.6 이상을 초기 Gate로 둔다. 계산은 category 0.50, 명시 모델 0.25, 필수 수식어 0.25의 가중 일치 합을 query에 실제 존재하는 그룹 가중치 합으로 나눈다. 값은 버전 있는 taxonomy/동의어 사전에서 exact 또는 허용 동의어=1, 부분 일치=0.5, 불일치/unknown=0이다. 그룹 안 수식어는 균등 배분한다. 알려진 필수 category/모델 불일치는 점수와 무관하게 탈락한다. 원문 query와 추출한 필수 조건을 evidence로 보존하고 사람이 평가한 text fixture로 오분석을 검사한다. 분모0이면 INVALID_INPUT. 수치는 PROVISIONAL이며 별도 text fixture로 평가한다.
- 커뮤니티 가격·merchant 가격·조건부 혜택을 분리. 할인율은 검증된 동일 variant 비교가격 근거가 있을 때만 표시.
# 9. 비용·쿼터·운영 설정
- 기존 USD20을 파일럿 누적 hard ceiling으로 유지, 자동 월초 리셋 없음. 실제 과거 지출·잔액이 확인될 때까지 새로운 유료 실행은 시작하지 않는다. 이 문서 개정에서 API 호출이나 결제를 실행한 것은 아니다.
- 실행 전 `spent + reserved + worstCaseNew <= budget`를 DB lock과 reservation으로 검사한다. 검색 전체 상한 예약 아래 operation별 sub-reservation으로 배분하며 이중 합산/이중 해제하지 않는다.
- 모델 token/tool fee·출력 상한·최대 tool calls·retry를 포함한 worst-case 산정이 안 되면 유료 호출을 금지한다. 무료 quota도 원장/계정 usage와 대조한다.
- 초기 paid API request cap/run: analyze/expand 합계2, discovery최대8, comparison최대4, 전체14. 비교20개를 최대5개씩4묶음으로 제한. retry도 같은 cap을 소비한다. 실제 model tool 호출 횟수는 API request와 별도로 집계하고 도구 내부 무제한 재검색을 제한한다.
- 검색별 비용 상한은 실제 요율·image token 상한·요청 실측을 바탕으로 배포 config에서 설정한다. 한도를 모른 채 USD20만 믿고 호출하지 않는다.
- browser OFF 기본, 최대8분/일·동시1, run당2개 page·12초씩. 정상 동적 페이지를 위해서만 쓴다. quota 조회/예약 불가→OFF.
- 관측 지표: 단계 지연/성공률, source별 추출·차단, Gate 탈락 이유, image/price/shipping completion, 유효 판매처 수, queue age, 유료 지출/미정산, TTL 위반, 디자인 회귀 실패.
- 상세 대시보드/알림·장애·복구·배포 runbook은 검증/운영 문서가 정본이다. 원본 이미지·상세 프롬프트를 관측 도구로 전송하지 않는다.
# 10. 운영 장애의 결과 의미
- 정상 수행 후 추천0: NO_RELIABLE_MATCH. 외부 장애로 판단 불가: FAILED.
- 일부 장애/예산 중단에도 검증된 추천 있음: PARTIAL. 필요한 후보가 적어도 계획대로 정상 종료했으면 COMPLETED.
- 접수90초 도달: 유효 추천 있으면 PARTIAL, 없으면 EXPIRED. 취소는 CANCELED. 운영 kill switch 중단은 유효 추천 있으면 PARTIAL, 없으면 FAILED/OPERATOR_STOP.
- 모든 종료 상태는 단방향. 늦은 결과·재시도·polling으로 다시 실행하지 않는다.
- merchant 차단은 해당 source 중단. secret 오류는 provider 비활성화·운영 알림, 사용자에게 내부 값 노출 없음.
# 11. 구현 순서와 완료 산출물
1. contracts/fixtures/design 원본·토큰 확정. schema/버전 변경을 CI에서 비교.
2. DB migration/RLS/익명 세션/업로드/cleanup/idempotency를 먼저 연결. 두 사용자 교차 조회 거절 시험.
3. provider wrapper/BudgetGuard/영속 job/lease fencing을 구현하고 stub으로 crash·cancel·timeout 시험.
4. 실제 사진1장→실제 상품근거1개→Gate→snapshot의 vertical slice. 비용·실측·실패를 저장.
5. 추출/랭킹·다중 source·텍스트 모드 확장. fixture와 held-out 품질 평가.
6. 기존 디자인에 실제 계약 연결. desktop 원본 오버레이, mobile/상태/모션/reduced-motion 검수.
7. 배포 전 account quota·secret·cost·backup/restore·rollback 점검, 제한된 파일럿 운영.
- 산출물: typed DTO/OpenAPI, migration/RLS, run/worker transactions, extractor fixtures, rank config/version, gold labels/eval report, visual baselines, cost usage report, deploy/rollback/incident runbooks.
- 출시 blocker는 ‘발표에서 언급’으로 면제하지 않는다. 기준 미달은 미완료로 남긴다.
# 12. 하위 정본 문서
<page url="https://app.notion.com/p/3ec7cdef782d819a89e7f77355ebdf34">SSANDEVISTHAN — 검색·랭킹 계약 v3</page>
<page url="https://app.notion.com/p/3ec7cdef782d818ab989cab459c8facb">SSANDEVISTHAN — 데이터·Edge API 계약 v3</page>
<page url="https://app.notion.com/p/3ec7cdef782d8146917ec72af0ef8d89">SSANDEVISTHAN — 운영·검증·릴리스 계약 v3</page>
<page url="https://app.notion.com/p/3ec7cdef782d810bafe6e70053b009a7">SSANDEVISTHAN — 쿠팡 이미지 추출 검증 계약 v2</page>
</content>
</page>
