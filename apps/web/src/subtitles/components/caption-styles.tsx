"use client";

import { materialGrid, TILE_THUMB } from "@/components/editor/panels/assets/material-grid";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { useEditor } from "@/editor/use-editor";
import { TextTile, tileStillUrl } from "@/text/components/preset-thumb";
import { CAPTION_SAMPLE_SECONDS, captionStill, captionTileElement } from "../caption-tile";
import { CAPTION_THEMES, captionScene, captionTheme, type CaptionTheme } from "../motion-looks";
import { cn } from "@/utils/ui";
import { applyCaptionStyle, isCaptionElement } from "../apply-style";
import { CreatePresetTile } from "@/presets/components/create-preset";
import { designCaptionStyle } from "@/presets/actions";
import { isUserPresetId, useUserPresets } from "@/presets/user-presets";
import { CAPTION_STYLES, captionStylesFor, useCaptionStyleStore, type CaptionStyle } from "../styles";
import { TEMPLATE_GROUPS, type TemplateGroupKey } from "../template-groups";

export { TEMPLATE_GROUPS, type TemplateGroupKey };
import { t, useLang } from "@/i18n";
import { ru } from "@/i18n/ru";



const FAVORITES_KEY = "gaziyav.captionFavorites";

/** CapCut's ☆ on a template: the starred ones are listed under Favorites (kept on this Mac). */
export const useCaptionFavorites = create<{ ids: string[]; toggle: (id: string) => void }>((set, get) => ({
	ids: (() => {
		try {
			return JSON.parse(globalThis.localStorage?.getItem(FAVORITES_KEY) ?? "[]") as string[];
		} catch {
			return [];
		}
	})(),
	toggle: (id) => {
		const ids = get().ids.includes(id) ? get().ids.filter((x) => x !== id) : [...get().ids, id];
		try {
			globalThis.localStorage?.setItem(FAVORITES_KEY, JSON.stringify(ids));
		} catch {}
		set({ ids });
	},
}));

/**
 * Caption templates (CapCut: Captions → Templates). One click makes the template the look of every caption: all caption
 * tracks are restyled and re-cut to its words per screen in one undo step, and new captions (whisper, SRT, voice-over
 * words) get it too. `query` searches every template by name, as CapCut's search field does.
 */
export function CaptionStyleGallery({ group, query = "" }: { group?: TemplateGroupKey; query?: string } = {}) {
	const editor = useEditor();
	const styleId = useCaptionStyleStore((state) => state.styleId);
	const setStyleId = useCaptionStyleStore((state) => state.setStyleId);
	const captionCount = useEditor((e) => {
		const tracks = e.scenes.getActiveSceneOrNull()?.tracks;
		if (!tracks) return 0;
		return [...tracks.overlay, tracks.main].reduce(
			(sum, track) => sum + track.elements.filter((element) => isCaptionElement(element)).length,
			0,
		);
	});
	const [hovered, setHovered] = useState<string | null>(null);
	const [theme, setTheme] = useState<CaptionTheme | "all">("all");
	const userStyles = useUserPresets((state) => state.captions);
	const favorites = useCaptionFavorites((state) => state.ids);
	const toggleFavorite = useCaptionFavorites((state) => state.toggle);
	const lang = useLang((s) => s.lang);
	const all = [...userStyles, ...captionStylesFor(lang)];
	const needle = query.trim().toLowerCase();
	const groupIds: readonly string[] | undefined = TEMPLATE_GROUPS.find((g) => g.key === group)?.ids;
	const styles: CaptionStyle[] = needle
		? all.filter((style) => style.name.toLowerCase().includes(needle) || ru(style.name).toLowerCase().includes(needle))
		: group === "tpl-favorites"
			? all.filter((style) => favorites.includes(style.id) || isUserPresetId(style.id))
			: group === "tpl-new"
				? [...userStyles, ...(groupIds ?? []).map((id) => all.find((style) => style.id === id)).filter((style) => style !== undefined)]
				: groupIds
					? groupIds.map((id) => all.find((style) => style.id === id)).filter((style) => style !== undefined)
					: all;
	// the theme filter: only the themes this group has (a theme it lacks falls back to All)
	const themes = CAPTION_THEMES.filter((item) => styles.some((style) => captionTheme(style.id) === item.id));
	const active = themes.some((item) => item.id === theme) ? theme : "all";
	const shown = active === "all" ? styles : styles.filter((style) => captionTheme(style.id) === active);
	const showNew = !needle && (!group || group === "tpl-new");
	const removeStyle = (style: CaptionStyle) => {
		const removed = useUserPresets.getState().remove("captions", style.id);
		if (!removed) return;
		if (styleId === style.id) setStyleId(CAPTION_STYLES[0].id);
		toast(`“${style.name}” deleted`, {
			action: { label: "Undo", onClick: () => useUserPresets.getState().restore("captions", removed.item, removed.index) },
		});
	};
	const pick = async (style: CaptionStyle) => {
		setStyleId(style.id);
		if (captionCount === 0) {
			toast(`${style.name}: new captions get this template`);
			return;
		}
		const changed = await applyCaptionStyle({ editor, styleId: style.id, scope: "all" });
		toast.success(`${style.name}: ${changed} ${changed === 1 ? "caption" : "captions"} — ⌘Z to undo`);
	};
	return (
		<div className="flex flex-col gap-2" data-caption-templates={group ?? "all"}>
			{themes.length > 1 && (
				<div className="flex flex-wrap gap-1.5" data-theme-filter>
					{[{ id: "all" as const, label: "All" }, ...themes].map((item) => (
						<button
							key={item.id}
							type="button"
							data-theme={item.id}
							aria-pressed={active === item.id}
							onClick={() => setTheme(item.id)}
							className={cn(
								"h-6 rounded-full px-2.5 text-[11px] font-medium transition-colors",
								active === item.id ? "bg-primary text-primary-foreground" : "bg-foreground/[0.07] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.12]",
							)}
						>
							{t(item.label)}
						</button>
					))}
				</div>
			)}
			<div style={materialGrid()} data-material-grid>
				{showNew && (
					<CreatePresetTile
						runKey="captions"
						label="Create"
						placeholder="Big yellow words with a black outline, the spoken word pops…"
						className="gap-1 border-0 p-0"
						previewClassName="aspect-square rounded-md border-2 border-dashed"
						create={async ({ description, signal }) => {
							const style = await designCaptionStyle({ description, signal });
							useUserPresets.getState().addCaption(style);
							setStyleId(style.id);
						}}
					/>
				)}
				{shown.map((style) => (
					<div key={style.id} className="group relative" onPointerEnter={() => setHovered(style.id)} onPointerLeave={() => setHovered((id) => (id === style.id ? null : id))}>
					{/* CapCut shows the look alone (no name under it); the name is the tooltip. */}
					<button
						type="button"
						aria-pressed={style.id === styleId}
						aria-label={style.name}
						data-caption-style={style.id}
						title={captionCount > 0 ? `${t(style.name)}: apply to all ${captionCount} captions (⌘Z undoes)` : `${t(style.name)}: the template of new captions`}
						onClick={() => void pick(style)}
						className="flex w-full flex-col text-left"
					>
						<div className={cn("bg-neutral-800", TILE_THUMB, style.id === styleId && "border-primary group-hover:border-primary")}>
							<CaptionThumb style={style} lang={lang} playing={hovered === style.id} />
						</div>
					</button>
					{/* CapCut's ☆ at the tile's bottom-right corner: Favorites. */}
					<button
						type="button"
						aria-label={favorites.includes(style.id) ? `Remove ${style.name} from Favorites` : `Add ${style.name} to Favorites`}
						aria-pressed={favorites.includes(style.id)}
						title={favorites.includes(style.id) ? "Remove from Favorites" : "Add to Favorites"}
						data-caption-favorite={style.id}
						onClick={() => toggleFavorite(style.id)}
						className={cn(
							"absolute right-1 bottom-1 grid size-[18px] place-items-center rounded-full bg-black/55 text-[11px] leading-none transition-colors",
							favorites.includes(style.id) ? "text-yellow-300" : "text-white/85 hover:text-white",
						)}
					>
						{favorites.includes(style.id) ? "★" : "☆"}
					</button>
					{isUserPresetId(style.id) && (
						<button
							type="button"
							aria-label={`Delete ${style.name}`}
							title="Delete style"
							onClick={() => removeStyle(style)}
							className="bg-background/80 text-muted-foreground hover:text-foreground absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-sm text-xs leading-none opacity-0 group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100"
						>
							×
						</button>
					)}
					</div>
				))}
			</div>
			{styles.length === 0 && !showNew && (
				<p className="text-muted-foreground text-xs" data-caption-templates-empty>
					{needle ? "No templates found." : group === "tpl-favorites" ? "Click ☆ on a template to keep it here." : "No templates here yet."}
				</p>
			)}
		</div>
	);
}

/** The style on a caption that speaks the sample (word timings every 0.5 s), on its theme's scene. */
function CaptionThumb({ style, lang, playing }: { style: CaptionStyle; lang: string; playing: boolean }) {
	const element = useMemo(() => captionTileElement(style, lang), [style, lang]);
	return (
		<TextTile
			id={style.id}
			stillUrl={tileStillUrl(`caption:${style.id}`, lang)}
			element={element}
			still={captionStill(style)}
			duration={CAPTION_SAMPLE_SECONDS}
			scene={captionScene(style.id)}
			fontFamily={String(style.params.fontFamily ?? "")}
			playing={playing}
		/>
	);
}
