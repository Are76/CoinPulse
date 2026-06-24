import "server-only";

import { getDb } from "@/lib/db";
import { getRedis } from "@/lib/redis";
import { env } from "@/lib/env";
import { serverEnv } from "@/lib/server-env";
import { SUPPORTED_CHAINS, PULSECHAIN_REFERENCE } from "@/config/chains";
import { SUPPORTED_SYNC_SOURCE_FAMILIES } from "@/services/sync/source-families";
import { getOperationStateReport, type OperationStateReport } from "@/services/debug/operation-state";
import {
  getMaterializationDiagnosticsReport,
  type MaterializationDiagnosticsReport,
} from "@/services/portfolio";
import {
  getHexMiningObservationStatus,
  type HexMiningObservationStatusDto,
} from "@/services/api/hexmining-observations";

export type DependencyState = "ready" | "degraded" | "unavailable";

export type HealthReport = {
  status: "ok" | "degraded";
  timestamp: string;
  app: {
    env: typeof env.NODE_ENV;
  };
  dependencies: {
    database: {
      status: DependencyState;
    };
    redis: {
      status: DependencyState;
    };
  };
};

export type DebugStatusReport = {
  status: "ok";
  timestamp: string;
  app: {
    env: typeof env.NODE_ENV;
  };
  supportedChains: Array<{
    chainId: number;
    name: string;
    nativeAssetId: string;
  }>;
  sourceFamilies: string[];
  pricing: {
    persistedObservationsOnly: true;
    liveAdaptersEnabled: false;
  };
  operationState: OperationStateReport;
  materializationDiagnostics: MaterializationDiagnosticsReport;
  hexMining: {
    observationStatus: HexMiningObservationStatusDto | { status: "unavailable" };
  };
};

type HealthDependencies = {
  databasePing?: () => Promise<void>;
  redisPing?: () => Promise<void>;
};

export async function getHealthReport(dependencies: HealthDependencies = {}): Promise<HealthReport> {
  const databasePing =
    dependencies.databasePing ??
    (async () => {
      await getDb().$queryRaw`SELECT 1`;
    });
  const redisPing =
    dependencies.redisPing ??
    pingRedis;

  const [databaseStatus, redisStatus] = await Promise.all([
    probe(databasePing),
    probe(redisPing),
  ]);

  return {
    status:
      databaseStatus === "ready" && redisStatus === "ready" ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    app: {
      env: serverEnv.NODE_ENV,
    },
    dependencies: {
      database: {
        status: databaseStatus,
      },
      redis: {
        status: redisStatus,
      },
    },
  };
}

export async function getDebugStatusReport(): Promise<DebugStatusReport> {
  const hexMiningObsStatus = await getHexMiningObservationStatus().catch(() => ({
    status: "unavailable" as const,
  }));

  return {
    status: "ok",
    timestamp: new Date().toISOString(),
    app: {
      env: serverEnv.NODE_ENV,
    },
    supportedChains: Object.values(SUPPORTED_CHAINS).map((chain) => ({
      chainId: chain.id,
      name: chain.name,
      nativeAssetId: chain.id === 369 ? PULSECHAIN_REFERENCE.nativeAssetId : `chain:${chain.id}:native`,
    })),
    sourceFamilies: [...SUPPORTED_SYNC_SOURCE_FAMILIES],
    pricing: {
      persistedObservationsOnly: true,
      liveAdaptersEnabled: false,
    },
    operationState: await getOperationStateReport(),
    materializationDiagnostics: await getMaterializationDiagnosticsReport(),
    hexMining: {
      observationStatus: hexMiningObsStatus,
    },
  };
}

async function pingRedis() {
  const redis = getRedis();

  if (redis.status === "wait") {
    await redis.connect();
  }

  await redis.ping();
}

async function probe(ping: () => Promise<void>): Promise<DependencyState> {
  try {
    await ping();
    return "ready";
  } catch {
    return "unavailable";
  }
}
