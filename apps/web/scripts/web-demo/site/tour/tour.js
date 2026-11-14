// ← / →, swipe (native scroll-snap), a progress line, #<n> deep links, the language remembered. No outside requests.
(() => {
	const deck = document.getElementById("deck");
	const slides = [...deck.querySelectorAll(".slide")];
	const count = document.getElementById("count");
	const bar = document.getElementById("bar");
	const prev = document.getElementById("prev");
	const next = document.getElementById("next");
	let at = 0;
	const show = (i, smooth = true) => {
		at = Math.max(0, Math.min(slides.length - 1, i));
		deck.scrollTo({ left: at * deck.clientWidth, behavior: smooth ? "smooth" : "instant" });
		mark();
	};
	const mark = () => {
		count.textContent = `${at + 1} / ${slides.length}`;
		bar.style.width = `${((at + 1) / slides.length) * 100}%`;
		prev.disabled = at === 0;
		next.disabled = at === slides.length - 1;
		const id = `#${at + 1}`;
		if (location.hash !== id) history.replaceState(null, "", id);
	};
	const fromHash = () => { const n = parseInt(location.hash.replace(/^#s?/, ""), 10); return Number.isFinite(n) ? n - 1 : 0; };
	let t;
	deck.addEventListener("scroll", () => { clearTimeout(t); t = setTimeout(() => { at = Math.round(deck.scrollLeft / deck.clientWidth); mark(); }, 80); }, { passive: true });
	prev.addEventListener("click", () => show(at - 1));
	next.addEventListener("click", () => show(at + 1));
	addEventListener("keydown", (e) => {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); show(at + 1); }
		else if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); show(at - 1); }
		else if (e.key === "Home") show(0);
		else if (e.key === "End") show(slides.length - 1);
	});
	addEventListener("hashchange", () => show(fromHash()));
	addEventListener("resize", () => show(at, false));
	document.querySelectorAll("[data-lang]").forEach((a) => a.addEventListener("click", (e) => {
		try { localStorage.setItem("gaziyav.tour.lang", a.dataset.lang); } catch {}
		e.preventDefault();
		location.href = `${a.getAttribute("href")}#${at + 1}`;
	}));
	try { localStorage.setItem("gaziyav.tour.lang", document.documentElement.lang); } catch {}
	show(fromHash(), false);
})();
