"use client";

import { Chip, ChipRow } from "@/components/ui/chips";
import { MATERIAL_TILE, materialGrid } from "@/components/editor/panels/assets/material-grid";
import { useWindowedGrid } from "@/components/editor/panels/assets/windowed-grid";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DraggableItem } from "@/components/editor/panels/assets/draggable-item";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useEditor } from "@/editor/use-editor";
import { resolveStickerIntrinsicSize } from "@/stickers";
import {
	buildGraphicElement,
	buildStickerElement,
} from "@/timeline/element-utils";
import { STICKER_CATEGORIES } from "@/stickers/categories";
import { GraphicsSection } from "./graphics-section";
import { ShapesSection } from "./shapes-section";
import { parseShapeStickerId } from "@/stickers/providers/shapes";
import type { TimelineDragData } from "@/timeline/drag";
import type {
	StickerBrowseSection,
	StickerCategory,
	StickerItem as StickerData,
} from "@/stickers";
import { useStickersStore } from "@/stickers/stickers-store";
import { cn } from "@/utils/ui";
import { MaterialsLayout, type NavItem } from "@/components/editor/panels/assets/materials-nav";
import {
	HappyIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { useT } from "@/i18n";
import { EDITION } from "@/edition/cuts";

// (the owner's own edition has no sticker packs — src/edition/cuts.ts: Shapes only)
const STICKER_NAV: NavItem[] = [
	...(EDITION.stickers
		? [
				{ key: "animated", label: "Animated" },
				{ key: "emoji3d", label: "3D" },
				{ key: "graphics", label: "Graphics" },
			]
		: []),
	{ key: "shapes", label: "Shapes" },
];

/** Stickers: Animated (Noto, by group), 3D (Fluent), Graphics (animated arrows, callouts, badges) and Shapes (hand-made
 * layers: rectangle, rounded, ellipse, line…) — single things you add on top of the video. */
export function StickersView() {
	return (
		<MaterialsLayout
			// no longer a tab (the owner, 12.11); kept for its sections' code (Shapes is Text's now)
			tab="text"
			items={STICKER_NAV}
			render={(section) =>
				!EDITION.stickers || section === "shapes" ? (
					<ShapesSection />
				) : section === "animated" ? (
					<div className="min-h-0 flex-1 overflow-y-auto px-2 pt-2">
						<GraphicsSection kind="animated" />
					</div>
				) : section === "graphics" ? (
					<div className="min-h-0 flex-1 overflow-y-auto px-2 pt-2" data-stickers-graphics>
						<GraphicsSection kind="motion" />
					</div>
				) : section === "shapes" ? (
					<ShapesSection />
				) : (
					<StickersColumnSection category="emoji3d" />
				)
			}
		/>
	);
}

/** The registry's shapes as sticker tiles (kept for older callers; Stickers → Shapes is the place now). */
export function ShapesBrowser() {
	return <StickersColumnSection category="shapes" />;
}

function StickersColumnSection({ category }: { category: StickerCategory }) {
	const selected = useStickersStore((s) => s.selectedCategory);
	const setSelectedCategory = useStickersStore((s) => s.setSelectedCategory);
	useEffect(() => {
		if (selected !== category) setSelectedCategory({ category });
	}, [category, selected, setSelectedCategory]);
	return <StickersBrowser />;
}

function StickersBrowser() {
	const {
		browseContent,
		browseStickers,
		searchQuery,
		searchStickers,
		setSearchQuery,
		viewMode,
	} = useStickersStore();

	useEffect(() => {
		if (viewMode === "browse" && !browseContent) {
			void browseStickers();
		}
	}, [browseContent, browseStickers, viewMode]);

	return (
		<div className="flex h-full flex-col">
			<div className="px-2 pt-2">
				<Input
					size="sm"
					variant="default"
					placeholder="Search"
					value={searchQuery}
					onChange={(e) => {
						setSearchQuery({ query: e.target.value });
						void searchStickers({ query: e.target.value });
					}}
					showClearIcon
					onClear={() => {
						setSearchQuery({ query: "" });
						void searchStickers({ query: "" });
					}}
					className="w-full"
					containerClassName="w-full"
				/>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-2 pt-3">
				<StickersContentView />
			</div>
		</div>
	);
}

function StickerGrid({
	items,
	shouldCapSize = false,
}: {
	items: StickerData[];
	shouldCapSize?: boolean;
}) {
	// a group of 3D emoji is up to 320 tiles: only the rows on screen are in the page
	const grid = useRef<HTMLDivElement>(null);
	const win = useWindowedGrid(grid, items.length);
	return (
		<div ref={grid} style={{ ...materialGrid(), ...win.style }} data-material-grid data-grid-window={`${win.from}-${win.to}/${items.length}`}>
			{items.slice(win.from, win.to).map((item) => (
				<StickerItem key={item.id} item={item} shouldCapSize={shouldCapSize} />
			))}
		</div>
	);
}

function StickerRow({ items }: { items: StickerData[] }) {
	return (
		<div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hidden">
			{items.map((item) => (
				<div key={item.id} className="shrink-0" style={{ width: MATERIAL_TILE }}>
					<StickerItem item={item} shouldCapSize containerClassName="w-full" />
				</div>
			))}
		</div>
	);
}

function EmptyView({ message }: { message: string }) {
	return (
		<div className="bg-background flex h-full flex-col items-center justify-center gap-3 p-4">
			<HugeiconsIcon
				icon={HappyIcon}
				className="text-muted-foreground size-10"
			/>
			<div className="flex flex-col gap-2 text-center">
				<p className="text-lg font-medium">No stickers found</p>
				<p className="text-muted-foreground text-sm text-balance">{message}</p>
			</div>
		</div>
	);
}

function StickersContentView() {
	const t = useT();
	const [group, setGroup] = useState<string | null>(null);
	const {
		browseContent,
		clearRecentStickers,
		isBrowsing,
		isSearching,
		searchQuery,
		searchResults,
		selectedCategory,
		setSelectedCategory,
		viewMode,
	} = useStickersStore();

	if (viewMode === "search") {
		if (isSearching) {
			return (
				<div className="flex items-center justify-center py-8">
					<Spinner className="text-muted-foreground size-6" />
				</div>
			);
		}

		if (searchResults?.items.length) {
			return (
				<div className="flex flex-col gap-3 pb-4">
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">
							{t("{n} results", { n: searchResults.total })}
						</span>
					</div>
					<StickerGrid items={searchResults.items} />
				</div>
			);
		}

		// "all" tab search — sections are in browseContent, fall through to section rendering below
		if (selectedCategory !== "all" && searchQuery) {
			return <EmptyView message={`No stickers found for "${searchQuery}"`} />;
		}
	}

	if (isBrowsing && !browseContent) {
		return (
			<div className="flex items-center justify-center py-8">
				<Spinner className="text-muted-foreground size-6" />
			</div>
		);
	}

	if (!browseContent?.sections.length) {
		const categoryLabel = STICKER_CATEGORIES[selectedCategory];
		return (
			<EmptyView
				message={
					viewMode === "search"
						? `No stickers found for "${searchQuery}"`
						: selectedCategory === "all"
							? "No stickers available yet."
							: `No stickers available in ${categoryLabel.toLowerCase()} yet.`
				}
			/>
		);
	}

	// Big sets (Fluent 3D: 1595 in 14 groups) show one group at a time under a row of chips, so the page holds a few
	// hundred tiles, not all of them; rows (Recent) stay above. Search still looks through everything.
	const rows = browseContent.sections.filter((section) => section.layout === "row");
	const grids = browseContent.sections.filter((section) => section.layout !== "row");
	const chosen = grids.find((section) => section.id === group) ?? grids[0];
	const sections = grids.length > 1 ? [...rows, ...(chosen ? [{ ...chosen, title: undefined }] : [])] : browseContent.sections;
	return (
		<div className="flex flex-col gap-4 pb-4">
			{grids.length > 1 && (
				<ChipRow aria-label="Sticker groups">
					{grids.map((section) => (
						<Chip key={section.id} active={section.id === chosen?.id} onClick={() => setGroup(section.id)} data-sticker-group={section.id}>
							{section.title}
						</Chip>
					))}
				</ChipRow>
			)}
			{sections.map((section) => (
				<StickerSection
					key={section.id}
					section={section}
					onClearRecent={clearRecentStickers}
					onSeeAll={(category) => {
						setSelectedCategory({ category });
					}}
				/>
			))}
		</div>
	);
}

function StickerSection({
	section,
	onClearRecent,
	onSeeAll,
}: {
	section: StickerBrowseSection;
	onClearRecent: () => void;
	onSeeAll: (category: StickerCategory) => void;
}) {
	const hasHeader =
		Boolean(section.title) || section.id === "recent" || section.action;

	return (
		<div className="flex flex-col gap-2">
			{hasHeader && (
				<div className="flex items-center justify-between gap-2">
					{section.title ? (
						<p className="text-xs text-muted-foreground">{section.title}</p>
					) : (
						<div />
					)}

					<div className="ml-auto flex items-center gap-2">
						{section.id === "recent" && (
							<Button
								onClick={onClearRecent}
								variant="text"
								size="sm"
								className="h-auto gap-1 p-0 text-xs text-muted-foreground"
							>
								Clear
							</Button>
						)}

						{section.action?.type === "see-all" && section.action.category && (
							<Button
								variant="text"
								size="sm"
								className="h-auto gap-1 p-0 text-xs text-primary"
								onClick={() => {
									onSeeAll(section.action?.category as StickerCategory);
								}}
							>
								See all
							</Button>
						)}
					</div>
				</div>
			)}

			{section.layout === "row" ? (
				<StickerRow items={section.items} />
			) : (
				<StickerGrid items={section.items} />
			)}
		</div>
	);
}

interface StickerItemProps {
	item: StickerData;
	shouldCapSize?: boolean;
	containerClassName?: string;
}

function StickerItem({
	item,
	shouldCapSize = false,
	containerClassName,
}: StickerItemProps) {
	const editor = useEditor();
	const { addToRecentStickers } = useStickersStore();
	const [isAdding, setIsAdding] = useState(false);
	const [hasImageError, setHasImageError] = useState(false);

	useEffect(() => {
		if (!item.id) {
			return;
		}

		setHasImageError(false);
	}, [item.id]);

	const displayName = item.name;
	const shapePreset =
		item.provider === "shapes" ? parseShapeStickerId({ stickerId: item.id }) : null;

	const handleAdd = async () => {
		setIsAdding(true);
		try {
			const currentTime = editor.playback.getCurrentTime();

			let element:
				| ReturnType<typeof buildGraphicElement>
				| ReturnType<typeof buildStickerElement>;
			if (shapePreset) {
				element = buildGraphicElement({
					definitionId: shapePreset.definitionId,
					name: shapePreset.name,
					startTime: currentTime,
					params: shapePreset.params,
				});
			} else {
				const { width: intrinsicWidth, height: intrinsicHeight } =
					await resolveStickerIntrinsicSize({ stickerId: item.id });
				element = buildStickerElement({
					stickerId: item.id,
					name: item.name,
					startTime: currentTime,
					intrinsicWidth,
					intrinsicHeight,
				});
				// Emoji land as a reaction-sized sticker (about a third of the frame), not full width.
				if (item.provider === "emoji") {
					element = {
						...element,
						params: { ...element.params, "transform.scaleX": 0.35, "transform.scaleY": 0.35 },
					};
				}
			}

			editor.timeline.insertElement({
				placement: { mode: "auto" },
				element,
			});

			addToRecentStickers({ stickerId: item.id });
		} catch (error) {
			console.error("Failed to add sticker:", error);
			toast.error("Failed to add sticker to timeline");
		} finally {
			setIsAdding(false);
		}
	};

	const preview = (
		<div className="flex size-full items-center justify-center p-3">
			{hasImageError ? (
				<span className="text-muted-foreground text-center text-xs break-all">
					{displayName}
				</span>
			) : (
				<Image
					src={item.previewUrl}
					alt={displayName}
					width={64}
					height={64}
					className="size-full object-contain"
					style={
						shouldCapSize
							? {
									maxWidth: "var(--sticker-max, 160px)",
									maxHeight: "var(--sticker-max, 160px)",
								}
							: undefined
					}
					onError={() => setHasImageError(true)}
					loading="lazy"
					unoptimized
				/>
			)}
		</div>
	);

	const dragData: TimelineDragData = shapePreset
		? {
				id: item.id,
				type: "graphic",
				name: displayName,
				definitionId: shapePreset.definitionId,
				params: shapePreset.params ?? {},
			}
		: {
				id: item.id,
				type: "sticker",
				name: displayName,
				stickerId: item.id,
			};

	return (
		<div
			className={cn("relative", isAdding && "pointer-events-none opacity-50")}
		>
			<DraggableItem
				name={displayName}
				preview={preview}
				dragData={dragData}
				onAddToTimeline={handleAdd}
				aspectRatio={1}
				shouldShowLabel={false}
				isRounded
				variant="card"
				containerClassName={containerClassName ?? "w-full"}
			/>
			{isAdding && (
				<div className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-black/60">
					<Spinner className="size-6 text-white" />
				</div>
			)}
		</div>
	);
}
