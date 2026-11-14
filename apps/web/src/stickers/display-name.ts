/** File names as tile names: «chat_bubble» and «comment» read «Chat Bubble» and «Comment» like the built-in ones.
 * A name that already has capitals («iPhone frame», «CTA») is the author's spelling and stays as it is. */
export function displayName(name: string): string {
	const words = name.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
	if (words !== words.toLowerCase()) return words;
	return words.replace(/(^|\s)\p{L}/gu, (letter) => letter.toUpperCase());
}
