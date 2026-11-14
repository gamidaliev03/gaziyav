"use client";

// Media → the compound clips an older project's extra timelines became (timeline/join-timelines.ts). A tile per clip:
// drag it or double-click it onto the timeline, ↗ (or the context menu) opens its own timeline.
import { ArrowUpRight01Icon, Layers01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { DraggableItem } from "@/components/editor/panels/assets/draggable-item";
import { materialGrid } from "@/components/editor/panels/assets/material-grid";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { useEditor } from "@/editor/use-editor";
import { useT } from "@/i18n";
import { compoundLength, mediaCompounds, openMediaCompound, placeMediaCompound, removeMediaCompound } from "@/timeline/media-compounds";
import { TICKS_PER_SECOND } from "@/wasm";

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function useMediaCompoundCount(): number {
	return useEditor((e) => mediaCompounds(e.scenes.getScenes()).length, ["scenes"]);
}

export function MediaCompounds({ grid, query }: { grid: boolean; query: string }) {
	const t = useT();
	const editor = useEditor();
	const scenes = useEditor((e) => e.scenes.getScenes(), ["scenes"]);
	const q = query.trim().toLowerCase();
	const items = mediaCompounds(scenes).filter((scene) => !q || scene.name.toLowerCase().includes(q));
	if (items.length === 0) return null;
	return (
		<div data-media-compounds="" className="flex flex-col gap-1.5">
			<h3 className="text-muted-foreground text-xs font-medium">{t("Compound clips")}</h3>
			<div className={grid ? undefined : "flex flex-col gap-1.5"} style={grid ? materialGrid() : undefined}>
				{items.map((scene) => {
					const seconds = compoundLength(scene) / TICKS_PER_SECOND;
					const open = () => void openMediaCompound(editor, scene.id);
					// the product's default name reads in the interface language («Составной клип 3»), a typed one stays
					const n = /^Compound clip (\d+)$/.exec(scene.name)?.[1];
					const name = n ? `${t("Compound clip")} ${n}` : scene.name;
					return (
						<ContextMenu key={scene.id}>
							<ContextMenuTrigger asChild>
								<div
									data-media-compound={scene.id}
									// a press focuses the tile: Delete / ⌫ then takes it out of Media (one ⌘Z), like any Media item
									tabIndex={-1}
									className="rounded focus-visible:ring-ring outline-hidden focus-visible:ring-2"
									onPointerDown={(event) => event.currentTarget.focus({ preventScroll: true })}
									onKeyDown={(event) => {
										if (event.key !== "Delete" && event.key !== "Backspace") return;
										event.preventDefault();
										event.stopPropagation();
										removeMediaCompound(editor, scene.id);
									}}
								>
									<DraggableItem
										name={name}
										preview={
											<div className="bg-muted/30 text-muted-foreground group relative flex size-full flex-col items-center justify-center gap-1 rounded">
												<HugeiconsIcon icon={Layers01Icon} className="size-6" />
												{seconds > 0 && <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-xs text-white">{clock(seconds)}</span>}
												<button
													type="button"
													data-media-compound-open=""
													aria-label={t("Open the compound clip")}
													title={t("Open the compound clip")}
													className="absolute top-1 left-1 grid size-6 place-items-center rounded-full bg-black/65 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/80 focus-visible:opacity-100"
													onPointerDown={(event) => event.stopPropagation()}
													onDoubleClick={(event) => event.stopPropagation()}
													onClick={(event) => {
														event.stopPropagation();
														open();
													}}
												>
													<HugeiconsIcon icon={ArrowUpRight01Icon} className="size-3" />
												</button>
											</div>
										}
										dragData={{
											id: scene.id,
											type: "deferred",
											name,
											elementType: "graphic",
											dur: seconds,
											place: async (start, hint) => {
												placeMediaCompound(editor, scene.id, start, hint);
											},
										}}
										shouldShowPlusOnDrag={false}
										onAddToTimeline={() => placeMediaCompound(editor, scene.id)}
										variant={grid ? "card" : "compact"}
										aspectRatio={1}
										isRounded={grid ? false : undefined}
										containerClassName={grid ? "w-full" : undefined}
									/>
								</div>
							</ContextMenuTrigger>
							<ContextMenuContent>
								<ContextMenuItem onSelect={open}>{t("Open the compound clip")}</ContextMenuItem>
								<ContextMenuItem onSelect={() => placeMediaCompound(editor, scene.id)}>{t("Insert at the playhead")}</ContextMenuItem>
								<ContextMenuItem variant="destructive" data-media-compound-delete="" onSelect={() => removeMediaCompound(editor, scene.id)}>
									{t("Delete")}
								</ContextMenuItem>
							</ContextMenuContent>
						</ContextMenu>
					);
				})}
			</div>
		</div>
	);
}
