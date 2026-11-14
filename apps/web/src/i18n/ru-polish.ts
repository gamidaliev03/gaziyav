// Russian text of this area, keyed by the English source text like ru.ts.
export const RU_POLISH: Record<string, string> = {
	// media/processing.ts — import failures and notices (an English toast in a Russian window, rc31)
	"Couldn't import {name}": "Не удалось импортировать {name}",
	"This format isn't supported. Use MP4, MOV, MP3, WAV, M4A, PNG, JPG or HEIC and try again.":
		"Этот формат не поддерживается. Используйте MP4, MOV, MP3, WAV, M4A, PNG, JPG или HEIC и попробуйте снова.",
	"The file couldn't be read. It may be damaged or not fully downloaded: try another copy of it.":
		"Файл не читается. Возможно, он повреждён или скачан не до конца: попробуйте другую его копию.",
	"Converting {name}": "Конвертируем {name}",
	"{name} is ready to edit": "{name} готов к монтажу",
	"Not enough disk space for {name}": "Не хватает места на диске для {name}",
	"The file is {size}. Free up disk space and try again.": "Файл весит {size}. Освободите место на диске и попробуйте снова.",
	"The file is {size}, but only {free} is free for the app. Free up disk space and try again.":
		"Файл весит {size}, а приложению доступно только {free}. Освободите место на диске и попробуйте снова.",
	"{name} is incomplete": "{name} записан не полностью",
	"Only the first {cut} of {full} are in the file: the download or copy was cut off. That part was imported.":
		"В файле только первые {cut} из {full}: скачивание или копирование оборвалось. Эта часть импортирована.",
	"The sound stops after {at} of {full}: the download or copy was cut off.":
		"Звук обрывается на {at} из {full}: скачивание или копирование оборвалось.",
	"This codec": "Этот кодек",
	"This Mac decodes {codec} without the graphics chip, so scrubbing it lagged.":
		"Этот Mac декодирует {codec} без графического чипа, поэтому перемотка тормозила.",
	"4K {codec} seeks slowly, so scrubbing it lagged.": "4K {codec} медленно перематывается, поэтому перемотка тормозила.",
	"{name}: smooth copy for editing": "{name}: плавная копия для монтажа",
	"The editor shows an H.264 copy with a key frame every half second; the export renders from your original.":
		"Редактор показывает копию в H.264 с ключевым кадром каждые полсекунды; экспорт идёт из вашего оригинала.",
	"Can't preview {name}": "Не удаётся показать {name}",
	"{codec} can't be decoded here and the automatic conversion didn't work, so this clip may not preview correctly. Convert it to H.264 MP4 and import it again.":
		"{codec} здесь не декодируется, а автоматическая конвертация не удалась, поэтому клип может показываться неправильно. Сконвертируйте его в H.264 MP4 и импортируйте снова.",
	"This video codec can't be decoded here and the automatic conversion didn't work, so this clip may not preview correctly. Convert it to H.264 MP4 and import it again.":
		"Этот видеокодек здесь не декодируется, а автоматическая конвертация не удалась, поэтому клип может показываться неправильно. Сконвертируйте его в H.264 MP4 и импортируйте снова.",
	// relink/damaged.ts — a stored media file that is there but can't be read
	"{n} clip(s) have a damaged media file: {names}. Relink a good copy (the ⚠ mark on the clip) or remove them, then export again.":
		"Клипов с повреждённым файлом: {n} — {names}. Найдите целую копию (значок ⚠ на клипе) или удалите эти клипы, потом экспортируйте снова.",
	"{n} clip(s) have a damaged file: {names}": "Клипов с повреждённым файлом: {n} — {names}",
	"The project's copy of the file can't be read. The rest plays; Relink: choose the folder with a good copy.":
		"Копия файла в проекте не читается. Остальное играет; «Найти файлы»: выберите папку с целой копией.",
	"The project's copy of this clip's file is damaged: it can't be read": "Копия файла этого клипа в проекте повреждена: она не читается",
	"⚠ Damaged file · {name}": "⚠ Файл повреждён · {name}",
	"The original of {names} is damaged: the video is made from its editing copy.": "Оригинал {names} повреждён: видео собирается из его копии для монтажа.",
	// components/editor/native-bridge.tsx — the menu's Import (File → Import…)
	"Importing {name}": "Импортируем {name}",
	"Importing {n} files": "Импортируем файлы: {n}",
	"Added {name}": "Добавлен {name}",
	"Added {n} files": "Добавлено файлов: {n}",
	"{name} is already in Media": "{name} уже есть в Медиа",
	"{n} files are already in Media": "Уже есть в Медиа: {n}",
	// components/editor/export-button.tsx — a save to a folder that can't be written (main.js says why)
	"That folder can't be written — save the video to another folder.": "В эту папку нельзя записать — сохраните видео в другую папку.",
};

/** Strings with a provider's own words in them (polish, 11.11): the provider's text stays as it said it, in a Russian frame. */
export const RU_POLISH_PATTERNS: Array<[RegExp, string | ((match: string, ...groups: string[]) => string)]> = [
	// fal/server.ts: a job fal.ai failed, with fal's own message («fal.ai: Stand-in failure…»)
	[/^fal\.ai: (?![^\n]*[А-Яа-яЁё])([\s\S]+)$/, "fal.ai ответил: «$1»"],
	[/^kie\.ai: (?![^\n]*[А-Яа-яЁё])([\s\S]+)$/, "kie.ai ответил: «$1»"],
];
