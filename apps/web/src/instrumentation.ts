// Runs once when the app's server starts.
//
// The Mac app runs this server inside an Electron utility process, whose Node
// has no WebAssembly.instantiateStreaming / compileStreaming. Turbopack uses
// them to load opencut-wasm while server-rendering the editor, so every full
// load of /editor/<id> (reload, ⌘R, renderer-crash recovery, "Restart editor")
// answered 500 "Internal Server Error" — a white screen. Buffer the response
// and use the non-streaming APIs instead.
export async function register(): Promise<void> {
	if (process.env.NEXT_RUNTIME !== "nodejs") return;
	// here stops the server rather than letting it go out directly.
	await import("./net/proxy")
		.then((m) => m.installProxy())
		.catch(() => {});
	// The fal.ai key comes from the app as a message: listen from the first moment, so no request finds it missing.
	void import("./fal/server").then((m) => m.listenForKey()).catch(() => {});
	// Share → Post: scheduled posts go out while the app runs (and the ones whose time passed while it was closed).
	if (process.env.NEXT_RUNTIME === "nodejs") void import("./share/server/posts").then((m) => m.startScheduler()).catch(() => {});
	const wasm = globalThis.WebAssembly as typeof WebAssembly & {
		instantiateStreaming?: unknown;
		compileStreaming?: unknown;
	};
	if (!wasm) return;
	const toBytes = async (source: Response | PromiseLike<Response>) =>
		(await source).arrayBuffer();
	// Bun's WebAssembly typings carry their own ImportValue union; the calls are the standard ones at run time.
	const instantiate = WebAssembly.instantiate.bind(WebAssembly) as (
		source: BufferSource,
		importObject?: WebAssembly.Imports,
	) => Promise<WebAssembly.WebAssemblyInstantiatedSource>;
	const compile = WebAssembly.compile.bind(WebAssembly) as (
		source: BufferSource,
	) => Promise<WebAssembly.Module>;
	const target = wasm as unknown as {
		instantiateStreaming: (
			source: Response | PromiseLike<Response>,
			imports?: WebAssembly.Imports,
		) => Promise<WebAssembly.WebAssemblyInstantiatedSource>;
		compileStreaming: (source: Response | PromiseLike<Response>) => Promise<WebAssembly.Module>;
	};
	if (typeof target.instantiateStreaming !== "function") {
		target.instantiateStreaming = async (
			source: Response | PromiseLike<Response>,
			imports?: WebAssembly.Imports,
		) => instantiate(await toBytes(source), imports);
	}
	if (typeof target.compileStreaming !== "function") {
		target.compileStreaming = async (source: Response | PromiseLike<Response>) =>
			compile(await toBytes(source));
	}
}
