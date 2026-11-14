"use client";

import { materialGrid } from "@/components/editor/panels/assets/material-grid";
import { DEMO } from "@/demo/flag";
import { type MediaRow, PendingMediaTile, SETTLE_CLASS, landingAssetIds, usePendingMedia, withPending } from "@/jobs/components/pending-media";
import { type Job, jobCenter } from "@/jobs/store";
import { generateUUID } from "@/utils/id";
import Image from "next/image";
import { CONVERTIBLE_ACCEPT } from "@/media/convert";
import { useEffect, useMemo, useRef, useState } from "react";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { MediaDragOverlay } from "@/components/editor/panels/assets/drag-overlay";
import { DraggableItem } from "@/components/editor/panels/assets/draggable-item";
import { Button } from "@/components/ui/button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuShortcut,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useEditor } from "@/editor/use-editor";
import { useFileUpload } from "@/media/use-file-upload";
import { invokeAction } from "@/actions";
import { processMediaAssets } from "@/media/processing";
import { splitKnownFiles } from "./known-files";
import {
	SelectableItem,
	SelectableSurface,
	useSelection,
	useSelectionScope,
} from "@/selection";
import {
	type MediaSortKey,
	type MediaSortOrder,
	type MediaViewMode,
	useAssetsPanelStore,
} from "@/components/editor/panels/assets/assets-panel-store";
import { MASKABLE_ELEMENT_TYPES } from "@/timeline";
import type { MediaAsset } from "@/media/types";
import { cn } from "@/utils/ui";
import { placeFirstVideoIfEmpty, useImportedSelection } from "./auto-place";
import { isAppliedToolResult } from "./origin";
import { WebImages } from "./web-images";
import { MediaCompounds, useMediaCompoundCount } from "./media-compounds";
import { insertMediaIntoRow } from "../source/source-monitor";
import { mediaDelete, SOURCE_SCOPE_ATTR, useSourceStore } from "../source/source-store";
import { AudioTileWaveform, HoverScrubVideo, MarksBar } from "../source/tile-media";
import { smartFilter } from "@/search/smart";
import { Input } from "@/components/ui/input";

/** Extra words so "photo", "music" or "фото" find media by kind. */
const KIND_WORDS: Record<string, string> = {
	image: "image photo picture",
	video: "video clip footage",
	audio: "audio sound music voice",
};
import { useStudioStore } from "@/studio/client/studio-store";
import {
	CloudUploadIcon,
	GridViewIcon,
	LeftToRightListDashIcon,
	SortingOneNineIcon,
	AiImageIcon,
	AiVideoIcon,
	Image02Icon,
	MusicNote01Icon,
	Video01Icon,
	YoutubeIcon,
	Search01Icon,
	Add01Icon,
	PlayIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@/components/ui/icon";
import { useT } from "@/i18n";
import { isTileEnter } from "@/keyboard/navigation";

export function MediaView() {
	const t = useT();
	const editor = useEditor();
	const mediaFiles = useEditor((e) => e.media.getAssets());
	// Only the id: the project object changes on every timeline edit.
	const activeProjectId = useEditor((e) => e.project.getActive()?.metadata.id);

	const {
		mediaViewMode,
		setMediaViewMode,
		highlightMediaId,
		clearHighlight,
		mediaSortBy,
		mediaSortOrder,
		setMediaSort,
	} = useAssetsPanelStore();

	const [isProcessing, setIsProcessing] = useState(false);
	const [progress, setProgress] = useState(0);

	const processFiles = async ({ files: picked }: { files: File[] }) => {
		if (!picked || picked.length === 0) return;
		if (!activeProjectId) {
			toast.error("No active project");
			return;
		}
		// A file that is already in Media is shown, not added a second time.
		const { fresh: files, known } = splitKnownFiles({
			files: picked,
			assets: editor.media.getAssets(),
			originalSizeOf: (id) => editor.media.getEditingOriginal(id)?.file.size,
		});
		if (known.length > 0) {
			useAssetsPanelStore.getState().requestRevealMedia(known[0].assetId);
			toast(known.length === 1 ? `${known[0].file.name} is already in Media` : `${known.length} files are already in Media`);
		}
		if (files.length === 0) return;

		setIsProcessing(true);
		setProgress(0);
		// Each file is in Media at once (grey, its picture when it is one), and lands in its place when it has been read:
		// no toast, the items themselves show it (the owner, 13.11).
		const slots = files.map((file) => {
			const assetId = generateUUID();
			const type: "video" | "image" | "audio" = file.type.startsWith("image/") ? "image" : file.type.startsWith("audio/") ? "audio" : "video";
			const still = type === "image" ? URL.createObjectURL(file) : undefined;
			const jobId = jobCenter.start({
				kind: "other",
				title: file.name,
				tab: "media",
				place: { media: { assetId, projectId: activeProjectId, name: file.name, type, origin: "source", still } },
			});
			return { file, assetId, jobId, still };
		});
		try {
			const added = [];
			let done = 0;
			for (const slot of slots) {
				try {
					const [asset] = await processMediaAssets({
						files: [slot.file],
						job: slot.jobId,
						onProgress: ({ progress }: { progress: number }) => setProgress(Math.round(((done + progress / 100) / slots.length) * 100)),
					});
					const landed = asset
						? await editor.media.addMediaAsset({ projectId: activeProjectId, asset: { ...asset, origin: "source", id: slot.assetId } })
						: null;
					// Not read (unsupported, damaged — processMediaAssets said why) or no room: the item goes.
					if (landed) jobCenter.finish(slot.jobId);
					else jobCenter.remove(slot.jobId);
					added.push(landed);
				} catch (error) {
					console.error("Error processing files:", error);
					jobCenter.remove(slot.jobId);
				} finally {
					if (slot.still) setTimeout(() => URL.revokeObjectURL(slot.still as string), 2000);
					done++;
				}
			}
			placeFirstVideoIfEmpty(editor, added);
			// shown as new in Media for a moment, NOT selected (place D)
			useImportedSelection.getState().set(added.flatMap((asset) => (asset ? [asset.id] : [])));
		} finally {
			setIsProcessing(false);
			setProgress(0);
		}
	};

	const importedPick = useImportedSelection((state) => state.pick);
	const { isDragOver, dragProps, openFilePicker, fileInputProps } =
		useFileUpload({
			accept: `image/*,video/*,audio/*,${CONVERTIBLE_ACCEPT}`,
			multiple: true,
			onFilesSelected: (files) => processFiles({ files }),
		});

	// Media the timeline uses asks first (CapCut): its clips go with it. Unused media goes at once. ⌘Z brings either back.
	const [pendingRemove, setPendingRemove] = useState<{ ids: string[]; uses: number } | null>(null);
	const removeNow = (ids: string[]) => invokeAction("remove-media-assets", { projectId: activeProjectId, assetIds: ids });
	const handleRemove = ({
		event,
		ids,
	}: {
		event: React.MouseEvent;
		ids: string[];
	}) => {
		event.stopPropagation();
		requestRemove(ids);
	};
	/** The tile menu's «Delete» and the ⌫ / Delete key (source-store.ts deleteSelectedMedia). */
	const requestRemove = (ids: string[]) => {
		const wanted = new Set(ids);
		const uses = editor.scenes
			.getScenes()
			.flatMap((scene) => [scene.tracks.main, ...scene.tracks.overlay, ...scene.tracks.audio])
			.flatMap((track) => track.elements as Array<{ mediaId?: string }>)
			.filter((element) => element.mediaId && wanted.has(element.mediaId)).length;
		if (uses > 0) setPendingRemove({ ids, uses });
		else removeNow(ids);
	};

	const handleSort = ({ key }: { key: MediaSortKey }) => {
		if (mediaSortBy === key) {
			setMediaSort({
				key,
				order: mediaSortOrder === "asc" ? "desc" : "asc",
			});
		} else {
			setMediaSort({ key, order: "asc" });
		}
	};

	const filteredMediaItems = useMemo(() => {
		// (a tool applied from the inspector is the clip's effect: its processed copy is not listed — origin.ts)
		const filtered = mediaFiles.filter((item) => !item.ephemeral && !isAppliedToolResult(item));

		filtered.sort((a, b) => {
			let valueA: string | number;
			let valueB: string | number;

			switch (mediaSortBy) {
				case "name":
					valueA = a.name.toLowerCase();
					valueB = b.name.toLowerCase();
					break;
				case "type":
					valueA = a.type;
					valueB = b.type;
					break;
				case "duration":
					valueA = a.duration || 0;
					valueB = b.duration || 0;
					break;
				case "size":
					valueA = a.file.size;
					valueB = b.file.size;
					break;
				default:
					return 0;
			}

			if (valueA < valueB) return mediaSortOrder === "asc" ? -1 : 1;
			if (valueA > valueB) return mediaSortOrder === "asc" ? 1 : -1;
			return 0;
		});

		return filtered;
	}, [mediaFiles, mediaSortBy, mediaSortOrder]);
	const [query, setQuery] = useState("");
	const compoundCount = useMediaCompoundCount();
	const searching = query.trim().length > 0;
	// "Web" in the header: the same search box, aimed at images on the web.
	const [webMode, setWebMode] = useState(false);
	const searchRef = useRef<HTMLInputElement>(null);
	// Smart search (typos, RU↔EN layout, translit) over names and kinds.
	const visibleMediaItems = useMemo(
		() =>
			searching
				? smartFilter({ items: filteredMediaItems, query, fields: (item) => [item.name, KIND_WORDS[item.type] ?? item.type] })
				: filteredMediaItems,
		[filteredMediaItems, query, searching],
	);
	// (a generated picture, a lipsync take, a YouTube piece) are all media, in the order the user sorts by.
	// Reversed / smooth-motion files are internal copies of a clip's media (src/motion): not listed.
	const items = useMemo(() => visibleMediaItems.filter((item) => !item.motionProxy), [visibleMediaItems]);
	const orderedMediaIds = useMemo(() => items.map((item) => item.id), [items]);
	// Items on their way (a YouTube piece, a web picture, a file being read): there already, where they will land.
	const assetIds = useMemo(() => new Set(mediaFiles.map((a) => a.id)), [mediaFiles]);
	const pending = usePendingMedia(activeProjectId, assetIds);
	const landing = landingAssetIds();

	return (
		<>
			<input {...fileInputProps} />
			<AlertDialog open={!!pendingRemove} onOpenChange={(open) => !open && setPendingRemove(null)}>
				<AlertDialogContent data-media-delete-confirm="">
					<AlertDialogHeader>
						<AlertDialogTitle>{t("Delete media used on the timeline?")}</AlertDialogTitle>
						<AlertDialogDescription>
							{(pendingRemove?.uses ?? 0) === 1
								? t("A clip on the timeline uses it. It goes too. ⌘Z brings everything back.")
								: t("{n} clips on the timeline use it. They go too. ⌘Z brings everything back.", { n: pendingRemove?.uses ?? 0 })}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
						<AlertDialogAction
							data-media-delete-go=""
							onClick={() => {
								if (pendingRemove) removeNow(pendingRemove.ids);
								setPendingRemove(null);
							}}
						>
							{t("Delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Media input: right-click anywhere in Media for every way to add media. */}
			<ContextMenu>
				<ContextMenuTrigger asChild>
					{/* Source scope: with the focus here, Space / J K L / I O act on the source preview. */}
					<div className="group/source h-full" {...{ [SOURCE_SCOPE_ATTR]: "" }}>
			<PanelView
				title="Media"
				headerContent={
					<div className="relative w-full">
						<HugeiconsIcon icon={Search01Icon} className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2" />
						<Input
							ref={searchRef}
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							onKeyDown={(e) => {
								if (e.key !== "Escape") return;
								setQuery("");
								setWebMode(false);
							}}
							onBlur={() => !query.trim() && setWebMode(false)}
							placeholder={webMode ? "Search the web" : "Search"}
							aria-label="Search media and web images"
							className="h-7 pl-8 text-xs"
							data-testid="media-search"
						/>
					</div>
				}
				actions={
					<MediaActions
						mediaViewMode={mediaViewMode}
						setMediaViewMode={setMediaViewMode}
						isProcessing={isProcessing}
						sortBy={mediaSortBy}
						sortOrder={mediaSortOrder}
						onSort={handleSort}
						onImport={openFilePicker}
						onWeb={() => {
							setWebMode(true);
							searchRef.current?.focus();
						}}
					/>
				}
				className={cn(isDragOver && "bg-accent/30")}
				contentClassName="h-full"
				{...dragProps}
			>
				<div className="flex h-full flex-col gap-3">
          {!searching && (isDragOver || (filteredMediaItems.length === 0 && pending.length === 0 && compoundCount === 0)) ? (
						<div className="min-h-0 flex-1">
							<MediaDragOverlay
								isVisible={true}
								isProcessing={isProcessing}
								progress={progress}
								isDragOver={isDragOver}
								onClick={openFilePicker}
							/>
						</div>
					) : (
						<SelectableSurface
							ariaLabel="Media"
							orderedIds={orderedMediaIds}
							revealId={highlightMediaId}
							newIds={importedPick}
							onRevealComplete={clearHighlight}
						>
							<MediaScopeRegistrar />
							<MediaDeleteKey onRemove={requestRemove} />
							<div className="flex flex-col gap-3 pb-3">
								{items.length + pending.length > 0 && (
									<MediaItemList
										items={items}
										pending={pending}
										landing={landing}
										sortBy={mediaSortBy}
										sortOrder={mediaSortOrder}
										mode={mediaViewMode}
										onRemove={handleRemove}
									/>
								)}
								<MediaCompounds grid={mediaViewMode === "grid"} query={query} />
								{searching && items.length === 0 && (
									<p className="text-muted-foreground text-xs">{t("No media matches “{q}”", { q: query.trim() })}</p>
								)}
								{searching && <WebImages query={query} />}
							</div>
						</SelectableSurface>
					)}
				</div>
			</PanelView>
					</div>
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuItem onSelect={openFilePicker}>
						Import files…
						<ContextMenuShortcut>⌘I</ContextMenuShortcut>
					</ContextMenuItem>
					{/* the browser edition has neither (a clip by link and web pictures need the app) */}
					{!DEMO && (
						<>
							<ContextMenuItem onSelect={() => useStudioStore.getState().setYoutubeOpen(true)}>
								YouTube link…
								<ContextMenuShortcut>⇧⌘Y</ContextMenuShortcut>
							</ContextMenuItem>
							<ContextMenuItem
								onSelect={() => {
									setWebMode(true);
									window.setTimeout(() => searchRef.current?.focus(), 50);
								}}
							>
								Web images…
							</ContextMenuItem>
						</>
					)}
				</ContextMenuContent>
			</ContextMenu>
		</>
	);
}


function MediaScopeRegistrar() {
	useSelectionScope();
	return null;
}

/** ⌫ / Delete removes the files selected in Media (the key dispatcher asks through source-store.ts). */
function MediaDeleteKey({ onRemove }: { onRemove: (ids: string[]) => void }) {
	const { selectedIds } = useSelection();
	const selected = useRef(selectedIds);
	selected.current = selectedIds;
	const remove = useRef(onRemove);
	remove.current = onRemove;
	useEffect(() => {
		mediaDelete.current = () => {
			if (selected.current.length === 0) return false;
			remove.current([...selected.current]);
			return true;
		};
		return () => {
			mediaDelete.current = null;
		};
	}, []);
	return null;
}

function MediaAssetDraggable({
	item,
	preview,
	variant,
	isRounded,
}: {
	item: MediaAsset;
	preview: React.ReactNode;
	variant: "card" | "compact";
	isRounded?: boolean;
}) {
	const editor = useEditor();
	// A selected tile dragged with others selected takes them all along, in the order Media shows them.
	const { isSelected, selectedIds, orderedIds } = useSelection();
	const stackIds =
		isSelected(item.id) && selectedIds.length > 1 ? orderedIds.filter((id) => selectedIds.includes(id)) : null;
	// CapCut: one click on a media item shows it in the player — play it, mark In / Out (I, O) and add that part with
	// «+» or by dragging. A click on the timeline (or Play) brings the player back to the timeline.
	const onlySelected = selectedIds.length === 1 ? selectedIds[0] : null;
	useEffect(() => {
		if (onlySelected === item.id) useSourceStore.getState().open(item.id);
	}, [onlySelected, item.id]);

	return (
		<DraggableItem
			name={item.name}
			stackCount={stackIds?.length ?? 1}
			preview={
				// One click selects and shows the item in the player (CapCut); ▶ on hover does the same; double-click / ↵
				// insert it at the playhead.
				<div className="relative size-full">
					{preview}
					<button
						type="button"
						data-source-open
						aria-label={`Preview ${item.name} in the player`}
						title="Preview in the player — play it and mark In / Out"
						className="focus-visible:ring-ring absolute top-1 left-1 grid size-6 place-items-center rounded-full bg-black/65 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/80 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-hidden"
						// The press stays on the button: the tile's selection surface would capture the pointer and take the click.
						onPointerDown={(event) => event.stopPropagation()}
						onClick={(event) => {
							event.stopPropagation();
							useSourceStore.getState().open(item.id);
						}}
						onDoubleClick={(event) => event.stopPropagation()}
					>
						<HugeiconsIcon icon={PlayIcon} className="size-3" />
					</button>
				</div>
			}
			dragData={{
				id: item.id,
				type: "media",
				mediaType: item.type,
				name: item.name,
				...(stackIds
					? { ids: stackIds }
					: item.type !== "audio" && {
							targetElementTypes: [...MASKABLE_ELEMENT_TYPES],
						}),
			}}
			shouldShowPlusOnDrag={false}
			// dragged out of the window: the file itself, into Finder or a chat
			dragOut={item.file ? { id: item.id, name: item.name, file: item.file } : undefined}
			// «+» and a double-click add THIS tile only, whatever is selected (after an import all the files are selected:
			// one «+» must give one clip — the lead, place-B2); ↵ in Media adds the whole selection, in Media's order (rule B)
			onAddToTimeline={() => insertMediaIntoRow({ editor, assets: stackIds && isTileEnter() ? stackIds.flatMap((id) => editor.media.getAssets().find((a) => a.id === id) ?? []) : [item] })}
			variant={variant}
			aspectRatio={1}
			isRounded={isRounded}
			containerClassName={variant === "card" ? "w-full" : undefined}
		/>
	);
}

function MediaItemWithContextMenu({
	item,
	children,
	onRemove,
}: {
	item: MediaAsset;
	children: React.ReactNode;
	onRemove: ({
		event,
		ids,
	}: {
		event: React.MouseEvent;
		ids: string[];
	}) => void;
}) {
	const editor = useEditor();
	const { isSelected, selectedIds, orderedIds } = useSelection();
	const idsToDelete = isSelected(item.id) ? selectedIds : [item.id];
	const deleteLabel =
		idsToDelete.length > 1 ? `Delete ${idsToDelete.length} items` : "Delete";

	// «Insert at the playhead»: this item; the selection's own row adds every selected item in Media's order (rule B)
	const addAtPlayhead = () => insertMediaIntoRow({ editor, assets: [item] });
	const selection = isSelected(item.id) && selectedIds.length > 1 ? orderedIds.filter((id) => selectedIds.includes(id)) : null;
	const addSelection = () =>
		selection && insertMediaIntoRow({ editor, assets: selection.flatMap((id) => editor.media.getAssets().find((a) => a.id === id) ?? []) });

	// The original file, through the app's Save dialog.
	const saveCopy = () => {
		const url = URL.createObjectURL(item.file);
		const link = document.createElement("a");
		link.href = url;
		link.download = item.name;
		document.body.appendChild(link);
		link.click();
		link.remove();
		window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
	};

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onSelect={() => useSourceStore.getState().open(item.id)}>Open in the source preview</ContextMenuItem>
				<ContextMenuItem onSelect={addAtPlayhead}>Insert at the playhead</ContextMenuItem>
				{selection && (
					<ContextMenuItem data-add-selection="" onSelect={addSelection}>
						Add the selected to the timeline
					</ContextMenuItem>
				)}
				<ContextMenuItem onSelect={saveCopy}>Save a copy…</ContextMenuItem>
				<ContextMenuItem
					variant="destructive"
					onClick={(event: React.MouseEvent<HTMLDivElement>) =>
						onRemove({ event, ids: idsToDelete })
					}
				>
					{deleteLabel}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}

function MediaItemList({
	items,
	pending = [],
	landing,
	sortBy = "name",
	sortOrder = "asc",
	mode,
	onRemove,
}: {
	items: MediaAsset[];
	/** Items on their way, shown where they will land (src/jobs/components/pending-media.tsx). */
	pending?: Job[];
	/** Items that just took their placeholder's place: they settle in. */
	landing?: ReadonlySet<string>;
	sortBy?: string;
	sortOrder?: "asc" | "desc";
	mode: MediaViewMode;
	onRemove: ({
		event,
		ids,
	}: {
		event: React.MouseEvent;
		ids: string[];
	}) => void;
}) {
	const isGrid = mode === "grid";

	return (
		<div
			className={cn(!isGrid && "flex flex-col gap-1.5")}
			style={isGrid ? materialGrid() : undefined}
			data-material-grid={isGrid ? "" : undefined}
		>
			{withPending(items, pending, sortBy, sortOrder).map((row: MediaRow<MediaAsset>) =>
				"pending" in row ? (
					<PendingMediaTile key={row.pending.place?.media?.assetId} job={row.pending} variant={isGrid ? "grid" : "compact"} />
				) : (
				<MediaItemWithContextMenu item={row.asset} onRemove={onRemove} key={row.asset.id}>
					<SelectableItem className={cn(!isGrid && "w-full", landing?.has(row.asset.id) && SETTLE_CLASS)} id={row.asset.id}>
						<MediaAssetDraggable
							item={row.asset}
							preview={
								<MediaPreview
									item={row.asset}
									variant={isGrid ? "grid" : "compact"}
								/>
							}
							variant={isGrid ? "card" : "compact"}
							isRounded={isGrid ? false : undefined}
						/>
					</SelectableItem>
				</MediaItemWithContextMenu>
				),
			)}
		</div>
	);
}

function formatDuration({ duration }: { duration: number }) {
	const min = Math.floor(duration / 60);
	const sec = Math.floor(duration % 60);
	return `${min}:${sec.toString().padStart(2, "0")}`;
}

function MediaDurationBadge({ duration }: { duration?: number }) {
	if (!duration) return null;

	return (
		// Bottom left: the «+» of the tile takes the bottom-right corner on hover.
		<div className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-xs text-white">
			{formatDuration({ duration })}
		</div>
	);
}

function MediaDurationLabel({ duration }: { duration?: number }) {
	if (!duration) return null;

	return (
		<span className="text-xs opacity-70">{formatDuration({ duration })}</span>
	);
}

function MediaTypePlaceholder({
	icon,
	label,
	duration,
	variant,
}: {
	icon: IconSvgElement;
	label: string;
	duration?: number;
	variant: "muted" | "bordered";
}) {
	const iconClassName = cn("size-6", variant === "bordered" && "mb-1");

	return (
		<div
			className={cn(
				"text-muted-foreground flex size-full flex-col items-center justify-center rounded",
				variant === "muted" ? "bg-muted/30" : "border",
			)}
		>
			<HugeiconsIcon icon={icon} className={iconClassName} />
			<span className="text-xs">{label}</span>
			<MediaDurationLabel duration={duration} />
		</div>
	);
}

export function MediaPreview({
	item,
	variant = "grid",
}: {
	item: MediaAsset;
	variant?: "grid" | "compact";
}) {
	const shouldShowDurationBadge = variant === "grid";

	if (item.type === "image") {
		return (
			<div className="relative flex size-full items-center justify-center bg-muted">
				<Image
					src={item.url ?? ""}
					alt={item.name}
					fill
					sizes="100vw"
					className="object-cover"
					loading="lazy"
					unoptimized
				/>
				{/* A still has no duration badge: without a mark a flat photo read as a broken placeholder. */}
				<div className="absolute bottom-1 left-1 grid size-5 place-items-center rounded bg-black/70 text-white" title="Image">
					<HugeiconsIcon icon={Image02Icon} className="size-3" />
				</div>
			</div>
		);
	}

	if (item.type === "video") {
		if (item.thumbnailUrl) {
			return (
				<div className="relative size-full">
					<Image
						src={item.thumbnailUrl}
						alt={item.name}
						fill
						sizes="100vw"
						className="rounded object-cover"
						loading="lazy"
						unoptimized
					/>
					{variant === "grid" && <HoverScrubVideo asset={item} />}
					{shouldShowDurationBadge ? (
						<MediaDurationBadge duration={item.duration} />
					) : null}
					<MarksBar asset={item} />
				</div>
			);
		}

		return (
			<MediaTypePlaceholder
				icon={Video01Icon}
				label="Video"
				duration={item.duration}
				variant="muted"
			/>
		);
	}

	if (item.type === "audio") {
		if (variant === "grid") {
			return (
				<div className="relative size-full">
					<AudioTileWaveform asset={item} />
					<MediaDurationBadge duration={item.duration} />
					<MarksBar asset={item} />
				</div>
			);
		}
		return (
			<MediaTypePlaceholder
				icon={MusicNote01Icon}
				label="Audio"
				duration={item.duration}
				variant="bordered"
			/>
		);
	}

	return (
		<MediaTypePlaceholder icon={Image02Icon} label="Unknown" variant="muted" />
	);
}

function MediaActions({
	mediaViewMode,
	setMediaViewMode,
	isProcessing,
	sortBy,
	sortOrder,
	onSort,
	onImport,
	onWeb,
}: {
	mediaViewMode: MediaViewMode;
	setMediaViewMode: (mode: MediaViewMode) => void;
	isProcessing: boolean;
	sortBy: MediaSortKey;
	sortOrder: MediaSortOrder;
	onSort: ({ key }: { key: MediaSortKey }) => void;
	onImport: () => void;
	onWeb: () => void;
}) {
	return (
		// The search, «+» (every way to add) and one menu for the view and the order (the owner, 12.11: nothing twice).
		<div className="flex gap-1">
			<AddMediaMenu isProcessing={isProcessing} onImport={onImport} onWeb={onWeb} />
			<TooltipProvider>
				<Tooltip>
					<DropdownMenu>
						<TooltipTrigger asChild>
							<DropdownMenuTrigger asChild>
								<Button
									size="icon"
									variant="ghost"
									disabled={isProcessing}
									aria-label="View and sort"
									data-media-view-menu
									className="items-center justify-center"
								>
									<HugeiconsIcon icon={SortingOneNineIcon} />
								</Button>
							</DropdownMenuTrigger>
						</TooltipTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onSelect={() => setMediaViewMode(mediaViewMode === "grid" ? "list" : "grid")}>
								<HugeiconsIcon icon={mediaViewMode === "grid" ? LeftToRightListDashIcon : GridViewIcon} />
								{mediaViewMode === "grid" ? "List" : "Grid"}
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<SortMenuItem
								label="Name"
								sortKey="name"
								currentSortBy={sortBy}
								currentSortOrder={sortOrder}
								onSort={onSort}
							/>
							<SortMenuItem
								label="Type"
								sortKey="type"
								currentSortBy={sortBy}
								currentSortOrder={sortOrder}
								onSort={onSort}
							/>
							<SortMenuItem
								label="Duration"
								sortKey="duration"
								currentSortBy={sortBy}
								currentSortOrder={sortOrder}
								onSort={onSort}
							/>
							<SortMenuItem
								label="File size"
								sortKey="size"
								currentSortBy={sortBy}
								currentSortOrder={sortOrder}
								onSort={onSort}
							/>
						</DropdownMenuContent>
					</DropdownMenu>
					<TooltipContent>
						<p>View and sort</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		</div>
	);
}

/** Every way to add media behind one compact button (fits the narrowest panel); same items as the right-click menu. */
function AddMediaMenu({
	isProcessing,
	onImport,
	onWeb,
}: {
	isProcessing: boolean;
	onImport: () => void;
	onWeb: () => void;
}) {
	// "Search images on the web" focuses the search field: the menu must not take the focus back when it closes.
	const keepFocus = useRef(false);
	// 14.11, «зачем вообще это нужно». The files on that shelf stay on disk untouched; the editor imports from Finder.)
	return (
		<>
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="shrink-0 items-center justify-center"
					title="Add"
					aria-label="Add"
					data-testid="media-add"
				>
					<HugeiconsIcon icon={Add01Icon} className="size-4" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				className="min-w-64"
				onCloseAutoFocus={(event) => {
					if (!keepFocus.current) return;
					keepFocus.current = false;
					event.preventDefault();
				}}
			>
				<DropdownMenuItem onSelect={onImport} disabled={isProcessing}>
					<HugeiconsIcon icon={CloudUploadIcon} />
					Import files…
					<DropdownMenuShortcut>⌘I</DropdownMenuShortcut>
				</DropdownMenuItem>
				{/* the browser edition has neither (a clip by link and web pictures need the app): they opened nothing there */}
				{!DEMO && (
					<>
						<DropdownMenuItem onSelect={() => useStudioStore.getState().setYoutubeOpen(true)}>
							<HugeiconsIcon icon={YoutubeIcon} />
							YouTube link…
							<DropdownMenuShortcut>⇧⌘Y</DropdownMenuShortcut>
						</DropdownMenuItem>
						<DropdownMenuItem
							onSelect={() => {
								keepFocus.current = true;
								window.setTimeout(onWeb, 50);
							}}
						>
							<HugeiconsIcon icon={Image02Icon} />
							Web images…
						</DropdownMenuItem>
					</>
				)}
				<DropdownMenuItem onSelect={() => useAssetsPanelStore.getState().openSection("media", "ai-image")} data-media-add="ai-image">
					<HugeiconsIcon icon={AiImageIcon} />
					AI photo…
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => useAssetsPanelStore.getState().openSection("media", "ai-video")} data-media-add="ai-video">
					<HugeiconsIcon icon={AiVideoIcon} />
					AI video…
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
		</>
	);
}

function SortMenuItem({
	label,
	sortKey,
	currentSortBy,
	currentSortOrder,
	onSort,
}: {
	label: string;
	sortKey: MediaSortKey;
	currentSortBy: MediaSortKey;
	currentSortOrder: MediaSortOrder;
	onSort: ({ key }: { key: MediaSortKey }) => void;
}) {
	const isActive = currentSortBy === sortKey;
	const arrow = isActive ? (currentSortOrder === "asc" ? "↑" : "↓") : "";

	return (
		<DropdownMenuItem onClick={() => onSort({ key: sortKey })}>
			{label} {arrow}
		</DropdownMenuItem>
	);
}
