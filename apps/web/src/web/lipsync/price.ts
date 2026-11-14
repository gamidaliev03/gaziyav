// The price of THIS run, from the one table (fal/models.ts): the same formulas the desktop bills by
// (fal/voice.ts voicePrice, fal/lipsync.ts falLipsync), with one honest difference — the whole used span is sent.
import { cents } from "@/studio/client/money";
import { FAL_DEFAULTS, type FalModel, falModel, price } from "@/fal/models";

export const TTS_MODEL = FAL_DEFAULTS.tts;
export const CLONE_MODEL = FAL_DEFAULTS.clone;

/** A lipsync model the page can run (fal's own; kie.ai's and ArgoLink's work only in the app). */
export function webLipModel(id: string | undefined): FalModel | null {
	const m = falModel(id || FAL_DEFAULTS.lipsync);
	return m && m.task === "lipsync" && !m.api ? m : null;
}

/** The voice still to make: the speech, plus a clone when the sample has none yet (fal/voice.ts voicePrice). */
export function voiceUsd(chars: number, clone: boolean): number {
	if (!(chars > 0)) return 0;
	const tts = falModel(TTS_MODEL) as FalModel;
	return price(tts, chars) + (clone ? price(falModel(CLONE_MODEL) as FalModel) : 0);
}

/** The clone's charge for a sample of `seconds` (fal/voice.ts cloneVoice). */
export const cloneUsd = (seconds: number) => price(falModel(CLONE_MODEL) as FalModel, seconds);

/** The seconds a lipsync request is billed by: the longer of the sound and the sent span (fal/lipsync.ts). */
export const billSeconds = (speech: number, span: number) => Math.max(0.5, speech, span);

/** One lipsync request on the whole used span. */
export function lipUsd(model: FalModel, speech: number, span: number): number {
	return price(model, model.id.includes("kling") ? span : billSeconds(speech, span));
}

export interface RunPrice {
	voiceUsd: number;
	lipUsd: number;
	total: number;
	/** «21 ¢» — what the button shows (cents, rounded up, never under the bill). */
	label: string;
	/** The voice is not made yet: the lipsync is priced on its estimate (an upper bound: the span or the estimate). */
	estimated: boolean;
}

export function runPrice(o: { model: FalModel; span: number; speech?: number; estimateSeconds?: number; voice?: { chars: number; clone: boolean }; lang?: "ru" | "en" }): RunPrice {
	const v = o.voice ? voiceUsd(o.voice.chars, o.voice.clone) : 0;
	const speech = o.speech ?? o.estimateSeconds ?? 0;
	const l = lipUsd(o.model, speech, o.span);
	const total = v + l;
	return { voiceUsd: v, lipUsd: l, total, label: cents(total, o.lang ?? "ru"), estimated: o.speech == null };
}

/** A confirmation only above the limit (the desktop's rule B: default 1 $). */
export const needsConfirm = (totalUsd: number, limitUsd = 1) => totalUsd > limitUsd + 1e-9;
