"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { resolveGlyphState, resolveTextAnimFrame } from "@/animation/presets";
import { glyphMotion, glyphsActive, glyphUnit, shimmerAt } from "@/text/glyph-anim";
import { TICKS_PER_SECOND } from "@/wasm";

type Slot = "in" | "out" | "loop";

/**
 * The preset label animates with its own preset while hovered (CapCut-style
 * hover preview). rAF throttled to ~30 fps; stops on leave; static when idle.
 */
export function AnimatedPresetLabel({
	slot,
	kind,
	label,
	hovered,
}: {
	slot: Slot;
	kind: string;
	label: string;
	hovered: boolean;
}) {
	const [style, setStyle] = useState<CSSProperties>({});
	const [visible, setVisible] = useState(label.length);
	// per-letter kinds (Letters pop, Scatter, Mask reveal…): one transform per letter
	const [letters, setLetters] = useState<CSSProperties[] | null>(null);

	useEffect(() => {
		if (!hovered || kind === "none") {
			setStyle({});
			setVisible(label.length);
			setLetters(null);
			return;
		}
		const clip = 1.2; // seconds of the virtual clip
		const cycle = slot === "loop" ? 2 : clip + 0.5;
		const params: Record<string, unknown> = {
			[`anim.${slot}`]: kind,
			"anim.inDuration": 0.5,
			"anim.outDuration": 0.5,
		};
		const started = performance.now();
		let last = -Infinity;
		let raf = 0;
		const tick = (now: number) => {
			if (now - last >= 32) {
				last = now;
				let t = ((now - started) / 1000) % cycle;
				if (slot !== "loop") t = Math.min(t, clip - 1 / 30);
				const f = resolveTextAnimFrame({
					params,
					duration: clip * TICKS_PER_SECOND,
					localTime: t * TICKS_PER_SECOND,
					canvasWidth: 120,
					canvasHeight: 28,
				});
				setStyle({
					display: "inline-block",
					transform: `translate(${f.offsetX}px, ${f.offsetY}px) scale(${f.scale}) rotate(${f.rotate}deg)`,
					opacity: f.opacity,
					filter: f.blur > 0 ? `blur(${(f.blur * 12).toFixed(2)}px)` : undefined,
					letterSpacing: f.tracking ? `${f.tracking}em` : undefined,
				});
				setVisible(Math.ceil(label.length * f.reveal));
				const glyphs = resolveGlyphState({ params, duration: clip * TICKS_PER_SECOND, localTime: t * TICKS_PER_SECOND });
				if (glyphs && (glyphsActive(glyphs) || shimmerAt(glyphs) != null || glyphs.loopKind === "glowPulse")) {
					const chars = Array.from(label);
					const unit = glyphUnit(glyphs);
					let word = 0;
					const wordOf = chars.map((c, i) => {
						if (i > 0 && /\s/.test(chars[i - 1]) && !/\s/.test(c)) word++;
						return word;
					});
					const shine = shimmerAt(glyphs);
					setLetters(
						chars.map((_, i) => {
							const n = unit === "word" ? Math.max(1, wordOf[chars.length - 1] + 1) : unit === "line" ? 1 : chars.length;
							const index = unit === "word" ? wordOf[i] : unit === "line" ? 0 : i;
							const m = glyphMotion({ state: glyphs, i: index, n, x: chars.length > 1 ? i / (chars.length - 1) : 0.5, lineEm: 1.2, unit });
							const lit = shine != null && Math.abs(i / Math.max(1, chars.length - 1) - shine) < 0.18;
							return {
								display: "inline-block",
								whiteSpace: "pre",
								transform: `translate(${m.dx}em, ${m.dy}em) rotate(${m.rotate}deg) scale(${m.scale}, ${m.scale * m.scaleY})`,
								opacity: m.alpha,
								clipPath: m.masked ? "inset(-10% -10% -10% -10%)" : undefined,
								color: lit ? "#ffffff" : undefined,
								textShadow: glyphs.loopKind === "glowPulse" ? `0 0 ${(0.25 + 0.35 * Math.sin(t * 7)).toFixed(2)}em currentColor` : undefined,
							};
						}),
					);
				} else setLetters(null);
			}
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [hovered, kind, slot, label]);

	if (letters) {
		return (
			<span style={{ ...style, overflow: "hidden" }} className="pointer-events-none whitespace-nowrap">
				{Array.from(label).map((char, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: letters of a fixed label
					<span key={i} style={letters[i]}>
						{char}
					</span>
				))}
			</span>
		);
	}
	return (
		<span style={style} className="pointer-events-none whitespace-nowrap">
			{label.slice(0, visible)}
			<span className="invisible">{label.slice(visible)}</span>
		</span>
	);
}
