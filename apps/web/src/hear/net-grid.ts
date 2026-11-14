// The beat network (Beat This!, on this Mac: native/local-beats.py) as a referee for the song's grid — not a
// replacement. Measured on nine made songs with known beats and ten library songs with a documented tempo
// but the two fail on different songs. So:
//   • today's grid is steady and at the network's tempo → today's answer, unchanged (nothing moves where both agree);
//   • today's grid is steady at 2× or 3× the network's tempo and the network's bars hold 3 or 4 of today's beats
//     → today's beats, the network's bar starts (a waltz: 3/4 found instead of 4/4 assumed);
//   • today's grid flips between tempo levels, or runs slower than the network's (half-time), or at no whole
//     ratio to it — and the network's own bars are plausible (3 or 4 of its beats) → the network's beats and bars,
//     each beat set on the drum hit it names (the network answers in 20 ms steps);
//   • today's grid flips, the network's beats are steady but its bars are not plausible → the network's beats, the
//     bars placed on them by today's own rule (the caller's: kick on 1, snare on 2 and 4, where the parts come in);
//   • anything else → today's answer.
// With the rule: beats right (F ≥ 0.95) on 8 of 9 made songs (today 6), bar starts (F ≥ 0.90) on 7 of 9 (today 4),
// tempo-level errors 1 (today 3), the library's documented tempo on 8 of 10 (today 5).
// Pure: times in the file's seconds.

export interface NetBeats {
	beats: number[];
	downbeats: number[];
}

export interface TempoStretch {
	start: number;
	end: number;
	bpm: number;
}

export interface Refereed {
	/**
	 * "dsp": today's grid stands. "network-bars": today's beats, the network's bar starts. "network": both from the
	 * network. "network-beats": the network's beats; the bars are the caller's to place on them (`bars` is null).
	 */
	rule: "dsp" | "network-bars" | "network" | "network-beats";
	why: string;
	tempo: TempoStretch[];
	beats: number[];
	/** Bar starts found (not yet continued over the whole song); null: the caller's own ("dsp") or the caller's to place ("network-beats"). */
	bars: number[] | null;
	/** Beats in a bar, when the network counted them. */
	meter: 3 | 4 | null;
	/** Share of bars that hold `meter` beats. */
	confidence: number;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const near = (ratio: number, value: number, tolerance = 0.05) => Math.abs(ratio / value - 1) < tolerance;
/** Steps between tempo levels a tracker takes by mistake: double, half, the triplet relations. */
const LEVELS = [2, 1 / 2, 3, 1 / 3, 3 / 2, 2 / 3, 4 / 3, 3 / 4];

const median = (v: number[]) => {
	const s = [...v].sort((a, b) => a - b);
	return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** The tempo the beats between `a` and `b` keep (the median step between neighbours; breaks and doubles left out). */
export function bpmOf(beats: number[], a = Number.NEGATIVE_INFINITY, b = Number.POSITIVE_INFINITY): number {
	const steps: number[] = [];
	for (let i = 1; i < beats.length; i++) {
		if (beats[i - 1] < a || beats[i] > b) continue;
		const d = beats[i] - beats[i - 1];
		if (d > 0.15 && d < 3) steps.push(d);
	}
	return steps.length ? 60 / median(steps) : 0;
}

/** How many of `beats` a bar of `bars` holds: the usual count and the share of bars that have it. */
export function beatsPerBar(beats: number[], bars: number[]): { count: number; share: number } {
	const counts: number[] = [];
	let i = 0;
	for (let k = 0; k + 1 < bars.length; k++) {
		while (i < beats.length && beats[i] < bars[k] - 0.03) i++;
		let n = 0;
		for (let j = i; j < beats.length && beats[j] < bars[k + 1] - 0.03; j++) n++;
		counts.push(n);
	}
	if (!counts.length) return { count: 0, share: 0 };
	const seen = new Map<number, number>();
	for (const c of counts) seen.set(c, (seen.get(c) ?? 0) + 1);
	const [count, times] = [...seen.entries()].sort((x, y) => y[1] - x[1])[0];
	return { count, share: times / counts.length };
}

const plausible = (m: { count: number; share: number }): m is { count: 3 | 4; share: number } => (m.count === 3 || m.count === 4) && m.share >= 0.75;

/** Each time moved onto the nearest of `targets` within `reach` seconds (sorted lists); kept where none is near. */
export function snapTo(times: number[], targets: number[], reach: number): number[] {
	const out: number[] = [];
	let j = 0;
	for (const t of times) {
		while (j + 1 < targets.length && Math.abs(targets[j + 1] - t) <= Math.abs(targets[j] - t)) j++;
		const v = targets.length && Math.abs(targets[j] - t) <= reach ? targets[j] : t;
		if (!out.length || v > out[out.length - 1] + 0.05) out.push(r3(v));
	}
	return out;
}

/**
 * Bars every `count` beats of a grid, per tempo stretch, from the phase most of `downbeats` fall on (each on the beat
 * nearest it, within half a beat): the network decides where «one» is, not where each bar starts — a stray downbeat
 * (a song's last bars, a fill) neither starts a bar of its own nor teaches the bars after the last one a bar one
 * beat long (fullBars continues the last bar's length).
 */
export function barsEvery(beats: number[], tempo: TempoStretch[], downbeats: number[], count: number): number[] {
	const out: number[] = [];
	tempo.forEach((s, k) => {
		const until = k + 1 < tempo.length ? tempo[k + 1].start - 0.001 : Number.POSITIVE_INFINITY;
		const b = beats.filter((t) => t >= s.start - 0.001 && t < until);
		if (b.length < 2 || !(s.bpm > 0)) return;
		const period = 60 / s.bpm;
		const votes = new Array<number>(count).fill(0);
		let j = 0;
		for (const d of downbeats) {
			if (d < b[0] - period / 2 || d > b[b.length - 1] + period / 2) continue;
			while (j + 1 < b.length && Math.abs(b[j + 1] - d) <= Math.abs(b[j] - d)) j++;
			if (Math.abs(b[j] - d) <= period / 2) votes[j % count]++;
		}
		const phi = votes.indexOf(Math.max(...votes));
		// the bar that began before the stretch's first beat (it opens on beat 2 or later)
		const before = r3(Math.max(0, b[0] - (count - phi) * period));
		if (phi > 0 && (!out.length || before > out[out.length - 1] + (count - 0.5) * period)) out.push(before);
		for (let i = phi; i < b.length; i += count) out.push(b[i]);
	});
	return out;
}

/** The network's own bar starts, a stray one dropped: each kept bar holds at least `count − ½` of its beats. */
export function steadyBars(bars: number[], beats: number[], count: number): number[] {
	const all = bpmOf(beats);
	const out: number[] = [];
	for (const t of bars) {
		const bpm = bpmOf(beats, t - 4, t + 4) || all;
		if (!out.length || !(bpm > 0) || t - out[out.length - 1] >= ((count - 0.5) * 60) / bpm) out.push(t);
	}
	return out;
}

/** Tempo stretches of a list of beats: a new one where the local tempo leaves the stretch's by more than 4 % for eight beats. */
export function tempoOf(beats: number[]): TempoStretch[] {
	if (beats.length < 4) return [];
	const local = (i: number) => bpmOf(beats.slice(Math.max(0, i - 4), i + 5));
	const out: TempoStretch[] = [];
	let from = 0;
	let off = 0;
	for (let i = 0; i <= beats.length; i++) {
		const stretch = bpmOf(beats.slice(from, Math.max(from + 2, i)));
		const moved = i < beats.length && i - from >= 8 && stretch > 0 && Math.abs(local(i) / stretch - 1) > 0.04;
		off = moved ? off + 1 : 0;
		if (i === beats.length || off >= 8) {
			const to = i === beats.length ? i : i - off + 1;
			const bpm = bpmOf(beats.slice(from, to));
			if (bpm > 0) out.push({ start: r3(beats[from]), end: r3(to < beats.length ? beats[to] : beats[beats.length - 1] + 60 / bpm), bpm: Math.round(bpm * 10) / 10 });
			from = to;
			off = 0;
		}
	}
	return out;
}

export function referee(grid: { tempo: TempoStretch[]; beats: number[] }, net: NetBeats | null | undefined, hits: number[] = []): Refereed {
	const keep = (why: string): Refereed => ({ rule: "dsp", why, tempo: grid.tempo, beats: grid.beats, bars: null, meter: null, confidence: 0 });
	if (!net || net.beats.length < 8) return keep("no network answer");
	const own = beatsPerBar(net.beats, net.downbeats);
	const network = (why: string): Refereed => {
		const beats = snapTo(net.beats, hits, 0.03);
		return { rule: "network", why, tempo: tempoOf(beats), beats, bars: steadyBars(snapTo(net.downbeats, beats, 0.12), beats, own.count), meter: own.count as 3 | 4, confidence: Math.round(own.share * 100) / 100 };
	};
	if (grid.beats.length < 8 || !grid.tempo.length) return plausible(own) ? network("today's grid found no beat") : keep("no beat found by either");
	// The network must have heard the stretch today's grid stands on (a network silent over most of it is no referee).
	const span = grid.beats[grid.beats.length - 1] - grid.beats[0];
	const heard = net.beats.filter((t) => t >= grid.beats[0] - 1 && t <= grid.beats[grid.beats.length - 1] + 1);
	if (heard.length < 8 || heard[heard.length - 1] - heard[0] < 0.6 * span) return keep("the network heard too little of the song");
	const flips = grid.tempo.some((t, i) => i > 0 && LEVELS.some((k) => near(t.bpm / grid.tempo[i - 1].bpm, k, 0.06)));
	const main = grid.tempo.reduce((m, t) => (t.end - t.start > m.end - m.start ? t : m));
	const theirs = bpmOf(net.beats, main.start, main.end) || bpmOf(net.beats);
	const ratio = theirs > 0 ? main.bpm / theirs : 0;
	if (!flips && near(ratio, 1)) return keep("both agree on the tempo");
	if (!flips && (near(ratio, 2) || near(ratio, 3))) {
		const counted = beatsPerBar(grid.beats, net.downbeats);
		if (!plausible(counted)) return keep("a faster level than the network's, its own bars kept");
		return { rule: "network-bars", why: `the network counts ${counted.count} of today's beats in a bar`, tempo: grid.tempo, beats: grid.beats, bars: barsEvery(grid.beats, grid.tempo, net.downbeats, counted.count), meter: counted.count, confidence: Math.round(counted.share * 100) / 100 };
	}
	if (!plausible(own)) {
		const beats = snapTo(net.beats, hits, 0.03);
		const tempo = tempoOf(beats);
		const steady = tempo.length > 0 && !tempo.some((t, i) => i > 0 && LEVELS.some((k) => near(t.bpm / tempo[i - 1].bpm, k, 0.06)));
		if (flips && steady) return { rule: "network-beats", why: "today's grid flips between tempo levels; the network's bars are implausible", tempo, beats, bars: null, meter: null, confidence: 0 };
		return keep("the network's bars are implausible");
	}
	return network(flips ? "today's grid flips between tempo levels" : `today's grid runs at ${ratio.toFixed(2)}× the network's tempo`);
}
