// Remove Background shows a fast (balanced) result at once and makes the accurate copy for export in the
// background. Export waits for copies still in progress, so a file is never exported at preview quality.
import { jobCenter } from "@/jobs/store";

const pending = new Set<Promise<unknown>>();

export function trackExportQuality(work: Promise<unknown>) {
	pending.add(work);
	void work.catch(() => {}).finally(() => pending.delete(work));
}

/** Resolves true when every export-quality copy is done (or failed: export then uses the preview copy), false if cancelled. */
export async function waitForNeuralExportQuality(isCancelled: () => boolean): Promise<boolean> {
	if (pending.size === 0) return true;
	jobCenter.update("export", { stage: "Finishing AI effects at export quality" });
	while (pending.size > 0) {
		if (isCancelled()) return false;
		await Promise.race([Promise.allSettled([...pending]), new Promise((r) => setTimeout(r, 200))]);
	}
	return true;
}
