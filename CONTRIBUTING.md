# 기여하기

관심 가져 주셔서 고맙습니다! 구조는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)에 있습니다.

## 개발 환경

- Node.js 20 이상 (`.nvmrc`는 22)
- (선택) "내 PC의 Claude Code" 연결을 시험하려면 [Claude Code](https://code.claude.com) 설치·로그인

```bash
npm install
npm run dev
```

## 자주 쓰는 명령

| 명령                | 설명                                           |
| ------------------- | ---------------------------------------------- |
| `npm run dev`       | 개발 서버 (로컬 Claude Code 브리지 포함)       |
| `npm test`          | 단위·통합 테스트 (Vitest)                      |
| `npm run typecheck` | 타입 검사                                      |
| `npm run format`    | Prettier로 포맷                                |
| `npm run build`     | 타입 검사 + 프로덕션 빌드                      |
| `npm start`         | 빌드 결과 + 브리지 서버 (`--port`로 포트 변경) |

PR을 올리기 전에 `npm run format:check && npm run typecheck && npm test && npm run build`가 통과해야 합니다. CI도 같은 순서로 검사합니다.

## 변경할 때 지켜 주세요

- **새 로직에는 테스트를 같이.** pdf.js·DOM에 의존하지 않는 로직은 `src/lib/`에 두고 테스트하기 쉽게 만듭니다. (`context.ts`가 좋은 예)
- **새 AI 연결 방식**은 `Provider`를 구현해 레지스트리에 등록합니다. (ARCHITECTURE.md의 "확장 지점" 참고)
- **각 회사의 약관 제약을 어기는 변경은 받을 수 없습니다.** (Google 계정 로그인으로 Gemini를 쓰는 연결, 로그인 토큰을 직접 다루는 코드 등)
- **Anthropic 약관 제약을 어기는 변경은 받을 수 없습니다.** 구독 토큰을 읽거나 저장·중계하는 코드, Claude Code 바이너리 수정, 브리지를 `127.0.0.1` 밖으로 여는 변경, 서버 호스팅 구성이 해당합니다. 자세한 내용은 ARCHITECTURE.md의 "지켜야 할 제약"에 있습니다.
- 브리지(`server/bridge.mjs`)를 바꾸면 `server/bridge.test.ts`의 보안 테스트가 계속 통과해야 합니다.

## 버그·아이디어

이슈로 남겨 주세요. 가능하면 재현 방법(PDF 종류, 브라우저, 연결 방식)을 같이 적어 주세요. 문서를 공유할 수 없다면 문제가 생기는 페이지의 성격(스캔본/수식/표 등)만 알려 주셔도 됩니다.
