import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  readWalletDexSwapSnapshots,
  readWalletRawLpActions,
  readWalletRawStakeActions,
  readWalletTransferRawTokenTransfers,
} from "@/services/ingestion/raw-store";
import { toCanonicalQuantity } from "@/services/normalization/types";

const WALLET = "0x1111111111111111111111111111111111111111";

// Prisma.Decimal serializes magnitudes >= 1e21 via toString() in exponential
// notation (e.g. "1.17038473047e+22"). readWalletRawStakeActions must emit
// fixed-point, digit-only strings so the downstream /^\d+$/ canonical quantity
// guard (toCanonicalQuantity) accepts them. Window 4's ~1.17e22 wei PLS gas fee
// exercises this path via appendFee -> normalizeStakeEnd.
describe("readWalletRawStakeActions large Decimal serialization", () => {
  it("emits digit-only strings for >= 1e21 Decimal columns (no exponential notation)", async () => {
    const feeAmount = new Prisma.Decimal("11703847304700000000000"); // ~1.17e22
    const principalLocked = new Prisma.Decimal("50000000000000000000000"); // 5e22
    const totalReturned = new Prisma.Decimal("60000000000000000000000"); // 6e22
    const principalReturned = new Prisma.Decimal("50000000000000000000000");
    const yieldAmount = new Prisma.Decimal("10000000000000000000000"); // 1e22
    const penalty = new Prisma.Decimal("1500000000000000000000"); // 1.5e21

    // Guard: confirm the raw toString() shape is actually exponential, i.e. we
    // are reproducing the failure condition rather than a benign value.
    for (const value of [
      feeAmount,
      principalLocked,
      totalReturned,
      principalReturned,
      yieldAmount,
      penalty,
    ]) {
      expect(value.toString()).toContain("e+");
    }

    const [record] = await readWalletRawStakeActions(
      {
        chainId: 369,
        walletAddress: WALLET,
        fromBlock: 0n,
        toBlock: 100n,
      },
      {
        rawStakeAction: {
          findMany: async () => [
            {
              chainId: 369,
              protocolSlug: "hex",
              actionKind: "END",
              txHash: "0xstakeend",
              blockNumber: 50n,
              blockHash: "0xblock50",
              actionIndex: 0,
              contractAddress: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
              initiatorAddress: WALLET,
              stakeId: 42n,
              stakeIndex: 3,
              stakedDays: 365,
              tokenAddress: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
              assetIdSnapshot:
                "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
              decimalsSnapshot: 8,
              principalLockedRaw: principalLocked,
              totalReturnedRaw: totalReturned,
              principalReturnedRaw: principalReturned,
              yieldRaw: yieldAmount,
              penaltyRaw: penalty,
              feeAssetIdSnapshot: "chain:369:native:PLS",
              feeDecimalsSnapshot: 18,
              feeAmountRaw: feeAmount,
            },
          ],
        },
      },
    );

    const digitOnly = /^\d+$/;
    expect(record.feeAmountRaw).toBe("11703847304700000000000");
    expect(record.feeAmountRaw).toMatch(digitOnly);
    expect(record.principalLockedRaw).toBe("50000000000000000000000");
    expect(record.principalLockedRaw).toMatch(digitOnly);
    expect(record.totalReturnedRaw).toBe("60000000000000000000000");
    expect(record.totalReturnedRaw).toMatch(digitOnly);
    expect(record.principalReturnedRaw).toBe("50000000000000000000000");
    expect(record.principalReturnedRaw).toMatch(digitOnly);
    expect(record.yieldRaw).toBe("10000000000000000000000");
    expect(record.yieldRaw).toMatch(digitOnly);
    expect(record.penaltyRaw).toBe("1500000000000000000000");
    expect(record.penaltyRaw).toMatch(digitOnly);
  });
});

// Same failure mode as the stake reader: the RawTokenTransfer amountRaw
// Decimal(78, 0) column must serialize as a fixed-point, digit-only string so
// the downstream /^\d+$/ canonical quantity guard accepts it, rather than
// exponential notation. TRANSFERS backfill Window 1 (blocks 26696999-26697998)
// failed at NORMALIZING_LEDGER on a 2.8e22 DAI amount via this exact path.
describe("readWalletTransferRawTokenTransfers large Decimal serialization", () => {
  function transferRecord(amountRaw: unknown) {
    return {
      chainId: 369,
      tokenId: "token-1",
      tokenAddress: "0x6b175474e89094c44da98b954eedeac495271d0f",
      assetIdSnapshot:
        "chain:369:erc20:0x6b175474e89094c44da98b954eedeac495271d0f",
      decimalsSnapshot: 18,
      txHash: "0xtransfer",
      blockNumber: 50n,
      blockHash: "0xblock50",
      logIndex: 0,
      fromAddress: WALLET,
      toAddress: "0x2222222222222222222222222222222222222222",
      amountRaw,
    };
  }

  async function readAmountRaw(amountRaw: unknown) {
    const [record] = await readWalletTransferRawTokenTransfers(
      {
        chainId: 369,
        walletAddress: WALLET,
        fromBlock: 0n,
        toBlock: 100n,
      },
      {
        rawTokenTransfer: {
          findMany: async () => [transferRecord(amountRaw)],
        },
      },
    );
    return record.amountRaw;
  }

  const digitOnly = /^\d+$/;

  it("passes through a normal small integer amount unchanged", async () => {
    const amountRaw = await readAmountRaw(new Prisma.Decimal("123456789"));
    expect(amountRaw).toBe("123456789");
    expect(amountRaw).toMatch(digitOnly);
  });

  it("emits a digit-only string at the 1e21 exponential-notation threshold", async () => {
    const amount = new Prisma.Decimal("1000000000000000000000"); // exactly 1e21
    // Guard: confirm the raw toString() shape is actually exponential, i.e. we
    // are reproducing the failure condition rather than a benign value.
    expect(amount.toString()).toContain("e+");

    const amountRaw = await readAmountRaw(amount);
    expect(amountRaw).toBe("1000000000000000000000");
    expect(amountRaw).toMatch(digitOnly);
  });

  it("emits a digit-only string for the observed Window 1 DAI amount class", async () => {
    const amount = new Prisma.Decimal("28000000000000000000140"); // ~2.8e22
    expect(amount.toString()).toContain("e+");

    const amountRaw = await readAmountRaw(amount);
    expect(amountRaw).toBe("28000000000000000000140");
    expect(amountRaw).toMatch(digitOnly);
    expect(amountRaw).not.toContain("e");
    expect(amountRaw).not.toContain("E");
  });

  it("preserves a full-width Decimal(78, 0) magnitude exactly", async () => {
    const seventyEightDigits = "9".repeat(78);
    const amount = new Prisma.Decimal(seventyEightDigits);
    expect(amount.toString()).toContain("e+");

    const amountRaw = await readAmountRaw(amount);
    expect(amountRaw).toBe(seventyEightDigits);
    expect(amountRaw).toMatch(digitOnly);
  });

  it("produces output accepted by the downstream canonical quantity guard", async () => {
    const amountRaw = await readAmountRaw(
      new Prisma.Decimal("28000000000000000000140"),
    );
    // toCanonicalQuantity throws "amountRaw must be an unsigned integer string"
    // on exponential notation — the exact Window 1 failure.
    expect(toCanonicalQuantity({ amountRaw, decimals: 18 })).toBe(
      "28000.00000000000000014",
    );
  });
});

// Same failure mode as the stake reader: Decimal(78, 0) swap amount/fee columns
// must serialize as fixed-point, digit-only strings so the downstream /^\d+$/
// canonical quantity guard accepts them, rather than exponential notation.
describe("readWalletDexSwapSnapshots large Decimal serialization", () => {
  it("emits digit-only strings for >= 1e21 Decimal columns (no exponential notation)", async () => {
    const soldAmount = new Prisma.Decimal("11703847304700000000000"); // ~1.17e22
    const boughtAmount = new Prisma.Decimal("50000000000000000000000"); // 5e22
    const feeAmount = new Prisma.Decimal("1500000000000000000000"); // 1.5e21

    // Guard: confirm the raw toString() shape is actually exponential, i.e. we
    // are reproducing the failure condition rather than a benign value.
    for (const value of [soldAmount, boughtAmount, feeAmount]) {
      expect(value.toString()).toContain("e+");
    }

    const [record] = await readWalletDexSwapSnapshots(
      {
        chainId: 369,
        walletAddress: WALLET,
        fromBlock: 0n,
        toBlock: 100n,
      },
      {
        rawDexSwap: {
          findMany: async () => [
            {
              chainId: 369,
              protocolSlug: "pulsex-v2",
              txHash: "0xswap",
              blockNumber: 50n,
              blockHash: "0xblock50",
              logIndex: 0,
              pairAddress: "0xpair",
              initiatorAddress: WALLET,
              counterpartyAddress: null,
              soldTokenAddress: "0xsold",
              soldAssetIdSnapshot: "chain:369:erc20:0xsold",
              soldDecimalsSnapshot: 18,
              soldAmountRaw: soldAmount,
              boughtTokenAddress: "0xbought",
              boughtAssetIdSnapshot: "chain:369:erc20:0xbought",
              boughtDecimalsSnapshot: 18,
              boughtAmountRaw: boughtAmount,
              feeAssetIdSnapshot: "chain:369:native:PLS",
              feeDecimalsSnapshot: 18,
              feeAmountRaw: feeAmount,
            },
          ],
        },
      },
    );

    const digitOnly = /^\d+$/;
    expect(record.soldAmountRaw).toBe("11703847304700000000000");
    expect(record.soldAmountRaw).toMatch(digitOnly);
    expect(record.boughtAmountRaw).toBe("50000000000000000000000");
    expect(record.boughtAmountRaw).toMatch(digitOnly);
    expect(record.feeAmountRaw).toBe("1500000000000000000000");
    expect(record.feeAmountRaw).toMatch(digitOnly);
  });
});

// Same failure mode as the stake reader: Decimal(78, 0) LP amount/fee columns
// must serialize as fixed-point, digit-only strings so the downstream /^\d+$/
// canonical quantity guard accepts them, rather than exponential notation.
describe("readWalletRawLpActions large Decimal serialization", () => {
  it("emits digit-only strings for >= 1e21 Decimal columns (no exponential notation)", async () => {
    const token0Amount = new Prisma.Decimal("11703847304700000000000"); // ~1.17e22
    const token1Amount = new Prisma.Decimal("50000000000000000000000"); // 5e22
    const lpAmount = new Prisma.Decimal("10000000000000000000000"); // 1e22
    const feeAmount = new Prisma.Decimal("1500000000000000000000"); // 1.5e21

    // Guard: confirm the raw toString() shape is actually exponential, i.e. we
    // are reproducing the failure condition rather than a benign value.
    for (const value of [token0Amount, token1Amount, lpAmount, feeAmount]) {
      expect(value.toString()).toContain("e+");
    }

    const [record] = await readWalletRawLpActions(
      {
        chainId: 369,
        walletAddress: WALLET,
        fromBlock: 0n,
        toBlock: 100n,
      },
      {
        rawLpAction: {
          findMany: async () => [
            {
              chainId: 369,
              protocolSlug: "pulsex-v2",
              actionKind: "ADD",
              txHash: "0xlp",
              blockNumber: 50n,
              blockHash: "0xblock50",
              logIndex: 0,
              pairAddress: "0xpair",
              initiatorAddress: WALLET,
              counterpartyAddress: null,
              token0Address: "0xtoken0",
              token0AssetIdSnapshot: "chain:369:erc20:0xtoken0",
              token0DecimalsSnapshot: 18,
              token0AmountRaw: token0Amount,
              token1Address: "0xtoken1",
              token1AssetIdSnapshot: "chain:369:erc20:0xtoken1",
              token1DecimalsSnapshot: 18,
              token1AmountRaw: token1Amount,
              lpTokenAddress: "0xlp",
              lpAssetIdSnapshot: "chain:369:erc20:0xlp",
              lpDecimalsSnapshot: 18,
              lpAmountRaw: lpAmount,
              feeAssetIdSnapshot: "chain:369:native:PLS",
              feeDecimalsSnapshot: 18,
              feeAmountRaw: feeAmount,
            },
          ],
        },
      },
    );

    const digitOnly = /^\d+$/;
    expect(record.token0AmountRaw).toBe("11703847304700000000000");
    expect(record.token0AmountRaw).toMatch(digitOnly);
    expect(record.token1AmountRaw).toBe("50000000000000000000000");
    expect(record.token1AmountRaw).toMatch(digitOnly);
    expect(record.lpAmountRaw).toBe("10000000000000000000000");
    expect(record.lpAmountRaw).toMatch(digitOnly);
    expect(record.feeAmountRaw).toBe("1500000000000000000000");
    expect(record.feeAmountRaw).toMatch(digitOnly);
  });
});
