// Parts (manifest.ts PARTS): a faster engine for a feature that is already installed. What must hold: the feature's
// own install stays exactly as it was (an rc32 install is still «verified»), a part never shows as a feature, every
// wheel and file of a part is pinned, and Windows has none.
import { expect, test } from "bun:test";
import crypto from "node:crypto";
import { BEATS_LOCK, PYTHON_VERSION, SEPARATE_LOCK, SEPARATE_MLX_LOCK, VOICE_LOCK } from "../locks";
import { BEATS_WEIGHTS, BEATS_WEIGHTS_SHA256, MODELS, type ModelSpec, modelSpec, originalSpec, PARTS, partsOf } from "../manifest";

/** server.ts' fingerprint of an install (the marker file holds it). */
function fingerprint(spec: ModelSpec, original = false): string {
	const h = crypto.createHash("sha256");
	for (const file of spec.files) {
		const f = original && file.alt ? file.alt : file;
		h.update(`${f.dest}:${f.sha256}\n`);
	}
	if (spec.python) h.update(spec.python.lock).update(PYTHON_VERSION);
	return h.digest("hex").slice(0, 16);
}

const pins = (lock: string) => new Map([...lock.matchAll(/^([a-z0-9][\w.-]*)==(\S+)((?:\s*\\\n\s+--hash=sha256:[0-9a-f]{64})+)/gim)].map((m) => [m[1], { version: m[2], hashes: [...m[3].matchAll(/sha256:([0-9a-f]{64})/g)].map((h) => h[1]).sort() }]));

test("Separate's own install is untouched: the marker rc32 wrote on the owner's Mac still verifies", () => {
	const separate = modelSpec("separate") as ModelSpec;
	// ~/Library/Application Support/Gaziyav/LocalSeparate/.installed.json, 2026-11-02
	expect([fingerprint(separate), fingerprint(separate, true)]).toContain("2be518599b52fe36");
	expect(separate.files.map((f) => f.dest)).not.toContain("htdemucs.safetensors");
});

test("a part is not a feature: no row in Settings, no tier, no mirror, and it is found by its id", () => {
	expect(PARTS.map((p) => p.id)).toEqual(["separate-mlx", "separate-beats"]);
	for (const part of PARTS) {
		expect(MODELS.some((m) => m.id === part.id)).toBe(false);
		expect(originalSpec(part.id)).toBeUndefined();
		expect(modelSpec(part.id)).toBe(part);
		expect(MODELS.some((m) => m.id === part.partOf)).toBe(true);
		// The background line reads as the feature's own («Separate voice and music · downloading in the background»).
		expect(part.title).toBe((modelSpec(part.partOf as string) as ModelSpec).title);
		// Inside the feature's folder: it leaves with the feature.
		expect(part.root().startsWith((modelSpec(part.partOf as string) as ModelSpec).root())).toBe(true);
	}
	expect(partsOf("separate").map((p) => p.id)).toEqual(["separate-mlx", "separate-beats"]);
	expect(partsOf("hear")).toEqual([]);
});

test("the MLX engine of Separate: the original files at a pinned revision, weights that cannot run code, pinned wheels", () => {
	const part = modelSpec("separate-mlx") as ModelSpec;
	expect(part.appleSiliconOnly).toBe(true);
	for (const f of part.files) {
		expect(f.url).toMatch(/^https:\/\/huggingface\.co\/ssmall256\/demucs-mlx\/resolve\/[0-9a-f]{40}\//);
		expect(f.alt).toBeUndefined(); // not our copy: the original, sha256-checked
		expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(f.dest).toMatch(/\.(safetensors|json)$/);
	}
	expect(part.files.reduce((s, f) => s + f.size, 0)).toBe(168_010_080);
	const lock = pins(SEPARATE_MLX_LOCK);
	expect([...lock.keys()].sort()).toEqual(["demucs-mlx", "mlx", "mlx-audio-io", "mlx-metal", "mlx-spectro", "numpy", "packaging", "tqdm"]);
	expect(lock.get("demucs-mlx")?.version).toBe("1.6.1");
	expect(lock.get("mlx-audio-io")?.version).toBe("1.3.24");
	expect(lock.get("mlx-spectro")?.version).toBe("0.9.10");
	// The same MLX the voice model's lock pins: one version of it in the app, the same wheels.
	const voice = pins(VOICE_LOCK);
	for (const name of ["mlx", "mlx-metal", "numpy", "packaging", "tqdm"]) expect(lock.get(name)).toEqual(voice.get(name));
	// No PyTorch in this environment (the helper's MLX engine must not need it).
	expect(SEPARATE_MLX_LOCK).not.toMatch(/^torch/m);
});

test("the beat model: the authors' checkpoint pinned by its sha256, converted to a pinned safetensors, three packages and no more", () => {
	const part = modelSpec("separate-beats") as ModelSpec;
	expect(part.files.length).toBe(1);
	expect(part.files[0].url).toBe("https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/final0.ckpt");
	expect(part.files[0].sha256).toBe("8c328b45f59d8dd3dff219253ff6a8d6482be57d0133a29140e2febbf8eb8331");
	expect(part.files[0].alt).toBeUndefined();
	expect(BEATS_WEIGHTS).toMatch(/\.safetensors$/);
	expect(BEATS_WEIGHTS_SHA256).toMatch(/^[0-9a-f]{64}$/);
	const lock = pins(BEATS_LOCK);
	expect([...lock.keys()].sort()).toEqual(["beat-this", "rotary-embedding-torch", "soxr"]);
	expect(lock.get("beat-this")?.version).toBe("1.1.0");
	expect(lock.get("rotary-embedding-torch")?.version).toBe("0.9.2");
	expect(lock.get("soxr")?.version).toBe("1.1.0");
	// What it runs on is Separate's own environment: PyTorch, torchaudio, einops and numpy are pinned there.
	const separate = pins(SEPARATE_LOCK);
	for (const name of ["torch", "torchaudio", "einops", "numpy"]) expect(separate.has(name)).toBe(true);
});
