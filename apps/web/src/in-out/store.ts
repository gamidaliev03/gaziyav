import { create } from "zustand";

/**
 * Timeline In/Out range (Kadr / FCP marking): I sets In, O sets Out, X marks the
 * clip under the playhead, ⌥X clears both, ⌥I / ⌥O clear one, ⇧I / ⇧O go to it, «/» plays In→Out.
 *
 * Public API for other features (lipsync fragment, export range):
 *   - `useInOutStore(s => s.inPoint)` / `s.outPoint` — raw marks in media ticks (or null);
 *   - `getInOutRange({ duration })` — the effective range, or null when nothing is marked;
 *   - `useInOutStore.getState().setRange({ start, end })` / `.clear()`.
 *
 * Times are MediaTime ticks (plain numbers). Marks belong to the open project and are
 * cleared when another project is opened (`projectId`).
 */
export interface InOutRange {
	start: number;
	end: number;
}

interface InOutState {
	projectId: string | null;
	inPoint: number | null;
	outPoint: number | null;
	setIn: (params: { time: number; projectId?: string | null }) => void;
	setOut: (params: { time: number; projectId?: string | null }) => void;
	setRange: (params: InOutRange & { projectId?: string | null }) => void;
	clearIn: () => void;
	clearOut: () => void;
	clear: () => void;
}

export const useInOutStore = create<InOutState>()((set, get) => {
	/** Marks of another project are dropped before a new mark is set. */
	const base = (projectId: string | null | undefined) => {
		const state = get();
		if (projectId !== undefined && projectId !== state.projectId) {
			return { projectId, inPoint: null, outPoint: null };
		}
		return { projectId: state.projectId, inPoint: state.inPoint, outPoint: state.outPoint };
	};

	return {
		projectId: null,
		inPoint: null,
		outPoint: null,
		setIn: ({ time, projectId }) => {
			const current = base(projectId);
			const outPoint =
				current.outPoint !== null && current.outPoint <= time ? null : current.outPoint;
			set({ ...current, inPoint: Math.max(0, time), outPoint });
		},
		setOut: ({ time, projectId }) => {
			const current = base(projectId);
			const inPoint =
				current.inPoint !== null && current.inPoint >= time ? null : current.inPoint;
			set({ ...current, inPoint, outPoint: Math.max(0, time) });
		},
		setRange: ({ start, end, projectId }) => {
			const current = base(projectId);
			if (end <= start) return;
			set({ ...current, inPoint: Math.max(0, start), outPoint: end });
		},
		clearIn: () => set({ inPoint: null }),
		clearOut: () => set({ outPoint: null }),
		clear: () => set({ inPoint: null, outPoint: null }),
	};
});

/** Effective In→Out range: a missing In is the start, a missing Out is the end. */
export function resolveInOutRange({
	inPoint,
	outPoint,
	duration,
}: {
	inPoint: number | null;
	outPoint: number | null;
	duration: number;
}): InOutRange | null {
	if (inPoint === null && outPoint === null) return null;
	const start = Math.min(inPoint ?? 0, duration);
	const end = Math.min(outPoint ?? duration, duration);
	return end > start ? { start, end } : null;
}

export function getInOutRange({
	duration,
}: {
	duration: number;
}): InOutRange | null {
	const { inPoint, outPoint } = useInOutStore.getState();
	return resolveInOutRange({ inPoint, outPoint, duration });
}
