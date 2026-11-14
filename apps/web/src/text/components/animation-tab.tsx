"use client";

import { useEffect, useRef, useState } from "react";
import { Segmented } from "@/components/editor/panels/properties/components/inspector-ui";
import { Slider } from "@/components/ui/slider";
import { useEditor } from "@/editor/use-editor";
import {
	DEFAULT_ANIM_IN_DURATION,
	DEFAULT_ANIM_OUT_DURATION,
	TEXT_ANIM_IN,
	TEXT_ANIM_LOOP,
	TEXT_ANIM_OUT,
} from "@/animation/presets";
import type { TimelineElement } from "@/timeline";
import { cn } from "@/utils/ui";
import { mediaTime, TICKS_PER_SECOND } from "@/wasm";
import { AnimatedPresetLabel } from "./anim-preview";

type Slot = "in" | "out" | "loop";
type Page = Slot | "combo";

const SLOT_OPTIONS: Record<Slot, ReadonlyArray<{ value: string; label: string }>> = {
	in: TEXT_ANIM_IN,
	out: TEXT_ANIM_OUT,
	loop: TEXT_ANIM_LOOP,
};

const PAGE_LABEL: Record<Page, string> = { in: "In", out: "Out", loop: "Loop", combo: "Combo" };

/**
 * CapCut's Combo for a video or photo: one animation over the whole clip — here an In and an Out that meet in the
 * middle (each half of the clip, up to 3 s). Picking an In or Out afterwards keeps the other half and drops the combo.
 */
const COMBOS: ReadonlyArray<{ value: string; label: string; in: string; out: string }> = [
	{ value: "none", label: "None", in: "none", out: "none" },
	{ value: "zoom", label: "Zoom in & out", in: "scaleDown", out: "scaleUp" },
	{ value: "fade", label: "Fade in & out", in: "fade", out: "fade" },
	{ value: "pop", label: "Pop", in: "pop", out: "pop" },
	{ value: "spin", label: "Spin around", in: "spin", out: "spin" },
	{ value: "rise", label: "Rise & fly", in: "rise", out: "rise" },
	{ value: "fall", label: "Drop down", in: "drop", out: "drop" },
	{ value: "swipe", label: "Swipe", in: "slideRight", out: "slideLeft" },
	{ value: "blur", label: "Blur in & out", in: "blurIn", out: "blurOut" },
	{ value: "smooth", label: "Smooth", in: "smoothRise", out: "smoothRise" },
];

const MAX_DURATION = 3;

function readString(element: TimelineElement, key: string): string {
	const value = element.params[key];
	return typeof value === "string" ? value : "none";
}

function readNumber(element: TimelineElement, key: string, fallback: number): number {
	const value = element.params[key];
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Video and photo get In · Out · Combo (CapCut); text and stickers In · Out · Loop. */
export function animationPages(element: TimelineElement): Page[] {
	return element.type === "video" || element.type === "image" ? ["in", "out", "combo"] : ["in", "out", "loop"];
}

/**
 * Properties → Animation: CapCut's row In · Out · Combo (or Loop), a grid of presets and the duration under it. One
 * click applies a preset (one undo step) and replays that part of the clip.
 */
export function TextAnimationTab({ element, trackId }: { element: TimelineElement; trackId: string }) {
	const editor = useEditor();
	const stopTimer = useRef<number | null>(null);
	const pages = animationPages(element);
	const combo = readString(element, "anim.combo");
	// opens on the part the clip already has
	const [page, setPage] = useState<Page>(() =>
		combo !== "none" && pages.includes("combo")
			? "combo"
			: (pages.find((p) => p !== "combo" && readString(element, `anim.${p}`) !== "none") ?? "in"),
	);
	useEffect(
		() => () => {
			if (stopTimer.current) window.clearTimeout(stopTimer.current);
		},
		[],
	);
	const clipSeconds = element.duration / TICKS_PER_SECOND;

	const write = (changes: Record<string, string | number>) => {
		editor.timeline.updateElements({
			updates: [{ trackId, elementId: element.id, patch: { params: { ...element.params, ...changes } } }],
		});
	};

	/** Plays the part of the clip the preset affects, like CapCut does. */
	const replay = (slot: Page, seconds: number) => {
		const from = slot === "out" ? Math.max(0, clipSeconds - seconds - 0.3) : 0;
		const span = slot === "loop" ? Math.min(clipSeconds, 2) : slot === "combo" ? clipSeconds : seconds + 0.4;
		editor.playback.pause();
		editor.playback.seek({ time: mediaTime({ ticks: Math.round(element.startTime + from * TICKS_PER_SECOND) }) });
		editor.playback.play();
		if (stopTimer.current) window.clearTimeout(stopTimer.current);
		stopTimer.current = window.setTimeout(() => editor.playback.pause(), span * 1000);
	};

	const comboHalf = Math.max(0.1, Math.min(MAX_DURATION, clipSeconds / 2));

	return (
		<div className="flex flex-col gap-3 px-4 pt-3 pb-4" data-animation-tab>
					<div data-anim-pages>
						<Segmented<Page>
							label="Animation type"
							value={page}
							options={pages.map((p) => ({ value: p, label: PAGE_LABEL[p] }))}
							onChange={setPage}
						/>
					</div>
					{page === "combo" ? (
						<AnimationGrid
							page="combo"
							options={COMBOS}
							value={combo}
							duration={readNumber(element, "anim.inDuration", comboHalf) * 2}
							maxDuration={Math.min(MAX_DURATION * 2, Math.max(0.2, clipSeconds))}
							onPick={(value) => {
								const pair = COMBOS.find((c) => c.value === value) ?? COMBOS[0];
								write({
									"anim.combo": value,
									"anim.in": pair.in,
									"anim.out": pair.out,
									"anim.inDuration": comboHalf,
									"anim.outDuration": comboHalf,
								});
								if (value !== "none") replay("combo", clipSeconds);
							}}
							onDuration={(seconds) => write({ "anim.inDuration": seconds / 2, "anim.outDuration": seconds / 2 })}
						/>
					) : (
						<AnimationGrid
							page={page}
							options={SLOT_OPTIONS[page]}
							value={combo !== "none" && page !== "loop" ? "none" : readString(element, `anim.${page}`)}
							duration={readNumber(element, `anim.${page}Duration`, page === "out" ? DEFAULT_ANIM_OUT_DURATION : DEFAULT_ANIM_IN_DURATION)}
							maxDuration={MAX_DURATION}
							onPick={(value) => {
								// a combo is both halves: picking one side ends it (the other side stays as it was)
								const changes: Record<string, string | number> = { [`anim.${page}`]: value };
								if (combo !== "none" && page !== "loop") {
									changes["anim.combo"] = "none";
									changes[page === "in" ? "anim.out" : "anim.in"] = "none";
								}
								write(changes);
								if (value !== "none") replay(page, readNumber(element, `anim.${page}Duration`, DEFAULT_ANIM_IN_DURATION));
							}}
							onDuration={(seconds) => write({ [`anim.${page}Duration`]: seconds })}
						/>
					)}
		</div>
	);
}

function AnimationGrid({
	page,
	options,
	value,
	duration,
	maxDuration,
	onPick,
	onDuration,
}: {
	page: Page;
	options: ReadonlyArray<{ value: string; label: string; in?: string }>;
	value: string;
	duration: number;
	maxDuration: number;
	onPick: (value: string) => void;
	onDuration: (seconds: number) => void;
}) {
	const [draft, setDraft] = useState(duration);
	const [hovered, setHovered] = useState<string | null>(null);
	useEffect(() => setDraft(duration), [duration]);

	return (
		<div className="flex flex-col gap-3" data-anim-page={page}>
			{/* two columns in a narrow panel: «Letters rise» and «Typewriter» were cut in three */}
			<div className="grid grid-cols-3 gap-1.5 @max-[17.5rem]/insp:grid-cols-2">
				{options.map((option) => (
					<button
						key={option.value}
						type="button"
						aria-pressed={value === option.value}
						data-anim-preset={option.value}
						onClick={() => onPick(option.value)}
						onMouseEnter={() => setHovered(option.value)}
						onMouseLeave={() => setHovered((current) => (current === option.value ? null : current))}
						title={option.label}
						className={cn(
							"h-7 overflow-hidden rounded-md border px-1.5 text-xs transition-colors",
							value === option.value
								? "border-primary bg-primary/10 text-foreground"
								: "text-muted-foreground hover:border-foreground/40 hover:text-foreground",
						)}
					>
						<AnimatedPresetLabel
							slot={page === "combo" ? "in" : page}
							kind={page === "combo" ? (option.in ?? "none") : option.value}
							label={option.label}
							hovered={hovered === option.value}
						/>
					</button>
				))}
			</div>
			{page !== "loop" && value !== "none" && (
				<div className="flex items-center gap-3" data-anim-duration>
					<span className="text-muted-foreground w-14 shrink-0 text-xs">Duration</span>
					<Slider
						min={page === "combo" ? 0.2 : 0.1}
						max={maxDuration}
						step={0.05}
						value={[Math.min(maxDuration, draft)]}
						onValueChange={([next]) => setDraft(next)}
						onValueCommit={([next]) => onDuration(next)}
						aria-label={`${PAGE_LABEL[page]} duration`}
					/>
					<span className="text-muted-foreground w-10 shrink-0 text-right text-xs tabular-nums">{draft.toFixed(1)} s</span>
				</div>
			)}
		</div>
	);
}
