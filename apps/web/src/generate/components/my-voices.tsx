"use client";

// «My voices» (CapCut: Text to speech → My voices → Create voice): voices cloned on this computer, shown as cards of
// the one voice picker (voice-picker.tsx), and «＋ Your voice» — 10–30 s of someone talking (a recording or a video)
// becomes a voice the generator, dubs and lipsync speak with. The voice is kept for good (Application Support/
// Gaziyav/Voices).
import { type RefObject, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/i18n";
import { refreshServer } from "@/studio/client/actions";
import { followJob, type JobState, type SavedVoice, studioApi, uploadOnce } from "@/studio/client/api";
import { useStudioStore } from "@/studio/client/studio-store";

const NO_VOICES: never[] = [];

/** «My voices» on this Mac (read once from the server when nothing is there yet). */
export function useSavedVoices(): SavedVoice[] {
	// One empty list for «no server yet»: a fresh [] on every read made the store re-render forever.
	const voices = useStudioStore((s) => s.server?.voices ?? NO_VOICES);
	const hasServer = useStudioStore((s) => !!s.server);
	useEffect(() => {
		if (!hasServer) void refreshServer();
	}, [hasServer]);
	return voices;
}

/** Asks, then removes one of «My voices»; true when it was removed. */
export async function removeSavedVoice(id: string, t: (s: string) => string): Promise<boolean> {
	if (!window.confirm(t("Remove this voice from My voices?"))) return false;
	useStudioStore.getState().setServer(await studioApi.deleteVoice(id));
	return true;
}

/** «＋ Your voice»: the file picker (opened by the card through `inputRef`), then the name, the consent and Clone. */
export function AddYourVoice({ inputRef, onAdded }: { inputRef: RefObject<HTMLInputElement | null>; onAdded: (id: string) => void }) {
	const t = useT();
	const [file, setFile] = useState<File | null>(null);
	const [name, setName] = useState("");
	const [consent, setConsent] = useState(false);
	const [stage, setStage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const clone = async () => {
		if (!file || stage) return;
		setError(null);
		setStage(t("Sending the recording"));
		try {
			const up = await uploadOnce(`voice-sample:${file.name}:${file.size}:${file.lastModified}`, file);
			const job = await studioApi.startVoiceClone({ fileId: up.fileId, name });
			const show = (s: JobState) => setStage(s.stages.find((x) => x.status === "running")?.title ?? null);
			show(job);
			const end = await followJob(job.id, show);
			if (end.status !== "done") throw new Error(end.error ?? t("The voice wasn't made."));
			const voice = (end.result as { voice: SavedVoice }).voice;
			await refreshServer();
			onAdded(voice.id);
			setFile(null);
			setConsent(false);
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setStage(null);
		}
	};

	return (
		<>
			<input
				ref={inputRef}
				type="file"
				accept="audio/*,video/*"
				hidden
				data-testid="my-voices-file"
				onChange={(e) => {
					const f = e.target.files?.[0];
					e.target.value = "";
					if (!f) return;
					setFile(f);
					setName(f.name.replace(/\.[^.]+$/, ""));
					setError(null);
				}}
			/>
			{file && (
				<div className="flex flex-col gap-2 rounded-md border p-2.5" data-testid="my-voices-clone">
					<span className="text-muted-foreground truncate text-[11px]">{file.name}</span>
					<input
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder={t("Name of the voice")}
						aria-label={t("Name of the voice")}
						className="border-input placeholder:text-muted-foreground h-8 rounded-md border bg-transparent px-2.5 text-xs outline-none focus:border-primary"
					/>
					<label htmlFor="my-voices-consent" className="flex items-start gap-2 text-xs leading-snug">
						<Checkbox id="my-voices-consent" checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-px" />
						{t("This is my voice, or the person agreed to have it cloned")}
					</label>
					<div className="flex gap-1.5">
						<Button size="sm" disabled={!consent || !!stage} onClick={() => void clone()} data-testid="my-voices-run">
							{stage && <Spinner className="size-3" />}
							{t("Clone the voice")}
						</Button>
						<Button size="sm" variant="ghost" disabled={!!stage} onClick={() => setFile(null)}>
							{t("Cancel")}
						</Button>
					</div>
					{stage && <span className="text-muted-foreground text-xs">{stage}</span>}
					{error && <p className="text-destructive text-xs whitespace-pre-wrap">{error.split("\n\nDetails:")[0]}</p>}
				</div>
			)}
		</>
	);
}
