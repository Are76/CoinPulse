// Wallet-forward completion SUPERVISOR — focused unit tests.
//
// All DB, HTTP, git, and child-process dependencies are mocked/injected. No
// live calls, no real POST, no rebuild, and no execution of a live sync
// window happens anywhere in this file — the child campaign runner itself is
// never invoked for real; every test injects a fake `runChildCampaign`.

import { describe, expect, it, vi } from "vitest";

import {
  buildChildCampaignId,
  computeNextChildPlan,
  computeSupervisorExitCode,
  evaluateRepositoryDrift,
  parseSupervisorCliArgs,
  runWalletForwardSupervisor,
  SUPERVISOR_CLEAN_STOP_REASONS,
  validateCampaignIdPrefix,
  verifyCanonicalCursorAfterChild,
  verifyChildCleanResult,
  type ChildProcessResult,
  type SupervisorCliOptions,
  type SupervisorDeps,
} from "../../scripts/wallet-forward-supervisor";
import type { EvidenceRecord, RunnerDbClient } from "../../scripts/lib/wallet-forward-sync-primitives";

const FIXTURE_WALLET = "0x08ac26d74013af7430c350c97eacd8be0bdc5613";
const FIXTURE_WALLET_ID = "wallet-cuid-1";
const FIXTURE_CHAIN_ID = 369;
const FIXTURE_ANCHOR_FROM = 25_077_549n;
const FIXTURE_WINDOW_SIZE = 1_000n;
const FIXTURE_HEAD = "abc123headsha";
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

type FakeDbState = {
  cursor: { fromBlock: bigint; toBlock: bigint } | null;
};

function makeFakeDb(initial: FakeDbState): RunnerDbClient & { setCursor: (c: FakeDbState["cursor"]) => void } {
  const state = { ...initial };
  return {
    syncCursor: {
      findUnique: async () => (state.cursor ? { ...state.cursor, blockHash: "0xblockhash" } : null),
    },
    syncRun: {
      findMany: async () => [],
      findUnique: async () => null,
      count: async () => 0,
    },
    $queryRaw: (async () => []) as RunnerDbClient["$queryRaw"],
    setCursor: (c) => {
      state.cursor = c;
    },
  };
}

function makeDeps(
  overrides: Partial<SupervisorDeps> & { db: ReturnType<typeof makeFakeDb> },
): SupervisorDeps {
  const evidence: EvidenceRecord[] = [];
  return {
    resolveWallet: async () => ({ id: FIXTURE_WALLET_ID, address: FIXTURE_WALLET }),
    httpGet: async () => ({ status: 200, body: { data: { status: "ok" } } }),
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
  it("accepts an exact clean max_windows_reached completion", () => {
    const result = verifyChildCleanResult({
      processResult: {
        exitCode: 0,
        stdout: cleanChildStdout({ stoppedReason: "max_windows_reached", windowsCompleted: 5, lastWindowNumber: 5 }),
        stderr: "",
      },
      expectedWindowsCompleted: 5,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a non-zero exit code", () => {
    const result = verifyChildCleanResult({
      processResult: { exitCode: 1, stdout: "", stderr: "boom" },
      expectedWindowsCompleted: 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/exited with code 1/);
  });

  it("rejects an unexpected stoppedReason (e.g. invariant_failed_after_run from a warning)", () => {
    const result = verifyChildCleanResult({
      processResult: {
        exitCode: 1,
        stdout: cleanChildStdout({ stoppedReason: "invariant_failed_after_run", windowsCompleted: 2, lastWindowNumber: 3 }),
        stderr: "",
      },
      expectedWindowsCompleted: 5,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects unparseable stdout", () => {
    const result = verifyChildCleanResult({
      processResult: { exitCode: 0, stdout: "not json", stderr: "" },
      expectedWindowsCompleted: 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/could not be parsed/);
  });

  it("rejects a window-count mismatch", () => {
    const result = verifyChildCleanResult({
      processResult: {
        exitCode: 0,
        stdout: cleanChildStdout({ stoppedReason: "max_windows_reached", windowsCompleted: 4, lastWindowNumber: 4 }),
        stderr: "",
      },
      expectedWindowsCompleted: 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/expected exactly 5/);
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

describe("validateCampaignIdPrefix / buildChildCampaignId", () => {
  it("accepts a valid prefix and builds a deterministic child id", () => {
    expect(validateCampaignIdPrefix({ campaignIdPrefix: "stage1-2026" }).ok).toBe(true);
    expect(buildChildCampaignId("stage1-2026", 3)).toBe("stage1-2026-c3");
  });

  it("rejects an invalid prefix charset", () => {
    expect(validateCampaignIdPrefix({ campaignIdPrefix: "bad prefix!" }).ok).toBe(false);
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

  it("parses a valid full argv into options", () => {
    const result = parseSupervisorCliArgs(requiredArgv());
    expect(result.ok).toBe(true);
  });

  it("defaults to dry-run (execute=false)", () => {
    const result = parseSupervisorCliArgs(requiredArgv());
    if (result.ok) expect(result.options.execute).toBe(false);
  });

  it("rejects --window-size other than 1000", () => {
    const result = parseSupervisorCliArgs(requiredArgv({ "--window-size": "500" }));
    expect(result.ok).toBe(false);
  });

  it("rejects --campaign-max-windows above the hard cap", () => {
    const result = parseSupervisorCliArgs(requiredArgv({ "--campaign-max-windows": "1001" }));
    expect(result.ok).toBe(false);
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
});

// ─── Orchestrator tests ─────────────────────────────────────────────────────

describe("runWalletForwardSupervisor", () => {
  it("scenario 1: one clean child reaches the target", async () => {
    const options = baseOptions({ authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 10 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => {
      db.setCursor({ fromBlock: FIXTURE_ANCHOR_FROM, toBlock: options.authorizedFinalBlock });
      return { exitCode: 0, stdout: cleanChildStdout({ stoppedReason: "authorized_final_block_reached", windowsCompleted: 3, lastWindowNumber: 3 }), stderr: "" };
    });
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("authorized_final_block_reached");
    expect(summary.childCampaignsCompleted).toBe(1);
    expect(runChildCampaign).toHaveBeenCalledTimes(1);
    expect(computeSupervisorExitCode(summary.stoppedReason)).toBe(0);
    expect(SUPERVISOR_CLEAN_STOP_REASONS.has(summary.stoppedReason)).toBe(true);
  });

  it("scenario 2: multiple clean bounded children reach one fixed target", async () => {
    const options = baseOptions({ authorizedFinalBlock: 25_078_548n + 6n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 2 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    let calls = 0;
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => {
      calls += 1;
      const current = (await db.syncCursor.findUnique({}))!;
      const nextTo = current.toBlock + 2n * FIXTURE_WINDOW_SIZE;
      db.setCursor({ fromBlock: FIXTURE_ANCHOR_FROM, toBlock: nextTo });
      const reachedTarget = nextTo === options.authorizedFinalBlock;
      return {
        exitCode: 0,
        stdout: cleanChildStdout({
          stoppedReason: reachedTarget ? "authorized_final_block_reached" : "max_windows_reached",
          windowsCompleted: 2,
          lastWindowNumber: 2,
        }),
        stderr: "",
      };
    });
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("authorized_final_block_reached");
    expect(summary.childCampaignsCompleted).toBe(3);
    expect(calls).toBe(3);
  });

  it("scenario 3: a max-windows child stop is followed by a valid next campaign", async () => {
    const options = baseOptions({ authorizedFinalBlock: 25_078_548n + 4n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 3 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => {
      const current = (await db.syncCursor.findUnique({}))!;
      const remaining = (options.authorizedFinalBlock - current.toBlock) / FIXTURE_WINDOW_SIZE;
      const windows = remaining < BigInt(options.campaignMaxWindows) ? Number(remaining) : options.campaignMaxWindows;
      const nextTo = current.toBlock + BigInt(windows) * FIXTURE_WINDOW_SIZE;
      db.setCursor({ fromBlock: FIXTURE_ANCHOR_FROM, toBlock: nextTo });
      return {
        exitCode: 0,
        stdout: cleanChildStdout({
          stoppedReason: nextTo === options.authorizedFinalBlock ? "authorized_final_block_reached" : "max_windows_reached",
          windowsCompleted: windows,
          lastWindowNumber: windows,
        }),
        stderr: "",
      };
    });
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("authorized_final_block_reached");
    expect(summary.childCampaignsCompleted).toBe(2);
  });

  it("scenario 4: non-zero child exit code stops the supervisor", async () => {
    const options = baseOptions({ authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 10 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => ({ exitCode: 1, stdout: "", stderr: "boom" }));
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("child_result_not_clean");
    expect(computeSupervisorExitCode(summary.stoppedReason)).toBe(1);
    expect(runChildCampaign).toHaveBeenCalledTimes(1);
  });

  it("scenario 5: an unexpected stoppedReason (e.g. a warning-triggered invariant failure) stops the supervisor", async () => {
    const options = baseOptions({ authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 10 });
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

  it("scenario 6: a window-count mismatch (implying a warning-count>0-style short child run) stops the supervisor", async () => {
    const options = baseOptions({ authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 3 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => ({
      exitCode: 0,
      stdout: cleanChildStdout({ stoppedReason: "max_windows_reached", windowsCompleted: 2, lastWindowNumber: 2 }),
      stderr: "",
    }));
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("child_result_not_clean");
    expect(summary.detail).toMatch(/expected exactly 3/);
  });

  it("scenario 7: canonical cursor mismatch after a clean-looking child stops the supervisor", async () => {
    const options = baseOptions({ authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 3 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => {
      // Canonical cursor never actually advances, even though the child
      // self-reports a clean completion — the supervisor must not trust that
      // self-report alone.
      return {
        exitCode: 0,
        stdout: cleanChildStdout({ stoppedReason: "authorized_final_block_reached", windowsCompleted: 3, lastWindowNumber: 3 }),
        stderr: "",
      };
    });
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("canonical_cursor_mismatch_after_child");
  });

  it("scenario 8: a child range mismatch (fewer windows than expected) stops the supervisor", async () => {
    const options = baseOptions({ authorizedFinalBlock: 25_078_548n + 5n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 5 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => ({
      exitCode: 0,
      stdout: cleanChildStdout({ stoppedReason: "max_windows_reached", windowsCompleted: 4, lastWindowNumber: 4 }),
      stderr: "",
    }));
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("child_result_not_clean");
  });

  it("scenario 9: the supervisor never derives a child range past the authorized final block", async () => {
    const options = baseOptions({ authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 1000 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    let capturedArgs: string[] = [];
    const runChildCampaign = vi.fn(async (args: string[]): Promise<ChildProcessResult> => {
      capturedArgs = args;
      db.setCursor({ fromBlock: FIXTURE_ANCHOR_FROM, toBlock: options.authorizedFinalBlock });
      return { exitCode: 0, stdout: cleanChildStdout({ stoppedReason: "authorized_final_block_reached", windowsCompleted: 3, lastWindowNumber: 3 }), stderr: "" };
    });
    const deps = makeDeps({ db, runChildCampaign });

    await runWalletForwardSupervisor(options, deps);

    const idx = capturedArgs.indexOf("--authorized-final-block");
    expect(BigInt(capturedArgs[idx + 1])).toBeLessThanOrEqual(options.authorizedFinalBlock);
    expect(BigInt(capturedArgs[idx + 1])).toBe(options.authorizedFinalBlock);
    expect(capturedArgs).not.toContain("--recovery-mode");
  });

  it("scenario 10: evidence append failure stops the supervisor", async () => {
    const options = baseOptions({ authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 10 });
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
    const options = baseOptions({ authorizedFinalBlock: 25_078_548n + 6n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 2 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    let call = 0;
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => {
      call += 1;
      const current = (await db.syncCursor.findUnique({}))!;
      db.setCursor({ fromBlock: FIXTURE_ANCHOR_FROM, toBlock: current.toBlock + 2n * FIXTURE_WINDOW_SIZE });
      return { exitCode: 0, stdout: cleanChildStdout({ stoppedReason: "max_windows_reached", windowsCompleted: 2, lastWindowNumber: 2 }), stderr: "" };
    });
    // The drift gate is re-checked at the top of every loop iteration,
    // including the one immediately before the first child — so allow the
    // startup call plus the pre-first-child call through before drifting.
    let headCalls = 0;
    const getGitHead = vi.fn(async () => {
      headCalls += 1;
      return headCalls <= 2 ? FIXTURE_HEAD : "drifted-sha";
    });
    const deps = makeDeps({ db, runChildCampaign, getGitHead });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("repository_drift_detected");
    expect(call).toBe(1);
  });

  it("scenario 12: a dirty working tree between child campaigns stops the supervisor", async () => {
    const options = baseOptions({ authorizedFinalBlock: 25_078_548n + 6n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 2 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    let call = 0;
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => {
      call += 1;
      const current = (await db.syncCursor.findUnique({}))!;
      db.setCursor({ fromBlock: FIXTURE_ANCHOR_FROM, toBlock: current.toBlock + 2n * FIXTURE_WINDOW_SIZE });
      return { exitCode: 0, stdout: cleanChildStdout({ stoppedReason: "max_windows_reached", windowsCompleted: 2, lastWindowNumber: 2 }), stderr: "" };
    });
    // Same reasoning as scenario 11: the working-tree gate runs before the
    // first child too, so allow the startup call plus the pre-first-child
    // call through before going dirty.
    let cleanCalls = 0;
    const isWorkingTreeClean = vi.fn(async () => {
      cleanCalls += 1;
      return cleanCalls <= 2;
    });
    const deps = makeDeps({ db, runChildCampaign, isWorkingTreeClean });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("repository_drift_detected");
    expect(call).toBe(1);
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
    const options = baseOptions({ authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 10 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => ({ exitCode: 1, stdout: "", stderr: "network error" }));
    const deps = makeDeps({ db, runChildCampaign });

    await runWalletForwardSupervisor(options, deps);

    expect(runChildCampaign).toHaveBeenCalledTimes(1);
  });

  it("scenario 16: never invokes --recovery-mode on any child", async () => {
    const options = baseOptions({ authorizedFinalBlock: 25_078_548n + 3n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 10 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    let capturedArgs: string[] = [];
    const runChildCampaign = vi.fn(async (args: string[]): Promise<ChildProcessResult> => {
      capturedArgs = args;
      db.setCursor({ fromBlock: FIXTURE_ANCHOR_FROM, toBlock: options.authorizedFinalBlock });
      return { exitCode: 0, stdout: cleanChildStdout({ stoppedReason: "authorized_final_block_reached", windowsCompleted: 3, lastWindowNumber: 3 }), stderr: "" };
    });
    const deps = makeDeps({ db, runChildCampaign });

    await runWalletForwardSupervisor(options, deps);

    expect(capturedArgs).not.toContain("--recovery-mode");
    expect(capturedArgs).not.toContain("--recovery-of-run-id");
  });

  it("scenario 17: the immutable authorized-final-block is preserved unchanged across every iteration", async () => {
    const options = baseOptions({ authorizedFinalBlock: 25_078_548n + 6n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 2 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const seenFinalBlocks: string[] = [];
    const runChildCampaign = vi.fn(async (args: string[]): Promise<ChildProcessResult> => {
      const idx = args.indexOf("--authorized-final-block");
      seenFinalBlocks.push(args[idx + 1]);
      const current = (await db.syncCursor.findUnique({}))!;
      const nextTo = current.toBlock + 2n * FIXTURE_WINDOW_SIZE;
      db.setCursor({ fromBlock: FIXTURE_ANCHOR_FROM, toBlock: nextTo });
      return {
        exitCode: 0,
        stdout: cleanChildStdout({
          stoppedReason: nextTo === options.authorizedFinalBlock ? "authorized_final_block_reached" : "max_windows_reached",
          windowsCompleted: 2,
          lastWindowNumber: 2,
        }),
        stderr: "",
      };
    });
    const deps = makeDeps({ db, runChildCampaign });

    await runWalletForwardSupervisor(options, deps);

    // Every child's authorized-final-block is <= the immutable overall
    // target, and the final one equals it exactly — the operator input
    // itself (options.authorizedFinalBlock) is never mutated anywhere.
    for (const seen of seenFinalBlocks) {
      expect(BigInt(seen)).toBeLessThanOrEqual(options.authorizedFinalBlock);
    }
    expect(BigInt(seenFinalBlocks[seenFinalBlocks.length - 1])).toBe(options.authorizedFinalBlock);
    expect(options.authorizedFinalBlock).toBe(25_078_548n + 6n * FIXTURE_WINDOW_SIZE);
  });

  it("scenario 18: resume derives position from canonical cursor state, not local counters", async () => {
    // Simulates a fresh invocation whose canonical cursor already reflects
    // two prior child campaigns worth of progress (as if a previous process
    // had run and exited) — the supervisor must plan its next child directly
    // from that canonical state, not from any assumption of "starting from
    // campaign 1's original range".
    const options = baseOptions({ authorizedFinalBlock: 25_078_548n + 6n * FIXTURE_WINDOW_SIZE, campaignMaxWindows: 2 });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n + 4n * FIXTURE_WINDOW_SIZE } });
    let capturedArgs: string[] = [];
    const runChildCampaign = vi.fn(async (args: string[]): Promise<ChildProcessResult> => {
      capturedArgs = args;
      db.setCursor({ fromBlock: FIXTURE_ANCHOR_FROM, toBlock: options.authorizedFinalBlock });
      return { exitCode: 0, stdout: cleanChildStdout({ stoppedReason: "authorized_final_block_reached", windowsCompleted: 2, lastWindowNumber: 2 }), stderr: "" };
    });
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    const idx = capturedArgs.indexOf("--first-window-start");
    expect(capturedArgs[idx + 1]).toBe((25_078_548n + 4n * FIXTURE_WINDOW_SIZE + 1n).toString());
    expect(summary.childCampaignsCompleted).toBe(1);
  });

  it("scenario 19: a target already reached before any child runs completes cleanly with zero children", async () => {
    const options = baseOptions({ authorizedFinalBlock: 25_078_548n });
    const db = makeFakeDb({ cursor: { fromBlock: FIXTURE_ANCHOR_FROM, toBlock: 25_078_548n } });
    const runChildCampaign = vi.fn(async (): Promise<ChildProcessResult> => ({ exitCode: 0, stdout: "", stderr: "" }));
    const deps = makeDeps({ db, runChildCampaign });

    const summary = await runWalletForwardSupervisor(options, deps);

    expect(summary.stoppedReason).toBe("authorized_final_block_already_reached");
    expect(summary.childCampaignsCompleted).toBe(0);
    expect(runChildCampaign).not.toHaveBeenCalled();
    expect(computeSupervisorExitCode(summary.stoppedReason)).toBe(0);
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
});
