// The export waits for every cloud file it uses — library sounds and stickers: one still in the cloud comes down first,
// and without a network it keeps waiting (saying so, Cancel works) — a file never goes out with something left out. A sound the library no longer
// has at all is not waited for: it plays from the project's own copy, or the clip says «Missing» (library/missing.ts).
import { cloudPause } from "@/content/client/pause";
import { jobCenter } from "@/jobs/store";
import type { SceneTracks, TimelineElement } from "@/timeline";

const idOf = (url: string) => {
	const m = /^\/api\/library\/file\/(.+)$/.exec(url);
	return m ? decodeURIComponent(m[1]) : null;
};

const pause = (ms: number, isCancelled: () => boolean) =>
	new Promise<void>((resolve) => {
		const t0 = Date.now();
		const tick = () => (isCancelled() || Date.now() - t0 >= ms ? resolve() : setTimeout(tick, 200));
		tick();
	});

export async function waitForLibraryFiles(tracks: SceneTracks, isCancelled: () => boolean): Promise<boolean> {
	const lanes = [tracks.main, ...tracks.overlay, ...(tracks.audio ?? [])] as Array<{ elements: readonly TimelineElement[] }>;
	const ids = [
		...new Set(
			lanes.flatMap((t) => t.elements).flatMap((e) => (e.type === "audio" && e.sourceType === "library" ? [idOf(e.sourceUrl)] : [])),
		),
	].filter((id): id is string => !!id);
	// 3D emoji stickers (their 256 px PNGs are in the content cloud).
	const stickers = [
		...new Set(
			lanes.flatMap((t) => t.elements).flatMap((e) => {
				const id = e.type === "sticker" ? (e as { stickerId?: string }).stickerId ?? "" : "";
				return id.startsWith("emoji3d:") ? [`${id.slice("emoji3d:".length)}.png`] : [];
			}),
		),
	].map((file) => ({ part: "stickers/emoji3d", file }));
	if (!ids.length && !stickers.length) return true;
	// The export's own downloads go first: the background ones wait until it is done.
	cloudPause("export", true);
	for (;;) {
		if (isCancelled()) return false;
		let failed = ids.length + stickers.length;
		try {
			const post = (url: string, body: unknown) =>
				fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Studio": "1" }, body: JSON.stringify(body) }).then(
					(r) => r.json() as Promise<{ ok?: boolean; failed?: string[] }>,
				);
			const none: { ok?: boolean; failed?: string[] } = { ok: true };
			const [sounds, pictures] = await Promise.all([ids.length ? post("/api/library/ensure", { ids }) : none, stickers.length ? post("/api/content/ensure", { files: stickers }) : none]);
			if (sounds.ok && pictures.ok) return true;
			failed = (sounds.failed?.length ?? 0) + (pictures.failed?.length ?? 0);
		} catch {}
		jobCenter.update("export", { stage: `Waiting for ${failed} file${failed === 1 ? "" : "s"} to download — check the internet connection` });
		await pause(3000, isCancelled);
	}
}
