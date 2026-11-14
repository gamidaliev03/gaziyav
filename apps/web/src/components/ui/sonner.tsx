"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";
import { useT } from "@/i18n";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// A routine notice is gone in 2 s; an error stays long enough to read and has a ✕ (a call can still ask otherwise).
const error = toast.error;
toast.error = ((message, data) => error(message, { duration: 6000, closeButton: true, ...data })) as typeof toast.error;

const Toaster = ({ ...props }: ToasterProps) => {
	const { theme = "system" } = useTheme();
	const t = useT();

	return (
		<Sonner
			theme={theme as ToasterProps["theme"]}
			className="toaster group"
			// the notices' region is named in the interface's language (Sonner's own «Notifications» stayed English)
			containerAriaLabel={t("Notifications")}
			// A small notice at the top centre, just under the title bar (over the player's dark top edge, not the
			// picture): bottom-left it covered the timeline's tools and the Media panel while editing (user, 05.11), and
			// over the tracks it took clicks meant for clips.
			position="top-center"
			offset={{ top: 44 }}
			// a narrow window (≤ 600 px) uses Sonner's mobile offsets: the same place there
			mobileOffset={{ top: 44, left: 16, right: 16 }}
			duration={2000}
			// over the player wherever the layout puts it (--player-centre, app/editor/[project_id]/page.tsx); the window's centre elsewhere
			style={{ "--width": "300px", left: "var(--player-centre, 50%)" } as React.CSSProperties}
			// Neutral cards with a coloured icon, not filled green/red slabs: a toast sits over the editor's panels,
			// so it should cover as little and as quietly as possible. Errors keep a red edge.
			toastOptions={{
				classNames: {
					// Padding and gap are marked important: Sonner's own stylesheet is unlayered, so it beats Tailwind's layered
					// utilities, and every notice came out with 16 px of padding (54 px for one line) instead of 8.
					// Never cut off at the bottom of the window: Sonner measures a toast once, as it appears, and a hovered
					// stack takes that height; text that grew after (the Russian translation landing a moment later, a font)
					// ran out of the box at the bottom. The front and the hovered toasts are at least as tall as their text.
					toast:
						"group toast group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border group-[.toaster]:border-border group-[.toaster]:rounded-xl group-[.toaster]:font-sans group-[.toaster]:shadow-lg group-[.toaster]:text-[13px] py-2! px-3! gap-2! data-[front=true]:min-h-fit data-[expanded=true]:min-h-fit",
					// and a long one scrolls inside rather than run past the bottom of the window
					content: "min-w-0 max-h-[calc(100dvh_-_8rem)] overflow-y-auto",
					description: "group-[.toast]:text-muted-foreground",
					// Sonner's own button styles won over these (both buttons came out white): marked important, so the
					// action reads as the main choice and the cancel as the quiet other one.
					actionButton: "bg-primary! text-primary-foreground! font-medium!",
					cancelButton: "bg-transparent! text-muted-foreground! hover:text-foreground!",
					success: "[&_[data-icon]]:text-emerald-400",
					info: "[&_[data-icon]]:text-sky-400",
					warning: "[&_[data-icon]]:text-amber-400",
					error: "group-[.toaster]:border-red-500/50 [&_[data-icon]]:text-red-400",
				},
			}}
			expand={false}
			{...props}
		/>
	);
};

export { Toaster };
