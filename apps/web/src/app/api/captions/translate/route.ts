// Captions → Bilingual captions / Translate: Gaziyav AI (the built-in agent) translates the caption lines.
// POST {to, lines[]} → {lines[]} (same count). Local app API only; the test harness gets a canned answer.
import { linesFromAnswer, TRANSLATE_SYSTEM } from "@/subtitles/translate-prompt";
import { rejectForeign } from "@/export/server/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) => Response.json(data, { status });

export async function POST(req: Request) {
	const blocked = rejectForeign(req);
	if (blocked) return blocked;
	try {
		const body = (await req.json()) as { to?: unknown; lines?: unknown };
		const to = typeof body.to === "string" ? body.to.trim().slice(0, 40) : "";
		const lines = Array.isArray(body.lines) ? body.lines.map((line) => String(line ?? "").slice(0, 500)).slice(0, 2000) : [];
		if (!to || lines.length === 0) return json({ error: "Nothing to translate." });
		if (process.env.STUDIO_TEST === "1" && process.env.STUDIO_TRANSLATE_MOCK) {
			return json({ lines: lines.map((line) => `${process.env.STUDIO_TRANSLATE_MOCK} ${line}`) });
		}
		const { DeepSeek } = await import("@/studio/server/deepseek");
		const { loadSettings } = await import("@/studio/server/settings");
		const { parseModelJson } = await import("@/subtitles/user-style");
		const settings = loadSettings();
		const ds = new DeepSeek(settings.deepseekKey, settings.deepseekModel);
		const out: string[] = [];
		// 120 lines a call: a long video's captions stay well inside one answer each.
		for (let start = 0; start < lines.length; start += 120) {
			const part = lines.slice(start, start + 120);
			const answer = await ds.chat({
				system: TRANSLATE_SYSTEM,
				user: JSON.stringify({ to, lines: part }),
				json: true,
				temperature: 0.3,
				maxTokens: 4000,
				thinking: false,
				signal: req.signal,
				// the target language with the call (never the interface's)
				lang: to,
			});
			out.push(...linesFromAnswer(parseModelJson(answer), part));
		}
		return json({ lines: out });
	} catch (error) {
		return json({ error: error instanceof Error && error.message ? error.message : "Couldn't translate it — nothing was changed." });
	}
}
