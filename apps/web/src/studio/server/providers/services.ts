// Settings → Services on the server: the keys (the app keeps them like the fal.ai key and hands them over as messages,
// GaziyavShell/modules/provider-keys.js), the choice of each row (services.json beside the settings; a row with no
// choice is Gaziyav's own way, as in 1.0.58), and one run of a ported OpenFilm provider (openfilm/*.mjs) whose errors come
// back as one plain line.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { falKey } from "@/fal/server";
import { kieKey } from "@/kie/server";
import { argoKey } from "@/argo/server";
import { CancelledError, StudioError } from "../errors";
import { studioHome } from "../settings";
import { type Ability, isAbility, type Option, optionOf, optionsOf, OWN_KEYS } from "./registry";
import azure from "./openfilm/azure.mjs";
import brave from "./openfilm/brave.mjs";
import cartesia from "./openfilm/cartesia.mjs";
import doubao from "./openfilm/doubao.mjs";
import elevenlabs from "./openfilm/elevenlabs.mjs";
import fal from "./openfilm/fal.mjs";
import google from "./openfilm/google.mjs";
import groq from "./openfilm/groq.mjs";
import inworld from "./openfilm/inworld.mjs";
import keenable from "./openfilm/keenable.mjs";
import mimo from "./openfilm/mimo.mjs";
import openai from "./openfilm/openai.mjs";
import openrouter from "./openfilm/openrouter.mjs";
import pexels from "./openfilm/pexels.mjs";
import pixabay from "./openfilm/pixabay.mjs";
import tavily from "./openfilm/tavily.mjs";

/** A ported provider (openfilm/contract.mjs `Provider`), as much of it as Gaziyav calls. */
export interface PortedProvider {
	id: string;
	name: string;
	verbs: readonly string[];
	keyless?: boolean;
	checkKey?: (key: string) => void;
	run: (verb: string, args: Record<string, unknown>, ctx: RunContext) => Promise<RunResult>;
}
export interface RunContext {
	key: string;
	model?: string;
	root: string;
	signal: AbortSignal;
	say: (line: string) => void;
	read: (p: string) => Promise<Uint8Array>;
}
export interface RunResult {
	files: Array<{ path: string; bytes: Uint8Array }>;
	index: Array<Record<string, unknown>>;
	receipt: Record<string, unknown>;
}

export const PORTED: Record<string, PortedProvider> = Object.fromEntries(
	[elevenlabs, inworld, cartesia, openai, google, fal, openrouter, pexels, pixabay, brave, tavily, groq, azure, doubao, mimo, keenable].map((p) => [(p as unknown as PortedProvider).id, p as unknown as PortedProvider]),
);

// ───────────────────────── keys ─────────────────────────

type Port = { on: (e: string, f: (m: unknown) => void) => void; postMessage: (m: unknown) => void };
type Holder = { __gaziyavServiceKeys?: Record<string, string | null>; __gaziyavServiceListening?: boolean; __gaziyavServiceKeysTest?: Record<string, string> | null };
const g = globalThis as Holder;

function listen() {
	const port = (process as unknown as { parentPort?: Port }).parentPort;
	g.__gaziyavServiceKeys ??= {};
	if (!port || g.__gaziyavServiceListening) return;
	g.__gaziyavServiceListening = true;
	port.on("message", (m) => {
		const d = ((m as { data?: unknown })?.data ?? m) as { type?: string; provider?: string; key?: unknown };
		if (d?.type === "provider-key" && typeof d.provider === "string" && (OWN_KEYS.includes(d.provider) || d.provider === "pexels" || d.provider === "pixabay")) {
			(g.__gaziyavServiceKeys as Record<string, string | null>)[d.provider] = typeof d.key === "string" && d.key.trim() ? d.key.trim() : null;
		}
	});
	for (const provider of OWN_KEYS) port.postMessage({ type: "provider-key-request", provider });
}

/** Tests: these keys instead of the app's (null: back to the app). */
export function setServiceKeysForTests(keys: Record<string, string> | null) {
	g.__gaziyavServiceKeysTest = keys;
}

/** The key of a service ("" when none): fal.ai, kie.ai and ArgoLink are Settings → AI's own. */
export function serviceKey(id: string): string {
	if (g.__gaziyavServiceKeysTest) return g.__gaziyavServiceKeysTest[id] ?? "";
	if (id === "fal") return falKey() ?? "";
	if (id === "kie") return kieKey() ?? "";
	if (id === "argo") return argoKey() ?? "";
	listen();
	return g.__gaziyavServiceKeys?.[id] || "";
}

/** For Settings: which keys are kept (the last four only). */
export function keysView(): Record<string, { key: boolean; hint: string | null }> {
	return Object.fromEntries(["fal", "kie", "argo", ...OWN_KEYS].map((id) => {
		const k = serviceKey(id);
		return [id, { key: !!k, hint: k ? `…${k.slice(-4)}` : null }];
	}));
}

/** Whether an option can run now: a key it needs is kept, or it needs none. */
export const usable = (o: Option) => o.free || !o.keys.length || o.keys.some((k) => !!serviceKey(k));

// ───────────────────────── the choices ─────────────────────────

const choiceFile = () => path.join(studioHome(), "services.json");

/** Each row's choice (absent: Gaziyav's own, the default). A file that can't be read is no choice. */
export function readChoices(): Partial<Record<Ability, string>> {
	try {
		const raw = JSON.parse(fs.readFileSync(choiceFile(), "utf8")) as { use?: Record<string, unknown> };
		return Object.fromEntries(Object.entries(raw.use ?? {}).filter(([k, v]) => isAbility(k) && typeof v === "string" && optionOf(k, v))) as Partial<Record<Ability, string>>;
	} catch {
		return {};
	}
}

export function choose(ability: Ability, id: string) {
	if (!optionOf(ability, id)) throw new StudioError("This service isn't offered for that.");
	const use = { ...readChoices(), [ability]: id };
	if (id === "gaziyav") delete use[ability];
	fs.mkdirSync(studioHome(), { recursive: true });
	const tmp = `${choiceFile()}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify({ use }, null, 2), { mode: 0o600 });
	fs.renameSync(tmp, choiceFile());
}

/** What a row uses now: its choice while it can run (else Gaziyav's own way, so nothing that worked stops). */
export function chosen(ability: Ability): Option {
	const pick = optionOf(ability, readChoices()[ability]);
	if (pick && pick.wired && usable(pick)) return pick;
	return optionsOf(ability)[0];
}

/** A row's chosen service when it is one of the ported providers (null: Gaziyav's own way, or a free source). */
export function chosenProvider(ability: Ability): { option: Option; provider: PortedProvider } | null {
	const o = chosen(ability);
	const provider = o.provider ? PORTED[o.provider] : undefined;
	return provider ? { option: o, provider } : null;
}

// ───────────────────────── one run ─────────────────────────

/** One plain line for whatever a service answered, in the app's English (the page shows its Russian). */
export function plainLine(error: unknown): string {
	if (error instanceof CancelledError || (error as Error)?.name === "AbortError") return "Cancelled";
	const e = error as Error & { code?: string };
	const text = String(e?.message ?? "");
	if (e?.code === "balance") return "The service has no money left on its account: top it up on its site.";
	if (/did not accept your key|\(40[13]\)|unauthori[sz]ed|invalid.*key|forbidden/i.test(text)) return "The service didn't accept the key: paste it again in Settings → Services.";
	if (/needs the resource's region|region/i.test(text)) return "Paste the Azure key as region:key, e.g. eastus:a1b2…";
	if (/could not be reached|fetch failed|ENOTFOUND|ECONN|network|timed? ?out|TimeoutError/i.test(text)) return "The service can't be reached: check the internet connection.";
	if (/found no (pictures|clips)/i.test(text)) return "Nothing found for that: try other words.";
	if (/paid plan/i.test(text)) return "This needs a paid plan at the service.";
	if (/429|rate limit|too many/i.test(text)) return "The service is busy: try again in a minute.";
	if (/takes no|needs? (a|an) (clip|recording|picture)|--video|--audio|--first-frame/i.test(text)) return "This model needs a clip or a recording to start from: pick another model.";
	return "The service didn't make it: try again, or pick another service.";
}

/**
 * Runs `verb` on a ported provider with its kept key and the chosen model; the files it made land in `into` (made
 * when needed) and come back as paths; the run's own folder goes. Errors are one plain line (plainLine).
 */
export async function runService(
	providerId: string,
	verb: string,
	args: Record<string, unknown>,
	o: { model?: string; into: string; signal?: AbortSignal; inputs?: Record<string, string>; onStatus?: (line: string) => void }
): Promise<{ files: string[]; index: RunResult["index"]; receipt: RunResult["receipt"] }> {
	const provider = PORTED[providerId];
	if (!provider) throw new StudioError("This service isn't offered for that.");
	const key = serviceKey(providerId);
	if (!key && !provider.keyless) throw new StudioError("Add the service's key first: Settings → Services.");
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "gz-service-"));
	const signal = o.signal ?? new AbortController().signal;
	try {
		// Inputs (a picture to start from, a recording): copied into the run's folder under the names the args give.
		for (const [rel, file] of Object.entries(o.inputs ?? {})) {
			const at = path.join(root, rel);
			fs.mkdirSync(path.dirname(at), { recursive: true });
			fs.copyFileSync(file, at);
		}
		let result: RunResult;
		try {
			result = await provider.run(verb, args, {
				key,
				model: o.model,
				root,
				signal,
				say: (line) => o.onStatus?.(line),
				read: async (p) => {
					const full = path.resolve(root, p);
					if (!full.startsWith(root + path.sep)) throw new Error("outside the run");
					return new Uint8Array(fs.readFileSync(full));
				},
			});
		} catch (error) {
			if (signal.aborted) throw new CancelledError();
			throw new StudioError(plainLine(error));
		}
		const into = o.into;
		fs.mkdirSync(into, { recursive: true });
		const files = result.files.map((f, i) => {
			const name = `${Date.now().toString(36)}-${i}-${path.basename(f.path).replace(/[^\w.-]+/g, "_")}`;
			const at = path.join(into, name);
			fs.writeFileSync(at, f.bytes);
			return at;
		});
		return { files, index: result.index, receipt: result.receipt };
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
}
