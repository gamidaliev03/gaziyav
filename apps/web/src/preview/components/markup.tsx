"use client";

// Preview · «Разметка» (WISHES 53): the social frame of the project's shape, TV safe areas, text zones, thirds — drawn
// over the player only (DOM; never in the render, the export, or the frame «look» shoots: data-look-hide).
import { GridIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import type { CSSProperties } from "react";
import { useActionHandler } from "@/actions/use-action-handler";
import { getActionShortcutLabel } from "@/actions/keybindings-store";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { useEditor } from "@/editor/use-editor";
import { useLang, useT } from "@/i18n";
import { cn } from "@/utils/ui";
import type { Guide, MarkupLayer } from "./markup-geometry";
import { aspectOfCanvas, liveMarkupGuides } from "./markup-live";
import { defaultMarkup, markupFor, setMarkup, toggleMarkup, toggleMarkupLayer, useMarkup, useSafeZones } from "./markup-store";
import { PLATFORMS_BY_LANGUAGE } from "./markup-zones";
import { VERTICAL_UNION, verticalPlatform } from "./markup-geometry";

// A 1 px light line with a 1 px dark companion outside it: reads on bright and on dark pictures alike.
const LINE = "border-white/75 shadow-[0_0_0_1px_rgb(0_0_0/0.45)]";
const LABEL = "absolute flex h-4 items-center overflow-hidden rounded-sm bg-black/55 px-1 text-[11px] leading-none whitespace-nowrap text-white/90 text-ellipsis";

function useCanvas() {
	return useEditor((e) => e.project.getActive().settings.canvasSize, ["project"]);
}

function GuideLabel({ guide, s, text }: { guide: Guide; s: number; text: string }) {
	const { w, h } = guide.rect;
	const at = guide.labelAt ?? "top-left";
	const room = (at === "vertical" ? h : w) * s - 8;
	if (room < 24 || (at === "vertical" ? w : h) * s < 20) return null;
	const style: CSSProperties = { maxWidth: room };
	if (at === "top-left") Object.assign(style, { left: 4, top: 4 });
	if (at === "top-right") Object.assign(style, { right: 4, top: 4 });
	if (at === "center") Object.assign(style, { left: "50%", top: 4, transform: "translateX(-50%)" });
	if (at === "vertical") Object.assign(style, { left: "50%", top: "50%", transform: "translate(-50%, -50%) rotate(90deg)" });
	return (
		<span className={LABEL} style={style} title={text} data-markup-label={guide.id}>
			{text}
		</span>
	);
}

/** The guides over the scene (mounted under the handles; nothing here takes the pointer). */
export function MarkupGuides({ sceneWidth }: { sceneWidth: number; sceneHeight: number }) {
	const t = useT();
	const canvas = useCanvas();
	const lang = useLang((l) => l.lang);
	const state = useMarkup();
	const aspect = aspectOfCanvas(canvas);
	const m = markupFor(aspect, state);
	const guides = liveMarkupGuides(canvas, lang, state);
	if (guides.length === 0) return null;
	const s = sceneWidth / canvas.width;
	const ui = aspect === "9:16" ? verticalPlatform(m.platform) : null;
	return (
		<div className="pointer-events-none absolute inset-0 overflow-hidden" data-markup-guides={aspect} data-look-hide="" aria-hidden>
			{guides.map((g) => {
				const box: CSSProperties = { left: g.rect.x * s, top: g.rect.y * s, width: g.rect.w * s, height: g.rect.h * s };
				const label = m.labels && g.label ? t(g.label) : "";
				const text = g.id === "social-top" && ui && ui.id !== VERTICAL_UNION.id ? `${ui.label} · ${label}` : label;
				if (g.kind === "line") {
					const vertical = g.rect.w === 0;
					return (
						<div
							key={g.id}
							data-markup-guide={g.id}
							className={cn("absolute bg-white/75", vertical ? "w-px shadow-[1px_0_0_rgb(0_0_0/0.45)]" : "h-px shadow-[0_1px_0_rgb(0_0_0/0.45)]")}
							style={vertical ? { left: box.left, top: 0, height: box.height } : { top: box.top, left: 0, width: box.width }}
						/>
					);
				}
				if (g.kind === "cross") {
					return (
						<div key={g.id} data-markup-guide={g.id} className="absolute" style={box}>
							<div className="absolute top-1/2 left-0 h-px w-full bg-white/75 shadow-[0_1px_0_rgb(0_0_0/0.45)]" />
							<div className="absolute top-0 left-1/2 h-full w-px bg-white/75 shadow-[1px_0_0_rgb(0_0_0/0.45)]" />
						</div>
					);
				}
				return (
					<div
						key={g.id}
						data-markup-guide={g.id}
						className={cn(
							"absolute box-border",
							g.kind === "band" && "bg-black/35",
							g.kind === "frame" && cn("border", LINE),
							g.kind === "zone" && cn("border border-dashed bg-white/[0.06]", LINE),
						)}
						style={box}
					>
						{text && <GuideLabel guide={g} s={s} text={text} />}
					</div>
				);
			})}
		</div>
	);
}

const LAYER_LABEL: Record<MarkupLayer, string> = { social: "Social frame", broadcast: "TV safe", text: "Text zones", thirds: "Thirds and centre" };
const ROW = "hover:bg-accent flex h-8 cursor-pointer items-center justify-between gap-3 px-3 text-[13px] font-normal";

/** The bar's «Разметка» button: the key flips the guides, the menu picks them. */
export function MarkupButton() {
	const t = useT();
	const canvas = useCanvas();
	const aspect = aspectOfCanvas(canvas);
	const lang = useLang((l) => l.lang);
	// the saved entry (stable) or the default, made outside the selector: a fresh object per call loops the store
	const saved = useMarkup((s) => s.byAspect[aspect]);
	const m = saved ?? defaultMarkup(aspect);
	const warn = useSafeZones((s) => s.warn);
	const outside = useSafeZones((s) => s.outside);
	useActionHandler("toggle-markup", () => toggleMarkup(aspect), undefined);
	const on = m.on && m.layers.length > 0;
	const key = getActionShortcutLabel({ action: "toggle-markup" });
	const name = t("Markup");
	const platforms = PLATFORMS_BY_LANGUAGE[lang];
	const layers: MarkupLayer[] = aspect === "custom" ? ["broadcast", "text", "thirds"] : ["social", "broadcast", "text", "thirds"];
	const swId = (id: string) => `markup-${id}`;
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					variant="text"
					size="icon"
					className={cn("relative size-7 justify-center rounded-md", on && "text-primary")}
					title={key ? `${name} (${key})` : name}
					aria-label={name}
					aria-pressed={on}
					data-markup-button={on ? "on" : "off"}
					data-safe-zones-button={on ? (outside > 0 && warn ? "warn" : "on") : "off"}
				>
					<HugeiconsIcon icon={GridIcon} className="size-4" />
					{on && warn && outside > 0 && <span className="bg-caution absolute top-1 right-1 size-1.5 rounded-full" />}
				</Button>
			</PopoverTrigger>
			<PopoverContent sideOffset={8} collisionPadding={8} className="w-64 px-0 py-1" data-markup-menu={aspect}>
				<Label htmlFor={swId("on")} className={ROW}>
					<span>{t("Show markup")}</span>
					<span className="flex items-center gap-2">
						{key && <span className="text-muted-foreground text-xs tabular-nums">{key}</span>}
						<Switch id={swId("on")} checked={on} onCheckedChange={() => toggleMarkup(aspect)} data-markup-toggle="on" />
					</span>
				</Label>
				<div className="my-1 border-t" />
				{layers.map((layer) => (
					<div key={layer}>
						<Label htmlFor={swId(layer)} className={ROW}>
							<span className={cn(!m.on && "text-muted-foreground")}>{t(LAYER_LABEL[layer])}</span>
							<Switch id={swId(layer)} checked={m.layers.includes(layer)} onCheckedChange={() => toggleMarkupLayer(aspect, layer)} data-markup-toggle={layer} />
						</Label>
						{layer === "social" && aspect === "9:16" && (
							<RadioGroup
								aria-label={t("Social frame")}
								value={m.platform}
								onValueChange={(value) => setMarkup(aspect, { platform: value, on: true, layers: m.layers.includes("social") ? m.layers : [...m.layers, "social"] })}
								className="gap-0 pb-1"
							>
								{platforms.map((id) => {
									const p = verticalPlatform(id);
									return (
										<Label key={id} htmlFor={swId(`p-${id}`)} className="hover:bg-accent flex h-7 cursor-pointer items-center gap-2.5 pr-3 pl-6 text-[13px] font-normal">
											<RadioGroupItem id={swId(`p-${id}`)} value={id} data-safe-zone-choice={id === "all" ? "universal" : id} data-markup-platform={id} />
											{id === "all" ? t(VERTICAL_UNION.label) : p.label}
										</Label>
									);
								})}
							</RadioGroup>
						)}
					</div>
				))}
				<div className="my-1 border-t" />
				<Label htmlFor={swId("labels")} className={ROW}>
					<span>{t("Zone labels")}</span>
					<Switch id={swId("labels")} checked={m.labels} onCheckedChange={(checked) => setMarkup(aspect, { labels: checked })} data-markup-toggle="labels" />
				</Label>
				{aspect !== "custom" && (
					<Label htmlFor={swId("warn")} className={ROW}>
						<span>{t("Warn when text is under the app UI")}</span>
						<Switch id={swId("warn")} checked={warn} onCheckedChange={(checked) => useSafeZones.getState().setWarn(checked)} data-markup-toggle="warn" />
					</Label>
				)}
			</PopoverContent>
		</Popover>
	);
}
