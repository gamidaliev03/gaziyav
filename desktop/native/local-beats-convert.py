# Beat This! `final0` as safetensors, made once (11.11.2026) from the authors' PyTorch checkpoint — a pickle, read here
# with weights_only=True (tensors and plain values only; anything else in the file stops the load) and never by the
# app: the app's helper (native/local-beats.py) reads only the safetensors this writes.
#   <LocalSeparate>/env/bin/python -I local-beats-convert.py final0.ckpt beat_this-final0.safetensors  (the install's self-test runs it)
# The file: the model's weights under their own names (the "model." prefix of the training wrapper removed, as
# beat_this.inference.load_model does) and, in the header's metadata, the model's hyper-parameters as JSON.
# Written by hand (8 bytes of header length, a JSON header, the raw little-endian tensors): no extra package, and the
# same bytes for the same checkpoint.
import inspect, json, struct, sys

import numpy as np
import torch

src, dest = sys.argv[1:3]
ck = torch.load(src, map_location="cpu", weights_only=True)
state = {(k[len("model."):] if k.startswith("model.") else k): v for k, v in ck["state_dict"].items()}


def plain(v):
    """Numbers, text, lists and maps of them: what JSON holds."""
    try:
        json.dumps(v)
        return True
    except TypeError:
        return False


hyper = {k: v for k, v in ck["hyper_parameters"].items() if plain(v)}
DTYPES = {torch.float32: "F32", torch.float64: "F64", torch.float16: "F16", torch.int64: "I64", torch.int32: "I32", torch.bool: "BOOL"}
header = {"__metadata__": {"format": "pt", "model": "beat_this final0 (CPJKU, MIT)", "hyper_parameters": json.dumps(hyper, sort_keys=True)}}
offset = 0
blobs = []
for name in sorted(state):
    t = state[name].detach().contiguous()
    raw = t.numpy().astype(t.numpy().dtype.newbyteorder("<"), copy=False).tobytes()
    header[name] = {"dtype": DTYPES[t.dtype], "shape": list(t.shape), "data_offsets": [offset, offset + len(raw)]}
    offset += len(raw)
    blobs.append(raw)
head = json.dumps(header, separators=(",", ":")).encode()
head += b" " * (-len(head) % 8)
with open(dest, "wb") as f:
    f.write(struct.pack("<Q", len(head)))
    f.write(head)
    for raw in blobs:
        f.write(raw)
print(f"{len(state)} tensors, {offset} bytes of weights, torch {torch.__version__}")
print("checkpoint keys:", sorted(ck.keys()))
print("hyper-parameters kept:", json.dumps(hyper, sort_keys=True))
print("hyper-parameters dropped:", sorted(set(ck["hyper_parameters"]) - set(hyper)))
