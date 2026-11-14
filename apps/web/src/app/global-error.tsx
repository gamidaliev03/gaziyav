"use client";

import "./globals.css";
import { CrashScreen } from "@/reliability/crash-screen";

export default function GlobalError(props: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	return (
		<html lang="en">
			<body className="font-sans antialiased">
				<CrashScreen {...props} />
			</body>
		</html>
	);
}
