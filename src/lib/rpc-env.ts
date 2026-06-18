import { z } from "zod";

const rpcEnvSchema = z.object({
  PULSECHAIN_RPC_URL: z.string().url(),
  PULSECHAIN_RPC_URL_2: z.string().url().optional(),
  PULSECHAIN_RPC_URL_3: z.string().url().optional(),
});

export const rpcEnv = rpcEnvSchema.parse({
  PULSECHAIN_RPC_URL: process.env.PULSECHAIN_RPC_URL,
  PULSECHAIN_RPC_URL_2: process.env.PULSECHAIN_RPC_URL_2 || undefined,
  PULSECHAIN_RPC_URL_3: process.env.PULSECHAIN_RPC_URL_3 || undefined,
});

export type RpcEnv = typeof rpcEnv;
