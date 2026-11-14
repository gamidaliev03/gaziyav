"use client";

// Home's one control besides the projects: «New project» and its format. The owner, 13.11: «главный экран … куча лишней
// the editor say where the key goes; AI image / video / voice / Lipsync are in its ИИ and Аудио tabs, Assemble in the
// project menu, captions in Текст → Субтитры, Cutout and Upscale in Эффекты).
import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@/components/ui/icon";
import { ArrowDown01Icon, Add01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Tab } from "@/components/editor/panels/assets/assets-panel-store";
import { type Kind, usePoint } from "@/cloud/client";
import { lastFormat, PROJECT_FORMATS, type ProjectFormat } from "./new-project";
import { useT } from "@/i18n";
import { cn } from "@/utils/ui";

export type StartOptions = { format?: ProjectFormat; files?: File[]; /** Left-panel tab the editor opens on, and its section. */ tab?: Tab; section?: string };
export type StartProject = (opts?: StartOptions) => void;

export const MEDIA_ACCEPT = "video/*,audio/*,image/*";

/** Opens a link in the browser (the desktop app sends every outside link there). */
export const openOutside = (url: string) => void window.open(url, "_blank");

/** A new project on the Generate tab, in this mode, with the request already typed. */
export function startPoint(onStart: StartProject, kind: Kind, prompt?: string) {
	usePoint.getState().setDraft({ kind, ...(prompt ? { prompt } : {}) });
	// CapCut's places: Media → Generate → AI image / AI video.
	onStart({ tab: "avatar", section: kind === "image" ? "ai-image" : "ai-video" });
}

/**
 * «＋ New project» (⌘N) and its ▾: 16:9 · 9:16 · 1:1 in a small popover. A pick starts the project in that format and is
 * remembered — «New project», ⌘N and dropped files start with it from then on (final-B I1, 07.11: 9:16 took three clicks
 * every time). It was a row of three buttons beside it; now one button, the format inside (the owner, 13.11).
 */
export function NewProjectButton({ onStart, starting }: { onStart: StartProject; starting: boolean }) {
	const t = useT();
	const [last, setLast] = useState<ProjectFormat>("16:9");
	const [open, setOpen] = useState(false);
	// localStorage is read after the mount (the page is rendered once without it).
	useEffect(() => setLast(lastFormat() ?? "16:9"), []);
	return (
		<div className="flex shrink-0 items-center gap-px" data-home-new>
			<Hint label="New project" shortcut="⌘N">
				<Button type="button" data-testid="new-project" disabled={starting} onClick={() => onStart()} className="h-8 shrink-0 gap-1.5 rounded-r-none px-3 text-[13px]">
					<HugeiconsIcon icon={Add01Icon} className="size-4" strokeWidth={2.2} />
					New project
				</Button>
			</Hint>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button type="button" disabled={starting} aria-label="New project format" title={last} data-home-format-menu className="h-8 w-7 shrink-0 rounded-l-none px-0">
						<HugeiconsIcon icon={ArrowDown01Icon} className="size-3.5" />
					</Button>
				</PopoverTrigger>
				<PopoverContent align="end" className="w-auto p-1">
					<div className="flex items-center gap-0.5" role="group" aria-label="New project format" data-home-formats>
						{PROJECT_FORMATS.map((f) => (
							<button
								key={f.id}
								type="button"
								aria-pressed={f.id === last}
								title={`${t(f.label)}: ${t(f.hint)}`}
								data-home-format={f.id}
								onClick={() => {
									setLast(f.id);
									setOpen(false);
									onStart({ format: f.id });
								}}
								className={cn(
									"h-7 rounded-md px-2.5 text-[12px] font-medium tabular-nums transition-colors",
									f.id === last ? "bg-foreground/[0.1] text-foreground" : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
								)}
							>
								{f.id}
							</button>
						))}
					</div>
				</PopoverContent>
			</Popover>
		</div>
	);
}
