"use client";

// Templates → Motion graphics: the ready-made Remotion graphics by category, as 76 px tiles (CapCut's material grid),
// each previewed over a photo of its theme. The theme chips narrow the list to a theme (gaming, wedding, travel…) and
// preview every tile over that theme's photo. Hover plays one; a double-click, ↵, «+» or a drag onto the timeline adds
// it (at the playhead / where dropped).
import { EDITION } from "@/edition/cuts";
import dynamic from "next/dynamic";
import { useState } from "react";
import { useWhenStill } from "@/components/editor/panels/assets/list-scroll";
import { TILE_LABEL, TILE_THUMB, TileAddButton } from "@/components/editor/panels/assets/material-grid";
import { tileActivation } from "@/components/editor/panels/assets/tile-activation";
import { FxBrowser } from "@/effects/components/fx-browser";
import { useEditor } from "@/editor/use-editor";
import { useT } from "@/i18n";
import { ru } from "@/i18n/ru";
import { cn } from "@/utils/ui";
import { insertMograph } from "../mograph-insert";
import { mographGeneratorFamily } from "@/generators/library";
import { MOGRAPH_CATEGORIES, MOGRAPH_KINDS, MOGRAPH_THEMES, type MographKind, type Theme, themeName, themePhoto } from "../mograph";

const MographPreview = dynamic(() => import("./mograph-preview"), { ssr: false });

export function MographTile({ kind, theme }: { kind: MographKind; theme?: Theme }) {
	const editor = useEditor();
	const t = useT();
	const [hover, setHover] = useState(false);
	// At rest the tile is its prebuilt still (public/mograph/tiles, scripts/mograph-tiles.mjs) over the theme photo; the
	// live preview is built only under the pointer, once the list is still.
	// A graphic with a picture slot shows the theme's photo in it: under another theme's filter its still (made on its
	// first theme) would not match, so it is drawn live once the list is still.
	const stillFits = !theme || theme === kind.themes[0] || !(kind.images ?? []).some((i) => i.key !== "logo");
	const live = useWhenStill(hover || !stillFits);
	const add = () => insertMograph(editor, kind);
	return (
		// the whole tile is content (its live preview shows the graphic's sample words): the Russian scan skips it
		<div className="group relative" data-no-translate>
			<button
				type="button"
				data-mograph={kind.kind}
				title={t(kind.label)}
				aria-label={t(kind.label)}
				{...tileActivation(add)}
				data-no-translate
				draggable
				onDragStart={(event) =>
					editor.timeline.dragSource.begin({
						dataTransfer: event.dataTransfer,
						dragData: { id: kind.kind, type: "deferred", name: kind.label, elementType: "graphic", dur: kind.dur, place: async (start, hint) => insertMograph(editor, kind, start, hint) },
					})
				}
				onDragEnd={() => editor.timeline.dragSource.end()}
				onPointerEnter={() => setHover(true)}
				onPointerLeave={() => setHover(false)}
				onFocus={() => setHover(true)}
				onBlur={() => setHover(false)}
				className="flex w-full flex-col gap-1 text-left"
			>
				<div className={`pointer-events-none relative bg-neutral-800 ${TILE_THUMB}`} style={{ background: `#14161c url(${themePhoto(theme ?? kind.themes[0])}) center / cover` }}>
					{live ? (
						<MographPreview kind={kind} playing={hover} theme={theme} />
					) : (
						// biome-ignore lint/performance/noImgElement: a small transparent still the app ships (public/mograph/tiles); nothing for next/image to do
						<img src={`/mograph/tiles/${kind.kind}.webp`} alt="" loading="lazy" decoding="async" draggable={false} className="absolute inset-0 size-full" />
					)}
				</div>
				<span className={TILE_LABEL}>{t(kind.label)}</span>
			</button>
			<TileAddButton onAdd={add} />
		</div>
	);
}

/** The theme filter: «All themes» and one chip per theme (Motion graphics and Templates). */
export function ThemeChips({ theme, onTheme }: { theme: Theme | null; onTheme: (theme: Theme | null) => void }) {
	const t = useT();
	const chip = (value: Theme | null, label: string) => (
		<button
			key={value ?? "all"}
			type="button"
			data-mograph-theme={value ?? "all"}
			aria-pressed={theme === value}
			onClick={() => onTheme(value)}
			className={cn("shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors", theme === value ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
		>
			{label}
		</button>
	);
	return (
		// One row that scrolls (the wheel scrolls it sideways) and fades at its right edge: a chip was cut in half there.
		// The row is a plain div inside the fieldset (a fieldset as the scroller grew to its chips' width, so the fade
		// fell outside the panel: design review 05.11), and its end padding lets the last chip scroll clear of the fade.
		<fieldset className="m-0 w-full min-w-0 border-0 p-0">
			<legend className="sr-only">{t("Themes")}</legend>
			<div
				className="scrollbar-hidden flex w-full min-w-0 gap-1.5 overflow-x-auto pt-0 pr-10 pb-2 pl-3"
				style={{ maskImage: "linear-gradient(to right, black calc(100% - 40px), transparent)", WebkitMaskImage: "linear-gradient(to right, black calc(100% - 40px), transparent)" }}
				onWheel={(event) => {
					if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY;
				}}
			>
				{chip(null, t("All themes"))}
				{MOGRAPH_THEMES.map((th) => chip(th, t(themeName(th))))}
			</div>
		</fieldset>
	);
}

export function MographBrowser() {
	const t = useT();
	// no theme chips (polish3 D, 13.11): they said again what the category column says («Новости», «Еда», «Путешествия»)
	const [theme] = useState<Theme | null>(null);
	// his edition has no stickers under any name (the owner, 12–13.11): the «Stickers» category of the animated graphics
	// goes with the sticker packs (src/edition/cuts.ts); templates and old projects still play them
	// what the Generators tab lists (camera and tape, particles, light, grain — generators/library.ts) lives THERE: nothing
	// is offered in two places
	const offered = MOGRAPH_KINDS.filter((k) => !k.hidden && (EDITION.stickers || k.category !== "Stickers") && !mographGeneratorFamily(k.kind));
	const items = theme ? offered.filter((k) => k.themes.includes(theme)) : offered;
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<FxBrowser
				groupLabel="Motion"
				items={items}
				getKey={(k) => k.kind}
				getName={(k) => t(k.label)}
				getCategory={(k) => k.category}
				getKeywords={(k) => [k.label, ru(k.label), k.category, ru(k.category), ...k.themes, ...k.fields.filter((f) => f.type === "text").map((f) => String(f.default))]}
				categoryOrder={[...MOGRAPH_CATEGORIES]}
				placeholder={t("Search motion graphics")}
				renderTile={(k) => <MographTile kind={k} theme={theme ?? undefined} />}
			/>
		</div>
	);
}
