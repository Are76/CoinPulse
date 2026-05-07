import { z } from "zod";

const rpcEnvSchema = z.object({
  PULSECHAIN_RPC_URL: z.string().url(),
});

export const rpcEnv = rpcEnvSchema.parse({
  PULSECHAIN_RPC_URL: process.env.PULSECHAIN_RPC_URL,
});

export type RpcEnv = typeof rpcEnv;
