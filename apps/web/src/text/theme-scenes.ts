// The backdrops a text preset's tile is shown on, so the user sees at a glance whether it is for them: a speaker
// plate over an interview, a price tag on a product, a wedding title at a wedding, a game title on a game. Each
// scene is a photo (public/text-scenes, Unsplash, sources.json) loaded when a tile first scrolls into view; until it
// arrives, or if it can't, the scene is drawn here on a canvas.
import { onMemoryPressure } from "@/platform/memory-pressure";

export const THEMES = [
	{ id: "gaming", label: "Gaming" },
	{ id: "wedding", label: "Wedding" },
	{ id: "travel", label: "Travel" },
	{ id: "food", label: "Food" },
	{ id: "fitness", label: "Fitness" },
	{ id: "business", label: "Business" },
	{ id: "music", label: "Music" },
	{ id: "beauty", label: "Beauty" },
	{ id: "tech", label: "Tech" },
	{ id: "kids", label: "Kids" },
	{ id: "education", label: "Education" },
	{ id: "news", label: "News" },
	{ id: "sports", label: "Sports" },
	{ id: "fashion", label: "Fashion" },
	{ id: "realEstate", label: "Real estate" },
] as const;

export type Theme = (typeof THEMES)[number]["id"];
/** A theme's own scene, or one of the group backdrops (film still, product shot, stories, night city, interview). */
export type Scene = Theme | "film" | "product" | "stories" | "nightCity" | "interview";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function rng(seed: number) {
	let s = seed >>> 0 || 1;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

function fillGradient(ctx: Ctx, w: number, h: number, stops: [number, string][], angle: "v" | "h" | "d" = "v") {
	const g = angle === "v" ? ctx.createLinearGradient(0, 0, 0, h) : angle === "h" ? ctx.createLinearGradient(0, 0, w, 0) : ctx.createLinearGradient(0, 0, w, h);
	for (const [at, color] of stops) g.addColorStop(at, color);
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, w, h);
}

function glow(ctx: Ctx, x: number, y: number, r: number, color: string, alpha = 1) {
	const g = ctx.createRadialGradient(x, y, 0, x, y, r);
	g.addColorStop(0, color);
	g.addColorStop(1, "rgba(0,0,0,0)");
	ctx.save();
	ctx.globalAlpha = alpha;
	ctx.fillStyle = g;
	ctx.fillRect(x - r, y - r, r * 2, r * 2);
	ctx.restore();
}

/** Out-of-focus lights. */
function bokeh(ctx: Ctx, w: number, h: number, seed: number, colors: string[], count: number, [r0, r1]: [number, number], region = { top: 0, bottom: 1 }, alpha = 0.5) {
	const rand = rng(seed);
	ctx.save();
	for (let i = 0; i < count; i++) {
		const r = (r0 + rand() * (r1 - r0)) * w;
		const x = rand() * w;
		const y = (region.top + rand() * (region.bottom - region.top)) * h;
		ctx.globalAlpha = alpha * (0.35 + rand() * 0.65);
		const g = ctx.createRadialGradient(x, y, r * 0.15, x, y, r);
		const color = colors[i % colors.length];
		g.addColorStop(0, color);
		g.addColorStop(0.7, color);
		g.addColorStop(1, "rgba(0,0,0,0)");
		ctx.fillStyle = g;
		ctx.beginPath();
		ctx.arc(x, y, r, 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.restore();
}

function vignette(ctx: Ctx, w: number, h: number, strength = 0.55) {
	const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
	g.addColorStop(0, "rgba(0,0,0,0)");
	g.addColorStop(1, `rgba(0,0,0,${strength})`);
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, w, h);
}

function grain(ctx: Ctx, w: number, h: number, amount: number, seed: number) {
	const rand = rng(seed);
	ctx.save();
	for (let i = 0; i < (w * h) / 18; i++) {
		ctx.globalAlpha = rand() * amount;
		ctx.fillStyle = rand() > 0.5 ? "#ffffff" : "#000000";
		ctx.fillRect(rand() * w, rand() * h, 1, 1);
	}
	ctx.restore();
}

function blurred(ctx: Ctx, px: number, draw: () => void) {
	ctx.save();
	ctx.filter = `blur(${px}px)`;
	draw();
	ctx.restore();
}

/** A person from the shoulders up (a silhouette, out of focus). */
function person(ctx: Ctx, cx: number, base: number, size: number, color: string) {
	ctx.fillStyle = color;
	ctx.beginPath();
	ctx.ellipse(cx, base - size * 1.25, size * 0.36, size * 0.44, 0, 0, Math.PI * 2);
	ctx.fill();
	ctx.beginPath();
	ctx.moveTo(cx - size * 0.95, base + size * 0.2);
	ctx.quadraticCurveTo(cx - size * 0.9, base - size * 0.62, cx - size * 0.2, base - size * 0.72);
	ctx.lineTo(cx + size * 0.2, base - size * 0.72);
	ctx.quadraticCurveTo(cx + size * 0.9, base - size * 0.62, cx + size * 0.95, base + size * 0.2);
	ctx.closePath();
	ctx.fill();
}

const SCENES: Record<Scene, (ctx: Ctx, w: number, h: number) => void> = {
	nightCity(ctx, w, h) {
		fillGradient(ctx, w, h, [[0, "#070418"], [0.55, "#1f0b3d"], [0.78, "#4a1258"], [1, "#12061f"]]);
		glow(ctx, w * 0.5, h * 0.72, w * 0.7, "rgba(255,45,149,0.35)");
		const rand = rng(7);
		let x = -w * 0.05;
		while (x < w * 1.05) {
			const bw = w * (0.07 + rand() * 0.1);
			const bh = h * (0.18 + rand() * 0.42);
			const top = h * 0.78 - bh;
			ctx.fillStyle = rand() > 0.5 ? "#0d0920" : "#140c2b";
			ctx.fillRect(x, top, bw, bh);
			for (let wy = top + h * 0.02; wy < h * 0.76; wy += h * 0.028) {
				for (let wx = x + bw * 0.15; wx < x + bw * 0.85; wx += bw * 0.22) {
					if (rand() > 0.55) continue;
					ctx.fillStyle = rand() > 0.6 ? "rgba(0,229,255,0.75)" : "rgba(255,200,120,0.8)";
					ctx.fillRect(wx, wy, bw * 0.1, h * 0.012);
				}
			}
			x += bw + w * 0.01;
		}
		// the wet street mirrors the signs
		fillGradient(ctx, w, h, [[0, "rgba(0,0,0,0)"], [0.78, "rgba(0,0,0,0)"], [0.8, "rgba(25,8,40,0.9)"], [1, "#05020c"]]);
		ctx.save();
		ctx.globalAlpha = 0.45;
		for (let i = 0; i < 14; i++) {
			ctx.fillStyle = i % 2 ? "#ff2d95" : "#00e5ff";
			ctx.fillRect(rand() * w, h * 0.8, w * 0.01, h * (0.06 + rand() * 0.14));
		}
		ctx.restore();
		blurred(ctx, w * 0.012, () => bokeh(ctx, w, h, 11, ["#ff2d95", "#00e5ff", "#ffb347"], 16, [0.03, 0.08], { top: 0.55, bottom: 1 }, 0.55));
		vignette(ctx, w, h, 0.6);
	},
	film(ctx, w, h) {
		fillGradient(ctx, w, h, [[0, "#0b2730"], [0.45, "#1d4a52"], [0.68, "#d77a43"], [0.78, "#f0b06a"], [1, "#2a160c"]]);
		glow(ctx, w * 0.62, h * 0.68, w * 0.45, "rgba(255,190,120,0.9)", 0.8);
		// hills and a lone figure against the low sun
		ctx.fillStyle = "#120a07";
		ctx.beginPath();
		ctx.moveTo(0, h * 0.8);
		ctx.quadraticCurveTo(w * 0.3, h * 0.7, w * 0.55, h * 0.76);
		ctx.quadraticCurveTo(w * 0.8, h * 0.82, w, h * 0.74);
		ctx.lineTo(w, h);
		ctx.lineTo(0, h);
		ctx.fill();
		person(ctx, w * 0.3, h * 0.76, h * 0.08, "#120a07");
		ctx.save();
		ctx.globalAlpha = 0.28;
		ctx.fillStyle = "#ff9a4d";
		ctx.translate(w * 0.85, 0);
		ctx.rotate(0.35);
		ctx.fillRect(0, 0, w * 0.12, h * 1.4);
		ctx.restore();
		grain(ctx, w, h, 0.18, 3);
		vignette(ctx, w, h, 0.5);
		ctx.fillStyle = "#000000";
		ctx.fillRect(0, 0, w, h * 0.11);
		ctx.fillRect(0, h * 0.89, w, h * 0.11);
	},
	product(ctx, w, h) {
		fillGradient(ctx, w, h, [[0, "#ffd9b8"], [0.62, "#f6b48f"], [0.63, "#e79b78"], [1, "#d98463"]]);
		glow(ctx, w * 0.5, h * 0.35, w * 0.6, "rgba(255,255,255,0.75)");
		ctx.save();
		ctx.fillStyle = "rgba(90,40,20,0.28)";
		ctx.beginPath();
		ctx.ellipse(w * 0.5, h * 0.83, w * 0.26, h * 0.04, 0, 0, Math.PI * 2);
		ctx.fill();
		// a podium and a bottle on it
		ctx.fillStyle = "#fff4ec";
		ctx.fillRect(w * 0.26, h * 0.66, w * 0.48, h * 0.17);
		ctx.beginPath();
		ctx.ellipse(w * 0.5, h * 0.66, w * 0.24, h * 0.035, 0, 0, Math.PI * 2);
		ctx.fill();
		const bottle = ctx.createLinearGradient(w * 0.41, 0, w * 0.59, 0);
		bottle.addColorStop(0, "#c2465c");
		bottle.addColorStop(0.35, "#ff7a90");
		bottle.addColorStop(0.5, "#ffd1da");
		bottle.addColorStop(0.65, "#ff7a90");
		bottle.addColorStop(1, "#a83249");
		ctx.fillStyle = bottle;
		ctx.beginPath();
		ctx.roundRect(w * 0.41, h * 0.36, w * 0.18, h * 0.3, w * 0.04);
		ctx.fill();
		ctx.fillStyle = "#2b2b30";
		ctx.beginPath();
		ctx.roundRect(w * 0.445, h * 0.29, w * 0.11, h * 0.08, w * 0.015);
		ctx.fill();
		ctx.fillStyle = "rgba(255,255,255,0.75)";
		ctx.fillRect(w * 0.43, h * 0.47, w * 0.14, h * 0.05);
		ctx.restore();
		vignette(ctx, w, h, 0.25);
	},
	stories(ctx, w, h) {
		fillGradient(ctx, w, h, [[0, "#ff9a8b"], [0.5, "#ff6a88"], [1, "#a14cff"]], "d");
		blurred(ctx, w * 0.04, () => bokeh(ctx, w, h, 5, ["#ffe29a", "#ffffff", "#ff4ecd"], 9, [0.12, 0.26], { top: 0, bottom: 1 }, 0.5));
		ctx.save();
		// the stories bar, the account and the reply row
		for (let i = 0; i < 4; i++) {
			ctx.fillStyle = i < 2 ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.4)";
			ctx.fillRect(w * (0.05 + i * 0.228), h * 0.04, w * 0.21, h * 0.008);
		}
		ctx.fillStyle = "#ffffff";
		ctx.beginPath();
		ctx.arc(w * 0.1, h * 0.1, w * 0.035, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = "rgba(255,255,255,0.85)";
		ctx.fillRect(w * 0.16, h * 0.09, w * 0.22, h * 0.018);
		ctx.strokeStyle = "rgba(255,255,255,0.8)";
		ctx.lineWidth = Math.max(1, w * 0.006);
		ctx.beginPath();
		ctx.roundRect(w * 0.05, h * 0.88, w * 0.68, h * 0.065, h * 0.032);
		ctx.stroke();
		ctx.fillStyle = "rgba(255,255,255,0.9)";
		ctx.beginPath();
		ctx.arc(w * 0.83, h * 0.912, w * 0.03, 0, Math.PI * 2);
		ctx.arc(w * 0.92, h * 0.912, w * 0.03, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
	},
	interview(ctx, w, h) {
		fillGradient(ctx, w, h, [[0, "#1a120d"], [0.6, "#3a2618"], [1, "#120c08"]]);
		blurred(ctx, w * 0.03, () => {
			bokeh(ctx, w, h, 21, ["#ffb35c", "#ffd59e", "#ff8a3d"], 14, [0.04, 0.1], { top: 0.05, bottom: 0.6 }, 0.6);
			ctx.fillStyle = "#4b3424";
			ctx.fillRect(w * 0.06, h * 0.12, w * 0.2, h * 0.5);
			person(ctx, w * 0.6, h * 0.92, h * 0.33, "#0c0806");
		});
		glow(ctx, w * 0.72, h * 0.35, w * 0.35, "rgba(255,170,90,0.25)");
		// the podcast mic in the foreground
		ctx.save();
		ctx.fillStyle = "#08080a";
		ctx.beginPath();
		ctx.roundRect(w * 0.17, h * 0.52, w * 0.14, h * 0.24, w * 0.07);
		ctx.fill();
		ctx.fillRect(w * 0.225, h * 0.76, w * 0.03, h * 0.24);
		ctx.strokeStyle = "rgba(255,190,120,0.45)";
		ctx.lineWidth = Math.max(1, w * 0.008);
		ctx.beginPath();
		ctx.roundRect(w * 0.17, h * 0.52, w * 0.14, h * 0.24, w * 0.07);
		ctx.stroke();
		ctx.restore();
		vignette(ctx, w, h, 0.55);
	},
	wedding(ctx, w, h) {
		fillGradient(ctx, w, h, [[0, "#fff6ef"], [0.5, "#f9dcd6"], [1, "#e9b8b0"]]);
		blurred(ctx, w * 0.02, () => bokeh(ctx, w, h, 9, ["#ffe7a8", "#ffffff", "#f5c27a"], 18, [0.03, 0.09], { top: 0, bottom: 1 }, 0.7));
		ctx.save();
		ctx.strokeStyle = "rgba(201,152,72,0.9)";
		ctx.lineWidth = Math.max(1.5, w * 0.018);
		for (const dx of [-0.06, 0.06]) {
			ctx.beginPath();
			ctx.ellipse(w * (0.5 + dx), h * 0.8, w * 0.1, w * 0.1, 0, 0, Math.PI * 2);
			ctx.stroke();
		}
		ctx.fillStyle = "rgba(255,255,255,0.95)";
		ctx.beginPath();
		ctx.arc(w * 0.56, h * 0.7, w * 0.025, 0, Math.PI * 2);
		ctx.fill();
		const rand = rng(4);
		for (let i = 0; i < 9; i++) {
			ctx.fillStyle = i % 2 ? "rgba(240,150,160,0.75)" : "rgba(255,200,205,0.85)";
			ctx.beginPath();
			ctx.ellipse(rand() * w, rand() * h * 0.5, w * 0.03, w * 0.016, rand() * 3, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.restore();
		vignette(ctx, w, h, 0.22);
	},
	gaming(ctx, w, h) {
		fillGradient(ctx, w, h, [[0, "#06040f"], [0.55, "#1a0838"], [0.6, "#ff2d95"], [0.62, "#2a0b4a"], [1, "#06040f"]]);
		glow(ctx, w * 0.5, h * 0.6, w * 0.55, "rgba(255,45,149,0.45)");
		ctx.save();
		ctx.strokeStyle = "rgba(0,229,255,0.75)";
		ctx.lineWidth = Math.max(1, w * 0.005);
		for (let i = -10; i <= 10; i++) {
			ctx.beginPath();
			ctx.moveTo(w * 0.5 + i * w * 0.03, h * 0.61);
			ctx.lineTo(w * 0.5 + i * w * 0.18, h);
			ctx.stroke();
		}
		for (let j = 1; j < 9; j++) {
			const y = h * 0.61 + (h * 0.39 * j * j) / 64;
			ctx.beginPath();
			ctx.moveTo(0, y);
			ctx.lineTo(w, y);
			ctx.stroke();
		}
		const rand = rng(8);
		for (let i = 0; i < 40; i++) {
			ctx.fillStyle = `rgba(255,255,255,${0.3 + rand() * 0.7})`;
			const s = Math.max(1, w * 0.006 * rand());
			ctx.fillRect(rand() * w, rand() * h * 0.55, s, s);
		}
		// a gamepad
		ctx.fillStyle = "#0a0614";
		ctx.strokeStyle = "rgba(0,229,255,0.9)";
		ctx.lineWidth = Math.max(1, w * 0.008);
		ctx.beginPath();
		ctx.roundRect(w * 0.36, h * 0.38, w * 0.28, h * 0.13, h * 0.06);
		ctx.fill();
		ctx.stroke();
		ctx.restore();
		vignette(ctx, w, h, 0.5);
	},
	travel(ctx, w, h) {
		fillGradient(ctx, w, h, [[0, "#2c3e70"], [0.45, "#ff7e5f"], [0.62, "#feb47b"], [1, "#feb47b"]]);
		glow(ctx, w * 0.5, h * 0.58, w * 0.22, "rgba(255,240,200,1)");
		ctx.fillStyle = "#fff3d0";
		ctx.beginPath();
		ctx.arc(w * 0.5, h * 0.58, w * 0.09, 0, Math.PI * 2);
		ctx.fill();
		for (const [color, base, amp, seed] of [
			["#7a3b5c", 0.66, 0.12, 1],
			["#4f2547", 0.74, 0.1, 2],
			["#2a1530", 0.84, 0.08, 3],
		] as const) {
			const rand = rng(seed);
			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.moveTo(0, h);
			for (let x = 0; x <= w + 1; x += w / 8) ctx.lineTo(x, h * (base - amp * rand()));
			ctx.lineTo(w, h);
			ctx.fill();
		}
		ctx.strokeStyle = "rgba(255,255,255,0.7)";
		ctx.lineWidth = Math.max(1, w * 0.006);
		ctx.setLineDash([w * 0.03, w * 0.02]);
		ctx.beginPath();
		ctx.moveTo(w * 0.05, h * 0.3);
		ctx.quadraticCurveTo(w * 0.45, h * 0.12, w * 0.85, h * 0.22);
		ctx.stroke();
		ctx.setLineDash([]);
		vignette(ctx, w, h, 0.3);
	},
	food(ctx, w, h) {
		fillGradient(ctx, w, h, [[0, "#6b3f22"], [1, "#3e2412"]], "d");
		const rand = rng(12);
		ctx.save();
		ctx.globalAlpha = 0.18;
		for (let i = 0; i < 12; i++) {
			ctx.fillStyle = rand() > 0.5 ? "#2a160a" : "#8a5530";
			ctx.fillRect(0, rand() * h, w, h * 0.012);
		}
		ctx.restore();
		ctx.fillStyle = "rgba(0,0,0,0.35)";
		ctx.beginPath();
		ctx.arc(w * 0.53, h * 0.56, w * 0.36, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = "#f7f3ee";
		ctx.beginPath();
		ctx.arc(w * 0.5, h * 0.52, w * 0.35, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = "#e8e1d8";
		ctx.beginPath();
		ctx.arc(w * 0.5, h * 0.52, w * 0.26, 0, Math.PI * 2);
		ctx.fill();
		for (let i = 0; i < 26; i++) {
			const a = rand() * Math.PI * 2;
			const r = rand() * w * 0.2;
			ctx.fillStyle = ["#5aa832", "#7cc444", "#e2402a", "#f2b632", "#3f8a2a"][i % 5];
			ctx.beginPath();
			ctx.ellipse(w * 0.5 + Math.cos(a) * r, h * 0.52 + Math.sin(a) * r, w * (0.03 + rand() * 0.03), w * 0.022, rand() * 3, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.fillStyle = "#c9c2b8";
		ctx.fillRect(w * 0.9, h * 0.15, w * 0.03, h * 0.7);
		vignette(ctx, w, h, 0.45);
	},
	fitness(ctx, w, h) {
		fillGradient(ctx, w, h, [[0, "#0b0b0d"], [1, "#1c1c22"]]);
		ctx.save();
		ctx.globalAlpha = 0.5;
		const cone = ctx.createLinearGradient(0, 0, 0, h);
		cone.addColorStop(0, "rgba(255,255,255,0.5)");
		cone.addColorStop(1, "rgba(255,255,255,0)");
		ctx.fillStyle = cone;
		ctx.beginPath();
		ctx.moveTo(w * 0.42, 0);
		ctx.lineTo(w * 0.58, 0);
		ctx.lineTo(w * 0.85, h);
		ctx.lineTo(w * 0.15, h);
		ctx.fill();
		ctx.restore();
		glow(ctx, w * 0.15, h * 0.85, w * 0.35, "rgba(255,80,40,0.55)");
		glow(ctx, w * 0.9, h * 0.2, w * 0.3, "rgba(255,120,40,0.4)");
		// a dumbbell on the floor
		ctx.fillStyle = "#050506";
		ctx.fillRect(w * 0.3, h * 0.76, w * 0.4, h * 0.03);
		for (const x of [0.27, 0.66]) {
			ctx.beginPath();
			ctx.roundRect(w * x, h * 0.69, w * 0.07, h * 0.17, w * 0.015);
			ctx.fill();
		}
		ctx.strokeStyle = "rgba(255,120,60,0.6)";
		ctx.lineWidth = Math.max(1, w * 0.006);
		ctx.strokeRect(w * 0.27, h * 0.69, w * 0.07, h * 0.17);
		ctx.strokeRect(w * 0.66, h * 0.69, w * 0.07, h * 0.17);
		vignette(ctx, w, h, 0.5);
	},
	business(ctx, w, h) {
		fillGradient(ctx, w, h, [[0, "#1d2b3c"], [1, "#3a4f68"]]);
		blurred(ctx, w * 0.02, () => {
			ctx.fillStyle = "rgba(200,225,255,0.18)";
			for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) ctx.fillRect(w * (0.08 + i * 0.22), h * (0.08 + j * 0.16), w * 0.18, h * 0.13);
		});
		ctx.save();
		const bars = [0.18, 0.27, 0.24, 0.36, 0.46];
		bars.forEach((v, i) => {
			const g = ctx.createLinearGradient(0, h * (0.92 - v), 0, h * 0.92);
			g.addColorStop(0, "rgba(61,139,255,0.9)");
			g.addColorStop(1, "rgba(61,139,255,0.2)");
			ctx.fillStyle = g;
			ctx.fillRect(w * (0.12 + i * 0.16), h * (0.92 - v), w * 0.1, h * v);
		});
		ctx.strokeStyle = "#7fffd4";
		ctx.lineWidth = Math.max(1.5, w * 0.012);
		ctx.beginPath();
		bars.forEach((v, i) => {
			const x = w * (0.17 + i * 0.16);
			const y = h * (0.88 - v);
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		});
		ctx.stroke();
		ctx.restore();
		vignette(ctx, w, h, 0.4);
	},
	music(ctx, w, h) {
		fillGradient(ctx, w, h, [[0, "#05030a"], [1, "#160822"]]);
		ctx.save();
		ctx.globalCompositeOperation = "lighter";
		for (const [x, color, turn] of [
			[0.2, "rgba(255,45,149,0.32)", 0.35],
			[0.5, "rgba(80,120,255,0.32)", 0],
			[0.8, "rgba(0,229,255,0.3)", -0.35],
		] as const) {
			ctx.save();
			ctx.translate(w * x, 0);
			ctx.rotate(turn);
			const g = ctx.createLinearGradient(0, 0, 0, h);
			g.addColorStop(0, color);
			g.addColorStop(1, "rgba(0,0,0,0)");
			ctx.fillStyle = g;
			ctx.beginPath();
			ctx.moveTo(-w * 0.02, 0);
			ctx.lineTo(w * 0.02, 0);
			ctx.lineTo(w * 0.22, h * 1.1);
			ctx.lineTo(-w * 0.22, h * 1.1);
			ctx.fill();
			ctx.restore();
		}
		ctx.restore();
		// the crowd, hands up
		ctx.fillStyle = "#020104";
		const rand = rng(6);
		ctx.beginPath();
		ctx.moveTo(0, h);
		for (let x = 0; x <= w; x += w / 18) {
			const y = h * (0.82 + rand() * 0.06);
			ctx.lineTo(x, y);
			if (rand() > 0.6) {
				ctx.lineTo(x + w * 0.01, y - h * 0.12);
				ctx.lineTo(x + w * 0.025, y);
			}
		}
		ctx.lineTo(w, h);
		ctx.fill();
		vignette(ctx, w, h, 0.4);
	},
	beauty(ctx, w, h) {
		fillGradient(ctx, w, h, [[0, "#ffe4ec"], [0.5, "#ffd2dc"], [1, "#f6b6c8"]], "d");
		blurred(ctx, w * 0.03, () => bokeh(ctx, w, h, 14, ["#ffffff", "#ffc4d6", "#ffe9b3"], 10, [0.08, 0.2], { top: 0, bottom: 1 }, 0.7));
		ctx.save();
		// a lipstick and a compact
		ctx.translate(w * 0.68, h * 0.62);
		ctx.rotate(-0.4);
		ctx.fillStyle = "#c21f4f";
		ctx.beginPath();
		ctx.moveTo(-w * 0.04, -h * 0.1);
		ctx.lineTo(w * 0.04, -h * 0.14);
		ctx.lineTo(w * 0.04, h * 0.02);
		ctx.lineTo(-w * 0.04, h * 0.02);
		ctx.fill();
		ctx.fillStyle = "#e6c07a";
		ctx.fillRect(-w * 0.05, h * 0.02, w * 0.1, h * 0.18);
		ctx.restore();
		ctx.fillStyle = "#f0d39a";
		ctx.beginPath();
		ctx.arc(w * 0.3, h * 0.75, w * 0.14, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = "#f6a5b8";
		ctx.beginPath();
		ctx.arc(w * 0.3, h * 0.75, w * 0.11, 0, Math.PI * 2);
		ctx.fill();
		vignette(ctx, w, h, 0.15);
	},
	tech(ctx, w, h) {
		fillGradient(ctx, w, h, [[0, "#020b1f"], [1, "#06306a"]], "d");
		const rand = rng(17);
		ctx.save();
		ctx.strokeStyle = "rgba(0,229,255,0.55)";
		ctx.fillStyle = "rgba(0,229,255,0.9)";
		ctx.lineWidth = Math.max(1, w * 0.005);
		ctx.shadowColor = "#00e5ff";
		ctx.shadowBlur = w * 0.02;
		for (let i = 0; i < 16; i++) {
			let x = rand() * w;
			let y = rand() * h;
			ctx.beginPath();
			ctx.moveTo(x, y);
			for (let k = 0; k < 3; k++) {
				if (rand() > 0.5) x += (rand() - 0.5) * w * 0.4;
				else y += (rand() - 0.5) * h * 0.4;
				ctx.lineTo(x, y);
			}
			ctx.stroke();
			ctx.beginPath();
			ctx.arc(x, y, w * 0.012, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.restore();
		glow(ctx, w * 0.5, h * 0.5, w * 0.5, "rgba(0,120,255,0.35)");
		vignette(ctx, w, h, 0.5);
	},
	kids(ctx, w, h) {
		fillGradient(ctx, w, h, [[0, "#7fd3ff"], [1, "#c6f0ff"]]);
		ctx.fillStyle = "#ffffff";
		for (const [x, y, s] of [
			[0.2, 0.2, 1],
			[0.75, 0.13, 0.8],
		] as const) {
			for (const [dx, dy, r] of [
				[0, 0, 0.07],
				[0.06, 0.01, 0.055],
				[-0.06, 0.015, 0.05],
			] as const) {
				ctx.beginPath();
				ctx.arc(w * (x + dx * s), h * (y + dy), w * r * s, 0, Math.PI * 2);
				ctx.fill();
			}
		}
		for (const [x, color] of [
			[0.18, "#ff5a7a"],
			[0.32, "#ffd23f"],
			[0.72, "#5ce1a6"],
			[0.86, "#8f7cff"],
		] as const) {
			ctx.strokeStyle = "rgba(60,60,60,0.5)";
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(w * x, h * 0.62);
			ctx.quadraticCurveTo(w * (x + 0.03), h * 0.8, w * x, h);
			ctx.stroke();
			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.ellipse(w * x, h * 0.55, w * 0.065, h * 0.08, 0, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = "rgba(255,255,255,0.5)";
			ctx.beginPath();
			ctx.ellipse(w * (x - 0.02), h * 0.52, w * 0.015, h * 0.025, -0.4, 0, Math.PI * 2);
			ctx.fill();
		}
		const rand = rng(31);
		for (let i = 0; i < 40; i++) {
			ctx.fillStyle = ["#ff5a7a", "#ffd23f", "#5ce1a6", "#8f7cff", "#ff9f43"][i % 5];
			ctx.save();
			ctx.translate(rand() * w, rand() * h);
			ctx.rotate(rand() * 3);
			ctx.fillRect(0, 0, w * 0.018, w * 0.008);
			ctx.restore();
		}
	},
	education(ctx, w, h) {
		fillGradient(ctx, w, h, [[0, "#1f3b2c"], [1, "#16291f"]]);
		const rand = rng(23);
		ctx.save();
		ctx.globalAlpha = 0.06;
		for (let i = 0; i < 30; i++) {
			ctx.fillStyle = "#ffffff";
			ctx.fillRect(rand() * w, rand() * h, w * 0.2 * rand(), h * 0.01);
		}
		ctx.restore();
		ctx.save();
		ctx.fillStyle = "rgba(255,255,255,0.55)";
		ctx.font = `${Math.round(w * 0.09)}px "Caveat", "Neucha", cursive`;
		ctx.fillText("a² + b² = c²", w * 0.08, h * 0.22);
		ctx.font = `${Math.round(w * 0.07)}px "Caveat", "Neucha", cursive`;
		ctx.fillText("E = mc²", w * 0.6, h * 0.36);
		ctx.strokeStyle = "rgba(255,255,255,0.45)";
		ctx.lineWidth = Math.max(1, w * 0.007);
		ctx.beginPath();
		ctx.moveTo(w * 0.12, h * 0.62);
		ctx.lineTo(w * 0.3, h * 0.42);
		ctx.lineTo(w * 0.42, h * 0.62);
		ctx.closePath();
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(w * 0.75, h * 0.58, w * 0.08, 0, Math.PI * 2);
		ctx.stroke();
		ctx.restore();
		ctx.fillStyle = "#6b4a2e";
		ctx.fillRect(0, h * 0.9, w, h * 0.1);
		ctx.fillStyle = "#f2f2f2";
		ctx.fillRect(w * 0.2, h * 0.88, w * 0.08, h * 0.02);
		vignette(ctx, w, h, 0.45);
	},
	news(ctx, w, h) {
		fillGradient(ctx, w, h, [[0, "#04122b"], [1, "#0b3a7a"]], "d");
		ctx.save();
		ctx.strokeStyle = "rgba(120,190,255,0.35)";
		ctx.lineWidth = Math.max(1, w * 0.005);
		const cx = w * 0.62;
		const cy = h * 0.45;
		const r = w * 0.32;
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.stroke();
		for (const k of [0.35, 0.7]) {
			ctx.beginPath();
			ctx.ellipse(cx, cy, r * k, r, 0, 0, Math.PI * 2);
			ctx.stroke();
			ctx.beginPath();
			ctx.ellipse(cx, cy, r, r * k, 0, 0, Math.PI * 2);
			ctx.stroke();
		}
		ctx.restore();
		glow(ctx, w * 0.2, h * 0.2, w * 0.4, "rgba(80,160,255,0.35)");
		ctx.fillStyle = "#d7262e";
		ctx.fillRect(0, h * 0.82, w, h * 0.07);
		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, h * 0.89, w, h * 0.05);
		ctx.fillStyle = "rgba(255,255,255,0.9)";
		ctx.fillRect(w * 0.05, h * 0.845, w * 0.16, h * 0.025);
		vignette(ctx, w, h, 0.35);
	},
	sports(ctx, w, h) {
		fillGradient(ctx, w, h, [[0, "#050a14"], [0.5, "#0f1d2e"], [0.55, "#1d6b2f"], [1, "#0f4a1f"]]);
		ctx.save();
		ctx.globalAlpha = 0.25;
		for (let i = 0; i < 7; i++) {
			ctx.fillStyle = i % 2 ? "#2b8a44" : "#196b30";
			ctx.beginPath();
			ctx.moveTo(w * (i / 7), h * 0.55);
			ctx.lineTo(w * ((i + 1) / 7), h * 0.55);
			ctx.lineTo(w * ((i + 1) / 7 + (i - 3) * 0.12), h);
			ctx.lineTo(w * (i / 7 + (i - 4) * 0.12), h);
			ctx.fill();
		}
		ctx.restore();
		ctx.strokeStyle = "rgba(255,255,255,0.6)";
		ctx.lineWidth = Math.max(1, w * 0.006);
		ctx.beginPath();
		ctx.ellipse(w * 0.5, h * 0.75, w * 0.22, h * 0.07, 0, 0, Math.PI * 2);
		ctx.stroke();
		for (const x of [0.12, 0.88]) {
			glow(ctx, w * x, h * 0.08, w * 0.3, "rgba(255,255,240,0.9)");
			ctx.fillStyle = "#ffffff";
			ctx.fillRect(w * x - w * 0.04, h * 0.06, w * 0.08, h * 0.03);
		}
		blurred(ctx, w * 0.01, () => bokeh(ctx, w, h, 41, ["#ffffff", "#ffd27a", "#9fd0ff"], 30, [0.008, 0.02], { top: 0.3, bottom: 0.52 }, 0.8));
		vignette(ctx, w, h, 0.45);
	},
	fashion(ctx, w, h) {
		fillGradient(ctx, w, h, [[0, "#0a0a0c"], [1, "#1d1a22"]]);
		const runway = ctx.createLinearGradient(0, h * 0.4, 0, h);
		runway.addColorStop(0, "#2b2731");
		runway.addColorStop(1, "#d8d2dc");
		ctx.fillStyle = runway;
		ctx.beginPath();
		ctx.moveTo(w * 0.44, h * 0.4);
		ctx.lineTo(w * 0.56, h * 0.4);
		ctx.lineTo(w * 0.85, h);
		ctx.lineTo(w * 0.15, h);
		ctx.fill();
		glow(ctx, w * 0.5, h * 0.35, w * 0.4, "rgba(255,255,255,0.35)");
		person(ctx, w * 0.5, h * 0.62, h * 0.12, "#050506");
		blurred(ctx, w * 0.008, () => bokeh(ctx, w, h, 51, ["#ffffff"], 22, [0.01, 0.03], { top: 0.4, bottom: 0.95 }, 0.9));
		vignette(ctx, w, h, 0.5);
	},
	realEstate(ctx, w, h) {
		fillGradient(ctx, w, h, [[0, "#2e3d6b"], [0.55, "#f6a46b"], [0.7, "#fbd38d"], [1, "#2d5a2b"]]);
		ctx.fillStyle = "#3f7a3a";
		ctx.fillRect(0, h * 0.8, w, h * 0.2);
		ctx.save();
		ctx.fillStyle = "#1c1c22";
		ctx.fillRect(w * 0.18, h * 0.5, w * 0.64, h * 0.3);
		ctx.fillRect(w * 0.42, h * 0.38, w * 0.4, h * 0.14);
		ctx.fillStyle = "#ffd28a";
		for (const [x, y, ww, hh] of [
			[0.22, 0.56, 0.16, 0.12],
			[0.45, 0.56, 0.12, 0.2],
			[0.62, 0.56, 0.16, 0.12],
			[0.48, 0.41, 0.28, 0.07],
		] as const) {
			ctx.fillRect(w * x, h * y, w * ww, h * hh);
		}
		ctx.fillStyle = "#14141a";
		ctx.fillRect(w * 0.12, h * 0.36, w * 0.76, h * 0.025);
		ctx.restore();
		glow(ctx, w * 0.5, h * 0.62, w * 0.45, "rgba(255,200,120,0.25)");
		vignette(ctx, w, h, 0.3);
	},
};

const cache = new Map<string, OffscreenCanvas | HTMLCanvasElement>();
onMemoryPressure(() => cache.clear());

/** The scene drawn at this size (cached: each scene is drawn once per tile size). */
export function sceneCanvas(scene: Scene, width: number, height: number): OffscreenCanvas | HTMLCanvasElement | null {
	const key = `${scene}:${width}x${height}`;
	const hit = cache.get(key);
	if (hit) return hit;
	const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height });
	const ctx = canvas.getContext("2d") as Ctx | null;
	if (!ctx) return null;
	SCENES[scene](ctx, width, height);
	cache.set(key, canvas);
	return canvas;
}

export const SCENE_IDS = Object.keys(SCENES) as Scene[];

const photos = new Map<Scene, Promise<HTMLImageElement | null>>();

/** The scene's photo (loaded once, shared by every tile on it), or null when it can't be loaded. */
export function scenePhoto(scene: Scene): Promise<HTMLImageElement | null> {
	let hit = photos.get(scene);
	if (!hit) {
		hit = new Promise((resolve) => {
			if (typeof Image === "undefined") return resolve(null);
			const image = new Image();
			image.decoding = "async";
			image.onload = () => resolve(image);
			image.onerror = () => resolve(null);
			image.src = `/text-scenes/${scene}.jpg`;
		});
		photos.set(scene, hit);
	}
	return hit;
}

/** Fills the tile with the scene: the photo cropped to cover it (or the drawn scene), darkened so any text reads. */
export function paintScene(ctx: Ctx, scene: Scene, width: number, height: number, photo: HTMLImageElement | null): void {
	if (photo && photo.naturalWidth > 0) {
		const scale = Math.max(width / photo.naturalWidth, height / photo.naturalHeight);
		const w = photo.naturalWidth * scale;
		const h = photo.naturalHeight * scale;
		ctx.drawImage(photo, (width - w) / 2, (height - h) / 2, w, h);
	} else {
		const drawn = sceneCanvas(scene, width, height);
		if (drawn) ctx.drawImage(drawn, 0, 0);
	}
	ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
	ctx.fillRect(0, 0, width, height);
	vignette(ctx, width, height, 0.5);
}
