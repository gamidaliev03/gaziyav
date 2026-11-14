// Annotations (hand-drawn arrow, callout, circle mark, magnifier), social pieces (reaction rail, comment reply,
// follow button), widgets (weather with Meteocons icons, a live analog clock, a geotag), picture frames (polaroid,
// film strip, phone) and data (line chart, poll, progress bar). Positions are fractions of the frame, so one setting
// fits 9:16, 16:9 and 1:1.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { Lottie } from "../assets";
import { Center, col, E, Fill, fitP, fontOf, list, Logo, mix, type MP, num, str, useMg } from "./base";
import { Slot } from "./overlays";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const frac = (v: unknown, d: number) => clamp(num(v, d), 0, 1);
const shadow = "0 3px 14px rgba(0,0,0,0.55)";

// ───────────── Arrows & callouts ─────────────

/** A hand-drawn arrow sweeping in towards a spot, the head snapping on, a scribbled label at its tail. */
export const MgArrow: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FFD23F");
	const short = Math.min(m.W, m.H);
	const tx = m.W * frac(p.x, 0.62);
	const ty = m.H * frac(p.y, 0.42);
	const dirs: Record<string, [number, number]> = { left: [-1, 0.5], right: [1, 0.5], top: [-0.35, -1], bottom: [0.35, 1] };
	const [dx, dy] = dirs[str(p.from, "left")] ?? dirs.left;
	const len = Math.hypot(dx, dy);
	const d = short * 0.4;
	const sx = tx + (dx / len) * d;
	const sy = ty + (dy / len) * d;
	const bend = num(p.bend, 0.35);
	const mx = (sx + tx) / 2 - ((ty - sy) * bend) / 1;
	const my = (sy + ty) / 2 + ((tx - sx) * bend) / 1;
	// The arrow stops a little short of the spot; the head follows the curve's last direction.
	const ex = tx - ((tx - mx) / Math.hypot(tx - mx, ty - my)) * short * 0.04;
	const ey = ty - ((ty - my) / Math.hypot(tx - mx, ty - my)) * short * 0.04;
	const ang = Math.atan2(ey - my, ex - mx);
	const w = clamp(num(p.thickness, 12), 2, 40) * m.u;
	const draw = m.at(0.1, 0.55, E.inOut);
	const head = m.at(0.6, 0.3, E.back);
	const hl = short * 0.07;
	const label = str(p.label);
	const path = `M${sx},${sy} Q${mx},${my} ${ex},${ey}`;
	const fs = label ? fitP(p, label, short * 0.6, 84 * m.u) : 0;
	// The label sits under the tail (over it when the arrow comes from above), kept inside the frame.
	const est = Math.min(m.W * 0.88, label.length * fs * 0.62 * 1.1);
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<svg aria-hidden="true" width={m.W} height={m.H} style={{ position: "absolute", inset: 0, overflow: "visible", filter: `drop-shadow(0 ${3 * m.u}px ${6 * m.u}px rgba(0,0,0,0.45))` }}>
				<path d={path} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - draw} fill="none" stroke={a} strokeWidth={w} strokeLinecap="round" />
				<g transform={`translate(${ex} ${ey}) rotate(${(ang * 180) / Math.PI}) scale(${head})`}>
					<path d={`M${-hl},${-hl * 0.75} L0,0 L${-hl},${hl * 0.7}`} fill="none" stroke={a} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
				</g>
			</svg>
			{label && (
				<div style={{ position: "absolute", left: clamp(sx, m.W * 0.06 + est / 2, m.W * 0.94 - est / 2), top: dy < 0 ? sy - fs * 1.5 : sy + fs * 0.3, translate: "-50% 0", rotate: "-4deg", fontFamily: fontOf(p, "Rubik"), fontWeight: 900, fontSize: fs, color: col(p.ink, "#FFFFFF"), textShadow: shadow, whiteSpace: "nowrap", opacity: m.at(0, 0.35), scale: String(mix(0.6, 1, m.at(0, 0.4, E.back))) }}>{label}</div>
			)}
		</AbsoluteFill>
	);
};

/** A callout: a pulsing dot on the spot, a leader line drawn out to the side and a title with a small line. */
export const MgCallout: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FFFFFF");
	const ink = col(p.ink, "#FFFFFF");
	const x = m.W * frac(p.x, 0.45);
	const y = m.H * frac(p.y, 0.55);
	const right = str(p.side, "right") === "right";
	const s = right ? 1 : -1;
	const short = Math.min(m.W, m.H);
	const dot = 16 * m.u;
	const kx = x + s * short * 0.09;
	const ky = y - short * 0.09;
	const run = short * 0.2;
	const line = m.at(0.25, 0.5, E.inOut);
	const t1 = m.at(0.6, 0.45);
	const title = str(p.title, "Handmade leather");
	const sub = str(p.sub);
	const family = fontOf(p, "Manrope");
	const pulse = (m.sec * 1.2) % 1;
	const pts = `M${x},${y} L${kx},${ky} L${kx + s * run},${ky}`;
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<div style={{ position: "absolute", left: x - dot * 2.5, top: y - dot * 2.5, width: dot * 5, height: dot * 5, borderRadius: "50%", border: `${3 * m.u}px solid ${a}`, scale: String(mix(0.3, 1.2, pulse)), opacity: (1 - pulse) * m.at(0, 0.3) }} />
			<div style={{ position: "absolute", left: x - dot, top: y - dot, width: dot * 2, height: dot * 2, borderRadius: "50%", background: a, boxShadow: shadow, scale: String(m.at(0, 0.35, E.back)) }} />
			<svg aria-hidden="true" width={m.W} height={m.H} style={{ position: "absolute", inset: 0, overflow: "visible", filter: `drop-shadow(${shadow})` }}>
				<path d={pts} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - line} fill="none" stroke={a} strokeWidth={4 * m.u} strokeLinejoin="round" />
			</svg>
			<div style={{ position: "absolute", top: ky - 70 * m.u, left: right ? kx + 8 * m.u : undefined, right: right ? undefined : m.W - kx + 8 * m.u, width: m.W * 0.6, textAlign: right ? "left" : "right", overflow: "hidden" }}>
				<div style={{ fontFamily: family, fontWeight: 800, fontSize: fitP(p, title, Math.max(run * 1.4, short * 0.45), 54 * m.u), color: ink, textShadow: shadow, translate: `0 ${mix(100, 0, t1)}%`, opacity: t1, whiteSpace: "nowrap" }}>{title}</div>
			</div>
			{sub && <div style={{ position: "absolute", top: ky + 14 * m.u, left: right ? kx + 8 * m.u : undefined, right: right ? undefined : m.W - kx + 8 * m.u, fontFamily: family, fontWeight: 600, fontSize: 34 * m.u, color: ink, opacity: 0.85 * m.at(0.8, 0.4), textShadow: shadow, whiteSpace: "nowrap" }}>{sub}</div>}
		</AbsoluteFill>
	);
};

/** A marker circle scribbled around a spot (a loop and a bit), with an optional note underneath. */
export const MgCircleMark: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FF3B30");
	const short = Math.min(m.W, m.H);
	const cx = m.W * frac(p.x, 0.5);
	const cy = m.H * frac(p.y, 0.45);
	const rx = (short * clamp(num(p.size, 0.36), 0.08, 1)) / 2;
	const ry = rx * clamp(num(p.squash, 0.7), 0.3, 1.5);
	const pts = Array.from({ length: 73 }, (_, i) => i).map((i) => {
		const t = (i / 72) * Math.PI * 2 * 1.12 - 2.2;
		const wob = 1 + 0.045 * Math.sin(t * 3 + 1) + 0.02 * Math.sin(t * 7) + 0.05 * (i / 72);
		return `${(cx + Math.cos(t) * rx * wob).toFixed(1)},${(cy + Math.sin(t) * ry * wob).toFixed(1)}`;
	});
	const draw = m.at(0.05, 0.6, E.inOut);
	const label = str(p.label);
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<svg aria-hidden="true" width={m.W} height={m.H} style={{ position: "absolute", inset: 0, overflow: "visible", filter: `drop-shadow(0 ${2 * m.u}px ${5 * m.u}px rgba(0,0,0,0.4))` }}>
				<polyline points={pts.join(" ")} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - draw} fill="none" stroke={a} strokeWidth={clamp(num(p.thickness, 10), 2, 40) * m.u} strokeLinecap="round" strokeLinejoin="round" />
			</svg>
			{label && <div style={{ position: "absolute", left: 0, right: 0, top: cy + ry * 1.12, textAlign: "center", fontFamily: fontOf(p, "Rubik"), fontWeight: 900, fontSize: fitP(p, label, short * 0.7, 72 * m.u), color: col(p.ink, a), textShadow: shadow, rotate: "-3deg", opacity: m.at(0.55, 0.3), scale: String(mix(0.7, 1, m.at(0.55, 0.35, E.back))) }}>{label}</div>}
		</AbsoluteFill>
	);
};

/** A magnifying glass over the picture: the lens shows it enlarged around the spot, glints, and drifts a little. */
export const MgMagnifier: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FFFFFF");
	const short = Math.min(m.W, m.H);
	const R = (short * clamp(num(p.size, 0.42), 0.15, 0.9)) / 2;
	const zoom = clamp(num(p.zoom, 2.2), 1.2, 6);
	const cx = m.W * frac(p.x, 0.5) + Math.sin(m.sec * 0.8) * 18 * m.u;
	const cy = m.H * frac(p.y, 0.45) + Math.cos(m.sec * 0.6) * 14 * m.u;
	const t = m.at(0, 0.5, E.back);
	const picture = (style: React.CSSProperties) => (
		<div style={{ position: "absolute", width: m.W, height: m.H, ...style }}>
			<Slot p={p} k="photo" label="" />
		</div>
	);
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			{p.backdrop !== false && picture({ left: 0, top: 0 })}
			<div style={{ position: "absolute", left: cx - R, top: cy - R, width: R * 2, height: R * 2, scale: String(t), opacity: Math.min(1, t * 2) }}>
				<div style={{ position: "absolute", left: R * 1.62, top: R * 1.62, width: R * 0.95, height: R * 0.26, borderRadius: R * 0.13, background: `linear-gradient(180deg, #3A3A40, #111114)`, rotate: "45deg", transformOrigin: "0 50%", boxShadow: shadow }} />
				<div style={{ position: "absolute", inset: 0, borderRadius: "50%", overflow: "hidden", boxShadow: `0 0 0 ${R * 0.07}px ${a}, 0 ${10 * m.u}px ${40 * m.u}px rgba(0,0,0,0.55)` }}>
					{picture({ left: R - cx, top: R - cy, transformOrigin: `${cx}px ${cy}px`, scale: String(zoom) })}
					<div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "radial-gradient(circle at 30% 25%, rgba(255,255,255,0.35), transparent 35%), radial-gradient(circle, transparent 70%, rgba(0,0,0,0.25) 100%)" }} />
				</div>
			</div>
		</AbsoluteFill>
	);
};

// ───────────── Social ─────────────

const ICONS = {
	heart: "M12 21.3l-1.4-1.3C5.4 15.4 2 12.3 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.4 22 8.5c0 3.8-3.4 6.9-8.6 11.5L12 21.3z",
	comment: "M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
	save: "M6 2h12a1 1 0 0 1 1 1v19l-7-4.5L5 22V3a1 1 0 0 1 1-1z",
	share: "M14 4l8 7.5-8 7.5v-4.6c-5.7 0-9.3 1.7-12 5.6 1-5.6 4.2-10.8 12-11.8V4z",
};

/** The reaction rail of a short video: profile with «+», then like, comment, save and share with counts; the like pops. */
export const MgSocialRail: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FE2C55");
	const ink = col(p.ink, "#FFFFFF");
	const family = fontOf(p, "Manrope");
	const s = (m.shape === "tall" ? 96 : 80) * m.u;
	const liked = m.sec > 1.3;
	const tap = E.back(clamp((m.sec - 1.3) / 0.35, 0, 1));
	const items: [keyof typeof ICONS, string][] = [
		["heart", str(p.likes, "128K")],
		["comment", str(p.comments, "2,048")],
		["save", str(p.saves, "15K")],
		["share", str(p.shares, "9,120")],
	];
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<div style={{ position: "absolute", right: m.W * (m.shape === "tall" ? 0.035 : 0.03), bottom: m.H * (m.shape === "tall" ? 0.2 : 0.1), display: "flex", flexDirection: "column", alignItems: "center", gap: s * 0.42 }}>
				<div style={{ position: "relative", marginBottom: s * 0.2, translate: `${mix(160, 0, m.at(0, 0.45))}% 0` }}>
					<Logo p={{ ...p, bg: "#111111" }} size={s * 1.05} ring={ink} />
					<div style={{ position: "absolute", left: "50%", bottom: -s * 0.2, translate: "-50% 0", width: s * 0.4, height: s * 0.4, borderRadius: "50%", background: a, color: "#FFFFFF", display: "grid", placeItems: "center", fontFamily: family, fontWeight: 900, fontSize: s * 0.34, lineHeight: 1 }}>+</div>
				</div>
				{items.map(([icon, label], i) => {
					const t = m.at(0.12 + i * 0.1, 0.45);
					const hot = icon === "heart" && liked;
					return (
						<div key={icon} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: s * 0.08, translate: `${mix(220, 0, t)}% 0`, opacity: Math.min(1, t * 2) }}>
							<svg aria-hidden="true" width={s * 0.8} height={s * 0.8} viewBox="0 0 24 24" style={{ filter: `drop-shadow(${shadow})`, scale: String(hot ? mix(1.5, 1, tap) : 1) }}>
								<path d={ICONS[icon]} fill={hot ? a : ink} />
							</svg>
							<span style={{ fontFamily: family, fontWeight: 800, fontSize: s * 0.27, color: ink, textShadow: shadow }}>{label}</span>
						</div>
					);
				})}
			</div>
		</AbsoluteFill>
	);
};

/** «Reply to …'s comment»: the white comment card a creator answers on video, popping in with a tilt. */
export const MgCommentReply: React.FC<MP> = (p) => {
	const m = useMg(p);
	const ink = col(p.ink, "#111111");
	const card = col(p.card, "#FFFFFF");
	const family = fontOf(p, "Manrope");
	const name = str(p.name, "anna.k");
	const comment = str(p.comment, "How did you make this?? 😍");
	const w = Math.min(m.W * 0.84, 860 * m.u);
	const fs = fitP(p, comment, w * 1.7, 48 * m.u, 0.5);
	const t = m.at(0, 0.5, E.back);
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<div style={{ position: "absolute", left: (m.W - w) / 2, top: m.H * (m.shape === "tall" ? 0.2 : 0.12), width: w, padding: `${24 * m.u}px ${30 * m.u}px`, borderRadius: 28 * m.u, background: card, boxShadow: "0 12px 40px rgba(0,0,0,0.35)", scale: String(mix(0.5, 1, t)), rotate: `${mix(-8, -2, t)}deg`, opacity: Math.min(1, t * 2), display: "flex", gap: 20 * m.u, alignItems: "flex-start" }}>
				<div style={{ flexShrink: 0 }}>
					<Logo p={{ ...p, name, accent: col(p.accent, "#FE2C55") }} size={72 * m.u} />
				</div>
				<div style={{ display: "flex", flexDirection: "column", gap: 6 * m.u, minWidth: 0 }}>
					<span style={{ fontFamily: family, fontWeight: 600, fontSize: 30 * m.u, color: ink, opacity: 0.55 }}>Reply to {name}'s comment</span>
					<span style={{ fontFamily: family, fontWeight: 800, fontSize: fs, lineHeight: 1.25, color: ink }}>{comment}</span>
				</div>
			</div>
		</AbsoluteFill>
	);
};

/** A follow card: profile, name and a «Follow» button a cursor clicks — it turns into «Following ✓». */
export const MgFollowButton: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FE2C55");
	const ink = col(p.ink, "#111111");
	const card = col(p.card, "#FFFFFF");
	const family = fontOf(p, "Manrope");
	const w = Math.min(m.W * 0.86, 820 * m.u);
	const h = 150 * m.u;
	const x = (m.W - w) / 2;
	const y = m.H * (m.shape === "tall" ? 0.68 : 0.66) - h / 2;
	const t = m.at(0, 0.5, E.back);
	const click = 1.5;
	const done = m.sec > click;
	const press = 1 - 0.1 * Math.sin(Math.PI * clamp((m.sec - click + 0.08) / 0.18, 0, 1));
	const bw = 230 * m.u;
	const bx = x + w - bw - 26 * m.u + bw * 0.55;
	const by = y + h / 2 + 10 * m.u;
	const cur = E.inOut(clamp((m.sec - 0.5) / 0.9, 0, 1));
	const curX = mix(m.W * 0.9, bx, cur);
	const curY = mix(m.H * 0.95, by, cur);
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<div style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: h / 2, background: card, boxShadow: "0 12px 40px rgba(0,0,0,0.35)", display: "flex", alignItems: "center", gap: 22 * m.u, padding: `0 ${26 * m.u}px 0 ${18 * m.u}px`, scale: String(mix(0.6, 1, t)), opacity: Math.min(1, t * 2) }}>
				<Logo p={{ ...p, accent: a }} size={h * 0.74} />
				<div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
					<span style={{ fontFamily: family, fontWeight: 800, fontSize: 40 * m.u, color: ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{str(p.name, "Your Name")}</span>
					<span style={{ fontFamily: family, fontWeight: 600, fontSize: 30 * m.u, color: ink, opacity: 0.55, whiteSpace: "nowrap" }}>{str(p.handle, "@yourname")}</span>
				</div>
				<div style={{ width: bw, height: h * 0.52, borderRadius: 999, background: done ? "#E9E9EE" : a, color: done ? ink : "#FFFFFF", display: "grid", placeItems: "center", fontFamily: family, fontWeight: 800, fontSize: 34 * m.u, scale: String(press), flexShrink: 0 }}>{done ? `${str(p.done, "Following")} ✓` : str(p.button, "Follow")}</div>
			</div>
			<svg aria-hidden="true" width={64 * m.u} height={64 * m.u} viewBox="0 0 24 24" style={{ position: "absolute", left: curX, top: curY, opacity: m.at(0.4, 0.3) * (1 - m.at(click + 0.6, 0.4)), scale: String(press), filter: `drop-shadow(${shadow})` }}>
				<path d="M4 2l15 11.5-6.4 1.1 3.9 7.2-2.8 1.4-3.8-7.3L4 20z" fill="#FFFFFF" stroke="#111111" strokeWidth={1.4} strokeLinejoin="round" />
			</svg>
		</AbsoluteFill>
	);
};

// ───────────── Widgets ─────────────

/** Meteocons (Bas Milius, MIT): the weather icons the widget animates (public/mograph/lottie/weather-*.json). */
export const WEATHER = ["clear-day", "partly-cloudy-day", "overcast-day", "rain", "thunderstorms-day-rain", "snow", "clear-night"];

/** A weather card: the animated icon, the temperature counting up, the place and the day's high and low. */
export const MgWeather: React.FC<MP> = (p) => {
	const m = useMg(p);
	const ink = col(p.ink, "#FFFFFF");
	const a = col(p.accent, "#4DA3FF");
	const family = fontOf(p, "Manrope");
	const cond = WEATHER.includes(str(p.condition)) ? str(p.condition) : "clear-day";
	const temp = num(p.temp, 24);
	const t = m.at(0, 0.55, E.back);
	const shown = Math.round(temp * m.at(0.2, 0.9, E.outQuart));
	const w = Math.min(m.W * 0.84, 780 * m.u);
	const icon = 230 * m.u;
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<div style={{ position: "absolute", left: (m.W - w) / 2, top: m.H * (m.shape === "tall" ? 0.14 : 0.1), width: w, padding: `${20 * m.u}px ${36 * m.u}px`, borderRadius: 44 * m.u, background: `linear-gradient(140deg, ${a}cc, ${a}66)`, border: "1px solid rgba(255,255,255,0.35)", boxShadow: "0 16px 50px rgba(0,0,0,0.3)", display: "flex", alignItems: "center", gap: 16 * m.u, scale: String(mix(0.7, 1, t)), opacity: Math.min(1, t * 2), backdropFilter: "blur(12px)" }}>
				<div style={{ width: icon, height: icon, flexShrink: 0, margin: -20 * m.u }}>
					<Lottie asset={{ type: "lottie", url: `${str(p.origin)}/mograph/lottie/weather-${cond}.json`, title: cond }} style={{ width: icon, height: icon }} />
				</div>
				<div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, alignItems: "flex-end" }}>
					<span style={{ fontFamily: family, fontWeight: 800, fontSize: 150 * m.u, lineHeight: 1, color: ink, fontVariantNumeric: "tabular-nums" }}>
						{shown}
						{str(p.unit, "°")}
					</span>
					<span style={{ fontFamily: family, fontWeight: 800, fontSize: fitP(p, str(p.city, "Lisbon"), w * 0.5, 46 * m.u), color: ink, whiteSpace: "nowrap" }}>{str(p.city, "Lisbon")}</span>
					<span style={{ fontFamily: family, fontWeight: 600, fontSize: 30 * m.u, color: ink, opacity: 0.8, whiteSpace: "nowrap" }}>{str(p.detail)}</span>
				</div>
			</div>
		</AbsoluteFill>
	);
};

/** An analog clock whose hands run from the set time (real time or a fast time-lapse), with a line underneath. */
export const MgClock: React.FC<MP> = (p) => {
	const m = useMg(p);
	const face = col(p.bg, "#FFFFFF");
	const ink = col(p.ink, "#111111");
	const a = col(p.accent, "#FF3B30");
	const mt = /^(\d{1,2}):(\d{2})/.exec(str(p.time, "10:09"));
	const start = mt ? Number(mt[1]) * 3600 + Number(mt[2]) * 60 : 36540;
	const now = start + m.sec * clamp(num(p.speed, 1), 1, 3600);
	const R = (Math.min(m.W, m.H) * clamp(num(p.size, 0.5), 0.2, 0.9)) / 2;
	const t = m.at(0, 0.5, E.back);
	const hand = (deg: number, len: number, w: number, c: string) => <div style={{ position: "absolute", left: R - w / 2, top: R - len, width: w, height: len + w * 1.6, borderRadius: w, background: c, transformOrigin: `50% ${len}px`, rotate: `${deg}deg` }} />;
	const label = str(p.label);
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<Center gap={30 * m.u}>
				<div style={{ position: "relative", width: R * 2, height: R * 2, borderRadius: "50%", background: face, boxShadow: `0 14px 50px rgba(0,0,0,0.4), inset 0 0 0 ${R * 0.05}px ${ink}22`, scale: String(t), opacity: Math.min(1, t * 2) }}>
					{Array.from({ length: 60 }, (_, i) => i).map((i) => (
						<div key={i} style={{ position: "absolute", left: R - (i % 5 ? 1.5 : 4) * m.u, top: R * 0.08, width: (i % 5 ? 3 : 8) * m.u, height: R * (i % 5 ? 0.05 : 0.11), background: ink, opacity: i % 5 ? 0.45 : 1, transformOrigin: `50% ${R * 0.92}px`, rotate: `${i * 6}deg`, borderRadius: 2 * m.u }} />
					))}
					{hand(((now / 3600) % 12) * 30, R * 0.5, 14 * m.u, ink)}
					{hand(((now / 60) % 60) * 6, R * 0.74, 9 * m.u, ink)}
					{hand((Math.floor(now) % 60) * 6, R * 0.82, 4 * m.u, a)}
					<div style={{ position: "absolute", left: R - 14 * m.u, top: R - 14 * m.u, width: 28 * m.u, height: 28 * m.u, borderRadius: "50%", background: a, border: `${5 * m.u}px solid ${face}` }} />
				</div>
				{label && <div style={{ fontFamily: fontOf(p, "Manrope"), fontWeight: 800, fontSize: fitP(p, label, R * 2.4, 64 * m.u), color: col(p.color2, "#FFFFFF"), textShadow: shadow, opacity: m.at(0.4, 0.4) }}>{label}</div>}
			</Center>
		</AbsoluteFill>
	);
};

const PIN = "M12 2C7.6 2 4 5.4 4 9.8 4 15.6 12 22 12 22s8-6.4 8-12.2C20 5.4 16.4 2 12 2zm0 10.8a3 3 0 1 1 0-6 3 3 0 0 1 0 6z";

/** A location sticker: a pin and the place on a white pill, dropping in with a bounce; an optional second line. */
export const MgGeotag: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FF3D71");
	const ink = col(p.ink, "#111111");
	const card = col(p.card, "#FFFFFF");
	const family = fontOf(p, "Montserrat");
	const place = str(p.place, "Lisbon, Portugal");
	const sub = str(p.sub);
	const fs = fitP(p, place, m.W * 0.6, 50 * m.u);
	const drop = m.at(0, 0.6, E.back);
	const bob = Math.sin(m.sec * 3) * 4 * m.u;
	const pos = str(p.position, "top");
	const top = pos === "bottom" ? m.H * (m.shape === "tall" ? 0.74 : 0.8) : pos === "center" ? m.H * 0.46 : m.H * (m.shape === "tall" ? 0.13 : 0.09);
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<div style={{ position: "absolute", left: 0, right: 0, top, display: "flex", justifyContent: "center", translate: `0 ${mix(-160, 0, drop) * m.u}px`, opacity: Math.min(1, drop * 3) }}>
				<div style={{ display: "flex", alignItems: "center", gap: 14 * m.u, padding: `${16 * m.u}px ${34 * m.u}px ${16 * m.u}px ${20 * m.u}px`, borderRadius: 999, background: card, boxShadow: "0 10px 34px rgba(0,0,0,0.3)", rotate: `${mix(-6, -1.5, drop)}deg` }}>
					<svg aria-hidden="true" width={fs * 1.4} height={fs * 1.4} viewBox="0 0 24 24" style={{ translate: `0 ${bob}px` }}>
						<path d={PIN} fill={a} />
					</svg>
					<div style={{ display: "flex", flexDirection: "column" }}>
						<span style={{ fontFamily: family, fontWeight: 800, fontSize: fs, color: ink, whiteSpace: "nowrap", lineHeight: 1.15 }}>{place}</span>
						{sub && <span style={{ fontFamily: family, fontWeight: 600, fontSize: fs * 0.55, color: ink, opacity: 0.55, whiteSpace: "nowrap" }}>{sub}</span>}
					</div>
				</div>
			</div>
		</AbsoluteFill>
	);
};

// ───────────── Frames ─────────────

/** A polaroid dropping onto the frame and settling at an angle, a handwritten-style caption under the picture. */
export const MgPolaroid: React.FC<MP> = (p) => {
	const m = useMg(p);
	const card = col(p.bg, "#FAF8F2");
	const w = Math.min(m.W, m.H) * (m.shape === "wide" ? 0.62 : 0.74);
	const t = m.at(0, 0.8, E.out);
	const rot = num(p.rotate, -4);
	const caption = str(p.caption, "Summer '26");
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<Center>
				<div style={{ width: w, padding: `${w * 0.05}px ${w * 0.05}px ${w * 0.2}px`, background: card, boxShadow: "0 24px 60px rgba(0,0,0,0.45)", rotate: `${mix(rot - 16, rot, t)}deg`, translate: `0 ${mix(-m.H * 0.6, 0, t)}px`, scale: String(mix(1.15, 1, t)), position: "relative" }}>
					<div style={{ width: "100%", aspectRatio: "1 / 1", background: "#222" }}>
						<Slot p={p} k="photo" label="Photo" />
					</div>
					<div style={{ position: "absolute", left: 0, right: 0, bottom: w * 0.05, height: w * 0.12, display: "grid", placeItems: "center", fontFamily: fontOf(p, "PlayfairDisplay"), fontStyle: "italic", fontWeight: 600, fontSize: fitP(p, caption, w * 0.85, w * 0.085), color: col(p.ink, "#2B2622"), opacity: m.at(0.6, 0.5) }}>{caption}</div>
				</div>
			</Center>
		</AbsoluteFill>
	);
};

/** A strip of film rolling across the frame: sprocket holes, three pictures repeating, a slight tilt, a caption. */
export const MgFilmStrip: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#151515");
	const short = Math.min(m.W, m.H);
	const h = short * (m.shape === "tall" ? 0.5 : 0.46);
	const fw = h * 0.78 * 1.3;
	const gap = h * 0.06;
	const speed = clamp(num(p.speed, 1), 0, 4);
	const shift = (m.sec * fw * 0.45 * speed) % ((fw + gap) * 3);
	const n = Math.ceil((m.W * 1.6) / (fw + gap)) + 4;
	const keys = ["photo", "photo2", "photo3"];
	const caption = str(p.caption);
	const hole = h * 0.05;
	return (
		<AbsoluteFill style={{ opacity: m.at(0, 0.4) * m.out }}>
			<Center gap={34 * m.u}>
				<div style={{ width: m.W * 1.4, height: h, background: a, rotate: `${num(p.angle, -6)}deg`, position: "relative", overflow: "hidden", boxShadow: "0 18px 50px rgba(0,0,0,0.5)", translate: `${mix(40, 0, m.at(0, 0.6))}% 0` }}>
					{[0, 1].map((row) => (
						<div key={row} style={{ position: "absolute", left: -shift % (hole * 3), right: 0, top: row ? undefined : hole * 0.7, bottom: row ? hole * 0.7 : undefined, height: hole * 1.3, backgroundImage: `repeating-linear-gradient(90deg, rgba(255,255,255,0.88) 0 ${hole * 1.5}px, transparent ${hole * 1.5}px ${hole * 3}px)`, borderRadius: 3 * m.u, width: m.W * 1.6 }} />
					))}
					<div style={{ position: "absolute", top: h * 0.11, left: -shift, height: h * 0.78, display: "flex", gap }}>
						{Array.from({ length: n }, (_, i) => i).map((i) => (
							<div key={i} style={{ width: fw, height: "100%", flexShrink: 0, borderRadius: 4 * m.u, overflow: "hidden" }}>
								<Slot p={p} k={p.assets?.[keys[i % 3]] || str(p[`${keys[i % 3]}Url`]) ? keys[i % 3] : "photo"} label="" />
							</div>
						))}
					</div>
				</div>
				{caption && <div style={{ fontFamily: fontOf(p, "Montserrat"), fontWeight: 800, fontSize: fitP(p, caption, m.W * 0.8, 70 * m.u), color: col(p.ink, "#FFFFFF"), textShadow: shadow, opacity: m.at(0.5, 0.4), marginTop: h * 0.15 }}>{caption}</div>}
			</Center>
		</AbsoluteFill>
	);
};

/** A phone sliding up with the picture on its screen (rounded bezel, island); a headline beside or above it. */
export const MgPhoneFrame: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#111111");
	const ph = m.H * (m.shape === "wide" ? 0.84 : 0.66);
	const pw = ph / 2.05;
	const r = pw * 0.15;
	const b = pw * 0.035;
	const t = m.at(0, 0.8, E.out);
	const label = str(p.label);
	const wide = m.shape === "wide";
	const fs = label ? fitP(p, label, wide ? m.W * 0.4 : m.W * 0.84, 96 * m.u) : 0;
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: wide ? "row" : "column", alignItems: "center", justifyContent: "center", gap: wide ? 90 * m.u : 50 * m.u }}>
				{label && <div style={{ fontFamily: fontOf(p, "Montserrat"), fontWeight: 900, fontSize: fs, color: col(p.ink, "#FFFFFF"), textShadow: shadow, maxWidth: wide ? m.W * 0.4 : m.W * 0.84, textAlign: wide ? "left" : "center", opacity: m.at(0.35, 0.5), translate: `0 ${mix(30, 0, m.at(0.35, 0.5)) * m.u}px` }}>{label}</div>}
				<div style={{ width: pw, height: ph, borderRadius: r, background: a, padding: b, boxShadow: `0 30px 80px rgba(0,0,0,0.55), inset 0 0 0 ${2 * m.u}px rgba(255,255,255,0.18)`, translate: `0 ${mix(m.H * 0.7, 0, t)}px`, rotate: `${mix(8, 0, t)}deg`, position: "relative", flexShrink: 0 }}>
					<div style={{ width: "100%", height: "100%", borderRadius: r - b, overflow: "hidden", background: "#000" }}>
						<Slot p={p} k="screen" label="Screen" />
					</div>
					<div style={{ position: "absolute", top: b * 2.2, left: "50%", translate: "-50% 0", width: pw * 0.3, height: pw * 0.085, borderRadius: 999, background: "#000" }} />
				</div>
			</div>
		</AbsoluteFill>
	);
};

// ───────────── Data ─────────────

/** A line chart drawing itself left to right over a soft area, dots popping with their values. */
export const MgLineChart: React.FC<MP> = (p) => {
	const m = useMg(p);
	const labels = list(p.labels, "Jan, Feb, Mar, Apr, May, Jun").slice(0, 12);
	const values = list(p.values, "12, 18, 15, 27, 34, 48").map((v) => num(v, 0)).slice(0, 12);
	const n = Math.max(2, Math.min(values.length, 12));
	const max = Math.max(1, ...values.slice(0, n));
	const a = col(p.accent, "#22D3EE");
	const ink = col(p.ink, "#FFFFFF");
	const family = fontOf(p, "Manrope");
	const W = m.W * (m.shape === "wide" ? 0.72 : 0.84);
	const H = m.H * (m.shape === "tall" ? 0.3 : 0.46);
	const pts = values.slice(0, n).map((v, i) => [(i / (n - 1)) * W, H - (v / max) * H * 0.86] as const);
	const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
	const draw = m.at(0.3, Math.min(1.8, m.L * 0.45), E.inOut);
	const title = str(p.title, "Followers, thousands");
	const id = `lc-${str(p.id, "mg").replace(/[^\w-]/g, "")}`;
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			{p.backdrop !== false && <Fill color={col(p.bg, "#0F172A")} />}
			<Center gap={44 * m.u}>
				{title && <div style={{ fontFamily: family, fontWeight: 800, fontSize: fitP(p, title, W, 64 * m.u), color: ink, opacity: m.at(0, 0.4), width: W }}>{title}</div>}
				<div style={{ position: "relative", width: W, height: H }}>
					<svg aria-hidden="true" width={W} height={H} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
						<defs>
							<linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
								<stop offset="0" stopColor={a} stopOpacity={0.45} />
								<stop offset="1" stopColor={a} stopOpacity={0} />
							</linearGradient>
							<clipPath id={`${id}-c`}>
								<rect x={-20 * m.u} y={-H} width={(W + 40 * m.u) * draw} height={H * 3} />
							</clipPath>
						</defs>
						{[0.25, 0.5, 0.75, 1].map((g) => (
							<line key={g} x1={0} x2={W} y1={H - g * H * 0.86} y2={H - g * H * 0.86} stroke={ink} strokeOpacity={0.12} strokeWidth={2 * m.u} />
						))}
						<g clipPath={`url(#${id}-c)`}>
							<path d={`${d} L${W},${H} L0,${H} Z`} fill={`url(#${id})`} />
							<path d={d} fill="none" stroke={a} strokeWidth={8 * m.u} strokeLinecap="round" strokeLinejoin="round" />
						</g>
					</svg>
					{pts.map(([x, y], i) => {
						const show = E.back(clamp((draw - i / (n - 1)) * 6, 0, 1));
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: one dot per value, in order
							<div key={i} style={{ position: "absolute", left: x, top: y, translate: "-50% -50%", opacity: Math.min(1, show * 2) }}>
								<div style={{ width: 22 * m.u, height: 22 * m.u, borderRadius: "50%", background: ink, border: `${6 * m.u}px solid ${a}`, scale: String(show) }} />
								<div style={{ position: "absolute", left: "50%", bottom: 34 * m.u, translate: "-50% 0", fontFamily: family, fontWeight: 800, fontSize: Math.min(40 * m.u, (W / n) * 0.42), color: ink, whiteSpace: "nowrap" }}>
									{values[i]}
									{str(p.unit)}
								</div>
							</div>
						);
					})}
				</div>
				<div style={{ display: "flex", justifyContent: "space-between", width: W + (W / (n - 1)) * 0.6, marginTop: -16 * m.u }}>
					{labels.slice(0, n).map((l, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: labels may repeat; a fixed list drawn in the same order every frame
						<span key={`${i}-${l}`} style={{ width: (W / (n - 1)) * 0.6, textAlign: "center", fontFamily: family, fontWeight: 600, fontSize: Math.min(32 * m.u, (W / n) * 0.34), color: ink, opacity: 0.7 * m.at(0.3, 0.4) }}>{l}</span>
					))}
				</div>
			</Center>
		</AbsoluteFill>
	);
};

/** A poll card: the question, then each answer's bar filling to its share; the leader lights up in the accent. */
export const MgPoll: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#c98a1e");
	const ink = col(p.ink, "#111111");
	const card = col(p.card, "#FFFFFF");
	const family = fontOf(p, "Manrope");
	const options = list(p.options, "Morning, Night").slice(0, 4);
	const values = list(p.values, "64, 36").map((v) => Math.max(0, num(v, 0)));
	const total = Math.max(1e-9, options.reduce((s, _, i) => s + (values[i] ?? 0), 0));
	const best = values.indexOf(Math.max(...values.slice(0, options.length)));
	const w = Math.min(m.W * 0.84, 860 * m.u);
	const q = str(p.question, "When do you work best?");
	const t = m.at(0, 0.5, E.back);
	const fill = m.at(0.7, 1.1, E.outQuart);
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<Center>
				<div style={{ width: w, padding: 36 * m.u, borderRadius: 36 * m.u, background: card, boxShadow: "0 18px 60px rgba(0,0,0,0.35)", display: "flex", flexDirection: "column", gap: 22 * m.u, scale: String(mix(0.6, 1, t)), opacity: Math.min(1, t * 2) }}>
					<div style={{ fontFamily: family, fontWeight: 800, fontSize: fitP(p, q, w * 1.6, 52 * m.u, 0.5), color: ink, textAlign: "center", lineHeight: 1.2 }}>{q}</div>
					{options.map((o, i) => {
						const share = ((values[i] ?? 0) / total) * fill;
						const win = i === best;
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: answers may repeat; a fixed list drawn in the same order every frame
							<div key={`${i}-${o}`} style={{ position: "relative", height: 84 * m.u, borderRadius: 22 * m.u, background: `${ink}10`, overflow: "hidden", opacity: m.at(0.3 + i * 0.1, 0.3) }}>
								<div style={{ position: "absolute", inset: 0, width: `${share * 100}%`, background: win ? a : `${ink}26`, borderRadius: 22 * m.u }} />
								<div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: `0 ${26 * m.u}px`, fontFamily: family, fontWeight: 800, fontSize: 38 * m.u, color: win && share > 0.5 ? "#FFFFFF" : ink }}>
									<span>{o}</span>
									<span style={{ fontVariantNumeric: "tabular-nums", color: win && share > 0.9 ? "#FFFFFF" : ink }}>{Math.round(share * 100)}%</span>
								</div>
							</div>
						);
					})}
					{str(p.votes) && <div style={{ fontFamily: family, fontWeight: 600, fontSize: 28 * m.u, color: ink, opacity: 0.5, textAlign: "center" }}>{str(p.votes)}</div>}
				</div>
			</Center>
		</AbsoluteFill>
	);
};

/** A progress bar filling to the set percentage with a running counter, a label above and a small line under it. */
export const MgProgressBar: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#22D3EE");
	const ink = col(p.ink, "#FFFFFF");
	const family = fontOf(p, "Manrope");
	const target = clamp(num(p.value, 100), 0, 100) / 100;
	const t = m.at(0.3, Math.max(0.6, m.L * 0.6), E.inOut) * target;
	const w = m.W * (m.shape === "wide" ? 0.6 : 0.8);
	const h = 34 * m.u;
	const label = str(p.label, "Uploading…");
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			{p.backdrop === true && <Fill color={col(p.bg, "#0B0D12")} />}
			<Center gap={22 * m.u}>
				<div style={{ width: w, display: "flex", justifyContent: "space-between", alignItems: "baseline", fontFamily: family, fontWeight: 800, color: ink, textShadow: shadow, opacity: m.at(0, 0.4) }}>
					<span style={{ fontSize: fitP(p, label, w * 0.7, 56 * m.u) }}>{label}</span>
					<span style={{ fontSize: 56 * m.u, fontVariantNumeric: "tabular-nums" }}>{Math.round(t * 100)}%</span>
				</div>
				<div style={{ width: w, height: h, borderRadius: 999, background: "rgba(255,255,255,0.18)", overflow: "hidden", boxShadow: shadow, scale: `${mix(0.6, 1, m.at(0, 0.45, E.back))} 1` }}>
					<div style={{ width: `${t * 100}%`, height: "100%", borderRadius: 999, background: `linear-gradient(90deg, ${col(p.color2, "#c98a1e")}, ${a})`, boxShadow: `0 0 ${20 * m.u}px ${a}` }} />
				</div>
				{str(p.sub) && <div style={{ fontFamily: family, fontWeight: 600, fontSize: 32 * m.u, color: ink, opacity: 0.75 * m.at(0.5, 0.4), textShadow: shadow }}>{str(p.sub)}</div>}
			</Center>
		</AbsoluteFill>
	);
};
