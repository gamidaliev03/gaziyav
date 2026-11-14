// Russian text of the AI features (trending voices and looks, dub modes, CleanUp), keyed by the English source text
// like ru.ts — kept apart so the AI lane and the interface lane don't edit the same lines.
export const RU_AI: Record<string, string> = {
	// Separate voice and music (Inspector → Audio)
	"Best": "Лучшее",
	"Quick": "Быстро",
	"The separation model on this Mac (520 MB once)": "Модель разделения на этом Mac (520 МБ один раз)",
	"What macOS has built in: faster, rougher": "Встроенное в macOS: быстрее, грубее",
	// Trending
	"Apply look": "Применить стиль",
	// Video translator (AI → Video translator) and the dub pipeline
	"Voice only": "Только голос",
	"Replace the original speech (off: it plays quieter under the new voice)": "Заменить оригинальную речь (выключено — она звучит тише под новым голосом)",
	// CleanUp
	"Remove a person, a logo or a caption; the background is filled in. Free, on this Mac.":
		"Уберите человека, логотип или надпись — фон дорисуется. Бесплатно, на этом Mac.",
	"Remove an object…": "Убрать объект…",
	"Click the object to remove (⌥-click: keep this part) or paint over it. In a clip it is followed in every frame.":
		"Щёлкните объект (⌥-щелчок — оставить эту часть) или закрасьте его кистью. В клипе он отслеживается в каждом кадре.",
	"Click the object": "Щелчок по объекту",
	Brush: "Кисть",
	Clear: "Очистить",
	"Getting the frame…": "Берём кадр…",
	"Show the outline": "Показать контур",
	Remove: "Убрать",
	"Object removed": "Объект убран",
	"⌘Z brings the original back": "⌘Z вернёт оригинал",
	// My voices (voice generator)
	"My voices": "Мои голоса",
	"Your voice": "Свой голос",
	"From 10–30 s of speech": "По 10–30 с речи",
	Cloned: "Клон",
	"Remove this voice": "Удалить голос",
	"Name of the voice": "Название голоса",
	"This is my voice, or the person agreed to have it cloned": "Это мой голос, или человек согласился на клонирование",
	"Clone the voice": "Клонировать голос",
	Cancel: "Отмена",
	"Sending the recording": "Отправляем запись",
	"The voice wasn't made.": "Голос не получился.",
	"Taking the voice sample": "Берём образец голоса",
	"Hearing what it says": "Слушаю, что сказано",
	// The Mac's temperature and memory (ondevice/thermal.ts, Settings → AI)
	"The Mac got hot — paused until it cools down · {time}": "Mac нагрелся — пауза, пока остынет · {time}",
	"Cooled down — continuing": "Остыл — продолжаем",
	"The Mac got hot — the export goes on (hardware codec), just slower": "Mac нагрелся — экспорт продолжается (аппаратный кодек), но медленнее",
	"Needs {n} GB of memory": "Нужно {n} ГБ памяти",
	"Not for this Mac": "Не для этого Mac",
	"Needs a Mac with 16 GB of memory.": "Нужен Mac с 16 ГБ памяти.",
};
