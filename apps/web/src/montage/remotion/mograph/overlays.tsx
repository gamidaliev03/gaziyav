// Overlays with live data, drawn over the video: a camcorder viewfinder (● REC, running timecode, battery), a VHS
// playback screen (PLAY ▶, the tape's date and a running clock), a film leader and a matte, a news ticker and
// «Breaking news», brand-free social screens (story, chat, notification), a HUD, comic «BOOM» and speed lines,
// split-screen, picture-in-picture and a passe-partout. The numbers move with the clip's own time.
import type React from "react";
import { AbsoluteFill, random } from "remotion";
import { Picture } from "../assets";
import { emojiFont, serifItalic } from "../fonts";
import { col, E, fitP, fontOf, Logo, mix, type MP, num, str, useMg } from "./base";
import { lookFont } from "./fonts";

const two = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");

/** "18:30" / "18:30:05" → seconds since midnight. */
function clockStart(text: string, d: number): number {
	const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
	return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0) : d;
}
const hms = (t: number) => `${two((t / 3600) % 24)}:${two((t / 60) % 60)}:${two(t % 60)}`;

// ───────────── Camera & film ─────────────

/** A camcorder screen: blinking ● REC, a running timecode, battery, corner marks, audio meters, optional grid. */
export const MgViewfinder: React.FC<MP> = (p) => {
	const m = useMg(p);
	const red = col(p.accent, "#FF3B30");
	const ink = col(p.ink, "#FFFFFF");
	const vcr = lookFont("vcr");
	const pad = (m.shape === "tall" ? 80 : 60) * m.u;
	const fs = (m.shape === "tall" ? 66 : 56) * m.u;
	const t = clockStart(str(p.timecode, "00:00:00"), 0) + m.sec;
	const tc = `${hms(t)}:${two(m.f % m.fps)}`;
	const blink = Math.floor(m.sec * 2) % 2 === 0;
	const level = Math.min(100, Math.max(0, num(p.battery, 72)));
	const arm = 90 * m.u;
	const line = 5 * m.u;
	const shadow = "0 0 6px rgba(0,0,0,0.6)";
	const text: React.CSSProperties = { fontFamily: vcr, fontSize: fs, color: ink, lineHeight: 1, textShadow: shadow, letterSpacing: "0.04em" };
	const corner = (pos: React.CSSProperties, rot: number) => (
		<div style={{ position: "absolute", width: arm, height: arm, borderTop: `${line}px solid ${ink}`, borderLeft: `${line}px solid ${ink}`, rotate: `${rot}deg`, boxShadow: undefined, ...pos }} />
	);
	const meter = (i: number) => Math.max(0.08, Math.min(1, 0.45 + 0.4 * Math.sin(m.sec * (7 + i * 3) + i) * random(`vf-${Math.floor(m.f / 2)}-${i}`)));
	return (
		<AbsoluteFill style={{ opacity: m.at(0, 0.25) * m.out }}>
			{p.grid === true && (
				<AbsoluteFill>
					{[1, 2].map((k) => (
						<div key={`v${k}`} style={{ position: "absolute", left: (m.W * k) / 3, top: 0, bottom: 0, width: 2 * m.u, background: `${ink}55` }} />
					))}
					{[1, 2].map((k) => (
						<div key={`h${k}`} style={{ position: "absolute", top: (m.H * k) / 3, left: 0, right: 0, height: 2 * m.u, background: `${ink}55` }} />
					))}
				</AbsoluteFill>
			)}
			{corner({ left: pad, top: pad }, 0)}
			{corner({ right: pad, top: pad }, 90)}
			{corner({ right: pad, bottom: pad }, 180)}
			{corner({ left: pad, bottom: pad }, 270)}
			<div style={{ position: "absolute", left: "50%", top: "50%", width: 70 * m.u, height: 70 * m.u, translate: "-50% -50%" }}>
				<div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 3 * m.u, translate: "-50% 0", background: ink, opacity: 0.8 }} />
				<div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 3 * m.u, translate: "0 -50%", background: ink, opacity: 0.8 }} />
			</div>
			<div style={{ position: "absolute", left: pad + arm * 0.5, top: pad + arm * 0.45, display: "flex", alignItems: "center", gap: 16 * m.u, ...text }}>
				<div style={{ width: fs * 0.62, height: fs * 0.62, borderRadius: "50%", background: red, opacity: blink ? 1 : 0.15, boxShadow: `0 0 ${12 * m.u}px ${red}` }} />
				{str(p.label, "REC")}
			</div>
			<div style={{ position: "absolute", right: pad + arm * 0.5, top: pad + arm * 0.45, ...text, fontVariantNumeric: "tabular-nums" }}>{tc}</div>
			<div style={{ position: "absolute", left: pad + arm * 0.5, bottom: pad + arm * 0.45, display: "flex", flexDirection: "column", gap: 14 * m.u }}>
				<div style={{ display: "flex", gap: 8 * m.u, alignItems: "flex-end", height: 60 * m.u }}>
					{[0, 1].map((i) => (
						<div key={i} style={{ width: 14 * m.u, height: `${meter(i) * 100}%`, background: meter(i) > 0.85 ? red : ink, opacity: 0.85 }} />
					))}
				</div>
				<span style={{ ...text, fontSize: fs * 0.8 }}>{str(p.info, "4K 30P  ISO 400")}</span>
			</div>
			<div style={{ position: "absolute", right: pad + arm * 0.5, bottom: pad + arm * 0.45, display: "flex", alignItems: "center", gap: 14 * m.u, ...text, fontSize: fs * 0.8 }}>
				{level}%
				<div style={{ position: "relative", width: 96 * m.u, height: 46 * m.u, border: `${4 * m.u}px solid ${ink}`, borderRadius: 6 * m.u, padding: 4 * m.u, display: "flex", gap: 4 * m.u }}>
					{[0, 1, 2, 3].map((i) => (
						<div key={i} style={{ flex: 1, background: level > i * 25 + 5 ? (level < 20 ? red : ink) : "transparent" }} />
					))}
					<div style={{ position: "absolute", right: -12 * m.u, top: "50%", width: 8 * m.u, height: 18 * m.u, translate: "0 -50%", background: ink, borderRadius: 2 * m.u }} />
				</div>
			</div>
		</AbsoluteFill>
	);
};

/** A VCR playback screen: PLAY ▶ and SP, the tape's date and a running clock in the VCR face, scanlines, a tracking band. */
export const MgVhs: React.FC<MP> = (p) => {
	const m = useMg(p);
	const ink = col(p.ink, "#FFFFFF");
	const vcr = lookFont("vcr");
	const pad = (m.shape === "tall" ? 90 : 70) * m.u;
	const fs = 72 * m.u;
	const t = clockStart(str(p.time, "22:24:07"), 0) + m.sec;
	const h = Math.floor(t / 3600) % 24;
	const clock = `${h < 12 ? "AM" : "PM"} ${two(h % 12 || 12)}:${two((t / 60) % 60)}:${two(t % 60)}`;
	const fringe = 4 * m.u;
	const text: React.CSSProperties = { fontFamily: vcr, fontSize: fs, color: ink, lineHeight: 1, textShadow: `${fringe}px 0 rgba(255,40,80,0.75), -${fringe}px 0 rgba(40,200,255,0.75)` };
	const bandY = (((m.sec * 0.33) % 1.4) - 0.2) * m.H;
	const noise = p.noise !== false;
	return (
		<AbsoluteFill style={{ opacity: m.at(0, 0.15) * m.out, overflow: "hidden" }}>
			{noise && (
				<AbsoluteFill style={{ backgroundImage: `repeating-linear-gradient(0deg, rgba(0,0,0,0.22) 0px, rgba(0,0,0,0.22) ${2 * m.u}px, transparent ${2 * m.u}px, transparent ${5 * m.u}px)` }} />
			)}
			{noise && (
				<div style={{ position: "absolute", left: 0, right: 0, top: bandY, height: m.H * 0.07, overflow: "hidden" }}>
					{Array.from({ length: 14 }, (_, i) => i).map((i) => {
						const r = random(`vhs-${m.f}-${i}`);
						return <div key={i} style={{ position: "absolute", top: `${(i / 14) * 100}%`, left: `${r * 60 - 20}%`, width: `${30 + r * 70}%`, height: 3 * m.u, background: "rgba(255,255,255,0.55)" }} />;
					})}
				</div>
			)}
			{noise && <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.45) 100%)" }} />}
			<div style={{ position: "absolute", left: pad, top: pad, display: "flex", flexDirection: "column", gap: 18 * m.u, ...text }}>
				<span>
					{str(p.label, "PLAY")} {m.sec < 2.5 && Math.floor(m.sec * 2) % 2 === 1 ? "" : "▶"}
				</span>
				<span style={{ fontSize: fs * 0.8 }}>{str(p.speed, "SP")}</span>
			</div>
			<div style={{ position: "absolute", left: pad, bottom: pad, ...text, fontVariantNumeric: "tabular-nums" }}>{clock}</div>
			<div style={{ position: "absolute", right: pad, bottom: pad, ...text }}>{str(p.date, "OCT. 31 1998")}</div>
		</AbsoluteFill>
	);
};

/** A film leader: rings, a cross, a sweeping hand and the countdown numbers, with grain, scratches and flicker. */
export const MgFilmLeader: React.FC<MP> = (p) => {
	const m = useMg(p);
	const from = Math.max(1, Math.round(num(p.from, 3)));
	const i = Math.floor(m.sec);
	const local = m.sec - i;
	const done = i >= from;
	const R = Math.min(m.W, m.H) * 0.36;
	const ink = col(p.ink, "#F2F0EA");
	const flicker = 0.9 + random(`fl-${m.f}`) * 0.1;
	const line = 6 * m.u;
	if (done) return <AbsoluteFill style={{ background: "#fff", opacity: Math.max(0, 1 - (m.sec - from) * 6) }} />;
	return (
		<AbsoluteFill style={{ background: col(p.bg, "#2B2A28"), opacity: flicker }}>
			<div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: line * 0.6, background: ink, opacity: 0.8 }} />
			<div style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: line * 0.6, background: ink, opacity: 0.8 }} />
			<div style={{ position: "absolute", left: "50%", top: "50%", width: R * 2, height: R * 2, translate: "-50% -50%", borderRadius: "50%", background: `conic-gradient(from 0deg, rgba(255,255,255,0.28) 0deg ${local * 360}deg, transparent ${local * 360}deg)` }} />
			{[1, 0.8].map((k) => (
				<div key={k} style={{ position: "absolute", left: "50%", top: "50%", width: R * 2 * k, height: R * 2 * k, translate: "-50% -50%", borderRadius: "50%", border: `${line}px solid ${ink}` }} />
			))}
			<AbsoluteFill style={{ display: "grid", placeItems: "center" }}>
				<span style={{ fontFamily: fontOf(p, "Montserrat"), fontWeight: 800, fontSize: R * 1.15, color: ink, lineHeight: 1 }}>{from - i}</span>
			</AbsoluteFill>
			{Array.from({ length: 26 }, (_, k) => k).map((k) => {
				const r = random(`gr-${m.f}-${k}`);
				const r2 = random(`gy-${m.f}-${k}`);
				return <div key={k} style={{ position: "absolute", left: r * m.W, top: r2 * m.H, width: (2 + r2 * 5) * m.u, height: (2 + r * 5) * m.u, borderRadius: "50%", background: k % 3 ? "#000" : "#fff", opacity: 0.55 }} />;
			})}
			{[0, 1].map((k) => (
				<div key={k} style={{ position: "absolute", top: 0, bottom: 0, left: random(`sc-${Math.floor(m.f / 3)}-${k}`) * m.W, width: 2 * m.u, background: "rgba(255,255,255,0.35)" }} />
			))}
			<AbsoluteFill style={{ background: "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.55) 100%)" }} />
		</AbsoluteFill>
	);
};

const RATIOS: Record<string, number> = { "2.39": 2.39, "2.00": 2, "1.85": 1.85, "1.33": 4 / 3, "1.00": 1 };

/** Cinema matte (кашетирование): bars that bring the frame to 2.39 / 2.00 / 1.85 / 4:3 / 1:1, sliding in and out. */
export const MgFilmMatte: React.FC<MP> = (p) => {
	const m = useMg(p);
	const ratio = str(p.ratio, "2.39");
	const frame = m.W / m.H;
	// A tall frame keeps a cinematic band (2.39 → 62 % of the height) rather than a sliver of picture.
	const TALL: Record<string, number> = { "2.39": 0.62, "2.00": 0.7, "1.85": 0.76, "1.33": 0.82 };
	const target = frame < 1 && TALL[ratio] ? m.W / (m.H * TALL[ratio]) : (RATIOS[ratio] ?? 2.39);
	const t = m.at(0, 0.7, E.inOut) * (1 - m.at(m.L - 0.6, 0.6, E.inOut));
	const c = col(p.bg, "#000000");
	const caption = str(p.caption);
	if (frame > target) {
		const bar = ((m.W - m.H * target) / 2) * t;
		return (
			<AbsoluteFill>
				<div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: bar, background: c }} />
				<div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: bar, background: c }} />
			</AbsoluteFill>
		);
	}
	const bar = ((m.H - m.W / target) / 2) * t;
	return (
		<AbsoluteFill>
			<div style={{ position: "absolute", left: 0, right: 0, top: 0, height: bar, background: c }} />
			<div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: bar, background: c, display: "grid", placeItems: "center" }}>
				{caption && <span style={{ fontFamily: fontOf(p, "Montserrat"), fontWeight: 600, fontSize: Math.min(bar * 0.3, 38 * m.u), color: col(p.ink, "#FFFFFF"), letterSpacing: "0.3em", opacity: m.at(0.6, 0.6), textTransform: "uppercase" }}>{caption}</span>}
			</div>
		</AbsoluteFill>
	);
};

// ───────────── News ─────────────

const Crawl: React.FC<{ text: string; speed: number; fs: number; family: string; color: string; m: ReturnType<typeof useMg> }> = ({ text, speed, fs, family, color, m }) => {
	const unit = `${text}   •   `;
	const unitW = unit.length * fs * 0.56;
	const x = -((m.sec * 220 * speed * m.u) % unitW);
	return (
		<div style={{ flex: 1, overflow: "hidden", height: "100%", display: "flex", alignItems: "center" }}>
			<div style={{ whiteSpace: "pre", fontFamily: family, fontWeight: 600, fontSize: fs, color, translate: `${x}px 0` }}>{unit.repeat(Math.ceil((m.W * 2) / unitW) + 2)}</div>
		</div>
	);
};

/** A news crawl at the bottom: a label box, the running text, a live clock. */
export const MgTicker: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#E11D2E");
	const family = fontOf(p, "Montserrat");
	const h = 100 * m.u;
	const t = clockStart(str(p.time, "18:30"), 0) + m.sec;
	const fs = 44 * m.u;
	const rise = m.at(0, 0.5);
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<div style={{ position: "absolute", left: 0, right: 0, bottom: m.H * (m.shape === "tall" ? 0.16 : 0.06), height: h, display: "flex", background: "rgba(255,255,255,0.96)", translate: `0 ${mix(h * 2, 0, rise)}px`, boxShadow: "0 10px 30px rgba(0,0,0,0.3)" }}>
				<div style={{ background: a, color: "#fff", fontFamily: family, fontWeight: 900, fontSize: fs, padding: `0 ${28 * m.u}px`, display: "grid", placeItems: "center", letterSpacing: "0.06em" }}>{str(p.label, "LIVE")}</div>
				<Crawl text={str(p.text, "Markets close higher · Storm moves north tonight · City marathon this Sunday")} speed={num(p.speed, 1)} fs={fs} family={family} color="#111" m={m} />
				<div style={{ background: "#111", color: "#fff", fontFamily: family, fontWeight: 800, fontSize: fs, padding: `0 ${24 * m.u}px`, display: "grid", placeItems: "center", fontVariantNumeric: "tabular-nums" }}>{`${two((t / 3600) % 24)}:${two((t / 60) % 60)}`}</div>
			</div>
		</AbsoluteFill>
	);
};

/** «Breaking news»: the red block slides in with a glint, the headline bar follows, LIVE pulses, a crawl runs under. */
export const MgBreaking: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#E11D2E");
	const family = fontOf(p, "Montserrat");
	const w = m.W * (m.shape === "wide" ? 0.82 : 0.94);
	const left = (m.W - w) / 2;
	const block = m.at(0, 0.45, E.out);
	const bar = m.at(0.3, 0.55, E.out);
	const glint = mix(-40, 140, m.at(0.6, 0.9, E.inOut));
	const headline = str(p.headline, "Big story developing right now");
	const fh = fitP(p, headline, w * 0.92, 64 * m.u, 0.6);
	const top = m.H * (m.shape === "tall" ? 0.66 : 0.66);
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<div style={{ position: "absolute", left, top, width: w }}>
				<div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
					<div style={{ position: "relative", overflow: "hidden", background: a, color: "#fff", fontFamily: family, fontWeight: 900, fontSize: 50 * m.u, padding: `${14 * m.u}px ${28 * m.u}px`, letterSpacing: "0.04em", fontStyle: "italic", translate: `${mix(-w, 0, block)}px 0` }}>
						{str(p.label, "BREAKING NEWS")}
						<div style={{ position: "absolute", top: 0, bottom: 0, left: `${glint}%`, width: "18%", background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)", rotate: "15deg" }} />
					</div>
					<div style={{ display: "flex", alignItems: "center", gap: 10 * m.u, padding: `0 ${18 * m.u}px`, background: "#111", color: "#fff", fontFamily: family, fontWeight: 800, fontSize: 34 * m.u, opacity: block }}>
						<div style={{ width: 16 * m.u, height: 16 * m.u, borderRadius: "50%", background: a, opacity: 0.4 + 0.6 * Math.abs(Math.sin(m.sec * 4)) }} />
						LIVE
					</div>
				</div>
				<div style={{ background: "rgba(255,255,255,0.97)", padding: `${16 * m.u}px ${28 * m.u}px`, clipPath: `inset(0 ${100 - bar * 100}% 0 0)` }}>
					<span style={{ fontFamily: family, fontWeight: 800, fontSize: fh, color: "#111" }}>{headline}</span>
				</div>
				<div style={{ height: 70 * m.u, background: "#111", display: "flex", opacity: m.at(0.7, 0.4) }}>
					<Crawl text={str(p.text, "Officials to speak at 6 PM · Roads closed downtown · Updates every hour")} speed={1} fs={34 * m.u} family={family} color="#fff" m={m} />
				</div>
			</div>
		</AbsoluteFill>
	);
};

// ───────────── Social (no brands) ─────────────

const Glyph: React.FC<{ d: string; size: number; color: string; fill?: boolean }> = ({ d, size, color, fill }) => (
	<svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill={fill ? color : "none"} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
		<path d={d} />
	</svg>
);
const HEART = "M12 20s-7-4.4-9.2-8.6C1.2 8.2 3.2 4.5 6.8 4.5c2.1 0 3.6 1.2 5.2 3 1.6-1.8 3.1-3 5.2-3 3.6 0 5.6 3.7 4 6.9C19 15.6 12 20 12 20z";
const PLANE = "M21 3L10 14M21 3l-7 18-4-7-7-4z";
const BELL = "M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zm-2.5 15a2.5 2.5 0 0 0 5 0";

/** A story screen: segment bars filling, the author's picture, name and time, a reply pill with heart and send. */
export const MgStory: React.FC<MP> = (p) => {
	const m = useMg(p);
	const n = Math.max(1, Math.min(8, Math.round(num(p.segments, 3))));
	const cur = Math.max(1, Math.min(n, Math.round(num(p.current, 1))));
	const family = fontOf(p, "Manrope");
	const pad = 36 * m.u;
	const av = 92 * m.u;
	const name = str(p.name, "yourname");
	return (
		<AbsoluteFill style={{ opacity: m.at(0, 0.3) * m.out }}>
			<div style={{ position: "absolute", left: 0, right: 0, top: 0, height: m.H * 0.18, background: "linear-gradient(rgba(0,0,0,0.45), transparent)" }} />
			<div style={{ position: "absolute", left: pad, right: pad, top: pad, display: "flex", gap: 8 * m.u }}>
				{Array.from({ length: n }, (_, k) => k + 1).map((k) => (
					<div key={k} style={{ flex: 1, height: 7 * m.u, borderRadius: 4 * m.u, background: "rgba(255,255,255,0.4)", overflow: "hidden" }}>
						<div style={{ height: "100%", width: `${(k < cur ? 1 : k > cur ? 0 : m.life) * 100}%`, background: "#fff" }} />
					</div>
				))}
			</div>
			<div style={{ position: "absolute", left: pad, right: pad, top: pad + 36 * m.u, display: "flex", alignItems: "center", gap: 20 * m.u }}>
				<div style={{ borderRadius: "50%", padding: 4 * m.u, background: `linear-gradient(45deg, ${col(p.accent, "#FF9F0A")}, ${col(p.color2, "#FF2D78")})` }}>
					<Logo p={{ ...p, monogram: name.slice(0, 1) }} size={av} />
				</div>
				<span style={{ fontFamily: family, fontWeight: 800, fontSize: 40 * m.u, color: "#fff" }}>{name}</span>
				<span style={{ fontFamily: family, fontWeight: 600, fontSize: 34 * m.u, color: "rgba(255,255,255,0.75)" }}>{str(p.time, "2h")}</span>
				<span style={{ flex: 1 }} />
				<span style={{ fontFamily: family, fontSize: 48 * m.u, color: "#fff", lineHeight: 1 }}>✕</span>
			</div>
			<div style={{ position: "absolute", left: pad, right: pad, bottom: pad * 1.6, display: "flex", alignItems: "center", gap: 24 * m.u, translate: `0 ${mix(60, 0, m.at(0.1, 0.5)) * m.u}px` }}>
				<div style={{ flex: 1, height: 100 * m.u, borderRadius: 999, border: `${3 * m.u}px solid rgba(255,255,255,0.85)`, display: "flex", alignItems: "center", padding: `0 ${34 * m.u}px`, fontFamily: family, fontWeight: 600, fontSize: 36 * m.u, color: "rgba(255,255,255,0.9)" }}>{str(p.reply, "Send message")}</div>
				<Glyph d={HEART} size={64 * m.u} color="#fff" />
				<Glyph d={PLANE} size={60 * m.u} color="#fff" />
			</div>
		</AbsoluteFill>
	);
};

/** A chat: messages arrive one by one (theirs after a typing bubble); «>» at the start marks your own. */
export const MgChat: React.FC<MP> = (p) => {
	const m = useMg(p);
	const msgs = str(p.messages, "Are you coming tonight?|>On my way! 🚗|Bring snacks 😄|>Already got them")
		.split("|")
		.map((s) => s.trim())
		.filter(Boolean)
		.slice(0, 8)
		.map((s) => ({ mine: s.startsWith(">"), text: s.replace(/^>\s*/, "") }));
	const family = `${fontOf(p, "Manrope")}, ${emojiFont()}`;
	const per = Math.min(1.1, Math.max(0.5, (m.L - 1) / Math.max(1, msgs.length)));
	const w = Math.min(m.W * 0.86, 940 * m.u);
	const fs = 40 * m.u;
	const shown = msgs.map((msg, i) => ({ ...msg, at: 0.5 + i * per })).filter((msg) => m.sec >= msg.at - (msg.mine ? 0 : 0.45));
	const name = str(p.name, "Alex");
	return (
		<AbsoluteFill style={{ opacity: m.at(0, 0.3) * m.out, display: "flex", alignItems: "center", justifyContent: "center" }}>
			<div style={{ width: w, display: "flex", flexDirection: "column", gap: 16 * m.u }}>
				<div style={{ alignSelf: "center", display: "flex", alignItems: "center", gap: 14 * m.u, background: "rgba(20,20,22,0.8)", padding: `${10 * m.u}px ${26 * m.u}px ${10 * m.u}px ${10 * m.u}px`, borderRadius: 999, marginBottom: 10 * m.u }}>
					<Logo p={{ ...p, monogram: name.slice(0, 1) }} size={64 * m.u} />
					<span style={{ fontFamily: family, fontWeight: 800, fontSize: 34 * m.u, color: "#fff" }}>{name}</span>
				</div>
				{shown.map((msg) => {
					const typing = !msg.mine && m.sec < msg.at;
					const t = m.at(typing ? msg.at - 0.45 : msg.at, 0.35, E.linear);
					return (
						<div key={`m${msg.at}`} style={{ alignSelf: msg.mine ? "flex-end" : "flex-start", maxWidth: w * 0.78, padding: `${18 * m.u}px ${28 * m.u}px`, borderRadius: 38 * m.u, borderBottomRightRadius: msg.mine ? 10 * m.u : 38 * m.u, borderBottomLeftRadius: msg.mine ? 38 * m.u : 10 * m.u, background: msg.mine ? col(p.accent, "#0A84FF") : col(p.color2, "#2C2C2E"), color: "#fff", fontFamily: family, fontWeight: 600, fontSize: fs, lineHeight: 1.3, scale: String(mix(0.6, 1, E.back(t))), opacity: Math.min(1, t * 2), transformOrigin: msg.mine ? "100% 100%" : "0% 100%" }}>
							{typing ? (
								<span style={{ display: "flex", gap: 10 * m.u, padding: `${8 * m.u}px 0` }}>
									{[0, 1, 2].map((d) => (
										<span key={d} style={{ width: 16 * m.u, height: 16 * m.u, borderRadius: "50%", background: "#fff", opacity: 0.35 + 0.65 * Math.max(0, Math.sin(m.sec * 9 - d)) }} />
									))}
								</span>
							) : (
								msg.text
							)}
						</div>
					);
				})}
			</div>
		</AbsoluteFill>
	);
};

/** Phone notifications dropping in from the top (a second one stacks under the first). */
export const MgNotification: React.FC<MP> = (p) => {
	const m = useMg(p);
	const family = `${fontOf(p, "Manrope")}, ${emojiFont()}`;
	const w = Math.min(m.W * 0.92, 980 * m.u);
	const items = [
		{ title: str(p.title, "New order 🎉"), body: str(p.body, "Someone just bought your product"), at: 0.2 },
		...(str(p.title2) ? [{ title: str(p.title2), body: str(p.body2), at: 1.4 }] : []),
	];
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<div style={{ position: "absolute", left: (m.W - w) / 2, top: m.H * (m.shape === "tall" ? 0.06 : 0.05), width: w, display: "flex", flexDirection: "column", gap: 16 * m.u }}>
				{items.map((it) => {
					const t = m.at(it.at, 0.55, E.linear);
					const shake = m.sec > it.at + 0.35 && m.sec < it.at + 0.6 ? Math.sin(m.sec * 80) * 4 * m.u : 0;
					return (
						<div key={it.title} style={{ display: "flex", gap: 22 * m.u, alignItems: "center", padding: 24 * m.u, borderRadius: 40 * m.u, background: "rgba(36,36,40,0.92)", boxShadow: "0 18px 40px rgba(0,0,0,0.35)", translate: `${shake}px ${mix(-260, 0, E.back(t)) * m.u}px`, opacity: Math.min(1, t * 3) }}>
							<div style={{ width: 96 * m.u, height: 96 * m.u, borderRadius: 24 * m.u, background: col(p.accent, "#34C759"), display: "grid", placeItems: "center", flexShrink: 0 }}>
								<Glyph d={BELL} size={56 * m.u} color="#fff" fill />
							</div>
							<div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 * m.u }}>
								<div style={{ display: "flex", justifyContent: "space-between", fontFamily: family, fontWeight: 600, fontSize: 28 * m.u, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
									<span>{str(p.app, "Shop")}</span>
									<span>now</span>
								</div>
								<span style={{ fontFamily: family, fontWeight: 800, fontSize: 38 * m.u, color: "#fff" }}>{it.title}</span>
								<span style={{ fontFamily: family, fontWeight: 500, fontSize: 34 * m.u, color: "rgba(255,255,255,0.85)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.body}</span>
							</div>
						</div>
					);
				})}
			</div>
		</AbsoluteFill>
	);
};

// ───────────── HUD & comic ─────────────

/** A targeting HUD: rotating rings close in on the target, readouts tick, a scan bar sweeps, «TARGET LOCKED» blinks. */
export const MgHud: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#00E5FF");
	const mono = lookFont("mono");
	const R = Math.min(m.W, m.H) * 0.22;
	const lock = m.at(0.4, 1, E.inOut);
	const box = mix(R * 2.6, R * 1.4, lock);
	const locked = m.sec > 1.45;
	const fs = (m.shape === "tall" ? 42 : 34) * m.u;
	const pad = (m.shape === "tall" ? 80 : 70) * m.u;
	const read = (label: string, value: string) => (
		<div style={{ display: "flex", gap: 14 * m.u, fontFamily: mono, fontSize: fs, color: a }}>
			<span style={{ opacity: 0.65 }}>{label}</span>
			<span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>
		</div>
	);
	const scan = ((m.sec * 0.5) % 1) * m.H;
	return (
		<AbsoluteFill style={{ opacity: m.at(0, 0.3) * m.out, filter: `drop-shadow(0 0 ${6 * m.u}px ${a}88)` }}>
			<div style={{ position: "absolute", left: 0, right: 0, top: scan, height: 2 * m.u, background: `linear-gradient(90deg, transparent, ${a}, transparent)`, opacity: 0.6 }} />
			<svg aria-hidden="true" width={R * 3} height={R * 3} style={{ position: "absolute", left: m.W / 2 - R * 1.5, top: m.H / 2 - R * 1.5 }}>
				<g transform={`translate(${R * 1.5} ${R * 1.5})`} fill="none" stroke={a}>
					<circle r={R * 1.25} strokeWidth={3 * m.u} strokeDasharray={`${R * 0.3} ${R * 0.12}`} transform={`rotate(${m.sec * 40})`} opacity={0.7} />
					<circle r={R} strokeWidth={5 * m.u} strokeDasharray={`${R * 1.2} ${R * 0.37}`} transform={`rotate(${-m.sec * 70})`} />
					<circle r={R * 0.12} strokeWidth={3 * m.u} />
					{[0, 90, 180, 270].map((d) => (
						<line key={d} x1={R * 0.25} x2={R * 0.6} y1={0} y2={0} strokeWidth={4 * m.u} transform={`rotate(${d})`} />
					))}
				</g>
			</svg>
			<div style={{ position: "absolute", left: m.W / 2 - box / 2, top: m.H / 2 - box / 2, width: box, height: box }}>
				{[
					{ left: 0, top: 0, borderLeft: 1, borderTop: 1 },
					{ right: 0, top: 0, borderRight: 1, borderTop: 1 },
					{ left: 0, bottom: 0, borderLeft: 1, borderBottom: 1 },
					{ right: 0, bottom: 0, borderRight: 1, borderBottom: 1 },
				].map((c, k) => (
					<div
						key={`c${k === 0 ? "tl" : k === 1 ? "tr" : k === 2 ? "bl" : "br"}`}
						style={{ position: "absolute", width: box * 0.18, height: box * 0.18, left: c.left, right: c.right, top: c.top, bottom: c.bottom, borderLeft: c.borderLeft ? `${5 * m.u}px solid ${locked ? col(p.color2, "#FF3B30") : a}` : undefined, borderRight: c.borderRight ? `${5 * m.u}px solid ${locked ? col(p.color2, "#FF3B30") : a}` : undefined, borderTop: c.borderTop ? `${5 * m.u}px solid ${locked ? col(p.color2, "#FF3B30") : a}` : undefined, borderBottom: c.borderBottom ? `${5 * m.u}px solid ${locked ? col(p.color2, "#FF3B30") : a}` : undefined }}
					/>
				))}
			</div>
			{locked && Math.floor(m.sec * 3) % 2 === 0 && (
				<div style={{ position: "absolute", left: "50%", top: m.H / 2 + R * 1.45, translate: "-50% 0", fontFamily: mono, fontSize: fs * 1.3, color: col(p.color2, "#FF3B30"), letterSpacing: "0.2em" }}>{str(p.label, "TARGET LOCKED")}</div>
			)}
			<div style={{ position: "absolute", left: pad, top: pad, display: "flex", flexDirection: "column", gap: 8 * m.u }}>
				{read("ALT", `${Math.round(1204 + Math.sin(m.sec * 1.3) * 18)} m`)}
				{read("SPD", `${Math.round(88 + Math.sin(m.sec * 2.1) * 6)} km/h`)}
				{read("BRG", `${Math.round(274 + m.sec * 3) % 360}°`)}
			</div>
			<div style={{ position: "absolute", right: pad, top: pad, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 * m.u }}>
				{read("SYS", "ONLINE")}
				{read("T+", `${two(m.sec / 60)}:${two(m.sec % 60)}.${two((m.sec * 100) % 100)}`)}
			</div>
			<div style={{ position: "absolute", left: pad, right: pad, bottom: pad, height: 4 * m.u, background: `${a}33` }}>
				<div style={{ height: "100%", width: `${m.life * 100}%`, background: a }} />
			</div>
		</AbsoluteFill>
	);
};

/** A comic «BOOM!»: a jagged burst with halftone dots, an outlined comic word, a pop and a shake. */
export const MgComicBoom: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FF3B30");
	const b = col(p.color2, "#FFD23F");
	const R = Math.min(m.W, m.H) * 0.4;
	const spikes = 22;
	const pts = (scale: number) =>
		Array.from({ length: spikes * 2 }, (_, i) => i)
			.map((i) => {
				const r = (i % 2 ? 0.62 + random(`cb-${i}`) * 0.12 : 0.9 + random(`cb-${i}`) * 0.1) * scale;
				const ang = (i / (spikes * 2)) * Math.PI * 2;
				return `${50 + Math.cos(ang) * r * 50}% ${50 + Math.sin(ang) * r * 50}%`;
			})
			.join(", ");
	const pop = E.back(m.at(0, 0.35, E.linear));
	const shake = m.sec < 0.6 ? (random(`sh-${m.f}`) - 0.5) * 24 * m.u : 0;
	const text = str(p.text, "BOOM!");
	const fs = fitP(p, text, R * 1.5, R * 0.62, 0.55);
	const stroke = col(p.ink, "#111111");
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<div style={{ position: "absolute", left: m.W / 2 - R, top: m.H / 2 - R, width: R * 2, height: R * 2, scale: String(pop), rotate: `${mix(-30, -6, pop)}deg`, translate: `${shake}px ${shake * 0.6}px` }}>
				<div style={{ position: "absolute", inset: -R * 0.04, background: stroke, clipPath: `polygon(${pts(1.04)})` }} />
				<div style={{ position: "absolute", inset: 0, background: b, clipPath: `polygon(${pts(1)})` }} />
				<div style={{ position: "absolute", inset: 0, clipPath: `polygon(${pts(0.78)})`, background: a, backgroundImage: "radial-gradient(circle, rgba(0,0,0,0.22) 38%, transparent 42%)", backgroundSize: `${22 * m.u}px ${22 * m.u}px` }} />
				<div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
					<span style={{ fontFamily: lookFont("comic"), fontSize: fs, color: "#fff", WebkitTextStroke: `${fs * 0.06}px ${stroke}`, paintOrder: "stroke fill", textShadow: `${fs * 0.06}px ${fs * 0.06}px 0 ${stroke}`, letterSpacing: "0.02em", rotate: "-4deg" }}>{text}</span>
				</div>
			</div>
		</AbsoluteFill>
	);
};

/** Anime speed lines rushing to the centre, redrawn every other frame. */
export const MgSpeedLines: React.FC<MP> = (p) => {
	const m = useMg(p);
	const c = col(p.ink, "#FFFFFF");
	const n = Math.round(num(p.amount, 70));
	const seed = Math.floor(m.f / 2);
	const diag = Math.hypot(m.W, m.H) / 2;
	const cx = m.W / 2;
	const cy = m.H / 2;
	const clear = Math.min(m.W, m.H) * num(p.clear, 0.32);
	const polys = Array.from({ length: n }, (_, i) => i).map((i) => {
		const ang = random(`sl-a-${seed}-${i}`) * Math.PI * 2;
		const spread = (0.004 + random(`sl-w-${seed}-${i}`) * 0.012) * Math.PI;
		const inner = clear * (1 + random(`sl-r-${seed}-${i}`) * 0.6);
		const p1 = [cx + Math.cos(ang - spread) * diag * 1.2, cy + Math.sin(ang - spread) * diag * 1.2];
		const p2 = [cx + Math.cos(ang + spread) * diag * 1.2, cy + Math.sin(ang + spread) * diag * 1.2];
		const tip = [cx + Math.cos(ang) * inner, cy + Math.sin(ang) * inner];
		return `${p1[0]},${p1[1]} ${p2[0]},${p2[1]} ${tip[0]},${tip[1]}`;
	});
	return (
		<AbsoluteFill style={{ opacity: num(p.opacity, 0.85) * m.at(0, 0.2) * m.out }}>
			<svg aria-hidden="true" width={m.W} height={m.H}>
				{polys.map((pts, i) => (
					<polygon key={pts.slice(0, 12) + String(i)} points={pts} fill={c} />
				))}
			</svg>
		</AbsoluteFill>
	);
};

// ───────────── Layouts ─────────────

export const Slot: React.FC<{ p: MP; k: string; label: string; radius?: number }> = ({ p, k, label, radius = 0 }) => {
	const asset = p.assets?.[k] ?? (str(p[`${k}Url`]) ? { type: "image" as const, url: str(p[`${k}Url`]) } : undefined);
	return (
		<div style={{ width: "100%", height: "100%", borderRadius: radius, overflow: "hidden", background: "linear-gradient(135deg, #3a3f4b, #1d2027)", display: "grid", placeItems: "center" }}>
			{asset?.url ? <Picture asset={asset} /> : <span style={{ fontFamily: fontOf(p, "Manrope"), fontWeight: 700, color: "rgba(255,255,255,0.55)", fontSize: 36 }}>{label}</span>}
		</div>
	);
};

/** Two pictures side by side (stacked on a tall frame) with a divider wiping in and BEFORE / AFTER labels. */
export const MgSplitScreen: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FFFFFF");
	const stack = m.shape === "tall";
	const t = m.at(0, 0.6, E.inOut);
	const family = fontOf(p, "Montserrat");
	const label = (text: string, pos: React.CSSProperties) =>
		text ? <div style={{ position: "absolute", ...pos, fontFamily: family, fontWeight: 800, fontSize: 40 * m.u, color: "#111", background: a, padding: `${10 * m.u}px ${24 * m.u}px`, borderRadius: 999, opacity: m.at(0.5, 0.4), letterSpacing: "0.06em" }}>{text}</div> : null;
	const pane = (k: string, first: boolean) => (
		<div style={{ position: "absolute", overflow: "hidden", ...(stack ? { left: 0, right: 0, height: "50%", top: first ? 0 : "50%" } : { top: 0, bottom: 0, width: "50%", left: first ? 0 : "50%" }), translate: stack ? `0 ${mix(first ? -100 : 100, 0, t)}%` : `${mix(first ? -100 : 100, 0, t)}% 0` }}>
			<Slot p={p} k={k} label={first ? "Picture 1" : "Picture 2"} />
			{label(first ? str(p.label1, "BEFORE") : str(p.label2, "AFTER"), { left: 30 * m.u, top: 30 * m.u })}
		</div>
	);
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			{pane("left", true)}
			{pane("right", false)}
			<div style={{ position: "absolute", background: a, ...(stack ? { left: 0, right: 0, top: "50%", height: 8 * m.u, translate: "0 -50%", scale: `${m.at(0.4, 0.5, E.inOut)} 1` } : { top: 0, bottom: 0, left: "50%", width: 8 * m.u, translate: "-50% 0", scale: `1 ${m.at(0.4, 0.5, E.inOut)}` }) }} />
		</AbsoluteFill>
	);
};

/** Picture-in-picture: a framed picture in a corner, popping in, with an optional label. */
export const MgPip: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FFFFFF");
	const size = Math.min(0.6, Math.max(0.15, num(p.size, 0.34)));
	const w = m.W * size;
	const h = m.shape === "tall" ? w * 1.25 : (w * 9) / 16;
	const corner = str(p.corner, "top-right");
	const pad = 50 * m.u;
	const right = corner.endsWith("right");
	const bottom = corner.startsWith("bottom");
	const t = E.back(m.at(0.05, 0.5, E.linear));
	const label = str(p.label);
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<div style={{ position: "absolute", width: w, height: h, [right ? "right" : "left"]: pad, [bottom ? "bottom" : "top"]: pad + (m.shape === "tall" ? m.H * 0.06 : 0), scale: String(t), transformOrigin: `${right ? "100%" : "0%"} ${bottom ? "100%" : "0%"}`, borderRadius: 26 * m.u, border: `${6 * m.u}px solid ${a}`, boxShadow: "0 20px 50px rgba(0,0,0,0.45)", overflow: "hidden" }}>
				<Slot p={p} k="photo" label="Picture" radius={20 * m.u} />
				{label && <div style={{ position: "absolute", left: 16 * m.u, bottom: 16 * m.u, fontFamily: fontOf(p, "Manrope"), fontWeight: 800, fontSize: 30 * m.u, color: "#fff", background: "rgba(0,0,0,0.6)", padding: `${6 * m.u}px ${16 * m.u}px`, borderRadius: 999 }}>{label}</div>}
			</div>
		</AbsoluteFill>
	);
};

/** A passe-partout: a mat around the video with a bevel line and inner shadow, a caption on the wider bottom. */
export const MgPassePartout: React.FC<MP> = (p) => {
	const m = useMg(p);
	const mat = col(p.bg, "#F3EFE6");
	const t = m.at(0, 0.7, E.inOut);
	const w = Math.min(m.W, m.H) * Math.min(0.2, Math.max(0.02, num(p.width, 0.07))) * t;
	const caption = str(p.caption);
	const bottom = caption ? w * 2.2 : w;
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<div style={{ position: "absolute", inset: 0, borderStyle: "solid", borderColor: mat, borderWidth: `${w}px ${w}px ${bottom}px ${w}px` }} />
			<div style={{ position: "absolute", left: w, right: w, top: w, bottom, boxShadow: `inset 0 0 ${24 * m.u}px rgba(0,0,0,0.45), 0 0 0 ${3 * m.u}px rgba(0,0,0,0.12)` }} />
			{caption && (
				<div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: bottom, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 * m.u, opacity: m.at(0.5, 0.6) }}>
					<span style={{ fontFamily: serifItalic(), fontSize: Math.min(bottom * 0.32, 54 * m.u), color: col(p.ink, "#2B2622") }}>{caption}</span>
					{str(p.sub) && <span style={{ fontFamily: fontOf(p, "Manrope"), fontWeight: 600, fontSize: Math.min(bottom * 0.16, 28 * m.u), color: col(p.ink, "#2B2622"), opacity: 0.6, letterSpacing: "0.2em", textTransform: "uppercase" }}>{str(p.sub)}</span>}
				</div>
			)}
		</AbsoluteFill>
	);
};

