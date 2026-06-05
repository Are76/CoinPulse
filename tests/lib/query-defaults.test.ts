import { describe, expect, it } from "vitest";

import { QUERY_DEFAULTS } from "@/lib/query/query-defaults";

describe("query defaults", () => {
  it("exports gcTime for all query types", () => {
    for (const [key, value] of Object.entries(QUERY_DEFAULTS)) {
      expect(
        (value as Record<string, unknown>).gcTime,
        `${key} must have gcTime`,
      ).toBeDefined();
      expect(
        (value as Record<string, unknown>).cacheTime,
        `${key} must not use cacheTime`,
      ).toBeUndefined();
    }
  });

  it("has correct debugHealth defaults", () => {
    expect(QUERY_DEFAULTS.debugHealth.staleTime).toBe(15_000);
    expect(QUERY_DEFAULTS.debugHealth.gcTime).toBe(5 * 60_000);
  });

  it("has correct debugStatus defaults", () => {
    expect(QUERY_DEFAULTS.debugStatus.staleTime).toBe(10_000);
    expect(QUERY_DEFAULTS.debugStatus.gcTime).toBe(5 * 60_000);
  });

  it("has correct dashboard defaults", () => {
    expect(QUERY_DEFAULTS.dashboard.staleTime).toBe(30_000);
    expect(QUERY_DEFAULTS.dashboard.gcTime).toBe(10 * 60_000);
  });
});
