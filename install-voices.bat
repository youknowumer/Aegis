@echo off
REM Adds Aegis's local language voices. Aegis then answers in the voice of the language you speak.
REM   Piper (new, light, natural, no PyTorch, about 1 GB for ~25 languages) goes first
REM   Meta MMS (31 languages incl. Urdu, Punjabi, Tamil; about 5 GB; PyTorch) is the second choice
REM Optional pre-download: without it Aegis fetches each voice by itself the first time that language is spoken.
REM Needs Python 3.10+ and internet once. MMS voices are non-commercial (CC-BY-NC 4.0); each Piper voice has its own licence.
REM   install-voices.bat                       -> Piper + MMS for every language Aegis knows
REM   install-voices.bat --piper-only          -> Piper only (small, fast)
REM   install-voices.bat --high                -> prefer Piper's high-quality tier
REM   install-voices.bat --langs ur,en,hi      -> only these (add "roman" for Roman Urdu: that one is MMS only)
cd /d "%~dp0server"
if not exist .venv (python -m venv .venv)
call .venv\Scripts\activate.bat
pip install -q -r requirements.txt
pip install -q -r requirements-piper.txt
set PIPER_ONLY=0
set PIPER_Q=
set LANGS=
:parse
if "%~1"=="" goto run
if /i "%~1"=="--piper-only" set PIPER_ONLY=1
if /i "%~1"=="--high" set PIPER_Q=--quality high
if /i "%~1"=="--langs" (set LANGS=%~2& shift)
shift
goto parse
:run
if defined LANGS (
  python scripts\piper_download.py %PIPER_Q% --langs %LANGS%
) else (
  python scripts\piper_download.py %PIPER_Q%
)
if "%PIPER_ONLY%"=="1" goto done
pip install -r requirements-mms.txt
if defined LANGS (python scripts\mms_download.py --langs %LANGS%) else (python scripts\mms_download.py)
:done
echo.
echo Done. Start Aegis with start-local.bat, then open Settings ^> Voice (it lists the languages each engine speaks).
pause
