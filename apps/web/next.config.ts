import type { NextConfig } from "next";
import { withContentCollections } from "@content-collections/next";

// Claude's hearing (studio/server/hear-models.ts) runs transformers.js + ONNX Runtime in a helper process with the app's
// runtime. Next's tracing follows the import there, but not ONNX Runtime's library beside its binding (the binding loads
// it), and it would carry every platform's binding: only this Mac's goes into the app (ARCH=x64 for the Intel build).
// Of transformers.js only the Node build is used (no browser builds, no WebAssembly runtime, no sources: −30 MB).
const ORT = "../../node_modules/.bun/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v3";
const ORT_ARCH = process.env.ARCH === "x64" ? "x64" : "arm64";
const HF = "../../node_modules/.bun/@huggingface+transformers@*/node_modules/@huggingface/transformers";
// so the compiler folds `false` and drops a family module required
// behind it (src/family/edition.ts says how). The family's own pages and API routes are named page.family.tsx /
// route.family.ts: they are routes in the family build only (GaziyavShell test/own-edition-scan.mjs checks his).

const nextConfig: NextConfig = {
	pageExtensions: ["tsx", "ts", "jsx", "js"],
	outputFileTracingIncludes: { "/api/hear/**": [`${ORT}/darwin/${ORT_ARCH}/*`] },
	outputFileTracingExcludes: {
		"/api/hear/**": [
			`${ORT}/linux/**`,
			`${ORT}/win32/**`,
			`${ORT}/darwin/${ORT_ARCH === "x64" ? "arm64" : "x64"}/**`,
			`${HF}/src/**`,
			`${HF}/types/**`,
			`${HF}/dist/ort-wasm*`,
			`${HF}/dist/transformers.js`,
			`${HF}/dist/transformers.min.js`,
			`${HF}/dist/transformers.web*`,
			`${HF}/dist/*.cjs`,
			`${HF}/dist/transformers.node.min.mjs`,
		],
	},
	compiler: {
		removeConsole: process.env.NODE_ENV === "production",
	},
	reactStrictMode: true,
	// Source maps add ~28 MB to the app and are never used by the packaged build.
	productionBrowserSourceMaps: false,
	output: "standalone",
	images: {
		remotePatterns: [
			{
				protocol: "https",
				hostname: "plus.unsplash.com",
			},
			{
				protocol: "https",
				hostname: "images.unsplash.com",
			},
			{
				protocol: "https",
				hostname: "images.marblecms.com",
			},
			{
				protocol: "https",
				hostname: "lh3.googleusercontent.com",
			},
			{
				protocol: "https",
				hostname: "avatars.githubusercontent.com",
			},
			{
				protocol: "https",
				hostname: "api.iconify.design",
			},
			{
				protocol: "https",
				hostname: "api.simplesvg.com",
			},
			{
				protocol: "https",
				hostname: "api.unisvg.com",
			},
			{
				protocol: "https",
				hostname: "cdn.brandfetch.io",
			},
		],
	},
};

export default withContentCollections(nextConfig);
