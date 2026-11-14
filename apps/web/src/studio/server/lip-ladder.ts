// The model ladder for THIS clip (rule L's pre-flight, rule H's data): every face the check saw with a judgement, each
// lipsync model reachable through the fal key with its price for this clip (the same plan the run uses), and which one
// the checks recommend — the reason as a key the page translates. Pure.
import { FAL_MODELS, type FalModel } from "@/fal/models";
import { type Plan, type PlanInput, planLipsync, wholePlan } from "./lip-plan";
import type { SeenFace } from "./media";

export type SizeClass = "small" | "medium" | "large";
export type AngleClass = "frontal" | "turned" | "profile";
export type Occlusion = "none" | "hand" | "partial";

export interface FaceJudgement {
	/** Left to right: the same face keeps its number between checks of the same clip. */
	index: number;
	/** 0…1 of the frame, top-left origin. */
	box: [number, number, number, number];
	/** The face's width in pixels of the source. */
	px: number;
	size: SizeClass;
	angle: AngleClass;
	occlusion: Occlusion;
	/** The biggest face (the one the model and the composite take). */
	main: boolean;
	/** Sampled frames it was in, of `of`. */
	hits: number;
	of: number;
}

/** Radians of head turn: under 20° facing the camera, under 40° turned, beyond that a profile. */
const TURNED = 0.35;
const PROFILE = 0.7;

export function judgeFaces(faces: SeenFace[], frame: { width: number; height: number }, sampled = 5): FaceJudgement[] {
	const seen = faces.filter((f) => f.hits > 0 && f.box[2] > 0);
	const biggest = seen.reduce<SeenFace | null>((m, f) => (!m || f.box[2] * f.box[3] > m.box[2] * m.box[3] ? f : m), null);
	return [...seen]
		.sort((a, b) => a.box[0] + a.box[2] / 2 - (b.box[0] + b.box[2] / 2))
		.map((f, index) => {
			const px = Math.round(f.box[2] * frame.width);
			return {
				index,
				box: f.box,
				px,
				size: px < 120 || f.box[2] < 0.1 ? "small" : px < 260 ? "medium" : "large",
				angle: Math.abs(f.yaw) >= PROFILE ? "profile" : Math.abs(f.yaw) >= TURNED ? "turned" : "frontal",
				occlusion: f.hand ? "hand" : f.conf < 0.5 ? "partial" : "none",
				main: f === biggest,
				hits: f.hits,
				of: sampled,
			};
		});
}

/** Why a model is recommended (keys for the page): the hardest thing the checks saw decides. */
export type Reason = "hand_at_mouth" | "face_profile" | "faces_several" | "face_small" | "face_turned" | "draft_ok" | "no_face";

const STRONG = "fal-ai/sync-lipsync/v2";
const DETAIL = "fal-ai/sync-lipsync/v2/pro";
const DRAFT = "fal-ai/latentsync";

export function recommend(faces: FaceJudgement[]): { id: string; reason: Reason } {
	const main = faces.find((f) => f.main);
	if (!main) return { id: DRAFT, reason: "no_face" };
	if (main.occlusion !== "none") return { id: DETAIL, reason: "hand_at_mouth" };
	if (main.angle === "profile") return { id: STRONG, reason: "face_profile" };
	// a second face seen in at least two of the sampled frames: another person, not a flicker of the detector
	if (faces.filter((f) => f.hits >= 2).length > 1) return { id: STRONG, reason: "faces_several" };
	if (main.size === "small") return { id: STRONG, reason: "face_small" };
	if (main.angle === "turned") return { id: STRONG, reason: "face_turned" };
	return { id: DRAFT, reason: "draft_ok" };
}

export interface Rung {
	id: string;
	title: string;
	/** The price shape, as models.ts states it. */
	unit: FalModel["unit"];
	unitUsd: number;
	included?: number;
	extra?: number;
	minSeconds?: number;
	maxSeconds?: number;
	minSide?: number;
	lipFor: string[];
	/** For this clip: the plan's price, requests and seconds sent with this model. */
	usd: number;
	requests: number;
	seconds: number;
	/** Usable for this clip; else why not (a key). */
	fits: boolean;
	why?: "needs_720p" | "too_short";
}

/** The lipsync models on fal (the key the owner has), cheapest for this clip first. */
export function ladder(o: { plan: Omit<PlanInput, "model">; pieces: boolean; side: number }): Rung[] {
	return FAL_MODELS.filter((m) => m.task === "lipsync" && !m.api)
		.map((m): Rung => {
			const p: Plan = o.pieces ? planLipsync({ ...o.plan, model: m }) : wholePlan({ ...o.plan, model: m });
			const fits = !(m.minSide && o.side > 0 && o.side < m.minSide);
			return {
				id: m.id,
				title: m.title,
				unit: m.unit,
				unitUsd: m.usd,
				included: m.included,
				extra: m.extra,
				minSeconds: m.minSeconds,
				maxSeconds: m.maxSeconds,
				minSide: m.minSide,
				lipFor: m.lipFor ?? [],
				usd: p.usd,
				requests: p.requests.length,
				seconds: p.secondsSent,
				fits,
				...(fits ? {} : { why: "needs_720p" as const }),
			};
		})
		.sort((a, b) => a.usd - b.usd);
}

/**
 * The model a sample runs on (rule E): the cheapest per-second lipsync model of the table for `seconds` (a per-request
 * floor makes a 3 s sample cost a whole take). Null when none is cheaper than the full model's first request.
 */
export function sampleModel(seconds: number, full: FalModel, firstRequestUsd: number): { model: FalModel; usd: number } | null {
	const per = FAL_MODELS.filter((m) => m.task === "lipsync" && !m.api && m.unit === "second").map((m) => ({ model: m, usd: m.usd * Math.max(1, seconds) }));
	const best = per.sort((a, b) => a.usd - b.usd)[0];
	if (!best || best.usd >= firstRequestUsd) return null;
	return best.model.id === full.id ? { model: full, usd: best.usd } : best;
}
