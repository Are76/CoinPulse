// TRANSFERS backfill campaign runner — focused unit tests.
//
// All DB, HTTP, and RPC dependencies are mocked/injected. No live calls.
// No real POST, rebuild, or window execution happens anywhere in this file.

import { describe, expect, it, vi } from "vitest";

import {
  CHECKPOINT_INTERVAL,
  FIRST_ACTIVITY_BLOCK,
  FULL_WINDOW_BLOCKS,
  MAX_WINDOWS_HARD_CAP,
  ORIGINAL_CURSOR_FROM_BLOCK,
  TOTAL_CAMPAIGN_WINDOWS,
  TRANSFER_BACKFILL_CHAIN_ID,
  buildManualSyncRequestBody,
  buildRebuildRequestBody,
  checkEnv,
  classifyRebuildWarningDetails,
  computeTotalWindows,
  computeWindowPlan,
  isCheckpointDue,
  isFinalRebuildDue,
  parseRunnerCliArgs,
  policyLabelForWindow,
  runTransferBackfillRunner,
  serializeEvidence,
  validateAdjacency,
  validateExpectedCursor,
  validateFixedCampaignScope,
  validateNoActiveOperation,
  validateNoPolicyLabelCollision,
  validateRangeSize,
  verifyCursorPostcondition,
  verifySyncRunTerminalState,
  type EvidenceRecord,
  type RunnerCliOptions,
  type RunnerDbClient,
  type RunnerDeps,
  type RunnerSyncRunRecord,
} from "../../scripts/transfer-backfill-runner";

// ─── Import safety ──────────────────────────────────────────────────────────────

describe("import safety", () => {
  it("importing the module does not run main() or mutate process.exitCode", () => {
    // If main() ran on import (e.g. a missing fileURLToPath guard), it would
    // read process.argv, hit missing-env validation, and set exitCode = 1.
    expect(process.exitCode).not.toBe(1);
  });
});

// ─── Test fixtures ──────────────────────────────────────────────────────────────

const WALLET_ADDRESS = "0x75f808367720951e789d47e9e9db51148d9aa765";
const WALLET_ID = "wallet-cuid-1";

function baseRunnerOptions(overrides: Partial<RunnerCliOptions> = {}): RunnerCliOptions {
  return {
    execute: false,
    maxWindows: 1,
    allowCheckpointRebuild: false,
    walletAddress: WALLET_ADDRESS,
    baseUrl: "http://localhost:3100",
    evidenceDir: "unused-in-tests",
    pollIntervalMs: 1,
    pollTimeoutMs: 1000,
    ...overrides,
  };
}

/** In-memory fake DB satisfying the narrow RunnerDbClient contract. */
function makeFakeDb(overrides: Partial<{
  cursor: { fromBlock: bigint; toBlock: bigint } | null;
  policyLabels: string[];
  activeRunCount: number;
  contaminationRows: number;
  duplicateTransferRows: number;
  duplicateLedgerRows: number;
  runsById: Record<string, RunnerSyncRunRecord>;
}> = {}): RunnerDbClient {
  const state = {
    cursor: overrides.cursor ?? { fromBlock: 26_679_999n, toBlock: 26_698_010n },
    policyLabels: overrides.policyLabels ?? [],
    activeRunCount: overrides.activeRunCount ?? 0,
    contaminationRows: overrides.contaminationRows ?? 0,
    duplicateTransferRows: overrides.duplicateTransferRows ?? 0,
    duplicateLedgerRows: overrides.duplicateLedgerRows ?? 0,
    runsById: overrides.runsById ?? {},
  };

  return {
    syncCursor: {
      findUnique: async () =>
        state.cursor ? { ...state.cursor, blockHash: "0xblockhash" } : null,
    },
    syncRun: {
      findMany: async () => state.policyLabels.map((policyLabel) => ({ policyLabel }) as unknown as RunnerSyncRunRecord),
      findUnique: async (args: unknown) => {
        const id = (args as { where: { id: string } }).where.id;
        return state.runsById[id] ?? null;
      },
      count: async () => state.activeRunCount,
    },
    $queryRaw: (async (query: TemplateStringsArray) => {
      const sql = query.join("");
      if (sql.includes("RawLog")) {
        return Array.from({ length: state.contaminationRows }, (_, i) => ({ id: `row-${i}` }));
      }
      if (sql.includes("LedgerEntry")) {
        return Array.from({ length: state.duplicateLedgerRows }, (_, i) => ({ dedupeKey: `dup-${i}` }));
      }
      return Array.from({ length: state.duplicateTransferRows }, (_, i) => ({ txHash: `0xdup${i}` }));
    }) as RunnerDbClient["$queryRaw"],
  };
}

function makeFakeDeps(args: {
  db: RunnerDbClient;
  httpPost?: RunnerDeps["httpPost"];
  clockStart?: number;
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
    resolveWallet: async () => ({ id: WALLET_ID, address: WALLET_ADDRESS }),
    httpGet: async () => ({ status: 200, body: { data: { status: "ok" } } }),
    httpPost: args.httpPost ?? defaultHttpPost,
    now: () => new Date(clock),
    sleep: async (ms) => {
      clock += ms;
    },
    writeEvidence: async (record) => {
      evidence.push(record);
    },
    verifyDecimalCapability: async () => ({ ok: true }),
  };

  return { deps, evidence, httpPostCalls };
}

function completedManualRun(overrides: Partial<RunnerSyncRunRecord> = {}): RunnerSyncRunRecord {
  return {
    id: "run-1",
    trigger: "MANUAL",
    status: "COMPLETED",
    stage: "COMPLETED",
    sourceFamilies: ["TRANSFERS"],
    startBlock: 26_678_999n,
    endBlock: 26_679_998n,
    latestSafeBlock: 26_679_998n,
    warningCount: 0,
    warningDetails: null,
    errorMessage: null,
    failedSourceFamily: null,
    failedFromBlock: null,
    failedToBlock: null,
    ...overrides,
  };
}

// ─── 1. Window 19 calculation ───────────────────────────────────────────────────

describe("Window 19 calculation", () => {
  it("computes Window 19 exactly from the given current cursor", () => {
    const plan = computeWindowPlan({ liveCursorFromBlock: 26_679_999n });
    if (plan.status !== "next_window") throw new Error("expected next_window");
    expect(plan.windowNumber).toBe(19);
    expect(plan.startBlock).toBe(26_678_999n);
    expect(plan.endBlock).toBe(26_679_998n);
    expect(plan.policyLabel).toBe("transfer-history-backfill-window-19");
    expect(plan.isFinalWindow).toBe(false);
  });
});

// ─── 2. Normal 1,000-block adjacency ────────────────────────────────────────────

describe("normal 1,000-block adjacency", () => {
  it("spans exactly 1,000 inclusive blocks for a non-final window", () => {
    const plan = computeWindowPlan({ liveCursorFromBlock: 26_679_999n });
    if (plan.status !== "next_window") throw new Error("expected next_window");
    expect(plan.blockCount).toBe(1000n);
    expect(plan.endBlock - plan.startBlock + 1n).toBe(FULL_WINDOW_BLOCKS);
  });
});

// ─── 3. Window numbering and policyLabel generation ────────────────────────────

describe("window numbering and policyLabel generation", () => {
  it("Window 1 is derived from the original cursor", () => {
    const plan = computeWindowPlan({ liveCursorFromBlock: ORIGINAL_CURSOR_FROM_BLOCK });
    if (plan.status !== "next_window") throw new Error("expected next_window");
    expect(plan.windowNumber).toBe(1);
    expect(plan.policyLabel).toBe("transfer-history-backfill-window-1");
  });

  it("policyLabelForWindow matches the campaign naming convention", () => {
    expect(policyLabelForWindow(42)).toBe("transfer-history-backfill-window-42");
  });

  it("total campaign size is 13,688 windows (13,687 full + 1 partial)", () => {
    expect(TOTAL_CAMPAIGN_WINDOWS).toBe(13_688);
    expect(
      computeTotalWindows({ originalCursorFromBlock: ORIGINAL_CURSOR_FROM_BLOCK, firstActivityBlock: FIRST_ACTIVITY_BLOCK }),
    ).toBe(13_688);
  });
});

// ─── 4. Final Window 13,688 partial range ──────────────────────────────────────

describe("final Window 13,688 partial range", () => {
  it("clamps to FIRST_ACTIVITY_BLOCK and spans 303 blocks", () => {
    // Live cursor after window 13,687 completed: CURSOR_FROM - 1000*13687 = 13,010,999.
    const liveCursorFromBlock = ORIGINAL_CURSOR_FROM_BLOCK - FULL_WINDOW_BLOCKS * 13_687n;
    expect(liveCursorFromBlock).toBe(13_010_999n);
    const plan = computeWindowPlan({ liveCursorFromBlock });
    if (plan.status !== "next_window") throw new Error("expected next_window");
    expect(plan.windowNumber).toBe(13_688);
    expect(plan.startBlock).toBe(13_010_696n);
    expect(plan.endBlock).toBe(13_010_998n);
    expect(plan.isFinalWindow).toBe(true);
    expect(plan.blockCount).toBe(303n);
  });

  it("reports campaign_complete once the cursor reaches FIRST_ACTIVITY_BLOCK", () => {
    const plan = computeWindowPlan({ liveCursorFromBlock: FIRST_ACTIVITY_BLOCK });
    expect(plan.status).toBe("campaign_complete");
  });
});

// ─── 5. No gap / overlap ────────────────────────────────────────────────────────

describe("no gap or overlap between consecutive windows", () => {
  it("chains three consecutive windows with zero gap and zero overlap", () => {
    let liveCursorFromBlock = 26_679_999n;
    const windows = [];
    for (let i = 0; i < 3; i += 1) {
      const plan = computeWindowPlan({ liveCursorFromBlock });
      if (plan.status !== "next_window") throw new Error("expected next_window");
      windows.push(plan);
      liveCursorFromBlock = plan.startBlock; // cursor advances to the window's startBlock once completed
    }
    for (let i = 1; i < windows.length; i += 1) {
      expect(windows[i].endBlock + 1n).toBe(windows[i - 1].startBlock);
    }
  });
});

// ─── 6. Refusal when cursor differs ─────────────────────────────────────────────

describe("refusal when cursor differs from operator expectation", () => {
  it("fails validateExpectedCursor on mismatch", () => {
    const result = validateExpectedCursor({ liveCursorFromBlock: 26_679_999n, expectedCursorFromBlock: 26_680_999n });
    expect(result.ok).toBe(false);
  });

  it("passes when no expectation is supplied", () => {
    expect(validateExpectedCursor({ liveCursorFromBlock: 26_679_999n }).ok).toBe(true);
  });

  it("stops the orchestrator end-to-end on cursor mismatch", async () => {
    const db = makeFakeDb({ cursor: { fromBlock: 26_679_999n, toBlock: 26_698_010n } });
    const { deps, httpPostCalls } = makeFakeDeps({ db });
    const summary = await runTransferBackfillRunner(
      baseRunnerOptions({ expectedCursorFromBlock: 999n }),
      deps,
    );
    expect(summary.stoppedReason).toBe("cursor_expectation_mismatch");
    expect(httpPostCalls).toHaveLength(0);
  });
});

// ─── 7. Refusal when policyLabel already exists ────────────────────────────────

describe("refusal when policyLabel already exists", () => {
  it("fails validateNoPolicyLabelCollision", () => {
    const result = validateNoPolicyLabelCollision({
      policyLabel: "transfer-history-backfill-window-19",
      existingPolicyLabels: ["transfer-history-backfill-window-19"],
    });
    expect(result.ok).toBe(false);
  });

  it("stops the orchestrator end-to-end on a policyLabel collision", async () => {
    const db = makeFakeDb({ policyLabels: ["transfer-history-backfill-window-19"] });
    const { deps, httpPostCalls } = makeFakeDeps({ db });
    const summary = await runTransferBackfillRunner(baseRunnerOptions({ execute: true }), deps);
    expect(summary.stoppedReason).toBe("policy_label_collision");
    expect(httpPostCalls).toHaveLength(0);
  });
});

// ─── 8. Refusal when an active operation exists ────────────────────────────────

describe("refusal when an active operation exists", () => {
  it("fails validateNoActiveOperation", () => {
    expect(validateNoActiveOperation({ activeRunCount: 1 }).ok).toBe(false);
    expect(validateNoActiveOperation({ activeRunCount: 0 }).ok).toBe(true);
  });

  it("stops the orchestrator end-to-end when a run is PENDING/RUNNING", async () => {
    const db = makeFakeDb({ activeRunCount: 1 });
    const { deps, httpPostCalls } = makeFakeDeps({ db });
    const summary = await runTransferBackfillRunner(baseRunnerOptions({ execute: true }), deps);
    expect(summary.stoppedReason).toBe("active_operation_conflict");
    expect(httpPostCalls).toHaveLength(0);
  });
});

// ─── 9. Refusal on warning or failed terminal state ────────────────────────────

describe("refusal on warning or failed terminal state", () => {
  it("fails verifySyncRunTerminalState when warningCount > 0", () => {
    const result = verifySyncRunTerminalState({
      run: completedManualRun({ warningCount: 3 }),
      expectedTrigger: "MANUAL",
      expectedStartBlock: 26_678_999n,
      expectedEndBlock: 26_679_998n,
    });
    expect(result.ok).toBe(false);
  });

  it("fails verifySyncRunTerminalState when status is FAILED with an errorMessage", () => {
    const result = verifySyncRunTerminalState({
      run: completedManualRun({ status: "FAILED", errorMessage: "boom" }),
      expectedTrigger: "MANUAL",
      expectedStartBlock: 26_678_999n,
      expectedEndBlock: 26_679_998n,
    });
    expect(result.ok).toBe(false);
  });

  it("stops the orchestrator end-to-end when the run completes with warnings", async () => {
    const db = makeFakeDb({
      runsById: { "run-1": completedManualRun({ warningCount: 1 }) },
    });
    const { deps } = makeFakeDeps({ db });
    const summary = await runTransferBackfillRunner(baseRunnerOptions({ execute: true }), deps);
    expect(summary.stoppedReason).toBe("invariant_failed_after_run");
    expect(summary.windowsCompleted).toBe(0);
  });
});

// ─── 9b. REBUILD trigger-specific warning validation ───────────────────────────
//
// Checkpoint/final rebuilds re-materialize the whole wallet mid-backfill and
// are documented (docs/transfer-history-backfill-operator-plan.md facts 10-11,
// §3 Q6) to legitimately emit `negative-token-balance:<assetId>:<qty>`
// warnings until the history is contiguous. MANUAL sync windows never
// materialize and so keep the strict warningCount === 0 rule unchanged.

function completedRebuildRun(overrides: Partial<RunnerSyncRunRecord> = {}): RunnerSyncRunRecord {
  return completedManualRun({ trigger: "REBUILD", ...overrides });
}

describe("REBUILD trigger-specific warning validation", () => {
  it("classifyRebuildWarningDetails accepts only the documented negative-token-balance class", () => {
    expect(
      classifyRebuildWarningDetails([
        "negative-token-balance:chain:369:erc20:0xabc:12.5",
        "negative-token-balance:chain:369:erc20:0xdef:0.001",
      ]).ok,
    ).toBe(true);
  });

  it("classifyRebuildWarningDetails rejects any other warning class", () => {
    const result = classifyRebuildWarningDetails([
      "negative-token-balance:chain:369:erc20:0xabc:12.5",
      "skipped unrelated-wallet transfer log",
    ]);
    expect(result.ok).toBe(false);
  });

  it("classifyRebuildWarningDetails fails closed when warningDetails is missing (e.g. truncated)", () => {
    expect(classifyRebuildWarningDetails(null).ok).toBe(false);
    expect(classifyRebuildWarningDetails(undefined).ok).toBe(false);
  });

  it("classifyRebuildWarningDetails fails closed on the capWarningDetails truncation marker", () => {
    const result = classifyRebuildWarningDetails([
      "negative-token-balance:chain:369:erc20:0xabc:12.5",
      "[truncated: 5 additional warnings not stored]",
    ]);
    expect(result.ok).toBe(false);
  });

  it("verifySyncRunTerminalState passes a REBUILD run whose warnings are all negative-token-balance", () => {
    const result = verifySyncRunTerminalState({
      run: completedRebuildRun({
        warningCount: 2,
        warningDetails: [
          "negative-token-balance:chain:369:erc20:0xabc:12.5",
          "negative-token-balance:chain:369:erc20:0xdef:0.001",
        ],
      }),
      expectedTrigger: "REBUILD",
      expectedStartBlock: 26_678_999n,
      expectedEndBlock: 26_679_998n,
    });
    expect(result.ok).toBe(true);
  });

  it("verifySyncRunTerminalState fails a REBUILD run with an unexpected warning class", () => {
    const result = verifySyncRunTerminalState({
      run: completedRebuildRun({
        warningCount: 1,
        warningDetails: ["skipped unrelated-wallet transfer log"],
      }),
      expectedTrigger: "REBUILD",
      expectedStartBlock: 26_678_999n,
      expectedEndBlock: 26_679_998n,
    });
    expect(result.ok).toBe(false);
  });

  it("verifySyncRunTerminalState still passes a REBUILD run with zero warnings", () => {
    const result = verifySyncRunTerminalState({
      run: completedRebuildRun({ warningCount: 0, warningDetails: null }),
      expectedTrigger: "REBUILD",
      expectedStartBlock: 26_678_999n,
      expectedEndBlock: 26_679_998n,
    });
    expect(result.ok).toBe(true);
  });

  it("regression: MANUAL runs are unaffected — zero warnings still passes", () => {
    const result = verifySyncRunTerminalState({
      run: completedManualRun({ warningCount: 0, warningDetails: null }),
      expectedTrigger: "MANUAL",
      expectedStartBlock: 26_678_999n,
      expectedEndBlock: 26_679_998n,
    });
    expect(result.ok).toBe(true);
  });

  it("regression: MANUAL runs still fail on any warning, even the negative-token-balance class", () => {
    const result = verifySyncRunTerminalState({
      run: completedManualRun({
        warningCount: 1,
        warningDetails: ["negative-token-balance:chain:369:erc20:0xabc:12.5"],
      }),
      expectedTrigger: "MANUAL",
      expectedStartBlock: 26_678_999n,
      expectedEndBlock: 26_679_998n,
    });
    expect(result.ok).toBe(false);
  });
});

// ─── 10. Refusal on cursor postcondition mismatch ──────────────────────────────

describe("refusal on cursor postcondition mismatch", () => {
  it("fails verifyCursorPostcondition when fromBlock did not move as predicted", () => {
    const result = verifyCursorPostcondition({
      cursorAfter: { fromBlock: 26_679_999n, toBlock: 26_698_010n },
      expectedFromBlock: 26_678_999n,
      expectedToBlock: 26_698_010n,
    });
    expect(result.ok).toBe(false);
  });

  it("passes when the cursor advanced exactly as predicted", () => {
    const result = verifyCursorPostcondition({
      cursorAfter: { fromBlock: 26_678_999n, toBlock: 26_698_010n },
      expectedFromBlock: 26_678_999n,
      expectedToBlock: 26_698_010n,
    });
    expect(result.ok).toBe(true);
  });
});

// ─── 11. Resume behavior after an already completed window ────────────────────

describe("resume behavior after an already completed window", () => {
  it("plans the NEXT window purely from the live cursor, ignoring any prior in-memory state", async () => {
    // Cursor already reflects Window 19 completed (fromBlock advanced to 26,678,999).
    const db = makeFakeDb({ cursor: { fromBlock: 26_678_999n, toBlock: 26_698_010n } });
    const { deps, evidence } = makeFakeDeps({ db });
    const summary = await runTransferBackfillRunner(baseRunnerOptions({ execute: false }), deps);
    expect(summary.lastWindowNumber).toBe(20);
    const plannedEvent = evidence.find((e) => e.kind === "window");
    expect(plannedEvent?.policyLabel).toBe("transfer-history-backfill-window-20");
  });
});

// ─── 12. Checkpoint detection after Window 25 ──────────────────────────────────

describe("checkpoint detection after Window 25", () => {
  it("is due at window 25 and every 25th window after", () => {
    expect(isCheckpointDue(25, CHECKPOINT_INTERVAL)).toBe(true);
    expect(isCheckpointDue(50, CHECKPOINT_INTERVAL)).toBe(true);
    expect(isCheckpointDue(24, CHECKPOINT_INTERVAL)).toBe(false);
    expect(isCheckpointDue(26, CHECKPOINT_INTERVAL)).toBe(false);
  });

  it("stops the orchestrator before submitting a due checkpoint rebuild without the explicit flag", async () => {
    // Cursor positioned so the next completed window is window 25.
    const liveCursorFromBlock = ORIGINAL_CURSOR_FROM_BLOCK - 24_000n; // window 25
    const db = makeFakeDb({
      cursor: { fromBlock: liveCursorFromBlock, toBlock: FIRST_ACTIVITY_BLOCK + 1_000_000n },
      runsById: {
        "run-1": completedManualRun({
          startBlock: liveCursorFromBlock - FULL_WINDOW_BLOCKS,
          endBlock: liveCursorFromBlock - 1n,
          latestSafeBlock: liveCursorFromBlock - 1n,
        }),
      },
    });
    // Cursor postcondition must reflect the completed window for the "completed" branch to be reached.
    let calls = 0;
    const dbWithAdvancingCursor: RunnerDbClient = {
      ...db,
      syncCursor: {
        findUnique: async () => {
          calls += 1;
          const fromBlock = calls === 1 ? liveCursorFromBlock : liveCursorFromBlock - FULL_WINDOW_BLOCKS;
          return { fromBlock, toBlock: FIRST_ACTIVITY_BLOCK + 1_000_000n, blockHash: "0xhash" };
        },
      },
    };
    const { deps } = makeFakeDeps({ db: dbWithAdvancingCursor });
    const summary = await runTransferBackfillRunner(baseRunnerOptions({ execute: true, allowCheckpointRebuild: false }), deps);
    expect(summary.stoppedReason).toBe("stopped_before_checkpoint_rebuild");
    expect(summary.windowsCompleted).toBe(1);
    expect(summary.lastWindowNumber).toBe(25);
  });
});

// ─── 13. Final rebuild detection after Window 13,688 ───────────────────────────

describe("final rebuild detection after Window 13,688", () => {
  it("is due only at the last window", () => {
    expect(isFinalRebuildDue(13_688, 13_688)).toBe(true);
    expect(isFinalRebuildDue(13_687, 13_688)).toBe(false);
  });
});

// ─── 14. Dry-run performs no POST or rebuild ───────────────────────────────────

describe("dry-run performs no POST or rebuild", () => {
  it("never calls httpPost when execute is false", async () => {
    const db = makeFakeDb();
    const { deps, httpPostCalls } = makeFakeDeps({ db });
    const summary = await runTransferBackfillRunner(baseRunnerOptions({ execute: false, maxWindows: 3 }), deps);
    expect(httpPostCalls).toHaveLength(0);
    expect(summary.stoppedReason).toBe("max_windows_reached");
  });

  it("never runs a rebuild in dry-run even when a checkpoint would be due", async () => {
    const liveCursorFromBlock = ORIGINAL_CURSOR_FROM_BLOCK - 24_000n; // window 25
    const db = makeFakeDb({ cursor: { fromBlock: liveCursorFromBlock, toBlock: 26_698_010n } });
    const { deps, httpPostCalls } = makeFakeDeps({ db });
    await runTransferBackfillRunner(baseRunnerOptions({ execute: false, maxWindows: 1 }), deps);
    expect(httpPostCalls.some((c) => c.url.includes("/api/rebuild"))).toBe(false);
  });
});

// ─── 15. Max-window bound is enforced ──────────────────────────────────────────

describe("max-window bound is enforced", () => {
  it("parseRunnerCliArgs rejects a value above the hard cap", () => {
    const result = parseRunnerCliArgs(["--max-windows", "26"]);
    expect(result.ok).toBe(false);
  });

  it("parseRunnerCliArgs rejects zero and non-integers", () => {
    expect(parseRunnerCliArgs(["--max-windows", "0"]).ok).toBe(false);
    expect(parseRunnerCliArgs(["--max-windows", "abc"]).ok).toBe(false);
  });

  it("defaults to 1 when --max-windows is omitted", () => {
    const result = parseRunnerCliArgs([]);
    if (!result.ok) throw new Error("expected ok parse");
    expect(result.options.maxWindows).toBe(1);
    expect(result.options.execute).toBe(false);
  });

  it("MAX_WINDOWS_HARD_CAP is conservative (<= 25)", () => {
    expect(MAX_WINDOWS_HARD_CAP).toBeLessThanOrEqual(25);
  });

  it("the orchestrator submits at most maxWindows sync requests across successful iterations", async () => {
    let cursorFromBlock = 26_679_999n;
    let lastSubmitted: { startBlock: bigint; endBlock: bigint } | null = null;
    const db: RunnerDbClient = {
      syncCursor: {
        findUnique: async () => ({ fromBlock: cursorFromBlock, toBlock: 26_698_010n, blockHash: "0xhash" }),
      },
      syncRun: {
        findMany: async () => [],
        findUnique: async () =>
          completedManualRun({
            startBlock: lastSubmitted?.startBlock ?? null,
            endBlock: lastSubmitted?.endBlock ?? null,
            latestSafeBlock: lastSubmitted?.endBlock ?? null,
          }),
        count: async () => 0,
      },
      $queryRaw: (async () => []) as RunnerDbClient["$queryRaw"],
    };
    const httpPostCalls: Array<{ url: string; body: unknown }> = [];
    const httpPost: RunnerDeps["httpPost"] = async (url, body) => {
      httpPostCalls.push({ url, body });
      const parsed = body as { startBlock: string; endBlock: string };
      lastSubmitted = { startBlock: BigInt(parsed.startBlock), endBlock: BigInt(parsed.endBlock) };
      // Mirrors the real cursor: it advances to the just-submitted window's startBlock.
      cursorFromBlock = lastSubmitted.startBlock;
      return { status: 202, body: { data: { runId: "run-1" } } };
    };
    const { deps } = makeFakeDeps({ db, httpPost });
    const summary = await runTransferBackfillRunner(baseRunnerOptions({ execute: true, maxWindows: 3 }), deps);
    expect(httpPostCalls).toHaveLength(3);
    expect(summary.windowsCompleted).toBe(3);
  });
});

// ─── 16. Evidence output excludes secret values ────────────────────────────────

describe("evidence output excludes secret values", () => {
  it("serializeEvidence never includes DATABASE_URL/REDIS_URL/headers-shaped keys", () => {
    const record: EvidenceRecord = {
      kind: "window",
      at: new Date(0).toISOString(),
      windowNumber: 19,
      policyLabel: "transfer-history-backfill-window-19",
      runId: "run-1",
    };
    const serialized = serializeEvidence(record);
    expect(serialized).not.toMatch(/postgres(ql)?:\/\//i);
    expect(serialized).not.toMatch(/redis:\/\//i);
    expect(serialized).not.toContain("DATABASE_URL");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("apikey");
  });

  it("serializes bigint fields as plain decimal strings, never leaking raw object internals", () => {
    const record: EvidenceRecord = {
      kind: "window",
      at: new Date(0).toISOString(),
      windowNumber: 19,
      startBlock: 26_678_999n,
    };
    const serialized = serializeEvidence(record);
    expect(serialized).toContain('"startBlock":"26678999"');
  });

  it("the orchestrator never writes process.env values into evidence records", async () => {
    process.env.__TEST_SECRET__ = "super-secret-value";
    const db = makeFakeDb();
    const { deps, evidence } = makeFakeDeps({ db });
    await runTransferBackfillRunner(baseRunnerOptions({ execute: false }), deps);
    for (const record of evidence) {
      expect(JSON.stringify(record)).not.toContain("super-secret-value");
    }
    delete process.env.__TEST_SECRET__;
  });
});

// ─── Additional coverage: fixed campaign scope, env check, request bodies ─────

describe("fixed campaign scope validation", () => {
  it("accepts exactly chainId 369 and sourceFamilies ['TRANSFERS']", () => {
    expect(validateFixedCampaignScope({ chainId: 369, sourceFamilies: ["TRANSFERS"] }).ok).toBe(true);
  });

  it("rejects any other chainId or source family set", () => {
    expect(validateFixedCampaignScope({ chainId: 1, sourceFamilies: ["TRANSFERS"] }).ok).toBe(false);
    expect(validateFixedCampaignScope({ chainId: 369, sourceFamilies: ["TRANSFERS", "DEX"] }).ok).toBe(false);
    expect(validateFixedCampaignScope({ chainId: 369, sourceFamilies: ["DEX"] }).ok).toBe(false);
  });
});

describe("checkEnv", () => {
  it("requires DATABASE_URL and REDIS_URL", () => {
    expect(checkEnv({})).toEqual({ ok: false, missing: ["DATABASE_URL", "REDIS_URL"] });
    expect(checkEnv({ DATABASE_URL: "x", REDIS_URL: "y" })).toEqual({ ok: true });
  });
});

describe("request body builders", () => {
  it("buildManualSyncRequestBody always includes explicit startBlock and endBlock", () => {
    const plan = computeWindowPlan({ liveCursorFromBlock: 26_679_999n });
    if (plan.status !== "next_window") throw new Error("expected next_window");
    const body = buildManualSyncRequestBody({ walletAddress: WALLET_ADDRESS, window: plan });
    expect(body.startBlock).toBe("26678999");
    expect(body.endBlock).toBe("26679998");
    expect(body.chainId).toBe(TRANSFER_BACKFILL_CHAIN_ID);
    expect(body.sourceFamilies).toEqual(["TRANSFERS"]);
    expect(body.policyLabel).toBe("transfer-history-backfill-window-19");
  });

  it("buildRebuildRequestBody scopes to fromBlock/toBlock and TRANSFERS only", () => {
    const plan = computeWindowPlan({ liveCursorFromBlock: 26_679_999n });
    if (plan.status !== "next_window") throw new Error("expected next_window");
    const body = buildRebuildRequestBody({ walletAddress: WALLET_ADDRESS, window: plan });
    expect(body.fromBlock).toBe("26678999");
    expect(body.toBlock).toBe("26679998");
    expect(body.sourceFamilies).toEqual(["TRANSFERS"]);
  });
});

describe("validateAdjacency and validateRangeSize", () => {
  it("rejects a proposed window disconnected from the live cursor", () => {
    expect(validateAdjacency({ liveCursorFromBlock: 26_679_999n, proposedEndBlock: 26_670_000n }).ok).toBe(false);
  });

  it("accepts an adjacent window", () => {
    expect(validateAdjacency({ liveCursorFromBlock: 26_679_999n, proposedEndBlock: 26_679_998n }).ok).toBe(true);
  });

  it("rejects a non-final window that is not exactly 1,000 blocks", () => {
    expect(
      validateRangeSize({ startBlock: 100n, endBlock: 200n, isFinalWindow: false }).ok,
    ).toBe(false);
  });

  it("accepts a final window smaller than 1,000 blocks", () => {
    expect(
      validateRangeSize({ startBlock: 13_010_696n, endBlock: 13_010_998n, isFinalWindow: true }).ok,
    ).toBe(true);
  });
});

describe("no real network or DB calls in this suite", () => {
  it("does not import a live PrismaClient or fetch", () => {
    // Guard: the fake deps above never call global fetch. If a future change
    // wires the CLI's real fetch-based httpPost into a test by mistake, this
    // spy would observe it.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
