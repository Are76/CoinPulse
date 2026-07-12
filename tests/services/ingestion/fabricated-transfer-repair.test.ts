import { describe, expect, it } from "vitest";

import {
  ERC20_TRANSFER_EVENT_TOPIC0,
  repairFabricatedTokenTransfers,
  type FabricatedTransferRepairClient,
} from "@/services/ingestion/fabricated-transfer-repair";
import { readWalletTransferRawTokenTransfers } from "@/services/ingestion/raw-store";
import {
  checkEnv,
  parseRepairCliArgs,
} from "../../../scripts/repair-fabricated-token-transfers";

// keccak256("StakeStart(uint256,address,uint40)") — the non-Transfer event the
// pre-PR-#326 decoder mis-decoded into fabricated RawTokenTransfer rows.
const STAKE_START_EVENT_TOPIC0 =
  "0x14872dc760f33532684e68e1b6d5fd3f71ba7b07dee76bdb2b084f28b74233ef";

type MockTransfer = {
  id: string;
  chainId: number;
  txHash: string;
  blockNumber: bigint;
  blockHash: string;
  logIndex: number;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  status: string;
};

type MockLog = {
  id: string;
  chainId: number;
  txHash: string;
  blockHash: string;
  logIndex: number;
  topic0: string | null;
  status: string;
};

function createMockClient(seed: {
  transfers: MockTransfer[];
  logs: MockLog[];
}) {
  const transfers = seed.transfers.map((transfer) => ({ ...transfer }));
  const logs = seed.logs.map((log) => ({ ...log }));
  const updateCalls: Array<Record<string, unknown>> = [];

  const client: FabricatedTransferRepairClient = {
    rawTokenTransfer: {
      async findMany(argsUnknown: unknown) {
        const args = argsUnknown as {
          where: {
            status?: string;
            chainId?: number;
            txHash?: string;
            logIndex?: number;
            blockHash?: string;
            id?: { gt: string };
          };
          orderBy?: { id: "asc" };
          take?: number;
        };
        let rows = transfers
          .filter(
            (transfer) =>
              (args.where.status === undefined ||
                transfer.status === args.where.status) &&
              (args.where.chainId === undefined ||
                transfer.chainId === args.where.chainId) &&
              (args.where.txHash === undefined ||
                transfer.txHash === args.where.txHash) &&
              (args.where.logIndex === undefined ||
                transfer.logIndex === args.where.logIndex) &&
              (args.where.blockHash === undefined ||
                transfer.blockHash === args.where.blockHash) &&
              (args.where.id?.gt === undefined || transfer.id > args.where.id.gt),
          )
          .sort((left, right) => (left.id < right.id ? -1 : 1));
        if (args.take !== undefined) {
          rows = rows.slice(0, args.take);
        }
        return rows as unknown as Array<Record<string, unknown>>;
      },
      async updateMany(argsUnknown: unknown) {
        const args = argsUnknown as {
          where: { id: { in: string[] }; status: string };
          data: { status: string };
        };
        updateCalls.push(args as unknown as Record<string, unknown>);
        let count = 0;
        for (const transfer of transfers) {
          if (
            args.where.id.in.includes(transfer.id) &&
            transfer.status === args.where.status
          ) {
            transfer.status = args.data.status;
            count += 1;
          }
        }
        return { count };
      },
    },
    rawLog: {
      async findMany(argsUnknown: unknown) {
        const args = argsUnknown as { where: { txHash: { in: string[] } } };
        return logs.filter((log) =>
          args.where.txHash.in.includes(log.txHash),
        ) as unknown as Array<Record<string, unknown>>;
      },
    },
  };

  return { client, transfers, logs, updateCalls };
}

function genuineTransferPair(suffix: string, chainId = 369) {
  const txHash = `0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa${suffix}`;
  const blockHash = `0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb${suffix}`;
  const transfer: MockTransfer = {
    id: `transfer_genuine_${suffix}`,
    chainId,
    txHash,
    blockNumber: 100n,
    blockHash,
    logIndex: 1,
    fromAddress: "0x1111111111111111111111111111111111111111",
    toAddress: "0x2222222222222222222222222222222222222222",
    amountRaw: "1000",
    status: "ACTIVE",
  };
  const log: MockLog = {
    id: `log_genuine_${suffix}`,
    chainId,
    txHash,
    blockHash,
    logIndex: 1,
    topic0: ERC20_TRANSFER_EVENT_TOPIC0,
    status: "ACTIVE",
  };
  return { transfer, log };
}

function fabricatedTransferPair(suffix: string, chainId = 369) {
  const txHash = `0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccc${suffix}`;
  const blockHash = `0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddd${suffix}`;
  const transfer: MockTransfer = {
    id: `transfer_fabricated_${suffix}`,
    chainId,
    txHash,
    blockNumber: 200n,
    blockHash,
    logIndex: 40,
    fromAddress: "0x1111111111111111111111111111111111111111",
    // StakeStart mis-decode packs the stakeId into the "to" slot.
    toAddress: "0x00000000000000000000000000000000000e6244",
    amountRaw: "136208203672213103748484872909488738650816492293935906579579",
    status: "ACTIVE",
  };
  const log: MockLog = {
    id: `log_stakestart_${suffix}`,
    chainId,
    txHash,
    blockHash,
    logIndex: 40,
    topic0: STAKE_START_EVENT_TOPIC0,
    status: "ACTIVE",
  };
  return { transfer, log };
}

describe("repairFabricatedTokenTransfers", () => {
  it("keeps a genuine Transfer-backed row ACTIVE and never reports it as fabricated", async () => {
    const genuine = genuineTransferPair("01");
    const { client, transfers, updateCalls } = createMockClient({
      transfers: [genuine.transfer],
      logs: [genuine.log],
    });

    const report = await repairFabricatedTokenTransfers(
      { apply: true, chainId: 369 },
      client,
    );

    expect(report.scannedActiveTransfers).toBe(1);
    expect(report.genuineTransfers).toBe(1);
    expect(report.provenFabricatedTransfers).toBe(0);
    expect(report.changedTransfers).toBe(0);
    expect(report.fabricated).toEqual([]);
    expect(transfers[0].status).toBe("ACTIVE");
    expect(updateCalls).toEqual([]);
  });

  it("reports a fabricated row in dry-run without mutating anything (dry-run is the default)", async () => {
    const fabricated = fabricatedTransferPair("02");
    const { client, transfers, updateCalls } = createMockClient({
      transfers: [fabricated.transfer],
      logs: [fabricated.log],
    });

    // No apply flag at all — the default must be a pure read.
    const report = await repairFabricatedTokenTransfers({ chainId: 369 }, client);

    expect(report.apply).toBe(false);
    expect(report.provenFabricatedTransfers).toBe(1);
    expect(report.changedTransfers).toBe(0);
    expect(report.fabricated).toEqual([
      {
        transferId: fabricated.transfer.id,
        rawLogId: fabricated.log.id,
        chainId: 369,
        txHash: fabricated.transfer.txHash,
        logIndex: 40,
        blockHash: fabricated.transfer.blockHash,
      },
    ]);
    expect(transfers[0].status).toBe("ACTIVE");
    expect(updateCalls).toEqual([]);
  });

  it("marks a proven fabricated row REORGED in apply mode using the ACTIVE guard", async () => {
    const fabricated = fabricatedTransferPair("03");
    const { client, transfers, updateCalls } = createMockClient({
      transfers: [fabricated.transfer],
      logs: [fabricated.log],
    });

    const report = await repairFabricatedTokenTransfers(
      { apply: true, chainId: 369 },
      client,
    );

    expect(report.provenFabricatedTransfers).toBe(1);
    expect(report.changedTransfers).toBe(1);
    expect(transfers[0].status).toBe("REORGED");
    expect(updateCalls).toEqual([
      {
        where: { id: { in: [fabricated.transfer.id] }, status: "ACTIVE" },
        data: { status: "REORGED" },
      },
    ]);
  });

  it("treats a null topic0 as definitively not an ERC-20 Transfer", async () => {
    const fabricated = fabricatedTransferPair("04");
    fabricated.log.topic0 = null;
    const { client, transfers } = createMockClient({
      transfers: [fabricated.transfer],
      logs: [fabricated.log],
    });

    const report = await repairFabricatedTokenTransfers(
      { apply: true, chainId: 369 },
      client,
    );

    expect(report.provenFabricatedTransfers).toBe(1);
    expect(transfers[0].status).toBe("REORGED");
  });

  it("skips a transfer whose backing RawLog is missing, without mutation", async () => {
    const fabricated = fabricatedTransferPair("05");
    const { client, transfers, updateCalls } = createMockClient({
      transfers: [fabricated.transfer],
      logs: [],
    });

    const report = await repairFabricatedTokenTransfers(
      { apply: true, chainId: 369 },
      client,
    );

    expect(report.missingBackingLog).toBe(1);
    expect(report.provenFabricatedTransfers).toBe(0);
    expect(report.changedTransfers).toBe(0);
    expect(report.skipped).toEqual([
      expect.objectContaining({
        transferId: fabricated.transfer.id,
        reason: "missing-backing-log",
      }),
    ]);
    expect(transfers[0].status).toBe("ACTIVE");
    expect(updateCalls).toEqual([]);
  });

  it("does not match a RawLog whose blockHash differs — identity is the full 4-field tuple", async () => {
    const fabricated = fabricatedTransferPair("06");
    fabricated.log.blockHash =
      "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee06";
    const { client, transfers } = createMockClient({
      transfers: [fabricated.transfer],
      logs: [fabricated.log],
    });

    const report = await repairFabricatedTokenTransfers(
      { apply: true, chainId: 369 },
      client,
    );

    expect(report.missingBackingLog).toBe(1);
    expect(report.changedTransfers).toBe(0);
    expect(transfers[0].status).toBe("ACTIVE");
  });

  it("does not match a RawLog whose chainId differs", async () => {
    const fabricated = fabricatedTransferPair("07");
    fabricated.log.chainId = 1;
    const { client, transfers } = createMockClient({
      transfers: [fabricated.transfer],
      logs: [fabricated.log],
    });

    const report = await repairFabricatedTokenTransfers(
      { apply: true, chainId: 369 },
      client,
    );

    expect(report.missingBackingLog).toBe(1);
    expect(transfers[0].status).toBe("ACTIVE");
  });

  it("skips a transfer whose backing RawLog is REORGED — an inactive log is not proof", async () => {
    const fabricated = fabricatedTransferPair("08");
    fabricated.log.status = "REORGED";
    const { client, transfers, updateCalls } = createMockClient({
      transfers: [fabricated.transfer],
      logs: [fabricated.log],
    });

    const report = await repairFabricatedTokenTransfers(
      { apply: true, chainId: 369 },
      client,
    );

    expect(report.inactiveBackingLog).toBe(1);
    expect(report.provenFabricatedTransfers).toBe(0);
    expect(report.changedTransfers).toBe(0);
    expect(report.skipped).toEqual([
      expect.objectContaining({
        transferId: fabricated.transfer.id,
        reason: "inactive-backing-log",
      }),
    ]);
    expect(transfers[0].status).toBe("ACTIVE");
    expect(updateCalls).toEqual([]);
  });

  it("skips a transfer whose identity matches more than one RawLog", async () => {
    const fabricated = fabricatedTransferPair("09");
    const duplicate: MockLog = { ...fabricated.log, id: "log_duplicate_09" };
    const { client, transfers } = createMockClient({
      transfers: [fabricated.transfer],
      logs: [fabricated.log, duplicate],
    });

    const report = await repairFabricatedTokenTransfers(
      { apply: true, chainId: 369 },
      client,
    );

    expect(report.ambiguousIdentity).toBe(1);
    expect(report.changedTransfers).toBe(0);
    expect(transfers[0].status).toBe("ACTIVE");
  });

  it("changes only provably fabricated rows in a mixed set", async () => {
    const genuine = genuineTransferPair("10");
    const fabricated = fabricatedTransferPair("11");
    const missing = fabricatedTransferPair("12");
    const { client, transfers } = createMockClient({
      transfers: [genuine.transfer, fabricated.transfer, missing.transfer],
      logs: [genuine.log, fabricated.log],
    });

    const report = await repairFabricatedTokenTransfers(
      { apply: true, chainId: 369 },
      client,
    );

    expect(report.scannedActiveTransfers).toBe(3);
    expect(report.genuineTransfers).toBe(1);
    expect(report.provenFabricatedTransfers).toBe(1);
    expect(report.missingBackingLog).toBe(1);
    expect(report.changedTransfers).toBe(1);

    const byId = new Map(transfers.map((transfer) => [transfer.id, transfer.status]));
    expect(byId.get(genuine.transfer.id)).toBe("ACTIVE");
    expect(byId.get(fabricated.transfer.id)).toBe("REORGED");
    expect(byId.get(missing.transfer.id)).toBe("ACTIVE");
  });

  it("is idempotent: a second apply run scans nothing and changes zero rows", async () => {
    const fabricated = fabricatedTransferPair("13");
    const { client, transfers } = createMockClient({
      transfers: [fabricated.transfer],
      logs: [fabricated.log],
    });

    const first = await repairFabricatedTokenTransfers(
      { apply: true, chainId: 369 },
      client,
    );
    const second = await repairFabricatedTokenTransfers(
      { apply: true, chainId: 369 },
      client,
    );

    expect(first.changedTransfers).toBe(1);
    expect(second.scannedActiveTransfers).toBe(0);
    expect(second.provenFabricatedTransfers).toBe(0);
    expect(second.changedTransfers).toBe(0);
    expect(transfers[0].status).toBe("REORGED");
  });

  it("targets only the exact identity in identity mode, leaving other fabricated rows untouched", async () => {
    const target = fabricatedTransferPair("14");
    const untouched = fabricatedTransferPair("15");
    const { client, transfers } = createMockClient({
      transfers: [target.transfer, untouched.transfer],
      logs: [target.log, untouched.log],
    });

    const report = await repairFabricatedTokenTransfers(
      {
        apply: true,
        chainId: 369,
        identity: {
          txHash: target.transfer.txHash,
          logIndex: target.transfer.logIndex,
          blockHash: target.transfer.blockHash,
        },
      },
      client,
    );

    expect(report.scannedActiveTransfers).toBe(1);
    expect(report.provenFabricatedTransfers).toBe(1);
    expect(report.changedTransfers).toBe(1);

    const byId = new Map(transfers.map((transfer) => [transfer.id, transfer.status]));
    expect(byId.get(target.transfer.id)).toBe("REORGED");
    expect(byId.get(untouched.transfer.id)).toBe("ACTIVE");
  });

  it("reports an already-invalidated identity-mode target and changes nothing on re-run", async () => {
    const target = fabricatedTransferPair("16");
    const { client, transfers } = createMockClient({
      transfers: [target.transfer],
      logs: [target.log],
    });

    const identityArgs = {
      apply: true,
      chainId: 369,
      identity: {
        txHash: target.transfer.txHash,
        logIndex: target.transfer.logIndex,
        blockHash: target.transfer.blockHash,
      },
    };

    const first = await repairFabricatedTokenTransfers(identityArgs, client);
    const second = await repairFabricatedTokenTransfers(identityArgs, client);

    expect(first.changedTransfers).toBe(1);
    expect(first.alreadyInvalidatedTransfers).toBe(0);
    expect(second.scannedActiveTransfers).toBe(0);
    expect(second.changedTransfers).toBe(0);
    expect(second.alreadyInvalidatedTransfers).toBe(1);
    expect(transfers[0].status).toBe("REORGED");
  });

  it("reports the actual update count when it differs from the candidate count", async () => {
    const fabricatedA = fabricatedTransferPair("17");
    const fabricatedB = fabricatedTransferPair("18");
    const { client } = createMockClient({
      transfers: [fabricatedA.transfer, fabricatedB.transfer],
      logs: [fabricatedA.log, fabricatedB.log],
    });

    // Simulate a row invalidated between scan and update: the update result
    // reports fewer rows than the candidate list.
    const racingClient: FabricatedTransferRepairClient = {
      rawTokenTransfer: {
        findMany: (args: unknown) => client.rawTokenTransfer.findMany(args),
        updateMany: async () => ({ count: 1 }),
      },
      rawLog: client.rawLog,
    };

    const report = await repairFabricatedTokenTransfers(
      { apply: true, chainId: 369 },
      racingClient,
    );

    expect(report.provenFabricatedTransfers).toBe(2);
    expect(report.changedTransfers).toBe(1);
  });

  it("paginates the scan with a stable id cursor", async () => {
    const pairs = ["19", "20", "21"].map((suffix) => fabricatedTransferPair(suffix));
    const { client, transfers } = createMockClient({
      transfers: pairs.map((pair) => pair.transfer),
      logs: pairs.map((pair) => pair.log),
    });

    const report = await repairFabricatedTokenTransfers(
      { apply: true, chainId: 369, batchSize: 1 },
      client,
    );

    expect(report.scannedActiveTransfers).toBe(3);
    expect(report.provenFabricatedTransfers).toBe(3);
    expect(report.changedTransfers).toBe(3);
    expect(transfers.every((transfer) => transfer.status === "REORGED")).toBe(true);
  });

  it("refuses apply mode without an explicit chainId scope", async () => {
    const { client } = createMockClient({ transfers: [], logs: [] });

    await expect(
      repairFabricatedTokenTransfers({ apply: true }, client),
    ).rejects.toThrow(/apply mode requires an explicit chainId scope/);
  });

  it("refuses identity targeting without chainId", async () => {
    const { client } = createMockClient({ transfers: [], logs: [] });

    await expect(
      repairFabricatedTokenTransfers(
        {
          identity: { txHash: "0xabc", logIndex: 1, blockHash: "0xdef" },
        },
        client,
      ),
    ).rejects.toThrow(/requires chainId/);
  });

  it("refuses partial identity targeting", async () => {
    const { client } = createMockClient({ transfers: [], logs: [] });

    await expect(
      repairFabricatedTokenTransfers(
        {
          chainId: 369,
          identity: {
            txHash: "0xabc",
            logIndex: Number.NaN,
            blockHash: "0xdef",
          },
        },
        client,
      ),
    ).rejects.toThrow(/partial identity is ambiguous/);
  });

  it("excludes invalidated rows from the wallet transfer reader while valid rows continue to flow", async () => {
    const genuine = genuineTransferPair("22");
    const fabricated = fabricatedTransferPair("23");
    // Same wallet on both rows so the reader would return both if ACTIVE.
    fabricated.transfer.fromAddress = genuine.transfer.fromAddress;
    fabricated.transfer.blockNumber = 100n;

    const { client, transfers } = createMockClient({
      transfers: [genuine.transfer, fabricated.transfer],
      logs: [genuine.log, fabricated.log],
    });

    await repairFabricatedTokenTransfers({ apply: true, chainId: 369 }, client);

    // Faithful mock of the production reader query: status ACTIVE + wallet OR.
    const readerRows = await readWalletTransferRawTokenTransfers(
      {
        chainId: 369,
        walletAddress: genuine.transfer.fromAddress,
        fromBlock: 0n,
        toBlock: 1_000n,
      },
      {
        rawTokenTransfer: {
          findMany: async (argsUnknown: unknown) => {
            const args = argsUnknown as {
              where: {
                chainId: number;
                status: string;
                blockNumber: { gte: bigint; lte: bigint };
                OR: Array<{ fromAddress?: string; toAddress?: string }>;
              };
            };
            return transfers.filter(
              (transfer) =>
                transfer.chainId === args.where.chainId &&
                transfer.status === args.where.status &&
                transfer.blockNumber >= args.where.blockNumber.gte &&
                transfer.blockNumber <= args.where.blockNumber.lte &&
                (transfer.fromAddress === args.where.OR[0]?.fromAddress ||
                  transfer.toAddress === args.where.OR[1]?.toAddress),
            ) as unknown as Array<Record<string, unknown>>;
          },
        },
      } as never,
    );

    expect(readerRows).toHaveLength(1);
    expect(readerRows[0].txHash).toBe(genuine.transfer.txHash);
  });
});

describe("repair-fabricated-token-transfers CLI parsing", () => {
  const VALID_TX =
    "0xaebd01a664efd36c04b37f4e1d0c25f2878f5936d02f490b3dffb7e88f50a006";
  const VALID_BLOCK =
    "0x96484e3dbf65a76935f7dfd32e21e5d22267d58c54421c451094c8609ba4befe";

  it("defaults to dry-run with no flags", () => {
    const result = parseRepairCliArgs([]);
    expect(result).toEqual({ ok: true, options: { apply: false } });
  });

  it("hard-fails --apply without --chain-id before any DB access", () => {
    const result = parseRepairCliArgs(["--apply"]);
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("--apply requires --chain-id"),
    });
  });

  it("accepts a chain-scoped apply", () => {
    const result = parseRepairCliArgs(["--chain-id", "369", "--apply"]);
    expect(result).toEqual({
      ok: true,
      options: { apply: true, chainId: 369 },
    });
  });

  it("hard-fails partial identity flags", () => {
    const result = parseRepairCliArgs([
      "--chain-id",
      "369",
      "--tx-hash",
      VALID_TX,
    ]);
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("Partial identity targeting is ambiguous"),
    });
  });

  it("hard-fails identity flags without --chain-id", () => {
    const result = parseRepairCliArgs([
      "--tx-hash",
      VALID_TX,
      "--log-index",
      "40",
      "--block-hash",
      VALID_BLOCK,
    ]);
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("requires --chain-id"),
    });
  });

  it("accepts a full exact identity and lowercases the hashes", () => {
    const result = parseRepairCliArgs([
      "--chain-id",
      "369",
      "--tx-hash",
      VALID_TX.toUpperCase().replace("0X", "0x"),
      "--log-index",
      "40",
      "--block-hash",
      VALID_BLOCK,
      "--apply",
    ]);
    expect(result).toEqual({
      ok: true,
      options: {
        apply: true,
        chainId: 369,
        identity: {
          txHash: VALID_TX,
          logIndex: 40,
          blockHash: VALID_BLOCK,
        },
      },
    });
  });

  it("rejects malformed hashes, bad numbers, and unknown flags", () => {
    expect(parseRepairCliArgs(["--tx-hash", "0x123"]).ok).toBe(false);
    expect(parseRepairCliArgs(["--block-hash", "nothex"]).ok).toBe(false);
    expect(parseRepairCliArgs(["--chain-id", "abc"]).ok).toBe(false);
    expect(parseRepairCliArgs(["--chain-id", "-1"]).ok).toBe(false);
    expect(parseRepairCliArgs(["--log-index", "-2"]).ok).toBe(false);
    expect(parseRepairCliArgs(["--frobnicate"]).ok).toBe(false);
  });

  it("requires DATABASE_URL and REDIS_URL without printing their values", () => {
    expect(checkEnv({})).toEqual({
      ok: false,
      missing: ["DATABASE_URL", "REDIS_URL"],
    });
    expect(
      checkEnv({ DATABASE_URL: "postgres://x", REDIS_URL: "redis://y" }),
    ).toEqual({ ok: true });
  });
});
