// The export gate for Claude's path only (export / post through the connector): the last review's hard failures that
// are neither fixed nor waived keep it closed. The user's own Export button never asks. Never throws: a server that
// doesn't answer opens the gate (a review problem must not cost the user the file).
import { EditorCore } from "@/core";

export async function exportGate(): Promise<string | null> {
	const pid = EditorCore.getInstance().project.getActiveOrNull()?.metadata.id;
	if (!pid) return null;
	try {
		const res = await fetch(`/api/production/gate?project=${encodeURIComponent(pid)}`, { headers: { "X-Studio": "1" } });
		const j = (await res.json()) as { blocked?: string | null };
		return j.blocked ?? null;
	} catch {
		return null;
	}
}
