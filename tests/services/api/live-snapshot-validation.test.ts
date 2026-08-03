import { describe, expect, it } from "vitest";

import { liveSnapshotRequestSchema } from "@/services/api/validation";

describe("liveSnapshotRequestSchema", () => {
  it("accepts a valid wallet address, chainId, and default quoteAsset", () => {
    const result = liveSnapshotRequestSchema.parse({
      walletAddress: "0x1111111111111111111111111111111111111111",
      chainId: "369",
    });
    expect(result.chainId).toBe(369);
    expect(result.quoteAsset).toBe("fiat:usd");
  });

  it("rejects a malformed wallet address", () => {
    expect(() =>
      liveSnapshotRequestSchema.parse({ walletAddress: "not-an-address", chainId: "369" }),
    ).toThrow();
  });
});
