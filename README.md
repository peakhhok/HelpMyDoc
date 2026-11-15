# HelpMyDoc

PDF를 왼쪽에 열고, 오른쪽의 AI(Claude)에게 **페이지 번호를 말하지 않고** 바로 질문하는 문서 리더.

> 300쪽을 보고 있는 상태에서 "여기서 중요한 부분을 요약해줘"라고만 해도, 지금 화면에 보이는 페이지(±1쪽)의 텍스트를 자동으로 Claude에게 함께 보냅니다.

## 특징 (MVP)

- PDF 열기 (파일 선택 / 드래그&드롭), 500쪽 이상도 보이는 쪽만 렌더링
- 현재 보고 있는 페이지 자동 추적 → 질문마다 그 주변 페이지 텍스트를 자동 첨부
- PDF에서 텍스트를 드래그해 선택하면 해당 문장을 함께 전달
- Claude 스트리밍 응답, Markdown 렌더링, 중지 버튼
- **두 가지 연결 방식** (⚙ 설정에서 선택)
  1. **API 키**: 내 Anthropic API 키로 브라우저에서 직접 호출 (키는 localStorage에만 저장)
  2. **내 PC의 Claude Code**: 이미 설치·로그인된 Claude Code(`claude`)를 그대로 실행해서, **Claude 구독(Pro/Max) 한도로** 사용

## 실행

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
3. ⚙ 설정 → "내 PC의 Claude Code"를 선택하면 연결 상태(`● Claude Code x.y.z · 구독 로그인`)가 표시됩니다.

동작 방식: 앱의 로컬 브리지(`server/bridge.mjs`)가 `claude -p`를 자식 프로세스로 실행하고(파일·명령 도구, MCP, 프로젝트 설정은 모두 끔), 현재 페이지 텍스트와 질문을 넘겨 스트리밍으로 답을 받습니다.

> 이 방식은 정적 호스팅(GitHub Pages 등)에서는 쓸 수 없고, 브리지가 도는 내 PC에서만 동작합니다. 정적 호스팅에서는 API 키 방식만 사용할 수 있습니다.

## 약관 관련 주의 (꼭 읽어 주세요)

- Anthropic은 서드파티 앱이 Claude 구독 로그인(OAuth)을 직접 받거나, 구독 크레덴셜로 요청을 대신 보내는 것을 허용하지 않습니다. ([Claude Code Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance))
- 그래서 이 앱은 구독 토큰을 **읽거나 저장하거나 중계하지 않습니다.** "내 PC의 Claude Code" 모드는 **수정하지 않은 Claude Code를 그대로 실행**하고, 로그인은 Claude Code가 직접 처리합니다.
- 브리지는 `127.0.0.1`에서만 열리고 Host/Origin을 검사합니다. **본인 PC에서 본인 계정으로만** 사용하세요. 서버로 호스팅해 여러 사람이 쓰게 하거나 구독을 공유하는 것은 [사용 정책](https://www.anthropic.com/legal/aup)(2026-11-12 시행: "서비스가 소비자 구독을 통해 요청을 중계하는 행위" 금지)에 어긋납니다.
- 약관 해석이 불확실한 부분은 Anthropic 약관과 [영업팀 문의](https://www.anthropic.com/contact-sales)로 직접 확인하세요. 이 README는 법률 자문이 아닙니다.

## 프라이버시

질문할 때마다 현재 페이지 주변의 텍스트가 선택한 방식의 Claude(Anthropic API 또는 내 PC의 Claude Code)로 전송됩니다. 그 외에는 어떤 서버로도 문서가 전송되지 않습니다.

## 구조

```
src/lib/pdf.ts        pdf.js 로딩, 페이지 텍스트 추출(캐시)
src/lib/context.ts    현재 페이지 ±N쪽 + 선택 텍스트로 프롬프트 구성
src/lib/providers.ts  연결 방식 선택 (API 키 / 로컬 Claude Code)
src/lib/claude.ts     Anthropic Messages API 스트리밍 호출
src/lib/claudeCode.ts 로컬 브리지 호출 (상태 확인, 스트리밍)
src/components/       PdfViewer(가상 렌더링·현재 페이지 감지), ChatPanel, SettingsDialog
server/bridge.mjs     `claude -p` 실행 브리지 (127.0.0.1 전용, Host/Origin 검사)
server/vite-plugin.mjs  dev/preview 서버에 브리지 연결
bin/helpmydoc.mjs     빌드 결과 + 브리지 서버 (`npm start`)
```

## 한계 / 다음 단계

- 스캔본(이미지) PDF는 텍스트가 없어 답변이 제한됩니다 → 페이지 이미지를 비전으로 전송하는 기능 예정
- "3장 전체 요약" 같은 넓은 범위 질문 → 문서 전체 색인(RAG) 또는 목차 기반 처리 예정
- 다른 AI(GPT, Gemini, 로컬 모델) 선택, 다른 문서 포맷은 추후 추가
- 데스크톱 앱(Tauri) 패키징: 설치형으로 만들어 브리지를 내장 예정
