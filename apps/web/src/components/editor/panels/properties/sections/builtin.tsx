"use client";

// The panel's own groups, registered through the same slots plug-ins use (../slots.ts).
import { Switch } from "@/components/ui/switch";
import { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import { hasListedClipEffects } from "@/effects/clip-effect-list";
import { ClipEffectsTab, StandaloneEffectTab } from "@/effects/components/effects-tab";
import { GraphicTab } from "@/graphics/components/graphic-tab";
import { MasksTab } from "@/masks/components/masks-tab";
import { isAiDefinition } from "@/montage/catalog";
import { getElementParam, readElementParamValue, writeElementParamValue } from "@/params/registry";
import { AudioEffectsSection } from "@/sounds/components/audio-effects";
import { isCaptionElement } from "@/subtitles/apply-style";
import { SpeedPlugin } from "@/motion/components/speed-plugin";
import { TextAnimationTab } from "@/text/components/animation-tab";
import { ApplyTextStyle } from "@/actions/components/apply-text-style";
import type {
	AudioElement,
	EffectElement,
	GraphicElement,
	MaskableElement,
	TextElement,
	TimelineElement,
	VideoElement,
	VisualElement,
} from "@/timeline";
import { ParamRows, type ParamRowSpec } from "../components/element-params-tab";
import { InspectorGroup, InspectorMore, InspectorRow } from "../components/inspector-ui";
import { registerInspectorSection, type InspectorSectionProps, type InspectorTabId } from "../slots";
import { CanvasSection } from "./canvas";
import { TransformResetButton, TransformSection } from "./transform";

const isText = (e: TimelineElement): e is TextElement => e.type === "text";
const isAudioClip = (e: TimelineElement): e is AudioElement => e.type === "audio";
const isAi = (e: TimelineElement): e is GraphicElement => e.type === "graphic" && isAiDefinition(e.definitionId);
const isShape = (e: TimelineElement): e is GraphicElement => e.type === "graphic" && !isAiDefinition(e.definitionId);
const isVisual = (e: TimelineElement): e is VisualElement =>
	["video", "image", "text", "sticker", "graphic"].includes(e.type);
const isMaskable = (e: TimelineElement): e is MaskableElement => ["video", "image", "graphic"].includes(e.type);
// A text gets its Effects list once an effect is on it (dropped from Effects, ⌘K, pasted): it renders, so it needs a
// place to be edited and removed (audit 21.11); a plain title keeps its short row of tabs.
const hasEffects = (e: TimelineElement): e is VisualElement =>
	["video", "image", "sticker", "graphic"].includes(e.type) || (e.type === "text" && hasListedClipEffects(e.effects));
const videoHasAudio = (e: TimelineElement): e is VideoElement => {
	if (e.type !== "video") return false;
	// after «Extract audio» the sound plays from its own audio clip, which has these controls (audit 21.11)
	if (e.isSourceAudioEnabled === false) return false;
	const asset = EditorCore.getInstance().media.getAssets().find((a) => a.id === e.mediaId);
	return asset?.hasAudio !== false;
};
/** A compound clip with sound somewhere inside it: its Audio tab sets the sound of all of it (montage/compound-sound.ts). */
const compoundHasAudio = (e: TimelineElement, depth = 0): boolean => {
	if (e.type !== "graphic" || e.params?.compound !== true || depth > 3) return false;
	const scene = EditorCore.getInstance().scenes.getScenes().find((s) => s.id === e.params.sceneId);
	if (!scene) return false;
	return [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio].some((t) =>
		(t.elements as TimelineElement[]).some((x) => x.type === "audio" || videoHasAudio(x) || compoundHasAudio(x, depth + 1)),
	);
};
const hasOwnSound = (e: TimelineElement) => videoHasAudio(e) || compoundHasAudio(e);

/** A group of parameter rows; `toggle` puts that boolean in the header and hides the rows while it's off. */
function ParamGroup({
	id,
	title,
	rows,
	more,
	toggle,
	defaultOpen,
	element,
	trackId,
}: InspectorSectionProps & {
	id: string;
	title: string;
	rows: readonly (ParamRowSpec | string)[];
	/** The advanced rows, folded under «More» (the owner: the common ones in sight, nothing piled up). */
	more?: readonly (ParamRowSpec | string)[];
	toggle?: string;
	defaultOpen?: boolean;
}) {
	const editor = useEditor();
	const toggleParam = toggle ? getElementParam({ element, key: toggle }) : null;
	const enabled = toggleParam ? Boolean(readElementParamValue({ element, param: toggleParam })) : true;
	return (
		<InspectorGroup
			id={id}
			title={title}
			defaultOpen={defaultOpen ?? true}
			trailing={
				toggleParam ? (
					<Switch
						aria-label={`${title} on`}
						checked={enabled}
						onCheckedChange={(on) =>
							editor.timeline.updateElements({
								updates: [{ trackId, elementId: element.id, patch: writeElementParamValue({ element, param: toggleParam, value: on }) }],
							})
						}
					/>
				) : undefined
			}
		>
			{enabled ? <ParamRows element={element} trackId={trackId} rows={rows} /> : null}
			{enabled && more?.length ? (
				<InspectorMore id={`${id}.more`}>
					<ParamRows element={element} trackId={trackId} rows={more} />
				</InspectorMore>
			) : null}
		</InspectorGroup>
	);
}

/**
 * A switch row and, while it is on, its rows (Stroke: colour, width) — inside a section instead of a section of its
 * own. The switch writes what the old group header's switch wrote: the boolean, one undo step.
 */
function ToggleRows({ element, trackId, toggle, label, rows }: InspectorSectionProps & { toggle: string; label: string; rows: readonly (ParamRowSpec | string)[] }) {
	const editor = useEditor();
	const param = getElementParam({ element, key: toggle });
	if (!param) return null;
	const on = Boolean(readElementParamValue({ element, param }));
	return (
		<>
			<InspectorRow rowId={toggle} label={label} inline>
				<div className="flex h-7 items-center">
					<Switch
						aria-label={`${label} on`}
						checked={on}
						onCheckedChange={(value) =>
							editor.timeline.updateElements({
								updates: [{ trackId, elementId: element.id, patch: writeElementParamValue({ element, param, value }) }],
							})
						}
					/>
				</div>
			</InspectorRow>
			{on ? <ParamRows element={element} trackId={trackId} rows={rows} /> : null}
		</>
	);
}

/**
 * Text → Text style, ONE section (it was eight: Font, Spacing, Stroke, Shadow, Background, Gradient, Text box): the font, size,
 * colour, alignment, outline and shadow in sight; weight, style, case, spacing, background, gradient and the box under
 * «More». Every row writes the same parameter it wrote in its old group.
 */
function TextStyleSection({ element, trackId }: InspectorSectionProps) {
	return (
		<InspectorGroup id="text.style" title="Text style">
			<ParamRows
				element={element}
				trackId={trackId}
				rows={[
					{ key: "fontFamily", label: "Font" },
					{ key: "fontSize", label: "Size" },
					{ key: "color", label: "Color" },
					{ key: "textAlign", label: "Align" },
				]}
			/>
			<ToggleRows element={element} trackId={trackId} toggle="stroke.enabled" label="Stroke" rows={[{ key: "stroke.color", label: "Color" }, { key: "stroke.width", label: "Width", unit: "%" }]} />
			<ToggleRows
				element={element}
				trackId={trackId}
				toggle="shadow.enabled"
				label="Shadow"
				rows={[
					{ key: "shadow.color", label: "Color" },
					{ key: "shadow.blur", label: "Blur", unit: "%" },
					{ key: "shadow.offsetX", label: "Offset X", unit: "%" },
					{ key: "shadow.offsetY", label: "Offset Y", unit: "%" },
				]}
			/>
			<InspectorMore id="text.style.more">
				<ParamRows
					element={element}
					trackId={trackId}
					rows={[
						{ key: "fontWeight", label: "Weight" },
						{ key: "fontStyle", label: "Style" },
						{ key: "textTransform", label: "Case" },
						{ key: "textDecoration", label: "Line" },
						{ key: "letterSpacing", label: "Letters" },
						{ key: "lineHeight", label: "Lines" },
					]}
				/>
				<ToggleRows
					element={element}
					trackId={trackId}
					toggle="background.enabled"
					label="Background"
					rows={[
						{ key: "background.color", label: "Color" },
						{ key: "background.cornerRadius", label: "Corners" },
						{ key: "background.paddingX", label: "Padding X" },
						{ key: "background.paddingY", label: "Padding Y" },
						{ key: "background.offsetX", label: "Offset X" },
						{ key: "background.offsetY", label: "Offset Y" },
					]}
				/>
				<ToggleRows element={element} trackId={trackId} toggle="gradient.enabled" label="Gradient" rows={[{ key: "gradient.color", label: "Bottom color" }]} />
				<ParamRows
					element={element}
					trackId={trackId}
					rows={[
						{ key: "box.width", label: "Box width", unit: "%" },
						{ key: "box.maxLines", label: "Max lines" },
						{ key: "box.autoFit", label: "Auto-fit" },
					]}
				/>
			</InspectorMore>
		</InspectorGroup>
	);
}

type GroupSpec = {
	id: string;
	title: string;
	rows: readonly (ParamRowSpec | string)[];
	more?: readonly (ParamRowSpec | string)[];
	toggle?: string;
	defaultOpen?: boolean;
};

function registerGroups(tab: InspectorTabId | ((e: TimelineElement) => InspectorTabId), appliesTo: (e: TimelineElement) => boolean, groups: GroupSpec[], startOrder: number) {
	groups.forEach((group, index) => {
		const tabs: InspectorTabId[] = typeof tab === "function" ? ["basic", "audio"] : [tab];
		for (const t of tabs) {
			registerInspectorSection({
				id: `${group.id}@${t}`,
				tab: t,
				title: group.title,
				order: startOrder + index * 10,
				bare: true,
				appliesTo: (e) => appliesTo(e) && (typeof tab === "function" ? tab(e) === t : true),
				render: (props) => <ParamGroup {...props} {...group} id={group.id} />,
				// rows only (their playhead is read live, their writes are partial): a move doesn't re-render it; a group
				// with a header switch writes the whole clip, so it re-renders
				placementFree: !group.toggle,
			});
		}
	});
}

/** Premiere's Opacity: the opacity in sight, the blend mode under «More». */
const OPACITY_ROWS: ParamRowSpec[] = [{ key: "opacity", label: "Opacity", unit: "%", override: { min: 0, max: 100, step: 1, displayMultiplier: 100 } }];
const OPACITY_MORE: ParamRowSpec[] = [{ key: "blendMode", label: "Blend mode" }];

/** A motion title's own rows (lower thirds, buttons, badges): the design, its second line, colours and icon. */
const DESIGN_GROUP: GroupSpec = {
	id: "text.design",
	title: "Design",
	rows: [
		{ key: "design.id", label: "Design" },
		{ key: "design.sub", label: "Second line" },
		{ key: "design.accent", label: "Accent" },
		{ key: "design.plate", label: "Plate" },
		{ key: "design.subColor", label: "Line 2 color" },
		{ key: "design.icon", label: "Icon" },
	],
};

/** Captions only: the spoken word's highlight (a plain title has no word timing, so the group would change nothing). */
const HIGHLIGHT_GROUP: GroupSpec = {
	id: "text.highlight",
	title: "Word highlight",
	defaultOpen: false,
	rows: [
		{ key: "highlight.mode", label: "Style" },
		{ key: "highlight.color", label: "Color" },
		{ key: "highlight.scale", label: "Scale" },
	],
};

/** The sound, Premiere's way: Volume (level, mute, fades; ducking and the voice role under «More»), then Pan. */
const AUDIO_GROUPS: GroupSpec[] = [
	{
		id: "audio.volume",
		title: "Volume",
		rows: [
			// Premiere's words: Volume › Level, Panner › Balance (a row never repeats its section's title)
			{ key: "volume", label: "Level", unit: "dB" },
			{ key: "muted", label: "Mute" },
			{ key: "fadeIn", label: "Fade in", unit: "s" },
			{ key: "fadeOut", label: "Fade out", unit: "s" },
		],
		more: [
			{ key: "duckUnderVoice", label: "Duck under voice" },
			{ key: "voiceRole", label: "Voice" },
		],
	},
	{ id: "audio.pan", title: "Pan", rows: [{ key: "pan", label: "Balance" }] },
	// «Clean up» (isolate the voice, reduce noise, gate) and the applied audio effects follow (sounds/components/audio-effects.tsx);
	// Enhance voice (AI) after them; Separate voice and music, the parts and the Voice changer are tools: neural/inspector.tsx
];

let registered = false;

export function registerBuiltInSections() {
	if (registered) return;
	registered = true;

	// Text → the text itself, then its style groups.
	registerInspectorSection({
		id: "text.content",
		tab: "text",
		title: "Text",
		order: 50,
		bare: true,
		appliesTo: isText,
		render: ({ element, trackId }) => (
			<div className="border-border/70 border-b px-4 pt-3.5 pb-4">
				<ParamRows element={element} trackId={trackId} rows={[{ key: "content", label: "Text" }]} />
				<ApplyTextStyle element={element} trackId={trackId} />
			</div>
		),
	});
	registerInspectorSection({
		id: "text.style",
		tab: "text",
		title: "Text style",
		order: 100,
		bare: true,
		appliesTo: isText,
		render: (props) => <TextStyleSection {...props} />,
	});
	registerGroups("text", (e) => isText(e) && isCaptionElement(e), [HIGHLIGHT_GROUP], 180);
	// A motion title (text/design.ts): its look, second line, colours and icon, above the font.
	registerGroups("text", (e) => isText(e) && typeof e.params["design.id"] === "string" && e.params["design.id"] !== "", [DESIGN_GROUP], 95);

	// Basic is the same for every visual clip, a text too: where it sits (Transform) and how it blends (Blend).
	registerInspectorSection({
		id: "transform@basic",
		tab: "basic",
		title: "Transform",
		order: 100,
		bare: true,
		appliesTo: isVisual,
		render: ({ element, trackId }) => (
			<InspectorGroup id="transform" title="Transform" trailing={<TransformResetButton element={element} trackId={trackId} />}>
				<TransformSection element={element} trackId={trackId} />
			</InspectorGroup>
		),
	});
	registerInspectorSection({
		id: "opacity@basic",
		tab: "basic",
		title: "Opacity",
		order: 200,
		bare: true,
		appliesTo: isVisual,
		render: (props) => <ParamGroup {...props} id="opacity" title="Opacity" rows={OPACITY_ROWS} more={OPACITY_MORE} />,
		placementFree: true,
	});
	// CapCut: Background sits under a main-track clip (it is the project's canvas fill, the same as Settings → Background);
	// an overlay clip has nothing of its own to fill.
	registerInspectorSection({
		id: "canvas",
		tab: "basic",
		title: "Canvas",
		order: 300,
		bare: true,
		appliesTo: (e) => e.type === "video" || e.type === "image",
		render: ({ trackId }) => <CanvasSection trackId={trackId} />,
		placementFree: true,
	});

	// Sound: Basic for audio clips, its own tab for video with sound.
	registerGroups((e) => (isAudioClip(e) ? "basic" : "audio"), (e) => isAudioClip(e) || hasOwnSound(e), AUDIO_GROUPS, 100);
	// The sound's clean-up (isolate the voice, reduce noise, gate), then the audio effects applied to it, in the order they
	// process the sound (one home: the clip's sound).
	for (const tab of ["basic", "audio"] as const) {
		const applies = (e: TimelineElement) => (tab === "basic" ? isAudioClip(e) : hasOwnSound(e));
		registerInspectorSection({
			id: `audio.cleanup@${tab}`,
			tab,
			title: "Clean up",
			order: 290,
			bare: true,
			appliesTo: applies,
			render: ({ element, trackId }) => <AudioEffectsSection element={element} trackId={trackId} part="cleanup" />,
			placementFree: true,
		});
		registerInspectorSection({
			id: `audio.effects@${tab}`,
			tab,
			title: "Audio effects",
			order: 300,
			bare: true,
			appliesTo: applies,
			render: ({ element, trackId }) => <AudioEffectsSection element={element} trackId={trackId} part="effects" />,
			placementFree: true,
		});
	}

	// Full-width tools that draw their own header.
	registerInspectorSection({
		id: "speed",
		tab: "speed",
		title: "Speed",
		order: 100,
		bare: true,
		appliesTo: (e) => e.type === "video" || e.type === "audio",
		render: ({ element, trackId }) => <SpeedPlugin element={element as VideoElement | AudioElement} trackId={trackId} />,
	});
	registerInspectorSection({
		id: "masks",
		tab: "cutout",
		title: "Mask",
		order: 300,
		bare: true,
		// a compound clip's mask cuts its whole picture at once (services/renderer/compound-group.ts)
		appliesTo: isMaskable,
		render: ({ element, trackId }) => <MasksTab element={element as MaskableElement} trackId={trackId} />,
	});
	registerInspectorSection({
		id: "effects",
		tab: "effects",
		title: "Effects",
		order: 100,
		bare: true,
		appliesTo: hasEffects,
		render: ({ element, trackId }) => <ClipEffectsTab element={element as VisualElement} trackId={trackId} />,
	});
	registerInspectorSection({
		id: "text.animation",
		tab: "animation",
		title: "Animation",
		order: 100,
		appliesTo: isText,
		render: ({ element, trackId }) => <TextAnimationTab element={element as TextElement} trackId={trackId} />,
	});
	registerInspectorSection({
		id: "graphic",
		tab: "shape",
		title: "Shape",
		order: 100,
		bare: true,
		appliesTo: isShape,
		render: ({ element, trackId }) => <GraphicTab element={element as GraphicElement} trackId={trackId} />,
	});
	// AI layers (a plate / template made with AI): the fields its component declared (texts, colours, pictures, timings).
	registerInspectorSection({
		id: "ai.fields",
		tab: "ai",
		title: "Template",
		order: 100,
		bare: true,
		appliesTo: isAi,
		render: ({ element, trackId }) => <GraphicTab element={element as GraphicElement} trackId={trackId} />,
	});
	registerInspectorSection({
		id: "effect",
		tab: "effects",
		title: "Effect",
		order: 100,
		bare: true,
		appliesTo: (e) => e.type === "effect",
		render: ({ element, trackId }) => <StandaloneEffectTab element={element as EffectElement} trackId={trackId} />,
	});
}
