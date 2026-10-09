Here is the result of "fetch" for the Page with URL https://app.notion.com/p/3ec7cdef782d8146917ec72af0ef8d89 as of 2026-10-09T05:51:20.555Z:
<page url="https://app.notion.com/p/3ec7cdef782d8146917ec72af0ef8d89" icon="🧪">
<ancestor-path>
<parent-page url="https://app.notion.com/p/3ec7cdef782d81f4948ed3a2597f9b6b" title="SSANDEVISTHAN — 백엔드 구현 아키텍처 v3"/>
<ancestor-2-page url="https://app.notion.com/p/3ea7cdef782d8127ae12ebad49065f19" title="싼데비슷한 / SSANDEVISTHAN — AI 유사 저가 상품 검색"/>
<ancestor-3-data-source url="collection://4a1725c4-940c-470a-b663-d0e89ff7ef4f" name="💡 아이디어 일지"/>
<ancestor-4-database url="https://app.notion.com/p/df70dbe7750447ecab7e58a27e891f58" title="💡 아이디어 일지"/>
</ancestor-path>
<properties>
{"title":"SSANDEVISTHAN — 운영·검증·릴리스 계약 v3"}
</properties>
<iconMetadata>{"type":"emoji","emoji":"🧪"}</iconMetadata>
<content>
> **문서 상태: SSANDEVISTHAN 실사용 제품의 검증·운영 계약 v3 / 2026-10-09 개정.** 이 문서는 구현 및 출시의 요구사항이다. 아래 수치는 별도 실측 보고서가 생기기 전까지 **제안 목표(PROVISIONAL), 현재 미측정**이며 통과·구현 완료를 의미하지 않는다. 5시간 해커톤, 발표용 예외, 데모 성공을 출시 근거로 삼는 과거 기준은 폐기한다.
# 1. 목적·정본·릴리스 원칙
프로젝트의 한글명은 **싼데비슷한**, 영문명은 **SSANDEVISTHAN**이다. 실제 사용자가 옷 사진 한 장으로 국내에서 구매 가능한 새상품 중 충분히 비슷하고 가격을 비교할 수 있는 대안을 찾도록 한다. 원본 상품 식별은 선택적인 보조 정보이며 검색 성공의 선행조건이 아니다.
디자인의 최우선 정본은 <mention-page url="https://app.notion.com/p/3f47cdef782d8145b2a8ee2543d43d7c"/>이 기록한 **실제 기존 목업 원본 및 확인된 자료**다. 해당 정본의 글꼴·색상·레이아웃·모션·디자인을 구현 편의, 라이브러리 기본값, 접근성 작업, 성능 작업 등의 이유로 임의로 바꾸지 않는다. 접근성·성능 문제는 우선 외관을 보존하는 구현으로 해결하고, 외관 변경이 불가피하면 시안을 별도로 검토받기 전까지 해당 변경을 출시하지 않는다. 이 계약은 디자인을 재정의하지 않고 그 기준의 보존 여부를 검증한다.
기술·상태·보존 기간·API의 정본:
<mention-page url="https://app.notion.com/p/3ec7cdef782d81f4948ed3a2597f9b6b">SSANDEVISTHAN — 백엔드 구현 아키텍처 v3</mention-page>
<mention-page url="https://app.notion.com/p/3ec7cdef782d818ab989cab459c8facb"/>
유사도, Gate, 가격 정규화, 점수 계산의 정본:
<mention-page url="https://app.notion.com/p/3ec7cdef782d819a89e7f77355ebdf34"/>
이 문서의 역할은 독립적인 합격 판정, 검증 증거, 운영 대응이다. 점수 공식을 이 문서에 복제하지 않는다. 발견된 충돌은 구현 전에 정본 문서와 이 문서를 함께 수정하고 변경 이유·검증 영향·버전을 남긴다.
# 2. 검증 수준과 증거 관리
검증은 다음 세 층을 분리한다.
- **결정적인 회귀검증:** 승인된 입력·상품 HTML/JSON-LD·이미지·모델 응답 fixture를 사용한다. 외부 API 호출 없이 파서, 상태 전이, Gate, 랭킹, 가격, 보안, UI를 재현한다. 녹화 시점과 출처를 가진 fixture이며 임의로 만든 성공 데이터는 실제 검색 품질의 증거로 계산하지 않는다.
- **고정 평가셋 검증:** 사람이 라벨링한 tune/holdout을 동일한 파이프라인 버전으로 평가한다. 과거 provider 응답을 재생한 결과는 `REPLAY`로, 새 외부 호출 결과는 `LIVE`로 표시한다. REPLAY는 현재 판매 여부와 현재 검색 범위를 입증하지 않는다.
- **실제 외부 연결 검증:** 사전 예약된 예산 내에서 새 이미지·현재 상품 페이지·현재 제공자 연결로 검색한다. 접근 차단·가격 변경·무료 한도·worker 실행 환경을 확인한다. 적은 live smoke만으로 전체 품질을 일반화하지 않는다.
각 실행 보고서에는 `evaluation_id / 실행 시각 / git SHA / 환경 / 데이터셋 버전 / split / LIVE|REPLAY / 표본 수 / category별 분포 / pipeline·prompt·extractor·ranker·price·source policy 버전 / provider·model 식별자 / 예산 예약·실비 / 제외 사유 / 실패 목록 / 작성자·검토자`를 기록한다. 실패한 run이나 빈 결과를 보고서에서 삭제하지 않는다. 동일 요청의 재시도는 별도 시도로 기록하고 최초 결과를 덮어쓰지 않는다.
실측 칸의 `TBD`는 0이 아니다. 재현 경로가 없는 스크린샷, 주관적 “괜찮음”, 성공 사례만 모은 영상은 합격 근거가 아니다.
# 3. 평가 데이터셋과 누수 방지
초기 평가셋의 제안 규모는 **최소 100개 target 이미지**, tune 50개 / 봉인 holdout 50개다. holdout은 유사 대안이 확인된 positive 40개 이상과 충분한 대안이 없어야 하는 negative 10개 이상을 포함한다. 수량을 채우려고 중복 이미지나 동일 상품의 다른 crop을 독립 표본으로 계산하지 않는다. 수집 가능한 증거 또는 예산이 부족하면 표본을 축소한 사실을 표시하고 제한된 내부 검증으로 남긴다. 공개 출시 기준을 자동으로 낮추지 않는다.
다음 분포를 둘 다 포함한다: 무지/기본형, 프린트·레터링 중심, 실루엣 중심, 워싱·질감 중심, 작은 부자재·디테일 중심, 다양한 모델·배경·촬영각, 일부 가림·복수 의류·낮은 해상도, 대안이 많은 경우/적은 경우, 비의류·판단 불가, 해외·중고·렌탈·조건부 가격·품절 함정. 카테고리별 최소 표본 수와 교차 분포를 데이터셋 manifest에 명시한다.
동일 상품, 같은 판매 페이지 이미지, 같은 촬영 세션, 같은 이미지의 crop·색상 변형·중복 URL을 하나의 `target_group_id`로 묶는다. **그룹 전체를 한 split에만 배정**한다. tune에서 프롬프트·가중치·threshold·source policy를 조정한 뒤 holdout을 봉인 해제한다. holdout 결과를 보고 조정하면 그 holdout은 다음 릴리스의 tune으로 편입하고 새 holdout을 확보한다. 사후에 어려운 표본을 제외하거나 GOOD/BAD 정의를 바꾸지 않는다.
각 target의 필수 라벨:
- 지원 여부, 주 의류 카테고리, 필수 시각 속성, 선택 속성, 확인 불가능한 속성.
- 실제 출처를 가진 candidate 목록, canonical product/offer 식별자, 판매처, 관측 시각, 상품·이미지·가격 근거.
- GOOD / ACCEPTABLE / BAD와 사유, 국내 새상품/제외 대상 판정, 확인 가능한 대안의 수.
- `positive` 또는 `negative`의 근거. 검색 실패로 우연히 결과가 없었다는 이유만으로 negative로 분류하지 않는다.
holdout target/candidate는 최소 2명이 가격과 시스템 점수를 보지 않고 독립 라벨링한다. 불일치는 근거를 기록하며 조정하고, 조정 전 일치율과 조정 건수를 함께 보고한다. 사람이 한 명뿐이면 단독 평가라고 명시하고 독립 검수 조건을 미충족으로 남긴다. 가격을 본 뒤 유사도 라벨을 바꾸지 않는다.
# 4. 품질 지표의 분모와 제안 목표
이하 추천 품질의 결과·상위 슬롯은 API의 구매 추천 `results`만 뜻한다. `references`는 구매 추천이나 Hit/Precision의 성공 건수에 포함하지 않고 참고 정보로 별도 집계한다. 모든 지표는 전체 및 카테고리별로 표본 수·분모·95% 구간을 함께 제시한다. 표본이 작으면 넓은 불확실성을 그대로 표시한다. 버전 간 비교에는 동일 split·동일 fixture·동일 판정 기준을 사용한다.
- **Good/Acceptable Hit@5:** positive target 중 상위 5개에 GOOD 또는 ACCEPTABLE이 1개 이상인 target 비율. FAILED, EXPIRED, 빈 결과는 실패로 분모에 포함. 제안 목표 **≥ 85%**.
- **Fixed Precision@5:** positive target마다 상위 5개 슬롯 중 GOOD/ACCEPTABLE 개수를 5로 나눈 값의 평균. 비어 있는 슬롯은 0점. 결과 1개만 내놓아 높은 precision을 만드는 일을 방지한다. 대안이 5개 미만인 target은 별도 scarcity slice로 함께 보고하며, 전체 P@5를 숨기지 않는다.
- **Filled Precision@5:** 실제 채워진 상위 5개 결과 중 GOOD/ACCEPTABLE 비율. 보조 지표로만 사용하고 Fixed Precision@5·평균 결과 수·0개 비율과 같이 공개한다. 빈 결과만 내는 시스템은 성공 처리하지 않는다.
- **Bad@5 Rate:** 모든 실제 반환 상위 5개 슬롯 중 BAD 비율. 제안 목표 **≤ 10%**. 전체 반환 슬롯 0개이면 계산 불가이며 통과가 아니다.
- **Negative rejection:** negative target에서 강제로 결과를 만들어 낸 건수 **0건**. source가 작동하지 않아 생긴 빈 결과는 정상적인 negative rejection 성공으로 계산하지 않는다.
- **Gate false positive / false negative:** 평가된 BAD 중 Gate 통과 비율, 평가된 GOOD 중 Gate 탈락 비율. Gate 튜닝은 tune에서만 수행하고 holdout의 분자·분모와 사유를 보고한다.
- **nDCG@5:** 라벨 gain(GOOD=2, ACCEPTABLE=1, BAD=0)으로 계산한다. candidate pool의 평가 범위와 ideal ranking 구성을 고정하고 미판정 후보를 좋은 후보로 추정하지 않는다. 누락 라벨이 있으면 해당 run의 확정 평가를 보류한다.
- **다양성:** 결과의 서로 다른 상품군 수·판매처 수·도메인 수·최다 도메인 점유율. 여러 URL을 같은 상품의 여러 대안으로 세지 않는다. source 3개 이상을 실제로 발견하는 케이스를 smoke에 포함하되 모든 검색에서 3개를 강제하여 저유사 상품을 채우지 않는다.
- **가격 정보 품질:** 유효한 일반 상품가 비율, 배송비 확인 비율, 가격 관측 시각 표시율을 분리한다. 알 수 없는 값을 0으로 채워 완성도를 높이지 않는다. 최종 결과의 가격·출처·관측 시각·비교 기준 표시는 누락 0건.
Fixed Precision@5, nDCG@5, source coverage는 첫 baseline 측정 후 목표를 제안·승인하며, 초기에는 수치를 날조하지 않는다. 랭킹 변경은 Hit@5와 BAD·안전 기준을 만족하고 baseline 대비 퇴행이 없어야 한다. 평균 가격·후보 중앙값 대비 절감은 보조 지표다. 원본 실제 가격이 없으면 원본 대비 할인율을 만들지 않는다.
# 5. 즉시 출시 차단하는 Hard Fail
아래 항목은 통계 목표와 무관하게 **0건**이어야 한다. 하나라도 발생하면 원인 수정과 관련 회귀검증 전까지 출시를 차단한다.
- 다른 의류 카테고리, 낮은 유사도 후보가 싼 가격 때문에 Gate를 우회.
- 사진만으로 소재 조성·브랜드·모델명·가격을 확정하거나 존재하지 않는 상품·판매처·근거 URL 생성.
- 리뷰·광고·추천·다른 상품 이미지를 상품 대표 이미지로 제시하거나 fallback 이미지를 판매처 직접 이미지로 위장.
- 중고·해외직구·구매대행·렌탈을 국내 새상품으로 잘못 표시.
- 조건부 가격을 일반가로 사용, 불명 배송비를 0원 처리, 옵션 최저가를 선택 상품 가격으로 오인, 0원/범위/외화/오류 문자열을 정상 KRW 판매가로 처리.
- 절대적인 인터넷 최저가·확정 할인율·유사도 확률을 검증 없이 주장.
- 타인 검색·이미지·결과 열람 또는 수정, 공개 업로드 저장소, secret·raw image·signed URL·인증 토큰 로그 노출.
- private network 접근, 접근 제한 우회, 수집 페이지의 지시문이 시스템 동작·출처 정책·도구 권한을 변경.
- 예산 예약 없이 유료 호출, 총 예산 상한 우회, 종료·취소 후 새 유료 작업 시작, 무료 서비스의 자동 유료 전환.
- 이전 worker가 새 lease의 결과를 덮어쓰거나 같은 작업의 결과·과금 원장을 중복 확정.
- 기존 목업에서 확인된 글꼴·색상·구성·간격·모서리·시각 계층·모션을 승인 없이 변경.
# 6. 단계별 회귀 fixture
## 6.1 입력·분석·Query
업로드 10,000,000 bytes 경계, 24 MP 경계, JPEG/PNG/WebP 정상 입력과 MIME 위장, corrupt file, EXIF 회전, 과도한 픽셀 수, animation, 비지원 포맷을 시험한다. 파일명·확장자·브라우저 MIME만 믿지 않는다. decode 가능한지 확인하고 최대 변 1600 px로 정규화하며 metadata를 제거하는 정책을 검증한다. 기존 PNG의 10MB 표기와 실제 서버 제한 10,000,000 bytes가 일치해야 한다. Supabase Edge에서 bounded WASM decoder를 사용한다면 정상·최대 허용·악성 입력의 CPU와 peak memory를 실측한다. sharp/libvips 지원을 가정하지 않고, 정규화가 실행 환경 안에서 안전하게 완료되지 않으면 출시를 차단한다. 거부 입력에서 외부 모델 호출·유료 비용이 발생하지 않아야 한다.
분석은 category/color/fit/shoulder/length/neck/graphic/pattern/wash/detail의 근거와 unknown을 검증한다. 화면에 보이지 않는 소재 조성·브랜드를 채우지 않는다. 여러 옷·낮은 해상도·비의류는 기술/API 계약의 명시된 오류 또는 재입력 처리로 연결한다.
Query는 4\~8개 범위, 중복 제거, 핵심 실루엣·디테일 보존, 한국어 중심의 필요한 영문·site-targeted 보완을 검사한다. 모두 같은 일반 단어로 축약된 query는 실패다. 사용자 이미지에 들어 있는 텍스트나 검색 페이지의 명령을 제어 지시로 실행하지 않는다.
## 6.2 수집·정규화·추출
raw URL ≤150, dedup ≤60, page extraction ≤30, expensive vision compare ≤20, purchase results ≤10, references ≤5를 각각 경계값에서 시험한다. retry·redirect·fallback이 한도를 우회하지 않는지 확인한다. 중복 query, 추적 파라미터, fragment, canonical, 상품 옵션 식별자를 fixture에 포함한다. 서로 다른 옵션을 무조건 합치거나 단순 URL 차이를 새로운 상품으로 세지 않는다.
상품 HTML은 Product/Offer JSON-LD, 복수 Product, stale OG, 옵션가, 품절, 회원가, 배송 조건, 대표 이미지 변경, 추천 상품 혼입, 잘못된 JSON, HTTP 429/403/5xx, 느린 응답, redirect loop, 대용량 body, 잘못된 content-type을 포함한다. 각 필드는 field별 evidence와 observedAt으로 추적 가능해야 한다. page title이나 검색 snippet만으로 구매 가능한 가격을 확정하지 않는다.
## 6.3 이미지·Gate·랭킹
실제 대표 이미지, 검색 thumbnail, placeholder의 출처를 구분하고 잘못 연결된 이미지를 BAD로 배제한다. 이미지 다운로드도 상품 HTML과 동일한 SSRF/크기/시간 정책을 적용한다. source별 성공률은 추출을 시도한 상품 수를 분모로 사용한다.
색·배경·모델 pose만 같은 BAD, 실루엣은 같지만 로고/프린트가 큰 BAD, 실제 속성이 unknown인 후보, 카테고리 불일치, 세부 디테일 위치 차이를 포함한다. unknown을 일치로 계산하지 않으며 coverage 감소를 확인한다. Gate 전후 후보와 탈락 사유를 보존한다.
정본 점수 계산은 동일 입력에서 안정적 순서를 반환해야 한다. 동점 처리, price missing, shipping unknown, 동일상품 여러 offer, 한 판매처 집중, 극단적으로 싼 BAD, 환율 미지원, stale price를 시험한다. API의 `priceBasis=TOTAL_PRICE|ITEM_PRICE_ONLY|UNKNOWN`와 `cohortRank`가 계산 근거와 일치하고 서로 다른 가격 기준을 하나의 동일 조건 순위로 오인시키지 않는지 검증한다. 사람에게 노출하는 유사도 표현이 내부 점수를 확률처럼 포장하지 않아야 한다.
## 6.4 텍스트 핫딜 모드
`DEAL_TEXT`의 FASHION/LIVING/ALL을 이미지 검색 평가와 분리한다. 명시된 상품군·모델·필수 수식어 불일치 후보를 reject하며 query relevance Gate를 통과한 국내 새상품만 일반 가격으로 비교한다. 정확 모델 query의 다른 모델 혼입, 동의어 근거, 빈 query·분모 0, 품절·중고·조건부 가격을 fixture로 검증한다. 초기 relevance 0.6은 Technical Spec의 PROVISIONAL 값이며 tune/holdout에서 별도 평가한다. 이미지 V/A/S/finalScore는 null이고 `dealRelevance/dealRankerVersion`을 사용한다. 커뮤니티 언급 가격을 실제 판매처 확인 가격으로 취급하지 않는다.
# 7. API·비동기 작업·동시성
Supabase Auth의 anonymous JWT를 첫날부터 사용하고 모든 사용자 소유 데이터에 RLS를 적용한 상태로 검증한다. 로그인 UI가 없다는 이유로 인증·소유권을 생략하지 않는다. 테스트는 서버 관리자 키만으로 수행하지 말고 실제 익명 사용자 A/B 토큰과 만료·잘못된 토큰을 사용한다.
다음 계약을 HTTP 응답, DB row, 원장, UI에서 함께 확인한다.
- 업로드 생성/완료/검색 생성/상태 조회/취소에서 소유자·TTL·단일 사용·입력 무결성 검증.
- 같은 사용자·같은 idempotency key·같은 입력은 하나의 search/job만 생성. 다른 입력으로 key 재사용은 명시적 충돌. 사용자 A와 B의 key가 서로 섞이지 않음.
- search/job/예산 예약 저장이 원자적으로 성공하거나 모두 실패. 응답 단절 뒤 재요청해도 작업이 증식하지 않음.
- 브라우저가 닫히거나 재접속해도 persisted Postgres queue의 상태를 조회 가능. 브라우저 polling을 worker 실행 조건으로 삼지 않음.
- 여러 worker가 동시에 claim해도 하나만 유효한 lease를 소유. lease 만료 후 재획득, checkpoint 재개, version/fencing 검증으로 늦은 worker의 write 차단.
- worker 1회 실행의 application budget과 lease TTL은 각각 최대 20초. 전체 deadline은 검색 접수로부터 90초이며 queue 대기도 포함. provider/page timeout은 step 잔여시간보다 최소 2초 짧게 설정하여 checkpoint commit 여유를 남김.
- 상태는 `QUEUED / RUNNING / COMPLETED / PARTIAL / NO_RELIABLE_MATCH / FAILED / CANCELED / EXPIRED`, 진행 단계는 `VALIDATING / ANALYZING / DISCOVERING / EXTRACTING / COMPARING / RANKING`으로 분리. 정의되지 않은 상태 문자열을 UI가 성공으로 해석하지 않음.
- terminal 상태는 임의로 RUNNING으로 돌아가지 않음. 완료·취소가 경합하면 원자적인 상태 조건으로 승자를 결정하고 하나의 terminal 결과만 확정.
- 취소 후 새 유료 호출은 0회. 이미 요청된 provider 호출은 비용이 생길 수 있으므로 취소를 비용 0 또는 환불로 표현하지 않음. 늦은 응답은 사용자 결과에 반영하지 않고 원장 정산·정리만 수행.
- retry는 정본의 횟수·backoff·남은 deadline·예산 제한 안에서만 수행. 4xx 입력 오류·권한 오류·차단을 무한 재시도하지 않음.
단위 수준에서 시계·난수·provider를 제어해 경합을 재현하고, 실제 배포 환경에서 dispatcher와 worker가 끊기지 않고 동작하는지 통합 검증한다. 플랫폼의 장시간 백그라운드 실행을 검증 없이 가정하지 않는다.
# 8. 종료 의미·장애 주입
- **COMPLETED:** 계획된 처리가 끝나고 Gate를 통과한 구매 추천 `results.length > 0`. `references`만 있는 경우는 해당하지 않음.
- **PARTIAL:** 검증된 구매 추천 `results.length > 0`이 있으나 source 장애·시간·예산 등으로 일부 처리를 완료하지 못함. `references`만으로 PARTIAL을 만들지 않음. 결과와 함께 누락 사유를 반환하며 전체 검색 완료처럼 표시하지 않음.
- **NO_RELIABLE_MATCH:** 정상적으로 수행된 탐색·비교에서 구매 추천 `results.length === 0`. `references`의 존재는 이 판정을 바꾸지 않음. 낮은 유사도 결과를 채우지 않음.
- **FAILED:** 핵심 처리 실패로 신뢰 가능한 결과를 만들지 못함. 모든 source/provider가 실패한 상황을 “비슷한 상품 없음”으로 숨기지 않음.
- **EXPIRED:** 90초 deadline 또는 작업 유효기간을 넘겼고 완료 가능한 결과가 없음. deadline에 검증된 구매 추천 `results.length > 0`이면 PARTIAL로 확정. `references`만 있는 경우는 EXPIRED.
- **CANCELED:** 사용자 취소가 확정됨. polling을 끝내고 cleanup을 예약.
최소 장애 주입: OpenAI 429·5xx·malformed output·지연, source 한 곳 실패, 모든 source 실패, 이미지 한 개 실패, DB write 실패, worker 중단, lease 중복, dispatch 지연, quota 차단, 비용 정산 응답 누락, 결과 저장 직전 취소. 각각 사용자 메시지·상태·재시도 가능 여부·원장·cleanup의 기대값을 표로 관리한다. HTTP가 200인 상태 조회가 곧 검색 성공을 뜻하지 않으며 정상 empty와 기술 오류를 구분한다.
# 9. 프론트엔드 목업 보존 검수
사용자가 제공한 PNG가 디자인의 확정 원본이다. 원본 크기는 **1586×992 px**, SHA-256은 `531162d78410f8a01a408d12955d0ab10d3c11d4add6e645a127bc5096ccc3ab`다. 메인 문서에 기록한 원본 asset ID/링크·확인 시각·화면 역할과 함께 보존하며 구현 결과로 덮어쓰지 않는다. 사용자가 PNG에 없는 구현 세부사항의 작성을 허용했으므로 존재하지 않는 Figma·CSS·폰트 파일을 추가로 요구하는 것을 차단 조건으로 삼지 않는다. 다만 원본과 새로 정의한 내용을 명확히 구별한다.
특징적인 wordmark·hero의 타이포그래피는 PNG 기반의 원래 모양을 보존한다. 기능성 본문·UI 텍스트는 메인 문서에 기록한 재구성 글꼴을 사용하며 원본 폰트를 정확히 식별했다는 주장을 하지 않는다. PNG는 motion 증거가 없으므로 다음 값은 새로 정의한 구현 사양이다: 공통 easing은 `--ease-ui: cubic-bezier(.2,.8,.2,1)`; 일반 hover 130ms, translateY(-2px); focus는 이동 없음; panel/state 변화는 180ms fade; press는 80ms; reduced-motion은 0ms. 이 사양의 결정적 테스트와 화면별 적용 범위를 메인 문서와 일치시킨다.
변경 금지 검수는 브랜드 타이포·기울기·자간, 한글/영문 글꼴·굵기·줄높이, 노랑/검정 및 보조색, 배경·테두리·절개·질감, 섹션 배치·폭·간격·정렬, 업로드 영역, 버튼·아이콘, 결과 카드와 가격 계층, 고정/스크롤 동작, 확인된 motion·loading 순서 각각에 대해 baseline과 구현을 나란히 비교한다. exact value가 원본에 없으면 사진에서 추출한 추정값과 확인값을 구분한다.
원본과 동일한 **1586×992** viewport에서 screenshot overlay와 시각 검수를 우선 시행한다. 1440×900, 1280×800, 390×844, 360×800은 별도의 반응형 검증 viewport 제안이며 원본 크기라고 주장하지 않는다. 제공되지 않은 화면/반응형/오류 상태는 원본의 시각 규칙을 보존해 설계하고 원본 존재 여부를 표시한다. 새로운 편의 기능이 원본의 배치나 밀도를 바꾸면 자동으로 승인된 변경으로 취급하지 않는다.
검수 순서:
1. 폰트 로드가 끝난 상태에서 동일 브라우저·DPR·viewport·데이터·시계·스크롤 위치·animation 시점을 고정.
2. Home·업로드 선택·진행·결과·PARTIAL·empty·오류·취소·모바일 주요 상태를 촬영. 캡처용 상품 fixture는 출처가 있는 고정 이미지 사용.
3. 픽셀 diff와 반투명 overlay로 확인하되 허용 오차를 일괄 확대해 실패를 숨기지 않음. antialiasing 차이를 제외한 위치·크기·색·글꼴 차이를 구체적으로 기록.
4. 동적 영역 mask는 사전에 목록화. 브랜드·주요 레이아웃·가격·버튼·상품 카드 전체를 mask하지 않음.
5. keyboard focus·tab 순서·screen reader label·contrast·zoom·touch target·reduced-motion을 점검. 외관을 보존한 해결책과 필요한 예외를 기록.
6. 디자인 검토자가 원본·차이·잔여 미확정 항목을 보고 승인. 기존 PNG 대조 및 새 모바일/상태 baseline 검토 전 “목업 준수 완료”라고 쓰지 않음.
로딩은 실제 stage를 반영하고 가짜 확정 진행률을 만들지 않는다. 카드의 상품명·판매처·일반 가격·배송비 기준·관측 시각·출처·비슷한 이유가 API와 일치해야 한다. 가격 없음/이미지 fallback/원본 식별 없음/PARTIAL에서도 목업의 시각 질서를 보존한다. 사용자가 가격·예산을 입력해야 진행되는 흐름을 추가하지 않는다.
# 10. 성능·부하·정합성
제안 초기 목표는 **완료 검색의 중앙 지연 ≤30초, 접수부터 terminal까지 p95 ≤90초**이며 현재 미측정이다. 성공 요청만의 지연 외에 전체 접수 요청의 queue wait·terminal 분포·실패율·timeout 비율을 함께 보고한다. timeout을 표본에서 제거하여 빠르게 보이게 하지 않는다. 브라우저 업로드 시간과 서버 처리 시간을 구분한다.
stage별 p50/p95, 외부 호출 수·retry 수·extraction 수·vision compare 수, queue depth·oldest age·lease 만료 수·부분 결과율을 기록한다. cold start/warm, cache hit/miss, 단일 사용자/동시 사용자, 큰 정상 이미지, 느린 merchant를 별도로 측정한다. 초기 worker 동시성·사용자 rate limit은 Technical Spec의 값으로 시작하고 무료 quota 및 비용을 확인한 뒤 조정한다. 부하 검증은 stub provider로 먼저 수행하며 유료 provider에 무제한 부하를 보내지 않는다.
부하 초과는 요청 제한과 명확한 재시도 안내로 처리한다. 이미 접수한 작업은 deadline을 지키고 종료한다. 무료 한도가 부족하면 신규 접수를 중단하거나 한도를 줄인다. 자동으로 유료 인프라로 변경하지 않는다.
# 11. 비용·무료 한도·원장 검수
**OpenAI API 외 유료 서비스 비용은 0원. 기존 USD 20은 전체 pilot의 누적 hard ceiling이며 기간별 자동 리셋 예산이 아니다.** 과거 사용액이 확인되지 않으면 잔액을 임의로 USD 20으로 설정하지 않는다. 과거 사용·예약·미정산액을 맞출 때까지 새 유료 호출은 fail-closed 한다. 예산 증액/리셋은 별도 명시적 결정이 있어야 한다.
유료 호출 전 BudgetGuard가 현재 요율 snapshot과 호출 상한으로 최대 비용을 예약한다. `확정 지출 + 진행 중 예약 + 신규 예약 ≤ USD 20`을 DB 트랜잭션/잠금으로 보장한다. search 전체 예약 안에서 operation별 sub-reservation을 배분하고 이중 합산·해제하지 않는다. provider operation별 idempotency key를 연결하고 동시 요청 두 개가 같은 잔액을 둘 다 사용하는 경합을 시험한다. 요율·operation 과금 방식을 알 수 없으면 호출을 시작하지 않는다.
호출 완료 후 usage·tool call count·실비를 정산하고 남는 예약만 해제한다. 실패·timeout·응답 단절은 과금 0으로 가정하지 않는다. 외부 요청을 시작한 뒤 usage가 불명확하면 미정산 예약을 보수적으로 유지하고 provider 사용내역과 대조한다. worker crash/cancel/duplicate callback 뒤에도 이중 해제·이중 과금 확정이 없어야 한다. 비용 상한은 호출 자체의 제한과 함께 강제하며 dashboard alert만으로 통제했다고 판단하지 않는다.
초기 유료 API 요청 cap/run은 analyze·expand 합계 2, discovery 최대 8, comparison 최대 4, 전체 14다. 비교 후보 20개를 최대 5개씩 4묶음으로 제한하고 retry도 같은 cap을 소비한다. 요청 수와 내부 유료 tool call 수를 별도로 기록하며 tool의 무제한 재검색을 차단한다. 이 경계값과 총 누적 예산을 동시에 시험한다.
출시 전 예산 내에서 최소 10회 실제 검색의 검색당 비용, 단계별 비용, 최대·중앙·p95, 성공/실패/부분 검색의 비용을 기록한다. 10회는 원가 smoke이며 품질 holdout을 대체하지 않는다. 남은 예산으로 필수 검증을 완료할 수 없다면 검증 미완료로 출시를 차단한다.
Supabase/Cloudflare/GitHub 및 선택적 Browser fallback의 현행 무료 조건은 출시 당일 공식 문서·계정 dashboard로 확인하고 URL·확인일·현재 사용량·잔여량·제한시 동작을 운영 체크리스트에 남긴다. 공식 문서 확인은 실제 계정의 사용 가능량 확인과 별개다.
2026-10-09 공식 문서 확인값: Supabase Edge Free는 wall time 150초, CPU time 2초, memory 256MB이므로 20초 worker wall-time 설계만으로 CPU/메모리 적합성을 입증하지 못한다. [Supabase Edge limits](https://supabase.com/docs/guides/functions/limits). Cloudflare Browser Run Free는 browser time 10분/일 및 동시 browser 3개다. [Browser Run pricing](https://developers.cloudflare.com/browser-run/pricing). 애플리케이션 fallback은 기본 OFF이며 더 낮은 **8분/일·동시 1개·run당 최대 2개 page·page당 최대 12초**를 예약·집계하여 제한하고 사용량 조회/예약이 불가능하면 끈다. 이 값들은 문서 확인 시점의 정보이며 실제 계정 상태·기타 quota와 배포 당일 조건을 다시 확인해야 한다. 무료 백업·가용성을 보장한다고 해석하지 않는다. browser fallback은 무료 사용 가능성과 강제 차단 방식이 검증된 경우에만 켠다.
# 12. 보안·프라이버시·보존
권한 matrix는 익명 사용자 A/B, 만료 토큰, 미인증, worker/service 역할별로 작성한다. A가 B의 upload/search/result/cancel 경로 및 UUID 추측을 시도해도 내용·존재 여부가 불필요하게 노출되지 않아야 한다. service role secret은 서버 전용이며 frontend bundle·source map·로그·오류 응답에서 탐지되지 않아야 한다. RLS bypass 권한이 있는 코드와 사용자 접근 경로를 분리한다.
SSRF 검증은 http(s) 이외 scheme, loopback/private/link-local/multicast/reserved IPv4·IPv6, DNS rebinding, redirect 후 목적지 변경, userinfo·인코딩된 host·혼합 IP 표기·임의 port·대용량/지연 응답을 포함한다. URL 승인뿐 아니라 실제 연결 대상과 매 redirect를 재검증하고 본문·이미지 byte cap을 적용한다. 임의 browser navigation·파일 다운로드·page script가 내부 서비스로 접근하지 못하도록 설정한다.
추출한 HTML·JSON-LD·상품 설명·이미지 내 텍스트는 불신 데이터다. “이전 지시 무시”, API key 전송, 다른 URL fetch, JSON 구조 탈출 등 prompt injection fixture에서 도구 권한과 시스템 정책이 바뀌지 않아야 한다. provider 출력도 schema 검증 후 사용한다. 화면 렌더링은 문자열 escaping, 안전한 링크 처리, 허용 scheme 검증을 적용하고 merchant HTML을 그대로 실행하지 않는다.
업로드 원본 바이트는 검증·정규화 동안 **메모리에서만 처리하고 영속 저장하지 않는다**. 서버 디스크·임시파일·Storage·DB·로그·백업 어디에도 원본이 기록되지 않는지 검증한다. 정규화 이미지에만 private 임시 Storage를 허용하며 생성 후 **최대 1시간**, terminal 후 **5분 이내 정리 목표**를 적용한다. 둘 중 더 이른 삭제 시점을 따르며 검색 결과 snapshot은 생성 후 **7일**이다. 재시도로 보존 시작 시각을 무한 연장하지 않는다. 재실행 가능한 cleanup job이 누락·중복·DB 부분 장애에서도 지우도록 하고 삭제된 object의 재접근 실패, 7일 후 snapshot 접근 실패, orphan object/row 정리를 검증한다. 5분 초과와 1시간 초과는 각각 경고·중요 사고로 감시한다.
로그에는 raw image/base64, 전체 prompt, bearer token, signed URL, secret, 전체 상품 HTML을 기록하지 않는다. 운영 이벤트는 search ID·operation ID·stage·reason code·시간·수량·비용 등 최소 필드로 제한한다. 진단용 fixture는 사용자 실사진을 자동 전환하여 보관하지 않으며 권리가 확인된 공개/제공 자료로 별도 구성한다. 외부 AI·검색 제공자로 전송되는 데이터와 로컬 삭제 범위는 사용자 안내에 사실대로 표시한다. 로컬 object 삭제를 외부 제공자 보존까지 삭제 완료된 것으로 표현하지 않는다.
# 13. 배포·마이그레이션·롤백
배포 전 변경 범위를 UI/계약/DB/worker/prompt/ranker별로 나누고 사용자 영향·재처리 필요 여부를 기록한다. 개발·검증·운영 환경의 endpoint·secret·저장소 경로를 구분한다. 무료 tier에서 별도 환경을 확보할 수 없는 경우 이를 제한으로 기록하고 운영 사용자 데이터를 테스트 fixture로 사용하지 않는다.
DB migration은 빈 DB와 이전 schema 양쪽에 적용 시험한다. `expand → 호환 코드 배포 → 데이터 보정 → 검증 → 사용 종료 후 contract` 순서로 진행한다. 이전 worker가 실행 중인 상태에서도 새 schema가 호환되는지 확인한다. enum/state/API 변경을 같은 순간에 강제해 진행 중 검색을 깨뜨리지 않는다. 파괴적 migration은 복구 검증 전 금지한다.
배포 순서: schema 확장·RLS 확인 → worker/API 배포 → 계약 smoke → frontend 배포 → 소량 실제 검색 → 주요 지표/비용/cleanup 확인 → 접수량 확대. 전 과정에서 server kill switch, source별 차단, browser fallback off, 신규 검색 중단을 독립적으로 조작할 수 있어야 한다.
rollback은 이전 frontend/API/worker artifact와 versioned configuration을 보존한 상태에서 수행한다. source/ranker 장애는 해당 config를 이전 검증 버전으로 되돌리되 과거 결과 snapshot의 버전·점수는 덮어쓰지 않는다. DB는 무조건 down migration하지 않고 호환 복구 또는 forward fix를 우선 검토한다. 진행 중 job은 drain 또는 명시적 terminal 처리 후 재접수 정책을 적용한다. 배포마다 rollback 실행 경로를 검증 환경에서 확인한다.
# 14. 관측성과 운영 대응
운영 dashboard의 최소 항목: 분당 접수·완료·실패·부분·empty·취소·만료, queue depth/oldest age, stage 지연, provider/source별 timeout/429/403/5xx, 이미지·가격 확보율, Gate 통과율, 결과 수, 예산 확정/예약/미정산/잔액, cleanup 지연·orphan 수, 인증/RLS 거부와 비정상 요청량. 원본 이미지나 사용자 prompt를 보지 않고 원인을 좁힐 수 있어야 한다.
알림의 초기 정책: secret·RLS·SSRF·정책 위반·hard budget 초과 시 즉시 신규 작업 중단, 전체 provider 실패나 queue가 deadline에 근접하면 신규 접수 제한, source 하나의 실패율 급증은 source 비활성화와 PARTIAL 추적. 수치 기반 경보 threshold는 첫 baseline에서 확정하고 현재 미측정이라고 표시한다. 한 명이 운영해도 담당자·확인 방법·복구 승인자·사고 기록 위치를 정해야 한다.
## 운영 Runbook
**예산/무료 quota 임박·초과:** 신규 유료 호출 및 필요시 신규 검색 접수 중지 → 진행 중 예약·provider 사용액 대조 → 유효 결과는 PARTIAL 또는 정본 상태로 종료 → 무료 한도 소비 작업을 중지 → 부족분을 숨기거나 자동 결제하지 않음 → 잔액·한도 복구가 확인된 뒤 제한적으로 재개.
**queue 정체/worker 중단:** dispatcher 상태·queue age·lease 확인 → 이미 종료된 job 재실행 금지 → 만료 lease만 원자적으로 재획득 → deadline 지난 작업 종료 → duplicate paid call 여부와 원장 대조 → 한 건 canary 완료·cleanup 확인 후 재개. queue row 수동 삭제로 미완료 작업을 숨기지 않음.
**provider 장애:** timeout/429/5xx 분류 → bounded retry 또는 circuit breaker 적용 → 신뢰 가능한 결과가 있으면 PARTIAL, 없고 탐색 실패면 FAILED → 사용자 재시도 안내 → 정상 응답과 비용 정산 확인 후 재개. 접근 차단·bot challenge를 우회하지 않음.
**source 파서/이미지 오염:** 해당 adapter/source feature flag 중지 → 영향을 받은 extractor_version·시간대·search ID 조회 → 잘못된 결과의 노출을 중단하고 필요시 결과 만료 → 실패 페이지를 개인정보를 제거한 회귀 fixture로 재현 → 잘못된 상품 이미지/가격 Hard Fail 0 확인 후 재개.
**개인정보·secret 노출:** 신규 접근/작업 제한 → 노출 범위 최소화와 secret 회전·권한 차단 → 토큰·signed URL·로그 접근 및 보존 범위 조사 → 필요한 사용자 안내와 처리 기록 → 원인 수정/RLS·로그 회귀검증 → 재개. 원본 민감정보를 사고 보고서에 복사하지 않음.
**cleanup 실패:** 미삭제 object/row를 기준 시각으로 재조회 → idempotent 재삭제 → 잔존 object의 직접 접근 실패 확인 → scheduler·권한·시계·부분 장애 원인 수정 → 1시간 초과 여부를 사고로 기록. DB row만 지우고 object 삭제 완료라고 하지 않음.
# 15. 백업·복구·데이터 소실 대응
무료 인프라의 자동 백업·보존·복구 기능을 가정하지 않는다. 실제 계정에서 사용 가능한 방법을 확인하고, schema/migrations/config는 Git에, 필요한 최소 운영 데이터 export는 접근 통제된 별도 저장 위치에 보관하는 절차를 정한다. export에는 secret, raw upload image, 만료된 snapshot을 포함하지 않는다. 백업의 보존도 개인정보 TTL을 우회하지 않게 삭제 정책을 적용한다.
복구 검증은 새 격리 DB에 schema → 필요한 데이터 → RLS/권한 → 기능 smoke 순서로 수행한다. 복원된 terminal job이 새 유료 호출을 시작하지 않는지, provider 원장과 예약이 중복 소비되지 않는지, 과거 snapshot과 image가 TTL 이후 되살아나지 않는지 확인한다. 백업 시각·복구 완료 시각·손실 가능한 기간·검증 결과를 남긴다. 복구 테스트 전에는 특정 RPO/RTO나 무손실을 약속하지 않는다.
일시적 무료 서비스 중지/프로젝트 비활성화/DB 소실이 생기면 명확한 장애 상태를 제공하고 신규 검색을 중단한다. 복구 가능한 검색 snapshot과 일시적 업로드를 구분한다. 업로드를 복구할 수 없으면 재업로드를 안내하며 없는 데이터를 생성하지 않는다.
# 16. Coupang adapter 독립 게이트
<mention-page url="https://app.notion.com/p/3ec7cdef782d810bafe6e70053b009a7"/>
쿠팡은 특정 source adapter이며 전체 검색 성공의 필수 전제가 아니다. 최소 20개 출처·관측 시각이 있는 상품 URL fixture에서 대표 이미지 정확도, 잘못된 이미지 0건, extraction stage 기록, static/metadata/browser fallback별 성공률, 차단·무료 quota 동작을 검증한다. 대표 이미지 정확 추출 ≥90%는 제안 목표이며 현재 실측값이 아니다. 접근 제한을 우회해야만 성공하는 방식은 채택하지 않는다. 미통과면 adapter를 끄고 다른 source의 실제 검색 품질로 평가한다.
# 17. 릴리스 체크리스트와 완료 정의
다음은 발표용 체크리스트가 아니라 **실사용 릴리스 차단 기준**이다. 미완료 blocker를 발표에서 말하는 것으로 해소하지 않는다.
- [ ] 문서 간 명칭·상태·입력·cap·deadline·예산·TTL·API 충돌 0; 폐기된 5시간 방향이 현재 문서/링크에 남지 않음.
- [ ] 실제 PNG의 provenance와 변경 금지 항목 기록; 재구성 글꼴·새 motion 사양 명시; 1586×992 원본 대조 및 새 모바일/상태 baseline 검토 증거 확보.
- [ ] typecheck/lint/build, 핵심 회귀·API·RLS·DB migration 검증 통과.
- [ ] 봉인 holdout과 baseline 비교 보고서; 실패·empty 포함 지표; tune 누수 없음.
- [ ] 실외부 연결 검증과 가격·이미지·source evidence 표본 감사; LIVE/REPLAY 구분.
- [ ] 모든 Hard Fail 0; 잘못된 가격·이미지·source·Gate 우회 0.
- [ ] persisted queue/dispatcher/20초 worker/90초 deadline/lease 재획득/취소 경합 검증.
- [ ] provider/source 장애·PARTIAL/NO_RELIABLE_MATCH/FAILED/EXPIRED 구분 검증.
- [ ] BudgetGuard 동시성·예약·미정산·cancel·재시도 검증; pilot 누적 USD 20 이내와 다른 유료 비용 0 확인.
- [ ] 원본 바이트 메모리 전용·영속 저장 0; 정규화 private 임시 이미지 ≤1시간, terminal cleanup ≤5분 목표, snapshot 7일 만료·orphan 정리 검증.
- [ ] rollback·복구 drill 및 운영 kill switch 확인; 운영 담당자와 사고 대응 경로 지정.
- [ ] 현재 무료 quota/권한/가격표를 공식 출처와 계정에서 재확인; 미확인 의존성 없음.
- [ ] 사용자에게 보이는 상태·오류·가격 기준·개인정보 안내가 실제 동작과 일치.
- [ ] unresolved blocker = 0, 릴리스 버전·측정 보고서·승인자 기록.
문서 작성만으로 체크박스를 채우지 않는다. 모든 실측은 현재 **미측정**이다. 구현·모델 지원·무료 worker 실행·bounded 이미지 정규화·원본 대조 QA는 증거가 생길 때까지 별도 차단 항목으로 남긴다. PNG에 없는 별도 원본 파일 부재 자체를 차단 사유로 삼지 않는다. 과거 해커톤의 제한된 성공 기준이나 “5시간 안에 됨”은 어떤 면제 근거도 제공하지 않는다.
</content>
</page>
