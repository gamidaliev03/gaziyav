"use client";

// Home → a project's menu → «Restore previous version»: the project's saved versions (opened, ⌘S, every 2 minutes of
// editing — the last 10), newest first; Restore makes the chosen one the project again, and what it was a moment ago
// becomes a version of its own (nothing is lost by restoring).
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EditorCore } from "@/core";
import type { ProjectBackup } from "@/services/storage/recovery";
import { cn } from "@/utils/ui";

const REASON: Record<ProjectBackup["reason"], string> = {
	open: "Opened",
	periodic: "While editing",
	save: "Saved (⌘S)",
	"before-restore": "Before a restore",
	"before-join": "Before joining timelines",
};

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function RestoreVersionDialog({ isOpen, onOpenChange, projectId, projectName }: { isOpen: boolean; onOpenChange: (open: boolean) => void; projectId: string; projectName: string }) {
	const [versions, setVersions] = useState<ProjectBackup[] | null>(null);
	const [chosen, setChosen] = useState<number | null>(null);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		if (!isOpen) return;
		setVersions(null);
		setChosen(null);
		void EditorCore.getInstance()
			.project.listVersions({ id: projectId })
			.then((list) => {
				setVersions(list);
				setChosen(list[0]?.createdAt ?? null);
			});
	}, [isOpen, projectId]);
	const restore = async () => {
		if (chosen === null) return;
		setBusy(true);
		const ok = await EditorCore.getInstance().project.restoreVersion({ id: projectId, createdAt: chosen }).catch(() => false);
		setBusy(false);
		if (ok) {
			toast.success(`«${projectName}» is back to ${when(chosen)}`);
			onOpenChange(false);
		} else toast.error("Couldn't restore this version");
	};
	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Restore previous version</DialogTitle>
				</DialogHeader>
				<DialogBody className="gap-1" data-restore-versions>
					{versions === null ? (
						<p className="text-muted-foreground text-sm">Loading…</p>
					) : versions.length === 0 ? (
						<p className="text-muted-foreground text-sm">No saved versions of this project yet.</p>
					) : (
						versions.map((version) => (
							<button
								key={version.createdAt}
								type="button"
								data-version={version.createdAt}
								aria-pressed={chosen === version.createdAt}
								onClick={() => setChosen(version.createdAt)}
								className={cn("flex items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors", chosen === version.createdAt ? "bg-primary/10 text-primary" : "hover:bg-foreground/[0.05]")}
							>
								<span className="tabular-nums">{when(version.createdAt)}</span>
								<span className="text-muted-foreground text-xs">{REASON[version.reason] ?? version.reason}</span>
							</button>
						))
					)}
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={restore} disabled={busy || chosen === null} data-restore-version>
						Restore
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
