"use client";

// Settings → Share: where Share → Post publishes — through Late (getlate.dev, now Zernio) only: one API key (checked
// with Late before it is kept), then Connect opens the platform's own sign-in and permission screen in a Gaziyav
// window (it closes by itself) and the account is listed here. (The old way — the site itself in a Share window with
// its buttons pressed in the background — is gone: log in once, then one press posts.)
import { InstagramIcon, TiktokIcon, YoutubeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/i18n";
import { cn } from "@/utils/ui";
import { PLATFORM_LABEL, type Platform } from "../caption";
import { canUseLate, clearLateKey, connectLate, disconnectLate, saveLateKey, useShare, watchShare } from "../client";
import { LATE_KEYS_URL, LATE_PLATFORMS, type LateAccount } from "../late";

const CONNECT_LABEL: Record<Platform, string> = {
	youtube: "Connect YouTube",
	instagram: "Connect Instagram",
	tiktok: "Connect TikTok",
};
const PLATFORM_NAME: Record<Platform, string> = {
	youtube: "YouTube",
	instagram: "Instagram",
	tiktok: "TikTok",
};

/** The site's mark in the circle until an account (with its picture) is connected. */
const PLATFORM_MARK: Record<Platform, { icon: typeof YoutubeIcon; tint: string }> = {
	youtube: { icon: YoutubeIcon, tint: "text-[#ff3d3d]" },
	instagram: { icon: InstagramIcon, tint: "text-[#e1306c]" },
	tiktok: { icon: TiktokIcon, tint: "text-foreground" },
};

const toastError = (error: unknown) => {
	const detail = (error as { detail?: string }).detail;
	toast.error((error as Error).message, detail ? { description: detail } : undefined);
};

export function Avatar({ platform, src, size = "size-8" }: { platform: Platform; src?: string; size?: string }) {
	// biome-ignore lint/performance/noImgElement: the account's picture lives at the service (a remote URL, no Next image config)
	if (src) return <img src={src} alt="" className={cn(size, "shrink-0 rounded-full object-cover")} referrerPolicy="no-referrer" />;
	return (
		<div className={cn("bg-foreground/[0.07] flex shrink-0 items-center justify-center rounded-full", size, PLATFORM_MARK[platform].tint)} data-share-mark={platform}>
			<HugeiconsIcon icon={PLATFORM_MARK[platform].icon} className="size-4" />
		</div>
	);
}

export function ShareSettings() {
	useEffect(() => {
		const stop = watchShare(true);
		void useShare.getState().refresh(true);
		return stop;
	}, []);
	return (
		<div className="flex flex-col gap-6" data-settings-share>
			<LateSettings />
		</div>
	);
}

/**
 * The Late key field (here, and the Post sheet's one step before the first post). Save asks Late first: a key it
 * refuses is not kept, and why stays under the field in plain words (a wrong key was saved and shown as «Key saved
 * …0000», with «Paste it again in Settings → Share» while the person was there).
 */
export function LateKeyForm({ replacing = false }: { replacing?: boolean }) {
	const t = useT();
	const [key, setKey] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<{ message: string; detail?: string } | null>(null);

	const save = async () => {
		const value = key.trim();
		setError(null);
		if (!value) return setError({ message: t("Paste the key first.") });
		if (/\s/.test(value) || value.length < 16) return setError({ message: t("That doesn't look like a whole Late API key. Copy it again.") });
		setBusy(true);
		try {
			const view = await saveLateKey(value);
			setKey("");
			// (a saved key Late has trouble with shows its line next to the key, from the state)
			if (!view?.error) toast.success(t("Late key saved and working"));
		} catch (e) {
			setError({ message: (e as Error).message, detail: (e as { detail?: string }).detail });
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="flex flex-col gap-1.5" data-late-key-form>
			<div className="flex gap-2">
				<Input
					type="password"
					autoComplete="off"
					spellCheck={false}
					placeholder={replacing ? t("Paste a new key to replace it") : t("Paste your Late API key")}
					value={key}
					onChange={(e) => {
						setKey(e.target.value);
						setError(null);
					}}
					onKeyDown={(e) => e.key === "Enter" && !busy && void save()}
					className="flex-1"
					aria-label={t("Late API key")}
					aria-invalid={!!error}
					data-late-key-input
				/>
				<Button disabled={!key.trim() || busy || !canUseLate()} onClick={() => void save()} data-late-save>
					{busy && <Spinner className="size-3" />}
					{busy ? t("Checking…") : t("Save")}
				</Button>
			</div>
			{error && (
				<span className="text-destructive text-xs" data-late-key-error>
					{error.message}
				</span>
			)}
			{error?.detail && (
				<span className="text-muted-foreground text-[11px] break-words" data-no-translate>
					{error.detail}
				</span>
			)}
			{!canUseLate() && <span className="text-muted-foreground text-xs">{t("Posting works in the Gaziyav app.")}</span>}
		</div>
	);
}

function LateSettings() {
	const t = useT();
	const late = useShare((s) => s.state?.late ?? null);
	const [busy, setBusy] = useState<string | null>(null);

	const run = async (what: string, action: () => Promise<unknown>) => {
		setBusy(what);
		try {
			await action();
		} catch (error) {
			toastError(error);
		} finally {
			setBusy(null);
		}
	};

	const byPlatform = (p: Platform) => (late?.accounts ?? []).filter((a) => a.platform === p);

	return (
		<section className="flex flex-col gap-3" data-settings-group="late" data-share-late>
			<h3 className="text-[0.95rem] font-medium">{t("Posting through Late")}</h3>
			<div className="flex flex-col gap-2 rounded-lg border p-3" data-late-key>
				<div className="flex items-center gap-2 text-sm">
					<span className={cn("size-2 rounded-full", late?.key ? (late.error ? "bg-amber-500" : "bg-emerald-500") : "bg-muted-foreground/40")} />
					{late?.key ? (
						<span>
							{t("Key saved")} <span className="text-muted-foreground tabular-nums">{late.hint}</span>
						</span>
					) : (
						<span className="text-muted-foreground">{t("No key yet")}</span>
					)}
					<span className="flex-1" />
					{late?.key && (
						<Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void run("clear", clearLateKey)} data-late-clear>
							{t("Remove")}
						</Button>
					)}
				</div>
				<LateKeyForm replacing={!!late?.key} />
				{late?.error && (
					<span className="text-xs text-amber-500" data-late-error>
						{t(late.error)}
					</span>
				)}
				<span className="text-muted-foreground text-xs">
					{t("Get a key in Late's dashboard → API keys.")}{" "}
					<button type="button" className="text-primary underline" onClick={() => window.open(LATE_KEYS_URL, "_blank")} data-late-get-key>
						{t("Open Late's dashboard")}
					</button>{" "}
					{t("It is stored encrypted in the Mac's Keychain and never shown again.")}
				</span>
			</div>

			{late?.key &&
				LATE_PLATFORMS.map((p) => (
					<div key={p} className="flex flex-col gap-2 border-t pt-3" data-late-platform={p}>
						<div className="flex items-center gap-3">
							<Avatar platform={p} />
							<span className="flex-1 text-sm font-semibold">{PLATFORM_LABEL[p]}</span>
							<Button size="sm" variant={byPlatform(p).length ? "secondary" : "default"} disabled={!!busy || !canUseLate()} onClick={() => void run(`connect:${p}`, () => connectLate(p))} data-late-connect={p}>
								{busy === `connect:${p}` ? <Spinner className="size-3" /> : null}
								{busy === `connect:${p}` ? t("Signing in…") : t(CONNECT_LABEL[p])}
							</Button>
						</div>
						{byPlatform(p).map((a) => (
							<AccountRow key={a.id} account={a} busy={!!busy} onReconnect={() => void run(`connect:${p}`, () => connectLate(p, a.id))} onDisconnect={() => void run(`off:${a.id}`, () => disconnectLate(a.id))} />
						))}
						{!byPlatform(p).length && (
							<span className="text-muted-foreground pl-11 text-xs" data-late-none={p}>
								{t("No {name} account connected yet.", {
									name: PLATFORM_NAME[p],
								})}
							</span>
						)}
						{p === "instagram" && <span className="text-muted-foreground pl-11 text-[11px]">{t("Instagram posts need a professional account (Business or Creator).")}</span>}
					</div>
				))}
		</section>
	);
}

function AccountRow({ account, busy, onReconnect, onDisconnect }: { account: LateAccount; busy: boolean; onReconnect: () => void; onDisconnect: () => void }) {
	const t = useT();
	return (
		<div className="flex items-center gap-3 pl-11" data-late-account={account.id} data-late-account-platform={account.platform}>
			<Avatar platform={account.platform} src={account.avatar} size="size-6" />
			<div className="min-w-0 flex-1">
				<div className="truncate text-sm" data-no-translate data-late-account-name>
					{account.name}
				</div>
				<div className={cn("truncate text-xs", account.reconnect ? "text-amber-500" : "text-muted-foreground")}>
					{account.reconnect ? t("The sign-in has expired: connect it again.") : account.username ? `@${account.username.replace(/^@/, "")}` : t("Connected")}
				</div>
			</div>
			{account.reconnect && (
				<Button size="sm" disabled={busy} onClick={onReconnect} data-late-reconnect={account.id}>
					{t("Reconnect")}
				</Button>
			)}
			<Button size="sm" variant="secondary" disabled={busy} onClick={onDisconnect} data-late-disconnect={account.id}>
				{t("Disconnect")}
			</Button>
		</div>
	);
}
