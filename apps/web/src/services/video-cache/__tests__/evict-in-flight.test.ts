// polish3 (11.11): the preview showed the talk's frame without the B-roll over it after a 25 s pause and a jump.
// Both layers ask their decoder at once; the main clip's request evicted the B-roll's decoder (idle > 10 s) between the
// B-roll's own ensureSink and its read, so the B-roll's request came back empty. A decoder a request is reading from
// is never closed now, and one closed under a request is opened again once.
import { describe, expect, test } from "bun:test";
import { VideoCache } from "../service";

type Fake = { key: string; input: { dispose: () => void }; iterator: null; lastUsed: number; prefetching: boolean; currentFrame: null; nextSample: null; back: null; pool: unknown[]; poolIndex: number };

function cacheWith(keys: string[], idleMs: number) {
	const disposed: string[] = [];
	const cache = new VideoCache() as unknown as {
		sinks: Map<string, Fake>;
		resolveFrame: (a: { sinkData: Fake; time: number }) => Promise<unknown>;
		initializeSink: (a: { mediaId: string }) => Promise<void>;
		getFrameAt: (a: { mediaId: string; file: File; time: number }) => Promise<{ key: string } | null>;
		trim: () => number;
	};
	const fake = (key: string): Fake => ({
		key,
		input: { dispose: () => disposed.push(key) },
		iterator: null,
		lastUsed: performance.now() - idleMs,
		prefetching: false,
		currentFrame: null,
		nextSample: null,
		back: null,
		pool: [],
		poolIndex: 0,
	});
	// the 1 s throttle of the eviction check must not hide it in a fresh process
	(cache as unknown as { lastEvictionCheck: number }).lastEvictionCheck = -1e9;
	for (const key of keys) cache.sinks.set(key, fake(key));
	// a decode takes a moment; the frame names its decoder
	cache.resolveFrame = async ({ sinkData }) => {
		await new Promise((r) => setTimeout(r, 5));
		return { key: sinkData.key, canvas: {}, timestamp: 0, duration: 1 };
	};
	const opened: string[] = [];
	cache.initializeSink = async ({ mediaId }) => {
		opened.push(mediaId);
		cache.sinks.set(mediaId, fake(mediaId));
	};
	return { cache, disposed, opened, file: {} as File };
}

describe("video cache: a decoder in use is never evicted", () => {
	test("two layers asked at once after a 25 s pause both get their frame", async () => {
		const { cache, disposed, file } = cacheWith(["talk", "broll"], 25_000);
		const [talk, broll] = await Promise.all([
			cache.getFrameAt({ mediaId: "talk", file, time: 12 }),
			cache.getFrameAt({ mediaId: "broll", file, time: 2 }),
		]);
		expect(talk?.key).toBe("talk");
		expect(broll?.key).toBe("broll");
		expect(disposed).not.toContain("broll");
	});

	test("the B-roll asked first, the talk second: still both", async () => {
		const { cache, disposed, file } = cacheWith(["talk", "broll"], 25_000);
		const [broll, talk] = await Promise.all([
			cache.getFrameAt({ mediaId: "broll", file, time: 2 }),
			cache.getFrameAt({ mediaId: "talk", file, time: 12 }),
		]);
		expect(talk?.key).toBe("talk");
		expect(broll?.key).toBe("broll");
		expect(disposed).toEqual([]);
	});

	test("an idle decoder nobody asks for is still closed (the 10 s rule stays)", async () => {
		const { cache, disposed, file } = cacheWith(["talk", "old"], 25_000);
		await cache.getFrameAt({ mediaId: "talk", file, time: 1 });
		expect(disposed).toEqual(["old"]);
	});

	test("memory pressure does not close a decoder a frame is read from", async () => {
		const { cache, disposed, file } = cacheWith(["talk", "broll"], 25_000);
		const pending = cache.getFrameAt({ mediaId: "broll", file, time: 2 });
		cache.trim();
		const broll = await pending;
		expect(broll?.key).toBe("broll");
		expect(disposed).toEqual(["talk"]);
	});

	test("a decoder closed between its opening and the read is opened again once", async () => {
		const { cache, opened, file } = cacheWith(["broll"], 0);
		const sinks = cache.sinks;
		const realGet = sinks.get.bind(sinks);
		let vanished = false;
		// the first read after ensureSink finds it gone (closed by someone else meanwhile)
		sinks.get = (key: string) => {
			if (key === "broll" && !vanished) {
				vanished = true;
				sinks.delete("broll");
				return undefined;
			}
			return realGet(key);
		};
		const broll = await cache.getFrameAt({ mediaId: "broll", file, time: 2 });
		expect(broll?.key).toBe("broll");
		expect(opened).toEqual(["broll"]);
	});
});
