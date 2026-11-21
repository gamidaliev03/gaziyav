// Settings → Services for the page (the app's own window only, like the other local APIs):
//   GET  /api/services                 → { rows, options: {row: [...]}, use: {row: option id}, keys: {service: {key, hint}} }
//   POST /api/services/use   { row, option }  → the new state
//   POST /api/services/check { service } | { option }  → { ok, ru, en }: one human line
//   GET  /api/services/voices          → { voices: [...] } (the services' voices for the voice pickers)
//   GET  /api/services/voice-sample?p=&v=  → a catalog voice's sample (fetched once, then kept)
import fs from "node:fs";
import { explain, StudioError } from "@/studio/server/errors";
import { isAbility, optionOf, optionsOf, ROWS, SERVICES } from "@/studio/server/providers/registry";
import { choose, chosen, keysView, readChoices, usable } from "@/studio/server/providers/services";
import { checkFree, checkService } from "@/studio/server/providers/check";
import { serviceVoices, voiceSampleFile } from "@/studio/server/providers/voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path?: string[] }> };
const json = (data: unknown, status = 200) => Response.json(data, { status });

function forbidden(req: Request): Response | null {
	const host = (req.headers.get("host") ?? "").toLowerCase();
	if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json({ error: "Request refused" }, 403);
	const origin = req.headers.get("origin");
	if (origin && origin !== `http://${host}`) return json({ error: "Request refused" }, 403);
	if (req.method !== "GET" && req.headers.get("x-studio") !== "1") return json({ error: "Request refused" }, 403);
	return null;
}

function state() {
	const saved = readChoices();
	return {
		rows: ROWS,
		services: SERVICES,
		options: Object.fromEntries(ROWS.map((r) => [r.id, optionsOf(r.id).map((o) => ({ ...o, usable: usable(o) }))])),
		// What each row is set to (his choice, kept even while its key is out), and what it runs on now.
		use: Object.fromEntries(ROWS.map((r) => [r.id, saved[r.id] ?? "gaziyav"])),
		live: Object.fromEntries(ROWS.map((r) => [r.id, chosen(r.id).id])),
		keys: keysView(),
	};
}

export async function GET(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [head] = (await ctx.params).path ?? [];
	const q = new URL(req.url).searchParams;
	try {
		if (!head) return json(state());
		if (head === "voices") return json({ voices: await serviceVoices() });
		if (head === "voice-sample") {
			const file = await voiceSampleFile(String(q.get("p") ?? ""), String(q.get("v") ?? ""));
			return new Response(new Uint8Array(fs.readFileSync(file)), { headers: { "Content-Type": file.endsWith(".mp3") ? "audio/mpeg" : "audio/mp4", "Cache-Control": "max-age=3600" } });
		}
		return json({ error: "Unknown request" }, 404);
	} catch (error) {
		return json({ error: error instanceof StudioError ? error.message : explain(error) }, 400);
	}
}

export async function POST(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [head] = (await ctx.params).path ?? [];
	try {
		const body = (await req.json().catch(() => ({}))) as { row?: unknown; option?: unknown; service?: unknown };
		if (head === "use") {
			if (!isAbility(body.row)) throw new StudioError("This service isn't offered for that.");
			choose(body.row, String(body.option ?? "gaziyav"));
			return json(state());
		}
		if (head === "check") {
			if (typeof body.service === "string") return json(await checkService(body.service));
			const row = isAbility(body.row) ? body.row : null;
			const option = row ? optionOf(row, String(body.option ?? "")) : undefined;
			if (!row || !option) return json({ ok: false, ru: "Такого варианта нет.", en: "There is no such option." });
			if (option.provider) return json(await checkService(option.provider));
			if (option.id === "gaziyav" && option.keys.length) {
				const lines = await Promise.all(option.keys.map((k) => checkService(k)));
				return json(lines.find((l) => l.ok) ?? lines[0]);
			}
			if (option.id === "gaziyav" && row === "translate") return json({ ok: true, ru: "Работает через Gaziyav AI — Claude из чата.", en: "Works through Gaziyav AI — the chat's Claude." });
			if (option.id === "gaziyav" && row !== "image-search" && row !== "video-search" && row !== "web-search") return json({ ok: true, ru: "Работает на этом Mac, без ключа.", en: "Works on this Mac, with no key." });
			return json(await checkFree(option.id === "gaziyav" ? (row === "image-search" || row === "video-search" ? "commons" : "wikipedia") : option.id));
		}
		return json({ error: "Unknown request" }, 404);
	} catch (error) {
		return json({ error: error instanceof StudioError ? error.message : explain(error) }, 400);
	}
}
