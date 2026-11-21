"use client";

// Music and sounds from the free web (Openverse: Jamendo, ccMixter, Freesound, Wikimedia) under the library's rows in
// the Music and Sounds lists, by the source switch (principle 1). Each row says its site; ▶ listens, a double-click or +
// downloads it into Media (with its credit) and puts it at the playhead.
import { Add01Icon, PauseIcon, PlayIcon } from "@hugeicons/core-free-icons";
import { useEffect, useRef, useState } from "react";
import { tileActivation } from "@/components/editor/panels/assets/tile-activation";
import { HugeiconsIcon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import { useEditor } from "@/editor/use-editor";
import { useT } from "@/i18n";
import { jobCenter } from "@/jobs/store";
import { processMediaAssets } from "@/media/processing";
import { registerAudioPreview } from "@/preview/audio-focus";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { generateUUID } from "@/utils/id";
import { cn } from "@/utils/ui";
import { mediaTimeFromSeconds } from "@/wasm";

interface WebAudioItem {
	id: string;
	source: string;
	title: string;
	author: string;
	license: string;
	sourceUrl: string;
	url: string;
	seconds: number;
}

const SITE: Record<string, string> = { jamendo: "Jamendo", ccmixter: "ccMixter", freesound: "Freesound", wikimedia_audio: "Wikimedia" };
const fileUrl = (url: string) => `/api/images/audio-file?u=${encodeURIComponent(url)}`;
const fmt = (s: number) => (s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);

let playing: HTMLAudioElement | null = null;
let playingId: string | null = null;
const listeners = new Set<() => void>();
const stop = () => {
	playing?.pause();
	playing = null;
	playingId = null;
	for (const fn of listeners) fn();
};
registerAudioPreview(stop);

export function WebAudioRows({ kind, query, pick, grow }: { kind: "music" | "sound"; query: string; pick: string; grow: boolean }) {
	const t = useT();
	const editor = useEditor();
	const q = query.trim();
	const [items, setItems] = useState<WebAudioItem[] | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [, tick] = useState(0);
	const req = useRef(0);

	useEffect(() => {
		const fn = () => tick((n) => n + 1);
		listeners.add(fn);
		return () => {
			listeners.delete(fn);
			stop();
		};
	}, []);

	useEffect(() => {
		if (q.length < 2 || pick === "library") {
			setItems(null);
			setError(null);
			return;
		}
		const id = ++req.current;
		setLoading(true);
		const timer = window.setTimeout(async () => {
			try {
				const res = await fetch(`/api/images/audio?q=${encodeURIComponent(q)}&kind=${kind}&source=${pick}`);
				const data = (await res.json()) as { items?: WebAudioItem[]; error?: string };
				if (id !== req.current) return;
				setItems(data.items ?? []);
				setError(res.ok ? null : (data.error ?? null));
			} catch {
				if (id === req.current) setError(t("The free music search can't be reached: check the internet connection."));
			} finally {
				if (id === req.current) setLoading(false);
			}
		}, 600);
		return () => window.clearTimeout(timer);
	}, [q, kind, pick, t]);

	const toggle = (item: WebAudioItem) => {
		if (playingId === item.id) return stop();
		stop();
		try {
			const playback = editor.playback;
			if (playback.getIsPlaying()) playback.pause();
		} catch {}
		const a = new Audio(fileUrl(item.url));
		a.onended = () => playing === a && stop();
		void a.play().catch(() => playing === a && stop());
		playing = a;
		playingId = item.id;
		for (const fn of listeners) fn();
	};

	const add = async (item: WebAudioItem, assetId = generateUUID()) => {
		const project = editor.project.getActiveOrNull();
		if (!project) return;
		const projectId = project.metadata.id;
		const at = editor.playback.getCurrentTime();
		const site = SITE[item.source] ?? item.source;
		const jobId = jobCenter.start({ id: `web-audio:${assetId}`, kind: "other", title: item.title, tab: "media", progress: 0 });
		try {
			const res = await fetch(fileUrl(item.url));
			if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "The sound didn't download.");
			const blob = await res.blob();
			const ext = blob.type.includes("ogg") ? "ogg" : blob.type.includes("wav") ? "wav" : blob.type.includes("flac") ? "flac" : "mp3";
			const name = `${item.title.slice(0, 60).replace(/[/\\:]/g, " ")}.${ext}`;
			const [processed] = await processMediaAssets({ files: [new File([blob], name, { type: blob.type || "audio/mpeg" })] });
			if (!processed) throw new Error("The editor couldn't read this sound.");
			const asset = await editor.media.addMediaAsset({ projectId, asset: { ...processed, id: assetId, origin: "source", attribution: { title: item.title, author: item.author, license: item.license, sourceUrl: item.sourceUrl } } });
			if (!asset) throw new Error("Not enough editor storage space — free some disk space and retry.");
			if (editor.project.getActiveOrNull()?.metadata.id === projectId) {
				editor.timeline.insertElement({
					element: buildElementFromMedia({ mediaId: asset.id, mediaType: asset.type, name: asset.name, duration: mediaTimeFromSeconds({ seconds: asset.duration ?? item.seconds ?? 3 }), startTime: at }),
					placement: { mode: "auto" },
				});
			}
			jobCenter.finish(jobId, `${item.title} — ${item.author} · ${item.license} · ${site}`);
		} catch (e) {
			jobCenter.fail(jobId, e instanceof Error && e.message ? e.message : "The sound didn't download.");
			jobCenter.update(jobId, { retry: () => { jobCenter.remove(jobId); void add(item, assetId); } });
		}
	};

	if (q.length < 2 || pick === "library") return null;
	return (
		<div className={cn("flex min-h-0 flex-col gap-1", grow ? "flex-1" : "max-h-[45%] shrink-0")} data-web-audio={kind}>
			<h4 className="text-muted-foreground text-[11px] font-medium">{kind === "music" ? t("Music from the web") : t("Sounds from the web")}</h4>
			{error && <p className="text-destructive text-xs">{error}</p>}
			{loading && !items?.length && (
				<div className="text-muted-foreground flex items-center gap-2 text-xs">
					<Spinner className="size-3.5" /> {t("Searching…")}
				</div>
			)}
			{!loading && !error && items?.length === 0 && <p className="text-muted-foreground text-xs">{t("Nothing found")}</p>}
			<div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto">
				{items?.map((item) => (
					<div
						key={item.id}
						className="hover:bg-accent/60 group flex h-[39px] items-center gap-2 rounded-md px-1.5"
						title={`${item.title} — ${item.author} · ${item.license}\n${t("Double-click to add at the playhead")}`}
						data-web-audio-row={item.id}
						data-no-translate
						{...tileActivation(() => add(item))}
					>
						<button
							type="button"
							aria-label={playingId === item.id ? "Pause" : "Play"}
							className="bg-accent grid size-6 shrink-0 place-items-center rounded-full"
							onClick={(e) => {
								e.stopPropagation();
								toggle(item);
							}}
						>
							<HugeiconsIcon icon={playingId === item.id ? PauseIcon : PlayIcon} className="size-3" />
						</button>
						<div className="min-w-0 flex-1">
							<div className="truncate text-xs">{item.title}</div>
							<div className="text-muted-foreground truncate text-[10px]">
								{item.author} · <span data-source-mark={SITE[item.source] ?? item.source}>{SITE[item.source] ?? item.source}</span>
							</div>
						</div>
						{item.seconds > 0 && <span className="text-muted-foreground text-[10px] tabular-nums">{fmt(item.seconds)}</span>}
						<button
							type="button"
							aria-label="Add"
							className="text-muted-foreground hover:text-foreground grid size-6 shrink-0 place-items-center rounded-md opacity-0 group-hover:opacity-100"
							onClick={(e) => {
								e.stopPropagation();
								void add(item);
							}}
						>
							<HugeiconsIcon icon={Add01Icon} className="size-3.5" />
						</button>
					</div>
				))}
			</div>
		</div>
	);
}
