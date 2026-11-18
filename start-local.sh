#!/usr/bin/env bash
# Runs Aegis (website + server) on this machine. Then open http://localhost:8000/app.html
cd "$(dirname "$0")/server" || exit 1
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
pip install -q -r requirements.txt
export AEGIS_ALLOW_LOCAL_PROVIDERS=1 AEGIS_JWT_SECRET="${AEGIS_JWT_SECRET:-change-me-to-any-long-random-text-123456789}"
# export ANTHROPIC_API_KEY=sk-ant-...   # optional; or add the key in the app (Settings > AI provider)
python -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000
