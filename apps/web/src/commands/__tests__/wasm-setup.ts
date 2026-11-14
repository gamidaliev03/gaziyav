import { mock } from "bun:test";
import { createRequire } from "node:module";

/**
 * bun cannot import the bundler-style `opencut-wasm` entry (it imports the
 * .wasm file as an ES module). Instantiate the same binary by hand and hand
 * the bindings to every importer of "opencut-wasm".
 */
export function installOpenCutWasm(): Promise<void> {
	// One instance per test process: a second one would receive the first one's objects when the garbage collector
	// frees them (wasm-bindgen finalizers), corrupt its memory and trap ("Unreachable") in a later test file.
	const g = globalThis as { __openCutWasm?: Promise<void> };
	g.__openCutWasm ??= instantiate();
	return g.__openCutWasm;
}

async function instantiate(): Promise<void> {
	const require = createRequire(import.meta.url);
	const entry = require.resolve("opencut-wasm");
	const dir = entry.slice(0, entry.lastIndexOf("/"));
	const bindings = await import(`${dir}/opencut_wasm_bg.js`);
	const bytes = await Bun.file(`${dir}/opencut_wasm_bg.wasm`).arrayBuffer();
	const { instance } = await WebAssembly.instantiate(bytes, {
		"./opencut_wasm_bg.js": bindings,
	});
	bindings.__wbg_set_wasm(instance.exports);
	const start = (instance.exports as Record<string, unknown>).__wbindgen_start;
	if (typeof start === "function") {
		start();
	}
	mock.module("opencut-wasm", () => bindings);
}
