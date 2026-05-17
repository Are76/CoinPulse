import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { invalidateDebugOperationQueries } from "@/lib/query/invalidation";
import { queryKeys } from "@/lib/query/query-keys";

describe("invalidateDebugOperationQueries", () => {
  it("invalidates debug status and health without invalidating dashboard truth", () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    invalidateDebugOperationQueries(queryClient);

    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, { queryKey: queryKeys.debug.status() });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, { queryKey: queryKeys.debug.health() });
    expect(
      invalidateQueries.mock.calls.some(([filters]) =>
        Array.isArray(filters?.queryKey) && filters.queryKey[0] === "dashboard",
      ),
    ).toBe(false);
  });

  it("does not block callers on invalidation promises", () => {
    const queryClient = new QueryClient();
    vi.spyOn(queryClient, "invalidateQueries").mockImplementation(() => new Promise(() => {}));

    expect(invalidateDebugOperationQueries(queryClient)).toBeUndefined();
  });
});
