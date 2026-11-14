"use client";

// The AI tools in CapCut's places of the inspector: Video → Retouch → Face (GFPGAN), and in Audio (an audio clip's own
// tab, a video's Audio tab) Enhance voice (DeepFilterNet 3), Separate voice and music (Demucs v4, or Apple's built-in
// isolation before that download) and Voice changer (voice effects, or another voice with OpenVoice v2). Each makes a
// processed copy of the clip's media (neural/apply.ts): progress here and in the job center, one ⌘Z or "Use original"
// brings the original back. A tool whose model isn't on this Mac yet downloads it on the first run, inside the same
// progress (no question; the catalog names each tool's model, apply.ts waits for it).
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { InspectorRow, InspectorSlider, Segmented, Split } from "@/components/editor/panels/properties/components/inspector-ui";
import { NumberParamField } from "@/components/editor/panels/properties/components/property-param-field";
import type { NumberParamDefinition } from "@/params";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEditor } from "@/editor/use-editor";
import { useSavedVoices } from "@/generate/components/my-voices";
import { myCards, readyCards, type VoiceCard, VoicePicker } from "@/generate/components/voice-picker";
import { useT } from "@/i18n";
import { etaSeconds, formatDuration, jobCenter, useJobsStore } from "@/jobs/store";
import type { TimelineElement } from "@/timeline";
import { applyToClip, jobIdsOfClip, restoreOriginal } from "../apply";
import { type NeuralFamilyId, neuralEffect, TOOL_FAMILIES, VOICE_EFFECTS } from "../catalog";
import { AiStepSwitch } from "./ai-step-switch";

type ToolId = keyof typeof TOOL_FAMILIES;

function run(trackId: string, element: TimelineElement, family: NeuralFamilyId, values: Record<string, string | number>) {
	// A new run: the clip's earlier error goes.
	const mine = jobIdsOfClip(element.id);
	jobCenter.markSeen((j) => mine.includes(j.id));
	if (!applyToClip(trackId, element.id, family, values)) toast.error("Select a video or a sound first");
}

/** What the clip shows now (when it is this tool's result), its running jobs and the last error. */
function ToolStatus({ element, trackId, tools }: { element: TimelineElement; trackId: string; tools: ToolId[] }) {
	const t = useT();
	const mediaId = "mediaId" in element ? element.mediaId : null;
	const asset = useEditor((e) => (mediaId ? e.media.getAssets().find((a) => a.id === mediaId) : undefined), ["media"]);
	const family = asset?.neural ? neuralEffect(asset.neural.effect)?.family : undefined;
	const shown = family && (tools as string[]).includes(family) ? asset?.neural : undefined;
	const jobIds = jobIdsOfClip(element.id);
	const jobs = useJobsStore((s) => s.jobs);
	const running = jobs.filter((j) => j.status === "running" && jobIds.includes(j.id) && tools.some((id) => j.title.startsWith(TOOL_FAMILIES[id].name)));
	const failed = jobs.find((j) => j.status === "error" && jobIds.includes(j.id) && !j.seen && tools.some((id) => j.title.startsWith(TOOL_FAMILIES[id].name)));
	const now = Date.now();
	return (
		<>
			{running.map((job) => {
				const eta = etaSeconds(job, now);
				return (
					<div key={job.id} className="flex min-w-0 flex-col gap-1" data-ai-tool-progress={job.id}>
						<div className="bg-accent h-1.5 w-full overflow-hidden rounded-full">
							<div className="bg-primary h-full transition-[width]" style={{ width: `${Math.round((job.progress ?? 0) * 100)}%` }} />
						</div>
						<div className="flex items-center justify-between gap-2">
							<span className="text-muted-foreground truncate text-[11px]">
								{job.stage ? `${t(job.stage)} · ` : ""}
								{Math.round((job.progress ?? 0) * 100)}%{eta != null ? ` · ~${formatDuration(eta)}` : ""}
							</span>
							<button type="button" className="text-muted-foreground hover:text-foreground text-[11px]" onClick={() => job.cancel?.()}>
								{t("Cancel")}
							</button>
						</div>
					</div>
				);
			})}
			{failed && (
				<p className="text-destructive text-[11px] leading-snug" data-ai-tool-error>
					{failed.message}
				</p>
			)}
			{/* an AI step of this tool anywhere in the clip's chain: its switch (on = result, off = the clip without it) */}
			<AiStepSwitch element={element} trackId={trackId} families={tools as NeuralFamilyId[]} />
			{shown && (
				<div className="flex justify-end" data-ai-tool-applied={shown.effect}>
					<button
						type="button"
						className="text-muted-foreground hover:text-foreground shrink-0 text-[11px]"
						data-ai-tool-original
						title={t("Back to your own file: every AI step on this clip goes (⌘Z brings them back)")}
						onClick={() => restoreOriginal(trackId, element.id)}
					>
						{t("Use original")}
					</button>
				</div>
			)}
		</>
	);
}

const STRENGTH_PARAM: NumberParamDefinition = { type: "number", key: "strength", label: "Strength", default: 70, min: 10, max: 100, step: 5 };

function StrengthRow({ id, value, onChange }: { id: string; value: number; onChange: (v: number) => void }) {
	const t = useT();
	return (
		<InspectorRow rowId={`${id}.strength`} label={t("Strength")}>
			<Split slider>
				<InspectorSlider label={t("Strength")} min={10} max={100} step={5} value={Math.round(value * 100)} onChange={(v) => onChange(v / 100)} onCommit={() => {}} />
				{/* a field, not a caption: in a narrow inspector the slider is hidden and this number is the control (B8) */}
				<NumberParamField param={STRENGTH_PARAM} value={Math.round(value * 100)} unit="%" onPreview={(v) => onChange(v / 100)} onCommit={() => {}} />
			</Split>
		</InspectorRow>
	);
}

/** Retouch → Face. */
export function RetouchFace({ element, trackId }: { element: TimelineElement; trackId: string }) {
	const t = useT();
	const [strength, setStrength] = useState(0.7);
	return (
		<div className="flex flex-col gap-2 px-4 pb-3" data-ai-tool="retouch">
			<StrengthRow id="retouch" value={strength} onChange={setStrength} />
			<ToolStatus element={element} trackId={trackId} tools={["retouch"]} />
			<Button size="sm" title={t("The person's own face, restored: sharper eyes, smoother skin.")} onClick={() => run(trackId, element, "retouch", { strength })} data-ai-tool-run="retouch">
				{t("Retouch face")}
			</Button>
		</div>
	);
}

/** Fix → Remove flickers (no model). */
export function RemoveFlickers({ element, trackId }: { element: TimelineElement; trackId: string }) {
	const t = useT();
	const [amount, setAmount] = useState<"light" | "medium" | "strong">("medium");
	return (
		<div className="flex flex-col gap-2 px-4 pb-3" data-ai-tool="deflicker">
			<InspectorRow rowId="deflicker.amount" label={t("Amount")} stackWhenNarrow>
				<Segmented
					label={t("Amount")}
					value={amount}
					options={[
						{ value: "light", label: t("Light") },
						{ value: "medium", label: t("Medium") },
						{ value: "strong", label: t("Strong") },
					]}
					onChange={setAmount}
				/>
			</InspectorRow>
			<ToolStatus element={element} trackId={trackId} tools={["deflicker"]} />
			<Button size="sm" title={t("Evens out the brightness from frame to frame: lights on mains power, timelapses.")} onClick={() => run(trackId, element, "deflicker", { amount })} data-ai-tool-run="deflicker">
				{t("Remove flickers")}
			</Button>
		</div>
	);
}

/** Color → AI color correction (no model). */
export function AutoColor({ element, trackId }: { element: TimelineElement; trackId: string }) {
	const t = useT();
	const [strength, setStrength] = useState(0.6);
	return (
		<div className="flex flex-col gap-2 px-4 pb-3" data-ai-tool="autoColor">
			<StrengthRow id="autoColor" value={strength} onChange={setStrength} />
			<ToolStatus element={element} trackId={trackId} tools={["autoColor"]} />
			<Button size="sm" title={t("White balance and levels set from the picture itself, followed smoothly over time.")} onClick={() => run(trackId, element, "autoColor", { strength })} data-ai-tool-run="autoColor">
				{t("Correct color")}
			</Button>
		</div>
	);
}

/** A picture's or clip's colours as the server's Color match reads them: 256 levels per channel, "r,…;g,…;b,…". */
export async function histogramOf(file: File, type: string): Promise<string> {
	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) throw new Error("This Mac can't read the reference's colours.");
	const h = [new Array(256).fill(0), new Array(256).fill(0), new Array(256).fill(0)];
	const add = (source: CanvasImageSource, w: number, ht: number) => {
		canvas.width = 160;
		canvas.height = Math.max(1, Math.round((160 * ht) / Math.max(1, w)));
		ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
		const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
		for (let i = 0; i < px.length; i += 4) {
			h[0][px[i]]++;
			h[1][px[i + 1]]++;
			h[2][px[i + 2]]++;
		}
	};
	if (type === "image") {
		const bitmap = await createImageBitmap(file);
		add(bitmap, bitmap.width, bitmap.height);
		bitmap.close();
	} else {
		// A clip: three frames (a quarter, half, three quarters in).
		const url = URL.createObjectURL(file);
		const video = document.createElement("video");
		video.muted = true;
		video.preload = "auto";
		try {
			await new Promise<void>((resolve, reject) => {
				video.onloadeddata = () => resolve();
				video.onerror = () => reject(new Error("This reference clip can't be read. Pick a picture or another clip."));
				video.src = url;
			});
			for (const at of [0.25, 0.5, 0.75]) {
				await new Promise<void>((resolve) => {
					video.onseeked = () => resolve();
					video.currentTime = (video.duration || 1) * at;
				});
				add(video, video.videoWidth, video.videoHeight);
			}
		} finally {
			URL.revokeObjectURL(url);
		}
	}
	return h.map((c) => c.join(",")).join(";");
}

/** Adjust → Color match: the clip's colours brought to a reference picture or clip from Media (no model). */
export function ColorMatch({ element, trackId }: { element: TimelineElement; trackId: string }) {
	const t = useT();
	const own = "mediaId" in element ? element.mediaId : null;
	const references = useEditor((e) => e.media.getAssets().filter((a) => (a.type === "image" || a.type === "video") && a.id !== own && !a.ephemeral), ["media"]);
	const [refId, setRefId] = useState("");
	const [strength, setStrength] = useState(0.8);
	const [measuring, setMeasuring] = useState(false);
	const go = async () => {
		const reference = references.find((a) => a.id === refId);
		if (!reference?.file) return;
		setMeasuring(true);
		try {
			run(trackId, element, "colorMatch", { strength, ref: await histogramOf(reference.file, reference.type) });
		} catch (error) {
			toast.error((error as Error).message);
		} finally {
			setMeasuring(false);
		}
	};
	return (
		<div className="flex flex-col gap-2 px-4 pb-3" data-ai-tool="colorMatch">
			<Select value={refId || "none"} onValueChange={(v) => setRefId(v === "none" ? "" : v)}>
				<SelectTrigger className="h-7 text-xs" data-color-match-ref title={t("The picture or clip whose colours this clip takes")}>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="none" className="text-xs">
						{references.length ? t("Pick a reference") : t("Add a picture or clip to Media first")}
					</SelectItem>
					{references.map((a) => (
						<SelectItem key={a.id} value={a.id} className="text-xs">
							{a.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<StrengthRow id="colorMatch" value={strength} onChange={setStrength} />
			<ToolStatus element={element} trackId={trackId} tools={["colorMatch"]} />
			<Button size="sm" title={t("The clip's colours brought to a reference picture or clip.")} disabled={!refId || measuring} onClick={() => void go()} data-ai-tool-run="colorMatch">
				{t("Match colors")}
			</Button>
		</div>
	);
}

/** Audio → Enhance voice. */
export function EnhanceVoice({ element, trackId }: { element: TimelineElement; trackId: string }) {
	const t = useT();
	const [strength, setStrength] = useState(1);
	return (
		<div className="flex flex-col gap-2 px-4 pb-3" data-ai-tool="voiceEnhance">
			<StrengthRow id="voiceEnhance" value={strength} onChange={setStrength} />
			<ToolStatus element={element} trackId={trackId} tools={["voiceEnhance"]} />
			<Button size="sm" title={t("Noise, hum and room taken out of the voice, on this Mac.")} onClick={() => run(trackId, element, "voiceEnhance", { strength })} data-ai-tool-run="voiceEnhance">
				{t("Enhance voice")}
			</Button>
		</div>
	);
}

/**
 * Audio → Separate voice and music. Best: the model on this Mac (it comes with the first run, inside the progress);
 * Quick: what macOS has built in, at once.
 */
export function SeparateVoice({ element, trackId }: { element: TimelineElement; trackId: string }) {
	const t = useT();
	const [engine, setEngine] = useState<"best" | "quick">("best");
	return (
		<div className="flex flex-col gap-2 px-4 pb-3" data-ai-tool="separate">
			<InspectorRow rowId="separate.engine" label={t("Quality")}>
				<Segmented
					label={t("Quality")}
					value={engine}
					options={[
						{ value: "best", label: t("Best"), title: t("The separation model on this Mac (520 MB once)") },
						{ value: "quick", label: t("Quick"), title: t("What macOS has built in: faster, rougher") },
					]}
					onChange={setEngine}
				/>
			</InspectorRow>
			<ToolStatus element={element} trackId={trackId} tools={["separate"]} />
			<Button size="sm" title={t("The clip keeps the voice; the music becomes a clip of its own under it.")} onClick={() => run(trackId, element, "separate", { engine })} data-ai-tool-run="separate">
				{t("Separate")}
			</Button>
		</div>
	);
}

/** Audio → Voice changer: voice effects (no download) and voices (ready-made and My voices; one download). */
export function VoiceChanger({ element, trackId }: { element: TimelineElement; trackId: string }) {
	const t = useT();
	const [voice, setVoice] = useState("deep");
	const mine = useSavedVoices();
	// One grid as everywhere a voice is picked: the effects (each with its sample: a ready voice through it), the ready
	// voices and My voices — the words and timing stay.
	const cards = useMemo<VoiceCard[]>(
		() => [
			...VOICE_EFFECTS.map((v) => ({ id: v.id, name: t(v.name), sample: `/api/voice-sample/fx:${v.id}`, groups: ["filters" as const] })),
			...readyCards().map((c) => ({ ...c, id: `ready:${c.id}` })),
			...myCards(mine).map((c) => ({ ...c, id: `my:${c.id}` })),
		],
		[mine, t],
	);
	return (
		<div className="flex flex-col gap-2 px-4 pb-3" data-ai-tool="voiceChange">
			<VoicePicker label="voice-changer" cards={cards} value={voice} onPick={setVoice} first="filters" />
			<ToolStatus element={element} trackId={trackId} tools={["voiceChange"]} />
			<Button size="sm" onClick={() => run(trackId, element, "voiceChange", { voice })} data-ai-tool-run="voiceChange">
				{t("Change voice")}
			</Button>
		</div>
	);
}
