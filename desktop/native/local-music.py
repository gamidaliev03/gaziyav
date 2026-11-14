# On-device music: ACE-Step 1.5 turbo (MIT) on the Apple GPU (MLX DiT + Metal), without the planning language model
# so it fits an 8 GB Mac. Usage:
#   python local-music.py --root <LocalMusic dir> --src <acestep source dir> --prompt "lofi hip hop, warm piano" \
#     [--lyrics "..."] [--instrumental] [--seconds 30] [--lang en] [--seed N] [--low-ram] --out song.wav
#   --low-ram (8 GB Macs): the diffusion model's weights in 8-bit (half the memory of half precision, the sound as good
#   as makes no difference), the song at most 2 minutes.
#   python local-music.py --root <LocalMusic dir> --src <acestep source dir> --serve
#   (stays loaded for the next songs: one JSON job per stdin line with the same fields — prompt, lyrics, instrumental,
#   seconds, lang, seed, out — each answered by "DONE 0" or "DONE 1"; "READY" once the model is loaded)
# Prints "STATUS"/"PROGRESS" lines; "ERROR <text>" and exit 1 (or "DONE 1") on failure.
import argparse, json, os, shutil, sys, tempfile, time

p = argparse.ArgumentParser()
p.add_argument("--root", required=True)
p.add_argument("--src", required=True)
p.add_argument("--prompt")
p.add_argument("--lyrics", default="")
p.add_argument("--instrumental", action="store_true")
p.add_argument("--seconds", type=float, default=30)
p.add_argument("--lang", default="en")
p.add_argument("--seed", type=int, default=-1)
p.add_argument("--out")
p.add_argument("--serve", action="store_true")
p.add_argument("--low-ram", action="store_true", help="8 GB Macs: 8-bit diffusion weights, songs up to 2 minutes")
args = p.parse_args()
if not args.serve and not (args.prompt and args.out):
    p.error("--prompt and --out are needed (or --serve)")

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ.pop("ACESTEP_CHECKPOINTS_DIR", None)
# ACE-Step's "project root" (its checkpoints folder, its progress-time estimates) is the model folder, never the cwd.
os.environ["ACESTEP_PROJECT_ROOT"] = os.path.abspath(args.root)
# The audio decoder in half precision on the Apple GPU: 2 s faster, 50 dB from full precision (inaudible).
os.environ.setdefault("ACESTEP_MLX_VAE_FP16", "1")
sys.path.insert(0, os.path.abspath(args.src))


def say(kind, text):
    print(f"{kind} {text}", flush=True)


try:
    say("STATUS", "loading the music model")
    # The checkpoint's model code comes from the bundled source, exactly as ACE-Step keeps it in sync itself.
    code_src = os.path.join(os.path.abspath(args.src), "acestep", "models", "turbo")
    code_dst = os.path.join(os.path.abspath(args.root), "checkpoints", "acestep-v15-turbo")
    for name in ("configuration_acestep_v15.py", "modeling_acestep_v15_turbo.py"):
        a, b = os.path.join(code_src, name), os.path.join(code_dst, name)
        if os.path.isfile(a) and os.path.isdir(code_dst):
            if not os.path.isfile(b) or open(a, "rb").read() != open(b, "rb").read():
                shutil.copyfile(a, b)
    from acestep.handler import AceStepHandler  # noqa: E402
    from acestep.inference import GenerationConfig, GenerationParams, generate_music  # noqa: E402
    from acestep.llm_inference import LLMHandler  # noqa: E402

    # Half precision on the Apple GPU: ACE-Step picks float32 there, which doubles the weights and (with the MLX copy)
    # took ~23 GB at load — a 16 GB Mac swapped hard. The dtype is chosen just before this check runs.
    if os.environ.get("GAZIYAV_MUSIC_FP32") != "1":
        import torch as _torch
        _check = AceStepHandler._validate_quantization_setup

        def _half(self, *a, **k):
            if str(getattr(self, "device", "")) == "mps":
                self.dtype = _torch.float16
            return _check(self, *a, **k)

        AceStepHandler._validate_quantization_setup = _half

        # The MLX copy of the diffusion model straight in half precision (ACE-Step converts through float32: +9 GB).
        import acestep.models.mlx.dit_convert as _dc

        def _convert_half(pytorch_model):
            import mlx.core as mx
            out = []
            for key, value in pytorch_model.decoder.state_dict().items():
                if "rotary_emb" in key:
                    continue
                v = value.detach().cpu().to(_torch.float16).numpy()
                k = key
                if key.startswith("proj_in.1."):
                    k = key.replace("proj_in.1.", "proj_in.")
                    if k.endswith(".weight"):
                        v = v.swapaxes(1, 2)
                elif key.startswith("proj_out.1."):
                    k = key.replace("proj_out.1.", "proj_out.")
                    if k.endswith(".weight"):
                        v = v.transpose(1, 2, 0)
                out.append((k, mx.array(v)))
            return out

        _dc.convert_decoder_weights = _convert_half
    dit = AceStepHandler()
    status, ok = dit.initialize_service(project_root=os.path.abspath(args.root), config_path="acestep-v15-turbo", device="mps", use_mlx_dit=True)
    if not ok:
        raise RuntimeError(status)
    # Memory for 8 GB Macs: the MLX copy of the diffusion decoder does the work, so the PyTorch one is freed, and the
    # MLX weights go to half precision (half the memory, same sound).
    import gc
    import torch
    if getattr(dit, "use_mlx_dit", False) and getattr(dit, "mlx_decoder", None) is not None:
        if getattr(dit.model, "decoder", None) is not None:
            dit.model.decoder = torch.nn.Identity()
        import mlx.core as mx
        from mlx.utils import tree_map
        dit.mlx_decoder.update(tree_map(lambda x: x.astype(mx.float16) if x.dtype == mx.float32 else x, dit.mlx_decoder.parameters()))
        mx.eval(dit.mlx_decoder.parameters())
        if args.low_ram:
            # 8 GB Macs: the linear layers' weights in 8-bit groups of 64 (≈2.4 GB instead of 4.8 GB). A layer whose width
            # doesn't divide into groups stays in half precision; if MLX can't quantize this build, half precision stays.
            try:
                import mlx.nn as nn
                nn.quantize(dit.mlx_decoder, group_size=64, bits=8, class_predicate=lambda _p, m: isinstance(m, nn.Linear) and m.weight.shape[-1] % 64 == 0)
                mx.eval(dit.mlx_decoder.parameters())
                say("STATUS", "the music model in 8-bit for this Mac's memory")
            except Exception as e:  # noqa: BLE001
                say("STATUS", f"8-bit weights not possible here ({type(e).__name__}); half precision")
            mx.set_cache_limit(256 << 20)
    gc.collect()
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()
    say("PROGRESS", "0.15")
except Exception as e:  # noqa: BLE001
    say("ERROR", f"the music model stopped: {type(e).__name__}: {str(e)[:300]}")
    sys.exit(1)


def job(a):
    """One song from a description (and lyrics), written to a.out."""
    instrumental = a.instrumental or not a.lyrics.strip()
    params = GenerationParams(
        caption=a.prompt.strip()[:500],
        lyrics="[Instrumental]" if instrumental else a.lyrics.strip()[:4000],
        instrumental=instrumental,
        duration=max(10.0, min(120.0 if args.low_ram else 240.0, a.seconds)),
        vocal_language=a.lang if not instrumental else "unknown",
        inference_steps=8,
        seed=a.seed,
        thinking=False,
        use_cot_metas=False,
        use_cot_caption=False,
        use_cot_language=False,
    )
    config = GenerationConfig(batch_size=1, use_random_seed=a.seed < 0, seeds=None if a.seed < 0 else [a.seed], audio_format="wav")
    say("STATUS", "composing")
    t0 = time.time()
    out_dir = tempfile.mkdtemp(prefix="gaziyav-music-")
    try:
        result = generate_music(dit, LLMHandler(), params, config, save_dir=out_dir, progress=lambda v, desc=None, **_: say("PROGRESS", f"{0.15 + 0.8 * float(v):.3f}") if isinstance(v, (int, float)) else None)
        if not result.success or not result.audios:
            raise RuntimeError(result.error or result.status_message or "no audio came out")
        path = result.audios[0].get("path") or result.audios[0].get("audio_path")
        if not path or not os.path.exists(path):
            raise RuntimeError("the song file is missing")
        shutil.move(path, a.out)
    finally:
        shutil.rmtree(out_dir, ignore_errors=True)
    say("STATUS", f"done in {time.time() - t0:.0f} s")
    say("PROGRESS", "1")


if not args.serve:
    try:
        job(args)
    except Exception as e:  # noqa: BLE001
        say("ERROR", f"the music model stopped: {type(e).__name__}: {str(e)[:300]}")
        sys.exit(1)
    sys.exit(0)
# Warm: the model stays loaded; the app sends the next songs here and ends the process when it is idle.
print("READY", flush=True)
for line in sys.stdin:
    if not line.strip():
        continue
    try:
        req = json.loads(line)
        job(argparse.Namespace(prompt=str(req["prompt"]), lyrics=str(req.get("lyrics") or ""), instrumental=bool(req.get("instrumental")),
                               seconds=float(req.get("seconds") or 30), lang=str(req.get("lang") or "en"), seed=int(req.get("seed", -1)), out=str(req["out"])))
        print("DONE 0", flush=True)
    except Exception as e:  # noqa: BLE001 — a failed song never takes the warm model down
        say("ERROR", f"the music model stopped: {type(e).__name__}: {str(e)[:300]}")
        print("DONE 1", flush=True)
