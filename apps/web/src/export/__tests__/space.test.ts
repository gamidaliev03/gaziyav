import { describe, expect, test } from "bun:test";
import { diskWriter } from "../disk";
import { isDiskFull, shortBytes, sizeText, whileDiskIsFull } from "../space";

const enospc = () => new Error("Error invoking remote method 'studio:export-file-write': Error: ENOSPC: no space left on device, write");

describe("a full disk in an export", () => {
	test("is recognised whoever reports it", () => {
		expect(isDiskFull(enospc())).toBe(true);
		expect(isDiskFull(new Error("av_interleaved_write_frame(): No space left on device"))).toBe(true);
		expect(isDiskFull("QuotaExceededError")).toBe(true);
		expect(isDiskFull(new Error("The folder «Exports» isn't there any more."))).toBe(false);
		expect(isDiskFull(undefined)).toBe(false);
	});
	test("how much is missing: what is left to write, less what is free, never less than the piece that failed", () => {
		// 1 GB export, 400 MB written, 100 MB free: 600 MB left (+5 % and 32 MB of air) − 100 MB
		expect(shortBytes({ totalBytes: 1_000_000_000, writtenBytes: 400_000_000, freeBytes: 100_000_000 })).toBe(Math.round(600_000_000 * 1.05) + 32 * 1024 * 1024 - 100_000_000);
		// the estimate was too small (everything it promised is written): the air, or the piece that failed when it is larger
		expect(shortBytes({ totalBytes: 1_000_000, writtenBytes: 5_000_000, freeBytes: 0, chunkBytes: 16_000_000 })).toBe(32 * 1024 * 1024);
		expect(shortBytes({ totalBytes: 1_000_000, writtenBytes: 5_000_000, freeBytes: 0, chunkBytes: 64_000_000 })).toBe(64_000_000);
		expect(shortBytes({ totalBytes: 1, writtenBytes: 0, freeBytes: null })).toBe(null);
		expect(sizeText(1_250_000_000)).toBe("1.3 GB");
		expect(sizeText(48_200_000)).toBe("48 MB");
		expect(sizeText(640_000)).toBe("640 KB");
	});
	test("the export waits and goes on by itself when the space is back", async () => {
		let tries = 0;
		const said: boolean[] = [];
		const value = await whileDiskIsFull(
			async () => {
				if (++tries < 4) throw enospc();
				return "written";
			},
			{ onWaiting: (waiting) => void said.push(waiting), retryMs: 1 },
		);
		expect(value).toBe("written");
		expect(tries).toBe(4);
		expect(said).toEqual([true, true, true, false]);
	});
	test("another failure is not waited on; Cancel ends the wait", async () => {
		let tries = 0;
		await expect(
			whileDiskIsFull(
				async () => {
					tries++;
					throw new Error("EIO: i/o error, write");
				},
				{ onWaiting: () => {}, retryMs: 1 },
			),
		).rejects.toThrow("EIO");
		expect(tries).toBe(1);
		let cancelled = false;
		const waiting = whileDiskIsFull(() => Promise.reject(enospc()), { onWaiting: () => {}, isCancelled: () => cancelled, retryMs: 20 });
		setTimeout(() => {
			cancelled = true;
		}, 30);
		await expect(waiting).rejects.toThrow("ENOSPC");
	});
	test("the file's writer: the same piece at the same place until it is written, with the free bytes said", async () => {
		const writes: Array<[number, number]> = [];
		let full = 2;
		const waits: Array<number | null> = [];
		const writer = diskWriter({
			id: "x1",
			app: {
				write: async (_id, position, data) => {
					if (position === 16 && full-- > 0) throw enospc();
					writes.push([position, data.byteLength]);
				},
				space: async () => ({ freeBytes: 1234 }),
			},
			onWaiting: (state) => waits.push(state ? state.freeBytes : null),
		});
		await writer.write(0, new Uint8Array(16));
		const started = Date.now();
		await writer.write(16, new Uint8Array(8));
		expect(writes).toEqual([
			[0, 16],
			[16, 8],
		]);
		expect(waits).toEqual([1234, 1234, null]);
		expect(Date.now() - started).toBeGreaterThan(1000);
	}, 20000);
});
