import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";

export function RenameProjectDialog({
	isOpen,
	onOpenChange,
	onConfirm,
	projectName,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: (newName: string) => void;
	projectName: string;
}) {
	const [name, setName] = useState(projectName);
	// Opened by a menu (not by the dialog itself): each time it starts from the project's current name, not from what
	// was typed and cancelled the last time.
	useEffect(() => {
		if (isOpen) setName(projectName);
	}, [isOpen, projectName]);

	const handleOpenChange = (open: boolean) => {
		if (open) {
			setName(projectName);
		}
		onOpenChange(open);
	};

	// A blank name left a card with no title, an empty project menu and an export called "mp4.mp4".
	const trimmedName = name.trim();
	const canRename = trimmedName.length > 0;
	const confirm = () => {
		if (!canRename) return;
		onConfirm(trimmedName);
	};

	return (
		<Dialog open={isOpen} onOpenChange={handleOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Rename project</DialogTitle>
				</DialogHeader>

				<DialogBody className="gap-3">
					<Label>New name</Label>
					<Input
						value={name}
						autoFocus
						onFocus={(e) => e.currentTarget.select()}
						onChange={(e) => setName(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								confirm();
							}
						}}
						placeholder="Enter a new name"
					/>
				</DialogBody>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={(e) => {
							e.preventDefault();
							e.stopPropagation();
							onOpenChange(false);
						}}
					>
						Cancel
					</Button>
					<Button disabled={!canRename} onClick={confirm}>
						Rename
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
