"use client";

// Inspector → Tracking: Tracker (track a face / subject / object, its action, smoothing, hand edits, layers
// attached to it), Make vertical (reframe to 9:16 and other aspects) and Follow (for any layer: move with a
// tracker). Every change is one ⌘Z.
import { useMemo, useRef, useState } from "react";
import { Switch } from "@/components/ui/switch";
import {
	InspectorGroup,
	InspectorRow,
	InspectorSlider,
	Segmented,
} from "@/components/editor/panels/properties/components/inspector-ui";
import { useEditor } from "@/editor/use-editor";
import type { EditorCore } from "@/core";
import type { SceneTracks, TimelineElement, TimelineTrack, VideoElement } from "@/timeline";
import { cn } from "@/utils/ui";
import { reframeClips, trackClip } from "../client";
import { ASPECTS, attachFollower, detachFollower, previewTracker, removeTracker, updateTracker, type AspectId } from "../commands";
import { clipSourceSeconds, followersOf } from "../follow";
import { jobFor, useMotionStore } from "../store";
import { DEFAULT_FX, trackBoxAt } from "../tracker";
import type { Tracker, TrackerFx, TrackerFxKind, TrackerKind, TrackerLook } from "../types";
import { MotionJobLine } from "./speed-sections";

const FX_OPTIONS: Array<{ value: TrackerFxKind; label: string }> = [
	{ value: "none", label: "None" },
	{ value: "blur", label: "Blur" },
	{ value: "pixelate", label: "Pixelate" },
	{ value: "spotlight", label: "Spotlight" },
	{ value: "colorPop", label: "Colour pop" },
	{ value: "glow", label: "Glow" },
	{ value: "filter", label: "Filter" },
];

/** Kind «Filter»: the look put only on the tracked thing. */
const LOOK_OPTIONS: Array<{ value: TrackerLook; label: string }> = [
	{ value: "bw", label: "B&W" },
	{ value: "warm", label: "Warm" },
	{ value: "cool", label: "Cool" },
	{ value: "vivid", label: "Vivid" },
	{ value: "vintage", label: "Vintage" },
];

function Chip({ active, onClick, children, disabled, data }: { active?: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean; data?: string }) {
	return (
		<button
			type="button"
			data-motion-button={data}
			disabled={disabled}
			aria-pressed={active}
			onClick={onClick}
			className={cn(
				"flex min-h-7 min-w-0 items-center justify-center rounded-md border px-1.5 py-1 text-center text-xs leading-tight break-words transition-colors disabled:cursor-not-allowed disabled:opacity-50",
				active ? "border-primary/60 bg-primary/12 text-foreground" : "border-border bg-accent text-muted-foreground hover:text-foreground",
			)}
		>
			{children}
		</button>
	);
}

/** A slider row that previews while dragging and commits one ⌘Z on release. */
function TrackerSlider({
	label,
	value,
	min,
	max,
	step,
	format,
	onPreview,
	onCommit,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	format: (v: number) => string;
	onPreview: (v: number) => void;
	onCommit: (v: number) => void;
}) {
	const [draft, setDraft] = useState<number | null>(null);
	const last = useRef(value);
	const shown = draft ?? value;
	return (
		<InspectorRow label={label}>
			<div className="flex items-center gap-2">
				<InspectorSlider
					label={label}
					value={shown}
					min={min}
					max={max}
					step={step}
					onChange={(v) => {
						last.current = v;
						setDraft(v);
						onPreview(v);
					}}
					onCommit={() => {
						onCommit(last.current);
						setDraft(null);
					}}
				/>
				<span className="text-muted-foreground w-10 shrink-0 text-right text-[11px] tabular-nums">{format(shown)}</span>
			</div>
		</InspectorRow>
	);
}

function TrackerDetails({ clip, tracker, busy }: { clip: VideoElement; tracker: Tracker; busy: boolean }) {
	const editor = useEditor();
	const tracks = useEditor((e) => e.scenes.getActiveSceneOrNull()?.tracks ?? null, ["scenes", "timeline"]);
	const draw = useMotionStore((s) => s.draw);
	const fx: TrackerFx = tracker.fx ?? { ...DEFAULT_FX.blur, kind: "none" };
	const followers = useMemo(() => (tracks ? followersOf(tracks, clip.id, tracker.id) : []), [tracks, clip.id, tracker.id]);
	const editing = draw?.mode === "edit" && draw.trackerId === tracker.id;

	const setFx = (patch: Partial<TrackerFx>, commit = true) => {
		const base = fx.kind === "none" && patch.kind && patch.kind !== "none" ? DEFAULT_FX[patch.kind as Exclude<TrackerFxKind, "none">] : fx;
		const next = { ...base, ...patch };
		if (commit) {
			editor.timeline.discardPreview();
			updateTracker(editor, clip.id, tracker.id, { fx: next });
		} else previewTracker(editor, clip.id, tracker.id, { fx: next });
	};

	/** Re-track from the playhead (the box as it is here, e.g. after Edit box), one side only. */
	const retrack = (direction: "forward" | "backward") => {
		useMotionStore.getState().setDraw(null);
		const box = trackBoxAt(tracker, clipSourceSeconds(clip, editor.playback.getCurrentTime()));
		if (!box) return;
		const rect: [number, number, number, number] = [box.cx - box.w / 2, box.cy - box.h / 2, box.w, box.h];
		void trackClip({
			elementId: clip.id,
			kind: tracker.kind === "face" ? "face" : "object",
			rect: tracker.kind === "face" ? undefined : rect,
			point: tracker.kind === "face" ? [box.cx, box.cy] : undefined,
			replace: tracker.id,
			direction,
		});
	};

	return (
		<div className="flex flex-col gap-2" data-tracker-details={tracker.id}>
			<InspectorRow label="Action" stacked>
				<div className="grid grid-cols-3 gap-1">
					{FX_OPTIONS.map((o) => (
						<Chip key={o.value} data={`fx-${o.value}`} active={fx.kind === o.value} onClick={() => setFx({ kind: o.value })}>
							{o.label}
						</Chip>
					))}
				</div>
			</InspectorRow>
			{fx.kind === "filter" && (
				<InspectorRow label="Look" stacked>
					<div className="grid grid-cols-3 gap-1">
						{LOOK_OPTIONS.map((o) => (
							<Chip key={o.value} data={`look-${o.value}`} active={(fx.look ?? "bw") === o.value} onClick={() => setFx({ look: o.value })}>
								{o.label}
							</Chip>
						))}
					</div>
				</InspectorRow>
			)}
			{fx.kind !== "none" && (
				<>
					<TrackerSlider
						label="Strength"
						value={fx.amount}
						min={0}
						max={1}
						step={0.01}
						format={(v) => `${Math.round(v * 100)}%`}
						onPreview={(v) => setFx({ amount: v }, false)}
						onCommit={(v) => setFx({ amount: v })}
					/>
					<TrackerSlider
						label="Size"
						value={fx.expand}
						min={0.6}
						max={3}
						step={0.05}
						format={(v) => `${v.toFixed(2)}×`}
						onPreview={(v) => setFx({ expand: v }, false)}
						onCommit={(v) => setFx({ expand: v })}
					/>
					<TrackerSlider
						label="Softness"
						value={fx.feather}
						min={0}
						max={1}
						step={0.01}
						format={(v) => `${Math.round(v * 100)}%`}
						onPreview={(v) => setFx({ feather: v }, false)}
						onCommit={(v) => setFx({ feather: v })}
					/>
					<InspectorRow label="Shape">
						<Segmented
							label="Shape"
							value={fx.shape}
							options={[
								{ value: "ellipse", label: "Oval" },
								{ value: "rect", label: "Box" },
							]}
							onChange={(shape) => setFx({ shape })}
						/>
					</InspectorRow>
				</>
			)}
			<TrackerSlider
				label="Smoothing"
				value={tracker.smoothing}
				min={0}
				max={1}
				step={0.01}
				format={(v) => `${Math.round(v * 100)}%`}
				onPreview={(v) => previewTracker(editor, clip.id, tracker.id, { smoothing: v })}
				onCommit={(v) => {
					editor.timeline.discardPreview();
					updateTracker(editor, clip.id, tracker.id, { smoothing: v });
				}}
			/>
			<div className="grid grid-cols-2 gap-1">
				<Chip
					data="edit-box"
					active={editing}
					onClick={() => useMotionStore.getState().setDraw(editing ? null : { elementId: clip.id, mode: "edit", trackerId: tracker.id })}
				>
					{editing ? "Done" : "Edit box"}
				</Chip>
				<Chip data="delete-tracker" onClick={() => removeTracker(editor, clip.id, tracker.id)}>
					Delete
				</Chip>
			</div>
			{editing && <p className="text-muted-foreground text-[11px]">Drag the box (or its corner) on the preview to fix this frame; nearby frames follow.</p>}
			<InspectorRow label="Re-track from here" hint="Tracks again from the playhead with the box as it is here; the other side is kept">
				<div className="grid grid-cols-2 gap-1">
					<Chip data="retrack-back" disabled={busy} onClick={() => retrack("backward")}>
						← Back
					</Chip>
					<Chip data="retrack" disabled={busy} onClick={() => retrack("forward")}>
						Forward →
					</Chip>
				</div>
			</InspectorRow>
			<InspectorRow label="Attached" stacked>
				<AttachLayer clip={clip} tracker={tracker} attached={followers.map((f) => f.element.id)} />
				{followers.length ? (
					<div className="flex flex-col gap-1" data-tracker-followers>
						{followers.map((f) => (
							<div key={f.element.id} className="flex items-center gap-2 text-xs">
								<span className="min-w-0 flex-1 truncate">{f.element.name}</span>
								<button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => detachFollower(editor, f.element.id)}>
									Detach
								</button>
							</div>
						))}
					</div>
				) : null}
			</InspectorRow>
		</div>
	);
}

function findTrackerOf(tracks: SceneTracks | null, clipId: string, trackerId: string): Tracker | null {
	if (!tracks) return null;
	for (const track of [tracks.main, ...tracks.overlay] as TimelineTrack[]) {
		for (const el of track.elements as TimelineElement[]) {
			if (el.id === clipId && el.type === "video") return (el as VideoElement).trackers?.find((t) => t.id === trackerId) ?? null;
		}
	}
	return null;
}

const ATTACHABLE = new Set(["text", "sticker", "image", "video", "graphic"]);

/** «Attach a layer…» on a tracked object: any visual layer above the clip moves with it (one ⌘Z). */
function AttachLayer({ clip, tracker, attached }: { clip: VideoElement; tracker: Tracker; attached: string[] }) {
	const editor = useEditor();
	const tracks = useEditor((e) => e.scenes.getActiveSceneOrNull()?.tracks ?? null, ["scenes", "timeline"]);
	const layers = useMemo(() => {
		if (!tracks) return [];
		return (tracks.overlay as TimelineTrack[]).flatMap((track) =>
			(track.elements as TimelineElement[]).filter((el) => ATTACHABLE.has(el.type) && el.id !== clip.id && !attached.includes(el.id)),
		);
	}, [tracks, clip.id, attached]);
	if (!layers.length) return null;
	return (
		<select
			aria-label="Attach a layer"
			title="A layer above this clip (text, sticker, photo, video, graphic) moves with the tracked object"
			data-tracker-attach
			value=""
			onChange={(e) => {
				if (e.target.value) attachFollower(editor, e.target.value, clip.id, tracker.id, {});
			}}
			className="bg-accent border-border mb-1 h-7 w-full min-w-0 rounded-md border px-1.5 text-xs"
		>
			<option value="">Attach a layer…</option>
			{layers.map((el) => (
				<option key={el.id} value={el.id}>
					{el.name}
				</option>
			))}
		</select>
	);
}

/** Tracker: find and follow a face, a subject (click) or an object (drawn box) through the clip. */
export function TrackerSection({ element }: { element: VideoElement; trackId: string }) {
	const editor = useEditor();
	const jobs = useMotionStore((s) => s.jobs);
	const draw = useMotionStore((s) => s.draw);
	const selected = useMotionStore((s) => s.selected[element.id]);
	const job = jobFor(jobs, element.id, "track");
	const trackers = element.trackers ?? [];
	const current = trackers.find((t) => t.id === selected) ?? trackers[trackers.length - 1] ?? null;
	const busy = job?.status === "running";
	const drawing = draw?.elementId === element.id && draw.mode !== "edit" ? draw : null;

	const start = (kind: TrackerKind) => {
		editor.selection.setSelectedElements({ elements: [{ trackId: locateTrack(editor, element.id) ?? "", elementId: element.id }] });
		if (kind === "face") {
			useMotionStore.getState().setDraw(null);
			void trackClip({ elementId: element.id, kind: "face" });
			return;
		}
		useMotionStore.getState().setDraw({ elementId: element.id, mode: kind === "subject" ? "subject" : "object", kind });
	};

	return (
		<InspectorGroup id="motion.tracker" title="Tracker">
			<div className="flex flex-col gap-2" data-motion-section="tracker">
				<InspectorRow label="Track" stackWhenNarrow>
					<div className="grid grid-cols-3 gap-1">
						<Chip data="track-face" disabled={busy} onClick={() => start("face")}>
							Face
						</Chip>
						<Chip data="track-subject" disabled={busy} active={drawing?.mode === "subject"} onClick={() => start("subject")}>
							Subject
						</Chip>
						<Chip data="track-object" disabled={busy} active={drawing?.mode === "object"} onClick={() => start("object")}>
							Object
						</Chip>
					</div>
				</InspectorRow>
				{drawing && (
					<div className="bg-primary/10 border-primary/40 flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs" data-motion-draw-hint>
						<span className="min-w-0 flex-1">
							{drawing.mode === "subject" ? "Click the person or thing on the preview." : "Drag a box around the object on the preview."}
						</span>
						<button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => useMotionStore.getState().setDraw(null)}>
							Cancel
						</button>
					</div>
				)}
				<MotionJobLine job={job} />
				{trackers.length > 0 && (
					<div className="flex flex-col gap-1" role="listbox" aria-label="Trackers" data-tracker-list>
						{trackers.map((t) => (
							<button
								key={t.id}
								type="button"
								role="option"
								aria-selected={current?.id === t.id}
								data-tracker-row={t.id}
								onClick={() => useMotionStore.getState().select(element.id, t.id)}
								className={cn(
									"flex h-7 items-center gap-2 rounded-md border px-2 text-left text-xs",
									current?.id === t.id ? "border-primary/60 bg-primary/10" : "border-border hover:bg-accent",
								)}
							>
								<span className="min-w-0 flex-1 truncate">{t.name}</span>
								{t.fx && t.fx.kind !== "none" && <span className="text-muted-foreground">{FX_OPTIONS.find((o) => o.value === t.fx?.kind)?.label}</span>}
								<span className="text-muted-foreground tabular-nums">{t.samples.length}f</span>
							</button>
						))}
					</div>
				)}
				{current && <TrackerDetails clip={element} tracker={current} busy={busy} />}
			</div>
		</InspectorGroup>
	);
}

function locateTrack(editor: EditorCore, elementId: string): string | null {
	const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
	if (!tracks) return null;
	for (const track of [tracks.main, ...tracks.overlay] as TimelineTrack[]) {
		if ((track.elements as TimelineElement[]).some((e) => e.id === elementId)) return track.id;
	}
	return null;
}

/** Make vertical / Reframe: converts to 9:16 (or 4:5, 1:1, 16:9) keeping the face / subject in frame. */
export function MakeVerticalSection({ element }: { element: VideoElement; trackId: string }) {
	const editor = useEditor();
	const [aspect, setAspect] = useState<AspectId>("9:16");
	const [busy, setBusy] = useState(false);
	const selectedVideos = () => {
		const ids = new Set(editor.selection.getSelectedElements().map((s) => s.elementId));
		ids.add(element.id);
		return [...ids].filter((id) => {
			const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
			if (!tracks) return false;
			return ([tracks.main, ...tracks.overlay] as TimelineTrack[]).some((t) => (t.elements as TimelineElement[]).some((e) => e.id === id && e.type === "video"));
		});
	};
	const go = async (target: AspectId | null) => {
		setBusy(true);
		try {
			await reframeClips(selectedVideos(), target);
		} finally {
			setBusy(false);
		}
	};
	return (
		<InspectorGroup id="motion.make-vertical" title="Make vertical">
			<div className="flex flex-col gap-2" data-motion-section="make-vertical">
				<InspectorRow label="Aspect" stackWhenNarrow>
					<Segmented label="Aspect" value={aspect} options={ASPECTS.map((a) => ({ value: a.id, label: a.id, title: a.label }))} onChange={setAspect} />
				</InspectorRow>
				<div className="grid grid-cols-2 gap-1">
					<Chip data="make-aspect" disabled={busy} onClick={() => void go(aspect)}>
						{busy ? "Working…" : `Make ${aspect}`}
					</Chip>
					<Chip data="keep-in-frame" disabled={busy} onClick={() => void go(null)}>
						Keep in frame
					</Chip>
				</div>
			</div>
		</InspectorGroup>
	);
}

/** Follow: this layer moves with a tracker of a video clip (keeps its distance; optional scaling). */
export function FollowSection({ element }: { element: TimelineElement; trackId: string }) {
	const editor = useEditor();
	const tracks = useEditor((e) => e.scenes.getActiveSceneOrNull()?.tracks ?? null, ["scenes", "timeline"]);
	const options = useMemo(() => {
		const out: Array<{ value: string; label: string; clipId: string; trackerId: string }> = [];
		if (!tracks) return out;
		// The pieces of a split clip carry the same tracker: listed once.
		const seen = new Set<string>();
		for (const track of [tracks.main, ...tracks.overlay] as TimelineTrack[]) {
			for (const el of track.elements as TimelineElement[]) {
				if (el.type !== "video" || el.id === element.id) continue;
				for (const t of (el as VideoElement).trackers ?? []) {
					if (seen.has(t.id)) continue;
					seen.add(t.id);
					out.push({ value: `${el.id}:${t.id}`, label: `${t.name} · ${el.name}`, clipId: el.id, trackerId: t.id });
				}
			}
		}
		return out;
	}, [tracks, element.id]);
	const link = element.follow;
	const current = link ? (options.find((o) => o.clipId === link.clipId && o.trackerId === link.trackerId) ?? options.find((o) => o.trackerId === link.trackerId)) : undefined;
	const flags = { move: link?.move !== false, scale: !!link?.size0, rotate: link?.angle0 !== undefined };
	const scale = flags.scale;
	const tracker = current ? findTrackerOf(tracks, current.clipId, current.trackerId) : null;

	// Nothing to follow yet (no tracker on any clip): the group stays out of the way.
	if (options.length === 0) return null;
	return (
		<InspectorGroup id="motion.follow" title="Follow">
			<div className="flex flex-col gap-2" data-motion-section="follow">
						<InspectorRow label="Tracker">
							<select
								aria-label="Follow tracker"
								data-follow-select
								value={current?.value ?? ""}
								onChange={(e) => {
									const o = options.find((x) => x.value === e.target.value);
									if (o) attachFollower(editor, element.id, o.clipId, o.trackerId, { scale });
									else detachFollower(editor, element.id);
								}}
								className="bg-accent border-border h-7 w-full min-w-0 rounded-md border px-1.5 text-xs"
							>
								<option value="">None</option>
								{options.map((o) => (
									<option key={o.value} value={o.value}>
										{o.label}
									</option>
								))}
							</select>
						</InspectorRow>
						{current && (
							<>
								{(
									[
										["move", "Move with it", "The layer keeps its place on the object"],
										["scale", "Scale with it", "The layer (and its distance) grows and shrinks with the object"],
										["rotate", "Rotate with it", "The layer turns with the object, around it"],
									] as const
								).map(([key, label, hint]) => (
									<InspectorRow key={key} label={label} hint={hint}>
										<div className="flex justify-end">
											<Switch
												aria-label={label}
												data-follow-option={key}
												checked={flags[key]}
												onCheckedChange={(on) => attachFollower(editor, element.id, current.clipId, current.trackerId, { ...flags, [key]: on })}
											/>
										</div>
									</InspectorRow>
								))}
								{tracker && (
									<TrackerSlider
										label="Smoothing"
										value={tracker.smoothing}
										min={0}
										max={1}
										step={0.01}
										format={(v) => `${Math.round(v * 100)}%`}
										onPreview={(v) => previewTracker(editor, current.clipId, current.trackerId, { smoothing: v })}
										onCommit={(v) => {
											editor.timeline.discardPreview();
											updateTracker(editor, current.clipId, current.trackerId, { smoothing: v });
										}}
									/>
								)}
							</>
						)}
			</div>
		</InspectorGroup>
	);
}
