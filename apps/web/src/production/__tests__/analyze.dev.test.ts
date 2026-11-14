import { expect, test } from "bun:test";

// The server's material brief on a real file, outside the app (PRODUCE_DEV=1 with STUDIO_BIN_DIR = an app's
// Resources/bin, WHISPER_MODEL, STUDIO_DATA_DIR, PRODUCE_FILE): ffmpeg, framejudge, claude-hear's ears and whisper.
test.skipIf(!process.env.PRODUCE_DEV)(
	"a brief of a real clip",
	async () => {
		const { requestAnalysis, analysisState } = await import("../server/analyze");
		const { readBrief } = await import("../server/store");
		const { compactBrief } = await import("../material");
		const file = String(process.env.PRODUCE_FILE);
		const key = `dev${Date.now().toString(16)}`;
		const t0 = Date.now();
		requestAnalysis({ key, file, name: file.split("/").pop() ?? "clip", front: true, music: process.env.PRODUCE_MUSIC === "1" });
		for (let i = 0; i < 600; i++) {
			const st = analysisState(key);
			if (st?.status === "done" || st?.status === "failed") break;
			await new Promise((r) => setTimeout(r, 500));
		}
		const st = analysisState(key);
		if (st?.status === "failed") throw new Error(st.error);
		const brief = readBrief(key)!;
		console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s\n${compactBrief(brief, key.slice(0, 8), { quotes: 3 })}\ncuts ${brief.speech?.cuts.length ?? 0}, frames ${brief.frames.length}, music ${JSON.stringify(brief.music ?? null).slice(0, 120)}`);
		expect(brief.seconds > 0 || brief.kind === "image").toBe(true);
	},
	600_000,
);
