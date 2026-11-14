// The browser edition's answers to the app's generation client (cloud/client.ts → /api/cloud/…), in the shape of the
// static edition's BrowserAi: the same JSON the Mac app's server sends (app/api/cloud/[...path]/route.ts), made by the
// engine beside this file. The app's AI image / AI video views stay exactly as they are.
import { isVideoMode } from "@/fal/video";
import type { WebAiAdapter } from "../lipsync/adapter";
import { GenerateError, type GenerateInput, type Generator, type Kind } from "./engine";

const ROUTES: Array<[string, RegExp]> = [
	["GET", /^\/api\/cloud\/status$/],
	["GET", /^\/api\/cloud\/models\/(image|video|audio)$/],
	["POST", /^\/api\/cloud\/estimate$/],
	["POST", /^\/api\/cloud\/generate$/],
	["POST", /^\/api\/cloud\/cancel\/[\w-]+$/],
	["GET", /^\/api\/cloud\/job\/[\w-]+$/],
	["GET", /^\/api\/cloud\/file\/[\w-]+\/\d+$/],
	["POST", /^\/api\/cloud\/reference$/],
];

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const kindOf = (v: string | null): Kind => (v === "video" || v === "audio" ? v : "image");

async function body<T>(init: RequestInit | undefined): Promise<T> {
	const b = init?.body;
	return (typeof b === "string" ? JSON.parse(b) : b instanceof Blob ? JSON.parse(await b.text()) : {}) as T;
}

/** The bytes of a reference as the client sends them (raw, with its type in the query). */
async function bytes(init: RequestInit | undefined, type: string): Promise<Blob | null> {
	const b = init?.body;
	if (b instanceof Blob) return b.type ? b : new Blob([b], { type });
	if (b instanceof ArrayBuffer) return new Blob([b], { type });
	if (ArrayBuffer.isView(b)) return new Blob([b as ArrayBufferView<ArrayBuffer>], { type });
	return null;
}

export interface AdapterDeps {
	/** A file the page already holds (an id of /api/studio/upload). */
	fileOfUpload?: (id: string) => Promise<Blob | undefined>;
	/** The piece of a clip or a sound a reference is («from» and «length» seconds), cut in the page. */
	cut?: (blob: Blob, kind: Kind, from: number, length: number) => Promise<Blob>;
}

export function createGenerateAdapter(engine: Generator, { fileOfUpload, cut }: AdapterDeps = {}): WebAiAdapter {
	return {
		handles: (path, method) => ROUTES.some(([m, re]) => m === method.toUpperCase() && re.test(path.split("?")[0])),
		async answer(path, init, url) {
			const method = (init?.method ?? "GET").toUpperCase();
			const tail = path.split("?")[0].split("/").slice(3);
			try {
				if (tail[0] === "status") return json(engine.status());
				if (tail[0] === "models") {
					const mode = url.searchParams.get("mode") ?? undefined;
					const named = url.searchParams.get("model");
					const list = engine.models(kindOf(tail[1]), mode);
					return json(named && isVideoMode(mode) ? { ...list, resolved: engine.resolveVideoModel(named, mode) } : list);
				}
				if (tail[0] === "estimate") return json(await engine.estimate(await body<GenerateInput>(init)));
				if (tail[0] === "generate") return json(await engine.generate(await body<GenerateInput>(init)));
				if (tail[0] === "cancel" && method === "POST") return json({ cancelled: await engine.cancel(tail[1]) });
				if (tail[0] === "job") {
					const view = await engine.job(tail[1]);
					return view ? json(view) : json({ error: "This generation is no longer known in this browser." }, 404);
				}
				if (tail[0] === "file") {
					const file = await engine.file(tail[1], Number(tail[2]));
					return file ? new Response(file.blob, { headers: { "Content-Type": file.type || "application/octet-stream" } }) : json({ error: "The file is no longer in this browser." }, 404);
				}
				if (tail[0] === "reference") {
					const kind = kindOf(url.searchParams.get("kind"));
					const type = url.searchParams.get("type") || "application/octet-stream";
					// (?fileId=<a file of /api/studio/upload>: a clip or a sound the page already holds)
					const held = url.searchParams.get("fileId");
					const whole = held ? await fileOfUpload?.(held) : await bytes(init, type);
					if (!whole) return json({ error: "The file didn't arrive. Pick it again." }, 400);
					const from = Number(url.searchParams.get("from"));
					const length = Number(url.searchParams.get("length"));
					const blob = cut && kind !== "image" && Number.isFinite(from) && length > 0 ? await cut(whole, kind, Math.max(0, from), length) : whole;
					return json(await engine.reference(blob, kind, `reference.${(type.split("/")[1] ?? "bin").replace("jpeg", "jpg").replace("mpeg", "mp3")}`));
				}
				return json({ error: "not here" }, 404);
			} catch (error) {
				return json({ error: error instanceof GenerateError ? error.message : (error as Error)?.message || "The generator didn't answer." }, 400);
			}
		},
	};
}

/** Two adapters as one: each request goes to the one that answers it (lipsync and generation share the page's AI seam). */
export function joinAdapters(...parts: WebAiAdapter[]): WebAiAdapter {
	const of = (path: string, method: string) => parts.find((p) => p.handles(path, method));
	const panel = parts.find((p) => p.panel)?.panel;
	return {
		handles: (path, method) => !!of(path, method),
		answer: (path, init, url) => (of(path, (init?.method ?? "GET").toUpperCase()) ?? parts[0]).answer(path, init, url),
		...(panel ? { panel } : {}),
	};
}
