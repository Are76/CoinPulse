import "server-only";

import { getDb } from "@/lib/db";

export type MaterializationProvenanceInput = {
  sourceLedgerFromBlock?: bigint | null;
  sourceLedgerToBlock?: bigint | null;
  sourceLedgerCoverageExact?: boolean;
  updatedFromBlock?: bigint | null;
  updatedToBlock?: bigint | null;
};

export type MaterializationStateClient = {
  portfolioMaterializationState?: {
    upsert(args: {
      where: { walletId_chainId: { walletId: string; chainId: number } };
      create: {
        walletId: string;
        chainId: number;
        status: "RUNNING" | "FAILED" | "COMPLETED";
        completedSuccessfully: boolean;
        lastAttemptedAt: Date;
        latestMaterializedAt?: Date | null;
        sourceLedgerFromBlock?: bigint | null;
        sourceLedgerToBlock?: bigint | null;
        updatedFromBlock?: bigint | null;
        updatedToBlock?: bigint | null;
        warningCount: number;
        warningDetails: string[];
        errorMessage?: string | null;
      };
      update: {
        status: "RUNNING" | "FAILED" | "COMPLETED";
        completedSuccessfully: boolean;
        lastAttemptedAt: Date;
        latestMaterializedAt?: Date | null;
        sourceLedgerFromBlock?: bigint | null;
        sourceLedgerToBlock?: bigint | null;
        updatedFromBlock?: bigint | null;
        updatedToBlock?: bigint | null;
        warningCount: number;
        warningDetails: string[];
        errorMessage?: string | null;
      };
    }): Promise<unknown>;
  };
};

export async function persistMaterializationState(args: {
  wallet: { id: string; chainId: number };
  provenance?: MaterializationProvenanceInput;
  status: "RUNNING" | "FAILED" | "COMPLETED";
  completedSuccessfully: boolean;
  attemptedAt?: Date;
  latestMaterializedAt?: Date | null;
  warnings: string[];
  errorMessage?: string | null;
  db?: MaterializationStateClient;
}) {
  const db = args.db ?? (getDb() as unknown as MaterializationStateClient);
  const attemptedAt = args.attemptedAt ?? new Date();
  if (!db.portfolioMaterializationState) {
    throw new Error("materialization provenance persistence is unavailable");
  }
  const sourceLedgerCoverage =
    args.status === "COMPLETED" && args.provenance?.sourceLedgerCoverageExact
      ? {
          sourceLedgerFromBlock: args.provenance?.sourceLedgerFromBlock ?? null,
          sourceLedgerToBlock: args.provenance?.sourceLedgerToBlock ?? null,
        }
      : {};
  const sourceLedgerCoverageForCreate =
    args.status === "COMPLETED" && args.provenance?.sourceLedgerCoverageExact
      ? {
          sourceLedgerFromBlock: args.provenance?.sourceLedgerFromBlock ?? null,
          sourceLedgerToBlock: args.provenance?.sourceLedgerToBlock ?? null,
        }
      : {
          sourceLedgerFromBlock: null,
          sourceLedgerToBlock: null,
        };
  const updatedCoverage =
    args.status === "COMPLETED"
      ? {
          updatedFromBlock: args.provenance?.updatedFromBlock ?? null,
          updatedToBlock: args.provenance?.updatedToBlock ?? null,
        }
      : {};
  const updatedCoverageForCreate =
    args.status === "COMPLETED"
      ? {
          updatedFromBlock: args.provenance?.updatedFromBlock ?? null,
          updatedToBlock: args.provenance?.updatedToBlock ?? null,
        }
      : {
          updatedFromBlock: null,
          updatedToBlock: null,
        };

  await db.portfolioMaterializationState.upsert({
    where: {
      walletId_chainId: {
        walletId: args.wallet.id,
        chainId: args.wallet.chainId,
      },
    },
    create: {
      walletId: args.wallet.id,
      chainId: args.wallet.chainId,
      status: args.status,
      completedSuccessfully: args.completedSuccessfully,
      lastAttemptedAt: attemptedAt,
      latestMaterializedAt: args.latestMaterializedAt ?? null,
      ...sourceLedgerCoverageForCreate,
      ...updatedCoverageForCreate,
      warningCount: args.warnings.length,
      warningDetails: [...args.warnings],
      errorMessage: args.errorMessage ?? null,
    },
    update: {
      status: args.status,
      completedSuccessfully: args.completedSuccessfully,
      lastAttemptedAt: attemptedAt,
      ...(args.latestMaterializedAt !== undefined
        ? { latestMaterializedAt: args.latestMaterializedAt }
        : {}),
      ...sourceLedgerCoverage,
      ...updatedCoverage,
      warningCount: args.warnings.length,
      warningDetails: [...args.warnings],
      errorMessage: args.errorMessage ?? null,
    },
  });
}
