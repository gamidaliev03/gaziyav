// Emoji accents of caption styles (the Submagic look): a keyword gets its emoji right after it — «деньги💰»,
// «idea💡» — glued to the word, so the word count and the spoken-word timings stay as they were. Russian words are
// matched by their stem (any ending), English ones by their start. At most two accents a caption, never twice the same.

const ACCENTS: Array<[RegExp, string]> = [
	[/^(деньг|денег|money|cash|доход|заработ|earn|рубл|доллар|dollar)/, "💰"],
	[/^(огон|огн|fire|hot|жар|горяч)/, "🔥"],
	[/^(любл|любов|love|сердц|heart|обожа)/, "❤️"],
	[/^(иде|idea|придума|мысл)/, "💡"],
	[/^(врем|time|минут|minute|hour|быстр|fast|quick|скор)/, "⏱️"],
	[/^(побед|win|чемпион|champion|лучш|best|топ|top)/, "🏆"],
	[/^(игр|game|gaming|геймер|gamer|уровен|level)/, "🎮"],
	[/^(музык|music|песн|song|трек|track|бит|beat)/, "🎵"],
	[/^(работ|work|бизнес|business|офис|office|карьер|career|проект|project)/, "💼"],
	[/^(старт|start|запуск|launch|рост|grow|вверх)/, "🚀"],
	[/^(нов|new|свеж|fresh)/, "✨"],
	[/^(секрет|secret|тайн|никто|nobody)/, "🤫"],
	[/^(смотр|watch|look|гляд|see)/, "👀"],
	[/^(крут|cool|класс|awesome|amazing|вау|wow)/, "😎"],
	[/^(скидк|sale|акци|дешев|cheap|выгод|deal)/, "🏷️"],
	[/^(подар|gift|бесплат|free)/, "🎁"],
	[/^(счаст|happy|радост|joy|улыб|smile)/, "😄"],
	[/^(груст|sad|плак|cry|боль|pain)/, "😢"],
	[/^(дума|думай|think|почему|why|вопрос|question)/, "🤔"],
	[/^(телефон|phone|смартфон|приложен|app)/, "📱"],
	[/^(дом|home|house|квартир|apartment)/, "🏠"],
	[/^(путешеств|travel|поездк|trip|отпуск|vacation|море|sea|beach|пляж)/, "✈️"],
	[/^(спорт|sport|трениров|workout|зал|gym|фитнес|fitness)/, "💪"],
	[/^(еда|еду|еды|food|вкусн|tasty|рецепт|recipe|cook)/, "🍽️"],
	[/^(кофе|coffee)/, "☕"],
	[/^(красот|beauty|макияж|makeup|кож|skin)/, "💄"],
	[/^(ошибк|mistake|wrong|неправильн|нельзя|never)/, "❌"],
	[/^(правильн|right|correct|верн|точно|exactly)/, "✅"],
	[/^(внимани|attention|важн|important|стоп|stop)/, "⚠️"],
	[/^(мозг|brain|умн|smart|учи|learn|знан|knowledge)/, "🧠"],
	[/^(цель|goal|мечт|dream)/, "🎯"],
	[/^(сил|power|энерги|energy)/, "⚡"],
];

/** The caption with its accents (unchanged when no word matches). */
export function addEmojiAccents(content: string): string {
	const used = new Set<string>();
	let added = 0;
	return content.replace(/[\p{L}\p{N}']+/gu, (word) => {
		if (added >= 2) return word;
		const key = word.toLowerCase();
		if (key.length < 3) return word;
		for (const [pattern, emoji] of ACCENTS) {
			if (!pattern.test(key) || used.has(emoji)) continue;
			used.add(emoji);
			added++;
			return `${word}${emoji}`;
		}
		return word;
	});
}
