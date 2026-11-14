import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n";

/** CapCut's «Move to Trash?»: nothing is lost, the project waits in Trash for 30 days. */
export function TrashProjectDialog({
	isOpen,
	onOpenChange,
	onConfirm,
	projectNames,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
	projectNames: string[];
}) {
	const t = useT();
	const confirmRef = useRef<HTMLButtonElement>(null);
	const count = projectNames.length;
	const what = count === 1 ? `“${projectNames[0]}”` : `${count} projects`;
	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent
				// «Move to Trash» is the window's default button: Return confirms (the project waits in Trash), Esc cancels.
				// Focus must leave the card behind the window, or Return opened that project instead.
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					confirmRef.current?.focus();
				}}
			>
				<DialogHeader>
					<DialogTitle>Move to Trash?</DialogTitle>
				</DialogHeader>
				<DialogBody>
					<DialogDescription>
						<span className="inline-block max-w-[300px] truncate align-bottom">{what}</span>{" "}
						{count === 1 ? t("will stay in Trash for 30 days. You can restore it from there.") : t("will stay in Trash for 30 days. You can restore them from there.")}
					</DialogDescription>
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button ref={confirmRef} variant="destructive" data-testid="confirm-trash" onClick={onConfirm}>
						Move to Trash
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
