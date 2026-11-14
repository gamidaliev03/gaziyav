// Kinetic typography, product / price / sale, and calls to action.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { Picture } from "../assets";
import { parseAccents } from "../ease";
import { Center, col, E, Fill, fitP, fontOf, Logo, MaskLine, mix, type MP, num, str, useMg } from "./base";

// ───────────── Kinetic type ─────────────

/** Three lines slam in one after another (the middle one in the accent) and slide away in turn. */
export const MgKineticStack: React.FC<MP> = (p) => {
	const m = useMg(p);
	const lines = [str(p.line1, "MAKE"), str(p.line2, "IT"), str(p.line3, "POP")].filter((l) => l.trim());
	const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), "");
	const fs = fitP(p, longest, m.W * 0.86, (m.shape === "wide" ? 200 : 240) * m.u, 0.72);
	const family = fontOf(p);
	return (
		<AbsoluteFill style={{ overflow: "hidden" }}>
			{p.backdrop === true && <Fill color={col(p.bg, "#0B0D12")} opacity={m.out} />}
			<Center style={{ scale: String(mix(1, 1.06, m.life)) }}>
				{lines.map((l, i) => {
					const t = m.at(i * 0.18, 0.4, E.linear);
					const leave = m.at(m.L - 0.5 + i * 0.06, 0.38, E.in);
					return (
						// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list drawn in the same order every frame
						<div key={l + i} style={{ fontFamily: family, fontWeight: 900, fontSize: fs, lineHeight: 0.98, color: i === 1 ? col(p.accent, "#FFD23F") : col(p.ink, "#FFFFFF"), scale: String(mix(2.2, 1, E.out(t))), opacity: Math.min(1, t * 3), translate: `${(i % 2 ? 1 : -1) * leave * 120}% 0`, textShadow: "0 6px 30px rgba(0,0,0,0.35)", whiteSpace: "nowrap" }}>
							{l}
						</div>
					);
				})}
			</Center>
		</AbsoluteFill>
	);
};

/** One word at a time, big, on the beat (*word* = accent pill). */
export const MgWordPop: React.FC<MP> = (p) => {
	const m = useMg(p);
	const words = parseAccents(str(p.text, "Every word *lands* on the beat")).flat();
	const pace = Math.max(0.5, num(p.pace, 3));
	const i = Math.min(words.length - 1, Math.floor(m.sec * pace));
	const local = m.sec * pace - i;
	const w = words[Math.max(0, i)];
	if (!w) return null;
	const pop = E.back(Math.min(1, local * 3.2));
	const fs = fitP(p, w.w, m.W * 0.8, 210 * m.u, 0.66);
	const a = col(p.accent, "#22D3EE");
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			{p.backdrop === true && <Fill color={col(p.bg, "#0B0D12")} />}
			<Center>
				<div style={{ fontFamily: fontOf(p, "Montserrat"), fontWeight: 900, fontSize: fs, color: w.accent ? col(p.bg, "#0B0D12") : col(p.ink, "#FFFFFF"), background: w.accent ? a : "transparent", padding: w.accent ? `0 ${fs * 0.2}px` : 0, borderRadius: fs * 0.16, scale: String(mix(0.55, 1, pop)), rotate: `${(i % 2 ? 1 : -1) * mix(5, 0, pop)}deg`, textShadow: w.accent ? undefined : "0 6px 28px rgba(0,0,0,0.45)", whiteSpace: "nowrap" }}>
					{w.w}
				</div>
			</Center>
		</AbsoluteFill>
	);
};

/** A big word cuts in half and opens like a door on the hidden word. */
export const MgSplitReveal: React.FC<MP> = (p) => {
	const m = useMg(p);
	const top = str(p.title, "BEFORE");
	const hidden = str(p.reveal, "AFTER");
	const fs = fitP(p, top.length > hidden.length ? top : hidden, m.W * 0.84, 220 * m.u, 0.72);
	const split = m.at(0.9, 0.6, E.inOut);
	const family = fontOf(p);
	const word = (clip: string, dy: number) => (
		<div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", clipPath: clip, translate: `0 ${dy}px`, opacity: 1 - m.at(1.6, 0.5) }}>
			<div style={{ fontFamily: family, fontWeight: 900, fontSize: fs, color: col(p.ink, "#FFFFFF"), whiteSpace: "nowrap", textShadow: "0 6px 26px rgba(0,0,0,0.4)" }}>{top}</div>
		</div>
	);
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<Center>
				<div style={{ fontFamily: family, fontWeight: 900, fontSize: fs * 0.82, color: col(p.ink, "#FFFFFF"), background: col(p.accent, "#FF3D71"), padding: `0 ${fs * 0.24}px`, borderRadius: fs * 0.12, scale: String(mix(0.7, 1, split)), opacity: split, whiteSpace: "nowrap" }}>{hidden}</div>
			</Center>
			<AbsoluteFill style={{ opacity: m.at(0, 0.3), scale: String(mix(1.2, 1, m.at(0, 0.5))) }}>
				{word("inset(0 0 50% 0)", -split * fs * 0.95)}
				{word("inset(50% 0 0 0)", split * fs * 0.95)}
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

/** Outlined letters fill with colour from left to right, then a shine runs over them. */
export const MgOutlineFill: React.FC<MP> = (p) => {
	const m = useMg(p);
	const title = str(p.title, "UNSTOPPABLE");
	const fs = fitP(p, title, m.W * 0.88, 210 * m.u, 0.74);
	const a = col(p.accent, "#FFD23F");
	const fill = m.at(0.5, 1, E.inOut);
	const shine = mix(-30, 130, m.at(1.6, 0.8, E.inOut));
	const base: React.CSSProperties = { fontFamily: fontOf(p), fontWeight: 900, fontSize: fs, whiteSpace: "nowrap", letterSpacing: "0.01em" };
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<Center style={{ scale: String(mix(0.9, 1, m.at(0, 0.6))), opacity: m.at(0, 0.3) }}>
				<div style={{ position: "relative" }}>
					<div style={{ ...base, color: "transparent", WebkitTextStroke: `${Math.max(2, fs * 0.025)}px ${col(p.ink, "#FFFFFF")}` }}>{title}</div>
					<div style={{ ...base, position: "absolute", inset: 0, clipPath: `inset(0 ${100 - fill * 100}% 0 0)`, backgroundImage: `linear-gradient(100deg, ${a} ${shine - 12}%, #ffffff ${shine}%, ${a} ${shine + 12}%)`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{title}</div>
				</div>
			</Center>
		</AbsoluteFill>
	);
};

/** Tilted bands of repeated text running in opposite directions. */
export const MgMarquee: React.FC<MP> = (p) => {
	const m = useMg(p);
	const t = str(p.text, "NEW DROP");
	const a = col(p.accent, "#FFD23F");
	const rows = m.shape === "tall" ? 5 : 3;
	const fs = (m.shape === "wide" ? 120 : 110) * m.u;
	const unit = `${t}  •  `;
	const line = unit.repeat(Math.ceil((m.W * 2.6) / Math.max(1, unit.length * fs * 0.62)) + 2);
	const speed = num(p.speed, 1);
	const family = fontOf(p);
	return (
		<AbsoluteFill style={{ overflow: "hidden", opacity: m.out }}>
			{p.backdrop === true && <Fill color={col(p.ink, "#0B0D12")} />}
			<Center gap={20 * m.u} style={{ rotate: "-7deg", scale: "1.25" }}>
				{Array.from({ length: rows }, (_, r) => {
					const enter = m.at(r * 0.07, 0.5);
					const dir = r % 2 ? 1 : -1;
					const x = dir * ((m.sec * 240 * speed * m.u) % (unit.length * fs * 0.62)) + dir * mix(m.W, 0, enter);
					const solid = r % 2 === 0;
					return (
						// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list drawn in the same order every frame
						<div key={r} style={{ width: m.W * 1.6, background: solid ? a : "transparent", padding: `${8 * m.u}px 0`, overflow: "hidden" }}>
							<div style={{ fontFamily: family, fontWeight: 900, fontSize: fs, whiteSpace: "pre", color: solid ? col(p.ink, "#0B0D12") : "transparent", WebkitTextStroke: solid ? undefined : `${3 * m.u}px ${a}`, translate: `${x - unit.length * fs * 0.62}px 0`, lineHeight: 1.1 }}>{line}</div>
						</div>
					);
				})}
			</Center>
		</AbsoluteFill>
	);
};

// ───────────── Product, price, sale ─────────────

const Check: React.FC<{ size: number; color: string }> = ({ size, color }) => (
	<svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24">
		<circle cx="12" cy="12" r="11" fill={color} />
		<path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#0B0D12" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
	</svg>
);

const PhotoSlot: React.FC<{ p: MP; w: number; h: number; radius: number; accent: string; label: string }> = ({ p, w, h, radius, accent, label }) => (
	<div style={{ width: w, height: h, borderRadius: radius, overflow: "hidden", background: `linear-gradient(135deg, ${accent}55, ${accent}11)`, display: "grid", placeItems: "center", boxShadow: "0 30px 70px rgba(0,0,0,0.45)" }}>
		{p.assets?.photo?.url || str(p.photoUrl) ? <Picture asset={p.assets?.photo?.url ? p.assets.photo : { type: "image", url: str(p.photoUrl) }} /> : <span style={{ fontFamily: fontOf(p, "Manrope"), color: "#fff", opacity: 0.6, fontSize: Math.min(w, h) * 0.08, fontWeight: 700 }}>{label}</span>}
	</div>
);

/** The product floats on a glow, its name and three features with checks come in beside it. */
export const MgProductShowcase: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#22D3EE");
	const wide = m.shape === "wide";
	const photo = wide ? m.H * 0.62 : m.W * 0.62;
	const family = fontOf(p, "Manrope");
	const feats = [str(p.feat1), str(p.feat2), str(p.feat3)].filter((f) => f.trim());
	const float = Math.sin(m.sec * 2) * 10 * m.u;
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			{p.backdrop !== false && <Fill color={col(p.bg, "#0F172A")} />}
			<Center column={!wide} gap={(wide ? 90 : 60) * m.u}>
				<div style={{ position: "relative", translate: `0 ${float}px`, scale: String(mix(0.7, 1, E.back(m.at(0.1, 0.6, E.linear)))), opacity: m.at(0.1, 0.3) }}>
					<div style={{ position: "absolute", inset: -photo * 0.25, borderRadius: "50%", background: `radial-gradient(circle, ${a}66 0%, ${a}00 65%)` }} />
					<PhotoSlot p={p} w={photo} h={photo} radius={photo * 0.12} accent={a} label="Product photo" />
				</div>
				<div style={{ display: "flex", flexDirection: "column", alignItems: wide ? "flex-start" : "center", gap: 26 * m.u, maxWidth: wide ? m.W * 0.42 : m.W * 0.86 }}>
					<MaskLine t={m.at(0.4, 0.6)}>
						<div style={{ fontFamily: family, fontWeight: 800, fontSize: fitP(p, str(p.name), wide ? m.W * 0.4 : m.W * 0.86, 84 * m.u, 0.56), color: col(p.ink, "#FFFFFF"), lineHeight: 1.05 }}>{str(p.name, "Product")}</div>
					</MaskLine>
					{feats.map((f, i) => {
						const t = m.at(0.7 + i * 0.16, 0.5);
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list drawn in the same order every frame
							<div key={f + i} style={{ display: "flex", alignItems: "center", gap: 16 * m.u, opacity: t, translate: `${mix(40, 0, t) * m.u}px 0` }}>
								<Check size={46 * m.u} color={a} />
								<span style={{ fontFamily: family, fontWeight: 600, fontSize: 42 * m.u, color: col(p.ink, "#FFFFFF") }}>{f}</span>
							</div>
						);
					})}
				</div>
			</Center>
		</AbsoluteFill>
	);
};

/** A price card: the old price strikes through, the new one punches in, a round badge spins onto the corner. */
export const MgPriceTag: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FFD23F");
	const b = col(p.color2, "#FF3D71");
	const family = fontOf(p);
	const cur = str(p.currency, "$");
	const old = str(p.oldPrice);
	const card = m.at(0, 0.5, E.linear);
	const strike = m.at(0.55, 0.35, E.inOut);
	const punch = E.back(m.at(0.75, 0.45, E.linear));
	const badge = m.at(1.05, 0.5, E.linear);
	const w = Math.min(m.W * 0.8, 760 * m.u);
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<Center>
				<div style={{ position: "relative", width: w, padding: `${50 * m.u}px ${40 * m.u}px`, borderRadius: 40 * m.u, background: "rgba(12,14,20,0.88)", border: `${4 * m.u}px solid ${a}`, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 * m.u, scale: String(mix(0.6, 1, E.back(card))), opacity: Math.min(1, card * 2) }}>
					<div style={{ fontFamily: family, fontWeight: 700, fontSize: 40 * m.u, color: a, letterSpacing: "0.12em", textTransform: "uppercase" }}>{str(p.title, "Today only")}</div>
					{old && (
						<div style={{ position: "relative", fontFamily: family, fontWeight: 700, fontSize: 60 * m.u, color: col(p.ink, "#FFFFFF"), opacity: 0.55 }}>
							{cur}
							{old}
							<div style={{ position: "absolute", left: "-6%", top: "52%", height: 6 * m.u, width: `${strike * 112}%`, background: b, rotate: "-8deg", borderRadius: 3 * m.u }} />
						</div>
					)}
					<div style={{ fontFamily: family, fontWeight: 900, fontSize: fitP(p, `${cur}${str(p.price, "49")}`, w * 0.8, 200 * m.u, 0.7), color: col(p.ink, "#FFFFFF"), scale: String(mix(0.3, 1, punch)), opacity: Math.min(1, punch * 2), lineHeight: 1 }}>
						<span style={{ fontSize: "0.5em", verticalAlign: "0.7em", color: a }}>{cur}</span>
						{str(p.price, "49")}
					</div>
					{str(p.badge) && (
						<div style={{ position: "absolute", right: -50 * m.u, top: -60 * m.u, width: 190 * m.u, height: 190 * m.u, borderRadius: "50%", background: b, display: "grid", placeItems: "center", fontFamily: family, fontWeight: 900, fontSize: fitP(p, str(p.badge), 150 * m.u, 64 * m.u, 0.64), color: "#fff", rotate: `${mix(-200, 12, badge)}deg`, scale: String(E.back(badge)), boxShadow: "0 16px 40px rgba(0,0,0,0.35)" }}>{str(p.badge)}</div>
					)}
				</div>
			</Center>
		</AbsoluteFill>
	);
};

/** «SALE» on a spinning starburst with rays, the discount stamped beside it. */
export const MgSaleBurst: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FF2E4D");
	const b = col(p.color2, "#FFD23F");
	const family = fontOf(p);
	const spikes = 18;
	const R = Math.min(m.W, m.H) * 0.36;
	const pts = Array.from({ length: spikes * 2 }, (_, i) => {
		const r = i % 2 ? R * 0.8 : R;
		const ang = (i / (spikes * 2)) * Math.PI * 2;
		return `${R + Math.cos(ang) * r},${R + Math.sin(ang) * r}`;
	}).join(" ");
	const pop = E.back(m.at(0.1, 0.5, E.linear));
	const stamp = E.back(m.at(0.6, 0.45, E.linear));
	return (
		<AbsoluteFill style={{ opacity: m.out, overflow: "hidden" }}>
			{p.backdrop !== false && <AbsoluteFill style={{ background: `repeating-conic-gradient(from ${m.sec * 20}deg, ${a} 0deg 10deg, ${a}dd 10deg 20deg)`, opacity: m.at(0, 0.3) }} />}
			<Center>
				<svg aria-hidden="true" width={R * 2} height={R * 2} style={{ position: "absolute", rotate: `${m.sec * 25}deg`, scale: String(pop) }}>
					<polygon points={pts} fill={b} />
				</svg>
				<div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", scale: String(pop) }}>
					<div style={{ fontFamily: family, fontWeight: 900, fontSize: R * 0.5, color: a, lineHeight: 0.95, rotate: "-6deg", textShadow: "0 6px 0 rgba(0,0,0,0.18)" }}>{str(p.title, "SALE")}</div>
					<div style={{ fontFamily: family, fontWeight: 900, fontSize: R * 0.34, color: "#0B0D12", rotate: "-6deg", scale: String(mix(2, 1, stamp)), opacity: Math.min(1, stamp * 2) }}>{str(p.discount, "-70%")}</div>
				</div>
			</Center>
			<AbsoluteFill style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", paddingBottom: m.H * (m.shape === "tall" ? 0.2 : 0.08) }}>
				<div style={{ fontFamily: family, fontWeight: 700, fontSize: 44 * m.u, color: col(p.ink, "#FFFFFF"), background: "rgba(0,0,0,0.55)", padding: `${12 * m.u}px ${32 * m.u}px`, borderRadius: 999, opacity: m.at(0.9, 0.4), translate: `0 ${mix(40, 0, m.at(0.9, 0.5)) * m.u}px` }}>{str(p.sub)}</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

/** The product card slides in tilted, a «NEW» stamp lands on its corner, the name rises beneath. */
export const MgNewArrival: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#00E0B8");
	const family = fontOf(p, "Montserrat");
	const wide = m.shape === "wide";
	const cw = wide ? m.H * 0.56 : m.W * 0.6;
	const slide = m.at(0, 0.7);
	const stamp = E.back(m.at(0.6, 0.45, E.linear));
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			{p.backdrop === true && <Fill color={col(p.bg, "#111827")} />}
			<Center column={!wide} gap={60 * m.u}>
				<div style={{ position: "relative", translate: `${mix(m.W * 0.6, 0, slide)}px 0`, rotate: `${mix(14, -3, slide)}deg` }}>
					<PhotoSlot p={p} w={cw} h={cw * 1.2} radius={30 * m.u} accent={a} label="Product photo" />
					<div style={{ position: "absolute", left: -50 * m.u, top: -50 * m.u, width: 180 * m.u, height: 180 * m.u, borderRadius: "50%", background: a, display: "grid", placeItems: "center", fontFamily: family, fontWeight: 900, fontSize: fitP(p, str(p.badge, "NEW"), 140 * m.u, 60 * m.u, 0.66), color: "#0B0D12", rotate: `${mix(-90, -12, stamp)}deg`, scale: String(mix(2.2, 1, stamp)), opacity: Math.min(1, stamp * 2) }}>{str(p.badge, "NEW")}</div>
				</div>
				<div style={{ display: "flex", flexDirection: "column", alignItems: wide ? "flex-start" : "center", gap: 14 * m.u }}>
					<MaskLine t={m.at(0.75, 0.6)}>
						<div style={{ fontFamily: family, fontWeight: 800, fontSize: fitP(p, str(p.name), wide ? m.W * 0.42 : m.W * 0.86, 80 * m.u, 0.6), color: col(p.ink, "#FFFFFF"), textShadow: "0 4px 22px rgba(0,0,0,0.4)" }}>{str(p.name, "New collection")}</div>
					</MaskLine>
					<div style={{ fontFamily: family, fontWeight: 600, fontSize: 38 * m.u, color: a, opacity: m.at(1, 0.5), letterSpacing: "0.1em", textTransform: "uppercase" }}>{str(p.sub)}</div>
				</div>
			</Center>
		</AbsoluteFill>
	);
};

// ───────────── Call to action ─────────────

const CURSOR = "M4 2.5l14.5 10.2-6.6 1.3 3.9 7.3-3 1.6-3.9-7.4L4 20.4z";
const Cursor: React.FC<{ size: number; x: number; y: number; press: number; opacity?: number }> = ({ size, x, y, press, opacity = 1 }) => (
	<svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" style={{ position: "absolute", left: x, top: y, scale: String(1 - press * 0.15), opacity, filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.4))" }}>
		<path d={CURSOR} fill="#fff" stroke="#111" strokeWidth={1.3} strokeLinejoin="round" />
	</svg>
);

const Bell: React.FC<{ size: number; color: string; ring: number }> = ({ size, color, ring }) => (
	<svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" style={{ rotate: `${Math.sin(ring * Math.PI * 6) * 18 * (1 - ring)}deg` }}>
		<path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zm-2.5 15a2.5 2.5 0 0 0 5 0" fill={color} />
	</svg>
);

/** Channel bar with a subscribe button: the cursor comes in, clicks, the button turns grey and the bell rings. */
export const MgSubscribe: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FF2E4D");
	const family = fontOf(p, "Montserrat");
	const s = m.shape === "wide" ? 0.9 : 1;
	const bar = m.at(0, 0.55, E.linear);
	const click = 1.5;
	const moving = m.at(0.6, 0.8, E.inOut);
	const press = m.at(click, 0.08, E.linear) * (1 - m.at(click + 0.1, 0.12, E.linear));
	const done = m.sec >= click + 0.08;
	const ring = m.at(click + 0.15, 0.9, E.linear);
	const H = 150 * m.u * s;
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<AbsoluteFill style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingTop: m.shape === "tall" ? m.H * 0.3 : m.H * 0.4 }}>
				<div style={{ position: "relative", display: "flex", alignItems: "center", gap: 24 * m.u * s, padding: `${14 * m.u}px ${18 * m.u}px`, height: H, borderRadius: H / 2, background: "rgba(255,255,255,0.96)", boxShadow: "0 20px 50px rgba(0,0,0,0.35)", scale: String(mix(0.4, 1, E.back(bar))), opacity: Math.min(1, bar * 2) }}>
					<Logo p={{ ...p, accent: a, bg: "#ffffff", monogram: str(p.channel, "Y").slice(0, 1) }} size={H - 28 * m.u} />
					<span style={{ fontFamily: family, fontWeight: 800, fontSize: 44 * m.u * s, color: "#111", whiteSpace: "nowrap" }}>{str(p.channel, "Your Channel")}</span>
					<div style={{ position: "relative" }}>
						<div style={{ background: done ? "#E5E7EB" : a, color: done ? "#374151" : "#fff", fontFamily: family, fontWeight: 800, fontSize: 36 * m.u * s, padding: `${20 * m.u * s}px ${34 * m.u * s}px`, borderRadius: 999, scale: String(1 - press * 0.08), whiteSpace: "nowrap" }}>{done ? str(p.done, "SUBSCRIBED") : str(p.button, "SUBSCRIBE")}</div>
						<Cursor size={90 * m.u} x={(mix(420, 0, moving) + mix(0, 160, m.at(click + 0.4, 0.5, E.inOut))) * m.u + 60 * m.u} y={(mix(300, 0, moving) + mix(0, 120, m.at(click + 0.4, 0.5, E.inOut))) * m.u + 30 * m.u} press={press} opacity={1 - m.at(click + 0.5, 0.4)} />
					</div>
					<div style={{ width: done ? 70 * m.u : 0, overflow: "hidden", display: "grid", placeItems: "center" }}>
						<Bell size={56 * m.u} color="#111" ring={ring} />
					</div>
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

/** «Link in bio» pill opening from a dot, an arrow bouncing at it, the link beneath. */
export const MgLinkInBio: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FFD23F");
	const family = fontOf(p, "Onest");
	const open = m.at(0.1, 0.6, E.inOut);
	const bounce = Math.abs(Math.sin(m.sec * 5)) * 26 * m.u;
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<Center gap={24 * m.u}>
				<div style={{ fontSize: 80 * m.u, translate: `0 ${-bounce}px`, opacity: m.at(0.6, 0.3), color: a, fontFamily: family, fontWeight: 900, lineHeight: 1 }}>↓</div>
				<div style={{ display: "flex", alignItems: "center", gap: 18 * m.u, background: a, borderRadius: 999, height: 130 * m.u, padding: `0 ${mix(0, 54, open) * m.u}px`, maxWidth: mix(130 * m.u, m.W * 0.9, open), overflow: "hidden", boxShadow: "0 18px 46px rgba(0,0,0,0.35)" }}>
					<svg aria-hidden="true" width={58 * m.u} height={58 * m.u} viewBox="0 0 24 24" fill="none" stroke={col(p.ink, "#0B0D12")} strokeWidth={2.4} strokeLinecap="round">
						<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
						<path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
					</svg>
					<span style={{ fontFamily: family, fontWeight: 800, fontSize: 60 * m.u, color: col(p.ink, "#0B0D12"), whiteSpace: "nowrap", opacity: open }}>{str(p.text, "Link in bio")}</span>
				</div>
				<div style={{ fontFamily: family, fontWeight: 600, fontSize: 38 * m.u, color: "#fff", background: "rgba(0,0,0,0.55)", padding: `${10 * m.u}px ${28 * m.u}px`, borderRadius: 999, opacity: m.at(0.8, 0.4) }}>{str(p.url)}</div>
			</Center>
		</AbsoluteFill>
	);
};

/** A big button with a shine; a tap ripples it at the beat. */
export const MgBuyNow: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#00E0B8");
	const family = fontOf(p);
	const enter = E.back(m.at(0.1, 0.5, E.linear));
	const tap = 1.2;
	const press = m.at(tap, 0.08, E.linear) * (1 - m.at(tap + 0.1, 0.15, E.linear));
	const ripple = m.at(tap, 0.7);
	const shine = ((m.sec * 0.8) % 1.4) * 100 - 20;
	const w = Math.min(m.W * 0.78, 720 * m.u);
	const h = 170 * m.u;
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<Center gap={26 * m.u}>
				<div style={{ position: "relative", scale: String(enter * (1 - press * 0.07)) }}>
					<div style={{ position: "absolute", left: "50%", top: "50%", width: w, height: h, translate: "-50% -50%", borderRadius: h / 2, border: `${6 * m.u}px solid ${a}`, scale: String(mix(1, 1.5, ripple)), opacity: ripple > 0 && ripple < 1 ? 1 - ripple : 0 }} />
					<div style={{ width: w, height: h, borderRadius: h / 2, background: `linear-gradient(105deg, ${a} ${shine - 10}%, #ffffffcc ${shine}%, ${a} ${shine + 10}%)`, display: "flex", alignItems: "center", justifyContent: "center", gap: 22 * m.u, boxShadow: `0 20px 50px ${a}55` }}>
						<svg aria-hidden="true" width={70 * m.u} height={70 * m.u} viewBox="0 0 24 24" fill="none" stroke={col(p.ink, "#0B0D12")} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
							<path d="M3 4h2.5l2.2 11h10.6l2-8H6.4" />
							<circle cx="9.5" cy="19.5" r="1.5" />
							<circle cx="16.5" cy="19.5" r="1.5" />
						</svg>
						<span style={{ fontFamily: family, fontWeight: 900, fontSize: fitP(p, str(p.button, "BUY NOW"), w * 0.6, 72 * m.u, 0.7), color: col(p.ink, "#0B0D12"), whiteSpace: "nowrap" }}>{str(p.button, "BUY NOW")}</span>
					</div>
					<Cursor size={100 * m.u} x={w * 0.62 + mix(160, 0, m.at(0.5, 0.6, E.inOut)) * m.u} y={h * 0.5 + mix(200, 0, m.at(0.5, 0.6, E.inOut)) * m.u} press={press} opacity={1 - m.at(tap + 0.5, 0.4)} />
				</div>
				<div style={{ fontFamily: family, fontWeight: 700, fontSize: 40 * m.u, color: "#fff", textShadow: "0 3px 16px rgba(0,0,0,0.5)", opacity: m.at(0.6, 0.4) }}>{str(p.sub)}</div>
			</Center>
		</AbsoluteFill>
	);
};

/** Chevrons climbing up in a wave above «Swipe up». */
export const MgSwipeUp: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FFFFFF");
	const family = fontOf(p, "Montserrat");
	return (
		<AbsoluteFill style={{ opacity: m.out * m.at(0, 0.4), display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", paddingBottom: m.H * (m.shape === "tall" ? 0.14 : 0.08), gap: 8 * m.u }}>
			{[0, 1, 2].map((i) => {
				const wave = (Math.sin(m.sec * 6 - i * 1.1) + 1) / 2;
				return (
					<svg aria-hidden="true" key={i} width={110 * m.u} height={50 * m.u} viewBox="0 0 44 20" style={{ opacity: mix(0.25, 1, wave), translate: `0 ${-wave * 10 * m.u}px` }}>
						<path d="M4 17L22 4l18 13" fill="none" stroke={a} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				);
			})}
			<div style={{ fontFamily: family, fontWeight: 800, fontSize: 64 * m.u, color: col(p.ink, "#FFFFFF"), textShadow: "0 4px 20px rgba(0,0,0,0.5)", marginTop: 10 * m.u }}>{str(p.text, "Swipe up")}</div>
			<div style={{ fontFamily: family, fontWeight: 500, fontSize: 36 * m.u, color: col(p.ink, "#FFFFFF"), opacity: 0.85, textShadow: "0 3px 14px rgba(0,0,0,0.5)" }}>{str(p.sub)}</div>
		</AbsoluteFill>
	);
};
