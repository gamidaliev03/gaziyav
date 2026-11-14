// The editor's local server (127.0.0.1:47831) answers only Gaziyav itself. Any page of any site — in Gaziyav's own
// browser or Telegram, or in Safari/Chrome on the same Mac — can point fetch, <img>, <form> or <script> at 127.0.0.1;
// the API's own checks (routes' X-Studio for writes) leave reads and some GETs with effects open. Refused here, for
// every /api route:
//  • a Host that isn't loopback (DNS rebinding: evil.example resolving to 127.0.0.1);
//  • an Origin that isn't a loopback page (another site's fetch/POST), or "null" (file:, data:, sandboxed frames);
//  • a request the browser marks as coming from another site (Sec-Fetch-Site: cross-site / same-site) unless that page
//    is local itself (the AI layers' renderer on localhost reads the editor's pictures and fonts).
// Gaziyav's own processes (the main process, the MCP server, tools) send none of these headers and pass.
import { type NextRequest, NextResponse } from "next/server";

const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
/** Late's static «done» page: where its sign-in window lands (the app closes that window; nothing happens here). */
const OPEN_PATHS = new Set(["/api/share/late/done"]);

function loopbackPage(value: string | null): boolean {
	if (!value) return false;
	try {
		const u = new URL(value);
		return (u.protocol === "http:" || u.protocol === "https:") && LOOPBACK_HOST.test(u.host);
	} catch {
		return false;
	}
}

const refuse = () => NextResponse.json({ error: "Request rejected" }, { status: 403 });

export function proxy(req: NextRequest) {
	if (OPEN_PATHS.has(req.nextUrl.pathname)) return NextResponse.next();
	if (!LOOPBACK_HOST.test(req.headers.get("host") ?? "")) return refuse();
	const origin = req.headers.get("origin");
	if (origin !== null && !loopbackPage(origin)) return refuse();
	const site = req.headers.get("sec-fetch-site");
	if (site && site !== "same-origin" && site !== "none" && !loopbackPage(origin ?? req.headers.get("referer"))) return refuse();
	return NextResponse.next();
}

// Next.js holds a copy of the body of every request that passes here and silently cuts it at 10 MB: a clip sent for AI
// arrived broken (06.11). Gaziyav's own window sends X-Studio to a loopback Host and skips this filter: a page of another
// site can't send that header without a preflight, which has no X-Studio and is refused here, and a rebinding page has
// a foreign Host.
export const config = {
	matcher: [
		{ source: "/api/:path*", missing: [{ type: "header", key: "x-studio", value: "1" }] },
		{ source: "/api/:path*", missing: [{ type: "host", value: "(127\\.0\\.0\\.1|localhost)" }] },
	],
};
