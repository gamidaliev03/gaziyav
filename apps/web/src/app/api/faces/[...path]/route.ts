// «My faces» for Face swap, kept for every project (studio/server/my-faces.ts).
//   GET  /api/faces/list            → { faces: [{ id, name, createdAt }] }
//   GET  /api/faces/file/<id>       → the JPEG
//   POST /api/faces/add?name=…      → photo body → { face }
//   POST /api/faces/remove/<id>     → { faces }
import fs from "node:fs";
import { explain } from "@/studio/server/errors";
import { addFace, faceFile, loadFaces, removeFace } from "@/studio/server/my-faces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

const json = (data: unknown, status = 200) => Response.json(data, { status });
const list = () => loadFaces().map(({ id, name, createdAt }) => ({ id, name, createdAt }));

// Same guard as /api/studio: only the app's own window may call this.
function forbidden(req: Request): Response | null {
	const host = (req.headers.get("host") ?? "").toLowerCase();
	if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json({ error: "Request refused" }, 403);
	const origin = req.headers.get("origin");
	if (origin && origin !== `http://${host}`) return json({ error: "Request refused" }, 403);
	if (req.method !== "GET" && req.headers.get("x-studio") !== "1") return json({ error: "Request refused" }, 403);
	return null;
}

export async function GET(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [head, id] = (await ctx.params).path;
	if (head === "list") return json({ faces: list() });
	if (head === "file" && id) {
		const file = faceFile(id);
		if (!file) return json({ error: "That face is no longer on this Mac." }, 404);
		return new Response(new Uint8Array(fs.readFileSync(file)), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
	}
	return json({ error: "Unknown request" }, 404);
}

export async function POST(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [head, id] = (await ctx.params).path;
	try {
		if (head === "add") {
			const face = await addFace(Buffer.from(await req.arrayBuffer()), new URL(req.url).searchParams.get("name") ?? "", req.signal);
			return json({ face: { id: face.id, name: face.name, createdAt: face.createdAt } });
		}
		if (head === "remove" && id) {
			removeFace(id);
			return json({ faces: list() });
		}
		return json({ error: "Unknown request" }, 404);
	} catch (error) {
		return json({ error: explain(error) }, 400);
	}
}
