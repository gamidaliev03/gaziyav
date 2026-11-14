// The one icon component of the app (DESIGN.md I1–I3, icons department 14.11). Every glyph is a @hugeicons glyph
// drawn here, so the box, the stroke and the alignment are decided once:
// - box: 16 or 20 px (I2). A request of 13–16 px is drawn at 16, 17–24 px at 20; a micro glyph (≤ 12 px: a fold
//   chevron, a tile badge) keeps its size inside a 16 box, and the extra room is given back by a negative margin so
//   the layout around it does not move. Above 24 px (empty-state art) the request is kept.
// - stroke: one weight in screen pixels at every size, round caps and joins (I1). A look may set its own weight with
//   the token `--gz-icon-stroke` (a length, default 1.5px) — the only contract with themes/**.
// - colour: the text's colour (currentColor); a caller's `fill` is for «on / selected» only (I1).
// The export keeps the name and props of @hugeicons/react's component, so a file switches by its import line only.
import type { HugeiconsIconProps, IconSvgElement } from "@hugeicons/react";
import { type CSSProperties, createElement, forwardRef } from "react";

export type { HugeiconsIconProps, IconSvgElement };

const STROKE = "var(--gz-icon-stroke, 1.5px)";

/** The size a caller asked for: the `size` prop, else the last size utility of its class, else null (CSS decides). */
function requested(size: unknown, className: string): number | null | "css" {
	if (typeof size === "number") return size;
	if (typeof size === "string" && /^\d+(\.\d+)?(px)?$/.test(size)) return parseFloat(size);
	let px: number | null = null;
	let free = false;
	for (const raw of className.split(/\s+/)) {
		if (!raw || raw.includes(":")) continue;
		const c = raw.replace(/!$/, "").replace(/^!/, "");
		const m = c.match(/^(?:size|w|h)-(\d+(?:\.\d+)?)$/) || c.match(/^(?:size|w|h)-\[(\d+(?:\.\d+)?)px\]$/);
		if (m) {
			const v = c.includes("[") ? Number(m[1]) : Number(m[1]) * 4;
			if (!c.startsWith("w-") || px === null) px = v;
			continue;
		}
		if (/^(?:size|w|h)-(full|auto|fit|screen|\[.*\])$/.test(c)) free = true;
	}
	if (px !== null) return px;
	return free ? "css" : null;
}

function box(req: number): { box: number; glyph: number } {
	if (req > 24) return { box: req, glyph: req };
	if (req > 16) return { box: 20, glyph: 20 };
	if (req > 12) return { box: 16, glyph: 16 };
	return { box: 16, glyph: Math.max(req, 8) };
}

export const HugeiconsIcon = forwardRef<SVGSVGElement, HugeiconsIconProps>(function GzIcon(
	{
		icon,
		altIcon,
		showAlt = false,
		size,
		className = "",
		style,
		color = "currentColor",
		primaryColor,
		secondaryColor,
		disableSecondaryOpacity = false,
		// one stroke for the app (I1): a caller's own weight is not used
		strokeWidth: _strokeWidth,
		absoluteStrokeWidth: _absolute,
		...rest
	},
	ref,
) {
	const req = requested(size, className);
	let sized: CSSProperties = {};
	let viewBox = "0 0 24 24";
	if (req !== "css") {
		const { box: b, glyph } = box(req ?? 16);
		sized = { width: b, height: b, flexShrink: 0 };
		if (glyph < b) {
			const span = (24 * b) / glyph;
			const o = (span - 24) / 2;
			viewBox = `${-o} ${-o} ${span} ${span}`;
			if (!/(^|\s)(absolute|fixed)(\s|$)/.test(className)) {
				const m = -(b - glyph) / 2;
				sized.margin = m;
			}
		}
	}
	const ink = primaryColor || color;
	const glyphs = showAlt && altIcon ? altIcon : icon;
	const children = [...glyphs]
		.sort(([, a], [, b]) => (b.opacity !== undefined ? 1 : a.opacity !== undefined ? -1 : 0))
		.map(([tag, attrs], i) => {
			const secondary = attrs.opacity !== undefined;
			const stroked = attrs.stroke !== undefined || attrs.strokeWidth !== undefined;
			const two = secondaryColor
				? stroked
					? { stroke: secondary ? secondaryColor : ink }
					: { fill: secondary ? secondaryColor : ink }
				: {};
			return createElement(tag, {
				...attrs,
				...two,
				...(stroked ? { strokeWidth: undefined, strokeLinecap: "round", strokeLinejoin: "round", style: { strokeWidth: STROKE, vectorEffect: "non-scaling-stroke" } } : {}),
				opacity: secondary && !disableSecondaryOpacity ? attrs.opacity : undefined,
				key: (attrs.key as string) ?? i,
			});
		});
	return createElement(
		"svg",
		{
			ref,
			xmlns: "http://www.w3.org/2000/svg",
			width: req === "css" ? 24 : (sized.width as number),
			height: req === "css" ? 24 : (sized.height as number),
			viewBox,
			fill: "none",
			color: ink,
			"data-gz-icon": "",
			className,
			...rest,
			style: { ...sized, ...style },
		},
		children,
	);
});

/** The same component under the app's own name, for new code. */
export const Icon = HugeiconsIcon;

/**
 * Disclosure chevrons (I3): one glyph (ArrowDown01Icon), one direction rule, one motion. Folded, it points where the
 * content will open (down); open, it turns half a circle in the app's shortest motion token. Use as
 * `className={cn("size-3.5", fold(open))}`.
 */
export const FOLD_MOTION = "transition-transform duration-[var(--gz-t1)] ease-[var(--gz-ease)] motion-reduce:transition-none";
export function fold(open: boolean): string {
	return open ? `${FOLD_MOTION} rotate-180` : FOLD_MOTION;
}
