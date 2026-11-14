import { describe, expect, test } from "bun:test";
import { decodeStoredSummary, encodeStoredSummary, storedSummaryName } from "../store";

// speed, 11.11: a waveform summary kept between sessions must come back exactly, and anything that is not a whole
// summary of this source must be refused (it is then made again).
const summary = () => ({ sampleRate: 48000, totalSamples: 1000, bucketSize: 128, amplitudes: Float32Array.from({ length: 8 }, (_, i) => i / 7) });
const bytesOf = (s: ReturnType<typeof summary>) => {
	const { header, peaks } = encodeStoredSummary(s);
	const out = new Uint8Array(header.byteLength + peaks.byteLength);
	out.set(new Uint8Array(header), 0);
	out.set(new Uint8Array(peaks.buffer, peaks.byteOffset, peaks.byteLength), header.byteLength);
	return out.buffer;
};

describe("kept waveform summaries", () => {
	test("a summary comes back bit for bit", () => {
		const back = decodeStoredSummary({ bytes: bytesOf(summary()), bucketSize: 128 });
		expect(back?.sampleRate).toBe(48000);
		expect(back?.totalSamples).toBe(1000);
		expect([...(back?.amplitudes ?? [])]).toEqual([...summary().amplitudes]);
	});
	test("a cut-off file, another bucket size, a wrong count and other bytes are refused", () => {
		const bytes = bytesOf(summary());
		expect(decodeStoredSummary({ bytes: bytes.slice(0, bytes.byteLength - 4), bucketSize: 128 })).toBeNull();
		expect(decodeStoredSummary({ bytes: bytes.slice(0, 10), bucketSize: 128 })).toBeNull();
		expect(decodeStoredSummary({ bytes, bucketSize: 256 })).toBeNull();
		expect(decodeStoredSummary({ bytes: bytesOf({ ...summary(), totalSamples: 5000 }), bucketSize: 128 })).toBeNull();
		expect(decodeStoredSummary({ bytes: new Uint8Array(64).buffer, bucketSize: 128 })).toBeNull();
	});
	test("the name carries the source, the file's size and its date: a replaced file is another summary", () => {
		const a = storedSummaryName({ sourceKey: "media:1b2c", file: { size: 10, lastModified: 5 } });
		expect(a).toBe("media_1b2c.10.5.v1.f32");
		expect(storedSummaryName({ sourceKey: "media:1b2c", file: { size: 11, lastModified: 5 } })).not.toBe(a);
		expect(storedSummaryName({ sourceKey: "media:1b2c", file: { size: 10, lastModified: 6 } })).not.toBe(a);
		const long = storedSummaryName({ sourceKey: `library:https://example.com/${"x".repeat(300)}`, file: { size: 1, lastModified: 1 } });
		expect(long.length).toBeLessThan(100);
		expect(storedSummaryName({ sourceKey: `library:https://example.com/${"x".repeat(299)}y`, file: { size: 1, lastModified: 1 } })).not.toBe(long);
	});
});
