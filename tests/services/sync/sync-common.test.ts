import { describe, expect, it } from "vitest";

import { buildNativeTransactionScanWindows } from "@/services/sync/sync-common";

describe("buildNativeTransactionScanWindows", () => {
  it("splits large ranges predictably by the configured max window size", () => {
    expect(
      buildNativeTransactionScanWindows({
        fromBlock: 10n,
        toBlock: 16n,
        maxWindowSize: 3n,
      }),
    ).toEqual([
      { fromBlock: 10n, toBlock: 12n },
      { fromBlock: 13n, toBlock: 15n },
      { fromBlock: 16n, toBlock: 16n },
    ]);
  });

  it("returns a single window when the range already fits", () => {
    expect(
      buildNativeTransactionScanWindows({
        fromBlock: 20n,
        toBlock: 21n,
        maxWindowSize: 5n,
      }),
    ).toEqual([{ fromBlock: 20n, toBlock: 21n }]);
  });
});
