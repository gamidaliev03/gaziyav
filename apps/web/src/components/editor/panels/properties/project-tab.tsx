"use client";

// CapCut's «Project» tab (nothing selected): Smart suggestions and Global edits. Each global edit is one switch for the
// whole project that runs the clip tool it stands for on every clip it fits — AI colour correction, Color match to the
// first clip, Normalize loudness, Enhance voice — on this Mac; switching it off gives the clips back their originals.
import { AiMagicIcon, ColorsIcon, Mic01Icon, VolumeHighIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { useState } from "react";
import { toast } from "sonner";
import { useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import { useT } from "@/i18n";
import type { MediaAsset } from "@/media/types";
import { applyToClip, restoreOriginal } from "@/neural/apply";
import { neuralEffect } from "@/neural/catalog";
import { histogramOf } from "@/neural/components/ai-tools";
import type { TimelineElement } from "@/timeline";

type Clip = { trackId: string; element: TimelineElement; asset: MediaAsset };
type EditId = "colorsBetter" | "colorsConsistent" | "volumeConsistent" | "voiceClearer";

/** The project's clips with a picture and the ones with sound (video with its sound, imported audio), timeline order. */
function projectClips(editor: EditorCore): { video: Clip[]; sound: Clip[] } {
	const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
	const assets = editor.media.getAssets();
	const video: Clip[] = [];
	const sound: Clip[] = [];
	if (!tracks) return { video, sound };
	for (const track of [tracks.main, ...(tracks.overlay ?? []), ...(tracks.audio ?? [])]) {
		for (const element of track.elements) {
			const asset = "mediaId" in element ? assets.find((a) => a.id === element.mediaId) : undefined;
			if (!asset) continue;
			const clip = { trackId: track.id, element, asset };
			if (element.type === "video") video.push(clip);
			if (element.type === "audio" || (element.type === "video" && (asset as { hasAudio?: boolean }).hasAudio !== false)) sound.push(clip);
		}
	}
	video.sort((a, b) => a.element.startTime - b.element.startTime);
	return { video, sound };
}

const familyOf = (clip: Clip) => (clip.asset.neural ? neuralEffect(clip.asset.neural.effect)?.family : undefined);
const normalized = (clip: Clip) => (clip.element as { params?: Record<string, unknown> }).params?.["fx.normalize"] === true;

function isOn(id: EditId, { video, sound }: { video: Clip[]; sound: Clip[] }): boolean {
	if (id === "colorsBetter") return video.length > 0 && video.every((c) => familyOf(c) === "autoColor");
	if (id === "colorsConsistent") return video.length > 1 && video.slice(1).every((c) => familyOf(c) === "colorMatch");
	if (id === "volumeConsistent") return sound.length > 0 && sound.every(normalized);
	return sound.length > 0 && sound.every((c) => familyOf(c) === "voiceEnhance");
}

async function setEdit(id: EditId, on: boolean) {
	const editor = EditorCore.getInstance();
	const clips = projectClips(editor);
	const family = { colorsBetter: "autoColor", colorsConsistent: "colorMatch", voiceClearer: "voiceEnhance" } as const;
	if (id === "volumeConsistent") {
		editor.timeline.updateElements({
			updates: clips.sound.map((c) => ({
				trackId: c.trackId,
				elementId: c.element.id,
				patch: { params: { ...(c.element as { params?: Record<string, unknown> }).params, "fx.normalize": on } } as Partial<TimelineElement>,
			})),
		});
		return;
	}
	const targets = id === "colorsConsistent" ? clips.video.slice(1) : id === "colorsBetter" ? clips.video : clips.sound;
	if (!on) {
		for (const c of targets) if (familyOf(c) === family[id]) restoreOriginal(c.trackId, c.element.id);
		return;
	}
	// Voice clearer's model, when it isn't here yet, comes inside the first clip's job (the others wait for the same download).
	let values: Record<string, string | number> = { strength: id === "colorsBetter" ? 0.6 : id === "colorsConsistent" ? 0.8 : 1 };
	if (id === "colorsConsistent") {
		const reference = clips.video[0];
		if (!reference?.asset.file) return;
		values = { ...values, ref: await histogramOf(reference.asset.file, reference.asset.type) };
	}
	let started = 0;
	for (const c of targets) if (familyOf(c) !== family[id] && applyToClip(c.trackId, c.element.id, family[id], values)) started += 1;
	if (started) toast.success(`${started} ${started === 1 ? "clip" : "clips"} started — see Jobs`);
}

const EDITS: { id: EditId; label: string; icon: typeof AiMagicIcon; needs: "video" | "two videos" | "sound" }[] = [
	{ id: "colorsBetter", label: "Make colors better", icon: AiMagicIcon, needs: "video" },
	{ id: "colorsConsistent", label: "Make colors consistent", icon: ColorsIcon, needs: "two videos" },
	{ id: "volumeConsistent", label: "Make volume consistent", icon: VolumeHighIcon, needs: "sound" },
	{ id: "voiceClearer", label: "Make voice clearer", icon: Mic01Icon, needs: "sound" },
];

export function ProjectTab() {
	const t = useT();
	// Re-render when the timeline or a clip's media (an AI result coming back) changes.
	useEditor((e) => e.scenes.getActiveSceneOrNull()?.tracks, ["timeline"]);
	useEditor((e) => e.media.getAssets(), ["media"]);
	const clips = projectClips(EditorCore.getInstance());
	const [suggestions, setSuggestions] = useState<{ text: string; action: string; run: () => void }[] | null>(null);
	const usable = (needs: (typeof EDITS)[number]["needs"]) =>
		needs === "video" ? clips.video.length > 0 : needs === "two videos" ? clips.video.length > 1 : clips.sound.length > 0;

	// Smart suggestions from what the project holds (no upload: everything is read here).
	const analyze = () => {
		const editor = EditorCore.getInstance();
		const tracks = editor.scenes.getActiveScene().tracks;
		const hasText = [tracks.main, ...(tracks.overlay ?? [])].some((track) => track.elements.some((e) => e.type === "text"));
		const list: { text: string; action: string; run: () => void }[] = [];
		if (clips.sound.length > 0 && !hasText)
			list.push({ text: t("Speech without captions"), action: t("Auto captions"), run: () => useAssetsPanelStore.getState().openSection("captions", "auto") });
		if (clips.sound.length > 1 && !isOn("volumeConsistent", clips)) list.push({ text: t("Clips may differ in loudness"), action: t("Make volume consistent"), run: () => void setEdit("volumeConsistent", true) });
		if (clips.video.length > 1 && !isOn("colorsConsistent", clips)) list.push({ text: t("Clips may differ in colour"), action: t("Make colors consistent"), run: () => void setEdit("colorsConsistent", true) });
		if (clips.video.length > 0 && !isOn("colorsBetter", clips)) list.push({ text: t("Colour and light can be corrected"), action: t("Make colors better"), run: () => void setEdit("colorsBetter", true) });
		setSuggestions(list);
	};

	return (
		<div data-inspector-body data-project-tab className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
			<section className="flex flex-col gap-2" data-smart-suggestions>
				<h3 className="text-muted-foreground text-sm font-medium">{t("Smart suggestions")}</h3>
				<p className="text-[15px] font-semibold leading-snug">{t("Find out how your video can be improved")}</p>
				<Button size="sm" variant="secondary" className="h-8 w-fit gap-1.5 px-3" onClick={analyze} disabled={clips.video.length + clips.sound.length === 0} data-project-analyze>
					<HugeiconsIcon icon={AiMagicIcon} className="size-4" />
					{t("Analyze")}
				</Button>
				{suggestions && (
					<ul className="flex flex-col gap-1.5" data-suggestions>
						{suggestions.length === 0 && <li className="text-muted-foreground text-xs">{t("Nothing to improve — it looks good.")}</li>}
						{suggestions.map((s) => (
							<li key={s.action} className="bg-foreground/[0.05] flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-xs">
								<span className="min-w-0">{s.text}</span>
								<Button size="sm" variant="ghost" className="text-primary h-6 shrink-0 px-2 text-xs" onClick={() => { s.run(); setSuggestions((prev) => prev?.filter((x) => x !== s) ?? null); }}>
									{s.action}
								</Button>
							</li>
						))}
					</ul>
				)}
			</section>
			<section className="flex flex-col gap-2" data-global-edits>
				<h3 className="text-muted-foreground text-sm font-medium">{t("Global edits")}</h3>
				{EDITS.map((edit) => {
					const on = isOn(edit.id, clips);
					const can = usable(edit.needs);
					return (
						<label
							key={edit.id}
							htmlFor={`global-edit-${edit.id}`}
							data-global-edit={edit.id}
							className="bg-foreground/[0.05] hover:bg-foreground/[0.08] flex h-10 cursor-pointer items-center gap-2.5 rounded-md px-3 text-sm has-[:disabled]:cursor-default has-[:disabled]:opacity-50"
						>
							<HugeiconsIcon icon={edit.icon} className="text-muted-foreground size-4 shrink-0" />
							<span className="min-w-0 flex-1 truncate">{t(edit.label)}</span>
							<Checkbox id={`global-edit-${edit.id}`} checked={on} disabled={!can} onCheckedChange={(value) => void setEdit(edit.id, value === true)} aria-label={t(edit.label)} />
						</label>
					);
				})}
			</section>
		</div>
	);
}
