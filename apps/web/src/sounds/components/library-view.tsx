"use client";

import { stopTileDoubleClick, tileActivation } from "@/components/editor/panels/assets/tile-activation";
import { Add01Icon, ArrowDown01Icon, Cancel01Icon, CloudDownloadIcon, PauseIcon, PlayIcon, StarIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type DragEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { List, type RowComponentProps } from "react-window";
import { Button } from "@/components/ui/button";
import { chipClass } from "@/components/ui/chips";
import { Input } from "@/components/ui/input";
import { PanelHeader } from "@/components/ui/panel-header";
import { Segmented, type SegmentedItem } from "@/components/ui/segmented";
import { Spinner } from "@/components/ui/spinner";
import { useEditor } from "@/editor/use-editor";
import { EditorCore } from "@/core";
import { registerAudioPreview } from "@/preview/audio-focus";
import {
	buildLibraryClip,
	isFavourite,
	type LibraryEntry,
	rememberRecent,
	toggleFavourite,
	useLibraryUserState,
} from "@/library/client";
import { kickDownloads, prefetchInView, useRowDownload } from "@/library/downloads";
import { gainFactor } from "@/library/gain";
import { useMissingLibrary } from "@/library/missing";
import { type LibraryIndex, type LibraryItem, libraryFileUrl } from "@/library/types";
import { mediaTimeFromSeconds } from "@/wasm";
import { smartFilter, smartScore } from "@/search/smart";
import type { TimelineElement } from "@/timeline";
import type { LibraryAudioDragData } from "@/timeline/drag";
import { cn } from "@/utils/ui";
import { useT } from "@/i18n";
import { waveFraction } from "./wave-seek";
import { SourceSwitch, useSearchSource } from "@/components/editor/panels/assets/source-switch";
import { WebAudioRows } from "./web-audio";

type Tab = "sfx" | "music" | "mine";
const TAB_KEY = "opencut.sounds.tab";
const AUDIO_SECTIONS = [
	{ value: "sfx", label: "Sounds" },
	{ value: "music", label: "Music" },
	{ value: "mine", label: "Saved" },
] as const satisfies readonly SegmentedItem<Tab>[];

let cachedIndex: LibraryIndex | null = null;

const fmt = (s: number) =>
	s < 10
		? `${s.toFixed(1)} s`
		: `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Purpose filters (what the sound is for), never pack names. Matched on name, category and tags. */
interface Purpose {
	label: string;
	words: string[];
}
const SFX_PURPOSES: Purpose[] = [
	{ label: "Whoosh", words: ["whoosh", "woosh", "swoosh", "swish", "swipe", "transition"] },
	{ label: "Impacts", words: ["impact", "hit", "punch", "boom", "slam", "thud", "sub drop", "kick"] },
	{ label: "Pops & UI", words: ["pop", "click", "ui", "button", "tap", "notification", "ding", "bell", "chime"] },
	{ label: "Risers", words: ["riser", "rise", "uplifter", "downlifter", "build", "sweep", "tension"] },
	{ label: "Glitch", words: ["glitch", "digital", "static", "error", "data", "computer"] },
	{ label: "Funny", words: ["funny", "fun", "laugh", "cartoon", "meme", "fail", "boing", "reaction", "comic", "rimshot", "scratch"] },
	{ label: "Ambience", words: ["ambience", "ambient", "nature", "rain", "wind", "birds", "forest", "city", "room tone"] },
];
const SFX_MORE: Purpose[] = [
	{ label: "Money", words: ["money", "cash", "coin", "register", "payment"] },
	{ label: "Everyday", words: ["door", "phone", "typing", "keyboard", "camera", "shutter", "footstep", "paper", "foley", "cards", "dice", "cloth", "metal"] },
	{ label: "Cinematic", words: ["cinematic", "trailer", "braam", "epic", "drone"] },
	{ label: "Game", words: ["game", "arcade", "8-bit", "level", "power up", "coin", "rpg", "sci-fi", "laser"] },
	{ label: "Musical stings", words: ["sting", "jingle", "musical", "fanfare", "harp", "piano", "drum", "snare", "hi-hat", "cymbal"] },
	{ label: "Crowd & people", words: ["crowd", "applause", "clap", "cheer", "voice", "breath", "kiss"] },
];
const MUSIC_PURPOSES: Purpose[] = [
	{ label: "Trending", words: ["trending beats"] },
	{ label: "Upbeat", words: ["upbeat", "happy", "pop", "dance"] },
	{ label: "Lo-fi & chill", words: ["lo-fi", "lofi", "chill"] },
	{ label: "Hip-hop", words: ["hip-hop", "trap", "urban", "rap"] },
	{ label: "Epic", words: ["cinematic", "epic", "trailer"] },
	{ label: "Corporate", words: ["corporate", "business"] },
	{ label: "Ambient", words: ["ambient", "calming", "dreamy"] },
	{ label: "Funny", words: ["funny", "meme", "humorous", "quirky"] },
	{ label: "Romantic", words: ["romantic", "love", "emotional", "piano"] },
];
const MUSIC_MORE: Purpose[] = [
	{ label: "Electronic", words: ["electronic", "synth", "grooving", "house", "edm"] },
	{ label: "Sports", words: ["sport", "workout", "energetic"] },
	{ label: "Travel & vlog", words: ["travel", "vlog", "lifestyle"] },
	{ label: "Acoustic", words: ["acoustic", "folk", "guitar"] },
	{ label: "Suspense", words: ["horror", "suspense", "dark", "mysterious"] },
	{ label: "Holiday", words: ["holiday", "christmas"] },
	{ label: "Latin & world", words: ["latin", "world", "bossa", "salsa", "tango"] },
	{ label: "Jazz & retro", words: ["jazz", "retro", "swing", "blues", "funk"] },
	{ label: "Rock & reggae", words: ["rock", "reggae", "punk"] },
];
/** One row of the library list (a SoundRow is 39 px): the list draws only the rows in view (react-window). */
const ROW_PX = 40;
const matchesPurpose = (item: LibraryItem, purpose: Purpose) => {
	const hay = `${item.name} ${item.cat} ${item.tags.join(" ")}`.toLowerCase();
	return purpose.words.some((w) => hay.includes(w));
};
const toEntry = (item: LibraryItem): LibraryEntry & { remote?: boolean; peaks?: string; artist?: string; license?: string; gain?: number } => ({
	id: item.id,
	kind: item.kind,
	name: item.name,
	cat: item.cat,
	dur: item.dur,
	url: libraryFileUrl(item.id),
	remote: item.remote,
	peaks: item.peaks,
	artist: item.artist,
	license: item.license,
	gain: item.gain,
});

/** A catalog file not on this Mac yet starts downloading now (the clip is already placed; it fills in when ready). */
const startDownload = (id: string, hover = false) =>
	void fetch("/api/library/fetch", { method: "POST", headers: { "Content-Type": "application/json", "X-Studio": "1" }, body: JSON.stringify({ id, hover }) })
		.then(() => kickDownloads())
		.catch(() => {});

/**
 * The catalog's preview wave (48 heights, base64) as the row's own strip: symmetric bars across the free width of the
 * row, the part already played in the accent colour while the ▶ preview runs (the user asked for the wave in the
 * Audio panel, not a 14 px hint). A click on the wave plays the track from that point (CapCut's scrub), a thin
 * playhead line runs across it; a drag from it still takes the row to the timeline.
 */
function Peaks({ peaks, progress = 0, playing = false, onSeek, onAdd }: { peaks: string; progress?: number; playing?: boolean; onSeek?: (fraction: number) => void; onAdd?: () => void }) {
	const bars = useMemo(() => {
		try {
			return Array.from(atob(peaks), (c) => c.charCodeAt(0) / 255);
		} catch {
			return [];
		}
	}, [peaks]);
	const at = Math.max(0, Math.min(1, progress));
	const played = Math.round(bars.length * at);
	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: the ▶ button is the keyboard way to play; the wave is a pointer shortcut
		<div
			className="relative h-6 max-w-[45%] min-w-10 flex-1 basis-0 cursor-pointer"
			data-library-wave-seek=""
			title="Click to listen from here, double-click to add at the playhead"
			onClick={(event) => {
				event.stopPropagation();
				const rect = event.currentTarget.getBoundingClientRect();
				onSeek?.(waveFraction(event.clientX, rect.left, rect.width));
			}}
			// A double-click on the wave adds the song like the rest of the row (final-A A2: it only listened).
			onDoubleClick={(event) => {
				event.preventDefault();
				event.stopPropagation();
				onAdd?.();
			}}
		>
			<svg viewBox={`0 0 ${bars.length * 3} 24`} preserveAspectRatio="none" className="size-full" aria-hidden="true" data-library-wave={played > 0 ? "playing" : "still"}>
				<title>Sound wave</title>
				{bars.map((h, i) => {
					const height = Math.max(2, h * 22);
					return (
						// biome-ignore lint/suspicious/noArrayIndexKey: fixed-length bar list
						<rect key={i} x={i * 3} y={12 - height / 2} width={2} height={height} rx={1} className={i < played ? "fill-primary" : "fill-muted-foreground/45"} />
					);
				})}
			</svg>
			{playing && (
				<div
					className="bg-primary pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 rounded-full"
					style={{ left: `${at * 100}%` }}
					data-library-wave-playhead={Math.round(at * 1000)}
				/>
			)}
		</div>
	);
}

function readTab(): Tab {
	try {
		const v = localStorage.getItem(TAB_KEY);
		return v === "music" || v === "mine" ? v : "sfx";
	} catch {
		return "sfx";
	}
}

/** One preview at a time across all lists. */
const preview = {
	audio: null as HTMLAudioElement | null,
	id: null as string | null,
	listeners: new Set<() => void>(),
	/** The ▶ plays the file at the library's level: its gain (library/gain.ts) through a gain node. */
	context: null as AudioContext | null,
	/** How far the preview has played (0..1): the row's wave fills up to here. */
	progress: 0,
	frame: 0,
	toggle(entry: LibraryEntry & { gain?: number }) {
		if (this.id === entry.id) this.stop();
		else this.start(entry, 0);
	},
	/** A click on a row's wave: the playing row jumps there, any other row starts there (the playing one stops). */
	seek(entry: LibraryEntry & { gain?: number }, fraction: number) {
		const at = Math.max(0, Math.min(1, fraction));
		const a = this.audio;
		if (this.id !== entry.id || !a) {
			this.start(entry, at);
			return;
		}
		const duration = mediaDuration(a) ?? (entry.dur > 0 ? entry.dur : 0);
		if (duration > 0) a.currentTime = at * duration;
		if (a.paused) void a.play().catch(() => {});
		this.progress = at;
		for (const fn of this.listeners) fn();
	},
	start(entry: LibraryEntry & { gain?: number }, from: number) {
		// One sound at a time: the timeline stops for a preview, the preview stops when the timeline starts.
		try {
			const playback = EditorCore.getInstance().playback;
			if (playback.getIsPlaying()) playback.pause();
		} catch {}
		this.audio?.pause();
		const a = new Audio();
		// the browser edition's files come from other sites (Hugging Face, Mixkit): asked with CORS, so the gain below still sounds
		a.crossOrigin = "anonymous";
		a.src = entry.url;
		if (entry.gain && typeof AudioContext !== "undefined") {
			try {
				if (!this.context) this.context = new AudioContext();
				const context = this.context;
				const node = context.createGain();
				node.gain.value = gainFactor(entry.gain);
				context.createMediaElementSource(a).connect(node).connect(context.destination);
				if (context.state === "suspended") void context.resume();
			} catch {}
		}
		if (from > 0) {
			// the file's own length once it is known (the catalog's is rounded); a cloud file is still coming down here
			const jump = () => {
				const duration = mediaDuration(a);
				if (duration) a.currentTime = from * duration;
			};
			if (a.readyState >= 1) jump();
			else a.addEventListener("loadedmetadata", jump, { once: true });
		}
		a.onended = () => {
			if (this.audio === a) this.stop();
		};
		void a.play().catch(() => {
			if (this.audio === a) this.stop();
		});
		this.audio = a;
		this.id = entry.id;
		this.progress = from;
		this.tick();
	},
	tick() {
		cancelAnimationFrame(this.frame);
		const a = this.audio;
		if (!a) return;
		const duration = mediaDuration(a);
		// until the file's length is known the line stays where it was clicked
		if (duration) this.progress = a.currentTime / duration;
		for (const fn of this.listeners) fn();
		this.frame = requestAnimationFrame(() => this.tick());
	},
	stop() {
		cancelAnimationFrame(this.frame);
		this.audio?.pause();
		this.audio = null;
		this.id = null;
		this.progress = 0;
		for (const fn of this.listeners) fn();
	},
};

// The timeline starting to play stops this preview (preview/audio-focus.ts): one sound at a time.
registerAudioPreview(() => preview.stop());

const mediaDuration = (a: HTMLMediaElement) => (Number.isFinite(a.duration) && a.duration > 0 ? a.duration : null);

/** The playing preview's progress (0..1), live; 0 for any other row. */
function usePreviewProgress(id: string) {
	const [value, setValue] = useState(0);
	useEffect(() => {
		const fn = () => setValue(preview.id === id ? preview.progress : 0);
		preview.listeners.add(fn);
		fn();
		return () => {
			preview.listeners.delete(fn);
		};
	}, [id]);
	return value;
}

function usePreviewId() {
	const [id, setId] = useState(preview.id);
	useEffect(() => {
		const fn = () => setId(preview.id);
		preview.listeners.add(fn);
		return () => {
			preview.listeners.delete(fn);
		};
	}, []);
	return id;
}

export function SoundsPanel({ section }: { section?: Tab } = {}) {
	const [own, setTabState] = useState<Tab>("sfx");
	const tab = section ?? own;
	useEffect(() => setTabState(readTab()), []);
	useEffect(() => () => preview.stop(), []);
	const setTab = (next: Tab) => {
		setTabState(next);
		try {
			localStorage.setItem(TAB_KEY, next);
		} catch {}
	};

	return (
		<div className="flex h-full flex-col">
			{!section && <PanelHeader
				tabs={
					<Segmented
						aria-label="Audio sections"
						value={tab}
						onValueChange={setTab}
						items={AUDIO_SECTIONS}
						itemProps={(key) => ({ "data-audio-tab": key })}
					/>
				}
			/>}
			<div className="min-h-0 flex-1">
				{tab === "mine" ? (
					<MineList />
				) : (
					<LibraryList key={tab} kind={tab} />
				)}
			</div>
		</div>
	);
}

let prefetchAsked = false;

function useLibraryIndex() {
	const [index, setIndex] = useState<LibraryIndex | null>(cachedIndex);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		// First time the Audio tab opens: the 20 most used files come down in the background.
		if (!prefetchAsked) {
			prefetchAsked = true;
			void fetch("/api/library/prefetch", { method: "POST", headers: { "X-Studio": "1" } }).catch(() => {});
		}
		if (cachedIndex) return;
		fetch("/api/library/index")
			.then((r) => r.json())
			.then((data) => {
				if (data?.error) setError(data.error);
				else {
					cachedIndex = data;
					setIndex(data);
				}
			})
			.catch(() => setError("The sound library is unavailable. Restart the app."));
	}, []);
	return { index, error };
}

function useAddAtPlayhead() {
	const editor = useEditor();
	return (entry: LibraryEntry & { gain?: number }) => {
		const target = useMissingLibrary.getState().replacing;
		if (target) {
			// «Replace» on a clip whose sound is gone: this one takes its place (same start, at most its length; one ⌘Z).
			const tracks = editor.scenes.getActiveScene().tracks;
			const lanes = [tracks.main, ...tracks.overlay, ...(tracks.audio ?? [])] as Array<{ elements: readonly TimelineElement[] }>;
			const el = lanes.flatMap((t) => [...t.elements]).find((e) => e.id === target.elementId);
			useMissingLibrary.getState().startReplace(null);
			if (el) {
				const full = mediaTimeFromSeconds({ seconds: entry.dur > 0 ? entry.dur : 3 });
				const duration = Math.min(el.duration, full) as typeof full;
				editor.timeline.updateElements({ updates: [{ trackId: target.trackId, elementId: target.elementId, patch: { sourceUrl: entry.url, name: entry.name, trimStart: 0 as typeof full, duration, trimEnd: (full - duration) as typeof full } }] });
				startDownload(entry.id);
				rememberRecent(entry);
				return;
			}
		}
		editor.timeline.insertElement({
			element: buildLibraryClip({
				entry,
				startTime: editor.playback.getCurrentTime(),
				tracks: editor.scenes.getActiveScene().tracks,
			}),
			placement: { mode: "auto" },
		});
		startDownload(entry.id);
		rememberRecent(entry);
	};
}

/** The list's search: × and Escape clear it (as in Effects, Text and Stickers). */
function SearchField({ placeholder, query, onQuery }: { placeholder: string; query: string; onQuery: (query: string) => void }) {
	return (
		<div className="relative">
			<Input
				size="sm"
				placeholder={placeholder}
				value={query}
				onChange={(e) => onQuery(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Escape" && query) {
						e.stopPropagation();
						onQuery("");
					}
				}}
				className="pr-7"
			/>
			{query && (
				<button
					type="button"
					aria-label="Clear search"
					onClick={() => onQuery("")}
					className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded-full"
				>
					<HugeiconsIcon icon={Cancel01Icon} className="size-3" />
				</button>
			)}
		</div>
	);
}

function LibraryList({ kind }: { kind: "sfx" | "music" }) {
	const t = useT();
	const { index, error } = useLibraryIndex();
	const [query, setQuery] = useState("");
	const [purpose, setPurpose] = useState<Purpose | null>(null);
	const add = useAddAtPlayhead();
	const searchKind = kind === "sfx" ? "sound" : "music";
	const { pick } = useSearchSource(searchKind);
	const web = query.trim().length >= 2 && pick !== "library";
	const libraryShown = pick !== "web" || !web;
	const replacing = useMissingLibrary((s) => (s.replacing?.kind === kind ? s.replacing : null));
	useEffect(() => {
		if (!replacing) return;
		setQuery(replacing.name);
		setPurpose(null);
	}, [replacing]);
	const items = useMemo(() => (index?.items ?? []).filter((item) => item.kind === kind), [index, kind]);
	// Only the filters that find something in this library (an empty one is clutter).
	const main = useMemo(() => (kind === "sfx" ? SFX_PURPOSES : MUSIC_PURPOSES).filter((p) => items.some((i) => matchesPurpose(i, p))), [kind, items]);
	const more = useMemo(() => (kind === "sfx" ? SFX_MORE : MUSIC_MORE).filter((p) => items.some((i) => matchesPurpose(i, p))), [kind, items]);
	const matched = useMemo(() => {
		const pool = purpose ? items.filter((item) => matchesPurpose(item, purpose)) : items;
		const fields = (item: LibraryItem) => [item.name, item.cat, ...item.tags];
		const found = smartFilter({ items: pool, query, fields });
		// Typo-only matches ("cash" → "crash") are noise when real matches exist.
		const words = query.trim().split(/\s+/).filter(Boolean).length;
		if (words === 0) return found;
		const strong = found.filter((item) => smartScore({ query, fields: fields(item) }) >= 0.7 * words);
		return strong.length > 0 ? strong : found;
	}, [items, purpose, query]);
	const shown = useMemo(() => matched.map(toEntry), [matched]);
	const filtered = !!purpose || !!query.trim();

	if (error) return <p className="text-destructive p-3 text-sm">{error}</p>;
	if (!index) {
		return (
			<div className="text-muted-foreground flex items-center gap-2 p-3 text-sm">
				<Spinner className="size-3.5" /> Loading library…
			</div>
		);
	}
	return (
		<div className="flex h-full flex-col gap-2 p-2">
			<SearchField placeholder={kind === "sfx" ? "Search: whoosh, impact, click, pop…" : "Search: upbeat, lo-fi, piano…"} query={query} onQuery={setQuery} />
			{replacing && (
				<div className="bg-primary/10 flex items-center gap-2 rounded-md px-2 py-1 text-[11px]" data-library-replacing={replacing.elementId}>
					<span className="min-w-0 flex-1 truncate">{t("Replacing «{name}» — double-click a sound", { name: replacing.name })}</span>
					<button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => useMissingLibrary.getState().startReplace(null)}>
						Cancel
					</button>
				</div>
			)}
			{query.trim().length >= 2 && <SourceSwitch kinds={[searchKind]} audio />}
			<PurposeChips main={main} more={more} purpose={purpose} onPick={setPurpose} />
			{!libraryShown ? null : shown.length === 0 ? (
				<p className={cn("text-muted-foreground min-h-0 py-6 text-center text-sm", !web && "flex-1")}>Nothing found</p>
			) : (
				<List
					className="scrollbar-hidden min-h-0 flex-1"
					data-library-list={kind}
					data-library-count={shown.length}
					rowCount={shown.length}
					rowHeight={ROW_PX}
					overscanCount={8}
					rowComponent={LibraryRow}
					rowProps={{ rows: shown, onAdd: add }}
					onRowsRendered={({ startIndex, stopIndex }) => prefetchInView(shown.slice(startIndex, stopIndex + 1).flatMap((e) => (e.remote ? [e.id] : [])))}
				/>
			)}
			{web && <WebAudioRows kind={searchKind} query={query} pick={pick} grow={!libraryShown || shown.length === 0} />}
			<p className="text-muted-foreground text-[10px] tabular-nums">
				{filtered ? `${matched.length} of ${items.length}` : items.length} {kind === "sfx" ? "sounds" : "tracks"}
			</p>
		</div>
	);
}

function MineList() {
	const user = useLibraryUserState();
	const { index } = useLibraryIndex();
	const [query, setQuery] = useState("");
	const add = useAddAtPlayhead();
	// a saved row is remembered by id and name: its author, wave, licence and level come from the library as it is now
	const byId = useMemo(() => new Map((index?.items ?? []).map((item) => [item.id, toEntry(item)])), [index]);
	const filter = (list: LibraryEntry[]) =>
		smartFilter({ items: list, query, fields: (e) => [e.name, e.cat] }).map((entry) => ({ ...byId.get(entry.id), ...entry }));
	const favourites = filter(user.favourites);
	const favIds = new Set(user.favourites.map((f) => f.id));
	const recent = filter(user.recent.filter((r) => !favIds.has(r.id)));
	const empty = user.favourites.length === 0 && user.recent.length === 0;

	return (
		<div className="flex h-full flex-col gap-2 p-2">
			{!empty && (
				<SearchField placeholder="Search saved sounds" query={query} onQuery={setQuery} />
			)}
			<div className="scrollbar-hidden -mx-2 min-h-0 flex-1 overflow-y-auto px-2">
				{empty && (
					<p className="text-muted-foreground flex justify-center px-2 py-8" aria-label="Sounds you star or add to a video show up here.">
						<HugeiconsIcon icon={StarIcon} className="size-4" />
					</p>
				)}
				{favourites.length > 0 && <ListHeading>Favourites</ListHeading>}
				{favourites.map((entry) => (
					<SoundRow key={`f:${entry.id}`} entry={entry} onAdd={add} />
				))}
				{recent.length > 0 && <ListHeading>Recent</ListHeading>}
				{recent.map((entry) => (
					<SoundRow key={`r:${entry.id}`} entry={entry} onAdd={add} />
				))}
			</div>
		</div>
	);
}

function ListHeading({ children }: { children: string }) {
	return <div className="text-muted-foreground px-1.5 pt-2 pb-1 text-[11px]">{children}</div>;
}

const dragGhost = (() => {
	let el: HTMLDivElement | null = null;
	return (name: string) => {
		if (!el) {
			el = document.createElement("div");
			el.style.cssText =
				"position:fixed;top:-100px;left:-1000px;padding:4px 8px;border-radius:6px;font:12px system-ui;color:#fff;background:#2563ebcc;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none";
			document.body.appendChild(el);
		}
		el.textContent = `♪ ${name}`;
		return el;
	};
})();

type ShownEntry = ReturnType<typeof toEntry>;

/** Around the ▶ of a row whose file is coming down (0…1). */
function ProgressRing({ value }: { value: number }) {
	const r = 12;
	const c = 2 * Math.PI * r;
	return (
		<svg className="text-primary pointer-events-none absolute inset-0 -rotate-90" viewBox="0 0 28 28" aria-hidden data-download-ring={Math.round(value * 100)}>
			<circle cx="14" cy="14" r={r} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth="2" />
			<circle cx="14" cy="14" r={r} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0.04, value))} strokeLinecap="round" />
		</svg>
	);
}

function LibraryRow({ index, style, ariaAttributes, rows, onAdd }: RowComponentProps<{ rows: ShownEntry[]; onAdd: (entry: LibraryEntry) => void }>) {
	const t = useT();
	return (
		<div style={style} {...ariaAttributes}>
			<SoundRow entry={rows[index]} onAdd={onAdd} />
		</div>
	);
}

function SoundRow({ entry, onAdd }: { entry: LibraryEntry & { remote?: boolean; peaks?: string; artist?: string; license?: string; gain?: number }; onAdd: (entry: LibraryEntry) => void }) {
	const t = useT();
	const { remote, peaks } = entry;
	const progress = usePreviewProgress(entry.id);
	const editor = useEditor();
	const user = useLibraryUserState();
	const playingId = usePreviewId();
	const ghost = useRef<HTMLDivElement | null>(null);
	const fav = isFavourite(user, entry.id);
	const playing = playingId === entry.id;
	const download = useRowDownload(entry.id, !!remote);
	const inCloud = !!remote && !download.cached;
	// The pointer resting on a row (~150 ms) brings its file first.
	const hover = useRef<ReturnType<typeof setTimeout> | null>(null);
	const onEnter = () => {
		if (!inCloud || download.progress !== null) return;
		hover.current = setTimeout(() => startDownload(entry.id, true), 150);
	};
	const onLeave = () => {
		if (hover.current) clearTimeout(hover.current);
		hover.current = null;
	};

	const onDragStart = (event: DragEvent<HTMLDivElement>) => {
		const dragData: LibraryAudioDragData = {
			type: "library-audio",
			id: entry.id,
			name: entry.name,
			url: entry.url,
			kind: entry.kind,
			dur: entry.dur,
			cat: entry.cat,
			gain: entry.gain,
		};
		editor.timeline.dragSource.begin({ dataTransfer: event.dataTransfer, dragData });
		ghost.current = dragGhost(entry.name);
		event.dataTransfer.setDragImage(ghost.current, 12, 12);
	};

	return (
		<div
			className="hover:bg-accent focus:bg-accent group flex cursor-grab items-center gap-2 rounded-md px-1.5 py-1 outline-none active:cursor-grabbing"
			draggable
			data-library-id={entry.id}
			onMouseEnter={onEnter}
			onMouseLeave={onLeave}
			onDragStart={onDragStart}
			onDragEnd={() => editor.timeline.dragSource.end()}
			{...tileActivation(() => onAdd(entry))}
			title={t("Double-click to add at the playhead, or drag to the timeline")}
		>
			<Button
				variant="ghost"
				size="icon"
				className="relative size-7 shrink-0"
				onDoubleClick={stopTileDoubleClick}
				onClick={() => {
					preview.toggle(entry);
					if (inCloud) kickDownloads();
				}}
				aria-label={playing ? "Stop" : "Preview"}
			>
				{playing ? <HugeiconsIcon icon={PauseIcon} className="size-3.5" /> : <HugeiconsIcon icon={PlayIcon} className="size-3.5" />}
				{download.progress !== null && <ProgressRing value={download.progress} />}
			</Button>
			{/* the name gets the larger share of the row and never less than 6 rem (at 1024×640 it shrank to 2 px, final-A A2); the wave the rest */}
			{/* a song's name, artist and licence are content, not interface text (data-no-translate: the Russian scan skips them) */}
			<div className="min-w-[6rem] flex-[1.6] basis-0" data-no-translate>
				<div className="truncate text-xs">{entry.name}</div>
				<div className="text-muted-foreground flex items-center gap-1.5 truncate text-[10px]" title={entry.license}>
					{fmt(entry.dur)}
					{entry.artist && <span className="truncate" data-library-artist>· {entry.artist}</span>}
					{inCloud && download.offline && <HugeiconsIcon icon={CloudDownloadIcon} className="size-3" aria-label="Not on this Mac — downloads when the internet is back" />}
				</div>
			</div>
			{/* A click on the wave listens from there (the user's wish: the middle of a song, before it goes on the timeline). */}
			{peaks && (
				<Peaks
					peaks={peaks}
					progress={progress}
					playing={playing}
					onSeek={(fraction) => {
						preview.seek(entry, fraction);
						if (inCloud) kickDownloads();
					}}
					onAdd={() => onAdd(entry)}
				/>
			)}
			{/* CapCut's «+» on the row, shown on hover: adds at the playhead, as the double-click and the drag do */}
			<button
				type="button"
				data-tile-add
				aria-label="Add at the playhead"
				title="Add at the playhead"
				className="bg-primary text-primary-foreground grid size-[18px] shrink-0 place-items-center rounded-[4px] opacity-0 shadow transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
				onClick={(event) => {
					event.stopPropagation();
					onAdd(entry);
				}}
				onDoubleClick={stopTileDoubleClick}
			>
				<HugeiconsIcon icon={Add01Icon} className="size-3" strokeWidth={3} />
			</button>
			<button
				type="button"
				className={cn(
					"shrink-0 rounded p-1",
					fav ? "text-amber-400" : "text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
				)}
				onClick={() => toggleFavourite(entry)}
				onDoubleClick={stopTileDoubleClick}
				aria-label={fav ? "Remove from favourites" : "Add to favourites"}
				aria-pressed={fav}
			>
				<HugeiconsIcon icon={StarIcon} className="size-3.5" fill={fav ? "currentColor" : "none"} />
			</button>
		</div>
	);
}

/**
 * One row of purpose chips that never clips: chips that do not fit the panel width move
 * into «More ▾» (widths are measured once, the row re-fits on resize).
 */
function PurposeChips({
	main,
	more,
	purpose,
	onPick,
}: {
	main: Purpose[];
	more: Purpose[];
	purpose: Purpose | null;
	onPick: (p: Purpose | null) => void;
}) {
	const rowRef = useRef<HTMLDivElement | null>(null);
	const chipRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const moreRef = useRef<HTMLButtonElement | null>(null);
	const widths = useRef<number[]>([]);
	const [fit, setFit] = useState(main.length + 1);
	const chips = [null, ...main];

	// biome-ignore lint/correctness/useExhaustiveDependencies: chips derive from main
	useLayoutEffect(() => {
		const row = rowRef.current;
		if (!row) return;
		const GAP = 4;
		const measure = () => {
			chips.forEach((_, i) => {
				const el = chipRefs.current[i];
				if (el && el.offsetWidth > 0) widths.current[i] = el.offsetWidth;
			});
			const room = row.clientWidth - (moreRef.current?.offsetWidth ?? 60) - GAP;
			let used = 0;
			let count = 0;
			for (let i = 0; i < chips.length; i++) {
				const w = (widths.current[i] ?? 60) + (i > 0 ? GAP : 0);
				if (used + w > room) break;
				used += w;
				count++;
			}
			setFit(Math.max(1, count));
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(row);
		return () => ro.disconnect();
	}, [main]);

	const overflow = main.slice(Math.max(0, fit - 1));
	const menu = [...overflow, ...more];
	const menuActive = !!purpose && menu.includes(purpose);

	return (
		<div ref={rowRef} className="relative flex shrink-0 items-center gap-1 overflow-hidden">
			{chips.map((p, i) => (
				<button
					key={p?.label ?? "all"}
					ref={(el) => {
						chipRefs.current[i] = el;
					}}
					type="button"
					className={cn(chipClass(purpose === p), i >= fit && "pointer-events-none invisible absolute")}
					aria-hidden={i >= fit}
					tabIndex={i >= fit ? -1 : 0}
					onClick={() => onPick(p)}
				>
					{p?.label ?? "All"}
				</button>
			))}
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button ref={moreRef} type="button" className={cn(chipClass(menuActive), "flex items-center gap-0.5")}>
						{menuActive ? purpose?.label : "More"} <HugeiconsIcon icon={ArrowDown01Icon} className="size-3" />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					{menu.map((p) => (
						<DropdownMenuItem key={p.label} onSelect={() => onPick(p)}>
							{p.label}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
