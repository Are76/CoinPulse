import { describe, expect, it } from "vitest";

import {
  buildBoundedReorgWindow,
  detectReorgMismatch,
} from "@/services/ingestion/reorg-guard";

describe("reorg guard", () => {
  it("returns the bounded rollback window when a stored hash mismatches", () => {
    expect(
      buildBoundedReorgWindow({
        detectedBlockNumber: 150n,
        latestIngestedBlockNumber: 155n,
        maxDepth: 10n,
      }),
    ).toEqual({
      fromBlock: 150n,
      toBlock: 155n,
    });
  });

  it("always includes the detected mismatching block even when it is older than the tip window", () => {
    expect(
      buildBoundedReorgWindow({
        detectedBlockNumber: 80n,
        latestIngestedBlockNumber: 155n,
        maxDepth: 10n,
      }),
    ).toEqual({
      fromBlock: 80n,
      toBlock: 90n,
    });
  });

  it("reports a mismatch only when the block hashes differ", () => {
    expect(
      detectReorgMismatch({
        blockNumber: 99n,
        expectedBlockHash: "0xaaa",
        observedBlockHash: "0xbbb",
      }),
    ).toEqual({
      blockNumber: 99n,
      expectedBlockHash: "0xaaa",
      observedBlockHash: "0xbbb",
    });

    expect(
      detectReorgMismatch({
        blockNumber: 99n,
        expectedBlockHash: "0xaaa",
        observedBlockHash: "0xaaa",
      }),
    ).toBeNull();
  });
});
