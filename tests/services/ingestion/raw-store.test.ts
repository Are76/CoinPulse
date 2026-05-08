import { describe, expect, it } from "vitest";

import {
  persistRawLpActions,
  persistRawStakeActions,
  persistRawDexSwaps,
  persistRawTokenTransfers,
  persistRawTransactions,
  readWalletRawLpActions,
  readWalletRawStakeActions,
  readWalletDexSwapSnapshots,
  readWalletTransferRawLogs,
  readWalletTransferRawTokenTransfers,
} from "@/services/ingestion/raw-store";

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

describe("readWalletTransferRawLogs", () => {
  it("returns only active wallet-related transfer logs ordered by block and log index", async () => {
    const walletTopic =
      "0x0000000000000000000000001111111111111111111111111111111111111111";
    const records = [
      {
        chainId: 369,
        txHash: "0xtx2",
        blockNumber: 12n,
        blockHash: "0xblock2",
        logIndex: 3,
        address: "0xtoken",
        topic0: TRANSFER_TOPIC,
        topic1: "0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        topic2: walletTopic,
        topic3: null,
        data: "0x02",
        status: "ACTIVE",
      },
      {
        chainId: 369,
        txHash: "0xtx1",
        blockNumber: 11n,
        blockHash: "0xblock1",
        logIndex: 1,
        address: "0xtoken",
        topic0: TRANSFER_TOPIC,
        topic1: walletTopic,
        topic2: "0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        topic3: null,
        data: "0x01",
        status: "ACTIVE",
      },
      {
        chainId: 369,
        txHash: "0xignored-reorg",
        blockNumber: 10n,
        blockHash: "0xblock0",
        logIndex: 0,
        address: "0xtoken",
        topic0: TRANSFER_TOPIC,
        topic1: walletTopic,
        topic2: "0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        topic3: null,
        data: "0x03",
        status: "REORGED",
      },
      {
        chainId: 369,
        txHash: "0xignored-other-wallet",
        blockNumber: 13n,
        blockHash: "0xblock3",
        logIndex: 0,
        address: "0xtoken",
        topic0: TRANSFER_TOPIC,
        topic1: "0x000000000000000000000000cccccccccccccccccccccccccccccccccccccccc",
        topic2: "0x000000000000000000000000dddddddddddddddddddddddddddddddddddddddd",
        topic3: null,
        data: "0x04",
        status: "ACTIVE",
      },
    ];

    const result = await readWalletTransferRawLogs(
      {
        chainId: 369,
        walletAddress: "0x1111111111111111111111111111111111111111",
        fromBlock: 10n,
        toBlock: 20n,
        transferTopic0: TRANSFER_TOPIC,
      },
      {
        rawLog: {
          findMany: async () =>
            records.filter(
              (record) =>
                record.status === "ACTIVE" &&
                record.topic0 === TRANSFER_TOPIC &&
                record.blockNumber >= 10n &&
                record.blockNumber <= 20n &&
                (record.topic1 === walletTopic || record.topic2 === walletTopic),
            ).sort((left, right) =>
              left.blockNumber === right.blockNumber
                ? left.logIndex - right.logIndex
                : Number(left.blockNumber - right.blockNumber),
            ),
        },
      },
    );

    expect(result.map((record) => `${record.blockNumber}:${record.logIndex}:${record.txHash}`)).toEqual([
      "11:1:0xtx1",
      "12:3:0xtx2",
    ]);
  });
});

describe("raw token transfer audit helpers", () => {
  it("persists and reads wallet-scoped raw token transfers deterministically", async () => {
    const creates: Array<unknown> = [];

    const persisted = await persistRawTokenTransfers(
      [
        {
          chainId: 369,
          tokenId: "token_1",
          tokenAddress: "0xtoken",
          assetIdSnapshot: "chain:369:erc20:0xtoken",
          decimalsSnapshot: 18,
          txHash: "0xtx1",
          blockNumber: 11n,
          blockHash: "0xblock1",
          logIndex: 1,
          fromAddress: "0x1111111111111111111111111111111111111111",
          toAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          amountRaw: "5",
        },
      ],
      {
        rawTokenTransfer: {
          createMany: async (args) => {
            creates.push(...args.data);
            return { count: args.data.length };
          },
        },
      },
    );

    expect(persisted).toEqual({ count: 1 });
    expect(creates[0]).toMatchObject({
      txHash: "0xtx1",
      blockHash: "0xblock1",
      tokenAddress: "0xtoken",
      assetIdSnapshot: "chain:369:erc20:0xtoken",
      decimalsSnapshot: 18,
      fromAddress: "0x1111111111111111111111111111111111111111",
      toAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      amountRaw: "5",
    });

    const records = await readWalletTransferRawTokenTransfers(
      {
        chainId: 369,
        walletAddress: "0x1111111111111111111111111111111111111111",
        fromBlock: 10n,
        toBlock: 20n,
      },
      {
        rawTokenTransfer: {
          findMany: async () => [
            {
              chainId: 369,
              tokenId: "token_1",
              tokenAddress: "0xtoken",
              assetIdSnapshot: "chain:369:erc20:0xtoken",
              decimalsSnapshot: 18,
              txHash: "0xtx1",
              blockNumber: 11n,
              blockHash: "0xblock1",
              logIndex: 1,
              fromAddress: "0x1111111111111111111111111111111111111111",
              toAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              amountRaw: "5",
            },
          ],
        },
      },
    );

    expect(records).toEqual([
      expect.objectContaining({
        txHash: "0xtx1",
        amountRaw: "5",
        tokenAddress: "0xtoken",
        assetIdSnapshot: "chain:369:erc20:0xtoken",
        decimalsSnapshot: 18,
      }),
    ]);
  });
});

describe("raw dex swap audit helpers", () => {
  it("persists raw transactions and wallet-scoped dex swap snapshots deterministically", async () => {
    const transactionCreates: Array<unknown> = [];
    const swapCreates: Array<unknown> = [];

    const persistedTransactions = await persistRawTransactions(
      [
        {
          chainId: 369,
          txHash: "0xswap",
          blockNumber: 100n,
          blockHash: "0xblock100",
          transactionIndex: 2,
          fromAddress: "0x1111111111111111111111111111111111111111",
          toAddress: "0x7777777777777777777777777777777777777777",
          valueRaw: "0",
          gasPriceRaw: "2000000000",
          gasUsedRaw: "100000",
        },
      ],
      {
        rawTransaction: {
          createMany: async (args) => {
            transactionCreates.push(...args.data);
            return { count: args.data.length };
          },
        },
      },
    );

    const persistedSwaps = await persistRawDexSwaps(
      [
        {
          chainId: 369,
          protocolSlug: "pulsex",
          txHash: "0xswap",
          blockNumber: 100n,
          blockHash: "0xblock100",
          logIndex: 5,
          pairAddress: "0x9999999999999999999999999999999999999999",
          initiatorAddress: "0x1111111111111111111111111111111111111111",
          counterpartyAddress: "0x7777777777777777777777777777777777777777",
          soldTokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          soldAssetIdSnapshot: "chain:369:erc20:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          soldDecimalsSnapshot: 6,
          soldAmountRaw: "5000000",
          boughtTokenAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          boughtAssetIdSnapshot: "chain:369:erc20:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          boughtDecimalsSnapshot: 18,
          boughtAmountRaw: "3000000000000000000",
          feeAssetIdSnapshot: "chain:369:native:PLS",
          feeDecimalsSnapshot: 18,
          feeAmountRaw: "200000000000000",
        },
      ],
      {
        rawDexSwap: {
          createMany: async (args) => {
            swapCreates.push(...args.data);
            return { count: args.data.length };
          },
        },
      },
    );

    expect(persistedTransactions).toEqual({ count: 1 });
    expect(persistedSwaps).toEqual({ count: 1 });
    expect(transactionCreates[0]).toMatchObject({
      txHash: "0xswap",
      blockHash: "0xblock100",
      fromAddress: "0x1111111111111111111111111111111111111111",
      gasPriceRaw: "2000000000",
      gasUsedRaw: "100000",
    });
    expect(swapCreates[0]).toMatchObject({
      protocolSlug: "pulsex",
      txHash: "0xswap",
      pairAddress: "0x9999999999999999999999999999999999999999",
      soldAssetIdSnapshot:
        "chain:369:erc20:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      boughtAssetIdSnapshot:
        "chain:369:erc20:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      feeAssetIdSnapshot: "chain:369:native:PLS",
      feeAmountRaw: "200000000000000",
    });

    const records = await readWalletDexSwapSnapshots(
      {
        chainId: 369,
        walletAddress: "0x1111111111111111111111111111111111111111",
        fromBlock: 90n,
        toBlock: 110n,
      },
      {
        rawDexSwap: {
          findMany: async () => [
            {
              chainId: 369,
              protocolSlug: "pulsex",
              txHash: "0xswap",
              blockNumber: 100n,
              blockHash: "0xblock100",
              logIndex: 5,
              pairAddress: "0x9999999999999999999999999999999999999999",
              initiatorAddress: "0x1111111111111111111111111111111111111111",
              counterpartyAddress: "0x7777777777777777777777777777777777777777",
              soldTokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              soldAssetIdSnapshot:
                "chain:369:erc20:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              soldDecimalsSnapshot: 6,
              soldAmountRaw: "5000000",
              boughtTokenAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              boughtAssetIdSnapshot:
                "chain:369:erc20:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              boughtDecimalsSnapshot: 18,
              boughtAmountRaw: "3000000000000000000",
              feeAssetIdSnapshot: "chain:369:native:PLS",
              feeDecimalsSnapshot: 18,
              feeAmountRaw: "200000000000000",
            },
          ],
        },
      },
    );

    expect(records).toEqual([
      expect.objectContaining({
        txHash: "0xswap",
        protocolSlug: "pulsex",
        soldAmountRaw: "5000000",
        boughtAmountRaw: "3000000000000000000",
        feeAmountRaw: "200000000000000",
      }),
    ]);
  });
});

describe("raw lp audit helpers", () => {
  it("persists and reads wallet-scoped raw lp action snapshots deterministically", async () => {
    const creates: Array<unknown> = [];

    const persisted = await persistRawLpActions(
      [
        {
          chainId: 369,
          protocolSlug: "pulsex",
          actionKind: "ADD",
          txHash: "0xlp",
          blockNumber: 120n,
          blockHash: "0xblock120",
          logIndex: 6,
          pairAddress: "0xpair",
          initiatorAddress: "0x1111111111111111111111111111111111111111",
          counterpartyAddress: "0xrouter",
          token0Address: "0xtoken0",
          token0AssetIdSnapshot: "chain:369:erc20:0xtoken0",
          token0DecimalsSnapshot: 18,
          token0AmountRaw: "1000000000000000000",
          token1Address: "0xtoken1",
          token1AssetIdSnapshot: "chain:369:erc20:0xtoken1",
          token1DecimalsSnapshot: 6,
          token1AmountRaw: "5000000",
          lpTokenAddress: "0xlp",
          lpAssetIdSnapshot: "chain:369:erc20:0xlp",
          lpDecimalsSnapshot: 18,
          lpAmountRaw: "100000000000000000",
          feeAssetIdSnapshot: "chain:369:native:PLS",
          feeDecimalsSnapshot: 18,
          feeAmountRaw: "200000000000000",
        },
      ],
      {
        rawLpAction: {
          createMany: async (args) => {
            creates.push(...args.data);
            return { count: args.data.length };
          },
        },
      },
    );

    expect(persisted).toEqual({ count: 1 });
    expect(creates[0]).toMatchObject({
      protocolSlug: "pulsex",
      actionKind: "ADD",
      txHash: "0xlp",
      pairAddress: "0xpair",
      token0AssetIdSnapshot: "chain:369:erc20:0xtoken0",
      token1AssetIdSnapshot: "chain:369:erc20:0xtoken1",
      lpAssetIdSnapshot: "chain:369:erc20:0xlp",
      feeAssetIdSnapshot: "chain:369:native:PLS",
    });

    const records = await readWalletRawLpActions(
      {
        chainId: 369,
        walletAddress: "0x1111111111111111111111111111111111111111",
        fromBlock: 100n,
        toBlock: 130n,
      },
      {
        rawLpAction: {
          findMany: async () => [
            {
              chainId: 369,
              protocolSlug: "pulsex",
              actionKind: "ADD",
              txHash: "0xlp",
              blockNumber: 120n,
              blockHash: "0xblock120",
              logIndex: 6,
              pairAddress: "0xpair",
              initiatorAddress: "0x1111111111111111111111111111111111111111",
              counterpartyAddress: "0xrouter",
              token0Address: "0xtoken0",
              token0AssetIdSnapshot: "chain:369:erc20:0xtoken0",
              token0DecimalsSnapshot: 18,
              token0AmountRaw: "1000000000000000000",
              token1Address: "0xtoken1",
              token1AssetIdSnapshot: "chain:369:erc20:0xtoken1",
              token1DecimalsSnapshot: 6,
              token1AmountRaw: "5000000",
              lpTokenAddress: "0xlp",
              lpAssetIdSnapshot: "chain:369:erc20:0xlp",
              lpDecimalsSnapshot: 18,
              lpAmountRaw: "100000000000000000",
              feeAssetIdSnapshot: "chain:369:native:PLS",
              feeDecimalsSnapshot: 18,
              feeAmountRaw: "200000000000000",
            },
          ],
        },
      },
    );

    expect(records).toEqual([
      expect.objectContaining({
        txHash: "0xlp",
        actionKind: "ADD",
        lpAssetIdSnapshot: "chain:369:erc20:0xlp",
        feeAmountRaw: "200000000000000",
      }),
    ]);
  });
});

describe("raw stake audit helpers", () => {
  it("persists and reads wallet-scoped raw stake action snapshots deterministically", async () => {
    const creates: Array<unknown> = [];

    const persisted = await persistRawStakeActions(
      [
        {
          chainId: 369,
          protocolSlug: "hex",
          actionKind: "START",
          txHash: "0xstake",
          blockNumber: 130n,
          blockHash: "0xblock130",
          actionIndex: 0,
          contractAddress: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
          initiatorAddress: "0x1111111111111111111111111111111111111111",
          stakeId: 42n,
          stakeIndex: 3,
          stakedDays: 365,
          tokenAddress: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
          assetIdSnapshot:
            "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
          decimalsSnapshot: 8,
          principalLockedRaw: "100000000",
          feeAssetIdSnapshot: "chain:369:native:PLS",
          feeDecimalsSnapshot: 18,
          feeAmountRaw: "200000000000000",
        },
      ],
      {
        rawStakeAction: {
          createMany: async (args) => {
            creates.push(...args.data);
            return { count: args.data.length };
          },
        },
      },
    );

    expect(persisted).toEqual({ count: 1 });
    expect(creates[0]).toMatchObject({
      protocolSlug: "hex",
      actionKind: "START",
      txHash: "0xstake",
      stakeId: 42n,
      principalLockedRaw: "100000000",
      assetIdSnapshot:
        "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      feeAssetIdSnapshot: "chain:369:native:PLS",
    });

    const records = await readWalletRawStakeActions(
      {
        chainId: 369,
        walletAddress: "0x1111111111111111111111111111111111111111",
        fromBlock: 120n,
        toBlock: 140n,
      },
      {
        rawStakeAction: {
          findMany: async () => [
            {
              chainId: 369,
              protocolSlug: "hex",
              actionKind: "START",
              txHash: "0xstake",
              blockNumber: 130n,
              blockHash: "0xblock130",
              actionIndex: 0,
              contractAddress: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
              initiatorAddress: "0x1111111111111111111111111111111111111111",
              stakeId: 42n,
              stakeIndex: 3,
              stakedDays: 365,
              tokenAddress: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
              assetIdSnapshot:
                "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
              decimalsSnapshot: 8,
              principalLockedRaw: "100000000",
              totalReturnedRaw: null,
              principalReturnedRaw: null,
              yieldRaw: null,
              penaltyRaw: null,
              feeAssetIdSnapshot: "chain:369:native:PLS",
              feeDecimalsSnapshot: 18,
              feeAmountRaw: "200000000000000",
            },
          ],
        },
      },
    );

    expect(records).toEqual([
      expect.objectContaining({
        txHash: "0xstake",
        actionKind: "START",
        stakeId: 42n,
        principalLockedRaw: "100000000",
        feeAmountRaw: "200000000000000",
      }),
    ]);
  });
});
