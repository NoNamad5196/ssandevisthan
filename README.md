# SSANDEVISTHAN · 싼데비슷한

의류 사진에서 특징을 분석하고, 검증한 국내 새상품을 Similarity Gate로 거른 뒤 가격을 비교하는 서비스입니다.

- 프론트엔드: https://ssandevisthan.pages.dev/
- 저장소: https://github.com/NoNamad5196/ssandevisthan (비공개)
- 구현 계약: `docs/contracts/`에 보존한 현재 Notion v3 문서 7개
- 디자인 원본: `design/reference/original.png` (1586×992)

현재 공개 프론트엔드는 사진 선택·검증·미리보기·교체·삭제, 핫딜 입력, 반응형 화면을 제공합니다. 실제 검색 API 연결과 LIVE 검증은 진행 중입니다. 테스트 fixture를 실제 상품 검색 성공으로 표시하지 않습니다.

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
```

`apps/web/.env.example`을 참고하여 공개 API origin을 설정합니다. `VITE_` 변수에는 공개 주소만 넣습니다. OpenAI 키·DB URL·JWT 서명키·배포 토큰은 서버 비밀 설정에만 저장합니다. 로컬 비밀은 Git에서 제외된 `.secrets/` 안에서만 취급합니다.

## 구조

- `apps/web`: React + Vite + TypeScript, 실제 업로드와 검색 상태·결과 UI
- `apps/api`: Neon Node.js Functions 어댑터, 익명 인증, PostgreSQL·비공개 Object Storage
- `packages/contracts`: 엄격한 v3 DTO·enum·Zod 검증·OpenAPI
- `packages/search-core`: 근거 검사, Similarity Gate, 가격 코호트·결정적 정렬
- `supabase/shared`: 공통 검색 파이프라인, OpenAI, 안전한 외부 요청, 상품 추출
- `supabase/migrations`: 계약에 따른 PostgreSQL 스키마·트랜잭션·RLS
- `deploy/neon`: 사용자 요청에 따라 선택한 대체 무료 백엔드 배포
- `.github/workflows`: 검증을 통과한 main commit의 프론트엔드 자동 배포

Supabase 무료 프로젝트 한도를 확인한 뒤 사용자가 다른 백엔드를 요청했습니다. 기존 프로젝트를 중지·삭제하지 않고 Neon Free를 선택했습니다. DB·API·검색 계약을 유지하고 인증·저장소·실행 환경을 어댑터로 교체합니다. 기존 Supabase 구현은 별도 검증 가능한 경로로 남아 있습니다.

## 원본 디자인과 글꼴

로고·콜라주·특징적인 메인 타이포그래피는 원본 PNG의 픽셀을 보존합니다. 버튼·입력·상태는 실제 HTML 요소입니다. 기능성 UI는 공식 Pretendard와 Gmarket Sans 배포본을 사용합니다. 라이선스와 출처·해시는 `design/font-license/` 및 `design/asset-manifest.json`에서 확인할 수 있습니다. 원본을 재생성하거나 새 로고로 교체하지 않습니다.

## 운영 원칙

OpenAI 외 유료 인프라는 활성화하지 않습니다. 전체 파일럿의 OpenAI 누적 한도는 **USD 20**이며 기간별로 초기화하지 않습니다. 과거 사용액과 현재 요율·호출 상한이 확인되기 전에는 유료 실행을 차단합니다. 가격·이미지·옵션·국내 새상품 근거가 없는 후보는 구매 추천으로 승격하지 않습니다. 판매처 접근 차단이나 CAPTCHA를 우회하지 않습니다.

공개 배포가 존재한다는 사실과 실사용 릴리스 검증 완료는 별개입니다. 미완료 운영·보안·품질·비용 검증은 검증 보고서에 남기고 완료로 표시하지 않습니다.
