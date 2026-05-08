import { describe, expect, it } from "vitest";

import {
  persistRawTokenTransfers,
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
