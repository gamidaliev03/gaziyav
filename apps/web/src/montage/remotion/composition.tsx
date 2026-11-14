// The Remotion layer of all AI layers visible on the current timeline: one <Sequence> per layer, kit components or
// DeepSeek's own (sandboxed) components. Same code in the editor's Player and in the export renderer.
// Layout per layer: "overlay" (transparent, over the video) or "scene" (full frame, opaque: covers the video).
import type React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { styleOf } from "../styles";
import { JSON_PREFIX, type MontageInput, type MontageItem } from "../types";
import type { LayerAsset } from "./assets";
import { LayerBoundary, loadComponent } from "./custom";
import { KIT } from "./kit";
import { MOGRAPH } from "./mograph";
import { transformAt } from "./transform";

/** Asset store names → URLs the Player (same origin) and the renderer (app origin) can load. */
function layerAssets(v: unknown, origin: string): Record<string, LayerAsset> {
	if (typeof v !== "string" || !v.startsWith("{")) return {};
	try {
		const raw = JSON.parse(v) as Record<string, Omit<LayerAsset, "url"> & { name: string }>;
		const out: Record<string, LayerAsset> = {};
		for (const [key, a] of Object.entries(raw)) {
			if (a && typeof a.name === "string") out[key] = { ...a, url: `${origin}/api/montage/asset/${encodeURIComponent(a.name)}` };
		}
		return out;
	} catch {
		return {};
	}
}

/** Structured props (lists, objects) travel as "json:" strings in the editor's params. */
function ownProps(props: MontageItem["props"]): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(props)) {
		if (typeof v === "string" && v.startsWith(JSON_PREFIX)) {
			try {
				out[k] = JSON.parse(v.slice(JSON_PREFIX.length));
				continue;
			} catch {}
		}
		out[k] = v;
	}
	return out;
}

/** The layer's transform plus the offset of the tracker it follows, `t` seconds after its start. */
function followed(item: MontageItem, base: MontageItem["tf"], t: number): MontageItem["tf"] {
	const tf = base ?? { x: 0, y: 0, sx: 1, sy: 1, rot: 0, op: 1 };
	const fp = item.fp;
	if (!fp || fp.length < 3) return base;
	const n = fp.length / 3;
	const f = Math.max(0, Math.min(n - 1, t * 30));
	const i = Math.min(n - 2, Math.floor(f));
	const k = n > 1 ? f - i : 0;
	const at = (j: number) => (n > 1 ? fp[i * 3 + j] + (fp[(i + 1) * 3 + j] - fp[i * 3 + j]) * k : fp[j]);
	return { ...tf, x: tf.x + at(0), y: tf.y + at(1), sx: tf.sx * at(2), sy: tf.sy * at(2) };
}

function Layer({ item, input }: { item: MontageItem; input: MontageInput }) {
	const { fps } = useVideoConfig();
	const frame = useCurrentFrame();
	const dur = Math.max(1, Math.round((item.len ?? item.dur) * fps));
	// No accent → the composition style's accent (the kit resolves it).
	const accent = typeof item.props.accent === "string" ? item.props.accent : "";
	// Captions carry their own words (ms from the layer start); otherwise the timeline words in timeline time.
	const own = parseWords(item.props.words);
	const assets = layerAssets(item.props.assets, input.origin);
	const ctx = { ...ownProps(item.props), id: item.id, dur, accent, t0: own ? 0 : item.from, words: own ?? input.words, media: {} as Record<string, string>, assets, origin: input.origin };
	let Comp: React.FC<any> | null = null;
	if (item.kind === "Custom") {
		const js = typeof item.props.js === "string" ? item.props.js : "";
		Comp = js ? loadComponent(js, String(item.props.component ?? "")) : null;
	} else {
		Comp = KIT[item.kind] ?? MOGRAPH[item.kind] ?? null;
	}
	if (!Comp) return null;
	const tf = followed(item, transformAt(item, frame / fps), frame / fps - (item.skip ?? 0));
	const style: React.CSSProperties | undefined =
		tf && (tf.x || tf.y || tf.sx !== 1 || tf.sy !== 1 || tf.rot || tf.op !== 1)
			? { translate: `${tf.x}px ${tf.y}px`, scale: `${tf.sx} ${tf.sy}`, rotate: `${tf.rot}deg`, opacity: tf.op }
			: undefined;
	const scene = item.props.layout === "scene";
	const bg = typeof item.props.bg === "string" && /^#[0-9a-f]{3,8}$/i.test(item.props.bg) ? item.props.bg : styleOf(item.props.style).id === "luxury" ? "#16120d" : "#0b0d12";
	return (
		<AbsoluteFill style={style} data-ai-item={item.id} data-ai-owner={item.owner ?? ""}>
			{scene && item.props.bg !== "none" && <AbsoluteFill style={{ background: bg }} />}
			<LayerBoundary name={String(item.props.component || item.kind)}>
				<Comp {...ctx} />
			</LayerBoundary>
		</AbsoluteFill>
	);
}

function parseWords(v: unknown): MontageInput["words"] | null {
	if (typeof v !== "string" || !v.startsWith("[")) return null;
	try {
		const raw = JSON.parse(v) as [string, number, number][];
		return raw.map(([text, startMs, endMs]) => ({ text, startMs, endMs }));
	} catch {
		return null;
	}
}

export const MontageComposition: React.FC<MontageInput> = (input) => {
	const { fps } = useVideoConfig();
	// items come top-first; draw bottom-first so the top layer is painted last.
	const ordered = [...input.items].reverse();
	return (
		<AbsoluteFill style={{ pointerEvents: "none" }}>
			{ordered.map((item) => (
				<Sequence key={`${item.owner ?? ""}/${item.id}`} from={Math.round(item.from * fps)} durationInFrames={Math.max(1, Math.round(item.dur * fps))}>
					<Sequence from={-Math.round((item.skip ?? 0) * fps)}>
						<Layer item={item} input={input} />
					</Sequence>
				</Sequence>
			))}
		</AbsoluteFill>
	);
};
