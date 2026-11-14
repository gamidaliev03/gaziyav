"use client";

// Project menu → Versions…: the open project's versions with their times, newest first; «Open as a copy» makes the
// chosen one a new project next to this one (this project stays as it is) and opens it. project/versions.ts.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EditorCore } from "@/core";
import { useT } from "@/i18n";
import { listProjectVersions, openVersionAsCopy, type ProjectVersion } from "@/project/versions";
import { cn } from "@/utils/ui";

const REASON: Record<string, string> = {
	open: "Opened",
	periodic: "While editing",
	save: "Saved (⌘S)",
	"before-restore": "Before a restore",
	"before-join": "Before joining timelines",
	kept: "Kept on disk",
};
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Off until «Open as a copy» is proven on a built app (see the footer). */
const OPEN_AS_COPY = true;

export function EditorVersionsDialog({ open, onOpenChange, projectId, projectName }: { open: boolean; onOpenChange: (open: boolean) => void; projectId: string; projectName: string }) {
	const t = useT();
	const router = useRouter();
	const [list, setList] = useState<ProjectVersion[] | null>(null);
	const [chosen, setChosen] = useState<ProjectVersion | null>(null);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		if (!open || !projectId) return;
		setList(null);
		setChosen(null);
		void (async () => {
			// what is on the screen now is a version of its own first (Save); then the list
			await EditorCore.getInstance().save.flush().catch(() => false);
			const versions = await listProjectVersions(projectId);
			setList(versions);
			setChosen(versions[0] ?? null);
		})();
	}, [open, projectId]);
	const openCopy = async () => {
		if (!chosen) return;
		setBusy(true);
		const name = `${projectName} — ${when(chosen.at)}`;
		const id = await openVersionAsCopy(projectId, chosen, name).catch(() => null);
		setBusy(false);
		if (!id) {
			toast.error(t("This version can't be opened"));
			return;
		}
		onOpenChange(false);
		toast.success(t("Opened as a copy: {name}", { name }));
		router.push(`/editor/${id}`);
	};
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent data-editor-versions>
				<DialogHeader>
					<DialogTitle>{t("Versions")}</DialogTitle>
				</DialogHeader>
				<DialogBody className="max-h-[50vh] gap-1 overflow-y-auto">
					{list === null ? (
						<p className="text-muted-foreground text-sm">{t("Loading…")}</p>
					) : list.length === 0 ? (
						<p className="text-muted-foreground text-sm">{t("No versions of this project yet.")}</p>
					) : (
						list.map((v) => (
							<button
								key={`${v.where}:${v.key}`}
								type="button"
								data-version-row={v.where}
								aria-pressed={chosen === v}
								onClick={() => setChosen(v)}
								className={cn("flex items-center justify-between rounded-md px-3 py-1.5 text-left text-sm transition-colors", chosen === v ? "bg-primary/10 text-primary" : "hover:bg-accent")}
							>
								<span className="tabular-nums">{when(v.at)}</span>
								<span className="text-muted-foreground text-xs">{t(REASON[v.reason] ?? v.reason)}</span>
							</button>
						))
					)}
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{t("Cancel")}
					</Button>
					{/* «Open as a copy» is out of rc31 (integrator, 11.11): on rc31 test/ideal-reliable-versions.mjs saw it open an
					    empty «Untitled Project» and write the copy's name into the project itself. Back with `openCopy` once proven. */}
					{OPEN_AS_COPY && (
						<Button onClick={openCopy} disabled={busy || !chosen} data-open-version-copy>
							{t("Open as a copy")}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
