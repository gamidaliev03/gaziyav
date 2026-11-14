// The browser demo build (NEXT_PUBLIC_GAZIYAV_DEMO=1, script/web-demo.sh): the editor as a static page, everything in
// the visitor's browser. What it leaves out is removed from the interface, not greyed (script/web-demo.sh says how it is built).
export const DEMO = process.env.NEXT_PUBLIC_GAZIYAV_DEMO === "1";

/** Storage names of the demo carry their own prefix, so the demo never meets another copy of the editor's data. */
export const demoName = (name: string): string => (DEMO ? `gzdemo-${name}` : name);
