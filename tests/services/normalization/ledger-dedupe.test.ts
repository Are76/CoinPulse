import { describe, expect, it } from "vitest";

import { buildLedgerEntryDedupeKey } from "@/services/normalization/ledger-dedupe";

describe("buildLedgerEntryDedupeKey", () => {
  it("builds a deterministic non-null dedupe key for synthesized entries", () => {
    const dedupeKey = buildLedgerEntryDedupeKey({
      chainId: 369,
      walletId: "wallet_1",
      txHash: "0xtx",
      entryType: "FEE",
      assetId: "chain:369:native:0x0000000000000000000000000000000000000000",
      direction: "OUT",
      normalizerVersion: "v1",
      sourceRef: "derived:fee:tx",
    });

    expect(dedupeKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it("distinguishes separate canonical rows within the same transaction", () => {
    const base = {
      chainId: 369,
      walletId: "wallet_1",
      txHash: "0xtx",
      assetId: "chain:369:native:0x0000000000000000000000000000000000000000",
      direction: "OUT",
      normalizerVersion: "v1",
    } as const;

    const feeKey = buildLedgerEntryDedupeKey({
      ...base,
      entryType: "FEE",
      sourceRef: "derived:fee:tx",
    });
    const sendKey = buildLedgerEntryDedupeKey({
      ...base,
      entryType: "SEND",
      sourceRef: "log:0xtx:12",
    });

    expect(feeKey).not.toBe(sendKey);
  });

  it("remains deterministic when fields contain colon separators", () => {
    const withColons = {
      chainId: 369,
      walletId: "wallet:1",
      txHash: "0xTX",
      entryType: "FEE",
      assetId: "chain:369:native:0x0000000000000000000000000000000000000000",
      direction: "OUT",
      normalizerVersion: "v1:2",
      sourceRef: "derived:fee:tx:1",
    } as const;

    expect(buildLedgerEntryDedupeKey(withColons)).toBe(
      buildLedgerEntryDedupeKey(withColons),
    );
  });
});
