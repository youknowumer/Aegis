#!/usr/bin/env bash
# Adds Aegis's local language voices (Meta MMS): Aegis then answers in the voice of the language you speak.
# Optional pre-download: without it Aegis fetches each voice by itself the first time that language is spoken.
# Needs Python 3.10+, internet once, about 5 GB of disk for all languages, and a non-commercial purpose (CC-BY-NC 4.0).
#   ./install-voices.sh                     -> every language Aegis knows (31 + Roman Urdu)
#   ./install-voices.sh --langs ur,en,roman -> only these
set -e
cd "$(dirname "$0")/server"
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
pip install -q -r requirements.txt
# CPU-only PyTorch (the default Linux wheel carries several GB of GPU libraries you do not need here)
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements-mms.txt
python scripts/mms_download.py "$@"
echo
echo "Done. Start Aegis with ./start-local.sh, then open Settings > Voice: it should say 'Local language voices are on'."
