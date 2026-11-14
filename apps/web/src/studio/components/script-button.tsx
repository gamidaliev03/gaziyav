"use client";

import { useRef, useState } from "react";
import { HugeiconsIcon } from "@/components/ui/icon";
import { AiMagicIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { aiScript, type ScriptAction } from "@/studio/client/actions";
import { resolveKey, useStudioStore } from "@/studio/client/studio-store";
import { openFalSettings } from "@/fal/client";
import { useT } from "@/i18n";
import { DEMO } from "@/demo/flag";

/** DeepSeek writes only the words to speak, sized to the video. */
export function ScriptButton({ projectId, seconds, context }: { projectId: string; seconds: number; context: string }) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const [idea, setIdea] = useState("");
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const last = useRef<{ action: ScriptAction; label: string } | null>(null);
	const abort = useRef<AbortController | null>(null);
	const hasKey = useStudioStore((s) => s.server?.settings.agent);
	const current = useStudioStore((s) => s.drafts[resolveKey(s, projectId)]?.text ?? "");

	const run = async (action: ScriptAction, label: string) => {
		if (abort.current) return; // one request at a time
		const ctl = new AbortController();
		abort.current = ctl;
		last.current = { action, label };
		setBusy(label);
		setError(null);
		let timedOut = false;
		const t = setTimeout(() => {
			timedOut = true;
			ctl.abort();
		}, 120_000);
		try {
			await aiScript(projectId, action, { seconds, context, signal: ctl.signal });
			if (!ctl.signal.aborted) setOpen(false);
		} catch (e) {
			const err = e as Error;
			setError(err.name === "AbortError" ? (timedOut ? "Gaziyav AI didn't answer in 2 minutes. Try again." : "Cancelled") : err.message);
		} finally {
			clearTimeout(t);
			if (abort.current === ctl) abort.current = null;
			setBusy(null);
		}
	};

	// the browser edition has no Gaziyav AI (the desktop's assistant): its lipsync view in the AI tab hides this row too
	if (DEMO) return null;
	return (
		<Popover
			open={open}
			onOpenChange={(o) => {
				// Closing the popover cancels the request: the text never changes behind the user's back.
				if (!o) abort.current?.abort();
				setOpen(o);
			}}
		>
			<PopoverTrigger asChild>
				<Button variant="outline" size="sm" className="gap-1.5">
					<HugeiconsIcon icon={AiMagicIcon} className="size-3.5" />
					Write with Gaziyav AI
				</Button>
			</PopoverTrigger>
			<PopoverContent className="flex w-80 flex-col gap-2.5" align="end">
				{!hasKey ? (
					// (check-ai D4, 06.11: it sent to «Settings → Gaziyav AI», a tab that doesn't exist)
					<div className="flex flex-col gap-2" data-script-no-key>
						<p className="text-sm">{t("Gaziyav AI writes on your fal.ai key: add it in Settings → AI.")}</p>
						<Button size="sm" variant="outline" className="self-start" onClick={openFalSettings}>
							{t("Open Settings → AI")}
						</Button>
					</div>
				) : (
					<>
						<Textarea
							rows={3}
							placeholder={t("What the video is about: the idea, the facts, who it is for. E.g. “three ways to light a talking head at home”")}
							value={idea}
							onChange={(e) => setIdea(e.target.value)}
							autoFocus
						/>
						<p className="text-muted-foreground text-xs">{t("Only the words to speak, ≈ {s} s — sized to the video.", { s: Math.round(seconds) })}</p>
						<div className="flex flex-wrap gap-1.5">
							<Button size="sm" disabled={!!busy || !idea.trim()} onClick={() => run({ kind: "write", idea: idea.trim() }, "write")}>
								{busy === "write" && <Spinner className="size-3" />}Write
							</Button>
							<Button size="sm" variant="outline" disabled={!!busy || !current.trim()} onClick={() => run({ kind: "improve" }, "improve")}>
								{busy === "improve" && <Spinner className="size-3" />}Improve mine
							</Button>
							<Button size="sm" variant="outline" disabled={!!busy || !current.trim()} onClick={() => run({ kind: "fit" }, "fit")}>
								{busy === "fit" && <Spinner className="size-3" />}Fit to video
							</Button>
						</div>
						{busy && (
							<Button size="sm" variant="ghost" onClick={() => abort.current?.abort()}>
								Cancel
							</Button>
						)}
						{error && (
							<div className="flex flex-col gap-1.5">
								<p className="text-destructive text-xs whitespace-pre-wrap">{error.split("\n\nDetails:")[0]}</p>
								{error.includes("\n\nDetails:") && (
									<details className="text-muted-foreground text-xs">
										<summary className="cursor-pointer">Details</summary>
										<span className="break-all">{error.split("\n\nDetails:")[1]?.trim()}</span>
									</details>
								)}
								<div className="flex gap-1.5">
									{error !== "Cancelled" && last.current && (
										<Button size="sm" variant="outline" disabled={!!busy} onClick={() => last.current && run(last.current.action, last.current.label)}>
											Retry
										</Button>
									)}
								</div>
							</div>
						)}
					</>
				)}
			</PopoverContent>
		</Popover>
	);
}
