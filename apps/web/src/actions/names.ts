// definition's description, and every entry point — the shortcuts table, the clip menu, the toolbar «⋯», the tool
// picker, ⌘K, tooltips — shows that one key, so the names cannot drift apart again. The name a menu shows is the
// description without its trailing «(…)» note («Paste (insert at the playhead…)» → «Paste»).
import { t } from "@/i18n";
import { ACTIONS, type TAction } from "./definitions";

/** The English catalogue key of the action's name. */
export const actionKey = (action: TAction): string => ACTIONS[action].description;

/** A name without its trailing note in brackets. */
export const withoutNote = (text: string): string => text.replace(/\s*\([^()]*\)\s*$/, "");

/** The action's name in the interface language, for a menu row or a tooltip. */
export const actionName = (action: TAction): string => withoutNote(t(actionKey(action)));
