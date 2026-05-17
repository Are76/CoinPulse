import { describe, expect, it } from "vitest";

import {
  createQueryClient,
  DEFAULT_QUERY_GC_TIME,
  DEFAULT_QUERY_STALE_TIME,
} from "@/lib/query/query-client";

describe("query client", () => {
  it("creates a QueryClient with conservative app-level defaults", () => {
    const queryClient = createQueryClient();
    const defaults = queryClient.getDefaultOptions();

    expect(defaults.queries?.retry).toBe(false);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
    expect(defaults.queries?.staleTime).toBe(DEFAULT_QUERY_STALE_TIME);
    expect(defaults.queries?.gcTime).toBe(DEFAULT_QUERY_GC_TIME);
    expect(defaults.mutations?.retry).toBe(false);
  });
});
