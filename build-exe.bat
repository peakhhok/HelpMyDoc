@echo off
chcp 65001 >nul
REM HelpMyDoc 설치 파일(exe)을 이 폴더의 release\ 안에 만든다. 더블클릭하면 된다.
REM (일반 배치 파일이라 PowerShell 실행 정책 오류가 나지 않는다)
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [오류] Node.js 가 설치되어 있지 않습니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요.
  goto :fail
)

REM 코드 서명 인증서를 찾지 않도록 한다 (서명되지 않은 빌드)
set CSC_IDENTITY_AUTO_DISCOVERY=false

echo.
echo [1/3] 필요한 패키지를 설치합니다... (처음에는 몇 분 걸릴 수 있어요)
call npm install
if errorlevel 1 goto :fail

echo.
echo [2/3] 설치 파일(exe)을 만듭니다... (처음에는 도구를 내려받느라 몇 분 걸립니다)
call npm run desktop:dist
if errorlevel 1 goto :fail

echo.
echo [3/3] 완료!
echo.
echo   바로 실행:   release\win-unpacked\HelpMyDoc.exe
echo   설치용:      release\HelpMyDoc-Setup-버전.exe
echo   설치 없이:   release\HelpMyDoc-버전-portable.exe
echo.
REM CI(자동 검증) 에서는 창을 열거나 멈추지 않는다
if "%CI%"=="" (
  start "" "%~dp0release"
  pause
)
exit /b 0

:fail
echo.
echo [실패] 위 메시지를 확인해 주세요.
echo   - "symbolic link" / "권한" 오류가 나면: Windows 설정 ^> 개발자용 ^> 개발자 모드를 켜거나,
echo     이 파일을 마우스 오른쪽 클릭 ^> 관리자 권한으로 실행해 보세요.
if "%CI%"=="" pause
exit /b 1
