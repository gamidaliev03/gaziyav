"use client";

import { NativeBridge } from "@/components/editor/native-bridge";
import { McpBridge } from "@/mcp/bridge";
import { useParams } from "next/navigation";
import {
	ResizablePanelGroup,
	ResizablePanel,
	ResizableHandle,
} from "@/components/ui/resizable";
import { AssetsPanel } from "@/components/editor/panels/assets";
import { PropertiesPanel } from "@/components/editor/panels/properties";
import { Timeline } from "@/timeline/components";
import { PreviewPanel } from "@/preview/components";
import { EditorHeader } from "@/components/editor/editor-header";
import { EditorProvider } from "@/components/providers/editor-provider";
import { PanelErrorBoundary } from "@/reliability/panel-error-boundary";
import { MigrationDialog } from "@/project/components/migration-dialog";
import { LAYOUT_SIZES, LAYOUTS, type LayoutId, type LayoutNode, type PanelKey, usePanelStore } from "@/editor/panel-store";
import { CompactTabs, useCompactSideFollows } from "@/components/editor/layout/compact-side";
import { usePasteMedia } from "@/media/use-paste-media";
import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ZERO_MEDIA_TIME } from "@/wasm";
import { useEditor } from "@/editor/use-editor";
import {
	createPreviewOverlayControl,
	isPreviewOverlayVisible,
	mergePreviewOverlaySources,
} from "@/preview/overlays";
import { usePreviewStore } from "@/preview/preview-store";
import { montagePreviewOverlaySource } from "@/montage/components/overlay-source";
import { motionPreviewOverlaySource } from "@/motion/components/tracker-overlay";
import { safeZonesPreviewOverlaySource } from "@/preview/components/safe-zones";
import { getRulersPreviewOverlaySource, rulersPreviewOverlay } from "@/preview/components/rulers";
import { getGuidePreviewOverlaySource } from "@/guides";
import {
	bookmarkNotesPreviewOverlay,
	getBookmarkPreviewOverlaySource,
} from "@/timeline/bookmarks/index";

const COMPACT_ERROR = "bg-panel flex h-12 shrink-0 items-center justify-center gap-3 px-4 text-center [&>p]:text-xs [&_details]:hidden";

export default function Editor() {
	const params = useParams();
	const projectId = params.project_id as string;

	return (
		<EditorProvider projectId={projectId}>
			<div className="bg-background flex h-screen w-screen flex-col overflow-hidden">
				{/* Nothing outside a panel may take the whole editor down: header, menu bridge, dialogs. */}
				<PanelErrorBoundary name="Header" className={COMPACT_ERROR}>
					<EditorHeader />
				</PanelErrorBoundary>
				<div className="min-h-0 min-w-0 flex-1">
					<EditorLayout />
				</div>
				<PanelErrorBoundary name="Menu bridge" className={COMPACT_ERROR}>
					<NativeBridge />
				</PanelErrorBoundary>
				<PanelErrorBoundary name="Claude bridge" className={COMPACT_ERROR}>
					<McpBridge page="editor" />
				</PanelErrorBoundary>
				<PanelErrorBoundary name="Project update" className={COMPACT_ERROR}>
					<MigrationDialog />
				</PanelErrorBoundary>
			</div>
		</EditorProvider>
	);
}

/**
 * Under this height the top row / timeline split is SHORT_ROWS instead of the layout's own (a 1024×640 window):
 * half and half — three track rows fit the timeline (≈210 px of tracks, 161 at CapCut's 46 %), and the panels keep
 * enough height for the Filters' category column (at 45 % it needed a scroll of its own).
 */
const SHORT_ROWS_BELOW_PX = 660;
const SHORT_ROWS = [50, 50];

/** The smallest a panel gets, in pixels (the splitters work in percent of their group). */
const MIN_PX: Record<PanelKey, { w: number; h: number }> = {
	media: { w: 280, h: 220 },
	player: { w: 300, h: 220 },
	details: { w: 250, h: 220 },
	timeline: { w: 420, h: 160 },
};
const minPx = (node: LayoutNode, axis: "w" | "h"): number => {
	if ("panel" in node) return MIN_PX[node.panel][axis];
	const along = (node.direction === "horizontal") === (axis === "w");
	const each = node.items.map((item) => minPx(item, axis));
	return along ? each.reduce((a, b) => a + b, 0) : Math.max(...each);
};

/**
 * The compact class (docs/DESIGN.md R1–R2): under this width of the editor's own area three columns at their floors
 * (Media 280 · player 360 · inspector 280, with the gaps) no longer fit — the player goes over the timeline beside one
 * side column that holds Media or the inspector (compact-side.tsx). Measured on the editor's area, not the window.
 */
const COMPACT_BELOW_PX = 940;
/** The compact side column's floor and the player's beside it; under half the side's floor the side folds to its tabs. */
const COMPACT_MIN = { side: 280, player: 300, top: 200, timeline: 160 };
const COMPACT_SIZES = { rows: [56, 44], top: [45, 55] };

/** The editor area's size in pixels (inside its padding), live while the window or anything around it resizes. */
function useAreaBox(ref: RefObject<HTMLDivElement | null>) {
	const [box, setBox] = useState({ w: 1476, h: 800 });
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const read = () => setBox((old) => {
			const w = Math.max(1, el.clientWidth - 16), h = Math.max(1, el.clientHeight - 8);
			return old.w === w && old.h === h ? old : { w, h };
		});
		read();
		const watch = new ResizeObserver(read);
		watch.observe(el);
		return () => watch.disconnect();
	}, [ref]);
	return box;
}

const pct = (px: number, total: number) => Math.min(80, Math.ceil((px / Math.max(1, total)) * 100));

type Hosts = Record<PanelKey, HTMLDivElement>;

/** A notice sits over the player (components/ui/sonner.tsx): in Vertical the window's centre is the inspector's tabs. */
function useNoticesOverPlayer(player: HTMLDivElement | undefined) {
	useEffect(() => {
		if (!player) return;
		const root = document.documentElement;
		const place = () => {
			const { left, width } = player.getBoundingClientRect();
			root.style.setProperty("--player-centre", `${Math.round(left + width / 2)}px`);
		};
		const watch = new ResizeObserver(place);
		watch.observe(player);
		watch.observe(root);
		return () => {
			watch.disconnect();
			root.style.removeProperty("--player-centre");
		};
	}, [player]);
}

/** Media, Player, Details and Timeline each live in their own element for the editor's whole life: Layout ▾ moves
 * that element into the new arrangement, so the player keeps its frame and the timeline its scroll and zoom. */
function usePanelHosts(): Hosts | null {
	const [hosts, setHosts] = useState<Hosts | null>(null);
	useEffect(() => {
		const make = (panel: PanelKey) => {
			const element = document.createElement("div");
			element.className = "size-full min-h-0 min-w-0";
			element.dataset.panelHost = panel;
			return element;
		};
		setHosts({ media: make("media"), player: make("player"), details: make("details"), timeline: make("timeline") });
	}, []);
	return hosts;
}

function PanelSlot({ host }: { host: HTMLDivElement }) {
	const ref = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const slot = ref.current;
		if (!slot) return;
		slot.appendChild(host);
		return () => {
			if (host.parentElement === slot) slot.removeChild(host);
		};
	}, [host]);
	return <div ref={ref} data-panel-slot={host.dataset.panelHost} className="size-full min-h-0 min-w-0" />;
}

/** The current layout's arrangement; dragging a border keeps that group's sizes for this layout. */
function Arrangement({ hosts }: { hosts: Hosts }) {
	const layout = usePanelStore((state) => state.layout);
	const revision = usePanelStore((state) => state.revision);
	const sizes = usePanelStore((state) => state.sizes);
	const setGroupSizes = usePanelStore((state) => state.setGroupSizes);
	const resetGroup = usePanelStore((state) => state.resetGroup);
	const area = useRef<HTMLDivElement>(null);
	const box = useAreaBox(area);
	const compact = box.w < COMPACT_BELOW_PX;
	useCompactSideFollows(compact);
	const render = (node: LayoutNode, at: { w: number; h: number }): ReactNode => {
		if ("panel" in node) return <PanelSlot host={hosts[node.panel]} />;
		const horizontal = node.direction === "horizontal";
		// A short window (1024×640): the timeline gets more than CapCut's 46 % — three tracks then fit without scrolling
		// (161 px for 180 px of rows before). The split dragged in a short window is remembered apart from the tall one
		// (onLayout saves every split, so the tall window's sizes would otherwise always win).
		const short = node.group === "rows" && !horizontal && at.h < SHORT_ROWS_BELOW_PX;
		const groupKey = short ? `${node.group}:short` : node.group;
		const shares = sizes[groupKey] ?? (short ? SHORT_ROWS : undefined) ?? LAYOUT_SIZES[layout][node.group] ?? node.items.map(() => 100 / node.items.length);
		const total = horizontal ? at.w : at.h;
		return (
			<ResizablePanelGroup
				key={`${layout}:${revision}:${node.group}${short ? ":short" : ""}`}
				direction={node.direction}
				className="gap-[5px]"
				data-layout-group={node.group}
				onLayout={(next) => setGroupSizes(groupKey, next)}
			>
				{node.items.flatMap((item, index) => {
					const share = shares[index] ?? 100 / node.items.length;
					const id = "panel" in item ? item.panel : item.group;
					const min = Math.min(45, Math.ceil((minPx(item, horizontal ? "w" : "h") / Math.max(1, total)) * 100));
					const panel = (
						<ResizablePanel key={id} id={id} order={index} defaultSize={share} minSize={min} className="min-h-0 min-w-0">
							{render(item, horizontal ? { w: (at.w * share) / 100, h: at.h } : { w: at.w, h: (at.h * share) / 100 })}
						</ResizablePanel>
					);
					return index === 0 ? [panel] : [<ResizableHandle key={`${id}:border`} onDoubleClick={() => resetGroup(groupKey)} />, panel];
				})}
			</ResizablePanelGroup>
		);
	};
	return (
		<div ref={area} className="size-full px-2 pb-2" data-layout-class={compact ? "compact" : "regular"}>
			{compact ? <CompactArrangement hosts={hosts} box={box} /> : render(LAYOUTS[layout as LayoutId] ?? LAYOUTS.default, box)}
		</div>
	);
}

/**
 * The compact class: [side column | player] over the full-width timeline, whatever the layout (Layout ▾ is for three
 * columns). The side column shows Media or the inspector under their two tabs; folded, only the tabs stay, as a rail.
 * Its splits are remembered apart from the wide layout's (and a short window's apart again), as R3 asks.
 */
function CompactArrangement({ hosts, box }: { hosts: Hosts; box: { w: number; h: number } }) {
	const layout = usePanelStore((state) => state.layout);
	const revision = usePanelStore((state) => state.revision);
	const sizes = usePanelStore((state) => state.sizes);
	const setGroupSizes = usePanelStore((state) => state.setGroupSizes);
	const resetGroup = usePanelStore((state) => state.resetGroup);
	const side = usePanelStore((state) => state.compactSide);
	const folded = usePanelStore((state) => state.compactFolded);
	const setFolded = usePanelStore((state) => state.setCompactFolded);
	const short = box.h < SHORT_ROWS_BELOW_PX;
	const rowsKey = short ? "compact-rows:short" : "compact-rows";
	const rows = sizes[rowsKey] ?? (short ? SHORT_ROWS : COMPACT_SIZES.rows);
	const saved = sizes["compact-top"];
	// a folded side saved nothing of its own: it opens again at its last open share
	const top = saved?.length === 2 ? saved : COMPACT_SIZES.top;
	const topW = folded ? box.w - 41 : box.w;
	const sideMin = pct(COMPACT_MIN.side, topW);
	return (
		<ResizablePanelGroup
			key={`compact:${layout}:${revision}${short ? ":short" : ""}`}
			direction="vertical"
			className="gap-[5px]"
			data-layout-group="compact-rows"
			onLayout={(next) => setGroupSizes(rowsKey, next)}
		>
			<ResizablePanel id="compact-top" order={0} defaultSize={rows[0]} minSize={pct(COMPACT_MIN.top, box.h)} className="min-h-0 min-w-0">
				<div className="flex size-full min-h-0 min-w-0 gap-[5px]">
					{folded && <CompactTabs rail />}
					<ResizablePanelGroup
						key={`compact-top:${folded ? "folded" : "open"}`}
						direction="horizontal"
						className="min-w-0 flex-1 gap-[5px]"
						data-layout-group="compact-top"
						onLayout={(next) => next.length === 2 && next[0] >= sideMin && setGroupSizes("compact-top", next)}
					>
						{!folded && (
							<ResizablePanel
								id="compact-side"
								order={0}
								defaultSize={Math.max(sideMin, top[0])}
								minSize={sideMin}
								collapsible
								collapsedSize={0}
								onCollapse={() => setFolded(true)}
								className="min-h-0 min-w-0"
							>
								<div className="flex size-full min-h-0 min-w-0 flex-col gap-[5px]" data-compact-side={side}>
									<CompactTabs />
									<div className="min-h-0 min-w-0 flex-1">
										<PanelSlot key={side} host={hosts[side]} />
									</div>
								</div>
							</ResizablePanel>
						)}
						{!folded && <ResizableHandle onDoubleClick={() => resetGroup("compact-top")} />}
						<ResizablePanel
							id="compact-player"
							order={1}
							defaultSize={folded ? 100 : 100 - Math.max(sideMin, top[0])}
							minSize={pct(COMPACT_MIN.player, topW)}
							className="min-h-0 min-w-0"
						>
							<PanelSlot host={hosts.player} />
						</ResizablePanel>
					</ResizablePanelGroup>
				</div>
			</ResizablePanel>
			<ResizableHandle onDoubleClick={() => resetGroup(rowsKey)} />
			<ResizablePanel id="compact-timeline" order={1} defaultSize={rows[1]} minSize={pct(COMPACT_MIN.timeline, box.h)} className="min-h-0 min-w-0">
				<PanelSlot host={hosts.timeline} />
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}

function EditorLayout() {
	usePasteMedia();
	const hosts = usePanelHosts();
	useNoticesOverPlayer(hosts?.player);
	// Only the bookmarks: the scene object changes on every timeline edit and
	// would re-render the whole editor layout (all panels) each time.
	const sceneBookmarks = useEditor(
		(editor) => editor.scenes.getActiveSceneOrNull()?.bookmarks ?? null,
		["scenes"],
	);
	const activeGuide = usePreviewStore((state) => state.activeGuide);
	const overlays = usePreviewStore((state) => state.overlays);
	const setOverlayVisibility = usePreviewStore(
		(state) => state.setOverlayVisibility,
	);
	const showBookmarkNotes = isPreviewOverlayVisible({
		overlay: bookmarkNotesPreviewOverlay,
		overlays,
	});
	// The playhead only matters for bookmark notes; otherwise the whole layout
	// would re-render on every playback frame.
	const tracksTime = showBookmarkNotes && (sceneBookmarks?.length ?? 0) > 0;
	const currentTime = useEditor((editor) =>
		tracksTime ? editor.playback.getCurrentTime() : ZERO_MEDIA_TIME,
	);

	// ⌥⌘R (CapCut): rulers along the frame's edges.
	const showRulers = isPreviewOverlayVisible({ overlay: rulersPreviewOverlay, overlays });
	const overlaySource = useMemo(
		() =>
			mergePreviewOverlaySources({
				sources: [
					montagePreviewOverlaySource,
					motionPreviewOverlaySource,
					safeZonesPreviewOverlaySource,
					getGuidePreviewOverlaySource({
						guideId: activeGuide,
					}),
					getRulersPreviewOverlaySource({ isVisible: showRulers }),
					sceneBookmarks
						? getBookmarkPreviewOverlaySource({
								bookmarks: sceneBookmarks,
								time: currentTime,
								isVisible: showBookmarkNotes,
							})
						: {
								definitions: [bookmarkNotesPreviewOverlay],
								instances: [],
							},
				],
			}),
		[activeGuide, sceneBookmarks, currentTime, showBookmarkNotes, showRulers],
	);

	const overlayControls = useMemo(
		() =>
			overlaySource.definitions.map((overlay) =>
				createPreviewOverlayControl({ overlay, overlays }),
			),
		[overlaySource.definitions, overlays],
	);

	if (!hosts) return null;
	return (
		<>
			<Arrangement hosts={hosts} />
			{createPortal(
				<PanelErrorBoundary name="Media">
					<AssetsPanel />
				</PanelErrorBoundary>,
				hosts.media,
			)}
			{createPortal(
				<PanelErrorBoundary name="Preview">
					<PreviewPanel overlayControls={overlayControls} overlayInstances={overlaySource.instances} onOverlayVisibilityChange={setOverlayVisibility} />
				</PanelErrorBoundary>,
				hosts.player,
			)}
			{createPortal(
				<PanelErrorBoundary name="Properties">
					<PropertiesPanel />
				</PanelErrorBoundary>,
				hosts.details,
			)}
			{createPortal(
				<PanelErrorBoundary name="Timeline">
					{/* One project, one timeline (the owner, 12.11): the Text and Scenes views are gone; nesting is compound clips. */}
					<div className="relative h-full min-h-0">
						<Timeline />
					</div>
				</PanelErrorBoundary>,
				hosts.timeline,
			)}
		</>
	);
}
