// The editor's boot screen (Gaziyav in the browser): a real progress of the editor's own files (how many of the page's scripts have arrived), then
// of the sample project being put on the timeline (the page calls window.__demoBoot). No other host, no tracking.
(function () {
	var lang = "en";
	try {
		var s = localStorage.getItem("gaziyav.language");
		if (s === "ru" || s === "en") lang = s;
		else {
			var l = navigator.languages || [navigator.language || "en"];
			for (var i = 0; i < l.length; i++) {
				var b = String(l[i]).toLowerCase().split("-")[0];
				if (b === "ru" || b === "en") { lang = b; break; }
			}
		}
	} catch (e) {}
	document.documentElement.lang = lang;
	var T = lang === "ru"
		? { files: "Загружаем редактор…", sample: "Кладём пример на таймлайн…", privacy: "Всё происходит в вашем браузере — файлы никуда не отправляются (кроме липсинка своим ключом, если вы его запустите)." }
		: { files: "Loading the editor…", sample: "Putting the sample on the timeline…", privacy: "Everything runs in your browser — your files never leave it (except lipsync with your own key, if you run it)." };
	var phase = "files", share = 0, timer = 0;
	function set(p, text) {
		var bar = document.getElementById("demo-boot-bar");
		var t = document.getElementById("demo-boot-text");
		var pr = document.getElementById("demo-boot-privacy");
		if (bar) bar.style.width = Math.max(3, Math.min(100, Math.round(p * 100))) + "%";
		if (t && text) t.setAttribute("data-text", text);
		if (pr && !pr.getAttribute("data-text")) pr.setAttribute("data-text", T.privacy);
	}
	function files() {
		var all = document.querySelectorAll('script[src*="_next/"]').length || 1;
		var got = 0;
		try {
			var e = performance.getEntriesByType("resource");
			for (var i = 0; i < e.length; i++) if (e[i].name.indexOf("/_next/static/") >= 0 && /\.js(\?|$)/.test(e[i].name)) got++;
		} catch (x) {}
		return Math.min(1, got / all);
	}
	function tick() {
		if (phase === "files") set(0.05 + 0.65 * files(), T.files);
	}
	timer = setInterval(tick, 120);
	window.__demoBoot = function (what, p) {
		if (what === "sample") { phase = "sample"; share = p || 0; set(0.7 + 0.3 * share, T.sample); }
		if (what === "ready" || what === "message") { clearInterval(timer); phase = what; }
	};
	document.addEventListener("DOMContentLoaded", tick);
	// the site's own files, kept for offline use (../sw.js); nothing else
	if ("serviceWorker" in navigator && location.protocol !== "file:")
		window.addEventListener("load", function () { navigator.serviceWorker.register("../sw.js", { scope: "../" }).catch(function () {}); });
})();
