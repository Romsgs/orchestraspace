import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  WEB_ORIGIN: z.string().url().transform((url) => new URL(url).origin).default("http://localhost:5173"),
  SESSION_SECRET: z.string().min(32),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
  SESSION_MAX_AGE_HOURS: z.coerce.number().positive().default(12),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0)
});

export const env = schema.parse(process.env);

if (env.NODE_ENV === "production") {
  if (env.COOKIE_SECURE !== "true") throw new Error("COOKIE_SECURE must be true in production.");
  if (env.TRUST_PROXY_HOPS < 1) throw new Error("TRUST_PROXY_HOPS must trust the production HTTPS proxy.");
  if (!process.env.WEB_ORIGIN) throw new Error("WEB_ORIGIN must be set in production.");
}
