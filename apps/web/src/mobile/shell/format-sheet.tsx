"use client";
// The «Format» sheet (mobile, 14.11): the project's frame — 9:16 first (Reels / Shorts / TikTok), then 4:5, 1:1, 16:9.
// One UpdateProjectSettingsCommand per tap: the same command the desktop's project settings run, one undo step.
import { UpdateProjectSettingsCommand } from "@/commands/project/update-project-settings";
import { useEditor } from "@/editor/use-editor";
import { useT } from "@/i18n";

export const FORMATS = [
	{ id: "9:16", label: "9:16 · Reels", width: 1080, height: 1920 },
	{ id: "4:5", label: "4:5 · Feed", width: 1080, height: 1350 },
	{ id: "1:1", label: "1:1", width: 1080, height: 1080 },
	{ id: "16:9", label: "16:9 · YouTube", width: 1920, height: 1080 },
] as const;

export function FormatSheet() {
	const t = useT();
	const editor = useEditor();
	const size = useEditor((e) => e.project.getActive()?.settings.canvasSize ?? null);
	return (
		<div className="grid grid-cols-2 gap-2 p-3">
			{FORMATS.map((f) => {
				const on = size?.width === f.width && size?.height === f.height;
				return (
					<button
						key={f.id}
						type="button"
						className="gz-hit border-border rounded-xl border px-3 py-4 text-sm data-[on]:border-primary"
						data-on={on ? "" : undefined}
						onClick={() =>
							editor.command.execute({
								command: new UpdateProjectSettingsCommand({ canvasSize: { width: f.width, height: f.height }, canvasSizeMode: "preset" }),
							})
						}
					>
						{t(f.label)}
					</button>
				);
			})}
		</div>
	);
}
