# HelpMyDoc

PDF를 왼쪽에 열고, 오른쪽의 AI(Claude)에게 **페이지 번호를 말하지 않고** 바로 질문하는 문서 리더.

> 300쪽을 보고 있는 상태에서 "여기서 중요한 부분을 요약해줘"라고만 해도, 지금 화면에 보이는 페이지(±1쪽)의 텍스트를 자동으로 Claude에게 함께 보냅니다.

## 특징 (MVP)

- PDF 열기 (파일 선택 / 드래그&드롭), 500쪽 이상도 보이는 쪽만 렌더링
- 현재 보고 있는 페이지 자동 추적 → 질문마다 그 주변 페이지 텍스트를 자동 첨부
- PDF에서 텍스트를 드래그해 선택하면 해당 문장을 함께 전달
- **문서별 기억**: 같은 PDF를 다시 열면 이전 대화와 마지막으로 보던 페이지가 이어집니다. 문서는 파일 이름이 아니라 **내용의 해시**로 구분해서, 이름을 바꿔도 같은 문서로 알아봅니다. (설정에서 끄거나 삭제할 수 있음)
- 답변 속 `(p.120)`을 누르면 그 쪽으로 이동
- Claude 스트리밍 응답, Markdown 렌더링, 중지 버튼
- **시작 화면에서 연결 점검**: 처음 실행하면 연결 방식(구독 / API 키)을 고르고, "Claude 구독" 방식이면 **Claude Code 설치 → 로그인** 여부를 단계별로 점검합니다. 빠진 단계는 OS에 맞는 공식 설치 명령과 로그인 명령을 복사 버튼과 함께 보여주고, 터미널에서 마치고 돌아오면 **자동으로 감지**해 다음으로 넘어갑니다. 사용 중에 로그인이 풀리면 화면을 막지 않고 채팅창에 배너로 알립니다.
- **두 가지 연결 방식** (⚙ 설정에서 선택)
  1. **API 키**: 내 Anthropic API 키로 브라우저에서 직접 호출 (키는 localStorage에만 저장)
  2. **내 PC의 Claude Code**: 이미 설치·로그인된 Claude Code(`claude`)를 그대로 실행해서, **Claude 구독(Pro/Max) 한도로** 사용

## 데스크톱 앱으로 쓰기

터미널 없이 더블클릭으로 쓰는 설치형 앱(Electron)입니다. 브라우저 버전과 코드가 같고, 로컬 Claude Code 브리지가 앱 안에 내장되어 있습니다.

```bash
npm install
npm run desktop        # 빌드 후 바로 실행
npm run desktop:dist   # 설치 파일 생성 → release/  (현재 OS 용: .dmg / .exe / .AppImage)
```

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

### 연결 방식 1: API 키

⚙ 설정 → "API 키"에 [Anthropic API 키](https://console.anthropic.com/settings/keys)를 입력합니다.

### 연결 방식 2: 내 PC의 Claude Code (구독 로그인)

1. [Claude Code](https://code.claude.com)를 설치하고 터미널에서 `claude`를 실행해 한 번 로그인합니다.
2. 위 방법으로 앱을 **내 PC에서** 실행합니다.
3. 처음 실행하면 나오는 시작 화면(또는 ⚙ 설정 → "내 PC의 Claude Code")에서 연결 상태(`● Claude Code x.y.z · 구독 로그인`)를 확인합니다. 설치·로그인이 안 돼 있으면 이 화면이 안내해 줍니다.

동작 방식: 앱의 로컬 브리지(`server/bridge.mjs`)가 `claude -p`를 자식 프로세스로 실행하고(파일·명령 도구, MCP, 프로젝트 설정은 모두 끔), 현재 페이지 텍스트와 질문을 넘겨 스트리밍으로 답을 받습니다.

> 이 방식은 정적 호스팅(GitHub Pages 등)에서는 쓸 수 없고, 브리지가 도는 내 PC에서만 동작합니다. 정적 호스팅에서는 API 키 방식만 사용할 수 있습니다.

## 약관 관련 주의 (꼭 읽어 주세요)

- Anthropic은 서드파티 앱이 Claude 구독 로그인(OAuth)을 직접 받거나, 구독 크레덴셜로 요청을 대신 보내는 것을 허용하지 않습니다. ([Claude Code Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance))
- 그래서 이 앱은 구독 토큰을 **읽거나 저장하거나 중계하지 않습니다.** "내 PC의 Claude Code" 모드는 **수정하지 않은 Claude Code를 그대로 실행**하고, 로그인은 Claude Code가 직접 처리합니다.
- 브리지는 `127.0.0.1`에서만 열리고 Host/Origin을 검사합니다. **본인 PC에서 본인 계정으로만** 사용하세요. 서버로 호스팅해 여러 사람이 쓰게 하거나 구독을 공유하는 것은 [사용 정책](https://www.anthropic.com/legal/aup)(2026-11-12 시행: "서비스가 소비자 구독을 통해 요청을 중계하는 행위" 금지)에 어긋납니다.
- 약관 해석이 불확실한 부분은 Anthropic 약관과 [영업팀 문의](https://www.anthropic.com/contact-sales)로 직접 확인하세요. 이 README는 법률 자문이 아닙니다.

## 프라이버시

- **전송**: 질문할 때마다 현재 페이지 주변의 텍스트와 질문(필요하면 이전 대화 최근 20개 메시지)이 선택한 방식의 Claude(Anthropic API 또는 내 PC의 Claude Code)로 전송됩니다. Anthropic 쪽의 처리·보관은 계정의 개인정보 설정과 Anthropic 정책을 따르며 이 앱이 바꿀 수 없습니다.
- **저장**: 기본값으로 **문서별 대화 내용·마지막으로 본 페이지·파일 이름**을 이 PC 안(브라우저/앱의 IndexedDB)에 저장합니다. PDF 파일과 본문 텍스트는 저장하지 않으며, 어떤 서버로도 보내지 않습니다. ⚙ 설정에서 저장을 끄거나 문서별·전체 기록을 삭제할 수 있습니다.
- **Claude Code 모드**에서는 Claude Code 자체의 세션 기록도 내 PC에 남기지 않도록 실행합니다(`--no-session-persistence`).
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
src/lib/providers/    연결 방식 (API 키 / 로컬 Claude Code) — Provider 인터페이스 + 레지스트리
src/lib/anthropicApi.ts Anthropic Messages API 스트리밍 호출
src/lib/bridgeClient.ts 로컬 브리지 호출 (상태 확인, 스트리밍)
src/components/       PdfViewer(가상 렌더링·현재 페이지 감지), ChatPanel, SettingsDialog
server/bridge.mjs     `claude -p` 실행 브리지 (127.0.0.1 전용, Host/Origin 검사)
server/vite-plugin.mjs  dev/preview 서버에 브리지 연결
bin/helpmydoc.mjs     빌드 결과 + 브리지 서버 (`npm start`)
```

## 한계 / 다음 단계

- 스캔본(이미지) PDF는 텍스트가 없어 답변이 제한됩니다 → 페이지 이미지를 비전으로 전송하는 기능 예정
- "3장 전체 요약" 같은 넓은 범위 질문 → 문서 전체 색인(RAG) 또는 목차 기반 처리 예정
- 다른 AI(GPT, Gemini, 로컬 모델) 선택, 다른 문서 포맷은 추후 추가
- 데스크톱 앱: PDF 파일 연결("연결 프로그램"으로 열기), 자동 업데이트, 코드 서명은 아직 없음

## 라이선스

[MIT](LICENSE)
