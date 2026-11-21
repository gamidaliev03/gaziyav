// The locale dates and times are written in: the interface's language, not the Mac's (a Russian window on an English
// Mac said «Nov 21, 07:11 PM»). English is the 24-hour, day-first British form the rest of the app writes.
import { useLang } from "./index";

export const uiLocale = (): string => {
	const lang = useLang.getState().lang;
	return lang === "en" ? "en-GB" : lang || "en-GB";
};
