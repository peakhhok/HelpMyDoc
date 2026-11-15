# 보안 정책

## 취약점 신고

공개 이슈 대신 GitHub의 **Private vulnerability reporting**(저장소 Security 탭 → Report a vulnerability)으로 알려 주세요.

## 위협 모델 요약

- **API 키**: 사용자의 브라우저 localStorage에만 저장되고 `api.anthropic.com`으로만 전송됩니다. 같은 출처의 악성 스크립트가 있으면 읽을 수 있으므로 신뢰할 수 없는 스크립트를 추가하지 마세요.
- **저장되는 대화**: 문서별 대화·마지막 페이지·파일 이름이 이 PC의 IndexedDB(앱 데이터 폴더)에 **암호화 없이** 저장됩니다. 같은 PC·같은 사용자 계정으로 접근할 수 있는 사람/프로그램은 읽을 수 있으므로, 민감한 문서는 설정에서 저장을 끄거나 기록을 삭제하세요. PDF 파일과 본문 텍스트는 저장하지 않습니다.
- **PDF 내용**: 질문할 때 현재 페이지 주변 텍스트가 선택한 AI(Anthropic API 또는 내 PC의 Claude Code)로 전송됩니다. PDF 자체는 업로드되지 않습니다. PDF 안의 텍스트는 AI에게 프롬프트 인젝션이 될 수 있으며, 이 앱의 AI는 도구를 쓰지 않는 순수 채팅이라 영향 범위가 답변 내용에 한정됩니다.
- **로컬 브리지** (`server/bridge.mjs`): 사용자의 Claude Code를 실행하는 로컬 엔드포인트이므로 다음으로 보호합니다.
  - `127.0.0.1`에서만 수신
  - `localhost`/`127.0.0.1`/`[::1]` 이외의 `Host` 거절 (DNS rebinding 방어)
  - 다른 `Origin`, `Sec-Fetch-Site: cross-site` 거절 (CSRF 방어)
  - `application/json`만 허용, 요청 크기·동시 실행 수·실행 시간 제한
  - 모델 이름 형식 검증 (CLI 옵션 주입 방지), 내장 도구·MCP·프로젝트 설정 비활성화
  - 계정 식별 정보(이메일 등)를 응답에 포함하지 않음

  이 보호는 `server/bridge.test.ts`로 검증합니다. 브리지를 `127.0.0.1` 밖으로 노출하거나 프록시 뒤에 두는 구성은 지원하지 않습니다.
