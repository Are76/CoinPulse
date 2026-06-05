// Per-query-type stale/gc time defaults aligned with docs/data-fetching-architecture.md.
// Use gcTime (not cacheTime) — React Query v5+ naming.

export const QUERY_DEFAULTS = {
  debugHealth: {
    staleTime: 15_000,
    gcTime: 5 * 60_000,
  },
  debugStatus: {
    staleTime: 10_000,
    gcTime: 5 * 60_000,
  },
  dashboard: {
    staleTime: 30_000,
    gcTime: 10 * 60_000,
  },
  // Reserved for future prices/status route
  pricesStatus: {
    staleTime: 15_000,
    gcTime: 5 * 60_000,
  },
  // Reserved for future transactions route
  transactions: {
    staleTime: 30_000,
    gcTime: 10 * 60_000,
  },
  wallets: {
    staleTime: 30_000,
    gcTime: 10 * 60_000,
  },
} as const;
