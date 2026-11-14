// The NVIDIA card of a Windows PC as its driver reports it (nvidia-smi comes with every NVIDIA driver), so the
// on-device AI can say up front what a PC can run instead of failing halfway through a download.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { IS_WINDOWS } from "@/platform/os";

export interface NvidiaGpu {
	name: string;
	/** Memory of the card in bytes. */
	vram: number;
	/** Driver version, e.g. 576.52. */
	driver: number;
}

/** PyTorch's CUDA 12.8 build needs this driver or newer (locks-win.ts). */
export const MIN_NVIDIA_DRIVER = 570;

let cached: NvidiaGpu | null | undefined;

/** The biggest NVIDIA card here, or null (no card, no driver, or not Windows). Asked once per app run. */
export function nvidiaGpu(): NvidiaGpu | null {
	if (!IS_WINDOWS) return null;
	if (cached !== undefined) return cached;
	cached = null;
	const smi = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "nvidia-smi.exe");
	try {
		const r = spawnSync(fs.existsSync(smi) ? smi : "nvidia-smi", ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"], {
			encoding: "utf8",
			timeout: 8000,
			windowsHide: true,
		});
		cached =
			(r.stdout ?? "")
				.split(/\r?\n/)
				.map((line) => line.split(",").map((s) => s.trim()))
				.filter((p) => p.length >= 3 && Number(p[1]) > 0)
				.map(([name, mib, driver]) => ({ name, vram: Number(mib) * 1024 * 1024, driver: Number.parseFloat(driver) || 0 }))
				.sort((a, b) => b.vram - a.vram)[0] ?? null;
	} catch {}
	return cached;
}
