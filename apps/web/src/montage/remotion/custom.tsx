// Sandboxed loader of DeepSeek's own components: compiled (sucrase, on the server) CommonJS evaluated with a
// whitelist of modules. A broken component never breaks the preview or the export — it renders nothing and
// reports "[montage-error] …" (the agent's still check reads these and fixes the code before the user sees it).
import React from "react";
import * as Remotion from "remotion";
import * as Noise from "@remotion/noise";
import * as Paths from "@remotion/paths";
import * as Shapes from "@remotion/shapes";
import { Lottie, Picture, useFont } from "./assets";
import { E, env, mix, prog } from "./ease";
import { emojiFont, font } from "./fonts";

const KIT = { E, env, mix, prog, font, emojiFont, Lottie, Picture, useFont };
const MODULES: Record<string, unknown> = {
	react: React,
	remotion: Remotion,
	"@remotion/noise": Noise,
	"@remotion/paths": Paths,
	"@remotion/shapes": Shapes,
	"./kit": KIT,
};

const cache = new Map<string, React.FC<any> | null>();
/** Globals a layer never needs; passed as undefined parameters, so the code can't reach them by name. */
const SHADOWED = ["window", "self", "globalThis", "document", "top", "parent", "frames", "opener", "location", "navigator", "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "localStorage", "sessionStorage", "indexedDB", "caches", "importScripts", "Worker", "SharedWorker", "studioApp"];

/** Throws when a component's loops spin more than ~3 M times within a second (a runaway loop), never otherwise. */
function loopGuard() {
	let n = 0;
	let since = 0;
	return () => {
		if ((++n & 4095) !== 0) return;
		const now = Date.now();
		if (!since || now - since > 1000) {
			since = now;
			n = 0;
		} else if (n > 3_000_000) {
			n = 0;
			throw new Error("a loop in the component runs too long");
		}
	};
}

export function loadComponent(js: string, name: string): React.FC<any> | null {
	const key = `${name}\u0000${js}`;
	if (cache.has(key)) return cache.get(key) ?? null;
	let comp: React.FC<any> | null = null;
	try {
		const module = { exports: {} as Record<string, unknown> };
		const require = (id: string) => {
			if (!(id in MODULES)) throw new Error(`module ${id} is not allowed`);
			return MODULES[id];
		};
		// The page's own objects are shadowed (undefined inside the component): no network, storage, app bridge or DOM,
		// even past the compile-time word list (montage/server/plan.ts) — defence in depth for code a model wrote.
		// eslint-disable-next-line no-new-func
		// (in an inner function: the component's own `const frames = …` or `const top = …` stays legal)
		new Function("require", "exports", "module", "React", "__loopGuard", ...SHADOWED, `(function () {\n${js}\n}).call(undefined);`)(require, module.exports, module, React, loopGuard());
		const exp = module.exports;
		const found = exp[name] ?? exp.default ?? Object.values(exp).find((v) => typeof v === "function");
		comp = typeof found === "function" ? (found as React.FC<any>) : null;
		if (!comp) console.error(`[montage-error] ${name}: the code exports no component`);
	} catch (error) {
		console.error(`[montage-error] ${name} does not load: ${(error as Error)?.message ?? error}`);
	}
	cache.set(key, comp);
	return comp;
}

export class LayerBoundary extends React.Component<{ children: React.ReactNode; name?: string }, { failed: boolean }> {
	state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	componentDidCatch(error: unknown) {
		console.error(`[montage-error] ${this.props.name ?? "layer"} crashed while rendering: ${(error as Error)?.message ?? error}`);
	}
	render() {
		return this.state.failed ? null : this.props.children;
	}
}
