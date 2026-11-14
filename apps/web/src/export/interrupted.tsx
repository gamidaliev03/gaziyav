"use client";

// An export cut short — the app was killed, crashed, lost power, or its page was reloaded — is said at the next start
// and offered again (render, 11.11). Nothing was left under the file's name (export/disk.ts); what the journal kept is
// the export as it was asked for (export/journal.ts), so one press makes the same file; with exports made as a build
// (export/build) the stretches it had rendered are kept too, and that press goes on from where it stopped.
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { t } from "@/i18n";
import { appPrefs } from "@/settings/app-prefs";
import { buildCacheInfo } from "./build/cache-client";
import { buildExportOn } from "./build/switch";
import { type JournalEntry, interruptedExports, journalEnd, noteInterrupted } from "./journal";

type Request = import("@/components/editor/export-button").ExportRequest;
type Entry = JournalEntry<Request>;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const interruptedToastId = (id: string) => `export-interrupted-${id}`;

/** What file an entry makes: two entries of the same project and file are one export pressed twice. */
const fileOf = (entry: Entry) => (entry.request.kind === "video" ? entry.request.delivery.filename : `${entry.request.fileBase}.${entry.request.format}`);

/** The newest entry of each project and file; the older ones end. */
export function newestOfEach(entries: Entry[]): Entry[] {
	const kept = new Map<string, Entry>();
	for (const entry of [...entries].sort((a, b) => a.at - b.at)) {
		const key = `${entry.projectId}\n${fileOf(entry)}`;
		const earlier = kept.get(key);
		if (earlier) journalEnd(earlier.id);
		kept.set(key, entry);
	}
	return [...kept.values()];
}

async function exportAgain(entry: Entry, go: (href: string) => void) {
	const { EditorCore } = await import("@/core");
	const editor = EditorCore.getInstance();
	const open = () => editor.project.getActiveOrNull()?.metadata.id === entry.projectId && !editor.project.getIsLoading() && !editor.media.isLoadingMedia();
	if (!open()) {
		go(`/editor/${entry.projectId}`);
		for (const until = Date.now() + 90_000; !open() && Date.now() < until; ) await sleep(300);
		if (!open()) {
			toast.error(t("Open «{name}» and export it again.", { name: entry.name }));
			return;
		}
		// (the editor's panels and the project's media settle)
		await sleep(1200);
	}
	const { runExportRequest } = await import("@/components/editor/export-button");
	await runExportRequest(editor, entry.name, entry.request);
}

function announce(entry: Entry, go: (href: string) => void) {
	noteInterrupted(entry.projectId, entry.id);
	const resumes = buildExportOn();
	toast(t("The export of «{name}» was interrupted", { name: entry.name }), {
		id: interruptedToastId(entry.id),
		// (with exports made as a build the stretches it rendered are kept: one press goes on from where it stopped)
		description: resumes
			? t("Your project is safe, and nothing was left under the file's name. What was already rendered is kept.")
			: t("Your project is safe, and nothing was left under the file's name."),
		duration: Number.POSITIVE_INFINITY,
		action: { label: resumes ? t("Continue from where it stopped") : t("Export again"), onClick: () => void exportAgain(entry, go) },
		cancel: { label: t("Not now"), onClick: () => journalEnd(entry.id) },
	});
}

let asked = false;

/** Mounted once for the whole app (app/layout.tsx): asks the journal after the page has settled. */
export function InterruptedExports() {
	const router = useRouter();
	useEffect(() => {
		if (asked) return;
		asked = true;
		const timer = window.setTimeout(() => {
			void interruptedExports<Request>().then((entries) => {
				for (const entry of newestOfEach(entries)) announce(entry, (href) => router.push(href));
			});
		}, 1500);
		return () => window.clearTimeout(timer);
	}, [router]);
	// Settings → Draft → «Auto delete cache from N days ago» holds for the kept stretches of exports too: once a launch.
	useEffect(() => {
		const days = appPrefs().cacheDays;
		if (days) void buildCacheInfo({ days });
	}, []);
	return null;
}
