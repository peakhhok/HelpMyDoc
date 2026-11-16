# HelpMyDoc

PDF를 왼쪽에 열고, 오른쪽의 AI(Claude)에게 **페이지 번호를 말하지 않고** 바로 질문하는 문서 리더.

> 300쪽을 보고 있는 상태에서 "여기서 중요한 부분을 요약해줘"라고만 해도, 지금 화면에 보이는 페이지(±1쪽)의 텍스트를 자동으로 Claude에게 함께 보냅니다.

## 특징 (MVP)

- PDF 열기 (파일 선택 / 드래그&드롭), 500쪽 이상도 보이는 쪽만 렌더링
- 현재 보고 있는 페이지 자동 추적 → 질문마다 그 주변 페이지 텍스트를 자동 첨부
- PDF에서 텍스트를 드래그해 선택하면 해당 문장을 함께 전달
- **문서별 기억**: 같은 PDF를 다시 열면 이전 대화와 마지막으로 보던 페이지가 이어집니다. 문서는 파일 이름이 아니라 **내용의 해시**로 구분해서, 이름을 바꿔도 같은 문서로 알아봅니다. (설정에서 끄거나 삭제할 수 있음)
- 답변 속 `(p.120)`을 누르면 그 쪽으로 이동
- **사용량 표시**: 답변마다 쓰인 토큰 수(입력·출력)를 보여주고, Claude Code(구독) 방식에서는 채팅창 머리말에 **5시간 / 7일 한도 사용률**과 초기화까지 남은 시간(마우스를 올리면)을 표시합니다. 70%부터 주황, 90%부터 빨강입니다. 한도 값은 Claude Code가 답변과 함께 알려주는 값이라 첫 질문 뒤부터 채워지고, 마지막 값은 앱을 껐다 켜도 남습니다.
- Claude 스트리밍 응답, Markdown 렌더링, 중지 버튼
- **시작 화면에서 연결 점검**: 처음 실행하면 연결 방식(구독 / API 키)을 고르고, "Claude 구독" 방식이면 **Claude Code 설치 → 로그인** 여부를 단계별로 점검합니다. 빠진 단계는 OS에 맞는 공식 설치 명령과 로그인 명령을 복사 버튼과 함께 보여주고, 터미널에서 마치고 돌아오면 **자동으로 감지**해 다음으로 넘어갑니다. 사용 중에 로그인이 풀리면 화면을 막지 않고 채팅창에 배너로 알립니다.
- **여러 AI를 바꿔 쓰기**: 채팅창 위의 목록에서 한 번에 전환합니다. 로그인·키가 준비된 연결은 `●`로 표시되고, **대화를 하던 도중에 바꿔도 이전 대화가 그대로 이어집니다.** (예: Claude로 묻다가 "방금 답이 맞는지 검토해줘"를 ChatGPT에게)

  | 연결             | 방식                | 비고                                                        |
  | ---------------- | ------------------- | ----------------------------------------------------------- |
  | Claude (구독)    | 내 PC의 Claude Code | 구독 한도 사용, 5시간/7일 사용률 표시                       |
  | ChatGPT (구독)   | 내 PC의 Codex CLI   | **실험 기능, 기본 꺼짐** — 설정에서 위험 안내를 확인하고 켬 |
  | Claude (API 키)  | Anthropic API       | 사용량 과금                                                 |
  | ChatGPT (API 키) | OpenAI API          | 사용량 과금, 모델은 내 키로 목록을 불러와 선택              |
  | Gemini (API 키)  | Gemini API          | 모델은 내 키로 목록을 불러와 선택                           |

  > Gemini의 **Google 계정 로그인(구독)** 방식은 Google 약관이 서드파티 도구의 접근을 금지하고 있어 지원하지 않습니다.

## 데스크톱 앱으로 쓰기

터미널 없이 더블클릭으로 쓰는 설치형 앱(Electron)입니다. 브라우저 버전과 코드가 같고, 로컬 Claude Code 브리지가 앱 안에 내장되어 있습니다.

```bash
npm install
npm run desktop        # 빌드 후 바로 실행
npm run desktop:dist   # 설치 파일 생성 → release/
```

### 설치 파일(.exe) 만들기

**윈도우에서** `npm run desktop:dist`를 실행하면 `release/` 폴더에 두 가지가 만들어집니다.

| 파일                            | 설명                                                                   |
| ------------------------------- | ---------------------------------------------------------------------- |
| `HelpMyDoc-Setup-<버전>.exe`    | 설치형. 더블클릭하면 설치되고 바탕화면·시작 메뉴에 바로가기가 생깁니다 |
| `HelpMyDoc-<버전>-portable.exe` | 설치 없이 바로 실행되는 단일 파일 (첫 실행은 조금 느릴 수 있음)        |

맥(`.dmg`)과 리눅스(`.AppImage`)는 각 OS에서 같은 명령으로 만듭니다. exe는 윈도우에서 빌드하는 것을 기본으로 합니다.

- `EPERM`/`Cannot create symbolic link` 오류가 나면 Windows 설정에서 **개발자 모드**를 켜거나 PowerShell을 **관리자 권한**으로 열어 다시 실행하세요.
- 빌드는 처음에 필요한 도구를 내려받느라 몇 분 걸립니다.
- 태그(`v*`)를 푸시하면 GitHub Actions(`.github/workflows/desktop.yml`)가 맥·윈도우·리눅스 설치 파일을 만들어 Release에 올립니다.
- **서명되지 않은 빌드**라서 처음 실행할 때 OS 경고가 뜹니다. (맥: 앱을 우클릭 → 열기 / 윈도우: SmartScreen "추가 정보 → 실행")
- **Claude Code는 앱에 포함되지 않습니다.** "내 PC의 Claude Code"를 쓰려면 Claude Code를 직접 설치하고 로그인해 두세요. 맥/리눅스에서는 앱이 로그인 셸의 PATH를 읽어 `claude`를 찾습니다. 윈도우는 네이티브 설치본(`claude.exe`)이 필요합니다. (`claude.cmd` 래퍼는 셸 없이 안전하게 실행할 수 없어 지원하지 않습니다.)
- 설정(API 키 포함)은 앱 데이터 폴더에 저장됩니다. 앱은 항상 같은 로컬 포트(47821)를 쓰므로 재실행해도 설정이 유지됩니다. 포트가 사용 중이면 임의 포트를 쓰고 이때는 설정이 유지되지 않을 수 있습니다.

## 실행 (브라우저)

```bash
npm install
npm run dev          # 개발 서버 (로컬 Claude Code 브리지 포함)
```

또는 빌드해서 실행:

```bash
npm run build
npm start            # http://localhost:5174  (--port 로 변경 가능)
```

### 연결 방식 설정

⚙ 설정에서 연결 방식을 고르고(또는 채팅창 위 목록에서 준비되지 않은 연결을 고르면 그 설정이 열립니다) 저장하면 바로 그 연결로 바뀝니다.

**API 키 (Claude / ChatGPT / Gemini)**: 키를 입력합니다. ChatGPT·Gemini는 **모델 불러오기**를 누르면 내 키로 쓸 수 있는 모델 목록이 나오고 거기서 고릅니다. (모델 이름을 앱에 고정해 두지 않아 새 모델이 나와도 그대로 보입니다.) 키는 이 PC에만 저장되고 해당 회사 API로만 전송됩니다.

- [Anthropic Console](https://console.anthropic.com/settings/keys) · [OpenAI 플랫폼](https://platform.openai.com/api-keys) · [Google AI Studio](https://aistudio.google.com/apikey)

**내 PC의 Claude Code (구독 로그인)**

1. [Claude Code](https://code.claude.com)를 설치하고 터미널에서 `claude`를 실행해 한 번 로그인합니다.
2. 위 방법으로 앱을 **내 PC에서** 실행합니다.
3. 처음 실행하면 나오는 시작 화면(또는 ⚙ 설정)에서 연결 상태(`● Claude Code x.y.z · 구독 로그인`)를 확인합니다. 설치·로그인이 안 돼 있으면 이 화면이 안내해 줍니다.

**내 PC의 Codex CLI (ChatGPT 구독 로그인, 실험 기능)**

1. `npm i -g @openai/codex`로 [Codex CLI](https://developers.openai.com/codex/auth)를 설치하고 `codex login`으로 ChatGPT 계정에 로그인합니다.
2. ⚙ 설정 → ChatGPT (구독)에서 **위험 안내를 읽고 동의 체크**를 하면 켜집니다.
3. Codex는 도구를 완전히 끌 수 없어, 앱은 **읽기 전용 샌드박스 + 세션 저장 안 함 + 사용자 설정 무시**로 실행하고 도구를 쓰지 말라는 지침을 붙입니다. 모델이 도구를 쓰려 하면 답변 아래에 알려 줍니다. **출처를 모르는 PDF에는 쓰지 마세요.**
4. 윈도우에서 npm으로 설치한 `codex.cmd`는 셸 없이 실행할 수 없어, 래퍼 옆의 `codex.js`를 직접 실행합니다. (윈도우에서는 아직 검증하지 못했습니다)

동작 방식: 앱의 로컬 브리지(`server/bridge.mjs`)가 `claude -p` 또는 `codex exec --json`을 자식 프로세스로 실행하고, 현재 페이지 텍스트와 질문을 넘겨 응답을 받아 화면에 보여줍니다. CLI별 차이는 `server/adapters.mjs`에 있습니다.

> CLI 방식(Claude Code, Codex)은 정적 호스팅(GitHub Pages 등)에서는 쓸 수 없고, 브리지가 도는 내 PC에서만 동작합니다. 정적 호스팅에서는 API 키 방식만 사용할 수 있습니다.

## 약관 관련 주의 (꼭 읽어 주세요)

- Anthropic은 서드파티 앱이 Claude 구독 로그인(OAuth)을 직접 받거나, 구독 크레덴셜로 요청을 대신 보내는 것을 허용하지 않습니다. ([Claude Code Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance))
- 그래서 이 앱은 구독 토큰을 **읽거나 저장하거나 중계하지 않습니다.** "내 PC의 Claude Code" 모드는 **수정하지 않은 Claude Code를 그대로 실행**하고, 로그인은 Claude Code가 직접 처리합니다.
- 브리지는 `127.0.0.1`에서만 열리고 Host/Origin을 검사합니다. **본인 PC에서 본인 계정으로만** 사용하세요. 서버로 호스팅해 여러 사람이 쓰게 하거나 구독을 공유하는 것은 [사용 정책](https://www.anthropic.com/legal/aup)(2026-11-12 시행: "서비스가 소비자 구독을 통해 요청을 중계하는 행위" 금지)에 어긋납니다.
- **OpenAI(Codex)**: 서드파티 앱용 공식 "Sign in with ChatGPT"는 현재 선정된 파트너 대상의 제한적 시범입니다. 사용자 PC의 공식 Codex CLI를 이 앱이 실행하는 방식을 OpenAI가 명시적으로 허용하는지는 확인하지 못했습니다. 그래서 기본 꺼짐 + 동의 후에만 켜지며, 약관 해석과 책임은 사용자에게 있습니다. 앱은 Codex의 로그인 토큰을 읽거나 저장하지 않습니다.
- **Google(Gemini)**: Google 약관은 Gemini CLI/Antigravity 뒤의 서비스에 서드파티 도구로 접근하는 것을 위반으로 보고 계정 정지 사유로 명시합니다. 공식 CLI를 다른 프로그램이 실행하는 경우에 대한 공식 답변을 찾지 못했고 불이익이 사용자 계정에 가기 때문에, **Google 계정 로그인(구독) 방식은 지원하지 않습니다.** API 키 방식만 지원합니다.
- 약관 해석이 불확실한 부분은 각 회사 약관과 Anthropic의 [영업팀 문의](https://www.anthropic.com/contact-sales) 등으로 직접 확인하세요. 이 README는 법률 자문이 아닙니다.

## 프라이버시

- **전송**: 질문할 때마다 현재 페이지 주변의 텍스트와 질문(필요하면 이전 대화(메시지 100개 또는 총 6만 자 이내의 최근 분량))이 선택한 방식의 AI로 전송됩니다. Anthropic 쪽의 처리·보관은 계정의 개인정보 설정과 Anthropic 정책을 따르며 이 앱이 바꿀 수 없습니다.
- **저장**: 기본값으로 **문서별 대화 내용·마지막으로 본 페이지·파일 이름**을 이 PC 안(브라우저/앱의 IndexedDB)에 저장합니다. PDF 파일과 본문 텍스트는 저장하지 않으며, 어떤 서버로도 보내지 않습니다. ⚙ 설정에서 저장을 끄거나 문서별·전체 기록을 삭제할 수 있습니다.
- **Claude Code / Codex 모드**에서는 각 CLI 자체의 세션 기록도 내 PC에 남기지 않도록 실행합니다(`--no-session-persistence`, `--ephemeral`).
- 설정(API 키 포함)은 localStorage에 평문으로 저장됩니다.

## 개발

```bash
npm test            # 테스트
npm run typecheck   # 타입 검사
npm run format      # 포맷
```

구조와 확장 방법은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 기여 방법은 [CONTRIBUTING.md](CONTRIBUTING.md), 보안 모델은 [SECURITY.md](SECURITY.md)를 보세요.

## 구조

```
src/lib/pdf.ts        pdf.js 로딩, 페이지 텍스트 추출(캐시)
src/lib/setup.ts      시작 화면의 점검 로직 (설치→로그인→인증 방식 판단, OS별 설치 명령)
src/lib/context.ts    현재 페이지 ±N쪽 + 선택 텍스트로 프롬프트 구성
src/lib/docStore.ts   문서별 대화·마지막 페이지 저장 (IndexedDB)
src/lib/docId.ts      파일 내용 해시(SHA-256)로 문서 식별
src/lib/history.ts    대화 길이 제한, 답변 속 p.N 링크 변환
electron/main.mjs     데스크톱 앱 (창 + 로컬 서버 시작, 외부 링크는 기본 브라우저로)
electron/path-fix.mjs 맥/리눅스 GUI 실행 시 PATH 보정 (claude 를 찾기 위해)
src/lib/providers/    연결 방식 5가지 (Claude Code, Codex, Claude/OpenAI/Gemini API) — Provider 인터페이스 + 레지스트리
src/lib/openaiApi.ts  OpenAI Chat Completions 스트리밍 + 모델 목록
src/lib/geminiApi.ts  Gemini generateContent 스트리밍 + 모델 목록
src/lib/sse.ts        SSE 응답 읽기
src/lib/anthropicApi.ts Anthropic Messages API 스트리밍 호출
src/lib/bridgeClient.ts 로컬 브리지 호출 (상태 확인, 스트리밍)
src/components/       PdfViewer(가상 렌더링·현재 페이지 감지), ChatPanel, SettingsDialog
server/bridge.mjs     공식 CLI 실행 브리지 (127.0.0.1 전용, Host/Origin 검사)
server/adapters.mjs   CLI별 어댑터: Claude Code(`claude -p`), Codex(`codex exec --json`)
server/vite-plugin.mjs  dev/preview 서버에 브리지 연결
bin/helpmydoc.mjs     빌드 결과 + 브리지 서버 (`npm start`)
```

## 한계 / 다음 단계

- 스캔본(이미지) PDF는 텍스트가 없어 답변이 제한됩니다 → 페이지 이미지를 비전으로 전송하는 기능 예정
- "3장 전체 요약" 같은 넓은 범위 질문 → 문서 전체 색인(RAG) 또는 목차 기반 처리 예정
- 로컬 모델(Ollama 등) 연결, 다른 문서 포맷은 추후 추가
- 데스크톱 앱: PDF 파일 연결("연결 프로그램"으로 열기), 자동 업데이트, 코드 서명은 아직 없음

## 라이선스

[MIT](LICENSE)
