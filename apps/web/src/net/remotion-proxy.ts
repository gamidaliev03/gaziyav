// Chrome with `--no-proxy-server --proxy-server='direct://' --proxy-bypass-list=*` hard-coded, so a composition's
// Google Fonts, Lottie files and pictures went straight out from this Mac, names resolved here. Chrome's own proxy
// flag can't carry the VPN's password, so the render script opens a tiny forwarder on 127.0.0.1 (a random port, for
// this render only) that adds the password and passes everything to the app's local proxy, and starts Chrome through a
// wrapper that drops those three flags and points it at the forwarder. With the VPN's core down the local proxy drops

/**
 * Source of `viaVpn(exe, dir)` for the render scripts (they run as plain ES modules under the app's Node):
 * resolves `{ exe, close }` — the executable to give Remotion (the wrapper, or `exe` itself) and the cleanup.
 */
export const VIA_VPN_SOURCE = `
async function viaVpn(exe) {
	return { exe, close() {} };
}
`;

/**
 * Source run first in the render scripts: Remotion serves the composition (its bundle, the layers' input with the
 * project's texts and pictures) and its frame server on `::` / `0.0.0.0` — every network interface, so anyone on the
 * same Wi-Fi could read them while a render runs. Every server of the script listens on loopback only.
 */
export const LOOPBACK_ONLY_SOURCE = `
{
	const netm = await import("node:net");
	const LOCAL = { "::": "::1", "0.0.0.0": "127.0.0.1", "": "127.0.0.1" };
	const listen = netm.Server.prototype.listen;
	netm.Server.prototype.listen = function (...args) {
		const o = args[0];
		if (o && typeof o === "object" && !Array.isArray(o) && "port" in o) args[0] = { ...o, host: LOCAL[o.host ?? ""] ?? o.host };
		else if (typeof o === "number" || (typeof o === "string" && /^\\d+$/.test(o))) {
			if (typeof args[1] === "string") args[1] = LOCAL[args[1]] ?? args[1];
			else args.splice(1, 0, "127.0.0.1");
		}
		return listen.apply(this, args);
	};
}
`;
