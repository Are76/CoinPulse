"use client";

import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";

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
  getDashboardErrorMessage,
  getDashboardMetaErrorMessage,
  resolveDashboardSubmission,
  resolveSubmittedWalletSource,
  findTrackedWalletLabel,
  type SubmittedParams,
} from "@/components/dashboard/dashboard-screen-helpers";
import { queryKeys } from "@/lib/query/query-keys";
import { useDashboardQuery } from "@/lib/query/use-dashboard-query";
import { useDebugHealthQuery } from "@/lib/query/use-debug-health-query";
import { useDebugStatusQuery } from "@/lib/query/use-debug-status-query";
import { useTrackedWalletsQuery } from "@/lib/query/use-tracked-wallets-query";

const DEFAULT_CHAIN_ID = "369";
const DEFAULT_QUOTE_ASSET = "fiat:usd";
const DASHBOARD_SCHEMA_VERSION = "v1" as const;
const DISABLE_REFETCH_INTERVAL = false as const;

export function DashboardScreen() {
  const queryClient = useQueryClient();
  const [walletAddress, setWalletAddress] = useState("");
  const [chainId, setChainId] = useState(DEFAULT_CHAIN_ID);
  const [submittedParams, setSubmittedParams] = useState<SubmittedParams | null>(null);
  const [submittedWalletSource, setSubmittedWalletSource] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const trackedWalletsQuery = useTrackedWalletsQuery();

  const healthQuery = useDebugHealthQuery({ refetchInterval: DISABLE_REFETCH_INTERVAL });
  const statusQuery = useDebugStatusQuery({ refetchInterval: DISABLE_REFETCH_INTERVAL });

  const dashboardQuery = useDashboardQuery({
    walletAddress: submittedParams?.walletAddress ?? "",
    chainId: submittedParams?.chainId ?? 0,
    quoteAsset: DEFAULT_QUOTE_ASSET,
    enabled: submittedParams !== null,
  });

  const trackedWallets = trackedWalletsQuery.data?.wallets;
  const hasHealthyTrackedWallets = trackedWalletsQuery.isSuccess;
  const selectedTrackedWalletLabel = hasHealthyTrackedWallets
    ? findTrackedWalletLabel(
        trackedWallets,
        walletAddress,
        chainId,
      )
    : null;

  // Auto-load first tracked wallet on initial page view
  const autoLoadedRef = useRef(false);
  useEffect(() => {
    if (autoLoadedRef.current || submittedParams !== null) return;
    if (!trackedWalletsQuery.isSuccess) return;
    const wallets = trackedWalletsQuery.data?.wallets ?? [];
    if (wallets.length === 0) return;
    autoLoadedRef.current = true;
    const first = wallets[0];
    const params: SubmittedParams = { walletAddress: first.address.toLowerCase(), chainId: first.chainId };
    setWalletAddress(first.address);
    setChainId(String(first.chainId));
    setSubmittedParams(params);
    setSubmittedWalletSource(resolveSubmittedWalletSource(params, wallets));
  }, [trackedWalletsQuery.isSuccess, trackedWalletsQuery.data, submittedParams]);

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
      setSubmittedWalletSource(null);
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
    setSubmittedWalletSource(
      resolveSubmittedWalletSource(
        params,
        hasHealthyTrackedWallets ? trackedWallets : undefined,
      ),
    );
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
