// Lottie graphics from the user's own library folder (Kadr layout), read-only, at run time (nothing is bundled:
// LottieFiles items have per-item licences). GET → index; GET ?file=<relative path> → the JSON.
import fs from "node:fs";
import path from "node:path";
import { userKadrLibrary } from "@/platform/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) => Response.json(data, { status });

function libraryDir(): string {
	// Only the user's own library folder (On-device AI → My library folder); "" = nothing to list.
	if (process.env.STUDIO_KADR_GRAPHICS) return process.env.STUDIO_KADR_GRAPHICS;
	const lib = userKadrLibrary();
	return lib ? path.join(lib, "Graphics") : "";
}

interface KadrItem {
	file: string;
	name: string;
	category: string;
	w: number;
	h: number;
	fps: number;
	duration: number;
	texts: number;
}

function readIndex(): { items: KadrItem[]; verified: Set<string> } | null {
	const dir = libraryDir();
	if (!dir) return null;
	try {
		const items = JSON.parse(fs.readFileSync(path.join(dir, "library.json"), "utf8")) as KadrItem[];
		let verified = new Set<string>();
		try {
			verified = new Set(
				fs.readFileSync(path.join(dir, "verified.txt"), "utf8").split("\n").map((line) => line.trim()).filter(Boolean),
			);
		} catch {}
		return { items: Array.isArray(items) ? items : [], verified };
	} catch {
		return null;
	}
}

function forbidden(req: Request): Response | null {
	const host = (req.headers.get("host") ?? "").toLowerCase();
	if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json({ error: "Request rejected" }, 403);
	const origin = req.headers.get("origin");
	if (origin && origin !== `http://${host}`) return json({ error: "Request rejected" }, 403);
	return null;
}

export async function GET(req: Request) {
	const blocked = forbidden(req);
	if (blocked) return blocked;
	const index = readIndex();
	const file = new URL(req.url).searchParams.get("file");
	if (!file) {
		if (!index) return json({ available: false, items: [] });
		// Only items Kadr verified to render correctly.
		const items = index.items
			.filter((item) => index.verified.size === 0 || index.verified.has(item.file))
			.map((item) => ({
				id: `kadr:${item.file}`,
				file: item.file,
				name: item.name,
				category: item.category,
				w: item.w,
				h: item.h,
				fps: item.fps,
				duration: item.duration,
				texts: item.texts,
			}));
		return json({ available: true, items });
	}
	// Files must be listed in the index; no paths outside the library.
	if (!index || !index.items.some((item) => item.file === file) || file.includes("..")) {
		return json({ error: "This graphic is not in your graphics library." }, 404);
	}
	try {
		if (!libraryDir()) return json({ error: "Not found" }, 404);
		const full = path.join(libraryDir(), file);
		if (!full.startsWith(libraryDir() + path.sep)) return json({ error: "Request rejected" }, 403);
		return new Response(fs.readFileSync(full), {
			headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=3600" },
		});
	} catch {
		return json({ error: "Couldn't read this graphic from your graphics library." }, 404);
	}
}
