import { describe, expect, it, vi } from "vitest";

import {
  capStructuredWarnings,
  capWarningDetails,
  createPrismaSyncRunStore,
  mergeCursorWindow,
  WARNING_DETAIL_LIMIT,
} from "@/services/sync/sync-state-store";
import { SYNC_WARNING_CODES, type SyncWarning } from "@/services/sync/sync-warning-codes";

describe("capWarningDetails", () => {
  it("passes through arrays within the limit unchanged", () => {
    const warnings = Array.from({ length: WARNING_DETAIL_LIMIT }, (_, i) => `warning-${i}`);
    const result = capWarningDetails(warnings);
    expect(result).toHaveLength(WARNING_DETAIL_LIMIT);
    expect(result[0]).toBe("warning-0");
    expect(result[WARNING_DETAIL_LIMIT - 1]).toBe(`warning-${WARNING_DETAIL_LIMIT - 1}`);
  });

  it("caps at WARNING_DETAIL_LIMIT and appends a truncation sentinel", () => {
    const warnings = Array.from({ length: WARNING_DETAIL_LIMIT + 5 }, (_, i) => `w-${i}`);
    const result = capWarningDetails(warnings);
    expect(result).toHaveLength(WARNING_DETAIL_LIMIT + 1);
    expect(result[WARNING_DETAIL_LIMIT]).toBe("[truncated: 5 additional warnings not stored]");
  });

  it("uses singular form when exactly 1 entry is omitted", () => {
    const warnings = Array.from({ length: WARNING_DETAIL_LIMIT + 1 }, (_, i) => `w-${i}`);
    const result = capWarningDetails(warnings);
    expect(result[WARNING_DETAIL_LIMIT]).toBe("[truncated: 1 additional warning not stored]");
  });

  it("returns a copy — does not mutate the input array", () => {
    const warnings = ["a", "b"];
    const result = capWarningDetails(warnings);
    result.push("c");
    expect(warnings).toHaveLength(2);
  });

  it("handles an empty array", () => {
    expect(capWarningDetails([])).toEqual([]);
  });
});

describe("capStructuredWarnings", () => {
  function warning(index: number): SyncWarning {
    return { code: SYNC_WARNING_CODES.UNKNOWN, detail: `warning-${index}` };
  }

  it("passes through arrays within the limit unchanged, with truncatedCount 0", () => {
    const warnings = Array.from({ length: WARNING_DETAIL_LIMIT }, (_, i) => warning(i));
    const result = capStructuredWarnings(warnings);
    expect(result.truncatedCount).toBe(0);
    expect(result.warnings).toHaveLength(WARNING_DETAIL_LIMIT);
    expect(result.warnings[0]).toEqual(warning(0));
    expect(result.warnings[WARNING_DETAIL_LIMIT - 1]).toEqual(warning(WARNING_DETAIL_LIMIT - 1));
  });

  it("retains exactly the first WARNING_DETAIL_LIMIT entries and reports the remainder as truncatedCount", () => {
    const warnings = Array.from({ length: WARNING_DETAIL_LIMIT + 5 }, (_, i) => warning(i));
    const result = capStructuredWarnings(warnings);
    expect(result.warnings).toHaveLength(WARNING_DETAIL_LIMIT);
    expect(result.truncatedCount).toBe(5);
    // Retained entries preserve their exact code/detail correspondence, in
    // order — no synthetic entry is ever appended to `warnings`.
    expect(result.warnings[WARNING_DETAIL_LIMIT - 1]).toEqual(warning(WARNING_DETAIL_LIMIT - 1));
    for (const entry of result.warnings) {
      expect(entry.code).not.toBe("[truncated]");
    }
  });

  it("never assigns RAW_BLOCKS_ALREADY_PERSISTED to the truncation boundary — truncation is metadata, not a warning entry", () => {
    const warnings = [
      { code: SYNC_WARNING_CODES.RAW_BLOCKS_ALREADY_PERSISTED, detail: "some raw blocks were already persisted for this range" },
      ...Array.from({ length: WARNING_DETAIL_LIMIT + 3 }, (_, i) => warning(i)),
    ];
    const result = capStructuredWarnings(warnings);
    expect(result.truncatedCount).toBe(warnings.length - WARNING_DETAIL_LIMIT);
    // The truncation count is a plain number, never a fabricated SyncWarning
    // object, so it can never be mistaken for a semantic warning of any code.
    expect(typeof result.truncatedCount).toBe("number");
    expect(result.warnings[0].code).toBe(SYNC_WARNING_CODES.RAW_BLOCKS_ALREADY_PERSISTED);
  });

  it("handles an empty array", () => {
    expect(capStructuredWarnings([])).toEqual({ warnings: [], truncatedCount: 0 });
  });

  it("returns a copy — does not mutate the input array", () => {
    const warnings = [warning(0), warning(1)];
    const result = capStructuredWarnings(warnings);
    result.warnings.push(warning(2));
    expect(warnings).toHaveLength(2);
  });
});

describe("createPrismaSyncRunStore structured warning persistence", () => {
  function createFakePrismaClient() {
    const creates: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    return {
      syncRun: {
        create: vi.fn(async (args: { data: Record<string, unknown> }) => {
          creates.push(args.data);
          return { id: "run_1" };
        }),
        update: vi.fn(async (args: { data: Record<string, unknown> }) => {
          updates.push(args.data);
        }),
      },
      creates,
      updates,
    };
  }

  it("persists an empty structured payload (never null) for a fresh no-warning run", async () => {
    const client = createFakePrismaClient();
    const store = createPrismaSyncRunStore(client as never);

    await store.createRun({
      walletId: "wallet_1",
      chainId: 369,
      trigger: "MANUAL",
      status: "PENDING",
      stage: "PENDING",
      sourceFamilies: ["TRANSFERS"],
      startBlock: 1n,
      endBlock: 10n,
      policyLabel: "test",
    });

    expect(client.creates[0].structuredWarnings).toEqual({ warnings: [], truncatedCount: 0 });
  });

  it("caps and persists structuredWarnings on createRun", async () => {
    const client = createFakePrismaClient();
    const store = createPrismaSyncRunStore(client as never);
    const warnings: SyncWarning[] = [
      { code: SYNC_WARNING_CODES.RAW_BLOCKS_ALREADY_PERSISTED, detail: "some raw blocks were already persisted for this range" },
    ];

    await store.createRun({
      walletId: "wallet_1",
      chainId: 369,
      trigger: "MANUAL",
      status: "PENDING",
      stage: "PENDING",
      sourceFamilies: ["TRANSFERS"],
      startBlock: 1n,
      endBlock: 10n,
      policyLabel: "test",
      warningCount: 1,
      warningDetails: ["some raw blocks were already persisted for this range"],
      structuredWarnings: warnings,
    });

    expect(client.creates[0].structuredWarnings).toEqual({
      warnings,
      truncatedCount: 0,
    });
  });

  it("caps and persists structuredWarnings on updateRun, and leaves the column untouched when omitted", async () => {
    const client = createFakePrismaClient();
    const store = createPrismaSyncRunStore(client as never);

    await store.updateRun({
      runId: "run_1",
      status: "RUNNING",
      warningCount: 1,
      warningDetails: ["skip-dex:0xabc:unsupported-initiator"],
      structuredWarnings: [
        { code: SYNC_WARNING_CODES.UNKNOWN, detail: "skip-dex:0xabc:unsupported-initiator" },
      ],
    });

    expect(client.updates[0].structuredWarnings).toEqual({
      warnings: [{ code: "UNKNOWN", detail: "skip-dex:0xabc:unsupported-initiator" }],
      truncatedCount: 0,
    });

    await store.updateRun({ runId: "run_1", status: "COMPLETED" });

    expect(client.updates[1].structuredWarnings).toBeUndefined();
  });

  it("A1: derives UNKNOWN structured entries from warningDetails when structuredWarnings is omitted — never a false empty classification", async () => {
    const client = createFakePrismaClient();
    const store = createPrismaSyncRunStore(client as never);
    const warningDetails = ["skip-dex:0xabc:unsupported-initiator", "skip-lp:0xdef:unknown-pool"];

    await store.createRun({
      walletId: "wallet_1",
      chainId: 369,
      trigger: "MANUAL",
      status: "PENDING",
      stage: "PENDING",
      sourceFamilies: ["TRANSFERS"],
      startBlock: 1n,
      endBlock: 10n,
      policyLabel: "test",
      warningCount: 2,
      warningDetails,
      // structuredWarnings intentionally omitted.
    });

    const persisted = client.creates[0].structuredWarnings as {
      warnings: SyncWarning[];
      truncatedCount: number;
    };

    // MANDATORY INVARIANT: warningCount > 0 + non-empty warningDetails must
    // never be paired with a known-empty structured payload.
    expect(persisted).not.toEqual({ warnings: [], truncatedCount: 0 });
    expect(persisted.truncatedCount).toBe(0);
    expect(persisted.warnings).toEqual(
      warningDetails.map((detail) => ({ code: SYNC_WARNING_CODES.UNKNOWN, detail })),
    );
  });

  it("A2: a fresh run with no warnings and omitted structuredWarnings still persists an explicit known-zero classification", async () => {
    const client = createFakePrismaClient();
    const store = createPrismaSyncRunStore(client as never);

    await store.createRun({
      walletId: "wallet_1",
      chainId: 369,
      trigger: "MANUAL",
      status: "PENDING",
      stage: "PENDING",
      sourceFamilies: ["TRANSFERS"],
      startBlock: 1n,
      endBlock: 10n,
      policyLabel: "test",
      warningCount: 0,
      warningDetails: [],
    });

    expect(client.creates[0].structuredWarnings).toEqual({ warnings: [], truncatedCount: 0 });
  });

  it("A3: derived UNKNOWN entries are truncation-safe beyond WARNING_DETAIL_LIMIT and never fabricate the legacy truncation sentinel as a warning", async () => {
    const client = createFakePrismaClient();
    const store = createPrismaSyncRunStore(client as never);
    const warningDetails = Array.from(
      { length: WARNING_DETAIL_LIMIT + 7 },
      (_, i) => `warning-${i}`,
    );

    await store.createRun({
      walletId: "wallet_1",
      chainId: 369,
      trigger: "MANUAL",
      status: "PENDING",
      stage: "PENDING",
      sourceFamilies: ["TRANSFERS"],
      startBlock: 1n,
      endBlock: 10n,
      policyLabel: "test",
      warningCount: warningDetails.length,
      warningDetails,
      // structuredWarnings intentionally omitted.
    });

    const persisted = client.creates[0].structuredWarnings as {
      warnings: SyncWarning[];
      truncatedCount: number;
    };
    const persistedLegacyDetails = client.creates[0].warningDetails as string[];

    // Retained ordering matches the legacy cap exactly.
    expect(persisted.warnings).toHaveLength(WARNING_DETAIL_LIMIT);
    expect(persisted.warnings[0]).toEqual({ code: SYNC_WARNING_CODES.UNKNOWN, detail: "warning-0" });
    expect(persisted.warnings[WARNING_DETAIL_LIMIT - 1]).toEqual({
      code: SYNC_WARNING_CODES.UNKNOWN,
      detail: `warning-${WARNING_DETAIL_LIMIT - 1}`,
    });
    // truncatedCount correctly represents the omitted real warnings — this
    // is never falsely presented as a complete/zero classification.
    expect(persisted.truncatedCount).toBe(7);
    expect(persisted).not.toEqual({ warnings: [], truncatedCount: 0 });
    // The legacy column's synthetic "[truncated: ...]" sentinel must never
    // become a semantic (UNKNOWN or otherwise) structured warning entry.
    expect(persistedLegacyDetails[WARNING_DETAIL_LIMIT]).toBe(
      "[truncated: 7 additional warnings not stored]",
    );
    expect(persisted.warnings.some((w) => w.detail.startsWith("[truncated"))).toBe(false);
  });
});

describe("mergeCursorWindow", () => {
  it("does not overstate coverage when a later rerun leaves a gap after the current high-water mark", () => {
    expect(
      mergeCursorWindow({
        existing: {
          fromBlock: 0n,
          toBlock: 120n,
          blockHash: "0x120",
        },
        next: {
          fromBlock: 200n,
          toBlock: 250n,
          blockHash: "0x250",
        },
      }),
    ).toEqual({
      fromBlock: 0n,
      toBlock: 120n,
      blockHash: "0x120",
      changed: false,
    });
  });

  it("preserves the high-water mark when rerunning an older historical range", () => {
    expect(
      mergeCursorWindow({
        existing: {
          fromBlock: 0n,
          toBlock: 150n,
          blockHash: "0xnewest",
        },
        next: {
          fromBlock: 50n,
          toBlock: 120n,
          blockHash: "0xolder",
        },
      }),
    ).toEqual({
      fromBlock: 0n,
      toBlock: 150n,
      blockHash: "0xnewest",
      changed: false,
    });
  });

  it("advances the cursor when a later range completes", () => {
    expect(
      mergeCursorWindow({
        existing: {
          fromBlock: 0n,
          toBlock: 120n,
          blockHash: "0xold",
        },
        next: {
          fromBlock: 121n,
          toBlock: 150n,
          blockHash: "0xnew",
        },
      }),
    ).toEqual({
      fromBlock: 0n,
      toBlock: 150n,
      blockHash: "0xnew",
      changed: true,
    });
  });

  it("preserves the existing high-water hash when a rerun ends at the same block", () => {
    expect(
      mergeCursorWindow({
        existing: {
          fromBlock: 0n,
          toBlock: 150n,
          blockHash: "0xexisting",
        },
        next: {
          fromBlock: 100n,
          toBlock: 150n,
          blockHash: "0xreplacement",
        },
      }),
    ).toEqual({
      fromBlock: 0n,
      toBlock: 150n,
      blockHash: "0xexisting",
      changed: false,
    });
  });
});
