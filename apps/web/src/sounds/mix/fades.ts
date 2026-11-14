// Clip mix settings stored in element params (fade in/out, «Приглушать под голосом»).
// Dependency-free so the timeline (waveform drawing) can use it without import cycles.

export const FADE_MAX_SECONDS = 30;

export interface MixSettings {
	fadeIn: number;
	fadeOut: number;
	duck: boolean;
}

const num = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) ? value : 0;

export function readMixSettings(element: { params: Record<string, unknown> }): MixSettings {
	const p = element.params;
	const clamp = (v: number) => Math.max(0, Math.min(FADE_MAX_SECONDS, v));
	return {
		fadeIn: clamp(num(p.fadeIn)),
		fadeOut: clamp(num(p.fadeOut)),
		duck: p.duckUnderVoice === true,
	};
}

/**
 * Equal-power fade gain at a time inside the clip. When the fades overlap (a short clip),
 * both are scaled down so they meet without a jump.
 */
export function fadeGainAt(settings: MixSettings, localTime: number, duration: number): number {
	let { fadeIn, fadeOut } = settings;
	if (fadeIn + fadeOut > duration && duration > 0) {
		const k = duration / (fadeIn + fadeOut);
		fadeIn *= k;
		fadeOut *= k;
	}
	let g = 1;
	if (fadeIn > 0 && localTime < fadeIn) {
		g *= Math.sin((Math.PI / 2) * Math.max(0, localTime / fadeIn));
	}
	if (fadeOut > 0 && localTime > duration - fadeOut) {
		g *= Math.sin((Math.PI / 2) * Math.max(0, (duration - localTime) / fadeOut));
	}
	return g;
}
