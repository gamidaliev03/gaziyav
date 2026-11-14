// Smoke test of a built Gaziyav.app: it starts in test mode (its own data folder and port, fake camera and
// microphone, never your projects), opens the projects page, makes a project, imports a clip and a picture it makes
// itself with the app's own ffmpeg, puts the clip on the timeline, plays it, and finds no page error.
//   STUDIO_APP_BUNDLE=<.app> [STUDIO_DEBUG_PORT=9590 STUDIO_PORT=3590 STUDIO_TEST_DIR=<abs dir>] node test/smoke.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as L from "./editor4-lib.mjs";

const { sleep, ED } = L;
const { check, finish } = L.makeChecker("smoke");
fs.mkdirSync(L.OUT, { recursive: true });

// test media: 4 s of colour bars with a tone, and one picture (the app's own ffmpeg; no file of anyone's)
const bundle = process.env.STUDIO_APP_BUNDLE || path.join(L.HERE, "..", "dist", "Gaziyav.app");
const ffmpeg = path.join(bundle, "Contents", "Resources", "bin", "ffmpeg");
const media = fs.mkdtempSync(path.join(os.tmpdir(), "gaziyav-smoke-"));
const clip = path.join(media, "bars.mp4");
const still = path.join(media, "still.png");
execFileSync(ffmpeg, ["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=4", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip]);
execFileSync(ffmpeg, ["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x640", "-frames:v", "1", still]);
check("test media made with the app's ffmpeg", fs.statSync(clip).size > 10_000 && fs.statSync(still).size > 1000);

const p = await L.start();
try {
	check("the app starts and shows the projects page", (await p.eval("location.pathname")).startsWith("/projects"));
	await L.newProject(p);
	check("a new project opens in the editor", (await p.eval("location.pathname")).startsWith("/editor/"));
	await L.importFiles(p, [clip, still], { keepPlaced: true });
	const assets = await p.eval(`${ED}.media.getAssets().map((a) => ({ type: a.type, duration: a.duration }))`);
	check("the clip and the picture are imported", assets.length >= 2 && assets.some((a) => a.type === "video" && a.duration > 3), JSON.stringify(assets));
	if ((await p.eval(L.elementCount)) === 0) {
		await p.eval(`(() => { const ed = ${ED}; const a = ed.media.getAssets().find((x) => x.type === "video"); ed.timeline.insertElement?.({ placement: { mode: "auto" }, element: { type: "video", mediaId: a.id, name: a.name, duration: a.duration, startTime: 0, trimStart: 0, trimEnd: 0 } }); })()`).catch(() => {});
		await sleep(800);
	}
	check("the clip is on the timeline", (await p.eval(L.elementCount)) > 0, `${await p.eval(L.elementCount)} elements`);
	await p.eval(`${ED}.playback.play()`);
	await sleep(1500);
	const t = await p.eval(`${ED}.playback.getCurrentTime()`);
	await p.eval(`${ED}.playback.pause()`);
	check("it plays", Number(t) > 0, `at ${t}`);
	const h = await L.health(p);
	check("no page errors", !h.errors?.length && !h.rejections?.length && !h.crash && !h.gone?.length, JSON.stringify({ e: h.errors?.slice(0, 2), r: h.rejections?.slice(0, 2), gone: h.gone }).slice(0, 300));
} catch (error) {
	check("run", false, String(error?.stack ?? error).slice(0, 400));
}
await p.close().catch(() => {});
fs.rmSync(media, { recursive: true, force: true });
finish();
