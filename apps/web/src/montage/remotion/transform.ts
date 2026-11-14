// The transform of an AI layer at a moment of its own time (pure: shared by the Remotion layer and the unit tests).
import type { MontageItem } from "../types";

/**
 * The layer's transform at content time `tau` (seconds since its untrimmed start): linear between the keyframed
 * samples (`tfk`, exact on the frame grid), else the still transform.
 */
export function transformAt(item: Pick<MontageItem, "tf" | "tfk">, tau: number): MontageItem["tf"] {
	const k = item.tfk;
	if (!k || k.v.length < 6 || !(k.r > 0)) return item.tf;
	const n = Math.floor(k.v.length / 6);
	const f = Math.max(0, Math.min(n - 1, (tau - k.t0) * k.r));
	const i = Math.min(Math.max(0, n - 2), Math.floor(f + 1e-6));
	const a = n > 1 ? Math.max(0, Math.min(1, f - i)) : 0;
	const at = (j: number) => (n > 1 ? k.v[i * 6 + j] + (k.v[(i + 1) * 6 + j] - k.v[i * 6 + j]) * a : k.v[j]);
	return { x: at(0), y: at(1), sx: at(2), sy: at(3), rot: at(4), op: at(5) };
}
