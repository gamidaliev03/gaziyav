// How Gaziyav posts through a service's own website, inside its Share window (the Mac app's main process runs these
// site with every selector in it: when a site changes its page, the fix is a selector here, nothing else.
//
// A Find is tried in order; the first visible match wins. css: a CSS selector · text: a regular expression for the
// element's own text (buttons, links, menu items) · aria: a regular expression for aria-label / title / placeholder.
// Shadow roots are searched too.

export interface Find {
	css?: string;
	text?: string;
	aria?: string;
}

/** What a typing step writes: the YouTube title, or the description / caption with the hashtags. */
export type Field = "title" | "caption";

export type Step =
	| { do: "goto"; url: string; label: string }
	| { do: "click"; find: Find[]; label: string; optional?: boolean; timeout?: number }
	| { do: "file"; find: Find[]; label: string; timeout?: number }
	| { do: "type"; find: Find[]; value: Field; label: string; optional?: boolean; timeout?: number }
	/** Clicks the option of the post's «Who can watch» (public / unlisted / private). */
	| { do: "privacy"; options: Record<"public" | "unlisted" | "private", Find[]>; label: string; optional?: boolean }
	/** Waits until the page shows one of these (an element, or text in the page). */
	| { do: "wait"; find?: Find[]; text?: string; label: string; optional?: boolean; timeout?: number }
	/** The button that publishes. After it, a failure leaves the window to the person (nothing is pressed twice). */
	| { do: "publish"; find: Find[]; label: string; timeout?: number };

export interface SiteRecipe {
	id: "youtube" | "instagram" | "tiktok";
	name: string;
	/** Where Connect opens (the site's own sign-in). */
	login: string;
	/** Signed in = one of these cookies is set for `url`. */
	signedIn: { url: string; cookies: string[] };
	/** Where Disconnect forgets the session (cookies and storage of these origins). */
	origins: string[];
	/** The account's name and picture, read once after signing in (`strip`: a pattern cut from the name, e.g. «'s profile picture»). */
	profile: { url: string; name: Find[]; avatar?: Find[]; strip?: string; json?: { url: string; name: string; avatar?: string } };
	/** A page at one of these addresses means the site signed the person out. */
	signedOutUrl: string;
	/** The steps of one post. */
	upload: Step[];
	/** Published: one of these is on the page; `link` is the post's address when the page shows it. */
	done: { find?: Find[]; text?: string; link?: Find[]; fallbackUrl: string; timeout: number };
}
