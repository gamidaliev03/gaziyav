import { z } from "zod";

// The Mac app has no accounts, blog, feedback database or rate limiter: every website-only
// setting is optional (empty when unset), so the server starts without placeholder values.
const optional = z.string().optional().default("");

const webEnvSchema = z.object({
	// Node
	NODE_ENV: z.enum(["development", "production", "test"]),
	ANALYZE: z.string().optional(),
	NEXT_RUNTIME: z.enum(["nodejs", "edge"]).optional(),

	// Public
	NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
	NEXT_PUBLIC_MARBLE_API_URL: z.url().default("https://api.marblecms.com"),

	// Server (website only)
	DATABASE_URL: optional.refine(
		(url) =>
			url === "" ||
			url.startsWith("postgres://") ||
			url.startsWith("postgresql://"),
		"DATABASE_URL must be a postgres:// or postgresql:// URL",
	),
	BETTER_AUTH_SECRET: optional,
	UPSTASH_REDIS_REST_URL: optional,
	UPSTASH_REDIS_REST_TOKEN: optional,
	MARBLE_WORKSPACE_KEY: optional,
	FREESOUND_CLIENT_ID: optional,
	FREESOUND_API_KEY: optional,
});

export const webEnv = webEnvSchema.parse(process.env);
