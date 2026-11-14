"use client";

// A Media item that is still on its way (a YouTube piece, a web picture, a big file being read, an AI result): it is in
// Media the moment the job starts, where it will land, grey; colour comes in with the job's progress and at 100 % the
// real item takes its place (same spot, a small settle). Waiting with nothing measured: the still breathes. Failed: it
// stops, dims, a retry glyph. No words: the owner, 13.11 — state is shown by behaviour.
import { HugeiconsIcon } from "@/components/ui/icon";
import { Cancel01Icon, Image02Icon, MusicNote01Icon, RefreshIcon, Video01Icon } from "@hugeicons/core-free-icons";
import { useMemo } from "react";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { useT } from "@/i18n";
import { cn } from "@/utils/ui";
import { type Job, type PendingMedia, type SpriteFrame, jobCenter, useJobsStore } from "../store";

/** The class a just-landed Media item mounts with (tailwindcss-animate): it settles in from its placeholder. */
export const SETTLE_CLASS = "gz-landed animate-in fade-in-50 zoom-in-95 duration-200 ease-out";

const isPending = (projectId?: string) => (j: Job) =>
	!!j.place?.media && (j.status === "running" || j.status === "error") && (!j.place.media.projectId || !projectId || j.place.media.projectId === projectId);

/**
 * The Media items on their way into `projectId`, minus those that already landed (`assetIds`). Re-renders only when the
 * set or a status changes — each tile follows its own progress.
 */
export function usePendingMedia(projectId: string | undefined, assetIds: ReadonlySet<string>): Job[] {
	const key = useJobsStore((s) =>
		s.jobs
			.filter(isPending(projectId))
			.map((j) => `${j.id}:${j.status}`)
			.join(","),
	);
	return useMemo(() => {
		if (!key) return [];
		return useJobsStore
			.getState()
			.jobs.filter(isPending(projectId))
			.filter((j) => !assetIds.has(j.place?.media?.assetId ?? ""))
			.reverse();
	}, [key, projectId, assetIds]);
}

/** Assets that took a placeholder's place just now (they mount with SETTLE_CLASS). Read at render, not subscribed. */
export function landingAssetIds(now = Date.now()): Set<string> {
	const ids = new Set<string>();
	for (const j of useJobsStore.getState().jobs) {
		const id = j.place?.media?.assetId;
		if (id && (j.status === "running" || (j.status === "done" && now - (j.endedAt ?? 0) < 1200))) ids.add(id);
	}
	return ids;
}

interface Sortable {
	name: string;
	type: string;
	duration?: number;
	size: number;
}

const assetKey = (a: { name: string; type: string; duration?: number; file?: { size: number } }): Sortable => ({
	name: a.name,
	type: a.type,
	duration: a.duration,
	size: a.file?.size ?? 0,
});

function compare(a: Sortable, b: Sortable, by: string): number {
	switch (by) {
		case "name":
			return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0;
		case "type":
			return a.type < b.type ? -1 : a.type > b.type ? 1 : 0;
		case "duration":
			return (a.duration ?? 0) - (b.duration ?? 0);
		case "size":
			return a.size - b.size;
		default:
			return 0;
	}
}

export type MediaRow<T> = { asset: T } | { pending: Job };

/** The list as it will be once the pending items land: each one where the panel's sort puts it (else at the end). */
export function withPending<T extends { name: string; type: string; duration?: number; file?: { size: number } }>(
	items: T[],
	pending: Job[],
	sortBy: string,
	order: "asc" | "desc",
): MediaRow<T>[] {
	const rows: MediaRow<T>[] = items.map((asset) => ({ asset }));
	if (!pending.length) return rows;
	const sign = order === "asc" ? 1 : -1;
	for (const job of pending) {
		const m = job.place?.media as PendingMedia;
		const key: Sortable = { name: m.name, type: m.type, duration: m.duration, size: 0 };
		let at = rows.length;
		if (sortBy === "name" || sortBy === "type" || sortBy === "duration") {
			const k = rows.findIndex((r) => "asset" in r && sign * compare(key, assetKey(r.asset), sortBy) < 0);
			if (k >= 0) at = k;
		}
		rows.splice(at, 0, { pending: job });
	}
	return rows;
}

export function Still({ still, type }: { still?: PendingMedia["still"]; type: PendingMedia["type"] }) {
	if (typeof still === "string" && still) {
		// biome-ignore lint/performance/noImgElement: a remote or blob still, no optimisation server
		return <img src={still} alt="" draggable={false} className="absolute inset-0 size-full object-cover" />;
	}
	if (still && typeof still === "object") return <SpriteStill frame={still} />;
	const icon = type === "audio" ? MusicNote01Icon : type === "image" ? Image02Icon : Video01Icon;
	return (
		<div className="text-muted-foreground absolute inset-0 grid place-items-center bg-muted/40">
			<HugeiconsIcon icon={icon} className="size-5" />
		</div>
	);
}

/** One storyboard frame, covering the square tile without distortion (centred, as object-cover would). */
function SpriteStill({ frame }: { frame: SpriteFrame }) {
	const x = frame.cols > 1 ? (frame.col / (frame.cols - 1)) * 100 : 0;
	const y = frame.rows > 1 ? (frame.row / (frame.rows - 1)) * 100 : 0;
	const wide = frame.width >= frame.height;
	return (
		<div
			className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
			style={{
				aspectRatio: `${frame.width} / ${frame.height}`,
				...(wide ? { height: "100%" } : { width: "100%" }),
				backgroundImage: `url("${frame.sheet}")`,
				backgroundSize: `${frame.cols * 100}% ${frame.rows * 100}%`,
				backgroundPosition: `${x}% ${y}%`,
			}}
		/>
	);
}

/** The progress of one job, subscribed on its own (the tile re-renders, not the panel). */
function useJob(id: string): Job | undefined {
	return useJobsStore((s) => s.jobs.find((j) => j.id === id));
}

export function PendingMediaTile({ job: initial, variant = "grid" }: { job: Job; variant?: "grid" | "compact" }) {
	const t = useT();
	const job = useJob(initial.id) ?? initial;
	const media = job.place?.media as PendingMedia;
	const failed = job.status === "error";
	const known = job.progress != null && job.status === "running";
	const p = failed ? 0 : Math.max(0, Math.min(1, job.progress ?? 0));
	const percent = Math.min(99, Math.floor(p * 100));
	// × is instant to the eye (CRAFT.md §6): the item leaves now, the job is told to stop and cleans up after.
	const close = () => {
		if (!failed) job.cancel?.();
		jobCenter.remove(job.id);
	};
	const look = {
		filter: `grayscale(${1 - p})`,
		transition: "filter var(--gz-t3) var(--gz-ease), opacity var(--gz-t2) var(--gz-ease)",
	};
	const controls = (
		<>
			{failed && job.retry && (
				<button
					type="button"
					data-pending-retry
					aria-label={t("Retry")}
					title={job.message ? `${t("Retry")} — ${job.message}` : t("Retry")}
					className="absolute top-1/2 left-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/65 text-white transition-colors hover:bg-black/85"
					onClick={(e) => {
						e.stopPropagation();
						job.retry?.();
					}}
				>
					<HugeiconsIcon icon={RefreshIcon} className="size-3.5" />
				</button>
			)}
			{(failed || job.cancel) && (
				<button
					type="button"
					data-pending-close
					aria-label={failed ? t("Remove") : t("Cancel")}
					title={failed ? t("Remove") : t("Cancel")}
					className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-black/65 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/85 focus-visible:opacity-100"
					onClick={(e) => {
						e.stopPropagation();
						close();
					}}
				>
					<HugeiconsIcon icon={Cancel01Icon} className="size-3" />
				</button>
			)}
		</>
	);
	const stillBox = (
		<div
			className={cn("absolute inset-0", !known && !failed && "animate-[gz-breathe_1.6s_ease-in-out_infinite]", failed && "opacity-40")}
			style={look}
		>
			<Still still={media.still} type={media.type} />
		</div>
	);
	const attrs = {
		"data-pending-media": media.assetId,
		"data-pending-status": job.status,
		"data-pending-progress": known ? String(Math.round(p * 1000) / 1000) : "",
		title: failed && job.message ? job.message : media.name,
	};
	if (variant === "compact") {
		return (
			<div {...attrs} className="group relative flex h-8 w-full items-center gap-3 px-1">
				<div className="relative size-6 shrink-0 overflow-hidden rounded-sm bg-accent">{stillBox}</div>
				<span className={cn("w-full flex-1 truncate text-left text-sm", failed && "text-muted-foreground")}>{media.name}</span>
				{known && <span className="text-muted-foreground text-[11px] tabular-nums">{percent}%</span>}
				<div className="relative size-5 shrink-0">{controls}</div>
			</div>
		);
	}
	return (
		<div {...attrs} className="group relative w-full">
			<div className="relative flex h-auto w-full cursor-default flex-col gap-1">
				<AspectRatio ratio={1} className="bg-accent relative overflow-hidden">
					{stillBox}
					{known && (
						<div className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-xs text-white tabular-nums" data-pending-percent>
							{percent}%
						</div>
					)}
					{/* A thin edge fills only while it is measured (CRAFT.md §2). */}
					{known && (
						<div
							data-pending-edge
							className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary"
							style={{ transform: `scaleX(${p})`, transition: "transform var(--gz-t3) var(--gz-ease)" }}
						/>
					)}
					{controls}
				</AspectRatio>
				<span className="text-muted-foreground line-clamp-2 w-full text-left text-[11px] leading-tight break-words">
					{media.name.length > 40 ? `${media.name.slice(0, 30)}…${media.name.slice(-7)}` : media.name}
				</span>
			</div>
		</div>
	);
}
