// Ready-made Lottie animations (LottieFiles, Google's animated Noto emoji) as motion graphics: the file plays
// frame-exact through the kit's Lottie player, pops in, sits where the inspector puts it with an optional caption,
// and can be recoloured to the accent. Full-frame ones (fireworks, confetti, money rain) cover the frame.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { Lottie } from "../assets";
import { col, E, fitP, fontOf, mix, type MP, num, str, useMg } from "./base";

const url = (p: MP, file: string) => `${str(p.origin)}/mograph/lottie/${file}.json`;

/** The component of one Lottie graphic; emoji tiles take the file from their «Emoji» field. */
export function lottieGraphic(file: string, fill = false): React.FC<MP> {
	const Graphic: React.FC<MP> = (p) => {
		const m = useMg(p);
		const name = str(p.emoji, file) || file;
		const asset = { type: "lottie" as const, url: url(p, name), title: name };
		const tint = p.tint === true ? col(p.accent, "#FFD23F") : undefined;
		const speed = Math.max(0.25, Math.min(3, num(p.speed, 1)));
		const loop = p.loop !== false;
		if (fill) {
			return (
				<AbsoluteFill style={{ opacity: Math.max(0.1, Math.min(1, num(p.opacity, 1))) * m.out }}>
					<Lottie asset={asset} loop={loop} speed={speed} tint={tint} fit="slice" style={{ width: m.W, height: m.H }} />
				</AbsoluteFill>
			);
		}
		const short = Math.min(m.W, m.H);
		const size = short * Math.max(0.1, Math.min(1.2, num(p.size, 0.5)));
		const place = str(p.place, "center");
		const caption = str(p.caption).trim();
		const fs = caption ? fitP(p, caption, Math.max(size, short * 0.6), 64 * m.u) : 0;
		const capH = caption ? fs * 1.5 : 0;
		const margin = short * 0.07;
		// Tall frames keep clear of the platform's top bar and bottom caption band.
		const top = margin * (m.shape === "tall" ? 2.4 : 1);
		const bottom = margin * (m.shape === "tall" ? 3.6 : 1);
		const cx = place.endsWith("left") ? margin + size / 2 : place.endsWith("right") ? m.W - margin - size / 2 : m.W / 2;
		const cy = place.startsWith("top") ? top + size / 2 : place.startsWith("bottom") ? m.H - bottom - capH - size / 2 : m.H / 2 - capH / 2;
		const pop = m.at(0, 0.45, E.back);
		const capIn = m.at(0.2, 0.4);
		return (
			<AbsoluteFill style={{ opacity: m.out }}>
				<div style={{ position: "absolute", left: cx - size / 2, top: cy - size / 2, width: size, height: size, scale: String(mix(0.3, 1, pop) * mix(0.85, 1, m.out)), opacity: Math.min(1, pop * 2) }}>
					<Lottie asset={asset} loop={loop} speed={speed} tint={tint} style={{ width: size, height: size }} />
				</div>
				{caption && (
					<div
						style={{
							position: "absolute",
							left: 0,
							right: 0,
							top: cy + size / 2,
							display: "flex",
							justifyContent: place.endsWith("left") ? "flex-start" : place.endsWith("right") ? "flex-end" : "center",
							paddingInline: margin,
							opacity: capIn,
							translate: `0 ${mix(20, 0, capIn) * m.u}px`,
						}}
					>
						<span style={{ fontFamily: fontOf(p, "Montserrat"), fontWeight: 800, fontSize: fs, lineHeight: 1.2, color: col(p.ink, "#FFFFFF"), textShadow: "0 2px 12px rgba(0,0,0,0.55)", whiteSpace: "nowrap" }}>{caption}</span>
					</div>
				)}
			</AbsoluteFill>
		);
	};
	return Graphic;
}
