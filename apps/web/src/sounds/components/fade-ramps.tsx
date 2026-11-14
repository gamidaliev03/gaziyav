"use client";

/**
 * The clip's gain envelope drawn over the waveform (CapCut-style): fade ramps and ducking
 * dips as one line, with the part above it shaded. `samples` are the waveform gain samples
 * (volume × fades × ducking), `volume` the clip's base linear gain, so the line shows only
 * what changes over time.
 */
export function GainEnvelope({ samples, volume }: { samples: readonly number[]; volume: number }) {
	const n = samples.length;
	if (n < 2 || volume <= 0) return null;
	const rel = samples.map((g) => Math.max(0, Math.min(1, g / volume)));
	if (rel.every((g) => g > 0.995)) return null;
	const pts: string[] = [];
	for (let i = 0; i < n; i++) {
		const x = ((i + 0.5) / n) * 100;
		const y = (1 - rel[i]) * 100;
		if (i === 0) pts.push(`0,${y.toFixed(2)}`);
		pts.push(`${x.toFixed(3)},${y.toFixed(2)}`);
		if (i === n - 1) pts.push(`100,${y.toFixed(2)}`);
	}
	const line = pts.join(" ");
	return (
		<svg
			className="pointer-events-none absolute inset-0 size-full"
			viewBox="0 0 100 100"
			preserveAspectRatio="none"
			aria-hidden
		>
			<polygon points={`0,0 ${line} 100,0`} fill="rgba(0,0,0,0.4)" />
			<polyline
				points={line}
				fill="none"
				stroke="white"
				strokeOpacity="0.85"
				strokeWidth="1.5"
				vectorEffect="non-scaling-stroke"
			/>
		</svg>
	);
}
