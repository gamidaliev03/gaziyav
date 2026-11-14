#!/usr/bin/env node
// Synthesizes the bundled sound-effects pack (public/sfx) from scratch: noise, oscillators and
// filters only, no samples, so every file is our own work and is released under CC0 1.0.
// Deterministic (seeded noise): running it again produces identical files.
//   node apps/web/scripts/generate-sfx.mjs
import fs from "node:fs";
import path from "node:path";

const SR = 44100;
const OUT = path.join(import.meta.dirname, "..", "public", "sfx");

// --- primitives ---------------------------------------------------------------------------

function rng(seed) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const buf = (seconds) => new Float32Array(Math.round(seconds * SR));

/** RBJ biquad with per-sample frequency (state-variable style update every 16 samples). */
function biquad(type) {
	let b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
	let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
	return {
		set(freq, q = 0.707, gainDb = 0) {
			const w = (2 * Math.PI * Math.min(freq, SR * 0.45)) / SR;
			const cos = Math.cos(w);
			const alpha = Math.sin(w) / (2 * q);
			let a0;
			if (type === "bandpass") {
				b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
			} else if (type === "lowpass") {
				b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
			} else if (type === "highpass") {
				b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
			} else {
				const A = 10 ** (gainDb / 40);
				b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
			}
			b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
		},
		run(x) {
			const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
			x2 = x1; x1 = x; y2 = y1; y1 = y;
			return y;
		},
	};
}

const lerp = (a, b, t) => a + (b - a) * t;
const expLerp = (a, b, t) => a * (b / a) ** t;
/** Attack/decay envelope, times in seconds. */
const ad = (t, attack, decay, curve = 3) =>
	t < attack ? t / attack : Math.exp((-(t - attack) / decay) * curve);

function normalize(x, peakDb = -1) {
	let peak = 0;
	for (const v of x) peak = Math.max(peak, Math.abs(v));
	const g = peak > 0 ? 10 ** (peakDb / 20) / peak : 1;
	for (let i = 0; i < x.length; i++) x[i] *= g;
	// Short fades at both ends (no clicks): 0.5 ms in, up to 5 ms out.
	const fin = Math.max(1, Math.round(0.0005 * SR));
	const fout = Math.min(Math.round(0.005 * SR), Math.round(x.length * 0.05));
	for (let i = 0; i < fin; i++) x[i] *= i / fin;
	for (let i = 0; i < fout; i++) x[x.length - 1 - i] *= i / fout;
	return x;
}

function add(dst, src, at = 0, gain = 1) {
	const o = Math.round(at * SR);
	for (let i = 0; i < src.length && o + i < dst.length; i++) dst[o + i] += src[i] * gain;
	return dst;
}

/** Small feedback-delay "room" so dry hits do not sound sterile. */
function room(x, mix = 0.18, time = 0.037, fb = 0.45) {
	const d = Math.round(time * SR);
	const d2 = Math.round(time * 1.37 * SR);
	const y = new Float32Array(x.length);
	for (let i = 0; i < x.length; i++) {
		const a = i >= d ? y[i - d] : 0;
		const b = i >= d2 ? y[i - d2] : 0;
		y[i] = x[i] + fb * 0.5 * (a + b);
	}
	for (let i = 0; i < x.length; i++) x[i] = x[i] * (1 - mix) + y[i] * mix;
	return x;
}

// --- sounds -------------------------------------------------------------------------------

function whoosh({ seconds = 0.45, from = 250, to = 5500, q = 1.6, seed = 1 }) {
	const r = rng(seed);
	const x = buf(seconds);
	const bp = biquad("bandpass");
	const bp2 = biquad("bandpass");
	for (let i = 0; i < x.length; i++) {
		const t = i / x.length;
		if (i % 16 === 0) {
			const f = expLerp(from, to, t ** 0.8);
			bp.set(f, q);
			bp2.set(f * 1.5, q * 1.3);
		}
		const n = r() * 2 - 1;
		const env = Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 2;
		x[i] = (bp.run(n) + 0.5 * bp2.run(n)) * env;
	}
	return normalize(x, -2);
}

function impact({ seconds = 1.2, seed = 2 }) {
	const r = rng(seed);
	const x = buf(seconds);
	let ph = 0;
	const lp = biquad("lowpass");
	lp.set(2200, 0.7);
	for (let i = 0; i < x.length; i++) {
		const t = i / SR;
		const f = expLerp(70, 38, Math.min(1, t / 0.6));
		ph += (2 * Math.PI * f) / SR;
		const body = Math.sin(ph) * ad(t, 0.002, 0.55, 2.2);
		const crack = lp.run(r() * 2 - 1) * ad(t, 0.0005, 0.06, 3);
		x[i] = Math.tanh(1.6 * (body + 0.7 * crack));
	}
	return normalize(room(x, 0.2, 0.045, 0.5), -1);
}

function punch({ seconds = 0.35, seed = 3 }) {
	const r = rng(seed);
	const x = buf(seconds);
	let ph = 0;
	const bp = biquad("bandpass");
	bp.set(1800, 0.9);
	for (let i = 0; i < x.length; i++) {
		const t = i / SR;
		ph += (2 * Math.PI * expLerp(140, 55, Math.min(1, t / 0.12))) / SR;
		const body = Math.sin(ph) * ad(t, 0.001, 0.12, 2.5);
		const snap = bp.run(r() * 2 - 1) * ad(t, 0.0003, 0.025, 3);
		x[i] = Math.tanh(2 * (body + snap));
	}
	return normalize(x, -1);
}

function pop({ seconds = 0.12, from = 950, to = 280 }) {
	const x = buf(seconds);
	let ph = 0;
	for (let i = 0; i < x.length; i++) {
		const t = i / SR;
		ph += (2 * Math.PI * expLerp(from, to, Math.min(1, t / 0.05))) / SR;
		x[i] = Math.sin(ph) * ad(t, 0.0015, 0.045, 3);
	}
	return normalize(x, -2);
}

function click({ seed = 4 }) {
	const r = rng(seed);
	const x = buf(0.05);
	const hp = biquad("highpass");
	hp.set(2500, 0.7);
	let ph = 0;
	for (let i = 0; i < x.length; i++) {
		const t = i / SR;
		ph += (2 * Math.PI * 3200) / SR;
		x[i] = hp.run(r() * 2 - 1) * ad(t, 0.0002, 0.004, 3) + 0.4 * Math.sin(ph) * ad(t, 0.0005, 0.012, 3);
	}
	return normalize(x, -3);
}

function riser({ seconds = 2.6, seed = 5 }) {
	const r = rng(seed);
	const x = buf(seconds);
	const bp = biquad("bandpass");
	let ph1 = 0;
	let ph2 = 0;
	for (let i = 0; i < x.length; i++) {
		const t = i / x.length;
		const f = expLerp(180, 2400, t ** 1.6);
		if (i % 16 === 0) bp.set(f * 2, 2.5);
		ph1 += (2 * Math.PI * f) / SR;
		ph2 += (2 * Math.PI * f * 1.006) / SR;
		const saw = ((ph1 / Math.PI) % 2) - 1 + (((ph2 / Math.PI) % 2) - 1);
		const env = t ** 2.2 * (t > 0.985 ? (1 - t) / 0.015 : 1);
		x[i] = (0.35 * saw + 1.2 * bp.run(r() * 2 - 1)) * env;
	}
	return normalize(x, -2);
}

function downlifter({ seconds = 2.2, seed = 6 }) {
	const r = rng(seed);
	const x = buf(seconds);
	const bp = biquad("bandpass");
	let ph = 0;
	for (let i = 0; i < x.length; i++) {
		const t = i / x.length;
		const f = expLerp(2200, 70, t ** 0.7);
		if (i % 16 === 0) bp.set(f * 1.8, 1.8);
		ph += (2 * Math.PI * f) / SR;
		const env = (1 - t) ** 1.6 * Math.min(1, t * 60);
		x[i] = (0.6 * Math.sin(ph) + bp.run(r() * 2 - 1)) * env;
	}
	return normalize(x, -2);
}

function glitch({ seconds = 0.55, seed = 7 }) {
	const r = rng(seed);
	const x = buf(seconds);
	let i = 0;
	while (i < x.length) {
		const len = Math.round((0.015 + r() * 0.05) * SR);
		const kind = Math.floor(r() * 4);
		const f = 120 + r() * 2400;
		let ph = 0;
		const hold = 1 + Math.floor(r() * 12); // sample-and-hold "bitcrush"
		let held = 0;
		for (let k = 0; k < len && i < x.length; k++, i++) {
			ph += (2 * Math.PI * f) / SR;
			let v = 0;
			if (kind === 0) v = Math.sign(Math.sin(ph));
			else if (kind === 1) v = r() * 2 - 1;
			else if (kind === 2) v = Math.sin(ph) * Math.sign(Math.sin(ph * 0.25));
			else v = 0;
			if (k % hold === 0) held = Math.round(v * 6) / 6;
			x[i] = held * 0.8;
		}
	}
	const lp = biquad("lowpass");
	lp.set(6000, 0.7);
	for (let k = 0; k < x.length; k++) x[k] = lp.run(x[k]);
	return normalize(x, -9);
}

function bell({ seconds = 1.8, f0 = 1046.5 }) {
	const x = buf(seconds);
	const partials = [
		[1, 1, 1.4],
		[2.76, 0.5, 0.8],
		[5.4, 0.28, 0.45],
		[8.93, 0.16, 0.25],
		[0.5, 0.2, 1.8],
	];
	for (let i = 0; i < x.length; i++) {
		const t = i / SR;
		let v = 0;
		for (const [m, a, d] of partials) v += a * Math.sin(2 * Math.PI * f0 * m * t) * ad(t, 0.002, d, 2.5);
		x[i] = v;
	}
	return normalize(x, -2);
}

function chime() {
	const a = bell({ seconds: 1.3, f0: 1318.5 });
	const b = bell({ seconds: 1.5, f0: 987.8 });
	const x = buf(1.7);
	add(x, a, 0, 0.8);
	add(x, b, 0.16, 0.8);
	return normalize(x, -2);
}

function shutter({ seed = 8 }) {
	const r = rng(seed);
	const x = buf(0.3);
	const one = (start, len, freq) => {
		const bp = biquad("bandpass");
		bp.set(freq, 1.2);
		const s = Math.round(start * SR);
		for (let i = 0; i < Math.round(len * SR) && s + i < x.length; i++) {
			const t = i / SR;
			x[s + i] += bp.run(r() * 2 - 1) * ad(t, 0.0005, len / 3, 3);
		}
	};
	one(0, 0.04, 3800);
	one(0.004, 0.03, 1200);
	one(0.11, 0.05, 2600);
	one(0.114, 0.04, 900);
	return normalize(room(x, 0.12, 0.012, 0.3), -2);
}

function typing({ seconds = 1.6, seed = 9 }) {
	const r = rng(seed);
	const x = buf(seconds);
	let t = 0.02;
	while (t < seconds - 0.08) {
		const key = buf(0.06);
		const bp = biquad("bandpass");
		bp.set(1800 + r() * 2200, 1.5);
		const lp = biquad("lowpass");
		lp.set(500, 0.8);
		for (let i = 0; i < key.length; i++) {
			const tt = i / SR;
			const n = r() * 2 - 1;
			key[i] = bp.run(n) * ad(tt, 0.0003, 0.008, 3) + 0.6 * lp.run(n) * ad(tt, 0.001, 0.02, 3);
		}
		add(x, key, t, 0.6 + r() * 0.4);
		t += 0.07 + r() * 0.13;
	}
	return normalize(x, -1);
}

function subDrop({ seconds = 1.6 }) {
	const x = buf(seconds);
	let ph = 0;
	for (let i = 0; i < x.length; i++) {
		const t = i / SR;
		ph += (2 * Math.PI * expLerp(95, 32, Math.min(1, t / 1.2))) / SR;
		x[i] = Math.tanh(1.4 * Math.sin(ph)) * ad(t, 0.004, 0.9, 2);
	}
	return normalize(x, -1);
}

function notify() {
	const x = buf(0.6);
	const tone = (f, at, len) => {
		const s = Math.round(at * SR);
		for (let i = 0; i < Math.round(len * SR) && s + i < x.length; i++) {
			const t = i / SR;
			x[s + i] += (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t)) * ad(t, 0.003, 0.18, 3);
		}
	};
	tone(880, 0, 0.35);
	tone(1318.5, 0.12, 0.45);
	return normalize(x, -2);
}

function swipe({ seed = 10 }) {
	return whoosh({ seconds: 0.22, from: 900, to: 9000, q: 2.2, seed });
}

// --- pack ---------------------------------------------------------------------------------

const PACK = [
	["whoosh.wav", "Вжух", "Whoosh", "transitions", ["whoosh", "вжух", "переход", "transition", "air"], () => whoosh({})],
	["whoosh-long.wav", "Вжух длинный", "Long whoosh", "transitions", ["whoosh", "вжух", "переход", "slow"], () => whoosh({ seconds: 0.9, from: 150, to: 4000, q: 1.2, seed: 11 })],
	["swoosh.wav", "Свуш", "Swoosh", "transitions", ["swoosh", "свуш", "свайп", "swipe", "быстрый"], () => swipe({})],
	["impact.wav", "Удар", "Impact", "impacts", ["impact", "hit", "удар", "бум", "boom"], () => impact({})],
	["punch.wav", "Удар короткий", "Punch hit", "impacts", ["punch", "hit", "удар", "акцент"], () => punch({})],
	["sub-drop.wav", "Саб-дроп", "Sub drop", "impacts", ["sub", "drop", "бас", "bass", "бум"], () => subDrop({})],
	["pop.wav", "Поп", "Pop", "ui", ["pop", "поп", "пузырь", "bubble"], () => pop({})],
	["pop-high.wav", "Поп высокий", "High pop", "ui", ["pop", "поп", "появление"], () => pop({ from: 1600, to: 600, seconds: 0.09 })],
	["click.wav", "Клик", "Click", "ui", ["click", "клик", "щелчок", "tap", "кнопка"], () => click({})],
	["riser.wav", "Нарастание", "Riser", "transitions", ["riser", "нарастание", "подъём", "build", "напряжение"], () => riser({})],
	["downlifter.wav", "Спад", "Downlifter", "transitions", ["downlifter", "спад", "падение", "fall"], () => downlifter({})],
	["glitch.wav", "Глитч", "Glitch", "glitch", ["glitch", "глитч", "сбой", "цифровой", "digital"], () => glitch({})],
	["ding.wav", "Дзынь", "Ding", "ui", ["bell", "ding", "колокольчик", "звонок", "дзынь"], () => bell({})],
	["chime.wav", "Перезвон", "Chime", "ui", ["chime", "bell", "колокольчик", "успех", "success"], () => chime()],
	["notification.wav", "Уведомление", "Notification", "ui", ["notification", "уведомление", "сообщение", "message"], () => notify()],
	["shutter.wav", "Затвор камеры", "Camera shutter", "everyday", ["camera", "shutter", "камера", "фото", "затвор"], () => shutter({})],
	["typing.wav", "Печать на клавиатуре", "Keyboard typing", "everyday", ["typing", "keyboard", "печать", "клавиатура", "текст"], () => typing({})],
];

function wav(samples) {
	const data = Buffer.alloc(samples.length * 2);
	for (let i = 0; i < samples.length; i++) {
		data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), i * 2);
	}
	const head = Buffer.alloc(44);
	head.write("RIFF", 0);
	head.writeUInt32LE(36 + data.length, 4);
	head.write("WAVE", 8);
	head.write("fmt ", 12);
	head.writeUInt32LE(16, 16);
	head.writeUInt16LE(1, 20);
	head.writeUInt16LE(1, 22);
	head.writeUInt32LE(SR, 24);
	head.writeUInt32LE(SR * 2, 28);
	head.writeUInt16LE(2, 32);
	head.writeUInt16LE(16, 34);
	head.write("data", 36);
	head.writeUInt32LE(data.length, 40);
	return Buffer.concat([head, data]);
}

fs.mkdirSync(OUT, { recursive: true });
const index = [];
for (const [file, name, en, cat, tags, make] of PACK) {
	const x = make();
	fs.writeFileSync(path.join(OUT, file), wav(x));
	index.push({ file, name, en, cat, tags, dur: Math.round((x.length / SR) * 1000) / 1000 });
}
fs.writeFileSync(path.join(OUT, "index.json"), `${JSON.stringify(index, null, "\t")}\n`);
fs.writeFileSync(
	path.join(OUT, "LICENSE.txt"),
	`Gaziyav basic sound effects
=================================

All files in this folder were synthesized from scratch by apps/web/scripts/generate-sfx.mjs
(oscillators, seeded noise and filters; no recordings or third-party samples were used).

To the extent possible under law, the authors have waived all copyright and related or
neighboring rights to these sound effects, releasing them under
Creative Commons CC0 1.0 Universal (https://creativecommons.org/publicdomain/zero/1.0/).
You may use them in any project, including commercial advertising, without attribution.
`,
);
console.log(`Wrote ${index.length} sounds to ${OUT}`);
