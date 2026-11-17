# HelpMyDoc

PDF를 왼쪽에 열고, 오른쪽의 AI(Claude)에게 **페이지 번호를 말하지 않고** 바로 질문하는 문서 리더.

> 300쪽을 보고 있는 상태에서 "여기서 중요한 부분을 요약해줘"라고만 해도, 지금 화면에 보이는 페이지(±1쪽)의 텍스트를 자동으로 Claude에게 함께 보냅니다.

## 특징 (MVP)

- PDF 열기 (파일 선택 / 드래그&드롭), 500쪽 이상도 보이는 쪽만 렌더링
- 현재 보고 있는 페이지 자동 추적 → 질문마다 그 주변 페이지 텍스트를 자동 첨부
- PDF에서 텍스트를 드래그해 선택하면 해당 문장을 함께 전달
- **문서별 기억**: 같은 PDF를 다시 열면 이전 대화와 마지막으로 보던 페이지가 이어집니다. 문서는 파일 이름이 아니라 **내용의 해시**로 구분해서, 이름을 바꿔도 같은 문서로 알아봅니다. (설정에서 끄거나 삭제할 수 있음)
- 답변 속 `(p.120)`을 누르면 그 쪽으로 이동
- **사용량 표시**: 답변마다 쓰인 토큰 수(입력·출력)를 보여주고, Claude Code(구독) 방식에서는 채팅창 머리말에 **5시간 / 7일 한도 사용률**과 초기화까지 남은 시간(마우스를 올리면)을 표시합니다. 70%부터 주황, 90%부터 빨강입니다. 한도 값은 Claude Code가 답변과 함께 알려주는 값이라 첫 질문 뒤부터 채워지고, 마지막 값은 앱을 껐다 켜도 남습니다. **5시간·7일 두 값은 비교적 최신 Claude Code(2.1.3xx대 확인)가 알려줍니다.** 옛 버전(예: 2.1.220)은 창 하나의 값이나 한도 상태(정상/경고/초과)만 알려주거나 아무것도 안 알려줄 수 있어서, 그때는 이유를 안내하고 `claude update`를 권합니다.
- Claude 스트리밍 응답, Markdown 렌더링, 중지 버튼
- **시작 화면에서 연결 점검**: 처음 실행하면 연결 방식(구독 / API 키)을 고르고, "Claude 구독" 방식이면 **Claude Code 설치 → 로그인** 여부를 단계별로 점검합니다. 빠진 단계는 OS에 맞는 공식 설치 명령(복사 버튼)을 보여주고, 로그인은 **"로그인 시도하기" 버튼**을 누르면 브라우저가 열려 거기서 로그인하면 됩니다. 마치면 **자동으로 감지**해 다음으로 넘어가요. (버튼이 안 되면 터미널 명령을 대신 쓸 수 있습니다) 사용 중에 로그인이 풀리면 화면을 막지 않고 채팅창에 배너로 알립니다. **실행할 때마다 짧은 요청("OK"라고만 답하게)을 한 번 실제로 보내 로그인이 아직 유효한지 확인**하고(재부팅 등으로 풀렸는데 `claude auth status`는 모르는 경우 대비), 풀려 있으면 바로 로그인 화면을 띄웁니다. 풀린 동안에는 몇 초마다 조용히 다시 확인해서 다시 로그인하면 자동으로 이어집니다. 사용량은 거의 쓰지 않으며 ⚙ 설정에서 끌 수 있습니다.
- **채팅에 파일 첨부**: 채팅창의 📎 버튼으로 고르거나 채팅창에 끌어다 놓으면, 그 파일의 글을 AI가 읽습니다. md·txt·csv·코드 같은 글 파일, PDF, PowerPoint(.pptx), Word(.docx)를 읽을 수 있고(이미지·옛 `.doc/.ppt/.hwp`·엑셀은 아직 안 됨), 파일 하나는 앞 6만 자까지(전체 합계 12만 자) 보냅니다. 올린 파일은 **다음에 보내는 질문 한 번에만** 함께 전송되고 보내면 입력창에서 비워집니다(채팅 앱처럼). 보낸 메시지에는 첨부한 파일 이름이 표시되고, 전송이 실패하면 첨부와 질문이 되돌아옵니다. AI는 질문마다 새로 시작하므로 이후 질문에서 그 파일을 다시 다루려면 다시 첨부하세요. 열려 있는 문서를 바꾸는 것이 아니라 "참고 자료"로 더하는 기능입니다.
- **프로젝트 폴더 연결(Claude Code)**: ⚙ 설정 > Claude Code에서 내 PC의 폴더(예: 공부 자료 저장소를 내려받은 폴더)를 연결하면, AI가 **GitHub가 아니라 그 폴더**를 직접 열어 파일을 읽고(`CLAUDE.md`의 지침 포함) 질문에 답합니다. "쓰기를 허용할 경로"(예: `quiz/**, STUDY_STATUS.md`)를 적으면 **그 경로에만** AI가 파일을 만들거나 고칠 수 있어(예: 오답 노트 기록), 비우면 읽기 전용입니다. 명령 실행·웹·폴더 밖은 막혀 있고, AI가 읽고 쓴 파일이 답변 아래에 표시되며 허용하지 않은 쓰기는 "거부됨"으로 보입니다. 쓴 내용은 내 PC의 파일에만 반영됩니다. 파일을 열어 보느라 답변이 느려지고 사용량이 더 들 수 있고, 문서 스캔에는 폴더를 쓰지 않습니다.
- **git (프로젝트 폴더 모드)**: 설정에서 "AI가 git을 읽고 로컬 commit까지 허용"을 켜고 브랜치(예: `main-hkwfct`)를 적으면, AI는 `git status / diff / log / branch --show-current`를 쓰고, **쓰기를 허용한 파일 중 파일 이름을 정확히 적은 것**만 `git add 파일`과 `git commit -m "메시지" -- 파일`로 커밋합니다(파일을 지정하지 않은 commit, `-a`/`--all`, `git add .`/`-A`, push·pull·reset·checkout·switch·amend 등은 모두 막힘). 현재 브랜치가 지정한 브랜치가 아니면 commit 권한 자체가 꺼집니다. **GitHub로 올리는 것은 AI가 아니라 채팅 위 `⬆ 동기화` 버튼**을 사용자가 눌러야만 일어나고, 누르면 확인 창 → `git pull --no-rebase --no-edit`(받아오기, 충돌이 나면 병합을 취소해 원래대로 되돌리고 멈춤) → `git push origin <브랜치>` 순서로 실행됩니다. 로그인은 PC의 git이 이미 가진 것을 쓰며(앱은 보지 않음), 비밀번호를 묻는 상황에서는 멈추지 않고 실패로 알려줍니다.
- **PowerPoint(.pptx) 열기**: Office 없이 앱이 파일을 직접 읽어 슬라이드를 그립니다. 슬라이드 한 장이 한 쪽이라서 질문·스캔·비슷한 쪽 찾기·형광펜·메모가 PDF와 똑같이 동작하고, 발표자 노트도 AI가 함께 읽습니다. 강의 슬라이드(글상자, 그림, 표, 기본 도형, 화살표, 그룹)는 원본과 비슷하게 나오지만, 차트·SmartArt·EMF 그림·특수 효과는 간단한 상자로 대신 보여주고 "원본과 다르게 보일 수 있어요"라고 표시합니다. 화면이 꼭 정확해야 하면 PowerPoint에서 PDF로 저장해 여세요. 옛 `.ppt`와 Word(.docx)는 아직 지원하지 않습니다.
- **형광펜·메모(공부용)**: 글자를 드래그하면 색(노랑·초록·분홍·파랑)을 골라 칠하고, 칠한 곳을 누르면 그 부분에 메모를 달 수 있습니다. 툴바의 색 버튼을 누르면 '형광펜 모드'(드래그하는 즉시 칠함)가 켜집니다. 쪽마다 메모도 쓸 수 있고, 오른쪽 **메모 탭**에 모아 보이며 Markdown으로 복사·내려받을 수 있습니다. 위치는 페이지 크기 대비 비율로 저장해서 확대·축소해도 맞습니다.
- **비슷한 쪽 찾기 + 문서 스캔**: 예를 들어 308쪽을 보고 있는데 같은 내용이 100쪽에도 나왔다면, 질문할 때 앱이 **지금 쪽(과 선택한 글, 질문)과 내용이 비슷한 다른 쪽**을 찾아 발췌와 함께 AI에게 같이 보내서 "100쪽에서 본 것과 이어진다"는 식으로 설명하게 합니다. 이 찾기는 내 PC 안에서 계산하므로 AI 사용량을 쓰지 않습니다. 툴바의 **🔍 문서 스캔**을 하면 AI가 문서를 구간별로 한 번 읽고 **쪽마다 한 줄 요약과 핵심 용어**를 적어 저장하는데(중간에 멈췄다가 이어서 가능), 그러면 표현이 달라도 같은 내용을 찾고 찾은 쪽의 한 줄 요약도 함께 보냅니다. 스캔은 사용 중인 AI의 사용량(구독 한도 또는 API 비용)을 쓰고, 글자가 없는 쪽(스캔본 그림)은 읽을 수 없습니다. AI는 질문마다 새로 시작하므로 문서 전체를 통째로 기억하지는 않고, 질문마다 관련된 부분을 골라 보내는 방식입니다. 질문에 이런 덧붙임(비슷한 쪽·문서 목차·내 메모)을 보낼지는 스캔 창에서 끌 수 있습니다.
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

### 자동 업데이트 (윈도우)

설치한 앱은 시작하고 잠시 뒤, 그리고 6시간마다 이 저장소의 **GitHub Releases**에서 새 버전을 확인합니다. 새 버전이 있으면 백그라운드로 받고, 받기가 끝나면 화면 위에 **"새 버전(v0.2.0)이 준비됐어요 [다시 시작해서 업데이트]"**가 나옵니다. 누르지 않아도 앱을 종료할 때 자동으로 설치됩니다. 대화 기록과 설정은 그대로 유지됩니다.

- **지금은 윈도우(설치형)만 배포합니다.** 포터블 exe는 자동 업데이트가 안 되어 직접 새 파일을 받아야 합니다. (맥·리눅스 빌드는 만들지 않습니다)
- 끄려면 환경변수 `HELPMYDOC_NO_UPDATE=1`로 앱을 실행하세요. 개발 실행(`npm run desktop`)에서는 항상 꺼져 있습니다.
- **새 버전 내기(관리자)**: `package.json`의 `version`을 올리고 커밋한 뒤 태그를 푸시하면 GitHub Actions가 윈도우 설치 파일과 업데이트 정보(`latest.yml`)를 만들어 Release에 올립니다.
  ```bash
  git tag v0.1.1 && git push origin v0.1.1
  ```
- 서명이 없으면 첫 설치 때 SmartScreen 경고가 뜹니다. 윈도우 서명은 오픈소스 무료 서명([SignPath Foundation](https://about.signpath.io/product/open-source), 승인 필요) 또는 유료(Azure Artifact Signing 월 9.99달러 등)로 나중에 붙일 수 있습니다.

### 설치 파일(.exe) 만들기

**윈도우에서** 프로젝트 폴더의 `build-exe.bat`을 더블클릭하거나(PowerShell 실행 정책 오류 없음) `npm run desktop:dist`를 실행하면 `release/` 폴더에 두 가지가 만들어집니다.

| 파일                            | 설명                                                                   |
| ------------------------------- | ---------------------------------------------------------------------- |
| `HelpMyDoc-Setup-<버전>.exe`    | 설치형. 더블클릭하면 설치되고 바탕화면·시작 메뉴에 바로가기가 생깁니다 |
| `HelpMyDoc-<버전>-portable.exe` | 설치 없이 바로 실행되는 단일 파일 (첫 실행은 조금 느릴 수 있음)        |

맥·리눅스용 설치 파일은 현재 배포하지 않습니다. (코드는 동작하지만 CI에서 만들거나 검증하지 않습니다)

- `EPERM`/`Cannot create symbolic link` 오류가 나면 Windows 설정에서 **개발자 모드**를 켜거나 PowerShell을 **관리자 권한**으로 열어 다시 실행하세요.
- 빌드는 처음에 필요한 도구를 내려받느라 몇 분 걸립니다.
- 태그(`v*`)를 푸시하면 GitHub Actions(`.github/workflows/desktop.yml`)가 윈도우 설치 파일을 만들어 Release에 올립니다. 수동 실행(Run workflow)은 Release 없이 산출물(Artifacts)만 만듭니다.
- **서명되지 않은 빌드**라서 처음 실행할 때 윈도우 SmartScreen 경고가 뜹니다. ("추가 정보 → 실행")
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
- **저장**: 기본값으로 **문서별 대화 내용·마지막으로 본 페이지·파일 이름**을 이 PC 안(브라우저/앱의 IndexedDB)에 저장합니다. (내가 만든 **메모·형광펜**과 **문서 스캔 결과(AI가 만든 구간 요약)**도 같은 곳에 저장됩니다.) PDF 파일과 본문 텍스트는 저장하지 않으며, 어떤 서버로도 보내지 않습니다. ⚙ 설정에서 저장을 끄거나 문서별·전체 기록을 삭제할 수 있습니다.
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
src/lib/docStore.ts   문서별 대화·메모·형광펜·스캔 결과·마지막 페이지 저장 (IndexedDB)
src/lib/annotations.ts  형광펜 좌표(비율)·병합·내보내기
src/lib/scan.ts        문서 스캔: 구간 나누기·쪽별 요약 파싱·목차 만들기
src/lib/related.ts     비슷한 쪽 찾기 (TF-IDF, 이 PC 안에서 계산)
src/lib/pptx/          PowerPoint(.pptx) 읽기(parse)와 슬라이드 그리기(render) — 마스터·레이아웃·테마 상속을 풀어서 그린다
src/lib/docSource.ts   열린 문서(PDF/PPTX)의 공통 모양: 쪽 수·쪽별 글·닫기
src/lib/attach.ts      채팅 첨부 파일을 글로 바꾸기 (글 파일, PDF, pptx, docx)
src/lib/verify.ts      실행할 때 로그인이 실제로 유효한지 확인
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
