// amber with a gloss — separated by a dark outline, a soft amber glow under them. The same drawing as the app icon
// (GaziyavShell/make_icon.swift, master ROOT/preview/logo/krylo-v2.svg), without the tile.
// `mono`: a single-colour glyph in currentColor (the top bar, About): the feathers cut apart by a mask, so the gaps stay
import { useId } from "react";
import { cn } from "@/utils/ui";

// In the master's 512 grid, cropped to the fan: a rounded bar of `w`, turned by `angle` around the root.
const ROOT = { x: 141, y: 319 };
const FEATHERS = [
	{ w: 168, angle: -68, from: "#585c66", to: "#8b909b" },
	{ w: 214, angle: -37, from: "#cfc9bd", to: "#f6f3ec" },
	{ w: 262, angle: -6, from: "#ff6f2c", to: "#ffd98a" },
] as const;
const VIEW = "92 118 340 262";

function bar(w: number) {
	return { x: ROOT.x - 25, y: ROOT.y - 25, width: w, height: 50, rx: 25 };
}
const turn = (angle: number) => `rotate(${angle} ${ROOT.x} ${ROOT.y})`;

export function KryloMark({ className, mono = false, glow = true }: { className?: string; mono?: boolean; glow?: boolean }) {
	const id = useId().replace(/:/g, "");
	if (mono) {
		return (
			<svg viewBox={VIEW} aria-hidden="true" className={cn("shrink-0", className)} data-mark="krylo">
				<defs>
					<mask id={`${id}-cut`} maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">
						{FEATHERS.map((f) => (
							<g key={f.angle} transform={turn(f.angle)}>
								<rect {...bar(f.w)} fill="white" stroke="black" strokeWidth="18" paintOrder="stroke" />
							</g>
						))}
					</mask>
				</defs>
				<rect x="0" y="0" width="512" height="512" fill="currentColor" mask={`url(#${id}-cut)`} />
			</svg>
		);
	}
	return (
		<svg viewBox={VIEW} aria-hidden="true" className={cn("shrink-0", className)} data-mark="krylo">
			<defs>
				{FEATHERS.map((f, i) => (
					<linearGradient key={f.angle} id={`${id}-f${i}`} x1="0" y1="0" x2="1" y2="0">
						<stop offset="0" stopColor={f.from} />
						<stop offset="1" stopColor={f.to} />
					</linearGradient>
				))}
				<linearGradient id={`${id}-gloss`} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor="#fff" stopOpacity=".38" />
					<stop offset=".55" stopColor="#fff" stopOpacity="0" />
				</linearGradient>
				<radialGradient id={`${id}-glow`} cx=".5" cy=".5" r=".5">
					<stop offset="0" stopColor="#ff8a2b" stopOpacity=".32" />
					<stop offset="1" stopColor="#ff8a2b" stopOpacity="0" />
				</radialGradient>
			</defs>
			{glow && <ellipse cx="262" cy="318" rx="170" ry="70" fill={`url(#${id}-glow)`} />}
			<g stroke="#15171b" strokeWidth="9" paintOrder="stroke">
				{FEATHERS.map((f, i) => (
					<rect key={f.angle} {...bar(f.w)} fill={`url(#${id}-f${i})`} transform={turn(f.angle)} />
				))}
				<rect x={ROOT.x - 17} y={ROOT.y - 20} width="246" height="20" rx="10" fill={`url(#${id}-gloss)`} stroke="none" transform={turn(-6)} />
			</g>
		</svg>
	);
}
