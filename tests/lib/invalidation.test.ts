import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { invalidateDebugOperationQueries } from "@/lib/query/invalidation";
import { queryKeys } from "@/lib/query/query-keys";

function invalidatedFamilies(invalidateQueries: ReturnType<typeof vi.fn>) {
  return invalidateQueries.mock.calls.map(([filters]) =>
    Array.isArray(filters?.queryKey) ? filters.queryKey[0] : undefined,
  );
}

describe("invalidateDebugOperationQueries", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invalidates exactly debug status and debug health", () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    const result = invalidateDebugOperationQueries(queryClient);

    expect(result).toBeUndefined();
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, { queryKey: queryKeys.debug.status() });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, { queryKey: queryKeys.debug.health() });
  });

  it("does not invalidate dashboard, pricing, tracked-wallet, or other query families", () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    invalidateDebugOperationQueries(queryClient);

    expect(invalidatedFamilies(invalidateQueries)).toEqual(["debug", "debug"]);
    expect(invalidatedFamilies(invalidateQueries)).not.toContain("dashboard");
    expect(invalidatedFamilies(invalidateQueries)).not.toContain("prices");
    expect(invalidatedFamilies(invalidateQueries)).not.toContain("wallets");
    expect(invalidatedFamilies(invalidateQueries)).not.toContain("transactions");
  });

  it("returns void and does not block on invalidation promises", () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockImplementation(() => new Promise(() => {}));

    const result = invalidateDebugOperationQueries(queryClient);

    expect(result).toBeUndefined();
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });
});
