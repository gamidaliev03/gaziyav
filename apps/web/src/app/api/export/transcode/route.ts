// Export → the ffmpeg pass (HEVC, AV1, ProRes, GIF, HDR, MP3/AAC/FLAC). POST the page's master (or WAV mix) with
// ?job=<json>&name=…&seconds=…[&folder=…]; the answer streams JSON lines: {"progress":0.4} …, then {"done":true,
// "path","id"} or {"error"}.
import { sweepOldWork, type TranscodeJob, transcode } from "@/export/server/files";
import { rejectForeign } from "@/export/server/guard";
import { isRenderedFile } from "@/export/server/rendered-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const blocked = rejectForeign(req);
	if (blocked) return blocked;
	const url = new URL(req.url);
	let job: TranscodeJob;
	try {
		job = JSON.parse(url.searchParams.get("job") ?? "");
		if (!job || (!("target" in job) && !("audio" in job))) throw new Error();
	} catch {
		return Response.json({ error: "Unknown export settings." }, { status: 400 });
	}
	const name = url.searchParams.get("name") ?? "Export";
	const folder = url.searchParams.get("folder") || undefined;
	const seconds = Number(url.searchParams.get("seconds")) || 0;
	// A long master is already on disk (the app's export file): read from there, not through the page's memory.
	const from = url.searchParams.get("from");
	if (from && !isRenderedFile(from)) {
		return Response.json({ error: "The rendered file is gone. Export again." }, { status: 400 });
	}
	sweepOldWork();
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (data: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(data)}\n`));
			let last = -1;
			try {
				const result = await transcode({
					body: from ? null : req.body,
					inputFile: from ?? undefined,
					job,
					name,
					folder,
					seconds,
					signal: req.signal,
					onStage: (stage) => send({ stage }),
					onProgress: (progress) => {
						if (progress - last < 0.01) return;
						last = progress;
						send({ progress });
					},
				});
				send({ done: true, ...result });
			} catch (error) {
				// (`kept`: the file is made and held here, only its place failed — the page places it again without a new encode)
				const kept = (error as { kept?: { id: string; path: string; bytes: number } }).kept;
				send({ error: error instanceof Error ? error.message : "The file couldn't be made.", ...(kept ? { kept } : {}) });
			} finally {
				controller.close();
			}
		},
	});
	return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}
