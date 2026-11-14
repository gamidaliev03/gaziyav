// The Claude call the window is running now (the bridge sets it around each call): paid steps check this video's
// budget only for Claude's calls, and the AI layers' «[montage-error] …» lines are caught for the call that placed them.

export interface ClaudeCall {
	tool: string;
	startedAt: number;
}

// Several calls can run at once (a generation goes on in the background while Claude reads the project), so the
// running calls are a set, not one slot that a call ending out of order would reset under another.
const running = new Map<symbol, ClaudeCall>();
let ended = 0;

/** The newest of Claude's calls running now, or null. */
export const claudeCall = (): ClaudeCall | null => {
	let last: ClaudeCall | null = null;
	for (const c of running.values()) last = c;
	return last;
};

/**
 * How many of Claude's calls have ended so far. A call's own changes land as it ends (a generation places its clip
 * last), so a call that sees another one end while it runs has that call's changes inside its own undo range.
 */
export const claudeCallsEnded = () => ended;

export async function asClaude<T>(tool: string, work: () => Promise<T>): Promise<T> {
	const key = Symbol(tool);
	running.set(key, { tool, startedAt: Date.now() });
	try {
		return await work();
	} finally {
		running.delete(key);
		ended++;
	}
}

// ── what the Remotion layers report (montage/remotion/custom.tsx logs «[montage-error] …» and draws nothing) ──

const errors: Array<{ at: number; text: string }> = [];
let hooked = false;

export function watchLayerErrors() {
	if (hooked || typeof window === "undefined") return;
	hooked = true;
	const original = console.error.bind(console);
	console.error = (...args: unknown[]) => {
		const first = args[0];
		if (typeof first === "string" && first.startsWith("[montage-error]")) {
			errors.push({ at: Date.now(), text: first.slice(16).trim() });
			if (errors.length > 50) errors.shift();
		}
		original(...args);
	};
}

/** The layer errors since `since` (ms), about `name` when given. */
export function layerErrorsSince(since: number, name?: string): string[] {
	return [...new Set(errors.filter((e) => e.at >= since && (!name || e.text.includes(name))).map((e) => e.text))];
}
