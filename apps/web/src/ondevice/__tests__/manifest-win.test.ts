import { describe, expect, test } from "bun:test";
import { FACESWAP_LOCK_WIN, LIPSYNC_LOCK_WIN, SEPARATE_LOCK_WIN, VOICE_LOCK_WIN, VOICECHANGE_LOCK_WIN } from "../locks-win";
import { ORIGINAL_SPECS } from "../manifest";
import { windowsSpec } from "../manifest-win";

const win = ORIGINAL_SPECS.map(windowsSpec);
/** The Windows spec of a feature (fails the test when it is missing). */
const spec = (id: string) => {
	const found = win.find((m) => m.id === id);
	if (!found) throw new Error(`no Windows spec for ${id}`);
	return found;
};
const LOCKS: Record<string, string> = {
	lipsync: LIPSYNC_LOCK_WIN,
	faceswap: FACESWAP_LOCK_WIN,
	cleanup: FACESWAP_LOCK_WIN,
	retouch: FACESWAP_LOCK_WIN,
	voice: VOICE_LOCK_WIN,
	separate: SEPARATE_LOCK_WIN,
	voicechange: VOICECHANGE_LOCK_WIN,
};

describe("Windows on-device AI", () => {
	test("every feature of the Mac exists, none needs a Mac", () => {
		expect(win.map((s) => s.id)).toEqual(ORIGINAL_SPECS.map((s) => s.id));
		for (const s of win) {
			expect(s.appleSiliconOnly).toBe(false);
			expect(s.minMacOS).toBeUndefined();
			expect(`${s.title} ${s.purpose}`).not.toContain("Mac");
		}
	});
	test("Python features install the Windows locks, with PyTorch's CUDA build where they use PyTorch", () => {
		for (const s of win.filter((m) => m.python)) {
			expect(s.python?.lock).toBe(LOCKS[s.id]);
			expect(s.python?.lock).toContain("--hash=sha256:");
			if (s.id !== "faceswap" && s.id !== "cleanup" && s.id !== "retouch") expect(s.python?.lock).toMatch(/^torch==[\d.]+\+cu128 /m);
		}
		expect(FACESWAP_LOCK_WIN).toMatch(/^onnxruntime-directml==/m);
		expect(VOICE_LOCK_WIN).not.toMatch(/^gradio==/m);
		for (const lock of [LIPSYNC_LOCK_WIN, FACESWAP_LOCK_WIN]) expect(lock).toMatch(/^mediapipe==/m);
	});
	test("the MLX models are replaced by their PyTorch / GGUF releases, all pinned", () => {
		for (const id of ["voice"]) {
			const s = spec(id);
			expect(s.files.some((f) => /mlx/i.test(f.url))).toBe(false);
			for (const f of s.files) {
				expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
				expect(f.size).toBeGreaterThan(0);
				expect(f.url).toMatch(/\/resolve\/[0-9a-f]{40}\//);
			}
		}
	});
	test("the GPU-heavy features need an NVIDIA card; face swap and captions run on any PC", () => {
		for (const id of ["lipsync", "voice"]) expect(spec(id).nvidia?.minVram).toBeGreaterThanOrEqual(6e9);
		for (const id of ["whisper", "faceswap"]) expect(spec(id).nvidia).toBeUndefined();
	});
});
