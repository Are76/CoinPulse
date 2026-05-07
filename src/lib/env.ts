import { z } from "zod";

const appEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export const env = appEnvSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
});

export type Env = typeof env;
