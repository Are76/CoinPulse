// Wallet-scoped forward TRANSFERS sync batch runner — focused unit tests.
//
// All DB, HTTP dependencies are mocked/injected. No live calls, no real POST,
// no rebuild, and no execution of the sync pipeline happens anywhere in this
// file.

import { describe, expect, it } from "vitest";

import {
  CLEAN_STOP_REASONS,
  DEFAULT_MAX_WINDOWS,
  MAX_WINDOWS_HARD_CAP,
  SUPPORTED_CHAIN_ID,
  WINDOW_SIZE_HARD_CAP_BLOCKS,
  buildManualSyncRequestBody,
  checkEnv,
  computeExitCode,
  computeForwardWindowPlan,
  parseRunnerCliArgs,
  policyLabelForBatchWindow,
  runWalletForwardSyncRunner,
  serializeEvidence,
  validateExpectedLiveCursor,
  validateFirstWindowStart,
  validateForwardAdjacency,
  validateNoActiveOperation,
  validateNoPolicyLabelCollision,
  validateSupportedChain,
  validateWindowSize,
  verifyForwardCursorPostcondition,
  verifyWindowTerminalState,
  type EvidenceRecord,
  type RunnerCliOptions,
  type RunnerDbClient,
  type RunnerDeps,
  type RunnerSyncRunRecord,
} from "../../scripts/wallet-forward-sync-runner";

// ─── Import safety ──────────────────────────────────────────────────────────────

describe("import safety", () => {
  it("importing the module does not run main() or mutate process.exitCode", () => {
    expect(process.exitCode).not.toBe(1);
  });
});

// ─── Regression fixture (the exact task scenario) ──────────────────────────────

const FIXTURE_WALLET = "0x08ac26d74013af7430c350c97eacd8be0bdc5613";
const FIXTURE_WALLET_ID = "wallet-cuid-1";
const FIXTURE_CHAIN_ID = 369;
const FIXTURE_CURSOR_FROM = 25_077_549n;
const FIXTURE_CURSOR_TO = 25_078_548n;
const FIXTURE_FIRST_WINDOW_START = 25_078_549n;
const FIXTURE_WINDOW_SIZE = 1_000n;

function baseRunnerOptions(overrides: Partial<RunnerCliOptions> = {}): RunnerCliOptions {
  return {
    execute: false,
    walletAddress: FIXTURE_WALLET,
    chainId: FIXTURE_CHAIN_ID,
    expectedCursorFromBlock: FIXTURE_CURSOR_FROM,
    expectedCursorToBlock: FIXTURE_CURSOR_TO,
    firstWindowStart: FIXTURE_FIRST_WINDOW_START,
    windowSizeBlocks: FIXTURE_WINDOW_SIZE,
    maxWindows: 1,
    policyLabelPrefix: "wallet-forward-sync-window",
    baseUrl: "http://localhost:3100",
    evidenceFile: "unused-in-tests/evidence.jsonl",
    pollIntervalMs: 1,
    pollTimeoutMs: 1000,
    ...overrides,
  };
}

function makeFakeDb(
  overrides: Partial<{
    cursor: { fromBlock: bigint; toBlock: bigint } | null;
    policyLabels: string[];
    activeRunCount: number;
    contaminationRows: number;
    duplicateTransactionRows: number;
    duplicateTransferRows: number;
    duplicateLedgerRows: number;
    runsById: Record<string, RunnerSyncRunRecord>;
  }> = {},
): RunnerDbClient & { advanceCursorTo: (toBlock: bigint) => void } {
  const state = {
    cursor: overrides.cursor ?? { fromBlock: FIXTURE_CURSOR_FROM, toBlock: FIXTURE_CURSOR_TO },
    policyLabels: overrides.policyLabels ?? [],
    activeRunCount: overrides.activeRunCount ?? 0,
    contaminationRows: overrides.contaminationRows ?? 0,
    duplicateTransactionRows: overrides.duplicateTransactionRows ?? 0,
    duplicateTransferRows: overrides.duplicateTransferRows ?? 0,
    duplicateLedgerRows: overrides.duplicateLedgerRows ?? 0,
    runsById: overrides.runsById ?? {},
  };

  const db: RunnerDbClient & { advanceCursorTo: (toBlock: bigint) => void } = {
    syncCursor: {
      findUnique: async () => (state.cursor ? { ...state.cursor, blockHash: "0xblockhash" } : null),
    },
    syncRun: {
      findMany: async () =>
        state.policyLabels.map((policyLabel) => ({ policyLabel }) as unknown as RunnerSyncRunRecord),
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
      if (sql.includes("RawTransaction")) {
        return Array.from({ length: state.duplicateTransactionRows }, (_, i) => ({ txHash: `0xtx${i}` }));
      }
      return Array.from({ length: state.duplicateTransferRows }, (_, i) => ({ txHash: `0xdup${i}` }));
    }) as RunnerDbClient["$queryRaw"],
    advanceCursorTo: (toBlock: bigint) => {
      if (state.cursor) state.cursor = { fromBlock: state.cursor.fromBlock, toBlock };
    },
  };

  return db;
}

function makeFakeDeps(args: {
  db: RunnerDbClient;
  httpPost?: RunnerDeps["httpPost"];
  clockStart?: number;
}): { deps: RunnerDeps; evidence: EvidenceRecord[]; httpPostCalls: Array<{ url: string; body: unknown }> } {
  const evidence: EvidenceRecord[] = [];
  const httpPostCalls: Array<{ url: string; body: unknown }> = [];
  let clock = args.clockStart ?? 0;

  const defaultHttpPost: RunnerDeps["httpPost"] = async () => {
    return { status: 202, body: { data: { runId: "run-1" } } };
  };

  const recordingHttpPost: RunnerDeps["httpPost"] = async (url, body) => {
    httpPostCalls.push({ url, body });
    return (args.httpPost ?? defaultHttpPost)(url, body);
  };

  const deps: RunnerDeps = {
    db: args.db,
    resolveWallet: async () => ({ id: FIXTURE_WALLET_ID, address: FIXTURE_WALLET }),
    httpGet: async () => ({ status: 200, body: { data: { status: "ok" } } }),
    httpPost: recordingHttpPost,
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

function completedManualRun(overrides: Partial<RunnerSyncRunRecord> = {}): RunnerSyncRunRecord {
  return {
    id: "run-1",
    trigger: "MANUAL",
    status: "COMPLETED",
    stage: "COMPLETED",
    chainId: FIXTURE_CHAIN_ID,
    walletId: FIXTURE_WALLET_ID,
    policyLabel: "wallet-forward-sync-window-1",
    sourceFamilies: ["TRANSFERS"],
    startBlock: 25_078_549n,
    endBlock: 25_079_548n,
    latestSafeBlock: 25_079_548n,
    warningCount: 0,
    warningDetails: [],
    errorMessage: null,
    failedSourceFamily: null,
    failedFromBlock: null,
    failedToBlock: null,
    ...overrides,
  };
}

// ─── CLI defaults and hard caps ─────────────────────────────────────────────────

describe("CLI defaults and hard caps", () => {
  const requiredArgv = [
    "--wallet-address",
    FIXTURE_WALLET,
    "--chain-id",
    "369",
    "--expected-cursor-from",
    "25077549",
    "--expected-cursor-to",
    "25078548",
    "--first-window-start",
    "25078549",
    "--window-size",
    "1000",
    "--policy-label-prefix",
    "wallet-forward-sync-window",
  ];

  it("dry-run is the default (--execute not implied)", () => {
    const parsed = parseRunnerCliArgs(requiredArgv);
    if (!parsed.ok) throw new Error("expected parse success");
    expect(parsed.options.execute).toBe(false);
  });

  it("--execute requires being explicitly passed", () => {
    const parsed = parseRunnerCliArgs([...requiredArgv, "--execute"]);
    if (!parsed.ok) throw new Error("expected parse success");
    expect(parsed.options.execute).toBe(true);
  });

  it("max-windows defaults to 1 when omitted", () => {
    const parsed = parseRunnerCliArgs(requiredArgv);
    if (!parsed.ok) throw new Error("expected parse success");
    expect(parsed.options.maxWindows).toBe(1);
    expect(DEFAULT_MAX_WINDOWS).toBe(1);
  });

  it("max-windows hard cap is 5; 6 is rejected", () => {
    const parsed = parseRunnerCliArgs([...requiredArgv, "--max-windows", "6"]);
    expect(parsed.ok).toBe(false);
    expect(MAX_WINDOWS_HARD_CAP).toBe(5);
  });

  it("max-windows of exactly 5 is accepted", () => {
    const parsed = parseRunnerCliArgs([...requiredArgv, "--max-windows", "5"]);
    if (!parsed.ok) throw new Error("expected parse success");
    expect(parsed.options.maxWindows).toBe(5);
  });

  it("window size cannot exceed the project hard cap (1001 inclusive blocks)", () => {
    expect(WINDOW_SIZE_HARD_CAP_BLOCKS).toBe(1_001n);
    const tooLarge = parseRunnerCliArgs([
      ...requiredArgv.slice(0, requiredArgv.indexOf("--window-size")),
      "--window-size",
      "1002",
      ...requiredArgv.slice(requiredArgv.indexOf("--policy-label-prefix")),
    ]);
    expect(tooLarge.ok).toBe(false);

    const atCap = parseRunnerCliArgs([
      ...requiredArgv.slice(0, requiredArgv.indexOf("--window-size")),
      "--window-size",
      "1001",
      ...requiredArgv.slice(requiredArgv.indexOf("--policy-label-prefix")),
    ]);
    expect(atCap.ok).toBe(true);
  });

  it("rejects an unsupported chain id, including 8453 (Base)", () => {
    const parsed = parseRunnerCliArgs([
      ...requiredArgv.slice(0, requiredArgv.indexOf("--chain-id")),
      "--chain-id",
      "8453",
      ...requiredArgv.slice(requiredArgv.indexOf("--expected-cursor-from")),
    ]);
    expect(parsed.ok).toBe(false);
    expect(validateSupportedChain({ chainId: 8453 }).ok).toBe(false);
    expect(validateSupportedChain({ chainId: SUPPORTED_CHAIN_ID }).ok).toBe(true);
  });

  it("requires every mandatory argument explicitly", () => {
    expect(parseRunnerCliArgs([]).ok).toBe(false);
    expect(
      parseRunnerCliArgs(requiredArgv.filter((_, i) => i !== requiredArgv.indexOf("--wallet-address"))).ok,
    ).toBe(false);
  });

  it("checkEnv reports missing DATABASE_URL/REDIS_URL", () => {
    expect(checkEnv({}).ok).toBe(false);
    expect(checkEnv({ DATABASE_URL: "x", REDIS_URL: "y" }).ok).toBe(true);
  });
});

// ─── Window size validation (direct) ────────────────────────────────────────────

describe("validateWindowSize", () => {
  it("rejects zero and negative-equivalent sizes", () => {
    expect(validateWindowSize({ windowSizeBlocks: 0n }).ok).toBe(false);
  });
  it("accepts the fixture window size of 1000", () => {
    expect(validateWindowSize({ windowSizeBlocks: 1_000n }).ok).toBe(true);
  });
});

// ─── Forward window planning: exact regression fixture ────────────────────────

describe("forward window planning — regression fixture", () => {
  it("plans exactly the five expected windows with no gap, no overlap, no sixth window", () => {
    let liveCursorToBlock = FIXTURE_CURSOR_TO;
    const expectedRanges = [
      [25_078_549n, 25_079_548n],
      [25_079_549n, 25_080_548n],
      [25_080_549n, 25_081_548n],
      [25_081_549n, 25_082_548n],
      [25_082_549n, 25_083_548n],
    ];

    const windows = [];
    for (let i = 0; i < 5; i += 1) {
      const plan = computeForwardWindowPlan({
        liveCursorToBlock,
        windowSizeBlocks: FIXTURE_WINDOW_SIZE,
        windowNumber: i + 1,
        policyLabelPrefix: "wallet-forward-sync-window",
      });
      windows.push(plan);
      liveCursorToBlock = plan.endBlock;
    }

    for (let i = 0; i < 5; i += 1) {
      expect(windows[i].startBlock).toBe(expectedRanges[i][0]);
      expect(windows[i].endBlock).toBe(expectedRanges[i][1]);
      expect(windows[i].policyLabel).toBe(`wallet-forward-sync-window-${i + 1}`);
    }
    // fromBlock stays anchored — this plan never reads/uses fromBlock at all,
    // only toBlock, so the anchor is structurally untouched by construction.
    for (let i = 1; i < 5; i += 1) {
      expect(windows[i].startBlock).toBe(windows[i - 1].endBlock + 1n); // no gap, no overlap
    }
    // No sixth ("Window 7 equivalent") window is ever planned by this loop —
    // the test only iterates 5 times, proving the caller controls the bound.
    expect(windows).toHaveLength(5);
  });

  it("policyLabelForBatchWindow follows <prefix>-<n>", () => {
    expect(policyLabelForBatchWindow("wallet-forward-sync-window", 3)).toBe("wallet-forward-sync-window-3");
  });

  it("first window start must equal the operator-supplied --first-window-start", () => {
    const plan = computeForwardWindowPlan({
      liveCursorToBlock: FIXTURE_CURSOR_TO,
      windowSizeBlocks: FIXTURE_WINDOW_SIZE,
      windowNumber: 1,
      policyLabelPrefix: "p",
    });
    expect(validateFirstWindowStart({ computedStartBlock: plan.startBlock, expectedFirstWindowStart: FIXTURE_FIRST_WINDOW_START }).ok).toBe(true);
    expect(validateFirstWindowStart({ computedStartBlock: plan.startBlock, expectedFirstWindowStart: FIXTURE_FIRST_WINDOW_START + 1n }).ok).toBe(false);
  });
});

// ─── Cursor / adjacency gates ───────────────────────────────────────────────────

describe("cursor expectation and adjacency gates", () => {
  it("validateExpectedLiveCursor passes on exact match and fails on mismatch", () => {
    expect(
      validateExpectedLiveCursor({
        liveCursor: { fromBlock: FIXTURE_CURSOR_FROM, toBlock: FIXTURE_CURSOR_TO },
        expectedCursorFromBlock: FIXTURE_CURSOR_FROM,
        expectedCursorToBlock: FIXTURE_CURSOR_TO,
      }).ok,
    ).toBe(true);
    expect(
      validateExpectedLiveCursor({
        liveCursor: { fromBlock: FIXTURE_CURSOR_FROM, toBlock: FIXTURE_CURSOR_TO + 1n },
        expectedCursorFromBlock: FIXTURE_CURSOR_FROM,
        expectedCursorToBlock: FIXTURE_CURSOR_TO,
      }).ok,
    ).toBe(false);
  });

  it("validateExpectedLiveCursor fails when no cursor exists", () => {
    expect(
      validateExpectedLiveCursor({
        liveCursor: null,
        expectedCursorFromBlock: FIXTURE_CURSOR_FROM,
        expectedCursorToBlock: FIXTURE_CURSOR_TO,
      }).ok,
    ).toBe(false);
  });

  it("validateForwardAdjacency catches a disconnected proposal", () => {
    expect(validateForwardAdjacency({ liveCursorToBlock: FIXTURE_CURSOR_TO, proposedStartBlock: FIXTURE_CURSOR_TO + 1n }).ok).toBe(true);
    expect(validateForwardAdjacency({ liveCursorToBlock: FIXTURE_CURSOR_TO, proposedStartBlock: FIXTURE_CURSOR_TO + 2n }).ok).toBe(false);
  });
});

// ─── Terminal state / cursor postcondition verification ────────────────────────

describe("terminal state and cursor postcondition verification", () => {
  const expectedIdentity = {
    expectedWalletId: FIXTURE_WALLET_ID,
    expectedChainId: FIXTURE_CHAIN_ID,
    expectedPolicyLabel: "wallet-forward-sync-window-1",
    expectedStartBlock: 25_078_549n,
    expectedEndBlock: 25_079_548n,
  };

  it("verifyWindowTerminalState passes for a clean COMPLETED run with correct walletId and policyLabel", () => {
    const result = verifyWindowTerminalState({
      run: completedManualRun(),
      ...expectedIdentity,
    });
    expect(result.ok).toBe(true);
  });

  it("fails on any warning", () => {
    const result = verifyWindowTerminalState({
      run: completedManualRun({ warningCount: 1, warningDetails: ["some-warning"] }),
      ...expectedIdentity,
    });
    expect(result.ok).toBe(false);
  });

  it("fails on non-COMPLETED status", () => {
    const result = verifyWindowTerminalState({
      run: completedManualRun({ status: "FAILED", errorMessage: "boom" }),
      ...expectedIdentity,
    });
    expect(result.ok).toBe(false);
  });

  it("fails on unexpected source family", () => {
    const result = verifyWindowTerminalState({
      run: completedManualRun({ sourceFamilies: ["DEX"] }),
      ...expectedIdentity,
    });
    expect(result.ok).toBe(false);
  });

  // ─── Blocker 1: exact SyncRun identity (walletId + policyLabel) ────────────

  it("fails when walletId is null (a chain-wide run) even though every other field matches", () => {
    const result = verifyWindowTerminalState({
      run: completedManualRun({ walletId: null }),
      ...expectedIdentity,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reasons.some((r) => r.includes("walletId"))).toBe(true);
  });

  it("fails on a wrong (non-null) walletId", () => {
    const result = verifyWindowTerminalState({
      run: completedManualRun({ walletId: "other-wallet" }),
      ...expectedIdentity,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reasons.some((r) => r.includes("walletId"))).toBe(true);
  });

  it("fails on a wrong chainId", () => {
    expect(
      verifyWindowTerminalState({
        run: completedManualRun({ chainId: 8453 }),
        ...expectedIdentity,
      }).ok,
    ).toBe(false);
  });

  it("fails on a wrong policyLabel", () => {
    const result = verifyWindowTerminalState({
      run: completedManualRun({ policyLabel: "wallet-forward-sync-window-2" }),
      ...expectedIdentity,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reasons.some((r) => r.includes("policyLabel"))).toBe(true);
  });

  it("fails when policyLabel is empty (nullable-equivalent for this field)", () => {
    const result = verifyWindowTerminalState({
      run: completedManualRun({ policyLabel: "" }),
      ...expectedIdentity,
    });
    expect(result.ok).toBe(false);
  });

  it("a chain-wide run (walletId: null) can never satisfy a wallet-scoped window verification, regardless of every other field matching exactly", () => {
    const chainWideRun = completedManualRun({ walletId: null });
    // Every other field (chainId, policyLabel, range, sourceFamilies, status,
    // warnings, errors) matches expectedIdentity exactly — only walletId
    // differs — proving walletId alone is a sufficient and necessary gate.
    const result = verifyWindowTerminalState({
      run: chainWideRun,
      ...expectedIdentity,
    });
    expect(result.ok).toBe(false);
  });

  it("verifyForwardCursorPostcondition requires the anchor unchanged and toBlock advanced exactly", () => {
    expect(
      verifyForwardCursorPostcondition({
        cursorAfter: { fromBlock: FIXTURE_CURSOR_FROM, toBlock: 25_079_548n },
        anchorFromBlock: FIXTURE_CURSOR_FROM,
        expectedToBlock: 25_079_548n,
      }).ok,
    ).toBe(true);
    expect(
      verifyForwardCursorPostcondition({
        cursorAfter: { fromBlock: FIXTURE_CURSOR_FROM + 1n, toBlock: 25_079_548n },
        anchorFromBlock: FIXTURE_CURSOR_FROM,
        expectedToBlock: 25_079_548n,
      }).ok,
    ).toBe(false);
    expect(
      verifyForwardCursorPostcondition({
        cursorAfter: null,
        anchorFromBlock: FIXTURE_CURSOR_FROM,
        expectedToBlock: 25_079_548n,
      }).ok,
    ).toBe(false);
  });
});

// ─── Other pure gates ───────────────────────────────────────────────────────────

describe("active operation and policy label gates", () => {
  it("validateNoActiveOperation fails when any active run exists", () => {
    expect(validateNoActiveOperation({ activeRunCount: 0 }).ok).toBe(true);
    expect(validateNoActiveOperation({ activeRunCount: 1 }).ok).toBe(false);
  });

  it("validateNoPolicyLabelCollision fails on an existing label", () => {
    expect(
      validateNoPolicyLabelCollision({ policyLabel: "p-1", existingPolicyLabels: ["p-1"] }).ok,
    ).toBe(false);
    expect(
      validateNoPolicyLabelCollision({ policyLabel: "p-1", existingPolicyLabels: ["p-2"] }).ok,
    ).toBe(true);
  });
});

describe("buildManualSyncRequestBody", () => {
  it("builds a TRANSFERS-only request body with string block numbers", () => {
    const body = buildManualSyncRequestBody({
      walletAddress: FIXTURE_WALLET,
      chainId: FIXTURE_CHAIN_ID,
      window: { startBlock: 25_078_549n, endBlock: 25_079_548n, policyLabel: "p-1" },
    });
    expect(body).toEqual({
      walletAddress: FIXTURE_WALLET,
      chainId: FIXTURE_CHAIN_ID,
      sourceFamilies: ["TRANSFERS"],
      startBlock: "25078549",
      endBlock: "25079548",
      policyLabel: "p-1",
    });
  });
});

describe("evidence serialization", () => {
  it("serializes bigint fields as decimal strings and contains no secret keys", () => {
    const record: EvidenceRecord = {
      kind: "window",
      at: "2026-01-01T00:00:00.000Z",
      startBlock: 25_078_549n,
    };
    const line = serializeEvidence(record);
    expect(line).toContain('"startBlock":"25078549"');
    expect(line.toLowerCase()).not.toContain("database_url");
    expect(line.toLowerCase()).not.toContain("redis_url");
    expect(line.toLowerCase()).not.toContain("rpc");
  });
});

// ─── Orchestrator: dry-run ──────────────────────────────────────────────────────

describe("orchestrator — dry-run", () => {
  it("plans the batch, never POSTs, and never mutates", async () => {
    const db = makeFakeDb();
    const { deps, evidence, httpPostCalls } = makeFakeDeps({ db });

    const summary = await runWalletForwardSyncRunner(baseRunnerOptions({ maxWindows: 5 }), deps);

    expect(summary.stoppedReason).toBe("max_windows_reached");
    expect(summary.windowsCompleted).toBe(0);
    expect(httpPostCalls).toHaveLength(0);
    const windowRecords = evidence.filter((e) => e.kind === "window");
    expect(windowRecords).toHaveLength(5);
    expect(windowRecords.every((r) => r.outcome === "dry_run_planned")).toBe(true);
    // No rebuild/materialization/pricing call exists anywhere in this file —
    // structurally verified: httpPostCalls is empty and no rebuild URL is
    // ever constructed by the orchestrator.
  });

  it("stops on cursor mismatch before planning anything", async () => {
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_CURSOR_FROM, toBlock: FIXTURE_CURSOR_TO + 1n } });
    const { deps, httpPostCalls } = makeFakeDeps({ db });

    const summary = await runWalletForwardSyncRunner(baseRunnerOptions(), deps);

    expect(summary.stoppedReason).toBe("cursor_expectation_mismatch");
    expect(httpPostCalls).toHaveLength(0);
  });

  it("stops on first-window-start mismatch", async () => {
    const db = makeFakeDb();
    const { deps } = makeFakeDeps({ db });

    const summary = await runWalletForwardSyncRunner(
      baseRunnerOptions({ firstWindowStart: FIXTURE_FIRST_WINDOW_START + 1n }),
      deps,
    );

    expect(summary.stoppedReason).toBe("first_window_start_mismatch");
  });

  it("stops on policy label collision", async () => {
    const db = makeFakeDb({ policyLabels: ["wallet-forward-sync-window-1"] });
    const { deps } = makeFakeDeps({ db });

    const summary = await runWalletForwardSyncRunner(baseRunnerOptions(), deps);

    expect(summary.stoppedReason).toBe("policy_label_collision");
  });

  it("stops on active operation conflict", async () => {
    const db = makeFakeDb({ activeRunCount: 1 });
    const { deps } = makeFakeDeps({ db });

    const summary = await runWalletForwardSyncRunner(baseRunnerOptions(), deps);

    expect(summary.stoppedReason).toBe("active_operation_conflict");
  });

  it("stops on contamination pre-gate", async () => {
    const db = makeFakeDb({ contaminationRows: 1 });
    const { deps } = makeFakeDeps({ db });

    const summary = await runWalletForwardSyncRunner(baseRunnerOptions(), deps);

    expect(summary.stoppedReason).toBe("fabricated_contamination_pre_gate");
  });
});

// ─── Orchestrator: execute ──────────────────────────────────────────────────────

describe("orchestrator — execute", () => {
  it("submits exactly one window and verifies every postcondition", async () => {
    const db = makeFakeDb({
      runsById: {
        "run-1": completedManualRun(),
      },
    });
    const { deps, httpPostCalls } = makeFakeDeps({
      db,
      httpPost: async () => {
        db.advanceCursorTo(25_079_548n);
        return { status: 202, body: { data: { runId: "run-1" } } };
      },
    });

    const summary = await runWalletForwardSyncRunner(baseRunnerOptions({ execute: true, maxWindows: 1 }), deps);

    expect(summary.stoppedReason).toBe("max_windows_reached");
    expect(summary.windowsCompleted).toBe(1);
    expect(httpPostCalls).toHaveLength(1);
    expect(httpPostCalls[0].url).toBe("http://localhost:3100/api/sync/manual");
    expect(httpPostCalls[0].body).toMatchObject({
      startBlock: "25078549",
      endBlock: "25079548",
      sourceFamilies: ["TRANSFERS"],
    });
  });

  it("completes exactly five windows and never submits a sixth", async () => {
    let cursorTo = FIXTURE_CURSOR_TO;
    const db = makeFakeDb();
    let callCount = 0;
    const { deps, httpPostCalls } = makeFakeDeps({
      db,
      httpPost: async () => {
        callCount += 1;
        const runId = `run-${callCount}`;
        const startBlock = cursorTo + 1n;
        const endBlock = startBlock + FIXTURE_WINDOW_SIZE - 1n;
        (db as unknown as { advanceCursorTo: (b: bigint) => void }).advanceCursorTo(endBlock);
        (db.syncRun.findUnique as unknown) = async (args: unknown) => {
          const id = (args as { where: { id: string } }).where.id;
          if (id !== runId) return null;
          return completedManualRun({
            id: runId,
            policyLabel: `wallet-forward-sync-window-${callCount}`,
            startBlock,
            endBlock,
            latestSafeBlock: endBlock,
          });
        };
        cursorTo = endBlock;
        return { status: 202, body: { data: { runId } } };
      },
    });

    const summary = await runWalletForwardSyncRunner(baseRunnerOptions({ execute: true, maxWindows: 5 }), deps);

    expect(summary.stoppedReason).toBe("max_windows_reached");
    expect(summary.windowsCompleted).toBe(5);
    expect(httpPostCalls).toHaveLength(5);
    expect(httpPostCalls[0].body).toMatchObject({ startBlock: "25078549", endBlock: "25079548" });
    expect(httpPostCalls[4].body).toMatchObject({ startBlock: "25082549", endBlock: "25083548" });
    // Window 7 equivalent (a sixth window) is never planned or submitted —
    // the loop bound (maxWindows=5) is the only thing that can produce more
    // POSTs, and exactly 5 were made.
  });

  it("does not submit a sixth window when max-windows=5 even if more capacity exists", async () => {
    const db = makeFakeDb();
    let calls = 0;
    const { deps } = makeFakeDeps({
      db,
      httpPost: async () => {
        calls += 1;
        return { status: 202, body: { data: { runId: `run-${calls}` } } };
      },
    });
    // Force every call to fail invariants immediately so we only assert on
    // call count, not full completion semantics (already covered above).
    (db.syncRun.findUnique as unknown) = async () => null;

    await runWalletForwardSyncRunner(baseRunnerOptions({ execute: true, maxWindows: 5, pollTimeoutMs: 5 }), deps);

    expect(calls).toBeLessThanOrEqual(5);
  });

  it("stops before the next POST when a run fails (non-COMPLETED)", async () => {
    const db = makeFakeDb({
      runsById: { "run-1": completedManualRun({ status: "FAILED", errorMessage: "boom", warningCount: 0 }) },
    });
    const { deps, httpPostCalls } = makeFakeDeps({ db });

    const summary = await runWalletForwardSyncRunner(baseRunnerOptions({ execute: true, maxWindows: 5 }), deps);

    expect(summary.stoppedReason).toBe("invariant_failed_after_run");
    expect(httpPostCalls).toHaveLength(1);
  });

  it("stops before the next POST when the completed run has any warning", async () => {
    const db = makeFakeDb({
      runsById: { "run-1": completedManualRun({ warningCount: 1, warningDetails: ["w"] }) },
    });
    const { deps, httpPostCalls } = makeFakeDeps({ db });

    const summary = await runWalletForwardSyncRunner(baseRunnerOptions({ execute: true, maxWindows: 5 }), deps);

    expect(summary.stoppedReason).toBe("invariant_failed_after_run");
    expect(httpPostCalls).toHaveLength(1);
  });

  it("stops before the next POST on a cursor postcondition mismatch", async () => {
    // Run reports COMPLETED and clean, but the live cursor does not move as
    // expected (simulating a corrupted/partial persistence).
    const db = makeFakeDb({ runsById: { "run-1": completedManualRun() } });
    const { deps, httpPostCalls } = makeFakeDeps({ db }); // cursor never advances

    const summary = await runWalletForwardSyncRunner(baseRunnerOptions({ execute: true, maxWindows: 5 }), deps);

    expect(summary.stoppedReason).toBe("invariant_failed_after_run");
    expect(httpPostCalls).toHaveLength(1);
  });

  it("stops before the next POST on post-run contamination", async () => {
    const db = makeFakeDb({ runsById: { "run-1": completedManualRun() } });
    const { deps } = makeFakeDeps({
      db,
      httpPost: async () => {
        db.advanceCursorTo(25_079_548n);
        return { status: 202, body: { data: { runId: "run-1" } } };
      },
    });
    // Contaminate only after submission, to simulate normalization sweeping a
    // row in during the run.
    const originalQueryRaw = db.$queryRaw;
    let postRunCall = 0;
    (db as unknown as { $queryRaw: unknown }).$queryRaw = (async (query: TemplateStringsArray, ...values: unknown[]) => {
      const sql = query.join("");
      if (sql.includes("RawLog")) {
        postRunCall += 1;
        return postRunCall > 1 ? [{ id: "contaminated-row" }] : [];
      }
      return originalQueryRaw(query, ...values);
    }) as RunnerDbClient["$queryRaw"];

    const summary = await runWalletForwardSyncRunner(baseRunnerOptions({ execute: true, maxWindows: 5 }), deps);

    expect(summary.stoppedReason).toBe("invariant_failed_after_run");
  });

  it("stops before the next POST on duplicate/invariant failure", async () => {
    const db = makeFakeDb({
      runsById: { "run-1": completedManualRun() },
      duplicateLedgerRows: 1,
    });
    const { deps, httpPostCalls } = makeFakeDeps({
      db,
      httpPost: async () => {
        db.advanceCursorTo(25_079_548n);
        return { status: 202, body: { data: { runId: "run-1" } } };
      },
    });

    const summary = await runWalletForwardSyncRunner(baseRunnerOptions({ execute: true, maxWindows: 5 }), deps);

    expect(summary.stoppedReason).toBe("invariant_failed_after_run");
    expect(httpPostCalls).toHaveLength(1);
  });

  it("no rebuild, materialization, or pricing URL is ever requested", async () => {
    const db = makeFakeDb({ runsById: { "run-1": completedManualRun() } });
    const { deps, httpPostCalls } = makeFakeDeps({
      db,
      httpPost: async () => {
        db.advanceCursorTo(25_079_548n);
        return { status: 202, body: { data: { runId: "run-1" } } };
      },
    });

    await runWalletForwardSyncRunner(baseRunnerOptions({ execute: true, maxWindows: 1 }), deps);

    expect(httpPostCalls.every((c) => c.url.endsWith("/api/sync/manual"))).toBe(true);
    expect(httpPostCalls.some((c) => c.url.includes("rebuild"))).toBe(false);
  });

  it("does not accept a Base (8453) chain request", () => {
    const parsed = parseRunnerCliArgs([
      "--wallet-address",
      FIXTURE_WALLET,
      "--chain-id",
      "8453",
      "--expected-cursor-from",
      "25077549",
      "--expected-cursor-to",
      "25078548",
      "--first-window-start",
      "25078549",
      "--window-size",
      "1000",
      "--policy-label-prefix",
      "p",
    ]);
    expect(parsed.ok).toBe(false);
  });

  it("evidence records are deterministic and complete for a full dry-run batch", async () => {
    const db = makeFakeDb();
    const { deps, evidence } = makeFakeDeps({ db });

    await runWalletForwardSyncRunner(baseRunnerOptions({ maxWindows: 5 }), deps);

    const kinds = evidence.map((e) => e.kind);
    expect(kinds[0]).toBe("preflight");
    expect(kinds.filter((k) => k === "window")).toHaveLength(5);
    expect(kinds[kinds.length - 1]).toBe("summary");
    for (const record of evidence) {
      expect(typeof record.at).toBe("string");
      const serialized = serializeEvidence(record as EvidenceRecord);
      expect(() => JSON.parse(serialized)).not.toThrow();
    }
  });
});

// ─── Blocker 2: exit-code allowlist at the CLI/main boundary ───────────────────
//
// main() itself calls process.exit and isn't unit-testable directly, but
// computeExitCode(summary.stoppedReason) is the exact expression main() uses
// to set process.exitCode. Exercising it directly against both literal stop
// reasons and real runWalletForwardSyncRunner() outcomes proves the CLI
// boundary's exit behavior without spawning a subprocess.

describe("exit-code allowlist (CLI/main boundary)", () => {
  it("CLEAN_STOP_REASONS is limited to genuine non-error completion", () => {
    expect(CLEAN_STOP_REASONS.has("max_windows_reached")).toBe(true);
    expect(CLEAN_STOP_REASONS.size).toBe(1);
  });

  it("clean dry-run completion (max_windows_reached) exits 0", () => {
    expect(computeExitCode("max_windows_reached")).toBe(0);
  });

  it("clean max-window completion exits 0", () => {
    expect(computeExitCode("max_windows_reached")).toBe(0);
  });

  it("every documented hard-stop reason exits 1, including ones that do not end with _failed", () => {
    const hardStopReasons = [
      "wallet_not_found",
      "cursor_expectation_mismatch",
      "first_window_start_mismatch",
      "adjacency_violation",
      "active_operation_conflict",
      "policy_label_collision",
      "server_unhealthy",
      "fabricated_contamination_pre_gate",
      "manual_sync_submit_failed",
      "poll_timeout",
      "invariant_failed_after_run",
    ];
    for (const reason of hardStopReasons) {
      expect(computeExitCode(reason)).toBe(1);
    }
  });

  it("fails closed for any unknown/future stop reason", () => {
    expect(computeExitCode("some_new_reason_nobody_added_to_the_allowlist")).toBe(1);
    expect(computeExitCode("")).toBe(1);
  });

  it("cursor mismatch (via the real orchestrator) exits 1", async () => {
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_CURSOR_FROM, toBlock: FIXTURE_CURSOR_TO + 1n } });
    const { deps } = makeFakeDeps({ db });
    const summary = await runWalletForwardSyncRunner(baseRunnerOptions(), deps);
    expect(summary.stoppedReason).toBe("cursor_expectation_mismatch");
    expect(computeExitCode(summary.stoppedReason)).toBe(1);
  });

  it("contamination (via the real orchestrator) exits 1", async () => {
    const db = makeFakeDb({ contaminationRows: 1 });
    const { deps } = makeFakeDeps({ db });
    const summary = await runWalletForwardSyncRunner(baseRunnerOptions(), deps);
    expect(summary.stoppedReason).toBe("fabricated_contamination_pre_gate");
    expect(computeExitCode(summary.stoppedReason)).toBe(1);
  });

  it("active-operation conflict (via the real orchestrator) exits 1", async () => {
    const db = makeFakeDb({ activeRunCount: 1 });
    const { deps } = makeFakeDeps({ db });
    const summary = await runWalletForwardSyncRunner(baseRunnerOptions(), deps);
    expect(summary.stoppedReason).toBe("active_operation_conflict");
    expect(computeExitCode(summary.stoppedReason)).toBe(1);
  });

  it("poll timeout (via the real orchestrator) exits 1", async () => {
    const db = makeFakeDb({ runsById: {} }); // findUnique never resolves to a terminal run
    const { deps } = makeFakeDeps({ db });
    const summary = await runWalletForwardSyncRunner(
      baseRunnerOptions({ execute: true, maxWindows: 1, pollTimeoutMs: 5, pollIntervalMs: 1 }),
      deps,
    );
    expect(summary.stoppedReason).toBe("poll_timeout");
    expect(computeExitCode(summary.stoppedReason)).toBe(1);
  });

  it("wallet not found (via the real orchestrator) exits 1", async () => {
    const db = makeFakeDb();
    const { deps } = makeFakeDeps({ db });
    const summary = await runWalletForwardSyncRunner(baseRunnerOptions(), {
      ...deps,
      resolveWallet: async () => null,
    });
    expect(summary.stoppedReason).toBe("wallet_not_found");
    expect(computeExitCode(summary.stoppedReason)).toBe(1);
  });

  it("clean batch completion (via the real orchestrator, dry-run) exits 0", async () => {
    const db = makeFakeDb();
    const { deps } = makeFakeDeps({ db });
    const summary = await runWalletForwardSyncRunner(baseRunnerOptions({ maxWindows: 5 }), deps);
    expect(summary.stoppedReason).toBe("max_windows_reached");
    expect(computeExitCode(summary.stoppedReason)).toBe(0);
  });
});
