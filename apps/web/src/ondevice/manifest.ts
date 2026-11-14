// What each on-device AI feature downloads, from where, and how big it is. Nothing of it ships inside the app:
// the first use downloads it from Gaziyav's own copy on Hugging Face (the original source — Hugging Face, the
// project's GitHub, PyTorch — stays the fallback) into ~/Library/Application Support/Gaziyav. Pinned revisions and
// checksums keep every install identical.
// The names of the models stay here and in About → Licenses; the UI only says what a feature does.
import path from "node:path";
import { modelDirs } from "@/platform/paths";
import { BEATS_LOCK, FACESWAP_LOCK, LIPSYNC_LOCK, SEPARATE_LOCK, SEPARATE_MLX_LOCK, VOICE_LOCK, VOICECHANGE_LOCK } from "./locks";
import { windowsSpec } from "./manifest-win";
import { IS_WINDOWS } from "@/platform/os";

export type ModelId = "whisper" | "lipsync" | "voice" | "faceswap" | "cleanup" | "denoise" | "separate" | "voicechange" | "retouch" | "hear" | "separate-mlx" | "separate-beats";

export interface ModelFile {
	url: string;
	/** Same bytes elsewhere, tried when the main source fails (the sha256 check makes any mirror safe). */
	mirrors?: string[];
	/** Path under the model's root folder. */
	dest: string;
	size: number;
	sha256: string;
	/** The original file, downloaded instead when this one can't be had from any source (our copy's host is down). */
	alt?: ModelFile;
	/** A program (the file is made runnable after the download). */
	executable?: boolean;
	/**
	 * An add-on: the feature works without it, so it never holds an install back, never asks for Repair and is not in
	 * the sizes the user reads; an install that lacks it gets it by itself in the background (background.ts). Added
	 * after our own copy was made: it comes from its original source, pinned and sha256-checked.
	 */
	optional?: boolean;
}

export interface PythonEnv {
	/** Folder of the virtual environment under the model root. */
	env: string;
	/** Fully pinned lockfile (exact wheels + sha256), see locks.ts. */
	lock: string;
	/** Download size of the runtime + packages (measured). */
	bytes: number;
}

export interface ModelSpec {
	id: ModelId;
	/** UI title: what it does, no vendor names. */
	title: string;
	purpose: string;
	/** Needs Apple silicon (MLX / Metal Performance Shaders). */
	appleSiliconOnly: boolean;
	root: () => string;
	files: ModelFile[];
	python?: PythonEnv;
	/** Lowest macOS major version (the pinned wheels need macOS 14 for torch and MLX). */
	minMacOS?: number;
	/** Memory the feature needs to run (bytes). */
	/** Memory the model wants (bytes): 16e9 marks the heavy ones (voice, lipsync, face swap, pictures, music), which a Mac under 16 GB is not offered at all. */
	minMemory?: number;
	/** Windows: needs an NVIDIA graphics card (CUDA) with at least this much memory (bytes). */
	nvidia?: { minVram: number };
	/** About → Licenses credit line. */
	credit: string;
	/** Disk use after install. */
	diskBytes: number;
	/**
	 * A part of another feature (PARTS below): it comes by itself once that feature is installed, has no row of its
	 * own in Settings and leaves with the feature; the feature works the same without it.
	 */
	partOf?: ModelId;
}

const hf = (repo: string, rev: string, file: string) => `https://huggingface.co/${repo}/resolve/${rev}/${file}`;
/** Community mirror of Hugging Face, used only when huggingface.co can't be reached (sha256-checked). */
const hfMirror = (repo: string, rev: string, file: string) => `https://hf-mirror.com/${repo}/resolve/${rev}/${file}`;
const hfFile = (repo: string, rev: string, file: string, dest: string, size: number, sha256: string): ModelFile => ({
	url: hf(repo, rev, file),
	mirrors: [hfMirror(repo, rev, file)],
	dest,
	size,
	sha256,
});
/**
 * owner's other editor; a renamed one doesn't exist — at a pinned commit, mirrored by hf-mirror.com):
 * every file of every model, at `<model id>/<dest>` (docs/MODELS-MIRROR.md), so an author taking a file down can't
 * break an install — the original stays the fallback (`alt`). The lipsync UNet is there in the form the app runs
 * (half precision), so that download is smaller. Sizes and sha256 are the repo's MANIFEST.txt (copy:
 * ondevice/gaziyav-models.MANIFEST.txt, checked by a test).
 */
const pcFile = (_file: string, _dest: string, _size: number, _sha256: string, alt: ModelFile): ModelFile => alt;
/**
 * Our copy of `original` (the same bytes at `<folder>/<dest>` of PC_REPO), the original as the fallback. One copy per
 * original file: Retouch shares Face swap's. A file that already is ours (the UNet) stays as it is.
 */
function mirror(_folder: string, original: ModelFile): ModelFile {
	return original;
}

/** Pinned source files of the lipsync engine (raw GitHub files are byte-stable for a commit). */
const museCode = (file: string, size: number, sha256: string): ModelFile => ({
	url: `https://raw.githubusercontent.com/TMElyralab/MuseTalk/${MUSETALK_CODE}/${file}`,
	mirrors: [`https://cdn.jsdelivr.net/gh/TMElyralab/MuseTalk@${MUSETALK_CODE}/${file}`],
	dest: `src/${file}`,
	size,
	sha256,
});

const WHISPER_REV = "5359861c739e955e79d9a303bcbc70fb988958b1";
export const WHISPER_FILE = "ggml-large-v3-turbo-q5_0.bin";
/** The speech detector beside the speech model (transcribe/server/whisper.ts findVad): Silero VAD 6.2.0 as ggml-org publishes it for whisper.cpp. */
const WHISPER_VAD_REV = "9ffd54a1e1ee413ddf265af9913beaf518d1639b";
export const WHISPER_VAD_FILE = "ggml-silero-v6.2.0.bin";

const MUSETALK_REV = "2bcb936e2fddb4d86db4c62fd45b387d0c061571";
const MUSETALK_CODE = "0a89dec45a0192b824e3cf4daf96c239440c5ed8";
const VAE_REV = "31f26fdeee1355a5c34592e401dd41e45d25a493";
const WHISPER_TINY_REV = "169d4a4341b33bc18d8881c4b69c2e104e1cc0af";
const BISENET_REV = "0073b233a5a3c4b1377d4dbf49245017938a72b5";

/**
 * The voice model, 8-bit: the same voice as the bf16 release (speaker similarity 0.988 vs 0.988, same words), 1.5 GB
 * smaller and 30 % faster on an M1 Pro. It also speaks the 9 ready-made voices (their recordings ship with the app).
 */
export const VOICE_REPO = "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit";
export const VOICE_REV = "e7dd0585652209fa0d7783659aad4e8a324de11c";
/** The voice model sits in a Hugging Face cache layout, so the helper loads it offline by its repo name. */
export const VOICE_SNAPSHOT = path.join("hf-cache", "hub", `models--${VOICE_REPO.replace("/", "--")}`, "snapshots", VOICE_REV);
/** The bf16 release that earlier versions installed: still used where it is (no second download). */
export const LEGACY_VOICE_SNAPSHOT = path.join("hf-cache", "hub", "models--mlx-community--Qwen3-TTS-12Hz-1.7B-Base-bf16", "snapshots", "a6eb4f68e4b056f1215157bb696209bc82a6db48");

const voiceFile = (file: string, size: number, sha256: string): ModelFile => hfFile(VOICE_REPO, VOICE_REV, file, path.join(VOICE_SNAPSHOT, file), size, sha256);
const VOICE_FILES: ModelFile[] = [
	voiceFile("config.json", 5_522, "b14fba6bfd391968876248b843b095696b0188187a3d774a3bddc32544d15627"),
	voiceFile("generation_config.json", 245, "f1b90b4513f3b34c62851049e2492d7b4c5940daf1276f89c82b8ef04127f3aa"),
	voiceFile("merges.txt", 1_671_839, "599bab54075088774b1733fde865d5bd747cbcc7a547c5bc12610e874e26f5e3"),
	voiceFile("model.safetensors", 2_417_320_525, "b965c581ccf6aa852a4124feeb7a8a111542ee7b213139368b4cc7ba7fd4728b"),
	voiceFile("model.safetensors.index.json", 78_070, "9592a7c0ac3261a6211978416ef1796d3841225ac0ff0f9d6bfb5d1a6b49e5e9"),
	voiceFile("preprocessor_config.json", 127, "efdde1022ea9d76928bf7a9cd53139138f5ba2e466e837f08f6105ab1af1c119"),
	voiceFile("speech_tokenizer/config.json", 2_336, "ee65bb901c876664ab8707c487157aa1a6ee57c65969b28fb5ec9dc211e68167"),
	voiceFile("speech_tokenizer/configuration.json", 76, "6bc26d64eb5024b4d1dab5a52371958b429256d6c9d59787f1f5294a54e0cebd"),
	voiceFile("speech_tokenizer/model.safetensors", 682_293_092, "836b7b357f5ea43e889936a3709af68dfe3751881acefe4ecf0dbd30ba571258"),
	voiceFile("speech_tokenizer/preprocessor_config.json", 234, "fcb3805e597e786d4067706e602f6688524640f8d3396790e2e09b5942fcbdfb"),
	voiceFile("tokenizer_config.json", 7_344, "dc3c31c3bdaedd5016382bb3cbe07323026775ad51f5a4fb564505992ae4a670"),
	voiceFile("vocab.json", 2_776_833, "ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910"),
];

// The ready-made voices are the voice model speaking from short recordings of each voice (Resources/voices): one model,
// one download for both features.

/** CleanUp: SAM 2.1 tiny (the object's outline, ONNX export of facebook/sam2.1-hiera-tiny) and LaMa (the fill). */
const SAM2_REPO = "onnx-community/sam2.1-hiera-tiny-ONNX";
const SAM2_REV = "814a066640debee5a91e70aa401fb8e17e030503";
const LAMA_REV = "c3c0c9e468934d62e79c329e35d82dd09ff8c444";
const samFile = (file: string, size: number, sha256: string): ModelFile => hfFile(SAM2_REPO, SAM2_REV, `onnx/${file}`, `sam2/onnx/${file}`, size, sha256);

/** Face swap models as FaceFusion publishes them (ONNX), pinned to a commit of each model repo. */
const FACEFUSION_300 = "728b9659bd9691bf32cbf7f61af478d94b7ba81e";
const FACEFUSION_330 = "6271ab1c4619ceb2e534d65e0ec973f22a9aec38";
/** The face restorer and parser of Face swap, also Retouch's (the same files: Retouch uses Face swap's when it is here). */
const GFPGAN_FILE = hfFile("facefusion/models-3.0.0", FACEFUSION_300, "gfpgan_1.4.onnx", "gfpgan_1.4.onnx", 340_299_087, "accc4757b26bdb89b32b4d3500d4f79c9dff97c1dd7c7104bf9dcb95e3311385");
const BISENET_FILE = hfFile("facefusion/models-3.0.0", FACEFUSION_300, "bisenet_resnet_34.onnx", "bisenet_resnet_34.onnx", 93_632_546, "4a0b8c958a3c938913bd06a8365dbb3c8761afba6ecbf0d14b3b1f77eb230c96");

/** Enhance voice: DeepFilterNet's own command-line program (Rust, ONNX inside) and the DeepFilterNet 3 model, release v0.5.6. */
const DFN = "https://github.com/Rikorose/DeepFilterNet";
const DFN_TAG = "v0.5.6";
/** Separate: Demucs v4's source files at the v4.0.1 release commit (raw GitHub files are byte-stable) and the htdemucs weights. */
const DEMUCS_CODE = "ef66d254cd6d558e207eeff2c4b8d053db2e77dd";
const demucsCode = (file: string, size: number, sha256: string): ModelFile => ({
	url: `https://raw.githubusercontent.com/facebookresearch/demucs/${DEMUCS_CODE}/${file}`,
	mirrors: [`https://cdn.jsdelivr.net/gh/facebookresearch/demucs@${DEMUCS_CODE}/${file}`],
	dest: `src/${file}`,
	size,
	sha256,
});
/** Voice changer: OpenVoice's model code (pinned commit) and the v2 tone colour converter (Hugging Face, pinned). */
const OPENVOICE_CODE = "74a1d147b17a8c3092dd5430504bd83ef6c7eb23";
const OPENVOICE_REV = "f36e7edfe1684461a8343844af60babc2efbb727";
const openvoiceCode = (file: string, size: number, sha256: string): ModelFile => ({
	url: `https://raw.githubusercontent.com/myshell-ai/OpenVoice/${OPENVOICE_CODE}/${file}`,
	mirrors: [`https://cdn.jsdelivr.net/gh/myshell-ai/OpenVoice@${OPENVOICE_CODE}/${file}`],
	dest: `src/${file}`,
	size,
	sha256,
});

/**
 * Claude's hearing (studio/server/hear-models.ts): CLAP larger_clap_general (sound ↔ words) and the AudioSet tagger,
 * both quantized ONNX by Xenova at pinned commits, run by transformers.js + ONNX Runtime in the app's server. Laid out
 * as `<repo>/<file>` so transformers.js finds them offline.
 */
const CLAP_REPO = "Xenova/larger_clap_general";
const CLAP_REV = "d78c3994912c441f0151a5cc44d86f6b7bf4c861";
const AST_REPO = "Xenova/ast-finetuned-audioset-10-10-0.4593";
const AST_REV = "249a1fbf0286b40e7f1ed687a8ae396997bf7dc6";
const clapFile = (file: string, size: number, sha256: string): ModelFile => hfFile(CLAP_REPO, CLAP_REV, file, `${CLAP_REPO}/${file}`, size, sha256);
const astFile = (file: string, size: number, sha256: string): ModelFile => hfFile(AST_REPO, AST_REV, file, `${AST_REPO}/${file}`, size, sha256);
export const HEAR_FILES: ModelFile[] = [
	clapFile("config.json", 587, "b8c3a259af1c9eee98570630d81881974a368364886678d9c6b04c6d15874837"),
	clapFile("preprocessor_config.json", 541, "9739f58296aa6f9ac18008fd0150fb2649bc554985fbde86d0a4041c882ac753"),
	clapFile("tokenizer.json", 2_108_774, "dc239041d98de27ffc3975473a1a23e3db4c937b23c138c38bbc66588bd247e5"),
	clapFile("tokenizer_config.json", 1_392, "2c964a338683aec3695ea37687271e75b40905233f5d2a5bbb9be8cb40c4d0a0"),
	clapFile("special_tokens_map.json", 964, "8c785abebea9ae3257b61681b4e6fd8365ceafde980c21970d001e834cf10835"),
	clapFile("vocab.json", 798_293, "ed19656ea1707df69134c4af35c8ceda2cc9860bf2c3495026153a133670ab5e"),
	clapFile("merges.txt", 456_318, "1ce1664773c50f3e0cc8842619a93edc4624525b728b188a9e0be33b7726adc5"),
	clapFile("onnx/audio_model_quantized.onnx", 78_155_433, "320b831d0043d36aa8cfad0f36b64b7c597fa9ff01a5a9b505e37632923cf9ac"),
	clapFile("onnx/text_model_quantized.onnx", 126_603_263, "045614ce697750cf8876cb965ebfad3ef2d0ae7900dda897d7569f7be86521cd"),
	astFile("config.json", 26_792, "49d0dce922da23685787c73a874d9b1ffa97297f8cc4dc0a4e8bef219725e44d"),
	astFile("preprocessor_config.json", 297, "8d04ba5a9c6fca5d39d0de2b1fd05ecf79deb589fbba279728bbebac39934231"),
	astFile("onnx/model_quantized.onnx", 90_807_386, "807d244b58a30eaa89f0a721fb841619c696857aabe4eac93769bd0b61497f61"),
];

/** The Mac models with their original sources; MAC_MODELS downloads the same files from our copy first. */
const MAC_ORIGINALS: ModelSpec[] = [
	{
		id: "whisper",
		title: "Speech recognition",
		purpose: "Captions from voice, Remove pauses, word timing for voice-overs",
		appleSiliconOnly: false,
		root: modelDirs.whisper,
		files: [
			hfFile("ggerganov/whisper.cpp", WHISPER_REV, WHISPER_FILE, WHISPER_FILE, 574_041_195, "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2"),
			{ ...hfFile("ggml-org/whisper-vad", WHISPER_VAD_REV, WHISPER_VAD_FILE, WHISPER_VAD_FILE, 885_098, "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987"), optional: true },
		],
		credit: "Whisper large-v3-turbo (OpenAI, MIT) in the whisper.cpp format (ggml-org, MIT), Silero VAD 6.2.0 (Silero Team, MIT) in the whisper.cpp format (ggml-org, MIT)",
		diskBytes: 574_041_195,
		minMemory: 4e9,
	},
	{
		id: "lipsync",
		title: "Lipsync on this Mac",
		purpose: "Free lipsync without a cloud key (about 2 min per 10 s of video)",
		appleSiliconOnly: true,
		minMacOS: 14,
		minMemory: 16e9,
		root: modelDirs.lipsync,
		files: [
			museCode("LICENSE", 13_427, "992ec5fd1dd4964cfa003665196cd0c0c10a7a5aa10109991e964eebd2c7f116"),
			museCode("musetalk/utils/__init__.py", 160, "ccd6f1e5ebcc92d26d7322a565c120d93aeda34c6ccba5e9aaa6f1138d7d91fb"),
			museCode("musetalk/utils/utils.py", 11_737, "3715eacedefc97d0ef97b98c2f3bf06929bf9e312393752b75b708e43a99a055"),
			museCode("musetalk/utils/audio_processor.py", 4_227, "b7b62f3daa99678576138bf581a6394a10d346571a2530a760d1299ffd622b81"),
			museCode("musetalk/utils/blending.py", 5_337, "f1be04977db7e6fa1551dfe66dfbdea1e2f32c8d237edaf5a75a0ca4ddd80b53"),
			museCode("musetalk/utils/face_parsing/__init__.py", 4_700, "c2824281e80458b81b7ecdde6cfd2b5f0224b022f41aaf1c61144a52163b2494"),
			museCode("musetalk/utils/face_parsing/model.py", 10_676, "05d69d1bd77fbca7b537602fe3f7851e8b2e1a3ea0279f383b4223598157e2d2"),
			museCode("musetalk/utils/face_parsing/resnet.py", 3_706, "a3419dabeff41c535e24f4d056b054c1bfc70d56f9ee430808b440005cc3189f"),
			museCode("musetalk/models/unet.py", 1_686, "05d5dadfde2e726b61d8387a4876336d4dcacc696636e8dcfec69863ce819256"),
			museCode("musetalk/models/vae.py", 5_419, "6ecde3f4417178d8a9de5ed6045e2a4832efa65189b10b0672cab68efe529d32"),
			// The UNet in half precision (1.7 GB, exactly what local-lipsync.py makes from the 3.4 GB original and runs).
			pcFile(
				"lipsync/models/musetalkV15/unet.fp16.safetensors",
				"models/musetalkV15/unet.fp16.safetensors",
				1_699_979_016,
				"7e1db0be4cbbe9630150ec5e424a351f50c7517e555ab0f7db7695f0c9d2c31f",
				hfFile("TMElyralab/MuseTalk", MUSETALK_REV, "musetalkV15/unet.pth", "models/musetalkV15/unet.pth", 3_400_074_924, "7ebf6c98c181e20838e4c0054e96e944ac60d5d692cc01db42839fe11b787007"),
			),
			hfFile("TMElyralab/MuseTalk", MUSETALK_REV, "musetalkV15/musetalk.json", "models/musetalkV15/musetalk.json", 748, "5b6923aee04d71692e0e9846c471e0a4ea07a4f686d39545e472bd4ba17e1b47"),
			hfFile("stabilityai/sd-vae-ft-mse", VAE_REV, "diffusion_pytorch_model.safetensors", "models/sd-vae/diffusion_pytorch_model.safetensors", 334_643_276, "a1d993488569e928462932c8c38a0760b874d166399b14414135bd9c42df5815"),
			hfFile("stabilityai/sd-vae-ft-mse", VAE_REV, "config.json", "models/sd-vae/config.json", 547, "92d3dfb746fca211a2c9e019e285f8597412211728dce3c5bcf4eda0f2d62e7e"),
			hfFile("openai/whisper-tiny", WHISPER_TINY_REV, "model.safetensors", "models/whisper/model.safetensors", 151_061_672, "7ebd0e69e78190ffe1438491fa05cc1f5c1aa3a4c4db3bc1723adbb551ea2395"),
			hfFile("openai/whisper-tiny", WHISPER_TINY_REV, "config.json", "models/whisper/config.json", 1_983, "ffdccec4f3211f4c63310f2b7098f309fe70f3952cedc5e4d11e43f5b2379b98"),
			hfFile("openai/whisper-tiny", WHISPER_TINY_REV, "preprocessor_config.json", "models/whisper/preprocessor_config.json", 184_990, "9b5cd03a36fbb8a627c64d98a5b5b126ead95a77720723944487311f0110b666"),
			// Face-parsing weights of zllrunning/face-parsing.PyTorch (MIT), mirrored on Hugging Face (same sha256 as the original).
			hfFile("ManyOtherFunctions/face-parse-bisent", BISENET_REV, "79999_iter.pth", "models/face-parse-bisent/79999_iter.pth", 53_289_463, "468e13ca13a9b43cc0881a9f99083a430e9c0a38abd935431d1c28ee94b26567"),
			{
				url: "https://download.pytorch.org/models/resnet18-5c106cde.pth",
				mirrors: [hf("ManyOtherFunctions/face-parse-bisent", BISENET_REV, "resnet18-5c106cde.pth")],
				dest: "models/face-parse-bisent/resnet18-5c106cde.pth",
				size: 46_827_520,
				sha256: "5c106cde386e87d4033832f2996f5493238eda96ccf559d1d62760c4de0613f8",
			},
		],
		python: { env: "env", lock: LIPSYNC_LOCK, bytes: 420_000_000 },
		credit: "MuseTalk 1.5 (Tencent Music Entertainment, MIT), SD VAE ft-MSE (Stability AI, MIT), whisper-tiny (OpenAI, Apache-2.0), face-parsing BiSeNet (MIT), PyTorch (BSD)",
		diskBytes: 5_600_000_000,
	},
	{
		id: "voice",
		title: "Voice on this Mac",
		purpose: "Free voice-over in the clip's own voice, without a cloud key",
		appleSiliconOnly: true,
		minMacOS: 14,
		minMemory: 16e9,
		root: modelDirs.voice,
		files: VOICE_FILES,
		python: { env: path.join("mlx-audio", "env"), lock: VOICE_LOCK, bytes: 160_000_000 },
		credit: "Qwen3-TTS 12Hz 1.7B Base (Alibaba Qwen, Apache-2.0), 8-bit MLX format (mlx-community), mlx-audio (MIT), MLX (Apple, MIT)",
		diskBytes: 3_200_000_000,
	},
	{
		id: "faceswap",
		title: "Face swap",
		purpose: "A new face on the person in a clip, made on this Mac",
		appleSiliconOnly: true,
		minMacOS: 14,
		minMemory: 16e9,
		root: modelDirs.faceswap,
		files: [
			hfFile("facefusion/models-3.3.0", FACEFUSION_330, "hyperswap_1b_256.onnx", "hyperswap_1b_256.onnx", 402_742_682, "5124031789c42f71b9558fb71954ef7aedb6da7ed9fac79293e23c61a792a73e"),
			hfFile("facefusion/models-3.0.0", FACEFUSION_300, "arcface_w600k_r50.onnx", "arcface_w600k_r50.onnx", 174_388_474, "f1f79dc3b0b79a69f94799af1fffebff09fbd78fd96a275fd8f0cbbea23270d1"),
			GFPGAN_FILE,
			BISENET_FILE,
		],
		python: { env: "env", lock: FACESWAP_LOCK, bytes: 70_000_000 },
		credit: "HyperSwap 1b (FaceFusion, ResearchRAIL), ArcFace w600k face recognition (InsightFace, non-commercial research license), GFPGAN 1.4 (Tencent ARC, Apache-2.0), BiSeNet face parser (MIT), ONNX Runtime (Microsoft, MIT), OpenCV (Apache-2.0)",
		diskBytes: 1_100_000_000,
	},
	{
		id: "cleanup",
		title: "CleanUp",
		purpose: "Removes an object, a person or a caption from a photo or a clip and fills in the background, on this Mac",
		appleSiliconOnly: true,
		minMacOS: 14,
		minMemory: 8e9,
		root: modelDirs.cleanup,
		files: [
			samFile("vision_encoder.onnx", 354_238, "4f30aacd3aaefbca81a0b7fe4c1fc96345570ea0a6f80ced599493d1b3be2e8c"),
			samFile("vision_encoder.onnx_data", 134_084_864, "e83df9866a5afe68ea7f0f721f18f65137fc3acbf0da1c74e946d363e09c69cc"),
			samFile("prompt_encoder_mask_decoder.onnx", 213_114, "874414704c5d686db7d206a35f6e15d26563d50c8c4468fccc6739bd7e491dcf"),
			samFile("prompt_encoder_mask_decoder.onnx_data", 20_958_208, "e9874d900dd4134ed60eab1e97910327c2419e0b2954485d8fd6e7f1a1470f47"),
			hfFile("Carve/LaMa-ONNX", LAMA_REV, "lama_fp32.onnx", "lama/lama_fp32.onnx", 208_044_816, "1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6"),
		],
		// The same small environment as Face swap (ONNX Runtime, OpenCV, NumPy).
		python: { env: "env", lock: FACESWAP_LOCK, bytes: 70_000_000 },
		credit: "SAM 2.1 Hiera tiny (Meta, Apache-2.0; ONNX by onnx-community), LaMa big-lama (Samsung AI, Apache-2.0; ONNX by Carve), ONNX Runtime (Microsoft, MIT), OpenCV (Apache-2.0)",
		diskBytes: 450_000_000,
	},
	{
		id: "denoise",
		title: "Enhance voice",
		purpose: "Clear speech: noise, hum and room taken out of a voice, on this Mac",
		appleSiliconOnly: true,
		root: modelDirs.denoise,
		files: [
			{ url: `${DFN}/releases/download/${DFN_TAG}/deep-filter-0.5.6-aarch64-apple-darwin`, dest: "deep-filter", size: 27_877_081, sha256: "4601e7f4e4c03e59a4c5b5000216ef3add3e808799cfccd95e14e83ea4611081", executable: true },
			{ url: `${DFN}/raw/${DFN_TAG}/models/DeepFilterNet3_onnx.tar.gz`, dest: "DeepFilterNet3_onnx.tar.gz", size: 7_983_136, sha256: "c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616" },
		],
		credit: "DeepFilterNet 3 (Hendrik Schröter, MIT / Apache-2.0)",
		diskBytes: 36_000_000,
		minMemory: 4e9,
	},
	{
		id: "separate",
		title: "Separate voice and music",
		purpose: "Voice and music of a clip as two clips, cleaner than the built-in separation, on this Mac",
		appleSiliconOnly: true,
		minMacOS: 14,
		minMemory: 8e9,
		root: modelDirs.separate,
		files: [
			demucsCode("LICENSE", 1_087, "cf9b17822d1fcd4ff32ccbe14183386fb3adf6f2ff92dc184130823f7fc28173"),
			demucsCode("demucs/__init__.py", 221, "2eeae8de4a5f91ba7b7e91cb7c2460787c10afc17e720b8773cd66e8e5a10e26"),
			demucsCode("demucs/apply.py", 10_824, "316278eeb028c66f99befa4201edca7f598166628aeec8e40a08544f00aa21df"),
			demucsCode("demucs/demucs.py", 17_010, "4ab138b111d98f0a6ad6ed0c8b8c2f42578fd187c6890104b2251089a74f0d2d"),
			demucsCode("demucs/hdemucs.py", 30_396, "5b98a5ee262bf6b872a0db23eeb60d024debc4be1ed237c551284af305343864"),
			demucsCode("demucs/htdemucs.py", 26_577, "3404ed68d35b946f9c54b54201851bb4171dd7861a498945ce53b1df1144b034"),
			demucsCode("demucs/spec.py", 1_429, "8a63153a012703fd5ed2e3d012e91ad624597c7296e9d82f40a26c4249f2bff7"),
			demucsCode("demucs/states.py", 4_835, "37375543dad61a7dc549caf6f165c0500d903313159c70cf893d47718194b865"),
			demucsCode("demucs/transformer.py", 27_256, "d99b3706f590397382abed1da384c539805c8fc3a0abb6f6ac79e711649c6f8d"),
			demucsCode("demucs/utils.py", 4_312, "be4a0005ed5ec2f23628c84be39082f5c3c0f6775049b982e24f2852ae0dcf5f"),
			{
				url: "https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th",
				dest: "models/htdemucs.th",
				size: 84_141_911,
				sha256: "8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4",
			},
		],
		python: { env: "env", lock: SEPARATE_LOCK, bytes: 110_000_000 },
		credit: "Demucs v4 htdemucs (Meta, MIT), Open-Unmix filtering (MIT), PyTorch (BSD)",
		diskBytes: 520_000_000,
	},
	{
		id: "voicechange",
		title: "Voice changer",
		purpose: "The clip's speech in another voice (ready-made or one of My voices), timing and intonation kept, on this Mac",
		appleSiliconOnly: true,
		minMacOS: 14,
		minMemory: 8e9,
		root: modelDirs.voicechange,
		files: [
			openvoiceCode("LICENSE", 1_057, "bb3541f421e6273d3a3e3dd5bdba2bd3b79a3c2eadca65cde9c62c2467903ac0"),
			openvoiceCode("openvoice/attentions.py", 16_360, "6a392057838e6051afc8beed43c2d1279d75de8c8b600552e7232ad930b356c3"),
			openvoiceCode("openvoice/commons.py", 4_956, "046943d265635c3d9c99195562e703564a26300981a7db5b87d4cd3fd180ae0d"),
			openvoiceCode("openvoice/models.py", 16_801, "54f9e8284a0e9a89c75cb3163d2694cf34d90a5d05cfbcbf12ccd4f0b1ba2dc8"),
			openvoiceCode("openvoice/modules.py", 19_010, "b2376049141934eb63bb4d905920c486a286bec65f0735b78ba52b2fb54564d0"),
			openvoiceCode("openvoice/transforms.py", 7_253, "e6798989a0d75cbec45e7e24e3697e1c4886b3664c6a80a452645ef1d2a93f9c"),
			hfFile("myshell-ai/OpenVoiceV2", OPENVOICE_REV, "converter/config.json", "converter/config.json", 838, "9dfff60350b8c63f2c664efd92a61b2516efb22671466960f0e5dfebd881fa47"),
			hfFile("myshell-ai/OpenVoiceV2", OPENVOICE_REV, "converter/checkpoint.pth", "converter/checkpoint.pth", 131_320_490, "9652c27e92b6b2a91632590ac9962ef7ae2b712e5c5b7f4c34ec55ee2b37ab9e"),
		],
		python: { env: "env", lock: VOICECHANGE_LOCK, bytes: 100_000_000 },
		credit: "OpenVoice v2 tone colour converter (MyShell, MIT), PyTorch (BSD)",
		diskBytes: 480_000_000,
	},
	{
		id: "retouch",
		title: "Retouch",
		purpose: "Sharper eyes and smoother skin on the person's own face, on this Mac (nothing to download when Face swap is here)",
		appleSiliconOnly: true,
		minMacOS: 14,
		minMemory: 8e9,
		root: modelDirs.retouch,
		files: [GFPGAN_FILE, BISENET_FILE],
		// The same small environment as Face swap (ONNX Runtime, OpenCV, NumPy).
		python: { env: "env", lock: FACESWAP_LOCK, bytes: 70_000_000 },
		credit: "GFPGAN 1.4 (Tencent ARC, Apache-2.0; ONNX by FaceFusion), BiSeNet face parser (MIT), ONNX Runtime (Microsoft, MIT), OpenCV (Apache-2.0)",
		diskBytes: 510_000_000,
	},
	{
		id: "hear",
		title: "Sound recognition for Claude",
		purpose: "Lets Claude ask how any stretch sounds, in plain words, and name what is heard (rain, applause, music style, mood…), on this Mac",
		appleSiliconOnly: false,
		minMemory: 4e9,
		root: modelDirs.hear,
		files: HEAR_FILES,
		credit: "CLAP larger_clap_general (LAION, Apache-2.0) and AST AudioSet (MIT, BSD-3-Clause), ONNX by Xenova; transformers.js (Hugging Face, Apache-2.0), ONNX Runtime (Microsoft, MIT)",
		diskBytes: 298_960_040,
	},
];

/**
 * Gaziyav keeps only the light models on this Mac; lipsync, voice and face swap (5.6 + 3.2 + 1.1 GB) run on fal.ai
 * (src/fal) — their specs stay above for reference only (docs/GAZIYAV.md).
 */
export const CLOUD_INSTEAD: ReadonlySet<ModelId> = new Set<ModelId>(["lipsync", "voice", "faceswap"]);

/** Not in our copy on Hugging Face (added after it was made): downloaded from the original, pinned and sha256-checked. */
export const NOT_MIRRORED: ReadonlySet<ModelId> = new Set<ModelId>(["hear"]);

// Retouch's two files are Face swap's (one copy in the repository, under faceswap/): with Face swap gone from this
// list they must still come from there, not from a retouch/ folder that was never uploaded.
const mirrorFolder = (id: ModelId) => (id === "retouch" ? "faceswap" : id);
const MAC_MODELS: ModelSpec[] = MAC_ORIGINALS.filter((spec) => !CLOUD_INSTEAD.has(spec.id)).map((spec) => (NOT_MIRRORED.has(spec.id) ? spec : { ...spec, files: spec.files.map((f) => mirror(mirrorFolder(spec.id), f)) }));

/** The features of this system: Windows gets the CUDA / DirectML versions (manifest-win.ts). */
export const MODELS: ModelSpec[] = IS_WINDOWS ? MAC_MODELS.map(windowsSpec) : MAC_MODELS;

export function modelSpec(id: string): ModelSpec | undefined {
	return MODELS.find((m) => m.id === id) ?? PARTS.find((m) => m.id === id);
}

export const ORIGINAL_SPECS: readonly ModelSpec[] = MAC_ORIGINALS;
export const originalSpec = (id: string): ModelSpec | undefined => MAC_ORIGINALS.find((m) => m.id === id);

/** Download size: model files + Python runtime and packages (an add-on is not what a feature waits for: left out). */
export function downloadBytes(spec: ModelSpec): number {
	return spec.files.reduce((s, f) => s + (f.optional ? 0 : f.size), 0) + (spec.python?.bytes ?? 0);
}

/**
 * The two classes of the download policy (docs/AI-DOWNLOAD.md). Small (a download up to 1 GB: speech recognition,
 * Enhance voice, Separate, Voice changer, CleanUp, Retouch): comes by itself in the background once the first project
 * has been opened (background.ts). Large (lipsync, voice, pictures, music, face swap): downloads on first use, inside
 * the feature's own progress — or in the background too, when Settings → AI says so.
 */
export const SMALL_LIMIT = 1_000_000_000;
export type ModelClass = "small" | "large";
export function modelClass(spec: ModelSpec): ModelClass {
	return downloadBytes(spec) <= SMALL_LIMIT ? "small" : "large";
}

/**
 * Parts of the features above (`partOf`): a faster engine for a model that is already here. A part downloads in the
 * background like the small models (background.ts), after its feature; until it is here — and whenever it fails — the
 * feature runs as it always did. Not in MODELS: Settings, the tiers and the mirror list see the features only.
 * Mac only (Apple's MLX); Windows keeps PyTorch on CUDA. Downloaded from the original, pinned and sha256-checked.
 *
 * separate-mlx: Demucs v4 htdemucs in MLX (demucs-mlx 1.6.1) — the weights are the same model's, as safetensors.
 * On an M1 Pro (16 GB) a 4-minute song separates in 10 s instead of 22 s, with 2.0 GB instead of 2.6 GB at the peak.
 */
const DEMUCS_MLX_REPO = "ssmall256/demucs-mlx";
const DEMUCS_MLX_REV = "35ecb1a906ec420b1a28069db575ad070d35860e";
/**
 * separate-beats: Beat This! `final0` (CPJKU), a referee for the song's beats and bars (hear/net-grid.ts). The authors
 * publish a PyTorch checkpoint (a pickle) on their university's cloud — no revisions there: the sha256 is the pin. The
 * install reads it once with weights_only (tensors and plain values; anything else stops it), writes safetensors —
 * the same bytes on every Mac, pinned below — and deletes the checkpoint; the helper loads the safetensors only.
 * Its three small packages sit in its own folder; the helper runs on Separate's Python (PyTorch is there).
 */
export const BEATS_WEIGHTS = "beat_this-final0.safetensors";
export const BEATS_WEIGHTS_SHA256 = "c56f5bec8c2acac43fc3172aa8ecf3dd2e0d68b4243c428892610bcc546816a0";
const MAC_PARTS: ModelSpec[] = [
	{
		id: "separate-mlx",
		partOf: "separate",
		title: "Separate voice and music",
		purpose: "The same separation, two to three times faster on Apple silicon",
		appleSiliconOnly: true,
		minMacOS: 14,
		minMemory: 8e9,
		root: () => path.join(modelDirs.separate(), "mlx"),
		files: [
			hfFile(DEMUCS_MLX_REPO, DEMUCS_MLX_REV, "htdemucs.safetensors", "htdemucs.safetensors", 168_005_865, "339d267a7a6983a11eedbdc00413c602a65e9b9103f695fb5c2b2a481cd9d297"),
			hfFile(DEMUCS_MLX_REPO, DEMUCS_MLX_REV, "htdemucs_config.json", "htdemucs_config.json", 4_215, "23657b19db14771aecf366ceedbf846c1386836c10043c97f4569acf05526b78"),
		],
		python: { env: "env", lock: SEPARATE_MLX_LOCK, bytes: 52_000_000 },
		credit: "demucs-mlx (ssmall256, MIT): Demucs v4 htdemucs (Meta, MIT) in MLX (Apple, MIT)",
		diskBytes: 365_000_000,
	},
	{
		id: "separate-beats",
		partOf: "separate",
		title: "Separate voice and music",
		purpose: "A song's beats and bar starts checked by a beat model, on this Mac",
		appleSiliconOnly: true,
		minMacOS: 14,
		minMemory: 8e9,
		root: () => path.join(modelDirs.separate(), "beats"),
		files: [{ url: "https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/final0.ckpt", dest: "final0.ckpt", size: 81_058_141, sha256: "8c328b45f59d8dd3dff219253ff6a8d6482be57d0133a29140e2febbf8eb8331" }],
		python: { env: "env", lock: BEATS_LOCK, bytes: 230_000 },
		credit: "Beat This! final0 (Institute of Computational Perception, JKU Linz, MIT), rotary-embedding-torch (MIT), python-soxr (LGPL-2.1-or-later)",
		diskBytes: 82_000_000,
	},
];
export const PARTS: ModelSpec[] = IS_WINDOWS ? [] : MAC_PARTS;
/** The parts of a feature. */
export const partsOf = (id: string): ModelSpec[] => PARTS.filter((p) => p.partOf === id);
