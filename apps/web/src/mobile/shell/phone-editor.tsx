"use client";
// The phone and tablet editor (mobile, 14.11 — round 1 sketch, UNBUILT). The same editor: the same EditorProvider,
// the same PreviewPanel, Timeline, AssetsPanel and PropertiesPanel, the same actions and commands; only the
// arrangement is for a hand. Chosen by device-switch.tsx (device-class.ts decides), never by a second code base.
//
//  phone (portrait)                      tablet (portrait / landscape)
//  ┌──────────────────────────┐          ┌──────────────────────────────┬──────────────┐
//  │ ‹ Projects   ⋯   Export ▸│ top bar  │ ‹ Projects        ⋯  Export ▸│              │
//  │                          │          │                              │  sheet as a  │
//  │        PLAYER            │  ~45 %   │           PLAYER             │  side panel  │
//  │                          │          │                              │  (Properties │
//  │ 0:04 / 0:15   ↶  ▶  ↷   │ transport│ 0:04 / 0:15        ↶  ▶  ↷  │   or a tab   │
//  ├──────────────────────────┤          ├──────────────────────────────┤   of Media)  │
//  │   TIMELINE (fat clips)   │  flex    │   TIMELINE                   │              │
//  ├──────────────────────────┤          ├──────────────────────────────┴──────────────┤
//  │ Add Edit Text Audio Filt…│ bar      │ Add  Edit  Text  Audio  Filters  Format  Export│
//  └──────────────────────────┘ + safe   └───────────────────────────────────────────────┘
//  a tool opens a bottom SHEET over the timeline (half height, drag down to close); the player stays visible.
import { useEffect, useRef, useState } from "react";
import { invokeAction } from "@/actions";
import { HugeiconsIcon } from "@/components/ui/icon";
import { ExportButton } from "@/components/editor/export-button";
import { AssetsPanel } from "@/components/editor/panels/assets";
import { useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import { PropertiesPanel } from "@/components/editor/panels/properties";
import { useEditor } from "@/editor/use-editor";
import { useT } from "@/i18n";
import { PreviewPanel } from "@/preview/components";
import { PanelErrorBoundary } from "@/reliability/panel-error-boundary";
import { Timeline } from "@/timeline/components";
import { TICKS_PER_SECOND } from "@/wasm";
import { attachPlayerTouch } from "../gestures/player-gestures";
import { attachTimelineTouch } from "../gestures/timeline-bridge";
import { BottomBar, ICONS } from "./bottom-bar";
import { FormatSheet } from "./format-sheet";
import { PhotosButton } from "./photos-button";
import { Sheet } from "./sheet";
import { EDIT_ACTIONS, type SheetId, TOP_ACTIONS } from "./tools";
import "./mobile.css";

export function PhoneEditor({ tablet = false }: { tablet?: boolean }) {
	const t = useT();
	const editor = useEditor();
	const [sheet, setSheet] = useState<SheetId | null>(null);
	const timelineRef = useRef<HTMLDivElement>(null);
	const playerRef = useRef<HTMLDivElement>(null);
	const hasSelection = useEditor((e) => e.selection.getSelectedElements().length > 0);
	const [playing, setPlaying] = useState(() => editor.playback.getIsPlaying());
	useEffect(() => editor.playback.subscribe(() => setPlaying(editor.playback.getIsPlaying())), [editor.playback]);

	useEffect(() => {
		const tl = timelineRef.current;
		const pl = playerRef.current;
		const detach: Array<() => void> = [];
		if (tl)
			detach.push(
				attachTimelineTouch(tl, {
					isSelected: (id) => editor.selection.getSelectedElements().some((r) => r.elementId === id),
					tick: () => navigator.vibrate?.(8),
				}),
			);
		if (pl) detach.push(attachPlayerTouch(pl, { isOnSelectedBox: (el) => !!el.closest("[data-preview-handle], [data-preview-selection]") }));
		return () => {
			for (const d of detach) d();
		};
	}, [editor]);

	// Speed shows the clip's Speed section of the inspector, which on a phone lives in the Edit sheet: open it first
	// (the action alone lit a section that was not on screen — nothing seemed to happen)
	const runQuick = (action: (typeof EDIT_ACTIONS)[number]["action"]) => {
		if (action !== "speed-duration") return invokeAction(action);
		setSheet("edit");
		setTimeout(() => invokeAction(action), 120);
	};

	// a sheet showing a materials tab: the tab is the desktop panel's own (one panel, two arrangements)
	useEffect(() => {
		const tab = sheet === "media" ? "media" : sheet === "text" ? "text" : sheet === "audio" ? "sounds" : sheet === "filters" ? "filters" : null;
		if (tab) useAssetsPanelStore.getState().setActiveTab(tab);
	}, [sheet]);

	return (
		<div className="gz-mobile bg-background text-foreground flex h-[100dvh] w-screen flex-col overflow-hidden" data-device={tablet ? "tablet" : "phone"}>
			<header className="gz-safe-top flex h-12 shrink-0 items-center justify-between px-3">
				<a href="../" className="gz-hit text-sm font-medium" aria-label="Gaziyav" data-no-translate>
					‹ Gaziyav
				</a>
				<ExportButton />
			</header>

			<div className={tablet ? "flex min-h-0 flex-1" : "flex min-h-0 flex-1 flex-col"}>
				<div className={tablet ? "flex min-h-0 min-w-0 flex-1 flex-col" : "flex min-h-0 flex-1 flex-col"}>
					<div ref={playerRef} className={tablet ? "min-h-0 flex-[3]" : "min-h-0 basis-[45%] shrink-0"}>
						<PanelErrorBoundary name="Preview">
							<PreviewPanel overlayControls={[]} overlayInstances={[]} onOverlayVisibilityChange={() => {}} />
						</PanelErrorBoundary>
					</div>
					<div className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center px-3" data-phone-transport>
						<PhoneTime />
						<div className="flex items-center gap-4">
							{TOP_ACTIONS.map((a) => (
								<button key={a.action} type="button" className="gz-hit" aria-label={t(a.label)} onClick={() => invokeAction(a.action)} data-phone-action={a.action}>
									<HugeiconsIcon icon={a.action === "toggle-play" && playing ? ICONS.PauseIcon : ICONS[a.icon]} className={a.action === "toggle-play" ? "size-7" : "size-6"} />
								</button>
							))}
						</div>
						<span />
					</div>
					<div ref={timelineRef} className="gz-timeline relative min-h-0 flex-[2]">
						<PanelErrorBoundary name="Timeline">
							<Timeline />
						</PanelErrorBoundary>
						{sheet && !tablet && (
							<Sheet onClose={() => setSheet(null)}>
								<SheetBody sheet={sheet} hasSelection={hasSelection} />
							</Sheet>
						)}
					</div>
				</div>
				{tablet && sheet && (
					<aside className="border-border w-[min(380px,40vw)] shrink-0 overflow-y-auto border-l">
						<SheetBody sheet={sheet} hasSelection={hasSelection} />
					</aside>
				)}
			</div>

			{hasSelection && !sheet && (
				<div className="gz-quick border-border bg-background shrink-0 border-t" data-phone-quick>
					{EDIT_ACTIONS.map((a) => (
						<button key={a.action} type="button" className="gz-tool" onClick={() => runQuick(a.action)} data-phone-action={a.action}>
							<HugeiconsIcon icon={ICONS[a.icon]} className="size-6" />
							<span>{t(a.label)}</span>
						</button>
					))}
				</div>
			)}
			<BottomBar active={sheet} onPick={(next) => setSheet((cur) => (cur === next ? null : next))} />
		</div>
	);
}

/** Where the playhead is and how long the film is: «0:04 / 0:15». */
function PhoneTime() {
	const editor = useEditor();
	const total = useEditor((e) => e.timeline.getTotalDuration());
	const [time, setTime] = useState<number>(() => editor.playback.getCurrentTime());
	useEffect(() => {
		const offUpdate = editor.playback.onUpdate(setTime);
		const offSeek = editor.playback.onSeek(setTime);
		return () => {
			offUpdate();
			offSeek();
		};
	}, [editor.playback]);
	const clock = (ticks: number) => {
		const seconds = Math.max(0, Math.floor(ticks / TICKS_PER_SECOND));
		return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
	};
	return (
		<span className="text-muted-foreground font-mono text-xs tabular-nums" data-phone-time>
			{clock(time)} / {clock(total)}
		</span>
	);
}

function SheetBody({ sheet, hasSelection }: { sheet: SheetId; hasSelection: boolean }) {
	const t = useT();
	if (sheet === "edit")
		return (
			<div className="flex flex-col gap-2">
				{!hasSelection && <p className="text-muted-foreground px-4 py-2 text-sm">{t("Tap a clip to edit it")}</p>}
				<div className="flex gap-1 overflow-x-auto px-2 pb-2">
					{EDIT_ACTIONS.map((a) => (
						<button key={a.action} type="button" disabled={!hasSelection} className="gz-tool" onClick={() => invokeAction(a.action)}>
							<HugeiconsIcon icon={ICONS[a.icon]} className="size-6" />
							<span>{t(a.label)}</span>
						</button>
					))}
				</div>
				{hasSelection && (
					<PanelErrorBoundary name="Properties">
						<PropertiesPanel />
					</PanelErrorBoundary>
				)}
			</div>
		);
	if (sheet === "format") return <FormatSheet />;
	if (sheet === "export")
		return (
			<p className="text-muted-foreground px-4 py-3 text-sm">
				{t("Export makes the video on this phone, then Share → Save Video puts it in Photos.")}
			</p>
		);
	return (
		<div className="flex h-full flex-col">
			{sheet === "media" && <PhotosButton />}
			<PanelErrorBoundary name="Media">
				<AssetsPanel />
			</PanelErrorBoundary>
		</div>
	);
}
