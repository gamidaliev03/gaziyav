// The browser test's page (bundled with `bun build`, served on 127.0.0.1:4042): the app's OWN client
// (studio/client/api.ts: studioApi, followJob, uploadOnce) talks to /api/studio/… as on the desktop; a small fetch
// shim (the method of pubdemo's src/demo/api-shim.ts) hands those requests to the adapter; the adapter talks to the
// stand-in provider on 127.0.0.1:4041 (routed: https://<host>/<path> → http://127.0.0.1:4041/<host>/<path>).
import { followJob, type JobState, studioApi, uploadOnce } from "@/studio/client/api";
import { createWebLipsync, bridgeUploadXhr } from "../adapter";
import { saveKey } from "../key";
import { DB_NAME } from "../park";

const FAKE = "http://127.0.0.1:4041";
type Made = ReturnType<typeof createWebLipsync>;
const g = globalThis as { __gzMade?: Made; __gzNativeFetch?: typeof fetch };
const realFetch = g.__gzNativeFetch ?? window.fetch.bind(window);
// mounted by pubdemo's own shim (page-pubdemo.ts) — or by the small shim below
const made: Made = g.__gzMade ?? createWebLipsync({ route: (u) => u.replace(/^https:\/\//, `${FAKE}/`), pollMs: 150, lang: () => "ru" });
if (!g.__gzMade) {
	window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
		const path = url.origin === location.origin ? url.pathname.slice(Math.max(0, url.pathname.indexOf("/api/"))) : "";
		const method = (init?.method ?? "GET").toUpperCase();
		if (path.startsWith("/api/") && made.adapter.handles(path, method)) return made.adapter.answer(path, init, url);
		if (path.startsWith("/api/")) return Promise.resolve(new Response(JSON.stringify({ error: "in the app" }), { status: 404 }));
		return realFetch(input, init);
	}) as typeof fetch;
	bridgeUploadXhr(made.adapter);
}

/** Every state the client was shown: «stage:status:detail» lines, deduplicated in order. */
function recorder() {
	const seen: string[] = [];
	return {
		seen,
		on: (s: JobState) => {
			for (const st of s.stages) {
				const line = `${st.id}:${st.status}${st.detail ? `:${st.detail}` : ""}`;
				if (seen[seen.length - 1] !== line && !seen.includes(line)) seen.push(line);
			}
			const end = `job:${s.status}${s.error ? `:${s.error}` : ""}`;
			if (s.status !== "running" && !seen.includes(end)) seen.push(end);
		},
	};
}

async function source(): Promise<File> {
	const blob = await (await realFetch("/media/src.mp4")).blob();
	return new File([blob], "talk.mp4", { type: "video/mp4", lastModified: 1_700_000_000_000 });
}

async function dumpDb(): Promise<string> {
	const db: IDBDatabase = await new Promise((res, rej) => {
		const r = indexedDB.open(DB_NAME, 1);
		r.onsuccess = () => res(r.result);
		r.onerror = () => rej(r.error);
	});
	const all = async (store: string) => new Promise<unknown[]>((res) => {
		const q = db.transaction(store).objectStore(store).getAll();
		q.onsuccess = () => res(q.result);
	});
	const files = (await all("files")) as Array<{ id: string; name: string; type: string; blob: Blob }>;
	return JSON.stringify({ jobs: await all("jobs"), facts: await all("facts"), files: files.map((f) => ({ id: f.id, name: f.name, type: f.type, size: f.blob.size })) });
}

const h = {
	setKey: (k: string) => saveKey(k),
	async preflightEstimate(text: string) {
		return studioApi.preflight({ estimate: { seconds: 3.2, length: 3 }, voice: { chars: text.length, clone: true }, model: "fal-ai/latentsync" });
	},
	/** The golden path: the clip's voice speaks the typed words, then the lips follow on the used span. */
	async golden(text: string, start: number, length: number) {
		const clip = await source();
		const up = await uploadOnce("media:src", clip);
		const voiceRec = recorder();
		const v0 = await studioApi.startVoiceover({ source: { fileId: up.fileId, start, length: 6 - start }, text });
		const v = await followJob(v0.id, voiceRec.on);
		const vr = v.result as { fileId: string; name: string; duration: number; voiceId: string };
		const voiceFile = await studioApi.fetchFile(vr.fileId, vr.name, "audio/mpeg");
		const a = await uploadOnce("media:voice", voiceFile);
		const pf = await studioApi.preflight({ video: { fileId: up.fileId, start, length }, audioFileId: a.fileId, model: "fal-ai/latentsync" });
		const lipRec = recorder();
		const l0 = await studioApi.startLipsync({ video: { fileId: up.fileId, start, length }, audioFileId: a.fileId, model: "fal-ai/latentsync" });
		const l = await followJob(l0.id, lipRec.on);
		const lr = l.result as { fileId: string; name: string; duration: number };
		const out = await studioApi.fetchFile(lr.fileId, lr.name, "video/mp4");
		const trail = (id: string) => made.engine.counts.trail.filter((l) => l.startsWith(`${id}|`)).map((l) => l.slice(id.length + 1));
		return { upload: up, voice: { trail: trail(v0.id), states: voiceRec.seen, result: vr, cost: v.cost, file: { size: voiceFile.size, type: voiceFile.type } }, preflight: pf, lip: { trail: trail(l0.id), states: lipRec.seen, result: lr, cost: l.cost, file: { size: out.size, type: out.type, name: out.name } } };
	},
	/** Starts a lipsync and returns at once (the test reloads, cancels or fails it). */
	async startLip(start: number, length: number) {
		const clip = await source();
		const up = await uploadOnce("media:src", clip);
		const a = await uploadOnce("media:voice2", new File([await (await realFetch("/media/voice.m4a")).blob()], "voice.m4a", { type: "audio/mp4" }));
		const j = await studioApi.startLipsync({ video: { fileId: up.fileId, start, length }, audioFileId: a.fileId, model: "fal-ai/latentsync" });
		sessionStorage.setItem("gz-test-job", j.id);
		return j.id;
	},
	/** After a reload: the app's client asks for its pending job, exactly as actions.ts does. */
	async collect(id: string) {
		const rec = recorder();
		const end = await followJob(id, rec.on);
		const r = end.result as { fileId: string; name: string } | undefined;
		const file = r ? await studioApi.fetchFile(r.fileId, r.name, "video/mp4") : null;
		return { states: rec.seen, status: end.status, error: end.error, size: file?.size ?? 0, counts: made.engine.counts };
	},
	cancel: (id: string) => studioApi.cancel(id),
	counts: () => made.engine.counts,
	storageDump: async () => ({ local: JSON.stringify({ ...localStorage }), session: JSON.stringify({ ...sessionStorage }), cookie: document.cookie, db: await dumpDb() }),
};
(window as unknown as { __h: typeof h }).__h = h;
document.title = g.__gzMade ? "weblip harness ready (pubdemo shim)" : "weblip harness ready";
