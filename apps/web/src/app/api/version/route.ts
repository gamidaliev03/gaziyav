import { appVersion } from "@/mcp/server/claude";

/** The installed app's version (Info.plist), for Settings → About. */
export async function GET() {
	return Response.json({ version: appVersion() });
}
