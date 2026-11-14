// The ffmpeg filter graph that plays the project's sound pieces as the timeline does (gains, fades, speed, music
// ducked under speech) into EBU R128 meters: the whole mix, plus speech alone and music alone when the mix has both.
// Pure, so every labelled output is checked to be used once (an unconnected split fails the whole graph).

export interface MixPart {
	key?: string;
	library?: string;
	from: number;
	to: number;
	at: number;
	gainDb: number;
	fadeIn: number;
	fadeOut: number;
	rate: number;
	role: "speech" | "music" | "other";
	duck: boolean;
}

const f3 = (v: number) => (Math.round(v * 1000) / 1000).toString();

export function mixGraph(usable: Array<{ p: MixPart; file: string }>, total: number, speech: Array<[number, number]>): { files: string[]; chains: string[]; outputs: string[]; both: boolean } {
	const files = [...new Set(usable.map((x) => x.file))];
	const uses = files.map((f) => usable.filter((x) => x.file === f).length);
	const chains: string[] = [];
	for (const k of files.keys()) chains.push(`[${k}:a]asplit=${uses[k]}${Array.from({ length: uses[k] }, (_, j) => `[s${k}_${j}]`).join("")}`);
	const counters = files.map(() => 0);
	const both = usable.some((x) => x.p.role === "speech") && usable.some((x) => x.p.role === "music");
	const duckExpr = speech.length ? speech.map(([a, b]) => `between(t,${f3(a)},${f3(b)})`).join("+") : "";
	const groups: Record<"all" | "speech" | "music", string[]> = { all: [], speech: [], music: [] };
	usable.forEach(({ p, file }, i) => {
		const k = files.indexOf(file);
		const j = counters[k]++;
		const len = (p.to - p.from) / Math.max(0.05, p.rate);
		const tempo = Math.max(0.5, Math.min(100, p.rate));
		const filters = [
			`atrim=start=${f3(p.from)}:end=${f3(p.to)}`,
			"asetpts=PTS-STARTPTS",
			...(Math.abs(tempo - 1) > 0.001 ? [`atempo=${f3(tempo)}`] : []),
			"aformat=sample_rates=48000:channel_layouts=stereo",
			`volume=${f3(p.gainDb)}dB`,
			...(p.fadeIn > 0 ? [`afade=t=in:d=${f3(Math.min(p.fadeIn, len / 2))}:curve=qsin`] : []),
			...(p.fadeOut > 0 ? [`afade=t=out:st=${f3(Math.max(0, len - Math.min(p.fadeOut, len / 2)))}:d=${f3(Math.min(p.fadeOut, len / 2))}:curve=qsin`] : []),
			`adelay=${Math.round(p.at * 1000)}:all=1`,
			...(p.duck && duckExpr ? [`volume=-12dB:enable='${duckExpr}'`] : []),
		];
		const into = !both ? null : p.role === "speech" ? "speech" : p.role === "music" ? "music" : null;
		const outs = into ? 2 : 1;
		chains.push(`[s${k}_${j}]${filters.join(",")},asplit=${outs}[a${i}]${into ? `[b${i}]` : ""}`);
		groups.all.push(`[a${i}]`);
		if (into) groups[into].push(`[b${i}]`);
	});
	const mix = (list: string[], tag: string, tail: string) => {
		if (!list.length) return;
		chains.push(`${list.join("")}${list.length > 1 ? `amix=inputs=${list.length}:normalize=0:duration=longest:dropout_transition=0,` : ""}apad,atrim=end=${f3(total)},${tail}[o_${tag}]`);
	};
	mix(groups.all, "all", "asplit=2[pre_all][sil];[pre_all]ebur128=peak=true");
	chains.push("[sil]silencedetect=n=-70dB:d=0.15[o_sil]");
	if (both) {
		mix(groups.speech, "speech", "ebur128");
		mix(groups.music, "music", "ebur128");
	}
	const outputs = ["o_all", "o_sil", ...(both ? ["o_speech", "o_music"] : [])];
	return { files, chains, outputs, both };
}
