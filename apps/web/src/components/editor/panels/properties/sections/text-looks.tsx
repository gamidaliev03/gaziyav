"use client";

// Text → Bubble and Text → Effects (CapCut's row Basic · Bubble · Effects), and Captions → Template for caption clips.
// Bubble: a plate behind the words (shape, colour, padding) with a readable text colour on it. Effects: word-art looks
// (fill, outline, glow, gradient, hard shadow). Each tile is one ⌘Z; the words, the font and the place stay.
import type { CSSProperties } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/editor/use-editor";
import { useLang } from "@/i18n";
import { applyCaptionStyle, isCaptionElement } from "@/subtitles/apply-style";
import { captionStylesFor, type CaptionStyleId } from "@/subtitles/styles";
import type { TimelineElement } from "@/timeline";
import { cn } from "@/utils/ui";

type Look = Record<string, string | number | boolean>;

const NO_STROKE: Look = { "stroke.enabled": false };
const NO_SHADOW: Look = { "shadow.enabled": false };
const NO_GRADIENT: Look = { "gradient.enabled": false };
const stroke = (width: number, color: string): Look => ({ "stroke.enabled": true, "stroke.color": color, "stroke.width": width });
const glow = (color: string, blur: number): Look => ({ "shadow.enabled": true, "shadow.color": color, "shadow.blur": blur, "shadow.offsetX": 0, "shadow.offsetY": 0 });

/** Word art: everything about the letters' paint, nothing about their place or size. */
export const WORD_ART: ReadonlyArray<{ id: string; label: string; look: Look }> = [
	{ id: "none", label: "None", look: { color: "#ffffff", ...NO_STROKE, ...NO_SHADOW, ...NO_GRADIENT } },
	{ id: "outline", label: "Outline", look: { color: "#ffffff", ...stroke(8, "#000000"), ...NO_SHADOW, ...NO_GRADIENT } },
	{ id: "yellow", label: "Yellow pop", look: { color: "#ffd60a", ...stroke(8, "#000000"), "shadow.enabled": true, "shadow.color": "#00000099", "shadow.blur": 14, "shadow.offsetX": 0, "shadow.offsetY": 5, ...NO_GRADIENT } },
	{ id: "neon", label: "Neon", look: { color: "#ffffff", ...NO_STROKE, ...glow("#00e5ffcc", 45), ...NO_GRADIENT } },
	{ id: "pink-glow", label: "Pink glow", look: { color: "#ffe6f2", ...NO_STROKE, ...glow("#ff2d95cc", 40), ...NO_GRADIENT } },
	{ id: "sunset", label: "Sunset", look: { color: "#ffd60a", ...stroke(4, "#000000"), ...NO_SHADOW, "gradient.enabled": true, "gradient.color": "#ff4d8c" } },
	{ id: "retro", label: "Retro", look: { color: "#ffffff", ...NO_STROKE, ...glow("#e040fb99", 25), "gradient.enabled": true, "gradient.color": "#e040fb" } },
	{ id: "drop", label: "Hard shadow", look: { color: "#ffffff", ...NO_STROKE, "shadow.enabled": true, "shadow.color": "#000000cc", "shadow.blur": 0, "shadow.offsetX": 6, "shadow.offsetY": 6, ...NO_GRADIENT } },
	{ id: "red-outline", label: "Red outline", look: { color: "#ffffff", ...stroke(6, "#ff3b30"), ...NO_SHADOW, ...NO_GRADIENT } },
];

/** Bubbles: a plate (radius 0…100 = square…pill, padding in em of the frame) and the text colour that reads on it. */
export const BUBBLES: ReadonlyArray<{ id: string; label: string; plate: { color: string; padX: number; padY: number; radius: number } | null; text?: string }> = [
	{ id: "none", label: "None", plate: null },
	{ id: "pill-yellow", label: "Yellow pill", plate: { color: "#ffd60a", padX: 0.45, padY: 0.22, radius: 100 }, text: "#111111" },
	{ id: "pill-red", label: "Red pill", plate: { color: "#ff3340", padX: 0.55, padY: 0.22, radius: 100 }, text: "#ffffff" },
	{ id: "box-dark", label: "Dark box", plate: { color: "#000000b3", padX: 0.45, padY: 0.25, radius: 18 }, text: "#ffffff" },
	{ id: "box-white", label: "White box", plate: { color: "#ffffff", padX: 0.45, padY: 0.25, radius: 30 }, text: "#111111" },
	{ id: "tag-blue", label: "Blue tag", plate: { color: "#0a84ff", padX: 0.4, padY: 0.2, radius: 12 }, text: "#ffffff" },
	{ id: "sticky", label: "Sticky note", plate: { color: "#fff27a", padX: 0.4, padY: 0.25, radius: 8 }, text: "#222222" },
	{ id: "glass", label: "Glass", plate: { color: "#00000080", padX: 0.5, padY: 0.25, radius: 30 }, text: "#ffffff" },
	{ id: "green", label: "Green", plate: { color: "#34c759", padX: 0.45, padY: 0.22, radius: 40 }, text: "#ffffff" },
];

function useApply(element: TimelineElement, trackId: string) {
	const editor = useEditor();
	return (look: Look) =>
		editor.timeline.updateElements({ updates: [{ trackId, elementId: element.id, patch: { params: { ...element.params, ...look } } }] });
}

/** The look a tile shows, as CSS on a sample. */
function lookStyle(look: Look): CSSProperties {
	const shadow = look["shadow.enabled"] === true;
	const strokeOn = look["stroke.enabled"] === true;
	return {
		color: String(look.color ?? "#ffffff"),
		backgroundImage: look["gradient.enabled"] === true ? `linear-gradient(${String(look.color)}, ${String(look["gradient.color"])})` : undefined,
		WebkitBackgroundClip: look["gradient.enabled"] === true ? "text" : undefined,
		WebkitTextFillColor: look["gradient.enabled"] === true ? "transparent" : undefined,
		WebkitTextStroke: strokeOn ? `${Math.max(1, Number(look["stroke.width"]) / 6)}px ${String(look["stroke.color"])}` : undefined,
		textShadow: shadow
			? `${Number(look["shadow.offsetX"] ?? 0) / 3}px ${Number(look["shadow.offsetY"] ?? 0) / 3}px ${Number(look["shadow.blur"] ?? 0) / 4}px ${String(look["shadow.color"])}`
			: undefined,
	};
}

function Tile({ selected, label, data, onClick, children }: { selected: boolean; label: string; data: Record<string, string>; onClick: () => void; children: React.ReactNode }) {
	return (
		<button
			type="button"
			aria-pressed={selected}
			aria-label={label}
			title={label}
			onClick={onClick}
			{...data}
			className={cn(
				"flex h-14 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-md border bg-neutral-800 px-1 transition-colors",
				selected ? "border-primary" : "border-border hover:border-foreground/40",
			)}
		>
			{children}
			<span className="text-muted-foreground w-full truncate text-center text-[10px]">{label}</span>
		</button>
	);
}

const same = (params: TimelineElement["params"], look: Look) => Object.entries(look).every(([key, value]) => (params[key] ?? null) === value);

export function WordArtSection({ element, trackId }: { element: TimelineElement; trackId: string }) {
	const apply = useApply(element, trackId);
	const current = WORD_ART.find((art) => art.id !== "none" && same(element.params, art.look))?.id ?? (same(element.params, WORD_ART[0].look) ? "none" : null);
	return (
		<div className="grid grid-cols-3 gap-1.5 px-4 pt-3 pb-4" data-word-art={current ?? "custom"}>
			{WORD_ART.map((art) => (
				<Tile key={art.id} selected={current === art.id} label={art.label} data={{ "data-word-art-tile": art.id }} onClick={() => apply(art.look)}>
					<span className="text-lg leading-none font-black" style={lookStyle(art.look)}>
						Aa
					</span>
				</Tile>
			))}
		</div>
	);
}

export function BubbleSection({ element, trackId }: { element: TimelineElement; trackId: string }) {
	const editor = useEditor();
	const apply = useApply(element, trackId);
	const height = editor.project.getActiveOrNull()?.settings.canvasSize.height ?? 1920;
	// paddings in the renderer's units (canvas px), as text presets do (text/presets.ts buildPresetParams)
	const units = (em: number) => Math.round((em * height) / 6);
	const lookOf = (bubble: (typeof BUBBLES)[number]): Look =>
		bubble.plate
			? {
					"background.enabled": true,
					"background.color": bubble.plate.color,
					"background.cornerRadius": bubble.plate.radius,
					"background.paddingX": units(bubble.plate.padX),
					"background.paddingY": units(bubble.plate.padY),
					...(bubble.text ? { color: bubble.text } : {}),
				}
			: { "background.enabled": false };
	const on = element.params["background.enabled"] === true;
	const current = on ? (BUBBLES.find((b) => b.plate && element.params["background.color"] === b.plate.color && element.params["background.cornerRadius"] === b.plate.radius)?.id ?? null) : "none";
	return (
		<div className="grid grid-cols-3 gap-1.5 px-4 pt-3 pb-4" data-bubble={current ?? "custom"}>
			{BUBBLES.map((bubble) => (
				<Tile key={bubble.id} selected={current === bubble.id} label={bubble.label} data={{ "data-bubble-tile": bubble.id }} onClick={() => apply(lookOf(bubble))}>
					{bubble.plate ? (
						<span
							className="px-2 py-0.5 text-xs font-bold"
							style={{ background: bubble.plate.color, color: bubble.text, borderRadius: `${Math.max(2, bubble.plate.radius / 8)}px` }}
						>
							Text
						</span>
					) : (
						<span className="text-muted-foreground text-xs">Aa</span>
					)}
				</Tile>
			))}
		</div>
	);
}

/** Captions → Template: the caption styles; a tile restyles this caption, «Apply to all» every caption (re-cut too). */
export function CaptionTemplateSection({ element }: { element: TimelineElement }) {
	const editor = useEditor();
	const lang = useLang((s) => s.lang);
	const styles = captionStylesFor(lang);
	const current = String(element.params["caption.style"] ?? "");
	const restyle = async (styleId: CaptionStyleId, scope: "selected" | "all") => {
		const changed = await applyCaptionStyle({ editor, styleId, scope });
		if (scope === "all" && changed > 0) toast.success(`${changed} ${changed === 1 ? "caption" : "captions"} restyled — ⌘Z to undo`);
	};
	return (
		<div className="flex flex-col gap-2 px-4 pt-3 pb-4" data-caption-template={current || "none"}>
			<div className="grid grid-cols-3 gap-1.5">
				{styles.map((style) => (
					<Tile
						key={style.id}
						selected={current === style.id}
						label={style.name}
						data={{ "data-caption-template-tile": style.id }}
						onClick={() => void restyle(style.id, "selected")}
					>
						<span className="truncate text-sm leading-none font-black" style={{ ...lookStyle(style.params), fontFamily: String(style.params.fontFamily ?? "inherit") }}>
							Aa
						</span>
					</Tile>
				))}
			</div>
			<Button size="sm" variant="secondary" data-caption-template-all disabled={!current} onClick={() => void restyle(current as CaptionStyleId, "all")}>
				Apply to all captions
			</Button>
		</div>
	);
}

export const isCaption = (element: TimelineElement) => isCaptionElement(element);
