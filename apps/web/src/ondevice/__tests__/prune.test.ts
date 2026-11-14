import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { originalSpec as modelSpec } from "../manifest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "prune-"));
const at = (rel: string) => path.join(root, rel);
const hub = "LocalTTS/hf-cache/hub";
/** A Hugging Face cache file: the snapshot links to a blob in the shared store (sparse, so a "2.4 GB" file costs nothing). */
function cached(repo: string, rev: string, file: string, blob: string, size: number) {
	fs.mkdirSync(at(`${hub}/blobs/${blob.slice(0, 2)}`), { recursive: true });
	const store = at(`${hub}/blobs/${blob.slice(0, 2)}/${blob}`);
	if (!fs.existsSync(store)) {
		fs.writeFileSync(store, "");
		fs.truncateSync(store, size);
	}
	const snap = at(`${hub}/models--${repo}/snapshots/${rev}`);
	fs.mkdirSync(path.dirname(path.join(snap, file)), { recursive: true });
	fs.symlinkSync(store, path.join(snap, file));
}

beforeAll(() => {
	process.env.STUDIO_SUPPORT_DIR = root;
	fs.mkdirSync(at("LocalLipsync/latentsync/checkpoints"), { recursive: true });
	fs.mkdirSync(at("LocalLipsync/musetalk/models/musetalkV15"), { recursive: true });
	fs.writeFileSync(at("LocalLipsync/musetalk/models/musetalkV15/unet.fp16.safetensors"), "x");
	fs.writeFileSync(at("LocalLipsync/musetalk/models/musetalkV15/unet.safetensors"), "x");
	fs.mkdirSync(at("LocalVoices/hf-cache"), { recursive: true });
	fs.mkdirSync(at("LocalTTS/chatterbox/env"), { recursive: true });
	cached("mlx-community--Qwen3-TTS-12Hz-1.7B-Base-8bit", "e7dd0585652209fa0d7783659aad4e8a324de11c", "model.safetensors", "9f071c", 2_417_320_525);
	cached("mlx-community--Qwen3-TTS-12Hz-1.7B-Base-8bit", "e7dd0585652209fa0d7783659aad4e8a324de11c", "speech_tokenizer/model.safetensors", "7aa53f", 682_293_092);
	// The rest of the 8-bit model, so it is complete (every file at its exact size).
	for (const f of modelSpec("voice")!.files) {
		const file = path.join(root, "LocalTTS", f.dest);
		if (fs.existsSync(file)) continue;
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, "");
		fs.truncateSync(file, f.size);
	}
	cached("mlx-community--Qwen3-TTS-12Hz-1.7B-Base-bf16", "a6eb4f68e4b056f1215157bb696209bc82a6db48", "model.safetensors", "69d0d8", 5000);
	cached("mlx-community--Qwen3-TTS-12Hz-1.7B-Base-bf16", "a6eb4f68e4b056f1215157bb696209bc82a6db48", "speech_tokenizer/model.safetensors", "7aa53f", 682_293_092);
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("pruneObsolete", () => {
	test.if(os.platform() === "darwin")("keeps the bf16 voice model while the 8-bit one is incomplete", async () => {
		const { pruneObsolete } = await import("../prune");
		const missing = path.join(root, "LocalTTS", modelSpec("voice")!.files.find((f) => f.dest.endsWith("vocab.json"))!.dest);
		fs.renameSync(missing, `${missing}.away`);
		pruneObsolete();
		expect(fs.existsSync(at(`${hub}/models--mlx-community--Qwen3-TTS-12Hz-1.7B-Base-bf16`))).toBe(true);
		fs.renameSync(`${missing}.away`, missing);
	});

	test.if(os.platform() === "darwin")("removes only the leftovers and keeps blobs that the voice model still uses", async () => {
		const { pruneObsolete } = await import("../prune");
		const removed = pruneObsolete();
		expect(fs.existsSync(at("LocalLipsync/latentsync"))).toBe(false);
		expect(fs.existsSync(at("LocalLipsync/musetalk/models/musetalkV15/unet.safetensors"))).toBe(false);
		expect(fs.existsSync(at("LocalLipsync/musetalk/models/musetalkV15/unet.fp16.safetensors"))).toBe(true);
		expect(fs.existsSync(at("LocalVoices"))).toBe(false);
		expect(fs.existsSync(at("LocalTTS/chatterbox"))).toBe(false);
		expect(fs.existsSync(at(`${hub}/models--mlx-community--Qwen3-TTS-12Hz-1.7B-Base-bf16`))).toBe(false);
		// The bf16 weights went; the speech tokenizer it shared with the 8-bit model stays.
		expect(fs.existsSync(at(`${hub}/blobs/69/69d0d8`))).toBe(false);
		expect(fs.existsSync(at(`${hub}/blobs/7a/7aa53f`))).toBe(true);
		expect(fs.statSync(at(`${hub}/models--mlx-community--Qwen3-TTS-12Hz-1.7B-Base-8bit/snapshots/e7dd0585652209fa0d7783659aad4e8a324de11c/model.safetensors`)).size).toBe(2_417_320_525);
		// (The first test already took the other leftovers.)
		expect(removed.some((r) => r.includes("1.7B-Base-bf16"))).toBe(true);
	});
});
