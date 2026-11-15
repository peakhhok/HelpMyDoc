# HelpMyDoc

PDF를 왼쪽에 열고, 오른쪽의 AI(Claude)에게 **페이지 번호를 말하지 않고** 바로 질문하는 문서 리더.

> 300쪽을 보고 있는 상태에서 "여기서 중요한 부분을 요약해줘"라고만 해도, 지금 화면에 보이는 페이지(±1쪽)의 텍스트를 자동으로 Claude에게 함께 보냅니다.

## 특징 (MVP)

- PDF 열기 (파일 선택 / 드래그&드롭), 500쪽 이상도 보이는 쪽만 렌더링
- 현재 보고 있는 페이지 자동 추적 → 질문마다 그 주변 페이지 텍스트를 자동 첨부
- PDF에서 텍스트를 드래그해 선택하면 해당 문장을 함께 전달
- Claude 스트리밍 응답, Markdown 렌더링
- 서버 없음: PDF는 브라우저에서만 처리되고, API 키는 브라우저 localStorage에 저장 (BYOK)

## 실행

```bash
npm install
npm run dev
```

브라우저에서 열고 ⚙ 설정에 [Anthropic API 키](https://console.anthropic.com/settings/keys)를 입력하세요.

> Claude 구독(Pro/Max) 로그인은 Anthropic 약관상 서드파티 앱에서 사용할 수 없어 API 키 방식을 사용합니다.

## 프라이버시

질문할 때마다 현재 페이지 주변의 텍스트가 `api.anthropic.com`으로 전송됩니다. 그 외에는 어떤 서버로도 문서가 전송되지 않습니다.

## 구조

```
src/lib/pdf.ts        pdf.js 로딩, 페이지 텍스트 추출(캐시)
src/lib/context.ts    현재 페이지 ±N쪽 + 선택 텍스트로 프롬프트 구성
src/lib/claude.ts     Anthropic Messages API 스트리밍 호출
src/components/       PdfViewer(가상 렌더링·현재 페이지 감지), ChatPanel, SettingsDialog
```

## 한계 / 다음 단계

- 스캔본(이미지) PDF는 텍스트가 없어 답변이 제한됩니다 → 페이지 이미지를 비전으로 전송하는 기능 예정
- "3장 전체 요약" 같은 넓은 범위 질문 → 문서 전체 색인(RAG) 또는 목차 기반 처리 예정
- 다른 AI(GPT, Gemini, 로컬 모델) 선택, 다른 문서 포맷은 추후 추가
