// The one place the server asks «which API runs this?». Every paid call goes through a provider: fal.ai as it always
// was (the same requests, byte for byte), or kie.ai. Which one comes from the model itself, so a job that already runs
// is never touched by flipping the switch in Settings → AI.
import { addSpend, falKey, fetchResult, runFal, type RunOptions, uploadFile } from "@/fal/server";
import type { FalTask } from "@/fal/models";
import type { AiApi } from "@/fal/video";
import { addArgoSpend, argoKey, fetchArgoResult, runArgo, uploadToArgo } from "@/argo/server";
import { addKieSpend, fetchKieResult, kieKey, runKie, uploadToKie } from "@/kie/server";

export type Output = "video" | "image" | "audio";

/** A provider's answer in fal's shape: the callers read one form. `usd`: what was really charged, when the API says. */
export interface Answer {
	video?: { url?: string };
	audio?: { url?: string };
	images?: Array<{ url?: string }>;
	image?: { url?: string };
	usd?: number;
}

export interface Provider {
	id: AiApi;
	label: string;
	hasKey: () => boolean;
	upload: (file: string, signal?: AbortSignal) => Promise<string>;
	run: (endpoint: string, input: Record<string, unknown>, output: Output, o?: RunOptions) => Promise<Answer>;
	save: (url: unknown, dest: string, signal?: AbortSignal) => Promise<string>;
	spend: (task: FalTask, usd: number) => void;
}

const fal: Provider = {
	id: "fal",
	label: "fal.ai",
	hasKey: () => !!falKey(),
	upload: uploadFile,
	run: (endpoint, input, _output, o) => runFal<Answer>(endpoint, input, o),
	save: fetchResult,
	spend: addSpend,
};

/** Seconds a speech task may take on kie.ai in all, queue included. */
export const SPEECH_LIMIT = 360;

const kie: Provider = {
	id: "kie",
	label: "kie.ai",
	hasKey: () => !!kieKey(),
	upload: uploadToKie,
	run: async (endpoint, input, output, o) => {
		// Speech takes seconds: a task still waiting after SPEECH_LIMIT is not going to start (runKie says so).
		const r = await runKie(endpoint, input, { ...o, timeoutSeconds: o?.timeoutSeconds ?? (output === "audio" ? SPEECH_LIMIT : undefined) });
		const [first] = r.urls;
		return { ...(output === "image" ? { images: r.urls.map((url) => ({ url })) } : output === "audio" ? { audio: { url: first } } : { video: { url: first } }), ...(r.usd === undefined ? {} : { usd: r.usd }) };
	},
	save: fetchKieResult,
	spend: addKieSpend,
};

const argo: Provider = {
	id: "argo",
	label: "ArgoLink",
	hasKey: () => !!argoKey(),
	upload: uploadToArgo,
	run: async (endpoint, input, _output, o) => {
		const r = await runArgo(endpoint, input, o);
		return { video: { url: r.urls[0] }, ...(r.usd === undefined ? {} : { usd: r.usd }) };
	},
	save: fetchArgoResult,
	spend: addArgoSpend,
};

export const provider = (api: AiApi | undefined): Provider => (api === "kie" ? kie : api === "argo" ? argo : fal);
