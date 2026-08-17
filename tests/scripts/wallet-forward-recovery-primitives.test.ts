// Explicit wallet-forward recovery mode (PR B) — focused unit tests for the
// shared recovery primitives in scripts/lib/wallet-forward-sync-primitives.ts.
//
// These primitives are pure: no DB, no HTTP, no live calls. Integration of
// the recovery pre-loop step into each runner is covered separately in
// tests/scripts/wallet-forward-sync-runner.test.ts and
// tests/scripts/wallet-forward-campaign-runner.test.ts.

import { describe, expect, it } from "vitest";

import {
  RECOVERY_ELIGIBLE_WARNING_CODE,
  parseRecoveryFlags,
  recoveryPolicyLabel,
  verifyRecoveryEligibility,
  verifyRecoveryWindowTerminalState,
  verifyStructuredWarningsRecoveryEligible,
  type RunnerSyncRunRecord,
} from "../../scripts/lib/wallet-forward-sync-primitives";
import { SYNC_WARNING_CODES } from "../../src/services/sync/sync-warning-codes";

const WALLET_ID = "wallet-cuid-1";
const CHAIN_ID = 369;
const START_BLOCK = 25_189_549n;
const END_BLOCK = 25_190_548n;
const RUN_ID = "run-source-1";

function baseRun(overrides: Partial<RunnerSyncRunRecord> = {}): RunnerSyncRunRecord {
  return {
    id: RUN_ID,
    trigger: "MANUAL",
    status: "COMPLETED",
    stage: "COMPLETED",
    chainId: CHAIN_ID,
    walletId: WALLET_ID,
    policyLabel: "wallet-forward-sync-window-1",
    sourceFamilies: ["TRANSFERS"],
    startBlock: START_BLOCK,
    endBlock: END_BLOCK,
    latestSafeBlock: END_BLOCK,
    warningCount: 0,
    warningDetails: [],
    errorMessage: null,
    failedSourceFamily: null,
    failedFromBlock: null,
    failedToBlock: null,
    ...overrides,
  };
}

const BENIGN_DETAIL = "some raw blocks were already persisted for this range";

function eligibleRun(overrides: Partial<RunnerSyncRunRecord> = {}): RunnerSyncRunRecord {
  return baseRun({
    warningCount: 1,
    warningDetails: [BENIGN_DETAIL],
    structuredWarnings: {
      warnings: [{ code: RECOVERY_ELIGIBLE_WARNING_CODE, detail: BENIGN_DETAIL }],
      truncatedCount: 0,
    },
    ...overrides,
  });
}

const expectedIdentity = {
  expectedRunId: RUN_ID,
  expectedWalletId: WALLET_ID,
  expectedChainId: CHAIN_ID,
  expectedStartBlock: START_BLOCK,
  expectedEndBlock: END_BLOCK,
};

// ─── P1 — exact benign source run is eligible ──────────────────────────────────

describe("verifyRecoveryEligibility — positive", () => {
  it("P1: a COMPLETED run with exactly one RAW_BLOCKS_ALREADY_PERSISTED warning, fully aligned, is eligible", () => {
    const result = verifyRecoveryEligibility({ run: eligibleRun(), ...expectedIdentity });
    expect(result.ok).toBe(true);
  });

  it("P2: several benign warnings, all RAW_BLOCKS_ALREADY_PERSISTED, fully aligned, is eligible", () => {
    const run = eligibleRun({
      warningCount: 2,
      warningDetails: [BENIGN_DETAIL, BENIGN_DETAIL],
      structuredWarnings: {
        warnings: [
          { code: RECOVERY_ELIGIBLE_WARNING_CODE, detail: BENIGN_DETAIL },
          { code: RECOVERY_ELIGIBLE_WARNING_CODE, detail: BENIGN_DETAIL },
        ],
        truncatedCount: 0,
      },
    });
    const result = verifyRecoveryEligibility({ run, ...expectedIdentity });
    expect(result.ok).toBe(true);
  });
});

// ─── Negative: source-run identity ─────────────────────────────────────────────

describe("verifyRecoveryEligibility — identity gates", () => {
  it("rejects a missing referenced SyncRun", () => {
    const result = verifyRecoveryEligibility({ run: null, ...expectedIdentity });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not found/);
  });

  it("rejects a run whose id does not match --recovery-of-run-id", () => {
    const result = verifyRecoveryEligibility({
      run: eligibleRun({ id: "different-run-id" }),
      ...expectedIdentity,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-MANUAL trigger", () => {
    const result = verifyRecoveryEligibility({ run: eligibleRun({ trigger: "SCHEDULED" }), ...expectedIdentity });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-COMPLETED (e.g. RUNNING) terminal state", () => {
    const result = verifyRecoveryEligibility({ run: eligibleRun({ status: "RUNNING" }), ...expectedIdentity });
    expect(result.ok).toBe(false);
  });

  it("rejects a wrong wallet", () => {
    const result = verifyRecoveryEligibility({
      run: eligibleRun({ walletId: "other-wallet" }),
      ...expectedIdentity,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/wallet/);
  });

  it("rejects a wrong chain", () => {
    const result = verifyRecoveryEligibility({ run: eligibleRun({ chainId: 8453 }), ...expectedIdentity });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/chain/);
  });

  it("rejects a wrong source family", () => {
    const result = verifyRecoveryEligibility({
      run: eligibleRun({ sourceFamilies: ["DEX"] }),
      ...expectedIdentity,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/sourceFamilies/);
  });

  it("rejects a wrong block range (startBlock mismatch)", () => {
    const result = verifyRecoveryEligibility({
      run: eligibleRun({ startBlock: START_BLOCK - 1n }),
      ...expectedIdentity,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/range/);
  });

  it("rejects a wrong block range (endBlock mismatch)", () => {
    const result = verifyRecoveryEligibility({
      run: eligibleRun({ endBlock: END_BLOCK + 1n }),
      ...expectedIdentity,
    });
    expect(result.ok).toBe(false);
  });
});

// ─── Negative: structured warning shape (R1-R6) ────────────────────────────────

describe("verifyStructuredWarningsRecoveryEligible — R1-R6", () => {
  it("R1: rejects historical structuredWarnings = null (classification unavailable)", () => {
    const result = verifyStructuredWarningsRecoveryEligible(
      baseRun({ warningCount: 1, warningDetails: [BENIGN_DETAIL], structuredWarnings: null }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/null|undefined|malformed/);
  });

  it("R1: rejects undefined structuredWarnings", () => {
    const run = baseRun({ warningCount: 1, warningDetails: [BENIGN_DETAIL] });
    delete (run as { structuredWarnings?: unknown }).structuredWarnings;
    const result = verifyStructuredWarningsRecoveryEligible(run);
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed structured payload (not an object)", () => {
    const result = verifyStructuredWarningsRecoveryEligible(
      baseRun({ warningCount: 1, warningDetails: [BENIGN_DETAIL], structuredWarnings: "not-an-object" }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed structured payload (warnings not an array)", () => {
    const result = verifyStructuredWarningsRecoveryEligible(
      baseRun({
        warningCount: 1,
        warningDetails: [BENIGN_DETAIL],
        structuredWarnings: { warnings: "nope", truncatedCount: 0 },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed structured payload (truncatedCount not a number)", () => {
    const result = verifyStructuredWarningsRecoveryEligible(
      baseRun({
        warningCount: 1,
        warningDetails: [BENIGN_DETAIL],
        structuredWarnings: { warnings: [], truncatedCount: "0" },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("R2: rejects truncatedCount > 0", () => {
    const result = verifyStructuredWarningsRecoveryEligible(
      eligibleRun({
        structuredWarnings: {
          warnings: [{ code: RECOVERY_ELIGIBLE_WARNING_CODE, detail: BENIGN_DETAIL }],
          truncatedCount: 3,
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/truncatedCount/);
  });

  it("R4: rejects UNKNOWN-only warnings", () => {
    const result = verifyStructuredWarningsRecoveryEligible(
      baseRun({
        warningCount: 1,
        warningDetails: ["skipped non-transfer log"],
        structuredWarnings: { warnings: [{ code: "UNKNOWN", detail: "skipped non-transfer log" }], truncatedCount: 0 },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("R4: rejects mixed RAW_BLOCKS_ALREADY_PERSISTED + UNKNOWN", () => {
    const result = verifyStructuredWarningsRecoveryEligible(
      baseRun({
        warningCount: 2,
        warningDetails: [BENIGN_DETAIL, "skipped non-transfer log"],
        structuredWarnings: {
          warnings: [
            { code: RECOVERY_ELIGIBLE_WARNING_CODE, detail: BENIGN_DETAIL },
            { code: "UNKNOWN", detail: "skipped non-transfer log" },
          ],
          truncatedCount: 0,
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("R4: rejects an unknown/future warning code", () => {
    const result = verifyStructuredWarningsRecoveryEligible(
      baseRun({
        warningCount: 1,
        warningDetails: [BENIGN_DETAIL],
        structuredWarnings: {
          warnings: [{ code: "SOME_FUTURE_CODE", detail: BENIGN_DETAIL }],
          truncatedCount: 0,
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("R4: rejects a missing/malformed code field", () => {
    const result = verifyStructuredWarningsRecoveryEligible(
      baseRun({
        warningCount: 1,
        warningDetails: [BENIGN_DETAIL],
        structuredWarnings: { warnings: [{ detail: BENIGN_DETAIL }], truncatedCount: 0 },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("R3: rejects a warningCount / structured-list length mismatch", () => {
    const result = verifyStructuredWarningsRecoveryEligible(
      baseRun({
        warningCount: 2,
        warningDetails: [BENIGN_DETAIL],
        structuredWarnings: {
          warnings: [{ code: RECOVERY_ELIGIBLE_WARNING_CODE, detail: BENIGN_DETAIL }],
          truncatedCount: 0,
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/warningCount/);
  });

  it("R6: rejects a structured/legacy detail mismatch", () => {
    const result = verifyStructuredWarningsRecoveryEligible(
      baseRun({
        warningCount: 1,
        warningDetails: ["a different legacy detail string"],
        structuredWarnings: {
          warnings: [{ code: RECOVERY_ELIGIBLE_WARNING_CODE, detail: BENIGN_DETAIL }],
          truncatedCount: 0,
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/detail/);
  });

  it("R5: rejects an ordinary zero-warning run", () => {
    const result = verifyStructuredWarningsRecoveryEligible(
      baseRun({ warningCount: 0, warningDetails: [], structuredWarnings: { warnings: [], truncatedCount: 0 } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/zero warnings/);
  });
});

// ─── verifyRecoveryWindowTerminalState (post-recovery-POST verification) ──────

describe("verifyRecoveryWindowTerminalState", () => {
  const expectedWindow = {
    expectedWalletId: WALLET_ID,
    expectedChainId: CHAIN_ID,
    expectedPolicyLabel: "wallet-forward-sync-window-recovery-of-run-source-1",
    expectedStartBlock: START_BLOCK,
    expectedEndBlock: END_BLOCK,
  };

  it("accepts a newly-recovered run whose only warning is RAW_BLOCKS_ALREADY_PERSISTED", () => {
    const result = verifyRecoveryWindowTerminalState({
      run: eligibleRun({ policyLabel: expectedWindow.expectedPolicyLabel }),
      ...expectedWindow,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a newly-recovered run with zero warnings (better than the source run)", () => {
    const result = verifyRecoveryWindowTerminalState({
      run: baseRun({
        policyLabel: expectedWindow.expectedPolicyLabel,
        warningCount: 0,
        warningDetails: [],
        structuredWarnings: { warnings: [], truncatedCount: 0 },
      }),
      ...expectedWindow,
    });
    expect(result.ok).toBe(true);
  });

  // ── Finding C (PR #370 review): a zero-warningCount recovered run must
  // prove structuredWarnings is the explicit known-zero shape too — not
  // just infer "clean" from the legacy warningCount/warningDetails fields,
  // which a contradictory structuredWarnings could otherwise slip past. ──

  it("Finding C: zero-warning + explicit empty structured payload is accepted", () => {
    const result = verifyRecoveryWindowTerminalState({
      run: baseRun({
        policyLabel: expectedWindow.expectedPolicyLabel,
        warningCount: 0,
        warningDetails: [],
        structuredWarnings: { warnings: [], truncatedCount: 0 },
      }),
      ...expectedWindow,
    });
    expect(result.ok).toBe(true);
  });

  it("Finding C: zero-warningCount but a contradictory UNKNOWN structuredWarnings entry is rejected", () => {
    const result = verifyRecoveryWindowTerminalState({
      run: baseRun({
        policyLabel: expectedWindow.expectedPolicyLabel,
        warningCount: 0,
        warningDetails: [],
        structuredWarnings: { warnings: [{ code: "UNKNOWN", detail: "x" }], truncatedCount: 0 },
      }),
      ...expectedWindow,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.some((reason) => reason.includes("known-empty shape"))).toBe(true);
    }
  });

  it("Finding C: zero-warningCount with structuredWarnings = null is rejected", () => {
    const result = verifyRecoveryWindowTerminalState({
      run: baseRun({
        policyLabel: expectedWindow.expectedPolicyLabel,
        warningCount: 0,
        warningDetails: [],
        structuredWarnings: null,
      }),
      ...expectedWindow,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.some((reason) => reason.includes("known-empty shape"))).toBe(true);
    }
  });

  it("zero-warningCount with structuredWarnings absent (undefined) is rejected", () => {
    const run = baseRun({
      policyLabel: expectedWindow.expectedPolicyLabel,
      warningCount: 0,
      warningDetails: [],
    });
    delete (run as { structuredWarnings?: unknown }).structuredWarnings;
    const result = verifyRecoveryWindowTerminalState({ run, ...expectedWindow });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.some((reason) => reason.includes("known-empty shape"))).toBe(true);
    }
  });

  it("Finding C: zero-warningCount with malformed structuredWarnings is rejected", () => {
    const result = verifyRecoveryWindowTerminalState({
      run: baseRun({
        policyLabel: expectedWindow.expectedPolicyLabel,
        warningCount: 0,
        warningDetails: [],
        structuredWarnings: "not-an-object",
      }),
      ...expectedWindow,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.some((reason) => reason.includes("known-empty shape"))).toBe(true);
    }
  });

  it("Finding C: zero-warningCount with truncatedCount > 0 is rejected", () => {
    const result = verifyRecoveryWindowTerminalState({
      run: baseRun({
        policyLabel: expectedWindow.expectedPolicyLabel,
        warningCount: 0,
        warningDetails: [],
        structuredWarnings: { warnings: [], truncatedCount: 2 },
      }),
      ...expectedWindow,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.some((reason) => reason.includes("known-empty shape"))).toBe(true);
    }
  });

  it("rejects warningCount 0 with non-empty legacy warningDetails", () => {
    const result = verifyRecoveryWindowTerminalState({
      run: baseRun({
        policyLabel: expectedWindow.expectedPolicyLabel,
        warningCount: 0,
        warningDetails: ["leftover legacy detail"],
        structuredWarnings: { warnings: [], truncatedCount: 0 },
      }),
      ...expectedWindow,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons.some((r) => r.includes("warningDetails"))).toBe(true);
  });

  it("rejects a latestSafeBlock that does not equal the window endBlock", () => {
    const result = verifyRecoveryWindowTerminalState({
      run: eligibleRun({
        policyLabel: expectedWindow.expectedPolicyLabel,
        latestSafeBlock: END_BLOCK - 1n,
      }),
      ...expectedWindow,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons.some((r) => r.includes("latestSafeBlock"))).toBe(true);
  });

  it("26: rejects when the recovery source was eligible but the NEW recovery run fails a normal postcondition (e.g. UNKNOWN warning this time)", () => {
    const result = verifyRecoveryWindowTerminalState({
      run: baseRun({
        policyLabel: expectedWindow.expectedPolicyLabel,
        warningCount: 1,
        warningDetails: ["skipped non-transfer log"],
        structuredWarnings: { warnings: [{ code: "UNKNOWN", detail: "skipped non-transfer log" }], truncatedCount: 0 },
      }),
      ...expectedWindow,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects wrong policyLabel/startBlock/endBlock on the new run just like the strict check would", () => {
    const result = verifyRecoveryWindowTerminalState({
      run: eligibleRun({ policyLabel: "wrong-label" }),
      ...expectedWindow,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons.some((r) => r.includes("policyLabel"))).toBe(true);
  });
});

// ─── CLI mutual-requirement gate ───────────────────────────────────────────────

describe("parseRecoveryFlags", () => {
  it("neither flag present: recovery is undefined (normal mode unchanged)", () => {
    const result = parseRecoveryFlags({ recoveryMode: false, recoveryOfRunId: null });
    expect(result).toEqual({ ok: true, recovery: undefined });
  });

  it("--recovery-mode without --recovery-of-run-id is rejected", () => {
    const result = parseRecoveryFlags({ recoveryMode: true, recoveryOfRunId: null });
    expect(result.ok).toBe(false);
  });

  it("--recovery-of-run-id without --recovery-mode is rejected", () => {
    const result = parseRecoveryFlags({ recoveryMode: false, recoveryOfRunId: "run-1" });
    expect(result.ok).toBe(false);
  });

  it("both flags present: recovery is populated", () => {
    const result = parseRecoveryFlags({ recoveryMode: true, recoveryOfRunId: "run-1" });
    expect(result).toEqual({ ok: true, recovery: { sourceRunId: "run-1" } });
  });
});

describe("recoveryPolicyLabel", () => {
  it("builds a deterministic, distinct-from-source policy label", () => {
    expect(recoveryPolicyLabel("wallet-forward-sync-window", "run-source-1")).toBe(
      "wallet-forward-sync-window-recovery-of-run-source-1",
    );
  });
});

describe("RECOVERY_ELIGIBLE_WARNING_CODE — canonical warning-code drift protection", () => {
  it("stays byte-for-byte identical to SYNC_WARNING_CODES.RAW_BLOCKS_ALREADY_PERSISTED", () => {
    // wallet-forward-sync-primitives.ts intentionally duplicates this value
    // as a literal (rather than importing sync-warning-codes.ts, a
    // server-only-guarded module) so the runner-safety module stays loadable
    // before CLI/env validation runs. This test is the only thing that
    // would catch the two constants drifting apart if the canonical code in
    // src/services/sync/sync-warning-codes.ts ever changes.
    expect(RECOVERY_ELIGIBLE_WARNING_CODE).toBe(SYNC_WARNING_CODES.RAW_BLOCKS_ALREADY_PERSISTED);
  });
});
