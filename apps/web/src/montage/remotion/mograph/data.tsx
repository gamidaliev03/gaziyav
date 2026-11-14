// Counters and timers, infographics (bars, donut, stats, steps), testimonials, quotes, a map route, ratings.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { Picture } from "../assets";
import { serifItalic } from "../fonts";
import { Center, col, E, Fill, fitP, fontOf, formatCount, list, MaskLine, mix, type MP, num, Stars, str, useMg } from "./base";

/** "98%" → 98 counting with "%" after; "$2.5M" → "$" + 2.5 + "M"; text without a number stays as it is. */
function countUp(text: string, t: number): string {
	const m = /^([^\d-]*)(-?\d[\d,]*(?:\.\d+)?)(.*)$/.exec(text);
	if (!m) return text;
	const value = Number(m[2].replace(/,/g, ""));
	const decimals = (m[2].split(".")[1] ?? "").length;
	const shown = formatCount(value * t, decimals);
	return `${m[1]}${m[2].includes(",") || Math.abs(value) >= 10000 ? shown : (value * t).toFixed(decimals)}${m[3]}`;
}

// ───────────── Counters & timers ─────────────

/** A big number counts up and punches, a ring fills around it in step, the label underneath. */
export const MgBigCounter: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#22D3EE");
	const from = num(p.from, 0);
	const to = num(p.value, 1000000);
	const t = m.at(0.2, Math.min(1.8, m.L * 0.5), E.outQuart);
	const value = Math.round(mix(from, to, t));
	const text = `${str(p.prefix)}${formatCount(value)}${str(p.suffix, "+")}`;
	const punch = 1 + 0.08 * Math.sin(Math.min(1, Math.max(0, (t - 0.97) / 0.03)) * Math.PI);
	const R = Math.min(m.W, m.H) * 0.34;
	const family = fontOf(p);
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<Center gap={20 * m.u}>
				<svg aria-hidden="true" width={R * 2.3} height={R * 2.3} style={{ position: "absolute", rotate: "-90deg", opacity: 0.9 * m.at(0, 0.4) }}>
					<circle cx={R * 1.15} cy={R * 1.15} r={R} fill="none" stroke={`${a}33`} strokeWidth={14 * m.u} />
					<circle cx={R * 1.15} cy={R * 1.15} r={R} fill="none" stroke={a} strokeWidth={14 * m.u} strokeLinecap="round" strokeDasharray={Math.PI * 2 * R} strokeDashoffset={Math.PI * 2 * R * (1 - t)} />
				</svg>
				<div style={{ fontFamily: family, fontWeight: 900, fontSize: fitP(p, text, R * 1.7, 170 * m.u, 0.66), color: col(p.ink, "#FFFFFF"), scale: String(punch * mix(0.7, 1, m.at(0, 0.4))), fontVariantNumeric: "tabular-nums", textShadow: "0 6px 30px rgba(0,0,0,0.4)" }}>{text}</div>
				<div style={{ fontFamily: family, fontWeight: 600, fontSize: 44 * m.u, color: a, opacity: m.at(0.5, 0.5), letterSpacing: "0.06em" }}>{str(p.label)}</div>
			</Center>
		</AbsoluteFill>
	);
};

/** 3 · 2 · 1 · GO: each number pops inside a draining ring. */
export const MgCountdown: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FFD23F");
	const from = Math.max(1, Math.round(num(p.from, 3)));
	const per = Math.min(1, Math.max(0.3, (m.L - 0.9) / (from + 0.4)));
	const i = Math.floor(m.sec / per);
	const local = (m.sec - i * per) / per;
	const going = i >= from;
	const label = going ? str(p.go, "GO!") : String(from - i);
	const R = Math.min(m.W, m.H) * 0.3;
	const pop = E.back(Math.min(1, (going ? (m.sec - from * per) / 0.4 : local * 2.5)));
	const family = fontOf(p);
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			{p.backdrop !== false && <Fill color={col(p.bg, "#0B0D12")} />}
			<Center>
				{!going && (
					<svg aria-hidden="true" width={R * 2.3} height={R * 2.3} style={{ position: "absolute", rotate: "-90deg" }}>
						<circle cx={R * 1.15} cy={R * 1.15} r={R} fill="none" stroke={`${a}33`} strokeWidth={18 * m.u} />
						<circle cx={R * 1.15} cy={R * 1.15} r={R} fill="none" stroke={a} strokeWidth={18 * m.u} strokeLinecap="round" strokeDasharray={Math.PI * 2 * R} strokeDashoffset={Math.PI * 2 * R * local} />
					</svg>
				)}
				<div style={{ fontFamily: family, fontWeight: 900, fontSize: going ? fitP(p, label, m.W * 0.8, R * 1.1, 0.7) : R * 1.1, color: going ? a : col(p.ink, "#FFFFFF"), scale: String(mix(0.4, 1, pop)), fontVariantNumeric: "tabular-nums" }}>{label}</div>
			</Center>
		</AbsoluteFill>
	);
};

/** «Offer ends in» with hours · minutes · seconds tiles ticking down live, each tile flipping on its change. */
export const MgOfferTimer: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FF3D71");
	const family = fontOf(p);
	const total = Math.max(0, num(p.hours, 2) * 3600 + num(p.minutes, 15) * 60 + num(p.seconds, 30) - Math.floor(m.sec));
	const parts = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
	const flip = 1 - Math.min(1, (m.sec % 1) * 6);
	const tile = (m.shape === "tall" ? 200 : 180) * m.u;
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<Center gap={30 * m.u}>
				<MaskLine t={m.at(0, 0.5)}>
					<div style={{ fontFamily: family, fontWeight: 800, fontSize: 56 * m.u, color: col(p.ink, "#FFFFFF"), letterSpacing: "0.06em", textTransform: "uppercase", textShadow: "0 4px 20px rgba(0,0,0,0.45)" }}>{str(p.title, "Offer ends in")}</div>
				</MaskLine>
				<div style={{ display: "flex", alignItems: "flex-start", gap: 18 * m.u }}>
					{parts.map((v, i) => {
						const t = m.at(0.2 + i * 0.1, 0.45, E.linear);
						const changes = i === 2 || (i === 1 && parts[2] === 59) || (i === 0 && parts[1] === 59 && parts[2] === 59);
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list drawn in the same order every frame
							<div key={i} style={{ display: "flex", alignItems: "center", gap: 18 * m.u }}>
								<div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 * m.u, scale: String(E.back(t)), opacity: Math.min(1, t * 2) }}>
									<div style={{ width: tile, height: tile * 1.1, borderRadius: 24 * m.u, background: "rgba(12,14,20,0.9)", border: `${3 * m.u}px solid ${a}`, display: "grid", placeItems: "center", fontFamily: family, fontWeight: 900, fontSize: tile * 0.56, color: col(p.ink, "#FFFFFF"), fontVariantNumeric: "tabular-nums", scale: `1 ${changes && m.sec > 1 ? mix(1, 0.86, flip) : 1}` }}>{String(v).padStart(2, "0")}</div>
									<span style={{ fontFamily: family, fontWeight: 700, fontSize: 26 * m.u, color: a, letterSpacing: "0.14em" }}>{["HOURS", "MIN", "SEC"][i]}</span>
								</div>
								{i < 2 && <span style={{ fontFamily: family, fontWeight: 900, fontSize: tile * 0.45, color: a, marginTop: tile * 0.2, opacity: m.sec % 1 < 0.5 ? 1 : 0.35 }}>:</span>}
							</div>
						);
					})}
				</div>
			</Center>
		</AbsoluteFill>
	);
};

// ───────────── Infographics ─────────────

const Title: React.FC<{ p: MP; m: ReturnType<typeof useMg>; text: string; size?: number }> = ({ p, m, text, size = 64 }) =>
	text ? (
		<MaskLine t={m.at(0, 0.5)}>
			<div style={{ fontFamily: fontOf(p, "Manrope"), fontWeight: 800, fontSize: fitP(p, text, m.W * 0.86, size * m.u, 0.56), color: col(p.ink, "#FFFFFF") }}>{text}</div>
		</MaskLine>
	) : null;

/** Up to 8 bars rising one after another with their values counting on top. */
export const MgBarChart: React.FC<MP> = (p) => {
	const m = useMg(p);
	const labels = list(p.labels, "2022, 2023, 2024, 2025").slice(0, 8);
	const values = list(p.values, "24, 41, 67, 92").map((v) => num(v, 0)).slice(0, 8);
	const n = Math.max(1, Math.min(labels.length || values.length, 8, values.length));
	const max = Math.max(1, ...values.slice(0, n));
	const a = col(p.accent, "#22D3EE");
	const b = col(p.color2, "#c98a1e");
	const family = fontOf(p, "Manrope");
	const areaW = m.W * (m.shape === "wide" ? 0.7 : 0.84);
	const areaH = m.H * (m.shape === "tall" ? 0.36 : 0.48);
	const gap = areaW * 0.04;
	const bw = (areaW - gap * (n - 1)) / n;
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			{p.backdrop !== false && <Fill color={col(p.bg, "#0F172A")} />}
			<Center gap={50 * m.u}>
				<Title p={p} m={m} text={str(p.title)} />
				<div style={{ display: "flex", alignItems: "flex-end", gap, height: areaH, width: areaW, borderBottom: `${3 * m.u}px solid rgba(255,255,255,0.35)` }}>
					{values.slice(0, n).map((v, i) => {
						const t = m.at(0.4 + i * 0.14, 0.8, E.outQuart);
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list drawn in the same order every frame
							<div key={i} style={{ width: bw, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", gap: 10 * m.u }}>
								<span style={{ fontFamily: family, fontWeight: 800, fontSize: Math.min(bw * 0.36, 48 * m.u), color: col(p.ink, "#FFFFFF"), opacity: Math.min(1, t * 2), fontVariantNumeric: "tabular-nums" }}>
									{Math.round(v * t)}
									{str(p.unit)}
								</span>
								<div style={{ width: "100%", height: (areaH * 0.82 * v * t) / max, borderRadius: `${Math.min(18 * m.u, bw * 0.2)}px ${Math.min(18 * m.u, bw * 0.2)}px 0 0`, background: `linear-gradient(180deg, ${i === n - 1 ? a : b}, ${i === n - 1 ? a : b}99)` }} />
							</div>
						);
					})}
				</div>
				<div style={{ display: "flex", gap, width: areaW, marginTop: -30 * m.u }}>
					{labels.slice(0, n).map((l, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list drawn in the same order every frame
						<span key={l + i} style={{ width: bw, textAlign: "center", fontFamily: family, fontWeight: 600, fontSize: Math.min(bw * 0.3, 34 * m.u), color: col(p.ink, "#FFFFFF"), opacity: 0.75 * m.at(0.4 + i * 0.14, 0.4) }}>{l}</span>
					))}
				</div>
			</Center>
		</AbsoluteFill>
	);
};

/** A donut drawing its parts in turn, the biggest share in the middle, a legend with the numbers. */
export const MgDonutChart: React.FC<MP> = (p) => {
	const m = useMg(p);
	const labels = list(p.labels, "Editing, Shooting, Ideas").slice(0, 6);
	const values = list(p.values, "55, 30, 15").map((v) => Math.max(0, num(v, 0))).slice(0, labels.length || 6);
	const total = Math.max(1e-9, values.reduce((s, v) => s + v, 0));
	const palette = [col(p.accent, "#FF3D71"), col(p.color2, "#FFD23F"), col(p.color3, "#22D3EE"), "#f0bd6a", "#34D399", "#F97316"];
	const family = fontOf(p, "Manrope");
	// Side by side unless the frame is tall (a square has no room for the legend under the donut).
	const wide = m.shape !== "tall";
	const R = Math.min(m.W, m.H) * (m.shape === "square" ? 0.2 : wide ? 0.26 : 0.28);
	const sw = R * 0.36;
	const C = 2 * Math.PI * R;
	const draw = m.at(0.3, 1.2, E.inOut);
	let acc = 0;
	const top = values.indexOf(Math.max(...values));
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			{p.backdrop !== false && <Fill color={col(p.bg, "#0F172A")} />}
			<Center gap={40 * m.u}>
				<Title p={p} m={m} text={str(p.title)} />
				<div style={{ display: "flex", flexDirection: wide ? "row" : "column", alignItems: "center", gap: 60 * m.u }}>
					<div style={{ position: "relative", width: (R + sw) * 2, height: (R + sw) * 2, scale: String(mix(0.8, 1, m.at(0.1, 0.6))) }}>
						<svg aria-hidden="true" width={(R + sw) * 2} height={(R + sw) * 2} style={{ rotate: "-90deg" }}>
							<circle cx={R + sw} cy={R + sw} r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={sw} />
							{values.map((v, i) => {
								const share = v / total;
								const startShare = acc;
								acc += share;
								const shown = Math.max(0, Math.min(share, draw - startShare));
								// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list drawn in the same order every frame
								return <circle key={i} cx={R + sw} cy={R + sw} r={R} fill="none" stroke={palette[i % palette.length]} strokeWidth={sw} strokeDasharray={`${Math.max(0, shown * C - 4 * m.u)} ${C}`} strokeDashoffset={-startShare * C} />;
							})}
						</svg>
						<div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontFamily: family, fontWeight: 900, fontSize: R * 0.5, color: col(p.ink, "#FFFFFF"), opacity: m.at(1.2, 0.4) }}>{Math.round((values[top] / total) * 100)}%</div>
					</div>
					<div style={{ display: "flex", flexDirection: "column", gap: 18 * m.u }}>
						{labels.map((l, i) => {
							const t = m.at(0.6 + i * 0.15, 0.5);
							return (
								// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list drawn in the same order every frame
								<div key={l + i} style={{ display: "flex", alignItems: "center", gap: 16 * m.u, opacity: t, translate: `${mix(30, 0, t) * m.u}px 0` }}>
									<div style={{ width: 30 * m.u, height: 30 * m.u, borderRadius: 8 * m.u, background: palette[i % palette.length] }} />
									<span style={{ fontFamily: family, fontWeight: 600, fontSize: 40 * m.u, color: col(p.ink, "#FFFFFF") }}>{l}</span>
									<span style={{ fontFamily: family, fontWeight: 800, fontSize: 40 * m.u, color: palette[i % palette.length] }}>{Math.round(((values[i] ?? 0) / total) * 100)}%</span>
								</div>
							);
						})}
					</div>
				</div>
			</Center>
		</AbsoluteFill>
	);
};

/** Three big numbers counting up side by side (stacked on a tall frame), divided by hairlines. */
export const MgStatTrio: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FFD23F");
	const family = fontOf(p);
	const stats = [
		[str(p.v1, "98%"), str(p.l1)],
		[str(p.v2, "2M"), str(p.l2)],
		[str(p.v3, "24/7"), str(p.l3)],
	].filter(([v]) => v.trim());
	const row = m.shape !== "tall";
	const cell = row ? (m.W * 0.86) / stats.length : m.W * 0.8;
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			{p.backdrop === true && <Fill color={col(p.bg, "#0B0D12")} />}
			<Center column={!row}>
				{stats.map(([v, l], i) => {
					const t = m.at(0.2 + i * 0.2, 1.2, E.outQuart);
					return (
						// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list drawn in the same order every frame
						<div key={v + i} style={{ display: "flex", flexDirection: row ? "row" : "column", alignItems: "center" }}>
							{i > 0 && <div style={{ width: row ? 2 * m.u : cell * 0.4, height: row ? 160 * m.u : 2 * m.u, background: "rgba(255,255,255,0.3)", margin: row ? `0 ${10 * m.u}px` : `${30 * m.u}px 0`, scale: String(m.at(0.3 + i * 0.2, 0.5)) }} />}
							<div style={{ width: row ? cell - 22 * m.u : cell, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 * m.u, opacity: Math.min(1, t * 3), translate: `0 ${mix(40, 0, m.at(0.2 + i * 0.2, 0.6)) * m.u}px` }}>
								<span style={{ fontFamily: family, fontWeight: 900, fontSize: fitP(p, v, cell * 0.8, (m.shape === "square" ? 110 : row ? 130 : 150) * m.u, 0.7), color: a, fontVariantNumeric: "tabular-nums", textShadow: "0 6px 26px rgba(0,0,0,0.4)" }}>{countUp(v, t)}</span>
								<span style={{ fontFamily: family, fontWeight: 600, fontSize: 36 * m.u, color: col(p.ink, "#FFFFFF"), textAlign: "center", textShadow: "0 3px 14px rgba(0,0,0,0.5)" }}>{l}</span>
							</div>
						</div>
					);
				})}
			</Center>
		</AbsoluteFill>
	);
};

/** Numbered steps joined by a line that runs through them one by one. */
export const MgSteps: React.FC<MP> = (p) => {
	const m = useMg(p);
	const steps = list(p.steps, "Pick, Customise, Order, Enjoy").slice(0, 6);
	const n = Math.max(1, steps.length);
	const a = col(p.accent, "#00E0B8");
	const family = fontOf(p, "Manrope");
	const row = m.shape === "wide";
	const span = row ? m.W * 0.76 : m.H * 0.5;
	const dot = 110 * m.u;
	const run = m.at(0.4, Math.min(2.6, m.L * 0.55), E.inOut);
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			{p.backdrop !== false && <Fill color={col(p.bg, "#0F172A")} />}
			<Center gap={60 * m.u}>
				<Title p={p} m={m} text={str(p.title)} />
				<div style={{ position: "relative", width: row ? span : m.W * 0.7, height: row ? dot * 2.2 : span }}>
					<div style={{ position: "absolute", background: "rgba(255,255,255,0.2)", ...(row ? { left: 0, right: 0, top: dot / 2 - 3 * m.u, height: 6 * m.u } : { top: 0, bottom: 0, left: dot / 2 - 3 * m.u, width: 6 * m.u }) }} />
					<div style={{ position: "absolute", background: a, ...(row ? { left: 0, width: `${run * 100}%`, top: dot / 2 - 3 * m.u, height: 6 * m.u } : { top: 0, height: `${run * 100}%`, left: dot / 2 - 3 * m.u, width: 6 * m.u }) }} />
					{steps.map((s, i) => {
						const pos = n === 1 ? 0 : i / (n - 1);
						const on = Math.min(1, Math.max(0, (run - pos) * 8 + 1));
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list drawn in the same order every frame
							<div key={s + i} style={{ position: "absolute", display: "flex", flexDirection: row ? "column" : "row", alignItems: "center", gap: 18 * m.u, ...(row ? { left: pos * span - dot / 2 - (pos === 1 ? 0 : 0), top: 0, width: dot } : { top: pos * span - dot / 2, left: 0 }) }}>
								<div style={{ width: dot, height: dot, borderRadius: "50%", background: on > 0.5 ? a : "#1F2937", border: `${4 * m.u}px solid ${a}`, display: "grid", placeItems: "center", fontFamily: family, fontWeight: 900, fontSize: dot * 0.42, color: on > 0.5 ? "#0B0D12" : a, scale: String(mix(0.8, 1, E.back(on))) }}>{i + 1}</div>
								<span style={{ fontFamily: family, fontWeight: 700, fontSize: 38 * m.u, color: col(p.ink, "#FFFFFF"), whiteSpace: "nowrap", opacity: mix(0.35, 1, on) }}>{s}</span>
							</div>
						);
					})}
				</div>
			</Center>
		</AbsoluteFill>
	);
};

// ───────────── Testimonials, quotes, map, ratings ─────────────

/** A review card rising in: photo, stars filling one by one, the quote, the name and role. */
export const MgTestimonial: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FFC83D");
	const inkC = col(p.ink, "#111827");
	const family = fontOf(p, "Manrope");
	const w = Math.min(m.W * 0.86, (m.shape === "wide" ? 1100 : 900) * m.u);
	const rise = m.at(0, 0.6);
	const name = str(p.name, "Alex Morgan");
	const quote = str(p.quote);
	const avatar = 130 * m.u;
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<Center>
				<div style={{ width: w, borderRadius: 36 * m.u, background: col(p.card, "#FFFFFF"), padding: `${50 * m.u}px ${54 * m.u}px`, display: "flex", flexDirection: "column", gap: 26 * m.u, boxShadow: "0 30px 80px rgba(0,0,0,0.35)", translate: `0 ${mix(120, 0, rise) * m.u}px`, opacity: Math.min(1, rise * 2) }}>
					<div style={{ display: "flex", alignItems: "center", gap: 24 * m.u }}>
						<div style={{ width: avatar, height: avatar, borderRadius: "50%", overflow: "hidden", background: `linear-gradient(135deg, ${a}, #FF7A59)`, display: "grid", placeItems: "center", flexShrink: 0 }}>
							{p.assets?.photo?.url || str(p.photoUrl) ? <Picture asset={p.assets?.photo?.url ? p.assets.photo : { type: "image", url: str(p.photoUrl) }} /> : <span style={{ fontFamily: family, fontWeight: 800, fontSize: avatar * 0.4, color: "#fff" }}>{name.split(/\s+/).map((x) => x[0]).join("").slice(0, 2)}</span>}
						</div>
						<div style={{ display: "flex", flexDirection: "column", gap: 8 * m.u }}>
							<span style={{ fontFamily: family, fontWeight: 800, fontSize: 44 * m.u, color: inkC }}>{name}</span>
							<span style={{ fontFamily: family, fontWeight: 600, fontSize: 30 * m.u, color: inkC, opacity: 0.6 }}>{str(p.role)}</span>
						</div>
					</div>
					<Stars value={num(p.stars, 5)} size={54 * m.u} color={a} t={m.at(0.5, 0.9, E.linear)} />
					<div style={{ fontFamily: family, fontWeight: 600, fontSize: fitP(p, quote, w * 3.2, 46 * m.u, 0.5), lineHeight: 1.35, color: inkC, opacity: m.at(0.8, 0.6) }}>“{quote}”</div>
				</div>
			</Center>
		</AbsoluteFill>
	);
};

/** A large quote mark, the quote fading in word by word in italic serif, a hairline and the author. */
export const MgBigQuote: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#E8C77A");
	const words = str(p.quote, "Simplicity is the ultimate sophistication.").split(/\s+/).filter(Boolean);
	const fs = fitP(p, words.join(" "), m.W * 0.82 * (m.shape === "tall" ? 3.4 : 2.4), 84 * m.u, 0.5);
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			{p.backdrop !== false && <Fill color={col(p.bg, "#141414")} />}
			<Center gap={30 * m.u} style={{ padding: `0 ${m.W * 0.09}px` }}>
				<div style={{ fontFamily: serifItalic(), fontSize: 260 * m.u, lineHeight: 0.6, height: 130 * m.u, color: a, scale: String(mix(0.4, 1, E.back(m.at(0, 0.5, E.linear)))), opacity: m.at(0, 0.3) }}>“</div>
				<div style={{ fontFamily: str(p.font) === "PlayfairDisplay" || !p.font ? serifItalic() : fontOf(p), fontSize: fs, lineHeight: 1.25, color: col(p.ink, "#FFFFFF"), textAlign: "center" }}>
					{words.map((w, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list drawn in the same order every frame
						<span key={w + i} style={{ opacity: m.at(0.3 + i * 0.08, 0.5), display: "inline-block", translate: `0 ${mix(18, 0, m.at(0.3 + i * 0.08, 0.6)) * m.u}px`, marginRight: "0.28em" }}>{w}</span>
					))}
				</div>
				<div style={{ width: 120 * m.u * m.at(0.5 + words.length * 0.08, 0.5, E.inOut), height: 3 * m.u, background: a }} />
				<div style={{ fontFamily: fontOf(p, "Manrope"), fontWeight: 600, fontSize: 36 * m.u, color: a, letterSpacing: "0.16em", textTransform: "uppercase", opacity: m.at(0.6 + words.length * 0.08, 0.5) }}>{str(p.author)}</div>
			</Center>
		</AbsoluteFill>
	);
};

/** Point on a cubic Bézier. */
const bez = (t: number, a: number, b: number, c: number, d: number) => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d;

const Pin: React.FC<{ x: number; y: number; color: string; t: number; size: number }> = ({ x, y, color, t, size }) => (
	<svg aria-hidden="true" width={size} height={size * 1.3} viewBox="0 0 24 31" style={{ position: "absolute", left: x - size / 2, top: y - size * 1.3, translate: `0 ${mix(-size, 0, E.back(t))}px`, opacity: Math.min(1, t * 3) }}>
		<path d="M12 0C5.4 0 0 5.2 0 11.7 0 20.4 12 31 12 31s12-10.6 12-19.3C24 5.2 18.6 0 12 0z" fill={color} />
		<circle cx="12" cy="11.5" r="4.6" fill="#fff" />
	</svg>
);

/** A stylised map: streets, a route drawing itself from A to B with a moving dot, pins and the distance. */
export const MgMapRoute: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FF3D71");
	const b = col(p.color2, "#22D3EE");
	const family = fontOf(p, "Manrope");
	const { W, H, u } = m;
	const A = { x: W * 0.2, y: H * (m.shape === "tall" ? 0.68 : 0.7) };
	const B = { x: W * 0.8, y: H * (m.shape === "tall" ? 0.32 : 0.3) };
	const c1 = { x: W * 0.35, y: H * 0.2 };
	const c2 = { x: W * 0.62, y: H * 0.85 };
	const run = m.at(0.6, Math.min(2.2, m.L * 0.5), E.inOut);
	const path = `M${A.x},${A.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${B.x},${B.y}`;
	const len = Math.hypot(W, H) * 1.1;
	const dot = { x: bez(run, A.x, c1.x, c2.x, B.x), y: bez(run, A.y, c1.y, c2.y, B.y) };
	const streets = Array.from({ length: 9 }, (_, i) => i);
	const label = (text: string, x: number, y: number, t: number) => (
		<div style={{ position: "absolute", left: x, top: y + 16 * u, translate: "-50% 0", fontFamily: family, fontWeight: 800, fontSize: 40 * u, color: col(p.ink, "#FFFFFF"), background: "rgba(0,0,0,0.55)", padding: `${8 * u}px ${22 * u}px`, borderRadius: 999, opacity: t, whiteSpace: "nowrap" }}>{text}</div>
	);
	return (
		<AbsoluteFill style={{ opacity: m.out * m.at(0, 0.4), background: col(p.bg, "#0F172A"), overflow: "hidden" }}>
			<svg aria-hidden="true" width={W} height={H} style={{ position: "absolute", inset: 0 }}>
				{streets.map((i) => (
					<line key={`h${i}`} x1={0} x2={W} y1={(H * (i + 0.5)) / 9} y2={(H * (i + 0.5)) / 9 + ((i % 3) - 1) * 60 * u} stroke="rgba(255,255,255,0.07)" strokeWidth={(i % 3 === 0 ? 10 : 4) * u} />
				))}
				{streets.map((i) => (
					<line key={`v${i}`} y1={0} y2={H} x1={(W * (i + 0.5)) / 9} x2={(W * (i + 0.5)) / 9 + ((i % 4) - 1.5) * 50 * u} stroke="rgba(255,255,255,0.06)" strokeWidth={(i % 4 === 0 ? 10 : 4) * u} />
				))}
				<circle cx={W * 0.7} cy={H * 0.62} r={Math.min(W, H) * 0.12} fill="rgba(34,211,238,0.07)" />
				<path d={path} fill="none" stroke={`${b}44`} strokeWidth={14 * u} strokeLinecap="round" />
				<path d={path} fill="none" stroke={b} strokeWidth={10 * u} strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - run)} />
				{run > 0 && run < 1 && <circle cx={dot.x} cy={dot.y} r={16 * u} fill="#fff" stroke={b} strokeWidth={6 * u} />}
			</svg>
			<Pin x={A.x} y={A.y} color={a} t={m.at(0.2, 0.5, E.linear)} size={70 * u} />
			<Pin x={B.x} y={B.y} color={a} t={m.at(0.6 + Math.min(2.2, m.L * 0.5), 0.5, E.linear)} size={70 * u} />
			{label(str(p.from, "Lisbon"), A.x, A.y, m.at(0.3, 0.4))}
			{label(str(p.to, "Berlin"), B.x, B.y, m.at(0.7 + Math.min(2.2, m.L * 0.5), 0.4))}
			<div style={{ position: "absolute", left: "50%", top: H * 0.08, translate: "-50% 0", fontFamily: family, fontWeight: 800, fontSize: 46 * u, color: "#0B0D12", background: b, padding: `${12 * u}px ${30 * u}px`, borderRadius: 999, opacity: m.at(1, 0.5), whiteSpace: "nowrap" }}>{str(p.info)}</div>
		</AbsoluteFill>
	);
};

/** «Loved by customers»: a rating counting up, stars filling, a row of avatars and the review count. */
export const MgRating: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FFC83D");
	const family = fontOf(p, "Montserrat");
	const rating = Math.min(5, Math.max(0, num(p.rating, 4.9)));
	const t = m.at(0.3, 1.2, E.outQuart);
	const faces = ["#F472B6", "#60A5FA", "#34D399", "#FBBF24", "#f0bd6a"];
	const av = 96 * m.u;
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			{p.backdrop === true && <Fill color={col(p.bg, "#0B0D12")} />}
			<Center gap={24 * m.u}>
				<MaskLine t={m.at(0, 0.5)}>
					<div style={{ fontFamily: family, fontWeight: 800, fontSize: fitP(p, str(p.title), m.W * 0.86, 64 * m.u, 0.58), color: col(p.ink, "#FFFFFF"), textShadow: "0 4px 20px rgba(0,0,0,0.45)" }}>{str(p.title, "Loved by customers")}</div>
				</MaskLine>
				<div style={{ display: "flex", alignItems: "center", gap: 28 * m.u }}>
					<span style={{ fontFamily: family, fontWeight: 900, fontSize: 150 * m.u, color: col(p.ink, "#FFFFFF"), fontVariantNumeric: "tabular-nums", textShadow: "0 6px 26px rgba(0,0,0,0.4)" }}>{(rating * t).toFixed(1)}</span>
					<Stars value={rating} size={70 * m.u} color={a} t={m.at(0.3, 1, E.linear)} />
				</div>
				<div style={{ display: "flex", alignItems: "center", gap: 20 * m.u }}>
					<div style={{ display: "flex" }}>
						{faces.map((c, i) => {
							const s = E.back(m.at(0.7 + i * 0.08, 0.4, E.linear));
							return <div key={c} style={{ width: av, height: av, borderRadius: "50%", background: `linear-gradient(135deg, ${c}, ${c}88)`, border: `${5 * m.u}px solid #0B0D12`, marginLeft: i ? -av * 0.3 : 0, scale: String(s), opacity: Math.min(1, s * 2) }} />;
						})}
					</div>
					<span style={{ fontFamily: family, fontWeight: 700, fontSize: 40 * m.u, color: col(p.ink, "#FFFFFF"), opacity: m.at(1.1, 0.4), textShadow: "0 3px 14px rgba(0,0,0,0.5)" }}>{str(p.count)}</span>
				</div>
			</Center>
		</AbsoluteFill>
	);
};
