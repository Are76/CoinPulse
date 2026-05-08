import { describe, expect, it } from "vitest";

import {
  buildAdaptiveWindows,
  splitBlockWindow,
} from "@/services/ingestion/block-window";

describe("block-window planning", () => {
  it("builds contiguous bounded windows across an inclusive range", () => {
    expect(
      buildAdaptiveWindows({
        startBlock: 100n,
        endBlock: 110n,
        maxWindowSize: 4n,
      }),
    ).toEqual([
      { fromBlock: 100n, toBlock: 103n },
      { fromBlock: 104n, toBlock: 107n },
      { fromBlock: 108n, toBlock: 110n },
    ]);
  });

  it("splits a failing window into two smaller contiguous windows", () => {
    expect(
      splitBlockWindow({
        fromBlock: 200n,
        toBlock: 207n,
      }),
    ).toEqual([
      { fromBlock: 200n, toBlock: 203n },
      { fromBlock: 204n, toBlock: 207n },
    ]);
  });
});
