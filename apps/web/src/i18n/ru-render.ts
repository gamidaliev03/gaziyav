// Russian text of this area, keyed by the English source text like ru.ts.
export const RU_RENDER: Record<string, string> = {
	// a full disk, in the export's words (export/space.ts)
	"Not enough space on the disk: this export needs about {need}, {free} is free — {short} more is needed. Free some space, choose another folder or a lower quality, then try again.":
		"На диске не хватает места: экспорту нужно около {need}, свободно {free} — не хватает {short}. Освободите место, выберите другую папку или качество пониже и попробуйте снова.",
	"The disk is full: {short} more is needed. Free some space — the export goes on by itself.": "Диск заполнен: не хватает {short}. Освободите место — экспорт продолжится сам.",
	"The disk is full. Free some space — the export goes on by itself.": "Диск заполнен. Освободите место — экспорт продолжится сам.",
	"The video wasn't saved: the disk is full.": "Видео не сохранено: диск заполнен.",
	// an export cut short, said at the next start (export/interrupted.tsx)
	"The export of «{name}» was interrupted": "Экспорт «{name}» был прерван",
	"Your project is safe, and nothing was left under the file's name. What was already rendered is kept.": "Проект цел, под именем файла ничего не осталось. То, что уже отрендерено, сохранено.",
	"Continue from where it stopped": "Продолжить с места остановки",
	"Your project is safe, and nothing was left under the file's name.": "Проект цел, под именем файла ничего не осталось.",
	"Open «{name}» and export it again.": "Откройте «{name}» и экспортируйте снова.",
	"Not now": "Не сейчас",
	// Settings → Draft → Export cache (export/build)
	"Export cache": "Кэш экспорта",
	"Parts of films you exported, kept on this Mac: an interrupted export goes on from where it stopped, and after a small change only what changed is rendered again. When it is full, the parts used longest ago make room. Clearing it loses nothing: the next export renders everything once.":
		"Части уже экспортированных фильмов хранятся на этом Mac: прерванный экспорт продолжается с места остановки, а после небольшой правки заново рендерится только изменённое. Когда кэш заполнен, место освобождают давно не использованные части. Очистка ничего не теряет: следующий экспорт один раз отрендерит всё.",
	"Export cache cleared": "Кэш экспорта очищен",
	// the time left of an export, as measured (the Export window and the Jobs chip)
	"{time} left": "осталось {time}",
	"at least {time} left": "осталось не меньше {time}",
	"{elapsed} · {time} left": "{elapsed} · осталось {time}",
	"{elapsed} · ~{time} left": "{elapsed} · осталось ~{time}",
	"{elapsed} · at least {time} left": "{elapsed} · осталось не меньше {time}",
	// the truth about depth (export/target.ts PICTURE_BITS)
	"This export carries 8-bit content: frames are drawn in 8 bits.": "В этом экспорте 8-битное изображение: кадры рисуются в 8 бит.",
};
