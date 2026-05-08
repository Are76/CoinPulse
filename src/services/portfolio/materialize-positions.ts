import "server-only";

import { getDb } from "@/lib/db";

const CANONICAL_SCALE = 18;

type MaterializeDbClient = {
  token: {
    findMany(args: {
      where: { chainId: number };
    }): Promise<
      Array<{
        assetId: string;
        addressLower: string;
        decimals: number;
        isNative: boolean;
      }>
    >;
  };
  ledgerEntry: {
    findMany(args: {
      where: { walletId: string; chainId: number };
      orderBy?: Array<{ occurredAt?: "asc" | "desc"; id?: "asc" | "desc" }>;
    }): Promise<
      Array<{
        id: string;
        actionGroupId: string;
        assetId: string;
        entryType: string;
        quantity: string | { toString(): string };
        direction: string;
        sourceLogKey: string | null;
      }>
    >;
  };
  portfolioTokenBalance: {
    deleteMany(args: { where: { walletId: string; chainId: number } }): Promise<{ count: number }>;
    createMany(args: { data: Array<Record<string, unknown>> }): Promise<{ count: number }>;
  };
  portfolioLpPosition: {
    deleteMany(args: { where: { walletId: string; chainId: number } }): Promise<{ count: number }>;
    createMany(args: { data: Array<Record<string, unknown>> }): Promise<{ count: number }>;
  };
  portfolioStakePosition: {
    deleteMany(args: { where: { walletId: string; chainId: number } }): Promise<{ count: number }>;
    createMany(args: { data: Array<Record<string, unknown>> }): Promise<{ count: number }>;
  };
  $transaction?<T>(callback: (client: MaterializeDbClient) => Promise<T>): Promise<T>;
};

type TokenMeta = {
  assetId: string;
  addressLower: string;
  decimals: number;
  isNative: boolean;
};

type LpPositionAccumulator = {
  lpAssetId: string;
  lpTokenAddress: string | null;
  lpTokenQuantityScaled: bigint;
  token0AssetId: string | null;
  token0Address: string | null;
  token1AssetId: string | null;
  token1Address: string | null;
  token0NetQuantityScaled: bigint | null;
  token1NetQuantityScaled: bigint | null;
};

type StakeAccumulator = {
  stakeKey: string;
  tokenAssetId: string;
  tokenAddress: string | null;
  principalQuantityScaled: bigint;
  returnedQuantityScaled: bigint;
  yieldQuantityScaled: bigint | null;
  penaltyQuantityScaled: bigint | null;
  started: boolean;
  ended: boolean;
};

export type MaterializePortfolioPositionsReport = {
  wallet: string;
  chainId: number;
  ledgerEntriesProcessed: number;
  tokenBalancesWritten: number;
  lpPositionsWritten: number;
  stakePositionsWritten: number;
  skippedCount: number;
  warnings: string[];
};

export async function materializeCurrentPortfolioPositions(args: {
  wallet: { id: string; address: string; chainId: number };
  db?: MaterializeDbClient;
}): Promise<MaterializePortfolioPositionsReport> {
  const db = args.db ?? (getDb() as unknown as MaterializeDbClient);
  const [tokens, ledgerEntries] = await Promise.all([
    db.token.findMany({ where: { chainId: args.wallet.chainId } }),
    db.ledgerEntry.findMany({
      where: { walletId: args.wallet.id, chainId: args.wallet.chainId },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    }),
  ]);

  const tokenByAssetId = new Map(tokens.map((token) => [token.assetId, token]));
  const tokenBalances = new Map<string, bigint>();
  const lpPositions = new Map<string, LpPositionAccumulator>();
  const stakePositions = new Map<string, StakeAccumulator>();
  const entriesByActionGroup = new Map<string, typeof ledgerEntries>();
  const warnings = new Set<string>();
  let skippedCount = 0;

  for (const entry of ledgerEntries) {
    const group = entriesByActionGroup.get(entry.actionGroupId);
    if (group) {
      group.push(entry);
    } else {
      entriesByActionGroup.set(entry.actionGroupId, [entry]);
    }

    if (entry.direction === "INTERNAL") {
      continue;
    }

    const quantityScaled = decimalToScaledBigInt(toQuantityString(entry.quantity));
    const signedQuantity = entry.direction === "IN" ? quantityScaled : -quantityScaled;
    tokenBalances.set(entry.assetId, (tokenBalances.get(entry.assetId) ?? 0n) + signedQuantity);
  }

  for (const groupEntries of entriesByActionGroup.values()) {
    const lpEntries = groupEntries.filter((entry) => entry.entryType.startsWith("LP_"));
    if (lpEntries.length > 0) {
      const lpResult = accumulateLpPosition({
        entries: lpEntries,
        tokenByAssetId,
        positions: lpPositions,
      });
      skippedCount += lpResult.skippedCount;
      for (const warning of lpResult.warnings) {
        warnings.add(warning);
      }
    }

    const stakeEntries = groupEntries.filter((entry) => entry.entryType.startsWith("STAKE_"));
    if (stakeEntries.length > 0) {
      const stakeResult = accumulateStakePosition({
        entries: stakeEntries,
        tokenByAssetId,
        positions: stakePositions,
      });
      skippedCount += stakeResult.skippedCount;
      for (const warning of stakeResult.warnings) {
        warnings.add(warning);
      }
    }
  }

  const walletAddress = args.wallet.address.toLowerCase();
  const tokenBalanceRows = Array.from(tokenBalances.entries())
    .filter(([, value]) => value !== 0n)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([assetId, value]) => {
      const token = tokenByAssetId.get(assetId);
      return {
        walletId: args.wallet.id,
        walletAddress,
        chainId: args.wallet.chainId,
        assetId,
        assetAddress: token?.isNative ? null : token?.addressLower ?? parseAssetAddress(assetId),
        balanceQuantity: scaledBigIntToDecimal(value),
        decimals: token?.decimals ?? null,
        updatedFromBlock: null,
        updatedToBlock: null,
      };
    });

  const lpRows = Array.from(lpPositions.values())
    .filter(
      (position) =>
        position.lpTokenQuantityScaled !== 0n ||
        position.token0NetQuantityScaled !== 0n ||
        position.token1NetQuantityScaled !== 0n,
    )
    .sort((left, right) => left.lpAssetId.localeCompare(right.lpAssetId))
    .map((position) => ({
      walletId: args.wallet.id,
      walletAddress,
      chainId: args.wallet.chainId,
      lpAssetId: position.lpAssetId,
      lpTokenAddress: position.lpTokenAddress,
      lpTokenQuantity: scaledBigIntToDecimal(position.lpTokenQuantityScaled),
      token0AssetId: position.token0AssetId,
      token0Address: position.token0Address,
      token1AssetId: position.token1AssetId,
      token1Address: position.token1Address,
      token0NetQuantity:
        position.token0NetQuantityScaled === null
          ? null
          : scaledBigIntToDecimal(position.token0NetQuantityScaled),
      token1NetQuantity:
        position.token1NetQuantityScaled === null
          ? null
          : scaledBigIntToDecimal(position.token1NetQuantityScaled),
      updatedFromBlock: null,
      updatedToBlock: null,
    }));

  const stakeRows = Array.from(stakePositions.values())
    .sort((left, right) => left.stakeKey.localeCompare(right.stakeKey))
    .map((position) => ({
      walletId: args.wallet.id,
      walletAddress,
      chainId: args.wallet.chainId,
      stakeKey: position.stakeKey,
      tokenAssetId: position.tokenAssetId,
      tokenAddress: position.tokenAddress,
      principalQuantity: scaledBigIntToDecimal(position.principalQuantityScaled),
      returnedQuantity: scaledBigIntToDecimal(position.returnedQuantityScaled),
      yieldQuantity:
        position.yieldQuantityScaled === null
          ? null
          : scaledBigIntToDecimal(position.yieldQuantityScaled),
      penaltyQuantity:
        position.penaltyQuantityScaled === null
          ? null
          : scaledBigIntToDecimal(position.penaltyQuantityScaled),
      status: position.ended ? "ENDED" : position.started ? "ACTIVE" : "UNKNOWN",
      startBlock: null,
      endBlock: null,
    }));

  const persist = async (client: MaterializeDbClient) => {
    await client.portfolioTokenBalance.deleteMany({
      where: { walletId: args.wallet.id, chainId: args.wallet.chainId },
    });
    await client.portfolioLpPosition.deleteMany({
      where: { walletId: args.wallet.id, chainId: args.wallet.chainId },
    });
    await client.portfolioStakePosition.deleteMany({
      where: { walletId: args.wallet.id, chainId: args.wallet.chainId },
    });

    const [tokenResult, lpResult, stakeResult] = await Promise.all([
      client.portfolioTokenBalance.createMany({ data: tokenBalanceRows }),
      client.portfolioLpPosition.createMany({ data: lpRows }),
      client.portfolioStakePosition.createMany({ data: stakeRows }),
    ]);

    return {
      tokenCount: tokenResult.count,
      lpCount: lpResult.count,
      stakeCount: stakeResult.count,
    };
  };

  const persisted = db.$transaction ? await db.$transaction(persist) : await persist(db);

  return {
    wallet: args.wallet.address,
    chainId: args.wallet.chainId,
    ledgerEntriesProcessed: ledgerEntries.length,
    tokenBalancesWritten: persisted.tokenCount,
    lpPositionsWritten: persisted.lpCount,
    stakePositionsWritten: persisted.stakeCount,
    skippedCount,
    warnings: Array.from(warnings).sort(),
  };
}

function accumulateLpPosition(args: {
  entries: Array<{
    assetId: string;
    entryType: string;
    quantity: string | { toString(): string };
  }>;
  tokenByAssetId: Map<string, TokenMeta>;
  positions: Map<string, LpPositionAccumulator>;
}) {
  const lpEntry =
    args.entries.find((entry) => entry.entryType === "LP_ADD_IN") ??
    args.entries.find((entry) => entry.entryType === "LP_REMOVE_OUT");

  if (!lpEntry) {
    return { warnings: ["lp-position-missing-lp-leg"], skippedCount: 1 };
  }

  const underlyingEntries = args.entries
    .filter((entry) => entry.assetId !== lpEntry.assetId)
    .sort((left, right) => left.assetId.localeCompare(right.assetId));

  if (underlyingEntries.length !== 2) {
    return {
      warnings: [`lp-position-ambiguous-underlyings:${lpEntry.assetId}:${underlyingEntries.length}`],
      skippedCount: 1,
    };
  }

  const lpToken = args.tokenByAssetId.get(lpEntry.assetId);
  const [token0Entry, token1Entry] = underlyingEntries;
  const token0 = args.tokenByAssetId.get(token0Entry.assetId);
  const token1 = args.tokenByAssetId.get(token1Entry.assetId);

  const position =
    args.positions.get(lpEntry.assetId) ?? {
      lpAssetId: lpEntry.assetId,
      lpTokenAddress:
        lpToken?.isNative ? null : lpToken?.addressLower ?? parseAssetAddress(lpEntry.assetId),
      lpTokenQuantityScaled: 0n,
      token0AssetId: token0Entry.assetId,
      token0Address:
        token0?.isNative ? null : token0?.addressLower ?? parseAssetAddress(token0Entry.assetId),
      token1AssetId: token1Entry.assetId,
      token1Address:
        token1?.isNative ? null : token1?.addressLower ?? parseAssetAddress(token1Entry.assetId),
      token0NetQuantityScaled: 0n,
      token1NetQuantityScaled: 0n,
    };

  position.lpTokenQuantityScaled +=
    lpEntry.entryType === "LP_ADD_IN"
      ? decimalToScaledBigInt(toQuantityString(lpEntry.quantity))
      : -decimalToScaledBigInt(toQuantityString(lpEntry.quantity));

  position.token0NetQuantityScaled =
    (position.token0NetQuantityScaled ?? 0n) +
    (token0Entry.entryType === "LP_ADD_OUT"
      ? decimalToScaledBigInt(toQuantityString(token0Entry.quantity))
      : -decimalToScaledBigInt(toQuantityString(token0Entry.quantity)));
  position.token1NetQuantityScaled =
    (position.token1NetQuantityScaled ?? 0n) +
    (token1Entry.entryType === "LP_ADD_OUT"
      ? decimalToScaledBigInt(toQuantityString(token1Entry.quantity))
      : -decimalToScaledBigInt(toQuantityString(token1Entry.quantity)));

  args.positions.set(lpEntry.assetId, position);

  return { warnings: [] as string[], skippedCount: 0 };
}

function accumulateStakePosition(args: {
  entries: Array<{
    assetId: string;
    entryType: string;
    quantity: string | { toString(): string };
    sourceLogKey: string | null;
  }>;
  tokenByAssetId: Map<string, TokenMeta>;
  positions: Map<string, StakeAccumulator>;
}) {
  const warnings = new Set<string>();
  let skippedCount = 0;

  for (const entry of args.entries) {
    const stakeKey = parseStakeKey(entry.sourceLogKey);
    if (!stakeKey) {
      warnings.add(`stake-key-missing:${entry.sourceLogKey ?? "null"}`);
      skippedCount += 1;
      continue;
    }

    const token = args.tokenByAssetId.get(entry.assetId);
    const position =
      args.positions.get(stakeKey) ?? {
        stakeKey,
        tokenAssetId: entry.assetId,
        tokenAddress:
          token?.isNative ? null : token?.addressLower ?? parseAssetAddress(entry.assetId),
        principalQuantityScaled: 0n,
        returnedQuantityScaled: 0n,
        yieldQuantityScaled: null,
        penaltyQuantityScaled: null,
        started: false,
        ended: false,
      };

    const quantityScaled = decimalToScaledBigInt(toQuantityString(entry.quantity));

    switch (entry.entryType) {
      case "STAKE_START":
        position.started = true;
        break;
      case "STAKE_END":
        position.ended = true;
        break;
      case "STAKE_PRINCIPAL_LOCKED":
        position.principalQuantityScaled += quantityScaled;
        break;
      case "STAKE_PRINCIPAL_RETURNED":
        position.returnedQuantityScaled += quantityScaled;
        break;
      case "STAKE_YIELD_RECEIVED":
        position.yieldQuantityScaled = (position.yieldQuantityScaled ?? 0n) + quantityScaled;
        break;
      case "STAKE_PENALTY":
        position.penaltyQuantityScaled = (position.penaltyQuantityScaled ?? 0n) + quantityScaled;
        break;
      default:
        break;
    }

    args.positions.set(stakeKey, position);
  }

  return { warnings: Array.from(warnings), skippedCount };
}

function parseStakeKey(sourceLogKey: string | null) {
  if (!sourceLogKey) {
    return null;
  }
  const match = sourceLogKey.match(/stake:(?:start|end):([^:]+)/i);
  return match?.[1] ?? null;
}

function parseAssetAddress(assetId: string) {
  const marker = ":erc20:";
  const index = assetId.indexOf(marker);
  if (index === -1) {
    return null;
  }
  return assetId.slice(index + marker.length).toLowerCase();
}

function toQuantityString(quantity: string | { toString(): string }) {
  return typeof quantity === "string" ? quantity : quantity.toString();
}

function decimalToScaledBigInt(value: string) {
  const normalized = value.trim();
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [integerPart, fractionalPart = ""] = unsigned.split(".");
  if (fractionalPart.length > CANONICAL_SCALE) {
    throw new Error(`quantity exceeds canonical scale: ${value}`);
  }
  const paddedFraction = fractionalPart.padEnd(CANONICAL_SCALE, "0");
  const scaled = BigInt(`${integerPart || "0"}${paddedFraction}`.replace(/^0+/, "") || "0");
  return negative ? -scaled : scaled;
}

function scaledBigIntToDecimal(value: bigint) {
  const negative = value < 0n;
  const unsigned = negative ? -value : value;
  const padded = unsigned.toString().padStart(CANONICAL_SCALE + 1, "0");
  const integerPart = padded.slice(0, -CANONICAL_SCALE).replace(/^0+/, "") || "0";
  const fractionalPart = padded.slice(-CANONICAL_SCALE).replace(/0+$/, "");
  const result =
    fractionalPart.length === 0 ? integerPart : `${integerPart}.${fractionalPart}`;
  return negative ? `-${result}` : result;
}
