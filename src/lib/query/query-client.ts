import { QueryClient } from "@tanstack/react-query";

export const queryTiming = {
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
  transactions: {
    staleTime: 30_000,
    gcTime: 10 * 60_000,
  },
  pricesStatus: {
    staleTime: 15_000,
    gcTime: 5 * 60_000,
  },
} as const;

export function createQueryClient() {
  return new QueryClient();
}
