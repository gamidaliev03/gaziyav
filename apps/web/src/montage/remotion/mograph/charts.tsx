// Two infographics in print-editorial and whiteboard styles: a chart of bars with a line over them (a headline, a key,
// the source under it) and a decision tree of sticky notes branching from one question. Motion adapted from the
// Hyperframes examples «NYT Graph» and «Decision Tree» (Apache-2.0, credited in GaziyavShell/skills-gaziyav/NOTICE.md),
// redrawn with the kit: every text, number and colour is a field, the layout follows the frame.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { col, E, Fill, fitP, fontOf, list, MaskLine, type MP, num, str, useMg } from "./base";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Bars that rise one by one and a line drawn across them on its own scale, under a serif headline and a key. */
export const MgEditorialChart: React.FC<MP> = (p) => {
	const m = useMg(p);
	const labels = list(p.labels, "Jan, Feb, Mar, Apr, May, Jun").slice(0, 10);
	const bars = list(p.values, "42, 48, 45, 58, 66, 74").map((v) => Math.max(0, num(v, 0))).slice(0, 10);
	const line = list(p.line, "2.1, 2.4, 2.2, 2.9, 3.3, 3.8").map((v) => Math.max(0, num(v, 0))).slice(0, 10);
	const n = Math.max(2, Math.min(bars.length, 10));
	const barMax = Math.max(1e-9, ...bars.slice(0, n));
	const lineMax = Math.max(1e-9, ...line.slice(0, n));
	const ink = col(p.ink, "#121212");
	const lineColor = col(p.accent, "#C0392B");
	const barColor = col(p.color2, "#7A93A8");
	const serif = fontOf(p, "PlayfairDisplay");
	const sans = fontOf({ ...p, font: "Manrope" }, "Manrope");
	const W = m.W * (m.shape === "wide" ? 0.78 : 0.86);
	const H = m.H * (m.shape === "tall" ? 0.34 : 0.46);
	const slot = W / n;
	const bw = slot * 0.56;
	const title = str(p.title, "Monthly revenue vs. conversion");
	const subtitle = str(p.subtitle, "January–June, in thousands");
	const source = str(p.source, "Source: company report");
	const unit = str(p.unit);
	const barsStart = 0.9;
	const step = Math.min(0.14, (m.L * 0.35) / n);
	const drawStart = barsStart + n * step * 0.6;
	const draw = m.at(drawStart, Math.min(1.6, m.L * 0.3), E.inOut);
	const pts = line.slice(0, n).map((v, i) => [slot * (i + 0.5), H - (v / lineMax) * H * 0.78] as const);
	const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
	const labelSize = clamp(slot * 0.26, 14 * m.u, 30 * m.u);
	const id = `ec-${str(p.id, "mg").replace(/[^\w-]/g, "")}`;
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			{p.backdrop !== false && <Fill color={col(p.bg, "#F7F4EC")} />}
			<AbsoluteFill style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 26 * m.u }}>
				<div style={{ width: W, display: "flex", flexDirection: "column", gap: 10 * m.u }}>
					{title && (
						<MaskLine t={m.at(0, 0.7)}>
							<div style={{ fontFamily: serif, fontWeight: 700, fontSize: fitP({ ...p, font: str(p.font, "PlayfairDisplay") }, title, W, 70 * m.u, 0.5), color: ink, lineHeight: 1.1 }}>{title}</div>
						</MaskLine>
					)}
					{subtitle && <div style={{ fontFamily: sans, fontSize: 30 * m.u, color: ink, opacity: 0.62 * m.at(0.25, 0.5) }}>{subtitle}</div>}
					<div style={{ display: "flex", gap: 34 * m.u, opacity: m.at(0.45, 0.5), fontFamily: sans, fontSize: 26 * m.u, color: ink }}>
						<span style={{ display: "flex", alignItems: "center", gap: 10 * m.u }}>
							<span style={{ width: 22 * m.u, height: 22 * m.u, background: barColor }} />
							{str(p.barName, "Revenue")}
						</span>
						<span style={{ display: "flex", alignItems: "center", gap: 10 * m.u }}>
							<span style={{ width: 34 * m.u, height: 4 * m.u, background: lineColor }} />
							{str(p.lineName, "Conversion, %")}
						</span>
					</div>
				</div>
				<div style={{ position: "relative", width: W, height: H }}>
					<svg aria-hidden="true" width={W} height={H} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
						<defs>
							<clipPath id={`${id}-c`}>
								<rect x={-20 * m.u} y={-H} width={(W + 40 * m.u) * draw} height={H * 3} />
							</clipPath>
						</defs>
						{[0.25, 0.5, 0.75, 1].map((g, i) => (
							<line key={g} x1={0} x2={W * m.at(0.5 + i * 0.05, 0.6, E.inOut)} y1={H - g * H * 0.82} y2={H - g * H * 0.82} stroke={ink} strokeOpacity={0.14} strokeWidth={1.5 * m.u} strokeDasharray={`${4 * m.u} ${5 * m.u}`} />
						))}
						<line x1={0} x2={W * m.at(0.5, 0.6, E.inOut)} y1={H} y2={H} stroke={ink} strokeWidth={2.5 * m.u} />
						{bars.slice(0, n).map((v, i) => {
							const t = m.at(barsStart + i * step, 0.7, E.outQuart);
							const h = (v / barMax) * H * 0.82 * t;
							return <rect key={`b${i}-${v}`} x={slot * (i + 0.5) - bw / 2} y={H - h} width={bw} height={h} fill={barColor} />;
						})}
						<g clipPath={`url(#${id}-c)`}>
							<path d={d} fill="none" stroke={lineColor} strokeWidth={5 * m.u} strokeLinejoin="round" strokeLinecap="round" />
						</g>
						{pts.map(([x, y], i) => {
							const t = m.at(drawStart + (i / Math.max(1, n - 1)) * Math.min(1.6, m.L * 0.3), 0.3, E.back);
							return <circle key={`d${i}-${x}`} cx={x} cy={y} r={9 * m.u * t} fill={col(p.bg, "#F7F4EC")} stroke={lineColor} strokeWidth={4 * m.u} />;
						})}
					</svg>
					{bars.slice(0, n).map((v, i) => {
						const t = m.at(barsStart + i * step + 0.45, 0.4);
						const h = (v / barMax) * H * 0.82;
						return (
							<span key={`v${i}-${v}`} style={{ position: "absolute", left: slot * i, width: slot, top: H - h - 40 * m.u, textAlign: "center", fontFamily: sans, fontWeight: 700, fontSize: labelSize, color: ink, opacity: t, fontVariantNumeric: "tabular-nums" }}>
								{v}
								{unit}
							</span>
						);
					})}
					{labels.slice(0, n).map((l, i) => (
						<span key={`l${i}-${l}`} style={{ position: "absolute", left: slot * i, width: slot, top: H + 12 * m.u, textAlign: "center", fontFamily: sans, fontSize: labelSize, color: ink, opacity: 0.7 * m.at(0.6 + i * 0.04, 0.4) }}>
							{l}
						</span>
					))}
				</div>
				{source && <div style={{ width: W, marginTop: 30 * m.u, fontFamily: sans, fontSize: 22 * m.u, color: ink, opacity: 0.5 * m.at(drawStart + 0.6, 0.6) }}>{source}</div>}
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

const NOTES = ["#FFE27A", "#B9EBC2", "#FFD0B0", "#D9CCFF", "#BFE3FF", "#FFC8DC", "#FFE27A"];

/** One question on a sticky note, two answers branching from it, four outcomes under them; one can be picked. */
export const MgFlowchart: React.FC<MP> = (p) => {
	const m = useMg(p);
	const ink = col(p.ink, "#1F2328");
	const a = col(p.accent, "#FF5A5F");
	const family = fontOf(p, "Manrope");
	const pastel = p.pastel !== false;
	const tall = m.shape === "tall";
	const texts = [
		str(p.question, "Want to learn to code?"),
		str(p.left, "Yes"),
		str(p.right, "Not sure"),
		str(p.leftA, "Start with Python"),
		str(p.leftB, "Try no-code"),
		str(p.rightA, "Build a website"),
		str(p.rightB, "Take a course"),
	];
	const nodeW = m.W * (tall ? 0.215 : 0.16);
	const rootW = m.W * (tall ? 0.6 : 0.3);
	const nodeH = m.H * (tall ? 0.085 : 0.13);
	const rows = tall ? [0.24, 0.42, 0.62] : [0.17, 0.44, 0.74];
	const pos: [number, number][] = [
		[0.5, rows[0]],
		[0.28, rows[1]],
		[0.72, rows[1]],
		[0.14, rows[2]],
		[0.38, rows[2]],
		[0.62, rows[2]],
		[0.86, rows[2]],
	].map(([x, y]) => [x * m.W, y * m.H]);
	// Timing of the original: the root, a hold, the two branches together, their notes, a hold, the four leaves.
	const appear = [0, 1.4, 1.6, 2.4, 2.55, 2.7, 2.85];
	const wires: [number, number, number][] = [
		[0, 1, 1.0],
		[0, 2, 1.0],
		[1, 3, 2.1],
		[1, 4, 2.1],
		[2, 5, 2.1],
		[2, 6, 2.1],
	];
	const pick = clamp(Math.round(num(p.pick, 1)), 0, 4);
	const pickAt = 3.6;
	const sw = 4 * m.u;
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			{p.backdrop !== false && <Fill color={col(p.bg, "#FFFFFF")} />}
			<svg aria-hidden="true" width={m.W} height={m.H} style={{ position: "absolute", inset: 0 }}>
				{wires.map(([from, to, start]) => {
					const [x1, y1] = pos[from];
					const [x2, y2] = pos[to];
					const top = y1 + nodeH / 2;
					const bottom = y2 - nodeH / 2;
					const mid = (top + bottom) / 2;
					const t = m.at(start, 0.5, E.linear);
					return <path key={`${from}-${to}`} d={`M${x1},${top} V${mid} H${x2} V${bottom}`} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - t} fill="none" stroke={ink} strokeOpacity={0.55} strokeWidth={sw} strokeLinejoin="round" />;
				})}
			</svg>
			{texts.map((text, i) => {
				const [x, y] = pos[i];
				const w = i === 0 ? rootW : nodeW;
				const s = m.at(appear[i], 0.4, i === 0 ? E.out : E.back);
				const picked = pick > 0 && i === pick + 2;
				const sel = picked ? m.at(pickAt, 0.25) : 0;
				const fill = pastel ? NOTES[i] : `${a}26`;
				const half = Math.ceil(text.length / 2);
				const size = Math.min(i === 0 ? 46 * m.u : 34 * m.u, fitP(p, text.length > 14 ? text.slice(0, half + 2) : text, w * 0.84, i === 0 ? 46 * m.u : 34 * m.u));
				return (
					<div
						key={`n${i}-${text}`}
						style={{
							position: "absolute",
							left: x - w / 2,
							top: y - nodeH / 2,
							width: w,
							height: nodeH,
							scale: String(s),
							rotate: `${(i % 2 ? -1 : 1) * 1.2}deg`,
							background: fill,
							borderRadius: 10 * m.u,
							boxShadow: `0 ${6 * m.u}px ${18 * m.u}px rgba(0,0,0,0.12)`,
							outline: sel ? `${5 * m.u}px solid ${a}` : "none",
							outlineOffset: 6 * m.u,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							textAlign: "center",
							padding: `0 ${w * 0.07}px`,
							fontFamily: family,
							fontWeight: i === 0 ? 800 : 700,
							fontSize: size,
							lineHeight: 1.15,
							color: ink,
						}}
					>
						{text}
						{picked && (
							<span style={{ position: "absolute", right: -18 * m.u, top: -22 * m.u, width: 48 * m.u, height: 48 * m.u, borderRadius: "50%", background: a, color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30 * m.u, fontWeight: 800, scale: String(m.at(pickAt + 0.35, 0.3, E.back)) }}>
								✓
							</span>
						)}
					</div>
				);
			})}
		</AbsoluteFill>
	);
};
