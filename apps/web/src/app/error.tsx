"use client";

import { CrashScreen } from "@/reliability/crash-screen";

export default function RouteError(props: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	return <CrashScreen {...props} />;
}
