// The agent's paid picture for the AI Composition: when its plan needs a picture nobody has, fal.ai makes it (the
// first image model of the catalog, the project's frame shape) after the user's OK on the price (usePoint.start asks).
import { type PointJob, pointModels, usePoint } from "./client";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The agent has no extra tools from an account any more (fal's generations are its own tools, agent/tools.ts). */
export async function pointAgentTools(_signal?: AbortSignal): Promise<Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }>> {
	return [];
}
export const isPointMcpTool = (_name: string) => false;
export const pointMcpLabel = (name: string) => name;
export async function runPointMcpTool(_name: string, _rawArgs: string, _signal: AbortSignal): Promise<{ ok: boolean; content: string; images?: string[] }> {
	return { ok: false, content: "Error: This tool isn't available." };
}

/** A picture for the AI Composition. Null when the user didn't allow the price. */
export async function pointPicture(prompt: string, portrait: boolean): Promise<File | null> {
	const model = (await pointModels("image"))[0];
	if (!model) throw new Error("No picture model is available.");
	const aspects = model.limits?.supported_aspect_ratios ?? [];
	const want = portrait ? "9:16" : "16:9";
	let job: PointJob;
	try {
		job = await usePoint.getState().start({ kind: "image", prompt: prompt.slice(0, 900), model: model.id, ...(aspects.includes(want) ? { aspect_ratio: want } : aspects[0] ? { aspect_ratio: aspects[0] } : {}) }, { quiet: true });
	} catch (error) {
		if (/didn't allow/.test((error as Error).message)) return null;
		throw error;
	}
	const t0 = Date.now();
	while (Date.now() - t0 < 10 * 60 * 1000) {
		await sleep(2500);
		await usePoint.getState().poll();
		const j = usePoint.getState().jobs.find((x) => x.id === job.id);
		if (j?.state === "failed") throw new Error(j.error ?? "The picture failed.");
		if (j?.state === "succeeded" && j.files.length) {
			const res = await fetch(`/api/cloud/file/${j.id}/0`, { headers: { "X-Studio": "1" } });
			if (!res.ok) throw new Error("The picture didn't arrive. Try again.");
			const blob = await res.blob();
			return new File([blob], j.files[0].name, { type: blob.type || "image/png" });
		}
	}
	throw new Error("The picture is still being made; it will appear in Media → Generate.");
}
