import { describe, expect, it } from "vitest";

import { PULSECHAIN_FORK_BOUNDARY, PULSECHAIN_REFERENCE } from "@/config/chains";
import {
  classifyPulseChainBlockProvenance,
  type PulseChainForkProvenance,
} from "@/services/chains/fork-provenance";

const PULSECHAIN_CHAIN_ID = PULSECHAIN_REFERENCE.id;
const OTHER_CHAIN_ID = 1;

describe("PULSECHAIN_FORK_BOUNDARY", () => {
  it("satisfies the firstPostForkBlock = lastInheritedBlock + 1 adjacency invariant", () => {
    expect(PULSECHAIN_FORK_BOUNDARY.firstPostForkBlock).toBe(
      PULSECHAIN_FORK_BOUNDARY.lastInheritedBlock + 1n,
    );
  });
});

describe("classifyPulseChainBlockProvenance", () => {
  const { lastInheritedBlock, firstPostForkBlock } = PULSECHAIN_FORK_BOUNDARY;

  const cases: Array<{
    name: string;
    blockNumber: bigint;
    chainId: number;
    expected: PulseChainForkProvenance;
  }> = [
    {
      name: "one block below lastInheritedBlock",
      blockNumber: lastInheritedBlock - 1n,
      chainId: PULSECHAIN_CHAIN_ID,
      expected: "ETHEREUM_INHERITED_HISTORY",
    },
    {
      name: "exactly lastInheritedBlock",
      blockNumber: lastInheritedBlock,
      chainId: PULSECHAIN_CHAIN_ID,
      expected: "ETHEREUM_INHERITED_HISTORY",
    },
    {
      name: "exactly firstPostForkBlock",
      blockNumber: firstPostForkBlock,
      chainId: PULSECHAIN_CHAIN_ID,
      expected: "PULSECHAIN_POST_FORK",
    },
    {
      name: "one block above firstPostForkBlock",
      blockNumber: firstPostForkBlock + 1n,
      chainId: PULSECHAIN_CHAIN_ID,
      expected: "PULSECHAIN_POST_FORK",
    },
    {
      name: "a chainId other than PulseChain fails closed",
      blockNumber: firstPostForkBlock,
      chainId: OTHER_CHAIN_ID,
      expected: "UNKNOWN_OR_UNVERIFIED",
    },
    {
      name: "a negative block number fails closed",
      blockNumber: -1n,
      chainId: PULSECHAIN_CHAIN_ID,
      expected: "UNKNOWN_OR_UNVERIFIED",
    },
  ];

  it.each(cases)("$name -> $expected", ({ blockNumber, chainId, expected }) => {
    expect(classifyPulseChainBlockProvenance({ chainId, blockNumber })).toBe(expected);
  });

  it("has no gap or overlap across the boundary — every block classifies as exactly one of the two ordinary classes", () => {
    const sweepStart = lastInheritedBlock - 5n;
    const sweepEnd = firstPostForkBlock + 5n;

    for (let block = sweepStart; block <= sweepEnd; block += 1n) {
      const result = classifyPulseChainBlockProvenance({
        chainId: PULSECHAIN_CHAIN_ID,
        blockNumber: block,
      });

      expect(["ETHEREUM_INHERITED_HISTORY", "PULSECHAIN_POST_FORK"]).toContain(result);
    }
  });

  it("never infers FORK_OPENING_STATE or ETHEREUM_CHAIN_HISTORY from an ordinary block number", () => {
    const sample = [
      -1n,
      0n,
      lastInheritedBlock - 1n,
      lastInheritedBlock,
      firstPostForkBlock,
      firstPostForkBlock + 1n,
      999_999_999n,
    ];

    for (const blockNumber of sample) {
      for (const chainId of [PULSECHAIN_CHAIN_ID, OTHER_CHAIN_ID]) {
        const result = classifyPulseChainBlockProvenance({ chainId, blockNumber });

        expect(result).not.toBe("FORK_OPENING_STATE");
        expect(result).not.toBe("ETHEREUM_CHAIN_HISTORY");
      }
    }
  });
});
