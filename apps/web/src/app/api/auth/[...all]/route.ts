// The website's sign-in API is not part of the Mac app (no accounts on this Mac): answered with 404 without loading
// the auth server, which failed at every start without its web secrets and filled the crash log.
const unavailable = () => Response.json({ error: "Not available" }, { status: 404 });

export const GET = unavailable;
export const POST = unavailable;
