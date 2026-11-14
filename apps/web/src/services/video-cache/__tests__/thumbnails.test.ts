import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ThumbnailWorkerRequest } from "../thumbnails.worker";

// A stand-in for the decoding worker: answers every job with a fake bitmap per time, then "done".
const sent: ThumbnailWorkerRequest[] = [];
class FakeWorker {
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onerror: unknown = null;
	postMessage(message: ThumbnailWorkerRequest) {
		sent.push(message);
		if (message.type !== "job") return;
		setTimeout(() => {
			for (const time of message.times) {
				const bitmap = { width: Math.round((message.height * 9) / 16), height: message.height, time, exact: message.exact };
				this.onmessage?.({ data: { type: "frame", id: message.id, mediaId: message.mediaId, time, height: message.height, bitmap } });
			}
			this.onmessage?.({ data: { type: "done", id: message.id } });
		}, 1);
	}
}

let T: typeof import("../thumbnails");
const globals = globalThis as unknown as { window?: unknown; Worker?: unknown };
const original = { window: globals.window, Worker: globals.Worker };
beforeAll(async () => {
	globals.window = globalThis;
	globals.Worker = FakeWorker;
	T = await import("../thumbnails");
});
afterAll(() => {
	// Other test files run in this process: put the real globals back.
	globals.window = original.window;
	globals.Worker = original.Worker;
});

const file = new File([], "a.mp4");
const jobs = () => sent.filter((m): m is Extract<ThumbnailWorkerRequest, { type: "job" }> => m.type === "job");

describe("filmstrip thumbnails", () => {
	test("tiles 1 s apart or more use key frames, closer ones are exact", async () => {
		await T.getThumbnails({ mediaId: "m1", file, times: [4, 2, 6, 0], height: 112, onFrame: () => {} });
		expect(jobs().at(-1)?.exact).toBe(false);
		await T.getThumbnails({ mediaId: "m1", file, times: [10, 10.25, 9.75], height: 112, onFrame: () => {} });
		expect(jobs().at(-1)?.exact).toBe(true);
	});

	test("cached tiles come back at once and are not decoded again", async () => {
		const before = jobs().length;
		const got: number[] = [];
		await T.getThumbnails({ mediaId: "m1", file, times: [10, 10.25], height: 112, onFrame: (t) => got.push(t) });
		expect(got).toEqual([10, 10.25]);
		expect(jobs().length).toBe(before);
		expect(T.peekThumbnail("m1", 10.25, 112)).not.toBeNull();
		expect(T.peekThumbnail("m1", 10.25, 64)).toBeNull();
	});

	test("a key-frame stand-in shows at once, then the exact frame replaces it", async () => {
		const got: Array<{ t: number; exact: boolean }> = [];
		await T.getThumbnails({
			mediaId: "m1",
			file,
			times: [2, 2.25],
			height: 112,
			onFrame: (t, bmp) => got.push({ t, exact: (bmp as unknown as { exact: boolean }).exact }),
		});
		expect(got[0]).toEqual({ t: 2, exact: false });
		expect(jobs().at(-1)?.times).toEqual([2, 2.25]);
		expect((T.peekThumbnail("m1", 2, 112) as unknown as { exact: boolean }).exact).toBe(true);
	});

	test("abort resolves at once and cancels the worker job", async () => {
		const controller = new AbortController();
		const job = T.getThumbnails({ mediaId: "m2", file, times: [1, 1.5], height: 112, signal: controller.signal, onFrame: () => {} });
		controller.abort();
		await job;
		const id = jobs().at(-1)?.id;
		expect(sent.some((m) => m.type === "cancel" && m.id === id)).toBe(true);
	});

	test("pausing reaches the worker once per change", () => {
		const count = () => sent.filter((m) => m.type === "pause").length;
		const before = count();
		T.setThumbnailsPaused(true);
		T.setThumbnailsPaused(true);
		T.setThumbnailsPaused(false);
		expect(count() - before).toBe(2);
	});
});
