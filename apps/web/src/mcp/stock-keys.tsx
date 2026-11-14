"use client";

// Settings → AI: the two optional free keys for stock video (Claude's B-roll): Pexels and Pixabay. One compact row
// each; the key goes to the app (Keychain), never into the page. Without them the search uses Wikimedia Commons.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n";

type Provider = "pexels" | "pixabay";
type Keys = Record<Provider, { key: boolean; hint: string | null }>;
type GzBridge = { invoke: (channel: string, ...args: unknown[]) => Promise<{ ok: boolean; error?: string }> };
const gz = () => (typeof window === "undefined" ? undefined : (window as unknown as { studioApp?: { gz?: GzBridge } }).studioApp?.gz);

const ROWS: Array<{ id: Provider; name: string; hint: string }> = [
	{ id: "pexels", name: "Pexels", hint: "free key at pexels.com/api" },
	{ id: "pixabay", name: "Pixabay", hint: "free key at pixabay.com/api/docs" },
];

const readKeys = () =>
	fetch("/api/mcp/stock/keys", { headers: { "X-Studio": "1" } })
		.then((r) => (r.ok ? (r.json() as Promise<Keys>) : null))
		.catch(() => null);

export function StockKeys() {
	const t = useT();
	const [keys, setKeys] = useState<Keys | null>(null);
	const load = useCallback(async () => setKeys(await readKeys()), []);
	useEffect(() => {
		void load();
	}, [load]);
	return (
		<div className="flex flex-col gap-1.5" data-stock-keys>
			<span className="text-sm font-medium">{t("Stock video for Claude (optional)")}</span>
			{ROWS.map((row) => (
				<KeyRow key={row.id} row={row} state={keys?.[row.id] ?? null} onChange={load} />
			))}
		</div>
	);
}

function KeyRow({ row, state, onChange }: { row: (typeof ROWS)[number]; state: Keys[Provider] | null; onChange: () => Promise<void> }) {
	const t = useT();
	const [value, setValue] = useState("");
	const [busy, setBusy] = useState(false);
	// The server learns the key a moment after the app saved it: wait for it.
	const until = async (want: boolean) => {
		for (let i = 0; i < 20; i++) {
			const k = await readKeys();
			if (!!k?.[row.id].key === want) break;
			await new Promise((r) => setTimeout(r, 150));
		}
		await onChange();
	};
	const save = async () => {
		const key = value.trim();
		const b = gz();
		if (!b) return toast.error(t("The key can only be saved in the Mac app."));
		setBusy(true);
		try {
			const r = await b.invoke("gz:keys:set", row.id, key);
			if (!r.ok) throw new Error(r.error || t("The key couldn't be saved."));
			setValue("");
			await until(true);
		} catch (error) {
			toast.error((error as Error).message);
		} finally {
			setBusy(false);
		}
	};
	const clear = async () => {
		setBusy(true);
		try {
			await gz()?.invoke("gz:keys:clear", row.id);
			await until(false);
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="flex items-center gap-2 text-sm" data-stock-key={row.id}>
			<span className="w-16 shrink-0">{row.name}</span>
			{state?.key ? (
				<>
					<span className="text-muted-foreground flex-1 tabular-nums" data-stock-key-hint>
						{state.hint}
					</span>
					<Button size="sm" variant="ghost" disabled={busy} onClick={() => void clear()} data-stock-key-clear>
						{t("Remove")}
					</Button>
				</>
			) : (
				<>
					<Input type="password" autoComplete="off" spellCheck={false} placeholder={t(row.hint)} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && value.trim() && void save()} className="h-7 flex-1 text-xs" aria-label={t("{name} key", { name: row.name })} data-stock-key-input />
					<Button size="sm" disabled={!value.trim() || busy} onClick={() => void save()} data-stock-key-save>
						{t("Save key")}
					</Button>
				</>
			)}
		</div>
	);
}
