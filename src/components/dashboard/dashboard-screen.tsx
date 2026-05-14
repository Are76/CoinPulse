"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import { PageContainer } from "@/components/ui/page-container";
import {
  BackendStatusPanel,
  DashboardHero,
  ErrorStateCard,
  IdleStateCard,
  LedgerCoverageSection,
  LoadingStateCard,
  LpPositionsTable,
  MaterializationFreshnessSection,
  PnlCoverageSection,
  PortfolioSummarySection,
  StakePositionsTable,
  SubmittedWalletSourceIndicator,
  TokenPositionsTable,
  TrackedWalletSelector,
  WalletQueryForm,
} from "@/components/dashboard/dashboard-presenters";
import {
  fetchDebugHealth,
  fetchDebugStatus,
} from "@/lib/api/dashboard-client";
import {
  getDashboardErrorMessage,
  getDashboardMetaErrorMessage,
  resolveDashboardSubmission,
  resolveSubmittedWalletSource,
  findTrackedWalletLabel,
  type SubmittedParams,
} from "@/components/dashboard/dashboard-screen-helpers";
import { queryKeys } from "@/lib/query/query-keys";
import { useDashboardQuery } from "@/lib/query/use-dashboard-query";
import { useTrackedWalletsQuery } from "@/lib/query/use-tracked-wallets-query";

const DEFAULT_CHAIN_ID = "369";
const DEFAULT_QUOTE_ASSET = "fiat:usd";
const DASHBOARD_SCHEMA_VERSION = "v1" as const;

export function DashboardScreen() {
  const queryClient = useQueryClient();
  const [walletAddress, setWalletAddress] = useState("");
  const [chainId, setChainId] = useState(DEFAULT_CHAIN_ID);
  const [submittedParams, setSubmittedParams] = useState<SubmittedParams | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const trackedWalletsQuery = useTrackedWalletsQuery();

  const healthQuery = useQuery({
    queryKey: queryKeys.debug.health(),
    queryFn: fetchDebugHealth,
    retry: false,
    staleTime: 15_000,
    gcTime: 5 * 60_000,
  });

  const statusQuery = useQuery({
    queryKey: queryKeys.debug.status(),
    queryFn: fetchDebugStatus,
    retry: false,
    staleTime: 10_000,
    gcTime: 5 * 60_000,
  });

  const dashboardQuery = useDashboardQuery({
    walletAddress: submittedParams?.walletAddress ?? "",
    chainId: submittedParams?.chainId ?? 0,
    quoteAsset: DEFAULT_QUOTE_ASSET,
    enabled: submittedParams !== null,
  });

  const trackedWallets = trackedWalletsQuery.data?.wallets;
  const selectedTrackedWalletLabel = findTrackedWalletLabel(
    trackedWallets,
    walletAddress,
    chainId,
  );
  const submittedWalletSource = resolveSubmittedWalletSource(
    submittedParams,
    trackedWallets,
  );

  function handleSelectTrackedWallet(address: string, selectedChainId: string) {
    setWalletAddress(address);
    setChainId(selectedChainId);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submission = resolveDashboardSubmission({
      walletAddress,
      chainId,
    });
    if (submission.validationError !== null) {
      setValidationError(submission.validationError);
      setSubmittedParams(null);
      return;
    }

    setValidationError(null);
    const params: SubmittedParams = submission.submittedParams;

    // Remove any cached data for this key so the loading state is always shown
    // on an explicit submit, preserving the original always-shows-loading behavior.
    queryClient.removeQueries({
      queryKey: queryKeys.dashboard({
        schemaVersion: DASHBOARD_SCHEMA_VERSION,
        chainId: params.chainId,
        walletAddress: params.walletAddress,
        quoteAsset: DEFAULT_QUOTE_ASSET,
      }),
    });

    setSubmittedParams(params);
  }

  const health = healthQuery.data ?? null;
  const debugStatus = statusQuery.data ?? null;
  const metaError = getDashboardMetaErrorMessage({
    healthError: healthQuery.isError ? healthQuery.error : null,
    statusError: statusQuery.isError ? statusQuery.error : null,
  });

  const isIdle = submittedParams === null && validationError === null;
  const errorMessage =
    validationError ??
    (dashboardQuery.isError ? getDashboardErrorMessage(dashboardQuery.error) : null);

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

      <TrackedWalletSelector
        wallets={trackedWalletsQuery.data?.wallets}
        isLoading={trackedWalletsQuery.isPending}
        isError={trackedWalletsQuery.isError}
        onSelectWallet={handleSelectTrackedWallet}
        selectedWalletAddress={walletAddress}
        selectedChainId={chainId}
      />

      <WalletQueryForm
        walletAddress={walletAddress}
        chainId={chainId}
        isLoading={submittedParams !== null && dashboardQuery.isFetching}
        selectedTrackedWalletLabel={selectedTrackedWalletLabel}
        onWalletAddressChange={setWalletAddress}
        onChainIdChange={setChainId}
        onSubmit={handleSubmit}
      />

      {isIdle ? <IdleStateCard /> : null}
      <SubmittedWalletSourceIndicator source={submittedWalletSource} />
      {errorMessage !== null ? <ErrorStateCard message={errorMessage} /> : null}
      {submittedParams !== null && dashboardQuery.isLoading ? <LoadingStateCard /> : null}

      {dashboardQuery.data !== undefined ? (
        <>
          <PortfolioSummarySection dashboard={dashboardQuery.data} />
          <MaterializationFreshnessSection
            freshness={dashboardQuery.data.materialization.freshness}
          />
          <LedgerCoverageSection
            ledgerCoverage={dashboardQuery.data.ledgerCoverage}
          />
          <PnlCoverageSection
            pnlCoverage={dashboardQuery.data.pnlCoverage}
          />
          <TokenPositionsTable positions={dashboardQuery.data.tokenPositions} />
          <LpPositionsTable positions={dashboardQuery.data.lpPositions} />
          <StakePositionsTable positions={dashboardQuery.data.stakePositions} />
        </>
      ) : null}
    </PageContainer>
  );
}
