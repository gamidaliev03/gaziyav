#!/usr/bin/env python3
"""The catalog of fonts that are not inside the app (src/fonts/remote-fonts.json).

The app carries a base set (the most used families, BASE below); every other bundled family is downloaded the first
time it is used (src/fonts/bundled.ts → /api/fonts → library/server/remote.ts). This script finds each family's file
on Google Fonts (its publisher, SIL OFL 1.1), downloads it, checks it has Cyrillic, and writes its size, SHA-256 and
the metrics the stand-in face needs (ascent, descent, line gap, the width against Golos Text) so a text laid out
before the file arrives doesn't jump when it does. The files are also staged for our Hugging Face dataset (Fonts/…).

  python3 scripts/font-catalog.py [stage dir]
"""
import hashlib
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from fontTools.ttLib import TTFont

HERE = Path(__file__).resolve().parent
WEB = HERE.parent
BUNDLED = WEB / "public" / "fonts" / "bundled"
OUT = WEB / "src" / "fonts" / "remote-fonts.json"
STAGE = Path(sys.argv[1]) if len(sys.argv) > 1 else WEB.parent.parent / "desktop" / "vendor" / "fonts-stage"
RAW = "https://raw.githubusercontent.com/google/fonts/main/ofl"

# The most used families across text presets and caption styles: they stay inside the app.
BASE = {"Montserrat", "Golos Text", "Inter", "Unbounded", "Rubik", "Manrope", "Oswald", "Jost"}
SAMPLE = "Съешь же ещё этих мягких французских булок, да выпей чаю. The quick brown fox jumps over the lazy dog 0123456789"


def families():
    src = (WEB / "src" / "fonts" / "bundled.ts").read_text()
    for m in re.finditer(r'family: "([^"]+)",\s*group: "([^"]+)",\s*faces: \[([^\]]+)\]', src):
        yield m.group(1), m.group(2), re.findall(r'v\("([^"]+)", "([^"]+)"\)', m.group(3))


def candidates(local: str):
    stem = local.rsplit(".", 1)[0]
    if stem.startswith("PT-"):
        yield stem.replace("PT-Sans", "PT_Sans").replace("PT-Serif", "PT_Serif") + ".ttf"
    yield local
    for axes in ("[wght]", "[opsz,wght]", "[wdth,wght]", "[CRSV,SHRP,slnt,wght]", "[slnt,wght]"):
        yield f"{stem}{axes}.ttf"
    if "-" not in stem:
        yield f"{stem}-Regular.ttf"


def fetch(url: str):
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            return r.read()
    except Exception:
        return None


def advance(font: TTFont, text: str) -> float:
    cmap = font.getBestCmap()
    hmtx = font["hmtx"].metrics
    widths = [hmtx[cmap[ord(c)]][0] for c in text if ord(c) in cmap and cmap[ord(c)] in hmtx]
    return sum(widths) / max(1, len(widths)) / font["head"].unitsPerEm


def metrics(font: TTFont) -> dict:
    upm = font["head"].unitsPerEm
    os2 = font["OS/2"]
    use_typo = bool(os2.fsSelection & (1 << 7))
    asc, desc, gap = (os2.sTypoAscender, -os2.sTypoDescender, os2.sTypoLineGap) if use_typo else (font["hhea"].ascent, -font["hhea"].descent, font["hhea"].lineGap)
    return {"ascent": round(asc / upm, 4), "descent": round(desc / upm, 4), "lineGap": round(gap / upm, 4)}


def main():
    golos = advance(TTFont(BUNDLED / "GolosText.ttf"), SAMPLE)
    out = {
        "_about": "Fonts downloaded on first use (src/fonts/bundled.ts): Google Fonts files with their size, SHA-256 and the metrics of the stand-in face. Made by scripts/font-catalog.py.",
        "license": "SIL Open Font License 1.1",
        "testOnly": False,
        "fonts": {},
    }
    for family, group, faces in families():
        if family in BASE:
            continue
        folder = re.sub(r"[^a-z0-9]", "", family.lower())
        rows = []
        for local, weight in faces:
            for name in candidates(local):
                url = f"{RAW}/{folder}/{urllib.parse.quote(name)}"
                data = fetch(url)
                if data:
                    break
            else:
                raise SystemExit(f"{family}: no file on Google Fonts for {local}")
            path = STAGE / "Fonts" / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            font = TTFont(path)
            cmap = font.getBestCmap()
            if not all(cp in cmap for cp in (0x416, 0x44F, 0x451)):
                raise SystemExit(f"{family}: {name} has no Cyrillic")
            rows.append({"file": name, "weight": weight, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "url": url, "hf": True})
        font = TTFont(STAGE / "Fonts" / rows[0]["file"])
        m = metrics(font)
        m["sizeAdjust"] = round(advance(font, SAMPLE) / golos, 4)
        out["fonts"][family] = {"group": group, "license": "SIL Open Font License 1.1", "faces": rows, "metrics": m}
        print(f"{family}: {', '.join(r['file'] for r in rows)} · {sum(r['bytes'] for r in rows) // 1024} KB · size {m['sizeAdjust']}")
    OUT.write_text(json.dumps(out, indent="\t", ensure_ascii=False) + "\n")
    print(f"{len(out['fonts'])} families → {OUT.relative_to(WEB)}")


main()
