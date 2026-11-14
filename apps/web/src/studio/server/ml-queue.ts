// One heavy on-device model at a time — pictures, music, voices, face swap, lipsync. They share the GPU and the
// unified memory: two at once make an 8–16 GB Mac swap and everything (the editor too) crawls. The rest waits its turn,
// and a model kept warm for its next job (warm.ts) leaves first — unless it is the one this job uses (`keep`).
import { evictWarm } from "./warm";

let tail: Promise<unknown> = Promise.resolve();
/** Heavy jobs running or waiting their turn. */
let queued = 0;

export function heavy<T>(work: () => Promise<T>, keep?: string): Promise<T> {
	const start = () => {
		evictWarm(keep);
		return work();
	};
	queued++;
	const next = tail.then(start, start);
	tail = next.catch(() => undefined);
	void tail.then(() => queued--);
	return next;
}

/** No heavy model at work or waiting: room to load one ahead of time (warm.ts prewarm). */
export const heavyIdle = () => queued === 0;
