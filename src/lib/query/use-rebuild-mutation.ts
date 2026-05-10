import { useMutation, useQueryClient } from "@tanstack/react-query";

import { runRebuild } from "@/lib/api/debug-client";
import { queryKeys } from "@/lib/query/query-keys";

/**
 * Shared TanStack Query mutation hook for debug rebuild operations.
 *
 * Calls the existing debug client mutation and only invalidates debug metadata
 * after settlement. Invalidation promises are intentionally not returned so the
 * operation result is not blocked by follow-up metadata refetches.
 */
export function useRebuildMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: Parameters<typeof runRebuild>[0]) => runRebuild(args),
    retry: false,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.debug.status() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.debug.health() });
    },
  });
}
