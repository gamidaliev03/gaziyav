/** The Trim tool in the timeline's tool menu: two edges facing each other, an arrow on each side (a 14 px line icon like the rest of the bar). */
export function TrimToolIcon({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
			<path d="M7.5 5h3v14h-3" />
			<path d="M16.5 5h-3v14h3" />
			<path d="M5.5 12H2m2-2.2L1.8 12 4 14.2" />
			<path d="M18.5 12H22m-2-2.2 2.2 2.2-2.2 2.2" />
		</svg>
	);
}
