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

// Tier 1-verified 2026-08-04 via direct rpc.pulsechain.com RPC calls and an
// api.scan.pulsechain.com cross-check (block regime change, parent-hash
// adjacency). See docs/pulsechain-fork-state-policy.md §6.1 for full evidence.
// D-036 (docs/project-decisions.md) remains Proposed; this constant records
// only the Tier 1-verified boundary block pair, not policy acceptance.
export const PULSECHAIN_FORK_BOUNDARY = {
  lastInheritedBlock: 17_232_999n,
  firstPostForkBlock: 17_233_000n,
} as const;
