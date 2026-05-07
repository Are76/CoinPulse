import { z } from "zod";

import { env as appEnv } from "@/lib/env";

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
});

export const serverEnv = {
  ...appEnv,
  ...serverEnvSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
  }),
};

export type ServerEnv = typeof serverEnv;
