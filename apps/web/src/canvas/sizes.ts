import type { TCanvasSize } from "@/project/types";

export const DEFAULT_CANVAS_PRESETS: TCanvasSize[] = [
	{ width: 1920, height: 1080 },
	{ width: 1080, height: 1920 },
	{ width: 1080, height: 1080 },
	{ width: 1440, height: 1080 },
];

// An empty project's player is 16:9, as CapCut's; the first clip then sets the shape (CapCut's «Original»).
export const DEFAULT_CANVAS_SIZE: TCanvasSize = { width: 1920, height: 1080 };
