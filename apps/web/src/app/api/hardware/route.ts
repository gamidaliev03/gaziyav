// The machine the app runs on, for the page (platform/hardware-client.ts): chip, memory, cores, tier.
import { hardware } from "@/platform/hardware";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json(hardware());
}
