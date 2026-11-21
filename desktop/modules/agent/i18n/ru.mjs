/**
 * The app's own words in Russian (Gaziyav): the menu bar, the dialogs of "Check for Updates…", the window of an update
 * installed at launch, the turns' notifications. One file, joined to upstream's tables (menu.mjs, update-dialogs.mjs,
 * install-window.mjs, turn-notices.mjs) by a line at the end of each, so their tables stay as upstream writes them.
 * The menu's names are macOS's own in Russian (Правка, Вид, Окно, «Скрыть остальные»…).
 */
export const RU_MENU = {
  about: 'О программе {name}', checkForUpdates: 'Проверить обновления…', betaUpdates: 'Бета-обновления', settings: 'Настройки…', services: 'Службы',
  hide: 'Скрыть {name}', hideOthers: 'Скрыть остальные', showAll: 'Показать все', quit: 'Завершить {name}',
  file: 'Файл', newTab: 'Новая вкладка', openProject: 'Открыть проект…', closeTab: 'Закрыть вкладку', reopenClosedTab: 'Открыть закрытую вкладку',
  edit: 'Правка', undo: 'Отменить', redo: 'Повторить', cut: 'Вырезать', copy: 'Скопировать', paste: 'Вставить', pasteAndMatchStyle: 'Вставить с тем же стилем',
  delete: 'Удалить', selectAll: 'Выбрать все', substitutions: 'Замены', showSubstitutions: 'Показать замены',
  smartQuotes: 'Смарт-кавычки', smartDashes: 'Смарт-тире', textReplacement: 'Замена текста', speech: 'Речь',
  startSpeaking: 'Начать проговаривание', stopSpeaking: 'Остановить проговаривание',
  view: 'Вид', showChat: 'Показать чат', actualSize: 'Реальный размер', zoomIn: 'Увеличить', zoomOut: 'Уменьшить',
  toggleFullScreen: 'Полноэкранный режим', reload: 'Перезагрузить', developerTools: 'Инструменты разработчика',
  window: 'Окно', minimize: 'Убрать в Dock', zoom: 'Изменить масштаб', showNextTab: 'Следующая вкладка', showPreviousTab: 'Предыдущая вкладка',
  bringAllToFront: 'Все окна — на передний план', help: 'Справка',
};

export const RU_UPDATE_DIALOG = {
  title: 'Проверка обновлений', ok: 'ОК', restart: 'Перезапустить', later: 'Позже',
  upToDate: 'У вас последняя версия {name}', version: 'Версия {version}', betaVersion: 'Версия {version} (бета)',
  ready: '{name} {version} готов к установке', readyDetail: 'Перезапустите сейчас, чтобы обновиться, или обновление установится при выходе, и в следующий раз откроется новая версия.',
  notRestarting: 'Пока нельзя перезапустить',
  downloading: 'Загружается {name} {version}', downloadingDetail: 'Обновление загружается в фоне — продолжайте работать. Когда оно будет готово, слева вверху появится кнопка «Перезапустить».',
  failed: 'Не удалось проверить обновления', failedDetail: '{error} {name} попробует ещё раз сам.',
  errors: {
    offline: 'Нет связи с сервисом обновлений. Проверьте подключение к интернету и попробуйте ещё раз.',
    unavailable: 'Обновления сейчас недоступны. Попробуйте позже.',
    failed: 'Не удалось завершить обновление. Попробуйте позже.',
    'agent-busy': 'Агент ещё работает. Перезапустите, когда он закончит.',
    exporting: 'Идёт экспорт. Перезапустите, когда он закончится.',
    'install-failed': 'Не удалось установить обновление. Закройте {name} и откройте снова, чтобы установить его.',
  },
};

export const RU_INSTALL = { title: 'Устанавливается {name} {version}…', detail: '{name} откроется снова, когда установка закончится.' };

export const RU_TURN_NOTICE = { agent: 'Агент', done: '{agent} закончил.', failed: '{agent} остановился: {error}', asking: '{agent} ждёт вашего ответа.' };
