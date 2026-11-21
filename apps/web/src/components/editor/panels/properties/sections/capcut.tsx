"use client";

// The inspector groups that give the tabs their content (docs/EDITOR-MAP.md): Cutout (remove background, chroma key),
// Color (the Color section itself), Motion (animation, stabilize) and, for text, Style and Voice.
import { followVoiceModel, useLibraryCards, useVoiceFitsModel, voiceLanguage } from "@/generate/service-voices";
import { VoiceLanguage } from "@/generate/components/voice-language";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EditorCore } from "@/core";
import { buildDefaultEffectInstance, effectsRegistry } from "@/effects";
import { ColorControls } from "@/effects/components/adjustment-view";
import { COLOR_EFFECT_TYPE } from "@/effects/definitions/studio/color";
import { useSavedVoices } from "@/generate/components/my-voices";
import { myCards, needsKey, useVoiceLang, VoicePicker } from "@/generate/components/voice-picker";
import { generate } from "@/generate/run";
import { useT } from "@/i18n";
import { NeuralInspector } from "@/neural/components/inspector-ai";
import type { TextElement, TimelineElement, VideoElement, VisualElement } from "@/timeline";
import { useElementPreview } from "@/timeline/hooks/use-element-preview";
import { TextAnimationTab } from "@/text/components/animation-tab";
import { isVisualElement } from "@/timeline/element-utils";
import { PropertyParamField } from "../components/property-param-field";
import { registerInspectorSection } from "../slots";
import { StabilizeSection } from "./stabilize";
import { BubbleSection, CaptionTemplateSection, isCaption, WordArtSection } from "./text-looks";
import { TextTrackingSection } from "./text-tracking";

import { CHROMA_KEY_EFFECT_TYPE as CHROMA_KEY } from "@/effects/clip-effect-list";
import { VoiceModelSelect } from "@/fal/components/voice-model-select";

function CutoutSection({ element, trackId }: { element: TimelineElement; trackId: string }) {
	// The one place of Remove background (⌘K and the Track menu lead here): its whole setup, the on/off switch of
	// the result, the progress with Cancel, Re-run and «Use original».
	return (
		<div className="flex flex-col gap-2 px-4 pb-3" data-cutout>
			<NeuralInspector element={element} trackId={trackId} only="background" />
		</div>
	);
}

/** CapCut's Chroma key: on/off, then the colour to remove and how strongly, right here (not in Adjust → Effects). */
const CHROMA_ROWS: Array<{ key: string; label: string }> = [
	{ key: "keyColor", label: "Color" },
	{ key: "tolerance", label: "Strength" },
	{ key: "softness", label: "Edge" },
	{ key: "spill", label: "Spill" },
];

function ChromaKeySection({ element, trackId }: { element: TimelineElement; trackId: string }) {
	const t = useT();
	const { renderElement, previewUpdates, commit } = useElementPreview({ trackId, elementId: element.id, fallback: element });
	const effects = "effects" in element ? (element.effects ?? []) : [];
	const effect = effects.find((e) => e.type === CHROMA_KEY) ?? null;
	const on = !!effect;
	const toggle = () => {
		const next = on ? effects.filter((e) => e.type !== CHROMA_KEY) : [...effects, buildDefaultEffectInstance({ effectType: CHROMA_KEY })];
		EditorCore.getInstance().timeline.updateElements({ updates: [{ trackId, elementId: element.id, patch: { effects: next } as Partial<TimelineElement> }] });
	};
	const definition = effect ? effectsRegistry.get(CHROMA_KEY) : null;
	const live = effect ? (((renderElement as VisualElement).effects ?? []).find((e) => e.id === effect.id) ?? effect) : null;
	const preview = (key: string) => (value: number | string | boolean) => {
		if (!effect) return;
		previewUpdates({
			effects: ((renderElement as VisualElement).effects ?? effects).map((e) => (e.id === effect.id ? { ...e, params: { ...e.params, [key]: value } } : e)),
		} as Partial<VideoElement>);
	};
	// On / off keeps the colour and strengths (the effect stays on the clip, switched off); «Remove» takes it away.
	const enabled = !!effect && effect.enabled !== false;
	const setEnabled = (value: boolean) => {
		if (!effect) return;
		EditorCore.getInstance().timeline.updateElements({
			updates: [{ trackId, elementId: element.id, patch: { effects: effects.map((e) => (e.id === effect.id ? { ...e, enabled: value } : e)) } as Partial<TimelineElement> }],
		});
	};
	return (
		<div className="flex flex-col gap-2 px-4 pb-3" data-chroma-key={on ? (enabled ? "on" : "off-kept") : "off"}>
			{on ? (
				<div className="flex items-center justify-between gap-2">
					<span className="text-muted-foreground text-[11px] leading-snug">{enabled ? t("The key colour is see-through. Off shows the clip as it is.") : t("Off: the clip shows as it is; the settings are kept.")}</span>
					<Switch aria-label={t("Chroma key on")} checked={enabled} onCheckedChange={setEnabled} data-chroma-switch="" />
				</div>
			) : null}
			{definition && live && enabled
				? CHROMA_ROWS.map((row) => {
						const param = definition.params.find((p) => p.key === row.key);
						if (!param) return null;
						return (
							<div key={row.key} data-chroma-param={row.key}>
								<PropertyParamField param={param} label={row.label} value={live.params[row.key] ?? param.default} onPreview={preview(row.key)} onCommit={commit} />
							</div>
						);
					})
				: null}
			<Button size="sm" variant={on ? "secondary" : "default"} onClick={toggle} data-chroma-toggle>
				{on ? t("Remove chroma key") : t("Add chroma key")}
			</Button>
		</div>
	);
}

function AdjustColor({ element, trackId }: { element: TimelineElement; trackId: string }) {
	if (!isVisualElement(element)) return null;
	const effect = (element.effects ?? []).find((e) => e.type === COLOR_EFFECT_TYPE) ?? null;
	return (
		<div data-adjust-color className="pt-2">
			<ColorControls key={element.id} target={{ kind: "clip", trackId, element, effect }} />
		</div>
	);
}

/** Text → Text-to-speech (CapCut): the same voice picker as Generate → Voice — chips, cards with ▶ samples, trending,
 * ready and the user's own voices — then «Read aloud» puts the voice on the timeline where the text starts. */
function TextToSpeech({ element }: { element: TimelineElement }) {
	const t = useT();
	const [voice, setVoice] = useState("ryan");
	const [voiceLang, setVoiceLang] = useState("auto");
	const [busy, setBusy] = useState(false);
	const content = element.type === "text" ? String(element.params.content ?? "") : "";
	// samples in the language of the text (a Russian line plays Russian samples)
	const lang = useVoiceLang(content);
	const saved = useSavedVoices();
	const library = useLibraryCards(lang.ui, lang.sample);
	const cards = useMemo(() => [...myCards(saved), ...library], [saved, library]);
	useVoiceFitsModel(voice, setVoice);
	const read = async () => {
		setBusy(true);
		const editor = EditorCore.getInstance();
		// the voice starts where the text does
		editor.playback.seek({ time: element.startTime });
		try {
			await generate("voice", voice.startsWith("trend:") ? { text: content, trend: voice.slice(6), lang: voiceLang } : { text: content, speaker: voice, style: "", lang: voiceLang }, { place: true });
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="flex flex-col gap-2 px-4 pb-3" data-tts>
			<VoicePicker
				label="text-tts"
				cards={cards}
				value={voice}
				onPick={(id) => {
					followVoiceModel(id);
					const own = voiceLanguage(id);
					if (own) setVoiceLang(own);
					setVoice(id);
				}}
			/>
			<VoiceLanguage value={voiceLang} onChange={setVoiceLang} />
			<VoiceModelSelect />
			<Button disabled={!content.trim() || busy || !!needsKey(cards.find((c) => c.id === voice))} onClick={() => void read()} data-tts-run>
				{busy ? t("Making the voice…") : t("Read aloud")}
			</Button>
		</div>
	);
}

export function registerCapcutSections() {
	// Cutout — what part of the picture shows: remove background, chroma key (and the masks, sections/builtin.tsx)
	// a photo too: one PNG with alpha (neural/apply.ts → applyToPhoto), the same switch
	registerInspectorSection({ id: "cutout.remove", tab: "cutout", title: "Remove background", order: 100, appliesTo: (e) => e.type === "video" || e.type === "image", render: (p) => <CutoutSection {...p} /> });
	registerInspectorSection({ id: "cutout.chroma", tab: "cutout", title: "Chroma key", order: 200, appliesTo: (e) => e.type === "video" || e.type === "image", render: (p) => <ChromaKeySection {...p} /> });
	// Motion: the clip's animation, then (motion/inspector.tsx) tracking, follow, make vertical, and stabilize last
	registerInspectorSection({ id: "stabilize", tab: "animation", title: "Stabilize", order: 500, bare: true, appliesTo: (e) => e.type === "video", render: (p) => <StabilizeSection element={p.element as VideoElement} /> });
	registerInspectorSection({ id: "adjust.color", tab: "color", title: "Color", order: 50, bare: true, appliesTo: (e) => isVisualElement(e), render: (p) => <AdjustColor {...p} /> });
	// the same In / Out / Loop presets as text, on the whole picture (services/renderer/resolve.ts); a graphic is a sticker here
	registerInspectorSection({ id: "clip.animation", tab: "animation", title: "Animation", order: 100, appliesTo: (e) => e.type === "video" || e.type === "image" || e.type === "sticker" || e.type === "graphic", render: (p) => <TextAnimationTab element={p.element as TextElement} trackId={p.trackId} /> });
	// Text → Style: the ready-made looks of the words
	registerInspectorSection({ id: "text.bubble", tab: "style", title: "Bubble", order: 100, appliesTo: (e) => e.type === "text", render: (p) => <BubbleSection {...p} /> });
	registerInspectorSection({ id: "text.wordart", tab: "style", title: "Word art", order: 200, appliesTo: (e) => e.type === "text", render: (p) => <WordArtSection {...p} /> });
	registerInspectorSection({ id: "captions.template", tab: "style", title: "Caption template", order: 50, appliesTo: isCaption, render: (p) => <CaptionTemplateSection element={p.element} /> });
	registerInspectorSection({ id: "text.tracking", tab: "animation", title: "Tracking", order: 200, appliesTo: (e) => e.type === "text", render: (p) => <TextTrackingSection element={p.element} /> });
	registerInspectorSection({ id: "text.tts", tab: "tts", title: "Text-to-speech", order: 100, appliesTo: (e) => e.type === "text", render: (p) => <TextToSpeech element={p.element} /> });
}
