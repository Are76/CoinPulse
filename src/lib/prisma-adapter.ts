import { PrismaPg } from "@prisma/adapter-pg";

import { serverEnv } from "@/lib/server-env";

export function createPrismaAdapter() {
  return new PrismaPg({ connectionString: serverEnv.DATABASE_URL });
}
