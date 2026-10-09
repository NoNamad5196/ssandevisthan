# OpenAI 비용 상한 검증 — 동일 모델의 순차 예약

검토일: 2026-10-09. 문서 조회와 합성 테스트만 수행했으며 이 검토에서 OpenAI API를 호출하지 않았다. 현재 모델은 `gpt-6.1-sol`이며 모델을 변경하지 않았다.

## 발견한 문제와 구현

기존 `maxInputTokens` 설정은 비용 예약 계산과 응답 후 검증에만 쓰였다. 이 숫자를 실제 요청의 입력 토큰 상한으로 보장하는 수단은 없었다. 응답 후 초과를 발견하면 이미 발생한 비용을 되돌릴 수 없다.

현재 provider는 **자동 서버 검증기가 정확한 요청 본문에서 유도한 전체 과금 입력 상한을 검증하지 못하면 예약과 HTTP 호출 전에 거절**한다. 검증 결과는 전송할 본문의 SHA-256과 `gpt-6.1-sol-stateless-context-v1-2026-10-09` 버전에 결합된다. 설정 숫자·`rates_verified_at`·운영자가 적은 hash 목록을 입력 상한 증명으로 인정하지 않는다. 사용자에게 매 검색 승인을 요구하는 흐름도 만들지 않았다.

`service_tier: default`, `truncation: disabled`, 출력·도구 호출 상한을 명시한다. 가격 계산은 BigInt 정수 연산과 올림을 사용한다. 입력의 cache read/write를 분리하고, 긴 문맥의 입력·출력 할증을 예약과 정산에 반영한다. 사용량 세부 항목이 없거나 모델/서비스 tier/도구가 예상과 다르면 0원으로 처리하지 않고 미정산 예약을 유지한다. 이는 실제 계정 요율·과거 지출·사용 가능 모델 검증을 대체하지 않는다.

## 공식 문서에서 확인한 범위

- Responses의 `max_output_tokens`와 `max_tool_calls`는 각각 생성 토큰과 내장 도구 호출 수를 제한한다. 확인한 스키마에는 별도의 요청 `max_input_tokens` 필드가 없었다. `truncation: disabled`는 모델 문맥 크기를 넘는 요청을 거절한다. [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
- `search_context_size: low`는 정확한 토큰 수를 보장하지 않는다. 검색 문맥 한도 128K는 문서화됐지만, 검색 실행 전체의 누적 과금 입력 상한과 동일하다고 확인하지 못했다. `return_token_budget`의 `default`도 이 검토에서 숫자 상한으로 증명하지 못했다. [Web search](https://developers.openai.com/api/docs/guides/tools-web-search)
- `/v1/responses/input_tokens`는 제공한 입력의 이미지·도구·구조 토큰을 계산한다. 아직 수행하지 않은 검색의 미래 결과를 사전 계산한다는 근거는 없고, 조회한 문서에서 이 endpoint 자체의 무료 여부도 확인하지 못했다. 따라서 호출하지 않았다. [Token counting](https://developers.openai.com/api/docs/guides/token-counting)
- GPT-6.1 Sol의 문맥은 1,050,000, 최대 출력은 128,000이다. Standard global 요율은 입력 $2/MTok, cache read $0.10, cache write $2.50, 출력 $10이다. 입력 272K 초과 요청은 입력/cache 요율 2배, 출력 1.5배다. [모델 및 요율](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
- 조회한 이미지 토큰 규칙 표에는 GPT-6.1 Sol의 명시적 sizing/multiplier가 없었다. 다른 모델의 이미지당 3,000 토큰 계산을 이 모델의 검증된 상한으로 차용하지 않았다. [Images and vision](https://developers.openai.com/api/docs/guides/images-vision)

## 제한된 요청에서 상한 유도

표준 단일 모델 실행의 도구 루프는 최초 모델 추론, 도구 실행, 도구 결과를 포함한 다음 추론으로 진행된다. 실행 가능한 내장 도구가 K회이면 최초 추론을 포함한 입력 패스는 최대 1+K개다. 이미지·프롬프트·도구 정의 및 결과는 매 패스의 모델 문맥 C 안에 들어가야 한다. 따라서 여기서는 **전체 과금 입력을 C×(1+K)로 보수적으로 유도**한다. 이는 공식 제한들을 조합한 공학적 상한이며 공급자가 특정 달러 상한을 별도로 보증했다는 뜻은 아니다. [도구 실행 흐름](https://developers.openai.com/api/docs/guides/function-calling), [이미지와 문맥 제한](https://developers.openai.com/api/docs/guides/images-vision)

| 작업 | 허용 내장 도구 K | 예약 입력 상한 |
|---|---:|---:|
| 사진 분석 | 0 | 1,050,000 |
| 상품 URL 발견 | 1 | 2,100,000 |
| 사진 유사도 비교 | 0 | 1,050,000 |

자동 검증기는 현재 요청 형태만 허용한다. 단일 사용자 입력, 모델 ID, `reasoning: {effort: low}`, Standard global 처리, 정확한 JSON schema, 사진 수, 최대 출력, 도구 수 및 `parallel_tool_calls: false`를 확인한다. 상태 이어받기·`previous_response_id`·conversation·이전 tool output·prompt template·추가 메시지·custom/MCP 도구·background·stream·Pro·multi-agent·compaction·알 수 없는 추가 필드는 거절한다. 요청 본문이 서버 모델/출력/도구 제한을 덮어쓸 수도 없다.

이 제한은 상한 유도의 반례를 제거한다. 특히 compaction은 문맥을 줄이며 추론을 계속할 수 있고, multi-agent는 내부적으로 compaction을 활성화하며 `max_tool_calls`를 지원하지 않는다. 따라서 이 기능들을 추가할 때 기존 비용 프로필을 재사용할 수 없다. 도구 한도를 넘긴 호출은 처리되지 않는다는 API 계약을 전제로 한다. 모델이 제한을 벗어난 사용량·도구·tier를 반환하면 정상 정산으로 간주하지 않는다. [Compaction](https://developers.openai.com/api/docs/guides/compaction), [Multi-agent 제한](https://developers.openai.com/api/docs/guides/responses-multi-agent)

표준 요율과 출력 상한 1,024를 사용한 예약 예시는 사진 단계 $5.26536, 발견 단계 $10.52536이다. 실제 과금액 예측이 아니라 최악 예약액이며, 실제 계정 요율·출력 설정을 사용해 다시 계산한다. 작은 이미지별 추정값이나 `low` 검색 힌트를 입력 상한으로 사용하지 않는다.

## 누적 $20 안에서 순차 진행

14회는 허용 요청 수의 최대치이며, 14회의 최악 비용을 동시에 예약하거나 모든 요청의 완수를 보장하라는 요구는 아니다. 검색은 누적 잔액 이하의 SEARCH 예약을 유지한다. 각 호출 전에 하위 최악 비용을 예약하고, 다음 checkpoint를 commit할 때 실제 확인한 비용으로 정산한다. 다음 요청은 `정산된 실제 비용 + 미정산 예약 + 새 최악 예약 <= SEARCH 예약`인 경우에만 시작한다. 발견은 checkpoint당 1회로 실행해야 $10.5 수준의 두 예약이 겹치지 않는다.

SEARCH 예약을 전역 잔액에서 다시 차감하거나, 아직 불명확한 호출을 환불하는 방식이 아니다. SEARCH 내부에서 확인된 미사용 하위 예약만 다음 작업에 쓸 수 있다. 접수 예약도 고정 $20 대신 검증된 검색 한도와 실제 남은 전역 잔액 중 작은 값이어야 한다. 최소 1회 작업의 보수적 예약조차 부족하면 접수를 거절한다. 진행 중 잔액·시간·요청 수 한도에 도달하면 확인된 결과만 PARTIAL로 반환하거나, 결과가 없으면 명확한 실패를 반환한다.

따라서 모든 발견 호출의 최악 비용을 더한 $42를 이유로 동일 모델의 구현 자체가 불가능하다고 결론내릴 필요는 없다. 실제 정산액이 작으면 같은 예약 안에서 순차 실행이 가능하다. 반대로 $20 안에 모든 검색이나 10회 LIVE 검증이 반드시 성공한다고 약속할 수는 없다. **과거 누적 지출·미정산액·실제 계정 모델/요율 확인은 여전히 유료 실행의 선행 조건**이다. 이 문서 검토에서 유료 실행을 활성화하지 않았다.

## 사용자 검토용 호환 대안 — 적용하지 않음

동일 모델의 순차 예약 경로를 우선한다. 별도 대안으로 상품 URL을 발견하는 단계만 `gpt-4.1-mini`의 non-preview `web_search`로 바꾸고, 사진 분석·유사도 비교는 GPT-6.1 Sol로 유지할 수 있다. 공식 가격표는 GPT-4.1 mini/GPT-4o mini의 non-preview 검색 내용에 호출당 **8,000 입력 토큰 고정 과금**을 명시한다. 검색 호출료는 $0.01이다. [검색 요율](https://developers.openai.com/api/docs/pricing)

| 후보 | 입력 / 출력 ($/MTok) | 계산 예시: 검색 내용 8K + 그 외 전체 과금 입력 2K + 출력 1K + 검색 1회 |
|---|---:|---:|
| GPT-4.1 mini | $0.40 / $1.60 | $0.0156/요청, 8요청 $0.1248 |
| GPT-4o mini | $0.15 / $0.60 | $0.0121/요청, 8요청 $0.0968 |

모델별 입력/출력 요율 출처: [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini), [GPT-4o mini](https://developers.openai.com/api/docs/models/gpt-4o-mini). 표의 나머지 입력 2K/출력 1K는 비교를 위한 예시이며, 실제 요청의 증명된 상한이나 전체 검색 가격이 아니다. 새 검색 adapter의 자동 입력 계산·실제 계정 모델 지원·실제 usage 구조를 먼저 검증해야 한다.

이 대안은 URL 발견 품질과 후보 회수율을 바꿀 수 있으므로 현재 v3 모델 계약에 대한 사용자 승인이 필요하다. 변경 범위는 발견 모델이며, 판매처의 실제 이미지·옵션·가격 검증과 Similarity Gate를 완화하는 방안이 아니다. 승인 요청은 “상품 링크를 찾는 모델만 GPT-4.1 mini로 변경하고 사진 판단은 GPT-6.1 Sol로 유지하는 호환안을 검증해도 되는가”처럼 구체적으로 제시할 수 있다. 승인 자체가 유료 실행 허가 조건의 검증 완료를 뜻하지 않는다.
