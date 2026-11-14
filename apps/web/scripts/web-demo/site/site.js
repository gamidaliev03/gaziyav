// The landing page's only script: the language (the visitor's choice, remembered; else the browser's languages at the
// first visit) and one line about this browser. Nothing is sent anywhere.
(function () {
	var KEY = "gaziyav.language";
	var page = document.documentElement.lang === "ru" ? "ru" : "en";
	var stored = null;
	try { stored = localStorage.getItem(KEY); } catch (e) {}
	var root = document.querySelector('link[rel="icon"]').getAttribute("href").replace(/icons\/icon-32\.png$/, "");
	if (stored !== "ru" && stored !== "en") {
		var want = "en";
		var l = navigator.languages || [navigator.language || "en"];
		for (var i = 0; i < l.length; i++) { var b = String(l[i]).toLowerCase().split("-")[0]; if (b === "ru" || b === "en") { want = b; break; } }
		try { localStorage.setItem(KEY, want); } catch (e) {}
		if (want !== page) { location.replace(root + (want === "ru" ? "ru/" : "")); return; }
	}
	var sw = document.querySelector("[data-lang]");
	if (sw) sw.addEventListener("click", function () { try { localStorage.setItem(KEY, sw.getAttribute("data-lang")); } catch (e) {} });
	var ok = typeof window.VideoEncoder === "function" && typeof window.AudioEncoder === "function";
	var store = !!(navigator.storage && navigator.storage.getDirectory) && typeof window.FileSystemFileHandle === "function" && "createWritable" in window.FileSystemFileHandle.prototype;
	var note = document.querySelector("[data-browser-note]");
	if (note && (!ok || !store)) {
		note.textContent = page === "ru"
			? (!store ? "Этот браузер пока не умеет хранить видео для редактора — откройте страницу в Chrome или Edge." : "В этом браузере работают монтаж и просмотр; для экспорта нужен Chrome или Edge.")
			: (!store ? "This browser can't keep video files for the editor yet — open this page in Chrome or Edge." : "Editing and playback work in this browser; export needs Chrome or Edge.");
		note.hidden = false;
	}
})();
