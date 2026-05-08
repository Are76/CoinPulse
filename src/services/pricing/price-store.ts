import "server-only";

import { createHash } from "node:crypto";

import { getDb } from "@/lib/db";
import type { PersistedPriceObservation, PriceObservationDraft } from "@/services/pricing/types";

type PriceStoreClient = {
  priceObservation: {
    createMany(args: {
      data: Array<{
        id: string;
        chainId: number;
        assetId: string;
        assetAddress: string | null;
        quoteAsset: string;
        price: string;
        sourceType: PriceObservationDraft["sourceType"];
        sourceId: string;
        routeMetadata: Record<string, unknown> | null;
        liquidityUsd: string | null;
        confidence: string;
        observedAt: Date;
        blockNumber: bigint | null;
        staleAfterSeconds: number;
        createdAt?: Date;
        updatedAt?: Date;
      }>;
      skipDuplicates: boolean;
    }): Promise<{ count: number }>;
    findMany(args: {
      where: {
        chainId: number;
        assetId: string;
        quoteAsset: string;
      };
      orderBy?: Array<{ observedAt: "asc" | "desc" } | { createdAt: "asc" | "desc" }>;
    }): Promise<PersistedPriceObservation[]>;
  };
};

export async function persistPriceObservations(
  drafts: readonly PriceObservationDraft[],
  client: PriceStoreClient = getDb() as never,
) {
  if (drafts.length === 0) {
    return { createdCount: 0 };
  }

  const observations = new Map<string, PriceObservationDraft>();
  for (const draft of drafts) {
    observations.set(buildPriceObservationId(draft), draft);
  }

  const created = await client.priceObservation.createMany({
    data: Array.from(observations.entries()).map(([id, draft]) => ({
      id,
      chainId: draft.chainId,
      assetId: draft.assetId,
      assetAddress: draft.assetAddress,
      quoteAsset: draft.quoteAsset,
      price: draft.price,
      sourceType: draft.sourceType,
      sourceId: draft.sourceId,
      routeMetadata: draft.routeMetadata,
      liquidityUsd: draft.liquidityUsd,
      confidence: draft.confidence,
      observedAt: draft.observedAt,
      blockNumber: draft.blockNumber,
      staleAfterSeconds: draft.staleAfterSeconds,
      createdAt: draft.observedAt,
      updatedAt: draft.observedAt,
    })),
    skipDuplicates: true,
  });

  return { createdCount: created.count };
}

export async function listPriceObservations(
  args: {
    chainId: number;
    assetId: string;
    quoteAsset: string;
  },
  client: PriceStoreClient = getDb() as never,
) {
  return client.priceObservation.findMany({
    where: {
      chainId: args.chainId,
      assetId: args.assetId,
      quoteAsset: args.quoteAsset,
    },
    orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }],
  });
}

export function buildPriceObservationId(draft: PriceObservationDraft) {
  return `po_${createHash("sha256")
    .update(
      JSON.stringify({
        chainId: draft.chainId,
        assetId: draft.assetId,
        quoteAsset: draft.quoteAsset,
        sourceType: draft.sourceType,
        sourceId: draft.sourceId,
        observedAt: draft.observedAt.toISOString(),
        blockNumber: draft.blockNumber?.toString() ?? null,
      }),
    )
    .digest("hex")}`;
}
