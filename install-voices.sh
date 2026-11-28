#!/usr/bin/env bash
# Adds Aegis's local language voices. Aegis then answers in the voice of the language you speak.
#   Piper (new, light, natural, no PyTorch, about 1 GB for ~25 languages) goes first
#   Meta MMS (31 languages incl. Urdu, Punjabi, Tamil; about 5 GB; PyTorch) is the second choice
# Optional pre-download: without it Aegis fetches each voice by itself the first time that language is spoken.
# Needs Python 3.10+ and internet once. MMS voices are non-commercial (CC-BY-NC 4.0); each Piper voice has its own licence.
#   ./install-voices.sh                       -> Piper + MMS for every language Aegis knows
#   ./install-voices.sh --langs ur,en,roman   -> only these ("roman" is Roman Urdu, an MMS voice)
#   ./install-voices.sh --piper-only          -> Piper only (small, fast)
#   ./install-voices.sh --high                -> prefer Piper's high-quality tier
set -e
cd "$(dirname "$0")/server"
PIPER_ONLY=0; PIPER_ARGS=(); MMS_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --piper-only) PIPER_ONLY=1;;
    --high) PIPER_ARGS+=(--quality high);;
    --langs) MMS_ARGS+=(--langs "$2"); l=$(echo "$2" | sed -E 's/(^|,)(roman-urdu|roman)(,|$)/\1\3/g;s/^,//;s/,$//;s/,,/,/g'); [ -n "$l" ] && PIPER_ARGS+=(--langs "$l"); shift;;
    *) PIPER_ARGS+=("$1"); MMS_ARGS+=("$1");;
  esac
  shift
done
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
pip install -q -r requirements.txt
pip install -q -r requirements-piper.txt
python scripts/piper_download.py "${PIPER_ARGS[@]}"
if [ "$PIPER_ONLY" = 0 ]; then
  # CPU-only PyTorch (the default Linux wheel carries several GB of GPU libraries you do not need here)
  pip install torch --index-url https://download.pytorch.org/whl/cpu
  pip install -r requirements-mms.txt
  python scripts/mms_download.py "${MMS_ARGS[@]}"
fi
echo
echo "Done. Start Aegis with ./start-local.sh, then open Settings > Voice (it lists the languages each engine speaks)."
echo "Check any time:  python scripts/piper_download.py --status   and   python scripts/mms_download.py --status"
