// Russian text of the film's scenes as data (src/chapters: the connector's scenes tool, scene marks on the timeline,
// YouTube chapters), keyed by the English source text like ru.ts. The Scenes and Text views are gone (one project, one
// timeline, 12.11): what stays is the words the remaining code shows, with the Russian the app showed before — four of
// them (Restore, Listening for pauses, Tighten, Open Media) the Text view's words had given the whole editor.
export const RU_CHAPTERS: Record<string, string> = {
	Restore: "Вернуть",
	"Listening for pauses": "Слушаем паузы",
	Tighten: "Подтянуть",
	"Open Media": "Открыть медиа",
	Continue: "Продолжить",
	"⌘Z puts it back": "⌘Z вернёт",
	"Find scenes": "Найти сцены",
	"Scene {n}": "Сцена {n}",
	"Starts at": "Начало",
	"Delete scene": "Удалить сцену",
	"Reading the cuts": "Читаем склейки",
	"Looking for shot changes": "Ищем смены планов",
	"Choosing the scenes": "Выбираем сцены",
	"The timeline is empty. Add clips first.": "Таймлайн пуст. Сначала добавьте клипы.",
	"No scenes yet. Find scenes first.": "Сцен пока нет. Сначала найдите сцены.",
	"Could not copy. Try again.": "Не удалось скопировать. Попробуйте ещё раз.",
	"Chapters copied.": "Главы скопированы.",
	"Chapters copied. Paste them into the video's description.": "Главы скопированы. Вставьте их в описание видео.",
	"YouTube shows chapters only when there are at least three.": "YouTube показывает главы, только если их не меньше трёх.",
	"YouTube needs every chapter to be at least 10 seconds long.": "YouTube нужно, чтобы каждая глава шла не меньше 10 секунд.",
	"No scene changes found: the film runs as one piece.": "Смен сцены не найдено: фильм идёт одним куском.",
};
