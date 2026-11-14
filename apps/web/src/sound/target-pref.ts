// The chosen loudness target is the app's «Target loudness» (Settings → Edit, settings/app-prefs): the meter's own
// picker writes that same value, so Export → Even loudness, the meter and «Bring to target» all aim at one number.
import { useAppPrefs } from "@/settings/app-prefs";
import { cleanTarget } from "./targets";

/** The target in force (LUFS). */
export const currentTarget = () => cleanTarget(useAppPrefs.getState().targetLufs);
export const setTarget = (lufs: number) => useAppPrefs.getState().setPrefs({ targetLufs: cleanTarget(lufs) });
/** The target, for a component (it follows the setting). */
export const useTarget = () => cleanTarget(useAppPrefs((s) => s.targetLufs));
