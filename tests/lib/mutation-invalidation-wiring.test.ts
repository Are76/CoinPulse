import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const MANUAL_SYNC_MUTATION_PATH = path.resolve(
  __dirname,
  "../../src/lib/query/use-manual-sync-mutation.ts",
);
const REBUILD_MUTATION_PATH = path.resolve(
  __dirname,
  "../../src/lib/query/use-rebuild-mutation.ts",
);
const INVALIDATION_PATH = path.resolve(
  __dirname,
  "../../src/lib/query/invalidation.ts",
);

function readSource(filePath: string) {
  return fs.readFileSync(filePath, "utf8");
}

describe("useManualSyncMutation source wiring", () => {
  it("delegates to runManualSync from debug-client — no direct fetch", () => {
    const source = readSource(MANUAL_SYNC_MUTATION_PATH);

    expect(source).toContain('import { runManualSync } from "@/lib/api/debug-client";');
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("axios");
  });

  it("uses shared invalidateDebugOperationQueries — no inline queryClient.invalidateQueries", () => {
    const source = readSource(MANUAL_SYNC_MUTATION_PATH);

    expect(source).toContain(
      'import { invalidateDebugOperationQueries } from "@/lib/query/invalidation";',
    );
    expect(source).toContain("invalidateDebugOperationQueries(queryClient)");
    const inlineInvalidateCount = (source.match(/queryClient\.invalidateQueries/g) ?? []).length;
    expect(inlineInvalidateCount).toBe(0);
  });

  it("fires invalidation from onSettled — not onSuccess only", () => {
    const source = readSource(MANUAL_SYNC_MUTATION_PATH);

    expect(source).toContain("onSettled:");
    expect(source).not.toContain("onSuccess:");
  });

  it("sets retry: false — does not retry on backend error or conflict", () => {
    const source = readSource(MANUAL_SYNC_MUTATION_PATH);

    expect(source).toContain("retry: false");
  });
});

describe("useRebuildMutation source wiring", () => {
  it("delegates to runRebuild from debug-client — no direct fetch", () => {
    const source = readSource(REBUILD_MUTATION_PATH);

    expect(source).toContain('import { runRebuild } from "@/lib/api/debug-client";');
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("axios");
  });

  it("uses shared invalidateDebugOperationQueries — no inline queryClient.invalidateQueries", () => {
    const source = readSource(REBUILD_MUTATION_PATH);

    expect(source).toContain(
      'import { invalidateDebugOperationQueries } from "@/lib/query/invalidation";',
    );
    expect(source).toContain("invalidateDebugOperationQueries(queryClient)");
    const inlineInvalidateCount = (source.match(/queryClient\.invalidateQueries/g) ?? []).length;
    expect(inlineInvalidateCount).toBe(0);
  });

  it("fires invalidation from onSettled — not onSuccess only", () => {
    const source = readSource(REBUILD_MUTATION_PATH);

    expect(source).toContain("onSettled:");
    expect(source).not.toContain("onSuccess:");
  });

  it("sets retry: false — does not retry on backend error or conflict", () => {
    const source = readSource(REBUILD_MUTATION_PATH);

    expect(source).toContain("retry: false");
  });
});

describe("invalidateDebugOperationQueries source wiring", () => {
  it("invalidates debug.status and debug.health via queryKeys — no hardcoded strings", () => {
    const source = readSource(INVALIDATION_PATH);

    expect(source).toContain('import { queryKeys } from "@/lib/query/query-keys";');
    expect(source).toContain("queryKeys.debug.status()");
    expect(source).toContain("queryKeys.debug.health()");
    expect(source).not.toMatch(/"debug",\s*"status"/);
    expect(source).not.toMatch(/"debug",\s*"health"/);
  });

  it("does not reference dashboard, prices, wallets, or transactions query keys", () => {
    const source = readSource(INVALIDATION_PATH);

    expect(source).not.toContain("queryKeys.dashboard");
    expect(source).not.toContain("queryKeys.prices");
    expect(source).not.toContain("queryKeys.wallets");
    expect(source).not.toContain("queryKeys.transactions");
  });

  it("returns void — invalidation promises are fire-and-forget", () => {
    const source = readSource(INVALIDATION_PATH);

    expect(source).toContain("): void {");
    expect(source).toContain("void queryClient.invalidateQueries(");
    expect(source).not.toContain("await queryClient.invalidateQueries(");
    expect(source).not.toContain("return queryClient.invalidateQueries(");
  });
});
