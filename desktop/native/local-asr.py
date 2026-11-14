# Russian speech recognition on this Mac: GigaAM v3 (end-to-end RNN-T: words with punctuation and capitals, int8 ONNX)
# run by onnx-asr on ONNX Runtime. No network: the model is loaded from its folder (onnx-asr is installed without its
# Hugging Face extra and is never asked for anything that is not there).
# The model hears at most 25 s at once, so the caller gives the windows — cut at the pauses it already knows
# (transcribe/align.ts speechIslands): nothing here looks for speech, and GigaAM's own long-form path (pyannote, a
# Hugging Face token) is never needed.
# Usage:
#   python local-asr.py --models <LocalSpeechRu dir> --input speech.wav (16 kHz mono, 16-bit) --windows windows.json
#     --out words.json [--threads N] [--coreml]
#   windows.json: [[start, end], …] in seconds, each at most 25 s.
#   → words.json: {"words": [{"text", "start", "last", "end", "p"}, …], "seconds": <recognition time>}
#     start / last: when the word's first / last piece was heard (the engine marks pieces, not ends); end: a guess
# Prints "STATUS"/"PROGRESS" lines; "ERROR <text>" and exit 1 on failure.
import argparse, json, math, os, sys, time, wave

os.environ.setdefault("HF_HUB_OFFLINE", "1")

p = argparse.ArgumentParser()
for a in ("models", "input", "windows", "out"):
    p.add_argument("--" + a, required=True)
p.add_argument("--threads", type=int, default=0)
p.add_argument("--coreml", action="store_true")
args = p.parse_args()

MODEL = "gigaam-v3-e2e-rnnt"
FILES = ("v3_e2e_rnnt_encoder.int8.onnx", "v3_e2e_rnnt_decoder.int8.onnx", "v3_e2e_rnnt_joint.int8.onnx", "v3_e2e_rnnt_vocab.txt", "config.json")
MAX_WINDOW = 25.0
RATE = 16000


def say(kind, text):
    print(f"{kind} {text}", flush=True)


def fail(text):
    say("ERROR", text)
    sys.exit(1)


for name in FILES:
    if not os.path.isfile(os.path.join(args.models, name)):
        fail(f"the Russian speech model isn't installed ({name})")

import numpy as np  # noqa: E402
import onnxruntime as ort  # noqa: E402

ort.set_default_logger_severity(3)
import onnx_asr  # noqa: E402

t0 = time.time()
with wave.open(args.input, "rb") as w:
    if w.getframerate() != RATE or w.getnchannels() != 1 or w.getsampwidth() != 2:
        fail("the audio must be 16 kHz mono 16-bit")
    audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
with open(args.windows, encoding="utf-8") as f:
    windows = [(float(a), float(b)) for a, b in json.load(f)]
for a, b in windows:
    if not (0 <= a < b) or b - a > MAX_WINDOW + 0.01:
        fail(f"a window of {b - a:.1f} s (at most {MAX_WINDOW:.0f} s)")

say("STATUS", "Loading the speech model")
opts = ort.SessionOptions()
opts.log_severity_level = 3
if args.threads > 0:
    opts.intra_op_num_threads = args.threads
providers = (["CoreMLExecutionProvider"] if args.coreml else []) + ["CPUExecutionProvider"]
try:
    model = onnx_asr.load_model(MODEL, args.models, quantization="int8", sess_options=opts, providers=providers).with_timestamps()
except Exception as error:  # a damaged file, a missing kernel: the caller falls back to the other engine
    fail(f"the Russian speech model did not load: {error}")
loaded = time.time() - t0

# A token is a piece of a word; one that begins with a space begins a word, punctuation closes the word before it.
STEP = 0.04  # the model's frame: 10 ms × 4


def words_of(result, offset, limit):
    out = []
    tokens = result.tokens or []
    times = result.timestamps or []
    probs = result.logprobs or [None] * len(tokens)
    for token, at, logp in zip(tokens, times, probs):
        piece = token.strip()
        starts = token.startswith(" ") or not out
        if not piece:
            # a bare space: the next piece begins a word
            if out:
                out[-1]["closed"] = True
            continue
        punctuation = not any(ch.isalnum() for ch in piece)
        if punctuation and out:
            out[-1]["text"] += piece
            out[-1]["closed"] = True
            continue
        if starts or out[-1].get("closed"):
            out.append({"text": piece, "start": at, "last": at, "logp": [], "closed": False})
        else:
            out[-1]["text"] += piece
            out[-1]["last"] = at
        if logp is not None and not punctuation:
            out[-1]["logp"].append(float(logp))
    words = []
    for i, w in enumerate(out):
        start = min(limit, offset + w["start"])
        # a word lasts until the next one begins (the model marks beginnings), at most to a little past its last piece
        nxt = offset + out[i + 1]["start"] if i + 1 < len(out) else limit
        end = max(start + STEP, min(nxt, offset + w["last"] + 0.32, limit))
        word = {"text": w["text"], "start": round(start, 3), "last": round(min(limit, offset + w["last"]), 3), "end": round(end, 3)}
        if w["logp"]:
            word["p"] = round(max(1e-4, min(1.0, math.exp(sum(w["logp"]) / len(w["logp"])))), 3)
        words.append(word)
    return words


say("STATUS", "Recognizing speech")
t1 = time.time()
total = sum(b - a for a, b in windows) or 1.0
done = 0.0
words = []
BATCH = 4  # windows at once: enough to keep the cores busy, little enough for the memory and for the progress to move
order = sorted(range(len(windows)), key=lambda i: windows[i][1] - windows[i][0])
found = {}
for k in range(0, len(order), BATCH):
    ids = order[k : k + BATCH]
    pieces = [audio[int(windows[i][0] * RATE) : int(windows[i][1] * RATE)] for i in ids]
    try:
        results = model.recognize(pieces, sample_rate=RATE)
    except Exception as error:
        fail(f"recognition stopped: {error}")
    for i, result in zip(ids, results):
        found[i] = words_of(result, windows[i][0], windows[i][1])
        done += windows[i][1] - windows[i][0]
    say("PROGRESS", f"{min(1.0, done / total):.3f}")
for i in range(len(windows)):
    words.extend(found.get(i, []))

with open(args.out, "w", encoding="utf-8") as f:
    json.dump({"words": words, "seconds": round(time.time() - t1, 2), "load": round(loaded, 2), "providers": providers}, f, ensure_ascii=False)
say("STATUS", f"Done in {time.time() - t0:.1f} s")
