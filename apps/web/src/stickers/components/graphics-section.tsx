"use client";

import { materialGrid, TILE_LABEL, TILE_THUMB, TileAddButton } from "@/components/editor/panels/assets/material-grid";
import { useWindowedGrid } from "@/components/editor/panels/assets/windowed-grid";
import { tileActivation } from "@/components/editor/panels/assets/tile-activation";
import { useEffect, useRef, useState } from "react";
import { whenScrollIdle } from "@/utils/scroll-idle-queue";
import { toast } from "sonner";
import lottie from "lottie-web/build/player/lottie_canvas";
import type { AnimationItem } from "lottie-web";
import { Chip, ChipRow } from "@/components/ui/chips";
import { useEditor } from "@/editor/use-editor";
import {
	fetchGraphicJson,
	IMPORTED_CATEGORY,
	useGraphicsLibrary,
	type GraphicItem,
} from "@/graphics/lottie/library";
import { displayName } from "@/stickers/display-name";
import { useT } from "@/i18n";
import { insertGraphic } from "@/stickers/insert-graphic";
import { mediaTime, TICKS_PER_SECOND } from "@/wasm";

const ticks = (seconds: number) => mediaTime({ ticks: Math.round(seconds * TICKS_PER_SECOND) });
const CATEGORY_ORDER = [
	// inside the app (Google's Noto Animated Emoji, CC BY 4.0): always there, the Kadr library's groups after it
	"Animated · Smileys",
	"Animated · People",
	"Animated · Animals",
	"Animated · Food",
	"Animated · Travel",
	"Animated · Activities",
	"Animated · Objects",
	"Animated · Symbols",
	"Animated · Flags",
	"Callouts",
	"Titles",
	"Lower Thirds",
	"Arrows",
	"Social",
	"Countdown",
	"Accents",
	"Status",
	"Celebrate",
	"Emoji",
	IMPORTED_CATEGORY,
];

const ANIMATED = "Animated · ";
/** Lottie titles duplicate the text presets (Text → Titles & plates): not offered here. */
const LEFT_OUT = new Set(["Titles"]);

/**
 * Lottie graphics as tiles under one row of category chips. «animated»: Stickers → Animated, Google's Noto Animated
 * Emoji by group. «motion»: Templates → Motion, the other graphics (callouts, arrows, badges, like/subscribe,
 * confetti…) and the user's imported .json files. Tiles animate on hover; a double-click adds one at the playhead.
 */
export function GraphicsSection({ kind }: { kind: "animated" | "motion" }) {
	const { status, items, imported, load, importFile } = useGraphicsLibrary();
	const [category, setCategory] = useState("");
	const fileInput = useRef<HTMLInputElement>(null);

	useEffect(() => {
		void load();
	}, [load]);

	const all = [...items, ...imported].filter((item) => !LEFT_OUT.has(item.category) && item.category.startsWith(ANIMATED) === (kind === "animated"));
	const categories = CATEGORY_ORDER.filter((name) => all.some((item) => item.category === name));
	const active = categories.includes(category) ? category : (categories[0] ?? category);
	const shown = all.filter((item) => item.category === active);
	// hundreds of tiles in a category: only the rows on screen are in the page
	const grid = useRef<HTMLDivElement>(null);
	const win = useWindowedGrid(grid, shown.length);

	return (
		<div data-graphics={kind}>
			{kind === "motion" && (
				<input
					ref={fileInput}
					type="file"
					accept=".json,application/json"
					className="hidden"
					onChange={async (event) => {
						const file = event.target.files?.[0];
						event.target.value = "";
						if (!file) return;
						try {
							await importFile(file);
							setCategory(IMPORTED_CATEGORY);
						} catch (error) {
							toast.error((error as Error).message);
						}
					}}
				/>
			)}
			{status === "loading" && <p className="text-muted-foreground text-xs">Loading graphics…</p>}
			{status === "error" && <p className="text-destructive text-xs">Couldn't read the graphics library. Reopen the tab to retry.</p>}
			<ChipRow aria-label="Graphics categories" className="mb-2">
				{categories.map((name) => (
					<Chip key={name} active={name === active} onClick={() => setCategory(name)}>
						{name.startsWith(ANIMATED) ? name.slice(ANIMATED.length) : name}
					</Chip>
				))}
				{kind === "motion" && (
					<Chip active={false} onClick={() => fileInput.current?.click()}>
						Import animation
					</Chip>
				)}
			</ChipRow>
			<div ref={grid} style={{ ...materialGrid(), ...win.style }} data-material-grid data-grid-window={`${win.from}-${win.to}/${shown.length}`}>
				{shown.slice(win.from, win.to).map((item) => (
					<GraphicTile key={item.id} item={item} />
				))}
			</div>
		</div>
	);
}

/** A tile that shows a still frame and plays while hovered (only while on screen). */
function GraphicTile({ item }: { item: GraphicItem }) {
	const editor = useEditor();
	const box = useRef<HTMLDivElement>(null);
	const anim = useRef<AnimationItem | null>(null);
	const [visible, setVisible] = useState(false);
	const [adding, setAdding] = useState(false);
	// A tile with a still picture (the app's graphics: their animations are in the content cloud) shows the picture and
	// builds the animation only when the pointer rests on it ~150 ms; the others build it when they come into view.
	const [resting, setResting] = useState(false);
	const [ready, setReady] = useState(false);
	const restTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const wanted = item.preview ? resting : visible;

	useEffect(() => {
		const node = box.current;
		if (!node) return;
		const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
			rootMargin: "120px",
		});
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (!wanted || !box.current) return;
		let cancelled = false;
		// built when the list is still, one tile per frame (hundreds of animated emoji in view at once stalled a scroll)
		whenScrollIdle(() =>
			fetchGraphicJson(item).then((json) => {
				if (cancelled || !box.current) return;
				const instance = lottie.loadAnimation({
					container: box.current,
					renderer: "canvas",
					loop: true,
					autoplay: false,
					animationData: JSON.parse(json),
					rendererSettings: { preserveAspectRatio: "xMidYMid meet", clearCanvas: true },
				} as Parameters<typeof lottie.loadAnimation>[0]);
				instance.addEventListener("DOMLoaded", () => {
					if (item.preview) instance.play();
					else instance.goToAndStop(Math.floor(instance.totalFrames * 0.6), true);
					setReady(true);
				});
				anim.current = instance;
			}),
		);
		return () => {
			cancelled = true;
			anim.current?.destroy();
			anim.current = null;
			setReady(false);
		};
	}, [wanted, item]);

	const add = async () => {
		setAdding(true);
		try {
			const { start, duration } = await insertGraphic(editor, item);
			// Frame 0 of many animations is empty: show the graphic once it has appeared.
			if (!editor.playback.getIsPlaying()) {
				editor.playback.seek({ time: ticks(start + Math.min(duration * 0.5, 1)) });
			}
		} catch (error) {
			toast.error((error as Error).message || "Couldn't add this graphic.");
		} finally {
			setAdding(false);
		}
	};

	const label = displayName(item.name);
	const t = useT();
	return (
		<div className="group relative">
			{/* the graphic's name is content (data-no-translate): the tooltip carries no name, so it reads in Russian whole */}
			<button
				type="button"
				title={t("Double-click to add at the playhead, or drag onto the timeline")}
				aria-label={label}
				data-no-translate
				disabled={adding}
				{...tileActivation(() => void add())}
				// Dragged onto the timeline: placed where it is dropped (its animation loads on the drop).
				draggable
				onDragStart={(event) =>
					editor.timeline.dragSource.begin({
						dataTransfer: event.dataTransfer,
						dragData: {
							id: item.id,
							type: "deferred",
							name: item.name,
							elementType: "graphic",
							dur: item.duration,
							place: async (start, hint) => {
								await insertGraphic(editor, item, start, hint);
							},
						},
					})
				}
				onDragEnd={() => editor.timeline.dragSource.end()}
				onPointerEnter={() => {
					if (item.preview) restTimer.current = setTimeout(() => setResting(true), 150);
					else anim.current?.play();
				}}
				onPointerLeave={() => {
					if (restTimer.current) clearTimeout(restTimer.current);
					if (item.preview) setResting(false);
					else anim.current?.goToAndStop(Math.floor((anim.current?.totalFrames ?? 0) * 0.6), true);
				}}
				onFocus={() => anim.current?.play()}
				onBlur={() => anim.current?.pause()}
				className="flex w-full flex-col gap-1 text-left"
			>
				<div className={`pointer-events-none relative bg-neutral-700/60 ${TILE_THUMB}`}>
					<div ref={box} className="absolute inset-0" />
					{item.preview && !ready && <img src={item.preview} alt="" className="absolute inset-0 m-auto size-3/4 object-contain" loading="lazy" draggable={false} />}
				</div>
				<span className={TILE_LABEL}>{label}</span>
			</button>
			<TileAddButton onAdd={() => void add()} />
		</div>
	);
}
