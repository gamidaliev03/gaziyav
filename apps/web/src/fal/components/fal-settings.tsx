"use client";

// Settings → Services: the fal.ai and kie.ai keys (kept by the app in the Mac's Keychain, never shown again), and the model
// each feature uses, with its price: one list per feature with the models of every API that has a key.
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { manyKeys, onOffer } from "@/fal/video";
import { useT } from "@/i18n";
import { cn } from "@/utils/ui";
import { CREDIT_USD } from "@/kie/catalog";
import { checkArgoKey, checkFalKey, checkKieKey, falBalance, useFal, useKeys } from "../client";
import { type AiApi, apiOf, FAL_TASKS, type FalModel, type FalTask, modelsFor, priceLine, usd } from "../models";

type GzBridge = { invoke: (channel: string, ...args: unknown[]) => Promise<{ ok: boolean; error?: string }> };
const keys = () => (window as unknown as { studioApp?: { gz?: GzBridge } }).studioApp?.gz;

type FalBridge = { set: (key: string) => Promise<{ ok: boolean; error?: string }>; clear: () => Promise<{ ok: boolean }> };
const bridge = () => (window as unknown as { studioApp?: { falKey?: FalBridge } }).studioApp?.falKey;

/**
 * A key typed into its field and left there when the box goes away — the big Save or Cancel of Settings, another tab — is
 * saved, not dropped in silence (check-flow A1, 06.11: the first key of a new Mac vanished that way).
 */
/** One money format for the three key rows: two decimals, and «< $0.01» under a cent. */
const money = (v: number): string => (!Number.isFinite(v) ? "$—" : v <= 0 ? "$0.00" : v < 0.01 ? "< $0.01" : `$${v.toFixed(2)}`);

/**
 * «Remove» asks once before the key goes (final-B D5, 07.11: a slip deleted a key at once, and it is never shown again,
 * so it had to be pasted from the provider). The trigger keeps its data attribute; the question's button is
 * `data-key-remove-go`.
 */
function RemoveKeyButton({ provider, site, disabled, onConfirm, ...attrs }: { provider: string; site: string; disabled: boolean; onConfirm: () => void } & Record<`data-${string}`, string | boolean>) {
	const t = useT();
	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button size="sm" variant="ghost" disabled={disabled} {...attrs}>
					{t("Remove")}
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent data-key-remove-dialog>
				<AlertDialogHeader>
					<AlertDialogTitle>{t("Remove the {provider} key?", { provider })}</AlertDialogTitle>
					<AlertDialogDescription>{t("It is never shown again: to use {provider} after this, paste the key again from {site}.", { provider, site })}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel data-key-remove-cancel>{t("Cancel")}</AlertDialogCancel>
					<AlertDialogAction data-key-remove-go onClick={onConfirm}>
						{t("Remove")}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function useSavePendingKey(key: string, save: (value: string) => Promise<unknown>) {
	const pending = useRef(key);
	pending.current = key;
	const saver = useRef(save);
	saver.current = save;
	useEffect(
		() => () => {
			const value = pending.current.trim();
			if (value.length >= 16 && !/\s/.test(value)) void saver.current(value);
		},
		[],
	);
}

const NAMES: Record<AiApi, string> = { fal: "fal.ai", kie: "kie.ai", argo: "ArgoLink" };

export function FalSettings() {
	const t = useT();
	const status = useFal((s) => s.status);
	const [key, setKey] = useState("");
	const [busy, setBusy] = useState<"save" | "check" | "clear" | null>(null);
	const [check, setCheck] = useState<{ ok: boolean; error?: string } | null>(null);
	const alive = useRef(true);
	useEffect(
		() => () => {
			alive.current = false;
		},
		[],
	);

	useEffect(() => {
		void useFal.getState().refresh();
	}, []);
	// fal's balance as fal reports it, read again when a job on fal has been paid (the spent total moves), when the key
	// changes and on Check (check-ai D8, 06.11: it stayed hidden until Settings was opened again).
	const [balance, setBalance] = useState<number | null>(null);
	const hasKey = !!status?.key;
	const hint = status?.hint ?? "";
	const paid = status?.spent.total ?? 0;
	// biome-ignore lint/correctness/useExhaustiveDependencies: a paid job or another key is the reason to read again
	useEffect(() => {
		if (!hasKey) return setBalance(null);
		let off = false;
		void falBalance().then((b) => !off && setBalance(b));
		return () => {
			off = true;
		};
	}, [hasKey, hint, paid]);

	const saveKey = async (value: string) => {
		const b = bridge();
		if (!b) return toast.error(t("The key can only be saved in the Mac app."));
		if (alive.current) setBusy("save");
		try {
			const r = await b.set(value);
			if (!r.ok) throw new Error(r.error || t("The key couldn't be saved."));
			if (alive.current) setKey("");
			// The server gets the key from the app a moment later: wait for it, then ask fal.
			for (let i = 0; i < 20; i++) {
				const s = await useFal.getState().refresh();
				if (s?.key) break;
				await new Promise((res) => setTimeout(res, 150));
			}
			const c = await checkFalKey();
			if (alive.current) setCheck(c);
			if (c.ok) toast.success(t("fal.ai key saved and working"));
			else toast.error(c.error ?? t("fal.ai didn't accept this key."));
			await useFal.getState().refresh();
			if (alive.current) setBalance(await falBalance());
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			if (alive.current) setBusy(null);
		}
	};
	const save = async () => {
		const value = key.trim();
		if (!value) return toast.error(t("Paste the key first."));
		if (/\s/.test(value) || value.length < 16) return toast.error(t("That doesn't look like a whole fal.ai key. Copy it again."));
		await saveKey(value);
	};
	useSavePendingKey(key, saveKey);

	const recheck = async () => {
		setBusy("check");
		try {
			const [c, b] = await Promise.all([checkFalKey(), falBalance()]);
			setCheck(c);
			setBalance(b);
		} finally {
			setBusy(null);
		}
	};

	const clear = async () => {
		setBusy("clear");
		try {
			await bridge()?.clear();
			setCheck(null);
			for (let i = 0; i < 20; i++) {
				const s = await useFal.getState().refresh();
				if (!s?.key) break;
				await new Promise((res) => setTimeout(res, 150));
			}
		} finally {
			setBusy(null);
		}
	};

	const spentAll = status ? status.spent.total + status.kie.spent.total + status.argo.spent.total : 0;
	const tokens = status?.spent.tokens ?? 0;
	return (
		<section className="flex flex-col gap-3" data-settings-group="fal">
			<div className="flex items-baseline justify-between gap-3">
				<h3 className="text-[0.95rem] font-medium">{t("API keys and models")}</h3>
				{status && (spentAll > 0 || tokens > 0) && (
					<span className="text-muted-foreground text-xs tabular-nums" data-spent-total={spentAll.toFixed(4)} title={t("The sum of the three keys' ledgers; the AI agent, scripts and translations count their tokens at the model's input price (a floor).")}>
						{t("Spent so far: {usd}", { usd: money(spentAll) })}
						{tokens > 0 ? ` · ${t("{n} LLM tokens", { n: tokens.toLocaleString("en-US") })}` : ""}
					</span>
				)}
			</div>
			{/* the keys: one row per provider in one list (state dot, name, balance, its actions) — no prose above it */}
			<div className="flex flex-col divide-y rounded-lg border" data-settings-card data-settings-keys>
			<div className="flex flex-col gap-2 p-3" data-fal-key>
				<div className="flex items-center gap-2 text-sm">
					<span className={cn("size-2 rounded-full", status?.key ? (check?.ok === false ? "bg-amber-500" : "bg-emerald-500") : "bg-muted-foreground/40")} />
					<span className="font-medium">fal.ai</span>
					{status?.key ? (
						<span className="text-muted-foreground tabular-nums">
							{t("Key saved")} {status.hint}
						</span>
					) : (
						<span className="text-muted-foreground">{t("No key yet")}</span>
					)}
					<span className="flex-1" />
					{status?.key && (
						<span className="text-muted-foreground text-xs tabular-nums" data-fal-balance>
							{balance !== null ? t("Balance: {usd}", { usd: money(balance) }) : t("Balance: needs an Admin key")}
						</span>
					)}
					{status?.key && (
						<>
							<Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void recheck()} data-fal-check>
								{busy === "check" && <Spinner className="size-3" />}
								{t("Check")}
							</Button>
							<RemoveKeyButton provider="fal.ai" site="fal.ai → Dashboard → API Keys" disabled={!!busy} onConfirm={() => void clear()} data-fal-clear />
						</>
					)}
				</div>
				<div className="flex gap-2">
					<Input
						type="password"
						autoComplete="off"
						spellCheck={false}
						placeholder={status?.key ? t("Paste a new key") : t("Paste your fal.ai key")}
						value={key}
						onChange={(e) => setKey(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && void save()}
						className={cn("flex-1", status?.key && "max-w-[18rem]")}
						aria-label={t("fal.ai key")}
						data-fal-key-input
					/>
					<Button disabled={!key.trim() || !!busy} onClick={() => void save()} data-fal-save>
						{busy === "save" && <Spinner className="size-3" />}
						{t("Save key")}
					</Button>
				</div>
				{check && !check.ok && <span className="text-xs text-amber-500">{check.error}</span>}
				{check?.ok && <span className="text-xs text-emerald-500">{t("fal.ai accepts this key.")}</span>}
				{status?.key && status.spent.total > 0 && (
					<span className="text-muted-foreground text-xs tabular-nums" data-fal-spent>
						{t("Spent so far: {usd}", { usd: money(status.spent.total) })}
					</span>
				)}
			</div>

			<KieKey />
			<ArgoKey />
			</div>

			<div className="flex flex-col divide-y rounded-lg border" data-fal-models>
				{/* One brain (21.11): text is Gaziyav AI's (the connected Claude), so the text model («AI agent») has no row here */}
				{FAL_TASKS.filter((task) => task.id !== "llm").map((task) => (
					<TaskRow key={task.id} task={task.id} title={task.title} note={task.note} />
				))}
			</div>
		</section>
	);
}

/** The kie.ai key, under fal's: saved by the app like it, shown only by its last four characters; its balance when it works. */
function KieKey() {
	const t = useT();
	const kie = useFal((s) => s.status?.kie);
	const [key, setKey] = useState("");
	const [busy, setBusy] = useState(false);
	const [check, setCheck] = useState<{ ok: boolean; error?: string; credits?: number } | null>(null);
	const has = !!kie?.key;
	const paidKie = kie?.spent.total ?? 0;
	// The balance is read again when a job on kie.ai has been paid (the spent total moves).
	// biome-ignore lint/correctness/useExhaustiveDependencies: a paid job is the reason to read again
	useEffect(() => {
		if (has) void checkKieKey().then(setCheck).catch(() => {});
	}, [has, paidKie]);
	const wait = async (want: boolean) => {
		for (let i = 0; i < 20; i++) {
			const s = await useFal.getState().refresh();
			if (!!s?.kie.key === want) return;
			await new Promise((res) => setTimeout(res, 150));
		}
	};
	const alive = useRef(true);
	useEffect(
		() => () => {
			alive.current = false;
		},
		[],
	);
	const saveKey = async (value: string) => {
		const b = keys();
		if (!b) return toast.error(t("The key can only be saved in the Mac app."));
		if (alive.current) setBusy(true);
		try {
			const r = await b.invoke("gz:keys:set", "kie", value);
			if (!r.ok) throw new Error(r.error || t("The key couldn't be saved."));
			if (alive.current) setKey("");
			await wait(true);
			const c = await checkKieKey();
			if (alive.current) setCheck(c);
			if (!c.ok) toast.error(c.error ?? t("kie.ai didn't accept this key."));
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			if (alive.current) setBusy(false);
		}
	};
	const save = async () => {
		const value = key.trim();
		if (/\s/.test(value) || value.length < 16) return toast.error(t("That doesn't look like a whole kie.ai key. Copy it again."));
		await saveKey(value);
	};
	useSavePendingKey(key, saveKey);
	const recheck = async () => {
		setBusy(true);
		try {
			setCheck(await checkKieKey());
		} finally {
			setBusy(false);
		}
	};
	const clear = async () => {
		setBusy(true);
		try {
			await keys()?.invoke("gz:keys:clear", "kie");
			setCheck(null);
			await wait(false);
		} finally {
			setBusy(false);
		}
	};
	const spentUsd = kie?.spent.total ?? 0;
	return (
		<div className="flex flex-col gap-2 p-3" data-kie-key>
			<div className="flex items-center gap-2 text-sm">
				<span className={cn("size-2 rounded-full", has ? (check?.ok === false ? "bg-amber-500" : "bg-emerald-500") : "bg-muted-foreground/40")} />
				<span className="font-medium">kie.ai</span>
				{has ? <span className="text-muted-foreground tabular-nums">{t("Key saved")} {kie?.hint}</span> : <span className="text-muted-foreground">{t("No key yet")}</span>}
				<span className="flex-1" />
				{check?.ok && check.credits !== undefined && (
					<span className="text-muted-foreground text-xs tabular-nums" data-kie-balance title={t("{credits} credits", { credits: Math.round(check.credits) })}>
						{t("Balance: {usd}", { usd: money(check.credits * CREDIT_USD) })}
					</span>
				)}
				{has && (
					<>
						<Button size="sm" variant="ghost" disabled={busy} onClick={() => void recheck()} data-kie-check>
							{t("Check")}
						</Button>
						<RemoveKeyButton provider="kie.ai" site="kie.ai → API Key" disabled={busy} onConfirm={() => void clear()} data-kie-clear />
					</>
				)}
			</div>
			<div className="flex gap-2">
				<Input type="password" autoComplete="off" spellCheck={false} placeholder={has ? t("Paste a new key") : t("Paste your kie.ai key")} value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void save()} className={cn("flex-1", has && "max-w-[18rem]")} aria-label={t("kie.ai key")} data-kie-key-input />
				<Button disabled={!key.trim() || busy} onClick={() => void save()} data-kie-save>
					{busy && <Spinner className="size-3" />}
					{t("Save key")}
				</Button>
			</div>
			{check && !check.ok && <span className="text-xs text-amber-500">{check.error}</span>}
			{spentUsd > 0 && (
				<span className="text-muted-foreground text-xs tabular-nums" data-kie-spent>
					{t("Spent so far: {usd}", { usd: money(spentUsd) })}
				</span>
			)}
		</div>
	);
}

/** The ArgoLink key, under kie's: saved by the app like it, shown only by its last four characters; its balance (and what running jobs hold) when it works. */
function ArgoKey() {
	const t = useT();
	const argo = useFal((s) => s.status?.argo);
	const [key, setKey] = useState("");
	const [busy, setBusy] = useState(false);
	const [check, setCheck] = useState<{ ok: boolean; error?: string; available?: number; held?: number } | null>(null);
	const has = !!argo?.key;
	const paidArgo = argo?.spent.total ?? 0;
	// The balance is read again when a job on ArgoLink has been paid (the spent total moves).
	// biome-ignore lint/correctness/useExhaustiveDependencies: a paid job is the reason to read again
	useEffect(() => {
		if (has) void checkArgoKey().then(setCheck).catch(() => {});
	}, [has, paidArgo]);
	const wait = async (want: boolean) => {
		for (let i = 0; i < 20; i++) {
			const s = await useFal.getState().refresh();
			if (!!s?.argo.key === want) return;
			await new Promise((res) => setTimeout(res, 150));
		}
	};
	const alive = useRef(true);
	useEffect(
		() => () => {
			alive.current = false;
		},
		[],
	);
	const saveKey = async (value: string) => {
		const b = keys();
		if (!b) return toast.error(t("The key can only be saved in the Mac app."));
		if (alive.current) setBusy(true);
		try {
			const r = await b.invoke("gz:keys:set", "argo", value);
			if (!r.ok) throw new Error(r.error || t("The key couldn't be saved."));
			if (alive.current) setKey("");
			await wait(true);
			const c = await checkArgoKey();
			if (alive.current) setCheck(c);
			if (!c.ok) toast.error(c.error ?? t("ArgoLink didn't accept this key."));
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			if (alive.current) setBusy(false);
		}
	};
	const save = async () => {
		const value = key.trim();
		if (/\s/.test(value) || value.length < 16) return toast.error(t("That doesn't look like a whole ArgoLink key. Copy it again."));
		await saveKey(value);
	};
	useSavePendingKey(key, saveKey);
	const recheck = async () => {
		setBusy(true);
		try {
			setCheck(await checkArgoKey());
		} finally {
			setBusy(false);
		}
	};
	const clear = async () => {
		setBusy(true);
		try {
			await keys()?.invoke("gz:keys:clear", "argo");
			setCheck(null);
			await wait(false);
		} finally {
			setBusy(false);
		}
	};
	const spentUsd = argo?.spent.total ?? 0;
	return (
		<div className="flex flex-col gap-2 p-3" data-argo-key>
			<div className="flex items-center gap-2 text-sm">
				<span className={cn("size-2 rounded-full", has ? (check?.ok === false ? "bg-amber-500" : "bg-emerald-500") : "bg-muted-foreground/40")} />
				<span className="font-medium">ArgoLink</span>
				{has ? <span className="text-muted-foreground tabular-nums">{t("Key saved")} {argo?.hint}</span> : <span className="text-muted-foreground">{t("No key yet")}</span>}
				<span className="flex-1" />
				{check?.ok && check.available !== undefined && (
					<span className="text-muted-foreground text-xs tabular-nums" data-argo-balance>
						{t("Balance: {usd}", { usd: money(check.available) })}
						{(check.held ?? 0) > 0 ? ` · ${t("{usd} held for running jobs", { usd: money(check.held ?? 0) })}` : ""}
					</span>
				)}
				{has && (
					<>
						<Button size="sm" variant="ghost" disabled={busy} onClick={() => void recheck()} data-argo-check>
							{t("Check")}
						</Button>
						<RemoveKeyButton provider="ArgoLink" site="ArgoLink → API keys" disabled={busy} onConfirm={() => void clear()} data-argo-clear />
					</>
				)}
			</div>
			<div className="flex gap-2">
				<Input type="password" autoComplete="off" spellCheck={false} placeholder={has ? t("Paste a new key") : t("Paste your ArgoLink key")} value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void save()} className={cn("flex-1", has && "max-w-[18rem]")} aria-label={t("ArgoLink key")} data-argo-key-input />
				<Button disabled={!key.trim() || busy} onClick={() => void save()} data-argo-save>
					{busy && <Spinner className="size-3" />}
					{t("Save key")}
				</Button>
			</div>
			{check && !check.ok && <span className="text-xs text-amber-500">{check.error}</span>}
			{spentUsd > 0 && (
				<span className="text-muted-foreground text-xs tabular-nums" data-argo-spent>
					{t("Spent so far: {usd}", { usd: money(spentUsd) })}
				</span>
			)}
		</div>
	);
}

function TaskRow({ task, title, note }: { task: FalTask; title: string; note: string }) {
	const t = useT();
	const status = useFal((s) => s.status);
	// The models of every API with a key, in one list (a task only fal has stays on fal's list).
	const keys = useKeys();
	// (in modelsFor's order: cheapest first)
	const byId = new Map((status?.models ?? []).map((m) => [m.id, m]));
	const models = modelsFor(task, keys).flatMap((m) => byId.get(m.id) ?? []);
	const anyKey = !!keys && (keys.fal || keys.kie || !!keys.argo);
	// (no key at all: every API's models, so each row says which API it is; with keys: the rows of an API without one say so)
	const both = manyKeys(keys) || !anyKey;
	const on = onOffer(keys);
	const chosen = status?.choices?.[task];
	const [custom, setCustom] = useState("");
	const pick = (id: string) =>
		useFal
			.getState()
			.choose(task, id)
			.catch((e) => toast.error((e as Error).message));
	const isCustom = task === "llm" && chosen && !models.some((m) => m.id === chosen);
	return (
		<div className="flex flex-col gap-2 px-3 py-2.5" data-fal-task={task}>
			{/* the task's name only: its description was a second line saying what the name says (W11) */}
			<span className="text-sm font-medium" title={t(note)}>
				{t(title)}
			</span>
			<div className="grid grid-cols-1 gap-1.5 @min-[32rem]:grid-cols-2 sm:grid-cols-2">
				{models.map((m) => (
					<ModelChip key={m.id} model={m} live={m.live} where={both || (anyKey && !on.includes(apiOf(m))) ? apiOf(m) : undefined} noKey={anyKey && !on.includes(apiOf(m))} active={chosen === m.id} onPick={() => void pick(m.id)} />
				))}
			</div>
			{task === "llm" && (
				<div className="flex gap-2">
					<Input
						placeholder={isCustom ? String(chosen) : t("Any OpenRouter model id")}
						value={custom}
						onChange={(e) => setCustom(e.target.value)}
						className="h-8 flex-1 text-xs"
						data-fal-llm-custom
					/>
					<Button size="sm" variant="secondary" disabled={!custom.trim()} onClick={() => void pick(custom.trim()).then(() => setCustom(""))}>
						{t("Use")}
					</Button>
				</div>
			)}
		</div>
	);
}

function ModelChip({ model, live, where, noKey = false, active, onPick }: { model: FalModel; live?: { usd: number; unit: string }; where?: AiApi; noKey?: boolean; active: boolean; onPick: () => void }) {
	const t = useT();
	return (
		<button
			type="button"
			onClick={onPick}
			aria-pressed={active}
			data-fal-model={model.id}
			data-model-no-key={noKey ? apiOf(model) : undefined}
			title={noKey ? t("Needs a {api} key", { api: NAMES[apiOf(model)] }) : undefined}
			className={cn(
				"flex min-w-0 flex-col items-start gap-0.5 rounded-md border px-2.5 py-1.5 text-left transition-colors",
				active ? "border-primary bg-primary/10" : "border-border/60 hover:border-border hover:bg-accent/40",
				noKey && "opacity-60",
			)}
		>
			<span className="flex w-full items-center gap-1.5 text-xs font-medium">
				<span className="truncate">{model.title}</span>
				<span className="text-muted-foreground shrink-0 font-normal">· {model.maker}</span>
				{where && (
					<span className="text-muted-foreground/70 ml-auto shrink-0 font-normal" data-model-api={where}>
						{where}
					</span>
				)}
			</span>
			<span className="text-muted-foreground w-full truncate text-[11px] tabular-nums">{priceLine(model, model.usd, t)}{noKey ? ` · ${t("needs a {api} key", { api: NAMES[apiOf(model)] })}` : ""}</span>
			{live && (
				<span className="text-muted-foreground/80 w-full truncate text-[10px] tabular-nums" title={t("fal's price for your account now")}>
					{t("fal now: {price} per {unit}", { price: usd(live.usd), unit: live.unit })}
				</span>
			)}
		</button>
	);
}
