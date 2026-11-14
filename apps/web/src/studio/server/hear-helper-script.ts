// The hearing models' own process. studio/server/hear-models.ts writes this script to the app's data folder and starts
// it with the app's runtime (Electron as Node), at low priority: transformers.js + ONNX Runtime on two threads. A model
// never runs in the app's server itself — ONNX Runtime blocks the thread that calls it (measured: up to 1 s per window),
// and the server must keep answering the editor. One JSON request per line on stdin, one answer per line on stdout
// (progress lines in between); the process quits after two idle minutes, or when the server goes away (stdin closes),
// and its memory goes with it.
//
// Requests: { id, op: "windows", file, items: [{ t, len }], clap?, tags? } → { windows: [{ t, len, e?, g? }] } where e is
// the CLAP sound embedding (unit length, float32, base64) and g the AudioSet tagger's top labels [label, probability]
// (sigmoid: each label on its own, as AudioSet is multi-label); { id, op: "texts", texts } → { e: [base64…] } (CLAP text
// embeddings); { id, op: "stats" } → { rss }; { op: "cancel", of } stops a running request between windows; { op: "quit" }.
// (No backquotes or dollar-brace in here: the script is a template-free string.)
export const HEAR_HELPER_SCRIPT = String.raw`import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

const cfg = JSON.parse(process.argv[2] || "{}");
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
const say = (e) => String((e && e.message) || e);

let t;
try {
	t = await import(pathToFileURL(cfg.transformers).href);
} catch (e) {
	send({ fatal: "The hearing runtime didn't load: " + say(e) });
	process.exit(3);
}
t.env.localModelPath = cfg.models.endsWith(path.sep) ? cfg.models : cfg.models + path.sep;
t.env.allowRemoteModels = false;
t.env.allowLocalModels = true;
const opts = { dtype: "q8", session_options: { intraOpNumThreads: cfg.threads || 2, interOpNumThreads: 1 } };

let clap = null;
let tagger = null;
function getClap() {
	if (!clap) {
		clap = Promise.all([
			t.AutoProcessor.from_pretrained(cfg.clap),
			t.ClapAudioModelWithProjection.from_pretrained(cfg.clap, opts),
			t.AutoTokenizer.from_pretrained(cfg.clap),
			t.ClapTextModelWithProjection.from_pretrained(cfg.clap, opts),
		]).then(([processor, audio, tokenizer, text]) => ({ processor, audio, tokenizer, text }));
		clap.catch(() => {
			clap = null;
		});
	}
	return clap;
}
function getTagger() {
	if (!tagger) {
		tagger = Promise.all([t.AutoFeatureExtractor.from_pretrained(cfg.tagger), t.AutoModelForAudioClassification.from_pretrained(cfg.tagger, opts)]).then(([fe, model]) => ({ fe, model, labels: model.config.id2label }));
		tagger.catch(() => {
			tagger = null;
		});
	}
	return tagger;
}

function unit(v) {
	let n = 0;
	for (let i = 0; i < v.length; i++) n += v[i] * v[i];
	n = Math.sqrt(n) || 1;
	const out = new Float32Array(v.length);
	for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
	return Buffer.from(out.buffer).toString("base64");
}

function decode(file, from, length, rate) {
	return new Promise((resolve, reject) => {
		const args = ["-hide_banner", "-loglevel", "error", "-nostdin"];
		if (from > 0) args.push("-ss", from.toFixed(3));
		args.push("-i", file, "-t", Math.max(0.05, length).toFixed(3), "-vn", "-sn", "-dn", "-ac", "1", "-ar", String(rate), "-f", "f32le", "pipe:1");
		const child = spawn(cfg.ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] });
		const parts = [];
		let err = "";
		child.stdout.on("data", (d) => parts.push(d));
		child.stderr.on("data", (d) => {
			err += d;
		});
		child.on("error", reject);
		child.on("close", (code) => {
			const b = Buffer.concat(parts);
			if (code !== 0 && !b.length) return reject(new Error("Couldn't read the sound: " + (err.trim().split("\n").pop() || code)));
			const out = new Float32Array(Math.floor(b.length / 4));
			new Uint8Array(out.buffer).set(b.subarray(0, out.length * 4));
			resolve(out);
		});
	});
}

const cancelled = new Set();
const yieldNow = () => new Promise((r) => setImmediate(r));

async function windows(req) {
	const items = (req.items || []).map((w) => ({ t: Number(w.t), len: Number(w.len) })).filter((w) => w.t >= 0 && w.len > 0.05).sort((a, b) => a.t - b.t);
	const m = req.clap ? await getClap() : null;
	const g = req.tags ? await getTagger() : null;
	// Windows that overlap are decoded together.
	const runs = [];
	for (const w of items) {
		const last = runs[runs.length - 1];
		if (last && w.t <= last.end) {
			last.items.push(w);
			last.end = Math.max(last.end, w.t + w.len);
		} else runs.push({ from: w.t, end: w.t + w.len, items: [w] });
	}
	const out = [];
	let done = 0;
	for (const run of runs) {
		const a48 = m ? await decode(req.file, run.from, run.end - run.from, 48000) : null;
		const a16 = g ? await decode(req.file, run.from, run.end - run.from, 16000) : null;
		for (const w of run.items) {
			if (cancelled.has(req.id)) throw new Error("Cancelled");
			const r = { t: w.t, len: w.len };
			if (a48) {
				const x = a48.subarray(Math.round((w.t - run.from) * 48000), Math.round((w.t - run.from + w.len) * 48000));
				if (x.length >= 2400) r.e = unit((await m.audio(await m.processor(x))).audio_embeds.data);
			}
			if (a16) {
				const x = a16.subarray(Math.round((w.t - run.from) * 16000), Math.round((w.t - run.from + w.len) * 16000));
				if (x.length >= 800) {
					const logits = (await g.model(await g.fe(x))).logits.data;
					const top = [];
					for (let i = 0; i < logits.length; i++) top.push([i, 1 / (1 + Math.exp(-logits[i]))]);
					top.sort((a, b) => b[1] - a[1]);
					r.g = top.slice(0, 12).map(([i, p]) => [String(g.labels[i]), Math.round(p * 1000) / 1000]);
					// A song's instruments, voices, genres and moods sit lower than the top 12: down to 2 %.
					if (req.music) r.m = top.filter(([, p]) => p >= 0.02).slice(0, 60).map(([i, p]) => [String(g.labels[i]), Math.round(p * 1000) / 1000]);
				}
			}
			out.push(r);
			done++;
			send({ id: req.id, progress: done / items.length });
			await yieldNow();
		}
	}
	return { windows: out };
}

// One text at a time: the ONNX text encoder takes input_ids only (no attention mask), so padding in a batch would change
// every shorter text's embedding (measured: «Speech» padded vs alone, cosine 0.90).
async function texts(req) {
	const m = await getClap();
	const list = (req.texts || []).map(String);
	const e = [];
	for (let i = 0; i < list.length; i++) {
		if (cancelled.has(req.id)) throw new Error("Cancelled");
		const o = await m.text(m.tokenizer([list[i]], { truncation: true }));
		e.push(unit(o.text_embeds.data));
		if (i % 16 === 15) await yieldNow();
	}
	return { e };
}

// ONNX Runtime aborts in its exit-time destructors on macOS («mutex lock failed», measured even after dispose()), and
// an abort leaves a crash report: the process ends itself with SIGKILL instead (no destructors run; the system frees
// the memory), after saying goodbye.
function quit() {
	process.stdout.write(JSON.stringify({ bye: true }) + "\n", () => process.kill(process.pid, "SIGKILL"));
	setTimeout(() => process.kill(process.pid, "SIGKILL"), 500);
	return new Promise(() => {});
}

let idle = null;
let chain = Promise.resolve();
const arm = () => {
	if (idle) clearTimeout(idle);
	idle = setTimeout(() => {
		chain = chain.then(quit);
	}, cfg.idleMs || 120000);
};
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
	let req;
	try {
		req = JSON.parse(line);
	} catch {
		return;
	}
	if (req.op === "cancel") {
		cancelled.add(req.of);
		return;
	}
	chain = chain.then(async () => {
		if (idle) clearTimeout(idle);
		try {
			let r;
			if (req.op === "windows") r = await windows(req);
			else if (req.op === "texts") r = await texts(req);
			else if (req.op === "stats") r = { rss: process.memoryUsage().rss };
			else if (req.op === "quit") await quit();
			else throw new Error("Unknown request");
			send(Object.assign({ id: req.id, ok: true }, r));
		} catch (e) {
			send({ id: req.id, ok: false, error: say(e) });
		} finally {
			cancelled.delete(req.id);
			arm();
		}
	});
});
rl.on("close", () => {
	chain = chain.then(quit);
});
send({ ready: true, pid: process.pid });
arm();
`;
