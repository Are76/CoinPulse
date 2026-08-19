// Wallet-forward completion SUPERVISOR — focused unit tests.
//
// All DB, HTTP, git, and child-process dependencies are mocked/injected. No
// live calls, no real POST, no rebuild, and no execution of a live sync
// window happens anywhere in this file — the child campaign runner itself is
// never invoked for real; every test injects a fake `runChildCampaign`.

import { describe, expect, it, vi } from "vitest";

import {
  buildChildCampaignId,
  computeChildProcessTimeoutMs,
  MAX_CHILD_PROCESS_TIMEOUT_MS,
  computeNextChildPlan,
  computeStartingChildCampaignNumber,
  computeSupervisorExitCode,
  DEFAULT_CHILD_EVIDENCE_FILE,
  evaluateEnvironmentDrift,
  evaluateRepositoryDrift,
  parseSupervisorCliArgs,
  resolveTsxCliPath,
  runWalletForwardSupervisor,
  SUPERVISOR_CLEAN_STOP_REASONS,
  validateCampaignIdPrefix,
  validateChildCampaignId,
  verifyCanonicalCursorAfterChild,
  verifyChildCleanResult,
  verifyDryRunNoCanonicalMutation,
  verifyPriorTerminalOperationClean,
  type ChildProcessResult,
  type SupervisorCliOptions,
  type SupervisorDeps,
} from "../../scripts/wallet-forward-supervisor";
import type { EvidenceRecord, RunnerDbClient, RunnerSyncRunRecord } from "../../scripts/lib/wallet-forward-sync-primitives";

const FIXTURE_WALLET = "0x08ac26d74013af7430c350c97eacd8be0bdc5613";
const FIXTURE_WALLET_ID = "wallet-cuid-1";
const FIXTURE_CHAIN_ID = 369;
const FIXTURE_ANCHOR_FROM = 25_077_549n;
const FIXTURE_WINDOW_SIZE = 1_000n;
const FIXTURE_HEAD = "abc123headsha";
const FIXTURE_APP_ENV = "development";
const FIXTURE_PREFIX = "wallet-forward-campaign";
const FIXTURE_CAMPAIGN_ID_PREFIX = "stage1-2026-08-19";

function baseOptions(overrides: Partial<SupervisorCliOptions> = {}): SupervisorCliOptions {
  return {
    execute: false,
    walletAddress: FIXTURE_WALLET,
    chainId: FIXTURE_CHAIN_ID,
    authorizedFinalBlock: FIXTURE_ANCHOR_FROM + 1000n + 3n * FIXTURE_WINDOW_SIZE - 1n,
    campaignMaxWindows: 10,
    windowSizeBlocks: FIXTURE_WINDOW_SIZE,
    campaignIdPrefix: FIXTURE_CAMPAIGN_ID_PREFIX,
    policyLabelPrefix: FIXTURE_PREFIX,
    checkpointIntervalWindows: 25,
    baseUrl: "http://localhost:3100",
    evidenceFile: "unused-in-tests/supervisor-evidence.jsonl",
    childEvidenceFile: undefined,
    pollIntervalMs: 1,
    pollTimeoutMs: 1000,
    runnerScriptPath: "scripts/wallet-forward-campaign-runner.ts",
    ...overrides,
  };
}

function cleanChildStdout(args: { stoppedReason: string; windowsCompleted: number; lastWindowNumber: number }) {
  return `${JSON.stringify({
    stoppedReason: args.stoppedReason,
    windowsCompleted: args.windowsCompleted,
    lastWindowNumber: args.lastWindowNumber,
    checkpointsPassed: 0,
  })}\n`;
}

function cleanExecuteResult(args: { windows: number; reachedTarget: boolean }): ChildProcessResult {
  return {
    exitCode: 0,
    stdout: cleanChildStdout({
      stoppedReason: args.reachedTarget ? "authorized_final_block_reached" : "max_windows_reached",
      windowsCompleted: args.windows,
      lastWindowNumber: args.windows,
    }),
    stderr: "",
  };
}

function cleanDryRunResult(args: { windows: number; reachedTarget: boolean }): ChildProcessResult {
  return {
    exitCode: 0,
    stdout: cleanChildStdout({
      stoppedReason: args.reachedTarget ? "authorized_final_block_reached" : "max_windows_reached",
      windowsCompleted: 0,
      lastWindowNumber: args.windows,
    }),
    stderr: "",
  };
}

function completedRun(overrides: Partial<RunnerSyncRunRecord> = {}): RunnerSyncRunRecord {
  return {
    id: "run-1",
    trigger: "MANUAL",
    status: "COMPLETED",
    stage: "COMPLETED",
    chainId: FIXTURE_CHAIN_ID,
    walletId: FIXTURE_WALLET_ID,
    policyLabel: `${FIXTURE_PREFIX}-${FIXTURE_CAMPAIGN_ID_PREFIX}-c1-w1`,
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

type FakeDbState = {
  cursor: { fromBlock: bigint; toBlock: bigint } | null;
  policyLabels: string[];
  runsByEndBlock: RunnerSyncRunRecord[];
};

function makeFakeDb(
  initial: Partial<FakeDbState> = {},
): RunnerDbClient & {
  setCursor: (c: FakeDbState["cursor"]) => void;
  setPolicyLabels: (labels: string[]) => void;
  setRunsByEndBlock: (runs: RunnerSyncRunRecord[]) => void;
} {
  const state: FakeDbState = {
    // "cursor" in initial (not ??) so an explicit `cursor: null` is honored
    // rather than being coalesced back to the default.
    cursor: "cursor" in initial ? (initial.cursor ?? null) : { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n },
    policyLabels: initial.policyLabels ?? [],
    runsByEndBlock: initial.runsByEndBlock ?? [],
  };
  return {
    syncCursor: {
      findUnique: async () => (state.cursor ? { ...state.cursor, blockHash: "0xblockhash" } : null),
    },
    syncRun: {
      findMany: async (args: unknown) => {
        const a = args as { where?: { endBlock?: bigint; chainId?: number } };
        if (a.where?.endBlock !== undefined) {
          return state.runsByEndBlock.filter((r) => r.endBlock === a.where!.endBlock);
        }
        // listActivePolicyLabels shape: select: { policyLabel: true }
        return state.policyLabels.map((policyLabel) => ({ policyLabel }) as unknown as RunnerSyncRunRecord);
      },
      findUnique: async () => null,
      count: async () => 0,
    },
    $queryRaw: (async () => []) as RunnerDbClient["$queryRaw"],
    setCursor: (c) => {
      state.cursor = c;
    },
    setPolicyLabels: (labels) => {
      state.policyLabels = labels;
    },
    setRunsByEndBlock: (runs) => {
      state.runsByEndBlock = runs;
    },
  };
}

function makeDeps(
  overrides: Partial<SupervisorDeps> & { db: ReturnType<typeof makeFakeDb> },
): SupervisorDeps & { evidence: EvidenceRecord[] } {
  const evidence: EvidenceRecord[] = [];
  return {
    evidence,
    resolveWallet: async () => ({ id: FIXTURE_WALLET_ID, address: FIXTURE_WALLET }),
    httpGet: async () => ({ status: 200, body: { data: { status: "ok", app: { env: FIXTURE_APP_ENV } } } }),
    now: () => new Date("2026-08-19T12:00:00.000Z"),
    writeEvidence: async (record) => {
      evidence.push(record);
    },
    getGitHead: async () => FIXTURE_HEAD,
    isWorkingTreeClean: async () => true,
    runChildCampaign: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    isInterrupted: () => false,
    ...overrides,
  };
}

// ─── Pure function tests ───────────────────────────────────────────────────

describe("computeNextChildPlan", () => {
  it("bounds a child to campaignMaxWindows when more remains than one child can cover", () => {
    const plan = computeNextChildPlan({
      liveCursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n },
      windowSizeBlocks: FIXTURE_WINDOW_SIZE,
      campaignMaxWindows: 5,
      authorizedFinalBlock: 25_078_548n + 20n * FIXTURE_WINDOW_SIZE,
      childCampaignNumber: 1,
    });
    expect(plan.done).toBe(false);
    if (plan.done === false && !("error" in plan)) {
      expect(plan.childMaxWindows).toBe(5);
      expect(plan.firstWindowStart).toBe(25_078_549n);
      expect(plan.childAuthorizedFinalBlock).toBe(25_078_549n + 5n * FIXTURE_WINDOW_SIZE - 1n);
    } else {
      throw new Error("expected a non-done, non-error plan");
    }
  });

  it("bounds a child to the remaining windows when fewer remain than campaignMaxWindows", () => {
    const cursorTo = 25_078_548n;
    const plan = computeNextChildPlan({
      liveCursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: cursorTo },
      windowSizeBlocks: FIXTURE_WINDOW_SIZE,
      campaignMaxWindows: 10,
      authorizedFinalBlock: cursorTo + 3n * FIXTURE_WINDOW_SIZE,
      childCampaignNumber: 1,
    });
    if (plan.done !== false || "error" in plan) throw new Error("expected a bounded plan");
    expect(plan.childMaxWindows).toBe(3);
  });

  it("reports done when the canonical cursor already sits at the authorized final block", () => {
    const plan = computeNextChildPlan({
      liveCursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n },
      windowSizeBlocks: FIXTURE_WINDOW_SIZE,
      campaignMaxWindows: 10,
      authorizedFinalBlock: 25_078_548n,
      childCampaignNumber: 1,
    });
    expect(plan).toEqual({ done: true, reason: "authorized_final_block_already_reached" });
  });

  it("fails closed when the canonical cursor is already beyond the authorized final block", () => {
    const plan = computeNextChildPlan({
      liveCursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n },
      windowSizeBlocks: FIXTURE_WINDOW_SIZE,
      campaignMaxWindows: 10,
      authorizedFinalBlock: 25_078_000n,
      childCampaignNumber: 1,
    });
    if (plan.done !== false || !("error" in plan)) throw new Error("expected an error result");
    expect(plan.error).toMatch(/already beyond/);
  });

  it("fails closed on a misaligned authorized final block", () => {
    const plan = computeNextChildPlan({
      liveCursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n },
      windowSizeBlocks: FIXTURE_WINDOW_SIZE,
      campaignMaxWindows: 10,
      authorizedFinalBlock: 25_078_548n + 500n,
      childCampaignNumber: 1,
    });
    if (plan.done !== false || !("error" in plan)) throw new Error("expected an error result");
    expect(plan.error).toMatch(/does not align/);
  });

  it("never derives a child authorized-final-block beyond the immutable target", () => {
    const cursorTo = 25_078_548n;
    const target = cursorTo + 4n * FIXTURE_WINDOW_SIZE;
    const plan = computeNextChildPlan({
      liveCursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: cursorTo },
      windowSizeBlocks: FIXTURE_WINDOW_SIZE,
      campaignMaxWindows: 1000,
      authorizedFinalBlock: target,
      childCampaignNumber: 1,
    });
    if (plan.done !== false || "error" in plan) throw new Error("expected a bounded plan");
    expect(plan.childAuthorizedFinalBlock).toBeLessThanOrEqual(target);
    expect(plan.childAuthorizedFinalBlock).toBe(target);
  });
});

describe("verifyChildCleanResult", () => {
  it("accepts an exact clean execute-mode max_windows_reached completion", () => {
    const result = verifyChildCleanResult({
      processResult: cleanExecuteResult({ windows: 5, reachedTarget: false }),
      execute: true,
      expectedChildMaxWindows: 5,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts an exact clean DRY-RUN completion (windowsCompleted stays 0)", () => {
    const result = verifyChildCleanResult({
      processResult: cleanDryRunResult({ windows: 5, reachedTarget: false }),
      execute: false,
      expectedChildMaxWindows: 5,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a dry-run child that reports execute-mode windowsCompleted semantics", () => {
    const result = verifyChildCleanResult({
      processResult: cleanExecuteResult({ windows: 5, reachedTarget: false }),
      execute: false,
      expectedChildMaxWindows: 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/expected exactly 0/);
  });

  it("rejects an execute-mode child that reports dry-run windowsCompleted semantics", () => {
    const result = verifyChildCleanResult({
      processResult: cleanDryRunResult({ windows: 5, reachedTarget: false }),
      execute: true,
      expectedChildMaxWindows: 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/expected exactly 5/);
  });

  it("rejects a signal-terminated process distinctly from a plain exit code", () => {
    const result = verifyChildCleanResult({
      processResult: { exitCode: 1, stdout: "", stderr: "", signal: "SIGTERM" },
      execute: true,
      expectedChildMaxWindows: 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/AMBIGUOUS/);
  });

  it("reaches the exit-code gate when exitCode is non-zero and there is no signal", () => {
    const result = verifyChildCleanResult({
      processResult: { exitCode: 1, stdout: "", stderr: "boom" },
      execute: true,
      expectedChildMaxWindows: 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/exited with code 1/);
  });

  it("reaches the stoppedReason allowlist gate (not the exit-code gate) for an unexpected reason", () => {
    const result = verifyChildCleanResult({
      processResult: {
        exitCode: 0,
        stdout: cleanChildStdout({ stoppedReason: "invariant_failed_after_run", windowsCompleted: 2, lastWindowNumber: 3 }),
        stderr: "",
      },
      execute: true,
      expectedChildMaxWindows: 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not an allowlisted clean completion/);
  });

  it("rejects unparseable stdout", () => {
    const result = verifyChildCleanResult({
      processResult: { exitCode: 0, stdout: "not json", stderr: "" },
      execute: true,
      expectedChildMaxWindows: 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/could not be parsed/);
  });

  it("rejects a window-count mismatch in execute mode", () => {
    const result = verifyChildCleanResult({
      processResult: cleanExecuteResult({ windows: 4, reachedTarget: false }),
      execute: true,
      expectedChildMaxWindows: 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/expected exactly 5/);
  });

  it("rejects a lastWindowNumber mismatch even when windowsCompleted matches (isolated from the count gate)", () => {
    const result = verifyChildCleanResult({
      processResult: {
        exitCode: 0,
        stdout: cleanChildStdout({ stoppedReason: "max_windows_reached", windowsCompleted: 5, lastWindowNumber: 4 }),
        stderr: "",
      },
      execute: true,
      expectedChildMaxWindows: 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/lastWindowNumber 4/);
  });
});

describe("verifyCanonicalCursorAfterChild", () => {
  it("passes when the cursor moved exactly as expected", () => {
    const gate = verifyCanonicalCursorAfterChild({
      liveCursorAfter: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_083_548n },
      expectedAnchorFromBlock: FIXTURE_ANCHOR_FROM,
      expectedToBlock: 25_083_548n,
    });
    expect(gate.ok).toBe(true);
  });

  it("fails when the anchor fromBlock drifted", () => {
    const gate = verifyCanonicalCursorAfterChild({
      liveCursorAfter: { fromBlock: FIXTURE_ANCHOR_FROM + 1n, toBlock: 25_083_548n },
      expectedAnchorFromBlock: FIXTURE_ANCHOR_FROM,
      expectedToBlock: 25_083_548n,
    });
    expect(gate.ok).toBe(false);
  });

  it("fails when toBlock does not exactly match the expected child range", () => {
    const gate = verifyCanonicalCursorAfterChild({
      liveCursorAfter: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_083_000n },
      expectedAnchorFromBlock: FIXTURE_ANCHOR_FROM,
      expectedToBlock: 25_083_548n,
    });
    expect(gate.ok).toBe(false);
  });

  it("fails when the cursor is missing entirely", () => {
    const gate = verifyCanonicalCursorAfterChild({
      liveCursorAfter: null,
      expectedAnchorFromBlock: FIXTURE_ANCHOR_FROM,
      expectedToBlock: 25_083_548n,
    });
    expect(gate.ok).toBe(false);
  });
});

describe("verifyDryRunNoCanonicalMutation", () => {
  it("passes when the cursor is byte-for-byte unchanged", () => {
    const gate = verifyDryRunNoCanonicalMutation({
      cursorBefore: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n },
      cursorAfter: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n },
    });
    expect(gate.ok).toBe(true);
  });

  it("fails when the cursor advanced despite no --execute", () => {
    const gate = verifyDryRunNoCanonicalMutation({
      cursorBefore: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n },
      cursorAfter: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_079_548n },
    });
    expect(gate.ok).toBe(false);
  });

  it("fails when the cursor disappeared", () => {
    const gate = verifyDryRunNoCanonicalMutation({
      cursorBefore: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n },
      cursorAfter: null,
    });
    expect(gate.ok).toBe(false);
  });
});

describe("evaluateRepositoryDrift", () => {
  it("passes when HEAD and working tree are unchanged", () => {
    const gate = evaluateRepositoryDrift({ supervisorStartHead: FIXTURE_HEAD, currentHead: FIXTURE_HEAD, workingTreeClean: true });
    expect(gate.ok).toBe(true);
  });

  it("fails on HEAD drift", () => {
    const gate = evaluateRepositoryDrift({ supervisorStartHead: FIXTURE_HEAD, currentHead: "other-sha", workingTreeClean: true });
    expect(gate.ok).toBe(false);
  });

  it("fails on a dirty working tree", () => {
    const gate = evaluateRepositoryDrift({ supervisorStartHead: FIXTURE_HEAD, currentHead: FIXTURE_HEAD, workingTreeClean: false });
    expect(gate.ok).toBe(false);
  });
});

describe("evaluateEnvironmentDrift", () => {
  it("passes when app.env is unchanged", () => {
    const gate = evaluateEnvironmentDrift({ supervisorStartAppEnv: "development", currentAppEnv: "development" });
    expect(gate.ok).toBe(true);
  });

  it("fails when app.env changed between children even though health stayed ok", () => {
    const gate = evaluateEnvironmentDrift({ supervisorStartAppEnv: "development", currentAppEnv: "production" });
    expect(gate.ok).toBe(false);
  });

  it("fails when app.env becomes undefined after starting defined", () => {
    const gate = evaluateEnvironmentDrift({ supervisorStartAppEnv: "development", currentAppEnv: undefined });
    expect(gate.ok).toBe(false);
  });
});

describe("verifyPriorTerminalOperationClean", () => {
  it("passes for exactly one clean COMPLETED TRANSFERS run", () => {
    const result = verifyPriorTerminalOperationClean({ candidates: [completedRun()] });
    expect(result.ok).toBe(true);
  });

  it("fails closed when no candidate evidence exists", () => {
    const result = verifyPriorTerminalOperationClean({ candidates: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no persisted TRANSFERS SyncRun evidence/);
  });

  it("fails closed when more than one candidate shares the endBlock (ambiguous)", () => {
    const result = verifyPriorTerminalOperationClean({ candidates: [completedRun({ id: "a" }), completedRun({ id: "b" })] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/ambiguous/);
  });

  it("fails closed when the sole candidate has a non-zero warningCount", () => {
    const result = verifyPriorTerminalOperationClean({ candidates: [completedRun({ warningCount: 2, warningDetails: [{ code: "X" }] })] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/warningCount/);
  });

  it("fails closed when the sole candidate is not COMPLETED", () => {
    const result = verifyPriorTerminalOperationClean({ candidates: [completedRun({ status: "FAILED" })] });
    expect(result.ok).toBe(false);
  });

  it("fails closed when the sole candidate has an errorMessage", () => {
    const result = verifyPriorTerminalOperationClean({ candidates: [completedRun({ errorMessage: "boom" })] });
    expect(result.ok).toBe(false);
  });

  it("ignores non-TRANSFERS candidates and treats them as absent evidence", () => {
    const result = verifyPriorTerminalOperationClean({
      candidates: [completedRun({ sourceFamilies: ["LP"] as unknown as readonly string[] })],
    });
    expect(result.ok).toBe(false);
  });
});

describe("computeStartingChildCampaignNumber", () => {
  it("starts at 1 when no matching policy labels exist", () => {
    const n = computeStartingChildCampaignNumber({
      existingPolicyLabels: [],
      policyLabelPrefix: FIXTURE_PREFIX,
      campaignIdPrefix: FIXTURE_CAMPAIGN_ID_PREFIX,
    });
    expect(n).toBe(1);
  });

  it("resumes past the highest previously-used child number for this exact prefix pair", () => {
    const n = computeStartingChildCampaignNumber({
      existingPolicyLabels: [
        `${FIXTURE_PREFIX}-${FIXTURE_CAMPAIGN_ID_PREFIX}-c1-w1`,
        `${FIXTURE_PREFIX}-${FIXTURE_CAMPAIGN_ID_PREFIX}-c1-w2`,
        `${FIXTURE_PREFIX}-${FIXTURE_CAMPAIGN_ID_PREFIX}-c2-w1`,
      ],
      policyLabelPrefix: FIXTURE_PREFIX,
      campaignIdPrefix: FIXTURE_CAMPAIGN_ID_PREFIX,
    });
    expect(n).toBe(3);
  });

  it("ignores labels belonging to a different campaign-id prefix", () => {
    const n = computeStartingChildCampaignNumber({
      existingPolicyLabels: [`${FIXTURE_PREFIX}-some-other-prefix-c9-w1`],
      policyLabelPrefix: FIXTURE_PREFIX,
      campaignIdPrefix: FIXTURE_CAMPAIGN_ID_PREFIX,
    });
    expect(n).toBe(1);
  });

  it("ignores labels belonging to a different policy-label prefix", () => {
    const n = computeStartingChildCampaignNumber({
      existingPolicyLabels: [`other-policy-prefix-${FIXTURE_CAMPAIGN_ID_PREFIX}-c9-w1`],
      policyLabelPrefix: FIXTURE_PREFIX,
      campaignIdPrefix: FIXTURE_CAMPAIGN_ID_PREFIX,
    });
    expect(n).toBe(1);
  });

  it("treats prefix regex metacharacters literally", () => {
    const n = computeStartingChildCampaignNumber({
      existingPolicyLabels: ["prefix.plus-idpre.fix-c5-w1"],
      policyLabelPrefix: "prefix.plus",
      campaignIdPrefix: "idpre.fix",
    });
    expect(n).toBe(6);
  });
});

describe("validateChildCampaignId / buildChildCampaignId", () => {
  it("accepts a valid built id", () => {
    expect(validateChildCampaignId("stage1-c3").ok).toBe(true);
  });

  it("rejects a built id over 64 characters (boundary)", () => {
    const prefix63 = "p".repeat(63);
    const id = buildChildCampaignId(prefix63, 1); // 63 + "-c1" = 66 chars
    expect(id.length).toBeGreaterThan(64);
    expect(validateChildCampaignId(id).ok).toBe(false);
  });

  it("accepts a built id at exactly 64 characters (boundary)", () => {
    const prefix = "p".repeat(61); // 61 + "-c1" (3) = 64
    const id = buildChildCampaignId(prefix, 1);
    expect(id.length).toBe(64);
    expect(validateChildCampaignId(id).ok).toBe(true);
  });

  it("rejects an id that grows past 64 characters only at a large child number (e.g. c10)", () => {
    const prefix = "p".repeat(60); // "-c9" (3 chars) => 63 ok; "-c10" (4 chars) => 64 ok too
    const okAt9 = buildChildCampaignId(prefix, 9);
    const okAt10 = buildChildCampaignId(prefix, 10);
    expect(validateChildCampaignId(okAt9).ok).toBe(true);
    expect(validateChildCampaignId(okAt10).ok).toBe(true);
    const prefix61 = "p".repeat(61);
    const failsAt10 = buildChildCampaignId(prefix61, 10); // 61 + "-c10" (4) = 65
    expect(validateChildCampaignId(failsAt10).ok).toBe(false);
  });
});

describe("validateCampaignIdPrefix", () => {
  it("accepts a valid prefix", () => {
    expect(validateCampaignIdPrefix({ campaignIdPrefix: "stage1-2026" }).ok).toBe(true);
  });

  it("rejects an invalid prefix charset", () => {
    expect(validateCampaignIdPrefix({ campaignIdPrefix: "bad prefix!" }).ok).toBe(false);
  });
});

describe("computeChildProcessTimeoutMs", () => {
  it("scales with childMaxWindows and pollTimeoutMs and stays bounded/positive", () => {
    const small = computeChildProcessTimeoutMs({ childMaxWindows: 1, pollTimeoutMs: 1000 });
    const large = computeChildProcessTimeoutMs({ childMaxWindows: 100, pollTimeoutMs: 1000 });
    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small);
  });

  it("always includes the fixed startup margin even for a single-window child", () => {
    const timeout = computeChildProcessTimeoutMs({ childMaxWindows: 1, pollTimeoutMs: 0 });
    expect(timeout).toBeGreaterThanOrEqual(5 * 60_000);
  });

  it("clamps to MAX_CHILD_PROCESS_TIMEOUT_MS instead of overflowing Node's 32-bit setTimeout ceiling (regression)", () => {
    // A 1000-window campaign at a generous 1-hour --poll-timeout-ms derives
    // an unclamped value of 3,720,300,000 ms — past Node's 2,147,483,647 ms
    // (2^31-1) setTimeout ceiling. Node silently truncates an oversized
    // `timeout` option instead of honoring it, which would otherwise kill
    // the child almost immediately and produce a spurious
    // child_process_ambiguous_termination on a perfectly legitimate,
    // approved, large campaign.
    const timeout = computeChildProcessTimeoutMs({ childMaxWindows: 1000, pollTimeoutMs: 3_600_000 });
    expect(timeout).toBe(MAX_CHILD_PROCESS_TIMEOUT_MS);
    expect(timeout).toBeLessThanOrEqual(2_147_483_647);
  });

  it("does not clamp a reasonable derived timeout that is already under the ceiling", () => {
    const timeout = computeChildProcessTimeoutMs({ childMaxWindows: 5, pollTimeoutMs: 1_200_000 });
    expect(timeout).toBeLessThan(MAX_CHILD_PROCESS_TIMEOUT_MS);
  });
});

describe("parseSupervisorCliArgs", () => {
  function requiredArgv(overrides: Record<string, string> = {}): string[] {
    const values: Record<string, string> = {
      "--wallet-address": FIXTURE_WALLET,
      "--chain-id": "369",
      "--authorized-final-block": "25088548",
      "--campaign-max-windows": "10",
      "--window-size": "1000",
      "--campaign-id-prefix": FIXTURE_CAMPAIGN_ID_PREFIX,
      "--policy-label-prefix": FIXTURE_PREFIX,
      "--base-url": "http://localhost:3100",
      ...overrides,
    };
    const argv: string[] = [];
    for (const [flag, value] of Object.entries(values)) argv.push(flag, value);
    return argv;
  }

  it("parses a valid full argv into options and pins every parsed value", () => {
    const result = parseSupervisorCliArgs(requiredArgv());
    if (!result.ok) throw new Error(`expected a successful parse, got: ${result.error}`);
    expect(result.options.walletAddress).toBe(FIXTURE_WALLET.toLowerCase());
    expect(result.options.chainId).toBe(369);
    expect(result.options.authorizedFinalBlock).toBe(25_088_548n);
    expect(result.options.windowSizeBlocks).toBe(1_000n);
    expect(result.options.campaignMaxWindows).toBe(10);
    expect(result.options.campaignIdPrefix).toBe(FIXTURE_CAMPAIGN_ID_PREFIX);
    expect(result.options.policyLabelPrefix).toBe(FIXTURE_PREFIX);
    expect(result.options.baseUrl).toBe("http://localhost:3100");
    expect(result.options.checkpointIntervalWindows).toBe(25);
  });

  it("defaults to dry-run (execute=false)", () => {
    const result = parseSupervisorCliArgs(requiredArgv());
    if (!result.ok) throw new Error(`expected a successful parse, got: ${result.error}`);
    expect(result.options.execute).toBe(false);
  });

  it("rejects --window-size other than 1000", () => {
    const result = parseSupervisorCliArgs(requiredArgv({ "--window-size": "500" }));
    expect(result.ok).toBe(false);
  });

  it("rejects --campaign-max-windows above the hard cap", () => {
    const result = parseSupervisorCliArgs(requiredArgv({ "--campaign-max-windows": "1001" }));
    expect(result.ok).toBe(false);
  });

  it("rejects a --checkpoint-interval above the campaign runner's own bound (25)", () => {
    const result = parseSupervisorCliArgs(requiredArgv({ "--checkpoint-interval": "26" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/checkpoint/i);
  });

  it("accepts a --checkpoint-interval at the boundary (25)", () => {
    const result = parseSupervisorCliArgs(requiredArgv({ "--checkpoint-interval": "25" }));
    expect(result.ok).toBe(true);
  });

  it("rejects a missing --base-url", () => {
    const argv = requiredArgv();
    const idx = argv.indexOf("--base-url");
    argv.splice(idx, 2);
    const result = parseSupervisorCliArgs(argv);
    expect(result.ok).toBe(false);
  });

  it("has no --recovery-mode flag support at all", () => {
    const result = parseSupervisorCliArgs([...requiredArgv(), "--recovery-mode"]);
    expect(result.ok).toBe(false);
  });

  it("rejects the documented-incorrect bare '--' separator (regression: docs must match this)", () => {
    const result = parseSupervisorCliArgs(["--", ...requiredArgv()]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Unknown argument: --/);
  });
});

// ─── Orchestrator tests ─────────────────────────────────────────────────────

describe("runWalletForwardSupervisor", () => {
  it("scenario 1 (execute): one clean child reaches the target", async () => {
    const options = baseOptions({ execute: true, authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 10 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => {
      db.setCursor({ fromBlock: FIXTURE_ANCHOR_FROM, toBlock: options.authorizedFinalBlock });
      return cleanExecuteResult({ windows: 3, reachedTarget: true });
    });
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("authorized_final_block_reached");
    expect(summary.childCampaignsCompleted).toBe(1);
    expect(runChildCampaign).toHaveBeenCalledTimes(1);
    expect(computeSupervisorExitCode(summary.stoppedReason)).toBe(0);
    expect(SUPERVISOR_CLEAN_STOP_REASONS.has(summary.stoppedReason)).toBe(true);
  });

  it("scenario 1b (dry-run): a clean simulated child reaches the target WITHOUT touching PostgreSQL", async () => {
    const options = baseOptions({ execute: false, authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 10 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => {
      // Deliberately does NOT call db.setCursor — proving the supervisor
      // never requires or trusts a DB mutation for a dry-run child to
      // succeed.
      return cleanDryRunResult({ windows: 3, reachedTarget: true });
    });
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("authorized_final_block_reached");
    expect(summary.childCampaignsCompleted).toBe(1);
    expect(runChildCampaign).toHaveBeenCalledTimes(1);
    // The real canonical cursor genuinely never moved.
    const finalCursor = await db.syncCursor.findUnique({});
    expect(finalCursor?.toBlock).toBe(25_078_548n);
  });

  it("scenario 1c (dry-run): multiple simulated children plan sequentially toward the target without DB mutation", async () => {
    const options = baseOptions({ execute: false, authorizedFinalBlock: 25_078_548n + 6n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 2 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const seenFirstWindowStarts: string[] = [];
    let call = 0;
    const runChildCampaign = vi.fn(async (args: string[]): Promise<ChildProcessResult> => {
      call += 1;
      const idx = args.indexOf("--first-window-start");
      seenFirstWindowStarts.push(args[idx + 1]);
      const reachedTarget = call === 3;
      return cleanDryRunResult({ windows: 2, reachedTarget });
    });
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("authorized_final_block_reached");
    expect(summary.childCampaignsCompleted).toBe(3);
    // Each simulated child planned from a distinct, advancing start block —
    // proving in-memory simulation actually progressed across children.
    expect(seenFirstWindowStarts).toEqual([
      "25078549",
      (25_078_548n + 2n * FIXTURE_WINDOW_SIZE + 1n).toString(),
      (25_078_548n + 4n * FIXTURE_WINDOW_SIZE + 1n).toString(),
    ]);
    const finalCursor = await db.syncCursor.findUnique({});
    expect(finalCursor?.toBlock).toBe(25_078_548n);
  });

  it("scenario: dry-run stops closed if the child unexpectedly mutated canonical state anyway", async () => {
    const options = baseOptions({ execute: false, authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 10 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => {
      // A dry-run child must never mutate the DB; simulate a bug/violation.
      db.setCursor({ fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n + FIXTURE_WINDOW_SIZE });
      return cleanDryRunResult({ windows: 3, reachedTarget: true });
    });
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("dry_run_unexpected_mutation");
    expect(computeSupervisorExitCode(summary.stoppedReason)).toBe(1);
  });

  it("scenario 2 (execute): multiple clean bounded children reach one fixed target", async () => {
    const options = baseOptions({ execute: true, authorizedFinalBlock: 25_078_548n + 6n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 2 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    let calls = 0;
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => {
      calls += 1;
      const current = (await db.syncCursor.findUnique({}))!;
      const nextTo = current.toBlock + 2n * FIXTURE_WINDOW_SIZE;
      db.setCursor({ fromBlock: FIXTURE_ANCHOR_FROM, toBlock: nextTo });
      return cleanExecuteResult({ windows: 2, reachedTarget: nextTo === options.authorizedFinalBlock });
    });
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("authorized_final_block_reached");
    expect(summary.childCampaignsCompleted).toBe(3);
    expect(calls).toBe(3);
    // Evidence proves the full lifecycle was recorded, in order, with the
    // effective child evidence path always resolved (never null).
    expect(deps.evidence.map((r) => r.kind)).toEqual([
      "supervisor_start",
      "child_campaign_start",
      "child_campaign_result",
      "child_campaign_start",
      "child_campaign_result",
      "child_campaign_start",
      "child_campaign_result",
      "supervisor_summary",
    ]);
    for (const record of deps.evidence.filter((r) => r.kind === "child_campaign_start" || (r.kind === "child_campaign_result" && r.ok))) {
      expect(record.childEvidenceFile).toBe(DEFAULT_CHILD_EVIDENCE_FILE);
    }
  });

  it("scenario 3 (execute): a max-windows child stop is followed by a valid next campaign", async () => {
    const options = baseOptions({ execute: true, authorizedFinalBlock: 25_078_548n + 4n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 3 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => {
      const current = (await db.syncCursor.findUnique({}))!;
      const remaining = (options.authorizedFinalBlock - current.toBlock) / FIXTURE_WINDOW_SIZE;
      const windows = remaining < BigInt(options.campaignMaxWindows) ? Number(remaining) : options.campaignMaxWindows;
      const nextTo = current.toBlock + BigInt(windows) * FIXTURE_WINDOW_SIZE;
      db.setCursor({ fromBlock: FIXTURE_ANCHOR_FROM, toBlock: nextTo });
      return cleanExecuteResult({ windows, reachedTarget: nextTo === options.authorizedFinalBlock });
    });
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("authorized_final_block_reached");
    expect(summary.childCampaignsCompleted).toBe(2);
  });

  it("scenario 4: non-zero child exit code stops the supervisor", async () => {
    const options = baseOptions({ execute: true, authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 10 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => ({ exitCode: 1, stdout: "", stderr: "boom" }));
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("child_result_not_clean");
    expect(computeSupervisorExitCode(summary.stoppedReason)).toBe(1);
    expect(runChildCampaign).toHaveBeenCalledTimes(1);
  });

  it("scenario 5: an unexpected stoppedReason (e.g. a warning-triggered invariant failure) stops the supervisor", async () => {
    const options = baseOptions({ execute: true, authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 10 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => ({
      exitCode: 1,
      stdout: cleanChildStdout({ stoppedReason: "invariant_failed_after_run", windowsCompleted: 1, lastWindowNumber: 1 }),
      stderr: "",
    }));
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("child_result_not_clean");
  });

  it("scenario: a signal-terminated (e.g. timed-out) child stops with the distinct ambiguous-termination reason", async () => {
    const options = baseOptions({ execute: true, authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 10 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => ({
      exitCode: 1,
      stdout: "",
      stderr: "",
      signal: "SIGTERM",
    }));
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("child_process_ambiguous_termination");
    expect(computeSupervisorExitCode(summary.stoppedReason)).toBe(1);
    // Never retried.
    expect(runChildCampaign).toHaveBeenCalledTimes(1);
  });

  it("scenario 6: a window-count mismatch stops the supervisor", async () => {
    const options = baseOptions({ execute: true, authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 3 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => cleanExecuteResult({ windows: 2, reachedTarget: false }));
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("child_result_not_clean");
    expect(summary.detail).toMatch(/expected exactly 3/);
  });

  it("scenario 7: canonical cursor mismatch after a clean-looking execute child stops the supervisor", async () => {
    const options = baseOptions({ execute: true, authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 3 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => {
      // Canonical cursor never actually advances, even though the child
      // self-reports a clean completion — the supervisor must not trust
      // that self-report alone.
      return cleanExecuteResult({ windows: 3, reachedTarget: true });
    });
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("canonical_cursor_mismatch_after_child");
  });

  it("scenario 8: a child range mismatch (fewer windows than expected) stops the supervisor", async () => {
    const options = baseOptions({ execute: true, authorizedFinalBlock: 25_078_548n + 5n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 5 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => cleanExecuteResult({ windows: 4, reachedTarget: false }));
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("child_result_not_clean");
  });

  it("scenario 9: the supervisor never derives a child range past the authorized final block", async () => {
    const options = baseOptions({ execute: true, authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 1000 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    let capturedArgs: string[] = [];
    const runChildCampaign = vi.fn(async (args: string[]): Promise<ChildProcessResult> => {
      capturedArgs = args;
      db.setCursor({ fromBlock: FIXTURE_ANCHOR_FROM, toBlock: options.authorizedFinalBlock });
      return cleanExecuteResult({ windows: 3, reachedTarget: true });
    });
    const deps = makeDeps({ db, runChildCampaign });

    await runWalletForwardSupervisor(options, deps);

    const idx = capturedArgs.indexOf("--authorized-final-block");
    expect(BigInt(capturedArgs[idx + 1])).toBeLessThanOrEqual(options.authorizedFinalBlock);
    expect(BigInt(capturedArgs[idx + 1])).toBe(options.authorizedFinalBlock);
    expect(capturedArgs).not.toContain("--recovery-mode");
  });

  it("scenario 10: evidence append failure stops the supervisor", async () => {
    const options = baseOptions({ execute: true, authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 10 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const deps = makeDeps({
      db,
      writeEvidence: async () => {
        throw new Error("disk full");
      },
    });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("evidence_append_failed");
    expect(computeSupervisorExitCode(summary.stoppedReason)).toBe(1);
  });

  it("scenario 11: repository HEAD drift between child campaigns stops the supervisor", async () => {
    const options = baseOptions({ execute: true, authorizedFinalBlock: 25_078_548n + 6n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 2 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    let childCompleted = false;
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => {
      const current = (await db.syncCursor.findUnique({}))!;
      db.setCursor({ fromBlock: FIXTURE_ANCHOR_FROM, toBlock: current.toBlock + 2n * FIXTURE_WINDOW_SIZE });
      childCompleted = true;
      return cleanExecuteResult({ windows: 2, reachedTarget: false });
    });
    // Drift only after the first child has completed, regardless of exactly
    // how many times the supervisor happens to read HEAD along the way —
    // keyed off actual progress, not a hardcoded call count.
    const getGitHead = vi.fn(async () => (childCompleted ? "drifted-sha" : FIXTURE_HEAD));
    const deps = makeDeps({ db, runChildCampaign, getGitHead });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("repository_drift_detected");
    expect(runChildCampaign).toHaveBeenCalledTimes(1);
  });

  it("scenario 12: a dirty working tree between child campaigns stops the supervisor", async () => {
    const options = baseOptions({ execute: true, authorizedFinalBlock: 25_078_548n + 6n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 2 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    let childCompleted = false;
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => {
      const current = (await db.syncCursor.findUnique({}))!;
      db.setCursor({ fromBlock: FIXTURE_ANCHOR_FROM, toBlock: current.toBlock + 2n * FIXTURE_WINDOW_SIZE });
      childCompleted = true;
      return cleanExecuteResult({ windows: 2, reachedTarget: false });
    });
    const isWorkingTreeClean = vi.fn(async () => !childCompleted);
    const deps = makeDeps({ db, runChildCampaign, isWorkingTreeClean });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("repository_drift_detected");
    expect(runChildCampaign).toHaveBeenCalledTimes(1);
  });

  it("environment drift between child campaigns stops the supervisor even though health stays 200/ok", async () => {
    const options = baseOptions({ execute: true, authorizedFinalBlock: 25_078_548n + 6n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 2 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    let childCompleted = false;
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => {
      const current = (await db.syncCursor.findUnique({}))!;
      db.setCursor({ fromBlock: FIXTURE_ANCHOR_FROM, toBlock: current.toBlock + 2n * FIXTURE_WINDOW_SIZE });
      childCompleted = true;
      return cleanExecuteResult({ windows: 2, reachedTarget: false });
    });
    const httpGet = vi.fn(async () => ({
      status: 200,
      body: { data: { status: "ok", app: { env: childCompleted ? "production" : FIXTURE_APP_ENV } } },
    }));
    const deps = makeDeps({ db, runChildCampaign, httpGet });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("environment_drift_detected");
    expect(runChildCampaign).toHaveBeenCalledTimes(1);
  });

  it("scenario 13: an unhealthy backend at supervisor start stops before any child runs", async () => {
    const options = baseOptions();
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => ({ exitCode: 0, stdout: "", stderr: "" }));
    const deps = makeDeps({ db, runChildCampaign, httpGet: async () => ({ status: 503, body: { data: { status: "degraded" } } }) });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("initial_health_baseline_failed");
    expect(runChildCampaign).not.toHaveBeenCalled();
  });

  it("a healthy backend that never reports app.env fails closed at startup instead of silently disabling environment drift detection", async () => {
    const options = baseOptions();
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => ({ exitCode: 0, stdout: "", stderr: "" }));
    const deps = makeDeps({
      db,
      runChildCampaign,
      httpGet: async () => ({ status: 200, body: { data: { status: "ok" } } }), // no app field at all
    });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("initial_health_baseline_failed");
    expect(summary.detail).toMatch(/app\.env/);
    expect(runChildCampaign).not.toHaveBeenCalled();
    expect(computeSupervisorExitCode(summary.stoppedReason)).toBe(1);
  });

  it("scenario 14: interruption before a child starts prevents that child from running", async () => {
    const options = baseOptions();
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => ({ exitCode: 0, stdout: "", stderr: "" }));
    const deps = makeDeps({ db, runChildCampaign, isInterrupted: () => true });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("interrupted");
    expect(runChildCampaign).not.toHaveBeenCalled();
    expect(computeSupervisorExitCode(summary.stoppedReason)).toBe(1);
  });

  it("scenario 15: no automatic retry after a child failure — exactly one invocation", async () => {
    const options = baseOptions({ execute: true, authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 10 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => ({ exitCode: 1, stdout: "", stderr: "network error" }));
    const deps = makeDeps({ db, runChildCampaign });

    await runWalletForwardSupervisor(options, deps);

    expect(runChildCampaign).toHaveBeenCalledTimes(1);
  });

  it("scenario 16: never invokes --recovery-mode on any child", async () => {
    const options = baseOptions({ execute: true, authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 10 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    let capturedArgs: string[] = [];
    const runChildCampaign = vi.fn(async (args: string[]): Promise<ChildProcessResult> => {
      capturedArgs = args;
      db.setCursor({ fromBlock: FIXTURE_ANCHOR_FROM, toBlock: options.authorizedFinalBlock });
      return cleanExecuteResult({ windows: 3, reachedTarget: true });
    });
    const deps = makeDeps({ db, runChildCampaign });

    await runWalletForwardSupervisor(options, deps);

    expect(capturedArgs).not.toContain("--recovery-mode");
    expect(capturedArgs).not.toContain("--recovery-of-run-id");
  });

  it("scenario 17: the immutable authorized-final-block is preserved unchanged across every iteration", async () => {
    const options = baseOptions({ execute: true, authorizedFinalBlock: 25_078_548n + 6n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 2 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const seenFinalBlocks: string[] = [];
    const runChildCampaign = vi.fn(async (args: string[]): Promise<ChildProcessResult> => {
      const idx = args.indexOf("--authorized-final-block");
      seenFinalBlocks.push(args[idx + 1]);
      const current = (await db.syncCursor.findUnique({}))!;
      const nextTo = current.toBlock + 2n * FIXTURE_WINDOW_SIZE;
      db.setCursor({ fromBlock: FIXTURE_ANCHOR_FROM, toBlock: nextTo });
      return cleanExecuteResult({ windows: 2, reachedTarget: nextTo === options.authorizedFinalBlock });
    });
    const deps = makeDeps({ db, runChildCampaign });

    await runWalletForwardSupervisor(options, deps);

    for (const seen of seenFinalBlocks) {
      expect(BigInt(seen)).toBeLessThanOrEqual(options.authorizedFinalBlock);
    }
    expect(BigInt(seenFinalBlocks[seenFinalBlocks.length - 1])).toBe(options.authorizedFinalBlock);
    expect(options.authorizedFinalBlock).toBe(25_078_548n + 6n * FIXTURE_WINDOW_SIZE);
  });

  it("scenario 18: resume derives position from canonical cursor state, not local counters", async () => {
    const options = baseOptions({ execute: true, authorizedFinalBlock: 25_078_548n + 6n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 2 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n + 4n * FIXTURE_WINDOW_SIZE } });
    let capturedArgs: string[] = [];
    const runChildCampaign = vi.fn(async (args: string[]): Promise<ChildProcessResult> => {
      capturedArgs = args;
      db.setCursor({ fromBlock: FIXTURE_ANCHOR_FROM, toBlock: options.authorizedFinalBlock });
      return cleanExecuteResult({ windows: 2, reachedTarget: true });
    });
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    const idx = capturedArgs.indexOf("--first-window-start");
    expect(capturedArgs[idx + 1]).toBe((25_078_548n + 4n * FIXTURE_WINDOW_SIZE + 1n).toString());
    expect(summary.childCampaignsCompleted).toBe(1);
  });

  it("scenario 18b: resume derives the NEXT CHILD CAMPAIGN NUMBER from canonical policy labels, never restarting at c1", async () => {
    const options = baseOptions({ execute: true, authorizedFinalBlock: 25_078_548n + 2n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 2 });
    const db = makeFakeDb({
      cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n },
      policyLabels: [`${FIXTURE_PREFIX}-${FIXTURE_CAMPAIGN_ID_PREFIX}-c1-w1`, `${FIXTURE_PREFIX}-${FIXTURE_CAMPAIGN_ID_PREFIX}-c1-w2`],
    });
    let capturedArgs: string[] = [];
    const runChildCampaign = vi.fn(async (args: string[]): Promise<ChildProcessResult> => {
      capturedArgs = args;
      db.setCursor({ fromBlock: FIXTURE_ANCHOR_FROM, toBlock: options.authorizedFinalBlock });
      return cleanExecuteResult({ windows: 2, reachedTarget: true });
    });
    const deps = makeDeps({ db, runChildCampaign });

    await runWalletForwardSupervisor(options, deps);

    const idx = capturedArgs.indexOf("--campaign-id");
    expect(capturedArgs[idx + 1]).toBe(`${FIXTURE_CAMPAIGN_ID_PREFIX}-c2`);
  });

  it("scenario 19: a target already reached before any child runs completes cleanly with zero children (fresh wallet, no prior evidence needed)", async () => {
    const options = baseOptions({ authorizedFinalBlock: FIXTURE_ANCHOR_FROM });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: FIXTURE_ANCHOR_FROM } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => ({ exitCode: 0, stdout: "", stderr: "" }));
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("authorized_final_block_already_reached");
    expect(summary.childCampaignsCompleted).toBe(0);
    expect(runChildCampaign).not.toHaveBeenCalled();
    expect(computeSupervisorExitCode(summary.stoppedReason)).toBe(0);
  });

  it("scenario 19b: a non-trivial target-already-reached resume verifies clean persisted terminal evidence before reporting success", async () => {
    const options = baseOptions({ authorizedFinalBlock: 25_078_548n });
    const db = makeFakeDb({
      cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n },
      runsByEndBlock: [completedRun({ endBlock: 25_078_548n })],
    });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => ({ exitCode: 0, stdout: "", stderr: "" }));
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("authorized_final_block_already_reached");
    expect(runChildCampaign).not.toHaveBeenCalled();
  });

  it("scenario 19c: a non-trivial target-already-reached resume stops closed when the terminal SyncRun evidence carried warnings", async () => {
    const options = baseOptions({ authorizedFinalBlock: 25_078_548n });
    const db = makeFakeDb({
      cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n },
      runsByEndBlock: [completedRun({ endBlock: 25_078_548n, warningCount: 3, warningDetails: [{ code: "X" }] })],
    });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => ({ exitCode: 0, stdout: "", stderr: "" }));
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("prior_terminal_operation_not_verified_clean");
    expect(computeSupervisorExitCode(summary.stoppedReason)).toBe(1);
    expect(runChildCampaign).not.toHaveBeenCalled();
  });

  it("scenario 19d: a non-trivial target-already-reached resume stops closed when no terminal SyncRun evidence exists at all", async () => {
    const options = baseOptions({ authorizedFinalBlock: 25_078_548n });
    const db = makeFakeDb({
      cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n },
      runsByEndBlock: [],
    });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => ({ exitCode: 0, stdout: "", stderr: "" }));
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("prior_terminal_operation_not_verified_clean");
    expect(runChildCampaign).not.toHaveBeenCalled();
  });

  it("child_process_spawn_failed when the child process cannot even be spawned", async () => {
    const options = baseOptions();
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => {
      throw new Error("ENOENT: npx not found");
    });
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("child_process_spawn_failed");
    expect(computeSupervisorExitCode(summary.stoppedReason)).toBe(1);
  });

  it("wallet_not_found stops before any child runs", async () => {
    const options = baseOptions();
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => ({ exitCode: 0, stdout: "", stderr: "" }));
    const deps = makeDeps({ db, runChildCampaign, resolveWallet: async () => null });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("wallet_not_found");
    expect(runChildCampaign).not.toHaveBeenCalled();
  });

  it("working_tree_dirty at startup stops before any child runs", async () => {
    const options = baseOptions();
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => ({ exitCode: 0, stdout: "", stderr: "" }));
    const deps = makeDeps({ db, runChildCampaign, isWorkingTreeClean: async () => false });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("working_tree_dirty");
    expect(runChildCampaign).not.toHaveBeenCalled();
  });

  it("canonical_cursor_missing stops before any child runs", async () => {
    const options = baseOptions();
    const db = makeFakeDb({ cursor: null });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => ({ exitCode: 0, stdout: "", stderr: "" }));
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("canonical_cursor_missing");
    expect(runChildCampaign).not.toHaveBeenCalled();
  });

  it("canonical_state_invalid stops on a misaligned authorized final block", async () => {
    const options = baseOptions({ authorizedFinalBlock: 25_078_548n + 500n });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => ({ exitCode: 0, stdout: "", stderr: "" }));
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("canonical_state_invalid");
    expect(runChildCampaign).not.toHaveBeenCalled();
    expect(computeSupervisorExitCode(summary.stoppedReason)).toBe(1);
  });

  it("child_campaign_id_invalid stops before evidence is written or the child is spawned (boundary: overlong prefix)", async () => {
    const overlongPrefix = "p".repeat(63); // "-c1" pushes this to 66 chars
    const options = baseOptions({
      execute: true,
      campaignIdPrefix: overlongPrefix,
      authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE,
      campaignMaxWindows: 10,
    });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => ({ exitCode: 0, stdout: "", stderr: "" }));
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("child_campaign_id_invalid");
    expect(runChildCampaign).not.toHaveBeenCalled();
    expect(deps.evidence.some((r) => r.kind === "child_campaign_start")).toBe(false);
  });

  it("invalid_checkpoint_interval is re-validated at runtime even if a caller bypasses parseSupervisorCliArgs", async () => {
    const options = baseOptions({ checkpointIntervalWindows: 26 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => ({ exitCode: 0, stdout: "", stderr: "" }));
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("invalid_checkpoint_interval");
    expect(runChildCampaign).not.toHaveBeenCalled();
  });

  it("dependency exception mid-loop (e.g. a rejected cursor read) still produces stop evidence, not just a bare rejection", async () => {
    const options = baseOptions({ execute: true, authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 10 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    let getGitHeadCalls = 0;
    const getGitHead = vi.fn(async () => {
      getGitHeadCalls += 1;
      if (getGitHeadCalls > 1) {
        throw new Error("git binary not found");
      }
      return FIXTURE_HEAD;
    });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => ({ exitCode: 0, stdout: "", stderr: "" }));
    const deps = makeDeps({ db, runChildCampaign, getGitHead });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("unexpected_error");
    expect(summary.detail).toMatch(/git binary not found/);
    expect(deps.evidence.some((r) => r.kind === "stop" && r.reason === "unexpected_error")).toBe(true);
    expect(runChildCampaign).not.toHaveBeenCalled();
  });
});

describe("resolveTsxCliPath (Windows spawn ENOENT/EINVAL fix)", () => {
  it("resolves to tsx's real on-disk .mjs CLI entrypoint, not a bin/ shim", () => {
    // This is the executable-resolution strategy that replaced "spawn npx"
    // (ENOENT on Windows) and "spawn npx.cmd" (EINVAL on Windows — Node
    // refuses to launch .bat/.cmd files without shell:true). Resolving
    // straight to tsx's published "./cli" export and spawning it via
    // process.execPath (always a real, non-shell executable on every
    // platform) never touches npx, npx.cmd, tsx.cmd, or tsx.ps1 at all.
    const resolved = resolveTsxCliPath();
    expect(resolved).toMatch(/tsx[\\/]dist[\\/]cli\.mjs$/);
    expect(resolved).not.toMatch(/\.(cmd|bat|ps1)$/i);
  });

  it("returns an absolute, directly spawnable path (no further PATH lookup needed)", () => {
    const resolved = resolveTsxCliPath();
    const isAbsolute = /^([A-Za-z]:[\\/]|\/)/.test(resolved);
    expect(isAbsolute).toBe(true);
  });

  it("is stable across repeated calls (pure resolution, no process/env mutation)", () => {
    expect(resolveTsxCliPath()).toBe(resolveTsxCliPath());
  });
});

describe("child invocation: executable selection, argument array, and --execute propagation", () => {
  it("dry-run (the default) never appends --execute to the child argument array", async () => {
    const options = baseOptions({
      execute: false,
      authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE,
      campaignMaxWindows: 5,
    });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    let capturedArgs: string[] = [];
    const runChildCampaign = vi.fn(async (args: string[]): Promise<ChildProcessResult> => {
      capturedArgs = args;
      return cleanDryRunResult({ windows: 3, reachedTarget: true });
    });
    const deps = makeDeps({ db, runChildCampaign });

    await runWalletForwardSupervisor(options, deps);

    expect(capturedArgs).not.toContain("--execute");
  });

  it("execute mode appends --execute exactly once to the child argument array", async () => {
    const options = baseOptions({
      execute: true,
      authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE,
      campaignMaxWindows: 5,
    });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    let capturedArgs: string[] = [];
    const runChildCampaign = vi.fn(async (args: string[]): Promise<ChildProcessResult> => {
      capturedArgs = args;
      db.setCursor({ fromBlock: FIXTURE_ANCHOR_FROM, toBlock: options.authorizedFinalBlock });
      return cleanExecuteResult({ windows: 3, reachedTarget: true });
    });
    const deps = makeDeps({ db, runChildCampaign });

    await runWalletForwardSupervisor(options, deps);

    expect(capturedArgs.filter((a) => a === "--execute")).toHaveLength(1);
  });

  it("arguments are passed to the injected runner as a plain string array — never concatenated into a shell command string", async () => {
    // The injectable runChildCampaign signature itself is (args: string[],
    // timeoutMs: number) — this test pins that every element the supervisor
    // builds stays a distinct array entry (no embedded spaces joining two
    // logical arguments, which would be the first symptom of an accidental
    // switch to string-based/shell invocation).
    const options = baseOptions({
      execute: false,
      authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE,
      campaignMaxWindows: 5,
    });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    let capturedArgs: string[] = [];
    const runChildCampaign = vi.fn(async (args: string[]): Promise<ChildProcessResult> => {
      capturedArgs = args;
      return cleanDryRunResult({ windows: 3, reachedTarget: true });
    });
    const deps = makeDeps({ db, runChildCampaign });

    await runWalletForwardSupervisor(options, deps);

    expect(Array.isArray(capturedArgs)).toBe(true);
    for (const entry of capturedArgs) {
      expect(typeof entry).toBe("string");
      expect(entry).not.toMatch(/\s/);
    }
    expect(capturedArgs).toContain("--wallet-address");
    expect(capturedArgs).toContain(FIXTURE_WALLET);
  });

  it("a spawn ENOENT failure (child process could not be started at all) still fails closed, with no retry and no recovery invocation", async () => {
    const options = baseOptions({
      execute: false,
      authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE,
      campaignMaxWindows: 5,
    });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => {
      throw new Error("spawn npx ENOENT");
    });
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).not.toBe("authorized_final_block_reached");
    expect(computeSupervisorExitCode(summary.stoppedReason)).toBe(1);
    expect(runChildCampaign).toHaveBeenCalledTimes(1);
    expect(deps.evidence.some((r) => r.kind === "stop")).toBe(true);
  });

  it("an ambiguous (signal-terminated) child termination still fails closed and never triggers a second invocation", async () => {
    const options = baseOptions({
      execute: true,
      authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE,
      campaignMaxWindows: 5,
    });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => ({
      exitCode: 1,
      stdout: "",
      stderr: "",
      signal: "SIGTERM",
    }));
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("child_process_ambiguous_termination");
    expect(computeSupervisorExitCode(summary.stoppedReason)).toBe(1);
    expect(runChildCampaign).toHaveBeenCalledTimes(1);
  });
});

describe("DEFAULT_CHILD_EVIDENCE_FILE", () => {
  it("matches the campaign runner's own documented default evidence path", () => {
    // Regression pin: this constant is intentionally duplicated (not
    // imported) from scripts/wallet-forward-campaign-runner.ts's own
    // DEFAULT_EVIDENCE_FILE — see the constant's doc comment. If the child
    // runner's default ever changes, this test must be updated alongside it.
    expect(DEFAULT_CHILD_EVIDENCE_FILE).toBe("operator-evidence/wallet-forward-campaign-runner/evidence.jsonl");
  });
});
