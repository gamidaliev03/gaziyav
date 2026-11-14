import type { ParamValues } from "@/params";
import type { TransitionDefinition, TransitionNumberParam } from "../types";
import glPack from "./gl-pack.json";

// GL Transitions (gl-transitions contributors, MIT / BSD — see
// LICENSE-gl-transitions.txt), converted to WGSL with naga by
// apps/web/scripts/gl-transitions.ts. Every item passed naga validation.

interface GlPackItem {
	id: string;
	name: string;
	group: string;
	author: string;
	license: string;
	params: TransitionNumberParam[];
	wgsl: string;
}

/** Packs GL uniforms into the 32-float block (defaults + user overrides). */
export function packGlParams(params: TransitionNumberParam[], values: ParamValues): number[] {
	const out = new Array<number>(32).fill(0);
	for (const param of params) {
		param.default.forEach((value, index) => {
			out[param.slot + index] = value;
		});
		if (param.type === "number" || param.type === "int") {
			const raw = values[param.key];
			if (typeof raw === "number" && Number.isFinite(raw)) out[param.slot] = raw;
		} else if (param.type === "bool") {
			const raw = values[param.key];
			if (typeof raw === "boolean") out[param.slot] = raw ? 1 : 0;
		} else if (param.type === "vec2") {
			const x = values[`${param.key}X`];
			const y = values[`${param.key}Y`];
			if (typeof x === "number") out[param.slot] = x;
			if (typeof y === "number") out[param.slot + 1] = y;
		}
	}
	return out;
}

/**
 * The GL Transitions shown in the library, with human names, in the browser's groups. Hidden: the ones our own
 * transitions already do (plain fade, the four wipes, the plain push), two that only make sense in 3D glasses
 * or as a test, and (1.0.82) twelve that were another transition to the eye — Pixelize (Pixelate), Defocus (Blur),
 * Fade to Colour (Dip to Black / White), Simple Zoom and Zoom Out (Seamless Zoom, Pull Back), Circle Open (Iris),
 * Rotate (Spin), Noise and Perlin Fade (TV Static, Noise Dissolve), Bow Tie ↕ (Bow Tie), Ripple (Water Drop, Ripple
 * Ring), Power Kaleido (Kaleidoscope). Hidden items stay registered (old projects keep rendering).
 */
const CURATED: Record<string, { name: string; category: string; duration?: number }> = {
	"gl.transition.GridFlip": { name: "Grid Flip", category: "3D" },
	"gl.transition.doorway": { name: "Doorway", category: "3D" },
	"gl.transition.swap": { name: "Swap", category: "3D" },
	"gl.transition.InvertedPageCurl": { name: "Page Curl", category: "3D", duration: 0.8 },
	"gl.transition.BookFlip": { name: "Book Flip", category: "3D" },
	"gl.transition.Fold": { name: "Fold", category: "3D" },
	"gl.transition.SimpleFlip": { name: "Flip", category: "3D" },
	"gl.transition.Revolve_Left": { name: "Revolve", category: "3D" },
	"gl.transition.Rolls": { name: "Roll Over", category: "3D" },
	"gl.transition.Box": { name: "Box", category: "3D" },
	"gl.transition.Bounce": { name: "Bounce", category: "Camera", duration: 0.8 },
	"gl.transition.DreamyZoom": { name: "Dreamy Zoom", category: "Camera" },
	"gl.transition.CrossZoom": { name: "Cross Zoom", category: "Camera" },
	"gl.transition.zoomInOut": { name: "Zoom In-Out", category: "Camera" },
	"gl.transition.ZoomInCircles": { name: "Zoom Circles", category: "Camera" },
	"gl.transition.RotateScaleVanish": { name: "Spin Vanish", category: "Camera" },
	"gl.transition.rotate_scale_fade": { name: "Spin Fade", category: "Camera" },
	"gl.transition.scale-in": { name: "Scale In", category: "Camera" },
	"gl.transition.pinwheel": { name: "Pinwheel", category: "Camera" },
	"gl.transition.DirectionalScaled": { name: "Push Zoom", category: "Slide & Push" },
	"gl.transition.directional-easing": { name: "Push Ease", category: "Slide & Push" },
	"gl.transition.Slides": { name: "Slides", category: "Slide & Push" },
	"gl.transition.ZoomLeftWipe": { name: "Zoom Wipe Left", category: "Slide & Push" },
	"gl.transition.ZoomRigthWipe": { name: "Zoom Wipe Right", category: "Slide & Push" },
	"gl.transition.splitSlideInHorizontal": { name: "Split In ↔", category: "Slide & Push" },
	"gl.transition.splitSlideInVertical": { name: "Split In ↕", category: "Slide & Push" },
	"gl.transition.splitSlideOutHorizontal": { name: "Split Out ↔", category: "Slide & Push" },
	"gl.transition.splitSlideOutVertical": { name: "Split Out ↕", category: "Slide & Push" },
	"gl.transition.splitSlideInOutHorizontal": { name: "Split Swap ↔", category: "Slide & Push" },
	"gl.transition.splitSlideInOutVertical": { name: "Split Swap ↕", category: "Slide & Push" },
	"gl.transition.tangentMotionBlur": { name: "Motion Blur Push", category: "Slide & Push" },
	"gl.transition.squeeze": { name: "Squeeze", category: "Slide & Push" },
	"gl.transition.LeftRight": { name: "Left Right", category: "Slide & Push" },
	"gl.transition.TopBottom": { name: "Top Bottom", category: "Slide & Push" },
	"gl.transition.directionalwipe": { name: "Soft Wipe", category: "Basic" },
	"gl.transition.HorizontalOpen": { name: "Open ↔", category: "Shape" },
	"gl.transition.HorizontalClose": { name: "Close ↔", category: "Shape" },
	"gl.transition.VerticalOpen": { name: "Open ↕", category: "Shape" },
	"gl.transition.VerticalClose": { name: "Close ↕", category: "Shape" },
	"gl.transition.morph": { name: "Morph", category: "Basic" },
	"gl.transition.crosswarp": { name: "Warp", category: "Distortion" },
	"gl.transition.luminance_melt": { name: "Melt", category: "Basic", duration: 0.8 },
	"gl.transition.fadegrayscale": { name: "Fade Grey", category: "Basic" },
	"gl.transition.HSVfade": { name: "Hue Fade", category: "Basic" },
	"gl.transition.ColourDistance": { name: "Colour Key Fade", category: "Basic" },
	"gl.transition.multiply_blend": { name: "Multiply", category: "Basic" },
	"gl.transition.dissolve": { name: "Noise Dissolve", category: "Basic" },
	"gl.transition.BlockDissolve": { name: "Block Dissolve", category: "Pattern" },
	"gl.transition.Dreamy": { name: "Dreamy", category: "Basic" },
	"gl.transition.Overexposure": { name: "Overexposure", category: "Light" },
	"gl.transition.burn0": { name: "Burn", category: "Light" },
	"gl.transition.FilmBurn": { name: "Burn Through", category: "Film" },
	"gl.transition.StaticFade": { name: "Static Fade", category: "Film" },
	"gl.transition.old_tv_lost_signal": { name: "Lost Signal", category: "Glitch" },
	"gl.transition.Drop_Zone_Flicker": { name: "Flicker", category: "Film" },
	"gl.transition.StripDatamoshGlitch": { name: "Datamosh", category: "Glitch", duration: 0.5 },
	"gl.transition.TVStatic": { name: "TV Static", category: "Glitch", duration: 0.4 },
	"gl.transition.GlitchDisplace": { name: "Glitch Displace", category: "Glitch" },
	"gl.transition.GlitchMemories": { name: "Glitch Memories", category: "Glitch" },
	"gl.transition.parametric_glitch": { name: "Parametric Glitch", category: "Glitch" },
	"gl.transition.static_wipe": { name: "Static Wipe", category: "Glitch" },
	"gl.transition.DoomScreenTransition": { name: "Melt Down", category: "Glitch" },
	"gl.transition.Mosaic": { name: "Mosaic", category: "Pattern" },
	"gl.transition.AdvancedMosaic": { name: "Mosaic Zoom", category: "Pattern" },
	"gl.transition.mosaic_transition": { name: "Mosaic Tiles", category: "Pattern" },
	"gl.transition.hexagonalize": { name: "Hexagonalize", category: "Pattern" },
	"gl.transition.WaterDrop": { name: "Water Drop", category: "Distortion" },
	"gl.transition.Swirl": { name: "Swirl", category: "Distortion" },
	"gl.transition.directionalwarp": { name: "Directional Warp", category: "Distortion" },
	"gl.transition.wind": { name: "Wind", category: "Distortion" },
	"gl.transition.flyeye": { name: "Fly Eye", category: "Distortion" },
	"gl.transition.ButterflyWaveScrawler": { name: "Butterfly", category: "Distortion" },
	"gl.transition.CrazyParametricFun": { name: "Spirograph", category: "Distortion" },
	"gl.transition.polar_function": { name: "Polar", category: "Distortion" },
	"gl.transition.kaleidoscope": { name: "Kaleidoscope", category: "Distortion" },
	"gl.transition.TilesWave": { name: "Tiles Wave", category: "Pattern" },
	"gl.transition.heart": { name: "Heart", category: "Shape" },
	"gl.transition.StarWipe": { name: "Star", category: "Shape" },
	"gl.transition.CircleCrop": { name: "Circle Crop", category: "Shape" },
	"gl.transition.Radial": { name: "Clock", category: "Shape" },
	"gl.transition.angular": { name: "Angular", category: "Shape" },
	"gl.transition.Rectangle": { name: "Rectangle", category: "Shape" },
	"gl.transition.BowTieHorizontal": { name: "Bow Tie ↔", category: "Shape" },
	"gl.transition.BowTieWithParameter": { name: "Bow Tie", category: "Shape" },
	"gl.transition.squareswire": { name: "Square Wire", category: "Pattern" },
	"gl.transition.randomsquares": { name: "Random Squares", category: "Pattern" },
	"gl.transition.chessboard": { name: "Chessboard", category: "Pattern" },
	"gl.transition.crosshatch": { name: "Crosshatch", category: "Pattern" },
	"gl.transition.PolkaDotsCurtain": { name: "Polka Dots", category: "Pattern" },
	"gl.transition.PuzzleRight": { name: "Puzzle", category: "Pattern" },
	"gl.transition.windowblinds": { name: "Blinds", category: "Pattern" },
	"gl.transition.windowslice": { name: "Slices", category: "Pattern" },
	"gl.transition.fragment": { name: "Fragments", category: "Pattern" },
};

export const GL_TRANSITIONS: TransitionDefinition[] = (glPack as GlPackItem[]).map((item) => ({
	type: item.id,
	name: CURATED[item.id]?.name ?? item.name,
	category: CURATED[item.id]?.category ?? item.group,
	hidden: !CURATED[item.id],
	defaultDuration: CURATED[item.id]?.duration ?? 0.6,
	wgsl: item.wgsl,
	numberParams: item.params,
	credit: `${item.author || "gl-transitions"} · ${item.license}`,
	pack: (values: ParamValues) => packGlParams(item.params, values),
}));
