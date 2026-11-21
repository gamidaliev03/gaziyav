// Ready-made motion graphics (Templates → Motion graphics): bumpers, intros and logo reveals, end screens, kinetic
// type, product and sale, CTAs, counters, infographics, social proof. Each is a Remotion layer of the motion kit
// (src/montage/remotion/mograph/*) placed on the timeline like an AI layer, but drawn by our own code: no AI, no
// paid credits. Every field shows in the inspector; the layout follows the frame (9:16, 16:9, 1:1).
// Free of Remotion imports: loaded by the editor core (catalog.ts).
import type { ParamDefinition } from "@/params";

type Field = ParamDefinition;

const text = (key: string, label: string, def: string): Field => ({
	key,
	label,
	type: "text",
	default: def,
});
const num = (
	key: string,
	label: string,
	def: number,
	min: number,
	max: number,
	step: number,
): Field => ({ key, label, type: "number", default: def, min, max, step });
const color = (key: string, label: string, def: string): Field => ({
	key,
	label,
	type: "color",
	default: def,
});
const bool = (key: string, label: string, def: boolean): Field => ({
	key,
	label,
	type: "boolean",
	default: def,
});

/** The open-licensed (OFL) fonts the kit ships, in both the preview and the export (src/montage/remotion/fonts.ts). */
export const MOGRAPH_FONTS = [
	"Unbounded",
	"Montserrat",
	"Onest",
	"Manrope",
	"Rubik",
	"GolosText",
	"PlayfairDisplay",
] as const;
const FONT_NAMES: Record<string, string> = {
	GolosText: "Golos Text",
	PlayfairDisplay: "Playfair Display",
};
const font = (def: (typeof MOGRAPH_FONTS)[number] = "Unbounded"): Field => ({
	key: "font",
	label: "Font",
	type: "select",
	default: def,
	options: MOGRAPH_FONTS.map((value) => ({
		value,
		label: FONT_NAMES[value] ?? value,
	})),
});
const select = (key: string, label: string, def: string, options: [string, string][]): Field => ({
	key,
	label,
	type: "select",
	default: def,
	options: options.map(([value, l]) => ({ value, label: l })),
});
const accent = (def = "#FFD23F") => color("accent", "Accent", def);
const second = (def = "#c98a1e") => color("color2", "Second colour", def);
const ink = (def = "#FFFFFF") => color("ink", "Text colour", def);
const bg = (def = "#0B0D12") => color("bg", "Background", def);
const backdrop = (def: boolean) => bool("backdrop", "Show background", def);

const PLACES: [string, string][] = [
	["center", "Centre"],
	["top", "Top"],
	["bottom", "Bottom"],
	["top-left", "Top left"],
	["top-right", "Top right"],
	["bottom-left", "Bottom left"],
	["bottom-right", "Bottom right"],
];
/** A ready-made Lottie placed over the video: size, place, speed, an optional caption, recolour to the accent. */
const stickerFields = (o: { size?: number; place?: string; caption?: string; tint?: boolean; accent?: string } = {}): Field[] => [
	num("size", "Size", o.size ?? 0.5, 0.1, 1.2, 0.01),
	select("place", "Position", o.place ?? "center", PLACES),
	num("speed", "Speed", 1, 0.25, 3, 0.05),
	bool("loop", "Loop", true),
	text("caption", "Caption", o.caption ?? ""),
	font("Montserrat"),
	ink(),
	bool("tint", "Recolour", o.tint ?? false),
	accent(o.accent ?? "#FFD23F"),
];
/** A ready-made Lottie filling the frame (fireworks, confetti, money rain). */
const fillFields = (): Field[] => [
	num("speed", "Speed", 1, 0.25, 3, 0.05),
	bool("loop", "Loop", true),
	num("opacity", "Opacity", 1, 0.1, 1, 0.05),
	bool("tint", "Recolour", false),
	accent("#FFD23F"),
];
/** Google's animated Noto emoji (public/mograph/lottie/emoji-*.json): any of them can stand in for the tile's own. */
export const MOGRAPH_EMOJI: [string, string][] = [
	["emoji-fire", "🔥 Fire"],
	["emoji-joy", "😂 Laughing"],
	["emoji-heart-eyes", "😍 Heart eyes"],
	["emoji-mind-blown", "🤯 Mind blown"],
	["emoji-scream", "😱 Shocked"],
	["emoji-clap", "👏 Clapping"],
	["emoji-hundred", "💯 Hundred"],
	["emoji-party-popper", "🎉 Party popper"],
	["emoji-red-heart", "❤️ Heart"],
	["emoji-thumbs-up", "👍 Thumbs up"],
	["emoji-skull", "💀 Skull"],
	["emoji-partying", "🥳 Party face"],
	["emoji-rocket", "🚀 Rocket"],
	["emoji-money-mouth", "🤑 Money"],
	["emoji-eyes", "👀 Eyes"],
	["emoji-sunglasses", "😎 Cool"],
	["emoji-sparkles", "✨ Sparkles"],
	["emoji-sob", "😭 Crying"],
];
const emojiFields = (def: string): Field[] => [select("emoji", "Emoji", def, MOGRAPH_EMOJI), ...stickerFields({ size: 0.34 })];

/** Content themes: the browser's filter, and the photo each tile is previewed on. */
export const MOGRAPH_THEMES = [
	"gaming",
	"wedding",
	"travel",
	"food",
	"fitness",
	"business",
	"music",
	"beauty",
	"tech",
	"kids",
	"education",
	"news",
	"sports",
	"fashion",
	"real-estate",
] as const;
export type Theme = (typeof MOGRAPH_THEMES)[number];
export const themeName = (t: Theme) => (t === "real-estate" ? "Real estate" : t.charAt(0).toUpperCase() + t.slice(1));
/** The theme's preview photo (public/mograph/themes, sources and licences in sources.json there). */
export const themePhoto = (t: Theme) => `/mograph/themes/${t}.jpg`;

export const MOGRAPH_CATEGORIES = [
	"Bumpers",
	"Intros & logos",
	"Outros",
	"Kinetic type",
	"Product & sale",
	"Call to action",
	"Counters & timers",
	"Infographics",
	"Social proof",
	"Camera & film",
	"News",
	"Social screens",
	"HUD & comic",
	"Particles",
	"Layouts",
	"Stickers",
	"Animated emoji",
	"Light & texture",
	"Arrows & callouts",
	"Widgets",
] as const;

export interface MographKind {
	kind: string;
	label: string;
	category: (typeof MOGRAPH_CATEGORIES)[number];
	/** Seconds on the timeline when added (the animation stretches its hold to the clip's length). */
	dur: number;
	/** A picture from Media the graphic shows (logo, product photo, avatar): kept in the layer's assets. */
	images?: { key: string; label: string }[];
	/** Themes it suits (Templates → Motion graphics filter); the first one picks the tile's preview photo. */
	themes: Theme[];
	/** Second of the animation the tile shows when it isn't hovered (default: once the entrance has played). */
	previewAt?: number;
	/** A ready-made Lottie it plays (public/mograph/lottie/<file>.json, `fill` = covers the frame) and where it came from. */
	lottie?: { file: string; fill?: boolean; source: string; author: string };
	/** Not offered in Templates → Motion (the Animated emoji repeat Stickers → Animated); templates still use it as a layer. */
	hidden?: boolean;
	fields: Field[];
}

export const MOGRAPH_PREFIX = "Mg";
export const isMographKind = (kind: string | undefined) =>
	!!kind?.startsWith(MOGRAPH_PREFIX);

export const MOGRAPH_KINDS: MographKind[] = [
	// ── Bumpers: full-frame stingers between scenes ──
	{
		kind: "MgStripeWipe",
		label: "Stripe wipe",
		category: "Bumpers",
		dur: 1.6,
		themes: ["gaming", "sports", "music", "kids"],
		fields: [
			text("title", "Text", "NEXT UP"),
			font(),
			accent("#FFD23F"),
			second("#FF3D71"),
			color("color3", "Third colour", "#2D7BFF"),
			ink("#0B0D12"),
		],
	},
	{
		kind: "MgCircleBurst",
		label: "Circle burst",
		category: "Bumpers",
		dur: 1.8,
		themes: ["kids", "gaming", "music", "beauty"],
		fields: [
			text("title", "Text", "WOW"),
			font(),
			accent("#FF3D71"),
			second("#FFD23F"),
			ink("#FFFFFF"),
		],
	},
	{
		kind: "MgSplitBumper",
		label: "Split bumper",
		category: "Bumpers",
		dur: 2,
		themes: ["education", "business", "tech", "news"],
		fields: [
			text("title", "Title", "CHAPTER 2"),
			text("sub", "Subtitle", "The big reveal"),
			font("Montserrat"),
			accent("#00E0B8"),
			second("#111827"),
			ink("#FFFFFF"),
		],
	},
	{
		kind: "MgZoomThrough",
		label: "Zoom through",
		category: "Bumpers",
		dur: 1.5,
		themes: ["sports", "gaming", "fitness", "music"],
		fields: [
			text("title", "Text", "BOOM"),
			font(),
			accent("#FFFFFF"),
			bg("#111111"),
		],
	},
	{
		kind: "MgBlockBumper",
		label: "Block flip",
		category: "Bumpers",
		dur: 1.8,
		themes: ["tech", "gaming", "education"],
		fields: [
			text("title", "Text", "MEANWHILE"),
			font("Rubik"),
			accent("#c98a1e"),
			second("#22D3EE"),
			ink("#FFFFFF"),
		],
	},

	// ── Intros & logo reveals ──
	{
		kind: "MgLogoReveal",
		label: "Logo reveal",
		category: "Intros & logos",
		dur: 3.5,
		themes: ["business", "tech", "real-estate", "fashion"],
		images: [{ key: "logo", label: "Logo" }],
		fields: [
			text("name", "Brand", "BRAND"),
			text("tagline", "Tagline", "Made to move"),
			text("monogram", "Letters (no logo)", ""),
			font(),
			accent("#FFD23F"),
			ink("#FFFFFF"),
			bg("#0B0D12"),
			backdrop(true),
		],
	},
	{
		kind: "MgLineReveal",
		label: "Line reveal",
		category: "Intros & logos",
		dur: 3.5,
		themes: ["fashion", "real-estate", "wedding", "business"],
		images: [{ key: "logo", label: "Logo" }],
		fields: [
			text("name", "Brand", "STUDIO NAME"),
			text("tagline", "Tagline", "Since 2026"),
			font("Montserrat"),
			accent("#FFFFFF"),
			ink("#FFFFFF"),
			bg("#101010"),
			backdrop(true),
		],
	},
	{
		kind: "MgCinematicTitle",
		label: "Cinematic title",
		category: "Intros & logos",
		dur: 4,
		themes: ["travel", "wedding", "real-estate", "music"],
		fields: [
			text("title", "Title", "THE JOURNEY"),
			text("sub", "Subtitle", "A film by You"),
			font("PlayfairDisplay"),
			accent("#E8C77A"),
			ink("#FFFFFF"),
			backdrop(false),
		],
	},
	{
		kind: "MgGradientIntro",
		label: "Gradient intro",
		category: "Intros & logos",
		dur: 3.5,
		themes: ["music", "tech", "beauty", "education"],
		fields: [
			text("title", "Title", "Hello, world"),
			text("sub", "Subtitle", "Episode 01"),
			font("Onest"),
			accent("#FF3D71"),
			second("#c98a1e"),
			color("color3", "Third colour", "#22D3EE"),
			ink("#FFFFFF"),
		],
	},

	// ── Outros & end screens ──
	{
		kind: "MgEndScreen",
		label: "End screen",
		category: "Outros",
		dur: 6,
		themes: ["gaming", "education", "tech", "music"],
		images: [{ key: "logo", label: "Channel picture" }],
		fields: [
			text("title", "Title", "Thanks for watching!"),
			text("button", "Button", "SUBSCRIBE"),
			text("next", "Next video", "Watch next"),
			text("more", "Second video", "Best of"),
			font("Montserrat"),
			accent("#FF2E4D"),
			ink("#FFFFFF"),
			bg("#0E1117"),
			backdrop(true),
		],
	},
	{
		kind: "MgLogoOutro",
		label: "Logo outro",
		category: "Outros",
		dur: 4,
		themes: ["business", "real-estate", "fashion", "tech"],
		images: [{ key: "logo", label: "Logo" }],
		fields: [
			text("name", "Brand", "BRAND"),
			text("url", "Website", "brand.com"),
			text("monogram", "Letters (no logo)", ""),
			font(),
			accent("#FFD23F"),
			ink("#FFFFFF"),
			bg("#0B0D12"),
			backdrop(true),
		],
	},
	{
		kind: "MgSocialHandles",
		label: "Social handles",
		category: "Outros",
		dur: 4,
		themes: ["beauty", "fashion", "food", "fitness", "travel"],
		fields: [
			text("title", "Title", "Follow us"),
			text("handle1", "Instagram", "@yourname"),
			text("handle2", "TikTok", "@yourname"),
			text("handle3", "YouTube", "/yourchannel"),
			font("Manrope"),
			accent("#FF3D71"),
			ink("#FFFFFF"),
		],
	},

	// ── Kinetic typography ──
	{
		kind: "MgKineticStack",
		label: "Kinetic stack",
		category: "Kinetic type",
		dur: 3,
		themes: ["fitness", "sports", "music", "gaming"],
		fields: [
			text("line1", "Line 1", "MAKE"),
			text("line2", "Line 2", "IT"),
			text("line3", "Line 3", "POP"),
			font(),
			accent("#FFD23F"),
			ink("#FFFFFF"),
			backdrop(false),
			bg("#0B0D12"),
		],
	},
	{
		kind: "MgWordPop",
		label: "Word by word",
		category: "Kinetic type",
		dur: 3.5,
		themes: ["education", "business", "music"],
		fields: [
			text("text", "Text", "Every word *lands* on the beat"),
			num("pace", "Words per second", 3, 1, 8, 0.5),
			font("Montserrat"),
			accent("#22D3EE"),
			ink("#FFFFFF"),
			backdrop(false),
			bg("#0B0D12"),
		],
	},
	{
		kind: "MgSplitReveal",
		label: "Split reveal",
		category: "Kinetic type",
		dur: 3,
		themes: ["beauty", "fitness", "real-estate"],
		fields: [
			text("title", "Top word", "BEFORE"),
			text("reveal", "Hidden word", "AFTER"),
			font(),
			accent("#FF3D71"),
			ink("#FFFFFF"),
		],
	},
	{
		kind: "MgOutlineFill",
		label: "Outline fill",
		category: "Kinetic type",
		dur: 3,
		themes: ["sports", "fitness", "gaming"],
		fields: [
			text("title", "Text", "UNSTOPPABLE"),
			font(),
			accent("#FFD23F"),
			ink("#FFFFFF"),
		],
	},
	{
		kind: "MgMarquee",
		label: "Marquee",
		category: "Kinetic type",
		dur: 4,
		themes: ["fashion", "music", "food"],
		fields: [
			text("text", "Text", "NEW DROP"),
			font(),
			accent("#FFD23F"),
			ink("#0B0D12"),
			num("speed", "Speed", 1, 0.25, 3, 0.05),
			backdrop(false),
		],
	},

	// ── Product, price, sale ──
	{
		kind: "MgProductShowcase",
		label: "Product showcase",
		category: "Product & sale",
		dur: 5,
		themes: ["tech", "beauty", "fashion", "business"],
		images: [{ key: "photo", label: "Product photo" }],
		fields: [
			text("name", "Product", "Aurora Headphones"),
			text("feat1", "Feature 1", "40 h battery"),
			text("feat2", "Feature 2", "Noise cancelling"),
			text("feat3", "Feature 3", "Fast charge"),
			font("Manrope"),
			accent("#22D3EE"),
			ink("#FFFFFF"),
			bg("#0F172A"),
			backdrop(true),
		],
	},
	{
		kind: "MgPriceTag",
		label: "Price tag",
		category: "Product & sale",
		dur: 4,
		themes: ["food", "fashion", "beauty", "real-estate"],
		fields: [
			text("title", "Title", "Today only"),
			text("price", "Price", "49"),
			text("oldPrice", "Old price", "99"),
			text("currency", "Currency", "$"),
			text("badge", "Badge", "-50%"),
			font(),
			accent("#FFD23F"),
			second("#FF3D71"),
			ink("#FFFFFF"),
		],
	},
	{
		kind: "MgSaleBurst",
		label: "Sale burst",
		category: "Product & sale",
		dur: 3.5,
		themes: ["fashion", "food", "beauty", "kids"],
		fields: [
			text("title", "Title", "SALE"),
			text("discount", "Discount", "-70%"),
			text("sub", "Subline", "This weekend only"),
			font(),
			accent("#FF2E4D"),
			second("#FFD23F"),
			ink("#FFFFFF"),
			backdrop(true),
		],
	},
	{
		kind: "MgNewArrival",
		label: "New arrival",
		category: "Product & sale",
		dur: 4,
		themes: ["fashion", "beauty", "tech"],
		images: [{ key: "photo", label: "Product photo" }],
		fields: [
			text("badge", "Badge", "NEW"),
			text("name", "Product", "Summer Collection"),
			text("sub", "Subline", "Available now"),
			font("Montserrat"),
			accent("#00E0B8"),
			ink("#FFFFFF"),
			backdrop(false),
			bg("#111827"),
		],
	},

	// ── Call to action ──
	{
		kind: "MgSubscribe",
		label: "Subscribe",
		category: "Call to action",
		dur: 4,
		themes: ["gaming", "education", "tech", "music"],
		images: [{ key: "logo", label: "Channel picture" }],
		fields: [
			text("channel", "Channel", "Your Channel"),
			text("button", "Button", "SUBSCRIBE"),
			text("done", "After the click", "SUBSCRIBED"),
			font("Montserrat"),
			accent("#FF2E4D"),
			ink("#FFFFFF"),
		],
	},
	{
		kind: "MgLinkInBio",
		label: "Link in bio",
		category: "Call to action",
		dur: 3.5,
		themes: ["beauty", "fashion", "food", "fitness"],
		fields: [
			text("text", "Text", "Link in bio"),
			text("url", "Link", "shop.yourbrand.com"),
			font("Onest"),
			accent("#FFD23F"),
			ink("#0B0D12"),
		],
	},
	{
		kind: "MgBuyNow",
		label: "Buy now",
		category: "Call to action",
		dur: 3.5,
		themes: ["fashion", "beauty", "tech", "food"],
		fields: [
			text("button", "Button", "BUY NOW"),
			text("sub", "Subline", "Free shipping today"),
			font(),
			accent("#00E0B8"),
			ink("#0B0D12"),
		],
	},
	{
		kind: "MgSwipeUp",
		label: "Swipe up",
		category: "Call to action",
		dur: 3,
		themes: ["fashion", "travel", "beauty"],
		fields: [
			text("text", "Text", "Swipe up"),
			text("sub", "Subline", "to shop the look"),
			font("Montserrat"),
			accent("#FFFFFF"),
			ink("#FFFFFF"),
		],
	},

	// ── Counters & timers ──
	{
		kind: "MgBigCounter",
		label: "Number counter",
		category: "Counters & timers",
		dur: 3.5,
		themes: ["business", "sports", "education"],
		fields: [
			num("value", "Number", 1000000, -1e12, 1e12, 1),
			num("from", "Count from", 0, -1e12, 1e12, 1),
			text("prefix", "Before the number", ""),
			text("suffix", "After the number", "+"),
			text("label", "Label", "happy users"),
			font(),
			accent("#22D3EE"),
			ink("#FFFFFF"),
		],
	},
	{
		kind: "MgCountdown",
		label: "Countdown",
		category: "Counters & timers",
		dur: 3.5,
		themes: ["sports", "fitness", "gaming", "kids"],
		fields: [
			num("from", "Count down from", 3, 1, 60, 1),
			text("go", "Last word", "GO!"),
			font(),
			accent("#FFD23F"),
			ink("#FFFFFF"),
			backdrop(true),
			bg("#0B0D12"),
		],
	},
	{
		kind: "MgOfferTimer",
		label: "Offer timer",
		category: "Counters & timers",
		dur: 5,
		themes: ["fashion", "food", "business"],
		fields: [
			text("title", "Title", "Offer ends in"),
			num("hours", "Hours", 2, 0, 99, 1),
			num("minutes", "Minutes", 15, 0, 59, 1),
			num("seconds", "Seconds", 30, 0, 59, 1),
			font(),
			accent("#FF3D71"),
			ink("#FFFFFF"),
		],
	},

	// ── Infographics ──
	{
		kind: "MgBarChart",
		label: "Bar chart",
		category: "Infographics",
		dur: 5,
		themes: ["business", "education", "news", "tech"],
		fields: [
			text("title", "Title", "Growth by year"),
			text("labels", "Labels (comma-separated)", "2022, 2023, 2024, 2025"),
			text("values", "Values (comma-separated)", "24, 41, 67, 92"),
			text("unit", "Unit", "%"),
			font("Manrope"),
			accent("#22D3EE"),
			second("#c98a1e"),
			ink("#FFFFFF"),
			backdrop(true),
			bg("#0F172A"),
		],
	},
	{
		kind: "MgDonutChart",
		label: "Donut chart",
		category: "Infographics",
		dur: 5,
		themes: ["business", "education", "news"],
		fields: [
			text("title", "Title", "Where time goes"),
			text("labels", "Labels (comma-separated)", "Editing, Shooting, Ideas"),
			text("values", "Values (comma-separated)", "55, 30, 15"),
			font("Manrope"),
			accent("#FF3D71"),
			second("#FFD23F"),
			color("color3", "Third colour", "#22D3EE"),
			ink("#FFFFFF"),
			backdrop(true),
			bg("#0F172A"),
		],
	},
	{
		kind: "MgEditorialChart",
		label: "Editorial chart",
		category: "Infographics",
		dur: 8,
		previewAt: 4.6,
		themes: ["business", "news", "education", "tech"],
		fields: [
			text("title", "Title", "Monthly revenue vs. conversion"),
			text("subtitle", "Subtitle", "January–June, in thousands"),
			text("labels", "Labels (comma-separated)", "Jan, Feb, Mar, Apr, May, Jun"),
			text("values", "Bars (comma-separated)", "42, 48, 45, 58, 66, 74"),
			text("line", "Line (comma-separated)", "2.1, 2.4, 2.2, 2.9, 3.3, 3.8"),
			text("barName", "Bars name", "Revenue"),
			text("lineName", "Line name", "Conversion, %"),
			text("unit", "Unit", ""),
			text("source", "Source", "Source: company report"),
			font("PlayfairDisplay"),
			accent("#C0392B"),
			second("#7A93A8"),
			ink("#121212"),
			backdrop(true),
			bg("#F7F4EC"),
		],
	},
	{
		kind: "MgFlowchart",
		label: "Decision tree",
		category: "Infographics",
		dur: 7,
		previewAt: 4.4,
		themes: ["business", "education", "tech"],
		fields: [
			text("question", "Question", "Want to learn to code?"),
			text("left", "Left answer", "Yes"),
			text("right", "Right answer", "Not sure"),
			text("leftA", "Left outcome 1", "Start with Python"),
			text("leftB", "Left outcome 2", "Try no-code"),
			text("rightA", "Right outcome 1", "Build a website"),
			text("rightB", "Right outcome 2", "Take a course"),
			num("pick", "Picked outcome (0 = none)", 1, 0, 4, 1),
			bool("pastel", "Pastel notes", true),
			font("Manrope"),
			accent("#FF5A5F"),
			ink("#1F2328"),
			backdrop(true),
			bg("#FFFFFF"),
		],
	},
	{
		kind: "MgStatTrio",
		label: "Three stats",
		category: "Infographics",
		dur: 4.5,
		themes: ["business", "real-estate", "tech", "sports"],
		fields: [
			text("v1", "Number 1", "98%"),
			text("l1", "Label 1", "satisfaction"),
			text("v2", "Number 2", "2M"),
			text("l2", "Label 2", "downloads"),
			text("v3", "Number 3", "24/7"),
			text("l3", "Label 3", "support"),
			font(),
			accent("#FFD23F"),
			ink("#FFFFFF"),
			backdrop(false),
			bg("#0B0D12"),
		],
	},
	{
		kind: "MgSteps",
		label: "Steps",
		category: "Infographics",
		dur: 5,
		themes: ["education", "food", "business", "tech"],
		fields: [
			text("title", "Title", "How it works"),
			text("steps", "Steps (comma-separated)", "Pick, Customise, Order, Enjoy"),
			font("Manrope"),
			accent("#00E0B8"),
			ink("#FFFFFF"),
			backdrop(true),
			bg("#0F172A"),
		],
	},

	// ── Testimonials, quotes, map, social proof ──
	{
		kind: "MgTestimonial",
		label: "Testimonial",
		category: "Social proof",
		dur: 5,
		themes: ["business", "beauty", "real-estate", "fitness"],
		images: [{ key: "photo", label: "Photo" }],
		fields: [
			text(
				"quote",
				"Quote",
				"The best purchase I made this year. Works like magic.",
			),
			text("name", "Name", "Alex Morgan"),
			text("role", "Role", "Verified buyer"),
			num("stars", "Stars", 5, 0, 5, 0.5),
			font("Manrope"),
			accent("#FFC83D"),
			ink("#111827"),
			color("card", "Card colour", "#FFFFFF"),
		],
	},
	{
		kind: "MgBigQuote",
		label: "Quote",
		category: "Social proof",
		dur: 5,
		themes: ["education", "wedding", "business"],
		fields: [
			text("quote", "Quote", "Simplicity is the ultimate sophistication."),
			text("author", "Author", "Leonardo da Vinci"),
			font("PlayfairDisplay"),
			accent("#E8C77A"),
			ink("#FFFFFF"),
			backdrop(true),
			bg("#141414"),
		],
	},
	{
		kind: "MgMapRoute",
		label: "Map route",
		category: "Social proof",
		dur: 5,
		themes: ["travel", "real-estate", "news", "sports"],
		fields: [
			text("from", "From", "Lisbon"),
			text("to", "To", "Berlin"),
			text("info", "Distance or time", "2 h 55 min"),
			font("Manrope"),
			accent("#FF3D71"),
			second("#22D3EE"),
			ink("#FFFFFF"),
			bg("#0F172A"),
		],
	},
	{
		kind: "MgRating",
		label: "Rating",
		category: "Social proof",
		dur: 4.5,
		themes: ["food", "business", "beauty", "real-estate"],
		fields: [
			text("title", "Title", "Loved by customers"),
			num("rating", "Rating", 4.9, 0, 5, 0.1),
			text("count", "Reviews", "12,000+ reviews"),
			font("Montserrat"),
			accent("#FFC83D"),
			ink("#FFFFFF"),
			backdrop(false),
			bg("#0B0D12"),
		],
	},
	// ── Overlays with live data (drawn over the video; the numbers move with the clip's time) ──
	{ kind: "MgViewfinder", label: "Camera REC", category: "Camera & film", dur: 6, themes: ["travel", "music", "sports", "kids"], fields: [text("label", "Label", "REC"), text("timecode", "Timecode starts at", "00:00:00"), num("battery", "Battery %", 72, 0, 100, 1), text("info", "Info", "4K 30P  ISO 400"), bool("grid", "Grid", false), accent("#FF3B30"), ink()] },
	{ kind: "MgVhs", label: "VHS play", category: "Camera & film", dur: 6, themes: ["music", "fashion", "travel", "kids"], fields: [text("label", "Label", "PLAY"), text("speed", "Tape speed", "SP"), text("date", "Date", "OCT. 31 1998"), text("time", "Clock starts at", "22:24:07"), bool("noise", "Scanlines and tracking", true), ink()] },
	{ kind: "MgFilmLeader", label: "Film countdown", category: "Camera & film", dur: 3.4, themes: ["wedding", "travel", "music"], fields: [num("from", "Count from", 3, 1, 10, 1), font("Montserrat"), accent("#F2F0EA"), ink("#F2F0EA"), bg("#2B2A28")] },
	{ kind: "MgFilmMatte", label: "Cinema matte", category: "Camera & film", dur: 6, themes: ["travel", "wedding", "real-estate", "music"], fields: [select("ratio", "Frame", "2.39", [["2.39", "2.39 : 1 scope"], ["2.00", "2 : 1"], ["1.85", "1.85 : 1 flat"], ["1.33", "4 : 3"], ["1.00", "1 : 1"]]), text("caption", "Caption", ""), font("Montserrat"), accent("#000000"), ink(), bg("#000000")] },
	{ kind: "MgTicker", label: "News ticker", category: "News", dur: 8, themes: ["news", "business", "sports"], fields: [text("label", "Label", "LIVE"), text("text", "Running text", "Markets close higher · Storm moves north tonight · City marathon this Sunday"), text("time", "Clock starts at", "18:30"), num("speed", "Speed", 1, 0.25, 3, 0.05), font("Montserrat"), accent("#E11D2E")] },
	{ kind: "MgBreaking", label: "Breaking news", category: "News", dur: 7, themes: ["news", "sports", "business"], fields: [text("label", "Label", "BREAKING NEWS"), text("headline", "Headline", "Big story developing right now"), text("text", "Running text", "Officials to speak at 6 PM · Roads closed downtown · Updates every hour"), font("Montserrat"), accent("#E11D2E")] },
	{ kind: "MgStory", label: "Story screen", category: "Social screens", dur: 5, themes: ["fashion", "beauty", "travel", "food"], images: [{ key: "logo", label: "Profile picture" }], fields: [text("name", "Name", "yourname"), text("time", "Posted", "2h"), text("reply", "Reply box", "Send message"), num("segments", "Stories", 3, 1, 8, 1), num("current", "This one", 1, 1, 8, 1), font("Manrope"), accent("#FF9F0A"), second("#FF2D78")] },
	{ kind: "MgChat", label: "Chat", category: "Social screens", dur: 5, themes: ["education", "business", "fashion", "kids"], images: [{ key: "logo", label: "Contact picture" }], fields: [text("name", "Contact", "Alex"), text("messages", "Messages (| between, > = yours)", "Are you coming tonight?|>On my way! 🚗|Bring snacks 😄|>Already got them"), font("Manrope"), accent("#0A84FF"), second("#2C2C2E")] },
	{ kind: "MgNotification", label: "Notification", category: "Social screens", dur: 4, themes: ["business", "tech", "fashion"], fields: [text("app", "App", "Shop"), text("title", "Title", "New order 🎉"), text("body", "Text", "Someone just bought your product"), text("title2", "Second title", "Payment received"), text("body2", "Second text", "$49.00 is on its way"), font("Manrope"), accent("#34C759")] },
	{ kind: "MgHud", label: "HUD target", category: "HUD & comic", dur: 5, themes: ["gaming", "tech", "sports"], fields: [text("label", "Lock text", "TARGET LOCKED"), accent("#00E5FF"), second("#FF3B30")] },
	{ kind: "MgComicBoom", label: "Comic boom", category: "HUD & comic", dur: 2, themes: ["kids", "gaming", "sports"], fields: [text("text", "Word", "BOOM!"), accent("#FF3B30"), second("#FFD23F"), ink("#111111")] },
	{ kind: "MgSpeedLines", label: "Speed lines", category: "HUD & comic", dur: 2.5, themes: ["gaming", "sports", "kids"], fields: [num("amount", "Lines", 70, 10, 200, 1), num("clear", "Clear centre", 0.32, 0.1, 0.6, 0.01), num("opacity", "Opacity", 0.85, 0.1, 1, 0.05), accent("#FFFFFF"), ink("#FFFFFF")] },
	{ kind: "MgConfetti", label: "Confetti", category: "Particles", dur: 4, previewAt: 0.8, themes: ["kids", "wedding", "business", "music"], fields: [select("mode", "Mode", "burst", [["burst", "Burst"], ["rain", "Rain"]]), num("amount", "Amount", 120, 10, 260, 1), accent("#FFD23F"), second("#FF3D71"), color("color3", "Third colour", "#22D3EE")] },
	{ kind: "MgSparks", label: "Sparks", category: "Particles", dur: 4, themes: ["music", "wedding", "sports"], fields: [num("amount", "Amount", 90, 10, 220, 1), accent("#FFB020"), second("#FFF3B0")] },
	{ kind: "MgSnow", label: "Snow", category: "Particles", dur: 6, themes: ["travel", "kids", "wedding"], fields: [num("amount", "Amount", 140, 10, 320, 1), num("speed", "Speed", 1, 0.2, 3, 0.05), accent("#FFFFFF")] },
	{ kind: "MgBokeh", label: "Bokeh lights", category: "Particles", dur: 6, themes: ["wedding", "beauty", "music", "fashion"], fields: [num("amount", "Amount", 28, 4, 80, 1), accent("#FFD27A"), second("#FF8FB1"), color("color3", "Third colour", "#8FD3FF")] },
	{ kind: "MgSplitScreen", label: "Split screen", category: "Layouts", dur: 5, themes: ["beauty", "fitness", "real-estate", "food"], images: [{ key: "left", label: "First picture" }, { key: "right", label: "Second picture" }], fields: [text("label1", "First label", "BEFORE"), text("label2", "Second label", "AFTER"), font("Montserrat"), accent("#FFFFFF")] },
	{ kind: "MgPip", label: "Picture in picture", category: "Layouts", dur: 5, themes: ["gaming", "education", "news", "tech"], images: [{ key: "photo", label: "Picture" }], fields: [select("corner", "Corner", "top-right", [["top-left", "Top left"], ["top-right", "Top right"], ["bottom-left", "Bottom left"], ["bottom-right", "Bottom right"]]), num("size", "Size", 0.34, 0.15, 0.6, 0.01), text("label", "Label", "LIVE"), font("Manrope"), accent("#FFFFFF")] },
	{ kind: "MgPassePartout", label: "Passe-partout", category: "Layouts", dur: 6, themes: ["wedding", "real-estate", "fashion", "travel"], fields: [num("width", "Mat width", 0.07, 0.02, 0.2, 0.005), text("caption", "Caption", "Summer in Lisbon"), text("sub", "Small line", "2026"), font("Manrope"), bg("#F3EFE6"), ink("#2B2622"), accent("#2B2622")] },
	// ── Light & texture over the video ──
	{ kind: "MgLightLeak", label: "Light leak", category: "Light & texture", dur: 5, themes: ["wedding", "travel", "music", "fashion"], fields: [num("intensity", "Intensity", 0.85, 0.1, 1, 0.05), num("speed", "Speed", 1, 0.2, 3, 0.05), accent("#FF6A1A"), second("#FFD36B")] },
	{ kind: "MgFilmBurn", label: "Film burn", category: "Light & texture", dur: 1.8, previewAt: 0.55, themes: ["wedding", "music", "travel", "fashion"], fields: [select("from", "Starts from", "right", [["right", "Right"], ["left", "Left"], ["center", "Centre"]]), num("intensity", "Intensity", 1, 0.2, 1, 0.05), accent("#FF5A1F"), second("#FFE7A3")] },
	{ kind: "MgLensFlare", label: "Lens flare", category: "Light & texture", dur: 5, themes: ["travel", "music", "sports", "real-estate"], fields: [num("x", "Light X", 0.22, 0, 1, 0.01), num("y", "Light Y", 0.22, 0, 1, 0.01), num("drift", "Drift", 0.15, -0.5, 0.5, 0.01), num("intensity", "Intensity", 0.9, 0.1, 1, 0.05), accent("#7FC8FF"), second("#FFD9A0")] },
	{ kind: "MgGrain", label: "Film grain & dust", category: "Light & texture", dur: 6, themes: ["wedding", "music", "fashion", "travel"], fields: [num("amount", "Grain", 0.35, 0, 1, 0.01), bool("dust", "Dust and scratches", true), num("vignette", "Vignette", 0.45, 0, 1, 0.01), num("tint", "Warm tint", 0.12, 0, 0.5, 0.01), accent("#FFB347"), ink()] },
	{ kind: "MgCrt", label: "CRT screen", category: "Light & texture", dur: 6, themes: ["gaming", "music", "tech", "news"], fields: [text("label", "Channel", "CH 03"), num("scan", "Scanlines", 0.35, 0, 0.9, 0.01), bool("roll", "Rolling band", true), bool("bezel", "Curved bezel", true), font("Rubik"), accent("#7CFFB2")] },
	{ kind: "MgRain", label: "Rain", category: "Light & texture", dur: 6, themes: ["travel", "music", "news", "real-estate"], fields: [num("amount", "Drops", 260, 20, 500, 1), num("angle", "Angle", 12, -40, 40, 1), num("speed", "Speed", 1, 0.2, 3, 0.05), num("darken", "Darken", 0.25, 0, 0.8, 0.01), bool("lightning", "Lightning", false), accent("#CFE6FF")] },
	// ── Particles drawn by the kit ──
	{ kind: "MgFireworks", label: "Fireworks show", category: "Particles", dur: 5, previewAt: 2, themes: ["music", "wedding", "kids", "sports"], fields: [num("bursts", "Bursts", 5, 1, 10, 1), accent("#FFD23F"), second("#FF3D71"), color("color3", "Third colour", "#22D3EE")] },
	{ kind: "MgHearts", label: "Floating hearts", category: "Particles", dur: 5, themes: ["wedding", "beauty", "fashion", "music"], fields: [num("amount", "Hearts", 36, 4, 120, 1), select("side", "Where", "right", [["right", "Right edge (live)"], ["full", "Whole frame"]]), accent("#FF3D71"), second("#FF8FB1")] },
	{ kind: "MgBubbles", label: "Bubbles", category: "Particles", dur: 6, themes: ["kids", "beauty", "wedding", "food"], fields: [num("amount", "Bubbles", 26, 4, 80, 1), num("speed", "Speed", 1, 0.2, 3, 0.05), accent("#8FE3FF"), second("#FF9CEB")] },
	// ── Stingers that cover a cut ──
	{ kind: "MgGlitch", label: "Glitch hit", category: "Bumpers", dur: 1.5, previewAt: 0.7, themes: ["gaming", "tech", "music", "news"], fields: [text("label", "Word", ""), num("intensity", "Intensity", 1, 0.2, 1.5, 0.05), font("Unbounded"), accent("#00E5FF"), second("#FF2D78")] },
	{ kind: "MgShutter", label: "Shutter blinds", category: "Bumpers", dur: 1.6, previewAt: 0.8, themes: ["fashion", "business", "real-estate", "sports"], fields: [num("slats", "Slats", 8, 3, 24, 1), select("direction", "Direction", "horizontal", [["horizontal", "Horizontal"], ["vertical", "Vertical"]]), text("label", "Word", "NEXT"), font("Montserrat"), accent("#111111"), ink()] },
	{ kind: "MgLiquidWipe", label: "Liquid wipe", category: "Bumpers", dur: 1.8, previewAt: 0.55, themes: ["beauty", "kids", "food", "fashion"], fields: [text("label", "Word", ""), font("Unbounded"), accent("#c98a1e"), second("#22D3EE"), ink()] },
	// ── Arrows & callouts ──
	{ kind: "MgArrow", label: "Hand-drawn arrow", category: "Arrows & callouts", dur: 4, themes: ["education", "tech", "food", "gaming"], fields: [text("label", "Label", "Look here!"), num("x", "Points at X", 0.62, 0, 1, 0.01), num("y", "Points at Y", 0.42, 0, 1, 0.01), select("from", "Comes from", "left", [["left", "Left"], ["right", "Right"], ["top", "Above"], ["bottom", "Below"]]), num("bend", "Bend", 0.35, -1, 1, 0.01), num("thickness", "Thickness", 12, 2, 40, 1), font("Rubik"), accent("#FFD23F"), ink()] },
	{ kind: "MgCallout", label: "Callout", category: "Arrows & callouts", dur: 4.5, themes: ["fashion", "tech", "real-estate", "food"], fields: [text("title", "Title", "Handmade leather"), text("sub", "Small line", "Italian full-grain"), num("x", "Spot X", 0.45, 0, 1, 0.01), num("y", "Spot Y", 0.55, 0, 1, 0.01), select("side", "Label side", "right", [["right", "Right"], ["left", "Left"]]), font("Manrope"), accent("#FFFFFF"), ink()] },
	{ kind: "MgCircleMark", label: "Circle it", category: "Arrows & callouts", dur: 3.5, themes: ["education", "news", "sports", "gaming"], fields: [text("label", "Note", ""), num("x", "Centre X", 0.5, 0, 1, 0.01), num("y", "Centre Y", 0.45, 0, 1, 0.01), num("size", "Size", 0.36, 0.08, 1, 0.01), num("squash", "Height", 0.7, 0.3, 1.5, 0.01), num("thickness", "Thickness", 10, 2, 40, 1), font("Rubik"), accent("#FF3B30"), ink("#FF3B30")] },
	{ kind: "MgMagnifier", label: "Magnifier", category: "Arrows & callouts", dur: 4, themes: ["education", "real-estate", "tech", "food"], images: [{ key: "photo", label: "Picture" }], fields: [num("x", "Spot X", 0.5, 0, 1, 0.01), num("y", "Spot Y", 0.45, 0, 1, 0.01), num("size", "Lens size", 0.42, 0.15, 0.9, 0.01), num("zoom", "Zoom", 2.2, 1.2, 6, 0.1), bool("backdrop", "Show the picture behind", true), accent("#FFFFFF")] },
	// ── Social pieces ──
	{ kind: "MgSocialRail", label: "Reaction rail", category: "Social screens", dur: 5, themes: ["fashion", "beauty", "gaming", "music"], images: [{ key: "logo", label: "Profile picture" }], fields: [text("likes", "Likes", "128K"), text("comments", "Comments", "2,048"), text("saves", "Saves", "15K"), text("shares", "Shares", "9,120"), font("Manrope"), accent("#FE2C55"), ink()] },
	{ kind: "MgCommentReply", label: "Comment reply", category: "Social screens", dur: 5, themes: ["beauty", "food", "education", "fashion"], images: [{ key: "logo", label: "Commenter picture" }], fields: [text("name", "Name", "anna.k"), text("comment", "Comment", "How did you make this?? 😍"), font("Manrope"), ink("#111111"), color("card", "Card colour", "#FFFFFF"), accent("#FE2C55")] },
	{ kind: "MgFollowButton", label: "Follow button", category: "Call to action", dur: 3.5, previewAt: 2.2, themes: ["fashion", "beauty", "gaming", "fitness"], images: [{ key: "logo", label: "Profile picture" }], fields: [text("name", "Name", "Your Name"), text("handle", "Handle", "@yourname"), text("button", "Button", "Follow"), text("done", "After the click", "Following"), font("Manrope"), accent("#FE2C55"), ink("#111111"), color("card", "Card colour", "#FFFFFF")] },
	// ── Widgets ──
	{ kind: "MgWeather", label: "Weather", category: "Widgets", dur: 5, themes: ["travel", "news", "kids", "sports"], fields: [select("condition", "Weather", "clear-day", [["clear-day", "Sunny"], ["partly-cloudy-day", "Partly cloudy"], ["overcast-day", "Cloudy"], ["rain", "Rain"], ["thunderstorms-day-rain", "Storm"], ["snow", "Snow"], ["clear-night", "Clear night"]]), num("temp", "Temperature", 24, -60, 60, 1), text("unit", "Unit", "°"), text("city", "Place", "Lisbon"), text("detail", "Small line", "H 27° · L 18°"), font("Manrope"), accent("#4DA3FF"), ink()] },
	{ kind: "MgClock", label: "Clock", category: "Widgets", dur: 5, themes: ["business", "education", "news", "fitness"], fields: [text("time", "Starts at", "10:09"), num("speed", "Speed (1 = real time)", 1, 1, 3600, 1), text("label", "Line under it", "Monday morning"), num("size", "Size", 0.5, 0.2, 0.9, 0.01), font("Manrope"), bg("#FFFFFF"), ink("#111111"), accent("#FF3B30"), second("#FFFFFF")] },
	{ kind: "MgGeotag", label: "Geotag", category: "Widgets", dur: 4, themes: ["travel", "food", "real-estate", "fashion"], fields: [text("place", "Place", "Lisbon, Portugal"), text("sub", "Small line", ""), select("position", "Position", "top", [["top", "Top"], ["center", "Centre"], ["bottom", "Bottom"]]), font("Montserrat"), accent("#FF3D71"), ink("#111111"), color("card", "Card colour", "#FFFFFF")] },
	// ── Picture frames ──
	{ kind: "MgPolaroid", label: "Polaroid", category: "Layouts", dur: 5, themes: ["wedding", "travel", "kids", "fashion"], images: [{ key: "photo", label: "Photo" }], fields: [text("caption", "Caption", "Summer '26"), num("rotate", "Tilt", -4, -30, 30, 0.5), font("PlayfairDisplay"), ink("#2B2622"), bg("#FAF8F2")] },
	{ kind: "MgFilmStrip", label: "Film strip", category: "Layouts", dur: 6, themes: ["travel", "wedding", "music", "kids"], images: [{ key: "photo", label: "First picture" }, { key: "photo2", label: "Second picture" }, { key: "photo3", label: "Third picture" }], fields: [text("caption", "Caption", ""), num("speed", "Speed", 1, 0, 4, 0.05), num("angle", "Tilt", -6, -30, 30, 0.5), font("Montserrat"), accent("#151515"), ink()] },
	{ kind: "MgPhoneFrame", label: "Phone mockup", category: "Layouts", dur: 5, themes: ["tech", "business", "education", "fashion"], images: [{ key: "screen", label: "Screen picture" }], fields: [text("label", "Headline", "Now on your phone"), font("Montserrat"), accent("#111111"), ink()] },
	// ── More data ──
	{ kind: "MgLineChart", label: "Line chart", category: "Infographics", dur: 5, themes: ["business", "tech", "news", "fitness"], fields: [text("title", "Title", "Followers, thousands"), text("labels", "Labels (comma-separated)", "Jan, Feb, Mar, Apr, May, Jun"), text("values", "Values (comma-separated)", "12, 18, 15, 27, 34, 48"), text("unit", "Unit", ""), font("Manrope"), accent("#22D3EE"), ink(), backdrop(true), bg("#0F172A")] },
	{ kind: "MgPoll", label: "Poll", category: "Infographics", dur: 5, themes: ["education", "business", "fashion", "food"], fields: [text("question", "Question", "When do you work best?"), text("options", "Answers (comma-separated)", "Morning, Night"), text("values", "Votes (comma-separated)", "64, 36"), text("votes", "Small line", "12,480 votes"), font("Manrope"), accent("#c98a1e"), ink("#111111"), color("card", "Card colour", "#FFFFFF")] },
	{ kind: "MgProgressBar", label: "Progress bar", category: "Infographics", dur: 4, themes: ["tech", "gaming", "education", "fitness"], fields: [text("label", "Label", "Uploading…"), num("value", "Fills to %", 100, 0, 100, 1), text("sub", "Small line", ""), font("Manrope"), accent("#22D3EE"), second("#c98a1e"), ink(), backdrop(false), bg("#0B0D12")] },
	// ── Ready-made Lottie animations (public/mograph/lottie; source and author with each) ──
	{ kind: "MgPartyConfetti", label: "Party confetti", category: "Particles", dur: 3, previewAt: 0.7, themes: ["kids", "wedding", "business", "music"], lottie: { file: "confetti-pop", fill: true, source: "https://lottiefiles.com/animations/confetti-coMR5KBYrt", author: "Jacques Mauriac (LottieFiles)" }, fields: fillFields() },
	{ kind: "MgMoneyRain", label: "Money rain", category: "Particles", dur: 4, previewAt: 1.1, themes: ["business", "gaming", "fashion", "news"], lottie: { file: "money-rain", fill: true, source: "https://lottiefiles.com/animations/green-money-falling-BlsNrgN8KO", author: "Muhammad Hunain (LottieFiles)" }, fields: fillFields() },
	{ kind: "MgTwinkle", label: "Twinkle stars", category: "Stickers", dur: 4, themes: ["beauty", "wedding", "fashion", "kids"], lottie: { file: "sparkles", source: "https://lottiefiles.com/animations/shining-stars-eKfHniOaob", author: "Neem Sutantio (LottieFiles)" }, fields: stickerFields({ size: 0.6 }) },
	{ kind: "MgLikeButton", label: "Like button", category: "Call to action", dur: 4, themes: ["music", "gaming", "education", "tech"], lottie: { file: "like-bar", source: "https://lottiefiles.com/animations/subscribe-red-JiCm6t1pjC", author: "Oscar Perez (LottieFiles)" }, fields: stickerFields({size: 0.6, place: "bottom"}) },
	{ kind: "MgSubscribeLike", label: "Subscribe & like", category: "Call to action", dur: 6, themes: ["gaming", "education", "tech", "music"], lottie: { file: "yt-subscribe", source: "https://lottiefiles.com/animations/subbutton-json-RLmHXt6HC0", author: "sujan rai (LottieFiles)" }, fields: stickerFields({size: 1, place: "bottom"}) },
	{ kind: "MgBellRing", label: "Bell ring", category: "Call to action", dur: 4, themes: ["education", "news", "gaming", "tech"], lottie: { file: "bell", source: "https://lottiefiles.com/animations/notification-allert-NeGbXFUoh9", author: "D.Stnt (LottieFiles)" }, fields: stickerFields({size: 0.32, place: "top-right"}) },
	{ kind: "MgTapHand", label: "Tap here", category: "Call to action", dur: 3, themes: ["tech", "business", "education", "kids"], lottie: { file: "tap-hand", source: "https://lottiefiles.com/animations/click-hand-tap-5kohu3cizA", author: "Tati Chenu (LottieFiles)" }, fields: stickerFields({size: 0.34, caption: "Tap here"}) },
	{ kind: "MgSaleBadge", label: "Sale badge", category: "Product & sale", dur: 4, themes: ["fashion", "beauty", "food", "tech"], lottie: { file: "sale-badge", source: "https://lottiefiles.com/animations/sale-Lilh8c59sW", author: "manju (LottieFiles)" }, fields: stickerFields({size: 0.5}) },
	{ kind: "MgDiscountTag", label: "Discount tag", category: "Product & sale", dur: 3, themes: ["fashion", "beauty", "food", "real-estate"], lottie: { file: "discount-tag", source: "https://lottiefiles.com/animations/discount-QgzJ4zHCAN", author: "Keren Kastro (LottieFiles)" }, fields: stickerFields({size: 0.5}) },
	{ kind: "MgHeartTap", label: "Heart tap", category: "Stickers", dur: 2, themes: ["beauty", "wedding", "fashion", "food"], lottie: { file: "heart-burst", source: "https://lottiefiles.com/animations/like-button-WVawL0PoB0", author: "Saki  Hanzawa (LottieFiles)" }, fields: stickerFields({size: 0.4}) },
	{ kind: "MgChatBubbles", label: "Chat bubbles", category: "Stickers", dur: 4, themes: ["education", "business", "tech", "kids"], lottie: { file: "chat-bubbles", source: "https://lottiefiles.com/animations/comments-nRytQQBr0F", author: "anwar khan (LottieFiles)" }, fields: stickerFields({size: 0.36, place: "top-left"}) },
	{ kind: "MgSuccessCheck", label: "Success check", category: "Stickers", dur: 2.5, themes: ["business", "education", "fitness", "tech"], lottie: { file: "success", source: "https://lottiefiles.com/animations/success-M6cycMppaO", author: "Jaydeep Das (LottieFiles)" }, fields: stickerFields({size: 0.42}) },
	{ kind: "MgGiftBox", label: "Gift box", category: "Stickers", dur: 2.5, themes: ["kids", "fashion", "beauty", "wedding"], lottie: { file: "gift", source: "https://lottiefiles.com/animations/gift-box-mT7BtjS0mr", author: "Sethulekshmy K S (LottieFiles)" }, fields: stickerFields({size: 0.42}) },
	{ kind: "MgRocketLaunch", label: "Rocket launch", category: "Stickers", dur: 5, themes: ["tech", "business", "education", "kids"], lottie: { file: "rocket", source: "https://lottiefiles.com/animations/rocket-67toMgwn3B", author: "Сергей Лаптев (LottieFiles)" }, fields: stickerFields({size: 0.5}) },
	{ kind: "MgFlame", label: "Flame", category: "Stickers", dur: 5, themes: ["fitness", "food", "sports", "gaming"], lottie: { file: "flame", source: "https://lottiefiles.com/animations/fire-JouAjGsGNS", author: "suppanut sukuntapuksa (LottieFiles)" }, fields: stickerFields({size: 0.36}) },
	{ kind: "MgRingLoader", label: "Loading ring", category: "Stickers", dur: 4, themes: ["tech", "gaming", "business"], lottie: { file: "ring-loader", source: "https://lottiefiles.com/animations/blue2-pvT5LopBd6", author: "Chang 9 (LottieFiles)" }, fields: stickerFields({size: 0.3, caption: "Loading…"}) },
	{ kind: "MgMapPin", label: "Map pin", category: "Stickers", dur: 3, themes: ["travel", "real-estate", "food", "news"], lottie: { file: "pin", source: "https://lottiefiles.com/animations/location-pin-dNO2ONFEBC", author: "Aravinth (LottieFiles)" }, fields: stickerFields({size: 0.3, caption: "Lisbon, Portugal"}) },
	{ kind: "MgStopwatch", label: "Stopwatch", category: "Stickers", dur: 3, themes: ["fitness", "sports", "education", "business"], lottie: { file: "stopwatch", source: "https://lottiefiles.com/animations/clock-TKXaAOdd35", author: "maria0505 (LottieFiles)" }, fields: stickerFields({size: 0.32}) },
	{ kind: "MgEmojiFire", label: "🔥 Fire", category: "Animated emoji", dur: 3, hidden: true, themes: ["fitness", "food", "sports", "music"], lottie: { file: "emoji-fire", source: "https://googlefonts.github.io/noto-emoji-animation/", author: "Google Noto Emoji Animation" }, fields: emojiFields("emoji-fire") },
	{ kind: "MgEmojiJoy", label: "😂 Laughing", category: "Animated emoji", dur: 3, hidden: true, themes: ["kids", "gaming", "education"], lottie: { file: "emoji-joy", source: "https://googlefonts.github.io/noto-emoji-animation/", author: "Google Noto Emoji Animation" }, fields: emojiFields("emoji-joy") },
	{ kind: "MgEmojiHeartEyes", label: "😍 Heart eyes", category: "Animated emoji", dur: 3, hidden: true, themes: ["food", "beauty", "fashion", "wedding"], lottie: { file: "emoji-heart-eyes", source: "https://googlefonts.github.io/noto-emoji-animation/", author: "Google Noto Emoji Animation" }, fields: emojiFields("emoji-heart-eyes") },
	{ kind: "MgEmojiMindBlown", label: "🤯 Mind blown", category: "Animated emoji", dur: 3, hidden: true, themes: ["tech", "education", "news", "gaming"], lottie: { file: "emoji-mind-blown", source: "https://googlefonts.github.io/noto-emoji-animation/", author: "Google Noto Emoji Animation" }, fields: emojiFields("emoji-mind-blown") },
	{ kind: "MgEmojiScream", label: "😱 Shocked", category: "Animated emoji", dur: 3, hidden: true, themes: ["news", "gaming", "kids"], lottie: { file: "emoji-scream", source: "https://googlefonts.github.io/noto-emoji-animation/", author: "Google Noto Emoji Animation" }, fields: emojiFields("emoji-scream") },
	{ kind: "MgEmojiClap", label: "👏 Clapping", category: "Animated emoji", dur: 3, hidden: true, themes: ["sports", "education", "business", "music"], lottie: { file: "emoji-clap", source: "https://googlefonts.github.io/noto-emoji-animation/", author: "Google Noto Emoji Animation" }, fields: emojiFields("emoji-clap") },
	{ kind: "MgEmojiHundred", label: "💯 Hundred", category: "Animated emoji", dur: 3, hidden: true, themes: ["fitness", "sports", "business", "food"], lottie: { file: "emoji-hundred", source: "https://googlefonts.github.io/noto-emoji-animation/", author: "Google Noto Emoji Animation" }, fields: emojiFields("emoji-hundred") },
	{ kind: "MgEmojiPartyPopper", label: "🎉 Party popper", category: "Animated emoji", dur: 3, hidden: true, themes: ["kids", "wedding", "business", "music"], lottie: { file: "emoji-party-popper", source: "https://googlefonts.github.io/noto-emoji-animation/", author: "Google Noto Emoji Animation" }, fields: emojiFields("emoji-party-popper") },
	{ kind: "MgEmojiRedHeart", label: "❤️ Heart", category: "Animated emoji", dur: 3, hidden: true, themes: ["wedding", "beauty", "fashion", "travel"], lottie: { file: "emoji-red-heart", source: "https://googlefonts.github.io/noto-emoji-animation/", author: "Google Noto Emoji Animation" }, fields: emojiFields("emoji-red-heart") },
	{ kind: "MgEmojiThumbsUp", label: "👍 Thumbs up", category: "Animated emoji", dur: 3, hidden: true, themes: ["business", "education", "tech", "food"], lottie: { file: "emoji-thumbs-up", source: "https://googlefonts.github.io/noto-emoji-animation/", author: "Google Noto Emoji Animation" }, fields: emojiFields("emoji-thumbs-up") },
	{ kind: "MgEmojiSkull", label: "💀 Skull", category: "Animated emoji", dur: 3, hidden: true, themes: ["gaming", "kids", "music"], lottie: { file: "emoji-skull", source: "https://googlefonts.github.io/noto-emoji-animation/", author: "Google Noto Emoji Animation" }, fields: emojiFields("emoji-skull") },
	{ kind: "MgEmojiPartying", label: "🥳 Party face", category: "Animated emoji", dur: 3, hidden: true, themes: ["kids", "wedding", "music", "travel"], lottie: { file: "emoji-partying", source: "https://googlefonts.github.io/noto-emoji-animation/", author: "Google Noto Emoji Animation" }, fields: emojiFields("emoji-partying") },
];

export const MOGRAPH_BY_KIND = new Map(MOGRAPH_KINDS.map((k) => [k.kind, k]));

/** Every field's default: what a new graphic starts with (the inspector shows the same values). */
export function mographDefaults(
	kind: MographKind,
): Record<string, string | number | boolean> {
	const out: Record<string, string | number | boolean> = {};
	for (const f of kind.fields)
		out[f.key] = f.default as string | number | boolean;
	return out;
}
