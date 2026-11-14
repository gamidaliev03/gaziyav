// fal.ai on the page: whether the key is set (Settings keeps it through the app, never the page), the models each
// feature uses and their prices. One store, refreshed when Settings changes something.
import { create } from "zustand";
import { openSettings } from "@/settings/settings-store";
import { useMemo } from "react";
import { apiOf, chosenModel, cloneTts, type FalModel, type FalTask, liveUnit, price, usd } from "./models";
import type { AiApi, Keys } from "./video";

export interface FalStatus {
	key: boolean;
	hint: string | null;
	choices: Record<FalTask, string>;
	models: Array<FalModel & { live?: { usd: number; unit: string } }>;
	spent: { total: number; byTask: Record<string, number>; tokens?: number };
	kie: { key: boolean; hint: string | null; spent: { total: number; byTask: Record<string, number> } };
	argo: { key: boolean; hint: string | null; spent: { total: number; byTask: Record<string, number> } };
	/** Providers that refused a paid job for an empty balance in the last 15 min → when (ms). */
	empty?: Partial<Record<AiApi, number>>;
}

interface State {
	status: FalStatus | null;
	refresh: () => Promise<FalStatus | null>;
	choose: (task: FalTask, id: string) => Promise<void>;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`/api/fal/${path}`, { ...init, headers: { "Content-Type": "application/json", "X-Studio": "1", ...(init?.headers ?? {}) } });
	const data = (await res.json().catch(() => ({}))) as T & { error?: string };
	if (!res.ok) throw new Error(data.error || "The app didn't answer. Try again.");
	return data;
}

export const useFal = create<State>()((set) => ({
	status: null,
	refresh: async () => {
		const status = await api<FalStatus>("status").catch(() => null);
		if (status) set({ status });
		return status;
	},
	choose: async (task, id) => {
		set({ status: await api<FalStatus>("model", { method: "POST", body: JSON.stringify({ task, id }) }) });
	},
}));

export const checkFalKey = () => api<{ ok: boolean; error?: string }>("check", { method: "POST" });
/** fal's balance in dollars, when fal reports one. */
export const falBalance = () => api<{ balance: number | null }>("balance").then((r) => r.balance).catch(() => null);
export const checkArgoKey = () => api<{ ok: boolean; error?: string; available?: number; held?: number }>("argo-check", { method: "POST" });
export const checkKieKey = () => api<{ ok: boolean; error?: string; credits?: number }>("kie-check", { method: "POST" });

/** Which APIs have a key (undefined until the status has come: then every model is on offer). */
export const keysOf = (s: FalStatus | null | undefined): Keys | undefined => (s ? { fal: s.key, kie: s.kie.key, argo: s.argo.key } : undefined);
export function useKeys(): Keys | undefined {
	const fal = useFal((s) => s.status?.key);
	const kie = useFal((s) => s.status?.kie.key);
	const argo = useFal((s) => s.status?.argo.key);
	return useMemo(() => (fal === undefined || kie === undefined || argo === undefined ? undefined : { fal, kie, argo }), [fal, kie, argo]);
}
/** Whether any API has a key (null: not read yet). */
export const useAnyKey = (): boolean | null => useFal((s) => (s.status ? s.status.key || s.status.kie.key || s.status.argo.key : null));

/** The model a feature uses now: the user's pick, else the default of an API with a key. Its `api` is where it runs. */
export function falChoice(task: FalTask): FalModel {
	const s = useFal.getState().status;
	return chosenModel(task, s?.choices, keysOf(s));
}
/** The same for a component: follows the status. */
export function useChoice(task: FalTask): FalModel {
	const choices = useFal((s) => s.status?.choices);
	const keys = useKeys();
	return useMemo(() => chosenModel(task, choices, keys), [task, choices, keys]);
}
/** The API the picked model of a task runs on. */
export const useApiOf = (task: FalTask): AiApi => apiOf(useChoice(task));
/** Whether the API the picked model of a task runs on has its key (null: not read yet). */
export function useApiKey(task: FalTask): boolean | null {
	const api = useApiOf(task);
	return useFal((s) => (s.status ? (api === "kie" ? s.status.kie.key : api === "argo" ? s.status.argo.key : s.status.key) : null));
}

/** fal's live price for a model when known (Settings shows it), else the catalog's — the same rule the server bills by (fal/server.ts liveUnitPrice). */
export function unitPrice(m: FalModel): number {
	return liveUnit(m, useFal.getState().status?.models.find((x) => x.id === m.id)?.live);
}

/** The speech model a cloned voice (the clip's own, My voices) really speaks with: fal's, whatever voice model is picked. */
export const falTts = (): FalModel => cloneTts(useFal.getState().status?.choices);
export function useFalTts(): FalModel {
	const choices = useFal((s) => s.status?.choices);
	return useMemo(() => cloneTts(choices), [choices]);
}
/** Whether the voice id names a clone (the clip's own voice or one of My voices): it speaks on fal. */
export const isCloneVoice = (voice: string | undefined) => voice === "clone" || !!voice?.startsWith("local:");

/** «≈ $0.20» for a run of `amount` (seconds / characters / pictures). */
export const estimate = (m: FalModel, amount: number) => `≈ ${usd(price(m, amount, unitPrice(m)))}`;

/** Opens Settings at the AI section (the fal key and the models). */
export function openFalSettings() {
	openSettings("ai");
}
