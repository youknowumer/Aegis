"""Download Piper voices for Aegis (ONNX, no PyTorch) into server/piper_models (or AEGIS_PIPER_DIR).

    python scripts/piper_download.py                     # the best voice for every Aegis language that Piper has
    python scripts/piper_download.py --langs en,es,de    # only these Aegis languages
    python scripts/piper_download.py --quality high      # prefer the high tier where it exists (bigger, slower, nicer)
    python scripts/piper_download.py --voices en_US-amy-medium,de_DE-thorsten-high   # exact voices
    python scripts/piper_download.py --list              # what would be fetched, nothing downloaded
    python scripts/piper_download.py --status            # what is installed, what Piper does not have (MMS / Edge speak those)

The choice is made from the live Piper voice list (voices.json), so a renamed or removed voice never breaks the install.
It is safe to stop and run again: finished voices are skipped, and a half-downloaded file is never kept.
Licence: every Piper voice has its own licence (see its MODEL_CARD on the voice page); check it before a commercial launch.
"""
import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import piper_engine as pe  # noqa: E402


def plan(args, index: dict) -> tuple:
    """(voice keys to fetch, Aegis languages Piper has no voice for)."""
    if args.voices:
        keys = [k.strip() for k in args.voices.split(",") if k.strip()]
        unknown = [k for k in keys if k not in index]
        if unknown:
            print(f"Not in the Piper voice list: {', '.join(unknown)}")
            sys.exit(2)
        return keys, []
    langs = [x.strip().lower() for x in args.langs.split(",") if x.strip() and x.strip().lower() not in ("roman", "roman-urdu")] if args.langs else list(pe.LANGS)
    bad = [x for x in langs if x not in pe.LANGS]
    if bad:
        print(f"Unknown language(s): {', '.join(bad)}. Aegis languages: {', '.join(pe.LANGS)}")
        sys.exit(2)
    keys, missing = [], []
    for lang in langs:
        key = pe.resolve(lang, index)
        (keys if key else missing).append(key or lang)
    seen, ordered = set(), []
    for k in keys:
        if k not in seen:
            seen.add(k)
            ordered.append(k)
    return ordered, missing


def size_mb(index: dict, key: str) -> float:
    files = (index.get(key) or {}).get("files", {})
    return sum(v.get("size_bytes", 0) for p, v in files.items() if p.endswith(".onnx")) / 1e6


def status(root: Path) -> None:
    have = pe.installed(force=True)
    print(f"Voices folder: {root}")
    print(f"Piper package: {'yes' if pe.deps_ok() else 'NO  (pip install -r requirements-piper.txt)'}; Piper ready: {'yes' if pe.ready() else 'no'}")
    print(f"Installed voices ({len(have)}): {', '.join(sorted(have)) or '-'}")
    covered = pe.languages()
    print(f"Aegis languages spoken by Piper ({len(covered)}): {', '.join(covered) or '-'}")
    print(f"Languages still on MMS / Edge ({len(pe.LANGS) - len(covered)}): {', '.join(l for l in pe.LANGS if l not in covered) or '-'}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Download Piper voices for Aegis.")
    ap.add_argument("--langs", help="Aegis language codes, e.g. en,es,de")
    ap.add_argument("--voices", help="exact Piper voice keys, e.g. en_US-amy-medium")
    ap.add_argument("--quality", choices=pe.QUALITY_ORDER, help="preferred tier (default: medium, or AEGIS_PIPER_QUALITY)")
    ap.add_argument("--list", action="store_true", help="show what would be downloaded and stop")
    ap.add_argument("--status", action="store_true", help="show what is installed and stop")
    ap.add_argument("--dir", help="voices folder (default: AEGIS_PIPER_DIR or server/piper_models)")
    args = ap.parse_args(argv)
    if args.quality:
        os.environ["AEGIS_PIPER_QUALITY"] = args.quality
    if args.dir:
        os.environ["AEGIS_PIPER_DIR"] = args.dir
    root = pe.models_dir()
    if args.status:
        status(root)
        return 0
    try:
        index = pe.load_index(force=True)
    except pe.PiperError as e:
        print(e)
        return 1
    keys, missing = plan(args, index)
    todo = [k for k in keys if not (root / f"{k}.onnx").is_file()]
    need = sum(size_mb(index, k) for k in todo)
    print(f"{len(keys)} voices selected, {len(keys) - len(todo)} already installed, {len(todo)} to download (about {need / 1000:.2f} GB).")
    if missing:
        print(f"Piper has no voice for: {', '.join(missing)} (MMS or the Edge voice speaks them).")
    if args.list:
        print(", ".join(keys))
        return 0
    if not todo:
        return 0
    root.mkdir(parents=True, exist_ok=True)
    import shutil
    free = shutil.disk_usage(root).free / 1e6
    if free < need * 1.1:
        print(f"Not enough free disk space in {root}: {free / 1000:.1f} GB free, about {need / 1000:.2f} GB needed.")
        return 1
    failed = []
    for i, key in enumerate(todo, 1):
        print(f"[{i}/{len(todo)}] {key} ({size_mb(index, key):.0f} MB) ...", flush=True)
        result = pe.download(key, index, root)
        print(f"    {result}")
        if result not in ("done", "skipped"):
            failed.append((key, result))
    print(f"\nFinished. {len(todo) - len(failed)} downloaded, {len(failed)} failed.")
    for key, why in failed:
        print(f"  {key}: {why}")
    if not pe.deps_ok():
        print("\nNext: pip install -r requirements-piper.txt   (the Piper engine is not installed yet)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
