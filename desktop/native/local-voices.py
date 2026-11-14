# On-device voice-over with ready-made voices: Qwen3-TTS 1.7B CustomVoice (8-bit) on MLX (Apple GPU).
# Usage: python local-voices.py --home <LocalVoices dir> --speaker ryan --lang russian --text "..." [--style "calm"] --out voice.wav
# Prints "STATUS"/"PROGRESS" lines; "ERROR <text>" and exit 1 on failure.
import argparse, os, re, sys

p = argparse.ArgumentParser()
for a in ("home", "speaker", "lang", "text", "out"):
    p.add_argument("--" + a, required=True)
p.add_argument("--style", default="")
args = p.parse_args()
os.environ["HF_HOME"] = os.path.join(args.home, "hf-cache")
os.environ["HF_HUB_OFFLINE"] = "1"  # the model is already on this Mac
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

import numpy as np, soundfile as sf  # noqa: E402
from mlx_audio.tts.utils import load_model  # noqa: E402

print("STATUS loading the voices", flush=True)
try:
    model = load_model("mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit")
except Exception as e:  # noqa: BLE001
    print(f"ERROR the voices aren't installed: {e}", flush=True)
    sys.exit(1)

parts = [s.strip() for s in re.split(r"(?<=[.!?…])\s+", args.text.strip()) if s.strip()] or [args.text]
audio, sr = [], 24000
try:
    for i, part in enumerate(parts):
        print(f"STATUS voicing sentence {i + 1} of {len(parts)}", flush=True)
        kw = {"text": part, "speaker": args.speaker, "language": args.lang.capitalize()}
        if args.style.strip():
            kw["instruct"] = args.style.strip()[:200]
        for r in model.generate_custom_voice(**kw):
            audio.append(np.array(r.audio, dtype=np.float32).reshape(-1))
            sr = r.sample_rate
        if i < len(parts) - 1:
            audio.append(np.zeros(int(sr * 0.12), np.float32))
        print(f"PROGRESS {(i + 1) / len(parts):.3f}", flush=True)
except Exception as e:  # noqa: BLE001
    print(f"ERROR the voice model stopped: {type(e).__name__}: {str(e)[:200]}", flush=True)
    sys.exit(1)
if not audio or not sum(len(a) for a in audio):
    print("ERROR no sound came out — try a shorter or simpler text", flush=True)
    sys.exit(1)
sf.write(args.out, np.concatenate(audio), sr)
print("STATUS done", flush=True)
