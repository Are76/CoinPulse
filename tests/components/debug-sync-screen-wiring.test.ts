import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const DEBUG_SYNC_SCREEN_PATH = path.resolve(
  __dirname,
  "../../src/components/debug/debug-sync-screen.tsx",
);

function readDebugSyncScreenSource() {
  return fs.readFileSync(DEBUG_SYNC_SCREEN_PATH, "utf8");
}

describe("debug-sync-screen TanStack Query wiring", () => {
  it("wires debug metadata reads through shared query hooks without changing operator state handling", () => {
    const source = readDebugSyncScreenSource();

    expect(source).toContain(
      'import { useDebugHealthQuery } from "@/lib/query/use-debug-health-query";',
    );
    expect(source).toContain(
      'import { useDebugStatusQuery } from "@/lib/query/use-debug-status-query";',
    );
    expect(source).not.toContain("fetchDebugHealth");
    expect(source).not.toContain("fetchDebugStatus");
    expect(source).not.toContain("useEffect");
    expect(source).toContain("const healthQuery = useDebugHealthQuery();");
    expect(source).toContain("const statusQuery = useDebugStatusQuery();");
    expect(source).toContain("health: healthQuery.data,");
    expect(source).toContain("healthError: healthQuery.error,");
    expect(source).toContain("status: statusQuery.data,");
    expect(source).toContain("statusError: statusQuery.error,");
    expect(source).toContain('title="Backend debug metadata failed"');
    expect(source).toContain("return { kind: \"ready\", health, status };");
    expect(source).toContain("return { kind: \"loading\" };");
  });

  it("wires manual sync submit through the shared mutation hook without changing existing sync state handling", () => {
    const source = readDebugSyncScreenSource();

    expect(source).toContain(
      'import { useManualSyncMutation } from "@/lib/query/use-manual-sync-mutation";',
    );
    expect(source).not.toContain("runManualSync");
    expect(source).toContain("const manualSyncMutation = useManualSyncMutation();");
    expect(source).toContain("const response = await manualSyncMutation.mutateAsync({");
    expect(source).toContain('setOperationState({ kind: "loading", operation: "sync" });');
    expect(source).toContain('message: "End block is required for manual sync.",');
    expect(source).toContain('message: "Policy label is required.",');
    expect(source).toContain('operation: "sync",');
    expect(source).toContain("payload: response.data,");
    expect(source).toContain('? "Syncing..."');
  });

  it("wires rebuild submit through the shared mutation hook without changing existing rebuild state handling", () => {
    const source = readDebugSyncScreenSource();

    expect(source).toContain(
      'import { useRebuildMutation } from "@/lib/query/use-rebuild-mutation";',
    );
    expect(source).not.toContain("runRebuild");
    expect(source).toContain("const rebuildMutation = useRebuildMutation();");
    expect(source).toContain("const response = await rebuildMutation.mutateAsync({");
    expect(source).toContain('setOperationState({ kind: "loading", operation: "rebuild" });');
    expect(source).toContain(
      'message: "Both from-block and to-block are required for rebuild.",',
    );
    expect(source).toContain('operation: "rebuild",');
    expect(source).toContain("payload: response.data,");
    expect(source).toContain('? "Rebuilding..."');
  });
});

describe("debug-sync-screen operator guardrails", () => {
  it("imports OPERATOR_MAX_BLOCK_SPAN from the debug client for UX guidance", () => {
    const source = readDebugSyncScreenSource();

    expect(source).toContain("OPERATOR_MAX_BLOCK_SPAN");
    expect(source).toContain('} from "@/lib/api/debug-client"');
  });

  it("renders max block span guidance in the manual sync form", () => {
    const source = readDebugSyncScreenSource();

    expect(source).toContain("OPERATOR_MAX_BLOCK_SPAN");
    expect(source).toContain("Max block span");
    expect(source).toContain("run families separately");
  });

  it("renders max block span guidance in the rebuild form", () => {
    const source = readDebugSyncScreenSource();

    const rebuildIdx = source.indexOf("handleRebuild");
    const afterRebuild = source.slice(rebuildIdx);

    expect(afterRebuild).toContain("OPERATOR_MAX_BLOCK_SPAN");
  });

  it("does not call RPC directly from the frontend", () => {
    const source = readDebugSyncScreenSource();

    expect(source).not.toContain("eth_getBlockByNumber");
    expect(source).not.toContain("getLogs");
    expect(source).not.toContain("getTransactionReceipt");
    expect(source).not.toContain("ethers");
    expect(source).not.toContain("viem");
  });

  it("does not calculate portfolio, token, pricing, valuation, or PnL values", () => {
    const source = readDebugSyncScreenSource();

    expect(source).not.toContain("computeBalance");
    expect(source).not.toContain("computePrice");
    expect(source).not.toContain("calculatePnl");
    expect(source).not.toContain("calculateValuation");
    expect(source).not.toContain("computeYield");
  });
});

describe("debug-sync-screen TanStack Query read migration", () => {
  it("does not import any direct fetch functions from debug-client", () => {
    const source = readDebugSyncScreenSource();

    expect(source).not.toContain("fetchDebugHealth");
    expect(source).not.toContain("fetchDebugStatus");
    expect(source).not.toContain("fetchTrackedWallets");
  });

  it("does not contain any useEffect hooks (no ad-hoc polling loop)", () => {
    const source = readDebugSyncScreenSource();

    expect(source).not.toContain("useEffect");
  });

  it("derives metaState from query data and errors — no computed balances or prices", () => {
    const source = readDebugSyncScreenSource();

    expect(source).toContain("const metaState = getMetaState({");
    expect(source).toContain("health: healthQuery.data,");
    expect(source).toContain("healthError: healthQuery.error,");
    expect(source).toContain("status: statusQuery.data,");
    expect(source).toContain("statusError: statusQuery.error,");
    expect(source).not.toContain("computeBalance");
    expect(source).not.toContain("computePrice");
    expect(source).not.toContain("calculatePnl");
    expect(source).not.toContain("calculateValuation");
  });

  it("represents loading state via metaState.kind === 'loading' sourced from query isPending", () => {
    const source = readDebugSyncScreenSource();

    expect(source).toContain("return { kind: \"loading\" };");
    expect(source).toContain("metaState.kind === \"loading\"");
  });

  it("represents error state via metaState.kind === 'error' with backend message", () => {
    const source = readDebugSyncScreenSource();

    expect(source).toContain("return { kind: \"error\"");
    expect(source).toContain("metaState.kind === \"error\"");
    expect(source).toContain('title="Backend debug metadata failed"');
  });

  it("POST submit handlers remain operation-state driven and do not call fetch directly", () => {
    const source = readDebugSyncScreenSource();

    expect(source).toContain("manualSyncMutation.mutateAsync(");
    expect(source).toContain("rebuildMutation.mutateAsync(");
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("axios");
  });

  it("does not use token symbol or ticker as identity", () => {
    const source = readDebugSyncScreenSource();

    expect(source).not.toMatch(/symbol\s*===|===\s*symbol/);
    expect(source).not.toContain("ticker");
  });
});
