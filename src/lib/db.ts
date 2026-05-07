import "server-only";

import { PrismaClient } from "@prisma/client";

import { createPrismaAdapter } from "@/lib/prisma-adapter";

declare global {
  var __coinpulsePrisma: PrismaClient | undefined;
}

export function getDb() {
  if (!globalThis.__coinpulsePrisma) {
    globalThis.__coinpulsePrisma = new PrismaClient({
      adapter: createPrismaAdapter(),
      log:
        process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
  }

  return globalThis.__coinpulsePrisma;
}
