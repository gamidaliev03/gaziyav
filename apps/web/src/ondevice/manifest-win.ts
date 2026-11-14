// The on-device AI on Windows: the same features as on a Mac, on an NVIDIA graphics card (CUDA); face swap runs on
// DirectML (any DirectX 12 GPU). What differs per model: the Python environment (locks-win.ts), the weights of the
// models the Mac runs on MLX (the original PyTorch / GGUF releases of the same models), and the card it needs.
// Everything still downloads in the app with one click: no CUDA toolkit, no Python, nothing else to install.
import path from "node:path";
import { FACESWAP_LOCK_WIN, LIPSYNC_LOCK_WIN, SEPARATE_LOCK_WIN, VOICE_LOCK_WIN, VOICECHANGE_LOCK_WIN } from "./locks-win";
import type { ModelFile, ModelSpec } from "./manifest";

/** Where a Windows model's weights live under its root folder (loaded from there, offline). */
export const WIN_MODEL_DIR = "model";

const hfFiles = (repo: string, rev: string, files: [string, number, string][], dir = WIN_MODEL_DIR): ModelFile[] =>
	files.map(([file, size, sha256]) => ({
		url: `https://huggingface.co/${repo}/resolve/${rev}/${file}`,
		mirrors: [`https://hf-mirror.com/${repo}/resolve/${rev}/${file}`],
		dest: path.join(dir, file),
		size,
		sha256,
	}));

const QWEN_TTS_SHARED: [string, number, string][] = [
	["generation_config.json", 245, "f1b90b4513f3b34c62851049e2492d7b4c5940daf1276f89c82b8ef04127f3aa"],
	["merges.txt", 1_671_839, "599bab54075088774b1733fde865d5bd747cbcc7a547c5bc12610e874e26f5e3"],
	["preprocessor_config.json", 127, "efdde1022ea9d76928bf7a9cd53139138f5ba2e466e837f08f6105ab1af1c119"],
	["speech_tokenizer/config.json", 2_336, "ee65bb901c876664ab8707c487157aa1a6ee57c65969b28fb5ec9dc211e68167"],
	["speech_tokenizer/configuration.json", 76, "6bc26d64eb5024b4d1dab5a52371958b429256d6c9d59787f1f5294a54e0cebd"],
	["speech_tokenizer/model.safetensors", 682_293_092, "836b7b357f5ea43e889936a3709af68dfe3751881acefe4ecf0dbd30ba571258"],
	["speech_tokenizer/preprocessor_config.json", 234, "fcb3805e597e786d4067706e602f6688524640f8d3396790e2e09b5942fcbdfb"],
	["tokenizer_config.json", 7_344, "dc3c31c3bdaedd5016382bb3cbe07323026775ad51f5a4fb564505992ae4a670"],
	["vocab.json", 2_776_833, "ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910"],
];

/** Qwen3-TTS 1.7B Base (a cloned voice), the original bf16 release. */
const VOICE_FILES = hfFiles("Qwen/Qwen3-TTS-12Hz-1.7B-Base", "fd4b254389122332181a7c3db7f27e918eec64e3", [
	["config.json", 4_494, "b4f01752d15a488abde3e1ab44723ae4f4b9e68a4037257b098b3737893cc1f9"],
	["model.safetensors", 3_857_413_744, "38fc7fc51c5e776e840414b6fd443962e9411b9654888fd7913e4da643cb857c"],
	...QWEN_TTS_SHARED,
]);


const sum = (files: ModelFile[]) => files.reduce((s, f) => s + f.size, 0);
/** PyTorch with its CUDA runtime is most of an environment's download (measured from the wheels). */
const TORCH_ENV = 3_300_000_000;
const MEDIAPIPE = ", MediaPipe face and hand landmarks (Google, Apache-2.0)";

/** The Windows version of a model; the Mac manifest stays the one place for what doesn't differ. */
export function windowsSpec(spec: ModelSpec): ModelSpec {
	const base: ModelSpec = {
		...spec,
		appleSiliconOnly: false,
		minMacOS: undefined,
		title: spec.title.replace("this Mac", "this PC"),
		purpose: spec.purpose.replace("this Mac", "this PC"),
	};
	const env = (lock: string, bytes = TORCH_ENV) => ({ env: "env", lock, bytes });
	switch (spec.id) {
		case "whisper":
			// The speech detector beside the speech model is the Mac's for now: never run with the Windows engine yet.
			return { ...base, files: base.files.filter((f) => !f.optional) };
		case "lipsync":
			return { ...base, nvidia: { minVram: 6e9 }, minMemory: 16e9, python: env(LIPSYNC_LOCK_WIN), credit: spec.credit + MEDIAPIPE, diskBytes: spec.diskBytes + 2.5e9 };
		case "faceswap":
			return { ...base, python: env(FACESWAP_LOCK_WIN, 160_000_000), credit: spec.credit.replace("ONNX Runtime (Microsoft, MIT)", "ONNX Runtime with DirectML (Microsoft, MIT)") + MEDIAPIPE };
		case "cleanup":
			return { ...base, python: env(FACESWAP_LOCK_WIN, 160_000_000) };
		case "voice":
			return { ...base, nvidia: { minVram: 6e9 }, minMemory: 16e9, files: VOICE_FILES, python: env(VOICE_LOCK_WIN), credit: "Qwen3-TTS 12Hz 1.7B Base (Alibaba Qwen, Apache-2.0), qwen-tts (Apache-2.0), PyTorch (BSD)", diskBytes: sum(VOICE_FILES) + 5e9 };
		case "denoise":
			// DeepFilterNet's Windows program (from its author: our copy holds the Mac one); the model file is the same.
			return {
				...base,
				files: [
					{ url: "https://github.com/Rikorose/DeepFilterNet/releases/download/v0.5.6/deep-filter-0.5.6-x86_64-pc-windows-msvc.exe", dest: "deep-filter.exe", size: 26_912_256, sha256: "75e11fa16445f560cb6b021521ddb89e89270d13b83089705d98776f58fd7915", executable: true },
					...spec.files.slice(1),
				],
			};
		case "retouch":
			return { ...base, python: env(FACESWAP_LOCK_WIN, 160_000_000), credit: spec.credit.replace("ONNX Runtime (Microsoft, MIT)", "ONNX Runtime with DirectML (Microsoft, MIT)") + MEDIAPIPE };
		case "separate":
			return { ...base, python: env(SEPARATE_LOCK_WIN) };
		case "voicechange":
			return { ...base, python: env(VOICECHANGE_LOCK_WIN) };
		case "hear":
			// ONNX models run by the app's own server (transformers.js): the same files on Windows.
			return base;
		case "separate-mlx":
		case "separate-beats":
			// Mac only (Apple's MLX): a part, never in the Windows lists (manifest.ts PARTS is empty there).
			return spec;
	}
}
