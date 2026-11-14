// On-device AI manager and content folder.
//   GET  /api/ondevice/status          → { models: ModelStatus[], library: { folder }, disk: { free, total } }
//   POST /api/ondevice/install/:id     → JobState (download with progress; poll status)
//   POST /api/ondevice/repair/:id      → JobState (re-verifies every file and the runtime, fixes, self-tests)
//   POST /api/ondevice/cancel/:id      → { cancelled }
//   POST /api/ondevice/remove/:id      → { removed }
//   POST /api/ondevice/library         → { folder } ("" = none) → { folder }
//   GET  /api/ondevice/background      → BackgroundStatus (the shell asks once at launch: arms the quiet download)
//   POST /api/ondevice/background      → { project: true } | { busy: string[] } | { large: boolean } → BackgroundStatus
//   GET  /api/ondevice/thermal         → ThermalStatus (the Mac's temperature as the shell last reported it)
//   POST /api/ondevice/thermal         → { level: nominal | fair | serious | critical } → ThermalStatus (from main.js;
//                                        serious / critical pause every model, back to fair / nominal continues them)
import fs from "node:fs";
import path from "node:path";
import { armOnLaunch, backgroundStatus, declineModel, largeBytesLeft, projectOpened, reportBusy, setLargeInBackground, undeclineModel } from "@/ondevice/background";
import { cancelInstall, installBundled, ondeviceStatus, removeModel, startInstall } from "@/ondevice/server";
import { parseThermal, setThermalLevel, thermalStatus } from "@/ondevice/thermal";
import { explain, StudioError } from "@/studio/server/errors";
import { loadSettings, saveSettings } from "@/studio/server/settings";
import { modelsDir } from "@/platform/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

const json = (data: unknown, status = 200) => Response.json(data, { status });

// Same guard as /api/studio: only the app's own window; writes must carry X-Studio.
function forbidden(req: Request): Response | null {
	const host = (req.headers.get("host") ?? "").toLowerCase();
	if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json({ error: "Request refused" }, 403);
	const origin = req.headers.get("origin");
	if (origin && origin !== `http://${host}`) return json({ error: "Request refused" }, 403);
	if (req.method !== "GET" && req.headers.get("x-studio") !== "1") return json({ error: "Request refused" }, 403);
	return null;
}

const fail = (error: unknown) => json({ error: error instanceof StudioError ? error.message : explain(error) }, 400);

export async function GET(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [head] = (await ctx.params).path;
	if (head === "background") {
		armOnLaunch();
		return json(backgroundStatus());
	}
	if (head === "thermal") return json(thermalStatus());
	if (head !== "status") return json({ error: "Unknown request" }, 404);
	try {
		// The «with models» build: what it carries installs by itself (the shell asks for the status at launch).
		installBundled();
		armOnLaunch();
		return json({
			models: ondeviceStatus(),
			library: { folder: loadSettings().libraryFolder },
			disk: diskSpace(),
			background: { ...backgroundStatus(), largeBytes: largeBytesLeft() },
		});
	} catch (error) {
		return fail(error);
	}
}

export async function POST(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [head, id = ""] = (await ctx.params).path;
	try {
		if (head === "install") {
			undeclineModel(id);
			return json(await startInstall(id));
		}
		if (head === "repair") return json(await startInstall(id, { repair: true }));
		if (head === "cancel") return json({ cancelled: cancelInstall(id) });
		if (head === "remove") {
			removeModel(id);
			declineModel(id);
			return json({ removed: true });
		}
		if (head === "background") {
			const body = (await req.json().catch(() => ({}))) as { project?: unknown; busy?: unknown; large?: unknown };
			if (body.project === true) projectOpened(new URL(req.headers.get("referer") || "http://x/").pathname);
			if (Array.isArray(body.busy)) reportBusy(body.busy.map(String));
			if (typeof body.large === "boolean") setLargeInBackground(body.large);
			return json(backgroundStatus());
		}
		if (head === "thermal") {
			const body = (await req.json().catch(() => ({}))) as { level?: unknown };
			const level = parseThermal(body.level);
			if (!level) throw new StudioError("Unknown thermal level");
			return json(setThermalLevel(level));
		}
		if (head === "library") {
			const body = (await req.json().catch(() => ({}))) as { folder?: unknown };
			const folder = typeof body.folder === "string" ? body.folder.trim() : "";
			if (folder && (!path.isAbsolute(folder) || !fs.statSync(folder, { throwIfNoEntry: false })?.isDirectory())) {
				throw new StudioError("That folder doesn't exist.");
			}
			return json({ folder: saveSettings({ libraryFolder: folder }).libraryFolder });
		}
		return json({ error: "Unknown request" }, 404);
	} catch (error) {
		return fail(error);
	}
}

/** Free and total bytes of the volume the models download to (Settings, and the one question before a download). */
function diskSpace(): { free: number; total: number } {
	try {
		const s = fs.statfsSync(modelsDir());
		return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
	} catch {
		return { free: 0, total: 0 };
	}
}
