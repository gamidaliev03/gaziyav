// This Mac (or PC) for every part of the app — the editor's previews, decoders and caches, the local AI's models, the
// shell: its chip, memory, CPU and GPU cores, and a tier. base: 8 GB (an M1 / M2 Air), standard: 16–24 GB, pro: 32 GB
// and more. STUDIO_HW_TIER=base|standard|pro sets the tier (a base Mac's behaviour on a bigger one, for tests); the
// rest stays what the machine is. Server side, read once (the commands take ~30 ms); the page asks /api/hardware
// (platform/hardware-client.ts).
import { execFileSync } from "node:child_process";
import os from "node:os";
import { IS_MAC } from "./os";

export type HardwareTier = "base" | "standard" | "pro";
export const HARDWARE_TIERS: readonly HardwareTier[] = ["base", "standard", "pro"];

export interface Hardware {
	/** "Apple M1 Pro". */
	chip: string;
	/** Physical memory, GB (GiB, as the Mac's About window counts it): 8, 16, 18, 24, 32… */
	memoryGB: number;
	cpuCores: number;
	/** Apple silicon's performance cores; null elsewhere. */
	performanceCores: number | null;
	/** The GPU's cores (7 on the smallest M1, 14 on an M1 Pro…); null when the system doesn't say. */
	gpuCores: number | null;
	tier: HardwareTier;
	/** "override": STUDIO_HW_TIER chose the tier, not the memory. */
	tierFrom: "memory" | "override";
}

/** The tier for this much memory (GB): under 12 base, under 30 standard (16, 18, 24), else pro (32 and more). */
export function tierForMemory(memoryGB: number): HardwareTier {
	if (memoryGB < 12) return "base";
	if (memoryGB < 30) return "standard";
	return "pro";
}

/** A tier named in STUDIO_HW_TIER (any case); null for anything else. */
export function parseTier(value: string | null | undefined): HardwareTier | null {
	const tier = value?.trim().toLowerCase();
	return HARDWARE_TIERS.find((t) => t === tier) ?? null;
}

function run(command: string, args: string[]): string | null {
	try {
		return execFileSync(command, args, { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
	} catch {
		return null;
	}
}

type Machine = Omit<Hardware, "tier" | "tierFrom">;
let machine: Machine | null = null;

function readMachine(): Machine {
	const memoryGB = Math.round(os.totalmem() / 2 ** 30);
	const cpus = os.cpus();
	if (!IS_MAC) {
		return { chip: cpus[0]?.model?.trim() || os.arch(), memoryGB, cpuCores: cpus.length, performanceCores: null, gpuCores: null };
	}
	const chip = run("sysctl", ["-n", "machdep.cpu.brand_string"]) ?? cpus[0]?.model ?? "Apple silicon";
	const performance = Number(run("sysctl", ["-n", "hw.perflevel0.physicalcpu"]));
	// The GPU's own driver says how many cores it has (system_profiler says it too, in ~1 s).
	const gpu = /"gpu-core-count"\s*=\s*(\d+)/.exec(run("ioreg", ["-rc", "AGXAccelerator", "-d", "1"]) ?? "");
	return {
		chip,
		memoryGB,
		cpuCores: cpus.length,
		performanceCores: Number.isFinite(performance) && performance > 0 ? performance : null,
		gpuCores: gpu ? Number(gpu[1]) : null,
	};
}

/** This machine and its tier (STUDIO_HW_TIER is read on every call: a test may set it while the server runs). */
export function hardware(): Hardware {
	if (!machine) machine = readMachine();
	const override = parseTier(process.env.STUDIO_HW_TIER);
	return { ...machine, tier: override ?? tierForMemory(machine.memoryGB), tierFrom: override ? "override" : "memory" };
}
