"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useEditor } from "@/editor/use-editor";
import { useT } from "@/i18n";
import { pasteAttributes, setPasteAttributeGroups, useAttributesClipboard } from "../attributes-clipboard";
import { ATTRIBUTE_GROUPS, type AttributeGroup } from "../timeline-edits";

/**
 * ⌥⌘V: which parts of the copied clip's look go onto the selected clips (FCP's Paste Attributes). The checkboxes
 * are remembered; ↵ pastes, one ⌘Z undoes it.
 */
export function PasteAttributesDialog() {
	const editor = useEditor();
	const t = useT();
	const { dialogOpen, groups, sourceName } = useAttributesClipboard();
	const close = () => useAttributesClipboard.setState({ dialogOpen: false });
	// From the store, not this render's `groups`: two quick clicks must not undo each other.
	const toggle = (id: AttributeGroup, on: boolean) => {
		const current = useAttributesClipboard.getState().groups.filter((group) => group !== id);
		setPasteAttributeGroups(on ? [...current, id] : current);
	};
	const targets = dialogOpen ? editor.selection.getSelectedElements().length : 0;

	const paste = () => {
		const changed = pasteAttributes(editor, groups);
		close();
		if (changed === 0) toast.info(t("Nothing to paste: the clips already match"));
	};

	return (
		<Dialog open={dialogOpen} onOpenChange={(open) => !open && close()}>
			<DialogContent
				data-paste-attributes=""
				className="max-w-sm"
				onKeyDown={(event) => {
					if (event.key === "Enter" && groups.length > 0) {
						event.preventDefault();
						paste();
					}
				}}
			>
				<DialogHeader>
					<DialogTitle>{t("Paste Attributes")}</DialogTitle>
					<DialogDescription>
						{targets === 1
							? t("From “{name}” onto the selected clip", { name: sourceName })
							: t("From “{name}” onto {n} selected clips", { name: sourceName, n: targets })}
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-2.5 px-6 py-1">
					{ATTRIBUTE_GROUPS.map((group) => (
						<div key={group.id} className="flex items-start gap-2.5">
							<Checkbox
								id={`paste-attribute-${group.id}`}
								data-attribute-group={group.id}
								checked={groups.includes(group.id)}
								onCheckedChange={(checked) => toggle(group.id, checked === true)}
								className="mt-0.5"
							/>
							<label htmlFor={`paste-attribute-${group.id}`} className="flex cursor-pointer flex-col">
								<span className="text-sm">{t(group.label)}</span>
								<span className="text-muted-foreground text-xs">{t(group.hint)}</span>
							</label>
						</div>
					))}
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={close}>
						{t("Cancel")}
					</Button>
					<Button onClick={paste} disabled={groups.length === 0} data-paste-attributes-ok="">
						{t("Paste")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
