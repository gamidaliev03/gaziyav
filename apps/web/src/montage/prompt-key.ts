// The composition prompt's Return: it asks Gaziyav AI (as the Generate / Apply button does), Shift+Return is a new
// line, and the Return that ends an IME composition (Chinese, Japanese: it picks the word) never sends. Pure.

export interface PromptKey {
	key: string;
	shiftKey?: boolean;
	altKey?: boolean;
	/** KeyboardEvent.isComposing (React: event.nativeEvent.isComposing). */
	isComposing?: boolean;
	/** 229: the key went to the IME (Safari ends a composition with a keydown that isn't marked composing). */
	keyCode?: number;
}

export function sendsPrompt(e: PromptKey): boolean {
	return e.key === "Enter" && !e.shiftKey && !e.altKey && !e.isComposing && e.keyCode !== 229;
}
