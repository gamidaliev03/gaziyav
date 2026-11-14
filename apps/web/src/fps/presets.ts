/**
 * The project's frame rates. 23.976, 29.97 and 59.94 are the film and NTSC rates every camera records: without them a
 * film editor could not set up a 23.976 timeline at all, only get one from a first clip (pro-core, 09.11). A value is
 * read with floatToFrameRate: «23.976» is 24000/1001.
 */
export const FPS_PRESETS = [
	{ value: "23.976", label: "23.976 fps" },
	{ value: "24", label: "24 fps" },
	{ value: "25", label: "25 fps" },
	{ value: "29.97", label: "29.97 fps" },
	{ value: "30", label: "30 fps" },
	{ value: "50", label: "50 fps" },
	{ value: "59.94", label: "59.94 fps" },
	{ value: "60", label: "60 fps" },
	{ value: "120", label: "120 fps" },
] as const;
