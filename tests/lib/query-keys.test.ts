import { describe, expect, it } from "vitest";

import { queryKeys } from "@/lib/query/query-keys";

describe("query keys", () => {
  it("builds debug keys", () => {
    expect(queryKeys.debug.health()).toEqual(["debug", "health"]);
    expect(queryKeys.debug.status()).toEqual(["debug", "status"]);
  });

  it("builds dashboard keys with normalized wallet and latest fallback", () => {
    expect(
      queryKeys.dashboard({
        schemaVersion: "v1",
        chainId: 369,
        walletAddress: " 0xABCDEF ",
        quoteAsset: "fiat:usd",
      }),
    ).toEqual(["dashboard", "v1", 369, "0xabcdef", "fiat:usd", "latest"]);
  });

  it("builds future chain-scoped and filtered keys", () => {
    expect(queryKeys.prices.status()).toEqual(["prices", "status"]);
    expect(queryKeys.wallets.tracked(369)).toEqual(["wallets", "tracked", 369]);
    expect(queryKeys.transactions("v1", { chainId: 369 })).toEqual([
      "transactions",
      "v1",
      { chainId: 369 },
    ]);
  });
});
