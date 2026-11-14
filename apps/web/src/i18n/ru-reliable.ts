// Russian text of this area, keyed by the English source text like ru.ts.
export const RU_RELIABLE: Record<string, string> = {
	// the check of a written export (export/server/verify.ts, components/editor/export/check-written.ts)
	"Checking the file": "Проверяем файл",
	"The exported file is not right: {what}": "С файлом экспорта что-то не так: {what}",
	"the file isn't there": "файла нет на месте",
	"the file is empty (0 bytes)": "файл пустой (0 байт)",
	"the file can't be read as a video or sound file": "файл не читается как видео или звук",
	"it has no picture": "в нём нет изображения",
	"it has no sound, but the timeline has sound": "в нём нет звука, хотя на таймлайне звук есть",
	"it is {diff} s shorter than the timeline ({got} s instead of {want} s)": "он на {diff} с короче таймлайна ({got} с вместо {want} с)",
	"it is {diff} s longer than the timeline ({got} s instead of {want} s)": "он на {diff} с длиннее таймлайна ({got} с вместо {want} с)",
	"its first second doesn't decode": "первая секунда не читается",
	"its last second doesn't decode": "последняя секунда не читается",
	"Reconnecting…": "Переподключаюсь…",
	// Project menu → Collect files into the project (media/originals.ts: the user's files are used where they are)
	"Collect files into the project": "Собрать проект",
	"Copy into the project the files it uses from their places on this Mac: then it needs none of them": "Скопировать в проект файлы, которые он берёт с их мест на этом Mac: тогда они ему больше не нужны",
	"Nothing to collect: every file is in the project already": "Собирать нечего: все файлы уже в проекте",
	"Collecting {n} file(s) into the project…": "Собираем проект: файлов — {n}…",
	"Collected {n} file(s) into the project": "Проект собран: файлов скопировано — {n}",
	"Couldn't collect into the project: {names}": "Не удалось собрать в проект: {names}",
	"the files": "файлы",
	// Project menu → Versions… (project/components/editor-versions-dialog.tsx)
	"Versions…": "Версии…",
	"Versions": "Версии",
	"Open as a copy": "Открыть как копию",
	"Opened as a copy: {name}": "Открыта копия: {name}",
	"This version can't be opened": "Эту версию не открыть",
	"No versions of this project yet.": "У этого проекта пока нет версий.",
	"Kept on disk": "Сохранена на диске",
	"Opened": "При открытии",
	"Saved (⌘S)": "Сохранено (⌘S)",
	// haptics
	"Trackpad feedback": "Отклик трекпада",
	"A light tap under the finger when a clip snaps, a guide aligns or a trim reaches its end":
		"Лёгкий толчок под пальцем, когда клип привязывается, срабатывает направляющая или подрезка доходит до края",
	"Follows the Mac's own setting: System Settings → Trackpad → Force Click and haptic feedback.":
		"Учитывает настройку Mac: Системные настройки → Трекпад → Сильное нажатие и тактильный отклик.",
};
