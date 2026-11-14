"use client";

// «✦ Balance» in the mixer's head: how far the music goes under words, and the one button that does the mix.
import { AiMagicIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { useEditor } from "@/editor/use-editor";
import { useT } from "@/i18n";
import { runBalance } from "../actions";
import { useTarget } from "../target-pref";
import { formatTarget } from "../targets";
import { Ring, Seal } from "../ui";
import { useSoundUi } from "../ui-store";
import { DUCK_CHOICES } from "./plan";
import { cancelBalance, useBalance } from "./run";

export function BalanceButton() {
	const editor = useEditor();
	const t = useT();
	const [open, setOpen] = useState(false);
	const target = useTarget();
	const duckDb = useSoundUi((s) => s.duckDb);
	const setDuckDb = useSoundUi((s) => s.setDuckDb);
	const progress = useBalance((s) => s.progress);
	const stage = useBalance((s) => s.stage);
	const busy = progress !== null;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="sm" className="h-6 shrink-0 gap-1 px-1.5 text-xs" data-balance-open="" aria-label={t("Balance the mix")} title={t("Balance the mix: voice, music and effects set against each other")}>
					{busy ? <Ring progress={progress ?? 0} /> : <HugeiconsIcon icon={AiMagicIcon} className="text-primary size-3.5!" />}
					{t("Balance")}
				</Button>
			</PopoverTrigger>
			<PopoverContent side="top" align="end" sideOffset={6} collisionPadding={8} className="w-[320px] p-0" data-balance-panel="">
				<div className="flex flex-col text-xs">
					<div className="flex flex-col gap-1 px-3 pt-3 pb-2.5">
						<span className="text-[13px] font-medium">{t("Balance the mix")}</span>
						<span className="text-muted-foreground text-[11px] leading-snug">{t("The voice goes to {lufs} LUFS and is evened between clips; the music steps down under the words; effects find their place. All as values and keyframes on the faders.", { lufs: formatTarget(target) })}</span>
					</div>
					<div className="flex flex-col gap-1.5 border-t px-3 py-2.5">
						<span className="text-muted-foreground text-[11px]">{t("Music under words, dB")}</span>
						<Segmented
							aria-label={t("Music under words, dB")}
							value={String(duckDb)}
							onValueChange={(value) => setDuckDb(Number(value))}
							items={DUCK_CHOICES.map((db) => ({ value: String(db), label: `−${db}` }))}
							itemProps={(id) => ({ "data-balance-duck": id })}
						/>
					</div>
					<div className="flex min-h-[46px] items-center justify-between gap-2 border-t px-3 py-2.5">
						{busy ? (
							<>
								<span className="flex min-w-0 flex-1 items-center gap-2" data-balance-busy="">
									<Ring progress={progress ?? 0} />
									<span className="min-w-0 truncate">
										{t(stage || "Listening to the clips")} · <span className="tabular-nums">{Math.round((progress ?? 0) * 100)} %</span>
									</span>
								</span>
								<Button variant="ghost" size="sm" className="h-6 px-2 text-xs" data-balance-cancel="" onClick={cancelBalance}>
									{t("Cancel")}
								</Button>
							</>
						) : (
							<>
								<Seal />
								<Button
									size="sm"
									className="h-7 px-3 text-xs"
									data-balance-run=""
									onClick={() => {
										void runBalance(editor).then((result) => {
											if (result) setOpen(false);
										});
									}}
								>
									{t("Balance the mix")}
								</Button>
							</>
						)}
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
