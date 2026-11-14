"use client";

import { useEffect } from "react";
import { EditorCore } from "@/core";

/**
 * Last line of defence behind the per-panel boundaries: a whole route failed
 * to render. Unsaved edits are copied to the recovery journal first, so a
 * reload offers "Restore unsaved changes?". Plain elements only — this must
 * render even when the UI kit is what broke.
 */
export function CrashScreen({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error("[app] route crashed", error);
		const editor = EditorCore.peekInstance();
		if (!editor) return;
		try {
			editor.save.writeEmergencyJournal();
		} catch {}
		void editor.save.flush().catch(() => {});
	}, [error]);

	const button =
		"inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium";

	return (
		<div
			role="alert"
			data-crash-screen
			className="bg-background text-foreground flex h-screen w-screen items-center justify-center p-6"
		>
			<div className="flex max-w-md flex-col items-center gap-4 text-center">
				<p className="text-base font-medium">Something went wrong on this screen</p>
				<p className="text-muted-foreground text-sm">
					Your edits are safe. Reload the screen to keep working.
				</p>
				<div className="flex gap-2">
					<button
						type="button"
						className={`${button} bg-foreground text-background`}
						onClick={() => reset()}
					>
						Reload screen
					</button>
					<button
						type="button"
						className={`${button} border`}
						onClick={() => window.location.reload()}
					>
						Restart editor
					</button>
				</div>
				<details className="text-muted-foreground max-w-full text-left text-xs">
					<summary className="cursor-pointer">Details</summary>
					<p className="mt-1 break-words select-text">{error.message}</p>
				</details>
			</div>
		</div>
	);
}
