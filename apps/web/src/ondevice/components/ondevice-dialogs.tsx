"use client";

// Settings → AI → AI on this Mac: the free features that run on this Mac (download size, progress, cancel, remove).
// LibraryRow (the user's own library folder) is exported for Settings → Draft. Also the one question requireModel()
// can ask: the disk has no room for a model.
// The models have this one place: a feature's own progress carries the download, Settings shows the same one.
// The quiet background download (ondevice/background.ts) is one line here, never a banner anywhere.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
	type BackgroundStatus,
	formatBytes,
	type ModelId,
	type ModelStatus,
	ondeviceApi,
	openOndevice,
	requireModel,
	settlePrompt,
	useOndeviceStore,
} from "@/ondevice/client";
import { BackgroundReporter } from "./background-reporter";
import { useT } from "@/i18n";

function usePolling(active: boolean) {
	const refresh = useOndeviceStore((s) => s.refresh);
	const running = useOndeviceStore((s) => s.state?.models.some((m) => m.job?.status === "running") ?? false);
	useEffect(() => {
		if (!active) return;
		void refresh();
		const t = setInterval(() => void refresh(), running ? 600 : 3000);
		return () => clearInterval(t);
	}, [active, running, refresh]);
}

function ModelRow({ model }: { model: ModelStatus }) {
	const t = useT();
	const refresh = useOndeviceStore((s) => s.refresh);
	const [busy, setBusy] = useState(false);
	const [confirm, setConfirm] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const job = model.job;
	const running = job?.status === "running";
	/** The queue's own download: a quiet line, no bar, no red. */
	const quiet = !!model.background;
	const stage = job?.stages.find((s) => s.status === "running");
	const doneStages = job?.stages.filter((s) => s.status === "done" || s.status === "skipped").length ?? 0;
	const overall = job ? (doneStages + (stage?.progress ?? 0)) / Math.max(1, job.stages.length) : 0;

	const act = async (fn: () => Promise<unknown>) => {
		setBusy(true);
		setError(null);
		try {
			await fn();
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
			setConfirm(false);
			void refresh();
		}
	};

	return (
		<div className="flex min-w-0 flex-col gap-2 rounded-md border p-3" data-testid={`ondevice-${model.id}`}>
			<div className="flex items-start gap-3">
				<div className="min-w-0 flex-1">
					<div className="text-sm font-medium">{model.title}</div>
					<div className="text-muted-foreground text-xs">{model.purpose}</div>
				</div>
				<div className="shrink-0">
					{model.unsupported ? null : running ? (
						<Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => ondeviceApi.cancel(model.id))}>
							Cancel
						</Button>
					) : model.sharedWith ? null : model.installed ? (
						confirm ? (
							<div className="flex gap-1.5">
								<Button
									size="sm"
									variant="destructive"
									disabled={busy}
									onClick={() =>
										act(async () => {
											await ondeviceApi.remove(model.id);
											toast.success(`${model.title} removed · ${formatBytes(model.diskBytes)} freed`);
										})
									}
								>
									Remove · frees {formatBytes(model.diskBytes)}
								</Button>
								<Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
									Keep
								</Button>
							</div>
						) : (
							<div className="flex gap-1.5">
								{model.id !== "whisper" && (
									<Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => ondeviceApi.repair(model.id))} data-testid={`ondevice-repair-${model.id}`}>
										Repair
									</Button>
								)}
								<Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
									Remove…
								</Button>
							</div>
						)
					) : (
						<Button size="sm" disabled={busy} onClick={() => act(() => startDownload(model.id))} data-testid={`ondevice-download-${model.id}`}>
							{job?.status === "failed" || job?.status === "cancelled" ? "Retry" : model.bundled ? "Set up" : "Download"}
							{model.bundled ? "" : ` · ${formatBytes(model.downloadBytes)}`}
						</Button>
					)}
				</div>
			</div>
			{model.unsupported && <div className="text-muted-foreground text-xs">{model.unsupported}</div>}
			{!!model.minMemory && (
				<div className="text-muted-foreground text-xs" data-ondevice-memory-line={Math.round(model.minMemory / 1e9)}>
					{t("Needs {n} GB of memory", { n: Math.round(model.minMemory / 1e9) })}
				</div>
			)}
			{!model.unsupported && model.installed && !running && (
				<div className="text-xs text-emerald-600 dark:text-emerald-400">
					{model.sharedWith ? `Ready · works offline · uses the ${model.sharedWith} download` : `Ready · works offline · about ${formatBytes(model.diskBytes)} on disk`}
					{!model.verified && <span className="text-muted-foreground"> · from an earlier version: press Repair once to check it</span>}
				</div>
			)}
			{!model.unsupported && model.note && <div className="text-muted-foreground text-xs">{model.note}</div>}
			{running && quiet && (
				<div className="text-muted-foreground text-xs tabular-nums" data-ondevice-quiet>
					{t("Downloading in the background · {p} %", { p: Math.round(overall * 100) })}
				</div>
			)}
			{running && !quiet && (
				<div className="flex min-w-0 flex-col gap-1">
					<div className="text-muted-foreground flex min-w-0 justify-between gap-2 text-xs">
						<span className="min-w-0 truncate">{stage ? `${stage.title}${stage.detail ? ` · ${stage.detail}` : ""}` : "Starting"}</span>
						<span className="shrink-0 tabular-nums">{Math.round(overall * 100)}%</span>
					</div>
					<Progress value={overall * 100} className="h-1" />
				</div>
			)}
			{!running && job?.status === "failed" && !quiet && <div className="text-destructive text-xs">{job.error}</div>}
			{!running && job?.status === "failed" && quiet && !model.installed && (
				<div className="text-muted-foreground text-xs">Downloads in the background later, or when you first use it.</div>
			)}
			{!running && job?.status === "cancelled" && !model.installed && (
				<div className="text-muted-foreground text-xs">Paused. Press Retry to continue where it stopped.</div>
			)}
			{error && <div className="text-destructive text-xs">{error}</div>}
		</div>
	);
}

type DesktopApp = { pickFolder?: (title?: string) => Promise<string | null> };

/** «My library folder»: the user's own music, sounds, graphics and fonts. Settings → Draft places it (next to «Downloaded media»). */
export function LibraryRow() {
	const state = useOndeviceStore((s) => s.state);
	const refresh = useOndeviceStore((s) => s.refresh);
	const [error, setError] = useState<string | null>(null);
	const folder = state?.library.folder ?? "";
	const app = (globalThis as unknown as { studioApp?: DesktopApp }).studioApp;
	const save = async (next: string) => {
		setError(null);
		try {
			await ondeviceApi.setLibrary(next);
			void refresh();
		} catch (e) {
			setError((e as Error).message);
		}
	};
	const choose = async () => {
		const picked = app?.pickFolder
			? await app.pickFolder("Choose your music, sound effects and graphics folder")
			: globalThis.prompt?.("Full path of your library folder", folder);
		if (picked) await save(picked);
	};
	return (
		// a row of Settings → Draft like the rows beside it (name left, the folder and its buttons right), not a card in
		// a card (des2 D6)
		<div className="grid grid-cols-[13rem_1fr] items-start gap-4 py-2.5" data-testid="ondevice-library" data-setting-row="My library folder">
			<span className="text-muted-foreground pt-1.5 text-sm">My library folder</span>
			<div className="flex min-w-0 flex-col gap-1.5">
				<div className="flex min-w-0 items-center gap-1.5">
					<div className="min-w-0 flex-1 truncate text-sm" title={folder}>
						{folder || "Not set"}
					</div>
					{folder && (
						<Button size="sm" variant="ghost" onClick={() => save("")}>
							Stop using
						</Button>
					)}
					<Button size="sm" variant="outline" onClick={choose}>
						{folder ? "Change…" : "Choose…"}
					</Button>
				</div>
				<p className="text-muted-foreground text-xs leading-snug">
					Your own music, sound effects, Lottie graphics and fonts, used in place (never copied). The app itself ships only
					open-licensed content.
				</p>
				{error && <div className="text-destructive text-xs">{error}</div>}
			</div>
		</div>
	);
}

/**
 * Settings' Download: the same Job a feature starts (activity list, ↻, durable — craft B). A failure in its first second
 * shows in the row too; later ones on the Job.
 */
function startDownload(id: ModelStatus["id"]): Promise<unknown> {
	const run = requireModel(id);
	run.catch(() => {});
	return Promise.race([run, new Promise((r) => setTimeout(r, 1000))]);
}

/** «Download all»: every model not here yet, one after another (the same downloads the features use). */
let downloadingAll = false;
async function downloadAll() {
	if (downloadingAll) return;
	downloadingAll = true;
	try {
		for (;;) {
			const state = await useOndeviceStore.getState().refresh();
			const next = state?.models.find((m) => !m.installed && !m.unsupported && !m.sharedWith);
			if (!next) return;
			await requireModel(next.id);
		}
	} catch {
		// Cancelled, or one failed (its row says why): the rest wait for the next «Download all».
	} finally {
		downloadingAll = false;
	}
}

/** The background download's one line: «Speech recognition · downloading in the background · 43 %», then «ready». */
export function backgroundLine(bg: BackgroundStatus | undefined): string {
	if (!bg || bg.state === "off") return "";
	const what = bg.large ? "Models" : "Small models";
	const pct = bg.progress ? ` · ${Math.round(bg.progress * 100)} %` : "";
	if (bg.state === "downloading") return `${bg.title} · downloading in the background${pct}`;
	if (bg.state === "paused") return `${bg.title} · paused: ${bg.reason ?? "waiting"}${pct}`;
	if (bg.state === "done") return `${what} · ready`;
	if (bg.state === "scheduled") return `${what} download in the background in a couple of minutes`;
	return `${what} download in the background after you open your first project`;
}

function BackgroundRow({ bg }: { bg: BackgroundStatus | undefined }) {
	const refresh = useOndeviceStore((s) => s.refresh);
	const [saving, setSaving] = useState(false);
	if (!bg || bg.state === "off") return null;
	const line = backgroundLine(bg);
	const toggle = async (on: boolean) => {
		setSaving(true);
		try {
			await ondeviceApi.background({ large: on });
		} catch {}
		setSaving(false);
		void refresh();
	};
	return (
		<div className="flex flex-col gap-2 pb-1" data-ondevice-background={bg.state}>
			<div className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs tabular-nums" data-ondevice-background-line>
				<span className={`size-1.5 shrink-0 rounded-full ${bg.state === "done" ? "bg-emerald-500" : bg.state === "downloading" ? "bg-sky-500" : "bg-muted-foreground/50"}`} />
				<span className="min-w-0 truncate" title={line}>
					{line}
				</span>
			</div>
			<div className="flex items-start gap-2">
				<Checkbox id="ondevice-large-bg" data-ondevice-large checked={bg.large} disabled={saving} onCheckedChange={(v) => void toggle(v === true)} />
				<Label htmlFor="ondevice-large-bg" className="flex flex-col items-start gap-0.5 text-sm leading-snug font-normal">
					Download large models in the background
					{/* the size only (the owner, 12.11: no sentences under a switch) */}
					{bg.largeBytes ? <span className="text-muted-foreground text-xs tabular-nums">{formatBytes(bg.largeBytes)}</span> : null}
				</Label>
			</div>
		</div>
	);
}

export function OndeviceSection() {
	const t = useT();
	usePolling(true);
	const state = useOndeviceStore((s) => s.state);
	const error = useOndeviceStore((s) => s.error);
	const used = state?.models.filter((m) => m.installed && !m.sharedWith).reduce((a, m) => a + m.diskBytes, 0) ?? 0;
	const missing = state?.models.filter((m) => !m.installed && !m.unsupported && !m.sharedWith) ?? [];
	return (
		<div className="flex flex-col gap-2" data-ondevice-section>
			<BackgroundRow bg={state?.background} />
			{state?.models.filter((m) => !m.unsupported).map((m) => <ModelRow key={m.id} model={m} />)}
			{/* The models this Mac can't run (under 16 GB: the heavy ones): listed apart, with the reason, no Download. */}
			{state?.models.some((m) => m.unsupported) && (
				<div className="flex flex-col gap-2 pt-1" data-ondevice-group="unsupported">
					<div className="text-muted-foreground text-xs font-medium">{t("Not for this Mac")}</div>
					{state.models.filter((m) => m.unsupported).map((m) => <ModelRow key={m.id} model={m} />)}
				</div>
			)}
			{!state && !error && <div className="text-muted-foreground text-xs">Checking…</div>}
			{error && <div className="text-destructive text-xs">{error}</div>}
			{state && (
				<div className="flex items-center gap-3 border-t pt-2" data-ondevice-footer>
					<span className="text-muted-foreground min-w-0 flex-1 text-xs" data-ondevice-disk>
						{t("Models use {size}", { size: formatBytes(used) })}
						{state.disk?.free ? ` · ${formatBytes(state.disk.free)} free on this disk` : ""}
					</span>
					{missing.length > 0 && (
						<Button size="sm" variant="secondary" onClick={() => void downloadAll()} data-ondevice-download-all>
							{t("Download all · {size}", { size: formatBytes(missing.reduce((a, m) => a + m.downloadBytes, 0)) })}
						</Button>
					)}
				</div>
			)}
		</div>
	);
}

/** The one question a feature can ask about its model: the disk hasn't room for it. */
function NoSpacePrompt({ id }: { id: ModelId }) {
	const state = useOndeviceStore((s) => s.state);
	const model = state?.models.find((m) => m.id === id);
	const close = useCallback(() => settlePrompt(id, false), [id]);
	return (
		<Dialog open onOpenChange={(open) => !open && close()}>
			<DialogContent className="max-w-md gap-3 p-5" data-ondevice-no-space>
				<DialogTitle>Not enough space</DialogTitle>
				<DialogDescription>
					{model ? `${model.title} needs ${formatBytes(model.installBytes)} to download and set up (${formatBytes(model.diskBytes)} once it is in); the disk has ${formatBytes(state?.disk?.free ?? 0)} free. Free up some space (or remove a model you don't use), then try again.` : "Checking…"}
				</DialogDescription>
				<div className="flex justify-end gap-2">
					<Button
						size="sm"
						variant="secondary"
						onClick={() => {
							close();
							openOndevice();
						}}
					>
						Show models
					</Button>
					<Button size="sm" onClick={close}>
						OK
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Mounted once in the editor: the no-space question, when a feature's model has no room on the disk, and the report
 * that lets the background download give way to the user's work (nothing of it shows).
 */
export function OndeviceDialogs() {
	const prompt = useOndeviceStore((s) => s.prompt);
	return (
		<>
			<BackgroundReporter />
			{prompt ? <NoSpacePrompt id={prompt} /> : null}
		</>
	);
}
