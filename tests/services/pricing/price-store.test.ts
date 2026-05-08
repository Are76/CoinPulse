import { describe, expect, it } from "vitest";

import { persistPriceObservations } from "@/services/pricing/price-store";
import type { PersistedPriceObservation, PriceObservationDraft } from "@/services/pricing/types";

const CHAIN_ID = 369;
const QUOTE_ASSET = "fiat:usd";

function createDraft(
  overrides: Partial<PriceObservationDraft> = {},
): PriceObservationDraft {
  return {
    chainId: CHAIN_ID,
    assetId: "chain:369:erc20:0xtokena",
    assetAddress: "0xtokena",
    quoteAsset: QUOTE_ASSET,
    price: "1.25",
    sourceType: "ONCHAIN_POOL",
    sourceId: "pulsex:pair:0xpair",
    routeMetadata: {
      hops: ["chain:369:erc20:0xtokena", "chain:369:native:PLS", QUOTE_ASSET],
    },
    liquidityUsd: "150000",
    confidence: "0.92",
    observedAt: new Date("2026-05-08T12:00:00.000Z"),
    blockNumber: 12345n,
    staleAfterSeconds: 120,
    ...overrides,
  };
}

function createMemoryDb() {
  const priceObservations = new Map<string, PersistedPriceObservation>();

  return {
    db: {
      priceObservation: {
        async createMany(args: {
          data: PersistedPriceObservation[];
          skipDuplicates: boolean;
        }) {
          let count = 0;

          for (const row of args.data) {
            if (!priceObservations.has(row.id)) {
              priceObservations.set(row.id, row);
              count += 1;
            }
          }

          return { count };
        },
        async findMany(args: {
          where: {
            chainId: number;
            assetId: string;
            quoteAsset: string;
          };
          orderBy: Array<{ observedAt: "desc" } | { createdAt: "desc" }>;
        }) {
          return Array.from(priceObservations.values())
            .filter(
              (row) =>
                row.chainId === args.where.chainId &&
                row.assetId === args.where.assetId &&
                row.quoteAsset === args.where.quoteAsset,
            )
            .sort((left, right) => right.observedAt.getTime() - left.observedAt.getTime());
        },
      },
    },
    priceObservations,
  };
}

describe("persistPriceObservations", () => {
  it("stores source-aware price observations idempotently", async () => {
    const stores = createMemoryDb();
    const first = createDraft();
    const second = createDraft({
      sourceId: "pulsex:pair:0xpair-b",
      price: "1.3",
      observedAt: new Date("2026-05-08T12:01:00.000Z"),
      blockNumber: 12346n,
    });

    const result = await persistPriceObservations([first, first, second], stores.db as never);

    expect(result.createdCount).toBe(2);
    expect(stores.priceObservations.size).toBe(2);
    expect(Array.from(stores.priceObservations.values())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetId: "chain:369:erc20:0xtokena",
          quoteAsset: QUOTE_ASSET,
          sourceType: "ONCHAIN_POOL",
          sourceId: "pulsex:pair:0xpair",
          routeMetadata: {
            hops: ["chain:369:erc20:0xtokena", "chain:369:native:PLS", QUOTE_ASSET],
          },
          liquidityUsd: "150000",
          confidence: "0.92",
          staleAfterSeconds: 120,
        }),
      ]),
    );
  });
});
