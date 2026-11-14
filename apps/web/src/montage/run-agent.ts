// The AI Composition agent from the editor: start a run on the app's server, follow its log, get the plan. Shared by
// the composition bar and the Text tab's own presets (the same agent designs a plate to keep).
import { buildDefaultParamValues } from "@/params/registry";
import type { PropValue } from "./types";

const HEADERS = { "Content-Type": "application/json", "X-Studio": "1" };

export async function api<T>(path: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
	let res: Response;
	try {
		res = await fetch(`/api/montage/${path}`, { ...init, headers: HEADERS, signal });
	} catch (error) {
		if ((error as Error)?.name === "AbortError") throw error;
		throw new Error("Gaziyav's local server is not responding. Restart Gaziyav.");
	}
	const data = await res.json().catch(() => null);
	if (!res.ok) throw new Error(data?.error || `Request failed (${res.status}). Try again.`);
	return data as T;
}

export interface PlanResult {
	comment: string;
	mode: "quick" | "full";
	layers: { id?: string; kind: string; from: number; to: number; props: Record<string, PropValue> }[];
	sfx: { at: number; file?: string; id?: string; name?: string; dur?: number }[];
	calls: number;
	keep?: string[];
	plan?: string;
	original?: { id: string; action: "hide" | "remove" }[];
	question?: { text: string; options: string[]; action?: "add-image"; query?: string };
}

interface RunState {
	id: string;
	status: "running" | "done" | "failed" | "cancelled";
	mode?: "quick" | "full";
	log: { at: number; text: string }[];
	result?: PlanResult;
	error?: string;
}

const wait = (ms: number, signal: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		const t = setTimeout(resolve, ms);
		signal.addEventListener("abort", () => (clearTimeout(t), reject(new DOMException("Cancelled", "AbortError"))), { once: true });
	});

/** Starts the agent on the app's server and follows its log until it is done (Cancel stops it there too). */
export async function runAgent(body: unknown, signal: AbortSignal, onLog: (lines: string[], mode?: string) => void): Promise<PlanResult> {
	const start = await api<RunState>("agent", { method: "POST", body: JSON.stringify(body) }, signal);
	const stop = () => void fetch(`/api/montage/runs/${start.id}`, { method: "DELETE", headers: HEADERS }).catch(() => {});
	signal.addEventListener("abort", stop, { once: true });
	try {
		let misses = 0;
		for (;;) {
			await wait(450, signal);
			let state: RunState;
			try {
				state = await api<RunState>(`runs/${start.id}`, { method: "GET" }, signal);
				misses = 0;
			} catch (error) {
				if (signal.aborted) throw error;
				if (++misses >= 6) throw error;
				continue;
			}
			onLog(state.log.map((l) => l.text), state.mode);
			if (state.status === "done" && state.result) return state.result;
			if (state.status === "cancelled") throw new DOMException("Cancelled", "AbortError");
			if (state.status === "failed") throw new Error(state.error || "Gaziyav AI couldn't finish the composition. Try again.");
		}
	} finally {
		signal.removeEventListener("abort", stop);
	}
}

/** Position/size defaults of a kit kind; never its placeholder content ("Main idea", "Tap the link"…). */
export function layoutDefaults(fields: Parameters<typeof buildDefaultParamValues>[0]): Record<string, PropValue> {
	const all = buildDefaultParamValues(fields) as Record<string, PropValue>;
	const out: Record<string, PropValue> = {};
	for (const f of fields) if (f.type === "number" || f.type === "boolean" || f.type === "select") if (!["value", "newPrice", "oldPrice"].includes(f.key)) out[f.key] = all[f.key];
	return out;
}
