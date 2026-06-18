import "server-only";

import { createPublicClient, fallback, http, type PublicClient } from "viem";

import { PULSECHAIN_CHAIN } from "@/config/chains";
import { rpcEnv } from "@/lib/rpc-env";

export function createPublicClientForChain(): PublicClient {
  const urls = [
    rpcEnv.PULSECHAIN_RPC_URL,
    rpcEnv.PULSECHAIN_RPC_URL_2,
    rpcEnv.PULSECHAIN_RPC_URL_3,
  ].filter((url): url is string => url !== undefined);

  return createPublicClient({
    chain: PULSECHAIN_CHAIN,
    transport: fallback(urls.map((url) => http(url, { retryCount: 2 }))),
  });
}
