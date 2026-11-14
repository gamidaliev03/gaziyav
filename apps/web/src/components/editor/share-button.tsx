"use client";

import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useEditor } from "@/editor/use-editor";
import { t, useT } from "@/i18n";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { useShellStore } from "./shell-store";
import { PostDialog } from "@/share/components/post-dialog";
import { watchShare } from "@/share/client";

type SavedExport = { path: string; name: string; at: number };
type StudioApp = {
	platform?: string;
	reveal?: (file: string) => void;
	share?: (file: string) => Promise<"shared" | "missing">;
};
const studioApp = () => (typeof window === "undefined" ? undefined : (window as unknown as { studioApp?: StudioApp }).studioApp);
const onMac = () => studioApp()?.platform === "darwin";

/** Saved files that are the video itself (not a caption file or a still frame saved on the way). */
const VIDEO_FILE = /\.(mp4|mov|webm|gif|mp3|m4a|aac|flac|wav)$/i;

/** The last video each project saved (Export → Save): Share hands it on without exporting again. */
const useSavedExports = create<{ byProject: Record<string, SavedExport>; remember: (projectId: string, saved: SavedExport) => void }>()(
	persist(
		(set) => ({
			byProject: {},
			remember: (projectId, saved) => set((state) => ({ byProject: { ...state.byProject, [projectId]: saved } })),
		}),
		{ name: "gaziyav-saved-exports" },
	),
);

/** «Export and share» was pressed: the next file the export saves opens the Share menu. */
let shareNext = false;

async function share(file: string) {
	if ((await studioApp()?.share?.(file)) === "missing") toast.error(t("The exported file was moved or deleted — export it again."));
}

/**
 * An export of `projectId` is on disk (the Save dialog, the «Export to» folder or the ffmpeg pass: every way a file
 * lands, export-button.tsx says so here). Share remembers it; the one «Export and share» asked for opens the Share
 * menu the moment it is saved.
 */
export function rememberExport(projectId: string, filePath: string) {
	if (!VIDEO_FILE.test(filePath)) return;
	void import("@/platform/desktop-sections").then((m) => m.noteExport(filePath));
	const wanted = shareNext;
	shareNext = false;
	useSavedExports.getState().remember(projectId, { path: filePath, name: filePath.slice(filePath.lastIndexOf("/") + 1), at: Date.now() });
	if (wanted && onMac()) void share(filePath);
}

/**
 * Share (CapCut: share for review, publish): the video goes on through the Mac's own Share menu — AirDrop, Messages,
 * Mail, Notes, any app. It shares the project's last export; «Export and share» saves a new one first and the Share
 * menu opens the moment the file is saved.
 */
export function ShareButton() {
	const t = useT();
	const editor = useEditor();
	const projectId = useEditor((e) => e.project.getActiveOrNull()?.metadata.id ?? null);
	const saved = useSavedExports((s) => (projectId ? s.byProject[projectId] : undefined));
	const [open, setOpen] = useState(false);
	const [posting, setPosting] = useState(false);
	const app = studioApp();
	// Uploads and scheduled posts show in the header chip while a project is open.
	useEffect(() => watchShare(), []);
	const mac = onMac();

	// The Export window closed without exporting: the Share menu is not wanted any more.
	useEffect(
		() =>
			useShellStore.subscribe((state, previous) => {
				if (previous.exportOpen && !state.exportOpen && !editor.project.getExportState().isExporting) shareNext = false;
			}),
		[editor],
	);

	const exportAndShare = () => {
		shareNext = true;
		setOpen(false);
		useShellStore.getState().setExportOpen(true);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="secondary"
					size="sm"
					className="relative h-[22px] w-[18px] rounded-[5px] px-0 after:absolute after:-inset-y-px after:-right-1.5 after:left-0 after:content-['']"
					data-share-button
					aria-label={t("Share")}
					title={t("Share")}
				>
					<HugeiconsIcon icon={ArrowDown01Icon} className="size-3" />
				</Button>
			</PopoverTrigger>
			{/* One orange action (Post); the rest are quiet. 6 px below the button, as the header's other menus. */}
			<PopoverContent align="end" sideOffset={6} className="flex w-64 flex-col gap-2 p-3" data-share-popover>
				<Button size="sm" data-share-post onClick={() => { setOpen(false); setPosting(true); }}>
					{t("Post to Shorts, Reels, TikTok…")}
				</Button>
				<div className="border-foreground/[0.07] my-0.5 border-t" />
				{saved ? (
					<>
						<div className="text-muted-foreground text-xs">{t("Last export")}</div>
						<div className="truncate text-sm" title={saved.path} data-no-translate data-share-last>
							{saved.name}
						</div>
						{mac && (
							<Button size="sm" variant="outline" data-share-file onClick={() => { setOpen(false); void share(saved.path); }}>
								{t("Share…")}
							</Button>
						)}
						<Button size="sm" variant="outline" data-share-reveal onClick={() => app?.reveal?.(saved.path)}>
							{mac ? t("Show in Finder") : t("Show in Explorer")}
						</Button>
						<Button size="sm" variant="ghost" data-share-export onClick={exportAndShare}>
							{t("Export again and share")}
						</Button>
					</>
				) : (
					<>
						<Button size="sm" variant="outline" data-share-export onClick={exportAndShare}>
							{mac ? t("Export and share") : t("Export")}
						</Button>
					</>
				)}
			</PopoverContent>
			<PostDialog open={posting} onOpenChange={setPosting} />
		</Popover>
	);
}
