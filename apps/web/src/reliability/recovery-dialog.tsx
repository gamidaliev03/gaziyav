"use client";

import { useState } from "react";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/editor/use-editor";

function formatTime(timestamp: number): string {
	const date = new Date(timestamp);
	const sameDay = date.toDateString() === new Date().toDateString();
	return date.toLocaleString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		...(sameDay ? {} : { day: "numeric", month: "long" }),
	});
}

/** "Restore unsaved changes?" — one click brings back edits lost to a crash. */
export function RecoveryDialog() {
	const editor = useEditor();
	const savedAt = useEditor(
		(e) => e.project.getRecoveryCandidate()?.savedAt ?? null,
	);
	const reason = useEditor(
		(e) => e.project.getRecoveryCandidate()?.reason ?? null,
	);
	const [isRestoring, setIsRestoring] = useState(false);

	if (savedAt === null) return null;

	const restore = async () => {
		setIsRestoring(true);
		try {
			await editor.project.applyRecovery();
		} finally {
			setIsRestoring(false);
		}
	};

	return (
		<AlertDialog
			open
			onOpenChange={(open) => {
				if (!open && !isRestoring) editor.project.dismissRecovery();
			}}
		>
			<AlertDialogContent data-recovery-dialog>
				<AlertDialogHeader>
					<AlertDialogTitle>Restore unsaved changes?</AlertDialogTitle>
					<AlertDialogDescription>
						{reason === "save-failed"
							? `Your latest edits couldn't be written to disk. A recovery copy from ${formatTime(savedAt)} is available.`
							: `The app closed before your latest edits were saved. A recovery copy from ${formatTime(savedAt)} is available.`}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isRestoring}>Don&apos;t restore</AlertDialogCancel>
					<Button autoFocus disabled={isRestoring} onClick={restore}>
						{isRestoring ? "Restoring…" : "Restore"}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
