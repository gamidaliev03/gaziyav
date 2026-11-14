# Motion graphics and infographics (Remotion layers)

Three ways, cheapest first — all land as editable layers (move, trim, re-time them like any clip):
1. A ready template: `find_content {kind:"motion", query:"lower third"}` → `place {item:"motion:<kind>", at, fields:{…}}`
   (also packs: `kind:"template"`).
2. A kit layer: `motion_layer {kind:"HookTitle"|"LowerThird"|"Counter"|"CTA"|"Plate"|"Card"|"Badge"|"PriceCard"|
   "ProgressBar"|"Finish", props, start, duration}` — e.g. `{kind:"Counter", props:{value:250, suffix:"K", label:"views"}}`.
3. Your own component (charts, data, anything): `motion_layer {code, component, props, start, duration}`.
   It is checked (compile + sandbox), placed, rendered at 3 moments, and the frames come back. On an error nothing
   stays on the timeline and the message names the line and what to write instead: fix and send the whole code again.
   Change it later: `motion_layer {id, code?, props?}`. After placing, look at the frames it returned.

## Rules for your own component (the sandbox)
- Imports only from `react`, `remotion`, `@remotion/shapes`, `@remotion/paths`, `@remotion/noise`, `./kit`.
- Export one function component named like `component`: `export const BarChart = (p) => …`.
- Animate only from `useCurrentFrame()` (+ `interpolate`, `spring`, the kit's `prog`/`env`/`mix`/`E`): no timers, no
  CSS transition/animation, no `Math.random` (use `random("seed")` from remotion), `for` loops only (no while).
- No network, files, storage or globals (window, document, fetch…): data comes in `props` (numbers, strings,
  arrays, objects up to 20 kB); pictures from Media as `props.assets`.
- Props you always get: `dur` (frames of the layer), `accent` (the colour), `words` (speech with times), `t0`.
  `useVideoConfig()` gives `width`, `height`, `fps` of the project (1080×1920 for 9:16). Scale everything by
  `u = width / 1080`.
- Fonts: `font("Unbounded" | "Montserrat" | "Manrope" | "Rubik" | "Onest" | "GolosText" | "PlayfairDisplay")` from
  `./kit` (Latin + Cyrillic); emoji: `emojiFont()`.
- Safe zone 9:16: keep text between y 220 and 1500 (of 1920) and x 60…940; captions sit around y 1200–1400.
- Enter ≤ 0.4 s (12 frames), hold to read (≥ 1 s per 3 words), exit faster than the entrance.

## Pattern 1 — lower third
```tsx
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { E, env, font, prog } from "./kit";

export const NameTag = (p: { name: string; role?: string; accent?: string; dur: number }) => {
	const f = useCurrentFrame();
	const { width, height } = useVideoConfig();
	const u = width / 1080;
	const x = interpolate(prog(f, 0, 16, E.out), [0, 1], [-60 * u, 0]);
	return (
		<AbsoluteFill>
			<div style={{ position: "absolute", left: 64 * u, top: height * 0.68, opacity: env(f, 0, p.dur, 14, 10), translate: `${x}px 0` }}>
				<div style={{ background: p.accent || "#FFD23F", height: 8 * u, width: 140 * u * prog(f, 4, 14), marginBottom: 12 * u }} />
				<div style={{ fontFamily: font("Montserrat"), fontWeight: 800, fontSize: 64 * u, color: "#fff", textShadow: "0 4px 24px rgba(0,0,0,.5)" }}>{p.name}</div>
				{p.role ? <div style={{ fontFamily: font("Manrope"), fontWeight: 600, fontSize: 36 * u, color: "rgba(255,255,255,.85)" }}>{p.role}</div> : null}
			</div>
		</AbsoluteFill>
	);
};
```

## Pattern 2 — animated number (counter)
```tsx
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { E, env, font, mix, prog } from "./kit";

export const CountUp = (p: { value: number; prefix?: string; suffix?: string; label?: string; accent?: string; dur: number }) => {
	const f = useCurrentFrame();
	const { width } = useVideoConfig();
	const u = width / 1080;
	const run = Math.min(45, Math.round(p.dur * 0.6));
	const n = Math.round(mix(0, Number(p.value) || 0, prog(f, 4, run, E.outQuart)));
	const punch = 1 + 0.08 * Math.sin(Math.PI * prog(f, run + 4, 10));
	return (
		<AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: env(f, 0, p.dur, 8, 8) }}>
			<div style={{ fontFamily: font("Unbounded"), fontWeight: 900, fontSize: 180 * u, color: p.accent || "#FFD23F", scale: String(punch) }}>
				{p.prefix ?? ""}{n.toLocaleString("en-US")}{p.suffix ?? ""}
			</div>
			{p.label ? <div style={{ fontFamily: font("Manrope"), fontWeight: 700, fontSize: 48 * u, color: "#fff" }}>{p.label}</div> : null}
		</AbsoluteFill>
	);
};
```

## Pattern 3 — bar chart from data (`props: {title, data:[{label, value}]}`)
```tsx
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { E, env, font, prog } from "./kit";

export const BarChart = (p: { title?: string; data: Array<{ label: string; value: number }>; accent?: string; dur: number }) => {
	const f = useCurrentFrame();
	const { width } = useVideoConfig();
	const u = width / 1080;
	const data = Array.isArray(p.data) ? p.data.slice(0, 8) : [];
	const max = Math.max(1, ...data.map((d) => Number(d.value) || 0));
	return (
		<AbsoluteFill style={{ padding: `${300 * u}px ${80 * u}px`, opacity: env(f, 0, p.dur, 10, 10) }}>
			{p.title ? <div style={{ fontFamily: font("Montserrat"), fontWeight: 800, fontSize: 60 * u, color: "#fff", marginBottom: 40 * u }}>{p.title}</div> : null}
			{data.map((d, i) => {
				const g = prog(f, 8 + i * 5, 24, E.out);
				return (
					<div key={i} style={{ display: "flex", alignItems: "center", gap: 20 * u, marginBottom: 22 * u }}>
						<div style={{ width: 220 * u, fontFamily: font("Manrope"), fontWeight: 700, fontSize: 34 * u, color: "rgba(255,255,255,.9)" }}>{d.label}</div>
						<div style={{ height: 54 * u, width: ((600 * u * (Number(d.value) || 0)) / max) * g, background: p.accent || "#FFD23F", borderRadius: 12 * u }} />
						<div style={{ fontFamily: font("Unbounded"), fontWeight: 800, fontSize: 34 * u, color: "#fff", opacity: g }}>{Math.round((Number(d.value) || 0) * g)}</div>
					</div>
				);
			})}
		</AbsoluteFill>
	);
};
```
A line chart: the same data as an SVG `<polyline>` whose `strokeDasharray`/`strokeDashoffset` follow
`prog(f, 6, 30)` (or `evolvePath` from `@remotion/paths`).

## Pattern 4 — kinetic title (words pop in one by one)
```tsx
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { E, font, prog } from "./kit";

export const KineticTitle = (p: { text: string; accent?: string; dur: number }) => {
	const f = useCurrentFrame();
	const { width } = useVideoConfig();
	const u = width / 1080;
	const words = String(p.text || "").split(/\s+/).filter(Boolean).slice(0, 8);
	const out = 1 - prog(f, p.dur - 8, 8, E.in);
	return (
		<AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: 80 * u }}>
			<div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: `${10 * u}px ${24 * u}px` }}>
				{words.map((w, i) => {
					const t = prog(f, i * 4, 12, E.back);
					return (
						<span key={i} style={{ fontFamily: font("Unbounded"), fontWeight: 900, fontSize: 120 * u, lineHeight: 1.05, color: i % 3 === 1 ? p.accent || "#FFD23F" : "#fff", opacity: t * out, translate: `0 ${(1 - t) * 60 * u}px`, scale: String(0.8 + 0.2 * t), textShadow: "0 6px 30px rgba(0,0,0,.45)" }}>
							{w}
						</span>
					);
				})}
			</div>
		</AbsoluteFill>
	);
};
```

## Camera moves on real footage
`edit {op:"camera", id, move}`: `push_in`, `pull_out`, `pan_left`, `pan_right`, `tilt_up`, `tilt_down`, `ken_burns`
(stills), `shake` (impact), `punch_in` (a cut-in that hides a jump cut). `amount` 0.05–0.15 looks natural. For AI video
prompts use the same words: "slow push-in", "pan left", "handheld shake", "dolly zoom", "orbit around the subject".
