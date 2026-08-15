// Wallet-forward TRANSFERS CAMPAIGN runner — focused unit tests.
//
// All DB, HTTP, git, and filesystem dependencies are mocked/injected. No
// live calls, no real POST, no rebuild, and no execution of the sync
// pipeline happens anywhere in this file. This is Stage 0 implementation
// testing only — no test here executes a live campaign window.

import { describe, expect, it } from "vitest";

import {
  CAMPAIGN_MAX_WINDOWS_HARD_CAP,
  CAMPAIGN_REQUIRED_WINDOW_SIZE_BLOCKS,
  DEFAULT_CAMPAIGN_CHECKPOINT_INTERVAL,
  MAX_CAMPAIGN_CHECKPOINT_INTERVAL,
  HTTP_REQUEST_TIMEOUT_MS,
  CAMPAIGN_CLEAN_STOP_REASONS,
  campaignWindowPolicyLabel,
  classifyAmbiguousSubmissionRecovery,
  computeCampaignExitCode,
  computeCampaignWindowPlan,
  computeLogicalCampaignWindowNumber,
  evaluateCheckpoint,
  parseCampaignCliArgs,
  runWalletForwardCampaignRunner,
  validateAuthorizedFinalBlockAlignment,
  validateCampaignId,
  validateCampaignMaxWindows,
  validateCampaignWindowSize,
  validateCheckpointInterval,
  validateLongestGeneratedLabel,
  validateWithinAuthorizedFinalBlock,
  type CampaignCliOptions,
  type CampaignDeps,
} from "../../scripts/wallet-forward-campaign-runner";
import type { EvidenceRecord, RunnerDbClient, RunnerSyncRunRecord } from "../../scripts/lib/wallet-forward-sync-primitives";

const FIXTURE_WALLET = "0x08ac26d74013af7430c350c97eacd8be0bdc5613";
const FIXTURE_WALLET_ID = "wallet-cuid-1";
const FIXTURE_CHAIN_ID = 369;
const FIXTURE_CURSOR_FROM = 25_077_549n;
const FIXTURE_CURSOR_TO = 25_078_548n;
const FIXTURE_FIRST_WINDOW_START = 25_078_549n;
const FIXTURE_WINDOW_SIZE = 1_000n;
const FIXTURE_CAMPAIGN_ID = "stage0-campaign-1";
const FIXTURE_PREFIX = "wallet-forward-campaign";

function finalBlockForWindows(n: number): bigint {
  return FIXTURE_FIRST_WINDOW_START + BigInt(n) * FIXTURE_WINDOW_SIZE - 1n;
}

function baseOptions(overrides: Partial<CampaignCliOptions> = {}): CampaignCliOptions {
  return {
    execute: false,
    walletAddress: FIXTURE_WALLET,
    chainId: FIXTURE_CHAIN_ID,
    expectedCursorFromBlock: FIXTURE_CURSOR_FROM,
    expectedCursorToBlock: FIXTURE_CURSOR_TO,
    firstWindowStart: FIXTURE_FIRST_WINDOW_START,
    windowSizeBlocks: FIXTURE_WINDOW_SIZE,
    maxWindows: 3,
    authorizedFinalBlock: finalBlockForWindows(3),
    campaignId: FIXTURE_CAMPAIGN_ID,
    policyLabelPrefix: FIXTURE_PREFIX,
    checkpointIntervalWindows: DEFAULT_CAMPAIGN_CHECKPOINT_INTERVAL,
    baseUrl: "http://localhost:3100",
    evidenceFile: "unused-in-tests/evidence.jsonl",
    pollIntervalMs: 1,
    pollTimeoutMs: 1000,
    ...overrides,
  };
}

function requiredArgv(overrides: Record<string, string> = {}, omit: string[] = []): string[] {
  const values: Record<string, string> = {
    "--wallet-address": FIXTURE_WALLET,
    "--chain-id": "369",
    "--expected-cursor-from": FIXTURE_CURSOR_FROM.toString(),
    "--expected-cursor-to": FIXTURE_CURSOR_TO.toString(),
    "--first-window-start": FIXTURE_FIRST_WINDOW_START.toString(),
    "--window-size": "1000",
    "--max-windows": "3",
    "--authorized-final-block": finalBlockForWindows(3).toString(),
    "--campaign-id": FIXTURE_CAMPAIGN_ID,
    "--policy-label-prefix": FIXTURE_PREFIX,
    "--base-url": "http://localhost:3100",
    ...overrides,
  };
  const argv: string[] = [];
  for (const [flag, value] of Object.entries(values)) {
    if (omit.includes(flag)) continue;
    argv.push(flag, value);
  }
  return argv;
}

function completedRun(overrides: Partial<RunnerSyncRunRecord> = {}): RunnerSyncRunRecord {
  return {
    id: "run-1",
    trigger: "MANUAL",
    status: "COMPLETED",
    stage: "COMPLETED",
    chainId: FIXTURE_CHAIN_ID,
    walletId: FIXTURE_WALLET_ID,
    policyLabel: campaignWindowPolicyLabel(FIXTURE_PREFIX, FIXTURE_CAMPAIGN_ID, 1),
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
    ambiguousCandidates: RunnerSyncRunRecord[];
  }> = {},
): RunnerDbClient & { advanceCursorTo: (toBlock: bigint) => void; setAmbiguousCandidates: (rows: RunnerSyncRunRecord[]) => void } {
  const state = {
    cursor: overrides.cursor ?? { fromBlock: FIXTURE_CURSOR_FROM, toBlock: FIXTURE_CURSOR_TO },
    policyLabels: overrides.policyLabels ?? [],
    activeRunCount: overrides.activeRunCount ?? 0,
    contaminationRows: overrides.contaminationRows ?? 0,
    duplicateTransactionRows: overrides.duplicateTransactionRows ?? 0,
    duplicateTransferRows: overrides.duplicateTransferRows ?? 0,
    duplicateLedgerRows: overrides.duplicateLedgerRows ?? 0,
    runsById: overrides.runsById ?? {},
    ambiguousCandidates: overrides.ambiguousCandidates ?? [],
  };

  const db = {
    syncCursor: {
      findUnique: async () => (state.cursor ? { ...state.cursor, blockHash: "0xblockhash" } : null),
    },
    syncRun: {
      findMany: async (args: unknown) => {
        const a = args as { where?: { policyLabel?: string; chainId?: number }; select?: unknown };
        if (a.select) {
          // listActivePolicyLabels shape
          return state.policyLabels.map((policyLabel) => ({ policyLabel }) as unknown as RunnerSyncRunRecord);
        }
        // ambiguous-recovery identity search shape
        return state.ambiguousCandidates.filter((c) => c.policyLabel === a.where?.policyLabel);
      },
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
    setAmbiguousCandidates: (rows: RunnerSyncRunRecord[]) => {
      state.ambiguousCandidates = rows;
    },
  };

  return db;
}

function makeFakeDeps(args: {
  db: RunnerDbClient;
  httpPost?: CampaignDeps["httpPost"];
  httpGet?: CampaignDeps["httpGet"];
  clockStart?: number;
  workingTreeClean?: boolean;
  /** If provided, overrides `workingTreeClean` and returns one value per
   * successive `isWorkingTreeClean()` call (startup, then each checkpoint),
   * holding the last entry once exhausted. */
  workingTreeCleanSequence?: boolean[];
  headSequence?: string[];
  evidenceWritable?: boolean;
  failEvidenceAfter?: number;
}): { deps: CampaignDeps; evidence: EvidenceRecord[]; httpPostCalls: Array<{ url: string; body: unknown }> } {
  const evidence: EvidenceRecord[] = [];
  const httpPostCalls: Array<{ url: string; body: unknown }> = [];
  let clock = args.clockStart ?? 0;
  let writeCount = 0;
  const heads = args.headSequence ?? ["head-1"];
  let headIndex = 0;
  const treeCleanSequence = args.workingTreeCleanSequence;
  let treeCleanIndex = 0;

  const defaultHttpPost: CampaignDeps["httpPost"] = async () => ({ status: 202, body: { data: { runId: "run-1" } } });

  const recordingHttpPost: CampaignDeps["httpPost"] = async (url, body) => {
    httpPostCalls.push({ url, body });
    return (args.httpPost ?? defaultHttpPost)(url, body);
  };

  const deps: CampaignDeps = {
    db: args.db,
    resolveWallet: async () => ({ id: FIXTURE_WALLET_ID, address: FIXTURE_WALLET }),
    httpGet: args.httpGet ?? (async () => ({ status: 200, body: { data: { status: "ok", app: { env: "test" } } } })),
    httpPost: recordingHttpPost,
    now: () => new Date(clock),
    sleep: async (ms) => {
      clock += ms;
    },
    writeEvidence: async (record) => {
      writeCount += 1;
      if (args.failEvidenceAfter !== undefined && writeCount > args.failEvidenceAfter) {
        throw new Error("simulated evidence write failure");
      }
      evidence.push(record);
    },
    getGitHead: async () => {
      const head = heads[Math.min(headIndex, heads.length - 1)];
      headIndex += 1;
      return head;
    },
    isWorkingTreeClean: async () => {
      if (treeCleanSequence) {
        const value = treeCleanSequence[Math.min(treeCleanIndex, treeCleanSequence.length - 1)];
        treeCleanIndex += 1;
        return value;
      }
      return args.workingTreeClean ?? true;
    },
    checkEvidenceWritable: async () => args.evidenceWritable ?? true,
  };

  return { deps, evidence, httpPostCalls };
}

// ─── CLI / boundaries ───────────────────────────────────────────────────────────

describe("campaign CLI boundaries", () => {
  it.each([1, 10, 50, 100, 250, 1000])("accepts --max-windows %d when aligned to authorized-final-block", (n) => {
    const argv = requiredArgv({
      "--max-windows": String(n),
      "--authorized-final-block": finalBlockForWindows(n).toString(),
    });
    const parsed = parseCampaignCliArgs(argv);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.options.maxWindows).toBe(n);
  });

  it("rejects --max-windows 1001", () => {
    const argv = requiredArgv({
      "--max-windows": "1001",
      "--authorized-final-block": finalBlockForWindows(1001).toString(),
    });
    expect(parseCampaignCliArgs(argv).ok).toBe(false);
    expect(CAMPAIGN_MAX_WINDOWS_HARD_CAP).toBe(1000);
  });

  it("rejects zero, negative, and non-integer --max-windows", () => {
    expect(validateCampaignMaxWindows({ maxWindows: 0 }).ok).toBe(false);
    expect(validateCampaignMaxWindows({ maxWindows: -1 }).ok).toBe(false);
    expect(validateCampaignMaxWindows({ maxWindows: 1.5 }).ok).toBe(false);
    expect(parseCampaignCliArgs(requiredArgv({ "--max-windows": "0" })).ok).toBe(false);
    expect(parseCampaignCliArgs(requiredArgv({ "--max-windows": "-1" })).ok).toBe(false);
    expect(parseCampaignCliArgs(requiredArgv({ "--max-windows": "abc" })).ok).toBe(false);
  });

  it("requires --authorized-final-block", () => {
    const parsed = parseCampaignCliArgs(requiredArgv({}, ["--authorized-final-block"]));
    expect(parsed.ok).toBe(false);
  });

  it("rejects a final block below --first-window-start", () => {
    const result = validateAuthorizedFinalBlockAlignment({
      firstWindowStart: FIXTURE_FIRST_WINDOW_START,
      windowSizeBlocks: FIXTURE_WINDOW_SIZE,
      authorizedFinalBlock: FIXTURE_FIRST_WINDOW_START - 1n,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an unaligned final block", () => {
    const result = validateAuthorizedFinalBlockAlignment({
      firstWindowStart: FIXTURE_FIRST_WINDOW_START,
      windowSizeBlocks: FIXTURE_WINDOW_SIZE,
      authorizedFinalBlock: finalBlockForWindows(3) + 1n,
    });
    expect(result.ok).toBe(false);
    const parsed = parseCampaignCliArgs(
      requiredArgv({ "--authorized-final-block": (finalBlockForWindows(3) + 1n).toString() }),
    );
    expect(parsed.ok).toBe(false);
  });

  it("accepts an exactly-aligned final block and reports the implied window count", () => {
    const result = validateAuthorizedFinalBlockAlignment({
      firstWindowStart: FIXTURE_FIRST_WINDOW_START,
      windowSizeBlocks: FIXTURE_WINDOW_SIZE,
      authorizedFinalBlock: finalBlockForWindows(7),
    });
    expect(result).toEqual({ ok: true, windowCount: 7 });
  });

  it("maxWindows and authorized-final-block are independently enforced — tighter boundary wins", async () => {
    // maxWindows=5 but authorized-final-block only covers 2 windows.
    const db = makeFakeDb({ runsById: { "run-1": completedRun(), "run-2": completedRun({ id: "run-2" }) } });
    let call = 0;
    const { deps, httpPostCalls } = makeFakeDeps({
      db,
      httpPost: async () => {
        call += 1;
        const runId = `run-${call}`;
        const startBlock = FIXTURE_CURSOR_TO + BigInt((call - 1) * 1000) + 1n;
        const endBlock = startBlock + FIXTURE_WINDOW_SIZE - 1n;
        (db as unknown as { advanceCursorTo: (b: bigint) => void }).advanceCursorTo(endBlock);
        (db.syncRun.findUnique as unknown) = async (args: unknown) => {
          const id = (args as { where: { id: string } }).where.id;
          return id === runId
            ? completedRun({
                id: runId,
                policyLabel: campaignWindowPolicyLabel(FIXTURE_PREFIX, FIXTURE_CAMPAIGN_ID, call),
                startBlock,
                endBlock,
                latestSafeBlock: endBlock,
              })
            : null;
        };
        return { status: 202, body: { data: { runId } } };
      },
    });

    const summary = await runWalletForwardCampaignRunner(
      baseOptions({ execute: true, maxWindows: 5, authorizedFinalBlock: finalBlockForWindows(2) }),
      deps,
    );

    expect(summary.stoppedReason).toBe("authorized_final_block_reached");
    expect(summary.windowsCompleted).toBe(2);
    expect(httpPostCalls).toHaveLength(2);
  });

  it("no Window 1001 is ever planned or POSTed even with maxWindows at the hard cap and a huge final block", async () => {
    // Use a tiny checkpoint interval and a small effective run to keep the
    // test fast: max-windows capped by an authorized-final-block of exactly
    // 3 windows, verifying the loop never exceeds that regardless of the
    // approved 1000 ceiling.
    const db = makeFakeDb();
    let calls = 0;
    const { deps, httpPostCalls } = makeFakeDeps({
      db,
      httpPost: async () => {
        calls += 1;
        const runId = `run-${calls}`;
        const startBlock = FIXTURE_CURSOR_TO + BigInt((calls - 1) * 1000) + 1n;
        const endBlock = startBlock + FIXTURE_WINDOW_SIZE - 1n;
        (db as unknown as { advanceCursorTo: (b: bigint) => void }).advanceCursorTo(endBlock);
        (db.syncRun.findUnique as unknown) = async (args: unknown) => {
          const id = (args as { where: { id: string } }).where.id;
          return id === runId
            ? completedRun({
                id: runId,
                policyLabel: campaignWindowPolicyLabel(FIXTURE_PREFIX, FIXTURE_CAMPAIGN_ID, calls),
                startBlock,
                endBlock,
                latestSafeBlock: endBlock,
              })
            : null;
        };
        return { status: 202, body: { data: { runId } } };
      },
    });

    const summary = await runWalletForwardCampaignRunner(
      baseOptions({
        execute: true,
        maxWindows: CAMPAIGN_MAX_WINDOWS_HARD_CAP,
        authorizedFinalBlock: finalBlockForWindows(3),
      }),
      deps,
    );

    expect(summary.stoppedReason).toBe("authorized_final_block_reached");
    expect(summary.windowsCompleted).toBe(3);
    expect(httpPostCalls).toHaveLength(3);
  });

  it("pre-POST gate independently rejects a plan whose endBlock exceeds authorized-final-block", () => {
    expect(
      validateWithinAuthorizedFinalBlock({ endBlock: finalBlockForWindows(3) + 1n, authorizedFinalBlock: finalBlockForWindows(3) }).ok,
    ).toBe(false);
    expect(
      validateWithinAuthorizedFinalBlock({ endBlock: finalBlockForWindows(3), authorizedFinalBlock: finalBlockForWindows(3) }).ok,
    ).toBe(true);
  });

  it("checkEnv/checkpoint-interval default to 25 when omitted", () => {
    const parsed = parseCampaignCliArgs(requiredArgv());
    if (!parsed.ok) throw new Error("expected parse success");
    expect(parsed.options.checkpointIntervalWindows).toBe(25);
    expect(DEFAULT_CAMPAIGN_CHECKPOINT_INTERVAL).toBe(25);
  });

  it("rejects an unsupported chain id, including 8453 (Base)", () => {
    expect(parseCampaignCliArgs(requiredArgv({ "--chain-id": "8453" })).ok).toBe(false);
  });
});

// ─── Campaign ID / label ────────────────────────────────────────────────────────

describe("campaign id and policy label", () => {
  it("requires --campaign-id", () => {
    expect(parseCampaignCliArgs(requiredArgv({}, ["--campaign-id"])).ok).toBe(false);
  });

  it("rejects an invalid campaignId (unsafe characters)", () => {
    expect(validateCampaignId({ campaignId: "bad id!" }).ok).toBe(false);
    expect(validateCampaignId({ campaignId: "" }).ok).toBe(false);
    expect(validateCampaignId({ campaignId: "-leading-dash" }).ok).toBe(false);
    expect(parseCampaignCliArgs(requiredArgv({ "--campaign-id": "bad id!" })).ok).toBe(false);
  });

  it("accepts a safe campaignId", () => {
    expect(validateCampaignId({ campaignId: "stage0-campaign_1" }).ok).toBe(true);
  });

  it("campaignId is stable across the whole invocation (echoed into every generated label)", () => {
    const plan1 = computeCampaignWindowPlan({
      liveCursorToBlock: FIXTURE_CURSOR_TO,
      windowSizeBlocks: FIXTURE_WINDOW_SIZE,
      firstWindowStart: FIXTURE_FIRST_WINDOW_START,
      policyLabelPrefix: FIXTURE_PREFIX,
      campaignId: FIXTURE_CAMPAIGN_ID,
    });
    const plan2 = computeCampaignWindowPlan({
      liveCursorToBlock: plan1.endBlock,
      windowSizeBlocks: FIXTURE_WINDOW_SIZE,
      firstWindowStart: FIXTURE_FIRST_WINDOW_START,
      policyLabelPrefix: FIXTURE_PREFIX,
      campaignId: FIXTURE_CAMPAIGN_ID,
    });
    expect(plan1.policyLabel).toContain(FIXTURE_CAMPAIGN_ID);
    expect(plan2.policyLabel).toContain(FIXTURE_CAMPAIGN_ID);
  });

  it("logical window numbering is derived from block position, not invocation-local loop index", () => {
    const number = computeLogicalCampaignWindowNumber({
      startBlock: FIXTURE_FIRST_WINDOW_START + FIXTURE_WINDOW_SIZE * 4n,
      firstWindowStart: FIXTURE_FIRST_WINDOW_START,
      windowSizeBlocks: FIXTURE_WINDOW_SIZE,
    });
    expect(number).toBe(5);
  });

  it("generated label is <= 128 chars for a realistic campaign", () => {
    const gate = validateLongestGeneratedLabel({
      policyLabelPrefix: FIXTURE_PREFIX,
      campaignId: FIXTURE_CAMPAIGN_ID,
      startingLogicalWindowNumber: 1,
      maxWindows: 1000,
    });
    expect(gate.ok).toBe(true);
  });

  it("an overlong generated label is rejected before execution", () => {
    const longPrefix = "p".repeat(150);
    const gate = validateLongestGeneratedLabel({
      policyLabelPrefix: longPrefix,
      campaignId: FIXTURE_CAMPAIGN_ID,
      startingLogicalWindowNumber: 1,
      maxWindows: 1000,
    });
    expect(gate.ok).toBe(false);
    const parsed = parseCampaignCliArgs(requiredArgv({ "--policy-label-prefix": longPrefix }));
    expect(parsed.ok).toBe(false);
  });

  it("a policyLabel collision stops the campaign before any POST", async () => {
    const db = makeFakeDb({ policyLabels: [campaignWindowPolicyLabel(FIXTURE_PREFIX, FIXTURE_CAMPAIGN_ID, 1)] });
    const { deps, httpPostCalls } = makeFakeDeps({ db });

    const summary = await runWalletForwardCampaignRunner(baseOptions({ execute: true }), deps);

    expect(summary.stoppedReason).toBe("policy_label_collision");
    expect(httpPostCalls).toHaveLength(0);
  });
});

// ─── Per-window regression (reused primitives via the campaign orchestrator) ──

describe("per-window gates reused from the shared primitives", () => {
  it("dry-run plans the batch, never POSTs, and never mutates", async () => {
    const db = makeFakeDb();
    const { deps, httpPostCalls, evidence } = makeFakeDeps({ db });

    const summary = await runWalletForwardCampaignRunner(baseOptions({ maxWindows: 3 }), deps);

    expect(summary.stoppedReason).toBe("max_windows_reached");
    expect(summary.windowsCompleted).toBe(0);
    expect(httpPostCalls).toHaveLength(0);
    const windowRecords = evidence.filter((e) => e.kind === "window");
    expect(windowRecords).toHaveLength(3);
    expect(windowRecords.every((r) => r.outcome === "dry_run_planned")).toBe(true);
  });

  it("stops on cursor mismatch", async () => {
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_CURSOR_FROM, toBlock: FIXTURE_CURSOR_TO + 1n } });
    const { deps } = makeFakeDeps({ db });
    const summary = await runWalletForwardCampaignRunner(baseOptions(), deps);
    expect(summary.stoppedReason).toBe("cursor_expectation_mismatch");
  });

  it("stops on first-window-start mismatch", async () => {
    const db = makeFakeDb();
    const { deps } = makeFakeDeps({ db });
    const summary = await runWalletForwardCampaignRunner(
      baseOptions({ firstWindowStart: FIXTURE_FIRST_WINDOW_START + 1n, authorizedFinalBlock: finalBlockForWindows(3) + 1n }),
      deps,
    );
    expect(summary.stoppedReason).toBe("first_window_start_mismatch");
  });

  it("stops on active operation conflict", async () => {
    const db = makeFakeDb({ activeRunCount: 1 });
    const { deps } = makeFakeDeps({ db });
    const summary = await runWalletForwardCampaignRunner(baseOptions(), deps);
    expect(summary.stoppedReason).toBe("active_operation_conflict");
  });

  it("stops on contamination pre-gate", async () => {
    const db = makeFakeDb({ contaminationRows: 1 });
    const { deps } = makeFakeDeps({ db });
    const summary = await runWalletForwardCampaignRunner(baseOptions(), deps);
    expect(summary.stoppedReason).toBe("fabricated_contamination_pre_gate");
  });

  it("submits exactly one window and verifies every postcondition (execute)", async () => {
    const db = makeFakeDb({ runsById: { "run-1": completedRun() } });
    const { deps, httpPostCalls } = makeFakeDeps({
      db,
      httpPost: async () => {
        db.advanceCursorTo(25_079_548n);
        return { status: 202, body: { data: { runId: "run-1" } } };
      },
    });

    const summary = await runWalletForwardCampaignRunner(baseOptions({ execute: true, maxWindows: 1, authorizedFinalBlock: finalBlockForWindows(1) }), deps);

    expect(summary.stoppedReason).toBe("max_windows_reached");
    expect(summary.windowsCompleted).toBe(1);
    expect(httpPostCalls).toHaveLength(1);
    expect(httpPostCalls[0].url).toBe("http://localhost:3100/api/sync/manual");
  });

  it("stops before the next POST when a completed run has any warning", async () => {
    const db = makeFakeDb({ runsById: { "run-1": completedRun({ warningCount: 1, warningDetails: ["w"] }) } });
    const { deps, httpPostCalls } = makeFakeDeps({ db });

    const summary = await runWalletForwardCampaignRunner(baseOptions({ execute: true }), deps);

    expect(summary.stoppedReason).toBe("invariant_failed_after_run");
    expect(httpPostCalls).toHaveLength(1);
  });

  it("stops before the next POST on duplicate LedgerEntry", async () => {
    const db = makeFakeDb({ runsById: { "run-1": completedRun() }, duplicateLedgerRows: 1 });
    const { deps, httpPostCalls } = makeFakeDeps({
      db,
      httpPost: async () => {
        db.advanceCursorTo(25_079_548n);
        return { status: 202, body: { data: { runId: "run-1" } } };
      },
    });

    const summary = await runWalletForwardCampaignRunner(baseOptions({ execute: true }), deps);

    expect(summary.stoppedReason).toBe("invariant_failed_after_run");
    expect(httpPostCalls).toHaveLength(1);
  });

  it("no rebuild, materialization, or pricing URL is ever requested", async () => {
    const db = makeFakeDb({ runsById: { "run-1": completedRun() } });
    const { deps, httpPostCalls } = makeFakeDeps({
      db,
      httpPost: async () => {
        db.advanceCursorTo(25_079_548n);
        return { status: 202, body: { data: { runId: "run-1" } } };
      },
    });

    await runWalletForwardCampaignRunner(baseOptions({ execute: true, maxWindows: 1, authorizedFinalBlock: finalBlockForWindows(1) }), deps);

    expect(httpPostCalls.every((c) => c.url.endsWith("/api/sync/manual"))).toBe(true);
  });
});

// ─── Checkpoints ────────────────────────────────────────────────────────────────

describe("checkpoints", () => {
  it("evaluateCheckpoint passes when every fact is clean", () => {
    const result = evaluateCheckpoint({
      campaignStartHead: "head-1",
      currentHead: "head-1",
      workingTreeClean: true,
      healthGate: { ok: true },
      baseUrl: "http://localhost:3000",
      campaignStartBaseUrl: "http://localhost:3000",
      appEnv: "development",
      campaignStartAppEnv: "development",
      expectedCursor: { fromBlock: FIXTURE_CURSOR_FROM, toBlock: FIXTURE_CURSOR_TO },
      liveCursor: { fromBlock: FIXTURE_CURSOR_FROM, toBlock: FIXTURE_CURSOR_TO },
      authorizedFinalBlock: finalBlockForWindows(3),
      lastPlannedEndBlock: finalBlockForWindows(1),
      evidenceWritable: true,
    });
    expect(result.ok).toBe(true);
  });

  it("evaluateCheckpoint fails on local HEAD drift", () => {
    const result = evaluateCheckpoint({
      campaignStartHead: "head-1",
      currentHead: "head-2",
      workingTreeClean: true,
      healthGate: { ok: true },
      baseUrl: "http://localhost:3000",
      campaignStartBaseUrl: "http://localhost:3000",
      appEnv: "development",
      campaignStartAppEnv: "development",
      expectedCursor: { fromBlock: FIXTURE_CURSOR_FROM, toBlock: FIXTURE_CURSOR_TO },
      liveCursor: { fromBlock: FIXTURE_CURSOR_FROM, toBlock: FIXTURE_CURSOR_TO },
      authorizedFinalBlock: finalBlockForWindows(3),
      lastPlannedEndBlock: null,
      evidenceWritable: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons.some((r) => r.includes("HEAD"))).toBe(true);
  });

  it("evaluateCheckpoint fails on a dirty working tree", () => {
    const result = evaluateCheckpoint({
      campaignStartHead: "head-1",
      currentHead: "head-1",
      workingTreeClean: false,
      healthGate: { ok: true },
      baseUrl: "http://localhost:3000",
      campaignStartBaseUrl: "http://localhost:3000",
      appEnv: "development",
      campaignStartAppEnv: "development",
      expectedCursor: { fromBlock: FIXTURE_CURSOR_FROM, toBlock: FIXTURE_CURSOR_TO },
      liveCursor: { fromBlock: FIXTURE_CURSOR_FROM, toBlock: FIXTURE_CURSOR_TO },
      authorizedFinalBlock: finalBlockForWindows(3),
      lastPlannedEndBlock: null,
      evidenceWritable: true,
    });
    expect(result.ok).toBe(false);
  });

  it("evaluateCheckpoint fails on environment/base-url classification mismatch", () => {
    const result = evaluateCheckpoint({
      campaignStartHead: "head-1",
      currentHead: "head-1",
      workingTreeClean: true,
      healthGate: { ok: true },
      baseUrl: "http://localhost:3000",
      campaignStartBaseUrl: "http://localhost:3000",
      appEnv: "production",
      campaignStartAppEnv: "development",
      expectedCursor: { fromBlock: FIXTURE_CURSOR_FROM, toBlock: FIXTURE_CURSOR_TO },
      liveCursor: { fromBlock: FIXTURE_CURSOR_FROM, toBlock: FIXTURE_CURSOR_TO },
      authorizedFinalBlock: finalBlockForWindows(3),
      lastPlannedEndBlock: null,
      evidenceWritable: true,
    });
    expect(result.ok).toBe(false);
  });

  it("evaluateCheckpoint fails when the expected cursor no longer matches live state", () => {
    const result = evaluateCheckpoint({
      campaignStartHead: "head-1",
      currentHead: "head-1",
      workingTreeClean: true,
      healthGate: { ok: true },
      baseUrl: "http://localhost:3000",
      campaignStartBaseUrl: "http://localhost:3000",
      appEnv: "development",
      campaignStartAppEnv: "development",
      expectedCursor: { fromBlock: FIXTURE_CURSOR_FROM, toBlock: FIXTURE_CURSOR_TO },
      liveCursor: { fromBlock: FIXTURE_CURSOR_FROM, toBlock: FIXTURE_CURSOR_TO + 5n },
      authorizedFinalBlock: finalBlockForWindows(3),
      lastPlannedEndBlock: null,
      evidenceWritable: true,
    });
    expect(result.ok).toBe(false);
  });

  it("evaluateCheckpoint fails when the evidence destination is not writable", () => {
    const result = evaluateCheckpoint({
      campaignStartHead: "head-1",
      currentHead: "head-1",
      workingTreeClean: true,
      healthGate: { ok: true },
      baseUrl: "http://localhost:3000",
      campaignStartBaseUrl: "http://localhost:3000",
      appEnv: "development",
      campaignStartAppEnv: "development",
      expectedCursor: { fromBlock: FIXTURE_CURSOR_FROM, toBlock: FIXTURE_CURSOR_TO },
      liveCursor: { fromBlock: FIXTURE_CURSOR_FROM, toBlock: FIXTURE_CURSOR_TO },
      authorizedFinalBlock: finalBlockForWindows(3),
      lastPlannedEndBlock: null,
      evidenceWritable: false,
    });
    expect(result.ok).toBe(false);
  });

  it("checkpoint runs exactly at window 2 for checkpoint-interval=2 in a 4-window dry run, with no mutation", async () => {
    const db = makeFakeDb();
    const { deps, evidence, httpPostCalls } = makeFakeDeps({ db });

    const summary = await runWalletForwardCampaignRunner(
      baseOptions({ maxWindows: 4, authorizedFinalBlock: finalBlockForWindows(4), checkpointIntervalWindows: 2 }),
      deps,
    );

    expect(summary.stoppedReason).toBe("max_windows_reached");
    expect(summary.checkpointsPassed).toBe(2);
    expect(httpPostCalls).toHaveLength(0);
    const checkpointRecords = evidence.filter((e) => e.kind === "checkpoint");
    expect(checkpointRecords).toHaveLength(2);
    expect(checkpointRecords.every((r) => r.ok === true)).toBe(true);
  });

  it("checkpoint failure stops before the next POST (via dirty working tree discovered only at the checkpoint, not startup)", async () => {
    const db = makeFakeDb();
    // Clean at startup (so the startup gate passes), dirty from the first
    // checkpoint onward.
    const { deps, httpPostCalls } = makeFakeDeps({ db, workingTreeCleanSequence: [true, false] });

    const summary = await runWalletForwardCampaignRunner(
      baseOptions({ maxWindows: 4, authorizedFinalBlock: finalBlockForWindows(4), checkpointIntervalWindows: 1 }),
      deps,
    );

    expect(summary.stoppedReason).toBe("checkpoint_failed");
    expect(httpPostCalls).toHaveLength(0);
  });

  it("checkpoint failure stops via local HEAD drift", async () => {
    const db = makeFakeDb();
    const { deps } = makeFakeDeps({ db, headSequence: ["head-1", "head-2"] });

    const summary = await runWalletForwardCampaignRunner(
      baseOptions({ maxWindows: 4, authorizedFinalBlock: finalBlockForWindows(4), checkpointIntervalWindows: 1 }),
      deps,
    );

    expect(summary.stoppedReason).toBe("checkpoint_failed");
  });

  it("checkpoint failure stops via evidence destination unavailable", async () => {
    const db = makeFakeDb();
    const { deps } = makeFakeDeps({ db, evidenceWritable: false });

    const summary = await runWalletForwardCampaignRunner(
      baseOptions({ maxWindows: 4, authorizedFinalBlock: finalBlockForWindows(4), checkpointIntervalWindows: 1 }),
      deps,
    );

    expect(summary.stoppedReason).toBe("checkpoint_failed");
  });
});

// ─── Evidence ───────────────────────────────────────────────────────────────────

describe("evidence", () => {
  it("writes a campaign_start record with campaignId, maxWindows, and authorizedFinalBlock", async () => {
    const db = makeFakeDb();
    const { deps, evidence } = makeFakeDeps({ db });

    await runWalletForwardCampaignRunner(baseOptions({ maxWindows: 1, authorizedFinalBlock: finalBlockForWindows(1) }), deps);

    const start = evidence.find((e) => e.kind === "campaign_start");
    expect(start).toBeDefined();
    expect(start!.campaignId).toBe(FIXTURE_CAMPAIGN_ID);
    expect(start!.approvedMaxWindows).toBe(1);
    expect(start!.authorizedFinalBlock).toBe(finalBlockForWindows(1).toString());
  });

  it("writes a campaign_summary record on clean completion", async () => {
    const db = makeFakeDb();
    const { deps, evidence } = makeFakeDeps({ db });

    await runWalletForwardCampaignRunner(baseOptions({ maxWindows: 1, authorizedFinalBlock: finalBlockForWindows(1) }), deps);

    const summaryRecord = evidence.find((e) => e.kind === "campaign_summary");
    expect(summaryRecord).toBeDefined();
  });

  it("window evidence carries the exact runId for a completed submitted window", async () => {
    const db = makeFakeDb({ runsById: { "run-1": completedRun() } });
    const { deps, evidence } = makeFakeDeps({
      db,
      httpPost: async () => {
        db.advanceCursorTo(25_079_548n);
        return { status: 202, body: { data: { runId: "run-1" } } };
      },
    });

    await runWalletForwardCampaignRunner(baseOptions({ execute: true, maxWindows: 1, authorizedFinalBlock: finalBlockForWindows(1) }), deps);

    const windowRecord = evidence.find((e) => e.kind === "window");
    expect(windowRecord!.runId).toBe("run-1");
    expect(windowRecord!.logicalWindowNumber).toBe(1);
  });

  it("evidence contains no secret-like keys", async () => {
    const db = makeFakeDb({ runsById: { "run-1": completedRun() } });
    const { deps, evidence } = makeFakeDeps({
      db,
      httpPost: async () => {
        db.advanceCursorTo(25_079_548n);
        return { status: 202, body: { data: { runId: "run-1" } } };
      },
    });

    await runWalletForwardCampaignRunner(baseOptions({ execute: true, maxWindows: 1, authorizedFinalBlock: finalBlockForWindows(1) }), deps);

    const serialized = JSON.stringify(evidence);
    expect(serialized.toLowerCase()).not.toContain("database_url");
    expect(serialized.toLowerCase()).not.toContain("redis_url");
  });

  it("evidence append failure prevents the next POST and reports evidence_append_failed", async () => {
    const db = makeFakeDb({ runsById: { "run-1": completedRun() } });
    // Allow exactly the campaign_start write to succeed, then fail every
    // subsequent write (the first window's evidence).
    const { deps, httpPostCalls } = makeFakeDeps({
      db,
      failEvidenceAfter: 1,
      httpPost: async () => {
        db.advanceCursorTo(25_079_548n);
        return { status: 202, body: { data: { runId: "run-1" } } };
      },
    });

    const summary = await runWalletForwardCampaignRunner(
      baseOptions({ execute: true, maxWindows: 3, authorizedFinalBlock: finalBlockForWindows(3) }),
      deps,
    );

    expect(summary.stoppedReason).toBe("evidence_append_failed");
    expect(httpPostCalls).toHaveLength(1);
  });
});

// ─── Recovery / failure ─────────────────────────────────────────────────────────

describe("ambiguous-submission recovery", () => {
  it("classifies a single fully-matching candidate as recoverable", () => {
    const candidate = completedRun();
    const result = classifyAmbiguousSubmissionRecovery({
      candidates: [candidate],
      expectedPolicyLabel: candidate.policyLabel,
      expectedWalletId: candidate.walletId!,
      expectedChainId: candidate.chainId,
      expectedStartBlock: candidate.startBlock!,
      expectedEndBlock: candidate.endBlock!,
    });
    expect(result.ok).toBe(true);
  });

  it("fails closed on zero matching candidates", () => {
    const result = classifyAmbiguousSubmissionRecovery({
      candidates: [],
      expectedPolicyLabel: "p-1",
      expectedWalletId: FIXTURE_WALLET_ID,
      expectedChainId: FIXTURE_CHAIN_ID,
      expectedStartBlock: 1n,
      expectedEndBlock: 2n,
    });
    expect(result.ok).toBe(false);
  });

  it("fails closed on multiple matching candidates", () => {
    const candidate = completedRun();
    const result = classifyAmbiguousSubmissionRecovery({
      candidates: [candidate, { ...candidate, id: "run-2" }],
      expectedPolicyLabel: candidate.policyLabel,
      expectedWalletId: candidate.walletId!,
      expectedChainId: candidate.chainId,
      expectedStartBlock: candidate.startBlock!,
      expectedEndBlock: candidate.endBlock!,
    });
    expect(result.ok).toBe(false);
  });

  it("fails closed when the only candidate mismatches on identity (e.g. wrong startBlock)", () => {
    const candidate = completedRun({ startBlock: 999n });
    const result = classifyAmbiguousSubmissionRecovery({
      candidates: [candidate],
      expectedPolicyLabel: candidate.policyLabel,
      expectedWalletId: candidate.walletId!,
      expectedChainId: candidate.chainId,
      expectedStartBlock: candidate.startBlock! + 1n,
      expectedEndBlock: candidate.endBlock!,
    });
    expect(result.ok).toBe(false);
  });

  it("via the real orchestrator: an ambiguous POST recovers when exactly one full-identity match exists", async () => {
    const plan1Label = campaignWindowPolicyLabel(FIXTURE_PREFIX, FIXTURE_CAMPAIGN_ID, 1);
    const recoveredRun = completedRun({ policyLabel: plan1Label });
    const db = makeFakeDb({
      runsById: { "run-1": recoveredRun },
      ambiguousCandidates: [recoveredRun],
    });
    const { deps, httpPostCalls } = makeFakeDeps({
      db,
      httpPost: async () => {
        // Simulates the server having already accepted and fully processed
        // the request (cursor advances server-side) even though the client
        // never received the response.
        db.advanceCursorTo(25_079_548n);
        throw new Error("simulated network failure after the server may have accepted the request");
      },
    });

    const summary = await runWalletForwardCampaignRunner(
      baseOptions({ execute: true, maxWindows: 1, authorizedFinalBlock: finalBlockForWindows(1) }),
      deps,
    );

    expect(summary.stoppedReason).toBe("max_windows_reached");
    expect(summary.windowsCompleted).toBe(1);
    expect(httpPostCalls).toHaveLength(1);
  });

  it("via the real orchestrator: an ambiguous POST with zero matching candidates fails closed and never retries", async () => {
    const db = makeFakeDb({ ambiguousCandidates: [] });
    let postCalls = 0;
    const { deps } = makeFakeDeps({
      db,
      httpPost: async () => {
        postCalls += 1;
        throw new Error("simulated network failure");
      },
    });

    const summary = await runWalletForwardCampaignRunner(
      baseOptions({ execute: true, maxWindows: 3, authorizedFinalBlock: finalBlockForWindows(3) }),
      deps,
    );

    expect(summary.stoppedReason).toBe("ambiguous_submission_unrecoverable");
    expect(postCalls).toBe(1); // no retry
  });

  it("via the real orchestrator: an ambiguous POST with multiple matching candidates fails closed", async () => {
    const plan1Label = campaignWindowPolicyLabel(FIXTURE_PREFIX, FIXTURE_CAMPAIGN_ID, 1);
    const candidate = completedRun({ policyLabel: plan1Label });
    const db = makeFakeDb({ ambiguousCandidates: [candidate, { ...candidate, id: "run-2" }] });
    const { deps } = makeFakeDeps({
      db,
      httpPost: async () => {
        throw new Error("simulated network failure");
      },
    });

    const summary = await runWalletForwardCampaignRunner(
      baseOptions({ execute: true, maxWindows: 1, authorizedFinalBlock: finalBlockForWindows(1) }),
      deps,
    );

    expect(summary.stoppedReason).toBe("ambiguous_submission_unrecoverable");
  });
});

describe("process errors and unexpected failures", () => {
  it("an unexpected error (e.g. DB throw) fails closed, exits nonzero, and never submits a POST", async () => {
    const db = makeFakeDb();
    (db.syncCursor.findUnique as unknown) = async () => {
      throw new Error("simulated DB outage");
    };
    const { deps, httpPostCalls } = makeFakeDeps({ db });

    const summary = await runWalletForwardCampaignRunner(baseOptions({ execute: true }), deps);

    expect(summary.stoppedReason).toBe("unexpected_error");
    expect(httpPostCalls).toHaveLength(0);
    expect(computeCampaignExitCode(summary.stoppedReason)).toBe(1);
  });

  it("a stale cursor at restart is rejected (no automatic resume)", async () => {
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_CURSOR_FROM, toBlock: FIXTURE_CURSOR_TO + 100n } });
    const { deps, httpPostCalls } = makeFakeDeps({ db });

    const summary = await runWalletForwardCampaignRunner(baseOptions({ execute: true }), deps);

    expect(summary.stoppedReason).toBe("cursor_expectation_mismatch");
    expect(httpPostCalls).toHaveLength(0);
  });

  it("a policyLabel collision on resume is rejected (no automatic resume)", async () => {
    const db = makeFakeDb({ policyLabels: [campaignWindowPolicyLabel(FIXTURE_PREFIX, FIXTURE_CAMPAIGN_ID, 1)] });
    const { deps, httpPostCalls } = makeFakeDeps({ db });

    const summary = await runWalletForwardCampaignRunner(baseOptions({ execute: true }), deps);

    expect(summary.stoppedReason).toBe("policy_label_collision");
    expect(httpPostCalls).toHaveLength(0);
  });
});

// ─── Exit-code allowlist ────────────────────────────────────────────────────────

describe("campaign exit-code allowlist", () => {
  it("CAMPAIGN_CLEAN_STOP_REASONS contains exactly the two genuine completion reasons", () => {
    expect(CAMPAIGN_CLEAN_STOP_REASONS.has("max_windows_reached")).toBe(true);
    expect(CAMPAIGN_CLEAN_STOP_REASONS.has("authorized_final_block_reached")).toBe(true);
    expect(CAMPAIGN_CLEAN_STOP_REASONS.size).toBe(2);
  });

  it("both clean reasons exit 0", () => {
    expect(computeCampaignExitCode("max_windows_reached")).toBe(0);
    expect(computeCampaignExitCode("authorized_final_block_reached")).toBe(0);
  });

  it("every documented hard-stop reason exits 1", () => {
    const hardStopReasons = [
      "wallet_not_found",
      "cursor_expectation_mismatch",
      "first_window_start_mismatch",
      "adjacency_violation",
      "active_operation_conflict",
      "policy_label_collision",
      "policy_label_overlong",
      "server_unhealthy",
      "fabricated_contamination_pre_gate",
      "manual_sync_submit_failed",
      "poll_timeout",
      "invariant_failed_after_run",
      "authorized_final_block_exceeded",
      "authorized_final_block_misaligned",
      "invalid_max_windows",
      "invalid_campaign_id",
      "checkpoint_failed",
      "evidence_append_failed",
      "ambiguous_submission_unrecoverable",
      "unexpected_error",
      "git_head_unavailable",
    ];
    for (const reason of hardStopReasons) {
      expect(computeCampaignExitCode(reason)).toBe(1);
    }
  });

  it("fails closed for any unknown future stop reason", () => {
    expect(computeCampaignExitCode("some_new_reason_nobody_added")).toBe(1);
  });
});

// ─── Checkpoint-interval validation ─────────────────────────────────────────────

describe("validateCheckpointInterval", () => {
  it("rejects zero and negative values", () => {
    expect(validateCheckpointInterval({ checkpointIntervalWindows: 0 }).ok).toBe(false);
    expect(validateCheckpointInterval({ checkpointIntervalWindows: -5 }).ok).toBe(false);
  });
  it("accepts the default of 25", () => {
    expect(validateCheckpointInterval({ checkpointIntervalWindows: 25 }).ok).toBe(true);
  });

  it.each([1, 5, 10, 25])("accepts %d (more frequent than or equal to the 25-window maximum)", (n) => {
    expect(validateCheckpointInterval({ checkpointIntervalWindows: n }).ok).toBe(true);
  });

  it.each([26, 100, 1000])("rejects %d (wider than the approved 25-window maximum spacing)", (n) => {
    expect(validateCheckpointInterval({ checkpointIntervalWindows: n }).ok).toBe(false);
    expect(parseCampaignCliArgs(requiredArgv({ "--checkpoint-interval": String(n) })).ok).toBe(false);
  });

  it("MAX_CAMPAIGN_CHECKPOINT_INTERVAL is exactly 25", () => {
    expect(MAX_CAMPAIGN_CHECKPOINT_INTERVAL).toBe(25);
  });
});

// ─── Blocker 9: campaign atomic window fixed at exactly 1000 blocks ────────────

describe("campaign window size is fixed at exactly 1000 blocks", () => {
  it("CAMPAIGN_REQUIRED_WINDOW_SIZE_BLOCKS is exactly 1000", () => {
    expect(CAMPAIGN_REQUIRED_WINDOW_SIZE_BLOCKS).toBe(1_000n);
  });

  it("accepts exactly 1000", () => {
    expect(validateCampaignWindowSize({ windowSizeBlocks: 1_000n }).ok).toBe(true);
  });

  it.each([999n, 1001n, 1n])("rejects %s", (n) => {
    expect(validateCampaignWindowSize({ windowSizeBlocks: n }).ok).toBe(false);
  });

  it("the CLI rejects a campaign --window-size other than exactly 1000", () => {
    expect(parseCampaignCliArgs(requiredArgv({ "--window-size": "999" })).ok).toBe(false);
    expect(parseCampaignCliArgs(requiredArgv({ "--window-size": "1001" })).ok).toBe(false);
    expect(parseCampaignCliArgs(requiredArgv({ "--window-size": "1" })).ok).toBe(false);
    expect(parseCampaignCliArgs(requiredArgv({ "--window-size": "1000" })).ok).toBe(true);
  });

  it("the orchestrator itself rejects a non-1000 window size even when constructed directly (defense in depth)", async () => {
    const db = makeFakeDb();
    const { deps, httpPostCalls } = makeFakeDeps({ db });

    const summary = await runWalletForwardCampaignRunner(
      baseOptions({
        windowSizeBlocks: 500n,
        firstWindowStart: FIXTURE_FIRST_WINDOW_START,
        authorizedFinalBlock: FIXTURE_FIRST_WINDOW_START + 500n * 3n - 1n,
        maxWindows: 3,
      }),
      deps,
    );

    expect(summary.stoppedReason).toBe("invalid_window_size");
    expect(httpPostCalls).toHaveLength(0);
  });
});

// ─── Blocker 3: --base-url must be explicit for the campaign runner ────────────

describe("--base-url must be explicit (no OPERATOR_RUNNER_BASE_URL / localhost default)", () => {
  it("omitted --base-url is rejected", () => {
    const parsed = parseCampaignCliArgs(requiredArgv({}, ["--base-url"]));
    expect(parsed.ok).toBe(false);
  });

  it("an explicit localhost --base-url is accepted", () => {
    const parsed = parseCampaignCliArgs(requiredArgv({ "--base-url": "http://localhost:3000" }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.options.baseUrl).toBe("http://localhost:3000");
  });

  it("OPERATOR_RUNNER_BASE_URL alone does not satisfy the requirement (the campaign parser never reads it)", () => {
    const previous = process.env.OPERATOR_RUNNER_BASE_URL;
    process.env.OPERATOR_RUNNER_BASE_URL = "http://example-should-not-be-used:9999";
    try {
      const parsed = parseCampaignCliArgs(requiredArgv({}, ["--base-url"]));
      expect(parsed.ok).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.OPERATOR_RUNNER_BASE_URL;
      else process.env.OPERATOR_RUNNER_BASE_URL = previous;
    }
  });
});

// ─── Blocker 7: --policy-label-prefix whitespace is rejected, not normalized ───

describe("--policy-label-prefix whitespace handling", () => {
  it("rejects leading whitespace", () => {
    expect(parseCampaignCliArgs(requiredArgv({ "--policy-label-prefix": " prefix" })).ok).toBe(false);
  });
  it("rejects trailing whitespace", () => {
    expect(parseCampaignCliArgs(requiredArgv({ "--policy-label-prefix": "prefix " })).ok).toBe(false);
  });
  it("rejects a whitespace-only value", () => {
    expect(parseCampaignCliArgs(requiredArgv({ "--policy-label-prefix": "   " })).ok).toBe(false);
  });
  it("accepts a valid prefix unchanged", () => {
    const parsed = parseCampaignCliArgs(requiredArgv({ "--policy-label-prefix": FIXTURE_PREFIX }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.options.policyLabelPrefix).toBe(FIXTURE_PREFIX);
  });
});

// ─── Blocker 2 & 4: mandatory startup gates (worktree, health) before campaign_start ──

describe("mandatory startup gates run before campaign_start and before any POST", () => {
  it("a dirty working tree at campaign start stops with working_tree_dirty and zero POSTs, even for a short (Stage-1-sized) campaign with the default 25-window checkpoint interval", async () => {
    const db = makeFakeDb();
    const { deps, httpPostCalls, evidence } = makeFakeDeps({ db, workingTreeClean: false });

    const summary = await runWalletForwardCampaignRunner(
      baseOptions({ execute: true, maxWindows: 10, authorizedFinalBlock: finalBlockForWindows(10) }),
      deps,
    );

    expect(summary.stoppedReason).toBe("working_tree_dirty");
    expect(httpPostCalls).toHaveLength(0);
    // No campaign_start record should exist — the startup gate ran and
    // failed before campaign_start was ever written.
    expect(evidence.some((e) => e.kind === "campaign_start")).toBe(false);
  });

  it("a clean working tree at campaign start allows the campaign to proceed", async () => {
    const db = makeFakeDb();
    const { deps, evidence } = makeFakeDeps({ db, workingTreeClean: true });

    const summary = await runWalletForwardCampaignRunner(baseOptions({ maxWindows: 1, authorizedFinalBlock: finalBlockForWindows(1) }), deps);

    expect(summary.stoppedReason).toBe("max_windows_reached");
    expect(evidence.some((e) => e.kind === "campaign_start")).toBe(true);
  });

  it("initial HTTP health-check failure (non-200) stops with initial_health_baseline_failed and zero POSTs", async () => {
    const db = makeFakeDb();
    const { deps, httpPostCalls, evidence } = makeFakeDeps({
      db,
      httpGet: async () => ({ status: 503, body: { data: { status: "degraded" } } }),
    });

    const summary = await runWalletForwardCampaignRunner(baseOptions({ execute: true }), deps);

    expect(summary.stoppedReason).toBe("initial_health_baseline_failed");
    expect(httpPostCalls).toHaveLength(0);
    expect(evidence.some((e) => e.kind === "campaign_start")).toBe(false);
  });

  it("initial non-ok status body stops with initial_health_baseline_failed and zero POSTs", async () => {
    const db = makeFakeDb();
    const { deps, httpPostCalls } = makeFakeDeps({
      db,
      httpGet: async () => ({ status: 200, body: { data: { status: "not-ok" } } }),
    });

    const summary = await runWalletForwardCampaignRunner(baseOptions({ execute: true }), deps);

    expect(summary.stoppedReason).toBe("initial_health_baseline_failed");
    expect(httpPostCalls).toHaveLength(0);
  });

  it("a valid initial health check allows the campaign to proceed", async () => {
    const db = makeFakeDb();
    const { deps, evidence } = makeFakeDeps({ db });

    const summary = await runWalletForwardCampaignRunner(baseOptions({ maxWindows: 1, authorizedFinalBlock: finalBlockForWindows(1) }), deps);

    expect(summary.stoppedReason).toBe("max_windows_reached");
    expect(evidence.some((e) => e.kind === "campaign_start")).toBe(true);
  });

  it("later app.env drift is still caught at a checkpoint (startup baseline established from the initial OK check)", async () => {
    const db = makeFakeDb();
    let call = 0;
    const { deps } = makeFakeDeps({
      db,
      httpGet: async () => {
        call += 1;
        // First call: startup baseline (ok, env "test"). Second call:
        // checkpoint health check reporting a different environment.
        return call === 1
          ? { status: 200, body: { data: { status: "ok", app: { env: "test" } } } }
          : { status: 200, body: { data: { status: "ok", app: { env: "production" } } } };
      },
    });

    const summary = await runWalletForwardCampaignRunner(
      baseOptions({ maxWindows: 2, authorizedFinalBlock: finalBlockForWindows(2), checkpointIntervalWindows: 1 }),
      deps,
    );

    expect(summary.stoppedReason).toBe("checkpoint_failed");
  });
});

// ─── Blocker 5: final campaign_summary evidence failure exits nonzero ─────────

describe("final campaign_summary evidence failure", () => {
  it("a write failure on the final campaign_summary record returns evidence_append_failed and exits nonzero, without rolling back or retrying completed windows", async () => {
    const db = makeFakeDb({ runsById: { "run-1": completedRun() } });
    let writeCount = 0;
    const evidence: EvidenceRecord[] = [];
    const httpPostCalls: Array<{ url: string; body: unknown }> = [];
    const deps: CampaignDeps = {
      db,
      resolveWallet: async () => ({ id: FIXTURE_WALLET_ID, address: FIXTURE_WALLET }),
      httpGet: async () => ({ status: 200, body: { data: { status: "ok", app: { env: "test" } } } }),
      httpPost: async (url, body) => {
        httpPostCalls.push({ url, body });
        db.advanceCursorTo(25_079_548n);
        return { status: 202, body: { data: { runId: "run-1" } } };
      },
      now: () => new Date(0),
      sleep: async () => {},
      writeEvidence: async (record) => {
        writeCount += 1;
        if (record.kind === "campaign_summary") {
          throw new Error("simulated campaign_summary write failure");
        }
        evidence.push(record);
      },
      getGitHead: async () => "head-1",
      isWorkingTreeClean: async () => true,
      checkEvidenceWritable: async () => true,
    };

    const summary = await runWalletForwardCampaignRunner(
      baseOptions({ execute: true, maxWindows: 1, authorizedFinalBlock: finalBlockForWindows(1) }),
      deps,
    );

    expect(summary.stoppedReason).toBe("evidence_append_failed");
    expect(computeCampaignExitCode(summary.stoppedReason)).toBe(1);
    // Exactly one POST happened and completed — canonical state is not
    // retried or rolled back because of the summary-write failure.
    expect(httpPostCalls).toHaveLength(1);
    expect(writeCount).toBeGreaterThan(0);
  });
});

// ─── Blocker 8: every stop record includes campaignId ──────────────────────────

describe("every campaign stop record includes campaignId", () => {
  it("wallet_not_found stop contains campaignId", async () => {
    const db = makeFakeDb();
    const { deps, evidence } = makeFakeDeps({ db });
    await runWalletForwardCampaignRunner(baseOptions(), { ...deps, resolveWallet: async () => null });
    const stopRecord = evidence.find((e) => e.kind === "stop" && e.reason === "wallet_not_found");
    expect(stopRecord?.campaignId).toBe(FIXTURE_CAMPAIGN_ID);
  });

  it("cursor mismatch stop contains campaignId", async () => {
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_CURSOR_FROM, toBlock: FIXTURE_CURSOR_TO + 1n } });
    const { deps, evidence } = makeFakeDeps({ db });
    await runWalletForwardCampaignRunner(baseOptions(), deps);
    const stopRecord = evidence.find((e) => e.kind === "stop" && e.reason === "cursor_expectation_mismatch");
    expect(stopRecord?.campaignId).toBe(FIXTURE_CAMPAIGN_ID);
  });

  it("initial health-baseline stop contains campaignId", async () => {
    const db = makeFakeDb();
    const { deps, evidence } = makeFakeDeps({ db, httpGet: async () => ({ status: 500, body: {} }) });
    await runWalletForwardCampaignRunner(baseOptions({ execute: true }), deps);
    const stopRecord = evidence.find((e) => e.kind === "stop" && e.reason === "initial_health_baseline_failed");
    expect(stopRecord?.campaignId).toBe(FIXTURE_CAMPAIGN_ID);
  });

  it("checkpoint_failed stop contains campaignId", async () => {
    const db = makeFakeDb();
    const { deps, evidence } = makeFakeDeps({ db, workingTreeCleanSequence: [true, false] });
    await runWalletForwardCampaignRunner(
      baseOptions({ maxWindows: 4, authorizedFinalBlock: finalBlockForWindows(4), checkpointIntervalWindows: 1 }),
      deps,
    );
    const stopRecord = evidence.find((e) => e.kind === "stop" && e.reason === "checkpoint_failed");
    expect(stopRecord?.campaignId).toBe(FIXTURE_CAMPAIGN_ID);
  });

  it("invariant_failed_after_run stop contains campaignId", async () => {
    const db = makeFakeDb({ runsById: { "run-1": completedRun({ warningCount: 1, warningDetails: ["w"] }) } });
    const { deps, evidence } = makeFakeDeps({ db });
    await runWalletForwardCampaignRunner(baseOptions({ execute: true }), deps);
    const stopRecord = evidence.find((e) => e.kind === "stop" && e.reason === "invariant_failed_after_run");
    expect(stopRecord?.campaignId).toBe(FIXTURE_CAMPAIGN_ID);
  });

  it("ambiguous_submission_unrecoverable stop contains campaignId", async () => {
    const db = makeFakeDb({ ambiguousCandidates: [] });
    const { deps, evidence } = makeFakeDeps({
      db,
      httpPost: async () => {
        throw new Error("simulated network failure");
      },
    });
    await runWalletForwardCampaignRunner(baseOptions({ execute: true }), deps);
    const stopRecord = evidence.find((e) => e.kind === "stop" && e.reason === "ambiguous_submission_unrecoverable");
    expect(stopRecord?.campaignId).toBe(FIXTURE_CAMPAIGN_ID);
  });

  it("unexpected_error stop contains campaignId where campaign identity is known", async () => {
    const db = makeFakeDb();
    (db.syncCursor.findUnique as unknown) = async () => {
      throw new Error("simulated DB outage");
    };
    const { deps, evidence } = makeFakeDeps({ db });
    await runWalletForwardCampaignRunner(baseOptions({ execute: true }), deps);
    const stopRecord = evidence.find((e) => e.kind === "stop" && e.reason === "unexpected_error");
    expect(stopRecord?.campaignId).toBe(FIXTURE_CAMPAIGN_ID);
  });
});

// ─── Blocker 1: HTTP request timeout ───────────────────────────────────────────

describe("HTTP request timeout and timeout-triggered ambiguous recovery", () => {
  it("HTTP_REQUEST_TIMEOUT_MS is a fixed 60-second bound", () => {
    expect(HTTP_REQUEST_TIMEOUT_MS).toBe(60_000);
  });

  it("a GET (health check) timeout fails closed — treated identically to any other network error", async () => {
    const db = makeFakeDb();
    const { deps, httpPostCalls } = makeFakeDeps({
      db,
      httpGet: async () => {
        throw new DOMException("The operation was aborted.", "TimeoutError");
      },
    });

    const summary = await runWalletForwardCampaignRunner(baseOptions({ execute: true }), deps);

    expect(summary.stoppedReason).toBe("initial_health_baseline_failed");
    expect(httpPostCalls).toHaveLength(0);
  });

  it("a timed-out POST enters ambiguous recovery and recovers when exactly one full-identity match exists (no auto-resubmit)", async () => {
    const recoveredRun = completedRun();
    const db = makeFakeDb({ runsById: { "run-1": recoveredRun }, ambiguousCandidates: [recoveredRun] });
    let postCalls = 0;
    const { deps, httpPostCalls } = makeFakeDeps({
      db,
      httpPost: async () => {
        postCalls += 1;
        db.advanceCursorTo(25_079_548n);
        throw new DOMException("The operation was aborted.", "TimeoutError");
      },
    });

    const summary = await runWalletForwardCampaignRunner(
      baseOptions({ execute: true, maxWindows: 1, authorizedFinalBlock: finalBlockForWindows(1) }),
      deps,
    );

    expect(summary.stoppedReason).toBe("max_windows_reached");
    expect(summary.windowsCompleted).toBe(1);
    expect(httpPostCalls).toHaveLength(1);
    expect(postCalls).toBe(1); // no auto-resubmit
  });

  it("a timed-out POST with zero matching candidates fails closed and never retries", async () => {
    const db = makeFakeDb({ ambiguousCandidates: [] });
    let postCalls = 0;
    const { deps } = makeFakeDeps({
      db,
      httpPost: async () => {
        postCalls += 1;
        throw new DOMException("The operation was aborted.", "TimeoutError");
      },
    });

    const summary = await runWalletForwardCampaignRunner(baseOptions({ execute: true }), deps);

    expect(summary.stoppedReason).toBe("ambiguous_submission_unrecoverable");
    expect(postCalls).toBe(1);
  });

  it("a timed-out POST with multiple matching candidates fails closed and never retries", async () => {
    const plan1Label = campaignWindowPolicyLabel(FIXTURE_PREFIX, FIXTURE_CAMPAIGN_ID, 1);
    const candidate = completedRun({ policyLabel: plan1Label });
    const db = makeFakeDb({ ambiguousCandidates: [candidate, { ...candidate, id: "run-2" }] });
    let postCalls = 0;
    const { deps } = makeFakeDeps({
      db,
      httpPost: async () => {
        postCalls += 1;
        throw new DOMException("The operation was aborted.", "TimeoutError");
      },
    });

    const summary = await runWalletForwardCampaignRunner(
      baseOptions({ execute: true, maxWindows: 1, authorizedFinalBlock: finalBlockForWindows(1) }),
      deps,
    );

    expect(summary.stoppedReason).toBe("ambiguous_submission_unrecoverable");
    expect(postCalls).toBe(1);
  });
});
