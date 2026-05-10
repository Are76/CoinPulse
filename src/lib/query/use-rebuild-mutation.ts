import { useMutation, useQueryClient } from "@tanstack/react-query";

import { runRebuild } from "@/lib/api/debug-client";
import { queryKeys } from "@/lib/query/query-keys";

/**
 * Shared TanStack Query mutation hook for POST /api/rebuild.
 *
 * Calls the existing runRebuild client function and always invalidates
 * queryKeys.debug.status() and queryKeys.debug.health() on settled (success
 * or failure), because persisted operation-state truth can change in both
 * cases, including on 409 conflict responses.
 *
 * Dashboard queries are intentionally NOT invalidated here: rebuild completion
 * does not guarantee that materialization has run and derived state is ready
 * for the dashboard.
 */
export function useRebuildMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: runRebuild,
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.debug.status() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.debug.health() }),
      ]);
    },
  });
}
