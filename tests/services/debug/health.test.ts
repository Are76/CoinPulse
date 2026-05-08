import { describe, expect, it } from "vitest";

import { getHealthReport } from "@/services/debug";

describe("getHealthReport", () => {
  it("returns ok when database and redis are reachable", async () => {
    const result = await getHealthReport({
      databasePing: async () => {},
      redisPing: async () => {},
    });

    expect(result.status).toBe("ok");
    expect(result.dependencies.database.status).toBe("ready");
    expect(result.dependencies.redis.status).toBe("ready");
  });

  it("returns degraded when a dependency probe fails", async () => {
    const result = await getHealthReport({
      databasePing: async () => {},
      redisPing: async () => {
        throw new Error("down");
      },
    });

    expect(result.status).toBe("degraded");
    expect(result.dependencies.redis.status).toBe("unavailable");
  });
});
