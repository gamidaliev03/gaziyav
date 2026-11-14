// Which engine a separation starts with (separate-run.ts): MLX only when its part is installed, the sound is a song's
// length and memory isn't critically short; everything else is today's PyTorch path.
import { expect, test } from "bun:test";
import { MLX_MAX_SECONDS, PRESSURE_CRITICAL, pickEngine } from "../separate-run";

const ok = { installed: true, seconds: 240, pressure: 1 };

test("without the part the app runs as before", () => {
	expect(pickEngine({ ...ok, installed: false })).toBe("torch");
});

test("the part installed: MLX for a song", () => {
	expect(pickEngine(ok)).toBe("mlx");
	expect(pickEngine({ ...ok, seconds: 1 })).toBe("mlx");
	expect(pickEngine({ ...ok, seconds: MLX_MAX_SECONDS })).toBe("mlx");
	expect(pickEngine({ ...ok, pressure: 2 })).toBe("mlx"); // a warning: MLX is the lighter of the two
});

test("today's path when the sound is long, memory is critical, the length is unknown or a test asks for it", () => {
	expect(pickEngine({ ...ok, seconds: MLX_MAX_SECONDS + 1 })).toBe("torch");
	expect(pickEngine({ ...ok, pressure: PRESSURE_CRITICAL })).toBe("torch");
	expect(pickEngine({ ...ok, seconds: Number.NaN })).toBe("torch");
	expect(pickEngine({ ...ok, seconds: 0 })).toBe("torch");
	expect(pickEngine({ ...ok, forced: "torch" })).toBe("torch");
});
