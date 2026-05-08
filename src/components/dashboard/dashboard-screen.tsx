"use client";

import { useEffect, useState, type FormEvent } from "react";

import { PageContainer } from "@/components/ui/page-container";
import {
  BackendStatusPanel,
  DashboardHero,
  ErrorStateCard,
  IdleStateCard,
  LoadingStateCard,
  LpPositionsTable,
  PortfolioSummarySection,
  StakePositionsTable,
  TokenPositionsTable,
  WalletQueryForm,
} from "@/components/dashboard/dashboard-presenters";
import {
  ApiClientError,
  fetchDebugHealth,
  fetchDebugStatus,
  fetchPortfolioDashboard,
  type DebugStatusReportDto,
  type HealthReportDto,
} from "@/lib/api/dashboard-client";
import type { PortfolioDashboardDto } from "@/services/dashboard/types";

type DashboardState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; data: PortfolioDashboardDto }
  | { kind: "error"; message: string };

const DEFAULT_CHAIN_ID = "369";
const DEFAULT_QUOTE_ASSET = "fiat:usd";

export function DashboardScreen() {
  const [walletAddress, setWalletAddress] = useState("");
  const [chainId, setChainId] = useState(DEFAULT_CHAIN_ID);
  const [dashboardState, setDashboardState] = useState<DashboardState>({
    kind: "idle",
  });
  const [health, setHealth] = useState<HealthReportDto | null>(null);
  const [debugStatus, setDebugStatus] = useState<DebugStatusReportDto | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadMetaReports() {
      try {
        const [healthReport, statusReport] = await Promise.all([
          fetchDebugHealth(),
          fetchDebugStatus(),
        ]);

        if (!active) {
          return;
        }

        setHealth(healthReport);
        setDebugStatus(statusReport);
      } catch (error) {
        if (!active) {
          return;
        }

        setMetaError(getErrorMessage(error));
      }
    }

    void loadMetaReports();

    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDashboardState({ kind: "loading" });

    const parsedChainId = Number(chainId);
    if (!Number.isInteger(parsedChainId) || parsedChainId <= 0) {
      setDashboardState({
        kind: "error",
        message: "Chain ID must be a positive integer.",
      });
      return;
    }

    try {
      const dashboard = await fetchPortfolioDashboard({
        walletAddress: walletAddress.trim(),
        chainId: parsedChainId,
        quoteAsset: DEFAULT_QUOTE_ASSET,
      });

      setDashboardState({ kind: "ready", data: dashboard });
    } catch (error) {
      setDashboardState({
        kind: "error",
        message: getErrorMessage(error),
      });
    }
  }

  return (
    <PageContainer className="flex flex-col gap-6">
      <DashboardHero
        backendStatusLabel={health ? `backend ${health.status}` : "backend loading"}
        backendStatusTone={health?.status === "ok" ? "fresh" : "warn"}
        pricingStatusLabel={debugStatus ? "pricing persisted only" : "status loading"}
      />

      <BackendStatusPanel
        databaseStatus={health?.dependencies.database.status ?? "loading"}
        redisStatus={health?.dependencies.redis.status ?? "loading"}
        sourceFamilies={debugStatus?.sourceFamilies.join(", ") ?? "loading"}
        metaError={metaError}
      />

      <WalletQueryForm
        walletAddress={walletAddress}
        chainId={chainId}
        isLoading={dashboardState.kind === "loading"}
        onWalletAddressChange={setWalletAddress}
        onChainIdChange={setChainId}
        onSubmit={handleSubmit}
      />

      {dashboardState.kind === "idle" ? <IdleStateCard /> : null}
      {dashboardState.kind === "error" ? (
        <ErrorStateCard message={dashboardState.message} />
      ) : null}
      {dashboardState.kind === "loading" ? <LoadingStateCard /> : null}

      {dashboardState.kind === "ready" ? (
        <>
          <PortfolioSummarySection dashboard={dashboardState.data} />
          <TokenPositionsTable positions={dashboardState.data.tokenPositions} />
          <LpPositionsTable positions={dashboardState.data.lpPositions} />
          <StakePositionsTable positions={dashboardState.data.stakePositions} />
        </>
      ) : null}
    </PageContainer>
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown frontend error.";
}
