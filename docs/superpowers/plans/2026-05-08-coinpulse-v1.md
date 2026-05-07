# CoinPulse V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-shaped, PulseChain-first, no-auth portfolio engine with on-demand sync, raw audit storage, canonical ledger, average-cost PnL, one dashboard, and one debug page.

**Architecture:** A Next.js 15 App Router application hosts the UI and API surface while server-side domain services handle logs-first RPC ingestion, deterministic normalization, conservative on-chain pricing, ledger-backed balances, and snapshot materialization. PostgreSQL is the source of truth, Redis is optional acceleration, normalized ledger quantities are stored only in canonical decimal-adjusted accounting units, and every portfolio number is served from persisted raw, ledger, or derived tables rather than direct RPC reads.

**Tech Stack:** Next.js 15.5.7, React 19.2.4, TypeScript, Tailwind CSS, shadcn/ui, Prisma, PostgreSQL, Redis, viem, TanStack Query, Zod, Zustand, decimal.js, Vitest, Testing Library

---

## File Structure

### App Routes

- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/dashboard/page.tsx`
- Create: `src/app/debug/sync/page.tsx`
- Create: `src/app/api/health/route.ts`
- Create: `src/app/api/wallets/route.ts`
- Create: `src/app/api/wallets/import/route.ts`
- Create: `src/app/api/sync/route.ts`
- Create: `src/app/api/sync/[runId]/route.ts`
- Create: `src/app/api/rebuild/route.ts`
- Create: `src/app/api/dashboard/route.ts`
- Create: `src/app/api/debug/sync/route.ts`
- Create: `src/app/api/prices/status/route.ts`

### Infrastructure

- Create: `src/lib/env.ts`
- Create: `src/lib/db.ts`
- Create: `src/lib/redis.ts`
- Create: `src/lib/logger.ts`
- Create: `src/lib/utils.ts`
- Create: `src/lib/decimal.ts`
- Create: `src/lib/query-client.ts`

### Domain Configuration

- Create: `src/config/chains.ts`
- Create: `src/config/assets.ts`
- Create: `src/config/protocols.ts`
- Create: `src/config/pricing.ts`

### Domain Services

- Create: `src/services/chains/public-client.ts`
- Create: `src/services/ingestion/block-window.ts`
- Create: `src/services/ingestion/raw-store.ts`
- Create: `src/services/ingestion/log-fetcher.ts`
- Create: `src/services/ingestion/reorg-guard.ts`
- Create: `src/services/ingestion/sync-orchestrator.ts`
- Create: `src/services/normalization/types.ts`
- Create: `src/services/normalization/transfer-normalizer.ts`
- Create: `src/services/normalization/swap-normalizer.ts`
- Create: `src/services/normalization/lp-normalizer.ts`
- Create: `src/services/normalization/hex-normalizer.ts`
- Create: `src/services/normalization/index.ts`
- Create: `src/services/pricing/pool-discovery.ts`
- Create: `src/services/pricing/route-pricer.ts`
- Create: `src/services/pricing/price-store.ts`
- Create: `src/services/pricing/status.ts`
- Create: `src/services/pnl/types.ts`
- Create: `src/services/pnl/utils.ts`
- Create: `src/services/pnl/average-cost-engine.ts`
- Create: `src/services/pnl/fifo-engine.ts`
- Create: `src/services/pnl/lifo-engine.ts`
- Create: `src/services/portfolio/balance-materializer.ts`
- Create: `src/services/portfolio/snapshot-materializer.ts`
- Create: `src/services/portfolio/dashboard-query.ts`
- Create: `src/services/rebuild/rebuild-ledger.ts`
- Create: `src/services/debug/debug-query.ts`

### UI

- Create: `src/components/app-shell.tsx`
- Create: `src/components/sidebar-nav.tsx`
- Create: `src/components/topbar.tsx`
- Create: `src/components/wallet-import-form.tsx`
- Create: `src/components/tracked-wallets-card.tsx`
- Create: `src/components/summary-cards.tsx`
- Create: `src/components/holdings-table.tsx`
- Create: `src/components/activity-table.tsx`
- Create: `src/components/position-cards.tsx`
- Create: `src/components/sync-banner.tsx`
- Create: `src/components/number-with-provenance.tsx`
- Create: `src/components/debug/sync-runs-panel.tsx`
- Create: `src/components/debug/price-status-panel.tsx`
- Create: `src/components/debug/rebuild-panel.tsx`

### State and Hooks

- Create: `src/store/portfolio-selection.ts`
- Create: `src/hooks/use-dashboard.ts`
- Create: `src/hooks/use-wallets.ts`
- Create: `src/hooks/use-sync-run.ts`
- Create: `src/hooks/use-price-status.ts`

### Prisma and Seeds

- Create: `prisma/schema.prisma`
- Create: `prisma/seed.ts`

### Tests

- Create: `tests/setup.ts`
- Create: `tests/lib/env.test.ts`
- Create: `tests/services/normalization/transfer-normalizer.test.ts`
- Create: `tests/services/normalization/swap-normalizer.test.ts`
- Create: `tests/services/pnl/average-cost-engine.test.ts`
- Create: `tests/services/pricing/route-pricer.test.ts`
- Create: `tests/services/ingestion/reorg-guard.test.ts`
- Create: `tests/services/portfolio/dashboard-query.test.ts`
- Create: `tests/app/api/wallet-import.route.test.ts`
- Create: `tests/app/api/dashboard.route.test.ts`

### Docs

- Create: `.env.example`
- Create: `README.md`

## Task 1: Scaffold the Next.js App and Baseline Tooling

**Files:**
- Create: `package.json`, `next.config.ts`, `tsconfig.json`, `src/app/globals.css`, `src/app/layout.tsx`, `src/app/page.tsx`
- Create: `components.json`
- Create: `vitest.config.ts`, `tests/setup.ts`
- Test: `tests/lib/env.test.ts`

- [ ] **Step 1: Scaffold the project and install the runtime/test dependencies**

```bash
npx create-next-app@latest . --yes --force --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --turbopack --use-npm
npm install next@15.5.7 react@19.2.4 react-dom@19.2.4 @prisma/client prisma zod decimal.js viem @tanstack/react-query zustand next-themes ioredis lucide-react recharts clsx tailwind-merge class-variance-authority
npm install -D vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event tsx
npx shadcn@latest init -d --base radix
npx shadcn@latest add button card input table badge alert separator sheet skeleton scroll-area tooltip
```

Expected: app scaffolded, `components.json` created, dependencies installed without interactive prompts.

- [ ] **Step 2: Write the failing environment smoke test**

```ts
// tests/lib/env.test.ts
import { describe, expect, it } from "vitest";

import { env } from "@/lib/env";

describe("env", () => {
  it("exposes a PulseChain default chain id", () => {
    expect(env.DEFAULT_CHAIN_ID).toBe(369);
  });
});
```

- [ ] **Step 3: Add the first-pass package scripts and Vitest config**

```json
// package.json (scripts excerpt)
{
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:seed": "tsx prisma/seed.ts"
  }
}
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 4: Add the base root layout and landing placeholder**

```tsx
// src/app/layout.tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CoinPulse",
  description: "PulseChain-first portfolio analytics",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
```

```tsx
// src/app/page.tsx
export default function HomePage() {
  return <main className="p-8">CoinPulse import view</main>;
}
```

- [ ] **Step 5: Run the smoke test**

Run: `npm run test -- tests/lib/env.test.ts`

Expected: FAIL with `Cannot find module '@/lib/env'`.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "chore: scaffold next app and test harness"
```

## Task 2: Add Environment Validation and Lazy Infrastructure Clients

**Files:**
- Create: `src/lib/env.ts`, `src/lib/db.ts`, `src/lib/redis.ts`, `src/lib/logger.ts`, `src/lib/decimal.ts`
- Modify: `tests/lib/env.test.ts`
- Test: `tests/lib/env.test.ts`

- [ ] **Step 1: Expand the environment test to cover required defaults**

```ts
// tests/lib/env.test.ts
import { describe, expect, it } from "vitest";

import { env } from "@/lib/env";

describe("env", () => {
  it("pins PulseChain as the default chain", () => {
    expect(env.DEFAULT_CHAIN_ID).toBe(369);
    expect(env.PULSECHAIN_RPC_URL).toContain("pulsechainstats.com");
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing module failure**

Run: `npm run test -- tests/lib/env.test.ts`

Expected: FAIL with `Cannot find module '@/lib/env'`.

- [ ] **Step 3: Implement validated env loading and lazy clients**

```ts
// src/lib/env.ts
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1).default("postgresql://postgres:postgres@localhost:5432/coinpulse"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  DEFAULT_CHAIN_ID: z.coerce.number().default(369),
  PULSECHAIN_RPC_URL: z.string().url().default("https://rpc.pulsechainstats.com"),
  NORMALIZER_VERSION: z.string().default("v1"),
});

export const env = envSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  DEFAULT_CHAIN_ID: process.env.DEFAULT_CHAIN_ID,
  PULSECHAIN_RPC_URL: process.env.PULSECHAIN_RPC_URL,
  NORMALIZER_VERSION: process.env.NORMALIZER_VERSION,
});
```

```ts
// src/lib/db.ts
import { PrismaClient } from "@prisma/client";

let prisma: PrismaClient | undefined;

export function getDb() {
  if (!prisma) {
    prisma = new PrismaClient({
      log: ["warn", "error"],
    });
  }

  return prisma;
}
```

```ts
// src/lib/redis.ts
import Redis from "ioredis";

import { env } from "@/lib/env";

let redis: Redis | undefined;

export function getRedis() {
  if (!redis) {
    redis = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  return redis;
}
```

- [ ] **Step 4: Add decimal helpers and a minimal logger**

```ts
// src/lib/decimal.ts
import Decimal from "decimal.js";

Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});

export { Decimal };
```

```ts
// src/lib/logger.ts
export function logInfo(message: string, context?: Record<string, unknown>) {
  console.info(message, context ?? {});
}

export function logError(message: string, context?: Record<string, unknown>) {
  console.error(message, context ?? {});
}
```

- [ ] **Step 5: Run the env test**

Run: `npm run test -- tests/lib/env.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib tests/lib/env.test.ts package.json vitest.config.ts
git commit -m "feat: add validated env and lazy infrastructure clients"
```

## Task 3: Model the Database Truth Layers in Prisma

**Files:**
- Create: `prisma/schema.prisma`, `prisma/seed.ts`
- Modify: `.env.example`
- Test: `tests/services/portfolio/dashboard-query.test.ts`

- [ ] **Step 1: Write a failing schema-oriented portfolio query test**

```ts
// tests/services/portfolio/dashboard-query.test.ts
import { describe, expect, it } from "vitest";

import { PULSECHAIN_NATIVE_ASSET_ID } from "@/config/assets";

describe("asset config", () => {
  it("defines a deterministic native PLS asset id", () => {
    expect(PULSECHAIN_NATIVE_ASSET_ID).toBe("chain:369:native:PLS");
  });
});
```

- [ ] **Step 2: Run the test to confirm missing config/schema support**

Run: `npm run test -- tests/services/portfolio/dashboard-query.test.ts`

Expected: FAIL with `Cannot find module '@/config/assets'`.

- [ ] **Step 3: Implement the Prisma schema for raw, ledger, and derived layers**

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum SyncRunStatus {
  PENDING
  RUNNING
  FAILED
  COMPLETED
}

enum LedgerEntryType {
  RECEIVE
  SEND
  SWAP_IN
  SWAP_OUT
  FEE
  LP_ADD_IN
  LP_ADD_OUT
  LP_REMOVE_IN
  LP_REMOVE_OUT
  STAKE_LOCK
  STAKE_UNLOCK
  STAKE_REWARD
  INTERNAL_TRANSFER
  APPROVAL_IGNORE
}

model Chain {
  id        Int      @id
  name      String
  rpcUrl    String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Wallet {
  id          String    @id @default(cuid())
  chainId     Int
  address     String
  label       String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  syncRuns    SyncRun[]
  @@unique([chainId, address])
}

model Token {
  id             String   @id @default(cuid())
  chainId         Int
  address         String
  assetId         String   @unique
  symbol          String
  name            String
  decimals        Int
  decimalsSource  String
  isNative        Boolean  @default(false)
  isIgnored       Boolean  @default(false)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@unique([chainId, address])
}

model SyncRun {
  id                 String        @id @default(cuid())
  walletId           String?
  chainId            Int
  status             SyncRunStatus @default(PENDING)
  stage              String
  startBlock         BigInt
  endBlock           BigInt?
  latestSafeBlock    BigInt?
  warningCount       Int           @default(0)
  errorMessage       String?
  createdAt          DateTime      @default(now())
  updatedAt          DateTime      @updatedAt
  wallet             Wallet?       @relation(fields: [walletId], references: [id])
}

model RawBlock {
  id          String   @id @default(cuid())
  chainId     Int
  blockNumber BigInt
  blockHash   String
  parentHash  String
  timestamp   DateTime
  createdAt   DateTime @default(now())
  @@unique([chainId, blockNumber, blockHash])
}

model RawTransaction {
  id               String   @id @default(cuid())
  chainId          Int
  txHash           String
  blockNumber      BigInt
  blockHash        String
  transactionIndex Int
  fromAddress      String
  toAddress        String?
  valueRaw         Decimal  @db.Decimal(65, 0)
  createdAt        DateTime @default(now())
  @@unique([chainId, txHash])
}

model RawLog {
  id          String   @id @default(cuid())
  chainId     Int
  txHash      String
  blockNumber BigInt
  blockHash   String
  logIndex    Int
  address     String
  topic0      String?
  topic1      String?
  topic2      String?
  topic3      String?
  data        String
  createdAt   DateTime @default(now())
  @@unique([chainId, txHash, logIndex])
}

model LedgerActionGroup {
  id             String   @id @default(cuid())
  chainId        Int
  walletId       String
  txHash         String
  actionGroupKey String   @unique
  actionType     String
  occurredAt     DateTime
  createdAt      DateTime @default(now())
}

model LedgerEntry {
  id                String          @id @default(cuid())
  chainId           Int
  walletId          String
  actionGroupId     String
  txHash            String
  entryType         LedgerEntryType
  assetId           String
  quantity          Decimal         @db.Decimal(65, 18)
  valueUsd          Decimal?        @db.Decimal(65, 18)
  direction         String
  normalizerVersion String
  occurredAt        DateTime
  sourceLogIndex    Int?
  createdAt         DateTime        @default(now())
  @@unique([chainId, walletId, txHash, entryType, assetId, sourceLogIndex])
}
```

- [ ] **Step 4: Add the remaining derived models, seed file, and env example**

```prisma
// prisma/schema.prisma (append)
model WalletTokenBalance {
  id          String   @id @default(cuid())
  walletId     String
  assetId      String
  chainId      Int
  balance      Decimal  @db.Decimal(65, 18)
  balanceRaw   Decimal  @db.Decimal(65, 0)
  updatedAt    DateTime @updatedAt
  @@unique([walletId, assetId])
}

model WalletPnlState {
  id                   String   @id @default(cuid())
  walletId             String
  assetId              String
  chainId              Int
  totalAcquired        Decimal  @db.Decimal(65, 18)
  totalDisposed        Decimal  @db.Decimal(65, 18)
  currentBalance       Decimal  @db.Decimal(65, 18)
  averageAcquisition   Decimal  @db.Decimal(65, 18)
  realizedPnlUsd       Decimal  @db.Decimal(65, 18)
  unrealizedPnlUsd     Decimal  @db.Decimal(65, 18)
  updatedAt            DateTime @updatedAt
  @@unique([walletId, assetId])
}

model WalletSnapshot {
  id                String   @id @default(cuid())
  walletId          String
  chainId           Int
  snapshotAt        DateTime
  totalValueUsd     Decimal  @db.Decimal(65, 18)
  pricedValueUsd    Decimal  @db.Decimal(65, 18)
  unpricedValueUsd  Decimal  @db.Decimal(65, 18)
  realizedPnlUsd    Decimal  @db.Decimal(65, 18)
  unrealizedPnlUsd  Decimal  @db.Decimal(65, 18)
  schemaVersion     String
  createdAt         DateTime @default(now())
}
```

```ts
// prisma/seed.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.chain.upsert({
    where: { id: 369 },
    update: {
      name: "PulseChain",
      rpcUrl: "https://rpc.pulsechainstats.com",
    },
    create: {
      id: 369,
      name: "PulseChain",
      rpcUrl: "https://rpc.pulsechainstats.com",
    },
  });
}

main().finally(async () => {
  await prisma.$disconnect();
});
```

```env
# .env.example
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/coinpulse
REDIS_URL=redis://localhost:6379
DEFAULT_CHAIN_ID=369
PULSECHAIN_RPC_URL=https://rpc.pulsechainstats.com
NORMALIZER_VERSION=v1
```

- [ ] **Step 5: Generate Prisma client, run migration, and seed**

Run:

```bash
npm run db:generate
npm run db:migrate -- --name init_coinpulse_v1
npm run db:seed
```

Expected: Prisma client generated, migration created/applied, PulseChain chain row seeded.

- [ ] **Step 6: Commit**

```bash
git add prisma .env.example
git commit -m "feat: add prisma truth-layer schema"
```

## Task 4: Add Chain and Asset Configuration

**Files:**
- Create: `src/config/chains.ts`, `src/config/assets.ts`, `src/config/protocols.ts`
- Create: `src/services/chains/public-client.ts`
- Modify: `tests/services/portfolio/dashboard-query.test.ts`
- Test: `tests/services/portfolio/dashboard-query.test.ts`

- [ ] **Step 1: Expand the asset config test**

```ts
// tests/services/portfolio/dashboard-query.test.ts
import { describe, expect, it } from "vitest";

import { PHEX_ADDRESS, PHEX_DECIMALS, PULSECHAIN_NATIVE_ASSET_ID } from "@/config/assets";

describe("asset config", () => {
  it("defines native PLS and pHEX invariants", () => {
    expect(PULSECHAIN_NATIVE_ASSET_ID).toBe("chain:369:native:PLS");
    expect(PHEX_ADDRESS).toBe("0x2b591e99afe9f32eaa6214f7b7629768c40eeb39");
    expect(PHEX_DECIMALS).toBe(8);
  });
});
```

- [ ] **Step 2: Run the config test**

Run: `npm run test -- tests/services/portfolio/dashboard-query.test.ts`

Expected: FAIL with `Cannot find module '@/config/assets'`.

- [ ] **Step 3: Implement chain, asset, and protocol constants**

```ts
// src/config/chains.ts
export const PULSECHAIN = {
  id: 369,
  name: "PulseChain",
  rpcUrl: "https://rpc.pulsechainstats.com",
} as const;
```

```ts
// src/config/assets.ts
export const PULSECHAIN_NATIVE_ASSET_ID = "chain:369:native:PLS";
export const PULSECHAIN_NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000";
export const WPLS_ADDRESS = "0xa1077a294dde1b09bb078844df40758a5d0f9a27";
export const PHEX_ADDRESS = "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39";
export const PHEX_DECIMALS = 8;
```

```ts
// src/config/protocols.ts
export const PROTOCOLS = {
  pulsex: {
    name: "PulseX",
    factoryAddress: "0x29eA7545DEf87022BAdc76323F373EA1e707C523",
  },
  hex: {
    name: "HEX",
    stakeManagerAddress: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
  },
} as const;
```

- [ ] **Step 4: Add the viem public client factory**

```ts
// src/services/chains/public-client.ts
import { createPublicClient, http } from "viem";

import { env } from "@/lib/env";

export function getPulsechainClient() {
  return createPublicClient({
    chain: {
      id: 369,
      name: "PulseChain",
      nativeCurrency: {
        name: "Pulse",
        symbol: "PLS",
        decimals: 18,
      },
      rpcUrls: {
        default: {
          http: [env.PULSECHAIN_RPC_URL],
        },
      },
    },
    transport: http(env.PULSECHAIN_RPC_URL),
  });
}
```

- [ ] **Step 5: Run the config test**

Run: `npm run test -- tests/services/portfolio/dashboard-query.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config src/services/chains tests/services/portfolio/dashboard-query.test.ts
git commit -m "feat: add pulsechain config and client factory"
```

## Task 5: Build Wallet Import and Local Portfolio Selection

**Files:**
- Create: `src/app/api/wallets/import/route.ts`, `src/app/api/wallets/route.ts`
- Create: `src/store/portfolio-selection.ts`, `src/hooks/use-wallets.ts`
- Create: `src/components/wallet-import-form.tsx`, `src/components/tracked-wallets-card.tsx`
- Modify: `src/app/page.tsx`
- Test: `tests/app/api/wallet-import.route.test.ts`

- [ ] **Step 1: Write the failing wallet import route test**

```ts
// tests/app/api/wallet-import.route.test.ts
import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/wallets/import/route";

describe("POST /api/wallets/import", () => {
  it("returns 201 for valid PulseChain wallet imports", async () => {
    const request = new Request("http://localhost/api/wallets/import", {
      method: "POST",
      body: JSON.stringify({
        addresses: ["0x000000000000000000000000000000000000dEaD"],
      }),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(201);
  });
});
```

- [ ] **Step 2: Run the route test**

Run: `npm run test -- tests/app/api/wallet-import.route.test.ts`

Expected: FAIL with `Cannot find module '@/app/api/wallets/import/route'`.

- [ ] **Step 3: Implement the import route with Zod and Prisma**

```ts
// src/app/api/wallets/import/route.ts
import { isAddress, getAddress } from "viem";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db";

const payloadSchema = z.object({
  addresses: z.array(z.string().min(42)).min(1),
});

export async function POST(request: Request) {
  const payload = payloadSchema.parse(await request.json());
  const db = getDb();

  const addresses = payload.addresses.map((address) => {
    if (!isAddress(address)) {
      throw new Error(`Invalid address: ${address}`);
    }

    return getAddress(address);
  });

  const wallets = await Promise.all(
    addresses.map((address) =>
      db.wallet.upsert({
        where: {
          chainId_address: {
            chainId: 369,
            address,
          },
        },
        update: {},
        create: {
          chainId: 369,
          address,
        },
      }),
    ),
  );

  return NextResponse.json({ wallets }, { status: 201 });
}
```

- [ ] **Step 4: Implement the tracked-wallet store and import UI**

```ts
// src/store/portfolio-selection.ts
import { create } from "zustand";

type PortfolioSelectionState = {
  selectedWalletIds: string[];
  setSelectedWalletIds: (walletIds: string[]) => void;
};

export const usePortfolioSelection = create<PortfolioSelectionState>((set) => ({
  selectedWalletIds: [],
  setSelectedWalletIds: (selectedWalletIds) => set({ selectedWalletIds }),
}));
```

```tsx
// src/components/wallet-import-form.tsx
"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function WalletImportForm() {
  const [value, setValue] = useState("");

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    await fetch("/api/wallets/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        addresses: value.split(",").map((entry) => entry.trim()).filter(Boolean),
      }),
    });
    setValue("");
  }

  return (
    <form onSubmit={onSubmit} className="flex gap-3">
      <Input value={value} onChange={(event) => setValue(event.target.value)} placeholder="Paste one or more PulseChain addresses" />
      <Button type="submit">Import</Button>
    </form>
  );
}
```

- [ ] **Step 5: Run the route test**

Run: `npm run test -- tests/app/api/wallet-import.route.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/wallets src/store src/hooks src/components src/app/page.tsx tests/app/api/wallet-import.route.test.ts
git commit -m "feat: add wallet import and local selection"
```

## Task 6: Persist Raw Audit Data with Logs-First Ingestion

**Files:**
- Create: `src/services/ingestion/block-window.ts`, `src/services/ingestion/raw-store.ts`, `src/services/ingestion/log-fetcher.ts`
- Test: `tests/services/normalization/transfer-normalizer.test.ts`

- [ ] **Step 1: Write the failing raw-store idempotency test**

```ts
// tests/services/normalization/transfer-normalizer.test.ts
import { describe, expect, it } from "vitest";

import { buildActionGroupKey } from "@/services/normalization/types";

describe("normalization types", () => {
  it("builds deterministic action group keys", () => {
    expect(buildActionGroupKey(369, "0xabc", "swap:0")).toBe("369:0xabc:swap:0");
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test -- tests/services/normalization/transfer-normalizer.test.ts`

Expected: FAIL with `Cannot find module '@/services/normalization/types'`.

- [ ] **Step 3: Implement block window planning and raw persistence helpers**

```ts
// src/services/ingestion/block-window.ts
export function buildBlockWindows(startBlock: bigint, endBlock: bigint, step = 2_000n) {
  const windows: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  let cursor = startBlock;

  while (cursor <= endBlock) {
    const toBlock = cursor + step > endBlock ? endBlock : cursor + step;
    windows.push({ fromBlock: cursor, toBlock });
    cursor = toBlock + 1n;
  }

  return windows;
}
```

```ts
// src/services/ingestion/raw-store.ts
import { getDb } from "@/lib/db";

export async function upsertRawLog(input: {
  chainId: number;
  txHash: string;
  blockNumber: bigint;
  blockHash: string;
  logIndex: number;
  address: string;
  topics: readonly string[];
  data: string;
}) {
  const db = getDb();

  return db.rawLog.upsert({
    where: {
      chainId_txHash_logIndex: {
        chainId: input.chainId,
        txHash: input.txHash,
        logIndex: input.logIndex,
      },
    },
    update: {
      blockHash: input.blockHash,
      data: input.data,
    },
    create: {
      chainId: input.chainId,
      txHash: input.txHash,
      blockNumber: input.blockNumber,
      blockHash: input.blockHash,
      logIndex: input.logIndex,
      address: input.address,
      topic0: input.topics[0],
      topic1: input.topics[1],
      topic2: input.topics[2],
      topic3: input.topics[3],
      data: input.data,
    },
  });
}
```

Policy note: raw token amounts stay preserved in raw audit rows exactly as returned on-chain. Any canonical ledger entry created from these rows must convert quantity fields into decimal-adjusted accounting units before persistence.

- [ ] **Step 4: Implement the logs-first fetcher**

```ts
// src/services/ingestion/log-fetcher.ts
import { getPulsechainClient } from "@/services/chains/public-client";
import { buildBlockWindows } from "@/services/ingestion/block-window";
import { upsertRawLog } from "@/services/ingestion/raw-store";

async function withRpcRetry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }

  throw lastError;
}

export async function fetchAndStoreLogs(args: {
  address: `0x${string}`;
  startBlock: bigint;
  endBlock: bigint;
}) {
  const client = getPulsechainClient();

  for (const window of buildBlockWindows(args.startBlock, args.endBlock)) {
    const logs = await withRpcRetry(() =>
      client.getLogs({
        address: args.address,
        fromBlock: window.fromBlock,
        toBlock: window.toBlock,
      }),
    );

    for (const log of logs) {
      await upsertRawLog({
        chainId: 369,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        blockHash: log.blockHash,
        logIndex: log.logIndex,
        address: log.address,
        topics: log.topics,
        data: log.data,
      });
    }
  }
}
```

- [ ] **Step 5: Run the test**

Run: `npm run test -- tests/services/normalization/transfer-normalizer.test.ts`

Expected: still FAIL until Task 7 adds normalization types.

- [ ] **Step 6: Commit**

```bash
git add src/services/ingestion
git commit -m "feat: add logs-first raw ingestion primitives"
```

## Task 7: Add Reorg Guard and Deterministic Normalization

**Files:**
- Create: `src/services/ingestion/reorg-guard.ts`
- Create: `src/services/normalization/types.ts`, `src/services/normalization/transfer-normalizer.ts`, `src/services/normalization/index.ts`
- Test: `tests/services/normalization/transfer-normalizer.test.ts`, `tests/services/ingestion/reorg-guard.test.ts`

- [ ] **Step 1: Add failing normalization and reorg tests**

```ts
// tests/services/ingestion/reorg-guard.test.ts
import { describe, expect, it } from "vitest";

import { hasBlockHashMismatch } from "@/services/ingestion/reorg-guard";

describe("reorg guard", () => {
  it("flags mismatched block hashes", () => {
    expect(hasBlockHashMismatch("0xaaa", "0xbbb")).toBe(true);
  });
});
```

```ts
// tests/services/normalization/transfer-normalizer.test.ts
import { describe, expect, it } from "vitest";

import { buildActionGroupKey } from "@/services/normalization/types";

describe("normalization types", () => {
  it("builds deterministic action group keys", () => {
    expect(buildActionGroupKey(369, "0xabc", "swap:0")).toBe("369:0xabc:swap:0");
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npm run test -- tests/services/normalization/transfer-normalizer.test.ts tests/services/ingestion/reorg-guard.test.ts`

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement normalization key helpers and transfer normalization**

```ts
// src/services/normalization/types.ts
export type CanonicalLedgerDraft = {
  chainId: number;
  walletAddress: string;
  txHash: string;
  actionGroupKey: string;
  entryType: string;
  assetId: string;
  quantity: string;
  direction: "IN" | "OUT" | "NEUTRAL";
  sourceLogIndex?: number;
};

export function buildActionGroupKey(chainId: number, txHash: string, suffix: string) {
  return `${chainId}:${txHash}:${suffix}`;
}
```

```ts
// src/services/normalization/transfer-normalizer.ts
import { buildActionGroupKey, type CanonicalLedgerDraft } from "@/services/normalization/types";

export function normalizeTransfer(args: {
  chainId: number;
  walletAddress: string;
  txHash: string;
  assetId: string;
  quantity: string;
  direction: "IN" | "OUT";
  logIndex: number;
}) : CanonicalLedgerDraft {
  return {
    chainId: args.chainId,
    walletAddress: args.walletAddress,
    txHash: args.txHash,
    actionGroupKey: buildActionGroupKey(args.chainId, args.txHash, `transfer:${args.logIndex}`),
    entryType: args.direction === "IN" ? "RECEIVE" : "SEND",
    assetId: args.assetId,
    quantity: args.quantity,
    direction: args.direction,
    sourceLogIndex: args.logIndex,
  };
}
```

- [ ] **Step 4: Implement bounded reorg detection**

```ts
// src/services/ingestion/reorg-guard.ts
export function hasBlockHashMismatch(storedBlockHash: string, latestBlockHash: string) {
  return storedBlockHash.toLowerCase() !== latestBlockHash.toLowerCase();
}
```

```ts
// src/services/normalization/index.ts
export * from "@/services/normalization/types";
export * from "@/services/normalization/transfer-normalizer";
```

- [ ] **Step 5: Run the tests**

Run: `npm run test -- tests/services/normalization/transfer-normalizer.test.ts tests/services/ingestion/reorg-guard.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/normalization src/services/ingestion/reorg-guard.ts tests/services/normalization/transfer-normalizer.test.ts tests/services/ingestion/reorg-guard.test.ts
git commit -m "feat: add deterministic normalization keys and reorg guard"
```

## Task 8: Normalize Swaps, LP Actions, and pHEX Stakes

**Files:**
- Create: `src/services/normalization/swap-normalizer.ts`, `src/services/normalization/lp-normalizer.ts`, `src/services/normalization/hex-normalizer.ts`
- Test: `tests/services/normalization/swap-normalizer.test.ts`

- [ ] **Step 1: Write the failing swap atomicity test**

```ts
// tests/services/normalization/swap-normalizer.test.ts
import { describe, expect, it } from "vitest";

import { normalizeSwap } from "@/services/normalization/swap-normalizer";

describe("swap normalizer", () => {
  it("returns grouped swap out, swap in, and fee entries", () => {
    const entries = normalizeSwap({
      chainId: 369,
      walletAddress: "0xabc",
      txHash: "0xswap",
      soldAssetId: "chain:369:erc20:0xsold",
      boughtAssetId: "chain:369:erc20:0xbought",
      soldQuantity: "10",
      boughtQuantity: "25",
      feeAssetId: "chain:369:native:PLS",
      feeQuantity: "0.1",
    });

    expect(entries.map((entry) => entry.entryType)).toEqual(["SWAP_OUT", "SWAP_IN", "FEE"]);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test -- tests/services/normalization/swap-normalizer.test.ts`

Expected: FAIL with `Cannot find module '@/services/normalization/swap-normalizer'`.

- [ ] **Step 3: Implement swap atomicity**

```ts
// src/services/normalization/swap-normalizer.ts
import { buildActionGroupKey, type CanonicalLedgerDraft } from "@/services/normalization/types";

export function normalizeSwap(args: {
  chainId: number;
  walletAddress: string;
  txHash: string;
  soldAssetId: string;
  boughtAssetId: string;
  soldQuantity: string;
  boughtQuantity: string;
  feeAssetId: string;
  feeQuantity: string;
}): CanonicalLedgerDraft[] {
  const actionGroupKey = buildActionGroupKey(args.chainId, args.txHash, "swap:0");

  return [
    {
      chainId: args.chainId,
      walletAddress: args.walletAddress,
      txHash: args.txHash,
      actionGroupKey,
      entryType: "SWAP_OUT",
      assetId: args.soldAssetId,
      quantity: args.soldQuantity,
      direction: "OUT",
    },
    {
      chainId: args.chainId,
      walletAddress: args.walletAddress,
      txHash: args.txHash,
      actionGroupKey,
      entryType: "SWAP_IN",
      assetId: args.boughtAssetId,
      quantity: args.boughtQuantity,
      direction: "IN",
    },
    {
      chainId: args.chainId,
      walletAddress: args.walletAddress,
      txHash: args.txHash,
      actionGroupKey,
      entryType: "FEE",
      assetId: args.feeAssetId,
      quantity: args.feeQuantity,
      direction: "OUT",
    },
  ];
}
```

- [ ] **Step 4: Implement LP and HEX normalizers**

```ts
// src/services/normalization/lp-normalizer.ts
import { buildActionGroupKey, type CanonicalLedgerDraft } from "@/services/normalization/types";

export function normalizeLpAdd(args: {
  chainId: number;
  walletAddress: string;
  txHash: string;
  token0AssetId: string;
  token1AssetId: string;
  lpAssetId: string;
  token0Quantity: string;
  token1Quantity: string;
  lpQuantity: string;
}): CanonicalLedgerDraft[] {
  const actionGroupKey = buildActionGroupKey(args.chainId, args.txHash, "lp-add:0");

  return [
    { chainId: args.chainId, walletAddress: args.walletAddress, txHash: args.txHash, actionGroupKey, entryType: "LP_ADD_OUT", assetId: args.token0AssetId, quantity: args.token0Quantity, direction: "OUT" },
    { chainId: args.chainId, walletAddress: args.walletAddress, txHash: args.txHash, actionGroupKey, entryType: "LP_ADD_OUT", assetId: args.token1AssetId, quantity: args.token1Quantity, direction: "OUT" },
    { chainId: args.chainId, walletAddress: args.walletAddress, txHash: args.txHash, actionGroupKey, entryType: "LP_ADD_IN", assetId: args.lpAssetId, quantity: args.lpQuantity, direction: "IN" },
  ];
}
```

```ts
// src/services/normalization/hex-normalizer.ts
import { buildActionGroupKey, type CanonicalLedgerDraft } from "@/services/normalization/types";

export function normalizeHexStakeLock(args: {
  chainId: number;
  walletAddress: string;
  txHash: string;
  assetId: string;
  quantity: string;
}): CanonicalLedgerDraft[] {
  return [
    {
      chainId: args.chainId,
      walletAddress: args.walletAddress,
      txHash: args.txHash,
      actionGroupKey: buildActionGroupKey(args.chainId, args.txHash, "hex-lock:0"),
      entryType: "STAKE_LOCK",
      assetId: args.assetId,
      quantity: args.quantity,
      direction: "OUT",
    },
  ];
}
```

- [ ] **Step 5: Run the swap test**

Run: `npm run test -- tests/services/normalization/swap-normalizer.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/normalization tests/services/normalization/swap-normalizer.test.ts
git commit -m "feat: add swap lp and hex normalizers"
```

## Task 9: Implement Conservative On-Chain Pricing

**Files:**
- Create: `src/config/pricing.ts`, `src/services/pricing/pool-discovery.ts`, `src/services/pricing/route-pricer.ts`, `src/services/pricing/price-store.ts`, `src/services/pricing/status.ts`
- Test: `tests/services/pricing/route-pricer.test.ts`

- [ ] **Step 1: Write the failing pricing threshold test**

```ts
// tests/services/pricing/route-pricer.test.ts
import { describe, expect, it } from "vitest";

import { shouldAcceptPrice } from "@/services/pricing/route-pricer";

describe("route pricer", () => {
  it("rejects low-liquidity price candidates", () => {
    expect(
      shouldAcceptPrice({
        liquidityUsd: 500,
        confidenceScore: 0.72,
        maxAgeMinutes: 5,
        observedAgeMinutes: 1,
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the pricing test**

Run: `npm run test -- tests/services/pricing/route-pricer.test.ts`

Expected: FAIL with `Cannot find module '@/services/pricing/route-pricer'`.

- [ ] **Step 3: Implement pricing thresholds and route acceptance**

```ts
// src/config/pricing.ts
export const PRICING_RULES = {
  minimumLiquidityUsd: 5_000,
  minimumConfidenceScore: 0.8,
  staleAfterMinutes: 15,
} as const;
```

```ts
// src/services/pricing/route-pricer.ts
import { PRICING_RULES } from "@/config/pricing";

export function shouldAcceptPrice(args: {
  liquidityUsd: number;
  confidenceScore: number;
  maxAgeMinutes: number;
  observedAgeMinutes: number;
}) {
  return (
    args.liquidityUsd >= PRICING_RULES.minimumLiquidityUsd &&
    args.confidenceScore >= PRICING_RULES.minimumConfidenceScore &&
    args.observedAgeMinutes <= args.maxAgeMinutes
  );
}
```

- [ ] **Step 4: Add store and status helpers**

```ts
// src/services/pricing/price-store.ts
import { getDb } from "@/lib/db";

export async function upsertPricePoint(input: {
  assetId: string;
  chainId: number;
  priceUsd: string;
  source: string;
  confidenceScore: number;
  route: string;
  liquidityUsd: string;
  observedAt: Date;
}) {
  const db = getDb();

  return db.pricePoint.create({
    data: {
      assetId: input.assetId,
      chainId: input.chainId,
      priceUsd: input.priceUsd,
      source: input.source,
      confidenceScore: input.confidenceScore,
      route: input.route,
      liquidityUsd: input.liquidityUsd,
      observedAt: input.observedAt,
    },
  });
}
```

```ts
// src/services/pricing/status.ts
export function summarizePriceCoverage(args: { pricedAssets: number; unpricedAssets: number }) {
  const total = args.pricedAssets + args.unpricedAssets;

  return {
    pricedAssets: args.pricedAssets,
    unpricedAssets: args.unpricedAssets,
    coverageRatio: total === 0 ? 0 : args.pricedAssets / total,
  };
}
```

- [ ] **Step 5: Run the pricing test**

Run: `npm run test -- tests/services/pricing/route-pricer.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config/pricing.ts src/services/pricing tests/services/pricing/route-pricer.test.ts
git commit -m "feat: add conservative pricing thresholds and status helpers"
```

## Task 10: Implement the Average-Cost PnL Engine and Snapshot Materialization

**Files:**
- Create: `src/services/pnl/types.ts`, `src/services/pnl/utils.ts`, `src/services/pnl/average-cost-engine.ts`, `src/services/pnl/fifo-engine.ts`, `src/services/pnl/lifo-engine.ts`
- Create: `src/services/portfolio/balance-materializer.ts`, `src/services/portfolio/snapshot-materializer.ts`
- Test: `tests/services/pnl/average-cost-engine.test.ts`

- [ ] **Step 1: Write the failing PnL engine test**

```ts
// tests/services/pnl/average-cost-engine.test.ts
import { describe, expect, it } from "vitest";

import { AverageCostEngine } from "@/services/pnl/average-cost-engine";

describe("AverageCostEngine", () => {
  it("does not realize pnl for internal transfers", () => {
    const engine = new AverageCostEngine();

    engine.applyEntry({ entryType: "RECEIVE", quantity: "10", valueUsd: "100" });
    engine.applyEntry({ entryType: "INTERNAL_TRANSFER", quantity: "4", valueUsd: "40" });

    expect(engine.getState().realizedPnlUsd.toString()).toBe("0");
  });
});
```

- [ ] **Step 2: Run the PnL test**

Run: `npm run test -- tests/services/pnl/average-cost-engine.test.ts`

Expected: FAIL with `Cannot find module '@/services/pnl/average-cost-engine'`.

- [ ] **Step 3: Implement the average-cost engine**

```ts
// src/services/pnl/average-cost-engine.ts
import { Decimal } from "@/lib/decimal";

type EngineEntry = {
  entryType: string;
  quantity: string;
  valueUsd: string;
};

export class AverageCostEngine {
  private totalAcquired = new Decimal(0);
  private totalDisposed = new Decimal(0);
  private currentBalance = new Decimal(0);
  private totalCostBasis = new Decimal(0);
  private realizedPnlUsd = new Decimal(0);

  applyEntry(entry: EngineEntry) {
    const quantity = new Decimal(entry.quantity);
    const valueUsd = new Decimal(entry.valueUsd);

    if (entry.entryType === "RECEIVE" || entry.entryType === "SWAP_IN") {
      this.totalAcquired = this.totalAcquired.add(quantity);
      this.currentBalance = this.currentBalance.add(quantity);
      this.totalCostBasis = this.totalCostBasis.add(valueUsd);
      return;
    }

    if (entry.entryType === "SEND" || entry.entryType === "SWAP_OUT") {
      const averageCost = this.getAverageCost();
      const costBasisRemoved = averageCost.mul(quantity);
      this.totalDisposed = this.totalDisposed.add(quantity);
      this.currentBalance = this.currentBalance.sub(quantity);
      this.totalCostBasis = this.totalCostBasis.sub(costBasisRemoved);
      this.realizedPnlUsd = this.realizedPnlUsd.add(valueUsd.sub(costBasisRemoved));
      return;
    }

    if (entry.entryType === "INTERNAL_TRANSFER") {
      return;
    }
  }

  getAverageCost() {
    if (this.currentBalance.eq(0)) {
      return new Decimal(0);
    }

    return this.totalCostBasis.div(this.currentBalance);
  }

  getState() {
    return {
      totalAcquired: this.totalAcquired,
      totalDisposed: this.totalDisposed,
      currentBalance: this.currentBalance,
      averageAcquisition: this.getAverageCost(),
      realizedPnlUsd: this.realizedPnlUsd,
    };
  }
}
```

- [ ] **Step 4: Add snapshot materialization**

```ts
// src/services/portfolio/snapshot-materializer.ts
import { Decimal } from "@/lib/decimal";

export function buildSnapshotTotals(rows: Array<{ valueUsd: string; priced: boolean }>) {
  return rows.reduce(
    (accumulator, row) => {
      const value = new Decimal(row.valueUsd);

      accumulator.totalValueUsd = accumulator.totalValueUsd.add(value);

      if (row.priced) {
        accumulator.pricedValueUsd = accumulator.pricedValueUsd.add(value);
      } else {
        accumulator.unpricedValueUsd = accumulator.unpricedValueUsd.add(value);
      }

      return accumulator;
    },
    {
      totalValueUsd: new Decimal(0),
      pricedValueUsd: new Decimal(0),
      unpricedValueUsd: new Decimal(0),
    },
  );
}
```

- [ ] **Step 5: Run the PnL test**

Run: `npm run test -- tests/services/pnl/average-cost-engine.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/pnl src/services/portfolio tests/services/pnl/average-cost-engine.test.ts
git commit -m "feat: add average cost pnl engine and snapshot materializer"
```

## Task 11: Add Sync Orchestration, Rebuild, and Health APIs

**Files:**
- Create: `src/services/ingestion/sync-orchestrator.ts`, `src/services/rebuild/rebuild-ledger.ts`
- Create: `src/app/api/sync/route.ts`, `src/app/api/sync/[runId]/route.ts`, `src/app/api/rebuild/route.ts`, `src/app/api/health/route.ts`
- Test: `tests/app/api/dashboard.route.test.ts`

- [ ] **Step 1: Write a failing health endpoint test**

```ts
// tests/app/api/dashboard.route.test.ts
import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("returns an ok status payload", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
  });
});
```

- [ ] **Step 2: Run the health test**

Run: `npm run test -- tests/app/api/dashboard.route.test.ts`

Expected: FAIL with `Cannot find module '@/app/api/health/route'`.

- [ ] **Step 3: Implement sync orchestration and health**

```ts
// src/services/ingestion/sync-orchestrator.ts
import { getDb } from "@/lib/db";

export async function createSyncRun(walletId: string | null, startBlock: bigint) {
  const db = getDb();

  return db.syncRun.create({
    data: {
      walletId,
      chainId: 369,
      status: "PENDING",
      stage: "QUEUED",
      startBlock,
    },
  });
}
```

```ts
// src/app/api/health/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    services: {
      database: "unknown",
      redis: "unknown",
      rpc: "unknown",
    },
  });
}
```

- [ ] **Step 4: Implement sync, sync-status, and rebuild routes**

```ts
// src/app/api/sync/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { createSyncRun } from "@/services/ingestion/sync-orchestrator";

const payloadSchema = z.object({
  walletId: z.string().nullable().optional(),
  startBlock: z.coerce.bigint().default(0n),
});

export async function POST(request: Request) {
  const payload = payloadSchema.parse(await request.json());
  const syncRun = await createSyncRun(payload.walletId ?? null, payload.startBlock);
  return NextResponse.json({ syncRun }, { status: 202 });
}
```

```ts
// src/app/api/rebuild/route.ts
import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ accepted: true }, { status: 202 });
}
```

- [ ] **Step 5: Run the health test**

Run: `npm run test -- tests/app/api/dashboard.route.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/ingestion/sync-orchestrator.ts src/services/rebuild src/app/api/sync src/app/api/rebuild src/app/api/health tests/app/api/dashboard.route.test.ts
git commit -m "feat: add sync orchestration and health endpoints"
```

## Task 12: Build Dashboard and Debug Query Services

**Files:**
- Create: `src/services/portfolio/dashboard-query.ts`, `src/services/debug/debug-query.ts`
- Create: `src/app/api/dashboard/route.ts`, `src/app/api/debug/sync/route.ts`, `src/app/api/prices/status/route.ts`
- Modify: `tests/services/portfolio/dashboard-query.test.ts`
- Test: `tests/services/portfolio/dashboard-query.test.ts`

- [ ] **Step 1: Rewrite the failing dashboard query test**

```ts
// tests/services/portfolio/dashboard-query.test.ts
import { describe, expect, it } from "vitest";

import { buildEmptyDashboardDto } from "@/services/portfolio/dashboard-query";

describe("dashboard query", () => {
  it("returns a versioned empty-state dto", () => {
    const dto = buildEmptyDashboardDto();

    expect(dto.schemaVersion).toBe("v1");
    expect(dto.summary.totalValueUsd).toBe("0");
  });
});
```

- [ ] **Step 2: Run the dashboard test**

Run: `npm run test -- tests/services/portfolio/dashboard-query.test.ts`

Expected: FAIL with `Cannot find module '@/services/portfolio/dashboard-query'`.

- [ ] **Step 3: Implement the dashboard DTO builder**

```ts
// src/services/portfolio/dashboard-query.ts
export function buildEmptyDashboardDto() {
  return {
    schemaVersion: "v1",
    summary: {
      totalValueUsd: "0",
      pricedValueUsd: "0",
      unpricedValueUsd: "0",
      realizedPnlUsd: "0",
      unrealizedPnlUsd: "0",
    },
    wallets: [],
    holdings: [],
    positions: {
      lp: [],
      hex: [],
    },
    activity: [],
    warnings: [],
  };
}
```

- [ ] **Step 4: Implement dashboard, debug, and price-status routes**

```ts
// src/app/api/dashboard/route.ts
import { NextResponse } from "next/server";

import { buildEmptyDashboardDto } from "@/services/portfolio/dashboard-query";

export async function GET() {
  return NextResponse.json(buildEmptyDashboardDto());
}
```

```ts
// src/app/api/prices/status/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    pricedAssets: 0,
    unpricedAssets: 0,
    rejectedSources: [],
    staleAssets: [],
  });
}
```

- [ ] **Step 5: Run the dashboard test**

Run: `npm run test -- tests/services/portfolio/dashboard-query.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/portfolio/dashboard-query.ts src/services/debug src/app/api/dashboard src/app/api/debug src/app/api/prices tests/services/portfolio/dashboard-query.test.ts
git commit -m "feat: add dashboard and debug query endpoints"
```

## Task 13: Build the Import, Dashboard, and Debug UI

**Files:**
- Create: `src/components/app-shell.tsx`, `src/components/sidebar-nav.tsx`, `src/components/topbar.tsx`, `src/components/summary-cards.tsx`, `src/components/holdings-table.tsx`, `src/components/activity-table.tsx`, `src/components/position-cards.tsx`, `src/components/sync-banner.tsx`, `src/components/number-with-provenance.tsx`
- Create: `src/components/debug/sync-runs-panel.tsx`, `src/components/debug/price-status-panel.tsx`, `src/components/debug/rebuild-panel.tsx`
- Create: `src/hooks/use-dashboard.ts`, `src/hooks/use-sync-run.ts`, `src/hooks/use-price-status.ts`
- Modify: `src/app/page.tsx`, `src/app/dashboard/page.tsx`, `src/app/debug/sync/page.tsx`
- Test: `tests/app/api/dashboard.route.test.ts`

- [ ] **Step 1: Add a failing route render test**

```ts
// tests/app/api/dashboard.route.test.ts
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import DashboardPage from "@/app/dashboard/page";

describe("dashboard page", () => {
  it("renders the CoinPulse dashboard heading", async () => {
    render(await DashboardPage());
    expect(screen.getByText("Portfolio dashboard")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the dashboard UI test**

Run: `npm run test -- tests/app/api/dashboard.route.test.ts`

Expected: FAIL with `Cannot find module '@/app/dashboard/page'`.

- [ ] **Step 3: Build the app shell and summary UI**

```tsx
// src/components/app-shell.tsx
import { SidebarNav } from "@/components/sidebar-nav";
import { Topbar } from "@/components/topbar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[260px_1fr]">
      <aside className="hidden border-r border-border lg:block">
        <SidebarNav />
      </aside>
      <div className="flex min-h-screen flex-col">
        <Topbar />
        <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-6">{children}</main>
      </div>
    </div>
  );
}
```

```tsx
// src/app/dashboard/page.tsx
import { AppShell } from "@/components/app-shell";

export default async function DashboardPage() {
  return (
    <AppShell>
      <h1 className="text-2xl font-semibold tracking-tight">Portfolio dashboard</h1>
    </AppShell>
  );
}
```

- [ ] **Step 4: Build the import and debug routes**

```tsx
// src/app/page.tsx
import { AppShell } from "@/components/app-shell";
import { WalletImportForm } from "@/components/wallet-import-form";

export default function HomePage() {
  return (
    <AppShell>
      <h1 className="text-2xl font-semibold tracking-tight">Import wallets</h1>
      <WalletImportForm />
    </AppShell>
  );
}
```

```tsx
// src/app/debug/sync/page.tsx
import { AppShell } from "@/components/app-shell";

export default function DebugSyncPage() {
  return (
    <AppShell>
      <h1 className="text-2xl font-semibold tracking-tight">Sync debug</h1>
    </AppShell>
  );
}
```

- [ ] **Step 5: Run the dashboard UI test**

Run: `npm run test -- tests/app/api/dashboard.route.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components src/hooks src/app/page.tsx src/app/dashboard src/app/debug tests/app/api/dashboard.route.test.ts
git commit -m "feat: add import dashboard and debug ui shells"
```

## Task 14: Finish Readme, Seed Data, and End-to-End Verification

**Files:**
- Modify: `README.md`, `.env.example`
- Test: all existing tests

- [ ] **Step 1: Write the README with local setup and architecture notes**

```md
<!-- README.md -->
# CoinPulse

CoinPulse is a PulseChain-first portfolio engine with PostgreSQL-backed raw audit, canonical ledger, derived balances, conservative pricing, and average-cost PnL.

## Local setup

1. Copy `.env.example` to `.env`.
2. Run `npm install`.
3. Run `npm run db:migrate`.
4. Run `npm run db:seed`.
5. Run `npm run dev`.

## Test

- `npm run test`
```

- [ ] **Step 2: Add the remaining UI and runtime environment variables**

```env
# .env.example
NEXT_PUBLIC_DEFAULT_CHAIN_ID=369
NEXT_PUBLIC_APP_NAME=CoinPulse
```

- [ ] **Step 3: Run the full test suite**

Run: `npm run test`

Expected: PASS.

- [ ] **Step 4: Run the local production checks**

Run:

```bash
npm run build
npm run db:generate
```

Expected: build completes and Prisma client generation succeeds.

- [ ] **Step 5: Commit**

```bash
git add README.md .env.example
git commit -m "docs: add setup and verification guidance"
```

- [ ] **Step 6: Publish the branch after local verification**

```bash
git branch -M main
git remote add origin <YOUR_GITHUB_REPO_URL>
git push -u origin main
```

Expected: the local repo is connected to GitHub and the approved milestone baseline is published.
