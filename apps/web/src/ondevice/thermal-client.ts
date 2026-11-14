// The page's view of the Mac's temperature (ondevice/thermal.ts on the server): the shell reports every change the
// same way it reports memory pressure (preload: studioApp.onThermal), and the current level is asked once from
// /api/ondevice/thermal. While the Mac is hot the job list says so on every running AI task («paused until it cools
// down», with the time) and on an export (it goes on, just slower); when it cools, «continuing» for a moment.
import { create } from "zustand";

export type ThermalLevel = "nominal" | "fair" | "serious" | "critical";

export interface ThermalState {
	level: ThermalLevel;
	/** When this level began (ms since the epoch). */
	since: number;
	/** When the Mac last went from hot back to fair or nominal (the «continuing» line), null before. */
	cooledAt: number | null;
}

export const isHotLevel = (level: ThermalLevel) => level === "serious" || level === "critical";

export const useThermal = create<ThermalState>()(() => ({ level: "nominal", since: 0, cooledAt: null }));

function apply(level: ThermalLevel, since: number) {
	const s = useThermal.getState();
	if (level === s.level) return;
	useThermal.setState({ level, since, cooledAt: isHotLevel(s.level) && !isHotLevel(level) ? Date.now() : s.cooledAt });
}

const LEVELS: readonly ThermalLevel[] = ["nominal", "fair", "serious", "critical"];
const parse = (value: unknown): ThermalLevel | null => LEVELS.find((l) => l === value) ?? null;

type DesktopApp = { onThermal?: (cb: (level: string) => void) => () => void };

let watching = false;

/** Once, from the editor: the current level, then every change the shell reports. */
export function watchThermal(): void {
	if (watching || typeof window === "undefined") return;
	watching = true;
	fetch("/api/ondevice/thermal")
		.then((res) => (res.ok ? res.json() : null))
		.then((status: { level?: unknown; since?: unknown } | null) => {
			const level = parse(status?.level);
			if (level) apply(level, typeof status?.since === "number" ? status.since : Date.now());
		})
		.catch(() => {});
	(window as unknown as { studioApp?: DesktopApp }).studioApp?.onThermal?.((raw) => {
		const level = parse(raw);
		if (level) apply(level, Date.now());
	});
}
