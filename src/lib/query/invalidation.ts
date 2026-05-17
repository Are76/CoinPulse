import type { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/query-keys";

/**
 * Invalidates operator metadata affected by debug sync/rebuild operations.
 *
 * Manual sync and rebuild can update persisted operation state even when they
 * fail or return conflicts, so callers should invoke this from mutation
 * settlement rather than success-only handlers. Invalidation promises are not
 * returned or awaited so backend mutation responses remain the operator-facing
 * result and are not blocked by follow-up metadata refetches.
 *
 * Dashboard invalidation is intentionally excluded until a mutation response can
 * prove materialized dashboard truth has been refreshed.
 */
export function invalidateDebugOperationQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.debug.status() });
  void queryClient.invalidateQueries({ queryKey: queryKeys.debug.health() });
}
