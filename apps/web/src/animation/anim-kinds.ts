// The text animation kinds (In / Out / Loop) as the inspector lists them. A leaf: the server can read it
// (Gaziyav AI's caption styles) without the animation engine.

export const TEXT_ANIM_IN = [
	{ value: "none", label: "None" },
	{ value: "fade", label: "Fade" },
	{ value: "pop", label: "Pop" },
	{ value: "slam", label: "Slam" },
	{ value: "punch", label: "Punch" },
	{ value: "smoothRise", label: "Smooth rise" },
	{ value: "spin", label: "Spin" },
	{ value: "swing", label: "Swing" },
	{ value: "neon", label: "Neon" },
	{ value: "rise", label: "Rise" },
	{ value: "drop", label: "Drop" },
	{ value: "slideLeft", label: "Slide left" },
	{ value: "slideRight", label: "Slide right" },
	{ value: "bounce", label: "Bounce" },
	{ value: "typewriter", label: "Typewriter" },
	{ value: "blurIn", label: "Blur" },
	{ value: "scaleDown", label: "Zoom" },
	{ value: "tracking", label: "Tracking" },
	{ value: "glitch", label: "Glitch" },
	{ value: "letters", label: "Letters rise" },
	{ value: "lettersPop", label: "Letters pop" },
	{ value: "scatter", label: "Scatter" },
	{ value: "flip", label: "Flip up" },
	{ value: "wordsUp", label: "Words up" },
	{ value: "maskRise", label: "Mask reveal" },
	{ value: "wipe", label: "Wipe" },
] as const;

export const TEXT_ANIM_OUT = [
	{ value: "none", label: "None" },
	{ value: "fade", label: "Fade" },
	{ value: "pop", label: "Pop" },
	{ value: "smoothRise", label: "Smooth up" },
	{ value: "spin", label: "Spin" },
	{ value: "neon", label: "Neon" },
	{ value: "rise", label: "Fly up" },
	{ value: "drop", label: "Drop" },
	{ value: "slideLeft", label: "Slide left" },
	{ value: "blurOut", label: "Blur" },
	{ value: "scaleUp", label: "Zoom" },
	{ value: "lettersOut", label: "Letters out" },
	{ value: "scatterOut", label: "Scatter" },
	{ value: "maskSink", label: "Mask sink" },
	{ value: "wipeOut", label: "Wipe" },
] as const;

export const TEXT_ANIM_LOOP = [
	{ value: "none", label: "None" },
	{ value: "pulse", label: "Pulse" },
	{ value: "float", label: "Float" },
	{ value: "wave", label: "Sway" },
	{ value: "flicker", label: "Flicker" },
	{ value: "shake", label: "Shake" },
	{ value: "lettersWave", label: "Letter wave" },
	{ value: "shimmer", label: "Shimmer" },
	{ value: "glowPulse", label: "Glow pulse" },
] as const;

export type TextAnimIn = (typeof TEXT_ANIM_IN)[number]["value"];
export type TextAnimOut = (typeof TEXT_ANIM_OUT)[number]["value"];
export type TextAnimLoop = (typeof TEXT_ANIM_LOOP)[number]["value"];
