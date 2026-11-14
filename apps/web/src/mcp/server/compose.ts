// Claude's own Remotion components for AI layers (motion_layer): the same sandbox as Gaziyav AI's components
// (montage/server/plan.ts compileComponent: allowed imports only, no network, timers, storage or globals; loops
// guarded), plus a few escapes that sandbox's word list misses (a function's constructor, prototypes, the app's
// bridge). Every refusal names the line and says what to write instead, so the next try compiles.
import { compileComponent } from "@/montage/server/plan";

export const ALLOWED_IMPORTS = ["react", "remotion", "@remotion/shapes", "@remotion/paths", "@remotion/noise", "./kit"];

/** Reached only through a constructor or a global object: never needed by a component. */
const ESCAPES: Array<{ re: RegExp; fix: string }> = [
	{ re: /\bconstructor\b|__proto__|\bprototype\b|getPrototypeOf|\bReflect\b|\bProxy\b/, fix: "write a plain function component; prototypes and constructors are not available" },
	{ re: /\bstudioApp\b|\bipcRenderer\b|\belectron\b/, fix: "the app itself is not reachable from a layer" },
	{ re: /(?<![.\w$])(self|top|parent|opener|location)\s*[.[]/, fix: "global objects are not available; use the props you get" },
];

/** What to do instead of a refused word (the sandbox's own list, montage/server/plan.ts FORBIDDEN). */
function hint(word: string): string {
	const w = word.trim();
	if (/^(fetch|XMLHttpRequest|WebSocket|navigator|https?:\/\/)/.test(w)) return "no network in a layer: put the picture in Media and pass it in props.assets, or draw it with SVG";
	if (/^(setTimeout|setInterval|requestAnimationFrame)$/.test(w)) return "timers don't render frame by frame: animate from useCurrentFrame() with interpolate() or spring()";
	if (/^(while|do)/.test(w)) return "use a for loop (for loops are guarded)";
	if (w === "Math.random") return "use random('a seed') from remotion: the same frame must render the same way";
	if (/^(transition|animation)/.test(w)) return "CSS animations don't render: drive every style from useCurrentFrame()";
	if (w === "require" || w.startsWith("import")) return `import at the top from: ${ALLOWED_IMPORTS.join(", ")}`;
	return "it is not available in a layer (no window, document, storage, eval or timers)";
}

const lineOf = (code: string, index: number) => code.slice(0, index).split("\n").length;

export type ComposeResult = { js: string } | { error: string };

/** TSX → the sandbox's CommonJS, or an error that says where and what to change. */
export function compileForClaude(code: string, component: string): ComposeResult {
	const src = String(code ?? "");
	if (!src.trim()) return { error: "Give the component's code (TSX)." };
	if (!/^[A-Z][A-Za-z0-9]{1,40}$/.test(component)) return { error: "component: a PascalCase name of 2–40 letters, the name the code exports (export const Chart = …)." };
	if (!new RegExp(`export\\s+(const|function)\\s+${component}\\b|export\\s+default\\b`).test(src)) return { error: `The code must export the component: export const ${component} = (props) => …` };
	for (const { re, fix } of ESCAPES) {
		const m = re.exec(src);
		if (m) return { error: `line ${lineOf(src, m.index)}: "${m[0].trim()}" is not allowed — ${fix}.` };
	}
	const r = compileComponent(src);
	if ("js" in r) return r;
	const bad = /import "([^"]+)" is not allowed/.exec(r.error)?.[1];
	if (bad) return { error: `import "${bad}" is not allowed — import only from ${ALLOWED_IMPORTS.join(", ")}.` };
	const word = /"([^"]+)" is not allowed/.exec(r.error)?.[1];
	if (word) {
		const at = src.indexOf(word);
		return { error: `${at >= 0 ? `line ${lineOf(src, at)}: ` : ""}"${word}" is not allowed — ${hint(word)}.` };
	}
	return { error: `${r.error}. Fix that line and send the whole code again.` };
}
