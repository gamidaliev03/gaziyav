// Model files that no feature of this version uses any more leave the disk, once, a little after launch: an earlier
// lipsync engine, voice models replaced by the 8-bit one (which also speaks the ready-made voices), a stray copy of the
// lipsync weights. Only these named leftovers are touched, and the replaced voice model only once its successor is
// complete on this Mac. On a Mac that went through the earlier versions this frees over 15 GB.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { modelsDir } from "@/platform/paths";
import { LEGACY_VOICE_SNAPSHOT, originalSpec } from "./manifest";

const HUB = path.join("LocalTTS", "hf-cache", "hub");

function sizeOf(file: string): number {
	try {
		return fs.statSync(file).size;
	} catch {
		return -1;
	}
}

/** Files under `dir`, recursively (links not followed). */
function walk(dir: string): string[] {
	const out: string[] = [];
	for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, d.name);
		if (d.isDirectory()) out.push(...walk(p));
		else out.push(p);
	}
	return out;
}

/**
 * The shared blob store of a Hugging Face cache: blobs no model folder points to any more are deleted (the folders
 * link their files into it, so removing a folder alone frees nothing).
 */
function collectBlobs(hub: string): number {
	const store = path.join(hub, "blobs");
	if (!fs.existsSync(store)) return 0;
	const used = new Set<string>();
	for (const d of fs.readdirSync(hub)) {
		if (!d.startsWith("models--")) continue;
		for (const f of walk(path.join(hub, d))) {
			try {
				used.add(fs.realpathSync(f));
			} catch {}
		}
	}
	let freed = 0;
	for (const f of walk(store)) {
		let real: string;
		try {
			real = fs.realpathSync(f);
		} catch {
			continue;
		}
		if (used.has(real)) continue;
		freed += Math.max(0, sizeOf(f));
		fs.rmSync(f, { force: true });
	}
	return freed;
}

/** Removes the leftovers; returns what went, for the log. */
export function pruneObsolete(): string[] {
	if (os.platform() !== "darwin") return [];
	const root = modelsDir();
	const at = (rel: string) => path.join(root, rel);
	const removed: string[] = [];
	const rm = (rel: string) => {
		if (!fs.existsSync(at(rel))) return;
		fs.rmSync(at(rel), { recursive: true, force: true });
		removed.push(rel);
	};
	// The lipsync engine before MuseTalk, a debug clip, and a copy of the UNet the engine never reads.
	rm(path.join("LocalLipsync", "latentsync"));
	rm(path.join("LocalLipsync", "musetalk", "ll_src25.mp4"));
	const v15 = path.join("LocalLipsync", "musetalk", "models", "musetalkV15");
	if (fs.existsSync(at(path.join(v15, "unet.pth"))) || fs.existsSync(at(path.join(v15, "unet.fp16.safetensors")))) rm(path.join(v15, "unet.safetensors"));
	// Voice engines tried before Qwen3-TTS 1.7B.
	rm(path.join("LocalTTS", "chatterbox"));
	for (const repo of ["Qwen3-TTS-12Hz-0.6B-Base-8bit", "chatterbox-multilingual-v3", "S3TokenizerV2"]) rm(path.join(HUB, `models--mlx-community--${repo}`));
	// The 8-bit voice model is complete when every one of its files is there at its exact size (downloads only ever
	// land at their final path once checked, so a size match is a finished file).
	const voice = originalSpec("voice");
	const eightBit = !!voice && voice.files.every((f) => sizeOf(path.join(voice.root(), f.dest)) === f.size);
	// The bf16 voice model, once the 8-bit one (same voice) is complete.
	if (eightBit) rm(path.join(HUB, "models--mlx-community--Qwen3-TTS-12Hz-1.7B-Base-bf16"));
	// The ready voices' own model: the voice model speaks them now.
	if (eightBit || fs.existsSync(at(path.join("LocalTTS", LEGACY_VOICE_SNAPSHOT, "model.safetensors")))) rm("LocalVoices");
	if (removed.length && fs.existsSync(at(HUB))) {
		const freed = collectBlobs(at(HUB));
		if (freed) removed.push(`${(freed / 1e9).toFixed(1)} GB of unused voice-model files`);
	}
	return removed;
}

/** Once per launch, a little after start (never on the way of opening the app). */
export function schedulePrune(log: (text: string) => void) {
	const g = globalThis as { __ondevicePruneScheduled?: boolean };
	if (g.__ondevicePruneScheduled) return;
	g.__ondevicePruneScheduled = true;
	setTimeout(() => {
		try {
			const removed = pruneObsolete();
			if (removed.length) log(`[ondevice] removed unused model files: ${removed.join(", ")}`);
		} catch (error) {
			log(`[ondevice] cleanup skipped: ${(error as Error).message}`);
		}
	}, 20_000).unref?.();
}
