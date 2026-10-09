# SSANDEVISTHAN · 싼데비슷한

의류 사진에서 특징을 분석하고, 검증한 국내 새상품을 Similarity Gate로 거른 뒤 가격을 비교하는 서비스입니다.

- 프론트엔드: https://ssandevisthan.pages.dev/
- 저장소: https://github.com/NoNamad5196/ssandevisthan (비공개)
- 구현 계약: `docs/contracts/`에 보존한 현재 Notion v3 문서 7개
- 디자인 원본: `design/reference/original.png` (1586×992)

공개 프론트엔드와 Neon 백엔드가 연결되어 있습니다. 공개 HTTPS 브라우저에서 실제 익명 인증, 사진 업로드·정규화·확정·삭제를 검증했습니다. **AI 상품 검색은 아직 출시 전입니다.** 현재 과거 OpenAI 누적 비용이 미확인이라 유료 검색을 차단하고 있습니다. 무료 잔여 한도, 실제 상품 근거와 LIVE 검색, 사람 검수 평가셋도 출시 전 검증이 필요합니다. 테스트 fixture를 실제 상품 검색 성공으로 표시하지 않습니다.

## 실행과 검증

Node.js 24를 사용합니다.

```sh
npm ci
npm run assets
npm run dev
npm run typecheck
npm test
npm run build
npm run test:e2e
node scripts/verify-assets.mjs
node scripts/verify-visual.mjs
node scripts/verify-secrets.mjs
```

`apps/web/.env.example`을 참고하여 공개 API origin을 설정합니다. `VITE_` 변수에는 공개 주소만 넣습니다. OpenAI 키·DB URL·JWT 서명키·배포 토큰은 서버 비밀 설정에만 저장합니다. 로컬 비밀은 Git에서 제외된 `.secrets/` 안에서만 취급합니다.

## 구조

- `apps/web`: React + Vite + TypeScript, 실제 업로드와 검색 상태·결과 UI
- `apps/api`: Neon Node.js Functions 어댑터, 익명 인증, PostgreSQL·비공개 Object Storage
- `packages/contracts`: 엄격한 v3 DTO·enum·Zod 검증·OpenAPI
- `packages/search-core`: 근거 검사, Similarity Gate, 가격 코호트·결정적 정렬
- `packages/quality`: 실제/합성 평가 구분, 사람 라벨·분리 검증, 실패·빈 결과를 포함하는 오프라인 품질 평가
- `supabase/shared`: 공통 검색 파이프라인, OpenAI, 안전한 외부 요청, 상품 추출
- `supabase/migrations`: 계약에 따른 PostgreSQL 스키마·트랜잭션·RLS
- `deploy/neon`: 사용자 요청에 따라 선택한 대체 무료 백엔드 배포
- `.github/workflows`: 검증을 통과한 main commit의 프론트엔드·백엔드 배포

Supabase 무료 프로젝트 한도를 확인한 뒤 사용자가 다른 백엔드를 요청했습니다. 기존 프로젝트를 중지·삭제하지 않고 Neon Free를 선택했습니다. DB·API·검색 계약을 유지하고 인증·저장소·실행 환경을 어댑터로 교체합니다. 기존 Supabase 구현은 별도 검증 가능한 경로로 남아 있습니다.

## 원본 디자인과 글꼴

로고·콜라주·특징적인 메인 타이포그래피는 원본 PNG의 픽셀을 보존합니다. 버튼·입력·상태는 실제 HTML 요소입니다. 기능성 UI는 공식 Pretendard와 Gmarket Sans 배포본을 사용합니다. 라이선스와 출처·해시는 `design/font-license/` 및 `design/asset-manifest.json`에서 확인할 수 있습니다. 원본을 재생성하거나 새 로고로 교체하지 않습니다.

## 운영 원칙

OpenAI 외 유료 인프라는 활성화하지 않습니다. 전체 파일럿의 OpenAI 누적 한도는 **USD 20**이며 기간별로 초기화하지 않습니다. 과거 사용액과 현재 요율·호출 상한이 확인되기 전에는 유료 실행을 차단합니다. 가격·이미지·옵션·국내 새상품 근거가 없는 후보는 구매 추천으로 승격하지 않습니다. 판매처 접근 차단이나 CAPTCHA를 우회하지 않습니다.

공개 배포가 존재한다는 사실과 실사용 릴리스 검증 완료는 별개입니다. 미완료 운영·보안·품질·비용 검증은 검증 보고서에 남기고 완료로 표시하지 않습니다.

## 실제 검증 기록

- `docs/deployment/api-smoke.json`: 실제 클라우드의 익명 사용자 격리·업로드·삭제 17개 검사. OpenAI 호출 0회, 상품 검색 성공 아님.
- `docs/deployment/normalizer-live.json`: 실제 클라우드의 2,400만 화소 입력 메모리·CPU·메타데이터 제거 측정.
- `docs/deployment/egress-live.json`: 실제 공개 HTTPS 연결과 내부망·DNS 변경 차단.
- `docs/deployment/retention-smoke.json`: 실제 스케줄러의 사진 삭제와 만료 데이터 접근 차단.
- `docs/deployment/operations-live.json`: 큐·원장·보존기한 읽기 전용 집계. 과거 지출 미확인 시 가용 예산은 `null`입니다.
- `docs/merchant-verification.md`: 실제 판매처 응답의 성공·실패 근거. 적격 상품이 없으면 그대로 기록합니다.
- `docs/openai-cost-verification.md`: 비용 상한의 근거, 구현 검증, 아직 필요한 계정 확인.
- `docs/deployment-readiness.md`: 배포·글꼴·시각 비교 및 잔여 항목.
- `docs/deployment/quota-audit-2026-10-09.json`: 계정에서 확인한 무료 사용량과 확인할 수 없었던 한도.
- `docs/deployment/recovery-local.json`: 격리된 로컬 PostgreSQL 복구 검사. 클라우드 복구 성공을 뜻하지 않습니다.
- `docs/deployment/quality-not-measured.json`: 실제 평가 데이터 미제공 상태의 품질 보고서. 지표는 `null`, 출시는 차단 상태입니다.
- `docs/deployment/public-82c6ddd.json`, `docs/deployment/backend-82c6ddd.json`: 공개 파일과 검증된 CI 산출물 일치, 프론트엔드·백엔드 배포 성공 및 유료 검색 비활성 상태.
- `docs/deployment/recovery-cloud-rls.json`: 실제 Neon의 별도 테스트 DB에서 합성 복구와 RLS 검증, 임시 역할 롤백 및 DB 정리 증거. 실제 상품 검색·애플리케이션 롤백 증거와 구분합니다.

품질 평가는 `node scripts/evaluate-quality.mjs`로 실행합니다. 입력이 없으면 `NOT_MEASURED`와 출시 차단을 보고하며 종료 코드 1을 반환합니다. 평가 데이터 형식과 사람 검토·holdout 절차는 `packages/quality/README.md`, 배포물 보존과 복구 절차는 `deploy/neon/RECOVERY.md`에 있습니다. 합성 라벨이나 재생 테스트를 실제 사람 평가·LIVE 검색으로 승격하지 않습니다.

운영 집계는 서버 자격 증명을 환경변수 또는 Git에서 제외한 설정으로 준비한 뒤 `node deploy/neon/inspect.mjs`로 확인합니다. 이 명령은 읽기 전용 트랜잭션을 사용하고 사용자 사진·프롬프트·토큰을 출력하지 않습니다. 배포·마이그레이션·스케줄러 절차는 `deploy/neon/README.md`를 따릅니다.

최소 운영 백업은 `node deploy/neon/backup.mjs`의 로컬 dry-run으로 확인합니다. 실제 저장은 별도 `--apply`와 배포된 만료 삭제 검증을 요구하며, 비용 합계·미정산 예약금만 비공개 저장소에 최대 1시간 보관합니다. 사용자 검색·사진·세션은 백업하지 않습니다. 복구 절차와 공동 저장소 장애의 한계는 `deploy/neon/RECOVERY.md`에 있습니다.
