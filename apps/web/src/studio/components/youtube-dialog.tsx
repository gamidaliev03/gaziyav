"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { HugeiconsIcon } from "@/components/ui/icon";
import { PauseIcon, PlayIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useEditor } from "@/editor/use-editor";
import { downloadFragment, refreshServer, resumePendingJobs } from "@/studio/client/actions";
import { studioApi, type YouTubeInfo } from "@/studio/client/api";
import type { Storyboard, YouTubeHit } from "@/studio/server/youtube";
import { looksLikeYouTubeVideo, useStudioStore } from "@/studio/client/studio-store";
import type { SpriteFrame } from "@/jobs/store";
import { useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import { startDurableJobs } from "@/jobs/durable";
import { startPointJobSource } from "@/jobs/point-source";
import { formatDuration, formatSeconds } from "@/studio/shared/models";
import { useT } from "@/i18n";

/** Browser names for the YouTube sign-in buttons (ids as yt-dlp knows them). */
const BROWSER_NAMES: Record<string, string> = {
	chrome: "Chrome",
	safari: "Safari",
	firefox: "Firefox",
	edge: "Edge",
	brave: "Brave",
	opera: "Opera",
	vivaldi: "Vivaldi",
	chromium: "Chromium",
	whale: "Whale",
};

/** YouTube's "confirm you're not a bot" (it pauses a network that sent many requests). */
const isBotCheck = (text: string | null) => !!text && /not a bot|YouTube paused/i.test(text);

const fmt = (s: number) => {
	const t = Math.max(0, s);
	return `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
};

/** "75", "1:15", "1:15.5", "1:02:03" → seconds; null for anything else (no 99:99, no 1:2:3 garbage). */
function parseTime(text: string): number | null {
	const t = text.trim().replace(",", ".");
	if (!/^\d+(\.\d+)?$|^\d+:[0-5]?\d(\.\d+)?$|^\d+:[0-5]\d:[0-5]\d(\.\d+)?$/.test(t)) return null;
	return t.split(":").map(Number).reduce((acc, p) => acc * 60 + p, 0);
}

/** Preview streams to play: through the app's proxy (real-time, seekable), else straight from the site. */
interface PreviewStream {
	video?: string;
	/** Separate sound stream (sites that only offer picture and sound apart). */
	audio?: string;
}

async function previewStream(info: YouTubeInfo, signal: AbortSignal): Promise<PreviewStream | null> {
	const direct: PreviewStream = info.preview
		? { video: info.preview }
		: { video: info.previewVideo, audio: info.previewAudio };
	const urls = [direct.video, direct.audio].filter((u): u is string => !!u);
	if (!urls.length) return null;
	try {
		const res = await fetch("/api/link-preview", {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Studio": "1" },
			body: JSON.stringify({ urls }),
			signal,
		});
		const ids: Array<string | null> = res.ok ? ((await res.json()).ids ?? []) : [];
		const via = (url: string | undefined) => {
			if (!url) return undefined;
			const id = ids[urls.indexOf(url)];
			return id ? `/api/link-preview?id=${encodeURIComponent(id)}` : url;
		};
		return { video: via(direct.video), audio: via(direct.audio) };
	} catch (e) {
		if ((e as Error).name === "AbortError") throw e;
		return direct;
	}
}

/** A YouTube link → watch it here → pick the piece → only that piece is downloaded into the project. */
export function YouTubeDialog() {
	const t = useT();
	const open = useStudioStore((s) => s.youtubeOpen);
	const prefill = useStudioStore((s) => s.youtubePrefill);
	const setOpen = useStudioStore((s) => s.setYoutubeOpen);
	const editor = useEditor();
	const projectId = useEditor((e) => e.project.getActiveOrNull()?.metadata.id ?? "");
	const [url, setUrl] = useState("");
	// A plain query (not a link) searches YouTube right here: pick a result instead of going to the browser.
	const [hits, setHits] = useState<YouTubeHit[]>([]);
	const [searching, setSearching] = useState(false);
	const searchAbort = useRef<AbortController | null>(null);
	const isLink = (text: string) => /^(https?:\/\/|www\.)|^[\w-]+\.[a-z]{2,}\//i.test(text.trim());
	const search = async (query = url.trim()) => {
		if (!query || isLink(query)) return;
		searchAbort.current?.abort();
		searchAbort.current = new AbortController();
		setSearching(true);
		setError(null);
		try {
			setHits(await studioApi.youtubeSearch(query, searchAbort.current.signal));
		} catch (e) {
			if ((e as Error).name !== "AbortError") setError((e as Error).message);
		} finally {
			setSearching(false);
		}
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: searches only when the typed text changes (the debounce restarts on each keystroke)
	useEffect(() => {
		const q = url.trim();
		if (q.length < 3 || isLink(q) || info) {
			if (!q) setHits([]);
			return;
		}
		const timer = window.setTimeout(() => void search(q), 500);
		return () => window.clearTimeout(timer);
	}, [url]);
	const [info, setInfo] = useState<YouTubeInfo | null>(null);
	const [stream, setStream] = useState<PreviewStream | null>(null);
	const [previewFailed, setPreviewFailed] = useState(false);
	const [buffering, setBuffering] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const server = useStudioStore((s) => s.server);
	const signInBrowser = server?.settings.youtubeBrowser ?? "";
	const browsers = server?.tools.browsers ?? [];
	/** The YouTube sign-in from this browser from now on (or none), then the link again. */
	const signInWith = async (browser: string) => {
		await studioApi.saveSettings({ youtubeBrowser: browser }).catch(() => null);
		await refreshServer();
		if (browser) void load();
	};
	// The browsers to offer come with the app's state: fetched when YouTube asks (the dialog may open first).
	useEffect(() => {
		if (isBotCheck(error) && !server) void refreshServer();
	}, [error, server]);
	const [range, setRange] = useState<[number, number]>([0, 0]);
	const [time, setTime] = useState(0);
	const video = useRef<HTMLVideoElement>(null);
	const audio = useRef<HTMLAudioElement>(null);
	const abort = useRef<AbortController | null>(null);
	/** Takes keyboard focus once the video is loaded, so I / O / Space mark and play instead of typing. */
	const stage = useRef<HTMLDivElement>(null);
	const [playing, setPlaying] = useState(false);
	const stopAt = useRef<number | null>(null);
	const togglePlay = () => {
		const v = video.current;
		if (!v) return;
		stopAt.current = null;
		v.paused ? void v.play().catch(() => {}) : v.pause();
	};
	// The fine bar shows the piece with 15 s around it, for frame-accurate ends on long videos.
	// biome-ignore lint/correctness/useExhaustiveDependencies: recomputed when an end moves by a whole second, not on every frame of a drag
	const fineView = useMemo<[number, number]>(() => {
		const d = info?.duration ?? 0;
		return [Math.max(0, range[0] - 15), Math.min(d, range[1] + 15)];
	}, [info, Math.round(range[0]), Math.round(range[1])]);

	const load = async (link = url.trim()) => {
		if (!link) return;
		abort.current?.abort();
		abort.current = new AbortController();
		setLoading(true);
		setError(null);
		setInfo(null);
		setStream(null);
		setPreviewFailed(false);
		try {
			const signal = abort.current.signal;
			const i = await studioApi.youtubeInfo(link, signal);
			setStream(await previewStream(i, signal));
			setInfo(i);
			setRange([0, Math.min(i.duration, 15)]);
			setTime(0);
			setTimeout(() => stage.current?.focus(), 50);
		} catch (e) {
			if ((e as Error).name !== "AbortError") setError((e as Error).message);
		} finally {
			setLoading(false);
		}
	};

	// This dialog is mounted with the editor, so it also re-attaches to jobs that were running before a reload.
	useEffect(() => {
		if (!projectId) return;
		resumePendingJobs(editor);
		// The one job model's producers, then the jobs kept on disk (src/jobs/durable.ts).
		startPointJobSource();
		startDurableJobs();
	}, [projectId, editor]);

	// Opening the dialog picks up a YouTube link from ⌘V or the clipboard and loads it right away.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs when the dialog opens or a link is handed in, not on every keystroke
	useEffect(() => {
		if (!open || info || loading) return;
		if (prefill) {
			setUrl(prefill);
			void load(prefill);
			return;
		}
		if (url) return;
		navigator.clipboard
			?.readText()
			.then((t) => {
				if (looksLikeYouTubeVideo(t)) {
					setUrl(t.trim());
					void load(t.trim());
				}
			})
			.catch(() => {});
	}, [open, prefill]);

	// Picture-only previews get their sound from a second player that follows the picture: it starts,
	// stops and seeks with it, waits while the picture buffers, and the picture waits for the sound.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the players are new elements whenever the stream or the video changes: listen again then
	useEffect(() => {
		const v = video.current;
		const a = audio.current;
		if (!v || !a) return;
		let heldForSound = false;
		const resync = (limit: number) => {
			if (Math.abs(a.currentTime - v.currentTime) > limit) a.currentTime = v.currentTime;
		};
		const onPlay = () => {
			resync(0.05);
			void a.play().catch(() => {});
		};
		const onPause = () => {
			if (!heldForSound) a.pause();
		};
		const onSeeking = () => {
			a.currentTime = v.currentTime;
		};
		const onWaiting = () => a.pause();
		const onPlaying = () => {
			resync(0.1);
			if (!v.paused) void a.play().catch(() => {});
		};
		const onTime = () => {
			if (!v.paused) resync(0.3);
		};
		const onRate = () => {
			a.playbackRate = v.playbackRate;
		};
		const onSoundWaiting = () => {
			if (v.paused || v.seeking) return;
			heldForSound = true;
			v.pause();
		};
		const onSoundReady = () => {
			if (!heldForSound) return;
			heldForSound = false;
			resync(0.05);
			void v.play().catch(() => {});
		};
		const picture: Array<[string, () => void]> = [
			["play", onPlay],
			["pause", onPause],
			["seeking", onSeeking],
			["waiting", onWaiting],
			["playing", onPlaying],
			["timeupdate", onTime],
			["ratechange", onRate],
		];
		const sound: Array<[string, () => void]> = [
			["waiting", onSoundWaiting],
			["canplay", onSoundReady],
			["playing", onSoundReady],
		];
		for (const [e, f] of picture) v.addEventListener(e, f);
		for (const [e, f] of sound) a.addEventListener(e, f);
		return () => {
			for (const [e, f] of picture) v.removeEventListener(e, f);
			for (const [e, f] of sound) a.removeEventListener(e, f);
		};
	}, [stream, info]);

	const seek = (t: number) => {
		if (video.current) video.current.currentTime = t;
		setTime(t);
		stage.current?.focus();
	};
	// I past the current Out moves the whole piece (same length) instead of stretching it; O before In likewise.
	const setStart = (t: number) =>
		setRange(([s, e]) => {
			const start = Math.max(0, t);
			if (start <= e - 0.5) return [start, e];
			const d = info?.duration ?? start + (e - s);
			return [Math.min(start, Math.max(0, d - 0.5)), Math.min(d, start + (e - s))];
		});
	const setEnd = (t: number) =>
		setRange(([s, e]) => {
			const end = Math.min(info?.duration ?? t, t);
			if (end >= s + 0.5) return [s, end];
			return [Math.max(0, end - (e - s)), Math.max(end, 0.5)];
		});

	const onKey = (e: React.KeyboardEvent) => {
		if (!info || (e.target as HTMLElement).tagName === "INPUT") return;
		const now = video.current?.currentTime ?? time;
		// By key position, so I/O work on the Russian layout too.
		if (e.code === "KeyI") {
			setStart(now);
			e.preventDefault();
		} else if (e.code === "KeyO") {
			setEnd(now);
			e.preventDefault();
		} else if (e.code === "Space") {
			togglePlay();
			e.preventDefault();
		}
	};

	const reset = () => {
		setInfo(null);
		setStream(null);
		setPreviewFailed(false);
		setUrl("");
		setError(null);
	};

	const close = (o: boolean) => {
		if (o) return setOpen(true);
		video.current?.pause();
		audio.current?.pause();
		abort.current?.abort();
		setLoading(false);
		setOpen(false);
		reset();
	};

	const length = range[1] - range[0];
	// The piece goes into Media at once (its item fills with colour as it downloads, src/jobs/components/pending-media.tsx):
	// the dialog closes the moment it is asked, and another piece can be taken while this one comes.
	const download = (full = false) => {
		if (!info) return;
		video.current?.pause();
		const from = full ? 0 : range[0];
		const still = (info.storyboard && frameAt(info.storyboard, from + Math.min(0.5, (full ? info.duration : range[1] - range[0]) / 2))) || info.thumbnail || undefined;
		void downloadFragment(
			editor,
			projectId,
			full
				? { url: url.trim(), start: 0, end: info.duration, title: info.title, full: true }
				: { url: url.trim(), start: range[0], end: range[1], title: info.title },
			{ still },
		);
		useAssetsPanelStore.getState().setActiveTab("media");
		setOpen(false);
		reset();
	};

	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogContent className="flex max-h-[calc(100vh-80px)] max-w-3xl flex-col" onKeyDown={onKey}>
				<DialogHeader>
					<DialogTitle>Add from a link</DialogTitle>
					<DialogDescription>Paste a link (YouTube, TikTok, Instagram…) or type to search YouTube. I / O marks a piece.</DialogDescription>
				</DialogHeader>
				<DialogBody className="min-h-0 overflow-y-auto">
					<div className="flex gap-2">
						<Input
							containerClassName="flex-1"
							className="flex-1"
							placeholder="Paste a link or search YouTube"
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							onPaste={(e) => {
								const pasted = e.clipboardData.getData("text").trim();
								if (!pasted) return;
								e.preventDefault();
								setUrl(pasted);
								void load(pasted);
							}}
							onKeyDown={(e) => e.key === "Enter" && void (isLink(url) ? load() : search())}
							autoFocus
						/>
						<Button onClick={() => void (isLink(url) ? load() : search())} disabled={loading || searching || !url.trim()}>
							{(loading || searching) && <Spinner className="mr-1" />}
							{isLink(url) || !url.trim() ? "Open" : "Search"}
						</Button>
					</div>
					{!info && !loading && hits.length > 0 && (
						<div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-youtube-results>
							{hits.map((hit) => (
								<button
									key={hit.id}
									type="button"
									data-youtube-hit={hit.id}
									className="hover:bg-accent group flex flex-col gap-1 rounded-md p-1 text-left transition-colors"
									onClick={() => {
										setUrl(hit.url);
										setHits([]);
										void load(hit.url);
									}}
								>
									<div className="relative aspect-video w-full overflow-hidden rounded-sm bg-black">
										<ScrubThumb hit={hit} />
										{hit.duration > 0 && (
											<span className="absolute right-1 bottom-1 rounded bg-black/75 px-1 text-[10px] text-white">{formatDuration(hit.duration)}</span>
										)}
									</div>
									<span className="line-clamp-2 text-xs leading-snug">{hit.title}</span>
									{hit.channel && <span className="text-muted-foreground truncate text-[11px]">{hit.channel}</span>}
								</button>
							))}
						</div>
					)}
					{loading && (
						<div className="flex flex-col gap-2" aria-label="Loading video">
							<Skeleton className="h-4 w-2/3" />
							<Skeleton className="aspect-video max-h-[40vh] w-full" />
							<Skeleton className="h-8 w-full" />
						</div>
					)}
					{error && !isBotCheck(error) && (
						<div className="flex flex-col gap-1">
							<p className="text-destructive text-sm">{error.split("\n\nDetails:")[0]}</p>
							{error.includes("\n\nDetails:") && (
								<details className="text-muted-foreground text-xs">
									<summary className="cursor-pointer select-none">Details</summary>
									<p className="mt-1 break-words">{error.split("\n\nDetails:")[1]}</p>
								</details>
							)}
						</div>
					)}
					{isBotCheck(error) && (
						<div className="flex flex-col gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm" data-youtube-signin>
							<p className="font-medium">YouTube wants to make sure you're a person</p>
							<p className="text-muted-foreground text-xs leading-relaxed">
								{signInBrowser
									? `It still asks with the sign-in from ${BROWSER_NAMES[signInBrowser] ?? signInBrowser}: open youtube.com there (signed in) once, then press Open again — or pick another browser.`
									: "It pauses networks that sent many requests. Gaziyav can open videos with your YouTube sign-in from a browser on this computer: it's used only for YouTube and never leaves this computer (the system may ask once to allow it). Or wait a few minutes and press Open again."}
							</p>
							{browsers.length > 0 && (
								<div className="flex flex-wrap gap-2">
									{browsers.map((b) => (
										<Button key={b} size="sm" variant={b === signInBrowser ? "default" : "secondary"} onClick={() => void signInWith(b)}>
											{t("Use my sign-in from {browser}", { browser: BROWSER_NAMES[b] ?? b })}
										</Button>
									))}
								</div>
							)}
						</div>
					)}
					{signInBrowser && !isBotCheck(error) && (
						<p className="text-muted-foreground text-xs">
							{t("YouTube sign-in from {browser}", { browser: BROWSER_NAMES[signInBrowser] ?? signInBrowser })} ·{" "}
							<button type="button" className="underline underline-offset-2" onClick={() => void signInWith("")}>
								Stop using it
							</button>
						</p>
					)}
					{info && (
						<div ref={stage} tabIndex={-1} className="flex flex-col gap-3 outline-none">
							<div className="truncate text-sm font-medium">
								{info.title} · {formatDuration(info.duration)}
							</div>
							{stream?.video && !previewFailed ? (
								<div className="relative">
									<video
										ref={video}
										src={stream.video}
										preload="auto"
										playsInline
										className="aspect-video max-h-[34vh] w-full cursor-pointer rounded-md bg-black"
										onClick={togglePlay}
										onPlay={() => setPlaying(true)}
										onPause={() => setPlaying(false)}
										onWaiting={() => setBuffering(true)}
										onPlaying={() => setBuffering(false)}
										onCanPlay={() => setBuffering(false)}
										onError={() => {
											setPreviewFailed(true);
											setPlaying(false);
										}}
										onTimeUpdate={(e) => {
											const t = e.currentTarget.currentTime;
											setTime(t);
											// «Play piece» stops at the end of the piece.
											if (stopAt.current != null && t >= stopAt.current) {
												stopAt.current = null;
												e.currentTarget.pause();
											}
										}}
									/>
									{buffering && playing && (
										<Spinner className="pointer-events-none absolute top-1/2 left-1/2 size-6 -translate-x-1/2 -translate-y-1/2 text-white" />
									)}
								</div>
							) : info.thumbnail ? (
								// eslint-disable-next-line @next/next/no-img-element
								<img src={info.thumbnail} alt="" className="max-h-[42vh] w-full rounded-md object-contain" />
							) : null}
							{stream?.video && previewFailed && (
								<p className="text-muted-foreground text-xs">
									This site doesn't allow a preview here. Set the start and end by time — the piece still downloads.
								</p>
							)}
							{stream?.audio && !previewFailed && (
								// biome-ignore lint/a11y/useMediaCaption: sound of the preview
								<audio ref={audio} src={stream.audio} preload="auto" />
							)}
							<div className="flex items-center gap-2">
								<Button
									variant="outline"
									size="icon"
									aria-label={playing ? "Pause" : "Play"}
									onClick={togglePlay}
									disabled={!stream?.video || previewFailed}
								>
									<HugeiconsIcon icon={playing ? PauseIcon : PlayIcon} className="size-4" />
								</Button>
								<span className="text-muted-foreground w-28 shrink-0 text-xs tabular-nums">
									{fmt(time)} / {fmt(info.duration)}
								</span>
								<div className="flex-1">
									<RangeBar label="Full length" view={[0, info.duration]} range={range} time={time} board={info.storyboard} onSeek={seek} onStart={setStart} onEnd={setEnd} />
								</div>
							</div>
							{info.duration > 90 && (
								<div className="flex items-center gap-2">
									<span className="w-9 shrink-0" />
									<span className="w-28 shrink-0" />
									<div className="flex-1">
										<RangeBar label="Close-up ±15 s" view={fineView} range={range} time={time} board={info.storyboard} onSeek={seek} onStart={setStart} onEnd={setEnd} />
									</div>
								</div>
							)}
							<div className="flex flex-wrap items-center gap-2 text-sm">
								<Button variant="outline" size="sm" onClick={() => setStart(video.current?.currentTime ?? time)}>
									Start here (I)
								</Button>
								<TimeField value={range[0]} onChange={setStart} label="Start" />
								<span className="text-muted-foreground">—</span>
								<TimeField value={range[1]} onChange={setEnd} label="End" />
								<Button variant="outline" size="sm" onClick={() => setEnd(video.current?.currentTime ?? time)}>
									End here (O)
								</Button>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => {
										seek(range[0]);
										stopAt.current = range[1];
										void video.current?.play();
									}}
								>
									▶ Play piece
								</Button>
							</div>
							<p className="text-muted-foreground text-xs">Space — play/pause · I / O — set start / end. Any length.</p>
						</div>
					)}
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={() => close(false)}>
						Close
					</Button>
					<Button variant="outline" disabled={!info} onClick={() => download(true)}>
						Whole video{info?.duration ? ` · ${formatSeconds(info.duration)}` : ""}
					</Button>
					<Button disabled={!info || length < 0.5} onClick={() => download()}>
						{t("Add piece · {length}", { length: formatSeconds(length) })}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function TimeField({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
	const [text, setText] = useState(fmt(value));
	// Re-render the field after every commit: the parent may clamp the value to the same number as before.
	const [commits, setCommits] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a commit that the parent clamps to the same value must still reset the text
	useEffect(() => setText(fmt(value)), [value, commits]);
	return (
		<Input
			size="sm"
			aria-label={label}
			className="w-20 text-center tabular-nums"
			value={text}
			onChange={(e) => setText(e.target.value)}
			onBlur={() => {
				const v = parseTime(text);
				if (v != null) onChange(v);
				setCommits((c) => c + 1);
			}}
			data-keep-enter
			onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
		/>
	);
}

/** A search result's picture that plays through the video under the pointer (YouTube's three frames at 25, 50 and 75 %:
 * small images from its picture servers, no request to YouTube itself). */
function ScrubThumb({ hit }: { hit: YouTubeHit }) {
	const [frame, setFrame] = useState(0);
	const frames = useMemo(() => [1, 2, 3].map((k) => `https://i.ytimg.com/vi/${hit.id}/mq${k}.jpg`), [hit.id]);
	return (
		// biome-ignore lint/a11y: the hover scrub is a pointer-only preview; the tile itself is the button
		<img
			src={frame ? frames[frame - 1] : hit.thumbnail}
			alt=""
			className="size-full object-cover"
			onMouseEnter={() => {
				for (const f of frames) new Image().src = f;
			}}
			onMouseMove={(e) => {
				const r = e.currentTarget.getBoundingClientRect();
				setFrame(1 + Math.min(2, Math.floor(((e.clientX - r.left) / Math.max(1, r.width)) * 3)));
			}}
			onMouseLeave={() => setFrame(0)}
		/>
	);
}

/** Indexes of the filmstrip frames that fill a bar `width` px wide (40 px tall frames). */
const filmstrip = (width: number, board: Storyboard) => Array.from({ length: Math.ceil(width / ((40 * board.width) / board.height)) }, (_, k) => k);

/** The storyboard frame of the video at `t` as a still for its Media item (a window onto the sprite sheet). */
function frameAt(board: Storyboard, t: number): SpriteFrame | undefined {
	const per = board.cols * board.rows;
	const k = Math.max(0, Math.min(board.count - 1, Math.floor(t / board.interval)));
	const sheet = board.sheets[Math.min(board.sheets.length - 1, Math.floor(k / per))];
	if (!sheet) return undefined;
	const i = k % per;
	return { sheet, col: i % board.cols, row: Math.floor(i / board.cols), cols: board.cols, rows: board.rows, width: board.width, height: board.height };
}

/** One storyboard frame (the video at `t`), `height` px tall: a window onto the sprite sheet, scaled without distortion. */
function BoardFrame({ board, t, height, className }: { board: Storyboard; t: number; height: number; className?: string }) {
	const per = board.cols * board.rows;
	const k = Math.max(0, Math.min(board.count - 1, Math.floor(t / board.interval)));
	const sheet = board.sheets[Math.min(board.sheets.length - 1, Math.floor(k / per))];
	const i = k % per;
	const scale = height / board.height;
	return (
		<div className={className} style={{ width: board.width * scale, height, overflow: "hidden" }}>
			<div
				style={{
					width: board.width,
					height: board.height,
					backgroundImage: `url("${sheet}")`,
					backgroundPosition: `${-(i % board.cols) * board.width}px ${-Math.floor(i / board.cols) * board.height}px`,
					transform: `scale(${scale})`,
					transformOrigin: "0 0",
				}}
			/>
		</div>
	);
}

/**
 * A stretch of the video as a bar: the chosen piece in yellow with draggable ends, the white playhead (drag to scrub).
 * With YouTube's storyboard the bar is a filmstrip, and the frame under the pointer shows above it at once.
 */
function RangeBar({
	label,
	view,
	range,
	time,
	board,
	onSeek,
	onStart,
	onEnd,
}: {
	label: string;
	view: [number, number];
	range: [number, number];
	time: number;
	board?: Storyboard;
	onSeek: (t: number) => void;
	onStart: (t: number) => void;
	onEnd: (t: number) => void;
}) {
	const bar = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(0);
	const [hover, setHover] = useState<{ t: number; x: number } | null>(null);
	useEffect(() => {
		const el = bar.current;
		if (!el) return;
		const ro = new ResizeObserver(() => setWidth(el.getBoundingClientRect().width));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
	const span = Math.max(view[1] - view[0], 0.01);
	const pct = (t: number) => `${(Math.max(0, Math.min(t - view[0], span)) / span) * 100}%`;
	const at = (clientX: number) => {
		const r = bar.current!.getBoundingClientRect();
		return view[0] + (Math.max(0, Math.min(clientX - r.left, r.width)) / r.width) * span;
	};
	const follow = (fn: (t: number) => void) => (e: React.PointerEvent) => {
		e.stopPropagation();
		e.preventDefault();
		fn(at(e.clientX));
		const move = (ev: PointerEvent) => fn(at(ev.clientX));
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	};
	const inView = (t: number) => t >= view[0] - 0.001 && t <= view[1] + 0.001;
	const len = range[1] - range[0];
	return (
		<div className="flex flex-col gap-0.5">
			<span className="text-muted-foreground text-[10px]">{label}</span>
			<div
					ref={bar}
					className={`bg-accent relative cursor-pointer rounded-md ${board ? "h-10" : "h-8 overflow-hidden"}`}
					onPointerDown={follow(onSeek)}
					onPointerMove={(e) => {
						if (!board || e.buttons) return setHover(null);
						setHover({ t: at(e.clientX), x: e.clientX - bar.current!.getBoundingClientRect().left });
					}}
					onPointerLeave={() => setHover(null)}
				>
					{board && width > 0 && (
						<div className="pointer-events-none absolute inset-0 flex overflow-hidden rounded-md opacity-70">
							{filmstrip(width, board).map((k, _, all) => (
								<BoardFrame key={k} board={board} height={40} t={view[0] + ((k + 0.5) * span) / all.length} className="shrink-0" />
							))}
						</div>
					)}
					{board && hover && (
						<div
							className="pointer-events-none absolute bottom-full z-10 mb-1.5 flex -translate-x-1/2 flex-col items-center gap-0.5"
							style={{ left: Math.max(48, Math.min(width - 48, hover.x)) }}
						>
							<BoardFrame board={board} t={hover.t} height={90} className="rounded border border-white/30 shadow-lg" />
							<span className="rounded bg-black/80 px-1 text-[10px] text-white tabular-nums">{fmt(hover.t)}</span>
						</div>
					)}
				<div
					className="absolute inset-y-0 flex items-center justify-center rounded-sm border-y-2 border-yellow-400 bg-yellow-400/25"
					style={{ left: pct(range[0]), width: `calc(${pct(range[1])} - ${pct(range[0])})` }}
				>
					{len / span > 0.08 && (
						<span className="pointer-events-none truncate px-3 text-[10px] font-medium text-yellow-200 tabular-nums">{len.toFixed(1)} s</span>
					)}
				</div>
				{(
					[
						[range[0], onStart, "-translate-x-0"],
						[range[1], onEnd, "-translate-x-full"],
					] as const
				).map(([t, fn, shift], i) =>
					inView(t) ? (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: the two ends of the range
							key={i}
							className={`absolute inset-y-0 w-3 cursor-ew-resize rounded-sm bg-yellow-400 ${shift}`}
							style={{ left: pct(t) }}
							onPointerDown={follow(fn)}
						/>
					) : null,
				)}
				{inView(time) && <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: pct(time) }} />}
			</div>
		</div>
	);
}
