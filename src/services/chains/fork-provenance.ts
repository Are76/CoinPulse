import { PULSECHAIN_FORK_BOUNDARY, PULSECHAIN_REFERENCE } from "@/config/chains";

// Five-value provenance model per D-036 (docs/project-decisions.md) and
// docs/pulsechain-fork-state-policy.md §7. D-036 remains Proposed — this
// type records the agreed vocabulary, not policy acceptance.
export type PulseChainForkProvenance =
  | "PULSECHAIN_POST_FORK"
  | "ETHEREUM_INHERITED_HISTORY"
  | "FORK_OPENING_STATE"
  | "ETHEREUM_CHAIN_HISTORY"
  | "UNKNOWN_OR_UNVERIFIED";

export type ClassifyPulseChainBlockProvenanceInput = {
  chainId: number;
  blockNumber: bigint;
};

// Classifies a PulseChain block number against the Tier 1-verified fork
// boundary (docs/pulsechain-fork-state-policy.md §6.1). Only the two
// block-number-driven classes are ever returned by this function:
//
// - FORK_OPENING_STATE requires separate proof-based observation-point
//   evidence (policy §10) — it can never be inferred from a block number.
// - ETHEREUM_CHAIN_HISTORY requires an observation independently sourced
//   from an actual Ethereum RPC/explorer (policy §7) — it can never be
//   inferred from a PulseChain block number or an unverified chainId input.
//
// Any input this function cannot safely classify — a chainId other than
// PulseChain's, or a negative block number — fails closed to
// UNKNOWN_OR_UNVERIFIED rather than guessing.
export function classifyPulseChainBlockProvenance(
  input: ClassifyPulseChainBlockProvenanceInput,
): PulseChainForkProvenance {
  if (input.chainId !== PULSECHAIN_REFERENCE.id) {
    return "UNKNOWN_OR_UNVERIFIED";
  }

  if (input.blockNumber < 0n) {
    return "UNKNOWN_OR_UNVERIFIED";
  }

  if (input.blockNumber <= PULSECHAIN_FORK_BOUNDARY.lastInheritedBlock) {
    return "ETHEREUM_INHERITED_HISTORY";
  }

  if (input.blockNumber >= PULSECHAIN_FORK_BOUNDARY.firstPostForkBlock) {
    return "PULSECHAIN_POST_FORK";
  }

  return "UNKNOWN_OR_UNVERIFIED";
}
