import { useMutation, useQueryClient } from "@tanstack/react-query";

import { runManualSync } from "@/lib/api/debug-client";
import { queryKeys } from "@/lib/query/query-keys";

/**
 * Shared TanStack Query mutation hook for POST /api/sync/manual.
 *
 * Calls the existing runManualSync client function and always invalidates
 * queryKeys.debug.status() and queryKeys.debug.health() on settled (success
 * or failure), because persisted SyncRun / operation-state truth can change
 * in both cases, including on 409 conflict responses.
 *
 * Dashboard queries are intentionally NOT invalidated here: manual sync
 * completion alone does not guarantee that materialization has run.
 */
export function useManualSyncMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: runManualSync,
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.debug.status() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.debug.health() }),
      ]);
    },
  });
}
