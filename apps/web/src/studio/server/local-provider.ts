// Types the lipsync panel shares with the pipeline (the lipsync itself runs on fal.ai: src/fal/lipsync.ts).

export interface LocalLipsyncStatus {
	ready: boolean;
	reason?: string;
	/** Seconds of processing per 10 s of video on this Mac, plus a fixed start-up (model loading). */
	secondsPer10s: number;
	overheadSeconds?: number;
	installed?: boolean;
	downloadBytes?: number;
	installJobId?: string;
}

/** A piece of the result (seconds from its start) where the original face was kept, and why. */
export interface KeptOriginal {
	from: number;
	to: number;
	reason: string;
}

