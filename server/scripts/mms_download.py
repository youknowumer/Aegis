"""Download Meta MMS voices for Aegis (Hugging Face / transformers format) into server/mms_models (or AEGIS_MMS_DIR).

    python scripts/mms_download.py                      # every language Aegis can speak (31 voices + Roman Urdu), about 150 MB each
    python scripts/mms_download.py --langs ur,en,hi,ar  # only these Aegis languages (add "roman" for Roman Urdu)
    python scripts/mms_download.py --codes eng,hin      # exact MMS codes
    python scripts/mms_download.py --all                # EVERY MMS-TTS checkpoint on the Hub: 1,100+ voices, roughly 160 GB
    python scripts/mms_download.py --list               # what the options above would fetch, nothing downloaded
    python scripts/mms_download.py --status             # what is installed and what is missing

Only the files a voice needs are fetched (config, tokenizer, weights as safetensors), not the duplicate pytorch_model.bin.
It is safe to stop and run again: finished voices are skipped and partial files resume.
Licence reminder: MMS checkpoints are CC-BY-NC 4.0, non-commercial use only (see app/mms.py).
"""
import argparse
import importlib.util
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import mms  # noqa: E402

APPROX_MB = mms.APPROX_MB
_have = mms._have
download = mms.download            # one voice into root/code: 'done', 'skipped' or an error text


def plan(args) -> list:
    """The MMS codes to fetch, in order, without duplicates."""
    if args.codes:
        wanted = [c.strip() for c in args.codes.split(",") if c.strip()]
    elif args.langs:
        wanted = []
        for lang in (x.strip().lower() for x in args.langs.split(",") if x.strip()):
            if lang in ("roman", "roman-urdu"):
                wanted.append(mms.ROMAN["ur"])
            elif lang in mms.CODES:
                wanted.append(mms.CODES[lang])
            else:
                print(f"Unknown language '{lang}'. Aegis languages with an MMS voice: {', '.join(sorted(mms.CODES))} (+ roman).")
                sys.exit(2)
    elif args.all:
        from huggingface_hub import HfApi

        wanted = sorted(m.id[len(mms.REPO_PREFIX):] for m in HfApi().list_models(author="facebook", search="mms-tts") if m.id.startswith(mms.REPO_PREFIX))
    else:
        wanted = list(mms.CODES.values()) + [mms.ROMAN["ur"]]
    seen, out = set(), []
    for c in wanted:
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out


def status(root: Path) -> None:
    have = {c for c in (p.name for p in root.iterdir() if p.is_dir() and _have(p))} if root.is_dir() else set()
    have |= set(mms.installed(force=True))
    print(f"Models folder: {root}")
    print("Python packages:", ", ".join(f"{m}={'yes' if importlib.util.find_spec(m) else 'NO'}" for m in ("torch", "transformers", "numpy", "uroman", "num2words")))
    print(f"Local voices ready: {'yes' if mms.ready() else 'no'}")
    ok = [f"{lang}" for lang, code in mms.CODES.items() if code in have]
    missing = [f"{lang}" for lang, code in mms.CODES.items() if code not in have]
    print(f"Installed ({len(ok)}): {', '.join(ok) or '-'}")
    print(f"Missing  ({len(missing)}): {', '.join(missing) or '-'}")
    print(f"Roman Urdu model: {'installed' if mms.ROMAN['ur'] in have else 'missing'}")
    print("Not available in MMS at all (the fallback voice speaks them): it, zh, ja, cs")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Download MMS voices for Aegis.")
    ap.add_argument("--langs", help="Aegis language codes, e.g. ur,en,hi,ar (add 'roman' for Roman Urdu)")
    ap.add_argument("--codes", help="MMS codes, e.g. eng,urd-script_arabic")
    ap.add_argument("--all", action="store_true", help="every MMS-TTS checkpoint on the Hub (about 160 GB)")
    ap.add_argument("--list", action="store_true", help="show what would be downloaded and stop")
    ap.add_argument("--status", action="store_true", help="show what is installed and stop")
    ap.add_argument("--dir", help="models folder (default: AEGIS_MMS_DIR or server/mms_models)")
    args = ap.parse_args(argv)

    root = Path(args.dir) if args.dir else mms.models_dir()
    if args.status:
        status(root)
        return 0
    codes = plan(args)
    todo = [c for c in codes if not _have(root / c)]
    print(f"{len(codes)} voices selected, {len(codes) - len(todo)} already installed, {len(todo)} to download (about {len(todo) * APPROX_MB / 1000:.1f} GB).")
    if args.list:
        print(", ".join(codes))
        return 0
    if not todo:
        return 0
    root.mkdir(parents=True, exist_ok=True)
    free_gb = shutil.disk_usage(root).free / 1e9
    need_gb = len(todo) * APPROX_MB / 1000
    if free_gb < need_gb * 1.1:
        print(f"Not enough free disk space in {root}: {free_gb:.1f} GB free, about {need_gb:.1f} GB needed.")
        return 1
    failed = []
    for i, code in enumerate(todo, 1):
        print(f"[{i}/{len(todo)}] {code} ...", flush=True)
        result = download(code, root)
        print(f"    {result}")
        if result not in ("done", "skipped"):
            failed.append((code, result))
    print(f"\nFinished. {len(todo) - len(failed)} downloaded, {len(failed)} failed.")
    for code, why in failed:
        print(f"  {code}: {why}")
    if not mms.deps_ok():
        print("\nNext: pip install -r requirements-mms.txt   (PyTorch and transformers are not installed yet)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
