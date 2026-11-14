import { ThemeProvider } from "next-themes";
import Script from "next/script";
import "./globals.css";
import "./skin.css";
import "../themes/themes.css";
import { Toaster } from "../components/ui/sonner";
import { TooltipProvider } from "../components/ui/tooltip";
import { baseMetaData } from "./metadata";
import { SettingsHost } from "@/settings/settings-host";
import { SectionHost } from "@/platform/desktop-sections";
import { InterruptedExports } from "@/export/interrupted";
import localFont from "next/font/local";
import { themeBootScript } from "@/themes/boot";
import { ThemeHost } from "@/themes/theme-host";
import { NoteHost } from "@/notes/note-host";

// Gaziyav's type: Golos Text for the interface, Unbounded for display (both OFL, already bundled for captions).
const uiFont = localFont({
	src: "../../public/fonts/bundled/GolosText.ttf",
	weight: "400 900",
	variable: "--font-golos",
	display: "swap",
});
const displayFont = localFont({
	src: "../../public/fonts/bundled/Unbounded.ttf",
	weight: "200 900",
	variable: "--font-unbounded",
	display: "swap",
});

export const metadata = baseMetaData;

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" className={`${uiFont.variable} ${displayFont.variable}`} suppressHydrationWarning>
			<head>
				{/* Inside the Mac app: mark the page so the header leaves room for the window buttons. */}
				<script
					// biome-ignore lint/security/noDangerouslySetInnerHtml: static one-liner
					dangerouslySetInnerHTML={{
						__html: "if(window.studioApp)document.documentElement.classList.add('studio-desktop')",
					}}
				/>
				{/* The chosen look (Settings → Appearance) before the first paint: src/themes/boot.ts */}
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: the theme's boot script, made on the server */}
				<script dangerouslySetInnerHTML={{ __html: themeBootScript() }} />
				{process.env.NODE_ENV === "development" && (
					<>
						<Script
							src="//unpkg.com/react-scan/dist/auto.global.js"
							crossOrigin="anonymous"
							strategy="beforeInteractive"
						/>
					</>
				)}
			</head>
			<body className="font-sans antialiased">
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					disableTransitionOnChange={true}
				>
					<TooltipProvider>
						<Toaster />
						{children}
						<SectionHost />
						<SettingsHost />
						<ThemeHost />
						<InterruptedExports />
						<NoteHost />
					</TooltipProvider>
				</ThemeProvider>
			</body>
		</html>
	);
}
