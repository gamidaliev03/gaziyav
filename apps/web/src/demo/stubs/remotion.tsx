// The browser demo's stand-in for the motion-graphics renderer (remotion, @remotion/*): that renderer needs a company
// licence for teams, so the demo does not ship it (next.config.ts aliases every import here). The demo cannot add
// motion-graphics layers at all; these names only let the modules that mention them compile — each draws nothing.
import type { CSSProperties, ReactNode } from "react";

type Props = { children?: ReactNode; style?: CSSProperties; className?: string };
export const AbsoluteFill = ({ children, style, className }: Props) => (
	<div className={className} style={{ position: "absolute", inset: 0, ...style }}>
		{children}
	</div>
);
export const Sequence = ({ children }: Props) => <>{children}</>;
export const Img = (props: { src?: string; style?: CSSProperties; className?: string }) => <img alt="" {...props} />;
export const Composition = () => null;
export const Thumbnail = () => null;
export const Player = () => null;
export const registerRoot = () => {};
export const useCurrentFrame = () => 0;
export const useVideoConfig = () => ({ width: 1920, height: 1080, fps: 30, durationInFrames: 1, id: "demo" });
export const delayRender = () => 0;
export const continueRender = () => {};
export const random = (seed: unknown) => {
	let h = 2166136261;
	for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
	return ((h >>> 0) % 1e6) / 1e6;
};
export const interpolate = (x: number, input: number[], output: number[]) => {
	const [a = 0, b = 1] = input;
	const [c = 0, d = 1] = output;
	const t = b === a ? 0 : Math.min(1, Math.max(0, (x - a) / (b - a)));
	return c + (d - c) * t;
};
export const spring = () => 1;
const id = (t: number) => t;
export const Easing = { linear: id, ease: id, in: () => id, out: () => id, inOut: () => id, bezier: () => id, quad: id, cubic: id, sin: id, exp: id, circle: id, back: () => id, elastic: () => id, bounce: id };
export const loadFont = () => ({ fontFamily: "sans-serif", waitUntilDone: () => Promise.resolve() });
export const makeNoise2D = () => () => 0;
export const makeNoise3D = () => () => 0;
export const noise2D = () => 0;
export const noise3D = () => 0;
export const getLength = () => 0;
export const evolvePath = () => ({ strokeDasharray: "0", strokeDashoffset: 0 });
const Shape = () => null;
export const Circle = Shape;
export const Rect = Shape;
export const Triangle = Shape;
export const Star = Shape;
export const Polygon = Shape;
export const Ellipse = Shape;
export const Pie = Shape;
export const Heart = Shape;
export default {};
