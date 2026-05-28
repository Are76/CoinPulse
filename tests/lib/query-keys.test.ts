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


  it("keeps dashboard, debug, pricing, and tracked-wallet keys free of token symbol or name identity", () => {
    const forbiddenDisplayIdentity = ["USDC", "USD Coin", "PLS", "Pulse", "Wrapped PLS"];
    const keys = [
      queryKeys.debug.health(),
      queryKeys.debug.status(),
      queryKeys.dashboard({
        schemaVersion: "v1",
        chainId: 369,
        walletAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        quoteAsset: "fiat:usd",
        asOf: "2026-05-08T12:04:00.000Z",
      }),
      queryKeys.prices.status(369),
      queryKeys.wallets.tracked(369),
    ];

    expect(keys).toEqual([
      ["debug", "health"],
      ["debug", "status"],
      [
        "dashboard",
        "v1",
        369,
        "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        "fiat:usd",
        "2026-05-08T12:04:00.000Z",
      ],
      ["prices", "status", { chainId: 369 }],
      ["wallets", "tracked", 369],
    ]);

    const serializedKeys = JSON.stringify(keys);
    for (const displayValue of forbiddenDisplayIdentity) {
      expect(serializedKeys).not.toContain(displayValue);
    }
  });

  it("builds future chain-scoped and filtered keys", () => {
    expect(queryKeys.prices.status(369)).toEqual(["prices", "status", { chainId: 369 }]);
    expect(queryKeys.wallets.tracked(369)).toEqual(["wallets", "tracked", 369]);
    expect(queryKeys.transactions("v1", { chainId: 369 })).toEqual([
      "transactions",
      "v1",
      { chainId: 369 },
    ]);
  });
});
