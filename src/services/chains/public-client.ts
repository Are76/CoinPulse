import "server-only";

import { createPublicClient, fallback, http, type PublicClient } from "viem";

import { PULSECHAIN_CHAIN } from "@/config/chains";
import { rpcEnv } from "@/lib/rpc-env";

export function createPublicClientForChain(): PublicClient {
  return createPublicClient({
    chain: PULSECHAIN_CHAIN,
    transport: fallback([http(rpcEnv.PULSECHAIN_RPC_URL, { retryCount: 2 })]),
  });
}
