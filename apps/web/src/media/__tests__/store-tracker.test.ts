import { expect, test } from "bun:test";
import { fileBeingStored, isStoring, onStored, trackStore, whenStored } from "@/media/store-tracker";

const deferred = () => {
	let resolve!: () => void;
	let reject!: (e: Error) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

test("an asset counts as being stored until its copy is written; then the listeners hear it", async () => {
	const heard: string[] = [];
	const off = onStored((id) => heard.push(id));
	const copy = deferred();
	trackStore("a1", copy.promise);
	expect(isStoring("a1")).toBe(true);
	let waited = false;
	const wait = whenStored("a1").then(() => {
		waited = true;
	});
	await tick();
	expect(waited).toBe(false);
	expect(heard).toEqual([]);
	copy.resolve();
	await wait;
	await tick();
	expect(waited).toBe(true);
	expect(isStoring("a1")).toBe(false);
	expect(heard).toEqual(["a1"]);
	off();
});

test("a failed copy ends the wait without a «stored» message; an unknown asset never waits", async () => {
	const heard: string[] = [];
	const off = onStored((id) => heard.push(id));
	const copy = deferred();
	trackStore("a2", copy.promise);
	copy.reject(new Error("disk full"));
	await whenStored("a2");
	await tick();
	expect(isStoring("a2")).toBe(false);
	expect(heard).toEqual([]);
	await whenStored("never-imported");
	off();
});

test("stored again before the first copy settled: only the newest copy ends it", async () => {
	const first = deferred();
	const second = deferred();
	trackStore("a3", first.promise);
	trackStore("a3", second.promise);
	first.resolve();
	await tick();
	await tick();
	expect(isStoring("a3")).toBe(true);
	second.resolve();
	await whenStored("a3");
	await tick();
	expect(isStoring("a3")).toBe(false);
});

test("while a copy is written, the file it is written from is at hand (a project opened meanwhile plays it)", async () => {
	const copy = deferred();
	const original = new File(["x"], "Big source.mp4");
	trackStore("a4", copy.promise, original);
	expect(fileBeingStored("a4")).toBe(original);
	copy.resolve();
	await whenStored("a4");
	await tick();
	expect(fileBeingStored("a4")).toBeUndefined();
});
