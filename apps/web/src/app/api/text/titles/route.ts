// AI titles for the Text tab: POST {speech} → {hook, cta}. Local app API only.
import { parseAiTitles, writeAiTitles } from "@/text/server/ai-titles";

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
		const body = (await req.json()) as { speech?: unknown };
		const speech = typeof body.speech === "string" ? body.speech.trim() : "";
		if (speech.split(/\s+/).filter(Boolean).length < 3) {
			// User-facing problems answer 200 + error, so they don't show up as failed requests.
			return json({ error: "Not enough speech to write titles. Add captions or a clip with a voice first." });
		}
		// Test harness only (STUDIO_TEST=1): a canned DeepSeek answer, so UI tests spend no money.
		const mock = process.env.STUDIO_TEST === "1" ? process.env.STUDIO_TITLES_MOCK : undefined;
		if (mock) return json(parseAiTitles(mock));
		return json(await writeAiTitles({ speech, signal: req.signal }));
	} catch (error) {
		const message = error instanceof Error && error.message ? error.message : "AI titles failed. Retry.";
		return json({ error: message });
	}
}
