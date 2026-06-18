import { defineChain } from "viem";

export const PULSECHAIN_REFERENCE = {
  id: 369,
  slug: "pulsechain",
  name: "PulseChain",
  nativeAssetId: "chain:369:native:0x0000000000000000000000000000000000000000",
} as const;

export const PULSECHAIN_CHAIN = defineChain({
  id: PULSECHAIN_REFERENCE.id,
  name: PULSECHAIN_REFERENCE.name,
  nativeCurrency: {
    name: "Pulse",
    symbol: "PLS",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      // No hardcoded default. Runtime transport is always provided explicitly by the caller.
      http: [],
    },
  },
  blockExplorers: {
    default: {
      name: "PulseScan",
      url: "https://scan.pulsechain.com",
    },
  },
});

export const SUPPORTED_CHAINS = {
  [PULSECHAIN_CHAIN.id]: PULSECHAIN_CHAIN,
} as const;

export type SupportedChainId = keyof typeof SUPPORTED_CHAINS;
