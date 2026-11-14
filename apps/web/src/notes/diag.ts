// never content: page errors and unhandled rejections (message, stack, route — redacted by the shell), long tasks over
// 200 ms counted per minute, failed jobs (kind, a short reason), the ring of action names. Batched: at most one send a
// second, no send while nothing happens; a repeated error is counted, not sent again.
import { hasFreshActions, setKindsReader, takeActions } from "./diag-actions";

type Send = (batch: unknown[]) => void;
const sender = (): Send | null => (window as unknown as { studioApp?: { diag?: Send } }).studioApp?.diag ?? null;

const route = () => location.pathname;

export function startDiagnostics(): () => void {
	const send = sender();
	if (!send) return () => {};
	const queue: unknown[] = [];
	let core: { peekInstance(): unknown } | null = null;
	const errors = new Map<string, { k: string; msg: string; stack: string; route: string; n: number }>();
	let stall: { minute: number; n: number; longest: number } | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const flush = () => {
		timer = null;
		for (const e of errors.values()) queue.push(e);
		errors.clear();
		const minute = Math.floor(Date.now() / 60000);
		if (stall && stall.minute < minute) {
			queue.push({ k: "stalls", minute: new Date(stall.minute * 60000).toISOString(), n: stall.n, longest: stall.longest });
			stall = null;
		}
		const actions = takeActions();
		if (actions.length) queue.push({ k: "actions", list: actions });
		if (queue.length) send(queue.splice(0));
		if (stall) schedule((stall.minute + 1) * 60000 - Date.now() + 50);
	};
	const schedule = (ms = 1000) => {
		if (!timer) timer = setTimeout(flush, Math.max(0, ms));
	};

	// the open project's name and its media's names out of a message, before it leaves the page (the shell then takes
	// out paths, file names, quoted and non-Latin text)
	const scrub = (text: string): string => {
		const editor = core?.peekInstance() as { project: { getActiveOrNull(): { metadata: { name?: string } } | null }; media: { getAssets(): { name?: string }[] } } | null | undefined;
		if (!editor) return text;
		const names = [editor.project.getActiveOrNull()?.metadata.name, ...editor.media.getAssets().slice(0, 300).map((a) => a.name)].filter((n): n is string => !!n && n.length >= 3);
		let out = text;
		for (const n of names.sort((a, b) => b.length - a.length)) out = out.split(n).join("<name>");
		return out;
	};
	const error = (k: string, err: unknown, fallback: string) => {
		const e = err as { message?: unknown; stack?: unknown } | null;
		let msg = String((e && typeof e === "object" ? e.message : err) ?? fallback).slice(0, 500);
		let stack = String((e && typeof e === "object" ? e.stack : "") ?? "").slice(0, 2000);
		try {
			msg = scrub(msg);
			stack = scrub(stack);
		} catch {}
		const key = `${k}\u0000${msg}`;
		const had = errors.get(key);
		if (had) had.n++;
		else errors.set(key, { k, msg, stack, route: route(), n: 1 });
		schedule();
	};
	const onError = (ev: ErrorEvent) => {
		if (/ResizeObserver loop/.test(ev.message || "")) return;
		error("page-error", ev.error ?? ev.message, "error");
	};
	const onRejection = (ev: PromiseRejectionEvent) => error("rejection", ev.reason, "rejection");
	window.addEventListener("error", onError);
	window.addEventListener("unhandledrejection", onRejection);

	let observer: PerformanceObserver | null = null;
	try {
		observer = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				if (entry.duration <= 200) continue;
				const minute = Math.floor(Date.now() / 60000);
				if (stall && stall.minute !== minute) flush();
				stall ??= { minute, n: 0, longest: 0 };
				stall.n++;
				stall.longest = Math.max(stall.longest, Math.round(entry.duration));
				schedule((minute + 1) * 60000 - Date.now() + 50);
			}
		});
		observer.observe({ type: "longtask", buffered: false });
	} catch {}

	// the action ring: the selected elements' kinds, read only once the editor is loaded
	setKindsReader(() => {
		if (!core) {
			if (location.pathname.startsWith("/editor")) void import("@/core").then((m) => (core = m.EditorCore)).catch(() => {});
			return undefined;
		}
		const editor = core.peekInstance() as {
			selection: { getSelectedElements(): { trackId: string; elementId: string }[] };
			scenes: { getActiveSceneOrNull(): { tracks: { main: { id: string; elements: { id: string; type: string }[] }; overlay: { id: string; elements: { id: string; type: string }[] }[]; audio: { id: string; elements: { id: string; type: string }[] }[] } } | null };
		} | null;
		const refs = editor?.selection.getSelectedElements() ?? [];
		if (!refs.length) return undefined;
		const tracks = editor?.scenes.getActiveSceneOrNull()?.tracks;
		if (!tracks) return undefined;
		const all = [tracks.main, ...tracks.overlay, ...tracks.audio];
		const kinds = new Set<string>();
		for (const r of refs.slice(0, 8)) {
			const el = all.find((t) => t.id === r.trackId)?.elements.find((e) => e.id === r.elementId);
			if (el) kinds.add(String(el.type));
		}
		return [...kinds];
	});
	// actions arrive by themselves: send them at most once a second
	const actionTick = setInterval(() => {
		if (hasFreshActions()) schedule(0);
	}, 1000);

	// failed jobs (src/jobs/store.ts publishes its store on window when it loads)
	const failed = new Set<string>();
	let unsubscribeJobs: (() => void) | null = null;
	const watchJobs = () => {
		if (unsubscribeJobs) return;
		const jobs = (window as unknown as { __studioJobs?: { store: { subscribe(fn: (s: { jobs: { id: string; kind: string; status: string; message?: string }[] }) => void): () => void } } }).__studioJobs;
		if (!jobs) return;
		unsubscribeJobs = jobs.store.subscribe((s) => {
			for (const j of s.jobs) {
				if (j.status !== "error" || failed.has(j.id)) continue;
				failed.add(j.id);
				queue.push({ k: "job-failed", job: j.kind, reason: scrub(String(j.message ?? "").slice(0, 300)) });
				schedule();
			}
		});
	};
	const jobTick = setInterval(watchJobs, 5000);
	watchJobs();

	const onHide = () => flush();
	window.addEventListener("pagehide", onHide);
	return () => {
		window.removeEventListener("error", onError);
		window.removeEventListener("unhandledrejection", onRejection);
		window.removeEventListener("pagehide", onHide);
		observer?.disconnect();
		clearInterval(actionTick);
		clearInterval(jobTick);
		unsubscribeJobs?.();
		setKindsReader(null);
		if (timer) clearTimeout(timer);
		flush();
	};
}
