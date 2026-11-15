# 구조 (Architecture)

HelpMyDoc은 **"AI가 지금 사용자가 보고 있는 페이지를 안다"** 는 한 가지 아이디어에 집중한 PDF 리더입니다.
새 기능을 얹을 때 이 문서의 확장 지점을 따르면 기존 코드를 크게 건드리지 않아도 됩니다.

## 한눈에 보기

```
┌──────────────────────── 브라우저 (React) ────────────────────────┐
│  PdfViewer ──현재 페이지·선택 텍스트──▶ App 상태                     │
│      │                                      │                        │
│  pdf.ts (페이지 텍스트 추출·캐시)              ▼                        │
│      └──────────────▶ context.ts ──▶ ChatPanel ──▶ Provider.stream() │
└───────────────────────────────────────────────┬──────────────────────┘
                                                │
              ┌─────────────────────────────────┴───────────────┐
              ▼                                                 ▼
     api provider                                 claude-code provider
     (브라우저 → api.anthropic.com)                (브라우저 → 로컬 브리지 → `claude -p`)
```

## 질문 한 번의 흐름

1. `PdfViewer`가 스크롤 위치로 **현재 페이지**를 계산해 `App`에 알린다. (화면 세로 중앙에 걸린 쪽)
2. 사용자가 질문을 보내면 `ChatPanel`이 `context.buildPrompt()`로 `현재 페이지 ±N쪽`의 텍스트 + 선택 텍스트 + 질문을 하나의 프롬프트로 만든다.
3. 선택된 `Provider`의 `stream()`이 AI를 호출하고, 글자가 도착할 때마다 `onText`로 화면을 갱신한다.
4. **문서 문맥은 이번 턴에만 붙인다.** 이전 턴은 질문 원문과 답변만 history로 보낸다 → 대화가 길어져도 토큰이 문서 문맥만큼 불어나지 않는다.

## 모듈 지도

| 경로                           | 책임                                                           | pdf.js 의존 | 테스트 |
| ------------------------------ | -------------------------------------------------------------- | :---------: | :----: |
| `src/lib/pdf.ts`               | pdf.js 로딩(한글 cMap 포함), 페이지 텍스트 추출·캐시           |      ✔      |   –    |
| `src/lib/context.ts`           | 현재 페이지 주변 텍스트 → 프롬프트 조립 (주입된 함수만 사용)   |      ✘      |   ✔    |
| `src/lib/anthropicApi.ts`      | Anthropic Messages API 스트리밍, 시스템 프롬프트               |      ✘      |   ✔    |
| `src/lib/bridgeClient.ts`      | 로컬 브리지 상태 확인·스트리밍 클라이언트                      |      ✘      |   ✔    |
| `src/lib/providers/`           | `Provider` 인터페이스, 레지스트리, 구현체                      |      ✘      |   ✔    |
| `src/lib/settings.ts`          | 설정 저장(localStorage), 모델 목록                             |      ✘      |   ✔    |
| `src/components/PdfViewer.tsx` | 가상 렌더링(보이는 쪽만 그림), 현재 페이지 감지, 텍스트 레이어 |      ✔      |   –    |
| `src/components/ChatPanel.tsx` | 채팅 UI, 중지/오류 처리                                        |      ✘      |   –    |
| `server/bridge.mjs`            | `claude -p` 실행 브리지 (127.0.0.1 전용)                       |      ✘      |   ✔    |
| `bin/helpmydoc.mjs`            | `dist/` + 브리지를 함께 서비스하는 CLI (`npm start`)           |      ✘      |   –    |

## 확장 지점

### 새 AI 연결 방식 추가 (GPT, Gemini, Ollama …)

1. `src/lib/providers/<name>.ts`에 `Provider`를 구현한다. (`describe`, `unavailableReason`, `stream`)
2. `src/lib/providers/index.ts`의 `PROVIDERS`에 등록하고, `src/lib/settings.ts`의 `ProviderId`에 id를 추가한다.
3. `SettingsDialog`에 해당 방식의 입력란을 추가한다.
4. `providers.test.ts`에 사용 가능 조건 테스트를 추가한다.

`stream()`은 `history`(이전 턴)와 `prompt`(이번 턴 문맥+질문)를 받는다. 서버가 대화를 기억하지 않는 방식이면 `claudeCode.ts`의 `toTranscript`처럼 history를 텍스트로 이어 붙인다.

### AI에게 보여줄 문맥을 늘리기 (스캔본 이미지, 목차, 전체 색인 …)

지금 `buildPrompt()`는 텍스트만 만든다. 이미지·검색 결과 같은 새 문맥은 `context.ts`에서 "문맥 조각"으로 추가하고, Provider가 이를 받을 수 있게 `ProviderRequest`를 확장한다. (예: `prompt: string` → 텍스트와 이미지 파트의 배열)

### 다른 문서 포맷

`PdfViewer` + `pdf.ts`가 "페이지 단위 렌더링 + 페이지 텍스트 + 현재 페이지 콜백"을 제공하는 부분이다. 같은 세 가지를 제공하면 다른 포맷의 뷰어로 바꿀 수 있다. `context.ts`는 이미 `numPages`와 `getPageText(page)`만 요구한다.

## 설계 결정과 이유

- **서버 없음 (BYOK)**: 문서와 API 키가 개발자 서버를 거치지 않는다. 운영 비용·개인정보 부담이 없고 오픈소스로 배포하기 쉽다.
- **보이는 쪽만 렌더링**: 500쪽 문서도 DOM·메모리가 일정하다. 현재 페이지는 이분 탐색으로 계산해 스크롤 중에도 가볍다.
- **현재 페이지 ±N쪽만 전송**: 비용과 정확도의 균형. 범위는 설정에서 바꿀 수 있다.
- **Claude Code 연결은 로컬 브리지로**: 브라우저는 프로세스를 실행할 수 없다. 구독 로그인은 Claude Code가 직접 처리하고, 앱은 토큰을 보지 않는다. (아래 제약 참고)
- **브리지는 순수 채팅으로만 실행**: 내장 도구 비활성화(`--tools ""`), MCP·슬래시 명령·프로젝트 설정 비활성화, 세션 저장 안 함, 빈 임시 폴더에서 실행.

## 지켜야 할 제약

Anthropic 약관([Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance), [Usage Policy](https://www.anthropic.com/legal/aup))상 아래를 어기는 변경은 받지 않는다.

1. 구독 로그인 토큰·세션을 **읽거나 저장하거나 중계하지 않는다.**
2. Claude Code 바이너리를 **수정하거나, 인증 방식을 끄거나, 다른 클라이언트인 척하지 않는다.**
3. 브리지는 **`127.0.0.1`에서만** 열고 Host/Origin 검사를 유지한다. 서버로 호스팅해 여러 사람이 쓰게 하는 구성은 만들지 않는다.
