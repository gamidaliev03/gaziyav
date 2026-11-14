"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
	projectBackups,
	type ProjectBackup,
} from "@/services/storage/recovery";
import { storageService } from "@/services/storage/service";

function formatBackupTime(timestamp: number): string {
	return new Date(timestamp).toLocaleString("en-US", {
		day: "numeric",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
	});
}

/**
 * Shown instead of a blank screen when a project can't be opened. Offers the
 * newest automatic backup (taken on open and every 5 minutes of editing).
 */
export function ProjectLoadError({
	projectId,
	details,
	onRetry,
}: {
	projectId: string;
	details: string;
	onRetry: () => void;
}) {
	const router = useRouter();
	const [backup, setBackup] = useState<ProjectBackup | null>(null);
	const [status, setStatus] = useState<"idle" | "restoring" | "failed">("idle");

	useEffect(() => {
		let cancelled = false;
		projectBackups
			.latest({ projectId })
			.then((latest) => {
				if (!cancelled) setBackup(latest);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [projectId]);

	const restoreBackup = async () => {
		if (!backup) return;
		setStatus("restoring");
		try {
			await storageService.saveSerializedProject({ serialized: backup.project });
			onRetry();
		} catch {
			setStatus("failed");
		}
	};

	return (
		<div className="bg-background flex h-screen w-screen items-center justify-center p-6">
			<div
				role="alert"
				data-project-load-error
				className="flex max-w-md flex-col items-center gap-4 text-center"
			>
				<p className="text-base font-medium">This project couldn&apos;t be opened</p>
				<p className="text-muted-foreground text-sm">
					{backup
						? `An automatic backup from ${formatBackupTime(backup.createdAt)} is available.`
						: "Try again, or go back to your projects."}
				</p>
				{status === "failed" && (
					<p className="text-destructive text-sm">
						Couldn&apos;t restore the backup. Free up disk space and try again.
					</p>
				)}
				<div className="flex flex-wrap justify-center gap-2">
					{backup && (
						<Button disabled={status === "restoring"} onClick={restoreBackup}>
							{status === "restoring" ? "Restoring…" : "Restore backup"}
						</Button>
					)}
					<Button variant="outline" onClick={onRetry}>
						Try again
					</Button>
					<Button variant="ghost" onClick={() => router.push("/projects")}>
						All projects
					</Button>
				</div>
				<details className="text-muted-foreground max-w-full text-left text-xs">
					<summary className="cursor-pointer">Details</summary>
					<p className="mt-1 break-words select-text">{details}</p>
				</details>
			</div>
		</div>
	);
}
