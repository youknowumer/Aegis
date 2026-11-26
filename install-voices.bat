@echo off
REM Adds Aegis's local language voices (Meta MMS): Aegis then answers in the voice of the language you speak.
REM Needs Python 3.10+, internet once, about 5 GB of disk for all languages, and a non-commercial purpose (CC-BY-NC 4.0).
REM   install-voices.bat                    -> every language Aegis knows (31 + Roman Urdu)
REM   install-voices.bat --langs ur,en,roman -> only these
cd /d "%~dp0server"
if not exist .venv (python -m venv .venv)
call .venv\Scripts\activate.bat
pip install -q -r requirements.txt
pip install -r requirements-mms.txt
python scripts\mms_download.py %*
echo.
echo Done. Start Aegis with start-local.bat, then open Settings ^> Voice: it should say "Local language voices are on".
pause
