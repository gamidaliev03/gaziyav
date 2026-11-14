# On-device voice-over with a cloned voice: Qwen3-TTS 1.7B (8-bit; the bf16 release where an earlier version installed
# it) on MLX (Apple GPU). The ready-made voices are this model too, speaking from each voice's recording.
# Usage: python local-tts.py --home <LocalTTS dir> --ref sample.wav --ref-text "what the sample says" --lang russian --text "..." --out voice.wav
#        [--clone auto|full|timbre]
#        python local-tts.py --home <LocalTTS dir> --serve
#        (stays loaded for the next voice-overs: one JSON job per stdin line with the same fields — ref, ref_text, lang,
#        text, out, clone — each answered by "DONE 0" or "DONE 1"; "READY" once the model is loaded)
# Prints "STATUS"/"PROGRESS" lines; "ERROR <text>" and exit 1 (or "DONE 1") on failure.
#
# Two ways to clone: "full" learns from the sample and its words (in-context), so it copies the timbre AND the way the
# sample speaks — its accent. Translated into another language, that sounds like a Russian speaking English. "timbre"
# keeps only the voice print (the speaker embedding) and lets the model speak the target language natively. "auto"
# (the default) uses "full" when the sample is in the target language and "timbre" when it isn't.
import argparse, json, os, re, sys

p = argparse.ArgumentParser()
p.add_argument("--home", required=True)
for a in ("ref", "ref-text", "lang", "text", "out"):
    p.add_argument("--" + a)
p.add_argument("--clone", choices=("auto", "full", "timbre"), default="auto")
p.add_argument("--serve", action="store_true")
args = p.parse_args()
if not args.serve and not all((args.ref, args.ref_text, args.lang, args.text, args.out)):
    p.error("--ref, --ref-text, --lang, --text and --out are needed (or --serve)")

# A few very common words per Latin-script language: enough to tell the sample's language from its transcript.
COMMON = {
    "english": {"the", "and", "is", "you", "to", "of", "this", "that", "it", "we", "for", "with", "on", "are", "be"},
    "spanish": {"el", "la", "de", "que", "y", "en", "los", "es", "por", "una", "para", "con", "las", "del", "se"},
    "french": {"le", "la", "les", "de", "et", "est", "un", "une", "que", "pour", "dans", "pas", "vous", "nous", "je"},
    "german": {"der", "die", "und", "das", "ist", "nicht", "ich", "sie", "ein", "eine", "mit", "zu", "den", "es", "wir"},
    "italian": {"il", "di", "che", "e", "la", "per", "non", "un", "una", "sono", "con", "mi", "ti", "lo", "gli"},
    "portuguese": {"o", "de", "que", "e", "do", "da", "em", "um", "para", "com", "não", "uma", "os", "no", "na"},
}


def sample_language(text: str):
    """The language the sample speaks, from its transcript; None when it can't be told."""
    if re.search(r"[\u0400-\u04FF]", text):
        return "russian"
    if re.search(r"[\u3040-\u30FF]", text):
        return "japanese"
    if re.search(r"[\uAC00-\uD7AF]", text):
        return "korean"
    if re.search(r"[\u4E00-\u9FFF]", text):
        return "chinese"
    words = set(re.findall(r"[a-zà-ÿ']+", text.lower()))
    if not words:
        return None
    scores = {lang: len(words & common) for lang, common in COMMON.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] >= 2 else None


os.environ["HF_HOME"] = os.path.join(args.home, "hf-cache")
os.environ["HF_HUB_OFFLINE"] = "1"  # the model is already on this Mac
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

import numpy as np, soundfile as sf  # noqa: E402
from mlx_audio.tts.utils import load_model  # noqa: E402

print("STATUS loading the voice model", flush=True)
# The 8-bit model (same voice, smaller and faster) once all of it is here, else the bf16 one an earlier version downloaded
# (a Repair fetches the 8-bit files one by one into this folder: a half-there model is never picked).
REPOS = ["mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit", "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16"]
NEEDED = ("config.json", "model.safetensors", "model.safetensors.index.json", "tokenizer_config.json", "vocab.json", "merges.txt",
          "speech_tokenizer/config.json", "speech_tokenizer/model.safetensors")


def complete(repo):
    snaps = os.path.join(args.home, "hf-cache", "hub", "models--" + repo.replace("/", "--"), "snapshots")
    return os.path.isdir(snaps) and any(all(os.path.exists(os.path.join(snaps, rev, f)) for f in NEEDED) for rev in os.listdir(snaps))


repo = next((r for r in REPOS if complete(r)), REPOS[0])
try:
    model = load_model(repo)
except Exception as e:  # noqa: BLE001
    print(f"ERROR the local voice model isn't installed: {e}", flush=True)
    sys.exit(1)


class Failed(Exception):
    """A job that can't be done; its text goes to the ERROR line."""


# Sentence by sentence keeps long texts stable; the pieces are joined with a short natural pause. The sentences are
# voiced together in one batch when the model can (the full clone): ~1.3× faster, same voice (speaker similarity
# 0.992 either way); one by one otherwise, and whenever a batch fails.
BATCH = 8


def job(a):
    """One voice-over: the text in the sample's voice, written to a.out."""
    source = sample_language(a.ref_text)
    target = a.lang.strip().lower()
    timbre_only = a.clone == "timbre" or (a.clone == "auto" and source is not None and source != target)
    if timbre_only:
        print(f"STATUS keeping the voice, speaking {target} without the {source} accent", flush=True)
    parts = [s_.strip() for s_ in re.split(r"(?<=[.!?…])\s+", a.text.strip()) if s_.strip()] or [a.text]
    # Without the sample's words the model takes only the voice print and speaks the target language natively.
    ref_text = None if timbre_only else a.ref_text

    def one_by_one(texts):
        out = []
        for i, part in enumerate(texts):
            print(f"STATUS voicing sentence {i + 1} of {len(texts)}", flush=True)
            pieces = []
            for r in model.generate(text=part, ref_audio=a.ref, ref_text=ref_text, lang_code=a.lang, verbose=False):
                pieces.append(np.array(r.audio, dtype=np.float32).reshape(-1))
            out.append(pieces)
            print(f"PROGRESS {(i + 1) / len(texts):.3f}", flush=True)
        return out

    def together(texts):
        out = [[] for _ in texts]
        for k in range(0, len(texts), BATCH):
            chunk = texts[k:k + BATCH]
            print(f"STATUS voicing sentences {k + 1}–{k + len(chunk)} of {len(texts)} at once", flush=True)
            for r in model.batch_generate(texts=chunk, ref_audio=a.ref, ref_text=ref_text, lang_code=a.lang):
                out[k + r.sequence_idx].append(np.array(r.audio, dtype=np.float32).reshape(-1))
            print(f"PROGRESS {(k + len(chunk)) / len(texts):.3f}", flush=True)
        return out

    sr = model.sample_rate
    try:
        voiced = None
        if len(parts) > 1 and model.supports_tts_batch(ref_audio=a.ref, ref_text=ref_text):
            try:
                voiced = together(parts)
                if not all(sum(len(x) for x in v) for v in voiced):
                    voiced = None
            except Exception as e:  # noqa: BLE001 — the sentences one by one instead
                print(f"STATUS voicing sentence by sentence ({type(e).__name__})", flush=True)
                voiced = None
        if voiced is None:
            voiced = one_by_one(parts)
    except Exception as e:  # noqa: BLE001
        raise Failed(f"the voice model stopped: {type(e).__name__}: {str(e)[:200]}") from e
    audio = []
    for i, pieces in enumerate(voiced):
        audio += pieces
        if i < len(voiced) - 1:
            audio.append(np.zeros(int(sr * 0.12), np.float32))
    if not audio or not sum(len(x) for x in audio):
        raise Failed("the voice model returned no sound — try a shorter or simpler text")
    sf.write(a.out, np.concatenate(audio), sr)
    print("STATUS done", flush=True)


if not args.serve:
    try:
        job(args)
    except Failed as e:
        print(f"ERROR {e}", flush=True)
        sys.exit(1)
    sys.exit(0)
# Warm: the model stays loaded; the app sends the next voice-overs here and ends the process when it is idle.
print("READY", flush=True)
for line in sys.stdin:
    if not line.strip():
        continue
    try:
        req = json.loads(line)
        job(argparse.Namespace(clone=req.get("clone") or "auto", ref=req["ref"], ref_text=req["ref_text"], lang=req["lang"], text=req["text"], out=req["out"]))
        print("DONE 0", flush=True)
    except Failed as e:
        print(f"ERROR {e}", flush=True)
        print("DONE 1", flush=True)
    except Exception as e:  # noqa: BLE001 — a bad request never takes the warm model down
        print(f"ERROR the voice model stopped: {type(e).__name__}: {str(e)[:200]}", flush=True)
        print("DONE 1", flush=True)
