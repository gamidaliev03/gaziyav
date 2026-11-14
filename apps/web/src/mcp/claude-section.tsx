"use client";

// Settings → Claude: one button that connects everything this Mac has (Claude for Mac's extension, Claude Code's skill
// and server, the skill file for claude.ai) and one status line. Claude itself stays in its own app.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";

export interface ClaudeStatus {
	version: string;
	claudeInstalled: boolean;
	connectorInstalled: boolean;
	codeInstalled: boolean;
	codeServer: boolean;
	skillInstalled: boolean;
	skillVersion: string | null;
	skillZip: string | null;
}

const HEADERS = { "X-Studio": "1", "Content-Type": "application/json" };

export async function connectClaude(): Promise<ClaudeStatus & { done: string[]; next: string[] }> {
	const r = await fetch("/api/mcp/claude/connect", { method: "POST", headers: HEADERS, body: "{}" });
	const j = (await r.json()) as ClaudeStatus & { done: string[]; next: string[]; error?: string };
	if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
	return j;
}

export const claudeStatusNow = () =>
	fetch("/api/mcp/claude/status", { headers: HEADERS })
		.then((r) => (r.ok ? (r.json() as Promise<ClaudeStatus>) : null))
		.catch(() => null);

export function ClaudeSection() {
	const t = useT();
	const [status, setStatus] = useState<ClaudeStatus | null>(null);
	const [busy, setBusy] = useState(false);
	const [next, setNext] = useState<string[]>([]);

	const load = useCallback(async () => setStatus(await claudeStatusNow()), []);
	useEffect(() => {
		void load();
		// The install happens in Claude's window: check again when the user comes back.
		const again = () => void load();
		window.addEventListener("focus", again);
		return () => window.removeEventListener("focus", again);
	}, [load]);

	const connect = async () => {
		setBusy(true);
		try {
			const j = await connectClaude();
			setStatus(j);
			setNext(j.next);
		} catch (error) {
			toast.error((error as Error).message);
		} finally {
			setBusy(false);
		}
	};

	const parts = !status
		? ["…"]
		: [
				status.claudeInstalled ? (status.connectorInstalled ? t("Claude for Mac ✓") : t("Claude for Mac: not connected")) : t("Claude for Mac isn't installed"),
				...(status.codeInstalled ? [status.skillInstalled && status.codeServer ? t("Claude Code: connected ✓") : t("Claude Code: not connected")] : []),
			];
	const connected = !!status && (status.connectorInstalled || (status.skillInstalled && status.codeServer));

	return (
		<div className="flex flex-col gap-2.5" data-settings-claude>
			<h3 className="text-[0.95rem] font-medium">{t("Claude")}</h3>
			<div className="flex flex-wrap items-center gap-3">
				<Button onClick={connect} disabled={busy || !status} data-claude-connect>
					{connected ? t("Connect again") : t("Connect Claude")}
				</Button>
				<span className="text-muted-foreground text-sm" data-claude-status>
					{parts.join(" · ")}
				</span>
			</div>
			{next.length > 0 && (
				<p className="text-muted-foreground text-xs" data-claude-next>
					{next.map((line) => t(line)).join(" ")}{" "}
					{status?.skillZip && (
						<button type="button" className="text-primary underline-offset-2 hover:underline" data-claude-skill-file onClick={() => void fetch("/api/mcp/claude/reveal-skill", { method: "POST", headers: HEADERS, body: "{}" })}>
							{t("Show the skill file")}
						</button>
					)}
				</p>
			)}
		</div>
	);
}
