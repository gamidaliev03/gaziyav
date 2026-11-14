import { materialGrid, TILE_LABEL, TILE_THUMB, TileAddButton } from "@/components/editor/panels/assets/material-grid";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { tileActivation } from "@/components/editor/panels/assets/tile-activation";
import { useEditor } from "@/editor/use-editor";
import {
	presetTheme,
	TEXT_PRESET_GROUPS,
	TEXT_PRESETS,
	type TextPreset,
} from "@/text/presets";
import { THEMES, type Theme } from "@/text/theme-scenes";
import { cn } from "@/utils/ui";
import { useState } from "react";
import { buildPresetElement, settlePlayhead } from "@/text/insert-preset";
import { autoPlacement } from "@/commands/timeline/element/insert-element";
import { t } from "@/i18n";
import { PresetThumb } from "./preset-thumb";
import { MyTemplates, UserTextPresets } from "@/presets/components/text-presets-section";
import { TemplatesView } from "@/templates/components/templates-view";
import { ShapesSection } from "@/stickers/components/shapes-section";
import { MaterialsLayout, type NavItem } from "@/components/editor/panels/assets/materials-nav";


// Motion graphics (animated titles, lower thirds, counters) and Shapes live here since the owner's 12.11 night: no
// Stickers, no Templates tab.
const TEXT_NAV: NavItem[] = [
	{ key: "add", label: "Add text" },
	{ key: "motion", label: "Motion graphics" },
	// the multi-layer packs the owner uses (flash sale, product launch, titles, talking head — the focus department's
	// catalog keeps them); the Templates tab's own name, inside Text since 12.11 (the key stays «layouts»)
	{ key: "layouts", label: "Templates" },
	{ key: "shapes", label: "Shapes" },
	// «Subtitles» (the caption-like styles) said «Субтитры» like the Captions switch over the panel: its own name here
	{ key: "template", label: "Styles", children: TEXT_PRESET_GROUPS.map((group) => ({ key: `group:${group}`, label: group === "Subtitles" ? "Subtitle styles" : t(group) })) },
	{ key: "yours", label: "Yours" },
];

/** Text → Text: Add text (the Default text tile), Titles & plates by group, Yours last. Captions is the next sub-tab. */
export function TextView() {
	return (
		<MaterialsLayout
			tab="text"
			items={TEXT_NAV}
			render={(section) =>
				section === "yours" ? (
					<PanelView title="Yours">
						<UserTextPresets />
						<MyTemplates />
					</PanelView>
				) : section === "motion" ? (
					<TemplatesView section="motion" />
				) : section === "layouts" ? (
					<TemplatesView section="templates" />
				) : section === "shapes" ? (
					<ShapesSection />
				) : section === "add" ? (
					<PresetGrid title="Add text" groups={TEXT_PRESET_GROUPS} only={["plain"]} />
				) : (
					<PresetGrid title={section.slice("group:".length)} groups={[section.slice("group:".length)]} />
				)
			}
		/>
	);
}

function PresetGrid({ title, groups, only }: { title: string; groups: readonly string[]; only?: string[] }) {
	const editor = useEditor();
	// Hover preview: the tile under the pointer plays the whole animation, drawn by the player's renderer.
	const [hovered, setHovered] = useState<string | null>(null);
	// The theme filter (gaming, wedding, travel…): only the themes this view has.
	const [theme, setTheme] = useState<Theme | "all">("all");
	const inView = TEXT_PRESETS.filter((preset) => groups.includes(preset.group) && (!only || only.includes(preset.id)));
	const themes = THEMES.filter((item) => inView.some((preset) => presetTheme(preset) === item.id));
	// a theme the next group doesn't have falls back to All
	const active = themes.some((item) => item.id === theme) ? theme : "all";
	const shown = (preset: TextPreset) => active === "all" || presetTheme(preset) === active;

	const add = async (preset: TextPreset) => {
		if (!editor.project.getActiveOrNull()) return;
		const { element, start, duration } = await buildPresetElement({ editor, preset });
		editor.timeline.insertElement({ element, placement: { mode: "auto" } });
		settlePlayhead({ editor, preset, start, duration });
	};

	return (
		<PanelView title={t(title)}>
			{!only && themes.length > 1 && (
				<div className="mb-3 flex flex-wrap gap-1.5" data-theme-filter>
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
			{groups.filter((group) => inView.some((preset) => preset.group === group && shown(preset))).map((group) => (
				<div key={group} className="mb-4">
					{!only && groups.length > 1 && <div className="text-muted-foreground mb-2 text-xs">{t(group)}</div>}
					<div style={materialGrid()} data-material-grid>
						{inView.filter((preset) => preset.group === group && shown(preset)).map((preset) => (
							<div key={preset.id} className="group relative">
								<button
									type="button"
									{...tileActivation(() => void add(preset))}
									// Dragged onto the timeline: placed where it is dropped (its font loads on the drop).
									draggable
									onDragStart={(event) =>
										editor.timeline.dragSource.begin({
											dataTransfer: event.dataTransfer,
											dragData: {
												id: preset.id,
												type: "deferred",
												name: preset.name,
												elementType: "text",
												dur: preset.duration,
												place: async (at, hint) => {
													const { element } = await buildPresetElement({ editor, preset, at });
													editor.timeline.insertElement({ element, placement: autoPlacement(hint) });
												},
											},
										})
									}
									onDragEnd={() => editor.timeline.dragSource.end()}
									onPointerEnter={() => setHovered(preset.id)}
									onPointerLeave={() => setHovered((id) => (id === preset.id ? null : id))}
									onFocus={() => setHovered(preset.id)}
									onBlur={() => setHovered((id) => (id === preset.id ? null : id))}
									title={preset.name}
									className="flex w-full flex-col gap-1 text-left"
									data-text-preset={preset.id}
								>
									<div className={`overflow-hidden bg-[radial-gradient(120%_90%_at_50%_30%,#3a3d46_0%,#1c1d22_100%)] ${TILE_THUMB}`}>
										<PresetThumb preset={preset} playing={hovered === preset.id} />
									</div>
									<span className={TILE_LABEL}>{t(preset.name)}</span>
								</button>
								<TileAddButton onAdd={() => void add(preset)} />
							</div>
						))}
					</div>
				</div>
			))}
		</PanelView>
	);
}

