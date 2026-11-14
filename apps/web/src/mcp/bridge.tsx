"use client";

// The window's end of the Claude connection: takes Claude's tool calls from the app's server (a long poll), runs them (run.ts: the listed tools and every older name, with Gaziyav AI's tools underneath, so a call
// edits, undoes and saves exactly like the agent and the buttons) and posts the answer back. While a long call runs it
// tells the server what is happening (the job center's line), so Claude sees progress. Mounted on the projects page
// and in the editor; it never takes the focus or opens anything on screen by itself.
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { t } from "@/i18n";
import { EditorCore } from "@/core";
import { useJobsStore } from "@/jobs/store";
import { agentFeed } from "@/agentview/feed";
import { CONTENT_TOOL_SPECS } from "./content-tools";
import { watchLayerErrors } from "./context";
import { EDIT_TOOL_SPECS } from "./edit-tools";
import { PROJECT_TOOL_SPECS } from "./project-tools";
import { callLabel } from "./compact";
import { runMcp } from "./run";
import { laneOf, navigates, SURFACE, UNLISTED } from "./surface";

const HEADERS = { "X-Studio": "1", "Content-Type": "application/json" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Call {
	id: string;
	tool: string;
	args: Record<string, unknown>;
	/** The project Claude worked in last (another one open now: its edits are refused, its reads say so). */
	expect?: { id: string; name: string };
}

const post = (route: string, body: unknown) =>
	fetch(`/api/mcp/${route}`, { method: "POST", headers: HEADERS, body: JSON.stringify(body) }).catch(() => null);

/** The job center's running line (captions, lipsync, export…): what Claude's long call is doing now. */
function progressNow(since: number): { stage?: string; progress?: number } {
	const running = useJobsStore
		.getState()
		.jobs.filter((j) => j.status === "running" && j.startedAt >= since - 1000)
		.sort((a, b) => b.startedAt - a.startedAt)[0];
	if (!running) return {};
	return { stage: [running.title, running.stage].filter(Boolean).join(" · ").slice(0, 120), ...(typeof running.progress === "number" ? { progress: Math.max(0, Math.min(1, running.progress)) } : {}) };
}

/** Once per profile, on the projects page: Claude is on this Mac but not connected → one quiet toast with Connect. */
async function offerClaude() {
	try {
		if (localStorage.getItem(OFFER_KEY)) return;
		const { claudeStatusNow, connectClaude } = await import("./claude-section");
		const s = (await claudeStatusNow()) as { offer?: boolean } | null;
		if (!s?.offer) return;
		localStorage.setItem(OFFER_KEY, "1");
		toast(t("Claude can edit your videos in Gaziyav."), {
			duration: 12_000,
			action: { label: t("Connect"), onClick: () => void connectClaude().then((r) => toast(r.next.map((line) => t(line)).join(" "))).catch((e) => toast.error((e as Error).message)) },
		});
	} catch {}
}

const OFFER_KEY = "gaziyav-claude-offer";

// The lanes (surface.ts): long steps and plain reads run beside everything; changes and the player's frames run one at
// a time, and wait for a render in progress, which reads the timeline as it goes. While one of those runs the window
// still takes the background ones (a project read never waits behind an edit waiting for an export), and while a call
// that goes to another project runs it takes nothing (the next call must see the project it opened).
const RENDERS = new Set(["export", "post"]);
export const runsInBackground = (tool: string, args: Record<string, unknown>) => laneOf(tool, args) === "background";

export function McpBridge({ page }: { page: "editor" | "projects" }) {
	const router = useRouter();
	useEffect(() => {
		const stop = new AbortController();
		const renders = new Set<Promise<void>>();
		const loop = async () => {
			const agent = await import("@/agent/tools");
			watchLayerErrors();
			if (page === "editor") (await import("./run")).watchHistory();
			// Listed: the few strong tools, and any tool of Gaziyav AI that no listed one covers (the hearing tools…).
			const listed = new Set<string>(SURFACE.map((t) => t.name));
			const extra = agent.TOOL_SPECS.map((t) => t.function).filter((f) => !UNLISTED.has(f.name) && !listed.has(f.name));
			const tools = [...SURFACE, ...extra];
			const legacy = [...PROJECT_TOOL_SPECS, ...CONTENT_TOOL_SPECS, ...EDIT_TOOL_SPECS, ...agent.TOOL_SPECS.map((t) => t.function)];
			await post("hello", { tools, legacy, page });
			if (page === "projects") void offerClaude();
			let foreground: Promise<void> | null = null;
			let moving = false;
			while (!stop.signal.aborted) {
				const active = EditorCore.getInstance().project.getActiveOrNull();
				// The editor takes calls only once its project is loaded (open → get_project must see it).
				if ((page === "editor" && !active) || moving) {
					await sleep(150);
					continue;
				}
				let call: Call | null = null;
				try {
					// (while a change runs: only calls that run beside it, in short polls, so the next change starts soon after)
					const q = new URLSearchParams({ page, project: active?.metadata.id ?? "", lanes: foreground ? "background" : "all", wait: foreground ? "1000" : "25000" });
					const res = await fetch(`/api/mcp/next?${q}`, { headers: HEADERS, signal: stop.signal });
					if (res.status === 204) continue;
					if (!res.ok) {
						await sleep(2000);
						continue;
					}
					call = (await res.json()) as Call;
				} catch {
					if (stop.signal.aborted) return;
					await sleep(1000);
					continue;
				}
				const run = async (c: Call, waitFor?: () => Promise<unknown>) => {
					const t0 = Date.now();
					// Stopped by the user (Stop in Claude) or by Claude (status {cancel}): this call's own signal.
					const own = new AbortController();
					let state: "waiting" | "running" = waitFor ? "waiting" : "running";
					const reason = () => (own.signal.reason as Error)?.message || "stopped";
					// (the editor's «Claude at work»: the pill and the card hear of every call here)
					agentFeed.started(c, own, !!waitFor);
					const beat = setInterval(async () => {
						const res = await post("alive", { id: c.id, ...(state === "waiting" ? { stage: "waiting" } : progressNow(t0)) });
						const said = (await res?.json().catch(() => null)) as { cancel?: string } | null;
						if (said?.cancel && !own.signal.aborted) own.abort(new DOMException(said.cancel, "AbortError"));
					}, 3000);
					let out: Awaited<ReturnType<typeof runMcp>>;
					try {
						if (waitFor) await Promise.race([waitFor(), new Promise((r) => own.signal.addEventListener("abort", r, { once: true }))]);
						state = "running";
						agentFeed.running(c.id);
						if (own.signal.aborted) out = { ok: false, content: `Not run: ${callLabel(c.tool, c.args ?? {})} was stopped (${reason()}) before it started; nothing was charged.` };
						else out = await runMcp(c.tool, c.args ?? {}, { page, agent, signal: AbortSignal.any([stop.signal, own.signal]), expect: c.expect });
					} catch (error) {
						out = { ok: false, content: own.signal.aborted ? `Stopped: ${callLabel(c.tool, c.args ?? {})} (${reason()}) after ${Math.round((Date.now() - t0) / 1000)} s. What it changed before it stopped stays (undo takes it back).` : `Error: ${(error as Error).message || String(error)}` };
					} finally {
						clearInterval(beat);
					}
					if (own.signal.aborted && out.ok) out = { ...out, content: `Stopped (${reason()}): ${out.content}` };
					// The project Claude works in now: the one this call opened (it goes there next), else the one open.
					const pm = EditorCore.getInstance().project;
					const opened = out.ok && out.navigate ? /\/editor\/([^/?#]+)/.exec(out.navigate)?.[1] : undefined;
					const open = pm.getActiveOrNull();
					const project = opened ? { id: opened, name: pm.getSavedProjects?.().find((x) => x.id === opened)?.name ?? "" } : open && page === "editor" ? { id: open.metadata.id, name: open.metadata.name } : null;
					out = agentFeed.finished(c, out, { landed: project, ...(own.signal.aborted ? { stopped: reason() } : {}) });
					await post("done", { id: c.id, ok: out.ok, content: out.content, images: out.images, ...(project ? { project } : {}) });
					// Keep taking calls: going to another project may keep this page mounted (/editor/a → /editor/b).
					if (out.navigate) router.push(out.navigate);
					// From the projects page into an editor this page goes away: it takes nothing more (the next call —
					// sent right after «Created project… it is opening now» — used to be taken here, before the editor was
					// there, and answered «No project is open»). The editor's own bridge takes it once the project is loaded.
					if (out.ok && out.navigate && page === "projects" && /\/editor\//.test(out.navigate)) {
						await new Promise<void>((resolve) => {
							const t = setTimeout(resolve, 20_000);
							stop.signal.addEventListener(
								"abort",
								() => {
									clearTimeout(t);
									resolve();
								},
								{ once: true },
							);
						});
					}
				};
				if (runsInBackground(call.tool, call.args ?? {})) {
					const job = run(call);
					if (RENDERS.has(call.tool)) {
						renders.add(job);
						void job.finally(() => renders.delete(job));
					}
					continue;
				}
				moving = navigates(call.tool, call.args ?? {});
				const waitFor = renders.size ? () => Promise.allSettled([...renders]) : undefined;
				foreground = run(call, waitFor).finally(() => {
					foreground = null;
					moving = false;
				});
			}
		};
		void loop();
		return () => stop.abort();
	}, [page, router]);
	return null;
}
