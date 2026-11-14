"use client";

import { MATERIAL_TILE, materialGrid } from "@/components/editor/panels/assets/material-grid";
import { HugeiconsIcon } from "@/components/ui/icon";
import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useT } from "@/i18n";
import { cn } from "@/utils/ui";

/** Tiles mounted in the first frame, then this many more a frame: Effects' hundreds at once were a 65 ms task, 60 still ~70 ms. */
const TILES_PER_FRAME = 24;

/**
 * The height the sticky category column may take: the visible height of the panel's scroll area. A column taller than
 * that (16 categories in Effects, a 450 px panel at 1440×900) sticks to the top and never scrolls with the tiles, so its
 * last categories were out of reach (B1, 05.11). Given a max height it scrolls inside itself instead.
 */
function useStickyMaxHeight(ref: React.RefObject<HTMLElement | null>): number | undefined {
	const [max, setMax] = useState<number>();
	useEffect(() => {
		const nav = ref.current;
		if (!nav) return;
		let scroller: HTMLElement | null = nav.parentElement;
		while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
		if (!scroller) return;
		const area = scroller;
		// From the column's own top to the area's bottom: with something above it (Filters at 1024×640) the column began
		// lower than the area's top, so a column as tall as the whole area ran past the window and its last category could
		// not be scrolled into view (panels-walk 09.11). Sticky, it climbs as the area scrolls: measured again then.
		let frame = 0;
		const measure = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const style = getComputedStyle(area);
				const box = area.getBoundingClientRect();
				const top = Math.max(nav.getBoundingClientRect().top, box.top + parseFloat(style.paddingTop));
				setMax(Math.max(96, Math.floor(box.bottom - parseFloat(style.paddingBottom) - top)));
			});
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(area);
		area.addEventListener("scroll", measure, { passive: true });
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
			area.removeEventListener("scroll", measure);
		};
	}, [ref]);
	return max;
}

/**
 * A tile library as in CapCut's materials panel (Effects, Transitions, Filters, Templates): the categories down the
 * left, search and the grid on the right. «All» shows every group, one after the other (the column names them); a
 * category shows only its tiles. `flat`: no column (a short list needs no categories).
 * Filtering is in-memory; tiles render their thumbnails lazily.
 */
export function FxBrowser<T>({
	items,
	getKey,
	getName,
	getCategory,
	getKeywords,
	categoryOrder,
	renderTile,
	renderGroupFooter,
	placeholder,
	tile = MATERIAL_TILE,
	flat = false,
}: {
	items: T[];
	getKey: (item: T) => string;
	getName: (item: T) => string;
	getCategory: (item: T) => string;
	getKeywords?: (item: T) => string[];
	categoryOrder?: string[];
	renderTile: (item: T) => ReactNode;
	/** Shown under a group's tiles (e.g. the settings of the AI tile that is open). */
	renderGroupFooter?: (category: string) => ReactNode;
	placeholder: string;
	/** Narrowest tile, px. */
	tile?: number;
	/** Was CapCut's group over the categories («Transitions ▴»); not drawn since polish3 D (the tab's switch names it). */
	groupLabel?: string;
	/** No category column: every tile in one grid. */
	flat?: boolean;
}) {
	const t = useT();
	const [query, setQuery] = useState("");
	const [category, setCategory] = useState<string>("All");
	const q = query.trim();

	const categories = useMemo(() => {
		const seen = [...new Set(items.map(getCategory))];
		const order = categoryOrder ?? [];
		return seen.sort((a, b) => {
			const ia = order.indexOf(a);
			const ib = order.indexOf(b);
			return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
		});
	}, [items, getCategory, categoryOrder]);

	const groups = useMemo(() => {
		const lower = q.toLowerCase();
		const match = (item: T) =>
			!lower ||
			getName(item).toLowerCase().includes(lower) ||
			getCategory(item).toLowerCase().includes(lower) ||
			(getKeywords?.(item) ?? []).some((k) => k.toLowerCase().includes(lower));
		const visible = items.filter((item) => (category === "All" || getCategory(item) === category) && match(item));
		return categories
			.map((name) => [name, visible.filter((item) => getCategory(item) === name)] as const)
			.filter(([, list]) => list.length > 0);
	}, [items, q, category, categories, getName, getCategory, getKeywords]);

	const total = groups.reduce((n, [, list]) => n + list.length, 0);
	const [shown, setShown] = useState(TILES_PER_FRAME);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new category or search starts from the first frame again
	useEffect(() => setShown(TILES_PER_FRAME), [q, category]);
	useEffect(() => {
		if (shown >= total) return;
		const frame = requestAnimationFrame(() => setShown((n) => n + TILES_PER_FRAME));
		return () => cancelAnimationFrame(frame);
	}, [shown, total]);
	let index = 0;
	const navRef = useRef<HTMLElement>(null);
	const navMax = useStickyMaxHeight(navRef);

	return (
		<div className="flex min-h-full gap-2" data-fx-browser>
			<nav
				ref={navRef}
				hidden={flat}
				aria-label="Categories"
				data-fx-categories
				style={navMax ? { maxHeight: navMax } : undefined}
				className="scrollbar-hidden sticky top-0 flex w-[7.25rem] shrink-0 flex-col gap-0.5 self-start overflow-y-auto overscroll-contain pt-0.5"
			>
				{/* no group header (polish3 D, 13.11): the tab's switch above already names the group — «Переходы» twice */}
				{!flat && ["All", ...categories].map((name) => (
					<button
						key={name}
						type="button"
						data-fx-category={name}
						aria-pressed={category === name}
						onClick={() => setCategory(name)}
						className={cn(
							// shrink-0: in a column shorter than its list a truncating row shrank to half its height, the text cut (user, 08.11)
							"shrink-0 truncate rounded-md px-2 py-1.5 text-left text-xs transition-colors",
							category === name ? "bg-foreground/[0.08] text-primary font-medium" : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]",
						)}
						title={t(name)}
					>
						{t(name)}
					</button>
				))}
			</nav>
			<div className="flex min-w-0 flex-1 flex-col gap-2">
				{/* Sticks over the panel's top padding too: tiles never show above the search while scrolling. */}
				<div className="bg-background sticky -top-2 z-10 -mt-2 pt-2 pb-1">
					<div className="relative">
						<HugeiconsIcon icon={Search01Icon} className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
						<input
							type="search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Escape" && query) {
									event.stopPropagation();
									setQuery("");
								}
							}}
							placeholder={placeholder}
							aria-label={placeholder}
							className="bg-foreground/[0.07] placeholder:text-muted-foreground h-8 w-full rounded-[10px] pr-7 pl-8 text-xs outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] [&::-webkit-search-cancel-button]:hidden"
						/>
						{query && (
							<button
								type="button"
								aria-label={t("Clear search")}
								onClick={() => setQuery("")}
								className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded-full"
							>
								<HugeiconsIcon icon={Cancel01Icon} className="size-3" />
							</button>
						)}
					</div>
				</div>
				{total === 0 && (
					<div className="text-muted-foreground flex flex-col items-center gap-1.5 px-1 py-6 text-center text-xs">
						<p>{t("Nothing found")}</p>
						{q && (
							<button type="button" onClick={() => setQuery("")} className="text-foreground/80 hover:text-foreground hover:underline">
								{t("Clear search")}
							</button>
						)}
					</div>
				)}
				{groups.map(([name, list]) => (
					<section key={name} className="pb-2">
						{/* no heading per category: the column on the left names them (polish3 D, 13.11: said once) */}
						<div style={materialGrid(tile)} data-material-grid>
							{list.map((item) => {
								// a tile not mounted yet keeps its square, so the list does not grow under the pointer
								const ready = index++ < shown;
								return (
									<div key={getKey(item)} style={ready ? undefined : { height: tile }}>
										{ready ? renderTile(item) : null}
									</div>
								);
							})}
						</div>
						{renderGroupFooter?.(name)}
					</section>
				))}
			</div>
		</div>
	);
}
