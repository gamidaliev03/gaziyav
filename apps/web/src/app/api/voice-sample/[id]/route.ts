// The sample a voice card plays (as CapCut plays a voice when you click it):
//   GET /api/voice-sample/<ready id>      → its own short recording (Resources/voices, neutral style)
//   GET /api/voice-sample/local:<id>      → the sample one of «My voices» was cloned from
//   GET /api/voice-sample/fx:<effect>     → a ready voice through that Voice changer effect (made once, then kept)
import fs from "node:fs";
import path from "node:path";
import { VOICE_FILTERS } from "@/studio/server/audio-ai";
import { myVoice } from "@/studio/server/my-voices";
import { readyVoice } from "@/studio/server/ready-voices";
import { studioHome } from "@/studio/server/settings";
import { findTool, run } from "@/studio/server/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { ".m4a": "audio/mp4", ".mp4": "audio/mp4", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".aac": "audio/aac" };

function send(file: string) {
	return new Response(new Uint8Array(fs.readFileSync(file)), {
		headers: { "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "audio/mp4", "Cache-Control": "max-age=3600" },
	});
}

async function effectSample(effect: string): Promise<string | null> {
	const filter = VOICE_FILTERS[effect];
	const base = readyVoice("ryan", "neutral");
	if (!filter || !base) return null;
	const dir = path.join(studioHome(), "voice-fx-samples");
	const out = path.join(dir, `${effect}.m4a`);
	if (fs.existsSync(out)) return out;
	fs.mkdirSync(dir, { recursive: true });
	const tmp = path.join(dir, `${effect}.${process.pid}.m4a`);
	const r = await run(findTool("ffmpeg"), ["-y", "-v", "error", "-i", base.ref, "-af", `aresample=48000,${filter}`, "-c:a", "aac", "-b:a", "128k", tmp], { timeout: 60 });
	if (r.status !== 0 || !fs.existsSync(tmp)) return null;
	fs.renameSync(tmp, out);
	return out;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
	const host = (req.headers.get("host") ?? "").toLowerCase();
	if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return Response.json({ error: "Request refused" }, { status: 403 });
	const id = decodeURIComponent((await ctx.params).id);
	let file: string | null = null;
	if (/^local:[\w-]{1,64}$/.test(id)) file = myVoice(id)?.path ?? null;
	else if (/^fx:[a-z]{2,20}$/.test(id)) file = await effectSample(id.slice(3));
	else if (/^[a-z_]{2,20}$/.test(id)) file = readyVoice(id, "neutral")?.ref ?? null;
	if (!file || !fs.existsSync(file)) return Response.json({ error: "No sample for this voice" }, { status: 404 });
	return send(file);
}
