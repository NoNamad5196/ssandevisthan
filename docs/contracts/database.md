Here is the result of "fetch" for the Page with URL https://app.notion.com/p/3ec7cdef782d818ab989cab459c8facb as of 2026-10-09T05:52:49.088Z:
<page url="https://app.notion.com/p/3ec7cdef782d818ab989cab459c8facb" icon="🔌">
<ancestor-path>
<parent-page url="https://app.notion.com/p/3ec7cdef782d81f4948ed3a2597f9b6b" title="SSANDEVISTHAN — 백엔드 구현 아키텍처 v3"/>
<ancestor-2-page url="https://app.notion.com/p/3ea7cdef782d8127ae12ebad49065f19" title="싼데비슷한 / SSANDEVISTHAN — AI 유사 저가 상품 검색"/>
<ancestor-3-data-source url="collection://4a1725c4-940c-470a-b663-d0e89ff7ef4f" name="💡 아이디어 일지"/>
<ancestor-4-database url="https://app.notion.com/p/df70dbe7750447ecab7e58a27e891f58" title="💡 아이디어 일지"/>
</ancestor-path>
<properties>
{"title":"SSANDEVISTHAN — 데이터·Edge API 계약 v3"}
</properties>
<iconMetadata>{"type":"emoji","emoji":"🔌"}</iconMetadata>
<content>
> **구현 계약 v3 · 2026-10-09 · SSANDEVISTHAN**
> 싼데비슷한은 국내 새 의류를 대상으로 실제 구매 가능한 유사 저가 상품을 찾는다. 5시간 해커톤 MVP 계약을 폐기하고, 이 문서의 인증·소유권·비동기 실행·근거·보존·오류 처리를 최초 구현부터 적용한다. 본문은 구현해야 할 사양이며 구현 완료 또는 외부 서비스 기능 검증을 뜻하지 않는다.
> **시각적 최상위 기준은 실제 기존 목업이다.** API나 상태 수가 늘어났다는 이유로 목업의 글꼴·색상·레이아웃·모션·카드·아이콘·문구 배치를 임의 재설계하지 않는다. 기술 변경은 기존 UI 안에 매핑한다. 확인된 1586×992 PNG가 시각적 원본이다. 원본에 없는 반응형·접근성·모션 상세는 상위 문서에서 새로 정의한 구현 사양을 적용하며, 그 값을 원본에서 측정한 것으로 표현하지 않는다.
# 1. 문서 책임과 공통 규칙
- 프로젝트 영문명: **SSANDEVISTHAN**. 저장소·패키지 식별자는 `ssandevisthan`을 사용한다.
- 이 문서는 API wire format, 상태 전이, 데이터 소유권, 영속성, DB·RLS, 재시도·삭제 계약의 정본이다.
- Gate, similarity coverage, 가격 코호트 계산·가중치·실험 기준은 <mention-page url="https://app.notion.com/p/3ec7cdef782d819a89e7f77355ebdf34"/>가 정본이다. 여기서 별도 임계값을 만들지 않는다.
- 실행 배치·모듈 경계·배포·운영은 <mention-page url="https://app.notion.com/p/3ec7cdef782d81f4948ed3a2597f9b6b">SSANDEVISTHAN — 백엔드 구현 아키텍처 v3</mention-page>, 검증은 <mention-page url="https://app.notion.com/p/3ec7cdef782d8146917ec72af0ef8d89"/>를 따른다.
- Base route: Supabase Edge router의 `/functions/v1/api/v3`. 이하 경로는 base에 상대적이다. 함수 구현에서 HTTP method와 route를 함께 검사한다.
- JSON은 UTF-8, `schemaVersion`은 정수 `3`, 시각은 UTC RFC 3339, 금액은 KRW 정수 원 단위, UUID는 UUID 문자열이다. 프론트 표시 시 사용자 현지 시간대로 변환한다.
- 성공 응답은 `ok`, `data`, `meta`; 실패 응답은 `ok`, `error`, `meta`로 고정한다. 모든 JSON 응답에 `meta.requestId`, `meta.schemaVersion`, `meta.createdAt`가 있다.
- `X-Request-Id`는 추적 전용이다. 클라이언트 값을 검증한 뒤 받아들이거나 서버가 UUID를 생성한다. 중복 실행 방지는 별도 `Idempotency-Key`가 담당한다.
- 초기부터 Supabase Auth 익명 로그인으로 JWT를 얻는다. 회원가입 화면을 강제하지 않지만 서버에서는 익명 사용자도 고유 `auth.uid()`를 가진 사용자다. JWT 서명·issuer·audience·expiry를 검증하며, body의 owner/userId는 받지 않는다.
- 모든 입력은 strict schema로 검증한다. 알려지지 않은 필드, `schemaVersion != 3`, 임의 URL·모델명·provider 설정·점수·owner는 거부한다.
- OpenAI 이외 유료 서비스·자동 과금 전환은 허용하지 않는다. 무료 제공 범위와 실제 배포 가능성 확인은 운영 문서의 출시 전 조건이다.
# 2. 엔드포인트
- `POST /uploads`: 업로드 세션 생성. 201.
- `PUT /uploads/{uploadId}/content`: 이미지 binary를 Edge로 전송하고 메모리에서 검증·정규화하여 private bucket에 저장. 200.
- `POST /uploads/{uploadId}/finalize`: 서버 저장 상태를 확인하고 검색에 사용할 수 있는 READY 업로드로 확정. 200.
- `DELETE /uploads/{uploadId}`: 미사용 업로드 폐기. 204. 이미 검색이 사용 중이면 409 `UPLOAD_IN_USE`; 해당 검색을 먼저 취소·삭제한다.
- `POST /searches`: 이미지 유사 검색 생성. 정상 최초/중복 재사용 모두 202.
- `POST /deals`: 텍스트 생활용품·의류 저가·핫딜 탐색 생성. 실행·소유권·보존·polling은 검색과 동일한 `searchId`를 쓴다. 202.
- `GET /searches/{searchId}`: 실행 상태. 200.
- `GET /searches/{searchId}/results?sort=RECOMMENDED|MOST_SIMILAR|LOWEST_PRICE`: 완료 결과. 실행 중이면 202, 종료 후 200. 실패·취소·만료도 HTTP 200의 종료 상태이며 배열은 빈 값일 수 있다.
- `GET /searches?limit=20&cursor=...`: 소유자의 최근 7일 이력. limit 1\~50, `(created_at,id)` 내림차순 keyset pagination; 다른 소유자의 검색은 보이지 않는다. 200.
- `POST /searches/{searchId}/cancel`: 취소를 DB에 반영하고 활성 lease를 무효화. 200. 이미 종료된 검색은 상태를 바꾸지 않고 현재 상태를 반환한다.
- `DELETE /searches/{searchId}`: 소유자의 검색 및 파생 데이터 삭제를 예약하고 즉시 조회 차단. 반복 호출도 204. 외부 사용자에게 존재 여부를 노출하지 않는다.
- `POST /offers/{offerId}/refresh`: 현재 범위에서 구현하지 않는다. 나중에 도입할 때 별도 계약·비용·관찰 기록을 추가한다. 브라우저가 해당 API를 호출하거나 최신 가격 보장을 표시하지 않는다.
- 조회·업로드를 포함해 `Authorization: Bearer <Supabase JWT>`가 필요하다. CORS allowlist, 허용 method/header, 최대 본문 크기를 명시적으로 제한한다. service-role secret은 브라우저에 제공하지 않는다.
# 3. 이미지 업로드: 원본 영구 저장 없이 재시도 가능한 입력 확보
## 3.1 입력 한도와 정규화
- 검색 입력은 이미지 **1장**. 허용 실제 인코딩: JPEG, PNG, WebP. `Content-Type`만 믿지 않고 magic bytes와 안전한 decoder 결과를 함께 검사한다.
- 기존 PNG 업로드 안내의 “JPG, PNG, WEBP 최대 10MB”를 그대로 보존한다. 원본 binary는 최대 `10,000,000 bytes`(십진수 10MB), 원본 가로×세로는 최대 `24,000,000 pixels`(24 MP). 압축 해제 전에 헤더 크기를 검사하고 decode 중 메모리·시간 한도를 둔다.
- 손상 파일, SVG/GIF/HEIC, 애니메이션·다중 프레임, decoder 실패, 빈 이미지·0 dimension은 거부한다. MIME 위장과 비정상 EXIF를 테스트한다.
- Supabase Edge의 현재 공식 한도 CPU 2초·메모리 256MB와 sharp/libvips 미지원 조건에 맞춰, bounded WASM decoder/normalizer를 실제 배포 환경에서 검증한다. 클라이언트 사전 축소는 성능 보조일 뿐 서버 독립 검증을 대체하지 않는다. 24MP 입력·정규화·metadata 제거의 최대 메모리/CPU 측정이 통과하지 못하면 배포를 보류하고 처리 경로를 재설계한다. 목업의 10MB 문구나 서버 지원 한도를 몰래 줄여 통과시키지 않는다. 공식 제한 근거: [Supabase Edge Functions limits](https://supabase.com/docs/guides/functions/limits).
- EXIF orientation 적용 → metadata 제거 → 긴 변 최대 `1600 px`로 축소(원본이 작으면 확대하지 않음) → 단일 프레임 정규화 WebP로 인코딩한다. 알파 채널은 보존하고, 모델 전달 시 배경 처리 정책은 버전으로 기록한다.
- 서버는 원본을 메모리에서만 처리한다. raw binary·base64·파일명·EXIF·prompt·개인정보를 DB/로그에 넣지 않는다. 메모리 임시 파일이 필요한 런타임이면 요청 종료에 반드시 제거하고 durable disk에 기록하지 않는다.
- 검색 재개에 필요한 **정규화 사본만** private temporary bucket에 저장한다. 경로는 서버가 만든 `owner_uuid/upload_uuid/normalized.webp`; 사용자가 object key를 지정할 수 없다.
- 정규화 사본의 최대 보존 시간은 생성 후 1시간. 정상적인 terminal 상태에서는 5분 이내 삭제한다. 사용자가 검색 삭제를 요청하면 즉시 다운로드 접근을 막고 가능한 즉시 object를 지운다. cleanup 실패를 재시도하며 1시간을 넘으면 보존 위반 알림을 발생시킨다.
- upload TTL이 검색에 90초를 보장하지 못하면 시작을 거부한다. 서버는 READY 여부와 `expiresAt >= now()+90s`를 검사한다.
## 3.2 업로드 생성
`POST /uploads` JSON:
```json
{
  "schemaVersion": 3,
  "declaredMimeType": "image/jpeg",
  "declaredBytes": 2345678
}
```
201 응답:
```json
{
  "ok": true,
  "data": {
    "uploadId": "a6d5fdbd-6c45-4614-b9b8-9c8a456a7001",
    "status": "PENDING",
    "contentUrl": "/functions/v1/api/v3/uploads/a6d5fdbd-6c45-4614-b9b8-9c8a456a7001/content",
    "expiresAt": "2026-10-09T04:00:00Z",
    "maxBytes": 10000000,
    "maxPixels": 24000000
  },
  "meta": {
    "requestId": "5ce3c828-eed6-4717-898d-fc065c981101",
    "schemaVersion": 3,
    "createdAt": "2026-10-09T03:00:00Z"
  }
}
```
`PUT contentUrl`의 body는 원본 image bytes, `Content-Type`은 선언한 이미지 MIME, `Content-Length`는 실제 bytes다. 서버는 요청을 한도 초과 시 중단한다. 공개 Storage upload URL로 원본을 먼저 올리는 방식은 이 계약에 맞지 않는다.
- 상태 `PENDING → PROCESSING → STORED → READY`. PROCESSING 중 같은 uploadId로 PUT하면 409 `UPLOAD_PROCESSING`; lease 만료 뒤에만 재개한다.
- PUT 완료 시 서버가 계산한 raw content digest를 내부적으로 비교하여 동일 bytes 재전송은 기존 STORED/READY 응답을 재사용한다. 다른 bytes로 동일 uploadId를 덮어쓰면 409 `UPLOAD_CONTENT_CHANGED`.
- digest는 bytes가 아닌 SHA-256 값만 보관한다. 미사용 upload 삭제 시 함께 삭제하고, 검색에 연결한 경우 정규화 fingerprint·uploadId·처리 버전만 run의 immutable input descriptor로 옮겨 검색과 함께 7일 내 삭제한다. 이를 통해 이미지 binary 정리 후에도 같은 key 재시도를 검증한다. 클라이언트 digest를 신뢰하지 않는다.
- PUT의 200 `data`는 `uploadId`, `status: "STORED"`, `mimeType: "image/webp"`, `width`, `height`, `normalizedBytes`, `expiresAt`이다. 원본·정규화 object URL은 반환하지 않는다.
`POST /uploads/{uploadId}/finalize` body:
```json
{
  "schemaVersion": 3
}
```
- owner 일치, 만료 전, STORED 상태, private object 존재·크기·정규화 digest를 확인하여 READY로 바꾼다. 클라이언트가 완료를 선언했다고 READY로 바꾸지 않는다.
- READY 세션에 재호출하면 같은 READY 응답. 미완료 세션은 409 `UPLOAD_NOT_READY`, 만료는 410 `UPLOAD_EXPIRED`.
- finalize의 200 `data`는 `uploadId`, `status: "READY"`, `width`, `height`, `mimeType`, `expiresAt`이다. DB에 READY인데 object가 사라진 경우 준비 완료로 반환하지 않는다.
- 업로드는 최초 검색 하나에 원자적으로 연결된다. 같은 검색 idempotency 재시도는 허용하지만 다른 key의 새 검색이 이미 사용한 uploadId를 쓰면 409 `UPLOAD_ALREADY_CONSUMED`. 새 검색에는 새 업로드를 사용한다.
# 4. 검색 생성과 중복 방지
`POST /searches`, `Idempotency-Key: 77e24b8a-875a-4554-a41f-6f067435282c`:
```json
{
  "schemaVersion": 3,
  "uploadId": "a6d5fdbd-6c45-4614-b9b8-9c8a456a7001",
  "resultLimit": 10
}
```
- `resultLimit`은 1\~10 정수이며 생략 시 10. 원본 가격·예산·referencePrice·강제 원본 상품 선택 필드는 없다.
- 서버가 `owner + endpoint + schemaVersion + normalizedImageSha256 + resultLimit + inputPolicyVersion`를 canonical JSON으로 직렬화해 `input_digest`를 만든다. object key·만료된 signed URL·JSON 필드 순서는 의미 있는 입력으로 포함하지 않는다.
- `Idempotency-Key`는 16\~128자의 ASCII 안전 문자열이며 owner와 결합해 유일하다. key 자체는 결제·인증 토큰이 아니며 로그에는 해시만 남긴다.
- 검색 시작 트랜잭션: JWT owner 확인 → 기존 `(owner_id,key)` 확인 → 새 요청이면 upload READY/미사용 확인 → budget reservation → run 삽입 → upload를 run에 연결 → 최초 job 삽입 → commit. 이 과정 전체가 원자적이어야 한다.
- 재시도는 key를 먼저 조회하고 기존 immutable input descriptor의 uploadId·정규화 fingerprint·resultLimit과 요청을 대조한다. 삭제된 binary를 다시 읽거나 모델을 호출해 digest를 재생성하지 않는다.
- 같은 owner/key/동일 digest는 **기존 searchId**를 반환한다. 이전 run이 실패·취소·만료되어도 재실행하지 않는다. 새 실행은 새 key와 새 입력 세션이 필요하다.
- 같은 owner/key/다른 digest는 409 `IDEMPOTENCY_KEY_REUSED`. 동시 요청은 unique constraint에 의해 한 건만 생성되고, 충돌 요청은 commit된 기존 row를 조회해 digest를 다시 비교한다.
- 네트워크 응답 유실 시 같은 key를 재전송한다. 동일 image로 다른 key를 보낸 경우의 자동 semantic dedup은 하지 않으며 rate/budget limit으로 통제한다.
- 삭제된 run의 key는 최초 생성 7일 만료까지 tombstone으로 유지해 늦은 retry가 새 실행을 만들지 않게 한다. 해당 key 재사용은 410 `SEARCH_DELETED`. tombstone에는 owner/key hash/digest/expiry만 남긴다.
202 응답. `Location`은 상태 URL, `Retry-After: 2`:
```json
{
  "ok": true,
  "data": {
    "searchId": "b71ff87a-9c48-45d8-b1e5-6f4eb7ac7002",
    "mode": "IMAGE_SIMILAR",
    "status": "QUEUED",
    "stage": null,
    "statusUrl": "/functions/v1/api/v3/searches/b71ff87a-9c48-45d8-b1e5-6f4eb7ac7002",
    "resultsUrl": "/functions/v1/api/v3/searches/b71ff87a-9c48-45d8-b1e5-6f4eb7ac7002/results",
    "deadlineAt": "2026-10-09T03:01:40Z",
    "reused": false
  },
  "meta": {
    "requestId": "ea248d0f-ad93-4836-b317-b55ad4827102",
    "schemaVersion": 3,
    "createdAt": "2026-10-09T03:00:10Z"
  }
}
```
접수된 run은 응답 연결과 독립적으로 DB에 존재한다. 브라우저 연결이 끊겨도 같은 searchId로 상태를 다시 조회할 수 있다.
# 5. 상태 머신·worker·polling
- 공개 상태: `QUEUED`, `RUNNING`, `COMPLETED`, `PARTIAL`, `NO_RELIABLE_MATCH`, `FAILED`, `CANCELED`, `EXPIRED`.
- 진행 stage: `VALIDATING`, `ANALYZING`, `DISCOVERING`, `EXTRACTING`, `COMPARING`, `RANKING`. QUEUED의 stage는 null. 종료 후 stage는 마지막 stage를 보존할 수 있다.
- `QUEUED → RUNNING → terminal`. terminal은 위의 마지막 6개 상태이며, 한번 terminal이 되면 다시 RUNNING으로 되돌리지 않는다.
- COMPLETED: Gate·근거·가격 정책을 통과한 구매 추천 `results.length > 0`이고 검색이 정책대로 끝남.
- PARTIAL: 구매 추천 `results.length > 0`이지만 provider 실패/일부 후보 처리 실패/전체 deadline 도달 때문에 명시된 커버리지를 모두 수행하지 못함. 가능한 결과를 먼저 확정하고 부족한 부분을 warning으로 남긴다.
- COMPLETED/PARTIAL의 결과 유무는 구매 추천 results\[\]만 센다. references\[\]만 존재하면 성공 구매 결과로 계산하지 않는다.
- NO_RELIABLE_MATCH: 정상 실행을 마쳤지만 추천 가능한 결과가 없음. 품질이 낮은 상품으로 배열을 채우지 않는다. 가격 미확인 참고 후보가 존재해도 추천 결과가 없으면 이 상태가 가능하다.
- FAILED: 필수 단계의 오류로 결과를 만들 수 없음. `failure.code`와 안전한 사용자 문구 제공.
- CANCELED: 사용자가 취소. EXPIRED: 전체 90초 deadline까지 구매 추천 결과가 없어 실행을 종료. 운영자가 실행을 중단한 경우 구매 추천 결과가 없으면 FAILED + `OPERATOR_STOP`, 있으면 PARTIAL로 종료한다. deadline을 넘긴 무한 background 실행 금지.
- 전체 90초는 run 접수 시각부터 대기열 시간을 포함한다. job 하나의 worker 실행은 최대 20초이며 provider timeout은 해당 step의 잔여 시간보다 짧다. 작업을 분할·checkpoint해서 DB job으로 이어 간다.
- OpenAI 유료 API request/run 상한은 analyze/expand 합계 2회, discovery 8회, comparison 4회, 전체 14회다. comparison은 최대 5개 후보씩 4묶음이다. retry도 단계·전체 cap을 소비하며 tool 내부 호출 수·비용은 별도 원장에서 제한한다.
- 단계당 작업 개수는 query 4\~8, raw URL≤150, dedup≤60, page extraction≤30, visual comparison≤20, 결과 합계≤10이다. deadline·비용·모든 cap 중 먼저 도달한 것이 우선한다.
- worker는 claim 시 lease owner, lease expiry, monotonic attempt token을 얻는다. 모든 checkpoint/결과 쓰기는 lease·attempt token·run status·deadline·deleted_at을 재검사한다.
- 외부 호출 전 budget을 예약하고 idempotent operation key를 저장한다. at-least-once job은 같은 checkpoint를 재사용하며 비용이 이미 사용되었는지 확인한다. 외부 API 자체의 exactly-once를 가정하지 않는다.
- worker crash 후 lease 만료 작업만 재claim. 남은 deadline·attempt cap·budget 안에서만 복구한다. 종료/삭제된 run은 재claim하지 않는다.
- polling은 2초에서 시작해 최대 5초까지 backoff+jitter. 백그라운드 탭은 5초 이상 또는 일시 중지. terminal이면 종료. 화면 이동·네트워크 끊김은 검색 취소가 아니며 다시 진입해 같은 searchId를 조회한다.
- 수치 백분율은 실제 작업량이 확정된 경우만 제공한다. 임의 99% 진행률을 만들지 않고 stage를 목업의 기존 분석/검색 표시 안에 매핑한다.
실행 중 `GET /searches/{id}` 예시:
```json
{
  "ok": true,
  "data": {
    "searchId": "b71ff87a-9c48-45d8-b1e5-6f4eb7ac7002",
    "mode": "IMAGE_SIMILAR",
    "status": "RUNNING",
    "stage": "EXTRACTING",
    "createdAt": "2026-10-09T03:00:10Z",
    "deadlineAt": "2026-10-09T03:01:40Z",
    "completedAt": null,
    "pollAfterMs": 3000,
    "progress": {
      "discoveredUrls": 64,
      "deduplicatedUrls": 28,
      "extractedCandidates": 12,
      "comparedCandidates": 0
    },
    "failure": null
  },
  "meta": {
    "requestId": "43727be6-6ac3-4e25-9e02-2d31e196e103",
    "schemaVersion": 3,
    "createdAt": "2026-10-09T03:00:35Z"
  }
}
```
- 진행 조회는 server cache 없이 `Cache-Control: private, no-store`. 진행 중 results endpoint는 202와 같은 상태 envelope를 돌려준다. 중간 점수는 최종 추천처럼 표시하지 않는다.
- 완료 snapshot은 owner 단위로 접근하고 shared CDN cache에 두지 않는다. 동일 결과를 다시 읽어도 ranking을 다시 계산하지 않는다.
# 6. 최종 결과 DTO
- `results[]`: 확인 가능한 일반 상품가가 있고 품질·국내 새상품·실제 상품 근거 조건을 통과한 구매 추천. `references[]`: 품질은 충족했지만 가격을 확인하지 못한 참고 후보. references는 최대 5개, 추천 10개와 별도이며 저가·핫딜·최저가 배지를 붙이지 않는다.
- `priceBasis=TOTAL_PRICE`: shippingFee를 확인했으며 effectivePrice=itemPrice+shippingFee. `priceBasis=ITEM_PRICE_ONLY`: shippingFee=null, effectivePrice=null; 일반 상품가끼리만 비교한다.
- `sort`는 `RECOMMENDED`(기본), `MOST_SIMILAR`, `LOWEST_PRICE` 중 하나다. IMAGE_SIMILAR는 세 값 모두 지원한다. DEAL_TEXT는 RECOMMENDED/LOWEST_PRICE만 지원하고 MOST_SIMILAR 요청은 400 `UNSUPPORTED_SORT_FOR_MODE`다.
- 검색 종료 시 resultLimit을 적용하기 전 전체 적격 후보(이미지 모드 최대 20개)의 점수·가격 코호트·근거·버전과 지원 sort별 정렬 순서를 `search_rank_snapshots`에 한번 저장한다. GET은 이 동일한 집합의 저장된 정렬 순서를 선택한 후 resultLimit을 적용한다. sort 변경은 새로운 provider 호출·점수 계산·Gate 변경·가격 재확인을 만들지 않는다.
- `cohortRank`는 선택한 sort에서 동일 `priceBasis` 안의 1-based 순위다. GET 응답용으로 해당 저장 순서에서 결정하며 alternate sort 결과를 search_results의 유일한 기본 순위 컬럼에 덮어쓰지 않는다. 서로 다른 코호트의 finalScore·cohortRank를 전역 가격 순위로 합치지 않는다.
- RECOMMENDED/LOWEST_PRICE의 직렬화는 TOTAL_PRICE 묶음 다음 ITEM_PRICE_ONLY 묶음이며 각 묶음은 해당 sort 규칙을 따른다. MOST_SIMILAR는 두 코호트를 합쳐 totalSimilarity 중심으로 정렬할 수 있으나 배송비 근거 구분을 그대로 표시한다. 정확한 tie-break는 랭킹 정본을 따른다.
- DEAL_TEXT의 RECOMMENDED는 text relevance Gate를 통과한 일반 구매 가격을 코호트 내 오름차순 정렬하며 가격 동점은 dealRelevance 내림차순 → priceObservedAt 최신순 → offerId다. LOWEST_PRICE도 동일 가격 기준을 사용한다. 이미지의 V/A/S/finalScore를 만들어 사용하지 않는다.
- resultLimit은 두 코호트 결과 합계에 적용한다. 최종 선별 정책·코호트별 할당은 랭킹 계약을 따른다.
- 가격 미확인을 0원으로 표현하지 않는다. 무료배송 확인은 `shippingFee:0`, 배송비 미확인은 `shippingFee:null`이다.
- `imageSource` 공통 enum은 `merchant_page | merchant_cdn | merchant_metadata | search_thumbnail | fallback_same_product | placeholder`다. 대소문자를 임의 변환하지 않는다. `imageExtractionStage`는 `STATIC_HTML | METADATA | BROWSER_DOM | BROWSER_NETWORK | SEARCH_THUMBNAIL | FALLBACK_SEARCH | PLACEHOLDER`다.
- imageUrl은 해당 상품과 연결된 검증된 merchant 이미지여야 구매 추천으로 쓰인다. placeholder/search thumbnail만으로 검증된 추천을 만들지 않는다. 이미지 URL 안전성·출처 표시와 만료 처리는 adapter 계약을 따른다.
- 공개 API의 `variantId`는 product_variants row UUID다. 내부 `variantKey`는 판매처 옵션 식별/확인한 옵션 조합이며 `sourceVariantKey`가 있으면 그 값을 근거로 생성한다. 미확인 내부 key는 UNKNOWN으로 유지하고 공개 UUID로 판매처 옵션 문자열을 반환하지 않는다.
- 모든 모델 속성은 `{value,state,source}` 구조다. value는 versioned uppercase controlled vocabulary, state는 OBSERVED/UNKNOWN/NOT_APPLICABLE이다. 선택 필드 confidence는 모델 내부 신호이며, evidenceIds는 실제 보존된 근거에만 연결한다. 모델 추정을 검증된 판매 사실로 표현하지 않는다.
- 가격 시각은 `priceObservedAt`, 이미지 시각은 `imageObservedAt`, 재고 시각은 `stockObservedAt`으로 분리한다. 범용 observedAt을 가격 시각의 별칭으로 반환하지 않는다.
- 원본 식별 `identifiedOriginal`은 null 가능. 검색 전제도 가격 비교 기준가도 아니다. 원본 미확인 자체를 실패로 처리하지 않는다.
- `matchedAttributes`, `differentAttributes`, `unknownAttributes`는 확인 가능한 사실과 모델 추정을 구분해 표시한다. 모델이 소재·브랜드·정품 여부를 단정하지 않는다.
아래는 형식 설명용 가상 데이터이며 실제 판매처·실측 결과가 아니다. `.invalid` URL은 실행·외부 노출용이 아니다.
```json
{
  "ok": true,
  "data": {
    "searchId": "b71ff87a-9c48-45d8-b1e5-6f4eb7ac7002",
    "mode": "IMAGE_SIMILAR",
    "status": "COMPLETED",
    "stage": "RANKING",
    "targetAnalysis": {
      "category": {
        "value": "SWEATSHIRT",
        "state": "OBSERVED",
        "source": "INPUT_IMAGE"
      },
      "color": {
        "value": "MELANGE_GRAY",
        "state": "OBSERVED",
        "source": "INPUT_IMAGE"
      },
      "fit": {
        "value": "OVERSIZED",
        "state": "OBSERVED",
        "source": "INPUT_IMAGE"
      },
      "shoulder": {
        "value": "DROP_SHOULDER",
        "state": "OBSERVED",
        "source": "INPUT_IMAGE"
      },
      "neck": {
        "value": "CREW_NECK",
        "state": "OBSERVED",
        "source": "INPUT_IMAGE"
      },
      "graphic": {
        "value": "SMALL_LETTERING",
        "state": "OBSERVED",
        "source": "INPUT_IMAGE"
      },
      "graphicPlacement": {
        "value": "LEFT_CHEST",
        "state": "OBSERVED",
        "source": "INPUT_IMAGE"
      },
      "material": {
        "value": null,
        "state": "UNKNOWN",
        "source": null
      },
      "materialAppearance": {
        "value": "SWEATSHIRT_LIKE",
        "state": "OBSERVED",
        "source": "INPUT_IMAGE"
      }
    },
    "generatedQueries": [
      "멜란지 그레이 오버핏 맨투맨",
      "회색 드롭숄더 작은 레터링 맨투맨",
      "멜란지 크루넥 스웨트셔츠 국내배송",
      "gray oversized sweatshirt small chest lettering"
    ],
    "identifiedOriginal": null,
    "results": [
      {
        "productId": "a1aba380-4d04-4d1e-90c6-38db17204001",
        "offerId": "fbec0476-b2cd-4da6-b7b2-ae0dd9084002",
        "variantId": "88fd3c40-9a8d-4d2d-b185-374879244003",
        "title": "멜란지 오버핏 레터링 맨투맨",
        "merchant": "예시 의류몰",
        "source": "merchant_example",
        "productUrl": "https://shop.example.invalid/products/sweatshirt-01?variant=gray-m",
        "imageUrl": "https://cdn.example.invalid/sweatshirt-01-gray.webp",
        "imageSource": "merchant_cdn",
        "imageSourceUrl": "https://shop.example.invalid/products/sweatshirt-01",
        "imageExtractionStage": "METADATA",
        "variant": {
          "color": "멜란지 그레이",
          "size": "M",
          "availability": "IN_STOCK",
          "selectionRequired": false
        },
        "currency": "KRW",
        "itemPrice": 21900,
        "shippingFee": 3000,
        "effectivePrice": 24900,
        "priceBasis": "TOTAL_PRICE",
        "conditionalPrices": [],
        "visualSimilarity": 0.91,
        "attributeSimilarity": 0.86,
        "priceScore": 0.5,
        "finalScore": 0.813,
        "cohortRank": 1,
        "matchedAttributes": [
          "오버핏",
          "드롭숄더",
          "작은 가슴 레터링"
        ],
        "differentAttributes": [
          "레터링 배치 일부 다름"
        ],
        "unknownAttributes": [
          "실제 원단 촉감"
        ],
        "warnings": [],
        "evidenceIds": [
          "9dccde21-4392-4f2b-aecb-e20a86e34004"
        ],
        "visualCoverage": 0.95,
        "attributeCoverage": 0.88,
        "totalSimilarity": 0.89125,
        "priceObservedAt": "2026-10-09T03:00:51Z",
        "imageObservedAt": "2026-10-09T03:00:49Z",
        "stockObservedAt": "2026-10-09T03:00:51Z"
      }
    ],
    "references": [],
    "warnings": [],
    "completedAt": "2026-10-09T03:01:02Z",
    "expiresAt": "2026-10-16T03:00:10Z",
    "sort": "RECOMMENDED"
  },
  "meta": {
    "requestId": "7a9fcc5e-4a3a-4b63-869b-e59fda9a8104",
    "schemaVersion": 3,
    "createdAt": "2026-10-09T03:01:03Z",
    "pipelineVersion": "similar-search-v3",
    "visionPromptVersion": "vision-attributes-v3",
    "queryExpanderVersion": "query-v3",
    "extractorVersion": "extractor-v3",
    "rankerVersion": "ranker-v3-bootstrap-1",
    "pricePolicyVersion": "unconditional-cohort-v3",
    "sourcePolicyVersion": "domestic-new-v3",
    "providerFailures": [],
    "sourceStats": {
      "rawUrls": 64,
      "dedupUrls": 28,
      "extractedProducts": 20,
      "comparedProducts": 16,
      "passedSimilarityGate": 4,
      "rankableProducts": 1,
      "countsByPriceBasis": {
        "TOTAL_PRICE": 1,
        "ITEM_PRICE_ONLY": 0,
        "UNKNOWN": 0
      }
    },
    "gateVersion": "gate-v3-bootstrap-1"
  }
}
```
- 예시의 수치와 version label은 schema 설명용이다. 출시 version manifest는 실제 사용한 prompt·모델·정규화기·extractor·ranker 설정을 immutable 값으로 기록한다. 모델 ID는 서버에서 검증한 설정을 사용하고 클라이언트에 선택권을 주지 않는다.
- references의 field는 `productId,title,merchant,productUrl,imageUrl,reasonCode,matchedAttributes,differentAttributes,unknownAttributes,imageObservedAt,priceObservedAt,evidenceIds`. reasonCode는 `PRICE_UNKNOWN` 등이며 `itemPrice:null`, `priceBasis:"UNKNOWN"`, `priceScore:null`, `finalScore:null`, `cohortRank:null`이다.
- 정상 빈 결과는 `status:"NO_RELIABLE_MATCH"`, `results:[]`, `references:[]`, `warnings:[{"code":"NO_CANDIDATE_PASSED","message":"충분히 비슷하고 가격을 확인할 수 있는 상품을 찾지 못했어요."}]` 형태다. HTTP 오류가 아니다.
- PARTIAL 결과에는 사용자용 warning과 안전한 providerFailures summary를 둔다. 내부 prompt·HTML·secret·전체 provider 응답·stack trace를 그대로 반환하지 않는다.
# 7. 텍스트 저가·핫딜 탐색: 생활용품·의류
`POST /deals`도 Idempotency-Key를 요구한다.
```json
{
  "schemaVersion": 3,
  "query": "회색 오버핏 맨투맨",
  "category": "FASHION",
  "resultLimit": 10
}
```
- trim 후 2\~200자, control character 제거. Unicode 정규화 정책과 query digest를 버전으로 고정한다. 카테고리는 `FASHION`, `LIVING`, `ALL`을 허용하며 기본은 `ALL`이다. 기존 PNG의 생활용품·의류 텍스트 검색 범위를 보존한다. 사진 유사 검색의 지원 범위인 국내 새 의류와 혼동하지 않는다.
- 응답 mode는 `DEAL_TEXT`. `visualSimilarity`, `visualCoverage`, `attributeSimilarity`, `attributeCoverage`, `totalSimilarity`, 이미지 `finalScore`는 모두 null이다. 별도 `dealRelevance`(0..1)·`dealRankerVersion`과 일반가 정렬을 사용한다. 시각 유사 검색과 핫딜 점수·순위를 혼합하지 않는다.
- deal 결과는 공통 offer·variant·근거 필드에 `dealEvidence`를 추가한다: `normalPrice`, `verifiedMerchantPrice`, `claimedCommunityPrice`, `conditionalPrices`, `conditions`, `verifiedAt`, `dealLabel`.
- normalPrice는 관찰된 일반 구매 가격이며 임의 정상가·할인 전 가격을 만들지 않는다. claimedCommunityPrice는 커뮤니티 게시글이 주장한 가격일 뿐이다. verifiedMerchantPrice는 해당 옵션 판매 페이지에서 확인한 현재 관찰 가격이다.
- 멤버십·특정 카드·첫구매·개인쿠폰·포인트·캐시백은 conditionalPrices에 조건과 근거를 보존하고 기본 저가 순위에 사용하지 않는다.
- 과거 비교 가격·할인 조건 증거가 충분하지 않으면 `dealLabel:"PRICE_DISCOVERY"`; 검증되지 않은 상태를 자동으로 HOT_DEAL이라 부르지 않는다. 절대적 인터넷 최저가 문구를 사용하지 않는다.
- 텍스트 검색 생성 digest는 owner+endpoint+정규화 query+category+resultLimit+정책 버전으로 생성한다.
# 8. 오류·재시도·취소·삭제
## 8.1 HTTP와 application 상태의 구분
- 400 `INVALID_INPUT`, `INVALID_SCHEMA_VERSION`, `INVALID_IMAGE`: 문법·형식 문제. 입력 수정 전 자동 재시도 금지.
- 401 `UNAUTHENTICATED`, `TOKEN_EXPIRED`: JWT refresh 1회 후 같은 요청 재전송. 익명 세션을 새로 만들면 이전 owner의 이력에 접근할 수 없으므로 기존 세션 복구를 먼저 시도한다.
- 404 `NOT_FOUND`: 존재하지 않거나 다른 owner의 ID. 두 경우 응답·시간 차이를 최소화한다.
- 409 `IDEMPOTENCY_KEY_REUSED`, `UPLOAD_ALREADY_CONSUMED`, `UPLOAD_NOT_READY`, `UPLOAD_CONTENT_CHANGED`, `UPLOAD_PROCESSING`: 코드별 사용자 또는 클라이언트 상태를 수정해야 한다.
- 410 `UPLOAD_EXPIRED`, `SEARCH_DELETED`, `SEARCH_EXPIRED`: 보존 만료·삭제. 검색 실행 상태 EXPIRED와 리소스 보존 만료 410은 다르다. 실행 EXPIRED snapshot도 생성 후 7일 동안 조회 가능하다.
- 413 `IMAGE_TOO_LARGE`, `IMAGE_DIMENSIONS_EXCEEDED`: bytes 또는 pixels 한도 초과.
- 415 `UNSUPPORTED_MEDIA_TYPE`: JPEG/PNG/WebP 외 실제 인코딩.
- 422 `UNSUPPORTED_CATEGORY`: 이미지 내용이 명확히 대상 범위 밖이면 VALIDATING/ANALYZING job에서 FAILED + 해당 failure.code로 기록한다. 업로드 시 내용 분석 전에는 422를 선제 반환하지 않는다. 직접 검증 가능한 텍스트 category 오류만 create 단계에서 422가 가능하다.
- 429 `RATE_LIMITED`, `BUDGET_LIMITED`, `FREE_QUOTA_EXHAUSTED`: Retry-After 또는 retryAt. 유료 서비스 자동 fallback 금지.
- 500 `INTERNAL_ERROR`, 503 `TEMPORARILY_UNAVAILABLE`: 접수/조회 계층 실패. 같은 Idempotency-Key와 jitter backoff로 bounded retry.
- 검색 접수 후 provider 502/timeout은 검색 run 안의 failure/providerFailures로 표현한다. polling 요청 자체를 502/504로 바꾸어 사용자가 새 실행을 만들게 하지 않는다.
- terminal FAILED의 `failure.retryable:true`는 사용자가 새 검색을 시도할 수 있다는 뜻이며 같은 run 자동 재시작의 의미가 아니다.
```json
{
  "ok": false,
  "error": {
    "code": "IDEMPOTENCY_KEY_REUSED",
    "message": "같은 요청 키에 다른 검색 내용이 사용되었습니다.",
    "retryable": false,
    "details": {
      "field": "Idempotency-Key"
    }
  },
  "meta": {
    "requestId": "9fbd4027-c701-4df9-8003-a258ba35c105",
    "schemaVersion": 3,
    "createdAt": "2026-10-09T03:00:11Z"
  }
}
```
## 8.2 취소와 삭제의 race
- cancel은 소유권을 확인하고 run row를 lock한다. 활성 run이면 CANCELED, completed_at, cancel_requested_at을 한 트랜잭션에 기록하고 job을 CANCELED로 바꾸며 lease token을 무효화한다. 이미 terminal이면 현재 상태 반환.
- 외부 요청은 AbortSignal로 중단을 시도하되, 공급자가 이미 처리한 호출의 비용 취소를 보장하지 않는다. cancel 이후 늦게 도착한 결과는 guard 실패로 저장하지 않는다.
- delete는 tombstone 기록과 deleted_at 설정, job 무효화, 결과 접근 차단을 한 트랜잭션으로 수행하고 204를 반환한다. API·직접 DB SELECT RLS 모두 즉시 숨긴다.
- 이후 private object 및 run 하위 데이터를 cleanup job이 제거한다. cleanup job은 일반 search_jobs와 분리하거나 run row cascade 이후에도 살아남는 구조로 만든다. 객체 제거 확인 전 object key를 잃어버리지 않는다.
- 삭제·보존 만료 시 candidate, field evidence, query, result snapshot, search 관련 provider telemetry를 cascade 제거한다. 원문 prompt·이미지 없이 합계만 가진 일별 비용 통계는 별도 운영 보존 정책을 따른다.
- 익명 계정도 세션 보관 기간 동안 이력을 조회·삭제할 수 있다. 브라우저 저장소를 지우면 복구 수단 없이 owner JWT를 잃을 수 있음을 설정/도움말의 기존 공간 안에서 간결히 설명한다.
# 9. 데이터 모델: 구현 필드와 불변 조건
아래 테이블은 이름만 나열한 ERD가 아닌 구현 기준이다. v3에서는 사용자별 검색 데이터가 먼저이며, 검증되지 않은 여러 사용자의 후보를 하나의 전역 상품 정답 DB로 합치지 않는다. 가격/옵션/이미지 근거는 run 당시 snapshot으로 고정한다.
## 9.1 auth와 입력
- `upload_sessions`: `id uuid PK`, `owner_id uuid NOT NULL FK auth.users`, `status text CHECK(PENDING,PROCESSING,STORED,READY,CONSUMED,DELETING,DELETED,EXPIRED)`, `object_key text UNIQUE nullable`, `declared_mime text`, `declared_bytes bigint`, `raw_sha256 text nullable`, `normalized_sha256 text nullable`, `normalizer_version text`, `width integer`, `height integer`, `normalized_bytes bigint`, `lease_token uuid nullable`, `lease_expires_at timestamptz nullable`, `consumed_by uuid nullable UNIQUE`, `created_at timestamptz`, `expires_at timestamptz`, `deleted_at timestamptz nullable`.
- `search_idempotency`: `owner_id uuid`, `key_hash text`, `input_digest text`, `search_id uuid nullable`, `deleted boolean default false`, `expires_at timestamptz`, PK(owner_id,key_hash). 검색 삭제 후 search_id를 null로 하고 deleted=true 유지. hash는 server HMAC 또는 안전한 SHA-256 규약을 고정한다. 원래 key 문자열은 저장하지 않아도 된다.
## 9.2 실행과 작업
- `search_runs`: `id uuid PK`, `owner_id uuid NOT NULL`, `mode text CHECK(IMAGE_SIMILAR,DEAL_TEXT)`, `schema_version smallint CHECK(=3)`, `input_digest text NOT NULL`, `input_descriptor jsonb NOT NULL`, `upload_id uuid nullable FK upload_sessions`, `query_text text nullable`, `status text`, `stage text nullable`, `result_limit smallint CHECK(1..10)`, `target_attributes jsonb`, `identified_original jsonb nullable`, `versions jsonb NOT NULL`, `warning_codes jsonb NOT NULL default []`, `failure jsonb nullable`, `created_at`, `started_at nullable`, `deadline_at`, `completed_at nullable`, `expires_at`, `cancel_requested_at nullable`, `deleted_at nullable` (시각 모두 timestamptz).
- `search_jobs`: `id bigint generated identity PK`, `search_id uuid FK search_runs ON DELETE CASCADE`, `operation_key text NOT NULL`, `stage text NOT NULL`, `state text CHECK(READY,LEASED,DONE,FAILED,CANCELED)`, `checkpoint jsonb NOT NULL default {}`, `attempt integer default 0`, `max_attempts smallint`, `available_at timestamptz`, `lease_token uuid nullable`, `lease_expires_at timestamptz nullable`, `last_error_code text nullable`, `created_at`, `updated_at`, UNIQUE(search_id,operation_key). checkpoint에는 URL/candidate cursor 및 이미 수행한 작업 ID만 저장하고 이미지 raw를 넣지 않는다.
- `search_queries`: `id uuid PK`, `search_id uuid NOT NULL`, `ordinal smallint CHECK(1..8)`, `query_text text NOT NULL`, `query_type text`, `source_target text nullable`, `created_at`, UNIQUE(search_id,ordinal). 비밀·추적 token이 포함된 URL을 query로 저장하지 않는다.
- `budget_reservations`: `id uuid PK`, `search_id uuid`, `operation_key text`, `reserved_microusd bigint CHECK(>=0)`, `actual_microusd bigint nullable CHECK(>=0)`, `state text CHECK(RESERVED,SETTLED,RELEASED)`, `created_at`, `settled_at nullable`, UNIQUE(search_id,operation_key). 단위는 1 USD=1,000,000 micro-USD. 금액 상한은 배포 설정으로 둔다.
## 9.3 상품·옵션·판매 조건
- `products`: `id uuid PK`, `search_id uuid NOT NULL`, `canonical_url text`, `canonical_url_hash text`, `source text`, `source_product_key text nullable`, `title text`, `brand text nullable`, `category text`, `model_code text nullable`, `normalized_attributes jsonb`, `created_at`, UNIQUE(search_id,source,canonical_url_hash). canonical URL은 추적 parameter만 제거하며 variant 선택 parameter는 보존한다.
- `product_variants`: `id uuid PK`, `product_id uuid NOT NULL`, `source_variant_key text nullable`, `variant_key_hash text NOT NULL`, `color text nullable`, `size text nullable`, `options jsonb NOT NULL default {}`, `selection_required boolean`, `observed_at`, UNIQUE(product_id,variant_key_hash). unknown 옵션은 known 옵션과 병합하지 않는다. variant key는 source option ID를 우선하고 없으면 확인된 옵션 조합의 hash를 사용한다.
- `product_images`: `id uuid PK`, `product_id uuid`, `variant_id uuid nullable`, `image_url text`, `image_url_hash text`, `source_url text`, `image_source text`, `extraction_stage text`, `verified_same_product boolean`, `is_merchant_image boolean`, `image_observed_at`, `evidence_id uuid nullable`, UNIQUE(product_id,image_url_hash). source_url은 이미지를 발견한 페이지이며 이미지 URL과 다르다.
- `offers`: `id uuid PK`, `product_id uuid`, `variant_id uuid NOT NULL`, `merchant text`, `product_url text`, `condition text CHECK(NEW,USED,UNKNOWN)`, `domestic_shipping text CHECK(CONFIRMED,REJECTED,UNKNOWN)`, `overseas_direct boolean nullable`, `rental boolean nullable`, `currency char(3) CHECK(='KRW')`, `item_price bigint nullable CHECK(>0)`, `shipping_fee bigint nullable CHECK(>=0)`, `effective_price bigint nullable`, `price_basis text NOT NULL CHECK(TOTAL_PRICE,ITEM_PRICE_ONLY,UNKNOWN)`, `stock_status text CHECK(IN_STOCK,OUT_OF_STOCK,UNKNOWN)`, `conditional_prices jsonb default []`, `price_observed_at`, `stock_observed_at nullable`, `price_evidence_id uuid nullable`, `shipping_evidence_id uuid nullable`.
- 실제 판매 옵션을 알 수 없거나 최저가 옵션과 대표 사진이 다른 경우 임의로 결합하지 않는다. 옵션 범위 가격은 `priceRange` 근거로 보존하되 특정 옵션의 일반가로 내보내지 않는다. 재고 없는 옵션의 낮은 가격을 구매 추천에 쓰지 않는다.
- 같은 상품의 다른 색/사이즈/판매처는 별도 variant/offer다. 상품 family를 묶는 식별과 구매 가능한 정확한 offer 식별을 분리한다.
- `price_observations`: `id uuid PK`, `offer_id uuid`, `observed_at`, `item_price bigint`, `shipping_fee bigint nullable`, `conditional_prices jsonb`, `currency char(3)`, `evidence_id uuid`, `extractor_version text`. 과거 관찰은 update로 덮어쓰지 않고 append한다. 검색 snapshot의 priceObservedAt은 실제 가격 근거 관찰 시각이다. DB offers의 price_observed_at, product_images의 image_observed_at, offer의 stock_observed_at을 별도로 보존한다.
## 9.4 후보·근거·결과
- `search_candidates`: `id uuid PK`, `search_id uuid`, `product_id uuid nullable`, `canonical_url_hash text`, `discovery_query_ids uuid[]`, `discovery_sources text[]`, `metadata_status text`, `image_status text`, `price_status text`, `source_policy_status text`, `visual_similarity numeric(6,5) nullable`, `attribute_similarity numeric(6,5) nullable`, `visual_coverage numeric(6,5) nullable`, `attribute_coverage numeric(6,5) nullable`, `total_similarity numeric(6,5) nullable`, `gate_status text`, `reject_reasons text[]`, `created_at`, UNIQUE(search_id,canonical_url_hash). score는 0..1 또는 null. 미평가를 0으로 치환하지 않는다.
- `field_evidence`: `id uuid PK`, `search_id uuid`, `candidate_id uuid nullable`, `product_id uuid nullable`, `offer_id uuid nullable`, `variant_id uuid nullable`, `field_path text NOT NULL`, `value_json jsonb`, `source_url text`, `source_kind text CHECK(MERCHANT_PAGE,MERCHANT_METADATA,MERCHANT_IMAGE,SEARCH_RESULT,COMMUNITY_POST,MODEL_INFERENCE)`, `extraction_method text`, `evidence_excerpt text nullable`, `content_sha256 text nullable`, `observed_at timestamptz`, `confidence text CHECK(VERIFIED,PROBABLE,UNKNOWN)`, `extractor_version text`.
- provenance는 필드 단위다. 예를 들어 `/itemPrice`는 JSON-LD Offer, `/shippingFee`는 배송 안내, `/variant/color`는 선택 옵션, `/imageUrl`은 merchant metadata에 각각 연결한다. `MODEL_INFERENCE`는 추정 특징에만 쓰고 가격·배송·재고·정품의 확인 근거로 승격하지 않는다.
- evidence_excerpt는 필요한 짧은 발췌만 저장하고 전체 HTML/게시글을 복제하지 않는다. HTML·문서의 지시문은 데이터로 취급하며 모델/시스템 설정을 변경시키지 않는다. URL은 secret·인증 query를 제거한 안전한 공개 URL이어야 한다.
- `search_results`: `id uuid PK`, `search_id uuid`, `mode text CHECK(IMAGE_SIMILAR,DEAL_TEXT)`, `product_id uuid`, `offer_id uuid nullable`, `kind text CHECK(RECOMMENDATION,REFERENCE)`, `price_basis text NOT NULL CHECK(TOTAL_PRICE,ITEM_PRICE_ONLY,UNKNOWN)`, `cohort_rank smallint nullable`, `final_score numeric(6,5) nullable`, `deal_relevance numeric(6,5) nullable`, `snapshot jsonb NOT NULL`, `created_at`. UNIQUE(search_id,offer_id) (offer_id가 있을 때), UNIQUE(search_id,price_basis,cohort_rank) (RECOMMENDATION일 때). 기본 RECOMMENDED의 최대 10개 카드만 저장한다. snapshot은 위 DTO 전체와 version manifest·evidence IDs를 보존한다. IMAGE_SIMILAR 추천에는 final_score가 필요하고 DEAL_TEXT에는 final_score=null 및 deal_relevance가 필요하다. reference의 점수·rank는 null이다.
- `search_rank_snapshots`: `search_id uuid PK FK search_runs ON DELETE CASCADE`, `eligible jsonb NOT NULL`, `references_json jsonb NOT NULL`, `sort_orders jsonb NOT NULL`, `versions jsonb NOT NULL`, `created_at timestamptz`. 이미지 mode의 eligible 전체 최대 20개, DEAL_TEXT의 eligible 전체 최대 30개를 resultLimit 이전에 저장하고 references 최대 5개를 분리한다. SQL 공통 상한은 30이며 서버의 parent mode 검증으로 IMAGE_SIMILAR의 20개 상한을 추가 강제한다. sort_orders는 지원 sort별 전체 offerId 순서다. terminal 전환과 함께 한번 확정하며 이후 immutable이다. RLS를 활성화하고 client role의 모든 직접 권한을 제거한다. API에서 parent run의 owner=검증된 JWT sub를 검사한 뒤 선택한 sort와 resultLimit으로 투영한다. service-role의 RLS 우회가 소유권 검사를 대체하지 않는다.
- `provider_runs`: `id uuid PK`, `search_id uuid`, `operation_key text`, `provider text`, `operation text`, `status text`, `attempt smallint`, `latency_ms integer`, `request_units jsonb`, `cost_microusd bigint nullable`, `error_code text nullable`, `created_at`, UNIQUE(search_id,operation_key,attempt). raw request/response/prompt/binary/사용자 파일명·full URL query는 기록하지 않는다.
- `cleanup_tasks`: `id bigint identity PK`, `owner_id uuid`, `search_id uuid nullable`, `object_key text nullable`, `reason text`, `state text`, `attempt integer`, `available_at`, `created_at`, `completed_at nullable`. search_id에는 cascade FK를 두지 않아 run 삭제 후 object cleanup이 살아남게 한다. 성공 후 object_key/owner 연결은 제거하고 최소 운영 집계만 남긴다.
# 10. SQL: 최초 구현에 포함할 제약·인덱스·RLS
다음 SQL은 핵심 run/result/lease 구조를 실제 실행 가능한 형태로 보인 최소 migration 예시다. 전체 테이블 DDL은 9장의 필드 규약을 동일하게 적용한다. 기존 v2가 있다면 백필→검증→NOT NULL 적용 순서로 별도 migration을 작성하고 nullable owner를 계속 허용하지 않는다.
```sql
create table public.search_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('IMAGE_SIMILAR','DEAL_TEXT')),
  schema_version smallint not null default 3 check (schema_version = 3),
  input_digest text not null,
  input_descriptor jsonb not null,
  status text not null default 'QUEUED'
    check (status in ('QUEUED','RUNNING','COMPLETED','PARTIAL',
      'NO_RELIABLE_MATCH','FAILED','CANCELED','EXPIRED')),
  stage text check (stage in ('VALIDATING','ANALYZING','DISCOVERING',
      'EXTRACTING','COMPARING','RANKING')),
  result_limit smallint not null default 10 check (result_limit between 1 and 10),
  target_attributes jsonb not null default '{}'::jsonb,
  versions jsonb not null,
  failure jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  deadline_at timestamptz not null,
  completed_at timestamptz,
  expires_at timestamptz not null,
  cancel_requested_at timestamptz,
  deleted_at timestamptz,
  check (deadline_at > created_at),
  check (deadline_at <= created_at + interval '90 seconds'),
  check (expires_at <= created_at + interval '7 days')
);
create index search_runs_owner_history_idx
  on public.search_runs(owner_id, created_at desc, id desc)
  where deleted_at is null;
create index search_runs_deadline_idx
  on public.search_runs(deadline_at)
  where status in ('QUEUED','RUNNING');
create index search_runs_expiry_idx on public.search_runs(expires_at);

create table public.search_jobs (
  id bigint generated always as identity primary key,
  search_id uuid not null references public.search_runs(id) on delete cascade,
  operation_key text not null,
  stage text not null check (stage in ('VALIDATING','ANALYZING','DISCOVERING',
      'EXTRACTING','COMPARING','RANKING')),
  state text not null default 'READY'
    check (state in ('READY','LEASED','DONE','FAILED','CANCELED')),
  checkpoint jsonb not null default '{}'::jsonb,
  attempt integer not null default 0 check (attempt >= 0),
  max_attempts smallint not null default 2 check (max_attempts between 1 and 3),
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(search_id, operation_key)
);
create index search_jobs_ready_idx
  on public.search_jobs(available_at, id) where state = 'READY';
create index search_jobs_lease_idx
  on public.search_jobs(lease_expires_at, id) where state = 'LEASED';

create table public.search_results (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.search_runs(id) on delete cascade,
  product_id uuid not null,
  offer_id uuid,
  mode text not null check (mode in ('IMAGE_SIMILAR','DEAL_TEXT')),
  kind text not null check (kind in ('RECOMMENDATION','REFERENCE')),
  price_basis text not null check (price_basis in ('TOTAL_PRICE','ITEM_PRICE_ONLY','UNKNOWN')),
  cohort_rank smallint check (cohort_rank between 1 and 10),
  final_score numeric(6,5) check (final_score between 0 and 1),
  deal_relevance numeric(6,5) check (deal_relevance between 0 and 1),
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  check ((kind = 'REFERENCE' and price_basis = 'UNKNOWN' and cohort_rank is null
           and final_score is null and deal_relevance is null)
      or (kind = 'RECOMMENDATION' and offer_id is not null and price_basis in ('TOTAL_PRICE','ITEM_PRICE_ONLY')
           and cohort_rank is not null)),
  check (kind <> 'RECOMMENDATION'
      or (mode = 'IMAGE_SIMILAR' and final_score is not null and deal_relevance is null)
      or (mode = 'DEAL_TEXT' and final_score is null and deal_relevance is not null))
);
create table public.search_rank_snapshots (
  search_id uuid primary key references public.search_runs(id) on delete cascade,
  eligible jsonb not null check (jsonb_typeof(eligible) = 'array'),
  references_json jsonb not null check (jsonb_typeof(references_json) = 'array'),
  sort_orders jsonb not null,
  versions jsonb not null,
  created_at timestamptz not null default now(),
  check (jsonb_array_length(eligible) <= 30),
  check (jsonb_array_length(references_json) <= 5)
);
alter table public.search_rank_snapshots enable row level security;
revoke all on public.search_rank_snapshots from anon, authenticated;

create unique index search_results_offer_idx
  on public.search_results(search_id, offer_id) where offer_id is not null;
create unique index search_results_rank_idx
  on public.search_results(search_id, price_basis, cohort_rank)
  where kind = 'RECOMMENDATION';

alter table public.search_runs enable row level security;
alter table public.search_results enable row level security;
alter table public.search_jobs enable row level security;
revoke all on public.search_runs, public.search_results, public.search_jobs
  from anon, authenticated;
grant select on public.search_runs, public.search_results to authenticated;
create policy own_live_runs on public.search_runs for select to authenticated
  using (owner_id = (select auth.uid()) and deleted_at is null and expires_at > now());
create policy own_live_results on public.search_results for select to authenticated
  using (exists (
    select 1 from public.search_runs r
    where r.id = search_results.search_id
      and r.owner_id = (select auth.uid())
      and r.deleted_at is null and r.expires_at > now()
  ));
```
- 익명 로그인 사용자는 JWT role이 authenticated여도 `auth.uid()`로 자기 데이터만 보게 된다. Supabase의 공개 anon key 자체는 사용자 인증이 아니다.
- insert/update/delete policy를 client에 만들지 않는다. API가 JWT owner를 검증한 뒤 제한된 server transaction을 실행한다. service-role은 RLS를 우회하므로 API의 owner 조건과 worker의 내부 인증을 별도로 검증해야 한다.
- jobs/provider_runs/budget_reservations/cleanup_tasks/field_evidence는 client 직접 SELECT를 허용하지 않는다. 필요한 안전한 근거만 API DTO로 투영한다. upload 테이블 및 나머지 사용자 데이터도 RLS를 켜고 명시적인 owner 경로를 적용한다.
- 임시 Storage bucket은 public=false. `storage.objects`에 anonymous/authenticated 광범위 read/write policy를 만들지 않는다. 업로드·모델 전달·cleanup은 서버만 수행하며 매우 짧은 signed URL이 필요하면 owner·run·deadline을 재검증하고 로그에서 URL을 마스킹한다.
worker claim의 최소 SQL 예시. worker만 접근할 수 있는 server RPC에서 실행하며 PUBLIC/anon/authenticated execute 권한을 반드시 제거한다.
```sql
create or replace function public.claim_search_job()
returns setof public.search_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with pick as (
    select j.id
    from public.search_jobs j
    join public.search_runs r on r.id = j.search_id
    where (j.state = 'READY' or
           (j.state = 'LEASED' and j.lease_expires_at < now()))
      and j.available_at <= now()
      and j.attempt < j.max_attempts
      and r.status in ('QUEUED','RUNNING')
      and r.deleted_at is null
      and r.deadline_at > now()
    order by j.available_at, j.id
    for update of j skip locked
    limit 1
  )
  update public.search_jobs j
    set state = 'LEASED',
        attempt = j.attempt + 1,
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + interval '20 seconds',
        updated_at = now()
    from pick
    where j.id = pick.id
    returning j.*;
end;
$$;
revoke all on function public.claim_search_job() from public, anon, authenticated;
grant execute on function public.claim_search_job() to service_role;
```
- claim은 작업 독점만 보장한다. worker 시작 시 run을 다시 lock·검사하여 RUNNING으로 바꾸고, COMMIT 직전 token·attempt·run 활성 조건을 다시 확인한다. claim과 cancel/delete가 경합해도 종료 run에 결과를 쓰지 못해야 한다.
- worker 결과/다음 job 삽입/현재 job DONE/step 비용 정산은 한 트랜잭션으로 commit한다. lease가 바뀌면 전체 rollback. final snapshot과 terminal run 전환도 원자적이다.
- run별 다음 단계 job은 이전 단계가 DONE일 때만 만든다. 단계 내 여러 후보 작업은 별도 operation_key를 사용한다. RANKING은 예정 후보가 완료/명시적 실패/중단 처리된 뒤 한번 실행한다.
- product/offer/variant/evidence에는 동일 search_id 관계를 검증하는 composite FK 또는 server transaction 검사까지 넣어 타 검색의 offer를 현재 결과에 연결할 수 없게 한다.
- offers CHECK: item_price가 null이면 price_basis=UNKNOWN 및 effective_price=null; item_price가 확인되고 shipping_fee가 null인 경우만 ITEM_PRICE_ONLY 및 effective_price=null; item_price와 shipping_fee가 모두 확인되면 TOTAL_PRICE 및 effective_price=item_price+shipping_fee. 통화 변환과 지역별 임의 배송비 추정은 하지 않는다.
- offers의 세 가지 가격 제약 분기는 다음과 같이 서로 배타적이어야 한다: `(item_price IS NULL AND price_basis='UNKNOWN' AND effective_price IS NULL)` 또는 `(item_price IS NOT NULL AND shipping_fee IS NULL AND price_basis='ITEM_PRICE_ONLY' AND effective_price IS NULL)` 또는 `(item_price IS NOT NULL AND shipping_fee IS NOT NULL AND price_basis='TOTAL_PRICE' AND effective_price=item_price+shipping_fee)`.
- 인덱스 추가: 모든 하위 테이블의 search_id, evidence의 `(search_id,field_path)`, price_observations의 `(offer_id,observed_at desc)`, upload의 `(expires_at)` 및 `(owner_id,created_at desc)`, cleanup의 `(state,available_at)`, idempotency의 `(expires_at)`.
# 11. 보존·보안·완료 기준
- 초기 cache TTL은 발견 URL 1시간, 정적 metadata 15분, 가격/재고 5분이며 같은 owner/run 안에서만 재사용한다. 캐시 읽기 시각으로 관찰 시각을 갱신하지 않는다. 새 추천 계산 전에 5분 지난 가격은 재확인하고 실패하면 UNKNOWN/reference로 처리한다. 완료 snapshot 재조회·sort 변경은 당시 priceObservedAt과 함께 과거 관찰값으로 표시하며 재확인·점수 재계산을 하지 않는다.
- 결과·분석·query·필드 근거·후보·검색 로그 snapshot은 **run 생성 후 7일** 보존하고 삭제한다. 이력 보존을 무기한 저장 기능으로 확대하지 않는다. 저장 기능 도입은 별도 동의·보존 계약이 필요하다.
- 종료 후 정규화 이미지 5분 이내 삭제, 어떤 경우든 생성 후 최대 1시간. cleanup 정기 스캔·작업 재시도·orphan object sweep을 운영 필수로 둔다. 조회 시 TTL 조건을 검사해 cleanup 지연 중에도 만료 데이터를 노출하지 않는다.
- 인증·RLS·보존을 후속 버전으로 미루지 않는다. 두 익명 사용자를 만들어 search/upload/result/delete를 교차 호출하는 부정 접근 테스트를 수행한다.
- HTTP fetch는 https 공개 목적지만 허용. DNS resolve 후 private/loopback/link-local 차단, redirect마다 재검사, 응답 byte/time 제한, MIME 검사, userinfo URL 금지. 모델이 만든 URL도 검증 없이 fetch하지 않는다.
- 외부 페이지의 HTML·텍스트는 추출 대상 데이터다. 거기에 적힌 지시문으로 도구·프롬프트·secret·네트워크 정책을 바꾸지 않는다.
- 입력 경계 fixture: 실제 binary 길이 10,000,000 bytes는 크기 검사 통과, 10,000,001 bytes는 413; 정상 인코딩 6000×4000=24,000,000 pixels는 dimension 검사 통과, 6001×4000=24,004,000 pixels는 413. 한도 내 fixture도 손상·다중 프레임·메모리·CPU 검사는 별도로 통과해야 하며, 긴 변 출력은 1600px 이하인지 확인한다. 24MP 최대 입력의 WASM CPU/peak memory 실측을 릴리스 증거로 저장한다.
- 필수 contract test: create 응답 유실 후 동일 key 재시도, 다른 입력 key 충돌, double click race, lease 중 worker crash, deadline 직전 retry, cancel/delete와 final write race, 사용 불가 옵션의 최저가, 배송비 unknown 코호트, 가격 null references, RLS 교차 사용자, raw 이미지 로그 미포함, 7일/1시간/5분 cleanup.
- 프론트 통합 검수는 API 완료와 별도로 기존 목업의 정확한 화면 기준을 통과해야 한다. 실서비스에 필요한 상태는 기존 component/모션 언어로 구현하고 기술 편의상 목업을 바꾸지 않는다.
</content>
</page>
