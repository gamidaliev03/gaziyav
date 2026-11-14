"use client";

// Properties panel (the inspector): a few named TABS by sphere for the selected clip — the clip itself, its sound,
// speed, colour, effects, AI (./layout-places.ts, the owner 14.11) — each a short list of rows. Sections come from ./slots —
// the panel's own ones (./sections/builtin) and any feature's (./plugins). Nothing selected: the project's own settings.
import {
	Activity,
	Component,
	memo,
	startTransition,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
	type CSSProperties,
	type ReactNode,
} from "react";
import { PanelHeader } from "@/components/ui/panel-header";
import { useT, t as translate } from "@/i18n";
import { useEditor } from "@/editor/use-editor";
import { useElementSelection } from "@/timeline/hooks/element/use-element-selection";
import type { TimelineElement, TimelineTrack } from "@/timeline";
import type { ElementRef } from "@/timeline/types";
import { EditorCore } from "@/core";
import { findTrackInSceneTracks } from "@/timeline/track-element-update";
import { onlyPlacementChanged, onlyTypedTextChanged, typingInInspector } from "./hooks/placement";
import { currentTabId, elementKind, kindLabel } from "./registry";
import { usePropertiesStore } from "./stores/properties-store";
import { revealInspectorSection } from "./reveal";
import { useInspectorTab } from "./inspector-tab";
import {
	getInspectorSectionsVersion,
	shownTabOf,
	subscribeInspectorSections,
	type InspectorSection,
} from "./slots";
import { registerBuiltInSections } from "./sections/builtin";
import { GroupDefaultsContext, InspectorGroup } from "./components/inspector-ui";
import { type BlockId, inspectorBlocks, type InspectorBlockSpec } from "./layout";
import { EffectsHeaderButtons } from "@/effects/components/effects-tab";
import { AudioEffectsAdd } from "@/sounds/components/audio-effects";
import { DetailsView } from "./details-view";
import { findCut, useSelectedCut } from "@/transitions/commands";
import { SelectedCutSection } from "@/transitions/components/assets-view";
import { registerCapcutSections } from "./sections/capcut";
import { MultiParamsTab } from "./components/multi-params-tab";
import "./plugins";

registerBuiltInSections();
registerCapcutSections();

// A tab asked for from elsewhere (the timeline's fx badge, ⌘R, a tool's link — usePropertiesStore.setActiveTab): the
// list has no tabs, so that tab's first section of the selected clip opens and scrolls into view. Read a frame later:
// the caller usually selects the clip in the same breath.
if (typeof window !== "undefined") {
	usePropertiesStore.subscribe((state, previous) => {
		const request = state.tabRequest;
		if (!request || request === previous.tabRequest) return;
		requestAnimationFrame(() => {
			const editor = EditorCore.getInstance();
			const selected = editor.selection.getSelectedElements();
			if (selected.length !== 1) return;
			const [found] = editor.timeline.getElementsWithTracks({ elements: selected });
			if (!found) return;
			const tab = currentTabId(request.tabId);
			const first = inspectorBlocks(found.element)
				.flatMap((block) => block.sections)
				.find(({ section }) => shownTabOf(section) === tab);
			if (first) revealInspectorSection(first.section.id);
		});
	});
}

// Wide enough for two-word labels («Fade out», «Padding X») on one line at the default panel width.
const SHELL_STYLE = { "--insp-label": "clamp(4rem, 32%, 7rem)" } as CSSProperties;

function Shell({ children }: { children: ReactNode }) {
	return (
		<div
			data-inspector
			data-handles-escape
			style={SHELL_STYLE}
			className="panel bg-background @container/insp flex h-full min-w-0 flex-col overflow-hidden rounded-sm border"
		>
			{children}
		</div>
	);
}

/**
 * The one scroll of the panel. A new `scrollKey` builds it again; a new `scrollResetKey` only scrolls a reused
 * body back to the top (another clip starts at the top, as it did when the body was rebuilt).
 */
function Body({
	children,
	scrollKey,
	scrollResetKey,
}: {
	children: ReactNode;
	scrollKey?: string;
	scrollResetKey?: string;
}) {
	const ref = useRef<HTMLDivElement>(null);
	// Known from scroll events: reading scrollTop here would force a layout on every selection.
	const scrolledRef = useRef(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: listens again when another panel's content mounts (scrollKey)
	useEffect(() => {
		scrolledRef.current = false;
		const element = ref.current;
		if (!element) return;
		const onScroll = () => {
			scrolledRef.current = element.scrollTop > 0;
		};
		element.addEventListener("scroll", onScroll, { passive: true });
		return () => element.removeEventListener("scroll", onScroll);
	}, [scrollKey]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: scrolls back to the top when the selection changes (scrollResetKey)
	useLayoutEffect(() => {
		if (!scrolledRef.current || !ref.current) return;
		ref.current.scrollTop = 0;
		scrolledRef.current = false;
	}, [scrollResetKey]);
	return (
		// scrollbar-gutter: a classic scrollbar (the Mac set to always show them) took its 15 px from the rows, so a long
		// tab's ◆, ↺ and group chevrons sat under it and a click at their right edge went to the scrollbar
		<div key={scrollKey} ref={ref} data-inspector-body className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
			{children}
		</div>
	);
}

/**
 * The selected clips as they are right now. A slider or a number scrub writes a preview while the pointer moves
 * (committed on release); the inspector must show that preview, or the slider stays frozen under the pointer and,
 * its value never changing, the release commits nothing.
 */
function livePairs(editor: EditorCore, selected: { trackId: string; elementId: string }[]): Array<{ track: TimelineTrack; element: TimelineElement }> {
	const pairs = editor.timeline.getElementsWithTracks({ elements: selected });
	const preview = editor.timeline.getPreviewTracks();
	if (!preview) return pairs;
	return pairs.map((pair) => {
		const track = findTrackInSceneTracks({ tracks: preview, trackId: pair.track.id }) ?? pair.track;
		const element = (track.elements as TimelineElement[]).find((e) => e.id === pair.element.id) ?? pair.element;
		return { track, element };
	});
}

const sameSelection = (a: ElementRef[], b: ElementRef[]) =>
	a === b || (a.length === b.length && a.every((ref, i) => ref.elementId === b[i].elementId && ref.trackId === b[i].trackId));

export function PropertiesPanel() {
	const { selectedElements } = useElementSelection();
	// The panel follows a new selection once the timeline's frame is on screen. Building it for the clip that a click or
	// an undo just selected (and detaching / re-attaching the panels' effects) ran ahead of that frame: a ⌘Z on a
	// 10-track project waited 18–30 ms for the inspector (perf-tracks10). Now the edit's frame shows the timeline and the
	// player, and the panel catches up right after (a frame later, unseen), in a deferred pass React can interrupt.
	const [shown, setShown] = useState(selectedElements);
	useEffect(() => {
		if (sameSelection(shown, selectedElements)) return;
		let timer = 0;
		const frame = requestAnimationFrame(() => {
			timer = window.setTimeout(() => startTransition(() => setShown(selectedElements)), 0);
		});
		return () => {
			cancelAnimationFrame(frame);
			window.clearTimeout(timer);
		};
	}, [selectedElements, shown]);
	return <PanelForSelection selectedElements={shown} />;
}

type Pair = { element: TimelineElement; track: TimelineTrack };


const PanelForSelection = memo(function PanelForSelection({ selectedElements }: { selectedElements: ElementRef[] }) {
	const editor = useEditor();
	const shownRef = useRef<{ element: TimelineElement; snapshot: unknown[] } | null>(null);
	// Re-render only when the selected element (or its media) changes, not on
	// every edit anywhere on the timeline.
	useEditor(
		(e) => {
			const selected = selectedElements;
			if (selected.length !== 1) {
				shownRef.current = null;
				return [selected.length, ...livePairs(e, selected).map((p) => p.element)];
			}
			const pair = livePairs(e, selected)[0];
			// The selected clip dragged or trimmed on the timeline: a preview that only moves it. The panel keeps showing it
			// as it was and catches up on the drop — it re-rendered on every pointer move (877 component renders for three
			// 20-step drags on a 264-clip project) while nobody could touch it.
			const shown = shownRef.current;
			// The same for words typed into the panel's own text field (perf, 13.11): the field shows them, the player and
			// the timeline draw the preview, the panel follows when the field is left (one ⌘Z step either way).
			if (
				shown &&
				pair &&
				shown.element.id === pair.element.id &&
				e.timeline.isPreviewActive() &&
				(onlyPlacementChanged(shown.element, pair.element) || (onlyTypedTextChanged(shown.element, pair.element) && typingInInspector()))
			) {
				return shown.snapshot;
			}
			const mediaId =
				pair && "mediaId" in pair.element ? pair.element.mediaId : null;
			const snapshot = [
				pair?.element ?? null,
				pair?.track.id ?? null,
				mediaId
					? (e.media.getAssets().find((asset) => asset.id === mediaId) ?? null)
					: null,
			];
			shownRef.current = pair ? { element: pair.element, snapshot } : null;
			return snapshot;
		},
		["scenes", "timeline", "media"],
	);
	useSyncExternalStore(subscribeInspectorSections, getInspectorSectionsVersion, getInspectorSectionsVersion);
	// A deleted clip can still be the shown selection for that one render: show the project panel then too.
	const pairs = selectedElements.length === 0 ? [] : livePairs(editor, selectedElements);
	const single = pairs.length === 1 ? pairs[0] : null;
	// The last clip's panel stays mounted, hidden, while nothing or several clips are selected. ⌫, ⌘Z and ⇧⌘Z switch
	// between a clip and nothing: tearing its ~260 nodes down and building them again was a quarter of each edit on a
	// big timeline (timeline9: delete 32 → 24 ms, undo 22 → 18 ms with the panel out of the way). Hidden, it keeps the
	// props it was last shown with and its subscriptions are off, so it costs nothing until it is shown again.
	// CapCut: a transition clicked on the timeline shows its settings here (no clip is selected then). It stays only while
	// that cut exists and nothing else was chosen: a clip picked, Esc, or the cut gone (a clip deleted) brings back the
	// project's details instead of an empty «Transition» panel.
	const picked = useSelectedCut((state) => state.cut);
	// A cut whose clips were deleted or moved apart is no cut any more: the project shows, not «Transition».
	const cut = picked && findCut(picked) ? picked : null;
	useEffect(() => {
		if (pairs.length > 0 && useSelectedCut.getState().cut) useSelectedCut.getState().setCut(null);
	}, [pairs.length]);
	useEffect(() => {
		if (!cut) return;
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (event.key !== "Escape" || target?.closest("input, textarea, [contenteditable=true], [role=dialog], [role=listbox], [role=menu]")) return;
			useSelectedCut.getState().setCut(null);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [cut]);
	const lastSingle = useRef<Pair | null>(null);
	if (single) lastSingle.current = single;
	const kept = single ?? lastSingle.current;

	return (
		<Shell>
			<Activity mode={pairs.length === 0 && !cut ? "visible" : "hidden"}>
				<DetailsView />
			</Activity>
			{pairs.length === 0 && cut && <TransitionPanel />}
			{pairs.length > 1 && <MultiPanel pairs={pairs} />}
			{kept && (
				<Activity mode={single ? "visible" : "hidden"}>
					<ClipPanel element={kept.element} track={kept.track} />
				</Activity>
			)}
		</Shell>
	);
});

const hasEffectList = (element: TimelineElement) => ["video", "image", "sticker", "graphic"].includes(element.type);

const ClipPanel = memo(function ClipPanel({ element, track }: Pair) {
	const blocks = inspectorBlocks(element);
	// the open tab, or the clip's own first tab when it has no such one (a text has no «Audio»)
	const wanted = useInspectorTab((state) => state.tab);
	const active = blocks.find((block) => block.id === wanted) ?? blocks[0];

	// Clicking from clip to clip of the same kind reuses the open properties (Transform, Opacity, Speed, Color: no
	// per-clip state) with the new clip's values instead of building the list again — that rebuild was most of the cost
	// of selecting a clip. The tools keep state per clip (lipsync, tracker, masks…): they start fresh for each clip.
	const bodyKey = element.type === "video" || element.type === "image" ? element.type : element.id;
	if (!active) return null;
	return (
		<Body scrollKey={`${bodyKey}:${active.id}`} scrollResetKey={`${element.id}:${active.id}`}>
			{/* data-inspector-tab: Tab walks the panel's controls before it leaves the panel (keyboard/navigation.ts) */}
			<div data-inspector-tab="list" data-inspector-list={elementKind(element)}>
				<TabStrip blocks={blocks} active={active.id} />
				<BlockView key={active.id} block={active} element={element} trackId={track.id} />
			</div>
		</Body>
	);
});

/**
 * The tabs by sphere (./layout-places.ts): named, few, the same order for every kind of clip. One alone is not drawn.
 * Every tab is always in sight: six Russian names («Видео Аудио Скорость Цвет Эффекты ИИ») are wider than the panel
 * at its usual width, and a strip that scrolled sideways with no scrollbar hid «Эффекты» and «ИИ» (the gate's
 * fit-any-window, 15.11) — so the strip takes a second row when it must, never a sideways scroll.
 */
function TabStrip({ blocks, active }: { blocks: InspectorBlockSpec[]; active: BlockId }) {
	const t = useT();
	if (blocks.length < 2) return null;
	return (
		<div role="tablist" data-inspector-tabs className="bg-background sticky top-0 z-10 flex flex-wrap gap-0.5 border-b border-white/[.07] px-2 py-1.5">
			{blocks.map((block) => {
				const on = block.id === active;
				return (
					<button
						key={block.id}
						type="button"
						role="tab"
						aria-selected={on}
						data-inspector-tab-button={block.id}
						onClick={() => useInspectorTab.getState().setTab(block.id)}
						className={
							on
								? "bg-foreground/[0.1] text-foreground shrink-0 rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap"
								: "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] shrink-0 rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap"
						}
					>
						{t(block.title)}
					</button>
				);
			})}
		</div>
	);
}

function BlockView({ block, element, trackId }: { block: InspectorBlockSpec; element: TimelineElement; trackId: string }) {
	const tools = block.id === "tools";
	const sections = block.sections.map(({ section, folded }) => (
		<SectionBoundary key={tools ? `${section.id}:${element.id}` : section.id} title={section.title} resetKey={element.id}>
			{/* scroll-mt: a section brought into view (reveal.ts) stops below the sticky tabs — two rows of them at most —, not behind them */}
			<div data-inspector-section={section.id} data-inspector-element={element.id} className="scroll-mt-[4.75rem] transition-colors duration-500 data-[revealed]:bg-primary/10">
				<SectionView section={section} element={element} trackId={trackId} folded={folded} />
			</div>
		</SectionBoundary>
	));
	// «+» of the tab: an effect onto the clip (Effects), a sound effect (the sound's tab)
	const add =
		block.id === "effects" && hasEffectList(element) ? (
			<EffectsHeaderButtons element={element} trackId={trackId} />
		) : block.id === "audio" || (block.id === "main" && element.type === "audio") ? (
			<AudioEffectsAdd element={element} trackId={trackId} />
		) : null;
	return (
		<div data-inspector-block={block.id}>
			{add && <div className="flex justify-end px-3 pt-1.5">{add}</div>}
			<GroupDefaultsContext.Provider value={foldedIds(block)}>{sections}</GroupDefaultsContext.Provider>
		</div>
	);
}

/** The ids of the folded sections of a part (and the group a bare one draws: its id without «@tab»). */
function foldedIds(block: InspectorBlockSpec): Record<string, boolean> {
	const ids: Record<string, boolean> = {};
	for (const { section, folded } of block.sections) {
		if (!folded) continue;
		ids[section.id] = false;
		ids[section.id.replace(/@[a-z]+$/, "")] = false;
	}
	return ids;
}

/** The transition at the clicked cut: its duration, options and «apply to all», as in CapCut's Transition tab. */
function TransitionPanel() {
	// the cut is gone (a clip deleted, an undo): let go of it, the project's details come back
	useEditor((e) => e.timeline.getPreviewTracks());
	const selected = useSelectedCut((state) => state.cut);
	const exists = Boolean(selected && findCut(selected));
	useEffect(() => {
		if (!exists) useSelectedCut.getState().setCut(null);
	}, [exists]);
	if (!exists) return null;
	return (
		<>
			<PanelHeader data-inspector-header title={<span data-transition-panel>Transition</span>} />
			<div data-inspector-body data-transition-inspector className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
				<SelectedCutSection />
			</div>
		</>
	);
}

function MultiPanel({ pairs }: { pairs: Pair[] }) {
	const counts = new Map<string, number>();
	for (const { element } of pairs) {
		const kind = kindLabel(element);
		const label = kind.startsWith("AI") ? kind : kind.toLowerCase();
		counts.set(label, (counts.get(label) ?? 0) + 1);
	}
	const summary = [...counts.entries()].map(([label, n]) => `${n} ${label}`).join(", ");
	return (
		<>
			{/* what is selected, by kind, on hover: the panel itself shows only what they share */}
			<PanelHeader
				data-inspector-header
				title={
					<span data-testid="multi-properties" title={summary}>
						{pairs.length} clips selected
					</span>
				}
			/>
			<Body>
				<MultiParamsTab items={pairs.map(({ track, element }) => ({ trackId: track.id, element }))} />
			</Body>
		</>
	);
}

/** Full-width tools that drew no header of their own (they had a tab to themselves): a header in the one list. */
const NEEDS_HEADER = new Set(["masks", "adjust.color"]);

type SectionViewProps = { section: InspectorSection; element: TimelineElement; trackId: string; folded?: boolean };

/**
 * Per-section re-render (perfb, 14.11): a committed edit of the selected clip re-rendered every section (550 components
 * on a drop or its ⌘Z, ~1 100 on ⌘B). A section that shows nothing of the clip's place (slots.ts placementFree) now
 * skips an edit that only moved or trimmed it; everything else of the clip changing renders it as before.
 */
const SectionView = memo(SectionViewInner, (a: SectionViewProps, b: SectionViewProps) =>
	a.section === b.section &&
	a.trackId === b.trackId &&
	a.folded === b.folded &&
	(a.element === b.element || (b.section.placementFree === true && a.element.id === b.element.id && onlyPlacementChanged(a.element, b.element))),
);

function SectionViewInner({ section, element, trackId, folded = false }: SectionViewProps) {
	const content = section.render({ element, trackId });
	if (section.bare && NEEDS_HEADER.has(section.id)) {
		return (
			<InspectorGroup id={section.id} title={section.title} defaultOpen={!folded} flush>
				{content}
			</InspectorGroup>
		);
	}
	if (section.bare) return <>{content}</>;
	return (
		<InspectorGroup id={section.id} title={section.title} defaultOpen={folded ? false : (section.defaultOpen ?? true)}>
			{content}
		</InspectorGroup>
	);
}

/** One broken group (a plug-in, say) shows a line instead of taking the whole panel down. */
class SectionBoundary extends Component<
	{ title: string; resetKey?: string; children: ReactNode },
	{ failed: boolean; resetKey?: string }
> {
	state: { failed: boolean; resetKey?: string } = { failed: false, resetKey: this.props.resetKey };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	// Another clip: try again (the body may be reused instead of rebuilt).
	static getDerivedStateFromProps(
		props: { resetKey?: string },
		state: { failed: boolean; resetKey?: string },
	) {
		return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey };
	}
	componentDidCatch(error: unknown) {
		console.error("[inspector] section failed", this.props.title, error);
	}
	render() {
		if (this.state.failed) {
			return (
				<p className="text-muted-foreground border-border/70 border-b px-4 py-3 text-xs">
					{translate("{title} couldn't be shown. Select the clip again to retry.", { title: translate(this.props.title) })}
				</p>
			);
		}
		return this.props.children;
	}
}
