"use client";

// Settings → AI, one section: fal.ai (the key and the model of every AI feature), the light AI that runs on this Mac
// (captions, pauses, cleanup, voice fixes) and connecting Claude (editing in Gaziyav from the Claude app).
import { FalSettings } from "@/fal/components/fal-settings";
import { ClaudeSection } from "@/mcp/claude-section";
import { StockKeys } from "@/mcp/stock-keys";
import { OndeviceSlot } from "./ondevice-slot";
import { SpendLimit } from "@/studio/components/spend-limit";

export function AiSection() {
	return (
		<div className="flex flex-col gap-5" data-settings-ai>
			<FalSettings />
			<SpendLimit />
			<StockKeys />
			<section className="flex flex-col gap-2.5 border-t pt-5" data-settings-group="ondevice">
				<OndeviceSlot />
			</section>
			{true && (
				<section className="flex flex-col gap-2.5 border-t pt-5" data-settings-group="claude">
					<ClaudeSection />
				</section>
			)}
		</div>
	);
}
