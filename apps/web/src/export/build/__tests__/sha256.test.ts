import { describe, expect, test } from "bun:test";
import { sha256 } from "../sha256";

const subtle = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer))].map((b) => b.toString(16).padStart(2, "0")).join("");

describe("sha256", () => {
	test("the known answers", () => {
		expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
		expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
		expect(sha256("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
	});
	test("the same as the browser's own, at every length around a block's edge and for Russian text", async () => {
		for (const length of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 131072]) {
			const bytes = new Uint8Array(length);
			for (let i = 0; i < length; i++) bytes[i] = (i * 31 + length) & 255;
			expect(sha256(bytes)).toBe(await subtle(bytes));
		}
		const text = "Сцена 12 — финал, дубль 3 🎬";
		expect(sha256(text)).toBe(await subtle(new TextEncoder().encode(text)));
	});
});
