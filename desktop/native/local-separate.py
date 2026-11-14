# Separate voice and music on this computer: Demucs v4 (htdemucs, Meta, MIT) on the GPU (Metal, or CUDA on a PC), or
# the CPU when the GPU fails. The model's own source files (pinned commit) sit in <models>/src, the weights in <models>/models.
# Audio in and out is raw 32-bit float, interleaved stereo at 44.1 kHz (the server converts with ffmpeg).
# Usage:
#   python local-separate.py --models <LocalSeparate dir> --input mix.f32 --voice voice.f32 --music music.f32 [--cpu]
#   python local-separate.py --models <LocalSeparate dir> --input mix.f32 --stems <dir> [--cpu]
#     --stems keeps all four parts the model hears (drums, bass, other, vocals) as 16-bit stereo WAVs at 44.1 kHz in
#     <dir> (drums.wav, bass.wav, other.wav, vocals.wav) for the song's score; --voice/--music may be given as well.
#   python local-separate.py --engine mlx --weights <dir> --input mix.f32 … (the same outputs)
#     the same model in Apple's MLX (demucs-mlx, MIT): faster on Apple silicon. <dir> holds htdemucs.safetensors and
#     htdemucs_config.json; nothing is ever downloaded from here. Run by its own environment's Python (no PyTorch
#     in it); the server falls back to the PyTorch engine when this one fails for any reason.
# Prints "STATUS"/"PROGRESS" lines; "ERROR <text>" and exit 1 on failure.
import argparse, os, sys, time, types

p = argparse.ArgumentParser()
p.add_argument("--input", required=True)
for a in ("models", "weights", "voice", "music", "stems"):
    p.add_argument("--" + a)
p.add_argument("--engine", choices=("torch", "mlx"), default="torch")
p.add_argument("--cpu", action="store_true")
args = p.parse_args()
if not args.stems and not (args.voice and args.music):
    p.error("give --voice and --music, or --stems")
if not (args.weights if args.engine == "mlx" else args.models):
    p.error("give --weights with --engine mlx, --models otherwise")


def say(kind, text):
    print(f"{kind} {text}", flush=True)


def fail(text):
    say("ERROR", text)
    sys.exit(1)


def write_out(names, stems):
    """`stems`: one float32 array (2, samples) per name, as the model gave them (clamped to -1…1 here, the music after its sum)."""
    import numpy as np

    if args.voice and args.music:
        voice = stems[names.index("vocals")]
        music = sum(stems[i] for i, n in enumerate(names) if n != "vocals")
        for part, dest in ((voice, args.voice), (music, args.music)):
            np.ascontiguousarray(np.clip(part, -1, 1).T, dtype=np.float32).tofile(dest)
    if args.stems:
        import wave

        os.makedirs(args.stems, exist_ok=True)
        for i, name in enumerate(names):
            pcm = (np.ascontiguousarray(np.clip(stems[i], -1, 1).T) * 32767.0).round().astype("<i2")
            tmp = os.path.join(args.stems, f".{name}.wav")
            with wave.open(tmp, "wb") as w:
                w.setnchannels(2)
                w.setsampwidth(2)
                w.setframerate(RATE)
                w.writeframes(pcm.tobytes())
            os.replace(tmp, os.path.join(args.stems, f"{name}.wav"))


RATE = 44100
t0 = time.time()


def separate_mlx():
    """Demucs v4 in MLX. Memory on a 16 GB Mac: one piece of the song at a time, MLX's memory and buffer cache capped, the cache emptied at the end."""
    for f in ("htdemucs.safetensors", "htdemucs_config.json"):
        if not os.path.isfile(os.path.join(args.weights, f)):
            fail("the fast separation model isn't on this Mac")
    # Offline, always: the weights are the app's own download (checked there), never fetched or converted from here.
    os.environ["DEMUCS_MLX_NO_DOWNLOAD"] = "1"
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["DEMUCS_MLX_CACHE_DIR"] = args.weights

    class Bar:
        """demucs-mlx walks the song in overlapping pieces behind a tqdm bar: PROGRESS lines instead."""

        def __init__(self, *_, total=None, **__):
            self.total, self.n = max(1, int(total or 1)), 0

        def update(self, n=1):
            self.n += n
            say("PROGRESS", f"{0.05 + 0.9 * min(1.0, self.n / self.total):.3f}")

        def close(self):
            pass

    tqdm = types.ModuleType("tqdm")
    tqdm.tqdm = Bar
    sys.modules["tqdm"] = tqdm

    say("STATUS", "loading the separation model")
    try:
        import numpy as np

        mix = np.fromfile(args.input, dtype=np.float32)
        if mix.size < RATE // 10:
            fail("the clip has no sound to separate")
        mix = mix.reshape(-1, 2).T.copy()
        import mlx.core as mx
        from demucs_mlx.api import Separator

        # MLX frees nothing until its memory limit is near, and its own limit is most of the Mac's memory: 3.5 GB was
        # in use for a 3-minute song, 1.8 GB with this one (room for the model at work, plus the song's own arrays).
        mx.set_memory_limit(MLX_ROOM + 8 * mix.nbytes)
        mx.set_cache_limit(MLX_CACHE)
        # seed: Demucs separates the song moved by a random bit of time (one «shift»); the same bit every time here, so
        # a song gives the same parts — and the same score — whenever it is separated again.
        separator = Separator(model="htdemucs", shifts=1, overlap=0.25, split=True, progress=True, batch_size=1, seed=0)
    except Exception as e:  # noqa: BLE001
        fail(f"the fast separation engine didn't start: {type(e).__name__}: {str(e)[:200]}")
    say("PROGRESS", "0.05")
    say("STATUS", f"separating {mix.shape[1] / RATE:.0f} s of sound")
    # As Demucs' own command line does (and the PyTorch engine below): separate the normalised mix, then scale back.
    ref = mix.mean(0)
    mean, std = float(ref.mean()), float(ref.std()) + 1e-8
    try:
        _, out = separator.separate_tensor((mix - mean) / std)
        names = list(out.keys())
        stems = [np.asarray(out[n], dtype=np.float32) * std + mean for n in names]
        del out, separator
        mx.clear_cache()
    except Exception as e:  # noqa: BLE001
        fail(f"the fast separation stopped: {type(e).__name__}: {str(e)[:200]}")
    if sorted(names) != ["bass", "drums", "other", "vocals"] or any(s.shape != mix.shape or not np.isfinite(s).all() for s in stems):
        fail("the fast separation gave a wrong answer")
    write_out(names, stems)
    say("STATUS", f"done in {time.time() - t0:.0f} s")
    say("PROGRESS", "1")


# Memory for the model at work (one 7.8 s piece of the song at a time), and the freed buffers MLX may keep for reuse
# (it has no limit of its own: tens of GB were seen on a big Mac).
MLX_ROOM = 1024 << 20
MLX_CACHE = 64 << 20
if args.engine == "mlx":
    separate_mlx()
    sys.exit(0)

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
# Only the training code of Demucs uses these two (configs and messages): stand-ins instead of two more packages.
omegaconf = types.ModuleType("omegaconf")
omegaconf.OmegaConf = None
dora = types.ModuleType("dora")
dora_log = types.ModuleType("dora.log")
dora_log.fatal = fail
sys.modules.setdefault("omegaconf", omegaconf)
sys.modules.setdefault("dora", dora)
sys.modules.setdefault("dora.log", dora_log)
# Open-Unmix (its Wiener filter) loads torchaudio for reading files, which the separation never does: not loaded at all.
sys.modules.setdefault("torchaudio", types.ModuleType("torchaudio"))
sys.path.insert(0, os.path.join(args.models, "src"))

say("STATUS", "loading the separation model")
try:
    import numpy as np
    import torch
    import demucs.apply as apply
    from demucs.states import load_model
except Exception as e:  # noqa: BLE001
    fail(f"the separation engine didn't start: {type(e).__name__}: {str(e)[:200]}")

mix = np.fromfile(args.input, dtype=np.float32)
if mix.size < RATE // 10:
    fail("the clip has no sound to separate")
mix = torch.from_numpy(mix.reshape(-1, 2).T.copy())

try:
    package = torch.load(os.path.join(args.models, "models", "htdemucs.th"), map_location="cpu", weights_only=False)
    model = load_model(package)
    model.eval()
except Exception as e:  # noqa: BLE001
    fail(f"the separation model didn't load: {type(e).__name__}: {str(e)[:200]}")
say("PROGRESS", "0.05")

seconds = mix.shape[1] / RATE


def progress(items, **_):
    """apply_model's progress bar → PROGRESS lines (it walks the clip in overlapping pieces)."""
    items = list(items)
    for i, item in enumerate(items):
        yield item
        say("PROGRESS", f"{0.05 + 0.9 * (i + 1) / max(1, len(items)):.3f}")


apply.tqdm = types.SimpleNamespace(tqdm=progress)

# As Demucs' own command line does: separate the normalised mix, then scale back.
ref = mix.mean(0)
mean, std = ref.mean(), ref.std() + 1e-8


def separate(device):
    with torch.no_grad():
        out = apply.apply_model(model, ((mix - mean) / std)[None], device=device, shifts=1, split=True, overlap=0.25, progress=True, num_workers=0)
    return out[0] * std + mean


device = "cpu" if args.cpu else "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
say("STATUS", f"separating {seconds:.0f} s of sound")
try:
    stems = separate(device)
except Exception as e:  # noqa: BLE001
    if device == "cpu":
        fail(f"the separation stopped: {type(e).__name__}: {str(e)[:200]}")
    say("STATUS", "separating on the processor")
    stems = separate("cpu")

names = list(model.sources)
write_out(names, [stems[i].float().contiguous().numpy() for i in range(len(names))])
say("STATUS", f"done in {time.time() - t0:.0f} s")
say("PROGRESS", "1")
