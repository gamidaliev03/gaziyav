// Every write transaction of the project store asks for strict durability (IDEAL reliable, audit #3: Chromium's
// default is "relaxed" since 121 — a power cut could take the last saves).
import { expect, test } from "bun:test";
import { IndexedDBAdapter } from "../indexeddb-adapter";

test("writes ask for { durability: 'strict' }, reads don't", async () => {
	const calls: Array<{ mode: string; options: unknown }> = [];
	const adapter = new IndexedDBAdapter({ dbName: "t-db", storeName: "t-store" }) as unknown as { getDB: () => Promise<unknown>; transaction: (m: string) => Promise<unknown> };
	adapter.getDB = async () => ({ transaction: (_s: string[], mode: string, options: unknown) => (calls.push({ mode, options }), {}) });
	await adapter.transaction("readwrite");
	await adapter.transaction("readonly");
	expect(calls[0]).toEqual({ mode: "readwrite", options: { durability: "strict" } });
	expect(calls[1].options).toBeUndefined();
});
