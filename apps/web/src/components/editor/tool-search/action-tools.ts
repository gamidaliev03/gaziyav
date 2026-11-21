// action a user can invoke, by its one name (actions/names.ts) in English and Russian, plus the words people type for
// it. Enter runs it through invokeAction, exactly as its key does; the row shows its key and is greyed with the reason
// when its precondition fails (actions/preconditions.ts). Nothing here is hand-listed but the synonyms.
import { ACTIONS, type TActionCategory, isActionWithOptionalArgs } from "@/actions/definitions";
import type { TAction } from "@/actions/types";
import type { Tool } from "./tools";

/** Where a command lives, by its category (English; translated where drawn). */
const WHERE: Record<TActionCategory, string> = {
	playback: "Player",
	player: "Player",
	editing: "Timeline",
	timeline: "Timeline",
	marks: "Timeline",
	keyframes: "Keyframes",
	view: "Editor",
	assets: "Media",
};

/** The words people type for a command (both languages) beyond its name. */
const WORDS: Partial<Record<TAction, string[]>> = {
	"toggle-play": ["play", "pause", "space", "играть", "пуск", "пауза", "воспроизвести", "проиграть"],
	"shuttle-forward": ["shuttle", "jkl", "вперёд", "перемотка"],
	"shuttle-backward": ["shuttle", "jkl", "назад", "перемотка назад"],
	"goto-start": ["home", "beginning", "в начало", "начало"],
	"goto-end": ["end", "в конец", "конец"],
	"goto-timecode": ["timecode", "jump", "таймкод", "перейти", "к времени"],
	"previous-edit": ["cut", "склейка", "предыдущая склейка"],
	"next-edit": ["cut", "склейка", "следующая склейка"],
	"mark-in": ["in", "in point", "вход", "начало отрезка", "метка"],
	"mark-out": ["out", "out point", "выход", "конец отрезка", "метка"],
	"toggle-bookmark": ["marker", "bookmark", "маркер", "метка", "закладка"],
	split: ["cut", "blade", "razor", "разделить", "разрезать", "разрез", "порезать", "нарезать"],
	"split-all": ["cut all", "blade all", "разделить все", "разрезать все дорожки"],
	"split-left": ["trim start", "q", "обрезать начало", "подрезать начало", "удалить слева", "до курсора"],
	"split-right": ["trim end", "w", "обрезать конец", "подрезать конец", "удалить справа", "после курсора"],
	"delete-selected": ["remove", "erase", "удалить", "стереть", "убрать клип"],
	"ripple-delete": ["remove and close gap", "удалить со сдвигом", "удалить без промежутка", "рипл"],
	"cut-selected": ["cut", "вырезать"],
	"copy-selected": ["copy", "копировать", "скопировать"],
	"paste-copied": ["paste", "insert", "вставить", "вставка"],
	"paste-over": ["overwrite", "вставить поверх", "заменить"],
	"duplicate-selected": ["duplicate", "clone", "дублировать", "дубликат", "копия", "размножить"],
	"copy-attributes": ["attributes", "properties", "копировать свойства", "атрибуты", "свойства"],
	"paste-attributes": ["attributes", "properties", "вставить свойства", "атрибуты", "свойства"],
	"nudge-left": ["nudge", "move", "сдвинуть", "подвинуть", "на кадр"],
	"nudge-right": ["nudge", "move", "сдвинуть", "подвинуть", "на кадр"],
	"trim-end-earlier": ["trim", "подрезать", "обрезка", "обрезать"],
	"trim-end-later": ["trim", "подрезать", "обрезка", "обрезать"],
	"trim-start-earlier": ["trim", "подрезать", "обрезка", "обрезать"],
	"trim-start-later": ["trim", "подрезать", "обрезка", "обрезать"],
	"extend-edit": ["extend", "продлить", "дотянуть", "до курсора"],
	"toggle-elements-visibility-selected": ["disable", "enable", "hide", "deactivate", "выключить клип", "скрыть", "деактивировать"],
	"toggle-elements-muted-selected": ["mute", "unmute", "без звука", "заглушить", "выключить звук"],
	"toggle-source-audio": ["detach audio", "extract audio", "извлечь звук", "отделить звук", "вернуть звук"],
	"select-all": ["select all", "выделить всё", "выделить все"],
	"deselect-all": ["deselect", "снять выделение", "сбросить выделение"],
	"toggle-snapping": ["snap", "snapping", "привязка", "прилипание", "магнит"],
	"toggle-ripple-editing": ["magnet", "ripple", "магнит", "рипл", "магнитная дорожка"],
	"toggle-linkage": ["link", "linkage", "связь", "связать", "привязка клипов"],
	"tool-split": ["blade", "razor", "лезвие", "нож", "разрезать"],
	"tool-select": ["arrow", "pointer", "выделение", "стрелка", "курсор"],
	"group-selected": ["group", "группа", "сгруппировать"],
	"ungroup-selected": ["ungroup", "разгруппировать"],
	"create-compound": ["compound", "nest", "составной", "вложить", "подпроект"],
	"freeze-frame": ["freeze", "still", "hold", "стоп-кадр", "заморозить", "заморозка", "стоп кадр"],
	"reverse-selected": ["reverse", "backwards", "задом наперёд", "реверс", "обратно"],
	"mirror-selected": ["flip", "mirror", "зеркало", "отразить", "отзеркалить"],
	"rotate-selected": ["rotate", "turn", "повернуть", "поворот"],
	"record-voiceover": ["record", "voiceover", "microphone", "запись", "озвучка", "микрофон", "записать голос"],
	"timeline-zoom-fit": ["fit", "zoom", "по размеру окна", "вписать", "масштаб"],
	"timeline-zoom-in": ["zoom", "приблизить", "увеличить масштаб"],
	"timeline-zoom-out": ["zoom", "отдалить", "уменьшить масштаб"],
	undo: ["undo", "back", "отменить", "отмена", "назад"],
	redo: ["redo", "повторить", "вернуть"],
	"export-project": ["export", "render", "save video", "экспорт", "экспортировать", "сохранить видео", "рендер"],
	"lift-in-out": ["lift", "поднять", "убрать отрезок"],
	"extract-in-out": ["extract", "извлечь", "вырезать отрезок"],
	"add-title": ["title", "text", "титр", "текст", "надпись"],
	"match-frame": ["match frame", "reveal", "найти кадр", "показать в медиа"],
	"speed-duration": ["speed", "duration", "скорость", "длительность", "замедлить", "ускорить"],
	"add-video-track": ["track", "дорожка", "новая дорожка"],
	"add-audio-track": ["track", "дорожка", "новая аудиодорожка"],
	"toggle-keyframe": ["keyframe", "key", "ключ", "ключевой кадр", "кейфрейм"],
	"volume-up": ["louder", "громче", "громкость"],
	"volume-down": ["quieter", "тише", "громкость"],
	"player-fullscreen": ["fullscreen", "во весь экран", "полный экран"],
	"project-settings": ["settings", "format", "fps", "resolution", "настройки проекта", "формат", "разрешение"],
	"new-project": ["new", "новый проект", "создать проект"],
	"save-project": ["save", "сохранить"],
	"import-media": ["import", "open file", "импорт", "импортировать", "открыть файл", "добавить файл"],
	"import-link": ["youtube", "link", "url", "ссылка", "ютуб"],
	"show-projects": ["projects", "home", "проекты", "все проекты", "домой"],
	"close-project": ["close", "закрыть", "закрыть проект"],
	"show-shortcuts": ["shortcuts", "keys", "hotkeys", "сочетания", "сочетания клавиш", "горячие клавиши", "клавиши"],
	"show-captions": ["captions", "subtitles", "субтитры", "титры"],
	"toggle-loop": ["loop", "repeat", "playback", "цикл", "повтор", "зациклить", "по кругу", "воспроизведение"],
	// the trim model (src/timeline/trim)
	"tool-trim": ["trim", "roll", "ripple", "slip", "slide", "trim tool", "подрезка", "тримминг", "трим", "ролл", "рипл", "слип", "слайд", "совмещение", "сдвиг", "прокрутка", "скольжение", "склейка"],
	"trim-select-roll": ["roll", "cut", "edit point", "both edges", "ролл", "совмещение", "склейка", "оба края", "точка монтажа"],
	"trim-select-out": ["ripple", "out point", "left edge", "tail", "рипл", "сдвиг", "конец клипа", "левый край склейки"],
	"trim-select-in": ["ripple", "in point", "right edge", "head", "рипл", "сдвиг", "начало клипа", "правый край склейки"],
	"trim-type-plus": ["number", "frames", "timecode", "numeric", "type", "число", "кадры", "таймкод", "ввести число", "на сколько кадров"],
	"trim-play-around": ["loop", "play around", "dynamic trim", "trim loop", "live trim", "jkl", "петля", "цикл", "подрезка на ходу", "склейка по кругу", "динамическая подрезка"],
	"slip-type-plus": ["slip", "number", "frames", "слип", "прокрутка", "число", "кадры"],
};

/** Every invokable, listed action as a ⌘K command (those `skip` already lists by hand are left out). */
export function actionTools(skip: ReadonlySet<string>): Tool[] {
	return (Object.keys(ACTIONS) as TAction[])
		.filter((action) => !skip.has(action) && isActionWithOptionalArgs(action) && !(ACTIONS[action] as { hidden?: boolean }).hidden)
		.map((action) => {
			const definition = ACTIONS[action];
			return {
				id: `action:${action}`,
				title: definition.description,
				where: WHERE[definition.category],
				words: WORDS[action] ?? [],
				target: { kind: "action", action },
			};
		});
}
