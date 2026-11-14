// Only the app's own window may call the export API (same guard as the studio API).
export function rejectForeign(req: Request, { header = true }: { header?: boolean } = {}): Response | null {
	const host = (req.headers.get("host") ?? "").toLowerCase();
	const deny = () => Response.json({ error: "Request rejected" }, { status: 403 });
	if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return deny();
	const origin = req.headers.get("origin");
	if (origin && origin !== `http://${host}`) return deny();
	if (header && req.headers.get("x-studio") !== "1") return deny();
	return null;
}
