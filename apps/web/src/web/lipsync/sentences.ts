// Every failure of the browser lipsync as ONE sentence, Russian and English. The job carries the key too (errorKey),
// so the page may say it in its own words; nothing technical in the sentence, the raw words under «Подробнее».

export type Lang = "ru" | "en";

export const SENTENCES = {
	"web.no_key": { ru: "Добавьте свой ключ fal.ai — он хранится только в этом браузере.", en: "Add your fal.ai key — it is kept only in this browser." },
	"web.key_refused": { ru: "fal.ai не принял ключ: проверьте его и нажмите «Повторить».", en: "fal.ai didn't accept the key: check it and press Retry." },
	"web.balance": { ru: "На счёте fal.ai нет денег: пополните его и нажмите «Повторить» — ничего не списано.", en: "The fal.ai balance is empty: top it up and press Retry — nothing was charged." },
	"web.refused": { ru: "Фильтр fal.ai отклонил этот запрос: возьмите другой кусок или другую модель.", en: "fal.ai's safety filter refused this request: take another piece or another model." },
	"web.invalid": { ru: "fal.ai не принял эти настройки: выберите другую модель и нажмите «Повторить».", en: "fal.ai didn't accept these settings: pick another model and press Retry." },
	"web.network": { ru: "Нет связи с fal.ai: проверьте интернет и нажмите «Повторить» — оплаченное не пропадёт.", en: "fal.ai can't be reached: check the connection and press Retry — nothing paid is lost." },
	"web.failed": { ru: "fal.ai не справился с задачей: нажмите «Повторить».", en: "fal.ai failed this job: press Retry." },
	"web.no_file": { ru: "fal.ai закончил, но файл не скачался: нажмите «Повторить» — второй раз платить не нужно.", en: "fal.ai finished but the file didn't download: press Retry — you won't pay twice." },
	"web.cancelled": { ru: "Остановлено: страница больше не ждёт, задача на fal.ai отменена.", en: "Stopped: the page no longer waits and the job on fal.ai was cancelled." },
	"web.closed_before_send": { ru: "Вкладку закрыли до отправки — ничего не оплачено: нажмите «Повторить».", en: "The tab closed before anything was sent — nothing was paid: press Retry." },
	"web.over_limit": { ru: "Дороже согласованной суммы — ничего не отправлено: подтвердите новую цену.", en: "This costs more than agreed — nothing was sent: confirm the new price." },
	"web.prepare": { ru: "Этот браузер не смог подготовить клип: откройте страницу в свежем Chrome или в приложении.", en: "This browser couldn't prepare the clip: open the page in a recent Chrome or in the app." },
	"web.no_video": { ru: "В выбранном клипе нет видео — выберите клип с лицом.", en: "The chosen clip has no video — pick a clip with a face." },
	"web.no_sound": { ru: "В клипе нет звука, чтобы взять голос: выберите готовый голос или клип со звуком.", en: "The clip has no sound to take the voice from: pick a ready voice or a clip with sound." },
	"web.too_short": { ru: "Слишком короткий звук для голоса: нужно хотя бы 3 секунды речи.", en: "The sound is too short for a voice: at least 3 seconds of speech are needed." },
	"web.model_app_only": { ru: "Эта модель работает только в приложении: выберите модель fal.ai.", en: "This model works only in the app: pick a fal.ai model." },
	"web.too_long": { ru: "Кусок длиннее, чем берёт модель: выберите кусок короче или другую модель.", en: "The piece is longer than the model takes: pick a shorter piece or another model." },
	"web.unknown_job": { ru: "Эта задача больше не известна странице.", en: "This job is no longer known to the page." },
	"web.no_text": { ru: "Напишите, что должен сказать голос.", en: "Type what the voice should say." },
	// voices (web/voice), face swap (web/faceswap), the AI editor and the script writer (web/agent)
	"web.voice_gone": { ru: "Этого голоса больше нет в этом браузере — клонируйте его заново в «Мои голоса».", en: "This voice is no longer in this browser — clone it again in My voices." },
	"web.trend_app_only": { ru: "Трендовые голоса обрабатываются в приложении: выберите готовый голос или свой.", en: "Trending voice looks are treated in the app: pick a ready voice or one of yours." },
	"web.no_speech": { ru: "В записи не слышно речи — возьмите 10–30 с, где говорит один человек.", en: "No speech found in this recording — use 10–30 s of one person talking." },
	"web.little_speech": { ru: "Здесь слишком мало речи — возьмите 10–30 с, где говорит один человек, чтобы голос был похож.", en: "Too little speech here — use 10–30 s of one person talking, so the voice sounds like them." },
	"web.no_face": { ru: "Сначала выберите лицо.", en: "Pick a face first." },
	"web.face_gone": { ru: "Этого лица больше нет в этом браузере — добавьте его снова.", en: "That face is no longer in this browser. Add it again." },
	"web.no_consent": { ru: "Подтвердите, что у вас есть право использовать лицо этого человека.", en: "Confirm you have the right to use this person's face." },
	"web.look_app_only": { ru: "Образы лица делает модель на устройстве — её нет ни здесь, ни в приложении: выберите лицо для замены.", en: "Face looks need the on-device face model, which this edition doesn't carry. Pick a face to swap instead." },
	"web.photo_bad": { ru: "Это фото не читается: выберите JPEG или PNG.", en: "That photo can't be read: pick a JPEG or PNG." },
	"web.photo_big": { ru: "Фото слишком большое (не больше 40 МБ).", en: "The photo is too big (40 MB at most)." },
	"web.llm_empty": { ru: "ИИ Gaziyav вернул пустой ответ. Попробуйте ещё раз.", en: "Gaziyav AI returned an empty answer. Try again." },
	"web.llm_length": { ru: "ИИ Gaziyav не уложился в длину ответа. Попробуйте ещё раз — обычно со второго раза получается.", en: "Gaziyav AI ran out of answer length. Try again: it usually works the second time." },
	"web.llm_text": { ru: "ИИ Gaziyav не прислал годного текста. Нажмите «Повторить».", en: "Gaziyav AI sent no usable text. Press Retry." },
	"web.empty_chat": { ru: "Пустой разговор.", en: "Empty conversation" },
	"web.busy": { ru: "fal.ai сейчас занят (слишком много запросов): подождите минуту и нажмите «Повторить».", en: "fal.ai is busy right now (too many requests): wait a minute, then press Retry." },
	"web.bad_model": { ru: "Эта модель здесь не предлагается.", en: "This model isn't offered for that." },
} as const satisfies Record<string, Record<Lang, string>>;

export type SentenceKey = keyof typeof SENTENCES;

export const say = (key: SentenceKey, lang: Lang = "ru"): string => SENTENCES[key][lang];

/** The quiet line beside the price: the honest difference from the desktop app. */
export const APP_CHEAPER: Record<Lang, string> = { ru: "в приложении дешевле: платите только за речь", en: "cheaper in the app: you pay only for speech" };

/** A failure the page knows by key, with the provider's raw words kept apart (never shown as the sentence). */
export class WebLipError extends Error {
	constructor(
		readonly key: SentenceKey,
		readonly details = "",
		/** The provider took the job and may bill it: a Retry must follow the same request. */
		readonly paid = false,
	) {
		super(key);
	}
}

/** A provider HTTP answer → the sentence's key. */
export function keyForHttp(status: number, text: string): SentenceKey {
	const bare = status === 422 ? "" : text;
	if (status === 402 || /exhausted[_ ]balance|insufficient (balance|credit|funds)|user is locked|account is locked|top up/i.test(bare)) return "web.balance";
	if (status === 401 || status === 403) return "web.key_refused";
	if (status === 422) return /content_policy_violation|model_moderated|content polic|safety|flagged|nsfw|moderat/i.test(text) ? "web.refused" : "web.invalid";
	return "web.failed";
}

/** Any error → the sentence's key (a cancel and a dropped line are told apart). */
export function keyOf(error: unknown): SentenceKey {
	if (error instanceof WebLipError) return error.key;
	const name = (error as { name?: string })?.name;
	if (name === "AbortError") return "web.cancelled";
	if (error instanceof TypeError) return "web.network";
	return "web.failed";
}
