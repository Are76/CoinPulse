import { useMutation, useQueryClient } from "@tanstack/react-query";

import { importWallet } from "@/lib/api/debug-client";
import { queryKeys } from "@/lib/query/query-keys";

/**
 * Shared TanStack Query mutation hook for wallet import operations.
 *
 * Calls the existing debug client function and only invalidates debug metadata
 * after settlement. Invalidation promises are intentionally not returned so the
 * operation result is not blocked by follow-up metadata refetches.
 *
 * Dashboard queries are intentionally not invalidated here because the wallet
 * import route does not guarantee materialized dashboard truth is updated.
 */
export function useWalletImportMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: Parameters<typeof importWallet>[0]) => importWallet(args),
    retry: false,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.debug.status() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.debug.health() });
    },
  });
}
