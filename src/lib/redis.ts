import "server-only";

import Redis from "ioredis";

import { serverEnv } from "@/lib/server-env";

declare global {
  var __coinpulseRedis: Redis | undefined;
}

export function getRedis() {
  if (!globalThis.__coinpulseRedis) {
    globalThis.__coinpulseRedis = new Redis(serverEnv.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
  }

  return globalThis.__coinpulseRedis;
}
