// The Gaziyav brand pieces (docs/GAZIYAV.md): the mark (three mountains), the wordmark and Gaziyav AI's avatar.
import { useId } from "react";
import { cn } from "@/utils/ui";
import { KryloMark } from "./krylo-mark";

// Three mountains of the Caucasus: the gold peak in front, the glacier-teal and the night-blue ones behind, snow on
// the two tallest and a line of the mountain ornament under them. One drawing for the header, the Dock icon
// (GaziyavShell/make_icon.swift draws the same shapes) and the loading screen.
export const MOUNTAINS = {
	back: { points: "4,84 33,33 60,84", from: "#3FC7B8", to: "#1C7F77" },
	right: { points: "42,84 72,42 97,84", from: "#3B6E8F", to: "#203B52" },
	front: { points: "20,88 50,16 80,88", from: "#F6C46E", to: "#D7861A" },
	snowFront: "50,16 41.5,36.5 46.2,33.2 50,38.6 53.8,33.2 58.5,36.5",
	snowBack: "33,33 27.2,43.6 30.6,41.4 33.4,44.6 36.4,41.2 38.6,42.6",
	ornament: "M12 94 l5 -3.2 l5 3.2 l5 -3.2 l5 3.2 l5 -3.2 l5 3.2 l5 -3.2 l5 3.2 l5 -3.2 l5 3.2 l5 -3.2 l5 3.2 l5 -3.2 l5 3.2 l5 -3.2",
} as const;

/** The mark (the three mountains). `pointClassName` is kept for callers that tinted the old mark's centre. */
export function PointMark({ className }: { className?: string; pointClassName?: string }) {
	return <KryloMark className={className} />;
	return <Mountains className={className} />;
}

function Mountains({ className }: { className?: string }) {
	const id = useId().replace(/:/g, "");
	const m = MOUNTAINS;
	return (
		<svg viewBox="0 0 100 100" fill="none" aria-hidden="true" className={cn("shrink-0", className)}>
			<defs>
				{(["back", "right", "front"] as const).map((k) => (
					<linearGradient key={k} id={`${id}-${k}`} x1="50" y1="14" x2="50" y2="90" gradientUnits="userSpaceOnUse">
						<stop stopColor={m[k].from} />
						<stop offset="1" stopColor={m[k].to} />
					</linearGradient>
				))}
			</defs>
			<polygon points={m.back.points} fill={`url(#${id}-back)`} />
			<polygon points={m.right.points} fill={`url(#${id}-right)`} />
			<polygon points={m.front.points} fill={`url(#${id}-front)`} />
			<polygon points={m.snowBack} fill="#F4F7F8" opacity="0.92" />
			<polygon points={m.snowFront} fill="#FBF6EC" />
			<path d={m.ornament} stroke="#E8A33D" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
		</svg>
	);
}

/** Mark + "Gaziyav" set in Unbounded. */
export function Wordmark({ className, markClassName, textClassName }: { className?: string; markClassName?: string; textClassName?: string }) {
	return (
		<span className={cn("inline-flex items-center gap-2.5", className)} aria-label="Gaziyav">
			<PointMark className={cn("size-7", markClassName)} />
			<span aria-hidden="true" className={cn("font-display text-[1.05rem] font-semibold tracking-[-0.03em]", textClassName)}>
				Gaziyav
			</span>
		</span>
	);
}

/** Gaziyav AI's avatar: a gold spark on night blue, the assistant's bubble. */
export function AgentAvatar({ className }: { className?: string }) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[radial-gradient(circle_at_30%_25%,#f6d59c,#e8a33d_55%,#9a5f10)] text-[#1a1206] shadow-[0_0_0_1px_rgb(255_255_255/0.12)_inset,0_2px_8px_-2px_rgb(232_163_61/0.6)]",
				className,
			)}
		>
			<svg viewBox="0 0 16 16" className="size-[62%]" fill="currentColor">
				<path d="M8 1.5c.35 2.9 1.6 4.15 4.5 4.5-2.9.35-4.15 1.6-4.5 4.5-.35-2.9-1.6-4.15-4.5-4.5 2.9-.35 4.15-1.6 4.5-4.5Z" />
				<path d="M12.6 9.6c.15 1.2.67 1.72 1.9 1.9-1.23.17-1.75.7-1.9 1.9-.17-1.2-.7-1.73-1.9-1.9 1.2-.18 1.73-.7 1.9-1.9Z" opacity=".75" />
			</svg>
		</span>
	);
}
