import "server-only";

import { getDb } from "@/lib/db";
import type { HexStakeListDto } from "@/services/hexmining/types";

const SNAPSHOT_TTL_SECONDS = 300;

const CURRENT_PAYLOAD_VERSION = "v1";

// Narrow typed client — subset of PrismaClient needed by this module.
type StakeSnapshotStoreClient = {
  hexStakeListSnapshot: {
    findUnique(args: {
      where: { walletAddress_chainId: { walletAddress: string; chainId: number } };
      select: { canonicalPayload: true; observedAt: true; staleAfterSeconds: true; payloadVersion: true };
    }): Promise<{ canonicalPayload: string; observedAt: Date; staleAfterSeconds: number; payloadVersion: string } | null>;
    upsert(args: {
      where: { walletAddress_chainId: { walletAddress: string; chainId: number } };
      create: {
        walletAddress: string;
        chainId: number;
        payloadVersion: string;
        canonicalPayload: string;
        observedAt: Date;
        staleAfterSeconds: number;
      };
      update: {
        canonicalPayload: string;
        observedAt: Date;
        staleAfterSeconds: number;
      };
    }): Promise<{ id: string }>;
  };
};

export type ReadHexStakeSnapshotInput = {
  walletAddress: string;
  chainId: number;
};

export type WriteHexStakeSnapshotInput = {
  walletAddress: string;
  chainId: number;
  dto: HexStakeListDto;
};

// Returns a cached HexStakeListDto if one exists and is within the TTL.
// Returns null if no snapshot exists or if the snapshot is stale.
export async function readFreshHexStakeSnapshot(
  input: ReadHexStakeSnapshotInput,
  client: StakeSnapshotStoreClient = getDb(),
): Promise<HexStakeListDto | null> {
  const row = await client.hexStakeListSnapshot.findUnique({
    where: { walletAddress_chainId: { walletAddress: input.walletAddress, chainId: input.chainId } },
    select: { canonicalPayload: true, observedAt: true, staleAfterSeconds: true, payloadVersion: true },
  });
  if (!row) return null;
  if (row.payloadVersion !== CURRENT_PAYLOAD_VERSION) return null;
  const ageSeconds = (Date.now() - row.observedAt.getTime()) / 1000;
  if (ageSeconds > row.staleAfterSeconds) return null;
  return JSON.parse(row.canonicalPayload) as HexStakeListDto;
}

// Upserts the DTO as the current snapshot for this wallet+chain pair.
export async function writeHexStakeSnapshot(
  input: WriteHexStakeSnapshotInput,
  client: StakeSnapshotStoreClient = getDb(),
): Promise<void> {
  const canonicalPayload = JSON.stringify(input.dto);
  const observedAt = input.dto.observedAt ? new Date(input.dto.observedAt) : new Date();
  await client.hexStakeListSnapshot.upsert({
    where: { walletAddress_chainId: { walletAddress: input.walletAddress, chainId: input.chainId } },
    create: {
      walletAddress: input.walletAddress,
      chainId: input.chainId,
      payloadVersion: CURRENT_PAYLOAD_VERSION,
      canonicalPayload,
      observedAt,
      staleAfterSeconds: SNAPSHOT_TTL_SECONDS,
    },
    update: {
      canonicalPayload,
      observedAt,
      staleAfterSeconds: SNAPSHOT_TTL_SECONDS,
    },
  });
}
