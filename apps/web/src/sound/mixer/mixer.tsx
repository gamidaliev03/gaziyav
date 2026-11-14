"use client";

// The mixer: a strip per track with sound, and the master — docked at the right of the timeline, beside the level
// meter (which is the master's meter). Every control is a view of a value the project already holds (levels.ts):
// the clips' volume and pan, the track's mute and solo, the timeline's master. A drag is previewed live through the
// timeline's own preview and stored on release as ONE step.
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import { KeyframeToggle } from "@/components/editor/panels/properties/components/keyframe-toggle";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Hint } from "@/components/ui/tooltip";
import type { MeterTap } from "@/core/managers/audio-manager";
import { useEditor } from "@/editor/use-editor";
import { crossesDetent, haptic } from "@/haptics";
import { useT } from "@/i18n";
import { type MeterState, amplitudeToDb, createMeterState, isMeterAtRest, meterFraction, samplePeak, stepMeter } from "@/media/level-meter";
import type { MediaTime } from "@/wasm";
import { cn } from "@/utils/ui";
import { commitMaster, toggleSolo } from "../actions";
import { BalanceButton } from "../balance/button";
import { MASTER_DB_MAX, type MasterMix, masterOf } from "../master";
import { resolve as silencedOf } from "../solo";
import { currentTarget } from "../target-pref";
import { ceilingFor, formatTarget } from "../targets";
import { useSoundUi } from "../ui-store";
import { FADER_MAX_DB, FADER_MIN_DB, FADER_TICKS_DB, faderDb, faderPosition, formatDb, formatPan, tenth } from "./fader-law";
import { type Strip, type StripReading, VOLUME_PATH, clipAt, keyVolume, localTime, readStrip, shiftPans, shiftVolumes, stripsOf } from "./levels";

export const STRIP_WIDTH_PX = 56;
/** The header's own needs: the mixer is never narrower than this. */
const MIN_WIDTH_PX = 168;

// ───────────────────────── the fader ─────────────────────────

const THUMB_HEIGHT = 12;

/**
 * A vertical fader on the console's law. It is grabbed where it is pressed (the level never jumps to the pointer),
 * ⇧ moves it four times finer, a double-click or ⌥-click puts it at 0 dB, the arrow keys step it by half a dB.
 */
function Fader({
	value,
	label,
	disabled = false,
	max = FADER_MAX_DB,
	onStart,
	onChange,
	onCommit,
	onCancel,
	dataId,
}: {
	value: number;
	label: string;
	disabled?: boolean;
	max?: number;
	onStart: () => void;
	onChange: (db: number) => void;
	onCommit: () => void;
	onCancel: () => void;
	dataId: string;
}) {
	const slot = useRef<HTMLDivElement>(null);
	const drag = useRef<{ y: number; position: number; last: number; moved: boolean } | null>(null);
	const [live, setLive] = useState<number | null>(null);
	const shown = live ?? value;
	const position = faderPosition(shown);
	const height = () => Math.max(1, (slot.current?.clientHeight ?? 1) - THUMB_HEIGHT);
	const step = (db: number) => {
		onStart();
		onChange(tenth(Math.min(max, Math.max(FADER_MIN_DB, db))));
		onCommit();
	};
	return (
		<div
			ref={slot}
			role="slider"
			tabIndex={disabled ? -1 : 0}
			aria-label={label}
			aria-orientation="vertical"
			aria-valuemin={FADER_MIN_DB}
			aria-valuemax={max}
			aria-valuenow={tenth(shown)}
			aria-valuetext={`${formatDb(shown)} dB`}
			aria-disabled={disabled || undefined}
			data-mixer-fader={dataId}
			className={cn("group/fader focus-visible:ring-ring relative h-full w-[22px] touch-none rounded-sm outline-hidden focus-visible:ring-1", disabled ? "opacity-40" : "cursor-grab active:cursor-grabbing")}
			onPointerDown={(event) => {
				if (disabled || event.button !== 0) return;
				event.preventDefault();
				event.currentTarget.focus({ preventScroll: true });
				if (event.altKey) {
					step(0);
					return;
				}
				event.currentTarget.setPointerCapture(event.pointerId);
				drag.current = { y: event.clientY, position: faderPosition(value), last: value, moved: false };
				onStart();
			}}
			onPointerMove={(event) => {
				const d = drag.current;
				if (!d || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
				const fine = event.shiftKey ? 0.25 : 1;
				// the cap's own place is carried along unrounded (a slow drag adds up); ⇧ pressed or let go mid-drag goes on from there
				d.position = Math.min(faderPosition(max), Math.max(0, d.position - ((event.clientY - d.y) * fine) / height()));
				d.y = event.clientY;
				const next = tenth(Math.min(max, faderDb(d.position)));
				if (next === d.last) return;
				if (crossesDetent(d.last, next, [0])) haptic("limit");
				d.last = next;
				d.moved = true;
				setLive(next);
				onChange(next);
			}}
			onPointerUp={(event) => {
				const d = drag.current;
				if (!d) return;
				drag.current = null;
				if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
				setLive(null);
				if (d.moved) onCommit();
				else onCancel();
			}}
			onLostPointerCapture={() => {
				const d = drag.current;
				if (!d) return;
				drag.current = null;
				setLive(null);
				if (d.moved) onCommit();
				else onCancel();
			}}
			onDoubleClick={() => {
				if (!disabled) step(0);
			}}
			onKeyDown={(event) => {
				if (disabled) return;
				if (event.key === "Escape" && drag.current) {
					drag.current = null;
					setLive(null);
					onCancel();
					return;
				}
				const by = event.shiftKey ? 0.1 : 0.5;
				const delta: Record<string, number> = { ArrowUp: by, ArrowDown: -by, PageUp: 3, PageDown: -3 };
				if (event.key in delta) step(value + delta[event.key]);
				else if (event.key === "Home") step(0);
				else return;
				event.preventDefault();
				event.stopPropagation();
			}}
		>
			{/* the well, the mark at 0 dB, the cap */}
			<div className="bg-accent absolute top-[6px] bottom-[6px] left-1/2 w-[3px] -translate-x-1/2 rounded-full" />
			<div className="bg-foreground/40 absolute left-[3px] h-px w-[16px]" style={{ bottom: `calc(${faderPosition(0) * 100}% - ${faderPosition(0) * THUMB_HEIGHT}px + ${THUMB_HEIGHT / 2}px)` }} />
			<div
				data-mixer-fader-cap=""
				className="border-border bg-secondary absolute left-0 w-full rounded-[3px] border shadow-sm group-hover/fader:border-foreground/40"
				style={{ height: THUMB_HEIGHT, bottom: `calc(${position * 100}% - ${position * THUMB_HEIGHT}px)` }}
			>
				<div className="bg-foreground/70 absolute top-1/2 right-[3px] left-[3px] h-px -translate-y-1/2" />
			</div>
		</div>
	);
}

/** The dB marks beside a fader: only as many as the height has room for. */
function FaderScale() {
	return (
		<div aria-hidden className="text-muted-foreground relative h-full w-[14px] text-[8px] leading-none tabular-nums">
			{FADER_TICKS_DB.map((db) => (
				<span
					key={db}
					className={cn("absolute right-0 -translate-y-1/2", (db === 6 || db === -6 || db === -36) && "@max-[9rem]/strip:hidden", (db === 12 || db === -24) && "@max-[5.5rem]/strip:hidden")}
					style={{ bottom: `calc(${faderPosition(db) * 100}% - ${faderPosition(db) * THUMB_HEIGHT}px + ${THUMB_HEIGHT / 2}px - 4px)` }}
				>
					{Math.abs(db)}
				</span>
			))}
		</div>
	);
}

// ───────────────────────── meters (one frame loop for every strip) ─────────────────────────

interface MeterSlot {
	canvas: HTMLCanvasElement;
	trackId: string;
	state: MeterState;
	tap: MeterTap | null;
	buffers: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>];
}

function drawMeter(slot: MeterSlot) {
	const canvas = slot.canvas;
	const width = canvas.clientWidth;
	const height = canvas.clientHeight;
	if (width < 2 || height < 8) return;
	const dpr = Math.max(1, window.devicePixelRatio || 1);
	if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
	}
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, width, height);
	const bar = Math.max(2, Math.floor((width - 1) / 2));
	const gradient = ctx.createLinearGradient(0, height, 0, 0);
	// the level meter's own colours (timeline/components/level-meter.tsx)
	for (const [db, color] of [[-60, "#2bb673"], [-18, "#34d399"], [-10, "#a3e635"], [-6, "#fbbf24"], [-2, "#fb923c"], [0, "#f43f5e"]] as const) gradient.addColorStop(meterFraction(db), color);
	for (let c = 0; c < 2; c++) {
		const x = c * (bar + 1);
		const channel = slot.state.channels[c];
		ctx.fillStyle = "rgba(128,128,128,0.16)";
		ctx.fillRect(x, 0, bar, height);
		const level = meterFraction(amplitudeToDb(channel.level)) * height;
		ctx.fillStyle = gradient;
		if (level > 0) ctx.fillRect(x, height - level, bar, level);
		const hold = amplitudeToDb(channel.hold);
		if (hold > -60) ctx.fillRect(x, Math.max(0, Math.round(height - meterFraction(hold) * height) - 1), bar, 2);
	}
	if (slot.state.clipped) {
		ctx.fillStyle = "#f43f5e";
		ctx.fillRect(0, 0, bar * 2 + 1, 3);
	}
}

/** Registers strip meters and runs them while the film plays (and until they have fallen back to rest). */
function useMeters() {
	const editor = useEditor();
	const slots = useRef(new Map<string, MeterSlot>());
	const control = useRef<{ kick: () => void } | null>(null);

	useEffect(() => {
		let raf: number | null = null;
		let last = 0;
		let playing = editor.playback.getIsPlaying();
		const release = () => {
			for (const slot of slots.current.values()) {
				slot.tap?.release();
				slot.tap = null;
			}
		};
		const frame = (now: number) => {
			raf = null;
			const dtMs = last ? Math.min(250, now - last) : 16;
			last = now;
			let resting = true;
			for (const slot of slots.current.values()) {
				const peaks: [number, number] = [0, 0];
				if (playing) {
					slot.tap ??= editor.audio.acquireTrackMeter(slot.trackId);
					if (slot.tap) {
						for (let c = 0; c < 2; c++) {
							slot.tap.analysers[c].getFloatTimeDomainData(slot.buffers[c]);
							peaks[c] = samplePeak(slot.buffers[c]);
						}
					}
				}
				stepMeter({ state: slot.state, peaks, now, dtMs });
				drawMeter(slot);
				// the held peak, for a reader of the page (the proofs): written only when it changes by a tenth of a dB
				const held = Math.round(amplitudeToDb(Math.max(slot.state.channels[0].hold, slot.state.channels[1].hold)) * 10) / 10;
				const text = held > -60 ? String(held) : "";
				if (slot.canvas.dataset.holdDb !== text) slot.canvas.dataset.holdDb = text;
				if (!isMeterAtRest(slot.state)) resting = false;
			}
			if (!playing && resting) {
				release();
				return;
			}
			raf = requestAnimationFrame(frame);
		};
		const kick = () => {
			if (raf === null) {
				last = 0;
				raf = requestAnimationFrame(frame);
			}
		};
		control.current = { kick };
		const off = editor.playback.subscribe(() => {
			const next = editor.playback.getIsPlaying();
			if (next === playing) return;
			playing = next;
			if (playing) for (const slot of slots.current.values()) slot.state.clipped = false;
			kick();
		});
		kick();
		return () => {
			off();
			if (raf !== null) cancelAnimationFrame(raf);
			release();
			control.current = null;
		};
	}, [editor]);

	return useCallback((trackId: string, canvas: HTMLCanvasElement | null) => {
		const had = slots.current.get(trackId);
		if (!canvas) {
			had?.tap?.release();
			slots.current.delete(trackId);
			return;
		}
		if (had?.canvas === canvas) return;
		had?.tap?.release();
		slots.current.set(trackId, { canvas, trackId, state: createMeterState(), tap: null, buffers: [new Float32Array(2048), new Float32Array(2048)] });
		control.current?.kick();
	}, []);
}

// ───────────────────────── a track's strip ─────────────────────────

const smallKey = "focus-visible:ring-ring flex h-[22px] w-6 cursor-pointer items-center justify-center rounded-[5px] text-[11px] font-semibold outline-hidden transition-colors focus-visible:ring-1";

const StripView = memo(function StripView({
	strip,
	reading,
	silenced,
	registerMeter,
}: {
	strip: Strip;
	reading: StripReading | null;
	/** Not heard because another track is soloed. */
	silenced: boolean;
	registerMeter: (trackId: string, canvas: HTMLCanvasElement | null) => void;
}) {
	const editor = useEditor();
	const t = useT();
	const name = strip.name ?? (strip.kind === "main" ? t("Main") : `${t(strip.kind === "video" ? "Video" : "Audio")}${strip.number ? ` ${strip.number}` : ""}`);
	const drag = useRef<{ startDb: number; startPan: number; clips: Strip["clips"]; key: { clip: Strip["clips"][number]; local: MediaTime } | null } | null>(null);

	/** What the strip stands on right now, from the stored (not the previewed) clips. */
	const begin = () => {
		const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
		const stored = tracks ? stripsOf(tracks, editor.media.getAssets()).find((s) => s.trackId === strip.trackId) : null;
		if (!stored) return null;
		const time = editor.playback.getCurrentTime();
		const now = readStrip(stored, time);
		const at = clipAt(stored.clips, time);
		if (!now || !at) return null;
		drag.current = { startDb: now.volumeDb, startPan: now.pan, clips: stored.clips, key: now.keyed ? { clip: at.clip, local: localTime(at.clip, time) } : null };
		return drag.current;
	};
	const preview = (patches: Array<{ elementId: string; updates: Parameters<typeof editor.timeline.previewElements>[0]["updates"][number]["updates"] }>) =>
		editor.timeline.previewElements({ updates: patches.map((patch) => ({ trackId: strip.trackId, elementId: patch.elementId, updates: patch.updates })) });
	const commit = () => {
		drag.current = null;
		editor.timeline.commitPreview();
	};
	const cancel = () => {
		drag.current = null;
		editor.timeline.discardPreview();
	};
	const quiet = strip.muted || silenced;
	// one ref for the strip's life: a new function each render would take the meter down and put it up again
	const trackId = strip.trackId;
	const meterRef = useCallback((node: HTMLCanvasElement | null) => registerMeter(trackId, node), [registerMeter, trackId]);

	return (
		<div data-mixer-strip={strip.trackId} data-mixer-kind={strip.kind} className="@container/strip flex h-full shrink-0 flex-col items-center gap-1 border-r px-1 pt-1 pb-0.5 last:border-r-0" style={{ width: STRIP_WIDTH_PX }}>
			<button
				type="button"
				data-mixer-name=""
				title={`${name} — ${t("click to select its clips")}`}
				onClick={(event) => {
					const own = strip.clips.map((clip) => ({ trackId: strip.trackId, elementId: clip.id }));
					const current = event.metaKey || event.shiftKey ? editor.selection.getSelectedElements() : [];
					const seen = new Set(current.map((ref) => ref.elementId));
					editor.selection.setSelectedElements({ elements: [...current, ...own.filter((ref) => !seen.has(ref.elementId))] });
				}}
				className={cn("hover:text-foreground h-[18px] w-full shrink-0 cursor-pointer truncate rounded-sm text-center text-[11px] leading-[18px]", quiet ? "text-muted-foreground" : "text-foreground/90")}
			>
				{name}
			</button>

			{/* pan: every clip of the track together */}
			<Hint label={`${t("Pan")}: ${formatPan(reading?.pan ?? 0)}`} side="top">
				<div className="flex h-[18px] w-full shrink-0 items-center px-0.5" data-mixer-pan={strip.trackId} onDoubleClick={() => { const d = begin(); if (d) { preview(shiftPans(d.clips, -d.startPan)); commit(); } }}>
					<Slider
						aria-label={`${t("Pan")}: ${name}`}
						min={-100}
						max={100}
						step={1}
						origin={0}
						thumbSize={10}
						value={[Math.round(reading?.pan ?? 0)]}
						disabled={!reading}
						trackClassName="h-[3px]"
						rangeClassName="bg-foreground/60"
						thumbClassName="size-2.5 border-foreground/50"
						onPointerDown={() => void begin()}
						onValueChange={([value]) => {
							const d = drag.current ?? begin();
							if (d) preview(shiftPans(d.clips, value - d.startPan));
						}}
						onValueCommit={commit}
					/>
				</div>
			</Hint>

			<div className="flex h-6 shrink-0 items-center gap-0.5">
				<Hint label={strip.muted ? t("Unmute track") : silenced ? t("Silent: another track is soloed") : t("Mute track")} side="top">
					<button
						type="button"
						aria-label={`${t("Mute")}: ${name}`}
						aria-pressed={strip.muted}
						data-mixer-mute={strip.trackId}
						data-implied={silenced && !strip.muted ? "" : undefined}
						onClick={() => editor.timeline.toggleTrackMute({ trackId: strip.trackId })}
						className={cn(smallKey, strip.muted ? "bg-destructive/20 text-destructive" : silenced ? "text-destructive/60 ring-destructive/40 ring-1 ring-inset" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
					>
						M
					</button>
				</Hint>
				<Hint label={strip.solo ? t("Solo off") : t("Solo: hear only this track (⌥-click: only this one)")} side="top">
					<button
						type="button"
						aria-label={`${t("Solo")}: ${name}`}
						aria-pressed={strip.solo}
						data-mixer-solo={strip.trackId}
						onClick={(event) => toggleSolo(editor, strip.trackId, event.altKey)}
						className={cn(smallKey, strip.solo ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
					>
						S
					</button>
				</Hint>
			</div>

			<div className="flex min-h-[44px] w-full flex-1 items-stretch justify-center gap-[3px]">
				<FaderScale />
				<Fader
					dataId={strip.trackId}
					label={reading?.keyed ? `${t("Volume at this keyframe")}: ${name}` : `${t("Volume of the whole track")}: ${name}`}
					value={Math.min(FADER_MAX_DB, reading?.volumeDb ?? 0)}
					disabled={!reading}
					onStart={() => void begin()}
					onChange={(db) => {
						const d = drag.current;
						if (!d) return;
						preview(d.key ? [keyVolume(d.key.clip, d.key.local, db)] : shiftVolumes(d.clips, db - d.startDb));
					}}
					onCommit={commit}
					onCancel={cancel}
				/>
				<canvas ref={meterRef} aria-hidden data-mixer-meter={strip.trackId} className="my-[6px] w-[9px]" />
			</div>

			<div className="flex h-6 w-full shrink-0 items-center justify-between pl-0.5">
				<span data-mixer-value={strip.trackId} title={reading?.keyed ? t("Volume at this keyframe") : t("Volume of the whole track")} className={cn("text-[10px] tabular-nums", quiet ? "text-muted-foreground" : "text-foreground/90")}>
					{reading ? formatDb(reading.volumeDb) : "—"}
				</span>
				<KeyframeToggle
					isActive={!!reading?.keyed}
					isAnimated={!!reading?.animated}
					isDisabled={!reading?.under}
					title={reading?.keyed ? t("Remove the volume keyframe") : t("Volume keyframe at the playhead")}
					onToggle={() => {
						const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
						const stored = tracks ? stripsOf(tracks, editor.media.getAssets()).find((s) => s.trackId === strip.trackId) : null;
						const time = editor.playback.getCurrentTime();
						const at = stored ? clipAt(stored.clips, time) : null;
						const now = stored ? readStrip(stored, time) : null;
						if (!at?.under || !now) return;
						const local = localTime(at.clip, time);
						const channel = at.clip.animations?.[VOLUME_PATH] as { keys?: Array<{ id: string; time: number }> } | undefined;
						const key = channel?.keys?.find((k) => k.time === local);
						if (key) editor.timeline.removeKeyframes({ keyframes: [{ trackId: strip.trackId, elementId: at.clip.id, propertyPath: VOLUME_PATH, keyframeId: key.id }] });
						else editor.timeline.upsertKeyframes({ keyframes: [{ trackId: strip.trackId, elementId: at.clip.id, propertyPath: VOLUME_PATH, time: local, value: Math.round(now.volumeDb * 100) / 100 }] });
					}}
				/>
			</div>
		</div>
	);
});

// ───────────────────────── the master ─────────────────────────

function MasterStrip() {
	const editor = useEditor();
	const t = useT();
	const master = useEditor((e) => masterOf(e.scenes.getActiveSceneOrNull()?.tracks), ["timeline", "scenes"]);
	const reduction = useRef<HTMLSpanElement>(null);
	const pending = useRef<MasterMix | null>(null);
	const limiterOn = master.ceilingDb !== undefined;

	// how deep the player's limiter goes while the film plays
	useEffect(() => {
		if (!limiterOn) return;
		let shown = "";
		let held = 0;
		let until = 0;
		const timer = setInterval(() => {
			const now = performance.now();
			const db = editor.playback.getIsPlaying() ? editor.audio.takeLimiterReduction() : 0;
			if (db < held || now > until) {
				held = db;
				until = now + 1200;
			}
			const text = held < -0.05 ? formatDb(held) : "";
			if (text !== shown && reduction.current) {
				shown = text;
				reduction.current.textContent = text;
			}
		}, 150);
		return () => clearInterval(timer);
	}, [editor, limiterOn]);

	return (
		<div data-mixer-strip="master" className="@container/strip flex h-full shrink-0 flex-col items-center gap-1 px-1 pt-1 pb-0.5" style={{ width: STRIP_WIDTH_PX }}>
			<span className="text-foreground/90 h-[18px] w-full shrink-0 truncate text-center text-[11px] leading-[18px] font-medium">{t("Master")}</span>
			<Hint label={limiterOn ? t("Limiter on: peaks held at {tp} dBTP, in the player and in the export", { tp: formatTarget(master.ceilingDb ?? -1) }) : t("Limiter: hold the peaks at {tp} dBTP", { tp: formatTarget(ceilingFor(currentTarget())) })} side="top">
				<button
					type="button"
					aria-pressed={limiterOn}
					aria-label={t("Limiter")}
					data-mixer-limiter=""
					onClick={() => commitMaster(editor, limiterOn ? { gainDb: master.gainDb } : { gainDb: master.gainDb, ceilingDb: ceilingFor(currentTarget()) })}
					className={cn("focus-visible:ring-ring h-[18px] w-full shrink-0 cursor-pointer rounded-[5px] text-[9px] font-semibold tracking-wide outline-hidden transition-colors focus-visible:ring-1", limiterOn ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
				>
					LIM
				</button>
			</Hint>
			<span ref={reduction} data-mixer-reduction="" title={t("How much the limiter is holding back")} className="text-caution flex h-6 shrink-0 items-center text-[10px] tabular-nums" />
			<div className="flex min-h-[44px] w-full flex-1 items-stretch justify-center gap-[3px]">
				<FaderScale />
				<Fader
					dataId="master"
					label={t("Master volume")}
					value={Math.min(FADER_MAX_DB, master.gainDb)}
					max={Math.min(FADER_MAX_DB, MASTER_DB_MAX)}
					onStart={() => {
						pending.current = master;
					}}
					onChange={(db) => {
						pending.current = { ...master, gainDb: db };
						editor.audio.previewMaster(db);
					}}
					onCommit={() => {
						const next = pending.current;
						pending.current = null;
						if (next) commitMaster(editor, next);
						editor.audio.previewMaster(null);
					}}
					onCancel={() => {
						pending.current = null;
						editor.audio.previewMaster(null);
					}}
				/>
				<span className="w-[9px]" />
			</div>
			<div className="flex h-6 w-full shrink-0 items-center justify-center">
				<span data-mixer-value="master" className="text-foreground/90 text-[10px] tabular-nums">
					{formatDb(master.gainDb)}
				</span>
			</div>
		</div>
	);
}

// ───────────────────────── the dock ─────────────────────────

export default function Mixer({ headerHeight }: { headerHeight: number }) {
	const editor = useEditor();
	const t = useT();
	const close = useSoundUi((s) => s.setMixerOpen);
	const tracks = useEditor((e) => e.timeline.getPreviewTracks() ?? e.scenes.getActiveSceneOrNull()?.tracks ?? null, ["timeline", "scenes"]);
	const assets = useEditor((e) => e.media.getAssets(), ["media"]);
	const strips = useMemo(() => (tracks ? stripsOf(tracks, assets) : []), [tracks, assets]);
	const silenced = useMemo(() => (tracks ? silencedOf(tracks, tracks, []) : new Set<string>()), [tracks]);
	// what each strip reads at the playhead, as one string: the strips re-render only when a reading changes
	const readingsKey = useEditor(
		(e) => {
			const time = e.playback.getCurrentTime();
			return strips
				.map((strip) => {
					const r = readStrip(strip, time);
					return r ? `${r.clipId}|${r.under ? 1 : 0}|${Math.round(r.volumeDb * 10)}|${Math.round(r.pan)}|${r.animated ? 1 : 0}|${r.keyed ? 1 : 0}` : "";
				})
				.join(";");
		},
		["playback", "timeline", "scenes"],
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the key says when a reading changed
	const readings = useMemo(() => {
		const time = editor.playback.getCurrentTime();
		return strips.map((strip) => readStrip(strip, time));
	}, [readingsKey, strips, editor]);
	const registerMeter = useMeters();
	const openAudio = useAssetsPanelStore((s) => s.setActiveTab);
	const width = Math.max(MIN_WIDTH_PX, strips.length * STRIP_WIDTH_PX + STRIP_WIDTH_PX + 1);

	return (
		<div data-mixer="" role="group" aria-label={t("Mixer")} className="bg-background flex max-w-[58%] shrink-0 flex-col border-l select-none" style={{ width }}>
			<div className="flex shrink-0 items-center gap-1 border-b pr-1 pl-2" style={{ height: headerHeight }}>
				<span className="min-w-0 flex-1 truncate text-xs font-medium">{t("Mixer")}</span>
				<BalanceButton />
				<Hint label={t("Close the mixer")} side="top">
					<Button variant="ghost" size="icon" className="size-6 shrink-0" aria-label={t("Close the mixer")} data-mixer-close="" onClick={() => close(false)}>
						<HugeiconsIcon icon={Cancel01Icon} className="size-3.5!" />
					</Button>
				</Hint>
			</div>
			<div className="flex min-h-0 flex-1">
				{strips.length === 0 ? (
					<div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 px-2 text-center" data-mixer-empty="">
						<span className="text-muted-foreground text-[11px] leading-snug">{t("No sound on the timeline yet.")}</span>
						<Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => openAudio("sounds")}>
							{t("Open Audio")}
						</Button>
					</div>
				) : (
					<div className="scrollbar-hidden flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden" data-mixer-strips="">
						{strips.map((strip, index) => (
							<StripView key={strip.trackId} strip={strip} reading={readings[index] ?? null} silenced={silenced.has(strip.trackId)} registerMeter={registerMeter} />
						))}
					</div>
				)}
				<div className="shrink-0 border-l">
					<MasterStrip />
				</div>
			</div>
		</div>
	);
}
