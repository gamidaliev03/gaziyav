// «Add to Home Screen» for the browser edition (mobile, 14.11) — what pubsite's app/layout.demo.tsx should carry (round
// 2: one merge into their `metadata` / `viewport`; their file is theirs tonight). As Next's Metadata / Viewport so the
// tags come out exactly as below.
//
//   <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
//   <meta name="theme-color" content="#0b0a09">
//   <meta name="apple-mobile-web-app-capable" content="yes">            (Next writes the older and the newer name)
//   <meta name="mobile-web-app-capable" content="yes">
//   <meta name="apple-mobile-web-app-title" content="Gaziyav">
//   <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
//   <link rel="apple-touch-icon" href="../icons/apple-touch-icon.png">  (180 × 180, opaque, no transparency)
//   <link rel="manifest" href="manifest.webmanifest">                     (already there: display standalone)
//
// iOS: the Home Screen icon comes from apple-touch-icon (the manifest's icons are a fallback since iOS 16.4); since
// iOS 26 every site added to the Home Screen opens as a web app by default. Splash: iOS draws the manifest's
// background_color with the icon (no apple-touch-startup-image set needed). No install prompt on iOS: the visitor uses
// Share → Add to Home Screen — the editor shows a one-line hint on the first phone visit (round 2). Android Chrome:
// the manifest + the service worker make it installable; it offers the install itself.
// `user-scalable=no` is NOT set (iOS ignores it, and it hurts accessibility): the editor blocks page zoom only where a
// gesture is the editor's own (touch-action on the timeline / player).
import type { Metadata, Viewport } from "next";

export const MOBILE_VIEWPORT: Viewport = {
	width: "device-width",
	initialScale: 1,
	viewportFit: "cover",
	interactiveWidget: "resizes-content",
	themeColor: "#0b0a09",
};

export const MOBILE_METADATA: Metadata = {
	appleWebApp: { capable: true, title: "Gaziyav", statusBarStyle: "black-translucent" },
	icons: { apple: [{ url: "../icons/apple-touch-icon.png", sizes: "180x180" }] },
	other: { "mobile-web-app-capable": "yes" },
};
