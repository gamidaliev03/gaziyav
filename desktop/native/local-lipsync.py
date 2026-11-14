# On-device lipsync: MuseTalk 1.5 on Metal (MPS) + Apple Vision landmarks (lipmarks helper) + a guarded blend.
# Usage: python local-lipsync.py --root <musetalk dir> --lipmarks <bin> --video in.mp4 --audio speech.wav --out out.mp4
#        [--ffmpeg path] [--report out.json] [--edge-frames 3] [--proof dir]
# Prints "STATUS <text>" and "PROGRESS <0..1>" lines; exits non-zero with "ERROR <text>" on failure.
#
# Glitch guards (--proof writes before/after crops and numbers for each of them):
#  ghost mouth — generated pixels cover the UNION of the original and the generated mouths (face parsing of both), and
#                the skin-tone correction is measured outside both mouths, so no halo of the old mouth is left;
#  chin / jaw  — below the mouth the mask is the union of both chins, and the original skin texture is kept only where
#                both faces agree, so there is no double jaw line;
#  hands       — Apple Vision hand joints (and non-face things inside the jaw, e.g. a microphone) stay original;
#  fallback    — side profile, heavy blur, a tiny face or no face → the original frames with a short crossfade; the ranges
#                go into the report so the app can list them;
#  seams       — the mask stays inside the generated square, is feathered to the face size, colour is matched by
#                normalised convolution;
#  edges       — the first and last frames of the piece crossfade from the original (--edge-frames, default 3);
#  other face  — Vision reports one face a frame and with two people sometimes the other one: those frames count as
#                missed (filled from the same face around them), a lasting switch is a cut (nothing smoothed across it).
# Mouth (--lips): the person's own lip colour and lip texture carried onto the new lip shape, lip edges and teeth raised
# to the person's own crispness, teeth as bright as in this clip's open mouths, stubble continued into the place of the
# old mouth (mirrored from around it).
# AI disclosure: every frame carries a small "AI-generated" plate, bottom-right inside the 5 % safe margin, 2.5 % of the
# frame height (drawn by lipmarks --plate), burned in during the one and only encode.
#
# Speed (M1 Pro, 6 s clip: 142 s before this engine), every step checked against the full-precision result:
#  - Apple Vision reads the face while the models load; the UNet loads from a half-precision copy of its weights;
#  - face latents: one half-precision VAE pass per batch (masked + reference faces together, 73 dB from fp32), and
#    they are kept for recent clips, so the same clip with another voice or language skips this step;
#  - mouths: the VAE decodes only the lower 3/4 of the face (the forehead is never pasted; 45 dB), in half precision;
#  - the blend runs on the CPU cores while the GPU generates the next batch, frames reach the encoder in order;
#  - frames that keep the original face (side profile, no face…) aren't generated at all.
# Smoothness: the generated faces are filtered over time where they barely change between frames (texture shimmer),
# never where the lips move (motion-adaptive weights).
# Cool and quiet: frames on disk (memmap), h264_videotoolbox, a low-priority process (the app runs it with nice).
import argparse, collections, json, os, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

p = argparse.ArgumentParser()
for a in ("root", "lipmarks", "video", "audio", "out"):
    p.add_argument("--" + a, required=True)
p.add_argument("--ffmpeg", default="ffmpeg")
p.add_argument("--report")
p.add_argument("--proof")
p.add_argument("--edge-frames", type=int, default=3)
p.add_argument("--batch", type=int, default=0, help="frames per GPU batch (0: by the memory of this Mac)")
p.add_argument("--smooth", type=float, default=1.0, help="temporal smoothing of the generated faces (0 = off)")
p.add_argument("--texture", type=int, default=1, help="real skin texture up to the lips (0 = only outside the ghost guard)")
p.add_argument("--crisp", type=float, default=1.0, help="how far the mouth detail may be raised to the clip's sharpness (0 = off, 1 = up to ×2)")
p.add_argument("--lips", type=float, default=1.0, help="the person's own lip colour and sharpness, brighter teeth (0 = off)")
p.add_argument("--mark-text", default="AI-generated")
p.add_argument("--mouths", help="developer: cache of the generated mouths (.npy) — reused if it exists, to iterate on the blend")
p.add_argument("--no-face-cache", action="store_true", help="developer: don't reuse or keep the face latents of this clip")
args = p.parse_args()
# Paths are resolved before we chdir into the model folder.
for a in ("root", "lipmarks", "video", "audio", "out"):
    setattr(args, a, os.path.abspath(getattr(args, a)))
for a in ("proof", "report", "mouths"):
    if getattr(args, a):
        setattr(args, a, os.path.abspath(getattr(args, a)))
FF = args.ffmpeg
FPS = 25
T0 = time.time()
timing = {}
ENGINE = 3  # face latents kept by an older engine are not reused


def say(kind, text):
    print(f"{kind} {text}", flush=True)


# Progress is weighted by the measured time of each stage on an M1 Pro (prepare 2 %, face + models 8 %, face latents
# 25 %, mouths + blend 65 %), so the app can turn it into a remaining-time estimate.
def progress(v):
    say("PROGRESS", f"{max(0.0, min(1.0, v)):.3f}")


tmp = []  # temp files, removed at the end and on failure


def cleanup():
    for f in tmp:
        try:
            os.remove(f)
        except OSError:
            pass


def fail(text):
    cleanup()
    say("ERROR", text)
    sys.exit(1)


def lap(name, since):
    timing[name] = round(time.time() - since, 2)
    return time.time()


os.chdir(args.root)
sys.path.insert(0, os.path.join(args.root, "src"))
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
# The face-parsing weights (official MuseTalk download) are in the legacy .tar format that torch 2.6 refuses by default.
os.environ.setdefault("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD", "1")
work = os.path.dirname(os.path.abspath(args.out))
stem = os.path.join(work, "." + os.path.basename(args.out))  # per-job temp names: two jobs never collide

# MARK: 1. A 25 fps copy (hardware encoder) so frames, landmarks and audio chunks line up.
t = time.time()
say("STATUS", "preparing the video")
progress(0.0)
src = stem + ".src25.mp4"
wav = stem + ".speech16k.wav"
tmp += [src, wav]
r = subprocess.run([FF, "-y", "-v", "error", "-i", args.video, "-an", "-vf", f"fps={FPS}", "-c:v", "h264_videotoolbox", "-b:v", "24M",
                    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", src], capture_output=True, text=True)
if r.returncode:
    fail("couldn't read the video: " + r.stderr.strip()[-300:])
r = subprocess.run([FF, "-y", "-v", "error", "-i", args.audio, "-ac", "1", "-ar", "16000", wav], capture_output=True, text=True)
if r.returncode:
    fail("couldn't read the speech: " + r.stderr.strip()[-300:])
t = lap("prepare", t)
progress(0.02)

# MARK: 2. Landmarks, head pose and hands with Apple Vision (Neural Engine) — while the models load on the GPU.
say("STATUS", "finding the face (Apple Vision) and loading the model")
marks_file, vision_log = stem + ".marks.json", stem + ".vision.log"
tmp += [marks_file, vision_log]
with open(marks_file, "w") as out_fh, open(vision_log, "w") as err_fh:
    vision = subprocess.Popen([args.lipmarks, src], stdout=out_fh, stderr=err_fh)

import cv2, numpy as np, torch  # noqa: E402

torch.set_num_threads(4)  # leave cores free and keep the Mac cool
cv2.setNumThreads(2)  # the blend runs on several threads already
dev = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
half = torch.float16 if dev.type == "mps" else torch.float32
cached = bool(args.mouths and os.path.exists(args.mouths))
try:
    BIG_MAC = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") >= 15e9
except (AttributeError, ValueError, OSError):
    BIG_MAC = True
BATCH = args.batch or (16 if BIG_MAC else 8)  # 8 GB Macs: smaller batches, same speed per frame


def load_unet():
    """MuseTalk's UNet in half precision. The download is fp32 (3.4 GB); the first job keeps a half-precision copy (1.7 GB,
    exactly what runs on the GPU, so not a bit of the result changes) and removes the original: loads in ~1 s, not ~8."""
    from diffusers import UNet2DConditionModel
    from safetensors.torch import load_file, save_file

    folder = os.path.join("models", "musetalkV15")
    compact, full = os.path.join(folder, "unet.fp16.safetensors"), os.path.join(folder, "unet.pth")
    with open(os.path.join(folder, "musetalk.json")) as fh:
        config = json.load(fh)
    if half == torch.float16 and not os.path.exists(compact) and os.path.exists(full):
        try:
            state = torch.load(full, map_location="cpu", mmap=True, weights_only=True)
            save_file({k: v.to(half).contiguous() for k, v in state.items()}, compact + ".part")
            del state
            os.replace(compact + ".part", compact)
        except Exception as e:  # noqa: BLE001 — the original weights still work
            print(f"STATUS keeping the original model weights ({type(e).__name__})", flush=True)
            try:
                os.remove(compact + ".part")
            except OSError:
                pass
    if half == torch.float16 and os.path.exists(compact):
        try:
            with torch.device("meta"):  # no random init of 860 M weights: they are replaced right away
                model = UNet2DConditionModel(**config)
            model.load_state_dict(load_file(compact), strict=True, assign=True)
            if any(t_.is_meta for t_ in list(model.parameters()) + list(model.buffers())):
                raise RuntimeError("weights missing")
            model = model.to(dev, half).eval()
            if os.path.exists(full):
                os.remove(full)
            return model
        except Exception as e:  # noqa: BLE001
            print(f"STATUS loading the original model weights ({type(e).__name__})", flush=True)
            if not os.path.exists(full):
                raise
    model = UNet2DConditionModel(**config)
    model.load_state_dict(torch.load(full, map_location="cpu", mmap=True, weights_only=True))
    return model.to(dev, half).eval()


from musetalk.utils.face_parsing import FaceParsing  # noqa: E402

fp = FaceParsing(left_cheek_width=90, right_cheek_width=90)
parser = fp.net.to(dev, half).eval()  # BiSeNet face parsing on the GPU (same labels in half precision)
MEAN = torch.tensor([0.485, 0.456, 0.406], device=dev).view(1, 3, 1, 1)
STD = torch.tensor([0.229, 0.224, 0.225], device=dev).view(1, 3, 1, 1)
if not cached:
    from diffusers import AutoencoderKL
    from transformers import WhisperModel
    from musetalk.models.unet import PositionalEncoding
    from musetalk.utils.audio_processor import AudioProcessor

    unet = load_unet()
    vae = AutoencoderKL.from_pretrained(os.path.join("models", "sd-vae")).to(dev, half).eval()
    SF = vae.config.scaling_factor
    pe = PositionalEncoding(d_model=384).to(dev, half)
    ap = AudioProcessor(feature_extractor_path="models/whisper")
    whisper = WhisperModel.from_pretrained("models/whisper").to(dev, half).eval()
    whisper.requires_grad_(False)
    ts = torch.tensor([0], device=dev)
t = lap("load", t)
progress(0.08)

if vision.wait():
    with open(vision_log) as fh:
        fail("couldn't analyse the face: " + (fh.read().strip()[-300:] or "lipmarks failed"))
with open(marks_file) as fh:
    marks = json.load(fh)
W, H, M = marks["w"], marks["h"], marks["frames"]
if not any(M):
    fail("no face found in this clip — pick a piece where the face is clearly visible")
t = lap("landmarks", t)
progress(0.1)


def read_frames(path):
    proc = subprocess.Popen([FF, "-v", "error", "-hwaccel", "videotoolbox", "-i", path, "-vf", "scale=in_color_matrix=bt709:in_range=tv,format=bgr24",
                             "-f", "rawvideo", "-"], stdout=subprocess.PIPE)
    size = W * H * 3
    while True:
        buf = proc.stdout.read(size)
        if len(buf) < size:
            break
        yield np.frombuffer(buf, np.uint8).reshape(H, W, 3)
    proc.wait()


# Frames live in a memory-mapped file, not in RAM: a 4K clip would otherwise need gigabytes.
store = stem + ".frames.u8"
tmp.append(store)
frames = np.memmap(store, np.uint8, "w+", shape=(len(M) + 4, H, W, 3))
count = 0
for f in read_frames(src):
    if count >= len(frames):
        break
    frames[count] = f
    count += 1
N = min(count, len(M))
if N == 0:
    fail("couldn't decode the video")
M = M[:N]


# MARK: 3. Which frames can be lipsynced: short Vision misses are filled, profile / blur / tiny / no face fall back.
def nearest_valid(i, valid):
    for d in range(1, len(valid)):
        for k in (i - d, i + d):
            if 0 <= k < len(valid) and valid[k]:
                return k
    return None


def spot(m):
    """Centre and size of Vision's face box."""
    x, y, bw_, bh_ = m["box"]
    return np.array([x + bw_ / 2, y + bh_ / 2]), max(bw_, bh_, 8.0)


def same_face(m1, m2, frames=1):
    """Whether two Vision faces `frames` apart can be the same face: it moved less than half its size (a little more
    over a longer gap) and didn't change size abruptly."""
    (c1, s1_), (c2, s2_) = spot(m1), spot(m2)
    return float(np.linalg.norm(c1 - c2)) <= (0.5 + 0.06 * (frames - 1)) * max(s1_, s2_) and 0.6 < s1_ / s2_ < 1.67


# One face, followed. Apple Vision reports one face per frame, and with two people in the picture it sometimes reports
# the other one for a frame or a few: the mouth would be drawn on the wrong person, or (the face square is smoothed over
# five frames) half-way between them. A jump that comes back within half a second is not this face — those frames count
# as missed; a jump that stays is a cut to another face (nothing is smoothed or filled across it); a run shorter than a
# fifth of a second (a flash of another face) is dropped.
cuts = set()
foreign = 0
track = None
i = 0
while i < N:
    if M[i] is None:
        i += 1
        continue
    if track is None or same_face(M[i], track):
        track = M[i]
        i += 1
        continue
    back = next((k for k in range(i + 1, min(N, i + 13)) if M[k] is not None and same_face(M[k], track, k - i + 1)), None)
    if back is not None:
        for k in range(i, back):
            if M[k] is not None:
                M[k] = None
                foreign += 1
        i = back
    else:
        cuts.add(i)
        track = M[i]
        i += 1
runs = sorted(cuts | {0, N})
for r0, r1 in zip(runs, runs[1:]):
    if 0 < sum(M[k] is not None for k in range(r0, r1)) < 6 and r1 - r0 < 6:
        for k in range(r0, r1):
            if M[k] is not None:
                M[k] = None
                foreign += 1
        cuts.discard(r0)
if foreign:
    print(f"STATUS skipped {foreign} frames where Vision saw another face", flush=True)


def between(ma, mb, t):
    """Vision's face part way (t) from frame ma to frame mb: points, box and pose interpolated (hands: the nearer frame's)."""
    out = dict(ma if t < 0.5 else mb)
    for key, va in ma.items():
        vb = mb.get(key)
        if isinstance(va, (int, float)) and isinstance(vb, (int, float)):
            out[key] = va + (vb - va) * t
        elif key in ("outer", "inner", "contour", "nose", "crest", "leye", "reye", "box") and isinstance(vb, list) and len(va) == len(vb) and len(va):
            out[key] = (np.array(va, np.float64) + (np.array(vb, np.float64) - np.array(va, np.float64)) * t).tolist()
    return out


has = [m is not None for m in M]
for i in range(N):
    if not has[i]:
        a = next((k for k in range(i - 1, -1, -1) if has[k]), None)
        b = next((k for k in range(i + 1, N) if has[k]), None)
        if a is None or b is None or any(a < c <= b for c in cuts):
            continue
        if b - a - 1 <= 2:  # Vision missed one or two frames
            M[i] = M[a] if i - a <= b - i else M[b]
        elif b - a - 1 <= 6 and same_face(M[a], M[b], b - a):  # a few frames of another face: the same face, moved
            M[i] = between(M[a], M[b], (i - a) / (b - a))


def lip_box(m, pad=0.6):
    pts = np.array(m["outer"], np.float32)
    x0, y0 = pts.min(0)
    x1, y1 = pts.max(0)
    w = max(8.0, x1 - x0)
    return int(max(0, x0 - w * pad)), int(max(0, y0 - w * pad)), int(min(W, x1 + w * pad)), int(min(H, y1 + w * pad))


def sharpness(f, m):
    """Laplacian variance of the mouth area, resized to a fixed width (resolution-independent)."""
    x0, y0, x1, y1 = lip_box(m)
    if x1 - x0 < 4 or y1 - y0 < 4:
        return 0.0
    g = cv2.cvtColor(np.ascontiguousarray(f[y0:y1, x0:x1]), cv2.COLOR_BGR2GRAY)
    g = cv2.resize(g, (96, max(8, int(96 * (y1 - y0) / (x1 - x0)))), interpolation=cv2.INTER_AREA)
    return float(cv2.Laplacian(g, cv2.CV_32F).var())


def turned(m):
    """A real side profile only. Talking heads are often turned 20–35° and lipsync well, so Vision's yaw must pass
    ~45° (or pitch ~55°), or the nose must sit near the jaw's edge AND the yaw agree."""
    yaw, pitch = abs(m.get("yaw", 0)), abs(m.get("pitch", 0))
    if yaw > 0.8 or pitch > 0.95:
        return True
    xs = [x for x, _ in m["contour"]]
    crest = m["crest"] or m["nose"]
    if len(xs) >= 4 and crest:
        nx = sum(x for x, _ in crest) / len(crest)
        r = (nx - min(xs)) / max(1.0, max(xs) - min(xs))
        return abs(r - 0.5) > 0.36 and yaw > 0.45
    return False


def hand_cover(i, m):
    """Share of the mouth hidden behind a hand (Vision joints, grown to finger width)."""
    pts = []
    for k in (i - 1, i, i + 1):
        if 0 <= k < N and marks["frames"][k]:
            pts += marks["frames"][k].get("handpts") or []
    if not pts:
        return 0.0
    x0, y0, x1, y1 = lip_box(m, pad=0.3)
    lips = (np.array(m["outer"], np.float32) - [x0, y0]).astype(np.int32)
    mw = max(8.0, float(lips[:, 0].max() - lips[:, 0].min()))
    mouth = np.zeros((y1 - y0, x1 - x0), np.uint8)
    cv2.fillConvexPoly(mouth, cv2.convexHull(lips), 1)
    hand = np.zeros_like(mouth)
    for h_ in pts:
        q = (np.array(h_, np.float32) - [x0, y0]).astype(np.int32)
        if len(q) >= 3:
            cv2.fillConvexPoly(hand, cv2.convexHull(q), 1)
        for x, y in q:
            cv2.circle(hand, (int(x), int(y)), max(4, int(0.22 * mw)), 1, -1)
    return float((mouth & hand).sum()) / max(1, int(mouth.sum()))


sharp = [sharpness(frames[i], M[i]) if M[i] else 0.0 for i in range(N)]
ok_sharp = sorted(s for s, m in zip(sharp, M) if m)
median_sharp = ok_sharp[len(ok_sharp) // 2] if ok_sharp else 0.0
reason = []
for i in range(N):
    m = M[i]
    if m is None:
        reason.append("no face")
    elif turned(m):
        reason.append("side profile")
    elif m["box"][2] < 48:
        reason.append("face too small")
    elif sharp[i] < max(4.0, 0.22 * median_sharp):
        reason.append("blur")
    elif hand_cover(i, m) > 0.3:  # half a generated mouth next to fingers looks worse than the real one
        reason.append("hand over the mouth")
    else:
        reason.append(None)
# Tiny bad runs (a blink of blur) stay lipsynced; short good islands between bad runs fall back too (no flicker).
i = 0
while i < N:
    if reason[i] is None:
        i += 1
        continue
    j = i
    while j < N and reason[j] is not None:
        j += 1
    if j - i < 3 and all(M[k] is not None for k in range(i, j)):
        for k in range(i, j):
            reason[k] = None
    i = j
i = 0
while i < N:
    if reason[i] is not None:
        i += 1
        continue
    j = i
    while j < N and reason[j] is None:
        j += 1
    if 0 < i and j < N and j - i < 6:
        for k in range(i, j):
            reason[k] = reason[i - 1]
    i = j
good = [r is None for r in reason]
if not any(good):
    # Never refuse a clip that has a face: a turned, soft or partly covered face is lipsynced as well as it can be.
    soft = {"side profile", "blur", "hand over the mouth"}
    if any(r in soft for r in reason):
        print("STATUS the face is turned or soft in this clip — doing the best possible", flush=True)
        reason = [None if r in soft else r for r in reason]
        good = [r is None for r in reason]
if not any(good):
    why = max(set(reason), key=reason.count)
    fail(f"no face found in this clip ({why}) — pick a piece where the face is visible")
for i in range(N):
    if M[i] is None or not good[i]:
        k = nearest_valid(i, good)
        M[i] = M[k]


LUMA = np.array([0.114, 0.587, 0.299], np.float32)  # BGR


def teeth_level():
    """(dark, bright) brightness inside this clip's open mouths (10th / 90th percentile within Vision's inner lips, median
    over the frames where the mouth is open), or None when the mouth is never open enough to see."""
    lo_, hi_ = [], []
    for i in range(0, N, 2):
        m = M[i]
        if not good[i] or not m or len(m.get("inner") or []) < 4:
            continue
        inner = np.array(m["inner"], np.float32)
        outer = np.array(m["outer"], np.float32)
        mw_ = float(np.ptp(outer[:, 0]))
        if mw_ < 16 or cv2.contourArea(inner) < 0.06 * mw_ * mw_:
            continue
        x0, y0 = np.floor(inner.min(0)).astype(int)
        x1_, y1_ = np.ceil(inner.max(0)).astype(int) + 1
        x0, y0, x1_, y1_ = max(0, x0), max(0, y0), min(W, x1_), min(H, y1_)
        if x1_ - x0 < 4 or y1_ - y0 < 4:
            continue
        hole = np.zeros((y1_ - y0, x1_ - x0), np.uint8)
        cv2.fillPoly(hole, [np.round(inner - [x0, y0]).astype(np.int32)], 1)
        hole = cv2.erode(hole, np.ones((3, 3), np.uint8))
        if hole.sum() < 20:
            continue
        yv = np.asarray(frames[i, y0:y1_, x0:x1_], np.float32) @ LUMA
        p10, p90 = np.percentile(yv[hole > 0], (10, 90))
        lo_.append(p10)
        hi_.append(p90)
    if len(hi_) < 4:
        return None
    return float(np.median(lo_)), float(np.median(hi_))


try:
    TEETH = teeth_level()
except Exception:  # noqa: BLE001 — a cosmetic step never stops the job
    TEETH = None


def bbox(m):
    """MuseTalk's crop: the jaw width, from (nose − (chin − nose)) to the chin, + 10 px margin (v1.5)."""
    xs = [x for x, _ in m["contour"]] or [m["box"][0], m["box"][0] + m["box"][2]]
    chin = max(y for _, y in m["contour"]) if m["contour"] else m["box"][1] + m["box"][3]
    nose = max(y for _, y in m["crest"]) if m["crest"] else m["box"][1] + m["box"][3] * 0.55
    top = nose - (chin - nose)
    return [min(xs), top, max(xs), chin + 10]


# Zero-phase smoothing of the crop over time (no jitter, no lag).
b = np.array([bbox(m) for m in M], np.float32)
k = 2
seg = np.cumsum([1 if i in cuts else 0 for i in range(N)])  # never smoothed across a cut to another face
sm = []
for i in range(N):
    idx = [min(N - 1, max(0, i + d)) for d in range(-k, k + 1)]
    sm.append(np.mean([b[q] if seg[q] == seg[i] else b[i] for q in idx], 0))
b = np.stack(sm)
boxes = []
for x1, y1, x2, y2 in b:
    x1, y1, x2, y2 = max(0, int(x1)), max(0, int(y1)), min(W, int(x2)), min(H, int(y2))
    boxes.append([x1, y1, max(x1 + 16, x2), max(y1 + 16, y2)])
# Forward then backward, like MuseTalk, when the speech is longer than the clip.
cyc = list(range(N)) + list(range(N))[::-1]
t = lap("analyse", t)


def crop256(i):
    """The face square of frame i at the model's 256 × 256 (RGB)."""
    x1, y1, x2, y2 = boxes[i]
    return cv2.resize(np.ascontiguousarray(frames[i, y1:y2, x1:x2]), (256, 256), interpolation=cv2.INTER_LANCZOS4)[..., ::-1]


# MARK: 4. Face latents: MuseTalk's two VAE latents per frame (lower half masked + full reference), kept per clip.
CACHE = os.path.join(args.root, "cache", "faces")


def signature():
    """32 × 32 grey pictures of every frame's face square: the same clip cut again (a new encode, a little noise) is
    recognised; another take of the same shot is not (its face moves and speaks differently)."""
    out = []
    for i in range(N):
        x1, y1, x2, y2 = boxes[i]
        g = cv2.cvtColor(np.ascontiguousarray(frames[i, y1:y2, x1:x2]), cv2.COLOR_BGR2GRAY)
        out.append(cv2.resize(g, (32, 32), interpolation=cv2.INTER_AREA))
    return np.stack(out).astype(np.float32)


def cached_latents(sig):
    """Latents of this clip from an earlier job: same size, frames and face squares (within noise), else None."""
    if args.no_face_cache or not os.path.isdir(CACHE):
        return None
    for name in sorted(os.listdir(CACHE), reverse=True):
        if not name.endswith(".npz"):
            continue
        try:
            with np.load(os.path.join(CACHE, name)) as z:
                if int(z["engine"]) != ENGINE or tuple(z["size"]) != (W, H) or len(z["sig"]) != N:
                    continue
                if z["sig"].shape != sig.shape or np.abs(z["boxes"] - np.array(boxes)).max() > 2:
                    continue
                per_frame = np.abs(z["sig"] - sig).mean(axis=(1, 2))
                if per_frame.mean() > 1.5 or per_frame.max() > 3.0:
                    continue
                os.utime(os.path.join(CACHE, name))  # most recently used
                return z["lat"], z["valid"]
        except Exception:  # noqa: BLE001 — a damaged entry is just a miss
            continue
    return None


def keep_latents(sig, lat, valid):
    """Keeps this clip's latents (16 KB a frame) next to the 24 most recently used clips."""
    if args.no_face_cache:
        return
    try:
        os.makedirs(CACHE, exist_ok=True)
        name = os.path.join(CACHE, f"{int(time.time() * 1000)}.npz")
        np.savez(name + ".part.npz", engine=ENGINE, size=np.array([W, H]), sig=sig, boxes=np.array(boxes), lat=lat, valid=valid)
        os.replace(name + ".part.npz", name)
        entries = sorted((os.path.getmtime(os.path.join(CACHE, f)), f) for f in os.listdir(CACHE) if f.endswith(".npz"))
        for _, f in entries[:-24]:
            os.remove(os.path.join(CACHE, f))
    except OSError:
        pass


if not cached:
    feats, length = ap.get_audio_feature(wav)
    chunks = ap.get_whisper_chunk(feats, dev, half, whisper, length, fps=FPS, audio_padding_length_left=2, audio_padding_length_right=2)
    n = len(chunks)
    t = lap("audio", t)
else:
    outs = list(np.load(args.mouths))
    n = len(outs)

# Crossfade weights per output frame: 0 at fallback frames, ramping over --edge-frames frames; the piece edges count
# as fallback, so the first and last frames blend in from the original.
K = max(0, args.edge_frames)
bad_out = [not good[cyc[i % len(cyc)]] for i in range(n)]
dist = [0] * n
d = 0
for i in range(n):
    d = 0 if bad_out[i] else d + 1
    dist[i] = d
d = 0
for i in range(n - 1, -1, -1):
    d = 0 if bad_out[i] else d + 1
    dist[i] = min(dist[i], d)
alpha = [0.0 if bad_out[i] else min(1.0, dist[i] / (K + 1)) for i in range(n)]
progress(0.12)

if not cached:
    say("STATUS", "encoding the face")
    sig = signature()
    hit = cached_latents(sig)
    lat_np = np.zeros((N, 8, 32, 32), np.float16) if hit is None else hit[0]
    valid = np.zeros(N, bool) if hit is None else hit[1].copy()
    half_mask = torch.zeros(1, 1, 256, 256, device=dev, dtype=half)
    half_mask[:, :, :128] = 1  # MuseTalk's mask: the lower half of the face is hidden from the model

    def encode(idx):
        x = torch.from_numpy(np.ascontiguousarray(np.stack([crop256(i) for i in idx]))).to(dev).permute(0, 3, 1, 2).to(half) / 255
        with torch.no_grad():
            # The distribution's centre, not a random sample: the same latents every run, no added frame-to-frame noise.
            lat = vae.encode(torch.cat([x * half_mask, x]) * 2 - 1).latent_dist.mean * SF
        k_ = len(idx)
        lat = torch.cat([lat[:k_], lat[k_:]], 1).float().cpu().numpy().astype(np.float16)
        for j_, i_ in enumerate(idx):
            lat_np[i_] = lat[j_]
            valid[i_] = True

    used = sorted({cyc[i % len(cyc)] for i in range(n) if alpha[i] > 0})
    todo = [i for i in used if not valid[i]]
    if hit is not None:
        say("STATUS", f"encoding the face (kept from an earlier run{'' if not todo else f', {len(todo)} new frames'})")
    for k_ in range(0, len(todo), BATCH):
        encode(todo[k_:k_ + BATCH])
        progress(0.12 + 0.23 * min(1, (k_ + BATCH) / len(todo)))
    if todo:
        keep_latents(sig, lat_np, valid)
    latents = torch.from_numpy(lat_np).to(dev, half)
    t = lap("encode", t)
progress(0.35)

# MARK: 5. The guarded blend.
FACE = (1, 11, 12, 13)  # skin, mouth, upper lip, lower lip
MOUTH = (11, 12, 13)
OCCLUDER = (0, 16, 18)  # background, cloth, hat — not a face, even though it sits inside the jaw


def parse(images):
    """BiSeNet labels (CelebAMask-HQ classes) for BGR crops, each back at its own size (one GPU batch)."""
    x = torch.stack([torch.from_numpy(np.ascontiguousarray(cv2.resize(c, (512, 512), interpolation=cv2.INTER_LINEAR)[..., ::-1])) for c in images])
    x = ((x.to(dev).permute(0, 3, 1, 2).float() / 255 - MEAN) / STD).to(half)
    with torch.no_grad():
        lab = parser(x)[0].argmax(1).to(torch.uint8).cpu().numpy()
    return [cv2.resize(l, (c.shape[1], c.shape[0]), interpolation=cv2.INTER_NEAREST) for l, c in zip(lab, images)]


def ellipse(r):
    r = max(1, int(r))
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def nconv(img, w, sigma):
    """Smooths img using only the pixels where w > 0 (normalised convolution), at quarter size for speed."""
    h0, w0 = w.shape
    s = 4 if min(h0, w0) >= 64 else 1
    size = (max(1, w0 // s), max(1, h0 // s))
    small_i = cv2.resize(img, size, interpolation=cv2.INTER_AREA).reshape(size[1], size[0], -1)
    small_w = cv2.resize(w, size, interpolation=cv2.INTER_AREA)
    num = cv2.GaussianBlur(small_i * small_w[..., None], (0, 0), max(0.8, sigma / s)).reshape(size[1], size[0], -1)
    den = cv2.GaussianBlur(small_w, (0, 0), max(0.8, sigma / s))
    est = num / np.maximum(den, 1e-6)[..., None]
    conf = np.clip(den / 0.004, 0, 1)  # inside a mouth-sized hole the estimate is still the surrounding skin
    est = cv2.resize(est, (w0, h0), interpolation=cv2.INTER_LINEAR).reshape(h0, w0, -1)
    return est, cv2.resize(conf, (w0, h0), interpolation=cv2.INTER_LINEAR)


def tone_field(diff, known, sigma):
    """Low-frequency correction: diff smoothed over the known pixels, then diffused into the unknown ones (quarter size)."""
    h0, w0 = known.shape
    q = 4 if min(h0, w0) >= 64 else 1
    size = (max(1, w0 // q), max(1, h0 // q))
    d = cv2.resize(diff, size, interpolation=cv2.INTER_AREA)
    k = cv2.resize(known, size, interpolation=cv2.INTER_AREA)
    sg = max(0.7, sigma / q)
    num = cv2.GaussianBlur(d * k[..., None], (0, 0), sg)
    den = cv2.GaussianBlur(k, (0, 0), sg)
    fixed = den > 0.35
    base = np.where(fixed[..., None], num / np.maximum(den, 1e-6)[..., None], 0).astype(np.float32)
    if not fixed.any():
        return np.zeros_like(diff)
    f = base.copy()
    f[~fixed] = base[fixed].mean(0)
    for _ in range(80):  # Jacobi diffusion: the known ring stays, the holes relax to a smooth membrane
        f = cv2.blur(f, (3, 3))
        f[fixed] = base[fixed]
    f = cv2.GaussianBlur(f, (0, 0), 1.0)
    return cv2.resize(f, (w0, h0), interpolation=cv2.INTER_LINEAR)


def hands_near(j):
    """Hand joints of frames j-1..j+1 (Vision checks hands every 2nd frame and hands move fast)."""
    pts = []
    for k in (j - 1, j, j + 1):
        if 0 <= k < N and marks["frames"][k]:
            pts += marks["frames"][k].get("handpts") or []
    return pts


GRAIN = cv2.GaussianBlur(np.random.default_rng(7).standard_normal((512, 512)).astype(np.float32), (0, 0), 0.6)
GRAIN /= GRAIN.std()


def steady(prev, cur, nxt):
    """Temporal smoothing of a generated face (its square is aligned to the face, so pixels match between frames).
    Neighbours count where they barely differ from this frame — the shimmer of teeth and skin texture — and fall to zero
    where the picture really changes, so lips and jaw keep their full motion."""
    c = cur.astype(np.float32)
    acc, wsum = c.copy(), np.ones(c.shape[:2], np.float32)
    cb = cv2.GaussianBlur(c, (0, 0), 1.2)
    for nb in (prev, nxt):
        if nb is None or nb.shape != cur.shape:
            continue
        f = nb.astype(np.float32)
        d = np.abs(cv2.GaussianBlur(f, (0, 0), 1.2) - cb).mean(2)
        w = (0.5 * args.smooth) * np.exp(-((d / 4.0) ** 2))
        acc += f * w[..., None]
        wsum += w
    return np.clip(acc / wsum[..., None] + 0.5, 0, 255).astype(np.uint8)


def crops(j, face):
    """The original crop around face j and the same crop with the generated face pasted (the face may be only the
    lower rows of the 256 square: they go to the bottom of the box)."""
    ori = np.asarray(frames[j])
    x1, y1, x2, y2 = boxes[j]
    bw, bh = x2 - x1, y2 - y1
    s = int(max(bw, bh) * 0.75)
    cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
    X1, Y1, X2, Y2 = max(0, cx - s), max(0, cy - s), min(W, cx + s), min(H, cy + s)
    O = ori[Y1:Y2, X1:X2].copy()
    G = O.copy()
    fh = max(1, min(bh, int(round(bh * face.shape[0] / 256))))
    G[y2 - fh - Y1:y2 - Y1, x1 - X1:x2 - X1] = cv2.resize(face.astype(np.uint8), (bw, fh), interpolation=cv2.INTER_LANCZOS4)
    return O, G, (X1, Y1, X2, Y2)


def lip_spans(m):
    """Per column of a lip mask: (first row, last row, has lip) — the columns without lip filled from their neighbours."""
    has = m.any(0)
    if has.sum() < 3:
        return None
    top = np.argmax(m, 0).astype(np.float32)
    bot = (m.shape[0] - 1 - np.argmax(m[::-1], 0)).astype(np.float32)
    cols = np.arange(m.shape[1])
    top = np.interp(cols, cols[has], top[has]).astype(np.float32)
    bot = np.interp(cols, cols[has], bot[has]).astype(np.float32)
    return top, bot, np.nonzero(has)[0]


def lip_detail(hi_o, Po, Pg):
    """The person's own lip texture (creases, edges) carried onto the generated lips: each lip (upper, lower) is mapped
    corner to corner and outer edge to inner edge, so the detail follows the new lip shape. Returns (detail, weight) or
    None. The weight falls where the shapes are too different to map (a lip three times thicker, a mouth far wider)."""
    h, w = Po.shape
    mapx = np.zeros((h, w), np.float32)
    mapy = np.zeros((h, w), np.float32)
    wt = np.zeros((h, w), np.float32)
    for c in (12, 13):
        mo, mg = Po == c, Pg == c
        so, sg = lip_spans(mo), lip_spans(mg)
        if so is None or sg is None:
            continue
        (to, bo, co), (tg, bg_, cg) = so, sg
        xo0, xo1, xg0, xg1 = co.min(), co.max(), cg.min(), cg.max()
        if xo1 - xo0 < 4 or xg1 - xg0 < 4:
            continue
        ratio = (xg1 - xg0) / (xo1 - xo0)
        if not 0.6 < ratio < 1.6:
            continue
        ys, xs = np.nonzero(mg)
        u = (xs - xg0) / max(1, xg1 - xg0)
        xo = xo0 + u * (xo1 - xo0)
        v = (ys - tg[xs]) / np.maximum(1.0, bg_[xs] - tg[xs])
        xi = np.clip(np.round(xo).astype(int), 0, w - 1)
        yo = to[xi] + v * (bo[xi] - to[xi])
        mapx[ys, xs] = xo
        mapy[ys, xs] = yo
        thick = np.maximum(1.0, bg_[xs] - tg[xs]) / np.maximum(1.0, bo[xi] - to[xi])
        wt[ys, xs] = np.clip(1.5 - 0.5 * np.maximum(thick, 1 / thick), 0, 1)  # full up to 1:1 thickness, none at 3:1
    if not wt.any():
        return None
    det = cv2.remap(hi_o, mapx, mapy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    return det, wt


def mirror_texture(hi, hole, ok):
    """Fine texture for the pixels of `hole` taken from the mirror image of their surroundings: each pixel takes the
    detail at its reflection through the nearest pixel outside the hole (stubble below the lips continues upwards into
    the place where the old mouth was). Returns (detail, weight); weight 0 where the reflection falls on unusable pixels."""
    src = (hole > 0).astype(np.uint8)  # distances (and labels) to the nearest zero pixel: the outside
    if src.all() or not src.any():
        return None
    _, lab = cv2.distanceTransformWithLabels(src, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    zy, zx = np.nonzero(src == 0)  # outside pixels in raster order: label k is the k-th of them
    ys, xs = np.nonzero(hole)
    k = lab[ys, xs] - 1
    qy = np.clip(2 * zy[k] - ys, 0, hole.shape[0] - 1)
    qx = np.clip(2 * zx[k] - xs, 0, hole.shape[1] - 1)
    det = np.zeros_like(hi)
    det[ys, xs] = hi[qy, qx]
    wt = np.zeros(hole.shape, np.float32)
    wt[ys, xs] = ok[qy, qx]
    return det, wt


def compose(j, O, G, Po, Pg, crop):
    """The blended crop for source frame j from its original and generated crops and their face labels.
    Returns (crop pixels, crop box, info)."""
    m = M[j]
    x1, y1, x2, y2 = boxes[j]
    X1, Y1, X2, Y2 = crop
    bw, bh = x2 - x1, y2 - y1
    cx = (x1 + x2) // 2
    h, w = Po.shape
    lips = np.array(m["outer"], np.float32) - [X1, Y1]
    mw = max(8.0, float(lips[:, 0].max() - lips[:, 0].min()))
    mouth_cy = float(lips[:, 1].mean())
    nose = np.array((m["nose"] or m["crest"] or [[cx, y1 + bh * 0.4]]), np.float32) - [X1, Y1]
    nose_y = float(nose[:, 1].max())
    rows = np.arange(h, dtype=np.float32)[:, None]

    mouth_o = np.isin(Po, MOUTH).astype(np.uint8)
    mouth_g = np.isin(Pg, MOUTH).astype(np.uint8)
    face_o = np.isin(Po, FACE).astype(np.uint8)
    face_g = np.isin(Pg, FACE).astype(np.uint8)
    r = max(2, int(0.1 * mw))
    # Ghost mouth: both mouths, closed and grown a little.
    U = cv2.dilate(cv2.morphologyEx(mouth_o | mouth_g, cv2.MORPH_CLOSE, ellipse(r)), ellipse(r))
    # Above the mouth line the original face decides; below it the union of both chins (jaw guard).
    below = (rows >= mouth_cy).astype(np.uint8)
    region = np.where(below > 0, face_o | face_g, face_o) | U
    region &= (Po != 10).astype(np.uint8)  # the nose stays original
    region = cv2.morphologyEx(region, cv2.MORPH_CLOSE, ellipse(r))
    # Hands (Vision joints → hand-shaped area) and non-face things inside the original jaw stay real.
    hand = np.zeros((h, w), np.uint8)
    finger = max(4, int(0.22 * mw))
    for pts in hands_near(j):
        q = (np.array(pts, np.float32) - [X1, Y1]).astype(np.int32)
        if len(q) >= 3:
            cv2.fillConvexPoly(hand, cv2.convexHull(q), 1)
        for x, y in q:
            cv2.circle(hand, (int(x), int(y)), finger, 1, -1)
    jaw = np.array(m["contour"], np.float32) - [X1, Y1] if m["contour"] else None
    occ = np.zeros((h, w), np.uint8)
    if jaw is not None and len(jaw) >= 3:
        hull = np.zeros((h, w), np.uint8)
        cv2.fillConvexPoly(hull, cv2.convexHull(np.concatenate([jaw, nose]).astype(np.int32)), 1)
        occ = hull & np.isin(Po, OCCLUDER).astype(np.uint8) & (rows >= nose_y).astype(np.uint8)
        occ = cv2.morphologyEx(occ, cv2.MORPH_OPEN, ellipse(max(1, r // 2)))  # specks of mislabelled skin don't count
    keep_real = cv2.dilate(hand | occ, ellipse(max(2, r // 2)))
    region_before_hands = region.copy()
    region &= 1 - keep_real

    # Seams: feathered to the face size, upper edge fades in under the nose, never touches the generated square's edge.
    sigma = max(1.5, 0.025 * bw)
    mask = cv2.GaussianBlur(region.astype(np.float32), (0, 0), sigma)
    mask *= np.clip((rows - nose_y) / max(2.0, 0.35 * (mouth_cy - nose_y)), 0, 1)
    gx = np.arange(w, dtype=np.float32)[None, :]
    edge = np.minimum(np.minimum(gx - (x1 - X1), (x2 - X1) - gx), np.minimum(rows - (y1 - Y1), (y2 - Y1) - rows))
    mask *= np.clip((edge - sigma) / (2.5 * sigma), 0, 1)
    mask *= 1 - cv2.GaussianBlur(keep_real.astype(np.float32), (0, 0), 1.0)  # crisp around fingers

    Of = O.astype(np.float32)
    Gf = G.astype(np.float32)
    # Skin tone: measured only where both faces are skin and away from both mouths (no halo of the old mouth).
    U2 = cv2.dilate(U, ellipse(max(1, r // 2)))
    agree = (face_o & face_g & (1 - U2) & (1 - keep_real)).astype(np.float32)
    # Tone: the colour difference original − generated, measured where both faces are skin, then filled into the mouths
    # like a membrane (diffusion from the surrounding ring), so the replaced area takes the local skin tone around it.
    Gf = Gf + tone_field(Of - Gf, agree, 0.03 * bw)
    # The mouth work below happens in a box around both mouths only (the rest of the crop is untouched by it).
    s1 = float(np.clip(0.0057 * bw, 1.0, 4.0))
    both = np.nonzero(mouth_o | mouth_g)
    lips_on = args.lips > 0 and len(both[0]) > 40
    if lips_on:
        m_ = int(7 * s1 + 4)
        R = (slice(max(0, both[0].min() - m_), min(h, both[0].max() + m_ + 1)), slice(max(0, both[1].min() - m_), min(w, both[1].max() + m_ + 1)))
        PoR, PgR = Po[R], Pg[R]
        lips_o_m, lips_g_m = np.isin(PoR, (12, 13)), np.isin(PgR, (12, 13))
        lipw = cv2.GaussianBlur(lips_g_m.astype(np.float32), (0, 0), max(1.0, 0.03 * mw))
        lips_on = lips_o_m.sum() > 30 and lips_g_m.sum() > 30
    # Lips: the person's own lip colour. The model draws lips pinker and paler than they are (a lipstick look); their
    # mean colour is moved to the person's lips in this frame (both are measured, whatever shape they have).
    if lips_on:
        shift = np.clip(Of[R][lips_o_m].mean(0) - Gf[R][lips_g_m].mean(0), -30, 30) * args.lips
        Gf[R] += lipw[..., None] * shift
    # Texture: stubble, pores and grain from the original where both faces agree; the generated detail in the mouths
    # and wherever the chins differ (no double jaw line). The mouths are grown only by the reach of the texture filter
    # (not by the wide ghost guard), so a moustache or stubble right above and below the lips stays the real one.
    differ = cv2.dilate(face_o ^ face_g, ellipse(r))
    lips_both = cv2.dilate(mouth_o | mouth_g, ellipse(max(2, int(2 * s1 + 1)))) if args.texture else U
    keep_tex = cv2.GaussianBlur((face_o & face_g & (1 - lips_both) & (1 - differ)).astype(np.float32), (0, 0), 2 * s1)[..., None]
    lo = cv2.GaussianBlur(Gf, (0, 0), s1)
    hi_o = Of - cv2.GaussianBlur(Of, (0, 0), s1)
    hi_g = Gf - lo
    # Crisp mouth: MuseTalk draws the face at 256 px, so its detail is softer than the video around it (lips at about
    # half the original's sharpness — the tell-tale sign of a lipsync). Measured on the skin both faces share (not on
    # the mouths, they say different words), the generated detail is raised to the original's strength: the lips get
    # this clip's own sharpness, never more (× 1…2).
    gain = 1.0
    skin = agree > 0.5
    if args.crisp > 0 and skin.sum() > 64:
        gain = float(np.clip(np.sqrt((hi_o[skin] ** 2).mean() / max(1e-6, float((hi_g[skin] ** 2).mean()))), 1.0, 1.0 + args.crisp))
    hi_new = hi_g * gain
    if lips_on:
        # The lips' own sharpness: their lines and edges are finer than the skin's, so the generated lips are raised to
        # the original lips' detail (measured on both lips; × 1…2.5), not only to the skin's; and the person's own lip
        # texture (creases) is carried onto the new lip shape.
        hoR, hgR = hi_o[R], hi_g[R]
        if args.crisp > 0:
            gl = float(np.sqrt((hoR[lips_o_m] ** 2).mean() / max(1e-6, float((hgR[lips_g_m] ** 2).mean()))))
            gl = float(np.clip(gl, 1.0, 1.0 + 1.5 * args.crisp))
            if gl > gain:
                hi_new[R] = hgR * (gain + (gl - gain) * lipw)[..., None]
        lipd = lip_detail(hoR, PoR, PgR)
        if lipd is not None:
            det, wt = lipd
            det = np.where((wt > 0)[..., None], det, hi_new[R])  # off the lips: nothing to carry, the edge fades
            wt = cv2.GaussianBlur(wt, (0, 0), max(1.0, 0.6 * s1))[..., None] * min(1.0, args.lips)
            hi_new[R] += (det - hi_new[R]) * wt
    Gf = lo + keep_tex * hi_o + (1 - keep_tex) * hi_new
    if lips_on and args.crisp > 0:
        # Mouth outline: the model's lips and teeth are also soft at a coarser scale (their edges spread over several
        # pixels when its 256 px face is enlarged), so the band between that scale and the fine one is raised as well,
        # to the strength the person's own mouth has there (measured on both mouths), at least × 1.35 (× 1.7 when the
        # model's face is enlarged 1.6× or more: its dark mouth opening has as much contrast as a real one, its lip
        # edges don't), at most × 1.8: crisp lip edges and teeth.
        s2 = 2.5 * s1
        grow = ellipse(max(1, int(2 * s1)))
        bo_ = cv2.dilate(np.isin(PoR, MOUTH).astype(np.uint8), grow) > 0
        bg_ = cv2.dilate(np.isin(PgR, MOUTH).astype(np.uint8), grow) > 0
        OR, GR = Of[R], Gf[R]
        mid_o = cv2.GaussianBlur(OR, (0, 0), s1) - cv2.GaussianBlur(OR, (0, 0), s2)
        mid_g = cv2.GaussianBlur(GR, (0, 0), s1) - cv2.GaussianBlur(GR, (0, 0), s2)
        g2 = float(np.sqrt((mid_o[bo_] ** 2).mean() / max(1e-6, float((mid_g[bg_] ** 2).mean()))))
        floor = 1.35 + 0.35 * float(np.clip((bw / 256 - 0.8) / 0.8, 0, 1))
        g2 = float(np.clip(max(g2, floor), 1.0, 1.0 + 0.8 * min(1.0, args.crisp))) if args.crisp >= 0.5 else 1.0
        if g2 > 1.01:
            band = cv2.GaussianBlur(bg_.astype(np.float32), (0, 0), s1)[..., None] * min(1.0, args.lips)
            Gf[R] += (g2 - 1) * mid_g * band
    # Teeth: the model's teeth are grey and dim (its mouth is drawn at 256 px and blurred). Inside the generated mouth
    # the brightness is stretched towards this clip's own open mouths (teeth level measured once, on Vision's inner lips),
    # never making the dark of the mouth brighter (× 1…1.4).
    if lips_on and TEETH is not None:
        inner_g = PgR == 11
        if inner_g.sum() > 40:
            yv = Gf[R] @ LUMA
            p10, p90 = np.percentile(yv[inner_g], (10, 90))
            if p90 - p10 > 12 and p90 < TEETH[1]:
                k = float(np.clip((TEETH[1] - min(p10, TEETH[0])) / (p90 - p10), 1.0, 1.4))
                lift = (min(p10, TEETH[0]) + (yv - p10) * k - yv).clip(-25, 40)
                inner_w = cv2.GaussianBlur(cv2.erode(inner_g.astype(np.uint8), ellipse(1)).astype(np.float32), (0, 0), max(0.8, 0.5 * s1))
                Gf[R] += (lift * inner_w * args.lips)[..., None]
    # Where the old mouth was replaced by generated (smooth) skin: grain with the original skin's local strength,
    # anchored to the face so it moves with it instead of crawling.
    amp2, _ = nconv((hi_o.mean(2) ** 2)[..., None], agree, 0.12 * bw)
    grain = np.zeros((h, w), np.float32)
    grain[y1 - Y1:y2 - Y1, x1 - X1:x2 - X1] = cv2.resize(GRAIN, (bw, bh), interpolation=cv2.INTER_LINEAR)
    lips_g = cv2.GaussianBlur(cv2.dilate(mouth_g, ellipse(max(1, r // 2))).astype(np.float32), (0, 0), s1)
    zone = (1 - keep_tex[..., 0]) * (1 - lips_g)
    if lips_on and args.texture:
        # Where the old mouth was and the new face shows skin (a dub: the person smiled wide, the new words keep the
        # mouth small), the person's own stubble and pores continue into it from around (mirrored), not a smooth patch.
        zR = zone[R]
        hole = ((zR > 0.5) & (face_g[R] > 0) & (mask[R] > 0.05)).astype(np.uint8)
        mirrored = mirror_texture(hi_o[R], hole, (keep_tex[R][..., 0] > 0.9).astype(np.float32)) if hole.sum() > 30 else None
        if mirrored is not None:
            det, wt = mirrored
            wt = cv2.GaussianBlur(wt, (0, 0), s1) * zR
            Gf[R] += det * wt[..., None]
            zone[R] = zR * (1 - wt)
    Gf += (zone * np.sqrt(np.maximum(amp2[..., 0], 0)) * grain * 0.9)[..., None]
    a = mask[..., None]
    out = np.clip(Of + (Gf - Of) * a, 0, 255).astype(np.uint8)

    area_o = max(1, int(mouth_o.sum()))
    info = {
        # share of the original mouth that the generated mouth alone would leave visible (a ghost without the union)
        "ghost": float((mouth_o & (1 - cv2.dilate(mouth_g, ellipse(2)))).sum()) / area_o,
        "chin": chin_gap(face_o, face_g, lips, mw),
        "hand": float((keep_real & region_before_hands).sum()) / max(1, int(region_before_hands.sum())),
        "gain": gain,
        "crop": crop,
        "mask": mask,
        "U": U,
        "keep_real": keep_real,
    }
    return out, crop, info


def compose_frame(j, face, a=1.0):
    """One whole output frame (used by --proof): crops, labels and the blend in one go. Returns (frame, info)."""
    O, G, crop = crops(j, face)
    Po, Pg = parse([O, G])
    region, (X1, Y1, X2, Y2), info = compose(j, O, G, Po, Pg, crop)
    out = np.array(frames[j])
    if a < 1:
        region = (O.astype(np.float32) * (1 - a) + region.astype(np.float32) * a).astype(np.uint8)
    out[Y1:Y2, X1:X2] = region
    return out, info


def chin_gap(face_o, face_g, lips, mw):
    """Pixels between the original and the generated chin, in the columns under the mouth."""
    c0, c1 = int(max(0, lips[:, 0].min())), int(min(face_o.shape[1], lips[:, 0].max()))
    if c1 <= c0:
        return 0.0

    def low(f):
        ys = np.where(f[:, c0:c1].any(1))[0]
        return float(ys.max()) if len(ys) else 0.0

    return abs(low(face_o) - low(face_g)) / mw


# The AI disclosure plate (straight-alpha PNG from lipmarks), placed once for all frames.
plate_h = max(14, round(H * 0.025))
plate_png = stem + ".plate.png"
tmp.append(plate_png)
r = subprocess.run([args.lipmarks, "--plate", args.mark_text, str(plate_h), plate_png], capture_output=True, text=True)
plate = cv2.imread(plate_png, cv2.IMREAD_UNCHANGED) if r.returncode == 0 else None
if plate is None or plate.ndim != 3 or plate.shape[2] != 4:
    fail("couldn't draw the AI-generated mark: " + (r.stderr.strip()[-200:] or "no plate"))
ph, pw = plate.shape[:2]
px, py = max(0, W - pw - round(W * 0.05)), max(0, H - ph - round(H * 0.05))
pw, ph = min(pw, W - px), min(ph, H - py)
plate_rgb = plate[:ph, :pw, :3].astype(np.float32)
plate_a = plate[:ph, :pw, 3:4].astype(np.float32) / 255


def mark(frame):
    """Burns the AI disclosure plate into the frame (bottom-right, inside the safe margin)."""
    frame = np.array(frame, copy=True)
    roi = frame[py:py + ph, px:px + pw].astype(np.float32)
    frame[py:py + ph, px:px + pw] = np.clip(roi * (1 - plate_a) + plate_rgb * plate_a, 0, 255).astype(np.uint8)
    return frame


# MARK: 6. Mouths on the GPU and the blend on the CPU, at the same time; frames go to the encoder in order.
ROW0 = 8  # latent rows above this (forehead and eyes, never pasted) are not decoded


def generate(ids):
    """Generated lower faces (BGR uint8, 192 × 256) for output frames ids."""
    lat = latents[[cyc[i % len(cyc)] for i in ids]]
    aud = torch.stack([chunks[i] for i in ids]).to(dev, half)
    with torch.no_grad():
        pred = unet(lat, ts, encoder_hidden_states=pe(aud)).sample
        img = vae.decode(pred[:, :, ROW0:] / SF).sample
        if not torch.isfinite(img).all():  # half precision overflowed: this batch again in full precision
            img = vae.float().decode(pred[:, :, ROW0:].float() / SF).sample
            vae.to(half)
        img = ((img.float() / 2 + 0.5).clamp(0, 1) * 255).round().to(torch.uint8)
    return list(img.permute(0, 2, 3, 1).cpu().numpy()[..., ::-1])


say("STATUS", "generating the mouths")
enc = subprocess.Popen([FF, "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-i", args.audio,
                        "-map", "0:v", "-map", "1:a", "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p", "-c:v", "h264_videotoolbox",
                        "-b:v", "16M", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-c:a", "aac", "-b:a", "192k",
                        "-shortest", "-movflags", "+faststart", args.out], stdin=subprocess.PIPE)
pool = ThreadPoolExecutor(max_workers=max(2, min(4, (os.cpu_count() or 4) // 2)))
stats = [None] * n
failures = []
gen_ids = [i for i in range(n) if alpha[i] > 0]
faces = {}  # output frame → generated lower face (150 KB each)
if cached:
    faces = {i: outs[i] for i in gen_ids}
queue = collections.deque()  # (output frame, future of (crop pixels, crop box, info) or None)
written = 0
Po_of = {}  # face labels of an original crop, by source frame (a long speech plays the clip twice)


def blend_one(i, j, O, G, Po, Pg, crop):
    try:
        out, box, info = compose(j, O, G, Po, Pg, crop)
        if alpha[i] < 1:
            out = (O.astype(np.float32) * (1 - alpha[i]) + out.astype(np.float32) * alpha[i]).astype(np.uint8)
        return out, box, info
    except Exception as e:  # noqa: BLE001 — one odd frame never kills the job; it stays original
        if not failures:
            import traceback

            traceback.print_exc()
        failures.append(i)
        print(f"frame {i} kept original ({type(e).__name__}: {e})", file=sys.stderr, flush=True)
        return None


def submit(ready):
    """Crops and face labels of the ready frames (one GPU batch), then their blends to the CPU threads."""
    work_ = []
    for i in ready:
        j = cyc[i % len(cyc)]
        face = faces[i]
        if args.smooth > 0:
            face = steady(faces.get(i - 1), face, faces.get(i + 1))
        O, G, crop = crops(j, face)
        work_.append((i, j, O, G, crop))
    if not work_:
        return
    todo_o = [w_ for w_ in work_ if w_[1] not in Po_of]
    labels = parse([w_[2] for w_ in todo_o] + [w_[3] for w_ in work_])
    known = {w_[1]: lab for w_, lab in zip(todo_o, labels[:len(todo_o)])}
    if n > N:  # the clip plays again (forward, then backward): its labels are needed a second time
        Po_of.update(known)
    for w_, Pg in zip(work_, labels[len(todo_o):]):
        i, j, O, G, crop = w_
        queue.append((i, pool.submit(blend_one, i, j, O, G, known.get(j, Po_of.get(j)), Pg, crop)))


def drain(backlog):
    """Writes finished frames in order (and the original frames between them); waits while more than `backlog`
    frames are queued for the blend, so the GPU stays ahead but memory stays bounded."""
    global written
    while written < n:
        i = written
        if alpha[i] <= 0:
            out = np.asarray(frames[cyc[i % len(cyc)]])
        else:
            if not queue or queue[0][0] != i:
                return
            fut = queue[0][1]
            if not fut.done() and len(queue) <= backlog:
                return
            queue.popleft()
            res = fut.result()
            out = np.array(frames[cyc[i % len(cyc)]])
            if res is not None:
                region, (X1, Y1, X2, Y2), info = res
                out[Y1:Y2, X1:X2] = region
                stats[i] = {k_: v for k_, v in info.items() if k_ in ("ghost", "chin", "hand", "gain")}
        enc.stdin.write(np.ascontiguousarray(mark(out)).tobytes())
        written += 1
        if written % 5 == 0:
            progress(0.35 + 0.65 * written / max(1, n))
            say("STATUS", f"generating the mouths {written}/{n}")


done_upto = 0  # gen_ids[:done_upto] are submitted to the blend
for b0 in range(0, len(gen_ids), BATCH):
    ids = gen_ids[b0:b0 + BATCH]
    if not cached:
        for i, face in zip(ids, generate(ids)):
            faces[i] = face
    last = b0 + len(ids) >= len(gen_ids)
    # A face is smoothed with its neighbours, so the last one of a batch waits for the next batch.
    upto = len(gen_ids) if last else b0 + len(ids) - 1
    submit(gen_ids[done_upto:upto])
    done_upto = upto
    # A face is needed only by its own frame and the next one (smoothing): the older ones go, so a long speech
    # doesn't pile up faces in memory (kept for the developer flags that save or inspect them).
    if not (args.mouths or args.proof) and done_upto:
        last = gen_ids[done_upto - 1]
        for k_ in [k_ for k_ in faces if k_ < last]:
            del faces[k_]
    drain(backlog=2 * BATCH)
drain(backlog=0)
pool.shutdown()
enc.stdin.close()
if enc.wait():
    fail("couldn't encode the result")
t = lap("generate", t)

# MARK: 7. Report: what fell back to the original (the app lists it), what each guard did.
ranges = []
i = 0
while i < n:
    if not bad_out[i]:
        i += 1
        continue
    j = i
    why = reason[cyc[i % len(cyc)]]
    while j < n and bad_out[j] and reason[cyc[j % len(cyc)]] == why:
        j += 1
    ranges.append({"from": round(i / FPS, 2), "to": round(j / FPS, 2), "reason": why})
    i = j
report = {
    "fps": FPS,
    "frames": n,
    "fallback": ranges,
    "guards": {
        "ghostFrames": sum(1 for s in stats if s and s["ghost"] > 0.05),
        "chinFrames": sum(1 for s in stats if s and s["chin"] > 0.04),
        "handFrames": sum(1 for s in stats if s and s["hand"] > 0.01),
        "edgeFrames": min(n, 2 * K),
        "crisp": round(float(np.median([s["gain"] for s in stats if s])), 2) if any(stats) else 1.0,
    },
    "seconds": dict(timing, total=round(time.time() - T0, 2)),
    "mark": {"text": args.mark_text, "x": px, "y": py, "w": pw, "h": ph},
}
if args.report:
    with open(args.report, "w") as fh:
        json.dump(report, fh)
if args.mouths and not cached and faces:
    some = next(iter(faces.values()))
    np.save(args.mouths, np.stack([faces.get(i, np.zeros_like(some)) for i in range(n)]))


# MARK: Proof (developer flag): before/after crops for the frames where each guard mattered most.
def proof():
    from musetalk.utils.blending import get_image

    os.makedirs(args.proof, exist_ok=True)
    fp_cpu = FaceParsing(left_cheek_width=90, right_cheek_width=90)  # MuseTalk's own blend runs on the CPU

    def full_face(i):
        """The generated face of output frame i as a 256 square (the undecoded forehead taken from the original)."""
        face = faces[i]
        if face.shape[0] == 256:
            return face
        sq = np.ascontiguousarray(crop256(cyc[i % len(cyc)])[..., ::-1])
        sq[256 - face.shape[0]:] = face
        return sq

    def old_blend(j, face):
        """The blend shipped before the guards: MuseTalk 'jaw' paste + texture transfer around the ORIGINAL lips only."""
        x1, y1, x2, y2 = boxes[j]
        ori = np.asarray(frames[j]).copy()
        f = cv2.resize(face.astype(np.uint8), (x2 - x1, y2 - y1))
        out = get_image(ori, f, [x1, y1, x2, y2], mode="jaw", fp=fp_cpu).astype(np.float32)
        o = ori.astype(np.float32)
        pts = np.array(M[j]["outer"], np.float32)
        ccx, ccy = pts.mean(0)
        mw = max(8.0, float(pts[:, 0].max() - pts[:, 0].min()))
        poly = np.stack([ccx + (pts[:, 0] - ccx) * 1.2, ccy + (pts[:, 1] - ccy) * 1.3], 1)
        poly = np.concatenate([poly, poly + [0, mw * 0.35]])
        lm = np.zeros(ori.shape[:2], np.float32)
        cv2.fillConvexPoly(lm, cv2.convexHull(poly.astype(np.int32)), 1.0)
        keep = 1.0 - cv2.GaussianBlur(lm, (0, 0), mw * 0.12)[..., None]
        lo = cv2.GaussianBlur(out, (0, 0), 1.6)
        hi_o = o - cv2.GaussianBlur(o, (0, 0), 1.6)
        lo = lo + keep * (cv2.GaussianBlur(o, (0, 0), 8) - cv2.GaussianBlur(out, (0, 0), 8))
        return np.clip(lo + keep * hi_o + (1 - keep) * (out - cv2.GaussianBlur(out, (0, 0), 1.6)), 0, 255).astype(np.uint8)

    def seam(img, ori, mask):
        """Seam strength: how abruptly the picture changes across the edge of the pasted area (grey levels per pixel,
        grain removed; lower is cleaner). Measured on the band where either blend fades in."""
        d = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32) - cv2.cvtColor(ori, cv2.COLOR_BGR2GRAY).astype(np.float32)
        d = cv2.GaussianBlur(d, (0, 0), 2.0)
        g = np.hypot(cv2.Sobel(d, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(d, cv2.CV_32F, 0, 1, ksize=3)) / 8
        changed = cv2.GaussianBlur((np.abs(d) > 2).astype(np.float32), (0, 0), 3)
        band = ((mask > 0.02) & (mask < 0.5)) | ((changed > 0.1) & (changed < 0.6))
        return float(g[band].mean()) if band.any() else 0.0

    def box_step(img, ori, j):
        """The classic MuseTalk seam: how much the picture changes right on the edge of the generated square
        (mean grey levels on a 3 px band along its sides and bottom; 0 = invisible)."""
        x1, y1, x2, y2 = boxes[j]
        d = np.abs(cv2.GaussianBlur(img.astype(np.float32) - ori.astype(np.float32), (0, 0), 1.0)).mean(2)
        ym = (y1 + y2) // 2
        band = np.concatenate([d[ym:y2, x1:x1 + 3].ravel(), d[ym:y2, x2 - 3:x2].ravel(), d[y2 - 3:y2, x1:x2].ravel()])
        return float(band.mean()) if band.size else 0.0

    def label(img, text):
        img = img.copy()
        cv2.rectangle(img, (0, 0), (img.shape[1], 22), (0, 0, 0), -1)
        cv2.putText(img, text, (5, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)
        return img

    picks = {}
    scored = [(i, s) for i, s in enumerate(stats) if s and alpha[i] >= 1]
    for key in ("ghost", "chin", "hand"):
        if scored:
            i, s = max(scored, key=lambda x: x[1][key])
            picks[key] = i
    picks["edge-start"] = 0
    picks["edge-end"] = n - 1
    for rg in ranges[:4]:
        a, b = int(round(rg["from"] * FPS)), int(round(rg["to"] * FPS))
        tag = rg["reason"].replace(" ", "-")
        picks[f"fallback-{tag}-middle"] = (a + b) // 2  # the old blend pasted a glitch here; now the original stays
        if a > 0 and not bad_out[a - 1]:
            picks[f"fallback-{tag}-crossfade"] = a - 1  # the last generated frame fades into the original
    numbers = {}
    for name, i in picks.items():
        if i not in faces:
            continue
        j = cyc[i % len(cyc)]
        ori = np.asarray(frames[j]).copy()
        new, info = compose_frame(j, faces[i], alpha[i])
        old = old_blend(j, full_face(i))
        X1, Y1, X2, Y2 = info["crop"]
        full_mask = np.zeros(ori.shape[:2], np.float32)
        full_mask[Y1:Y2, X1:X2] = info["mask"]
        crop = lambda im: im[Y1:Y2, X1:X2]  # noqa: E731
        ov = crop(ori).copy()
        tint = np.zeros_like(ov)
        tint[..., 1] = 255
        ov = (ov * (1 - 0.45 * info["mask"][..., None]) + tint * 0.45 * info["mask"][..., None]).astype(np.uint8)
        ov[info["keep_real"] > 0] = (ov[info["keep_real"] > 0] * 0.5 + np.array([0, 0, 255]) * 0.5).astype(np.uint8)
        cnts, _ = cv2.findContours(info["U"], cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(ov, cnts, -1, (255, 255, 0), 1)
        tiles = [label(crop(ori), f"original f{j}"), label(crop(old), "before (old blend)"), label(crop(new), f"guarded a={alpha[i]:.2f}"),
                 label(ov, "mask / keep-real / mouths")]
        hh = max(t_.shape[0] for t_ in tiles)
        th = min(560, hh)
        tiles = [cv2.resize(t_, (int(t_.shape[1] * th / hh), th), interpolation=cv2.INTER_AREA) for t_ in tiles]
        cv2.imwrite(os.path.join(args.proof, f"{name}.png"), np.concatenate(tiles, 1))
        # The mouth at 2×, original / before / guarded, where ghosts and seams are easiest to see.
        lx0, ly0, lx1, ly1 = lip_box(M[j], pad=0.9)
        zoom = [cv2.resize(im[ly0:ly1, lx0:lx1], None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC) for im in (ori, old, new)]
        cv2.imwrite(os.path.join(args.proof, f"{name}-mouth.png"), np.concatenate(zoom, 1))
        # Where the picture changed, ×4 (black = untouched): seams show up as hard lines or a square.
        diff = [label(np.clip(np.abs(crop(im).astype(np.int16) - crop(ori).astype(np.int16)) * 4, 0, 255).astype(np.uint8), t_)
                for im, t_ in ((old, "change x4, before"), (new, "change x4, guarded"))]
        cv2.imwrite(os.path.join(args.proof, f"{name}-change.png"), np.concatenate(diff, 1))
        numbers[name] = {
            "outFrame": i, "srcFrame": j, "alpha": round(alpha[i], 3),
            "ghost": round(info["ghost"], 3), "chin": round(info["chin"], 3), "hand": round(info["hand"], 3),
            "seamOld": round(seam(old, ori, full_mask), 2), "seamNew": round(seam(new, ori, full_mask), 2),
            "squareEdgeOld": round(box_step(old, ori, j), 2), "squareEdgeNew": round(box_step(new, ori, j), 2),
        }
    with open(os.path.join(args.proof, "proof.json"), "w") as fh:
        json.dump({"picks": numbers, "report": report, "medianSharpness": median_sharp,
                   "reasons": {r_: reason.count(r_) for r_ in set(reason)}}, fh, indent=1)


if args.proof:
    say("STATUS", "writing the proof frames")
    proof()

cleanup()
progress(1)
say("REPORT", json.dumps(report))
say("STATUS", "done")
