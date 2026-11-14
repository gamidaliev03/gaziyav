// Heavy tile previews (a Lottie still, a GPU thumbnail) one per animation frame, and none while a list scrolls: with
// hundreds of tiles a scroll brings dozens into view at once, and building their previews in the same frames stalled
// the scroll. The queue goes on 250 ms after the wheel or a scroll stops.

let lastScrollAt = 0;
if (typeof window !== "undefined") {
	const mark = () => {
		lastScrollAt = performance.now();
	};
	window.addEventListener("wheel", mark, { capture: true, passive: true });
	document.addEventListener("scroll", mark, { capture: true, passive: true });
}

/** Whether a list was scrolled in the last 250 ms. */
export function scrolledRecently(): boolean {
	return performance.now() - lastScrollAt < 250;
}

const queue: Array<() => unknown> = [];
let running = false;

/** Runs `job` when the lists are still, one job per frame; a job that throws never stops the queue. */
export function whenScrollIdle(job: () => unknown): void {
	queue.push(job);
	if (running) return;
	running = true;
	const run = async () => {
		if (scrolledRecently()) {
			setTimeout(() => void run(), 120);
			return;
		}
		const next = queue.shift();
		if (!next) {
			running = false;
			return;
		}
		try {
			// a preview that never settles (a stalled fetch) gives up its turn after 4 s instead of holding every other
			await Promise.race([next(), new Promise((r) => setTimeout(r, 4000))]);
		} catch {
			// a preview that fails keeps its placeholder
		}
		requestAnimationFrame(() => void run());
	};
	requestAnimationFrame(() => void run());
}
