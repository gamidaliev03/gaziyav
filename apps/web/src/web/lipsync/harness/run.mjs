// The browser test of lipsync in the page: the project's own Electron as a plain sandboxed Chromium window (no node
// integration, no preload) on a bundled harness page (127.0.0.1:4042), against the stand-in provider
// (GaziyavShell/test/fake-fal.mjs) behind a cross-origin front on 127.0.0.1:4041 that answers preflights and CORS like
// the real hosts. Run:
//   FAKE_FAL=<GaziyavShell>/test/fake-fal.mjs SITE=<dir with page.js + media> OUT=<scratch> electron run.mjs
import { app, BrowserWindow } from "electron";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const OUT = process.env.OUT;
const SITE = process.env.SITE;
const PAGE = process.env.PAGE || "page.js";
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const FFPROBE = FFMPEG.replace(/ffmpeg$/, "ffprobe");
fs.rmSync(path.join(OUT, "profile"), { recursive: true, force: true });
fs.rmSync(path.join(OUT, "fake"), { recursive: true, force: true });
for (const f of ["progress.txt", "console.txt"]) fs.rmSync(path.join(OUT, f), { force: true });
fs.mkdirSync(path.join(OUT, "fake"), { recursive: true });
app.setPath("userData", path.join(OUT, "profile"));

const results = [];
const check = (name, ok, got) => {
	results.push({ name, ok: !!ok, got });
	const line = `${ok ? "ok  " : "FAIL"} ${name}${got !== undefined ? ` — ${typeof got === "string" ? got : JSON.stringify(got)}` : ""}`;
	fs.appendFileSync(path.join(OUT, "progress.txt"), `${line}\n`);
	console.log(`${ok ? "ok  " : "FAIL"} ${name}${got !== undefined ? ` — ${typeof got === "string" ? got : JSON.stringify(got)}` : ""}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 60_000) => {
	const t = Date.now();
	while (!(await f())) {
		if (Date.now() - t > ms) throw new Error("timed out");
		await wait(50);
	}
};

app.whenReady().then(main);

async function main() {
const { startFakeFal, FAKE_KEY } = await import(pathToFileURL(process.env.FAKE_FAL).href);
const fake = await startFakeFal({ ffmpeg: FFMPEG, dir: path.join(OUT, "fake") });

// ── the provider's front: cross-origin, preflights answered as the real hosts answer them ──
const front = [];
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS", "access-control-allow-headers": "authorization, content-type", "access-control-max-age": "86400" };
const frontServer = http.createServer((req, res) => {
	front.push({ method: req.method, url: req.url, auth: req.headers.authorization ?? null, origin: req.headers.origin ?? null, at: Date.now() });
	if (req.method === "OPTIONS") return res.writeHead(204, CORS), res.end();
	const headers = { ...req.headers };
	delete headers.host;
	delete headers.origin;
	const up = http.request(`${fake.url}${req.url}`, { method: req.method, headers }, (r) => {
		res.writeHead(r.statusCode, { ...r.headers, ...CORS });
		r.pipe(res);
	});
	up.on("error", () => (res.writeHead(502, CORS), res.end()));
	req.pipe(up);
});
await new Promise((r) => frontServer.listen(4041, "127.0.0.1", r));

// ── the static page, with the CSP the edition would send (connect-src: itself + the provider) ──
const TYPES = { ".js": "text/javascript", ".mp4": "video/mp4", ".m4a": "audio/mp4" };
const site = http.createServer((req, res) => {
	const u = new URL(req.url, "http://x");
	if (u.pathname === "/") {
		res.writeHead(200, { "Content-Type": "text/html", "Content-Security-Policy": "default-src 'self'; script-src 'self'; connect-src 'self' blob: http://127.0.0.1:4041; media-src 'self' blob:" });
		return res.end(`<!doctype html><meta charset="utf-8"><title>loading</title><script src="/${PAGE}"></script>`);
	}
	const f = path.join(SITE, path.normalize(u.pathname));
	if (!f.startsWith(SITE) || !fs.existsSync(f)) return res.writeHead(404), res.end();
	res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] ?? "application/octet-stream" });
	fs.createReadStream(f).pipe(res);
});
await new Promise((r) => site.listen(4042, "127.0.0.1", r));

const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, partition: "persist:weblip", backgroundThrottling: false } });
const wc = win.webContents;
const consoleLines = [];
wc.on("console-message", (e, _l, message) => {
	const m = String(e?.message ?? message ?? "");
	consoleLines.push(m);
	fs.appendFileSync(path.join(OUT, "console.txt"), `${m}\n`);
});
const net = [];
await wc.loadURL("about:blank");
fs.appendFileSync(path.join(OUT, "progress.txt"), ".. blank loaded\n");
wc.debugger.attach("1.3");
wc.debugger.on("message", (_e, method, p) => {
	if (method === "Network.requestWillBeSent") net.push({ url: p.request.url, headers: p.request.headers });
	if (method === "Network.requestWillBeSentExtraInfo") net.push({ url: "(extra)", headers: p.headers });
});
await wc.debugger.sendCommand("Network.enable");
const ev = (code, ms = 120_000) => {
	fs.appendFileSync(path.join(OUT, "progress.txt"), `.. ${code.slice(0, 60)}\n`);
	return Promise.race([wc.executeJavaScript(code, true), wait(ms).then(() => { throw new Error(`no answer in ${ms / 1000} s: ${code.slice(0, 60)} · console: ${consoleLines.slice(-5).join(" | ")}`); })]);
};
const load = async () => {
	await wc.loadURL("http://127.0.0.1:4042/");
	await until(async () => String(await ev("document.title")).startsWith("weblip harness ready"));
};

try {
	await load();
	await ev(`__h.setKey(${JSON.stringify(FAKE_KEY)})`);
	check("mounted", true, await ev("document.title"));
	const TEXT = "Привет! Это новые слова для этого клипа.";

	// 1. the price shown before the run (an estimate: the voice is not made yet)
	const est = await ev(`__h.preflightEstimate(${JSON.stringify(TEXT)})`);
	check("price before the run: total = voice + clone + LatentSync, from models.ts", Math.abs(est.total - (0.09 * TEXT.length / 1000 + 0.0008 + 0.2)) < 1e-9, { total: est.total, voiceUsd: est.voiceUsd, usd: est.usd, estimated: est.estimated });
	check("the quiet line beside the price", est.checks.some((c) => c.text === "в приложении дешевле: платите только за речь"));

	// 2. the golden path
	const before = front.length;
	const START = 1.5;
	const LENGTH = 3.0;
	const t0 = Date.now();
	const g = await ev(`__h.golden(${JSON.stringify(TEXT)}, ${START}, ${LENGTH})`);
	const ms = Date.now() - t0;
	const vWant = ["sample:running", "sample:running:taking the voice from the sample", "sample:running:waiting in the fal.ai queue · 1 ahead", "sample:running:working on fal.ai", "sample:done:working on fal.ai", "speech:running", "speech:running:waiting in the fal.ai queue · 1 ahead", "speech:running:working on fal.ai", "speech:done:working on fal.ai", "words:skipped:no word timings in the browser", "job:done"];
	check("voice: every state, in order (the engine's trail)", JSON.stringify(g.voice.trail) === JSON.stringify(vWant), g.voice.trail);
	const lWant = ["prepare:running", "prepare:running:preparing the piece in this browser", "prepare:running:sending the piece to fal.ai", "prepare:done:sending the piece to fal.ai", "lipsync:running", "lipsync:running:waiting in the fal.ai queue · 1 ahead", "lipsync:running:working on fal.ai", "lipsync:done:working on fal.ai", "job:done"];
	check("lipsync: every state, in order (the engine's trail)", JSON.stringify(g.lip.trail) === JSON.stringify(lWant), g.lip.trail);
	check("the app's client (followJob) saw the run and its end", g.voice.states.at(-1) === "job:done" && g.lip.states.at(-1) === "job:done" && g.lip.states.some((x) => x.startsWith("lipsync:")), { voice: g.voice.states.length, lip: g.lip.states.length });
	check("voice result: a clone's voice id, an audio file", g.voice.result.voiceId.startsWith("webclone:") && g.voice.file.size > 1000, { voiceId: g.voice.result.voiceId.slice(0, 40), name: g.voice.result.name, duration: g.voice.result.duration });
	check("lipsync result: an mp4 file handed to the client", g.lip.file.type === "video/mp4" && g.lip.file.size > 1000, g.lip.file);
	check("charged = shown (voice part, lipsync part)", Math.abs(g.lip.cost - 0.2) < 1e-9 && Math.abs(g.preflight.usd - 0.2) < 1e-9, { voiceCost: g.voice.cost, lipCost: g.lip.cost, preflightUsd: g.preflight.usd });
	const run = front.slice(before).filter((e) => e.method !== "OPTIONS");
	const by = (re, m) => run.filter((e) => e.method === m && re.test(e.url)).length;
	const counts = { submits: by(/^\/queue\.fal\.run\/[^?]+$/, "POST"), tickets: by(/^\/rest\.fal\.ai\//, "POST"), puts: by(/^\/v3\.fal\.media\/upload\//, "PUT"), downloads: by(/^\/v3\.fal\.media\/files\//, "GET"), statusPolls: by(/\/status/, "GET"), answers: by(/^\/queue\.fal\.run\/.+\/requests\/[\w-]+$/, "GET"), preflights: front.slice(before).filter((e) => e.method === "OPTIONS").length };
	check("requests per run: 3 submits (clone, speech, lipsync), 3 uploads, 3 answers, 2 downloads", counts.submits === 3 && counts.tickets === 3 && counts.puts === 3 && counts.answers === 3 && counts.downloads === 2, { ...counts, seconds: ms / 1000 });
	check("fal's own schemas accepted every request", fake.rejected.length === 0, fake.rejected);

	// the bytes that went: the sample (WAV) and the prepared span (MP4)
	const putFiles = fake.log.filter((e) => e.host === "v3.fal.media" && e.method === "PUT").map((e) => ({ name: e.path.slice("/upload/".length), bytes: e.bytes }));
	const probe = (f) => JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-count_frames", "-show_entries", "stream=codec_name,codec_type,width,height,pix_fmt,nb_read_frames,r_frame_rate,channels,sample_rate,duration,color_transfer,color_primaries:format=duration,size", "-of", "json", f], { encoding: "utf8" }));
	const sample = putFiles.find((p) => p.name.endsWith(".wav"));
	const sp = probe(path.join(OUT, "fake", sample.name));
	check("voice sample: the clip's own sound from 1.5 s to its end (4.5 s), mono WAV", Math.abs(Number(sp.format.duration) - 4.5) < 0.03 && sp.streams[0].channels === 1 && /pcm_s16/.test(sp.streams[0].codec_name), { duration: sp.format.duration, codec: sp.streams[0].codec_name, channels: sp.streams[0].channels, bytes: sample.bytes });
	const piece = putFiles.find((p) => p.name.endsWith(".mp4"));
	const pfile = path.join(OUT, "fake", piece.name);
	const pp = probe(pfile);
	const v = pp.streams.find((s) => s.codec_type === "video");
	const a = pp.streams.find((s) => s.codec_type === "audio");
	const dump = JSON.parse((await ev("__h.storageDump()")).db);
	const prepared = dump.jobs.find((j) => j.kind === "lipsync")?.input?.["out:prepare"];
	check("the upload's bytes = the prepared file's bytes", piece.bytes === fs.statSync(pfile).size && prepared?.bytes === piece.bytes, { uploaded: piece.bytes, prepared: prepared?.bytes });
	check("prepared: H.264 + AAC, 8-bit 4:2:0, short side ≤ 1080 (1440×2560 → 1080×1920)", v.codec_name === "h264" && a?.codec_name === "aac" && v.pix_fmt === "yuv420p" && v.width === 1080 && v.height === 1920, { video: `${v.codec_name} ${v.width}x${v.height} ${v.pix_fmt} ${v.r_frame_rate} ${v.color_transfer ?? "untagged"}`, audio: `${a?.codec_name} ${a?.sample_rate} ${a?.channels}ch` });
	check("prepared: duration = the used span to the frame (90 frames of 30 fps = 3.000 s)", Number(v.nb_read_frames) === 90 && Math.abs(Number(v.duration) - 3) < 1 / 30 / 2, { frames: v.nb_read_frames, videoSeconds: v.duration, audioSeconds: a?.duration });
	// the first and last frame are the source's frames 45 and 134 (by PSNR against the neighbours)
	const frame = (src, n, out) => execFileSync(FFMPEG, ["-y", "-v", "error", "-i", src, "-vf", `select=eq(n\\,${n}),scale=1080:1920`, "-frames:v", "1", out]);
	const fr = path.join(OUT, "frames");
	fs.mkdirSync(fr, { recursive: true });
	const src = path.join(SITE, "media", "src.mp4");
	frame(pfile, 0, `${fr}/p0.png`);
	frame(pfile, 89, `${fr}/p89.png`);
	const score = (p, n) => {
		frame(src, n, `${fr}/s${n}.png`);
		try {
			execFileSync(FFMPEG, ["-v", "error", "-i", p, "-i", `${fr}/s${n}.png`, "-lavfi", `psnr=stats_file=${fr}/psnr.txt`, "-f", "null", "-"]);
			const t = fs.readFileSync(`${fr}/psnr.txt`, "utf8");
			const m = /psnr_avg:([\d.]+|inf)/.exec(t);
			return m ? (m[1] === "inf" ? 99 : Number(m[1])) : 0;
		} catch {
			return 0;
		}
	};
	const firsts = [44, 45, 46].map((n) => score(`${fr}/p0.png`, n));
	const lasts = [133, 134, 135].map((n) => score(`${fr}/p89.png`, n));
	check("prepared frame 0 = source frame 45, frame 89 = source frame 134 (PSNR vs ±1)", firsts[1] > firsts[0] && firsts[1] > firsts[2] && lasts[1] > lasts[0] && lasts[1] > lasts[2], { first: firsts.map((x) => x.toFixed(1)), last: lasts.map((x) => x.toFixed(1)) });

	// 3. reload in the middle → collected ONCE
	fake.mode.delayPolls = 1e9;
	const sub0 = fake.lip.submitted;
	const id1 = await ev("__h.startLip(0.5, 3)");
	await until(() => fake.lip.submitted === sub0 + 1);
	await wait(800);
	await wc.reload();
	await until(async () => { try { return String(await ev("document.title")).startsWith("weblip harness ready"); } catch { return false; } });
	fake.mode.delayPolls = 2;
	const c1 = await ev(`__h.collect(${JSON.stringify(id1)})`);
	await wait(1000);
	check("reload mid-run: the parked job is COLLECTED once, never submitted again", c1.status === "done" && c1.size > 1000 && fake.lip.submitted === sub0 + 1 && c1.counts.collected === 1 && (c1.counts.submits.lipsync ?? 0) === 0, { status: c1.status, submittedAtFake: fake.lip.submitted - sub0, collected: c1.counts.collected, states: c1.states });

	// 4. cancel
	fake.mode.delayPolls = 1e9;
	const sub1 = fake.lip.submitted;
	const id2 = await ev("__h.startLip(0.5, 3)");
	await until(() => fake.lip.submitted === sub1 + 1);
	await wait(500);
	const reqId = [...fake.jobs.values()].filter((j) => /latentsync/.test(j.endpoint)).at(-1).id;
	await ev(`__h.cancel(${JSON.stringify(id2)})`);
	const polls = () => front.filter((e) => e.url.includes(`/requests/${reqId}/status`)).length;
	const p0 = polls();
	await wait(2000);
	const c2 = await ev(`__h.collect(${JSON.stringify(id2)})`);
	check("cancel: polling stops, the provider's job is cancelled, the page says so", c2.status === "cancelled" && fake.jobs.get(reqId).cancelled === true && polls() === p0 && /Остановлено/.test(c2.error ?? ""), { status: c2.status, error: c2.error, pollsAfter: polls() - p0 });
	fake.mode.delayPolls = 2;

	// 5. a failure → one sentence; retry in place → done
	const sub2 = fake.lip.submitted;
	fake.mode.lipFail = [sub2 + 1];
	const id3 = await ev("__h.startLip(0.5, 3)");
	const c3 = await ev(`__h.collect(${JSON.stringify(id3)})`);
	check("a provider failure: one Russian sentence", c3.status === "failed" && c3.error === "fal.ai не справился с задачей: нажмите «Повторить».", { status: c3.status, error: c3.error });
	const id4 = await ev("__h.startLip(0.5, 3)");
	const c4 = await ev(`__h.collect(${JSON.stringify(id4)})`);
	check("retry in place: done, one new submission", c4.status === "done" && fake.lip.submitted === sub2 + 2, { status: c4.status, submissions: fake.lip.submitted - sub2 });

	// 6. the key: only in the Authorization header to the provider's key hosts
	const KEY = FAKE_KEY;
	const keyed = front.filter((e) => e.auth);
	check("key only in Authorization, only to queue.fal.run / rest.fal.ai", keyed.every((e) => e.auth === `Key ${KEY}` && /^\/(queue\.fal\.run|rest\.fal\.ai)\//.test(e.url)) && front.filter((e) => /^\/(queue\.fal\.run|rest\.fal\.ai)\//.test(e.url) && e.method !== "OPTIONS").every((e) => e.auth), { keyedRequests: keyed.length, storageRequestsWithKey: front.filter((e) => e.auth && /fal\.media/.test(e.url)).length });
	check("no request URL holds the key (provider front + every request the page made)", !front.some((e) => e.url.includes(KEY)) && !net.some((n) => n.url.includes(KEY)), { frontRequests: front.length, pageRequests: net.filter((n) => n.url !== "(extra)").length });
	const hosts = [...new Set(net.filter((n) => n.url !== "(extra)").map((n) => { try { return new URL(n.url).host; } catch { return n.url.slice(0, 5); } }))];
	check("the page talked to itself and the provider only", hosts.every((h) => h === "127.0.0.1:4041" || h === "127.0.0.1:4042" || h === ""), hosts);
	const headerHits = net.flatMap((n) => Object.entries(n.headers ?? {}).filter(([, v]) => String(v).includes(KEY)).map(([k]) => k.toLowerCase()));
	check("in the page's request headers the key is only ever «authorization»", headerHits.length > 0 && headerHits.every((k) => k === "authorization"), [...new Set(headerHits)]);
	check("console: no key", !consoleLines.some((l) => l.includes(KEY)), { lines: consoleLines.length });
	const sd = await ev("__h.storageDump()");
	const local = JSON.parse(sd.local);
	check("storage: the key in its one slot only; not in session storage, cookies or the parked jobs", Object.keys(local).join() === "gz-web-lipsync-key" && !sd.session.includes(KEY) && !sd.cookie.includes(KEY) && !sd.db.includes(KEY), { localKeys: Object.keys(local), dbBytes: sd.db.length });
} catch (error) {
	check("the run itself", false, String(error?.stack ?? error));
} finally {
	fs.writeFileSync(path.join(OUT, "result.json"), JSON.stringify({ results, front: front.length }, null, 1));
	const failed = results.filter((r) => !r.ok).length;
	console.log(`\n${results.length - failed}/${results.length} passed`);
	win.destroy();
	frontServer.close();
	site.close();
	await fake.close();
	app.exit(failed ? 1 : 0);
}
}
