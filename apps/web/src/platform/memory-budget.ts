// One owner for the memory of every cache that holds decoded media (perf round B, 14.11: «it runs on an 8 GB Air»).
// Each cache — the preview's decoders, their frames kept for playing backwards, the filmstrip's frames, the waveforms,
// the decoded sound — registers here with what it holds now and how to let go of the least recently used part. Its
// limit comes from this machine's memory (platform/hardware.ts: an 8 GB Mac «base» gets the small column, 16 GB
// «standard» what the editor always had) and from the moment: in the background half, while macOS says memory is
// short a quarter (warning) or the floor (critical) — and on the signal itself everything drops to the floor at once.
// Nothing dropped is lost: each cache makes it again when it is shown. The signal is the shell's one channel
// window.__studioMemory.signal(level) and pretend «8 GB» with STUDIO_HW_TIER=base (or __studioMemory.tier("base")).
import type { HardwareTier } from "./hardware";
import { hardwareInfo, hardwareTier, onHardware, rememberHardware } from "./hardware-client";
import { onMemoryPressure, onPressureLevel } from "./memory-pressure";

export type CacheName = "video.decoders" | "video.back" | "thumbnails" | "waveforms" | "audio.decoded" | "audio.prepared";
export type BudgetLevel = "normal" | "background" | "warning" | "critical";

type Spec = { unit: "count" | "bytes"; base: number; standard: number; pro: number; floor: number; what: string };
const MB = 1 << 20;

export const BUDGETS: Record<CacheName, Spec> = {
	"video.decoders": { unit: "count", base: 3, standard: 6, pro: 8, floor: 2, what: "open video decoders (3 frame canvases each)" },
	"video.back": { unit: "bytes", base: 64 * MB, standard: 192 * MB, pro: 256 * MB, floor: 0, what: "frames kept for playing backwards, per decoder" },
	thumbnails: { unit: "bytes", base: 32 * MB, standard: 64 * MB, pro: 128 * MB, floor: 0, what: "filmstrip frames" },
	waveforms: { unit: "bytes", base: 16 * MB, standard: 64 * MB, pro: 128 * MB, floor: 0, what: "waveform peaks" },
	"audio.decoded": { unit: "bytes", base: 128 * MB, standard: 512 * MB, pro: 1024 * MB, floor: 0, what: "whole decoded sound (retimed clips)" },
	"audio.prepared": { unit: "bytes", base: 64 * MB, standard: 256 * MB, pro: 512 * MB, floor: 0, what: "retimed clip sound" },
};

/** The share of the tier's budget each moment allows (never below the floor). */
export const LEVEL_SCALE: Record<BudgetLevel, number> = { normal: 1, background: 0.5, warning: 0.25, critical: 0 };

export interface BudgetMember {
	name: CacheName;
	/** What the cache holds now (bytes or entries, as its spec says). */
	used(): number;
	/** Lets go of the least recently used entries until `used() <= limit` (what is in use right now may stay). */
	shrink(limit: number): void;
}

const members = new Set<BudgetMember>();
const peaks = new Map<CacheName, number>();
let pressure: "normal" | "warning" | "critical" = "normal";
let background = false;
let shrinks = 0;
let lastShrinkAt = 0;

export function budgetLevel(): BudgetLevel {
	if (pressure !== "normal") return pressure;
	return background ? "background" : "normal";
}

/** The limit for a cache on this machine at this moment. */
export function budgetLimit(name: CacheName, tier: HardwareTier = hardwareTier(), level: BudgetLevel = budgetLevel()): number {
	const spec = BUDGETS[name];
	return Math.max(spec.floor, Math.floor(spec[tier] * LEVEL_SCALE[level]));
}

/** A cache counts in; returns the unregister. */
export function joinBudget(member: BudgetMember): () => void {
	members.add(member);
	return () => members.delete(member);
}

/** Called by a cache after it grew: keeps the peak and holds it to its limit. */
export function noteUse(member: BudgetMember): void {
	const used = member.used();
	const limit = budgetLimit(member.name);
	if (used > limit) {
		member.shrink(limit);
		shrinks++;
	}
	const now = member.used();
	if (now > (peaks.get(member.name) ?? 0)) peaks.set(member.name, now);
}

function shrinkAll(toFloor: boolean): void {
	for (const member of members) {
		try {
			member.shrink(toFloor ? BUDGETS[member.name].floor : budgetLimit(member.name));
		} catch {
			// one cache that can't let go never stops the others
		}
	}
	shrinks++;
	lastShrinkAt = Date.now();
}

/** The moment changed (the shell's signal, the app going to the background and back, a test). */
export function setBudgetSignal(level: string): void {
	if (level === "warning" || level === "critical") pressure = level;
	else if (level === "normal") pressure = "normal";
	else if (level === "background") background = true;
	else if (level === "foreground") background = false;
	else return;
	// growing back needs nothing: the caches fill again as frames are shown
	if (level === "background") shrinkAll(false);
}

/** What each cache holds against its budget (the test's table). */
export function budgetTable() {
	const used = new Map<CacheName, number>();
	for (const m of members) used.set(m.name, (used.get(m.name) ?? 0) + m.used());
	return (Object.keys(BUDGETS) as CacheName[]).map((name) => ({
		name,
		unit: BUDGETS[name].unit,
		base: BUDGETS[name].base,
		standard: BUDGETS[name].standard,
		floor: BUDGETS[name].floor,
		limit: budgetLimit(name),
		used: used.get(name) ?? 0,
		peak: peaks.get(name) ?? 0,
		members: [...members].filter((m) => m.name === name).length,
	}));
}

export function resetBudgetPeaks(): void {
	peaks.clear();
	for (const m of members) peaks.set(m.name, Math.max(peaks.get(m.name) ?? 0, m.used()));
}

/** Unit tests: back to a fresh start. */
export function resetBudgetForTests(): void {
	members.clear();
	peaks.clear();
	pressure = "normal";
	background = false;
	shrinks = 0;
}

// The shell's signal: «warning» / «critical» → every cache to its floor now (relieveMemory runs the other drops too);
// «normal» lifts the cap; «background» / «foreground» from the shell when the window is hidden or another app is in
// front for a minute.
onPressureLevel(setBudgetSignal);
onMemoryPressure(() => shrinkAll(true));
// A machine told late (the tier is «standard» until /api/hardware answers): an 8 GB Mac's caches shrink to its column.
onHardware(() => shrinkAll(false));

if (typeof window !== "undefined") {
	const w = window as unknown as { __studioMemory?: Record<string, unknown> };
	w.__studioMemory = {
		...(w.__studioMemory ?? {}),
		table: budgetTable,
		level: budgetLevel,
		resetPeaks: resetBudgetPeaks,
		shrinks: () => ({ shrinks, lastShrinkAt }),
		/** «8 GB» on this Mac for a test: the page's tier only (the server keeps STUDIO_HW_TIER). */
		tier: (tier: HardwareTier) => {
			const info = hardwareInfo();
			rememberHardware({ chip: info?.chip ?? "test", memoryGB: tier === "base" ? 8 : (info?.memoryGB ?? 16), cpuCores: info?.cpuCores ?? 8, performanceCores: info?.performanceCores ?? null, gpuCores: info?.gpuCores ?? null, tier, tierFrom: "override" });
			return hardwareTier();
		},
	};
}
