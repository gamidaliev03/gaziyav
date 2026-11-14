"use client";
// The layout switch (mobile, 14.11): inside the editor's EditorProvider, the desktop arrangement or the touch one.
// Only the browser edition can switch (NEXT_PUBLIC_GAZIYAV_DEMO=1); the Mac app never asks — with this file unused,
// or in the app, the editor renders exactly as before.
//
// NOT WIRED YET (round 2, with pubsite: their layer patches app/editor/[project_id]/page.tsx by anchors tonight). The
// wiring is one wrap of the page's body:
//     <DeviceSwitch desktop={<>…the current header + EditorLayout…</>} />
import type { ReactNode } from "react";
import { useDeviceClass } from "../device-class";
import { PhoneEditor } from "./phone-editor";

const BROWSER_EDITION = process.env.NEXT_PUBLIC_GAZIYAV_DEMO === "1";

export function DeviceSwitch({ desktop }: { desktop: ReactNode }) {
	const device = useDeviceClass();
	if (!BROWSER_EDITION || device === "desktop") return <>{desktop}</>;
	return <PhoneEditor tablet={device === "tablet"} />;
}
