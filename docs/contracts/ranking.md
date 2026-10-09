Here is the result of "fetch" for the Page with URL https://app.notion.com/p/3ec7cdef782d819a89e7f77355ebdf34 as of 2026-10-09T05:52:19.360Z:
<page url="https://app.notion.com/p/3ec7cdef782d819a89e7f77355ebdf34" icon="🔎">
<ancestor-path>
<parent-page url="https://app.notion.com/p/3ec7cdef782d81f4948ed3a2597f9b6b" title="SSANDEVISTHAN — 백엔드 구현 아키텍처 v3"/>
<ancestor-2-page url="https://app.notion.com/p/3ea7cdef782d8127ae12ebad49065f19" title="싼데비슷한 / SSANDEVISTHAN — AI 유사 저가 상품 검색"/>
<ancestor-3-data-source url="collection://4a1725c4-940c-470a-b663-d0e89ff7ef4f" name="💡 아이디어 일지"/>
<ancestor-4-database url="https://app.notion.com/p/df70dbe7750447ecab7e58a27e891f58" title="💡 아이디어 일지"/>
</ancestor-path>
<properties>
{"title":"SSANDEVISTHAN — 검색·랭킹 계약 v3"}
</properties>
<iconMetadata>{"type":"emoji","emoji":"🔎"}</iconMetadata>
<content>
> **상태: v3 구현 계약 / 2026-10-09**
> 영문 프로젝트명은 **SSANDEVISTHAN**이다. 5시간 해커톤 일정과 해커톤용 품질 축소는 폐기한다. 국내 새 의류의 실제 판매 근거를 확보하여, 충분히 비슷한 후보 안에서 저렴한 대안을 제안하는 실사용 서비스가 기준이다.
> **POLICY**는 반드시 지킬 제품·데이터 원칙이다. **BOOTSTRAP / PROVISIONAL**은 구현을 시작할 수 있도록 고정한 초기 수치이며, 평가·버전 변경 없이 임의로 바꾸지 않는다. 이 문서의 수치가 운영 품질을 검증했다는 뜻은 아니다.
## 1. 문서 책임과 우선순위
- 제품 범위·명칭: <mention-page url="https://app.notion.com/p/3ea7cdef782d8127ae12ebad49065f19">싼데비슷한 / SSANDEVISTHAN — AI 유사 저가 상품 검색</mention-page>.
- 모듈·저장·작업 실행·보안: <mention-page url="https://app.notion.com/p/3ec7cdef782d81f4948ed3a2597f9b6b">SSANDEVISTHAN — 백엔드 구현 아키텍처 v3</mention-page>.
- 실제 목업 PNG·보존 기준·새로 정의한 폰트/모션/반응형: <mention-page url="https://app.notion.com/p/3f47cdef782d8145b2a8ee2543d43d7c"/>.
- 이 문서는 후보 자격, 근거, 유사도, 가격, 순위, 결과 부족 시 동작의 정본이다. API 문서는 이 계약을 전달하고 검증 문서는 이 계약을 시험한다.
- **시각 디자인의 최상위 정본은 실제 확인한 기존 목업이다.** 글꼴·색상·레이아웃·모션·디자인을 검색 구현 편의 때문에 바꾸지 않는다. 이 문서의 `cohort`, `warnings`, `evidence`는 데이터 요구사항이며 새로운 카드·배지·화면 디자인을 마음대로 추가하라는 뜻이 아니다. 필요 정보는 목업의 기존 정보 영역에서 표현하고, 표현 불가능한 경우 디자인 변경 전에 요구사항 충돌로 기록한다.
- 이전 v2의 “FINAL”, 해커톤 hard cap, 예시 API·모델 이름, 이미지 추출의 성공 보장 문구는 현재 구현 확정 근거로 사용하지 않는다.
## 2. 검색의 성공과 비목표
**주 출력: ****`SIMILAR_PRODUCT`** — 업로드한 옷의 핵심 형태와 디자인이 유사하고, 국내 판매·배송이 확인되는 새상품의 구매 가능한 제안이다.
- 원본 브랜드·모델·가격을 알아야 검색할 수 있는 구조를 금지한다. 원본 식별 실패는 검색 실패 사유가 아니다.
- 입력은 옷 사진 한 장이다. 가격·예산·쇼핑몰 선택을 필수 입력으로 추가하지 않는다.
- “더 싸다”는 원본 가격을 알아냈다는 뜻이 아니다. 현재 수집된 유사 후보의 일반 구매 가격을 비교한다. 검증된 원본 가격이 없으면 “원본 대비 70% 저렴” 같은 표현을 생성하지 않는다.
- 인터넷 전체 최저가, 동일상품 확정, 정품 판정, 소재·품질·내구성 보장은 제공하지 않는다.
- 제품 단위 중복 제거는 지금 구현한다. 동일 모델의 모든 판매처 최저가를 보장하는 별도 `SAME_PRODUCT_OFFER` 서비스는 추후 범위다.
- 핫딜·텍스트 검색은 `DEAL_TEXT`라는 별도 모드다. 이미지 검색의 점수와 평가를 공유하지 않는다.
## 3. 입력·예산·진행 계약
`schemaVersion=3`을 사용한다. 허용 입력은 단일 프레임 JPEG/PNG/WebP, 원본 최대 10,000,000 bytes(목업의 10 MB), 최대 24 MP이며 실제 디코딩한 형식·크기·픽셀 수를 검사한다. 애니메이션·다중 프레임은 WebP/PNG 컨테이너여도 지원하지 않는다. EXIF orientation을 적용하고 메타데이터를 제거한 뒤 종횡비를 유지하여 긴 변 최대 1,600 px로 정규화한다. 파일명·브라우저 MIME 선언만으로 허용하지 않는다.
전체 검색 마감은 시작 후 90초다. 작업 상태를 저장하고 각 실행 단계를 최대 20초 이내로 제한한다. 단계 사이에 deadline·취소·남은 호출 및 비용 예산을 재검사한다. 하나의 요청이나 프로세스가 90초 내내 살아 있다고 가정하지 않는다.
상태는 `QUEUED → RUNNING → COMPLETED | PARTIAL | NO_RELIABLE_MATCH | FAILED | CANCELED | EXPIRED`다. 진행 stage는 `VALIDATING, ANALYZING, DISCOVERING, EXTRACTING, COMPARING, RANKING`이다. 완료 결과의 의미와 재시도는 기술/API 계약을 따른다. 외부 소스 하나의 실패로 검색 전체를 즉시 실패시키지 않는다.
초기 실행 상한은 모든 retry와 보강 검색을 포함한다.
- query 4\~8개. `site:` 보강도 8개 안에서 교체·선택한다.
- raw URL 150개, 정규화·중복 제거 후보 60개.
- 상품 페이지 추출 30개, 비싼 이미지 비교 후보 20개.
- 최종 구매 결과 `results[]` 최대 10개. 10개를 채우려고 Gate를 낮추지 않는다.
- OpenAI 유료 API request는 analyze/expand 합계 2회, discovery 8회, comparison 4회, 총 14회가 초기 상한이다. comparison은 최대 5개 후보씩 4묶음이며 retry도 해당 단계·전체 상한을 소비한다. 후보 20개 상한과 API 요청 4회 상한은 별개다. tool 내부 호출 수와 비용도 별도 원장으로 제한한다.
- 후보 재비교를 포함한 작업량·OpenAI 비용은 기술 문서의 BudgetGuard가 제어한다. 상한을 늘리는 자동 확장이나 무료 quota 초과 후 유료 전환은 금지한다.
## 4. 원본 속성 분석
각 속성에 `value`, `state`, `source`, `evidence`, `confidence`를 저장한다. `state`는 `OBSERVED | UNKNOWN | NOT_APPLICABLE`이며 UNKNOWN과 “없음”을 구별한다. 예를 들어 선명한 무지 상의의 `graphic=NONE`은 OBSERVED, 가슴이 가려져 그림을 알 수 없는 경우는 UNKNOWN이다.
분석 대상은 category, silhouette/fit, shoulder, length, color family, neck/collar, closure, graphic type/placement/scale, pattern, wash/texture appearance, pocket/detail layout이다. 여러 옷이 동등하게 강조되거나 주요 옷을 판단할 수 없으면 특정 옷을 확정한 듯 진행하지 않고 입력 보완 사유를 반환한다.
```json
{
  "category": {"value":"SWEATSHIRT","state":"OBSERVED","source":"INPUT_IMAGE"},
  "fit": {"value":"OVERSIZED","state":"OBSERVED","source":"INPUT_IMAGE"},
  "color": {"value":"MELANGE_GRAY","state":"OBSERVED","source":"INPUT_IMAGE"},
  "graphic": {"value":"SMALL_LETTERING","state":"OBSERVED","source":"INPUT_IMAGE"},
  "graphicPlacement": {"value":"LEFT_CHEST","state":"OBSERVED","source":"INPUT_IMAGE"},
  "material": {"value":null,"state":"UNKNOWN","source":null},
  "materialAppearance": {"value":"SWEATSHIRT_LIKE","state":"OBSERVED","source":"INPUT_IMAGE"}
}
```
사진으로 면 함량, 실측 치수, 정확한 브랜드·모델·원가·정품 여부를 확정하지 않는다. `confidence`는 모델의 내부 확신 신호이며 사실 검증이나 일치 확률로 사용자에게 보여주지 않는다. 소재·치수는 판매 페이지에 근거가 있어야 별도 사실 필드에 기록한다.
## 5. Query 생성과 후보 발견
4\~8개 query 안에 넓은 category/color 1\~2개, silhouette/detail 2\~3개, graphic/pattern 1\~2개, 필요 시 영어 또는 특정 도메인 보강을 조합한다. 총합이 8개를 넘으면 우선순위가 낮은 중복 query를 제거한다. 원본 식별을 못 했다고 임의의 브랜드를 넣지 않는다.
예: `회색 오버핏 맨투맨`, `멜란지 그레이 드롭숄더 맨투맨`, `작은 가슴 레터링 그레이 스웨트셔츠`, `빈티지 워싱 그레이 맨투맨`, `melange gray oversized sweatshirt`.
모든 발견 항목에 `discoveryQueryId`, query text, provider, provider response ID, rank, returned URL, title/snippet, `discoveredAt`을 남긴다. 실제 도구·응답에 포함된 URL만 후보로 등록한다. LLM이 스스로 만든 URL이나 기억에 의존한 상품명·가격은 발견 근거가 아니다.
소스 다양성은 확보하되 모든 쇼핑몰의 지원·커버리지를 보장하지 않는다. 국내 공개 쇼핑 페이지, 브랜드 공식몰, 독립몰을 대상으로 하고 승인된 무료 소스 또는 유료 허용 범위인 OpenAI만 사용한다. 특정 사이트의 접근 차단·검색 미노출은 해당 소스의 실패로 기록한다.
후보 선택은 다음 순서로 고정한다.
1. 각 query의 발견 순위 순으로 URL을 받아 정규화한다. 검색 snippet은 저비용 후보 선별에만 쓴다.
2. 자격이 명백히 아닌 URL과 중복을 제거한다. query 간 round-robin으로 최대 60개를 보존한다.
3. 알려진 category 적합성 → 알려진 핵심 속성 수 → 발견 순위로 page extraction 후보를 정한다. UNKNOWN은 불일치와 구별한다.
4. 페이지 추출 30개를 구성할 때 먼저 merchant당 최대 6개를 취한 뒤 남는 자리를 같은 순서로 채운다. 한 merchant에 후보가 많다는 이유로 전부 제거하지 않는다.
5. 실제 상품 이미지·자격 근거가 있는 후보에서 같은 순서와 merchant 다양성 규칙으로 최대 20개를 비교한다. 가격의 싼 순서로 비교 대상을 먼저 뽑지 않는다.
6. 동점의 마지막 키는 정규화 URL의 오름차순이다. 동시 응답 완료 순서로 순위가 바뀌지 않게 한다.
## 6. URL·상품·옵션·판매 제안의 식별
URL 중복, 상품 중복, 동일 판매 제안 중복은 서로 다르다.
- `canonicalUrl`: fragment와 확인된 tracking parameter를 제거한 URL. 상품 ID·색상·사이즈·variant를 선택하는 parameter는 보존한다. 미확인 parameter를 일괄 삭제하지 않는다.
- `productId`: 동일 상품의 내부 식별자. merchant product ID, 검증한 brand/model code, 동일성 근거를 사용한다. 비슷한 사진만으로 서로 다른 제품을 합치지 않는다.
- `variantKey`: 내부 옵션 식별값이다. 판매처 옵션 ID 또는 근거 있는 색상·사이즈 조합을 사용하며 확인하지 못하면 null/UNKNOWN 상태로 보존하고 다른 옵션 가격을 옮겨 붙이지 않는다. 공개 API의 `variantId`는 해당 `product_variants` row의 UUID다. 내부 variantKey와 공개 variantId는 별도 필드이며 API에 판매처 옵션 문자열을 variantId처럼 반환하지 않는다.
- `offerId`: merchant/seller + merchant product ID + variantKey + 구매 조건을 나타낸다. 재수집은 새 상품이 아니라 같은 offer의 새로운 observation이다.
- `resultGroupKey`: 동일 상품·대상 디자인 변형을 묶는 키다. 같은 URL이 여러 query에서 발견되면 하나의 후보에 발견 근거를 병합한다.
기본 결과는 그룹당 카드 1개다. 그룹 내 대표 offer는 자격을 통과하고 디자인에 맞는 variant가 확인된 제안 중 `TOTAL_PRICE`을 우선하고, 동등한 조건 안에서 가격·최신 관측·offer ID 순서로 결정한다. 그룹의 다른 판매 제안은 내부 근거로 남긴다. 제품 동일성이 불확실하면 억지로 병합하지 않으며 `possibleDuplicate` 진단값을 남긴다.
대표 이미지가 검정인데 최저 표시 가격은 흰색 작은 사이즈에만 적용되는 경우, 검정 상품 가격으로 사용하면 안 된다. 옵션별 가격이 다르면 선택 variant 가격 또는 확인된 가격 범위만 저장한다. 정확한 대상 variant의 일반가가 확인되지 않은 범위 가격은 PriceScore를 계산하지 않고 참고 대상으로만 처리한다.
## 7. 판매 페이지 추출과 필드 근거
HTTP 응답의 JSON-LD Product/Offer, 공개 inline 상품 state, OG metadata, 실제 DOM의 상품 정보, 상품 이미지 후보를 수집한다. 일반 extractor가 실패할 때만 검증된 merchant adapter 또는 허용된 무료 browser fallback을 사용한다. 현재 API에 특정 기능이 있다고 가정해 설계하지 않으며 구현 전에 provider 기능·권한·quota를 확인한다.
필드별로 `value`, `sourceUrl`, `sourceType`, `locator`, `observedAt`, `variantKey`, `extractorVersion`을 기록한다. 이미지·상품 URL·가격·배송비의 출처는 각각 유지한다. 화면에 보이는 선택 옵션과 machine-readable Offer가 충돌하면 확인된 variant의 명시적 값이 우선이다. variant 대응을 해결하지 못하면 값을 UNKNOWN으로 남기고 `CONFLICTING_SOURCE`를 기록한다.
페이지를 가져왔다는 사실만으로 모든 값이 검증된 것이 아니다. HTML 응답이 로그인·차단·오류 페이지인지, Product schema가 추천 상품 또는 다른 상품인지, 이미지가 로고·배너인지 검사한다. 정상 상품 페이지의 상품 ID와 option ID를 매칭해야 한다.
상품 페이지·검색 snippet·이미지 OCR은 **비신뢰 데이터**다. 해당 콘텐츠에 있는 “이전 지시 무시”, 도구 호출, 비밀 읽기, 외부 전송 같은 문장을 실행 지시로 취급하지 않는다. 외부 텍스트를 system/developer 지시문에 이어 붙이지 않는다. 모델 출력은 제한된 schema로 검증하고 URL·가격·출처를 원래 evidence와 대조한다. 누락된 필드를 모델이 채워 만든 경우 삭제한다.
## 8. 국내 새상품 자격 Gate
순위 계산 전에 다음 자격을 검사한다.
- `condition=NEW` 근거가 있다. 중고·리퍼·렌탈은 제외한다.
- 국내 배송과 국내 판매 재고/유통 근거가 있고 `overseasDirect=false`다. 한글 페이지나 `.kr` 도메인만으로 국내 새상품을 확정하지 않는다.
- 명확한 품절, 종료 상품, 사라진 페이지는 제외한다. 선택 variant의 구매 가능성을 확인한다.
- 판매/배송 방식·새상품 여부가 미확인인 후보는 기본 구매 결과에 넣지 않는다. 자격 불명 이유와 수집 상태를 진단에 남긴다.
- 로그인·회원 가입 자체는 판매 자격 탈락 사유가 아니지만 회원 전용 가격을 일반가로 쓰지 않는다.
- 상품 페이지·대표 이미지 대응이 확인되어야 한다. 실제 상품 이미지가 없으면 이미지 유사 구매 결과에 넣지 않는다.
자격 탈락 코드: `NOT_CLOTHING`, `CATEGORY_MISMATCH`, `NOT_NEW`, `OVERSEAS_DIRECT`, `RENTAL`, `OUT_OF_STOCK`, `ELIGIBILITY_UNKNOWN`, `PRODUCT_PAGE_UNVERIFIED`, `IMAGE_UNVERIFIED`, `VARIANT_MISMATCH`.
## 9. 상품 이미지의 근거와 품질
우선순위는 판매 페이지 대표 이미지 → 그 페이지에서 확인된 merchant CDN 원본 → merchant metadata 이미지다. 이미지 URL·출처 페이지·추출 방식·이미지 해시·관측 시각을 보존한다.
`imageSource`의 대소문자를 포함한 공통 enum은 `merchant_page | merchant_cdn | merchant_metadata | search_thumbnail | fallback_same_product | placeholder`다. `extractionStage`는 별도 필드다. 이미지의 출처 분류만으로 추천 자격을 얻지 않으며, 같은 상품·variant의 검증된 merchant 이미지라는 근거가 구매 결과에 필요하다. search_thumbnail/fallback_same_product/placeholder 값을 merchant_page로 바꿔 출처를 숨기지 않는다.
검색엔진 thumbnail은 발견·저비용 후보 선별에 사용할 수 있지만 판매 페이지 상품과 대응을 검증하지 못하면 최종 유사도 비교·구매 결과의 검증된 이미지로 승격하지 않는다. 타 판매처 이미지도 동일 모델·variant라는 근거 없이는 대체하지 않는다. placeholder로 실제 상품 비교를 수행하지 않는다.
이미지 다운로드는 공개 HTTPS 목적지·허용 content type·응답 크기·디코딩 픽셀 제한을 적용한다. redirect 후에도 사설/loopback/link-local 네트워크 접근을 막고 URL을 재검사한다. CDN 호스트가 달라도 해당 상품 페이지가 실제 참조했는지 검증한다. CAPTCHA·Access Denied를 우회하지 않는다.
배경·모델 얼굴·워터마크·촬영 구도를 제품 유사도로 오인하지 않도록 대상 의류 영역을 비교한다. 이미지가 너무 작거나 가려져 핵심 특징을 비교할 수 없으면 `INSUFFICIENT_VISUAL_EVIDENCE`다. 모델이 숫자를 출력했다는 사실로 비교 가능한 이미지가 되지는 않는다.
## 10. VisualSimilarity: 정규화 점수이며 확률이 아님
초기 ranker는 원본과 후보의 실제 상품 이미지를 같은 rubric으로 비교한다. 판매처 이미지가 우선이며 OpenAI web_search의 이미지 검색 기능은 선택적 발견·보강 수단이다. 검색 이미지 결과가 판매 페이지 근거를 대신하지 않는다. 4개 축별 정수 ordinal `0,1,2,3,4`와 짧은 관찰 근거를 출력한다.
- silhouette/비율/핏: 0.35.
- 색상 계열·배색: 0.20.
- 그래픽·패턴·분포: 0.25.
- 목·여밈·주머니 등 디테일 배치: 0.20.
공통 anchor: 0=핵심 구조가 명백히 다름, 1=부분 요소만 약하게 겹침, 2=여러 요소가 겹치지만 큰 차이가 있음, 3=핵심 구조가 비슷하고 일부 차이가 있음, 4=관찰 가능한 해당 축이 매우 비슷함. 각 축의 세부 예시는 평가 fixture에 고정한다. 목표 이미지에서 적용되지 않는 축만 분모에서 제외한다. “무지”는 그래픽 축이 적용되지 않는 것이 아니라 `NONE`이라는 관측값이다.
```plain text
visualCoverage = 관찰 가능한 후보 축의 가중치 합 / 목표에 적용되는 축 가중치 합
V = Σ(축 가중치 × ordinal/4) / 목표에 적용되는 축 가중치 합
```
후보에서 관찰 불가능한 축은 ordinal 점수 0으로 계산하고 UNKNOWN으로 보존한다. 알려진 축만 분모로 재정규화하여 정보가 적은 후보를 높이지 않는다. `V`는 \[0,1\]의 순위용 정규화 값이며 `94% 동일`, `구매 성공 확률`처럼 표시하지 않는다.
추후 embedding을 도입하면 cosine 원값은 `rawCosine`에 별도 저장한다. `V=cosine` 또는 `(cosine+1)/2`를 기존 rubric 점수와 혼용하지 않는다. 라벨 데이터에서 보정한 버전 있는 mapping을 도입하고 gate를 재검증한 뒤 ranker 전체를 전환한다. 서로 다른 ranker의 점수를 한 검색 결과에서 섞지 않는다.
## 11. AttributeSimilarity와 unknown coverage
초기 속성 그룹 가중치는 다음과 같다. 그룹 안에 여러 필드가 있으면 target에서 관측된 필드에 동일 가중치를 배분한다.
- category 0.15.
- silhouette/fit/shoulder/length 0.20.
- color family/배색 0.15.
- neck/collar 0.10.
- closure 0.10.
- graphic type/placement/scale 0.10.
- pattern 0.08.
- pockets/detail layout 0.07.
- wash/texture appearance 0.05.
목표에서 UNKNOWN 또는 NOT_APPLICABLE인 필드는 비교 분모에서 제외한다. 후보만 UNKNOWN이면 분모를 유지하고 일치점수 0을 준다. target가 관측한 `NONE`은 제거하지 않는다. 세부 속성 점수는 versioned compatibility matrix의 `1=같음`, `0.5=허용 가능한 가까운 값`, `0=다름/미확인`만 사용한다. LLM이 자유롭게 0.83 같은 attribute score를 만들지 않는다.
예: 색상 BLACK↔CHARCOAL, fit REGULAR↔RELAXED처럼 0.5를 허용하는 조합을 fixture로 명시한다. CATEGORY의 다른 하위 상품군을 자동으로 0.5 처리하지 않는다. 맨투맨↔반집업·셔츠↔재킷 등 허용 여부는 category taxonomy와 matrix에서 결정하고 버전으로 관리한다.
```plain text
W = target에서 비교 가능한 필드 가중치의 합
A = Σ(w_i × match_i) / W
attributeCoverage = Σ(w_i × candidateKnown_i) / W
candidateKnown_i = 후보에서 관측된 경우 1, UNKNOWN이면 0
S = 0.625 × V + 0.375 × A
```
`W=0`이거나 category를 결정할 수 없으면 정상 유사도 점수를 만들지 않는다. category가 명백히 다르면 수치가 높아도 hard reject한다. 목표 대비 중요한 차이가 있는 필드는 `differentAttributes`, 정보가 부족한 필드는 `unknownAttributes`, 실제 관측으로 맞는 필드는 `matchedAttributes`에 분리한다. UNKNOWN은 “다르다”라는 사용자 설명으로 바꾸지 않는다.
## 12. Similarity Gate: 초기 값과 고정 원칙
다음은 **BOOTSTRAP / PROVISIONAL** 초기값이다. 모든 조건을 충족해야 구매 결과 후보가 된다.
```plain text
sourceEligibility == PASS
categoryCompatible == true
visualCoverage >= 0.75
attributeCoverage >= 0.60
V >= 0.65
A >= 0.60
S >= 0.65
```
0.65는 보편적인 유사성 경계가 아니라 초기 calibration 대상이다. 사용자 입력이나 후보 수에 따라 실행 중 임계값을 낮추지 않는다. threshold 변경은 versioned 설정·평가 결과·승인된 배포 변경으로만 한다.
**POLICY: 가격은 Gate를 절대 우회하지 못한다.** category mismatch나 아주 다른 큰 프린트·여밈 구조를 낮은 가격으로 보상하지 않는다. 비교 실패 후보를 임의의 평균 유사도로 살리지 않는다.
유사도 탈락 코드: `LOW_VISUAL_SIMILARITY`, `LOW_ATTRIBUTE_SIMILARITY`, `LOW_TOTAL_SIMILARITY`, `LOW_VISUAL_COVERAGE`, `LOW_ATTRIBUTE_COVERAGE`, `INSUFFICIENT_VISUAL_EVIDENCE`, `COMPARISON_FAILED`.
## 13. 가격 정규화와 자격
가격은 KRW 정수다. 0원·음수·비숫자·환율 환산이 필요한 값·렌탈 월납부금·보증금·회원 조건 할인·범위 가격을 일반 단일 판매가로 사용하지 않는다. 상품 선택 옵션의 세금 포함 일반가와 필수 배송비를 각각 확인한다.
`itemPrice`는 누구나 조건 없이 구매 가능한 관측 일반가다. `shippingFee=0`은 무료배송 근거가 있을 때만 허용한다. 주문 금액 조건, 특정 지역 추가금, 묶음 주문 등은 `shippingConditions`에 보존한다. 기본 가격 비교는 판매자가 공개한 일반 국내 기본 배송 조건을 전제로 하며, 실제 주소에 따른 추가 배송비 가능성은 설명한다. 배송 조건이 불명확하면 shipping은 UNKNOWN이다.
```plain text
itemPrice 확인 + 필수 배송비 확인:
  priceBasis = TOTAL_PRICE
  effectivePrice = itemPrice + shippingFee

itemPrice 확인 + 배송비 미확인:
  priceBasis = ITEM_PRICE_ONLY
  shippingFee = null
  effectivePrice = null

itemPrice 미확인 또는 정확한 variant 가격 미확인:
  priceBasis = UNKNOWN
  priceScore = null
  finalScore = null
  results[]에는 넣지 않고 references[]로 분리
```
카드·멤버십·첫구매·개인쿠폰·포인트·캐시백은 `conditionalPrices[]`에 조건과 근거를 함께 저장한다. 기본 PriceScore에 쓰지 않는다. 검색 snippet의 가격은 `discoveryClaimedPrice`이며 판매 페이지 가격과 같은 검증 수준으로 취급하지 않는다.
최근 가격이라는 표현은 가격 근거 관측 시각과 함께 한다. 내부 가격 evidence의 관측 시각을 공개 결과 DTO의 `priceObservedAt`으로 투영하며 cache 조회 시각으로 덮어쓰지 않는다. 현재 재추출 없이 과거 cache만 반환할 때에는 기술/API 계약의 freshness 정책에 따라 `STALE_PRICE`를 표시하고 자동 구매 가격처럼 보장하지 않는다. 관측 snapshot을 “실시간 최저가”라고 부르지 않는다.
## 14. PriceScore: cohort 안에서만 비교
가격 근거가 다른 두 cohort를 유지한다.
- `TOTAL_PRICE`: 배송비 포함 effectivePrice로 비교.
- `ITEM_PRICE_ONLY`: 배송비가 확인되지 않았다는 경고와 함께 itemPrice로 비교.
각 cohort에서 **자격·유사도 Gate·상품 중복 제거를 통과한 전체 후보**를 모아 가격 점수를 계산한 뒤 top 10을 자른다. 먼저 상위 10개를 정하고 그 10개의 가격으로 다시 점수를 계산하지 않는다. 한 product의 여러 offer로 cohort 분포를 부풀리지 않는다.
```plain text
n = 해당 cohort의 후보 수
rankAsc(p) = 가격 오름차순 순위의 동률 평균(midrank), 1부터 시작
P = 1 - (rankAsc(p) - 1) / (n - 1), n >= 2
n == 1 또는 전부 같은 가격이면 P = 0.5
```
가격 크기의 극단값이 점수 간격을 왜곡하지 않도록 percentile 순위를 사용한다. 가격 차이가 작아도 순위 차이는 생기므로 점수는 가격 이득 크기를 뜻하지 않는다. 비정상 저가가 의심되면 옵션·수량·판매 방식·상품 ID를 재검사하고 근거를 해결하지 못하면 제외한다. 값이 낮다는 이유만으로 상품을 거짓이라고 단정하지 않는다.
ITEM_PRICE_ONLY의 낮은 표시 가격을 TOTAL_PRICE의 배송비 포함 가격과 숫자로 직접 겨루게 하지 않는다. `effectivePrice=null`을 `itemPrice` 또는 0으로 대입하지 않는다.
## 15. 최종 정렬과 동점 처리
Gate를 통과하고 itemPrice가 확인된 후보에만 다음을 계산한다.
```plain text
FinalScore = 0.50 × V + 0.30 × A + 0.20 × P
```
가중치는 **BOOTSTRAP / PROVISIONAL**이며 ranker version에 고정한다. FinalScore는 cohort 내부 순위용이다. `cohortRank`는 해당 priceBasis 그룹에서의 순서이며 전역 `rank`를 반환하지 않는다. 서로 다른 cohort 사이의 숫자를 비교하지 않는다.
검색 종료 시 resultLimit으로 자르기 전의 전체 적격 후보 집합과 V/A/S/P/FinalScore·coverage·가격 집단·근거·정책 버전을 불변 snapshot으로 저장한다. 최종 API 정렬은 이 동일한 집합에서 수행한다. `GET /searches/{searchId}/results?sort=RECOMMENDED|MOST_SIMILAR|LOWEST_PRICE`의 sort를 생략하면 RECOMMENDED다. sort 변경은 저장된 점수를 재계산하거나 threshold를 바꾸거나 새 외부 호출을 만들지 않는다. 저장된 적격 집합을 선택한 규칙으로 정렬한 뒤 resultLimit(최대 10)을 적용한다. 서로 다른 sort에서도 Gate를 통과하지 않은 후보나 가격 미확인 reference가 추천으로 승격되지 않는다.
`cohortRank`는 선택한 sort에서 해당 priceBasis 내부의 1-based 순위다. MOST_SIMILAR는 가격 집단이 결과 배열에서 섞일 수 있지만 이 값과 priceBasis를 함께 표시하고 전체 가격 순위로 읽히게 하지 않는다. `references[]`는 같은 불변 reference snapshot에서 S 순으로 최대 5개 제공하며 sort에 따라 새 후보를 수집하지 않는다.
- `RECOMMENDED`: TOTAL_PRICE를 먼저, ITEM_PRICE_ONLY를 뒤에 둔다. 각 cohort 안에서 FinalScore 내림차순 → S 내림차순 → 해당 가격 오름차순 → priceObservedAt 최신순 → offerId 오름차순이다.
- `MOST_SIMILAR`: 두 cohort를 합쳐 S 내림차순 → V 내림차순 → TOTAL_PRICE 우선 → 같은 cohort 안의 가격 오름차순 → offerId 순이다. 배송비 근거 구분은 유지한다.
- `LOWEST_PRICE`: TOTAL_PRICE의 effectivePrice 오름차순을 먼저, ITEM_PRICE_ONLY의 itemPrice 오름차순을 뒤에 둔다. 각 cohort 동점은 S 내림차순 → offerId다. 전체 배송비 포함 최저가인 것처럼 설명하지 않는다.
- `references[]`: Gate는 통과했으나 가격이 미확인인 후보만 최대 5개, S 내림차순으로 보존한다. 순위·가격 점수·할인율은 null이다. 구매 결과 수에 합산하지 않는다.
최종 10개 제한 때문에 ITEM_PRICE_ONLY가 화면에 없을 수 있다. `countsByPriceBasis`에 전체 유효 후보 수를 기록한다. 단순히 더 싼 상품만 채우기 위한 비공개 점수 가산, merchant 광고 가중치, 중복 offer 가중치를 넣지 않는다.
## 16. 계산 예시와 반례
같은 TOTAL_PRICE cohort에 배송 포함 20,000원, 30,000원, 40,000원 상품 A/B/C가 있다. 각 P는 1, 0.5, 0이다.
```plain text
A: V=.75, A=.72 → S=.73875, P=1.0 → Final=.791
B: V=.90, A=.88 → S=.89250, P=.5  → Final=.814
C: V=.85, A=.80 → S=.83125, P=0   → Final=.665
추천순: B → A → C
```
더 비슷한 B가 A보다 비싸도 추천순 1위가 될 수 있다. 5,000원이지만 V=.50인 D는 Gate에서 제외되어 P와 Final을 계산하지 않는다. itemPrice=10,000원·배송비 UNKNOWN인 E는 별도의 ITEM_PRICE_ONLY cohort에 속하므로 A의 20,000원과 직접 비교해 전체 최저가라고 선언할 수 없다. E만 그 cohort에 있으면 P=.5다. 배송비를 알 수 없는 상품이 일괄 무료배송으로 취급되는 테스트는 반드시 실패해야 한다.
속성 coverage 예: target에서 적용되는 전체 가중치가 1이고 candidate 관측 가중치가 .70, 일치점수 가중 합이 .62이면 coverage=.70, A=.62다. `.62/.70=.886`으로 계산해 누락을 보상하지 않는다. 목표 사진에서 원래 보이지 않은 속성은 target 분모에서 제외하므로 후보에게 그 사실을 추측하도록 요구하지 않는다.
## 17. 결과 payload와 설명
API의 정본 schema를 따르되 ranker는 다음 항목을 제공해야 한다.
```json
{
  "schemaVersion": 3,
  "productId": "internal-product-id",
  "offerId": "internal-offer-id",
  "variantId": "internal-variant-uuid",
  "resultGroupKey": "verified-design-variant",
  "productUrl": "verified-public-merchant-url",
  "imageUrl": "verified-product-image-url",
  "imageSource": "merchant_page",
  "itemPrice": 20000,
  "shippingFee": 0,
  "effectivePrice": 20000,
  "priceBasis": "TOTAL_PRICE",
  "cohortRank": 2,
  "visualSimilarity": 0.75,
  "visualCoverage": 1.0,
  "attributeSimilarity": 0.72,
  "attributeCoverage": 0.9,
  "totalSimilarity": 0.73875,
  "priceScore": 1.0,
  "finalScore": 0.791,
  "matchedAttributes": ["오버핏", "멜란지 회색"],
  "differentAttributes": ["가슴 레터링 위치가 중앙임"],
  "unknownAttributes": ["워싱 세부 질감"],
  "warnings": [],
  "priceObservedAt": "ISO-8601 timestamp",
  "rankerVersion": "ranker-v3-bootstrap-1",
  "gateVersion": "gate-v3-bootstrap-1",
  "evidenceIds": ["field-level-evidence-id"]
}
```
위 URL·ID·시각은 schema 설명용 placeholder이며 실제 상품 근거가 아니다. 프로덕션 출력은 DB의 검증된 evidence를 참조한다. 설명은 저장된 속성 비교 결과에서 생성하고 확인하지 않은 장점을 추가하지 않는다. 유사도 숫자를 퍼센트 확률로 바꾸지 않는다.
## 18. 부족·실패·시간 초과 결과
- 정상 수행 후 Gate 통과 구매 결과가 1개면 1개만 반환하고 `COMPLETED`다. 후보가 적다는 이유만으로 품질 기준을 낮추지 않는다.
- 어떤 source·단계가 deadline/예산/외부 오류로 미완료여도 검증된 구매 결과가 있으면 `PARTIAL`로 반환하고 `partialReasons[]`와 실제 수행 coverage를 기록한다.
- 정상 수행했지만 검증된 구매 결과가 없으면 `NO_RELIABLE_MATCH`다. references가 있으면 별도 제공할 수 있으나 성공 상품 수를 부풀리지 않는다.
- 핵심 분석/비교/수집 실패로 검색 품질을 판단할 수 없고 검증된 구매 결과도 없으면 `FAILED`다. 외부 장애를 “비슷한 상품 없음”으로 바꾸지 않는다.
- deadline 도달 시 이미 검증된 구매 결과가 있으면 `PARTIAL`, 하나도 없으면 `EXPIRED`다. 사용자 취소는 `CANCELED`로 구별한다.
- provider 실패·재시도는 bounded step과 전체 비용·90초 상한 안에서만 한다. 취소·종료한 작업의 늦은 응답이 결과 상태를 다시 RUNNING으로 바꾸지 못하게 한다.
- placeholder 이미지, 조작된 가격, 낮은 유사도 후보로 빈 화면을 억지로 채우지 않는다.
## 19. DEAL_TEXT 별도 계약
텍스트 핫딜은 상품 키워드·category·조건으로 발견하고 판매 페이지 근거를 확인한다. 목업의 의류/생활용품 범위를 유지하여 `category=FASHION | LIVING | ALL` 필터를 허용한다. 이미지 유사 검색의 의류 범위를 텍스트 모드의 생활용품으로 넓히거나 두 모드의 점수를 섞지 않는다. 커뮤니티 게시글의 `claimedPrice`와 실제 판매처 `verifiedMerchantPrice`를 구별한다. 외부 글이 “역대 최저”라고 주장해도 사실로 재발행하지 않는다.
원본 사진이 없는 DEAL_TEXT에서 visualSimilarity, attributeSimilarity, totalSimilarity, image-mode finalScore는 null이다. 기본 정렬은 자격을 확인한 일반 구매 가격으로 하되 TOTAL_PRICE와 ITEM_PRICE_ONLY를 같은 원칙으로 분리한다. 텍스트 관련성 Gate와 deal ranking은 별도 version이다. 이미지 모드의 V/A를 가짜 상수로 채우지 않는다.
`dealRelevance`, `dealRankerVersion`, query의 필수 category/모델/수식어 판정과 초기 text relevance threshold는 기술 정본의 **§8 가격·랭킹과 텍스트 핫딜**을 따른다: <mention-page url="https://app.notion.com/p/3ec7cdef782d81f4948ed3a2597f9b6b">SSANDEVISTHAN — 백엔드 구현 아키텍처 v3</mention-page>. 이미지 Gate의 V/A/S 수치로 대체하지 않는다. 텍스트 모드의 정렬 지원값은 API 계약을 따르며 사진 유사도 없는 MOST_SIMILAR를 임의 계산하지 않는다.
할인율은 동일 상품·variant의 검증된 비교 기준 가격, 기준 시점·기간·source가 있을 때만 계산한다. MSRP·판매자 표시 취소선·과거 실제 관측 가격을 구별한다. 근거 없으면 할인율과 “핫딜 확정” 문구를 표시하지 않는다. 품절·종료·조건부 혜택이 확인되면 해당 상태를 그대로 보존한다.
## 20. 평가와 변경 통제
기존 30개 목표 사진은 파일럿 최소치로만 사용한다. 실사용 출시 전 데이터셋의 규모·분할·품질 기준은 Test & Acceptance Contract를 따른다. 상품 계열·원본 이미지의 근접 복제·같은 모델 사진이 calibration과 holdout에 동시에 들어가지 않게 분리한다.
라벨은 GOOD/ACCEPTABLE/BAD, category 적합성, 핵심 attribute, 새상품/국내/재고 자격, price/variant 일치, 이미지 근거를 포함한다. 사람이 유사성과 가격 매력을 별도로 판단하게 하여 저렴하다는 이유로 유사성 라벨이 높아지지 않게 한다. 모호한 사례와 두 평가자의 불일치는 별도로 남긴다.
측정 지표: Precision@5, GOOD-or-ACCEPTABLE Hit@5, BAD@5, category hard fail, source 자격 오류, 이미지 출처 오류, variant 가격 오류, metadata/price/shipping coverage, 중복 카드율, PARTIAL/FAILED/EXPIRED 비율, p50/p95 latency, OpenAI 비용/검색. 결과가 5개 미만인 질의도 denominator와 반환 개수를 함께 보고해 통계를 유리하게 만들지 않는다.
필수 회귀 사례: 회색이라는 이유로 후드와 맨투맨을 혼동, 작은 가슴 레터링 대 큰 전면 프린트, regular 대 cropped, 후보 속성 대부분 UNKNOWN, 배송비 UNKNOWN 대 무료배송, 조건부 할인만 있는 상품, 잘못된 옵션의 최소 가격, 동일 상품 URL 5개, 다른 상품의 같은 스톡 이미지, 품절, 해외직구, 지연·취소·차단, 외부 문서 prompt injection, 조작된 provider JSON.
각 결과에 pipeline/vision prompt/query/attribute taxonomy/compatibility matrix/extractor/ranker/gate/price/source policy 버전을 기록한다. 점수·threshold 변경은 고정 fixture와 holdout 결과를 비교하고 변경 사유를 남긴다. 기존 검색 snapshot은 당시 버전·관측 근거를 유지하며 현재 점수로 조용히 덮어쓰지 않는다.
</content>
</page>
