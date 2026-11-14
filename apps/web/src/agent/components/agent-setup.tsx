"use client";

// Gaziyav AI thinks on fal.ai (OpenRouter's models through the one fal key). The chooser by the prompt comes up when a
// request is sent with no key yet (it sends the user to Settings → AI) or from the AI badge (the model).
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { useT } from "@/i18n";
import { openFalSettings } from "@/fal/client";
import { refreshServer } from "@/studio/client/actions";
import { cn } from "@/utils/ui";

export interface ProviderRow {
	id: string;
	name: string;
	keyHost: string;
	keyUrl: string;
	keyOptional: boolean;
	mask: string;
	ready: boolean;
	model: string;
}

export interface AgentSetup {
	ready: boolean;
	provider: string | null;
	name: string | null;
	model: string | null;
	baseUrl: string;
	providers: ProviderRow[];
}

const HEADERS = { "X-Studio": "1", "Content-Type": "application/json" };

export async function agentCall(route: string, body?: unknown): Promise<AgentSetup> {
	const r = await fetch(`/api/agent/${route}`, body === undefined ? { headers: HEADERS } : { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
	const j = (await r.json().catch(() => ({}))) as AgentSetup & { error?: string };
	if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
	return j;
}

export function useAgentSetup() {
	const [setup, setSetup] = useState<AgentSetup | null>(null);
	const load = useCallback(async () => setSetup(await agentCall("setup").catch(() => null)), []);
	useEffect(() => {
		void load();
	}, [load]);
	const change = useCallback(async (route: string, body: unknown) => {
		const next = await agentCall(route, body);
		setSetup(next);
		// The prompt, the panel and every AI button read «Gaziyav AI has an AI» from the app's state.
		await refreshServer();
		return next;
	}, []);
	return { setup, change, load };
}

/** Provider → key (an address too for Other) → the check; then `onDone`. */
export function BrainPicker({ setup, change, onDone, runLabel, only }: { setup: AgentSetup | null; change: (route: string, body: unknown) => Promise<AgentSetup>; onDone?: (s: AgentSetup) => void; runLabel: string; only?: string }) {
	const t = useT();
	const [picked, setPicked] = useState(only ?? setup?.provider ?? "anthropic");
	const [key, setKey] = useState("");
	const [baseUrl, setBaseUrl] = useState(setup?.baseUrl || "http://localhost:1234/v1");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const row = setup?.providers.find((p) => p.id === picked);
	const save = async (value = key) => {
		setBusy(true);
		setError("");
		try {
			const next = await change("key", { provider: picked, key: value, baseUrl });
			setKey("");
			onDone?.(next);
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	};
	const canRun = !busy && (!!key.trim() || (row?.keyOptional && !!baseUrl.trim()));
	return (
		<div className="flex flex-col gap-2.5" data-brain-picker>
			{!only && (
				<div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label={t("AI")}>
					{(setup?.providers ?? []).map((p) => (
						// biome-ignore lint/a11y/useSemanticElements: provider tiles act as one radio group (like the mode switch)
						<button
							key={p.id}
							type="button"
							role="radio"
							aria-checked={picked === p.id}
							data-brain-provider={p.id}
							onClick={() => {
								setPicked(p.id);
								setError("");
							}}
							className={cn(
								"flex items-center justify-between gap-1 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors",
								picked === p.id ? "border-primary bg-primary/10" : "hover:bg-accent",
							)}
						>
							<span className="truncate">{t(p.name)}</span>
							{p.ready && <span className="text-emerald-500">✓</span>}
						</button>
					))}
				</div>
			)}
			{picked === "other" && (
				<Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:1234/v1" className="h-8 text-xs" data-brain-base-url aria-label={t("Address")} />
			)}
			<Input
				type="password"
				autoComplete="off"
				spellCheck={false}
				value={key}
				onChange={(e) => setKey(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && canRun) {
						e.preventDefault();
						void save();
					}
				}}
				// A pasted key is checked at once (the usual way a key arrives): no second click.
				onPaste={(e) => {
					const pasted = e.clipboardData.getData("text").trim();
					if (!pasted || busy || pasted.includes("\n")) return;
					e.preventDefault();
					setKey(pasted);
					void save(pasted);
				}}
				placeholder={row?.keyOptional ? t("API key (optional)") : picked === "anthropic" ? "sk-ant-…" : t("API key")}
				className="h-8 text-xs"
				data-brain-key
			/>
			{error && (
				<p className="text-destructive text-xs" role="alert" data-brain-error>
					{error}
				</p>
			)}
			<div className="flex items-center justify-between gap-2">
				{row && (
					<a href={row.keyUrl} target="_blank" rel="noreferrer" className="text-muted-foreground min-w-0 truncate text-[11px] underline-offset-2 hover:underline">
						{t("Get a key: {where}", { where: row.keyHost })}
					</a>
				)}
				<Button size="sm" onClick={() => void save()} disabled={!canRun} data-brain-run>
					{busy ? t("Checking…") : runLabel}
				</Button>
			</div>
			<p className="text-muted-foreground text-[11px]">{t("Only API keys work here: a Claude or ChatGPT subscription can't be used by other apps. Keys stay in this Mac's Keychain.")}</p>
		</div>
	);
}

/**
 * The chooser by the prompt: opens on a request sent with no AI yet (then `onReady` runs that request as typed) or
 * from the AI badge. `children` is what it is anchored to.
 */
export function BrainChooser({ open, onOpenChange, onReady, request, children }: { open: boolean; onOpenChange: (v: boolean) => void; onReady?: () => void; request: boolean; children: React.ReactNode }) {
	const t = useT();
	const { setup, change, load } = useAgentSetup();
	useEffect(() => {
		if (open) void load();
	}, [open, load]);
	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverAnchor asChild>{children}</PopoverAnchor>
			<PopoverContent align="start" className="w-[340px] p-3" data-brain-chooser onOpenAutoFocus={(e) => e.preventDefault()}>
				<div className="mb-2 text-sm font-medium">{request ? t("Choose the AI for this request") : t("Gaziyav AI's AI")}</div>
				{setup?.ready && !request && (
					<p className="text-muted-foreground mb-2 text-xs" data-brain-now>
						{t("Now: {name} · {model}", { name: t(setup.name ?? ""), model: setup.model ?? "" })}
					</p>
				)}
				{setup?.ready ? (
					<Button
						size="sm"
						className="w-full"
						onClick={() => {
							onOpenChange(false);
							onReady?.();
						}}
						data-brain-run
					>
						{request ? t("Run") : t("OK")}
					</Button>
				) : (
					<div className="flex flex-col gap-2 text-xs" data-brain-nokey>
						<span className="text-muted-foreground">{t("Gaziyav AI thinks on your fal.ai key. Add it once in Settings → AI.")}</span>
						<Button
							size="sm"
							onClick={() => {
								onOpenChange(false);
								openFalSettings();
							}}
						>
							{t("Open Settings")}
						</Button>
					</div>
				)}
				<span className="text-muted-foreground mt-2 block text-[11px]">{t("The model is chosen in Settings → AI → AI agent.")}</span>
			</PopoverContent>
		</Popover>
	);
}

/** Settings → AI → API keys: one row per AI (status, Add / Change / Remove, the model), and which one Gaziyav AI uses. */
export function ApiKeysGroup() {
	const t = useT();
	const { setup, change } = useAgentSetup();
	const [editing, setEditing] = useState<string | null>(null);
	const [models, setModels] = useState<Record<string, string[]>>({});
	const run = (route: string, body: unknown) => change(route, body).catch((e) => toast.error((e as Error).message));
	const loadModels = async (id: string) => {
		if (models[id]) return;
		const r = await fetch(`/api/agent/models?provider=${id}`, { headers: HEADERS });
		const j = (await r.json().catch(() => ({}))) as { models?: string[]; error?: string };
		if (j.models) setModels((m) => ({ ...m, [id]: j.models as string[] }));
		else if (j.error) toast.error(j.error);
	};
	return (
		<section className="flex flex-col gap-2.5 border-t pt-5 first:border-t-0 first:pt-0" data-settings-group="api-keys">
			<h3 className="text-[0.95rem] font-medium">{t("API keys")}</h3>
			<p className="text-muted-foreground text-sm">{t("Gaziyav AI and the AI text features run on your own key. Pick which AI Gaziyav AI thinks with.")}</p>
			<div className="flex flex-col divide-y rounded-lg border">
				{(setup?.providers ?? []).map((p) => (
					<div key={p.id} className="flex flex-col gap-2 px-3 py-2.5" data-api-key-row={p.id}>
						<div className="flex min-w-0 flex-wrap items-center gap-2">
							<label className="flex min-w-0 items-center gap-2 text-sm">
								<input
									type="radio"
									name="pointagent-brain"
									checked={setup?.provider === p.id}
									disabled={!p.ready}
									onChange={() => run("provider", { provider: p.id })}
									aria-label={t("Gaziyav AI thinks with {name}", { name: t(p.name) })}
									data-api-key-use={p.id}
								/>
								<span className="truncate font-medium">{t(p.name)}</span>
							</label>
							<span className={cn("text-xs", p.ready ? "text-emerald-500" : "text-muted-foreground")} data-api-key-status={p.id}>
								{p.ready ? `${p.mask || t("no key")} ✓` : t("Not set")}
							</span>
							{setup?.provider === p.id && <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 text-[11px]">{t("Gaziyav AI's AI")}</span>}
							<div className="ml-auto flex gap-1.5">
								<Button size="sm" variant="outline" className="h-7" onClick={() => setEditing(editing === p.id ? null : p.id)} data-api-key-edit={p.id}>
									{p.ready ? t("Change") : t("Add")}
								</Button>
								{p.ready && (
									<Button size="sm" variant="outline" className="h-7" onClick={() => run("remove", { provider: p.id })} data-api-key-remove={p.id}>
										{t("Remove")}
									</Button>
								)}
							</div>
						</div>
						{editing === p.id && <BrainPicker setup={setup} change={change} only={p.id} runLabel={t("Check and save")} onDone={() => setEditing(null)} />}
						{p.ready && (
							<div className="flex items-center gap-2 text-xs">
								<span className="text-muted-foreground">{t("Model")}</span>
								<select
									value={p.model}
									onFocus={() => void loadModels(p.id)}
									onChange={(e) => run("model", { provider: p.id, model: e.target.value })}
									className="bg-background min-w-0 max-w-64 rounded-md border px-2 py-1 text-xs"
									data-api-key-model={p.id}
								>
									{[...new Set([p.model, ...(models[p.id] ?? [])])].filter(Boolean).map((m) => (
										<option key={m} value={m}>
											{m}
										</option>
									))}
								</select>
							</div>
						)}
					</div>
				))}
			</div>
		</section>
	);
}
