# Beats and bar starts of a song by a network, on this computer: Beat This! (CPJKU, MIT; the `final0` model) on the
# GPU (Metal), or the processor when the GPU refuses. Run by the separation model's own Python (PyTorch is there); the
# three small packages it adds (beat_this, rotary_embedding_torch, soxr) sit in --site, the weights in one safetensors
# file (--weights: plain numbers under names, read here by hand — nothing in it can run code; the authors' own file is
# a PyTorch checkpoint, converted on install by local-beats-convert.py). Nothing is ever downloaded from here.
# Usage:
#   python -I local-beats.py --weights beat_this-final0.safetensors --site <site-packages> --input mono.f32 --out beats.json [--cpu]
#     mono.f32: raw 32-bit float, one channel, 22.05 kHz (the server converts with ffmpeg)
#     beats.json: {"beats": [s…], "downbeats": [s…], "device": "mps" | "cpu", "seconds": song length}
#     (the network answers in frames of 20 ms: the server sets each beat on the drum hit it names)
# Prints "STATUS"/"PROGRESS" lines; "ERROR <text>" and exit 1 on failure.
import argparse, inspect, json, os, struct, sys, time

p = argparse.ArgumentParser()
for a in ("weights", "site", "input", "out"):
    p.add_argument("--" + a, required=True)
p.add_argument("--cpu", action="store_true")
args = p.parse_args()


def say(kind, text):
    print(f"{kind} {text}", flush=True)


def fail(text):
    say("ERROR", text)
    sys.exit(1)


# Offline, always.
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TORCH_HOME"] = os.path.join(os.path.dirname(os.path.abspath(args.out)), ".no-torch-hub")
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
sys.path.append(args.site)
RATE = 22050
t0 = time.time()
say("STATUS", "loading the beat model")
try:
    import numpy as np
    import torch
    from beat_this.inference import split_predict_aggregate
    from beat_this.model.beat_tracker import BeatThis
    from beat_this.model.postprocessor import Postprocessor
    from beat_this.preprocessing import LogMelSpect
except Exception as e:  # noqa: BLE001
    fail(f"the beat engine didn't start: {type(e).__name__}: {str(e)[:200]}")

KINDS = {"F32": np.float32, "F64": np.float64, "F16": np.float16, "I64": np.int64, "I32": np.int32, "BOOL": np.bool_}


def read_weights(path):
    """A safetensors file: 8 bytes of header length, a JSON header (name → dtype, shape, byte range), the raw numbers."""
    with open(path, "rb") as f:
        (n,) = struct.unpack("<Q", f.read(8))
        if not 2 <= n <= 4_000_000:
            raise ValueError("not a safetensors file")
        header = json.loads(f.read(n))
        data = f.read()
    meta = header.pop("__metadata__", {})
    state = {}
    for name, t in header.items():
        a, b = t["data_offsets"]
        count = int(np.prod(t["shape"])) if t["shape"] else 1
        if not 0 <= a <= b <= len(data) or (b - a) != count * np.dtype(KINDS[t["dtype"]]).itemsize:
            raise ValueError(f"a wrong size for {name}")
        state[name] = torch.from_numpy(np.frombuffer(data, dtype=KINDS[t["dtype"]], count=count, offset=a).reshape(t["shape"]).copy())
    return state, json.loads(meta.get("hyper_parameters", "{}"))


try:
    state, hyper = read_weights(args.weights)
    known = set(inspect.signature(BeatThis).parameters)
    model = BeatThis(**{k: v for k, v in hyper.items() if k in known})
    model.load_state_dict(state)
    model.eval()
    del state
except Exception as e:  # noqa: BLE001
    fail(f"the beat model didn't load: {type(e).__name__}: {str(e)[:200]}")
say("PROGRESS", "0.1")

signal = np.fromfile(args.input, dtype=np.float32)
if signal.size < RATE:
    fail("the song is too short to find its beat")
seconds = signal.size / RATE


def run(device):
    net = model.to(device)
    spect = LogMelSpect(device=device)(torch.from_numpy(signal).to(device))
    with torch.inference_mode():
        # as beat_this' own Audio2Beats does: pieces of 30 s, 6 frames of border, the first answer kept where they overlap
        pred = split_predict_aggregate(spect=spect, chunk_size=1500, overlap_mode="keep_first", border_size=6, model=net)
    beats, downbeats = Postprocessor(type="minimal")(pred["beat"].float().cpu(), pred["downbeat"].float().cpu())
    return [round(float(t), 3) for t in beats], [round(float(t), 3) for t in downbeats]


device = "cpu" if args.cpu or not torch.backends.mps.is_available() else "mps"
say("STATUS", f"finding the beat of {seconds:.0f} s of sound")
try:
    beats, downbeats = run(device)
except Exception as e:  # noqa: BLE001
    if device == "cpu":
        fail(f"the beat model stopped: {type(e).__name__}: {str(e)[:200]}")
    say("STATUS", "finding the beat on the processor")
    device = "cpu"
    try:
        beats, downbeats = run(device)
    except Exception as e2:  # noqa: BLE001
        fail(f"the beat model stopped: {type(e2).__name__}: {str(e2)[:200]}")
if any(not (0 <= t <= seconds + 1) for t in beats + downbeats) or beats != sorted(beats) or downbeats != sorted(downbeats):
    fail("the beat model gave a wrong answer")
tmp = args.out + ".part"
with open(tmp, "w") as f:
    json.dump({"beats": beats, "downbeats": downbeats, "device": device, "seconds": round(seconds, 3)}, f)
os.replace(tmp, args.out)
say("STATUS", f"done in {time.time() - t0:.1f} s")
say("PROGRESS", "1")
