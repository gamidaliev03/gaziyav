# Voice changer on this Mac: the clip's speech in another voice with OpenVoice v2's tone colour converter (MyShell,
# MIT). The words, timing and intonation stay the clip's own; only the voice (timbre) becomes the target's. The
# converter's source files (pinned commit) sit in <models>/src, its weights in <models>/converter.
# Audio in and out is raw 32-bit float mono at 22.05 kHz (the server converts with ffmpeg); targets likewise.
# Usage:
#   python local-voicechange.py --models <LocalVoiceChange dir> --input speech.f32 --target ref1.f32[,ref2.f32] --out out.f32
#     [--tau 0.3]
# Prints "STATUS"/"PROGRESS" lines; "ERROR <text>" and exit 1 on failure.
import argparse, json, os, sys, time

p = argparse.ArgumentParser()
for a in ("models", "input", "target", "out"):
    p.add_argument("--" + a, required=True)
p.add_argument("--tau", type=float, default=0.3)
args = p.parse_args()


def say(kind, text):
    print(f"{kind} {text}", flush=True)


def fail(text):
    say("ERROR", text)
    sys.exit(1)


sys.path.insert(0, os.path.join(args.models, "src"))
t0 = time.time()
say("STATUS", "loading the voice model")
try:
    import numpy as np
    import torch
    from openvoice.models import SynthesizerTrn
except Exception as e:  # noqa: BLE001
    fail(f"the voice changer didn't start: {type(e).__name__}: {str(e)[:200]}")

cfg = json.load(open(os.path.join(args.models, "converter", "config.json")))
data = cfg["data"]
RATE, N_FFT, HOP, WIN = data["sampling_rate"], data["filter_length"], data["hop_length"], data["win_length"]
torch.set_num_threads(max(1, (os.cpu_count() or 4) - 2))
try:
    model = SynthesizerTrn(0, N_FFT // 2 + 1, n_speakers=data["n_speakers"], **cfg["model"])
    ckpt = os.path.join(args.models, "converter", "checkpoint.pth")
    try:
        state = torch.load(ckpt, map_location="cpu", weights_only=True)
    except Exception:  # noqa: BLE001 — an older checkpoint layout
        state = torch.load(ckpt, map_location="cpu", weights_only=False)
    model.load_state_dict(state["model"], strict=False)
    model.eval()
except Exception as e:  # noqa: BLE001
    fail(f"the voice model didn't load: {type(e).__name__}: {str(e)[:200]}")
say("PROGRESS", "0.05")

window = torch.hann_window(WIN)


def spectrogram(y):
    """OpenVoice's magnitude spectrogram (mel_processing.spectrogram_torch, center=False)."""
    y = torch.nn.functional.pad(y[None, None], ((N_FFT - HOP) // 2, (N_FFT - HOP) // 2), mode="reflect")[0]
    s = torch.stft(y, N_FFT, hop_length=HOP, win_length=WIN, window=window, center=False, pad_mode="reflect", normalized=False, onesided=True, return_complex=True)
    return torch.sqrt(s.real**2 + s.imag**2 + 1e-6)


def tone(samples):
    """The voice's tone colour (speaker embedding) from up to 30 s of it."""
    y = torch.from_numpy(samples[: RATE * 30].copy())
    with torch.no_grad():
        return model.ref_enc(spectrogram(y).transpose(1, 2)).unsqueeze(-1)


speech = np.fromfile(args.input, dtype=np.float32)
if speech.size < RATE // 4:
    fail("the clip has no speech to change")
targets = [np.fromfile(t, dtype=np.float32) for t in args.target.split(",") if t]
if not targets or any(t.size < RATE for t in targets):
    fail("the target voice's recording is too short")
src = tone(speech)
tgt = torch.stack([tone(t) for t in targets]).mean(0)
say("PROGRESS", "0.1")

# Long clips go in 20 s pieces that overlap by a quarter second and cross-fade (the converter works locally in time).
PIECE, OVER = RATE * 20, RATE // 4
out = np.zeros(speech.size, np.float32)
weight = np.zeros(speech.size, np.float32)
starts = list(range(0, max(1, speech.size - OVER), PIECE - OVER))
say("STATUS", f"changing the voice · {speech.size / RATE:.0f} s")
for i, a in enumerate(starts):
    b = min(speech.size, a + PIECE)
    y = torch.from_numpy(speech[a:b].copy())
    spec = spectrogram(y)
    with torch.no_grad():
        audio = model.voice_conversion(spec, torch.LongTensor([spec.shape[-1]]), sid_src=src, sid_tgt=tgt, tau=args.tau)[0][0, 0]
    audio = audio.float().numpy()[: b - a]
    ramp = np.ones(audio.size, np.float32)
    n = min(OVER, audio.size // 2)
    if a > 0:
        ramp[:n] = np.linspace(0, 1, n, dtype=np.float32)
    if b < speech.size:
        ramp[-n:] = np.linspace(1, 0, n, dtype=np.float32)
    out[a : a + audio.size] += audio * ramp
    weight[a : a + audio.size] += ramp
    say("PROGRESS", f"{0.1 + 0.88 * (i + 1) / len(starts):.3f}")
out = np.clip(out / np.maximum(weight, 1e-3), -1, 1).astype(np.float32)
out.tofile(args.out)
say("STATUS", f"done in {time.time() - t0:.0f} s")
say("PROGRESS", "1")
