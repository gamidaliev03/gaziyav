# CleanUp on this Mac: an object (a person, a logo, a caption burned into the picture) is removed from a photo or a
# clip and the background is filled in. Everything runs on ONNX Runtime + OpenCV, no network:
#  - the object: a click on it (SAM 2.1 tiny finds its outline) and/or a brush stroke, on one frame;
#  - in a clip the outline follows the object: optical flow carries it from frame to frame, and every few frames
#    SAM redraws it from the carried box (so it keeps the object's real edge as it moves and turns);
#  - the fill: the background is taken from the other frames where it is visible (each frame aligned to this one by
#    the camera's motion), nearest frames first; what no frame ever shows is painted by LaMa once and carried on with
#    the camera, so it doesn't flicker. A photo is filled by LaMa directly.
# The picture is worked on at ≤1280 px and only the filled area is put back into the full-size frames.
# Usage:
#   python local-cleanup.py --models <LocalCleanup dir> --ffmpeg <bin> --input clip.mp4|photo.png --out out.mp4|out.png
#     [--at <seconds of the frame the user marked>] [--points '[[x, y, 1], …]' (0–1 of the frame; 1 = object, 0 = keep)]
#     [--brush mask.png (white = remove, on that frame)] [--preview] [--cpu]
#   --preview: only the object's outline on that frame → --out (PNG, white = object); prints "AREA <share>".
# Prints "STATUS"/"PROGRESS" lines; "ERROR <text>" and exit 1 on failure.
import argparse, json, os, re, subprocess, sys, time

p = argparse.ArgumentParser()
for a in ("models", "ffmpeg", "input", "out"):
    p.add_argument("--" + a, required=True)
p.add_argument("--at", type=float, default=0.0)
p.add_argument("--points", default="[]")
p.add_argument("--brush", default="")
p.add_argument("--preview", action="store_true")
p.add_argument("--cpu", action="store_true")
args = p.parse_args()


def say(kind, text):
    print(f"{kind} {text}", flush=True)


def fail(text):
    say("ERROR", text)
    sys.exit(1)


import cv2, numpy as np  # noqa: E402
import onnxruntime as ort  # noqa: E402

ort.set_default_logger_severity(3)
t0 = time.time()
WORK = 1280  # longest side the work is done at
SAM_EVERY = 2  # frames between SAM redraws of the carried outline
REACH = 45  # frames looked at, each way, for background


def session(rel):
    path = os.path.join(args.models, rel)
    if not os.path.exists(path):
        fail(f"the CleanUp model isn't installed ({os.path.basename(rel)})")
    opts = ort.SessionOptions()
    opts.log_severity_level = 3
    return ort.InferenceSession(path, opts, providers=["CPUExecutionProvider"])


IMAGE = os.path.splitext(args.input)[1].lower() in (".png", ".jpg", ".jpeg", ".webp", ".heic", ".bmp", ".tif", ".tiff")
FF = args.ffmpeg
probe = subprocess.run([FF, "-hide_banner", "-i", args.input], capture_output=True, text=True).stderr
size_m = re.search(r"Video:.*?(\d{2,5})x(\d{2,5})", probe)
if not size_m:
    fail("couldn't read the picture")
W, H = int(size_m.group(1)), int(size_m.group(2))
rot = re.search(r"rotation of (-?\d+)", probe) or re.search(r"rotate\s*:\s*(-?\d+)", probe)
if rot and abs(int(rot.group(1))) % 180 == 90:
    W, H = H, W
fps_m = re.search(r"(\d+(?:\.\d+)?) fps", probe)
fps = fps_m.group(1) if fps_m else "30"
has_audio = "Audio:" in probe
scale = min(1.0, WORK / max(W, H))
w, h = max(2, int(round(W * scale / 2)) * 2), max(2, int(round(H * scale / 2)) * 2)


def read_frames(width, height, only=None):
    """Frames as BGR arrays at width×height (all, or the one with index `only`)."""
    if IMAGE:
        img = cv2.imread(args.input, cv2.IMREAD_COLOR)
        if img is None:
            fail("couldn't read the photo")
        yield cv2.resize(img, (width, height), interpolation=cv2.INTER_AREA) if (img.shape[1], img.shape[0]) != (width, height) else img
        return
    vf = f"scale={width}:{height}:flags=area,format=bgr24"
    if only is not None:
        vf = f"select=eq(n\\,{only})," + vf
    proc = subprocess.Popen([FF, "-v", "error", "-i", args.input, "-vf", vf, "-fps_mode", "passthrough", "-f", "rawvideo", "-"], stdout=subprocess.PIPE)
    n = width * height * 3
    while True:
        buf = proc.stdout.read(n)
        if len(buf) < n:
            break
        yield np.frombuffer(buf, np.uint8).reshape(height, width, 3)
        if only is not None:
            break
    proc.stdout.close()
    proc.wait()


# ───────────── The object's outline (SAM 2.1 tiny) ─────────────
class Sam:
    MEAN, STD = np.array([0.485, 0.456, 0.406], np.float32), np.array([0.229, 0.224, 0.225], np.float32)

    def __init__(self):
        self.enc = session(os.path.join("sam2", "onnx", "vision_encoder.onnx"))
        self.dec = session(os.path.join("sam2", "onnx", "prompt_encoder_mask_decoder.onnx"))

    def embed(self, frame):
        x = cv2.resize(frame, (1024, 1024), interpolation=cv2.INTER_AREA)[:, :, ::-1].astype(np.float32) / 255.0
        x = ((x - self.MEAN) / self.STD).transpose(2, 0, 1)[None].astype(np.float32)
        return self.enc.run(None, {"pixel_values": x})

    def mask(self, emb, fw, fh, points, labels, box=None):
        """Outline from points (frame pixels) and an optional box. Of SAM's three answers (the whole thing, a part, a
        detail) the largest one SAM is fairly sure of: a click on a face removes the person, not just the face."""
        sx, sy = 1024.0 / fw, 1024.0 / fh
        pts = np.array([[[[x * sx, y * sy] for x, y in points]]], np.float32).reshape(1, 1, -1, 2)
        lab = np.array([[labels]], np.int64).reshape(1, 1, -1)
        boxes = np.zeros((1, 0, 4), np.float32) if box is None else np.array([[[box[0] * sx, box[1] * sy, box[2] * sx, box[3] * sy]]], np.float32)
        iou, masks, _ = self.dec.run(None, {"input_points": pts, "input_labels": lab, "input_boxes": boxes,
                                            "image_embeddings.0": emb[0], "image_embeddings.1": emb[1], "image_embeddings.2": emb[2]})
        scores = iou[0, 0]
        areas = [(masks[0, 0, k] > 0).sum() for k in range(len(scores))]
        sure = [k for k in range(len(scores)) if scores[k] >= scores.max() - 0.15]
        best = masks[0, 0, max(sure, key=lambda k: areas[k])] if box is None else masks[0, 0, int(scores.argmax())]
        return cv2.resize(best, (fw, fh), interpolation=cv2.INTER_LINEAR) > 0


def interior(m):
    """The point deepest inside an outline (a safe positive click)."""
    d = cv2.distanceTransform(m.astype(np.uint8), cv2.DIST_L2, 5)
    y, x = np.unravel_index(int(d.argmax()), d.shape)
    return float(x), float(y)


def bbox(m, pad=0.06):
    ys, xs = np.nonzero(m)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    px, py = (x1 - x0) * pad + 2, (y1 - y0) * pad + 2
    return [max(0, x0 - px), max(0, y0 - py), min(m.shape[1] - 1, x1 + px), min(m.shape[0] - 1, y1 + py)]


def iou(a, b):
    u = np.logical_or(a, b).sum()
    return np.logical_and(a, b).sum() / u if u else 0.0


points = json.loads(args.points or "[]")
clicks = [(float(x), float(y), int(lbl)) for x, y, lbl in points]
sam = Sam() if clicks else None


def clicked_mask(frame):
    """SAM's outline of what the user clicked (empty without clicks)."""
    fh, fw = frame.shape[:2]
    if not clicks:
        return np.zeros((fh, fw), bool)
    return sam.mask(sam.embed(frame), fw, fh, [(x * fw, y * fh) for x, y, _ in clicks], [lbl for *_, lbl in clicks])


def brush_mask(fw, fh):
    """The brush stroke. It stays put in every frame: what one paints over — a burned-in caption, a logo, a
    watermark — sits still on the screen whatever the camera does."""
    if not args.brush:
        return np.zeros((fh, fw), bool)
    b = cv2.imread(args.brush, cv2.IMREAD_GRAYSCALE)
    if b is None:
        fail("couldn't read the brush stroke")
    return cv2.resize(b, (fw, fh), interpolation=cv2.INTER_NEAREST) > 127


def seed_mask(frame):
    """What the user marked on their frame: SAM's outline of the clicks, plus the brush."""
    return clicked_mask(frame) | brush_mask(frame.shape[1], frame.shape[0])


at_frame = 0 if IMAGE else max(0, int(round(args.at * float(fps))))

if args.preview:
    say("STATUS", "finding the object")
    frame = next(read_frames(w, h, only=at_frame), None)
    if frame is None:
        fail("couldn't read that frame")
    m = seed_mask(frame)
    cv2.imwrite(args.out, (m * 255).astype(np.uint8))
    say("AREA", f"{m.mean():.4f}")
    sys.exit(0)

# ───────────── Read the picture ─────────────
say("STATUS", "reading the clip")
frames = list(read_frames(w, h))
n = len(frames)
if not n:
    fail("couldn't read the clip")
at_frame = min(at_frame, n - 1)
say("PROGRESS", "0.05")

# LaMa: the fill for what no frame shows.
lama = session(os.path.join("lama", "lama_fp32.onnx"))


def lama_fill(img, hole):
    """LaMa on the area around the hole (512² square), pasted back inside the hole."""
    ys, xs = np.nonzero(hole)
    cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
    extent = max(xs.max() - xs.min(), ys.max() - ys.min())
    if extent + 16 >= min(img.shape[:2]):
        # A hole as big as the picture: the whole picture (LaMa sees all the context there is).
        x0 = y0 = 0
        crop, hm = img, hole
    else:
        # A square around the hole with room for context (LaMa works on 512²; a square keeps the shapes true).
        side = int(min(min(img.shape[:2]), max(256, extent * 2.2 + 64)))
        x0 = int(np.clip(cx - side / 2, 0, img.shape[1] - side))
        y0 = int(np.clip(cy - side / 2, 0, img.shape[0] - side))
        crop = img[y0:y0 + side, x0:x0 + side]
        hm = hole[y0:y0 + side, x0:x0 + side]
    ch, cw = crop.shape[:2]
    im = cv2.resize(crop, (512, 512), interpolation=cv2.INTER_AREA)[:, :, ::-1].astype(np.float32).transpose(2, 0, 1)[None] / 255.0
    mk = (cv2.resize(hm.astype(np.uint8), (512, 512), interpolation=cv2.INTER_NEAREST) > 0).astype(np.float32)[None, None]
    out = lama.run(None, {"image": im, "mask": mk})[0][0].transpose(1, 2, 0)
    out = np.clip(out if out.max() > 2 else out * 255, 0, 255).astype(np.uint8)[:, :, ::-1]
    out = cv2.resize(out, (cw, ch), interpolation=cv2.INTER_CUBIC)
    res = img.copy()
    region = res[y0:y0 + ch, x0:x0 + cw]
    region[hm] = out[hm]
    return res


# ───────────── The outline in every frame ─────────────
say("STATUS", "following the object")
painted_area = brush_mask(w, h)
seed = clicked_mask(frames[at_frame])
if (seed | painted_area).sum() < 16:
    fail("nothing is marked — click the object or paint over it")
masks = [None] * n
masks[at_frame] = seed
small = lambda f: cv2.cvtColor(cv2.resize(f, (f.shape[1] // 2, f.shape[0] // 2), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
gx, gy = np.meshgrid(np.arange(w // 2, dtype=np.float32), np.arange(h // 2, dtype=np.float32))
done = 1
for step in (1, -1):
    prev, prev_g = seed, small(frames[at_frame])
    i = at_frame + step
    while 0 <= i < n:
        g = small(frames[i])
        flow = dis.calc(g, prev_g, None)  # where each pixel of this frame was in the last one
        pm = cv2.resize(prev.astype(np.float32), (w // 2, h // 2), interpolation=cv2.INTER_AREA)
        carried = cv2.remap(pm, gx + flow[..., 0], gy + flow[..., 1], cv2.INTER_LINEAR, borderValue=0)
        m = cv2.resize(carried, (w, h), interpolation=cv2.INTER_LINEAR) > 0.5
        if sam and m.sum() > 64 and abs(i - at_frame) % SAM_EVERY == 0:
            redrawn = sam.mask(sam.embed(frames[i]), w, h, [interior(m)], [1], bbox(m, 0.15))
            if iou(redrawn, m) > 0.45:
                # SAM's edge, plus whatever the flow carried that SAM missed at the box edge (a fast hand).
                m = redrawn | (m & (cv2.dilate(redrawn.astype(np.uint8), np.ones((15, 15), np.uint8)) > 0))
        masks[i] = m
        prev, prev_g = m, g
        done += 1
        say("PROGRESS", f"{0.05 + 0.4 * done / n:.3f}")
        i += step
        if not seed.any():
            break
for i in range(n):
    masks[i] = (masks[i] if masks[i] is not None else np.zeros((h, w), bool)) | painted_area

# A margin around the object (its edge, soft shadow, motion blur).
grow = max(3, int(round(min(w, h) * 0.02)))
kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * grow + 1, 2 * grow + 1))
holes = [cv2.dilate(m.astype(np.uint8), kernel) > 0 for m in masks]

# ───────────── The camera's motion between neighbours ─────────────
say("STATUS", "matching the frames")
orb = cv2.ORB_create(1500)


def motion(a, b, ma, mb):
    """The camera's move from frame b to frame a (shift, turn, zoom — what a hand-held phone does), from the background
    only; identity when it can't be told for sure (hands or a body moving in front would otherwise pass for it)."""
    ka, da = orb.detectAndCompute(a, (~ma).astype(np.uint8) * 255)
    kb, db = orb.detectAndCompute(b, (~mb).astype(np.uint8) * 255)
    if da is None or db is None or len(ka) < 30 or len(kb) < 30:
        return np.eye(3)
    matches = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(db, da)
    if len(matches) < 30:
        return np.eye(3)
    src = np.float32([kb[m.queryIdx].pt for m in matches]).reshape(-1, 1, 2)
    dst = np.float32([ka[m.trainIdx].pt for m in matches]).reshape(-1, 1, 2)
    A, inl = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=2.0)
    if A is None or inl is None or inl.sum() < 40 or inl.mean() < 0.5:
        return np.eye(3)
    Hm = np.vstack([A, [0, 0, 1]])
    corners = np.float32([[0, 0], [b.shape[1], 0], [0, b.shape[0]], [b.shape[1], b.shape[0]]]).reshape(-1, 1, 2)
    moved = np.abs(cv2.perspectiveTransform(corners, Hm) - corners).max()
    # Barely moving (a tripod, a phone on a stand): exactly still, so nothing swims. A jump of more than a tenth of
    # the frame between two frames is a cut or a misreading, not a camera move.
    if moved < 0.75 or moved > 0.1 * max(b.shape):
        return np.eye(3)
    return Hm


half = [cv2.resize(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY), (w // 2, h // 2), interpolation=cv2.INTER_AREA) for f in frames]
half_holes = [cv2.resize(m.astype(np.uint8), (w // 2, h // 2), interpolation=cv2.INTER_NEAREST) > 0 for m in holes]
S = np.diag([2.0, 2.0, 1.0])
to_first = [np.eye(3)]  # frame i → frame 0
for i in range(1, n):
    Hh = motion(half[i - 1], half[i], half_holes[i - 1], half_holes[i])  # half-size: i onto i-1
    to_first.append(to_first[-1] @ (S @ Hh @ np.linalg.inv(S)))
    say("PROGRESS", f"{0.45 + 0.1 * i / n:.3f}")
from_first = [np.linalg.inv(m) for m in to_first]

# ───────────── Fill ─────────────
# Does the picture move around the hole (beyond the camera)? A caption over a talking person's hands: the hidden part
# changes every frame, so it is painted in every frame (softened with the last one); over a still wall it is painted
# once and carried with the camera (a painted fill that never flickers).
ring_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (6 * grow + 1, 6 * grow + 1))
moving_frames = 0
for i in range(1, n):
    ring = (cv2.dilate(holes[i].astype(np.uint8), ring_k) > 0) & ~holes[i] & ~holes[i - 1]
    if ring.sum() < 50:
        continue
    prev = cv2.warpPerspective(cv2.cvtColor(frames[i - 1], cv2.COLOR_BGR2GRAY), from_first[i] @ to_first[i - 1], (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    diff = np.abs(cv2.cvtColor(frames[i], cv2.COLOR_BGR2GRAY).astype(np.float32) - prev.astype(np.float32))[ring].mean()
    moving_frames += diff > 6.0
LIVE = moving_frames > 0.3 * max(1, n - 1)

say("STATUS", "filling in the background")
filled = [None] * n
ones = np.full((h, w), 255, np.uint8)
lama_runs = 0
for i in range(n):
    out = frames[i].copy()
    need = holes[i].copy()
    if need.any():
        order = sorted((j for j in range(max(0, i - REACH), min(n, i + REACH + 1)) if j != i), key=lambda j: abs(j - i))
        # Real background first (nearest frames); what no frame shows: the last filled frame carried with the camera
        # (still surroundings) or painted again (moving surroundings), then LaMa.
        sources = [(frames[j], ~holes[j], j) for j in order] + ([(filled[i - 1], None, i - 1)] if i > 0 and not LIVE else [])
        for img, valid, j in sources:
            if not need.any():
                break
            Hij = from_first[i] @ to_first[j]
            warped = cv2.warpPerspective(img, Hij, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            ok = cv2.warpPerspective(ones if valid is None else valid.astype(np.uint8) * 255, Hij, (w, h), flags=cv2.INTER_NEAREST, borderValue=0) == 255
            take = need & ok
            out[take] = warped[take]
            need &= ~take
        if need.any():
            painted = lama_fill(out, need)
            lama_runs += 1
            if LIVE and i > 0:
                # Softened with the last frame's fill (carried with the camera): the painted part doesn't shimmer.
                Hl = from_first[i] @ to_first[i - 1]
                last = cv2.warpPerspective(filled[i - 1], Hl, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
                inside = need & (cv2.warpPerspective(ones, Hl, (w, h), flags=cv2.INTER_NEAREST, borderValue=0) == 255)
                painted[inside] = (0.6 * painted[inside].astype(np.float32) + 0.4 * last[inside].astype(np.float32) + 0.5).astype(np.uint8)
            out = painted
    filled[i] = out
    say("PROGRESS", f"{0.55 + 0.3 * (i + 1) / n:.3f}")
say("STATUS", f"filled ({lama_runs} painted{', moving surroundings' if LIVE else ''})")


# ───────────── Back into the full-size picture ─────────────
def soft(hole, size):
    a = cv2.resize(hole.astype(np.float32), size, interpolation=cv2.INTER_LINEAR)
    return np.clip(cv2.GaussianBlur(a, (0, 0), max(1.0, 1.5 / scale)) * 1.4, 0, 1)[..., None]


def compose(full, i):
    if not holes[i].any():
        return full
    fill = cv2.resize(filled[i], (W, H), interpolation=cv2.INTER_CUBIC) if scale < 1 else filled[i]
    a = soft(holes[i], (W, H))
    return (full.astype(np.float32) * (1 - a) + fill.astype(np.float32) * a + 0.5).astype(np.uint8)


if IMAGE:
    full = cv2.imread(args.input, cv2.IMREAD_COLOR)
    cv2.imwrite(args.out, compose(full, 0))
else:
    say("STATUS", "writing the clip")
    cmd = [FF, "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", fps, "-i", "-", "-i", args.input, "-map", "0:v"]
    if has_audio:
        cmd += ["-map", "1:a:0", "-c:a", "aac", "-b:a", "192k"]
    rate = max(8, min(40, round(W * H * float(fps) / 1e6 * 0.25)))
    cmd += ["-c:v", "h264_videotoolbox", "-b:v", f"{rate}M", "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
            "-movflags", "+faststart", "-shortest", args.out]
    writer = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for i, full in enumerate(read_frames(W, H)):
        if i >= n:
            break
        writer.stdin.write(np.ascontiguousarray(compose(full, i)).tobytes())
        if i % 10 == 0:
            say("PROGRESS", f"{0.85 + 0.14 * i / n:.3f}")
    writer.stdin.close()
    if writer.wait() != 0:
        fail("couldn't write the result")
if not os.path.exists(args.out):
    fail("couldn't write the result")
say("STATUS", f"done in {time.time() - t0:.0f} s ({n} frames)")
say("PROGRESS", "1")
