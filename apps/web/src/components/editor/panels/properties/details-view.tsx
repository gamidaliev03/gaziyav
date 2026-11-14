"use client";

import { useState } from "react";

// Nothing selected (CapCut 9.5 «Details»): the project's facts in two columns — the project, a divider, then its
// timeline — and Modify at the bottom opens the project settings. Every value says what is true in Gaziyav.
import { HugeiconsIcon } from "@/components/ui/icon";
import { HelpCircleIcon } from "@hugeicons/core-free-icons";
import { useShellStore } from "@/components/editor/shell-store";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEditor } from "@/editor/use-editor";
import { create } from "zustand";
import { cn } from "@/utils/ui";
import { ProjectTab } from "./project-tab";
import { frameRateToFloat } from "@/fps/utils";
import { useT } from "@/i18n";
import { formatOf } from "@/preview/canvas-format";

type Row = { label: string; value: string; hint?: string };

/** A rate as editors write it, the Export window's way: 25fps, 29.97fps, 23.976fps (it read 25.00fps and 23.98fps). */
export function fpsLabel(rate: number): string {
	const ntsc = [23.976, 29.97, 59.94].find((value) => Math.abs(value - rate) < 0.01);
	return `${ntsc ?? Number(rate.toFixed(2))}fps`;
}

/** The tab chosen when nothing is selected; kept while clips are selected and back. */
const useDetailsTab = create<{ tab: "project" | "details"; setTab: (tab: "project" | "details") => void }>()((set) => ({ tab: "details", setTab: (tab) => set({ tab }) }));

export function DetailsView() {
	const t = useT();
	const project = useEditor((e) => e.project.getActiveOrNull(), ["project"]);
	const setDialog = useShellStore((s) => s.setDialog);
	const hasClips = useEditor((e) => (e.scenes.getActiveSceneOrNull()?.tracks.main.elements.length ?? 0) > 0, ["timeline"]);
	const tab = useDetailsTab((s) => s.tab);
	const setTab = useDetailsTab((s) => s.setTab);
	if (!project) return null;
	const { canvasSize, fps } = project.settings;
	const projectRows: Row[] = [
		{ label: t("Name"), value: project.metadata.name },
		{ label: t("Path"), value: t("Gaziyav library") },
		{ label: t("Floating-point"), value: t("Turned off"), hint: t("Colours are processed in 8 bits per channel.") },
		{ label: t("Imported media"), value: t("Copied to project"), hint: t("Imported files are copied into the project: moving or renaming the originals doesn't break it.") },
	];
	const timelineRows: Row[] = [
		{ label: t("Aspect ratio"), value: formatOf(canvasSize) ?? t("Custom") },
		{ label: t("Resolution"), value: `${canvasSize.width}×${canvasSize.height}` },
		{ label: t("Frame rate"), value: fpsLabel(frameRateToFloat(fps)) },
		{ label: t("Color space"), value: "Rec. 709 SDR" },
	];
	return (
		<>
			{/* CapCut: «Project · Details» once the project has clips (an empty one shows Details alone). */}
			<div className="flex h-11 shrink-0 items-center gap-5 border-b px-4">
				{hasClips && (
					<button type="button" data-inspector-tab-project aria-pressed={tab === "project"} onClick={() => setTab("project")} className={cn("text-sm font-medium relative after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']", tab === "project" ? "text-primary" : "text-foreground/85 hover:text-foreground")}>
						{t("Project")}
					</button>
				)}
				<button type="button" data-details-header aria-pressed={tab === "details" || !hasClips} onClick={() => setTab("details")} className={cn("text-sm font-medium relative after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']", tab === "details" || !hasClips ? "text-primary" : "text-foreground/85 hover:text-foreground")}>
					{t("Details")}
				</button>
			</div>
			{hasClips && tab === "project" ? (
				<ProjectTab />
			) : (
			<>
			<div data-inspector-body data-inspector-empty data-project-details className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-2">
				<Rows rows={projectRows} />
				<div className="border-foreground/[0.08] my-2 border-t" />
				<Rows rows={timelineRows} />
			</div>
			<div className="flex shrink-0 justify-end border-t px-4 py-2">
				<Button size="sm" variant="secondary" className="h-7 px-4" data-project-modify onClick={() => setDialog("settings")}>
					{t("Modify")}
				</Button>
			</div>
			</>
			)}
		</>
	);
}

function Rows({ rows }: { rows: Row[] }) {
	return (
		<dl className="flex flex-col">
			{rows.map((row) => (
				<div key={row.label} className="grid grid-cols-[minmax(110px,max-content)_minmax(0,1fr)] items-baseline gap-3 py-2 text-[13px] leading-4">
					<dt className="text-muted-foreground flex items-center gap-1">
						{row.label}
						{row.hint && <HintIcon hint={row.hint} />}
					</dt>
					<dd className="break-words" data-no-translate title={row.value}>
						{row.value}
					</dd>
				</div>
			))}
		</dl>
	);
}

/** CapCut's ⓘ next to a Details row: its hint shows on hover, on focus and on a click (a click used to do nothing). */
function HintIcon({ hint }: { hint: string }) {
	const [open, setOpen] = useState(false);
	// The tooltip closes itself on a press; preventing that keeps it open for the click.
	const show = (event: React.SyntheticEvent) => {
		event.preventDefault();
		setOpen(true);
	};
	return (
		<Tooltip open={open} onOpenChange={setOpen}>
			<TooltipTrigger asChild>
				<button type="button" aria-label={hint} data-details-hint onPointerDown={show} onClick={show} className="text-muted-foreground/70 hover:text-foreground -m-1 inline-flex size-6 items-center justify-center">
					{/* a 24 px target (G4) around a 16 px icon (I2); the negative margin keeps the row as it was */}
					<HugeiconsIcon icon={HelpCircleIcon} className="size-4" />
				</button>
			</TooltipTrigger>
			<TooltipContent className="max-w-60">{hint}</TooltipContent>
		</Tooltip>
	);
}
