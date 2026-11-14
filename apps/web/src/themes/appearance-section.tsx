"use client";

// Settings → Appearance («Оформление»): the look of the whole window, applied the moment it is clicked and remembered.
// colour, and «More» for the rest (a tint, the glass's transparency and blur, reset).
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { Segmented } from "@/components/ui/segmented";
import { Slider } from "@/components/ui/slider";
import { useT } from "@/i18n";
import { DEMO } from "@/demo/flag";
import { cn } from "@/utils/ui";
import { isGlass, type Mode, resolve, type Resolved } from "./engine";
import { ACCENT_SWATCHES, FAMILIES, type Family, ORIGINAL_FAMILY } from "./families";
import { useThemeStore } from "./store";

type ModeChoice = "dark" | "light" | "system";

const studio = () => (window as unknown as { studioApp?: { setTheme?: (t: string) => void } }).studioApp;

/** «Как было»'s picture: the Ember skin and the light look before this night (their own colours, not the engine's). */
const ORIGINAL_TILE: Record<Mode, Resolved["tile"]> = {
	dark: { room: "#0b0a09", roomImage: "none", panel: "#151412", panelFill: "#151412", stage: "#080706", timeline: "#151412", fg: "#f2efe9", fgMuted: "#a49d92", accent: "#e8a33d", fill: "#e8a33d", fillFg: "#1a1206", raised: "#1d1b18", border: "#26231f" },
	light: { room: "#f6f6f8", roomImage: "none", panel: "#f7f7f9", panelFill: "#f7f7f9", stage: "#f7f7f9", timeline: "#f7f7f9", fg: "#121214", fgMuted: "#6b6b75", accent: "#b8741a", fill: "#b8741a", fillFg: "#ffffff", raised: "#ececf0", border: "#e2e2e7" },
};

const TINTS = ["#0a84ff", "#bf5af2", "#ff375f", "#ff9f0a", "#30d158", "#64d2ff"];

/** A tiny picture of the editor in a look: the room, two shelves, the player, the timeline with two clips. A look of the
 * pack draws its skin from its own tokens (corners, bevels, the bar, its heading face, clip colours, selection, playhead):
 * the same values the window gets, never a picture. */
function Tile({ id, tile, glass }: { id: string; tile: Resolved["tile"]; glass: boolean }) {
	const sk = tile.skin;
	const r = (n: number) => (sk ? `min(${sk.rPanel}, ${n}px)` : `${n}px`);
	const shelf = {
		backgroundColor: glass ? tile.panelFill : tile.panel,
		borderRadius: r(4),
		boxShadow: sk ? sk.panelShadow : glass ? "inset 0 1px 0 rgb(255 255 255 / 0.18), inset 0 0 0 0.5px rgb(255 255 255 / 0.14)" : undefined,
	};
	const clipR = sk ? `min(${sk.clipR}, 2px)` : "2px";
	return (
		<div className="gz-tile-room relative h-[40px] w-full overflow-hidden rounded-[7px]" style={{ backgroundColor: tile.room, backgroundImage: tile.roomImage }} aria-hidden>
			<div className="absolute top-[5px] right-[6px] h-[5px] w-[14px]" style={{ backgroundColor: tile.fill, borderRadius: sk ? `min(${sk.rControl}, 2px)` : "2px", boxShadow: sk ? sk.raise : undefined }} />
			{sk ? (
				<div className="absolute top-[2px] left-[6px] text-[8px] leading-[10px]" style={{ color: tile.fg, fontFamily: sk.head, textTransform: sk.headCase as "none" | "uppercase" }}>
					Aa 12:00
				</div>
			) : (
				<div className="absolute top-[5px] left-[6px] h-[5px] w-[22px] rounded-[2px] opacity-60" style={{ backgroundColor: tile.fgMuted }} />
			)}
			<div className="absolute top-[11px] left-[4px] h-[11px] w-[42%] p-[2px]" style={shelf}>
				<div className="h-[3px] w-[60%] rounded-full" style={{ backgroundColor: tile.fg }} />
				<div className="mt-[1px] h-[3px] w-[40%] rounded-full" style={{ backgroundColor: tile.fgMuted }} />
			</div>
			<div className="absolute top-[11px] left-[calc(42%+7px)] h-[11px] w-[24%] p-[2px]" style={shelf}>
				<div className="h-[3px] w-[70%] rounded-full" style={{ backgroundColor: tile.fgMuted }} />
			</div>
			<div className="absolute top-[11px] right-[4px] bottom-[3px] w-[calc(34%-14px)]" style={{ backgroundColor: tile.stage, borderRadius: r(4) }}>
				<div className="absolute inset-x-[22%] inset-y-[16%] rounded-[2px] bg-black/80" />
			</div>
			<div className="absolute bottom-[3px] left-[4px] h-[14px] w-[calc(66%+3px)]" style={{ backgroundColor: tile.timeline, borderRadius: r(4), boxShadow: sk ? sk.panelShadow : undefined }}>
				{sk ? (
					<>
						<div className="absolute top-[2px] left-[10%] h-[4px] w-[44%]" style={{ backgroundColor: sk.clips[0], borderRadius: clipR, boxShadow: `0 0 0 1px ${sk.sel}, 0 0 0 2px ${sk.selEdge}` }}>
							<div className="mt-[2px] ml-[2px] h-[2px] w-[40%]" style={{ backgroundColor: sk.label }} />
						</div>
						<div className="absolute top-[8px] left-[22%] h-[4px] w-[30%]" style={{ backgroundColor: sk.clips[1], borderRadius: clipR }} />
						<div className="absolute top-[8px] left-[54%] h-[4px] w-[18%]" style={{ backgroundColor: sk.clips[2], borderRadius: clipR }} />
						<div className="absolute top-[2px] bottom-[2px] left-[34%] w-px" style={{ backgroundColor: sk.playhead, boxShadow: `0 0 0 0.5px ${sk.playheadEdge}` }} />
					</>
				) : (
					<>
						<div className="absolute top-[2px] left-[10%] h-[4px] w-[44%] rounded-[2px]" style={{ backgroundColor: tile.raised, boxShadow: `inset 0 0 0 0.5px ${tile.border}` }} />
						<div className="absolute top-[8px] left-[22%] h-[4px] w-[30%] rounded-[2px]" style={{ backgroundColor: tile.fill, opacity: 0.85 }} />
						<div className="absolute top-[2px] bottom-[2px] left-[34%] w-px" style={{ backgroundColor: tile.accent }} />
					</>
				)}
			</div>
			<TileMark id={id} />
		</div>
	);
}

/** The one element that tells a look from its neighbour at tile size (looks4: the four pairs) — drawn, never a picture. */
function TileMark({ id }: { id: string }) {
	switch (id) {
		case "analog": // the amber lamp under the player
			return <div className="absolute right-[7px] bottom-[5px] h-[4px] w-[12px] rounded-[1px]" style={{ backgroundColor: "#1a1410", boxShadow: "inset 0 0 0 1px #000", backgroundImage: "linear-gradient(90deg, #ffb347 0 70%, transparent 70%)", backgroundSize: "8px 2px", backgroundPosition: "2px 1px", backgroundRepeat: "no-repeat" }} />;
		case "retro95": // the navy title bar
			return <div className="absolute top-[2px] right-[24px] left-[44px] h-[7px]" style={{ backgroundColor: "#000080" }} />;
		case "arena": // the lock-on brackets round the first clip
			return <div className="absolute bottom-[10px] left-[calc(10%+3px)] h-[7px] w-[calc(29%+4px)]" style={{ background: "linear-gradient(#fff,#fff) left top/4px 1px no-repeat, linear-gradient(#fff,#fff) left top/1px 4px no-repeat, linear-gradient(#fff,#fff) right top/4px 1px no-repeat, linear-gradient(#fff,#fff) right top/1px 4px no-repeat, linear-gradient(#fff,#fff) left bottom/4px 1px no-repeat, linear-gradient(#fff,#fff) left bottom/1px 4px no-repeat, linear-gradient(#fff,#fff) right bottom/4px 1px no-repeat, linear-gradient(#fff,#fff) right bottom/1px 4px no-repeat" }} />;
		case "terminal": // the prompt
			return <div className="absolute top-[2px] left-[46px] text-[8px] leading-[8px]" style={{ color: "#39ff7a", fontFamily: "ui-monospace, Menlo, monospace" }}>&gt;_</div>;
		case "rose": // the gloss on the key
			return <div className="absolute top-[5px] right-[6px] h-[2px] w-[14px]" style={{ backgroundColor: "rgb(255 255 255 / 0.55)", borderRadius: "2px 2px 0 0" }} />;
		case "sakura": // the ink rule under the heading
			return <div className="absolute top-[10px] left-[6px] h-px w-[34px]" style={{ backgroundColor: "#232046" }} />;
		case "neon": // the lit chamfer
			return <div className="absolute top-0 left-0 size-[7px]" style={{ background: "linear-gradient(135deg, #22e6ff 0 3.5px, transparent 3.5px)" }} />;
		case "pixel": // the stepped shadow under the shelf
			return <div className="absolute top-[22px] left-[6px] h-[2px] w-[42%]" style={{ backgroundColor: "#07081f" }} />;
		default:
			return null;
	}
}

export function AppearanceSection() {
	const t = useT();
	const { theme, resolvedTheme, setTheme } = useTheme();
	const state = useThemeStore((s) => s.state);
	const { set, reset, refresh } = useThemeStore.getState();
	const [more, setMore] = useState(false);
	// sliders follow the hand; the look is made again when the hand lets go (a whole-window restyle per frame is not free)
	const [draft, setDraft] = useState<{ clarity?: number; blur?: number; tintAmount?: number }>({});
	useEffect(() => refresh(), [refresh]);

	const mode: Mode = resolvedTheme === "light" ? "light" : "dark";
	const modeChoice: ModeChoice = theme === "light" || theme === "dark" ? theme : "system";
	const chosen = state.family;
	const family = FAMILIES.find((f) => f.id === chosen);
	const original = chosen === ORIGINAL_FAMILY;
	const glass = !!family && isGlass(family.material);

	const setMode = (next: ModeChoice) => {
		setTheme(next);
		studio()?.setTheme?.(next);
	};

	const tiles = useMemo(() => {
		const list: Array<{ id: string; name: string; note: string; tile: Resolved["tile"]; glass: boolean; only?: Mode }> = FAMILIES.map((f: Family) => {
			const m: Mode = f[mode] ? mode : f.dark ? "dark" : "light";
			const r = resolve(f, m, { ...state, family: f.id });
			return { id: f.id, name: f.name, note: f.note, tile: r!.tile, glass: isGlass(f.material), only: f.dark && f.light ? undefined : m };
		});
		list.push({ id: ORIGINAL_FAMILY, name: "As it was", note: "The look before, without settings", tile: ORIGINAL_TILE[mode], glass: false });
		return list;
	}, [state, mode]);
	// «Основные» (the plain looks and «Как было») and «Темы» (the skinned looks of the pack, in DESIGN §8's order)
	const groups = useMemo(() => {
		const skinned = new Set(FAMILIES.filter((f) => !!f.skin).map((f) => f.id));
		return [
			{ id: "basic", label: "Basic looks", tiles: tiles.filter((x) => !skinned.has(x.id)) },
			{ id: "pack", label: "Themed looks", tiles: tiles.filter((x) => skinned.has(x.id)) },
		];
	}, [tiles]);

	const pick = (id: string) => {
		const f = FAMILIES.find((x) => x.id === id);
		if (f && !f[mode]) setMode(f.dark ? "dark" : "light");
		set({ family: id });
	};

	// the Mac's colour picker sends a stream of colours while the hand moves: the last one of each short pause is taken
	const pickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const later = (patch: Parameters<typeof set>[0]) => {
		if (pickTimer.current) clearTimeout(pickTimer.current);
		pickTimer.current = setTimeout(() => set(patch), 90);
	};
	useEffect(() => () => {
		if (pickTimer.current) clearTimeout(pickTimer.current);
	}, []);

	const ownAccent = family?.[mode]?.accent ?? family?.dark?.accent ?? family?.light?.accent ?? "#0a84ff";
	const accentNow = state.accent ?? ownAccent;
	const custom = state.accent && !ACCENT_SWATCHES.some((s) => s.hex === state.accent) ? state.accent : null;

	return (
		<div data-settings-appearance className="flex flex-col gap-6">
			<section className="flex flex-col gap-3">
				<div className="flex items-center justify-between gap-3">
					<h3 className="text-[0.95rem] font-medium">{t("Window look")}</h3>
					<Segmented<ModeChoice>
						aria-label={t("Light or dark")}
						size="sm"
						value={modeChoice}
						onValueChange={setMode}
						items={[
							{ value: "dark", label: t("Dark look") },
							{ value: "light", label: t("Light look") },
							{ value: "system", label: t(DEMO ? "As on this computer" : "As on this Mac") },
						]}
						itemProps={(v) => ({ "data-theme-mode": v })}
					/>
				</div>
				{/* two groups, six to a row (looks4): all nineteen tiles stand in the window at 1024×640 without a scroll */}
				<div role="radiogroup" aria-label={t("Window look")} className="flex flex-col gap-2" data-theme-tiles>
					{groups.map((g) => (
						<div key={g.id} className="flex flex-col gap-1" data-theme-group={g.id}>
							<span className="text-muted-foreground text-[11px] font-medium">{t(g.label)}</span>
							<div className="grid grid-cols-6 gap-1">
								{g.tiles.map((x) => {
									const on = chosen === x.id;
									return (
										// biome-ignore lint/a11y/useSemanticElements: a picture card, not a radio input
										<button
											key={x.id}
											type="button"
											role="radio"
											aria-checked={on}
											data-theme-tile={x.id}
											title={x.only ? `${t(x.note)} · ${t(x.only === "dark" ? "Dark only" : "Light only")}` : t(x.note)}
											onClick={() => pick(x.id)}
											className={cn(
												"flex min-w-0 flex-col gap-1 rounded-[8px] p-1 text-left transition-colors",
												on ? "bg-foreground/[0.07] ring-primary ring-2" : "hover:bg-foreground/[0.04]",
											)}
										>
											<Tile id={x.id} tile={x.tile} glass={x.glass} />
											<span className="line-clamp-2 min-h-[13px] px-0.5 text-[11px] leading-[13px] font-medium break-words">{t(x.name)}</span>
										</button>
									);
								})}
							</div>
						</div>
					))}
				</div>
			</section>

			<section className={cn("flex flex-col gap-2.5", original && "opacity-50")} aria-disabled={original}>
				<h3 className="text-[0.95rem] font-medium">{t("Accent colour")}</h3>
				<div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={t("Accent colour")}>
					<Swatch
						hex={ownAccent}
						label={t("The look's own")}
						on={state.accent === null}
						disabled={original}
						data={{ "data-accent-swatch": "theme" }}
						onClick={() => set({ accent: null })}
						ring
					/>
					<span className="bg-border mx-0.5 h-5 w-px" aria-hidden />
					{ACCENT_SWATCHES.map((s) => (
						<Swatch key={s.hex} hex={s.hex} label={t(s.name)} on={state.accent === s.hex} disabled={original} data={{ "data-accent-swatch": s.hex }} onClick={() => set({ accent: s.hex })} />
					))}
					<label
						className={cn("relative grid size-7 place-items-center rounded-full", custom ? "ring-foreground ring-2 ring-offset-2 ring-offset-[var(--background)]" : "")}
						title={t("Any colour")}
						style={{ background: custom ?? "conic-gradient(#ff453a, #ff9f0a, #ffd60a, #30d158, #64d2ff, #0a84ff, #bf5af2, #ff375f, #ff453a)" }}
					>
						<span className="sr-only">{t("Any colour")}</span>
						<input
							type="color"
							data-accent-custom
							disabled={original}
							value={accentNow}
							onChange={(e) => later({ accent: e.target.value })}
							className="absolute inset-0 size-full cursor-default opacity-0"
						/>
					</label>
				</div>
				{original && <p className="text-muted-foreground text-xs">{t("«As it was» keeps its own colours.")}</p>}
			</section>

			<section className="flex flex-col gap-3">
				<button
					type="button"
					data-theme-more
					aria-expanded={more}
					onClick={() => setMore((v) => !v)}
					className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1.5 text-sm"
				>
					<span className={cn("inline-block transition-transform", more && "rotate-90")} aria-hidden>
						›
					</span>
					{t("More")}
				</button>
				{more && (
					<div className="flex flex-col gap-5 pl-4" data-theme-more-body>
						<div className={cn("flex flex-col gap-2", original && "opacity-50")}>
							<span className="text-sm">{t("Tint of the surfaces")}</span>
							<div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={t("Tint of the surfaces")}>
								<Swatch hex="" label={t("No tint")} on={state.tint === null} disabled={original} data={{ "data-tint-swatch": "none" }} onClick={() => set({ tint: null })} />
								{TINTS.map((hex) => (
									<Swatch key={hex} hex={hex} label={hex} on={state.tint === hex} disabled={original} data={{ "data-tint-swatch": hex }} onClick={() => set({ tint: hex })} />
								))}
								<Swatch hex={accentNow} label={t("Like the accent")} on={!!state.tint && state.tint === accentNow && !TINTS.includes(state.tint)} disabled={original} data={{ "data-tint-swatch": "accent" }} onClick={() => set({ tint: accentNow })} />
							</div>
							<SliderRow
								id="tint"
								label={t("Strength")}
								value={draft.tintAmount ?? state.tintAmount}
								disabled={original || !state.tint}
								onDraft={(v) => setDraft((d) => ({ ...d, tintAmount: v }))}
								onCommit={(v) => {
									setDraft((d) => ({ ...d, tintAmount: undefined }));
									set({ tintAmount: v });
								}}
							/>
						</div>
						<div className={cn("flex flex-col gap-2", !glass && "opacity-50")}>
							<SliderRow
								id="clarity"
								label={t("Glass transparency")}
								value={draft.clarity ?? state.clarity}
								disabled={!glass}
								onDraft={(v) => setDraft((d) => ({ ...d, clarity: v }))}
								onCommit={(v) => {
									setDraft((d) => ({ ...d, clarity: undefined }));
									set({ clarity: v });
								}}
							/>
							<SliderRow
								id="blur"
								label={t("Blur behind menus and sheets")}
								value={draft.blur ?? state.blur}
								disabled={!glass}
								onDraft={(v) => setDraft((d) => ({ ...d, blur: v }))}
								onCommit={(v) => {
									setDraft((d) => ({ ...d, blur: undefined }));
									set({ blur: v });
								}}
							/>
							{!glass && <p className="text-muted-foreground text-xs">{t("For the glass looks.")}</p>}
						</div>
						<div className="flex flex-col gap-1">
							<button
								type="button"
								data-theme-reset
								onClick={() => {
									setDraft({});
									reset();
								}}
								className="text-primary w-fit text-sm hover:underline"
							>
								{t("Back to the default look")}
							</button>
							<p className="text-muted-foreground text-xs">{t("Minimal, its own accent, no tint.")}</p>
						</div>
					</div>
				)}
			</section>
		</div>
	);
}

function Swatch({ hex, label, on, onClick, disabled, data, ring }: { hex: string; label: string; on: boolean; onClick: () => void; disabled?: boolean; data: Record<string, string>; ring?: boolean }) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: a colour swatch
		<button
			type="button"
			role="radio"
			aria-checked={on}
			aria-label={label}
			title={label}
			disabled={disabled}
			onClick={onClick}
			{...data}
			className={cn(
				"relative grid size-7 shrink-0 place-items-center rounded-full transition-shadow",
				on ? "ring-foreground ring-2 ring-offset-2 ring-offset-[var(--background)]" : "ring-foreground/15 ring-1 ring-inset",
			)}
			style={{ backgroundColor: hex || "transparent" }}
		>
			{!hex && <span className="bg-foreground/60 h-px w-4 rotate-[-45deg]" aria-hidden />}
			{ring && <span className="border-background/70 absolute inset-[5px] rounded-full border-2" aria-hidden />}
		</button>
	);
}

function SliderRow({ id, label, value, disabled, onDraft, onCommit }: { id: string; label: string; value: number; disabled?: boolean; onDraft: (v: number) => void; onCommit: (v: number) => void }) {
	return (
		<div className="grid grid-cols-[13rem_1fr_2.5rem] items-center gap-3">
			<span className="text-muted-foreground text-sm">{label}</span>
			<Slider
				data-theme-slider={id}
				aria-label={label}
				min={0}
				max={100}
				step={1}
				disabled={disabled}
				value={[value]}
				onValueChange={(v) => onDraft(v[0] ?? 0)}
				onValueCommit={(v) => onCommit(v[0] ?? 0)}
			/>
			<span className="text-muted-foreground text-right text-xs tabular-nums">{Math.round(value)}</span>
		</div>
	);
}
