"use client";

// Settings → Services: one row per ability with the service it uses on the right (Gaziyav's own way is each row's
// default, as before), the key each service needs, and «Проверить» answering in one line. The keys of the services are
// kept by the app like the fal.ai key (Settings → AI keeps fal.ai, kie.ai and ArgoLink). A choice acts at once.
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useLang } from "@/i18n";
import type { Ability, Option, Row, Service } from "@/studio/server/providers/registry";
import { useSettingsStore } from "./settings-store";

type Keys = Record<string, { key: boolean; hint: string | null }>;
interface State {
	rows: Row[];
	services: Service[];
	options: Record<Ability, Array<Option & { usable: boolean }>>;
	use: Record<Ability, string>;
	live: Record<Ability, string>;
	keys: Keys;
}
type Line = { ok: boolean; ru: string; en: string };
type GzBridge = { invoke: (channel: string, ...args: unknown[]) => Promise<{ ok: boolean; error?: string }> };
const gz = () => (typeof window === "undefined" ? undefined : (window as unknown as { studioApp?: { gz?: GzBridge } }).studioApp?.gz);
const HEADERS = { "Content-Type": "application/json", "X-Studio": "1" };

async function call<T>(path: string, body?: unknown): Promise<T> {
	const r = await fetch(`/api/services${path}`, body === undefined ? { headers: { "X-Studio": "1" } } : { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
	const j = (await r.json().catch(() => ({}))) as T & { error?: string };
	if (!r.ok) throw new Error(j.error || "—");
	return j;
}

/** The page's words: Russian in the Russian interface, English otherwise. */
function useWords() {
	const ru = useLang((s) => s.lang) === "ru";
	return { ru, w: (r: string, e: string) => (ru ? r : e) };
}

/** The card a group of rows sits on, as the other tabs draw theirs. */
function Group({ title, id, children }: { title: string; id: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-2.5" data-settings-group={id}>
			<h3 className="text-[13px] font-semibold">{title}</h3>
			<div className="bg-foreground/[0.04] flex flex-col divide-y rounded-lg px-3 py-1">{children}</div>
		</section>
	);
}

export function ServicesSection() {
	const { w } = useWords();
	const [state, setState] = useState<State | null>(null);
	const load = useCallback(async () => {
		try {
			setState(await call<State>(""));
		} catch {
			setState(null);
		}
	}, []);
	useEffect(() => {
		void load();
	}, [load]);
	if (!state) return <Spinner className="mx-auto my-8" />;
	return (
		<div className="flex flex-col gap-5" data-settings-services data-no-translate>
			<Group title={w("Что чем делается", "What does what")} id="services-rows">
				{state.rows.map((row) => (
					<AbilityRow key={row.id} row={row} state={state} onState={setState} />
				))}
			</Group>
			<Group title={w("Ключи сервисов", "Service keys")} id="services-keys">
				{state.services.map((s) => (
					<KeyRow key={s.id} service={s} kept={state.keys[s.id]} onChange={load} />
				))}
			</Group>
		</div>
	);
}

/** What an option needs, in a few words: «без ключа», the key it has, or the key to add. */
function keyNote(o: Option & { usable: boolean }, state: State, w: (r: string, e: string) => string): string {
	if (o.free && !o.keys.length) return w("без ключа", "no key");
	const names = o.keys.map((k) => state.services.find((s) => s.id === k)?.name ?? k).join(" / ");
	if (o.free) return o.usable && o.keys.some((k) => state.keys[k]?.key) ? w(`ключ ${names} есть`, `${names} key in`) : w(`без ключа · ключ ${names} снимает лимиты`, `no key · a ${names} key lifts limits`);
	return o.usable ? w(`ключ ${names} есть`, `${names} key in`) : w(`нужен ключ ${names}`, `needs a ${names} key`);
}

function AbilityRow({ row, state, onState }: { row: Row; state: State; onState: (s: State) => void }) {
	const { ru, w } = useWords();
	const options = state.options[row.id];
	const value = state.use[row.id];
	const picked = options.find((o) => o.id === value) ?? options[0];
	const [line, setLine] = useState<Line | null>(null);
	const [busy, setBusy] = useState(false);
	const pick = async (id: string) => {
		setLine(null);
		try {
			onState(await call<State>("/use", { row: row.id, option: id }));
		} catch (error) {
			toast.error((error as Error).message);
		}
	};
	const check = async () => {
		setBusy(true);
		try {
			setLine(await call<Line>("/check", { row: row.id, option: picked.id }));
		} catch {
			setLine({ ok: false, ru: "Не получилось проверить: попробуйте ещё раз.", en: "Couldn't check: try again." });
		} finally {
			setBusy(false);
		}
	};
	// A choice that can't run now (no key yet, or not run by this version) is kept, and the row works Gaziyav's way meanwhile.
	const waiting = state.live[row.id] !== picked.id;
	return (
		<div className="grid grid-cols-[12rem_minmax(0,1fr)] items-start gap-4 py-2.5" data-service-row={row.id}>
			<div className="flex min-w-0 flex-col pt-1">
				<span className="text-sm">{ru ? row.ru.name : row.en.name}</span>
				<span className="text-muted-foreground text-[11px] leading-snug">{ru ? row.ru.note : row.en.note}</span>
			</div>
			<div className="flex min-w-0 flex-col gap-1.5">
				<div className="flex min-w-0 items-center gap-2">
					<Select value={picked.id} onValueChange={(v) => void pick(v)}>
						<SelectTrigger className="h-8 min-w-0 flex-1 text-xs" data-service-trigger={row.id} aria-label={ru ? row.ru.name : row.en.name}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent data-service-options={row.id}>
							{options.map((o) => (
								<SelectItem key={o.id} value={o.id} className="text-xs" disabled={!o.wired} note={o.wired ? keyNote(o, state, w) : w("скоро", "soon")} data-service-option={o.id}>
									{ru ? o.ru : o.en}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Button size="sm" variant="outline" className="h-8 shrink-0" disabled={busy} onClick={() => void check()} data-service-check={row.id}>
						{busy ? <Spinner className="size-3.5" /> : w("Проверить", "Check")}
					</Button>
				</div>
				<p className="text-muted-foreground text-[11px] leading-snug" data-service-key-note={row.id}>
					{keyNote(picked, state, w)}
					{waiting && w(" · пока работает по-газиявски", " · works Gaziyav's way until then")}
				</p>
				{line && (
					<p className={line.ok ? "text-[12px] text-emerald-600 dark:text-emerald-400" : "text-destructive text-[12px]"} data-service-line={row.id}>
						{ru ? line.ru : line.en}
					</p>
				)}
			</div>
		</div>
	);
}

function KeyRow({ service, kept, onChange }: { service: Service; kept: { key: boolean; hint: string | null } | undefined; onChange: () => Promise<void> }) {
	const { ru, w } = useWords();
	const [value, setValue] = useState("");
	const [busy, setBusy] = useState(false);
	const [line, setLine] = useState<Line | null>(null);
	// The server learns a key a moment after the app saved it: wait for it.
	const until = async (want: boolean) => {
		for (let i = 0; i < 20; i++) {
			const s = await call<State>("").catch(() => null);
			if (!!s?.keys[service.id]?.key === want) break;
			await new Promise((r) => setTimeout(r, 150));
		}
		await onChange();
	};
	const save = async () => {
		const b = gz();
		if (!b) return toast.error(w("Ключ сохраняется только в приложении для Mac.", "The key can only be saved in the Mac app."));
		setBusy(true);
		try {
			const r = await b.invoke("gz:keys:set", service.id, value.trim());
			if (!r.ok) throw new Error(w("Это не похоже на целый ключ: скопируйте его ещё раз.", "That doesn't look like a whole key: copy it again."));
			setValue("");
			await until(true);
			setLine(await call<Line>("/check", { service: service.id }));
		} catch (error) {
			toast.error((error as Error).message);
		} finally {
			setBusy(false);
		}
	};
	const clear = async () => {
		setBusy(true);
		try {
			await gz()?.invoke("gz:keys:clear", service.id);
			setLine(null);
			await until(false);
		} finally {
			setBusy(false);
		}
	};
	const check = async () => {
		setBusy(true);
		try {
			setLine(await call<Line>("/check", { service: service.id }));
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="flex flex-col gap-1 py-2" data-service-key={service.id}>
			<div className="flex min-w-0 items-center gap-2 text-sm">
				<a href={service.keysUrl} target="_blank" rel="noreferrer" className="w-36 shrink-0 truncate hover:underline" title={w("Где взять ключ", "Where to get the key")}>
					{service.name}
				</a>
				{service.elsewhere ? (
					<>
						<span className="text-muted-foreground flex-1 text-xs tabular-nums">{kept?.key ? kept.hint : w("нет ключа", "no key")}</span>
						<Button size="sm" variant="ghost" className="h-7" onClick={() => useSettingsStore.getState().setSection("ai")} data-service-key-ai>
							{w("В разделе ИИ", "In the AI tab")}
						</Button>
					</>
				) : kept?.key ? (
					<>
						<span className="text-muted-foreground flex-1 text-xs tabular-nums" data-service-key-hint>
							{kept.hint}
						</span>
						<Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => void check()} data-service-key-check>
							{w("Проверить", "Check")}
						</Button>
						<Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => void clear()} data-service-key-clear>
							{w("Убрать", "Remove")}
						</Button>
					</>
				) : (
					<>
						<Input
							type="password"
							autoComplete="off"
							spellCheck={false}
							placeholder={service.keyless ? w("без ключа; ключ снимает лимиты", "no key needed; a key lifts limits") : (service.hint ? (ru ? service.hint.ru : service.hint.en) : w("вставьте ключ", "paste the key"))}
							value={value}
							onChange={(e) => setValue(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && value.trim() && void save()}
							className="h-7 flex-1 text-xs"
							aria-label={`${service.name} key`}
							data-service-key-input
						/>
						<Button size="sm" className="h-7" disabled={!value.trim() || busy} onClick={() => void save()} data-service-key-save>
							{w("Сохранить", "Save")}
						</Button>
					</>
				)}
			</div>
			{line && (
				<p className={line.ok ? "pl-[9.5rem] text-[12px] text-emerald-600 dark:text-emerald-400" : "text-destructive pl-[9.5rem] text-[12px]"} data-service-key-line={service.id}>
					{ru ? line.ru : line.en}
				</p>
			)}
		</div>
	);
}
