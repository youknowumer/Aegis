@echo off
REM Runs Aegis (website + server) on this PC. Then open http://localhost:8000/app.html
REM Needs Python 3.10+ (python.org). First run installs packages (1-2 minutes).
cd /d "%~dp0server"
if not exist .venv (python -m venv .venv)
call .venv\Scripts\activate.bat
pip install -q -r requirements.txt
set AEGIS_ALLOW_LOCAL_PROVIDERS=1
set AEGIS_JWT_SECRET=change-me-to-any-long-random-text-123456789
REM Optional: put your Claude key here, or add it later in the app (Settings > AI provider)
REM set ANTHROPIC_API_KEY=sk-ant-...
start "" http://localhost:8000/app.html
python -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000
pause
