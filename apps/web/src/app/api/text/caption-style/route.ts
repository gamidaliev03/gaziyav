// A caption style Gaziyav AI designs for the Captions tab: POST {description} → {style}. Local app API only.
import { randomUUID } from "node:crypto";
import { USER_PREFIX } from "@/presets/user-presets";
import { CAPTION_STYLE_SYSTEM, captionStyleFromAnswer, parseModelJson } from "@/subtitles/user-style";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) => Response.json(data, { status });

// Same guard as the studio API: only the app's own window may call it.
function forbidden(req: Request): Response | null {
	const host = (req.headers.get("host") ?? "").toLowerCase();
	if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json({ error: "Request rejected" }, 403);
	const origin = req.headers.get("origin");
	if (origin && origin !== `http://${host}`) return json({ error: "Request rejected" }, 403);
	if (req.headers.get("x-studio") !== "1") return json({ error: "Request rejected" }, 403);
	return null;
}

export async function POST(req: Request) {
	const blocked = forbidden(req);
	if (blocked) return blocked;
	try {
		const body = (await req.json()) as { description?: unknown };
		const description = typeof body.description === "string" ? body.description.trim().slice(0, 500) : "";
		// User-facing problems answer 200 + error, so they don't show up as failed requests.
		if (!description) return json({ error: "Describe the captions you want." });
		const id = `${USER_PREFIX}${randomUUID()}` as const;
		// Test harness only (STUDIO_TEST=1): a canned answer, so UI tests spend no money.
		const mock = process.env.STUDIO_TEST === "1" ? process.env.STUDIO_CAPTION_STYLE_MOCK : undefined;
		const answer =
			mock ??
			(await (async () => {
				const { DeepSeek } = await import("@/studio/server/deepseek");
				const { loadSettings } = await import("@/studio/server/settings");
				const settings = loadSettings();
				const ds = new DeepSeek(settings.deepseekKey, settings.deepseekModel);
				return ds.chat({
					system: CAPTION_STYLE_SYSTEM,
					user: description,
					json: true,
					temperature: 0.8,
					maxTokens: 500,
					thinking: false,
					signal: req.signal,
				});
			})());
		return json({ style: captionStyleFromAnswer({ answer: parseModelJson(answer), id, description }) });
	} catch (error) {
		const message = error instanceof Error && error.message ? error.message : "Gaziyav AI didn't manage this one: nothing was changed. Press the button once more.";
		return json({ error: message });
	}
}
