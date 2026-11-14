"use client";

// CapCut's Trash (its words, `pc_trash_*` in CapCut's en.po): projects moved there wait 30 days, then go for good.
// Restore puts them back in Projects; Delete removes the project and its imported media (the original files stay).
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@/components/ui/icon";
import { ArrowLeft01Icon, Delete02Icon, RestoreBinIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { trashDaysLeft } from "@/core/managers/project-manager";
import { useEditor } from "@/editor/use-editor";
import { DeleteProjectDialog } from "@/project/components/delete-project-dialog";
import type { TProjectMetadata } from "@/project/types";
import { useT } from "@/i18n";
import { currentCode } from "@/i18n/lookup";
import { cn } from "@/utils/ui";
import { useProjectsStore } from "./store";

// the date in the interface's language (a month name in English inside the Russian UI was one of the leftovers)
const movedAt = (date: Date) =>
	date.toLocaleString(currentCode() === "en" ? "en-US" : "ru-RU", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function TrashView({ thumb }: { thumb: (project: TProjectMetadata) => React.ReactNode }) {
	const editor = useEditor();
	const t = useT();
	const trashed = useEditor((e) => e.project.getTrashedProjects());
	const setPage = useProjectsStore((s) => s.setPage);
	const [picked, setPicked] = useState<string[]>([]);
	const [deleting, setDeleting] = useState<string[] | null>(null);
	// Only ids still in Trash count (a row restored elsewhere drops out of the choice).
	const selected = useMemo(() => picked.filter((id) => trashed.some((p) => p.id === id)), [picked, trashed]);
	const all = trashed.length > 0 && selected.length === trashed.length;

	const restore = async (ids: string[]) => {
		await editor.project.restoreProjects({ ids });
		setPicked((current) => current.filter((id) => !ids.includes(id)));
		toast("Restored");
	};
	const names = (ids: string[]) => trashed.filter((p) => ids.includes(p.id)).map((p) => p.name);

	return (
		<section aria-label="Trash" data-testid="trash-view" className="flex flex-col gap-4">
			<header className="flex flex-col gap-1">
				<div className="flex items-center gap-1.5">
					<Button variant="ghost" size="icon" className="size-8 rounded-lg" aria-label="Back to projects" onClick={() => setPage("home")}>
						<HugeiconsIcon icon={ArrowLeft01Icon} className="size-5" />
					</Button>
					<h1 className="text-[18px] font-semibold">Trash</h1>
				</div>
				<p className="text-muted-foreground pl-[42px] text-[12px]">Items moved to Trash will appear here and be deleted after 30 days.</p>
			</header>

			<div className="flex min-h-8 items-center justify-between gap-3">
				<div className="flex items-center gap-3">
					<Checkbox
						aria-label="Select all"
						disabled={trashed.length === 0}
						checked={all ? true : selected.length ? "indeterminate" : false}
						onCheckedChange={(checked) => setPicked(checked === true ? trashed.map((p) => p.id) : [])}
					/>
					<span className="text-[13px] font-medium tabular-nums">
						{selected.length ? t("{n} selected", { n: selected.length }) : t("Recently moved ({n})", { n: trashed.length })}
					</span>
					{selected.length > 0 && (
						<>
							<Button variant="ghost" size="sm" className="h-7 gap-1.5 rounded-md px-2.5" onClick={() => void restore(selected)}>
								<HugeiconsIcon icon={RestoreBinIcon} className="size-4" />
								Restore
							</Button>
							<Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 h-7 gap-1.5 rounded-md px-2.5" onClick={() => setDeleting(selected)}>
								<HugeiconsIcon icon={Delete02Icon} className="size-4" />
								Delete
							</Button>
						</>
					)}
				</div>
				{trashed.length > 0 && (
					<Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 h-7 rounded-md px-2.5" onClick={() => setDeleting(trashed.map((p) => p.id))}>
						Delete all
					</Button>
				)}
			</div>

			{trashed.length === 0 ? (
				<div className="flex flex-col items-center gap-3 py-20 text-center">
					<div className="bg-foreground/[0.05] flex size-14 items-center justify-center rounded-2xl">
						<HugeiconsIcon icon={Delete02Icon} className="text-muted-foreground size-6" />
					</div>
					<p className="text-[14px] font-medium">Trash is empty</p>
				</div>
			) : (
				<div className="bg-foreground/[0.03] ring-foreground/[0.06] flex flex-col overflow-hidden rounded-xl ring-1">
					<div className="text-muted-foreground border-foreground/[0.06] flex items-center gap-4 border-b px-4 py-2 text-[12px]">
						<span className="w-4" />
						<span className="flex-1">
							Name
						</span>
						<span className="hidden w-48 md:block">
							Move time
						</span>
						<span className="w-28">
							Days remaining
						</span>
						<span className="w-[148px]" />
					</div>
					{trashed.map((project) => {
						const on = selected.includes(project.id);
						const days = trashDaysLeft(project);
						return (
							<div
								key={project.id}
								data-trash-row={project.name}
								className={cn(
									"group border-foreground/[0.06] hover:bg-foreground/[0.03] flex items-center gap-4 border-b px-4 py-2 transition-colors last:border-b-0",
									on && "bg-primary/[0.07]",
								)}
							>
								<Checkbox
									aria-label={`Select ${project.name}`}
									checked={on}
									onCheckedChange={(checked) =>
										setPicked((current) => (checked === true ? [...current, project.id] : current.filter((id) => id !== project.id)))
									}
								/>
								<span className="flex min-w-0 flex-1 items-center gap-3">
									<span className="relative size-10 shrink-0 overflow-hidden rounded-md bg-black">{thumb(project)}</span>
									<span className="truncate text-[13px] font-medium" data-no-translate>
										{project.name}
									</span>
								</span>
								<span className="text-muted-foreground hidden w-48 text-[12px] md:block">
									{project.trashedAt ? movedAt(project.trashedAt) : "—"}
								</span>
								<span className="text-muted-foreground w-28 text-[12px] tabular-nums">
									{/* the column's heading names the unit */}
									{days === null ? "" : days}
								</span>
								<span className="flex w-[148px] justify-end gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
									<Button variant="ghost" size="sm" className="h-7 rounded-md px-2.5" onClick={() => void restore([project.id])}>
										Restore
									</Button>
									<Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 h-7 rounded-md px-2.5" onClick={() => setDeleting([project.id])}>
										Delete
									</Button>
								</span>
							</div>
						);
					})}
				</div>
			)}

			<DeleteProjectDialog
				isOpen={!!deleting}
				onOpenChange={(open) => !open && setDeleting(null)}
				projectNames={deleting ? names(deleting) : []}
				onConfirm={async () => {
					const ids = deleting ?? [];
					setDeleting(null);
					await editor.project.deleteProjects({ ids });
					setPicked((current) => current.filter((id) => !ids.includes(id)));
					toast("Deleted");
				}}
			/>
		</section>
	);
}
