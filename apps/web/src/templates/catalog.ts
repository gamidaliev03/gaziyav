// Templates (left panel → Templates): ready-made multi-layer layouts, like the paid After Effects / Premiere packs —
// the motion graphics and overlays (src/montage/mograph.ts) and the text presets (src/text/presets.ts), each layer at
// its own moment of the video. One double-click puts every layer on the timeline, as one ⌘Z step.
// Free of React and Remotion: the panel, the insert and the tests read it.
import { MOGRAPH_BY_KIND, mographDefaults, type Theme, themePhoto } from "@/montage/mograph";
import type { PropValue } from "@/montage/types";
import { EDITION, KEPT_TEMPLATE_PACKS } from "@/edition/cuts";

/**
 * When a layer plays: from the start, ending with the video, over the whole video, or at a second from the start.
 * A text part without `at` goes where its preset belongs (a hook at the playhead, a CTA at the end…).
 */
export type At = "start" | "end" | "whole" | number;

/** A text preset (`content` replaces its sample words) or a motion graphic with its own fields. */
export type TemplatePart = { text: string; at?: At; content?: string } | MgPart;
export type MgPart = { mg: string; at: At; dur?: number; params?: Record<string, PropValue> };

export interface Template {
	id: string;
	name: string;
	category: string;
	themes: Theme[];
	parts: TemplatePart[];
	/** The pack's colours: every graphic that carries brand colours takes them (a layer's own params still win). */
	palette?: { accent: string; color2?: string };
	/** The cover photo: the photo of the template's first theme. */
	cover: string;
	/** The second the cover shows when the first overlay isn't the telling one (default: coverMoment's pick). */
	coverAt?: number;
	/** The cover also shows the text layers' words (titles and talking-head packs, where the words are the point). */
	coverText?: boolean;
	featured?: boolean;
}

export const TEMPLATE_CATEGORIES = ["Ads", "Social", "Vlog & travel", "Events", "Sports & fitness", "Business", "Gaming & fun", "Talking head", "Titles"];

const t = (text: string, at?: At, content?: string): TemplatePart => ({ text, at, content });
const mg = (kind: string, at: At, params?: Record<string, PropValue>, dur?: number): TemplatePart => ({ mg: kind, at, params, dur });

/** Colour sets the packs are built on (accent, second colour). */
const P = {
	gold: { accent: "#FFD23F", color2: "#FF3D71" },
	sale: { accent: "#FF2E4D", color2: "#FFD23F" },
	mint: { accent: "#00E0B8", color2: "#c98a1e" },
	tech: { accent: "#22D3EE", color2: "#c98a1e" },
	blush: { accent: "#FF7AA8", color2: "#FFD6E5" },
	luxe: { accent: "#E8C77A", color2: "#F3EFE6" },
	sunset: { accent: "#FF8A3D", color2: "#FFD23F" },
	neon: { accent: "#00E5FF", color2: "#FF2D78" },
	forest: { accent: "#34D399", color2: "#FDE68A" },
	news: { accent: "#E11D2E", color2: "#111827" },
	sport: { accent: "#C6FF00", color2: "#111111" },
	kids: { accent: "#FFB800", color2: "#FF4D8D" },
	ocean: { accent: "#3BA7FF", color2: "#7FE3D0" },
	food: { accent: "#FF6B35", color2: "#FFD166" },
	estate: { accent: "#C9A46A", color2: "#1F2937" },
} as const;

type Def = Omit<Template, "cover">;

const DEFS: Def[] = [
	// ── Ads ──
	{ id: "flash-sale", name: "Flash sale", category: "Ads", themes: ["fashion", "food", "beauty"], palette: P.sale, featured: true, parts: [mg("MgGlitch", "start", { label: "FLASH SALE" }), mg("MgSaleBurst", 1.2, { title: "FLASH SALE", discount: "-60%", sub: "Only 24 hours" }), mg("MgOfferTimer", 4.8, { title: "Ends in", hours: 23, minutes: 59, seconds: 59 }), mg("MgDiscountTag", 5, { place: "top-right", size: 0.34 }, 3), mg("MgBuyNow", "end", { button: "SHOP THE SALE", sub: "Free returns · 30 days" })] },
	{ id: "product-launch", name: "Product launch", category: "Ads", themes: ["tech", "business"], palette: P.tech, featured: true, parts: [mg("MgLensFlare", "start", { x: 0.8, y: 0.2 }, 3), mg("MgProductShowcase", 0.6, { name: "Aurora Pro", feat1: "40 h battery", feat2: "Studio sound", feat3: "Charges in 15 min" }), mg("MgStatTrio", 5.8, { v1: "2×", l1: "faster", v2: "40 h", l2: "battery", v3: "4.9★", l3: "rating" }), mg("MgBuyNow", "end", { button: "PRE-ORDER", sub: "Ships in March" })] },
	{ id: "shop-drop", name: "New drop", category: "Ads", themes: ["fashion", "beauty"], palette: P.gold, parts: [mg("MgMarquee", "start", { text: "NEW DROP · FW26" }, 3), mg("MgNewArrival", 3, { badge: "NEW", name: "The Autumn Edit", sub: "In stores Friday" }), mg("MgTwinkle", 3.2, { place: "top-right", size: 0.4 }, 3), mg("MgLinkInBio", "end", { text: "Shop the drop", url: "shop.yourbrand.com" })] },
	{ id: "notification-ad", name: "Order alert", category: "Ads", themes: ["business", "tech", "fashion"], palette: P.mint, parts: [mg("MgNotification", "start", { app: "Shop", title: "New order 🎉", body: "Someone in Berlin just bought this", title2: "Only 3 left", body2: "Selling fast today" }), mg("MgPriceTag", 3.6, { title: "Today only", price: "39", oldPrice: "79", badge: "-50%" }), mg("MgSuccessCheck", 7.6, { size: 0.3, place: "top", caption: "Paid in one tap" }), mg("MgBuyNow", "end", { button: "ORDER NOW", sub: "Delivery tomorrow" })] },
	{ id: "ugc-ad", name: "UGC ad", category: "Ads", themes: ["beauty", "fashion"], palette: P.blush, parts: [t("hook", undefined, "I tried it for\n30 days"), mg("MgCommentReply", 0.4, { name: "maria.v", comment: "Does it really work?? 👀" }), mg("MgEmojiHeartEyes", 5, { place: "bottom-right", size: 0.26 }), t("cta", undefined, "Link in bio ↓"), t("ad-label", undefined, "Ad · Paid partnership")] },
	{ id: "sale", name: "Sale", category: "Ads", themes: ["fashion", "food"], palette: P.sale, parts: [mg("MgSaleBadge", "start", { size: 0.4, place: "top" }, 3), t("price", undefined, "−40% this weekend"), mg("MgPriceTag", 3.4, { title: "Weekend price", price: "59", oldPrice: "99", badge: "-40%" }), t("cta", undefined, "Shop before Sunday"), t("ad-label", undefined, "Ad · Your Brand")] },
	{ id: "retro-promo", name: "Retro promo", category: "Ads", themes: ["music", "fashion"], palette: P.sunset, parts: [mg("MgVhs", "whole", { label: "PLAY", date: "SUMMER '86" }), t("retro-gradient", 0.4, "BACK TO\n'86"), mg("MgPriceTag", 3.6, { title: "Retro price", price: "19", oldPrice: "39", badge: "RETRO" }), t("cta", undefined, "Grab yours")] },

	// ── Social ──
	{ id: "story-promo", name: "Story promo", category: "Social", themes: ["fashion", "beauty", "travel"], palette: P.blush, featured: true, parts: [mg("MgStory", "whole", { name: "lena.style", time: "2h", segments: 4, current: 2 }), mg("MgGeotag", 0.6, { place: "Paris, France", position: "center" }, 3.4), mg("MgSwipeUp", "end", { text: "Swipe up", sub: "to shop the look" })] },
	{ id: "review", name: "Honest review", category: "Social", themes: ["tech", "beauty", "food"], palette: P.gold, parts: [t("hook", 0, "Honest review\nafter 3 months"), mg("MgRating", 3, { title: "My score", rating: 4.6, count: "after 90 days" }), mg("MgTestimonial", 7.5, { quote: "Worth every penny. The battery is unreal.", name: "Me, honestly", role: "Paid for it myself", stars: 5 }), mg("MgPoll", 12.5, { question: "Would you buy it?", options: "Yes, No", values: "78, 22", votes: "Vote in the comments" }), t("cta", undefined, "Full review on the channel")] },
	{ id: "before-after", name: "Before / after", category: "Social", themes: ["beauty", "fitness", "real-estate"], palette: P.mint, parts: [mg("MgSplitScreen", "start", { label1: "BEFORE", label2: "AFTER" }), mg("MgArrow", 5.2, { label: "6 weeks!", x: 0.62, y: 0.42, from: "left" }), t("callout", 5, "6 weeks of work"), mg("MgLinkInBio", "end", { text: "Get the plan", url: "yourplan.com" })] },
	{ id: "chat-story", name: "Chat story", category: "Social", themes: ["education", "business", "kids"], palette: P.tech, parts: [t("hook", 0, "She texted me this…"), mg("MgChat", 2.5, { name: "Kate", messages: "Did you see the news?|>No, what happened?|We won the contest!! 🏆|>NO WAY 😱" }), mg("MgEmojiScream", 7.8, { place: "top-right", size: 0.26 }), mg("MgNotification", 8, { app: "Mail", title: "You're a winner 🏆", body: "Claim your prize by Friday" })] },

	// ── Vlog & travel ──
	{ id: "travel-vlog", name: "Travel vlog", category: "Vlog & travel", themes: ["travel"], palette: P.ocean, featured: true, parts: [mg("MgViewfinder", "whole", { info: "4K 60P  ISO 100" }), mg("MgGeotag", 0.8, { place: "Lisbon, Portugal", sub: "Day 3" }, 3.6), mg("MgWeather", 4.6, { condition: "clear-day", temp: 27, city: "Lisbon", detail: "H 29° · L 19°" }), mg("MgMapRoute", 9.8, { from: "Lisbon", to: "Porto", info: "3 h by train" }), t("typewriter", 15, "Next stop: Porto")] },
	{ id: "travel-film", name: "Travel film", category: "Vlog & travel", themes: ["travel", "wedding"], palette: P.luxe, parts: [mg("MgFilmMatte", "whole"), mg("MgLightLeak", "whole", { intensity: 0.6 }), mg("MgCinematicTitle", "start", { title: "ICELAND", sub: "A film by Lena Moss" }), mg("MgFilmStrip", "end", { caption: "Ten days north" })] },
	{ id: "retro-vlog", name: "Retro VHS vlog", category: "Vlog & travel", themes: ["music", "travel", "fashion"], palette: P.sunset, parts: [mg("MgVhs", "whole", { date: "AUG. 12 1997" }), mg("MgGrain", "whole", { amount: 0.4, tint: 0.18 }), mg("MgStripeWipe", "start", { title: "ROLL TAPE" }), t("typewriter", 3, "Summer tapes, vol. 1")] },
	{ id: "winter-trip", name: "Winter trip", category: "Vlog & travel", themes: ["travel", "kids"], palette: P.ocean, parts: [mg("MgSnow", "whole"), mg("MgGradientIntro", "start", { title: "Snow days", sub: "Winter 2026" }), mg("MgWeather", 4, { condition: "snow", temp: -6, city: "Zermatt", detail: "Fresh snow 40 cm" }), mg("MgPolaroid", "end", { caption: "See you next winter", rotate: 3 })] },

	// ── Events ──
	{ id: "wedding", name: "Wedding film", category: "Events", themes: ["wedding"], palette: P.luxe, featured: true, parts: [mg("MgFilmLeader", "start"), mg("MgPassePartout", "whole", { caption: "Anna & Mark", sub: "12 · 06 · 2026" }), mg("MgBokeh", "whole"), mg("MgLightLeak", 3.4, { intensity: 0.55 }, 6), mg("MgBigQuote", "end", { quote: "Love is the whole thing. We are only pieces.", author: "Rumi" })] },
	{ id: "party", name: "Party", category: "Events", themes: ["kids", "music", "wedding"], palette: P.gold, parts: [mg("MgCircleBurst", "start", { title: "PARTY!" }), mg("MgPartyConfetti", 1.6), mg("MgKineticStack", 2.2, { line1: "FRIDAY", line2: "NIGHT", line3: "8 PM" }), mg("MgEmojiPartying", 6, { place: "bottom", size: 0.3 }), mg("MgFireworks", "end")] },
	{ id: "concert", name: "Concert night", category: "Events", themes: ["music"], palette: P.neon, coverAt: 14, parts: [mg("MgGradientIntro", "start", { title: "Live tonight", sub: "Doors 8 PM · Arena" }), mg("MgSparks", "whole"), mg("MgLensFlare", 3.6, { x: 0.5, y: 0.12, drift: 0 }, 5), mg("MgCountdown", 9, { from: 3, go: "SHOWTIME" }), mg("MgSocialHandles", "end", { title: "Tickets", handle1: "@arena.live", handle2: "@theband", handle3: "/tickets" })] },

	// ── Sports & fitness ──
	{ id: "fitness-intro", name: "Workout intro", category: "Sports & fitness", themes: ["fitness", "sports"], palette: P.sport, featured: true, parts: [mg("MgKineticStack", "start", { line1: "NO", line2: "PAIN", line3: "NO GAIN" }), mg("MgCountdown", 3, { from: 3, go: "GO!" }), mg("MgEmojiFire", 6.6, { place: "top-right", size: 0.24 }), mg("MgBigCounter", 6.6, { value: 500, suffix: " kcal", label: "burned today" }), mg("MgProgressBar", "end", { label: "Weekly goal", value: 80, sub: "4 of 5 workouts" })] },
	{ id: "game-day", name: "Game day", category: "Sports & fitness", themes: ["sports"], palette: P.sport, parts: [mg("MgZoomThrough", "start", { title: "GAME DAY" }), mg("MgStatTrio", 1.6, { v1: "3-1", l1: "score", v2: "62%", l2: "possession", v3: "14", l3: "shots" }), mg("MgCircleMark", 6.4, { label: "MVP", x: 0.5, y: 0.42 }), mg("MgSpeedLines", 6.4), mg("MgEmojiClap", "end", { place: "bottom", size: 0.3 })] },

	// ── Business & education ──
	{ id: "business-pitch", name: "Business pitch", category: "Business", themes: ["business", "tech"], palette: P.mint, parts: [mg("MgLogoReveal", "start", { name: "NORTHWIND", tagline: "Logistics, simplified", monogram: "N" }), mg("MgLineChart", 3.6, { title: "Orders per month, k", labels: "Jan, Feb, Mar, Apr, May, Jun", values: "12, 15, 19, 26, 33, 41" }), mg("MgBigCounter", 8.8, { value: 12000, suffix: "+", label: "clients in 30 countries" }), mg("MgLogoOutro", "end", { name: "NORTHWIND", url: "northwind.io", monogram: "N" })] },
	{ id: "explainer", name: "Explainer", category: "Business", themes: ["education", "tech"], palette: P.tech, parts: [mg("MgSplitBumper", "start", { title: "LESSON 1", sub: "How the internet works" }), mg("MgCallout", 2.2, { title: "Your router", sub: "Talks to the world", x: 0.4, y: 0.55 }), mg("MgBarChart", 6.8, { title: "Speed by year, Mbit/s", labels: "2010, 2015, 2020, 2025", values: "8, 25, 90, 300", unit: "" }), mg("MgSteps", 12, { title: "The path", steps: "Phone, Router, Server, Back" }), mg("MgSubscribe", "end", { channel: "Learn in 5", button: "SUBSCRIBE" })] },
	{ id: "podcast", name: "Podcast", category: "Business", themes: ["business", "education", "music"], palette: P.sunset, parts: [t("lower-third", 0.5, "Dr. Ana Lopes\nNeuroscientist"), mg("MgPip", "whole", { label: "GUEST" }), mg("MgCommentReply", 6, { name: "brainfan", comment: "Can you explain sleep cycles?" }), mg("MgSubscribe", "end", { channel: "Deep Talks", button: "FOLLOW" })] },
	{ id: "news-flash", name: "News flash", category: "Business", themes: ["news", "business"], palette: P.news, parts: [mg("MgBreaking", "start", { label: "BREAKING NEWS", headline: "City votes for a car-free centre", text: "Mayor to speak at 6 PM · Trams free this week" }), mg("MgTicker", "whole", { label: "LIVE", text: "Car-free centre from May · Trams free this week · Weather: sunny, 24°" }), mg("MgWeather", 7.8, { condition: "partly-cloudy-day", temp: 24, city: "City centre", detail: "Light wind" }), t("lower-third", 12, "Maria Chen\nCity reporter")] },
	{ id: "real-estate", name: "House tour", category: "Business", themes: ["real-estate"], palette: P.estate, featured: true, parts: [mg("MgLogoReveal", "start", { name: "HAVEN HOMES", tagline: "Find your place", monogram: "H" }), mg("MgPriceTag", 3.6, { title: "Asking price", price: "450K", oldPrice: "", badge: "NEW" }), mg("MgCallout", 8, { title: "Open-plan kitchen", sub: "Oak floors · south light", x: 0.42, y: 0.6 }), mg("MgMapRoute", 12.6, { from: "Home", to: "Centre", info: "12 min drive" }), mg("MgLogoOutro", "end", { name: "HAVEN HOMES", url: "havenhomes.com", monogram: "H" })] },
	{ id: "recipe", name: "Recipe", category: "Business", themes: ["food"], palette: P.food, parts: [mg("MgMarquee", "start", { text: "15-MINUTE PASTA" }, 2.6), mg("MgSteps", 2.6, { title: "Recipe", steps: "Boil, Fry garlic, Toss, Parmesan" }), mg("MgStopwatch", 7.8, { place: "top-right", size: 0.24, caption: "15 min" }), mg("MgEmojiHeartEyes", 8.2, { place: "bottom", size: 0.24 }), mg("MgRating", "end", { title: "Loved by home cooks", rating: 4.9, count: "2,300 reviews" })] },

	// ── Gaming & fun ──
	{ id: "gaming", name: "Gaming clip", category: "Gaming & fun", themes: ["gaming"], palette: P.neon, featured: true, parts: [mg("MgGlitch", "start", { label: "GG" }), mg("MgHud", 1.4, { label: "TARGET LOCKED" }), mg("MgSpeedLines", 5.6), mg("MgComicBoom", 5.8, { text: "HEADSHOT!" }), mg("MgEndScreen", "end", { title: "Thanks for watching!", button: "SUBSCRIBE", next: "Ranked climb", more: "Best plays" })] },
	{ id: "kids-fun", name: "Kids fun", category: "Gaming & fun", themes: ["kids"], palette: P.kids, coverAt: 6.4, parts: [mg("MgCircleBurst", "start", { title: "YAY!" }), mg("MgBubbles", "whole"), mg("MgConfetti", 1.8), mg("MgEmojiJoy", 4, { place: "bottom-right", size: 0.28 }), mg("MgComicBoom", 5.6, { text: "WOW!" })] },

	// ── More packs ──
	{ id: "black-friday", name: "Black Friday", category: "Ads", themes: ["fashion", "tech", "beauty"], palette: { accent: "#FFD23F", color2: "#111111" }, parts: [mg("MgStripeWipe", "start", { title: "BLACK FRIDAY", accent: "#111111", color2: "#FFD23F", color3: "#FF3D71", ink: "#FFFFFF" }), mg("MgSaleBurst", 1.6, { title: "UP TO", discount: "-80%", sub: "Friday only" }), mg("MgOfferTimer", 5.2, { title: "Ends in", hours: 23, minutes: 59, seconds: 59 }), mg("MgMoneyRain", 5.2, {}, 3), mg("MgBuyNow", "end", { button: "SHOP NOW", sub: "Free shipping all weekend" })] },
	{ id: "food-delivery", name: "Food delivery", category: "Ads", themes: ["food", "business"], palette: P.food, parts: [mg("MgNotification", "start", { app: "Food", title: "Your order is on its way 🛵", body: "Arriving in 12 minutes", title2: "Courier is 2 min away", body2: "Get the door ready" }), mg("MgMapRoute", 2.6, { from: "Kitchen", to: "You", info: "12 min" }), mg("MgPriceTag", 7.8, { title: "Free delivery", price: "0", oldPrice: "4.99", badge: "TODAY" }), mg("MgEmojiFire", 8.4, { place: "top-left", size: 0.22 }), mg("MgLinkInBio", "end", { text: "Order now", url: "eat.yourapp.com" })] },
	{ id: "app-promo", name: "App promo", category: "Ads", themes: ["tech", "business"], palette: P.tech, parts: [mg("MgPhoneFrame", "start", { label: "Meet Flowly" }, 4), mg("MgNotification", 4.2, { app: "Flowly", title: "Welcome aboard 👋", body: "Your first week is free", title2: "Streak: 7 days 🔥", body2: "You're on fire" }), mg("MgStatTrio", 8.4, { v1: "1M+", l1: "downloads", v2: "4.8★", l2: "rating", v3: "#1", l3: "in productivity" }), mg("MgSwipeUp", "end", { text: "Download free", sub: "iOS and Android" })] },
	{ id: "beauty-routine", name: "Beauty routine", category: "Social", themes: ["beauty"], palette: P.blush, coverAt: 10.5, parts: [mg("MgWordPop", "start", { text: "My *glow* routine" }), mg("MgSteps", 3.6, { title: "Routine", steps: "Cleanse, Tone, Serum, Glow" }), mg("MgHearts", 8.6, {}, 4), mg("MgRating", 8.8, { title: "Skin loves it", rating: 4.9, count: "my holy grail" }), mg("MgLinkInBio", "end", { text: "Shop the routine", url: "glow.yourbrand.com" })] },
	{ id: "unboxing", name: "Unboxing", category: "Social", themes: ["tech", "fashion", "kids"], palette: P.gold, parts: [mg("MgViewfinder", "whole", { info: "UNBOXING" }), mg("MgGiftBox", 0.4, { size: 0.4 }), mg("MgComicBoom", 2.8, { text: "WOW!" }), mg("MgProductShowcase", 4.6, { name: "Nova Watch", feat1: "7-day battery", feat2: "Sapphire glass", feat3: "Swim-proof" }), mg("MgRating", "end", { title: "First impression", rating: 4.7, count: "full review soon" })] },
	{ id: "day-in-life", name: "Day in my life", category: "Vlog & travel", themes: ["travel", "fashion", "food"], palette: P.sunset, parts: [mg("MgStory", "whole", { name: "my.day", time: "now" }), mg("MgClock", 0.6, { time: "06:30", speed: 900, label: "6:30 AM — up early", size: 0.4 }, 3.6), mg("MgChat", 4.4, { name: "Mom", messages: "Where are you today?|>Exploring the old town ☀️|Send photos!|>On it 📸" }), mg("MgPolaroid", "end", { caption: "A day well spent", rotate: -3 })] },
	{ id: "road-trip", name: "Road trip", category: "Vlog & travel", themes: ["travel"], palette: P.sunset, coverAt: 8.6, parts: [mg("MgVhs", "whole", { date: "JUL. 14 2026" }), mg("MgMapRoute", 1.2, { from: "Home", to: "The coast", info: "620 km" }), mg("MgKineticStack", 7, { line1: "ROAD", line2: "TRIP", line3: "2026" }), mg("MgGeotag", 10.6, { place: "Big Sur, California", position: "bottom" }, 3.4)] },
	{ id: "birthday", name: "Birthday", category: "Events", themes: ["kids", "wedding", "music"], palette: P.kids, parts: [mg("MgCountdown", "start", { from: 3, go: "HAPPY BIRTHDAY!" }), mg("MgPartyConfetti", 3.3), mg("MgKineticStack", 3.6, { line1: "HAPPY", line2: "BIRTHDAY", line3: "ANNA" }), mg("MgEmojiPartyPopper", 7, { place: "bottom", size: 0.3 }), mg("MgBokeh", "end")] },
	{ id: "save-the-date", name: "Save the date", category: "Events", themes: ["wedding"], palette: P.luxe, parts: [mg("MgBokeh", "whole"), mg("MgCinematicTitle", "start", { title: "SAVE THE DATE", sub: "June 12, 2026" }), mg("MgPolaroid", 4.4, { caption: "Anna & Mark", rotate: -4 }), mg("MgPassePartout", "end", { caption: "Anna & Mark", sub: "Lisbon" })] },
	{ id: "music-release", name: "Music release", category: "Events", themes: ["music"], palette: P.neon, parts: [mg("MgZoomThrough", "start", { title: "NEW SINGLE" }), mg("MgCrt", "whole", { label: "CH 07" }), mg("MgBigCounter", 3.4, { value: 1000000, suffix: " streams", label: "first week" }), mg("MgSocialHandles", "end", { title: "Listen now", handle1: "@nightdrive", handle2: "@nightdrive.music", handle3: "/nightdrive" })] },
	{ id: "match-highlights", name: "Match highlights", category: "Sports & fitness", themes: ["sports"], palette: P.sport, parts: [mg("MgBreaking", "start", { label: "HIGHLIGHTS", headline: "Late winner seals the title" }), mg("MgSpeedLines", 4.2), mg("MgStatTrio", 6.8, { v1: "2-1", l1: "final", v2: "89'", l2: "winner", v3: "54k", l3: "fans" }), mg("MgArrow", 11.6, { label: "The winner", x: 0.55, y: 0.45, from: "bottom" }), mg("MgTicker", "end", { label: "SPORT", text: "Next match Saturday · Tickets on sale now" })] },
	{ id: "workout-timer", name: "Workout timer", category: "Sports & fitness", themes: ["fitness"], palette: P.sport, parts: [mg("MgOutlineFill", "start", { title: "HIIT" }), mg("MgCountdown", 3, { from: 3, go: "GO!" }), mg("MgSteps", 6.6, { title: "Round 1", steps: "Squats, Burpees, Plank, Rest" }), mg("MgStopwatch", 6.6, { place: "top-right", size: 0.22 }, 5), mg("MgBigCounter", "end", { value: 30, suffix: " min", label: "done" })] },
	{ id: "esports", name: "Esports", category: "Gaming & fun", themes: ["gaming"], palette: P.neon, parts: [mg("MgBlockBumper", "start", { title: "GG" }), mg("MgHud", 1.8, { label: "ENEMY DOWN" }), mg("MgCrt", 6.8, { label: "REPLAY" }, 5), mg("MgBigCounter", 6.8, { value: 27, suffix: " kills", label: "season best" }), mg("MgSubscribe", "end", { channel: "NeonLeague", button: "SUBSCRIBE" })] },
	{ id: "quarterly-results", name: "Quarterly results", category: "Business", themes: ["business", "news"], palette: P.mint, parts: [mg("MgSplitBumper", "start", { title: "Q3 2026", sub: "Results" }), mg("MgBarChart", 2.2, { title: "Revenue, $M", labels: "Q4, Q1, Q2, Q3", values: "18, 24, 31, 42", unit: "" }), mg("MgDonutChart", 7.4, { title: "Revenue by region", labels: "Europe, Americas, Asia", values: "45, 35, 20" }), mg("MgLineChart", 12.6, { title: "Customers, thousands", labels: "Q4, Q1, Q2, Q3", values: "41, 48, 57, 70" }), mg("MgBigQuote", "end", { quote: "Our best quarter yet.", author: "Dana Kim, CEO" })] },
	{ id: "online-course", name: "Online course", category: "Business", themes: ["education"], palette: P.tech, coverAt: 5.2, parts: [mg("MgLineReveal", "start", { name: "MASTERCLASS", tagline: "Lesson 3 · Colour" }), mg("MgPip", 3.6, { label: "TEACHER", corner: "bottom-right" }, 6), mg("MgSteps", 3.8, { title: "Today", steps: "Theory, Example, Practice", backdrop: false }), mg("MgPoll", 10, { question: "Ready for the quiz?", options: "Yes!, Need a recap", values: "71, 29", votes: "Answer below" }), mg("MgEndScreen", "end", { title: "Next lesson", button: "SUBSCRIBE", next: "Lesson 4", more: "All lessons" })] },
	{ id: "open-house", name: "Open house", category: "Business", themes: ["real-estate"], palette: P.estate, parts: [mg("MgFilmMatte", "whole", { ratio: "1.85" }), mg("MgCinematicTitle", "start", { title: "OPEN HOUSE", sub: "Saturday 11–3" }), mg("MgStatTrio", 4.4, { v1: "4", l1: "bedrooms", v2: "210 m²", l2: "living", v3: "2", l3: "garages" }), mg("MgMagnifier", 9, { zoom: 2.4, x: 0.5, y: 0.5 }, 4), mg("MgPriceTag", "end", { title: "Offers from", price: "620K", oldPrice: "", badge: "NEW", currency: "$" })] },
	{ id: "comic-reaction", name: "Comic reaction", category: "Gaming & fun", themes: ["kids", "gaming"], palette: P.kids, parts: [mg("MgSpeedLines", "start"), mg("MgComicBoom", 0.4, { text: "WHAT?!" }), mg("MgSplitReveal", 3, { title: "EXPECTED", reveal: "REALITY" }), mg("MgEmojiMindBlown", 6.2, { place: "center", size: 0.4 }), mg("MgConfetti", "end", { mode: "rain" })] },

	// ── Talking head & titles (text presets with graphics) ──
	{ id: "expert", name: "Expert talk", category: "Talking head", themes: ["business", "education"], palette: P.mint, coverText: true, coverAt: 11, parts: [t("lower-third", undefined, "Dr. Sam Patel\nSleep researcher"), mg("MgCallout", 4, { title: "7–9 hours", sub: "what adults need", x: 0.3, y: 0.3, side: "right" }), mg("MgBigCounter", 9, { value: 63, suffix: "%", label: "sleep less than that" }), t("caption")] },
	{ id: "story", name: "Story", category: "Talking head", themes: ["travel", "education"], palette: P.sunset, coverText: true, coverAt: 6, parts: [t("typewriter", undefined, "It started with\none ticket…"), mg("MgFilmBurn", 3, { from: "right" }), mg("MgGeotag", 4.4, { place: "Kyoto, Japan", sub: "2019" }, 3.6), t("cta", undefined, "Part 2 tomorrow")] },
	{ id: "hook-caption", name: "Hook + captions", category: "Talking head", themes: ["education", "business", "beauty"], palette: P.gold, coverText: true, parts: [t("hook", undefined, "Stop scrolling —\nthis saves you $500"), mg("MgEmojiHundred", 0.8, { place: "top-right", size: 0.22 }, 2.4), mg("MgCircleMark", 5, { label: "this part", x: 0.5, y: 0.6 }), t("caption")] },
	{ id: "quote-card", name: "Quote card", category: "Talking head", themes: ["education", "wedding"], palette: P.luxe, coverText: true, parts: [mg("MgGrain", "whole", { amount: 0.25 }), t("quote", undefined, "“Do the hard thing first.”"), t("lower-third", undefined, "Daily motivation\nDay 12")] },
	{ id: "promo", name: "Promo", category: "Titles", themes: ["music", "fashion"], palette: P.gold, coverText: true, parts: [mg("MgLiquidWipe", "start", { label: "NEW" }), t("bold-pop", 1.6, "THE DROP\nIS HERE"), mg("MgTwinkle", 2, { place: "top", size: 0.4 }, 3), t("cta", undefined, "Out now")] },
	{ id: "trailer", name: "Trailer", category: "Titles", themes: ["music", "gaming"], palette: P.luxe, coverText: true, parts: [mg("MgFilmMatte", "whole"), mg("MgLensFlare", "start", { x: 0.15, y: 0.5, drift: 0.6 }, 4), t("cinematic", 0.6, "THIS SUMMER"), mg("MgShutter", 5, { label: "COMING SOON" }), t("callout", 7, "Only in cinemas")] },
	{ id: "neon-night", name: "Neon night", category: "Titles", themes: ["music", "gaming"], palette: P.neon, coverText: true, parts: [mg("MgRain", "whole", { darken: 0.35 }), t("neon", 0.5, "NIGHT\nDRIVE"), mg("MgGlitch", 4.6, { label: "" }), t("cta", undefined, "Stream it tonight")] },
	{ id: "glitch-intro", name: "Glitch intro", category: "Titles", themes: ["gaming", "tech"], palette: P.neon, coverText: true, parts: [mg("MgGlitch", "start", { label: "SYSTEM" }), t("glitch", 1.2, "SYSTEM\nONLINE"), mg("MgCrt", 1.2, { label: "AV-1" }, 6), t("kinetic-zoom", 5, "LEVEL UP")] },
];

/** Every template, its cover on the photo of its first theme. The owner's own edition offers only the text-motion packs
 * and the ones his projects use (src/edition/cuts.ts); a project made with any other still plays: its layers are
 * ordinary motion graphics and texts. */
export const ALL_TEMPLATES: Template[] = DEFS.map((d) => ({ ...d, cover: themePhoto(d.themes[0]) }));
/** The packs this edition offers (the panel, the connector's `template` kind). */
export const TEMPLATES: Template[] = ALL_TEMPLATES.filter((d) => EDITION.templatePacks || KEPT_TEMPLATE_PACKS.has(d.id));

/**
 * Graphics whose colours describe the thing itself, not the brand — light, film, frames, platform screens, stickers,
 * markers — keep their own colours under a pack's palette.
 */
const OWN_COLOURS = new Set(["Light & texture", "Camera & film", "Layouts", "Social screens", "News", "HUD & comic", "Stickers", "Animated emoji", "Arrows & callouts"]);
const OWN_COLOUR_KINDS = new Set(["MgSnow", "MgSwipeUp", "MgShutter", "MgFilmLeader", "MgZoomThrough"]);

/** A graphic layer's fields: the graphic's defaults, the pack's colours where it carries brand colours, then its own. */
export function layerParams(template: Template, part: MgPart): Record<string, PropValue> {
	const kind = MOGRAPH_BY_KIND.get(part.mg);
	if (!kind) return { ...part.params };
	const keys = new Set(kind.fields.map((f) => f.key));
	const palette: Record<string, PropValue> = {};
	if (template.palette && !OWN_COLOURS.has(kind.category) && !OWN_COLOUR_KINDS.has(kind.kind)) {
		for (const [key, value] of Object.entries(template.palette)) if (value && keys.has(key)) palette[key] = value;
	}
	return { ...mographDefaults(kind), ...palette, ...part.params };
}

/** The template's own length: its timed layers end by then (10 s at least). */
export function templateSeconds(template: Template, textSeconds: (id: string) => number = () => 3): number {
	let end = 0;
	let tail = 0;
	for (const part of template.parts) {
		const dur = "mg" in part ? (part.dur ?? MOGRAPH_BY_KIND.get(part.mg)?.dur ?? 3) : textSeconds(part.text);
		if (typeof part.at === "number") end = Math.max(end, part.at + dur);
		if (part.at === "start") end = Math.max(end, dur);
		if (part.at === "end") tail = Math.max(tail, dur);
	}
	return Math.max(10, end + tail);
}

export interface PlacedLayer {
	part: TemplatePart;
	/** Seconds from the start of the video; null = the text preset places itself. */
	start: number | null;
	/** Seconds; null = the preset's own length. */
	dur: number | null;
}

/**
 * Every layer's start and length on a video of `videoSeconds` (the template's own length when the timeline is shorter
 * or empty): «start» from 0, «end» finishing with the video, «whole» across it, a number from that second.
 */
export function placeTemplate(template: Template, videoSeconds: number, textSeconds: (id: string) => number = () => 3): PlacedLayer[] {
	const span = Math.max(videoSeconds, templateSeconds(template, textSeconds));
	return template.parts.map((part) => {
		if (!("mg" in part)) {
			if (part.at == null) return { part, start: null, dur: null };
			const dur = textSeconds(part.text);
			return { part, start: part.at === "end" ? Math.max(0, span - dur) : part.at === "whole" || part.at === "start" ? 0 : part.at, dur: part.at === "whole" ? span : dur };
		}
		const dur = part.dur ?? MOGRAPH_BY_KIND.get(part.mg)?.dur ?? 3;
		if (part.at === "whole") return { part, start: 0, dur: span };
		if (part.at === "end") return { part, start: Math.max(0, span - dur), dur };
		return { part, start: part.at === "start" ? 0 : part.at, dur };
	});
}

/** A graphic that covers the whole frame (a bumper, an intro on its own background): the video doesn't show. */
const fillsFrame = (kind: string) => {
	const k = MOGRAPH_BY_KIND.get(kind);
	return !k || k.category === "Bumpers" || kind === "MgGradientIntro" || kind === "MgFilmLeader" || k.fields.some((f) => f.key === "backdrop" && f.default === true);
};

/**
 * The second the cover shows: the first timed graphic drawn over the video, once its entrance has played — so the
 * card shows the template on its theme's photo; a template of overlays only shows its middle.
 */
export function coverMoment(template: Template): number {
	if (template.coverAt != null) return template.coverAt;
	const span = templateSeconds(template);
	for (const { part, start, dur } of placeTemplate(template, 0)) {
		if (!("mg" in part) || part.at === "whole" || start == null || dur == null || fillsFrame(part.mg)) continue;
		return start + (MOGRAPH_BY_KIND.get(part.mg)?.previewAt ?? Math.min(dur * 0.55, 2.2));
	}
	return Math.min(span / 2, 4);
}
