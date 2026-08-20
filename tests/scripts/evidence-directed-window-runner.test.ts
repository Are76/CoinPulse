// Evidence-directed multi-family historical window runner — focused unit
// tests. All DB, HTTP, and RPC dependencies are mocked/injected. No live
// calls. No real POST or window execution happens anywhere in this file.

import { describe, expect, it, vi } from "vitest";

import { PULSECHAIN_FORK_BOUNDARY } from "@/config/chains";
import { MANUAL_SYNC_MAX_BLOCK_SPAN } from "@/services/api/validation";
import { mergeCursorWindow, type SyncCursorRecord } from "@/services/sync/sync-state-store";

import {
  CLEAN_STOP_REASONS,
  HTTP_REQUEST_TIMEOUT_MS,
  MAX_REASON_SLUG_LENGTH,
  POLICY_LABEL_PREFIX,
  WINDOW_CHAIN_ID,
  WINDOW_SOURCE_FAMILIES,
  buildManualSyncRequestBody,
  buildPolicyLabel,
  checkEnv,
  classifyAmbiguousSubmissionRecovery,
  classifyCursorDisconnection,
  computeExitCode,
  cursorsIdentical,
  parseRunnerCliArgs,
  policyLabelExistsForChain,
  runEvidenceDirectedWindowRunner,
  sanitizeBackendResponseBody,
  serializeEvidence,
  slugifyReason,
  validateBlockOrder,
  validateChainId,
  validateCursorDisconnection,
  validateForkBoundary,
  validateNoActiveOperation,
  validateNoPolicyLabelCollision,
  validateRangeSize,
  validateWalletAddress,
  type EvidenceRecord,
  type RunnerCliOptions,
  type RunnerDbClient,
  type RunnerDeps,
  type RunnerSyncRunRecord,
} from "../../scripts/evidence-directed-window-runner";

// ─── Import safety ──────────────────────────────────────────────────────────

describe("import safety", () => {
  it("importing the module does not run main() or mutate process.exitCode", () => {
    expect(process.exitCode).not.toBe(1);
  });
});

// ─── Test fixtures ──────────────────────────────────────────────────────────

const WALLET_ADDRESS = "0x75f808367720951e789d47e9e9db51148d9aa765";
const WALLET_ID = "wallet-cuid-1";
const POST_FORK_START = PULSECHAIN_FORK_BOUNDARY.firstPostForkBlock;
const POST_FORK_END = POST_FORK_START + 999n;
const DEFAULT_POLICY_LABEL = "EVIDENCE_DIRECTED_WINDOW_V1:recover-window-evidence";

function baseRunnerOptions(overrides: Partial<RunnerCliOptions> = {}): RunnerCliOptions {
  return {
    execute: false,
    walletAddress: WALLET_ADDRESS,
    chainId: WINDOW_CHAIN_ID,
    startBlock: POST_FORK_START,
    endBlock: POST_FORK_END,
    reason: "recover window evidence",
    baseUrl: "http://localhost:3100",
    evidenceDir: "unused-in-tests",
    pollIntervalMs: 1,
    pollTimeoutMs: 1000,
    ...overrides,
  };
}

type CursorFixture = { fromBlock: bigint; toBlock: bigint } | null;

function makeFakeDb(overrides: Partial<{
  cursorsByFamily: Partial<Record<(typeof WINDOW_SOURCE_FAMILIES)[number], CursorFixture>>;
  policyLabelExists: boolean;
  policyLabelCandidates: RunnerSyncRunRecord[];
  activeRunCount: number;
  runsById: Record<string, RunnerSyncRunRecord>;
}> = {}): RunnerDbClient {
  const state = {
    cursorsByFamily: overrides.cursorsByFamily ?? {},
    policyLabelExists: overrides.policyLabelExists ?? false,
    policyLabelCandidates: overrides.policyLabelCandidates ?? [],
    activeRunCount: overrides.activeRunCount ?? 0,
    runsById: overrides.runsById ?? {},
  };

  return {
    syncCursor: {
      findUnique: async (args: unknown) => {
        const where = (args as { where: { walletId_chainId_sourceFamily: { sourceFamily: string } } }).where;
        const family = where.walletId_chainId_sourceFamily.sourceFamily as (typeof WINDOW_SOURCE_FAMILIES)[number];
        const cursor = state.cursorsByFamily[family];
        return cursor ? { ...cursor, blockHash: "0xblockhash" } : null;
      },
    },
    syncRun: {
      // Only used by findSyncRunsByPolicyLabel (ambiguous-submission recovery).
      findMany: async () => state.policyLabelCandidates,
      findUnique: async (args: unknown) => {
        const id = (args as { where: { id: string } }).where.id;
        return state.runsById[id] ?? null;
      },
      // Serves two distinct real call sites: countActiveOperations
      // (where.status.in) and policyLabelExistsForChain (where.policyLabel).
      count: async (args: unknown) => {
        const where = (args as { where?: { status?: { in?: string[] }; policyLabel?: string } }).where;
        if (where?.status?.in) {
          return state.activeRunCount;
        }
        if (where?.policyLabel !== undefined) {
          return state.policyLabelExists ? 1 : 0;
        }
        return 0;
      },
    },
  };
}

function makeFakeDeps(args: {
  db: RunnerDbClient;
  httpPost?: RunnerDeps["httpPost"];
  clockStart?: number;
  walletFound?: boolean;
}): { deps: RunnerDeps; evidence: EvidenceRecord[]; httpPostCalls: Array<{ url: string; body: unknown }> } {
  const evidence: EvidenceRecord[] = [];
  const httpPostCalls: Array<{ url: string; body: unknown }> = [];
  let clock = args.clockStart ?? 0;

  const defaultHttpPost: RunnerDeps["httpPost"] = async (url, body) => {
    httpPostCalls.push({ url, body });
    return { status: 202, body: { data: { runId: "run-1" } } };
  };

  const deps: RunnerDeps = {
    db: args.db,
    resolveWallet: async () => (args.walletFound === false ? null : { id: WALLET_ID, address: WALLET_ADDRESS }),
    httpGet: async () => ({ status: 200, body: { data: { status: "ok" } } }),
    httpPost: args.httpPost ?? defaultHttpPost,
    now: () => new Date(clock),
    sleep: async (ms) => {
      clock += ms;
    },
    writeEvidence: async (record) => {
      evidence.push(record);
    },
  };

  return { deps, evidence, httpPostCalls };
}

// ─── 1. Dry-run is default ──────────────────────────────────────────────────

describe("dry-run default", () => {
  it("defaults execute to false via CLI parsing", () => {
    const parsed = parseRunnerCliArgs([
      "--wallet-address", WALLET_ADDRESS,
      "--chain-id", "369",
      "--start-block", POST_FORK_START.toString(),
      "--end-block", POST_FORK_END.toString(),
      "--reason", "test reason",
    ]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.options.execute).toBe(false);
    }
  });
});

// ─── 2. Dry-run performs no execution/mutation ──────────────────────────────

describe("dry-run mutation safety", () => {
  it("never calls httpPost and reports dry_run_reported", async () => {
    const db = makeFakeDb();
    const { deps, evidence, httpPostCalls } = makeFakeDeps({ db });

    const summary = await runEvidenceDirectedWindowRunner(baseRunnerOptions({ execute: false }), deps);

    expect(summary.stoppedReason).toBe("dry_run_reported");
    expect(httpPostCalls).toHaveLength(0);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].kind).toBe("dry-run");
    expect(evidence[0].executed).toBe(false);
  });
});

// ─── 3. --execute is required for submission ────────────────────────────────

describe("execute gate", () => {
  it("submits exactly one manual sync POST only when execute is true, and completes", async () => {
    const db = makeFakeDb({ runsById: { "run-1": completedRun() } });
    const { deps, httpPostCalls } = makeFakeDeps({ db });

    const summary = await runEvidenceDirectedWindowRunner(baseRunnerOptions({ execute: true }), deps);

    expect(httpPostCalls).toHaveLength(1);
    expect(httpPostCalls[0].url).toBe("http://localhost:3100/api/sync/manual");
    expect(summary.stoppedReason).toBe("execute_completed");
  });
});

// ─── 4. chainId != 369 is rejected ──────────────────────────────────────────

describe("chainId validation", () => {
  it("rejects a non-PulseChain chainId", () => {
    expect(validateChainId(1).ok).toBe(false);
    expect(validateChainId(369).ok).toBe(true);
  });

  it("stops the runner before any DB or HTTP call for a bad chainId", async () => {
    const db = makeFakeDb();
    const { deps, httpPostCalls } = makeFakeDeps({ db });
    const findUniqueSpy = vi.spyOn(db.syncCursor, "findUnique");

    const summary = await runEvidenceDirectedWindowRunner(baseRunnerOptions({ chainId: 1 }), deps);

    expect(summary.stoppedReason).toBe("invalid_chain_id");
    expect(httpPostCalls).toHaveLength(0);
    expect(findUniqueSpy).not.toHaveBeenCalled();
  });
});

// ─── 5. startBlock <= lastInheritedBlock is rejected ────────────────────────

describe("fork boundary — pre-fork rejection", () => {
  it("rejects lastInheritedBlock as a startBlock", () => {
    const gate = validateForkBoundary({ startBlock: PULSECHAIN_FORK_BOUNDARY.lastInheritedBlock });
    expect(gate.ok).toBe(false);
  });

  it("stops the runner in both dry-run and execute mode", async () => {
    for (const execute of [false, true]) {
      const db = makeFakeDb();
      const { deps, httpPostCalls } = makeFakeDeps({ db });
      const summary = await runEvidenceDirectedWindowRunner(
        baseRunnerOptions({
          execute,
          startBlock: PULSECHAIN_FORK_BOUNDARY.lastInheritedBlock,
          endBlock: PULSECHAIN_FORK_BOUNDARY.lastInheritedBlock,
        }),
        deps,
      );
      expect(summary.stoppedReason).toBe("fork_boundary_violation");
      expect(httpPostCalls).toHaveLength(0);
    }
  });
});

// ─── 6. firstPostForkBlock is accepted ──────────────────────────────────────

describe("fork boundary — post-fork acceptance", () => {
  it("accepts firstPostForkBlock as a startBlock", () => {
    const gate = validateForkBoundary({ startBlock: PULSECHAIN_FORK_BOUNDARY.firstPostForkBlock });
    expect(gate.ok).toBe(true);
  });
});

// ─── 7. startBlock > endBlock rejected ──────────────────────────────────────

describe("block order validation", () => {
  it("rejects an inverted range", () => {
    const gate = validateBlockOrder({ startBlock: 200n, endBlock: 100n });
    expect(gate.ok).toBe(false);
  });

  it("accepts startBlock === endBlock", () => {
    const gate = validateBlockOrder({ startBlock: 100n, endBlock: 100n });
    expect(gate.ok).toBe(true);
  });
});

// ─── 8. oversized range rejected ────────────────────────────────────────────

describe("range size validation", () => {
  it("rejects a span larger than MANUAL_SYNC_MAX_BLOCK_SPAN", () => {
    const gate = validateRangeSize({
      startBlock: POST_FORK_START,
      endBlock: POST_FORK_START + MANUAL_SYNC_MAX_BLOCK_SPAN + 1n,
    });
    expect(gate.ok).toBe(false);
  });

  it("accepts a span exactly at MANUAL_SYNC_MAX_BLOCK_SPAN", () => {
    const gate = validateRangeSize({
      startBlock: POST_FORK_START,
      endBlock: POST_FORK_START + MANUAL_SYNC_MAX_BLOCK_SPAN,
    });
    expect(gate.ok).toBe(true);
  });

  it("never increases the existing manual-sync limit", () => {
    expect(MANUAL_SYNC_MAX_BLOCK_SPAN).toBe(1_000n);
  });
});

// ─── 9. empty/malformed reason rejected ─────────────────────────────────────

describe("reason sanitization", () => {
  it("rejects a reason that sanitizes to empty", () => {
    expect(slugifyReason("")).toBeNull();
    expect(slugifyReason("   ")).toBeNull();
    expect(slugifyReason("!!!###")).toBeNull();
  });

  it("buildPolicyLabel fails closed for an empty reason", () => {
    const result = buildPolicyLabel("");
    expect(result.ok).toBe(false);
  });
});

// ─── 10. valid reason produces exact deterministic policyLabel ─────────────

describe("policyLabel determinism", () => {
  it("produces the exact EVIDENCE_DIRECTED_WINDOW_V1:<slug> format", () => {
    const result = buildPolicyLabel("Recover Window 65 Evidence!!");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.policyLabel).toBe("EVIDENCE_DIRECTED_WINDOW_V1:recover-window-65-evidence");
    }
  });

  it("is deterministic across repeated calls with the same reason", () => {
    const a = buildPolicyLabel("same reason text");
    const b = buildPolicyLabel("same reason text");
    expect(a).toEqual(b);
  });

  it("collapses whitespace/separators and bounds slug length", () => {
    const longReason = "a".repeat(500);
    const result = buildPolicyLabel(longReason);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.slug.length).toBeLessThanOrEqual(MAX_REASON_SLUG_LENGTH);
    }
  });
});

// ─── 11. policyLabel prefix cannot be overridden by operator input ──────────

describe("policyLabel prefix immutability", () => {
  it("always begins with the fixed prefix regardless of reason content", () => {
    const attempts = [
      "EVIDENCE_DIRECTED_WINDOW_V2:hijack",
      "normal reason",
      "../../etc/passwd",
    ];
    for (const reason of attempts) {
      const result = buildPolicyLabel(reason);
      if (result.ok) {
        expect(result.policyLabel.startsWith(POLICY_LABEL_PREFIX)).toBe(true);
        // Exactly one occurrence of the prefix marker, at the start only.
        expect(result.policyLabel.indexOf(POLICY_LABEL_PREFIX)).toBe(0);
      }
    }
  });

  it("CLI parsing has no flag through which sourceFamilies or the prefix can be overridden", () => {
    const parsed = parseRunnerCliArgs(["--source-families", "TRANSFERS"]);
    expect(parsed.ok).toBe(false);
  });
});

// ─── 12 & 13. sourceFamilies fixed, submitted payload always exact 4 ────────

describe("fixed source-family policy", () => {
  it("WINDOW_SOURCE_FAMILIES is exactly the four approved families", () => {
    expect(WINDOW_SOURCE_FAMILIES).toEqual(["TRANSFERS", "DEX", "LP", "STAKING"]);
  });

  it("buildManualSyncRequestBody always submits exactly the fixed four families", () => {
    const body = buildManualSyncRequestBody({
      walletAddress: WALLET_ADDRESS,
      startBlock: POST_FORK_START,
      endBlock: POST_FORK_END,
      policyLabel: "EVIDENCE_DIRECTED_WINDOW_V1:test",
    });
    expect(body.sourceFamilies).toEqual(["TRANSFERS", "DEX", "LP", "STAKING"]);
  });

  it("the submitted execute payload matches the fixed families exactly, and completes", async () => {
    const db = makeFakeDb({ runsById: { "run-1": completedRun() } });
    const { deps, httpPostCalls } = makeFakeDeps({ db });

    const summary = await runEvidenceDirectedWindowRunner(baseRunnerOptions({ execute: true }), deps);

    const body = httpPostCalls[0].body as { sourceFamilies: string[] };
    expect(body.sourceFamilies).toEqual(["TRANSFERS", "DEX", "LP", "STAKING"]);
    expect(summary.stoppedReason).toBe("execute_completed");
  });
});

// ─── 14 & 15. never invokes rebuild/materialization; output states so ──────

describe("materialization contract", () => {
  it("only ever POSTs to /api/sync/manual, never /api/rebuild", async () => {
    const db = makeFakeDb({ runsById: { "run-1": completedRun() } });
    const { deps, httpPostCalls } = makeFakeDeps({ db });

    await runEvidenceDirectedWindowRunner(baseRunnerOptions({ execute: true }), deps);

    for (const call of httpPostCalls) {
      expect(call.url).not.toContain("/api/rebuild");
    }
  });

  it("execute evidence explicitly states portfolio totals were not refreshed", async () => {
    const db = makeFakeDb({
      runsById: {
        "run-1": completedRun(),
      },
    });
    const { deps, evidence } = makeFakeDeps({ db });

    await runEvidenceDirectedWindowRunner(baseRunnerOptions({ execute: true }), deps);

    const executeRecord = evidence.find((e) => e.kind === "execute");
    expect(executeRecord).toBeDefined();
    expect(executeRecord?.portfolioTotalsRefreshed).toBe(false);
    expect(String(executeRecord?.materializationLimitation)).toMatch(/never calls rebuild/i);
  });
});

// ─── 16. output explicitly states reorg detection is not provided ──────────

describe("reorg limitation disclosure", () => {
  it("execute evidence includes the reorg limitation statement", async () => {
    const db = makeFakeDb({ runsById: { "run-1": completedRun() } });
    const { deps, evidence } = makeFakeDeps({ db });

    await runEvidenceDirectedWindowRunner(baseRunnerOptions({ execute: true }), deps);

    const executeRecord = evidence.find((e) => e.kind === "execute");
    expect(String(executeRecord?.reorgLimitation)).toMatch(/not wired into production ingestion/i);
  });
});

// ─── 17. disconnected historical window: cursor byte-identical before/after ─

describe("disconnected window cursor invariant", () => {
  it("reports cursorsBefore per family in dry-run when disconnected from existing coverage", async () => {
    // Existing TRANSFERS coverage sits far above the requested window —
    // genuinely disconnected, mirroring a real evidence-directed gap.
    const db = makeFakeDb({
      cursorsByFamily: {
        TRANSFERS: { fromBlock: POST_FORK_END + 100_000n, toBlock: POST_FORK_END + 101_000n },
      },
    });
    const { deps, evidence } = makeFakeDeps({ db });

    await runEvidenceDirectedWindowRunner(baseRunnerOptions({ execute: false }), deps);

    const record = evidence[0];
    const disconnection = record.disconnectionFromExistingCoverage as Record<string, string>;
    expect(disconnection.TRANSFERS).toBe("disconnected");
    expect(disconnection.DEX).toBe("no_existing_cursor");
  });

  it("classifyCursorDisconnection matches mergeCursorWindow's disconnected-gap definition", () => {
    const cursor = { fromBlock: 100n, toBlock: 200n };
    expect(classifyCursorDisconnection({ cursor, startBlock: 500n, endBlock: 600n })).toBe("disconnected");
    expect(classifyCursorDisconnection({ cursor, startBlock: 50n, endBlock: 90n })).toBe("disconnected");
    expect(classifyCursorDisconnection({ cursor, startBlock: 150n, endBlock: 250n })).toBe("connected");
    expect(classifyCursorDisconnection({ cursor: null, startBlock: 1n, endBlock: 2n })).toBe("no_existing_cursor");
  });

  // Runner-level bridge test against the REAL production mergeCursorWindow
  // (imported directly from src/services/sync/sync-state-store.ts, not
  // reimplemented or mocked here) — this repo has no real-Postgres
  // integration-test harness anywhere (no CI Postgres service, no
  // PrismaClient used in any test file; mergeCursorWindow's own dedicated
  // coverage in tests/services/sync/sync-state-store.test.ts is pure-function
  // unit testing, the established convention this whole suite follows). What
  // this bridge test CAN and does prove: for every window this runner's
  // validateCursorDisconnection gate WOULD allow through to execute
  // ("disconnected" or "no_existing_cursor"), the real mergeCursorWindow
  // either leaves the existing cursor completely untouched (the
  // "disconnected" case) or has no prior cursor to protect at all (the
  // "no_existing_cursor" case) — so the gate can never let an execute-mode
  // submission silently move a cursor. A "connected" window (which the gate
  // always rejects before submission) is deliberately NOT asserted to always
  // mutate the cursor — a window fully inside existing coverage is
  // "connected" too, and mergeCursorWindow correctly treats that as a no-op;
  // the gate still refuses it because it targets no genuine gap.
  it("bridges to the real mergeCursorWindow: every gate-allowed window leaves an existing cursor byte-identical", () => {
    const existing: SyncCursorRecord = { fromBlock: 100n, toBlock: 200n, blockHash: "0xexisting" };
    const disconnectedCases: Array<{ startBlock: bigint; endBlock: bigint; label: string }> = [
      { startBlock: 500n, endBlock: 600n, label: "far forward gap" },
      { startBlock: 10n, endBlock: 90n, label: "far backward gap" },
      { startBlock: 202n, endBlock: 250n, label: "one block beyond forward adjacency" },
      { startBlock: 50n, endBlock: 98n, label: "one block beyond backward adjacency" },
    ];
    const connectedCases: Array<{ startBlock: bigint; endBlock: bigint; label: string }> = [
      { startBlock: 201n, endBlock: 250n, label: "exactly adjacent forward (toBlock + 1)" },
      { startBlock: 50n, endBlock: 99n, label: "exactly adjacent backward (fromBlock - 1)" },
      { startBlock: 150n, endBlock: 250n, label: "overlapping forward" },
      { startBlock: 120n, endBlock: 180n, label: "fully inside existing coverage" },
    ];

    for (const testCase of disconnectedCases) {
      expect(
        classifyCursorDisconnection({ cursor: existing, startBlock: testCase.startBlock, endBlock: testCase.endBlock }),
        testCase.label,
      ).toBe("disconnected");

      const merged = mergeCursorWindow({
        existing,
        next: { fromBlock: testCase.startBlock, toBlock: testCase.endBlock, blockHash: "0xnext" },
      });
      expect(merged.changed, `${testCase.label}: mergeCursorWindow must leave a disconnected cursor unchanged`).toBe(false);
      expect(merged.fromBlock).toBe(existing.fromBlock);
      expect(merged.toBlock).toBe(existing.toBlock);
    }

    for (const testCase of connectedCases) {
      expect(
        classifyCursorDisconnection({ cursor: existing, startBlock: testCase.startBlock, endBlock: testCase.endBlock }),
        testCase.label,
      ).toBe("connected");
    }

    // No existing cursor at all: mergeCursorWindow always adopts `next`
    // (changed: true), which is exactly why validateCursorDisconnection
    // treats "no_existing_cursor" as acceptable for this runner — there is
    // no prior coverage to protect.
    const adopted = mergeCursorWindow({
      existing: null,
      next: { fromBlock: 500n, toBlock: 600n, blockHash: "0xnext" },
    });
    expect(adopted.changed).toBe(true);
    expect(classifyCursorDisconnection({ cursor: null, startBlock: 500n, endBlock: 600n })).toBe(
      "no_existing_cursor",
    );
  });

  it("for a successful execute run, SyncCursor snapshots for all four families remain byte-identical before/after when the underlying store never mutated them (disconnected gap)", async () => {
    const fixedCursor = { TRANSFERS: { fromBlock: 900_000n, toBlock: 901_000n } };
    const db = makeFakeDb({
      cursorsByFamily: fixedCursor,
      runsById: { "run-1": completedRun() },
    });
    const { deps, evidence } = makeFakeDeps({ db });

    await runEvidenceDirectedWindowRunner(baseRunnerOptions({ execute: true }), deps);

    const executeRecord = evidence.find((e) => e.kind === "execute");
    const comparison = executeRecord?.cursorComparison as Record<string, { unchanged: boolean }>;
    for (const family of WINDOW_SOURCE_FAMILIES) {
      expect(comparison[family].unchanged).toBe(true);
    }
  });

  it("cursorsIdentical treats null/null as identical and null/non-null as different", () => {
    expect(cursorsIdentical(null, null)).toBe(true);
    expect(cursorsIdentical(null, { fromBlock: 1n, toBlock: 2n })).toBe(false);
    expect(cursorsIdentical({ fromBlock: 1n, toBlock: 2n }, { fromBlock: 1n, toBlock: 2n })).toBe(true);
    expect(cursorsIdentical({ fromBlock: 1n, toBlock: 2n }, { fromBlock: 1n, toBlock: 3n })).toBe(false);
  });
});

// ─── Connected-window rejection (execute-mode gate) ─────────────────────────

describe("connected-window rejection gate", () => {
  it("validateCursorDisconnection fails when any family's cursor is connected", () => {
    const disconnected = validateCursorDisconnection({
      cursorsBefore: {
        TRANSFERS: { fromBlock: POST_FORK_END + 100_000n, toBlock: POST_FORK_END + 101_000n },
        DEX: null,
        LP: null,
        STAKING: null,
      },
      startBlock: POST_FORK_START,
      endBlock: POST_FORK_END,
    });
    expect(disconnected.ok).toBe(true);

    const connected = validateCursorDisconnection({
      cursorsBefore: {
        TRANSFERS: null,
        DEX: { fromBlock: POST_FORK_START, toBlock: POST_FORK_START + 10n },
        LP: null,
        STAKING: null,
      },
      startBlock: POST_FORK_START,
      endBlock: POST_FORK_END,
    });
    expect(connected.ok).toBe(false);
    if (!connected.ok) {
      expect(connected.reason).toContain("DEX");
    }
  });

  it("refuses to execute when a family's cursor overlaps the requested window, before any POST", async () => {
    const db = makeFakeDb({
      cursorsByFamily: {
        LP: { fromBlock: POST_FORK_START, toBlock: POST_FORK_START + 500n },
      },
    });
    const { deps, httpPostCalls } = makeFakeDeps({ db });

    const summary = await runEvidenceDirectedWindowRunner(baseRunnerOptions({ execute: true }), deps);

    expect(summary.stoppedReason).toBe("window_connected_to_existing_cursor");
    expect(httpPostCalls).toHaveLength(0);
  });

  it("does not block dry-run — the window is only reported, never rejected, in dry-run", async () => {
    const db = makeFakeDb({
      cursorsByFamily: {
        LP: { fromBlock: POST_FORK_START, toBlock: POST_FORK_START + 500n },
      },
    });
    const { deps } = makeFakeDeps({ db });

    const summary = await runEvidenceDirectedWindowRunner(baseRunnerOptions({ execute: false }), deps);

    expect(summary.stoppedReason).toBe("dry_run_reported");
  });
});

// ─── 18. repeated identical execution: only one new SyncRun attempt, ───────
// ─── no duplicate submission for a colliding policyLabel ───────────────────

describe("policy label collision / idempotent-attempt gate", () => {
  it("refuses a second execute submission with the same policyLabel", async () => {
    const db = makeFakeDb({ policyLabelExists: true });
    const { deps, httpPostCalls } = makeFakeDeps({ db });

    const summary = await runEvidenceDirectedWindowRunner(baseRunnerOptions({ execute: true }), deps);

    expect(summary.stoppedReason).toBe("policy_label_collision");
    expect(httpPostCalls).toHaveLength(0);
  });

  it("validateNoPolicyLabelCollision is the pure gate backing this behavior", () => {
    expect(validateNoPolicyLabelCollision({ policyLabel: "x", policyLabelExists: true }).ok).toBe(false);
    expect(validateNoPolicyLabelCollision({ policyLabel: "x", policyLabelExists: false }).ok).toBe(true);
  });
});

// ─── Follow-up C: targeted policyLabel existence lookup ─────────────────────

describe("policyLabelExistsForChain — targeted existence lookup", () => {
  it("queries by the exact (chainId, policyLabel) pair via count, not a full-chain scan", async () => {
    const db = makeFakeDb({ policyLabelExists: true });
    const countSpy = vi.spyOn(db.syncRun, "count");
    const findManySpy = vi.spyOn(db.syncRun, "findMany");

    const exists = await policyLabelExistsForChain(db, { chainId: WINDOW_CHAIN_ID, policyLabel: DEFAULT_POLICY_LABEL });

    expect(exists).toBe(true);
    expect(countSpy).toHaveBeenCalledWith({ where: { chainId: WINDOW_CHAIN_ID, policyLabel: DEFAULT_POLICY_LABEL } });
    expect(findManySpy).not.toHaveBeenCalled();
  });

  it("returns false when no matching SyncRun exists", async () => {
    const db = makeFakeDb({ policyLabelExists: false });
    const exists = await policyLabelExistsForChain(db, { chainId: WINDOW_CHAIN_ID, policyLabel: DEFAULT_POLICY_LABEL });
    expect(exists).toBe(false);
  });
});

// ─── 19. active-operation conflict prevents overlap with in-flight work ────

describe("active operation conflict gate", () => {
  it("refuses to submit while a PENDING/RUNNING SyncRun exists", async () => {
    const db = makeFakeDb({ activeRunCount: 1 });
    const { deps, httpPostCalls } = makeFakeDeps({ db });

    const summary = await runEvidenceDirectedWindowRunner(baseRunnerOptions({ execute: true }), deps);

    expect(summary.stoppedReason).toBe("active_operation_conflict");
    expect(httpPostCalls).toHaveLength(0);
  });

  it("validateNoActiveOperation is the pure gate backing this behavior", () => {
    expect(validateNoActiveOperation({ activeRunCount: 0 }).ok).toBe(true);
    expect(validateNoActiveOperation({ activeRunCount: 2 }).ok).toBe(false);
  });
});

// ─── 20. multi-family mixed transaction: higher-order semantics ────────────
// ─── survive at the request-building layer (no generic-shadow field added) ─

describe("multi-family request shape", () => {
  it("the manual sync request body carries no generic TRANSFER-only fields beyond the documented contract", () => {
    const body = buildManualSyncRequestBody({
      walletAddress: WALLET_ADDRESS,
      startBlock: POST_FORK_START,
      endBlock: POST_FORK_END,
      policyLabel: "EVIDENCE_DIRECTED_WINDOW_V1:test",
    });
    expect(Object.keys(body).sort()).toEqual(
      ["chainId", "endBlock", "policyLabel", "sourceFamilies", "startBlock", "walletAddress"].sort(),
    );
  });
});

// ─── Wallet resolution / not-found ──────────────────────────────────────────

describe("wallet resolution", () => {
  it("stops cleanly when the wallet is not found", async () => {
    const db = makeFakeDb();
    const { deps, httpPostCalls } = makeFakeDeps({ db, walletFound: false });

    const summary = await runEvidenceDirectedWindowRunner(baseRunnerOptions({ execute: true }), deps);

    expect(summary.stoppedReason).toBe("wallet_not_found");
    expect(httpPostCalls).toHaveLength(0);
  });
});

// ─── Wallet address validation ──────────────────────────────────────────────

describe("wallet address validation", () => {
  it("rejects a malformed address", () => {
    expect(validateWalletAddress("not-an-address").ok).toBe(false);
    expect(validateWalletAddress(WALLET_ADDRESS).ok).toBe(true);
  });

  it("CLI parsing rejects a malformed --wallet-address", () => {
    const parsed = parseRunnerCliArgs([
      "--wallet-address", "0xnothex",
      "--chain-id", "369",
      "--start-block", "1",
      "--end-block", "2",
      "--reason", "x",
    ]);
    expect(parsed.ok).toBe(false);
  });
});

// ─── CLI required-argument coverage ──────────────────────────────────────────

describe("CLI required arguments", () => {
  it("requires wallet-address, chain-id, start-block, end-block, and reason", () => {
    const required = ["--wallet-address", "--chain-id", "--start-block", "--end-block", "--reason"];
    const full = [
      "--wallet-address", WALLET_ADDRESS,
      "--chain-id", "369",
      "--start-block", "17233000",
      "--end-block", "17233999",
      "--reason", "test",
    ];
    for (const flag of required) {
      const withoutFlag: string[] = [];
      for (let i = 0; i < full.length; i += 2) {
        if (full[i] !== flag) {
          withoutFlag.push(full[i], full[i + 1]);
        }
      }
      const parsed = parseRunnerCliArgs(withoutFlag);
      expect(parsed.ok).toBe(false);
    }
  });
});

// ─── Env check ───────────────────────────────────────────────────────────────

describe("checkEnv", () => {
  it("reports missing DATABASE_URL/REDIS_URL", () => {
    expect(checkEnv({}).ok).toBe(false);
    expect(checkEnv({ DATABASE_URL: "x", REDIS_URL: "y" }).ok).toBe(true);
  });
});

// ─── Evidence serialization (bigint safety) ─────────────────────────────────

describe("serializeEvidence", () => {
  it("serializes bigint fields as decimal strings, never exponential notation", () => {
    const json = serializeEvidence({
      kind: "dry-run",
      at: "2026-01-01T00:00:00.000Z",
      startBlock: 28_000_000_000_000_000_000_140n,
    });
    expect(json).toContain("28000000000000000000140");
    expect(json).not.toContain("e+");
  });
});

// ─── Server health gate ──────────────────────────────────────────────────────

describe("server health gate", () => {
  it("stops before submission when health check fails (non-200)", async () => {
    const db = makeFakeDb();
    const { deps, httpPostCalls } = makeFakeDeps({ db });
    deps.httpGet = async () => ({ status: 500, body: undefined });

    const summary = await runEvidenceDirectedWindowRunner(baseRunnerOptions({ execute: true }), deps);

    expect(summary.stoppedReason).toBe("server_unhealthy");
    expect(httpPostCalls).toHaveLength(0);
  });
});

// ─── Blocker A: bounded HTTP request timeouts ───────────────────────────────

describe("bounded HTTP timeout policy", () => {
  it("uses a fixed, non-arbitrary timeout constant", () => {
    expect(HTTP_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(HTTP_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(120_000);
  });

  it("GET timeout / thrown network error fails the health gate closed, never reaching POST", async () => {
    const db = makeFakeDb();
    const { deps, httpPostCalls } = makeFakeDeps({ db });
    deps.httpGet = async () => {
      throw new DOMException("The operation was aborted.", "TimeoutError");
    };

    const summary = await runEvidenceDirectedWindowRunner(baseRunnerOptions({ execute: true }), deps);

    expect(summary.stoppedReason).toBe("server_unhealthy");
    expect(httpPostCalls).toHaveLength(0);
  });

  it("POST timeout before acceptance, with zero matching SyncRun candidates, fails closed with no automatic retry", async () => {
    const db = makeFakeDb({ policyLabelCandidates: [] });
    const httpPost: RunnerDeps["httpPost"] = async () => {
      throw new DOMException("The operation was aborted.", "TimeoutError");
    };
    const postCalls: unknown[] = [];
    const wrappedHttpPost: RunnerDeps["httpPost"] = async (url, body) => {
      postCalls.push({ url, body });
      return httpPost(url, body);
    };
    const { deps, evidence } = makeFakeDeps({ db, httpPost: wrappedHttpPost });

    const summary = await runEvidenceDirectedWindowRunner(baseRunnerOptions({ execute: true }), deps);

    expect(summary.stoppedReason).toBe("ambiguous_submission_unrecoverable");
    expect(postCalls).toHaveLength(1);
    const stopRecord = evidence.find((e) => e.kind === "stop" && e.reason === "ambiguous_submission_unrecoverable");
    expect(stopRecord).toBeDefined();
    expect(stopRecord?.serverAcceptanceUnknown).toBe(true);
    expect(String(stopRecord?.detail)).toMatch(/zero SyncRun candidates/i);
  });

  it("ambiguous POST where exactly one matching SyncRun exists recovers and proceeds without resubmitting", async () => {
    const matchingCandidate = completedRun({ id: "recovered-run", policyLabel: DEFAULT_POLICY_LABEL });
    const db = makeFakeDb({
      policyLabelCandidates: [matchingCandidate],
      runsById: { "recovered-run": matchingCandidate },
    });
    const postCalls: unknown[] = [];
    const httpPost: RunnerDeps["httpPost"] = async (url, body) => {
      postCalls.push({ url, body });
      throw new DOMException("The operation was aborted.", "TimeoutError");
    };
    const { deps, evidence } = makeFakeDeps({ db, httpPost });

    const summary = await runEvidenceDirectedWindowRunner(baseRunnerOptions({ execute: true }), deps);

    expect(postCalls).toHaveLength(1);
    expect(summary.stoppedReason).toBe("execute_completed");
    const executeRecord = evidence.find((e) => e.kind === "execute");
    expect(executeRecord?.recoveredFromAmbiguousSubmission).toBe(true);
    expect(executeRecord?.runId).toBe("recovered-run");
  });

  it("ambiguous POST with more than one matching candidate fails closed, never guesses", async () => {
    const db = makeFakeDb({
      policyLabelCandidates: [
        completedRun({ id: "run-a", policyLabel: DEFAULT_POLICY_LABEL }),
        completedRun({ id: "run-b", policyLabel: DEFAULT_POLICY_LABEL }),
      ],
    });
    const httpPost: RunnerDeps["httpPost"] = async () => {
      throw new Error("network error");
    };
    const { deps } = makeFakeDeps({ db, httpPost });

    const summary = await runEvidenceDirectedWindowRunner(baseRunnerOptions({ execute: true }), deps);

    expect(summary.stoppedReason).toBe("ambiguous_submission_unrecoverable");
  });

  it("classifyAmbiguousSubmissionRecovery rejects a candidate whose identity does not fully match", () => {
    const mismatched = completedRun({
      id: "run-x",
      policyLabel: DEFAULT_POLICY_LABEL,
      startBlock: POST_FORK_START + 1n,
    });
    const result = classifyAmbiguousSubmissionRecovery({
      candidates: [mismatched],
      expectedPolicyLabel: DEFAULT_POLICY_LABEL,
      expectedStartBlock: POST_FORK_START,
      expectedEndBlock: POST_FORK_END,
    });
    expect(result.ok).toBe(false);
  });

  it("manual_sync_submit_failed evidence preserves the backend response body", async () => {
    const db = makeFakeDb();
    const httpPost: RunnerDeps["httpPost"] = async () => ({
      status: 409,
      body: { error: { code: "OPERATION_CONFLICT", message: "conflict", details: { activeRunId: "run-9" } } },
    });
    const { deps, evidence } = makeFakeDeps({ db, httpPost });

    const summary = await runEvidenceDirectedWindowRunner(baseRunnerOptions({ execute: true }), deps);

    expect(summary.stoppedReason).toBe("manual_sync_submit_failed");
    const stopRecord = evidence.find((e) => e.kind === "stop" && e.reason === "manual_sync_submit_failed");
    expect(stopRecord?.responseBody).toEqual({
      error: { code: "OPERATION_CONFLICT", message: "conflict", details: { activeRunId: "run-9" } },
    });
  });
});

describe("sanitizeBackendResponseBody", () => {
  it("redacts secret-like keys and never throws", () => {
    expect(sanitizeBackendResponseBody({ password: "hunter2", ok: true })).toEqual({
      password: "[redacted]",
      ok: true,
    });
    expect(sanitizeBackendResponseBody(undefined)).toBeNull();
  });

  it("truncates an oversized string body", () => {
    const huge = "x".repeat(3000);
    const result = sanitizeBackendResponseBody(huge) as string;
    expect(result.length).toBeLessThan(huge.length);
    expect(result).toContain("[truncated]");
  });
});

// ─── Blocker B: exit-code / clean-stop-reason contract ──────────────────────

describe("computeExitCode / CLEAN_STOP_REASONS", () => {
  it("exits 0 only for dry_run_reported and execute_completed", () => {
    expect(CLEAN_STOP_REASONS.has("dry_run_reported")).toBe(true);
    expect(CLEAN_STOP_REASONS.has("execute_completed")).toBe(true);
    expect(computeExitCode("dry_run_reported")).toBe(0);
    expect(computeExitCode("execute_completed")).toBe(0);
  });

  it("fails closed (exit 1) for every gate decline and failure reason", () => {
    const failClosedReasons = [
      "invalid_chain_id",
      "invalid_block_order",
      "range_too_large",
      "fork_boundary_violation",
      "invalid_reason",
      "wallet_not_found",
      "window_connected_to_existing_cursor",
      "active_operation_conflict",
      "policy_label_collision",
      "server_unhealthy",
      "ambiguous_submission_unrecoverable",
      "manual_sync_submit_failed",
      "poll_timeout",
      "sync_run_not_completed",
      "some_future_unlisted_reason",
    ];
    for (const reason of failClosedReasons) {
      expect(computeExitCode(reason)).toBe(1);
    }
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function completedRun(overrides: Partial<RunnerSyncRunRecord> = {}): RunnerSyncRunRecord {
  return {
    id: "run-1",
    trigger: "MANUAL",
    status: "COMPLETED",
    stage: "COMPLETED",
    policyLabel: DEFAULT_POLICY_LABEL,
    sourceFamilies: ["TRANSFERS", "DEX", "LP", "STAKING"],
    startBlock: POST_FORK_START,
    endBlock: POST_FORK_END,
    warningCount: 0,
    warningDetails: null,
    errorMessage: null,
    failedSourceFamily: null,
    failedFromBlock: null,
    failedToBlock: null,
    ...overrides,
  };
}
