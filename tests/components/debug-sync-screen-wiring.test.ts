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

describe("debug-sync-screen mutation wiring", () => {
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
