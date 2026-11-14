"use client";
// «Split into parts» in a song clip's right-click menu and in its inspector (Audio tab, under «Separate voice and
// music»); on a part clip: «Solo · drums» and «Full mix». Each is one ⌘Z (hear/parts.ts).
import { VolumeHighIcon, SplitIcon } from "@hugeicons/core-free-icons";
import { DEMO } from "@/demo/flag";
import { HugeiconsIcon } from "@/components/ui/icon";
import { toast } from "sonner";
import { registerInspectorSection } from "@/components/editor/panels/properties/slots";
import { Button } from "@/components/ui/button";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { EditorCore } from "@/core";
import { useT } from "@/i18n";
import { t as tr } from "@/i18n";
import type { TimelineElement } from "@/timeline";
import { canSplit, partOf, soloPart, splitIntoParts } from "../parts";

export function runSplit(trackId: string, elementId: string) {
	void splitIntoParts(trackId, elementId).then(
		(line) => toast.success(tr("Split into parts: four tracks under the song"), { description: line.includes("already split") ? tr("Already split") : undefined }),
		(error) => {
			const m = error instanceof Error ? error.message : String(error);
			if (m !== "Cancelled.") toast.error(m);
		},
	);
}

function solo(element: TimelineElement, all: boolean) {
	const p = partOf(element);
	if (!p) return;
	try {
		soloPart(p.songId, all ? null : p.part);
	} catch (error) {
		toast.error(error instanceof Error ? error.message : String(error));
	}
}

export function PartsMenuItems({ trackId, element }: { trackId: string; element: TimelineElement | null }) {
	const t = useT();
	if (!element) return null;
	// the browser edition cannot split a sound into parts (a job of the app)
	if (DEMO) return null;
	const part = partOf(element)?.part;
	if (part)
		return (
			<>
				<ContextMenuItem
					icon={<HugeiconsIcon icon={VolumeHighIcon} />}
					data-clip-menu="solo-part"
					onClick={(event: React.MouseEvent) => {
						event.stopPropagation();
						solo(element, false);
					}}
				>
					{t("Solo «· {part}»", { part })}
				</ContextMenuItem>
				<ContextMenuItem
					icon={<HugeiconsIcon icon={VolumeHighIcon} />}
					data-clip-menu="full-mix"
					onClick={(event: React.MouseEvent) => {
						event.stopPropagation();
						solo(element, true);
					}}
				>
					{t("Full mix")}
				</ContextMenuItem>
			</>
		);
	if (!canSplit(element)) return null;
	return (
		<ContextMenuItem
			icon={<HugeiconsIcon icon={SplitIcon} />}
			data-clip-menu="split-parts"
			onClick={(event: React.MouseEvent) => {
				event.stopPropagation();
				EditorCore.getInstance().selection.setSelectedElements({ elements: [{ trackId, elementId: element.id }] });
				runSplit(trackId, element.id);
			}}
		>
			{t("Split into parts")}
		</ContextMenuItem>
	);
}

function SplitPartsSection({ element, trackId }: { element: TimelineElement; trackId: string }) {
	const t = useT();
	const part = partOf(element)?.part;
	if (part)
		return (
			<div className="flex flex-col gap-2 px-4 pb-3" data-ai-tool="parts">
				<p className="text-muted-foreground text-xs">{t("This is the song's «{part}» part.", { part: t(part) })}</p>
				<div className="flex gap-2">
					<Button size="sm" variant="secondary" onClick={() => solo(element, false)} data-parts-run="solo">
						{t("Solo")}
					</Button>
					<Button size="sm" variant="secondary" onClick={() => solo(element, true)} data-parts-run="mix">
						{t("Full mix")}
					</Button>
				</div>
			</div>
		);
	return (
		<div className="flex flex-col gap-2 px-4 pb-3" data-ai-tool="parts">
			<Button size="sm" variant="secondary" onClick={() => runSplit(trackId, element.id)} data-parts-run="split">
				{t("Split into parts")}
			</Button>
		</div>
	);
}

const isUploadAudio = (e: TimelineElement) => e.type === "audio" && (e.sourceType === "upload" || e.sourceType === "library");
const videoWithSound = (e: TimelineElement) => e.type === "video" && EditorCore.getInstance().media.getAssets().find((a) => a.id === e.mediaId)?.hasAudio !== false;
registerInspectorSection({ id: "audio.parts@basic", tab: "basic", title: "Split into parts", order: 415, defaultOpen: true, appliesTo: isUploadAudio, render: (props) => <SplitPartsSection {...props} /> });
registerInspectorSection({ id: "audio.parts@audio", tab: "audio", title: "Split into parts", order: 415, defaultOpen: false, appliesTo: videoWithSound, render: (props) => <SplitPartsSection {...props} /> });
