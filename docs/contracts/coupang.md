Here is the result of "fetch" for the Page with URL https://app.notion.com/p/3ec7cdef782d810bafe6e70053b009a7 as of 2026-10-09T05:50:44.318Z:
<page url="https://app.notion.com/p/3ec7cdef782d810bafe6e70053b009a7" icon="🧪">
<ancestor-path>
<parent-page url="https://app.notion.com/p/3ec7cdef782d81f4948ed3a2597f9b6b" title="SSANDEVISTHAN — 백엔드 구현 아키텍처 v3"/>
<ancestor-2-page url="https://app.notion.com/p/3ea7cdef782d8127ae12ebad49065f19" title="싼데비슷한 / SSANDEVISTHAN — AI 유사 저가 상품 검색"/>
<ancestor-3-data-source url="collection://4a1725c4-940c-470a-b663-d0e89ff7ef4f" name="💡 아이디어 일지"/>
<ancestor-4-database url="https://app.notion.com/p/df70dbe7750447ecab7e58a27e891f58" title="💡 아이디어 일지"/>
</ancestor-path>
<properties>
{"title":"SSANDEVISTHAN — 쿠팡 이미지 추출 검증 계약 v2"}
</properties>
<iconMetadata>{"type":"emoji","emoji":"🧪"}</iconMetadata>
<content>
<callout icon="🧪" color="yellow_bg">
	**SSANDEVISTHAN — 쿠팡 상품 이미지 추출 feasibility / v2**
	이 문서는 이미 발견한 쿠팡 상품 URL과 실제 대표 이미지·옵션의 대응을 검증하는 독립 adapter 실험 계약이다. 원본 상품 식별이나 쿠팡 지원은 전체 유사검색의 필수 전제가 아니다.
	**상태: PROVISIONAL / 자동 추출 검증 미완료.** 기존 수동 사례를 production 성공률로 확대 해석하지 않는다.
</callout>
개정일: <mention-date start="2026-10-09"/>. 제품: **싼데비슷한 / SSANDEVISTHAN**. 실사용 정본: <mention-page url="https://app.notion.com/p/3ec7cdef782d81f4948ed3a2597f9b6b">SSANDEVISTHAN — 백엔드 구현 아키텍처 v3</mention-page>. 검색·근거: <mention-page url="https://app.notion.com/p/3ec7cdef782d819a89e7f77355ebdf34"/>.
# 1. 기존 기록과 실제 확인 범위
- 기존 2026-10-01 기록: 사용자가 브라우저 ‘이미지 주소 복사’로 얻은 `thumbnail.coupangcdn.com` URL이 외부 브라우저에서 열리는 사례를 수동 확인했다고 기록되어 있다.
- 이 사실은 단일 CDN 이미지 접근 사례다. HTML에서 자동 추출 가능, 대표 이미지 판별 정확성, URL 영구성, 모든 상품·옵션 지원을 입증하지 않는다.
- 이번 문서 정리에서는 쿠팡 실상품 자동 추출 시험·20건 fixture 측정을 실행하지 않았다. 표의 성공률을 측정 완료로 채우지 않는다.
# 2. 입력·출력
입력: 실제 검색 도구가 반환한 공개 쿠팡 상품 URL. SafeFetcher로 host·DNS·redirect·private IP·port·userinfo를 검증하고 productId/option parameter를 보존한다.
출력은 canonical product URL, source product/variant key, 선택 대표 image URL, imageSource, extractionStage, field evidence, 관측시각이다. API DTO에는 내부 키를 정해진 productId/variantId/offerId로 매핑한다.
```json
{
  "ok": true,
  "productUrl": "https://www.coupang.com/vp/products/EXAMPLE",
  "sourceProductKey": "EXAMPLE",
  "sourceVariantKey": "EXAMPLE-OPTION",
  "imageUrl": "https://thumbnail.coupangcdn.com/EXAMPLE.jpg",
  "imageSource": "merchant_cdn",
  "extractionStage": "METADATA",
  "verifiedSameProduct": true,
  "verifiedSameVariant": true,
  "evidenceIds": ["example-evidence-id"],
  "observedAt": "2026-10-09T03:00:00Z"
}
```
위 URL·ID는 schema 설명용이며 실제 상품/검증 사례가 아니다. 실패는 `ok:false`, `reason`, `attemptedStages`, `httpStatus`, `durationMs`를 반환하며 imageUrl을 만들어내지 않는다.
실패 코드: BLOCKED, RATE_LIMITED, PAGE_NOT_PRODUCT, VARIANT_AMBIGUOUS, NO_RELIABLE_PRODUCT_IMAGE, AMBIGUOUS_IMAGE, IMAGE_DOWNLOAD_FAILED, QUOTA_EXHAUSTED, TIMEOUT.
# 3. 추출 단계와 중단 규칙
## A. 일반 HTTP/HTML
- 정상 HTTPS 요청으로 JSON-LD Product.image, OG image, twitter:image, img/srcset/picture/source와 공개 상품 state를 수집한다.
- HTML 안에 product ID·선택 option·title과 image의 대응 근거가 있는지 검사한다. 여러 Product schema가 있으면 현재 URL 상품을 찾는다.
- HTML2MB, request8초, redirect3회, response stream 제한 등 공통 SafeFetcher 상한을 따른다.
- **403/429/CAPTCHA/Access Denied는 차단/제한으로 끝낸다. 브라우저나 프록시로 단계를 높여 우회하지 않는다.** 429는 Retry-After와 정책에 따라 해당 source를 일정 기간 쉬게 한다.
## B. 정상 페이지의 metadata/public state
- `script[type="application/ld+json"]`와 JSON으로 파싱 가능한 공개 state만 읽는다. 임의 script 실행 금지.
- 확인되지 않은 DOM selector나 특정 JSON path를 추측해 production parser로 고정하지 않는다. fixture에서 구조를 검증하고 adapterVersion으로 관리한다.
- `coupangcdn.com` 문자열만 찾았다고 대표 이미지로 확정하지 않는다. URL path의 657x657/q90/trim 의미를 가격/동일성 판단 근거로 추측하지 않는다.
## C. 정상 동적 페이지의 DOM
- A/B가 정상 상품 HTML을 반환했으나 JS 렌더링 이후에만 gallery가 생기는 경우에만 시도한다. 차단 응답 이후 fallback은 허용하지 않는다.
- 로컬 Playwright는 개발/fixture 검증용. 운영은 검증된 무료 Browser Run feature flag 안에서만 사용. Supabase Edge에서 Chromium 직접 실행 금지.
- gallery 안 visible img의 currentSrc/srcset, alt, naturalWidth/Height, 위치, product/variant context를 수집한다.
- 선택 option을 임의 변경해 더 싼 가격을 끌어오지 않는다. 원래 source option과 사진/가격 연결을 유지한다.
## D. 해당 정상 페이지의 network 이미지
- 렌더링 중 실제 요청된 image response를 관찰한다. host boundary 검사로 `coupangcdn.com`과 그 subdomain만 후보화한다.
- network URL이 page의 gallery/currentSrc와 대응되는 경우에만 강한 근거로 승격한다. 요청되었다는 사실만으로 상품 대표 이미지가 되지는 않는다.
# 4. 이미지 선택 규칙
강한 근거는 현재 상품과 맞는 JSON-LD Product.image, 해당 상품 gallery의 대표 currentSrc, gallery와 동일한 network URL, product context를 확인한 OG image다.
보조 근거는 충분한 image 크기, 제목과 대응하는 alt, 첫 gallery item, 동일 gallery 그룹, 상단 product 영역 위치다.
- 강한 근거1개 이상과 product/variant 대응이 모두 있어야 선택한다.
- 리뷰/추천 상품/광고/배너/로고/추적pixel은 hard reject.
- 큰 이미지라는 이유만으로 대표로 선택하지 않는다.
- 여러 동률 후보가 서로 다른 상품·색상이면 AMBIGUOUS_IMAGE, 근거 없는 임의 선택 금지.
- 같은 상품의 색상이 다르면 verifiedSameVariant=false. 해당 이미지로 다른 옵션 일반가를 추천하지 않는다.
# 5. CDN GET·출처·캐시 검증
- 선택 image URL도 별도로 SafeFetcher 검사, GET200, image Content-Type, nonempty body, 안전 decode를 확인한다. HEAD만으로 성공을 판단하지 않는다.
- 이미지10MB/24MP 상한과 공통 deadline을 지킨다. 재다운로드·재시도도 예산/attempt에 포함한다.
- source URL, source product/variant key, locator, original image URL, image hash, observedAt, extractionStage, extractorVersion을 저장한다.
- signed/query URL에 인증 정보가 들어가면 로그·API에 그대로 출력하지 않는다. 안정적인 공개 경로가 확인되지 않으면 임시 fetch/cache 정책으로 제한하고 영구 URL을 약속하지 않는다.
- 같은 판매 페이지의 실제 image는 merchant_cdn, 검색 thumbnail은 search_thumbnail으로 기록한다. 다른 출처를 쿠팡 직접 이미지라고 표시하지 않는다.
- 실패 시 쿠팡 URL 발견 기록은 남기되 상품 이미지가 검증되지 않은 후보는 기본 구매 추천에서 제외한다. 다른 source 검색은 계속한다. placeholder는 디버깅/빈 상태용이며 similarity 근거가 아니다.
# 6. 무료 브라우저 실행 예산
- [Cloudflare Browser Run 공식 요금 문서](https://developers.cloudflare.com/browser-run/pricing/)에서 2026-10-09 확인한 Free 한도는 10분/일·동시3개다. 실제 account 권한과 배포 시 조건은 재확인한다.
- 앱은 8분/일·동시1·검색당최대2페이지·페이지12초로 더 낮게 제한한다. 일일 기준과 reset은 provider usage 기준으로 저장한다.
- browser 시작 전 예약, 종료 후 실제 사용 정산. usage를 조회/예약할 수 없거나 상한 도달 시 OFF. 무료 초과 유료전환 없음.
- 실제 서비스가 대부분 browser에 의존하여 Free budget에서 충분한 처리가 안 되면 이 adapter 채택을 미룬다. 실패를 숨기려고 유료 서비스/우회 수단을 추가하지 않는다.
# 7. fixture·실험 프로토콜
1. 기존 수동 사례의 실제 상품 URL·선택 옵션·정답 대표 이미지가 확보되면 1건 재현. 없으면 과거 사례를 측정 표본으로 세지 않는다.
2. 의류2건, 옵션/색상1건, 여러 gallery 이미지1건, 동적 페이지1건의 5건 smoke.
3. 총20개 독립 상품 URL을 서로 다른 유형으로 구성해 수동 정답과 비교. 옵션 변경·품절·차단·이미지404·광고 함정을 포함한다.
4. 가능하면 같은 fixture를 다른 날짜에 재실행해 URL/DOM 변화를 확인. 모든 재시도·사용량·차단율을 함께 보고한다.
- 정답: 현재 페이지의 실제 상품/선택색상·대표 이미지·가격과 관측시각을 평가자가 확인한다.
- 결과: stage별 success/fail/reason, latency, static vs browser 비중, correct image, correct variant, CDN GET 성공, quota 소비.
- 실행 로그는 수치/ID/hash/안전 URL만 저장. cookie/session/full HTML/사용자 원본 사진은 기록하지 않는다.
# 8. 채택 기준 — 목표이며 아직 미측정
- 20개 fixture에서 대표 이미지 정확 추출 ≥90%, 직접 CDN GET 성공 ≥90%를 초기 목표로 둔다.
- 다른 상품/리뷰/광고 이미지 오탐0, 잘못된 variant 연결0, 우회 로직0, stage/근거 기록 누락0은 hard gate.
- A/B 성공률과 C/D 필요 비율을 분리한다. 합산 성공률만 보고 브라우저 비용을 숨기지 않는다.
- 20건은 feasibility 신호이며 장기 안정성 보장이 아니다. 운영 adapter 채택은 추가 반복 fixture·실제 무료quota·장애/버전변경·가격연결 회귀까지 확인한다.
- 조건 미달이면 adapter는 OFF/PROVISIONAL로 유지. 전체 서비스는 다른 확인 가능한 상품 source로 운영할 수 있다.
# 9. 결과 기록 양식
```plain text
run_id / test_date / adapter_version / fixture_set_version
fixture_product_url / expected_variant / expected_image_hash
stage_attempted / http_status / block_reason / chosen_evidence
selected_image_hash / correct_product / correct_variant / get_ok
duration_ms / browser_ms_reserved / browser_ms_actual
result PASS|FAIL / reviewer / note
```
현재 실측: **미실행**. 다음 판단은 이 양식의 증거와 <mention-page url="https://app.notion.com/p/3ec7cdef782d8146917ec72af0ef8d89"/>의 릴리스 절차를 따른다. 전용 adapter의 합격을 전체 검색 품질·목업 준수 합격으로 대체하지 않는다.
</content>
</page>
