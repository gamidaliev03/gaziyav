"use client";
import { materialGrid, TILE_LABEL, TileAddButton } from "@/components/editor/panels/assets/material-grid";
import type { MediaTime } from "@/wasm";

import { tileActivation } from "@/components/editor/panels/assets/tile-activation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { EditorCore } from "@/core";
import { TracksSnapshotCommand } from "@/commands/timeline";
import { buildDefaultEffectInstance } from "@/effects";
import {
	COLOR_EFFECT_TYPE,
	type ColorGroup,
	isColorGroupNeutral,
	resetColorGroup,
} from "@/effects/definitions/studio/color";
import { InspectorGroup } from "@/components/editor/panels/properties/components/inspector-ui";
import { useT } from "@/i18n";
import { ChangedDot, type ColorEdit, ColorSlider, CurvesEditor, HslControls, WheelsControls } from "./color-controls";
import { encodeCube, parseCube } from "@/effects/luts/cube";
import { getLutStrip, LOOKS, lookTextureId } from "@/effects/luts/looks";
import type { Effect } from "@/effects/types";
import type { ParamValues } from "@/params";
import type { SceneTracks, TimelineElement } from "@/timeline";
import { isVisualElement } from "@/timeline/element-utils";
import { buildEffectElement } from "@/timeline/element-utils";
import { cn } from "@/utils/ui";
import { generateUUID } from "@/utils/id";
import { EFFECT_TARGET_ELEMENT_TYPES, effectsRegistry, resolveEffectPasses } from "@/effects";
import { loadSavedLooks, parseKadrPreset, saveLook, type StudioLook } from "@/effects/luts/kadr-preset";
import { FxThumbnail } from "./fx-thumbnail";
import type { EffectPass, EffectTimeContext } from "@/effects/types";
import { whenScrollIdle } from "@/utils/scroll-idle-queue";
import { onMemoryPressure } from "@/platform/memory-pressure";
import { ScopesButton } from "@/colour/components/scopes-button";

export type Target =
	| { kind: "clip"; trackId: string; element: TimelineElement; effect: Effect | null }
	| { kind: "layer"; trackId: string; element: TimelineElement & { params: ParamValues } };

function tracksNow(): SceneTracks | null {
	return EditorCore.getInstance().scenes.getActiveSceneOrNull()?.tracks ?? null;
}

export function resolveTarget(): Target | null {
	const editor = EditorCore.getInstance();
	const [first] = editor.timeline.getElementsWithTracks({
		elements: editor.selection.getSelectedElements(),
	});
	if (!first) return null;
	const { track, element } = first;
	if (element.type === "effect" && element.effectType === COLOR_EFFECT_TYPE) {
		return { kind: "layer", trackId: track.id, element: element as TimelineElement & { params: ParamValues } };
	}
	if (!isVisualElement(element)) return null;
	const effect = (element.effects ?? []).find((e) => e.type === COLOR_EFFECT_TYPE) ?? null;
	return { kind: "clip", trackId: track.id, element, effect };
}

export function targetParams(target: Target): ParamValues {
	const defaults = buildDefaultEffectInstance({ effectType: COLOR_EFFECT_TYPE }).params;
	if (target.kind === "layer") return { ...defaults, ...target.element.params };
	return { ...defaults, ...(target.effect?.params ?? {}) };
}

/** Returns new tracks with the target's color params replaced. */
function withParams(tracks: SceneTracks, target: Target, params: ParamValues): SceneTracks {
	const patchElement = (element: TimelineElement): TimelineElement => {
		if (element.id !== target.element.id) return element;
		if (target.kind === "layer") return { ...element, params } as TimelineElement;
		if (!isVisualElement(element)) return element;
		const effects = element.effects ?? [];
		const existing = effects.find((e) => e.type === COLOR_EFFECT_TYPE);
		const nextEffects = existing
			? effects.map((e) => (e.id === existing.id ? { ...e, params, enabled: true } : e))
			: [...effects, { ...buildDefaultEffectInstance({ effectType: COLOR_EFFECT_TYPE }), params }];
		return { ...element, effects: nextEffects } as TimelineElement;
	};
	const patchTrack = <T extends { id: string; elements: TimelineElement[] }>(track: T): T =>
		track.id === target.trackId ? ({ ...track, elements: track.elements.map(patchElement) } as T) : track;
	return {
		...tracks,
		main: patchTrack(tracks.main),
		overlay: tracks.overlay.map((t) => patchTrack(t as never)) as SceneTracks["overlay"],
	};
}

/** Live update without history (during a slider drag). */
function previewParams(target: Target, params: ParamValues) {
	const tracks = tracksNow();
	if (!tracks) return;
	EditorCore.getInstance().timeline.updateTracks(withParams(tracks, target, params));
}

/** One undo step from `before` to the current tracks. */
function commitFrom(before: SceneTracks | null) {
	const after = tracksNow();
	if (!before || !after || before === after) return;
	EditorCore.getInstance().command.push({ command: new TracksSnapshotCommand({ before, after }) });
}

export function applyParams(target: Target, params: ParamValues) {
	const before = tracksNow();
	if (!before) return;
	EditorCore.getInstance().command.execute({
		command: new TracksSnapshotCommand({ before, after: withParams(before, target, params) }),
	});
}

/** CapCut's «Custom adjustment»: a color layer at `at` (the playhead by default) that grades everything under it. */
export function addColorLayer(at?: MediaTime) {
	const editor = EditorCore.getInstance();
	if (!editor.project.getActiveOrNull()) return;
	const element = buildEffectElement({
		effectType: COLOR_EFFECT_TYPE,
		startTime: at ?? editor.playback.getCurrentTime(),
	});
	editor.timeline.insertElement({
		placement: { mode: "auto", trackType: "effect", newTrack: true },
		element: { ...element, name: "Adjustment" },
	});
}

type GroupSpec = { id: ColorGroup; title: string };
const GROUPS: GroupSpec[] = [
	{ id: "basic", title: "Basic" },
	{ id: "balance", title: "Balance" },
	{ id: "saturation", title: "Saturation and vibrance" },
	{ id: "curves", title: "Curves" },
	{ id: "hsl", title: "HSL" },
	{ id: "wheels", title: "Color wheels" },
	{ id: "look", title: "LUT and looks" },
];

const NEUTRAL = (): ParamValues => buildDefaultEffectInstance({ effectType: COLOR_EFFECT_TYPE }).params;

export function ColorControls({ target }: { target: Target }) {
	const t = useT();
	const params = targetParams(target);
	// The tracks before an edit: taken on its first change (never on a press alone, which may change nothing and would
	// leave a stale snapshot for the next edit) and turned into one undo step once the edit's last value is in.
	const beforeRef = useRef<SceneTracks | null>(null);
	const latest = useRef(params);
	latest.current = params;
	const edit: ColorEdit = {
		start: () => {
			beforeRef.current ??= tracksNow();
		},
		preview: (patch) => previewParams(target, { ...latest.current, ...patch }),
		end: () =>
			queueMicrotask(() => {
				commitFrom(beforeRef.current);
				beforeRef.current = null;
			}),
		apply: (patch) => applyParams(target, { ...latest.current, ...patch }),
	};
	// Before / after: held down, the picture shows the clip without its grading (preview only, no history).
	const held = useRef<ParamValues | null>(null);
	// the tracks as they were when the button went down: the release puts exactly them back (writing the grading back
	// instead added a colour effect to a clip that had none — outside the undo history)
	const heldTracks = useRef<SceneTracks | null>(null);
	const holdBefore = () => {
		if (held.current) return;
		held.current = latest.current;
		heldTracks.current = tracksNow();
		previewParams(target, { ...NEUTRAL(), lutData: latest.current.lutData ?? "", lutName: latest.current.lutName ?? "" });
	};
	const releaseBefore = () => {
		if (!held.current) return;
		const graded = held.current;
		const before = heldTracks.current;
		held.current = null;
		heldTracks.current = null;
		if (before) EditorCore.getInstance().timeline.updateTracks(before);
		else previewParams(target, graded);
	};
	// a section that closes while the button is held (selection changed) puts the grading back
	const releaseRef = useRef(releaseBefore);
	releaseRef.current = releaseBefore;
	useEffect(() => () => releaseRef.current(), []);
	const dirty = GROUPS.some((g) => !isColorGroupNeutral(g.id, params));

	const fileRef = useRef<HTMLInputElement>(null);
	const look = String(params.look ?? "none");
	const presetRef = useRef<HTMLInputElement>(null);
	const [savedLooks, setSavedLooks] = useState<StudioLook[]>(() => loadSavedLooks());
	const onImportPreset = async (file: File) => {
		try {
			const look = parseKadrPreset(await file.text(), file.name.replace(/\.kadrpreset$/i, ""));
			if (look.effects.length === 0) {
				toast.error(t("“{name}” has no effects we support ({skipped}).", { name: look.name, skipped: look.skipped.join(", ") || "empty" }));
				return;
			}
			setSavedLooks(saveLook(look));
			applyLookStack(target, look);
		} catch (error) {
			toast.error(t("Couldn't import {file}: {reason}", { file: file.name, reason: error instanceof Error ? error.message : t("unknown format") }));
		}
	};
	const onImport = async (file: File) => {
		try {
			const cube = parseCube(await file.text());
			edit.apply({ look: "custom", lutData: encodeCube(cube), lutName: file.name.replace(/\.cube$/i, ""), lookIntensity: 100 });
			toast.success(t("LUT “{name}” applied", { name: file.name }));
		} catch (error) {
			toast.error(t("Couldn't import {file}: {reason}", { file: file.name, reason: error instanceof Error ? error.message : t("unknown format") }));
		}
	};

	const slider = (key: string, label: string, extra?: { min?: number; max?: number; step?: number }) => (
		<ColorSlider key={key} label={t(label)} paramKey={key} params={params} edit={edit} {...extra} />
	);
	const body: Record<ColorGroup, React.ReactNode> = {
		basic: (
			<>
				{slider("exposure", "Exposure", { min: -3, max: 3, step: 0.05 })}
				{slider("contrast", "Contrast")}
				{slider("highlights", "Highlights")}
				{slider("shadows", "Shadows")}
				{slider("whites", "Whites")}
				{slider("blacks", "Blacks")}
			</>
		),
		balance: (
			<>
				{slider("temperature", "Temperature")}
				{slider("tint", "Tint")}
			</>
		),
		saturation: (
			<>
				{slider("saturation", "Saturation")}
				{slider("vibrance", "Vibrance")}
			</>
		),
		curves: <CurvesEditor params={params} edit={edit} />,
		hsl: <HslControls params={params} edit={edit} />,
		wheels: <WheelsControls params={params} edit={edit} />,
		look: (
			<div className="flex flex-col gap-2 px-4 pb-2">
				<div className="flex gap-3">
					<button type="button" className="text-primary text-xs" onClick={() => fileRef.current?.click()}>
						{t("Import .cube")}
					</button>
					<button type="button" className="text-primary text-xs" onClick={() => presetRef.current?.click()}>
						{t("Import look")}
					</button>
					<input
						ref={presetRef}
						type="file"
						accept=".kadrpreset,application/json"
						className="hidden"
						onChange={(event) => {
							const file = event.target.files?.[0];
							event.target.value = "";
							if (file) void onImportPreset(file);
						}}
					/>
					<input
						ref={fileRef}
						type="file"
						accept=".cube"
						className="hidden"
						onChange={(event) => {
							const file = event.target.files?.[0];
							event.target.value = "";
							if (file) void onImport(file);
						}}
					/>
				</div>
				<div style={materialGrid()} data-material-grid>
					<LookTile id="none" name={t("None")} active={look === "none"} onPick={() => edit.apply({ look: "none" })} />
					{LOOKS.map((item) => (
						<LookTile key={item.id} id={item.id} name={item.name} active={look === item.id} onPick={() => edit.apply({ look: item.id })} />
					))}
					{typeof params.lutData === "string" && params.lutData && (
						<LookTile
							id="custom"
							name={String(params.lutName ?? t("Imported"))}
							active={look === "custom"}
							onPick={() => edit.apply({ look: "custom" })}
						/>
					)}
				</div>
				{savedLooks.length > 0 && (
					<>
						<h4 className="pt-1 text-xs font-medium">{t("My looks")}</h4>
						<div style={materialGrid()} data-material-grid>
							{savedLooks.map((item) => (
								<StackLookTile key={item.id} look={item} onPick={() => applyLookStack(target, item)} />
							))}
						</div>
					</>
				)}
				<div className="-mx-4">
					{look !== "none" && slider("lookIntensity", "Intensity", { min: 0, max: 100 })}
					{slider("vignette", "Vignette", { min: 0, max: 100 })}
				</div>
			</div>
		),
	};

	return (
		<div className="flex flex-col pb-4" data-color-section>
			<div className="flex flex-wrap items-center gap-2 px-4 pb-2">
				<button
					type="button"
					data-color-before
					title={target.kind === "layer" ? t("Hold to see the picture without this layer's grading") : t("Hold to see the clip without its grading")}
					onPointerDown={(event) => {
						event.currentTarget.setPointerCapture(event.pointerId);
						holdBefore();
					}}
					onPointerUp={releaseBefore}
					onPointerCancel={releaseBefore}
					onLostPointerCapture={releaseBefore}
					onKeyDown={(event) => {
						if (event.key === " " || event.key === "Enter") holdBefore();
					}}
					onKeyUp={releaseBefore}
					onBlur={releaseBefore}
					className="bg-foreground/[0.07] hover:bg-foreground/[0.1] active:bg-primary/30 h-7 rounded-full px-3 text-xs font-medium"
				>
					{t("Before / after")}
				</button>
				{/* the colour scopes under the player (src/colour/scopes) */}
				<ScopesButton />
				<span className="min-w-0 flex-1" />
				{dirty && (
					<button type="button" data-color-reset-all className="text-muted-foreground hover:text-foreground text-xs" onClick={() => applyParams(target, NEUTRAL())}>
						{t("Reset all")}
					</button>
				)}
			</div>
			{GROUPS.map((group) => {
				const changed = !isColorGroupNeutral(group.id, params);
				return (
					<InspectorGroup
						key={group.id}
						id={`color.${group.id}`}
						title={t(group.title)}
						defaultOpen={false}
						trailing={
							<span className="flex items-center gap-2" data-color-group={group.id}>
								<ChangedDot on={changed} />
								{changed && (
									<button
										type="button"
										data-color-reset={group.id}
										className="text-muted-foreground hover:text-foreground text-xs"
										onClick={(event) => {
											event.stopPropagation();
											applyParams(target, resetColorGroup(group.id, latest.current));
										}}
									>
										{t("Reset")}
									</button>
								)}
							</span>
						}
					>
						{body[group.id]}
					</InspectorGroup>
				);
			})}
		</div>
	);
}

const lookThumbCache = new Map<string, string>();
onMemoryPressure(() => {
	lookThumbCache.clear();
	baseImages.clear();
});
/** The small photo each look is graded on, per photo (the default portrait or a theme's). */
const baseImages = new Map<string, ImageData>();
/** One canvas encodes every look tile's JPEG (made on first use: there is no document on the server). */
let encodeCanvas: HTMLCanvasElement | null = null;
const LOOK_PREVIEW_PHOTO = "/effects/preview.jpg";

function useLookThumbnail(id: string, photo: string = LOOK_PREVIEW_PHOTO): string | null {
	const key = `${photo}|${id}`;
	const [url, setUrl] = useState<string | null>(lookThumbCache.get(key) ?? null);
	useEffect(() => {
		const cachedUrl = lookThumbCache.get(key);
		if (cachedUrl) {
			setUrl(cachedUrl);
			return;
		}
		let cancelled = false;
		const render = (baseImage: ImageData) => {
			// every tile also asks for the original ("none"): the first one queued makes it, the rest take it
			const made = lookThumbCache.get(key);
			if (made) {
				if (!cancelled) setUrl(made);
				return;
			}
			const size = baseImage.width;
			const out = new ImageData(new Uint8ClampedArray(baseImage.data), size, size);
			// The look's own function on the tile's 80×80 pixels (6 400 calls). A 33³ cube per tile was 36 000 calls
			// each: with 105 filters opening at once, the page froze for 2.7 s.
			const look = id === "none" || id === "custom" ? null : LOOKS.find((l) => l.id === id);
			if (look) {
				const d = out.data;
				for (let i = 0; i < d.length; i += 4) {
					const [r, g, b] = look.fn([d[i] / 255, d[i + 1] / 255, d[i + 2] / 255]);
					d[i] = r * 255;
					d[i + 1] = g * 255;
					d[i + 2] = b * 255;
				}
			}
			// a CPU canvas (willReadFrequently): a GPU one read every tile back from the GPU for the JPEG
			encodeCanvas ??= document.createElement("canvas");
			encodeCanvas.width = size;
			encodeCanvas.height = size;
			encodeCanvas.getContext("2d", { willReadFrequently: true })?.putImageData(out, 0, 0);
			const dataUrl = encodeCanvas.toDataURL("image/jpeg", 0.85);
			lookThumbCache.set(key, dataUrl);
			if (!cancelled) setUrl(dataUrl);
		};
		// one tile per frame, none while a list scrolls (utils/scroll-idle-queue)
		const queued = (baseImage: ImageData) =>
			whenScrollIdle(() => {
				if (!cancelled) render(baseImage);
			});
		const base = baseImages.get(photo);
		if (base) {
			queued(base);
		} else {
			const image = new Image();
			image.onload = () => {
				const canvas = document.createElement("canvas");
				canvas.width = 80;
				canvas.height = 80;
				// read once with getImageData: a CPU canvas, not a GPU readback (a 110 ms frame on the first Filters open)
				const ctx = canvas.getContext("2d", { willReadFrequently: true });
				if (!ctx) return;
				// The middle of a photo that isn't square (object-fit: cover).
				const side = Math.min(image.naturalWidth, image.naturalHeight) || 80;
				ctx.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 80, 80);
				const data = ctx.getImageData(0, 0, 80, 80);
				baseImages.set(photo, data);
				queued(data);
			};
			image.src = photo;
		}
		return () => {
			cancelled = true;
		};
	}, [id, key, photo]);
	return url;
}

/** The look's colour table made while the pointer rests on its tile, so applying it is only the upload. */
function warmLook(id: string) {
	if (id === "none" || id === "custom") return;
	const make = () => getLutStrip(lookTextureId(id));
	if (typeof requestIdleCallback === "function") requestIdleCallback(make, { timeout: 300 });
	else setTimeout(make, 0);
}

/** A look's name under its tile: up to two lines (the tiles are 80 px wide; «Tungsten 800 Night» was cut). */
const LOOK_LABEL = TILE_LABEL;

const WIPE_KEYFRAMES = `@keyframes studio-look-wipe { 0%, 10% { clip-path: inset(0 100% 0 0); } 45%, 60% { clip-path: inset(0 0 0 0); } 95%, 100% { clip-path: inset(0 100% 0 0); } }`;

export function LookTile({
	id,
	name,
	active,
	onPick,
	photo,
}: {
	id: string;
	name: string;
	active: boolean;
	onPick: () => void;
	/** The photo it is graded on (a theme's), else the default portrait. */
	photo?: string;
}) {
	const url = useLookThumbnail(id, photo);
	const original = useLookThumbnail("none", photo);
	const [hovered, setHovered] = useState(false);
	return (
		<div className="group relative">
			<button
				type="button"
				{...tileActivation(onPick)}
				data-no-translate
				// Dragged onto a clip it grades that clip with this look; onto empty space it becomes a filter layer.
				draggable={id !== "none"}
				onDragStart={(event) =>
					EditorCore.getInstance().timeline.dragSource.begin({
						dataTransfer: event.dataTransfer,
						dragData: { id: `look:${id}`, type: "effect", name, effectType: COLOR_EFFECT_TYPE, targetElementTypes: EFFECT_TARGET_ELEMENT_TYPES, params: { look: id } },
					})
				}
				onDragEnd={() => EditorCore.getInstance().timeline.dragSource.end()}
				onMouseEnter={() => {
					setHovered(true);
					warmLook(id);
				}}
				onMouseLeave={() => setHovered(false)}
				className="flex w-full min-w-0 flex-col gap-1 text-left"
				aria-label={`Apply look ${name}`}
				title={`${name} — double-click to apply`}
			>
				<div
					className={cn(
						"bg-accent relative aspect-square w-full overflow-hidden rounded-sm border-2",
						active ? "border-primary" : "border-transparent",
					)}
				>
					{/* idle: graded still; hover: before → after wipe (CSS only, stops on leave) */}
					{hovered && original && id !== "none" ? (
						<>
							<style>{WIPE_KEYFRAMES}</style>
							<img src={original} alt="" className="absolute inset-0 size-full object-cover" />
							{url && (
								<img
									src={url}
									alt=""
									className="absolute inset-0 size-full object-cover"
									style={{ animation: "studio-look-wipe 1.6s ease-in-out infinite" }}
								/>
							)}
						</>
					) : (
						url && <img src={url} alt="" className="size-full object-cover" />
					)}
				</div>
				<span className={LOOK_LABEL}>{name}</span>
			</button>
			<TileAddButton onAdd={onPick} label="Apply" />
		</div>
	);
}

/** Adds a saved look (an effect stack) to the selected clip — one ⌘Z. */
function applyLookStack(target: Target, look: StudioLook) {
	if (target.kind !== "clip") {
		toast.info("Select a clip to apply a look stack.");
		return;
	}
	const before = tracksNow();
	if (!before) return;
	const patch = (element: TimelineElement): TimelineElement => {
		if (element.id !== target.element.id || !isVisualElement(element)) return element;
		const added = look.effects
			.filter((e) => effectsRegistry.has(e.type))
			.map((e) => ({ id: generateUUID(), type: e.type, params: { ...e.params }, enabled: true }));
		return { ...element, effects: [...(element.effects ?? []), ...added] } as TimelineElement;
	};
	const patchTrack = <T extends { id: string; elements: TimelineElement[] }>(track: T): T =>
		track.id === target.trackId ? ({ ...track, elements: track.elements.map(patch) } as T) : track;
	const after: SceneTracks = {
		...before,
		main: patchTrack(before.main),
		overlay: before.overlay.map((t) => patchTrack(t as never)) as SceneTracks["overlay"],
	};
	EditorCore.getInstance().command.execute({ command: new TracksSnapshotCommand({ before, after }) });
	toast.success(
		`Look "${look.name}" applied (${look.effects.length} effect${look.effects.length === 1 ? "" : "s"})` +
			(look.skipped.length ? ` · skipped: ${look.skipped.join(", ")}` : ""),
	);
}

function StackLookTile({ look, onPick }: { look: StudioLook; onPick: () => void }) {
	const [hovered, setHovered] = useState(false);
	const buildPasses = (time: EffectTimeContext): EffectPass[] =>
		look.effects
			.filter((e) => effectsRegistry.has(e.type))
			.flatMap((e) =>
				resolveEffectPasses({ definition: effectsRegistry.get(e.type), effectParams: e.params, width: 160, height: 160, time }),
			);
	return (
		<div className="group relative">
			<button
				type="button"
				{...tileActivation(onPick)}
				data-no-translate
				onMouseEnter={() => setHovered(true)}
				onMouseLeave={() => setHovered(false)}
				className="flex w-full min-w-0 flex-col gap-1 text-left"
				aria-label={`Apply look ${look.name}`}
				title={look.skipped.length ? `${look.name} — double-click to apply. Not supported: ${look.skipped.join(", ")}` : `${look.name} — double-click to apply`}
			>
				<div className="bg-accent aspect-square w-full overflow-hidden rounded-sm border-2 border-transparent">
					<FxThumbnail cacheKey={`look:${look.id}`} buildPasses={buildPasses} restTime={0.3} loopSeconds={1.5} hovered={hovered} />
				</div>
				<span className={LOOK_LABEL}>{look.name}</span>
			</button>
			<TileAddButton onAdd={onPick} label="Apply" />
		</div>
	);
}
