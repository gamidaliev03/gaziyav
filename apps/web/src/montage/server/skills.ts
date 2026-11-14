import { GITHUB_SKILLS } from "./skills-github";

// Motion-design skills the composer loads on demand, like an agent loading a skill for the task at hand: only the
// ones the request needs go into its prompt. Condensed and adapted to this sandbox (Remotion components with the
// imports listed in knowledge.ts) from open-source craft: iart-ai motion skills (MIT) — animation principles, logo
// animation, kinetic typography, map animation, short-form video, data animation, explainers — and the official
// Remotion skills. Like knowledge.ts: no literal on-screen words, every text comes from props.

export interface Skill {
	id: string;
	/** Words in the request (any language) that call for this skill. */
	when: RegExp;
	text: string;
}

/** Always loaded: the craft every animation needs. */
export const PRINCIPLES = `## Animation principles (always)
- Timing at 30 fps: a pop 6–9 frames, a move 12–20, a scene beat 45–90. Hold every finished state ≥ 1 s before it changes again.
- Ease everything: in-out for moves across the frame, out (fast start, soft land) for entrances, in for exits. Linear only for continuous loops (rotation, scrolling).
- Overshoot and settle for objects that land (spring damping 10–14, or scale 0 → 1.08 → 1). Anticipation before a big move: 3–5 frames the other way.
- Stagger groups (0.05–0.15 s apart) instead of moving them together; the eye follows the order — most important last or first, never random.
- Follow-through and secondary motion: what stops keeps a small wobble (spring), hair/tails/ribbons lag a few frames.
- Arcs, not straight lines, for anything alive. Squash on impact, stretch on fast moves (keep the volume: scaleX × scaleY ≈ 1).
- One focal point at a time; everything else calmer or dimmed. Contrast in speed: fast pops against slow drifts.`;

export const SKILLS: Skill[] = [
	{
		id: "styles",
		when: /./,
		text: `## Style — pick it from the request, never default to one look
Read the request for a style word or mood and commit to ONE style for the whole composition; if none is named, choose the style the content and the audience call for (kids topic → kids style, game → pixel, finance → clean, party → pop). Business glass plates are only for corporate/clean requests.
- Clean / corporate: dark glass plates (rgba(15,17,22,.72) + blur), one accent, Manrope/Onest, soft shadows, slow precise eases.
- Cartoon: flat saturated fills, thick dark outlines (6–10u, round joins), squash & stretch, bouncy springs, Rubik/Unbounded.
- Kids: rounded everything, primary + pastel colours on a cream background, big friendly shapes, wobble and bounce, smiling simple characters.
- Pixel / 8-bit retro: a coarse grid, crisp edges, a limited palette, stepped motion (8–12 steps per second).
- Hand-drawn / sketch: paper colour background, marker strokes drawn on with evolvePath, slight line boil, handwritten-looking font weight.
- Neon / cyber: near-black background, magenta/cyan glow (stacked drop-shadows), flicker on entrance (opacity steps), grid lines.
- Retro 80s / synthwave: purple-orange gradient sun, perspective grid floor, chrome text, scanlines.
- Comic / pop-art: halftone dots, bold outlines, burst bubbles, primary colours, angled panels.
- Luxury: serif (PlayfairDisplay), gold (#C9A14A) on black, slow fades and tracking, thin lines.
- Minimal Swiss: white or black, one strong colour, big type on a grid, hard cuts between beats.
- Paper cut-out: layered flat shapes with drop shadows, slight rotation jitter, stop-motion stepping.
State the style in your plan line.`,
	},
	{
		id: "cartoon",
		when: /мульт|cartoon|детск|kids|child|для детей|ребён|персонаж|character|мишк|котик|зверь|animal|смешн|funny|игрушеч|hand.?drawn|рисованн|скетч|sketch|дудл|doodle|стикер|sticker|пузыр|bubble|милый|cute/i,
		text: `## Cartoon, kids and hand-drawn drawing in SVG
- Build characters and objects from primitives: <circle>, <ellipse>, <rect rx>, and <path> with quadratic curves (Q) for smooth organic outlines. One <svg viewBox="0 0 1080 1920"> per layer; group parts in <g transform> so heads, arms and eyes move separately.
- Outline: stroke the fills with a dark colour (#1d1d27), strokeWidth 8–12, strokeLinejoin/strokeLinecap "round". Kids: no black — darker shade of the fill instead.
- Life: idle bob (translateY = sin(frame/fps·2π·0.8)·6u), blink (eyes scaleY 1 → 0.1 → 1 over 4 frames every ~2.6 s), head tilt on emphasis, arms waving on arcs.
- Squash & stretch: on landing scaleY 0.8 / scaleX 1.2 for 3 frames, then spring back; jumps on parabolic arcs.
- Line boil (hand-drawn feel): displace path points by noise2D(seed, i, Math.floor(frame/3))·2u — redrawn every 3 frames ("on threes").
- Speech/thought bubbles: rounded rect + a tail path; pop in with spring (0 → 1.1 → 1); text inside from props; thought bubble = 3 shrinking circles.
- Decoration: sparkles (4-point stars scaling and rotating), confetti (random('seed-'+i) positions, falling with rotation), hearts, motion lines behind fast objects.
- Palettes: kids #FFD93D #6BCB77 #4D96FF #FF6B6B on #FFF8E7; cartoon #FF5D5D #FFC93C #3DB2FF #7C5CFF with #1d1d27 outlines.
- Faces sell it: big round eyes with white highlights, simple curved mouth that opens on speech beats.`,
	},
	{
		id: "pixel",
		when: /пиксел|pixel|8.?bit|8-бит|ретро.?игр|retro game|арказ|arcade|minecraft|майнкрафт|денди|nes\b|game ?boy|игров|video ?game/i,
		text: `## Pixel art
- Choose a grid (e.g. 90 columns across the width: cell = width / 90) and snap everything to it: x = Math.round(x / cell) * cell.
- Draw with <svg shapeRendering="crispEdges"> and <rect> per pixel (or per run of pixels). Sprites as arrays of strings in props or constants of shape only, e.g. rows of "..XX..": map each char to a palette colour.
- Stepped motion: const step = Math.floor(frame / (fps / 10)); positions and sprite frames change per step, never smoothly. Walk cycles = 2–4 sprite frames.
- Palette (PICO-8): #000000 #1D2B53 #7E2553 #008751 #AB5236 #5F574F #C2C3C7 #FFF1E8 #FF004D #FFA300 #FFEC27 #00E436 #29ADFF #83769C #FF77A8 #FFCCAA — use 4–8 of them.
- Text: build letters from a 5×7 bitmap font (a small map of the letters you need, each as 7 strings of 5 chars) drawn as rects; or a heavy font (Unbounded 900) with no anti-aliasing look (text-shadow in hard steps).
- Effects: blinking "PRESS START", score counters, coin pickups (+1 popping up in steps), screen shake in whole cells, CRT scanlines (repeating-linear-gradient 2px) and a slight vignette.`,
	},
	{
		id: "map",
		when: /карт[аеуоыи](?![а-яё])|map\b|маршрут|route|путь|path|путешеств|travel|перелёт|перелет|flight|самолёт|самолет|plane|из .+ в |страна|country|город|city|глобус|globe|location|локаци/i,
		text: `## Map animation with a moving route
- Geography that must be real: ask for an "image" asset of the map ("map of <region>", Wikimedia Commons) and draw the route over it in its own coordinates (fractions of the picture). If exact geography is not needed, draw a stylised map yourself: land as soft blobs (noise-shaped paths), water as a flat colour, a light grid.
- The route: an SVG path through the points (smooth with cubic curves). Draw it with evolvePath(progress, d) over 1.5–3 s (ease in-out), as a dashed or glowing line in one bright colour on a muted map.
- A moving icon (plane, car, ship, pin): position from getPointAtLength(d, len·progress) and rotation from getTangentAtLength (atan2 → degrees), both from '@remotion/paths' (getLength gives len). A fading trail behind it.
- Camera: the map layer scales 1.2–1.8 and translates so the head of the route stays near the centre; ease the camera slightly behind the icon. Start wide, push in, end wide on the whole route.
- Markers: start and end pins pop in (spring), pulse rings (scale 1 → 2.2, opacity 1 → 0, looping), city labels appear when the route reaches them (text from props).
- Editorial look (Vox-style): desaturated base, one accent route colour, drop shadow under the route, a small legend or distance counter.`,
	},
	{
		id: "logo",
		when: /лого|logo|бренд|brand|эмблем|emblem|знак|wordmark|заставк|intro|интро|outro|аутро|концовк|reveal|появлен|png|svg|иконк приложени|app icon/i,
		text: `## Logo and picture reveals (the user's own PNG/SVG from media)
- One idea per logo: draw OR wipe OR build OR assemble — not all. Reveal 0.8–2.5 s, then hold the clean mark ≥ 1 s. Never stretch or skew the brand; scale and fade are safe. Keep clear space around it.
- SVG (media has paths): draw each path with evolvePath (stroke = the logo colour, 1.2 s, stagger 0.1 s), then fade the fills in under the strokes and fade the strokes out.
- PNG with transparency: <Picture asset={p.assets.logo}/> with, for example:
  · mask wipe: clipPath inset(0 X% 0 0) from 100 % to 0 %, eased; or a circle clip growing from the centre;
  · scale 0.86 → 1.04 → 1 (spring) + blur(12u) → 0 + opacity, landing on the beat;
  · light sweep: a diagonal white gradient band moving across, limited to the logo with maskImage: url(<asset url>) and mixBlendMode 'screen';
  · glow: filter drop-shadow(0 0 30u accent) pulsing once at the settle;
  · assemble: the picture cut into a grid of tiles (background-position per tile) flying in from random('t'+i) offsets with stagger, snapping together;
  · particles converging into the logo centre, then the logo pops; 3D tilt: perspective(1200px) rotateY(25° → 0) rotateX(10° → 0).
- Backdrop: a soft radial gradient in the logo's own colours (media lists them), subtle grain; finish with a small tagline from props if given.
- With a sound: the settle frame lands exactly on the hit.`,
	},
	{
		id: "kinetic",
		when: /кинетич|kinetic|типограф|typograph|текст ан|text anim|слова|words|цитат|quote|заголов|title|lyric|караоке|karaoke|субтитр|caption|фраз/i,
		text: `## Kinetic typography
- Split text into words (and characters for short words): each unit gets its own enter with a stagger 2–4 frames; reveal behind a mask (a wrapper with overflow hidden, the word slides from translateY 100 % to 0).
- Tie words to the speech: a word appears at its spoken time (word timings), the current word is emphasised (accent colour, scale 1.1, heavier weight), past words dim.
- Rhythm: big single words on strong beats (fill 70–85 % of the width), small connective words smaller; vary size, weight and alignment between lines, keep one grid.
- Moves: scale punch (1.25 → 1 in 6 frames), tracking in (letterSpacing 0.4em → 0), slide-and-stop with overshoot, rotate-in 8°, split colour fills, outline-to-fill.
- Never more than ~3 lines on screen; clear the previous group before the next (fast exit 6–8 frames).`,
	},
	{
		id: "data",
		when: /инфограф|infograph|график|chart|диаграм|diagram|статист|statistic|процент|percent|%|цифр|number|рост|growth|сравнен|compar|рейтинг|rating|топ ?\d|top ?\d|счётчик|счетчик|counter|данн|data|bar|столб/i,
		text: `## Data and infographics
- Data lives in props (arrays of {label, value}); positions and sizes are computed from it, never hard-coded.
- Counters: value = interpolate(progress, [0,1], [from, to]) with an out-ease, formatted (Math.round, thousands separators, unit from props); the number lands, then pulses once.
- Bars grow from a baseline (scaleY from 0 with transformOrigin bottom), staggered 0.08 s, labels and values appear after each bar lands; the key bar in the accent colour, others neutral.
- Pie/donut: <Pie progress/> from '@remotion/shapes' or stroke-dasharray on a circle; a line chart is a path drawn with evolvePath, then dots pop on the points.
- Comparisons: two columns or two cards side by side, the winner gets the accent and a small check; rankings reveal from last to first.
- Keep 3–6 data points per screen; units and sources (if given) in a small caption.`,
	},
	{
		id: "social",
		when: /чат|chat|сообщен|message|переписк|telegram|whatsapp|imessage|коммент|comment|лайк|like|уведомлен|notification|соцсет|social|подпис|subscribe|отзыв|review|эмодзи|emoji|реакци|reaction/i,
		text: `## Social UI, chats and reactions
- Chat bubbles: incoming (light grey, left) and outgoing (accent, right), radius 36u with a tail corner, text from props, appearing one by one with a typing indicator (three dots bouncing in sequence) before each incoming bubble.
- Notifications: a card sliding from the top with an app-like icon circle, title and text from props, spring settle, auto-exit after ~1.5 s.
- Reactions: hearts/likes bursting upward (random('h'+i) drift, scale and fade), a like counter ticking up, emoji via emojiFont() popping with overshoot.
- Comment/review cards: avatar circle, name, stars filling one by one, quote text; stack and slide.
- Keep them inside the safe area and off the face.`,
	},
	{
		id: "background",
		when: /фон|background|backdrop|градиент|gradient|частиц|particle|абстракт|abstract|волн|wave|переход|transition|сцена|scene|заставк|intro|loop|луп|neon|неон|retro|ретро|80|synthwave|космос|space|звёзд|звезд|star/i,
		text: `## Backgrounds, atmosphere and in-scene transitions
- Living gradients: 2–3 large radial gradients whose centres drift with noise2D (slow, 0.05–0.2 per second); never a flat dead fill for a full-frame scene.
- Particles: 30–120 dots/shapes with positions from random('p'+i), slow drift and twinkle (opacity by noise); depth by size and speed (parallax).
- Starfield/space: points moving outward from the centre with growing size; nebula = blurred gradients.
- Synthwave: a perspective grid floor (lines converging to the horizon, scrolling down), a striped gradient sun, purple → orange sky.
- Grain and vignette at low opacity for a filmic look; scanlines only for retro.
- Between beats inside a scene: wipes (clipPath circle/inset), zoom-through, slide pushes, shape transitions (a coloured shape covering the frame then revealing the next beat) — 10–16 frames, eased.`,
	},
	{
		id: "product",
		when: /товар|product|продукт|магазин|shop|цен[аеуы]|price|скидк|sale|discount|распродаж|акци|offer|3d|объём|объем|карточк|card|упаковк|package|iphone|телефон|phone|приложен|app\b|ui\b|интерфейс|screen/i,
		text: `## Product and 3D-feel scenes
- Depth with CSS 3D: a container with perspective(1400px); the product picture or card rotates rotateY 30° → 0 and rotateX 12° → 0 while it settles; a soft floor shadow (blurred ellipse) scales with it.
- Floating: translateY = sin(t·0.8)·10u, a slow rotate ±2°; a reflection (flipped, faded) under it for premium.
- Price/offer: the old price struck through by a drawn line, the new price pops with overshoot in the accent, a badge (−X % from props) rotates in.
- Phone/app UI: a device frame (rounded rect with a notch) containing the screenshot; tap ripples (circle scaling and fading) on the buttons the request names; scroll the screenshot inside.
- Feature callouts: lines drawn from the product to small labels, staggered.`,
	},
	{
		id: "explainer",
		when: /объясн|explain|как работает|how it works|по шагам|step|этап|stage|процесс|process|схем|scheme|mind ?map|интеллект|концеп|concept|урок|lesson|обучен|tutorial|история|story|сюжет/i,
		text: `## Explainer scenes
- Structure in beats, in the order the request or the speech gives them: one idea per beat (1.5–3 s each), each beat one clear picture, not a wall of text.
- An "infinite canvas": all beats laid out on a big plane; the camera (translate + scale on a wrapper) glides from one to the next with an in-out ease, so the viewer feels the progression.
- Icons + arrows + short labels (from props): arrows drawn with evolvePath, icons pop on arrival, the current step highlighted, past steps dimmed.
- Mind maps: the central idea first, branches drawn outward in the order they are said, nodes as rounded pills, curved connectors.
- Characters (simple cartoon figures) make abstract ideas concrete: one character reacting to each step.`,
	},
];

/** Which open-source skills (GitHub, as their authors wrote them) a request calls for. */
const GITHUB_WHEN: Record<string, RegExp> = {
	"logo-animation": /лого|logo|бренд|brand|эмблем|wordmark/i,
	"map-animation": /карт[аеуоыи](?![а-яё])|map\b|маршрут|route|перелёт|перелет|flight|путешеств|travel/i,
	"remotion-static-map": /карт[аеуоыи](?![а-яё])|map\b|маршрут|route/i,
	"kinetic-typography": /кинетич|kinetic|типограф|typograph|цитат|quote|текст ан|text anim|слова|words/i,
	"caption-animation": /субтитр|caption|караоке|karaoke/i,
	"animated-infographic": /инфограф|infograph|статист|statistic|цифр|данн|data/i,
	"chart-animation": /график|chart|диаграм|diagram|столб|bar|pie|рост|growth/i,
	"diagram-animation": /схем|scheme|diagram|диаграм|mind ?map|процесс|process|по шагам|step/i,
	"explainer-video": /объясн|explain|как работает|how it works|урок|lesson|tutorial/i,
	"whiteboard-animation": /доск|whiteboard|рисованн|hand.?drawn|скетч|sketch|дудл|doodle/i,
	"isometric-animation": /изометр|isometric|3d|объём|объем/i,
	"generative-illustration": /мульт|cartoon|иллюстрац|illustrat|детск|kids|рисун|drawing|персонаж|character|пиксел|pixel/i,
	"javascript-animation": /пиксел|pixel|частиц|particle|генератив|generative|canvas/i,
	"motion-background": /фон|background|градиент|gradient|абстракт|abstract|частиц|particle/i,
	"lower-thirds": /плашк|lower third|нижн|имя|name tag|титр/i,
	"countdown-video": /отсчёт|отсчет|countdown|таймер|timer/i,
	"promo-video": /промо|promo|акци|sale|скидк|discount|распродаж|offer/i,
	"product-demo-video": /товар|product|продукт|демо|demo|приложен|app\b|интерфейс|ui\b/i,
	"ad-creative-video": /реклам|\bad\b|креатив|creative|баннер/i,
	"youtube-intro-outro": /интро|intro|аутро|outro|заставк|концовк|youtube/i,
	"color-motion": /цвет|colou?r|палитр|palette|неон|neon/i,
	"shot-composition": /композиц кадр|framing|кадрирован|shot/i,
	"remotion-light-leaks": /свет|light leak|блик|flare|засвет/i,
	"remotion-3d": /3d|трёхмер|трехмер|объёмн/i,
	"remotion-lottie": /lottie|лотти|стикер|sticker|анимац.*икон/i,
};

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}\n…` : t);

/**
 * The skills for this request: the craft basics and the style guide always; the open-source skills its words call
 * for (as their authors wrote them, at most 3); and this sandbox's own notes for the topics (cartoon, pixel, map…).
 */
export function skillsFor(request: string): string {
	const q = request.toLowerCase();
	const own = SKILLS.filter((s) => s.id === "styles" || s.when.test(q)).slice(0, 4);
	const github = GITHUB_SKILLS.filter((g) => GITHUB_WHEN[g.id]?.test(q)).slice(0, 3);
	const intro = github.length
		? "## Skills from open-source motion designers (as written by them)\nThey often show web code (CSS animations, GSAP, canvas). Use their technique and craft, written in this sandbox: useCurrentFrame + interpolate/spring, SVG, the allowed imports only."
		: "";
	return [PRINCIPLES, ...own.map((s) => s.text), intro, ...github.map((g) => `### ${g.id} (${g.source})\n${clip(g.text, 9000)}`)].filter(Boolean).join("\n\n");
}
