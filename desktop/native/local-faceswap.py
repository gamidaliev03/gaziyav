# On-device face swap, the best open pipeline (as in FaceFusion 3): HyperSwap 1b (256) puts the new face in, a face
# parser (BiSeNet) keeps it inside the person's own face outline (no hair, ears or background smeared), GFPGAN 1.4
# restores the face detail, and the face points are filtered over time (One-Euro) so nothing shimmers. Faces are found
# and aligned by Apple Vision (the lipmarks helper); the models run on ONNX Runtime + Core ML (Neural Engine / GPU).
# Pipelined across the chip: the Neural Engine swaps frame N+1 while the GPU restores frame N (two restorers at once),
# and the person in frame N+2 is read (face labels, beard) on another thread; the frames reach the encoder in order —
# same result, ~2× faster than one frame at a time.
# Beards: a bearded or stubbly person is shaved before the swap (the swap model keeps the hair it sees and its square
# ends at the chin), so a new face never carries beard remnants on the jaw or under it. One face is followed: frames
# where Vision reports another person (two people in the picture) count as lost and are carried by optical flow, so the
# new face never jumps onto someone else or flies across the picture.
# Trending looks (--look zombie|marble|gold|cyborg|vampire|alien|doll|aged, no --face): no other face at all — the
# person's own face is restyled inside its outline, followed the same way (see LOOKS below).
# Retouch (--look retouch [--strength 0..1]): the person's own face restored by GFPGAN (sharper eyes, smoother skin) inside
# its outline; no other face and no AI mark (nothing was swapped).
# The «AI-generated» mark is burned in. Usage:
#   python local-faceswap.py --models <LocalFaceSwap dir> --lipmarks <bin> --ffmpeg <bin> --face face.png \
#     --video clip.mp4 --out out.mp4 [--plate plate.png] [--cpu]
#   python local-faceswap.py ... --look zombie --video clip.mp4 --out out.mp4
# Prints "STATUS"/"PROGRESS" lines; "ERROR <text>" and exit 1 on failure.
import argparse, collections, json, math, os, queue, re, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

p = argparse.ArgumentParser()
for a in ("models", "lipmarks", "ffmpeg", "face", "video", "out"):
    p.add_argument("--" + a, required=a != "face")
p.add_argument("--look", default="", help="restyle the person's own face instead of swapping it")
p.add_argument("--plate", default="")
p.add_argument("--cpu", action="store_true", help="no Core ML (the fallback when Core ML fails on this Mac)")
p.add_argument("--strength", type=float, default=0.7, help="retouch: how much of the restored face (0-1)")
args = p.parse_args()
if not args.face and not args.look:
    p.error("--face or --look is needed")


def say(kind, text):
    print(f"{kind} {text}", flush=True)


def fail(text):
    say("ERROR", text)
    sys.exit(1)


import cv2, numpy as np  # noqa: E402
import onnxruntime as ort  # noqa: E402

ort.set_default_logger_severity(3)

# Five-point templates (fractions of the crop): ArcFace recognition, the HyperSwap crop and the FFHQ (GFPGAN) crop.
ARCFACE_112_V2 = np.array([[0.34191607, 0.46157411], [0.65653393, 0.45983393], [0.50022500, 0.64050536], [0.37097589, 0.82469196], [0.63151696, 0.82325089]])
ARCFACE_128 = np.array([[0.36167656, 0.40387734], [0.63696719, 0.40235469], [0.50019687, 0.56044219], [0.38710391, 0.72160547], [0.61507734, 0.72034453]])
FFHQ_512 = np.array([[0.37691676, 0.46864664], [0.62285697, 0.46912813], [0.50123859, 0.61331904], [0.39308822, 0.72541100], [0.61150205, 0.72490465]])
# Face parser classes kept: skin, brows, eyes, glasses, nose, mouth, lips (not hair, ears, neck, clothes).
FACE_CLASSES = [1, 2, 3, 4, 5, 6, 10, 11, 12, 13]

# Each model on the unit it runs best and safely on (measured on M1 Pro; the GPU graph of some models fails).
UNITS = {
    "arcface_w600k_r50.onnx": ("MLProgram", "ALL"),
    "hyperswap_1b_256.onnx": ("MLProgram", "CPUAndNeuralEngine"),
    "gfpgan_1.4.onnx": ("MLProgram", "CPUAndGPU"),
    "bisenet_resnet_34.onnx": ("NeuralNetwork", "ALL"),
}


def session(name):
    path = os.path.join(args.models, name)
    if not os.path.exists(path):
        fail(f"the face swap model isn't installed ({name})")
    opts = ort.SessionOptions()
    opts.log_severity_level = 3
    if args.cpu:
        return ort.InferenceSession(path, opts, providers=["CPUExecutionProvider"])
    fmt, units = UNITS[name]
    cache = os.path.join(args.models, "coreml-cache", units)
    os.makedirs(cache, exist_ok=True)
    o = {"ModelFormat": fmt, "MLComputeUnits": units}
    if fmt == "MLProgram":
        o["ModelCacheDirectory"] = cache
    try:
        return ort.InferenceSession(path, opts, providers=[("CoreMLExecutionProvider", o), "CPUExecutionProvider"])
    except Exception:  # noqa: BLE001
        return ort.InferenceSession(path, opts, providers=["CPUExecutionProvider"])


def marks(path):
    r = subprocess.run([args.lipmarks, path, "--nohands"], capture_output=True, text=True)
    if r.returncode:
        fail("couldn't look at the face: " + (r.stderr.strip()[-200:] or "lipmarks failed"))
    return json.loads(r.stdout)


def five(m):
    """Eye centres, nose tip and mouth corners (image-left first) from Apple Vision's face outlines."""
    if not m or len(m.get("leye", [])) < 3 or len(m.get("reye", [])) < 3 or len(m.get("outer", [])) < 4:
        return None
    e1, e2 = np.mean(m["leye"], axis=0), np.mean(m["reye"], axis=0)
    if e1[0] > e2[0]:
        e1, e2 = e2, e1
    axis = (e2 - e1) / (np.linalg.norm(e2 - e1) + 1e-6)
    lips = np.array(m["outer"], dtype=np.float64)
    proj = lips @ axis
    m1, m2 = lips[int(np.argmin(proj))], lips[int(np.argmax(proj))]
    crest = np.array(m.get("crest") or m.get("nose"), dtype=np.float64)
    down = np.array([-axis[1], axis[0]])
    nose = crest[int(np.argmax(crest @ down))] if len(crest) else (e1 + e2) / 2 + down * np.linalg.norm(e2 - e1) * 0.6
    return np.array([e1, e2, nose, m1, m2], dtype=np.float32)


def warp(frame, pts, template, size):
    matrix = cv2.estimateAffinePartial2D(pts, template * size, method=cv2.RANSAC, ransacReprojThreshold=100)[0]
    return cv2.warpAffine(frame, matrix, (size, size), borderMode=cv2.BORDER_REPLICATE, flags=cv2.INTER_AREA), matrix


def box_mask(size, blur=0.3):
    m = np.ones((size, size), np.float32)
    edge = max(int(size * 0.5 * blur) // 2, 1)
    m[:edge, :] = 0
    m[-edge:, :] = 0
    m[:, :edge] = 0
    m[:, -edge:] = 0
    return cv2.GaussianBlur(m, (0, 0), size * 0.5 * blur * 0.25)


def paste(frame, crop, mask, matrix):
    """crop (float BGR 0..255) back into frame through the inverse of matrix, blended by mask (0..1)."""
    H, W = frame.shape[:2]
    size = crop.shape[0]
    inverse = cv2.invertAffineTransform(matrix)
    corners = cv2.transform(np.array([[[0, 0], [size, 0], [size, size], [0, size]]], np.float32), inverse)[0]
    x1, y1 = np.clip(np.floor(corners.min(0)).astype(int), 0, [W, H])
    x2, y2 = np.clip(np.ceil(corners.max(0)).astype(int), 0, [W, H])
    if x2 - x1 < 4 or y2 - y1 < 4:
        return frame
    inverse[0, 2] -= x1
    inverse[1, 2] -= y1
    m = cv2.warpAffine(mask, inverse, (x2 - x1, y2 - y1)).clip(0, 1)[:, :, None]
    face = cv2.warpAffine(crop, inverse, (x2 - x1, y2 - y1), borderMode=cv2.BORDER_REPLICATE)
    out = frame.copy()
    region = out[y1:y2, x1:x2].astype(np.float32)
    out[y1:y2, x1:x2] = (region * (1 - m) + face * m).clip(0, 255).astype(np.uint8)
    return out


class OneEuro:
    """One-Euro filter (Casiez et al.): steady when still, no lag when the head moves."""

    def __init__(self, fps, min_cutoff=1.2, beta=0.02, d_cutoff=1.0):
        self.fps, self.min_cutoff, self.beta, self.d_cutoff = fps, min_cutoff, beta, d_cutoff
        self.x = None
        self.dx = None

    def __call__(self, x):
        if self.x is None:
            self.x, self.dx = x.copy(), np.zeros_like(x)
            return x
        dx = (x - self.x) * self.fps
        a_d = 1.0 / (1.0 + self.fps / (2 * math.pi * self.d_cutoff))
        self.dx = a_d * dx + (1 - a_d) * self.dx
        cutoff = self.min_cutoff + self.beta * np.abs(self.dx)
        a = 1.0 / (1.0 + self.fps / (2 * math.pi * cutoff))
        self.x = a * x + (1 - a) * self.x
        return self.x.copy()


t0 = time.time()


def load_face():
    """The new face's identity (for a swap): its picture, its points, the swap and restore models."""
    global recognizer, swapper, enhancers, source
    say("STATUS", "reading the new face")
    src = cv2.imread(args.face, cv2.IMREAD_COLOR)
    if src is None:
        fail("couldn't read the face picture")
    sm = marks(args.face)
    spts = five(sm["frames"][0] if sm["frames"] else None)
    if spts is None:
        fail("no clear face in the picture — use a front-facing photo with the whole face visible")
    if (sm["w"], sm["h"]) != (src.shape[1], src.shape[0]):
        spts = spts * np.array([src.shape[1] / sm["w"], src.shape[0] / sm["h"]], dtype=np.float32)

    say("STATUS", "loading the face models")
    recognizer = session("arcface_w600k_r50.onnx")
    swapper = session("hyperswap_1b_256.onnx")
    # Two restorers: their runs overlap on the GPU (157 ms a frame instead of 193 on an M1 Pro).
    enhancers = queue.Queue()
    for _ in range(1 if args.cpu else 2):
        enhancers.put(session("gfpgan_1.4.onnx"))
    crop, _ = warp(src, spts, ARCFACE_112_V2, 112)
    x = (crop[:, :, ::-1] / 127.5 - 1).transpose(2, 0, 1)[None].astype(np.float32)
    embedding = recognizer.run(None, {recognizer.get_inputs()[0].name: x})[0].ravel()
    source = (embedding / np.linalg.norm(embedding)).reshape(1, -1).astype(np.float32)


if args.look:
    say("STATUS", "loading the face models")
    if args.look == "retouch":
        enhancers = queue.Queue()
        enhancers.put(session("gfpgan_1.4.onnx"))
else:
    load_face()
parser = session("bisenet_resnet_34.onnx")
parser_ahead = session("bisenet_resnet_34.onnx")  # its own copy for the thread that prepares the next frame
say("PROGRESS", "0.04")

say("STATUS", "finding the face in the clip (Apple Vision)")
vm = marks(args.video)
W, H, M = vm["w"], vm["h"], vm["frames"]
P = [five(m) for m in M]
if not any(x is not None for x in P):
    fail("no face found in this clip — pick a piece where the face is clearly visible")


def spot(p):
    """Centre and size of a face from its five points."""
    return p.mean(0), max(float(np.ptp(p, 0).max()) * 2.0, 8.0)


def same_face(p, q, frames=1):
    """Whether five points p and q (`frames` apart) can be the same face: it moved less than half its size (a little more
    over a longer gap) and didn't change size abruptly."""
    (c1, s1), (c2, s2) = spot(p), spot(q)
    return float(np.linalg.norm(c1 - c2)) <= (0.5 + 0.06 * (frames - 1)) * max(s1, s2) and 0.6 < s1 / s2 < 1.67


# One face, followed. Apple Vision reports one face per frame, and with two people in the picture it sometimes reports
# the other one for a frame or a few: the new face would jump onto the other person and fly back across the picture
# (the time filter drags it through the frames in between). A jump that comes back within half a second is not this
# face — those frames count as a moment where the face was lost (carried by optical flow below); a jump that stays is a
# cut to another face: the filter starts over there and nothing is blended across it. A run shorter than a fifth of a
# second (a flash of another face) is dropped too.
cuts = set()
foreign = 0
track = None
i = 0
while i < len(P):
    if P[i] is None:
        i += 1
        continue
    if track is None or same_face(P[i], track):
        track = P[i]
        i += 1
        continue
    back = next((k for k in range(i + 1, min(len(P), i + 13)) if P[k] is not None and same_face(P[k], track, k - i + 1)), None)
    if back is not None:
        for k in range(i, back):
            if P[k] is not None:
                P[k] = None
                foreign += 1
        i = back
    else:
        cuts.add(i)
        track = P[i]
        i += 1
runs = sorted(cuts | {0, len(P)})
for r0, r1 in zip(runs, runs[1:]):
    if 0 < sum(P[k] is not None for k in range(r0, r1)) < 6 and r1 - r0 < 6:
        for k in range(r0, r1):
            if P[k] is not None:
                P[k] = None
                foreign += 1
        cuts.discard(r0)
if foreign:
    say("STATUS", f"skipped {foreign} frames where Vision saw another face")
for i in range(len(P)):  # short Vision misses (1–2 frames) are filled in
    if P[i] is None:
        a = next((j for j in range(i - 1, max(-1, i - 3), -1) if P[j] is not None), None)
        b = next((j for j in range(i + 1, min(len(P), i + 3)) if P[j] is not None), None)
        if a is not None and b is not None and same_face(P[a], P[b], b - a) and not any(a < c <= b for c in cuts):
            P[i] = P[a] + (P[b] - P[a]) * ((i - a) / (b - a))

FF = args.ffmpeg
probe = subprocess.run([FF, "-hide_banner", "-i", args.video], capture_output=True, text=True).stderr
fps_m = re.search(r"(\d+(?:\.\d+)?) fps", probe)
fps = fps_m.group(1) if fps_m else "30"
has_audio = "Audio:" in probe

# Developer check of the gap tracking: GAZIYAV_FS_DROP="60-89" hides Vision's face in those frames.
if os.environ.get("GAZIYAV_FS_DROP"):
    lo, hi = (int(v) for v in os.environ["GAZIYAV_FS_DROP"].split("-"))
    for i in range(max(0, lo), min(len(P), hi + 1)):
        P[i] = None

# Gaps: where Vision loses the face for a moment (a quick turn, motion blur, a hand), the face is carried by optical
# flow — feature points inside the face are tracked frame to frame (pyramidal Lucas–Kanade, each one checked by tracking
# it back), a similarity transform is fitted to them (RANSAC) and moves the five face points. Forward from the last face
# and backward from the next one, blended across the gap. Where the flow loses it too, the swap fades out and back in
# over a quarter of a second instead of popping back to the original face.
MAX_GAP = 90  # frames; a longer gap is a cut or the person left the frame
gaps = []
i = 0
while i < len(P):
    if P[i] is not None:
        i += 1
        continue
    j = i
    while j < len(P) and P[j] is None:
        j += 1
    if j - i <= MAX_GAP and (i > 0 or j < len(P)):
        gaps.append((i - 1 if i > 0 else None, j if j < len(P) else None))
    i = j
tracked = 0
if gaps:
    need = set()
    for a, b in gaps:
        need.update(range(0 if a is None else a, (len(P) - 1 if b is None else b) + 1))
    gw = min(640, W)
    scale = gw / W
    gh = max(2, int(round(H * scale / 2)) * 2)
    gray = {}
    proc = subprocess.Popen([FF, "-v", "error", "-i", args.video, "-vf", f"scale={gw}:{gh},format=gray", "-f", "rawvideo", "-"], stdout=subprocess.PIPE)
    k = 0
    while True:
        buf = proc.stdout.read(gw * gh)
        if len(buf) < gw * gh:
            break
        if k in need:
            gray[k] = np.frombuffer(buf, np.uint8).reshape(gh, gw)
        k += 1
    proc.wait()

    def features(g, pts):
        """Corners inside the face (a disc around the five points), the things optical flow can follow."""
        c = pts.mean(0)
        r = max(12.0, float(np.linalg.norm(pts[1] - pts[0])) * 1.3)
        mask = np.zeros(g.shape, np.uint8)
        cv2.circle(mask, (int(c[0]), int(c[1])), int(r), 255, -1)
        f = cv2.goodFeaturesToTrack(g, maxCorners=150, qualityLevel=0.01, minDistance=4, mask=mask)
        return None if f is None else f.astype(np.float32)

    def carry(start, stop, step):
        """The five points of frame `start`, moved frame by frame towards `stop` (exclusive) while the flow holds."""
        out = {}
        if start not in gray:
            return out
        pts = (P[start] * scale).astype(np.float32)
        g0 = gray[start]
        feats = features(g0, pts)
        k = start
        while feats is not None and len(feats) >= 8:
            k2 = k + step
            if k2 == stop or k2 not in gray:
                break
            g1 = gray[k2]
            nxt, st, _ = cv2.calcOpticalFlowPyrLK(g0, g1, feats, None, winSize=(21, 21), maxLevel=3)
            back, st2, _ = cv2.calcOpticalFlowPyrLK(g1, g0, nxt, None, winSize=(21, 21), maxLevel=3)
            ok = (st.ravel() == 1) & (st2.ravel() == 1) & (np.linalg.norm((back - feats).reshape(-1, 2), axis=1) < 1.0)
            if ok.sum() < 8:
                break
            m, inl = cv2.estimateAffinePartial2D(feats[ok], nxt[ok], method=cv2.RANSAC, ransacReprojThreshold=2.0)
            if m is None or inl is None or inl.sum() < 8:
                break
            pts = cv2.transform(pts[None], m)[0]
            out[k2] = pts / scale
            feats = nxt[ok][inl.ravel() == 1].reshape(-1, 1, 2)
            if len(feats) < 40:
                feats = features(g1, pts)
            g0, k = g1, k2
        return out

    for a, b in gaps:
        fwd = carry(a, b if b is not None else len(P), 1) if a is not None else {}
        bwd = carry(b, a if a is not None else -1, -1) if b is not None else {}
        lo = (a + 1) if a is not None else 0
        hi = (b - 1) if b is not None else len(P) - 1
        apart = a is not None and b is not None and not same_face(P[a], P[b], b - a)  # a cut inside the gap
        for k in range(lo, hi + 1):
            if k in fwd and k in bwd and not apart:
                w = (k - a) / (b - a)
                P[k] = (fwd[k] * (1 - w) + bwd[k] * w).astype(np.float32)
            elif k in fwd or k in bwd:
                P[k] = (fwd.get(k) if k in fwd else bwd[k]).astype(np.float32)
            if P[k] is not None:
                tracked += 1
    del gray
if tracked:
    say("STATUS", f"kept the face through {tracked} frames where it turned or blurred")

# How much of the swap each frame shows: all of it, except the quarter second before and after a gap the flow couldn't
# bridge, where it fades (the original face comes back softly, never with a jump).
FADE = 6
alpha = [0.0 if p is None else 1.0 for p in P]
d = 1e9
for i in range(len(P)):
    d = 0 if P[i] is None else d + 1
    alpha[i] = min(alpha[i], d / (FADE + 1))
d = 1e9
for i in range(len(P) - 1, -1, -1):
    d = 0 if P[i] is None else d + 1
    alpha[i] = min(alpha[i], d / (FADE + 1))
# Points filtered over time, each run of frames with a face on its own.
S = [None] * len(P)
flt = None
for i, pts in enumerate(P):
    if pts is None:
        flt = None
        continue
    if flt is None or i in cuts:
        flt = OneEuro(float(fps))
    S[i] = flt(pts.astype(np.float64)).astype(np.float32)
say("PROGRESS", "0.08")

BOX256, BOX512 = box_mask(256), box_mask(512)
FRAME_ONES = np.ones((H, W), np.uint8)
DILATE = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
MEAN, STD = np.array([0.485, 0.456, 0.406], np.float32), np.array([0.229, 0.224, 0.225], np.float32)


def parse(crop_bgr, net=None):
    """Face-parser classes of a crop, at the crop's size."""
    x = cv2.resize(crop_bgr, (512, 512))[:, :, ::-1].astype(np.float32) / 255.0
    x = ((x - MEAN) / STD).transpose(2, 0, 1)[None].astype(np.float32)
    seg = (net or parser).run(None, {"input": x})[0][0].argmax(0).astype(np.uint8)
    return cv2.resize(seg, crop_bgr.shape[:2][::-1], interpolation=cv2.INTER_NEAREST)


def soft(m):
    return (cv2.GaussianBlur(m.astype(np.float32).clip(0, 1), (0, 0), 5).clip(0.5, 1) - 0.5) * 2


BROWS, EYES = [2, 3], [4, 5, 6]
SMALL = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
# The last frame's swapped face and mask, in the aligned square (the face sits in the same place in every frame there).
prev_face = None
prev_region = None


def steady(prev, cur):
    """The swapped face held still where it barely changes from the last frame (skin and texture shimmer), never where it
    really moves (expressions, the mouth): a solid face from frame to frame."""
    if prev is None:
        return cur
    c, f = cur.astype(np.float32), prev.astype(np.float32)
    d = np.abs(cv2.GaussianBlur(f, (0, 0), 1.2) - cv2.GaussianBlur(c, (0, 0), 1.2)).mean(2)
    w = (0.45 * np.exp(-((d / 5.0) ** 2)))[..., None]
    return np.clip(c + (f - c) * w + 0.5, 0, 255).astype(np.uint8)


# Beards. The swap model keeps a beard or stubble it sees (dark hair on the jaw and under the chin of a new face), and the
# swap square ends at the chin, so a beard under it stays as it was. So the person is shaved first: their whole lower
# face and neck are looked at, aligned like the swap square, wider (crop units -64..320 × -32..352 at 512 px; the face
# parser reads the person here — one run, as before, only wider, so it also sees the jaw and the neck under it); facial
# hair is found there (fine dark-hair texture under the nose, measured against the person's own upper cheeks, so shading
# and a clean-shaven face don't count), and replaced by the skin around it. The swap model then sees a shaved face and
# draws a clean one, and the shaved skin shows wherever the new face doesn't reach (under the jaw, at its edge).
WS = 512 / 384
A_WIDE = np.array([[WS, 0, 64 * WS], [0, WS, 32 * WS]], np.float64)
WIDE_TO_256 = cv2.invertAffineTransform(A_WIDE)


def wide_px(cu):
    return int(round((cu + 32) * WS))


def wide_col(cu):
    return int(round((cu + 64) * WS))


ROW_NOSE, ROW_MOUTH = wide_px(150), wide_px(178)  # under the nose tip, the mouth line (ARCFACE_128 template)
CHEEKS = (wide_px(92), wide_px(140), wide_col(40), wide_col(216))  # rows, columns of the upper cheeks
CHIN = (wide_px(196), wide_px(250), wide_col(76), wide_col(180))  # under the lower lip down to the chin
GRAIN = cv2.GaussianBlur(np.random.default_rng(7).standard_normal((512, 512)).astype(np.float32), (0, 0), 0.7)
GRAIN /= GRAIN.std()
SQ9 = np.ones((9, 9), np.uint8)
LUMA = np.array([0.114, 0.587, 0.299], np.float32)  # BGR
NECK_SHADE = 0.5
CLOSE5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
INNER_KEEP = 0.3  # the inner lower face is shaved this much for the swap model (it replaces that part well itself)
CLOSE15 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
prev_hair = None
last_jaw = None
beard_level = 0.0


def ramp(x, lo, hi):
    t = np.clip((x - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def cheeks(seg):
    m = np.zeros(seg.shape, bool)
    r0, r1, c0, c1 = CHEEKS
    m[r0:r1, c0:c1] = seg[r0:r1, c0:c1] == 1
    return m & ~cv2.dilate(np.isin(seg, [2, 3, 4, 5, 6, 10]).astype(np.uint8), SQ9).astype(bool)


def nconv(img, w, sigma):
    """img smoothed over the pixels where w > 0 only (normalised convolution, quarter size) and its confidence."""
    small_i = cv2.resize(img, (128, 128), interpolation=cv2.INTER_AREA)
    small_w = cv2.resize(w, (128, 128), interpolation=cv2.INTER_AREA)
    num = cv2.GaussianBlur(small_i * small_w[..., None], (0, 0), sigma / 4)
    den = cv2.GaussianBlur(small_w, (0, 0), sigma / 4)
    est = num / np.maximum(den, 1e-4)[..., None]
    return cv2.resize(est, (512, 512)), cv2.resize(np.clip(den / 0.25, 0, 1), (512, 512))


def jaw_side(jaw):
    """1 above the jaw (the face), 0 under it (the neck), from Apple Vision's face outline in crop units; a typical jaw
    when there is none yet."""
    side = np.zeros((512, 512), np.uint8)
    if jaw is not None and len(jaw) >= 5:
        poly = np.concatenate([jaw, [[jaw[-1][0], -40], [jaw[0][0], -40]]])
        cv2.fillPoly(side, [np.round(cv2.transform(poly[None].astype(np.float64), A_WIDE)[0]).astype(np.int32)], 1)
    else:
        cv2.ellipse(side, (wide_col(128), wide_px(140)), (int(92 * WS), int(104 * WS)), 0, 0, 360, 1, -1)
        side[:wide_px(140)] = 1
    return side


def shave(wide, seg, jaw, inside):
    """(hair 0..1, shaved picture, hair as shaved for the swap model) of the wide square, or None for a clean-shaven face.
    Hair: fine detail stronger than on the person's upper cheeks (relative to brightness, so a beard in the shade counts),
    or darker than the cheeks with some texture (a full beard: on the face and just under the jaw only, never a dark
    collar further down); under the nose only, on skin, neck or (below the mouth) hair labels; never on the lips or the
    nostrils. Shaved: stubble → the skin between the hairs with its own shading (a grey closing removes the dark dots,
    not the shadows) in the colour of the skin around; a full beard → that skin, in the shade under the jaw."""
    global prev_hair, beard_level
    ref = cheeks(seg) & (inside > 0)  # only what is in the picture (the square may stick out of the frame)
    if ref.sum() < 300:
        return None
    g = cv2.cvtColor(wide, cv2.COLOR_BGR2GRAY).astype(np.float32)
    detail = np.abs(g - cv2.GaussianBlur(g, (0, 0), 1.2))
    tex = cv2.GaussianBlur(detail, (0, 0), 4) / (cv2.GaussianBlur(g, (0, 0), 4) + 12)
    ts = tex / max(0.004, float(np.median(tex[ref])))
    dark = 1 - g / max(20.0, float(np.median(g[ref])))
    side = jaw_side(jaw)
    near_jaw = 1 - ramp(cv2.distanceTransform(1 - side, cv2.DIST_L2, 3), 20 * WS, 40 * WS)  # 1 on the face
    rows = np.arange(512)[:, None]
    zone = (np.isin(seg, [1, 14]) & (rows >= ROW_NOSE)) | ((seg == 17) & (rows >= ROW_MOUTH))
    zone &= ~cv2.dilate(np.isin(seg, [11, 12, 13]).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    zone &= ~cv2.dilate((seg == 10).astype(np.uint8), SQ9).astype(bool)
    zone &= inside > 0
    zone &= ~cv2.dilate(np.isin(seg, [0, 16]).astype(np.uint8), SQ9).astype(bool)  # off the collar and the background
    zone = cv2.GaussianBlur(zone.astype(np.float32), (0, 0), 2)
    wf = wide.astype(np.float32)
    base = cv2.GaussianBlur(cv2.morphologyEx(wide, cv2.MORPH_CLOSE, CLOSE5), (0, 0), 1.0).astype(np.float32)
    yb = base @ LUMA
    # Stubble shows skin between the hairs (bright after the closing); a dark collar or shirt doesn't.
    skinlike = np.maximum(near_jaw, ramp(yb / max(20.0, float(np.median(g[ref]))), 0.3, 0.5))
    hair = np.maximum(ramp(ts, 1.5, 2.3) * skinlike, ramp(dark, 0.3, 0.5) * ramp(ts, 0.9, 1.3) * near_jaw)
    hair = cv2.morphologyEx(hair * zone, cv2.MORPH_CLOSE, CLOSE15)
    hair = cv2.GaussianBlur(hair, (0, 0), 3) * zone
    first = prev_hair is None
    if not first:  # the map sits on the face (aligned), so it is steadied over time like the mask
        hair = 0.6 * hair + 0.4 * prev_hair
    prev_hair = hair
    # Is there a beard at all: hair on the chin (under the lower lip), steadied over time. A clean-shaven face is left
    # exactly as it was; stubble or a beard is shaved in full.
    r0, r1, c0, c1 = CHIN
    chin = zone[r0:r1, c0:c1] > 0.5
    level = float(hair[r0:r1, c0:c1][chin].mean()) if chin.sum() > 200 else 0.0
    beard_level = level if first else 0.8 * beard_level + 0.2 * level
    gate = ramp(beard_level, 0.4, 0.55)
    if gate <= 0:
        return None
    hair = hair * gate
    # What the swap model sees: the jaw edge and everything under it shaved in full (that is where it leaves hair), the
    # inner lower face only partly — shaving it all would cost the new face its fine skin detail there.
    inside_jaw = cv2.distanceTransform(side, cv2.DIST_L2, 3)
    hair_swap = hair * (1 - (1 - INNER_KEEP) * ramp(inside_jaw, 18 * WS, 36 * WS))
    clean = ((seg == 1) & (inside > 0)).astype(np.float32) * (1 - cv2.dilate(hair, SQ9)).clip(0, 1)
    near, cn = nconv(wf, clean, 12)
    far, _ = nconv(wf, clean, 40)
    skin = far + (near - far) * cn[..., None]
    ys = np.maximum(skin @ LUMA, 1.0)
    stub = yb[..., None] + 0.75 * (skin - ys[..., None]) + 0.25 * (base - yb[..., None])
    thick = (ramp(1 - yb / ys, 0.2, 0.45) * near_jaw)[..., None]
    sidef = cv2.GaussianBlur(side.astype(np.float32), (0, 0), 3)[..., None]
    fill = stub + (skin * (sidef + (1 - sidef) * NECK_SHADE) - stub) * thick
    fill += (GRAIN * 1.3 * float(np.median(detail[ref])))[..., None]
    return hair, fill, hair_swap


def prepare(frame, pts, contour, a):
    """Everything about the person in this frame, one frame ahead on its own thread (in frame order) while the swap
    model works on the last one: the swap square, the wide square and its face labels, the shave (pasted into the frame
    under the new face). Returns (frame, square for the swap model, its matrix, the person's face labels)."""
    global last_jaw
    crop, matrix = warp(frame, pts, ARCFACE_128, 256)
    mw = (np.vstack([A_WIDE, [0, 0, 1]]) @ np.vstack([matrix, [0, 0, 1]]))[:2]
    wide = cv2.warpAffine(frame, mw, (512, 512), borderMode=cv2.BORDER_REPLICATE, flags=cv2.INTER_AREA)
    seg_w = parse(wide, parser_ahead)
    seg_t = cv2.warpAffine(seg_w, WIDE_TO_256, (256, 256), flags=cv2.INTER_NEAREST)
    if contour is not None and len(contour) >= 5:
        jaw = cv2.transform(np.array(contour, np.float64)[None], matrix)[0]
        if last_jaw is not None and len(last_jaw) == len(jaw):
            jaw = 0.5 * jaw + 0.5 * last_jaw
        last_jaw = jaw
    inside = cv2.warpAffine(FRAME_ONES, mw, (512, 512), flags=cv2.INTER_NEAREST, borderValue=0)
    shaved = shave(wide, seg_w, last_jaw, inside)
    if shaved is not None:
        hair, fill, hair_swap = shaved
        h256 = cv2.warpAffine(hair_swap, WIDE_TO_256, (256, 256))[..., None]
        crop = (crop + (cv2.warpAffine(fill, WIDE_TO_256, (256, 256)) - crop) * h256).clip(0, 255).astype(np.uint8)
        frame = paste(frame, fill, hair * a, mw)  # the shaved skin, under the new face (under the jaw, at its edge)
    return frame, crop, matrix, seg_t


def restart():
    """A new run of the face: nothing carried over from before (on the preparing thread, in frame order)."""
    global prev_hair, last_jaw
    prev_hair = last_jaw = None


def swap(pts, a, frame, crop, matrix, seg_t):
    """The new face pasted into the (prepared) frame at strength `a`; returns the frame and its aligned 512 crop for the
    restorer."""
    global prev_face, prev_region
    x = ((crop[:, :, ::-1] / 255.0 - 0.5) / 0.5).transpose(2, 0, 1)[None].astype(np.float32)
    out = swapper.run(None, {"source": source, "target": x})[0]
    y = (np.clip(out[0].transpose(1, 2, 0) * 0.5 + 0.5, 0, 1)[:, :, ::-1] * 255).astype(np.uint8)
    seg_s = parse(y)
    # The person's own brows where the new face has none (they sat higher): skin is painted over them, or they show
    # as a second brow above the new one.
    ghost = np.isin(seg_t, BROWS) & ~cv2.dilate(np.isin(seg_s, BROWS).astype(np.uint8), SMALL).astype(bool) & ~np.isin(seg_s, EYES)
    if ghost.sum() > 12:
        y = cv2.inpaint(y, cv2.dilate(ghost.astype(np.uint8) * 255, SMALL), 6, cv2.INPAINT_TELEA)
    y = steady(prev_face, y)
    prev_face = y
    # The new face covers the person's own face AND its own outline, a little wider; its edge moves smoothly over time
    # (the face parser's outline jitters by a few pixels from frame to frame).
    region = np.maximum(soft(np.isin(seg_t, FACE_CLASSES)), soft(np.isin(seg_s, FACE_CLASSES)))
    region = cv2.GaussianBlur(cv2.dilate(region, DILATE), (0, 0), 3)
    if prev_region is not None:
        region = 0.65 * region + 0.35 * prev_region
    prev_region = region
    frame = paste(frame, y.astype(np.float32), np.minimum(BOX256, region) * a, matrix)
    crop, matrix = warp(frame, pts, FFHQ_512, 512)
    return frame, crop, matrix


# Trending looks (--look): the person keeps their own face; it is restyled inside the face parser's outline on the
# aligned 512 square (FFHQ template), so every pattern sits on the face and moves with it. Nothing is generated: no
# other person's face, no new model. Each look: (crop BGR float 0..255, labels) -> (styled crop, where it applies 0..1).
LOOKS = ("zombie", "marble", "gold", "cyborg", "vampire", "alien", "doll", "aged")


def _fbm(seed, scales):
    out = np.zeros((512, 512), np.float32)
    for k, (s, w) in enumerate(scales):
        r = np.random.default_rng(seed + k).standard_normal((512 // s + 3, 512 // s + 3)).astype(np.float32)
        n = cv2.GaussianBlur(cv2.resize(r, (512, 512), interpolation=cv2.INTER_CUBIC), (0, 0), max(1.0, s * 0.3))
        out += w * (n - n.mean()) / (n.std() + 1e-6)
    return out / (out.std() + 1e-6)


N_LO = _fbm(21, [(96, 1.0), (48, 0.5)])
N_MID = _fbm(41, [(40, 1.0), (20, 0.5), (10, 0.25)])
N_HI = _fbm(61, [(6, 1.0)])
VEINS = np.exp(-((N_MID / 0.07) ** 2)).astype(np.float32)  # thin lines where the noise crosses zero
YY, XX = np.mgrid[0:512, 0:512].astype(np.float32)
# Places on the FFHQ square: eye centres (template), cheeks, outer eye corners, nose wings, mouth corners.
EYE_L, EYE_R = FFHQ_512[0] * 512, FFHQ_512[1] * 512


def _blob(cx, cy, r):
    return np.exp(-(((XX - cx) ** 2 + (YY - cy) ** 2) / (2 * r * r))).astype(np.float32)


def _gmap(L, stops):
    """Gradient map: luminance 0..1 -> BGR through (position, (b, g, r)) stops."""
    pos = [s[0] for s in stops]
    return np.stack([np.interp(L, pos, [s[1][c] for s in stops]) for c in range(3)], -1).astype(np.float32)


def _smooth(L, d=9, sc=0.08, ss=7):
    return cv2.bilateralFilter(L.astype(np.float32), d, sc, ss)


def _mix(a, b, w):
    w = w[..., None] if np.ndim(w) == 2 else w
    return a + (b - a) * w


def _bulge(img, c, r, k, interp):
    """Magnifies a disc (radius r) around c by up to k (doll eyes)."""
    dx, dy = XX - c[0], YY - c[1]
    d = np.sqrt(dx * dx + dy * dy) / r
    f = np.where(d < 1, 1 - k * (1 - d * d) ** 2, 1).astype(np.float32)
    return cv2.remap(img, (c[0] + dx * f).astype(np.float32), (c[1] + dy * f).astype(np.float32), interp, borderMode=cv2.BORDER_REPLICATE)


def _blank_eyes(col, eyes, L):
    """Statue eyes: the eye openings filled with the surface around them, the lid crease kept as shading."""
    m = cv2.dilate(eyes.astype(np.uint8) * 255, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))
    if m.max() == 0:
        return col
    filled = cv2.inpaint(np.clip(col, 0, 255).astype(np.uint8), m, 7, cv2.INPAINT_TELEA).astype(np.float32)
    shade = (0.82 + 0.18 * np.clip(L / max(1e-3, float(L[m > 0].mean() if (m > 0).any() else 0.5)), 0.6, 1.2))[..., None]
    w = cv2.GaussianBlur((m > 0).astype(np.float32), (0, 0), 2)
    return _mix(col, filled * shade, w)


def look(name, crop, seg):
    L = (crop @ LUMA) / 255.0
    grey = np.repeat(L[..., None] * 255, 3, -1)
    skin = np.isin(seg, [1, 10]).astype(np.float32)
    eyes = np.isin(seg, [4, 5])
    brows = np.isin(seg, [2, 3]).astype(np.float32)
    lips = np.isin(seg, [12, 13]).astype(np.float32)
    mouth = (seg == 11).astype(np.float32)
    face = np.isin(seg, FACE_CLASSES + [7, 8]).astype(np.float32)
    neck = (seg == 14).astype(np.float32)
    region = np.maximum(face, neck * 0.9)
    eyesf = eyes.astype(np.float32)
    iris = eyesf * np.clip((0.55 - L) / 0.3, 0, 1)  # the dark part of the eye opening
    sockets = np.clip(cv2.GaussianBlur(cv2.dilate(eyes.astype(np.uint8), np.ones((31, 31), np.uint8)).astype(np.float32), (0, 0), 9) - eyesf, 0, 1)

    if name == "zombie":
        col = crop * 0.2 + grey * np.array([0.60, 0.74, 0.58], np.float32) * 0.85
        col *= (1 + 0.12 * N_LO + 0.06 * N_MID)[..., None]
        col = _mix(col, np.array([70, 45, 75], np.float32) * (0.5 + L[..., None]), VEINS * 0.45 * (N_LO > -0.3))
        col *= (1 - 0.5 * sockets)[..., None]
        col = _mix(col, (0.62 + 0.3 * L[..., None]) * np.array([200, 222, 214], np.float32), eyesf * 0.6)
        col = _mix(col, np.array([80, 72, 86], np.float32) * (0.45 + L[..., None]), lips * 0.6)
        col *= (1 - 0.35 * mouth)[..., None]
    elif name in ("marble", "gold"):
        Ls = _smooth(L)
        det = L - cv2.GaussianBlur(L, (0, 0), 2)
        if name == "marble":
            v = np.clip(0.34 + 0.74 * Ls + 0.5 * det, 0, 1.05)
            col = v[..., None] * np.array([236, 238, 240], np.float32)
            col -= (VEINS * 0.22 + np.clip(N_HI, 0, None) * 0.015)[..., None] * np.array([110, 100, 92], np.float32)
        else:
            v = np.clip((Ls - 0.5) * 1.3 + 0.55 + 0.4 * det, 0, 1)
            col = _gmap(v, [(0, (6, 26, 60)), (0.35, (20, 85, 160)), (0.7, (60, 170, 232)), (1.0, (185, 240, 255))])
            col += (np.clip(det * 6, 0, 1) * 70)[..., None]
        col = _blank_eyes(col, eyes, L)
        region = np.maximum(face, neck)
    elif name == "cyborg":
        Ls = _smooth(L)
        band = 0.5 + 0.5 * np.cos(cv2.GaussianBlur(Ls, (0, 0), 3) * 5.5 + 1.0)
        v = np.clip(0.6 * Ls + 0.4 * band + 0.12 * (L - cv2.GaussianBlur(L, (0, 0), 2)), 0, 1)
        col = _gmap(v, [(0, (45, 28, 16)), (0.45, (160, 140, 120)), (0.8, (238, 228, 218)), (1.0, (255, 255, 255))])
        seams = (np.abs(np.sin((YY + 25 * N_LO) / 512 * np.pi * 9)) < 0.035).astype(np.float32) * (skin > 0)
        col *= (1 - 0.45 * seams)[..., None]
        col = _mix(col, np.array([70, 70, 255], np.float32), np.clip(iris * 1.6, 0, 1))
        glow = cv2.GaussianBlur(iris, (0, 0), 6) * 2.2
        col += (np.clip(glow, 0, 1) * 160)[..., None] * np.array([0.35, 0.35, 1.0], np.float32)
        region = np.maximum(np.maximum(face, neck), np.clip(glow, 0, 1))
    elif name == "vampire":
        Lp = np.clip(0.38 + 0.68 * L, 0, 1)
        col = _mix(crop, Lp[..., None] * np.array([238, 228, 226], np.float32), np.full(L.shape, 0.78, np.float32))
        bags = np.clip(_bulge_shift(eyes, 12) - eyesf, 0, 1)
        col = _mix(col, col * np.array([0.62, 0.5, 0.58], np.float32), np.clip(bags * 0.75 + sockets * 0.35, 0, 1))
        col = _mix(col, np.array([30, 25, 190], np.float32) * (0.6 + L[..., None]), np.clip(iris * 1.5, 0, 1))
        col = _mix(col, np.array([35, 20, 105], np.float32) * (0.55 + 0.9 * L[..., None]), lips * 0.85)
    elif name == "alien":
        col = _gmap(L, [(0, (50, 18, 4)), (0.45, (205, 125, 30)), (0.75, (245, 195, 110)), (1.0, (255, 240, 215))])
        col = _mix(crop, col, np.full(L.shape, 0.85, np.float32))
        stripes = np.clip((np.sin(XX * 0.055 + YY * 0.012 + 5 * N_LO) - 0.55) * 3, 0, 1) * np.clip(N_MID + 0.3, 0, 1)
        col *= (1 - 0.28 * stripes * skin)[..., None]
        dots = (N_HI > 2.4).astype(np.float32) * _blob(256, 300, 90) * skin
        col = _mix(col, np.array([255, 235, 170], np.float32), cv2.GaussianBlur(dots, (0, 0), 1.2) * 1.5)
        col = _mix(col, np.array([40, 200, 250], np.float32) * (0.5 + L[..., None]), np.clip(iris * 1.4, 0, 1))
        col = _mix(col, np.array([120, 50, 25], np.float32) * (0.6 + L[..., None]), lips * 0.6)
        region = np.maximum(face, neck)
    elif name == "doll":
        sm = cv2.bilateralFilter(np.clip(crop, 0, 255).astype(np.uint8), 15, 45, 9)
        sm = cv2.bilateralFilter(sm, 15, 45, 9).astype(np.float32)
        Ls = (sm @ LUMA) / 255.0
        porcelain = np.clip(0.5 + 0.55 * Ls, 0, 1)[..., None] * np.array([236, 232, 252], np.float32)
        col = _mix(crop, _mix(sm, porcelain, np.full(L.shape, 0.55, np.float32)), skin * 0.95 + (1 - skin) * 0.3)
        blush = (_blob(EYE_L[0] - 4, EYE_L[1] + 62, 26) + _blob(EYE_R[0] + 4, EYE_R[1] + 62, 26)) * skin
        col = _mix(col, col * np.array([0.88, 0.82, 1.06], np.float32), blush * 0.55)
        lipc = np.array([120, 70, 235], np.float32) * (0.55 + 0.6 * L[..., None])
        col = _mix(col, lipc, lips * 0.8)
        col += (np.clip((L - 0.62) * 4, 0, 1) * lips * 90)[..., None]
    elif name == "aged":
        det1 = L - cv2.GaussianBlur(L, (0, 0), 3)
        det2 = L - cv2.GaussianBlur(L, (0, 0), 10)
        tone = _mix(crop, grey * np.array([0.9, 1.0, 1.06], np.float32), np.full(L.shape, 0.35, np.float32))
        lines = np.zeros((512, 512), np.float32)
        # Forehead lines: between the hairline and the brows.
        fy0, fy1 = EYE_L[1] - 150, EYE_L[1] - 50
        band = np.clip((YY - fy0) / 18, 0, 1) * np.clip((fy1 - YY) / 18, 0, 1)
        lines += np.clip((np.sin((YY + 14 * N_LO) / 17 * 2 * np.pi) - 0.82) * 6, 0, 1) * band * 0.9
        # Crow's feet: short fans at the outer eye corners.
        for (cx, cy), sx in ((EYE_L, -1), (EYE_R, 1)):
            ox, oy = cx + sx * 42, cy + 4
            ang = np.arctan2(YY - oy, (XX - ox) * sx)
            rr = np.hypot(XX - ox, YY - oy)
            fan = np.clip((np.cos(ang * 9) - 0.75) * 5, 0, 1) * np.clip((rr - 6) / 8, 0, 1) * np.clip((40 - rr) / 12, 0, 1) * (np.abs(ang) < 1.0)
            lines += fan * 0.8
        # Folds from the nose wings past the mouth corners.
        folds = np.zeros((512, 512), np.uint8)
        mx = (EYE_L[0] + EYE_R[0]) / 2
        for sx in (-1, 1):
            pts = np.array([[mx + sx * 40, EYE_L[1] + 75], [mx + sx * 62, EYE_L[1] + 115], [mx + sx * 72, EYE_L[1] + 160]], np.int32)
            cv2.polylines(folds, [pts], False, 255, 3, cv2.LINE_AA)
        lines += cv2.GaussianBlur(folds.astype(np.float32) / 255, (0, 0), 2.2) * 1.2
        bags = np.clip(_bulge_shift(eyes, 14) - eyesf, 0, 1)
        lines += bags * 0.45
        lines *= skin
        # Creases deepened at the scale of folds (det2), barely at the scale of pores and sensor noise (det1): no shimmer.
        col = tone * (1 + (det1 * 0.5 + _smooth(det2, 7, 0.05, 5) * 1.6)[..., None] * skin[..., None])
        col *= (1 - 0.33 * np.clip(lines, 0, 1))[..., None]
        # The light edge under each line (a fold, not a pen stroke).
        hl = np.roll(np.clip(lines, 0, 1), 3, axis=0) * (1 - np.clip(lines, 0, 1))
        col *= (1 + 0.08 * hl)[..., None]
        spots = cv2.GaussianBlur((N_HI > 2.5).astype(np.float32), (0, 0), 1.6) * 2 * skin
        col = _mix(col, col * np.array([0.62, 0.75, 0.9], np.float32), np.clip(spots, 0, 0.6))
        col = _mix(col, (0.35 + 0.5 * L[..., None]) * np.array([190, 190, 190], np.float32), cv2.GaussianBlur(brows, (0, 0), 1.5) * 0.5)
        col = _mix(col, grey * 0.95 + col * 0.05, lips * 0.45)
    else:
        return crop, np.zeros(L.shape, np.float32)
    return np.clip(col, 0, 255), region


def _bulge_shift(eyes, dy):
    """The eye openings moved down by dy and widened: the place of eye bags and dark circles."""
    m = np.roll(eyes.astype(np.uint8), dy, axis=0)
    m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 13)))
    return cv2.GaussianBlur(m.astype(np.float32), (0, 0), 5)


def look_prepare(frame, pts):
    """The aligned 512 square of the person and its face labels (one frame ahead, on the preparing thread)."""
    crop, matrix = warp(frame, pts, FFHQ_512, 512)
    if args.look == "doll":
        # Doll eyes: both eyes a fifth bigger (the labels move with them).
        for c in (EYE_L, EYE_R):
            crop = _bulge(crop, c, 46, 0.2, cv2.INTER_LINEAR)
    return frame, crop, matrix, parse(crop, parser_ahead)


prev_look = None


def restyle(a, frame, crop, matrix, seg):
    global prev_region, prev_look
    if args.look == "retouch":
        return retouch(a, frame, crop, matrix, seg)
    styled, region = look(args.look, crop.astype(np.float32), seg)
    styled = steady(prev_look, styled.astype(np.uint8))
    prev_look = styled
    region = cv2.GaussianBlur(cv2.dilate(soft(region > 0.5) * region.max(), DILATE), (0, 0), 3) if region.max() > 0 else region
    if prev_region is not None:
        region = 0.65 * region + 0.35 * prev_region
    prev_region = region
    return paste(frame, styled.astype(np.float32), np.minimum(BOX512, region) * a, matrix)


def enhance(crop):
    """GFPGAN on the aligned 512 crop (on whichever restorer is free)."""
    x = ((crop[:, :, ::-1] / 255.0 - 0.5) / 0.5).transpose(2, 0, 1)[None].astype(np.float32)
    s = enhancers.get()
    try:
        e = s.run(None, {"input": x})[0][0]
    finally:
        enhancers.put(s)
    return (np.clip((e.transpose(1, 2, 0) + 1) / 2, 0, 1)[:, :, ::-1] * 255).astype(np.float32)


detail_prev = None
retouch_prev = None
RETOUCH = max(0.0, min(1.0, args.strength))


def retouch(a, frame, crop, matrix, seg):
    """The person's own face through GFPGAN, mixed in at --strength inside the face outline (no hair or background from
    the restorer). Its fine detail is averaged with the last frame's (aligned crop) so the skin doesn't shimmer."""
    global prev_region, retouch_prev
    e = enhance(crop)
    base = cv2.GaussianBlur(e, (0, 0), 2.5)
    detail = e - base
    if retouch_prev is not None:
        detail = 0.45 * detail + 0.55 * retouch_prev
    retouch_prev = detail
    region = cv2.GaussianBlur(cv2.dilate(soft(np.isin(seg, FACE_CLASSES)), DILATE), (0, 0), 3)
    if prev_region is not None:
        region = 0.65 * region + 0.35 * prev_region
    prev_region = region
    return paste(frame, base + detail, np.minimum(BOX512, region) * (a * RETOUCH), matrix)


def finish(frame, e, matrix, a=1.0):
    """Detail back: GFPGAN on the swapped face, blended at 80 % (as FaceFusion does). Its fine grain changes from frame
    to frame (a shimmer): the fine detail is averaged with the last frame's (the face is aligned, so it lines up), the
    shape and light come from this frame. Runs in frame order."""
    global detail_prev
    base = cv2.GaussianBlur(e, (0, 0), 2.5)
    detail = e - base
    if detail_prev is not None:
        detail = 0.45 * detail + 0.55 * detail_prev
    detail_prev = detail
    return paste(frame, base + detail, BOX512 * (0.8 * a), matrix)


reader = subprocess.Popen([FF, "-v", "error", "-hwaccel", "videotoolbox", "-i", args.video, "-vf", "scale=in_color_matrix=bt709:in_range=tv,format=bgr24", "-f", "rawvideo", "-"],
                          stdout=subprocess.PIPE)
cmd = [FF, "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", fps, "-i", "-", "-i", args.video]
inputs = 2
if args.plate and os.path.exists(args.plate):
    cmd += ["-i", args.plate]
    inputs = 3
conv = "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p"
vf = f"[0:v]{conv}[v]"
if inputs == 3:
    # The disclosure mark exactly where lipsync puts it: bottom-right inside the 5 % safe margin (drawn at 2.5 % height).
    vf = f"[0:v][2:v]overlay=x=main_w-overlay_w-{round(W * 0.05)}:y=main_h-overlay_h-{round(H * 0.05)},{conv}[v]"
cmd += ["-filter_complex", vf, "-map", "[v]"]
if has_audio:
    cmd += ["-map", "1:a:0", "-c:a", "aac", "-b:a", "192k"]
rate = max(8, min(40, round(W * H * float(fps) / 1e6 * 0.25)))
cmd += ["-c:v", "h264_videotoolbox", "-b:v", f"{rate}M", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
        "-movflags", "+faststart", "-shortest", args.out]
writer = subprocess.Popen(cmd, stdin=subprocess.PIPE)

say("STATUS", "styling the face" if args.look else "swapping the face")
size = W * H * 3
n = len(M)
i = 0
written = 0
t1 = time.time()
pool = ThreadPoolExecutor(max_workers=1 if args.look else enhancers.qsize())
pending = collections.deque()  # (frame, None, None, 0, True) or (swapped frame, future of the restored crop, matrix, strength, starts over)


def write_ready(limit):
    """Writes finished frames in order; waits while more than `limit` are in flight."""
    global detail_prev, written
    while pending:
        frame, fut, matrix, a, fresh = pending[0]
        if fut is not None and not fut.done() and len(pending) <= limit:
            return
        pending.popleft()
        if fresh:
            detail_prev = None  # a new run of the face: no grain from before the cut
        if fut is not None:
            try:
                frame = finish(frame, fut.result(), matrix, a)
            except Exception as e:  # noqa: BLE001
                fail(f"the face model stopped: {type(e).__name__}: {str(e)[:160]}")
        writer.stdin.write(np.ascontiguousarray(frame).tobytes())
        written += 1
        if written % 10 == 0:
            say("PROGRESS", f"{0.1 + 0.88 * min(1, written / max(1, n)):.3f}")
            if written == 20:
                per = (time.time() - t1) / 20
                say("STATUS", f"{'retouching' if args.look == 'retouch' else 'styling' if args.look else 'swapping'} the face · about {max(1, round(per * (n - written)))} s left")


prep = ThreadPoolExecutor(max_workers=1)
ahead = collections.deque()  # (frame, points, strength, starts over, future of the prepared frame or None)
eof = False


def feed():
    """Reads the next frame and starts its preparation."""
    global i, eof
    buf = reader.stdout.read(size)
    if len(buf) < size:
        eof = True
        return
    frame = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
    pts = S[i] if i < len(S) else None
    a = alpha[i] if i < len(alpha) else 0.0
    if pts is None or a <= 0:
        prep.submit(restart)
        ahead.append((frame, None, 0.0, True, None))
    else:
        if i in cuts:
            prep.submit(restart)
        job = prep.submit(look_prepare, frame, pts) if args.look else prep.submit(prepare, frame, pts, M[i]["contour"] if i < len(M) and M[i] else None, a)
        ahead.append((frame, pts, a, i in cuts, job))
    i += 1


while True:
    while not eof and len(ahead) < 3:
        feed()
    if not ahead:
        break
    frame, pts, a, fresh, fut = ahead.popleft()
    if fresh:
        prev_face = prev_region = prev_look = retouch_prev = None  # a new run of the face (or another face) starts clean
    if fut is None:
        pending.append((frame, None, None, 0.0, True))
    elif args.look:
        try:
            pending.append((restyle(a, *fut.result()), None, None, 0.0, fresh))
        except Exception as e:  # noqa: BLE001
            fail(f"the face look stopped: {type(e).__name__}: {str(e)[:160]}")
    else:
        try:
            frame, crop512, matrix = swap(pts, a, *fut.result())
        except Exception as e:  # noqa: BLE001
            fail(f"the face model stopped: {type(e).__name__}: {str(e)[:160]}")
        pending.append((frame, pool.submit(enhance, crop512), matrix, a, fresh))
    write_ready(limit=4)
write_ready(limit=0)
pool.shutdown()
prep.shutdown()
reader.wait()
writer.stdin.close()
if writer.wait() != 0 or not os.path.exists(args.out):
    fail("couldn't write the result")
say("STATUS", f"done in {time.time() - t0:.0f} s ({written} frames)")
say("PROGRESS", "1")
