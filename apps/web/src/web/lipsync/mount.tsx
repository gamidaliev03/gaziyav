// The one call the browser edition makes at start-up: the adapter registered, the upload bridged, the key panel in
// the AI tab. pubdemo: `import { mountBrowserLipsync } from "@/web/lipsync/mount"; mountBrowserLipsync(registerBrowserAi);`
import { mountWebLipsync, type WebAiAdapter } from "./adapter";
import { KeyPanel } from "./key-panel";

const lang = () => (typeof document !== "undefined" && /^en/i.test(document.documentElement.lang) ? "en" : "ru");

export function mountBrowserLipsync(register: (a: WebAiAdapter) => void) {
	return mountWebLipsync(register, { lang, panel: () => <KeyPanel lang={lang()} /> });
}
