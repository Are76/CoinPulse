"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useEffect, useRef, useState } from "react";

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
  MaterializationIntegritySection,
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
import {
  buildWalletNavHref,
  parseWalletNavContext,
} from "@/lib/navigation/wallet-query-params";
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
  // useSearchParams requires a Suspense boundary for static rendering — same
  // pattern as app/transactions/page.tsx, kept inside the screen module.
  return (
    <Suspense>
      <DashboardScreenContent />
    </Suspense>
  );
}

function DashboardScreenContent() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // URL navigation context (draft-state input only — never enables a query).
  // Invalid or partial params yield null and fall back to form defaults.
  const urlWalletContext = parseWalletNavContext(searchParams);
  const urlWallet = urlWalletContext?.walletAddress ?? null;
  const urlChainId = urlWalletContext?.chainId ?? null;
  const urlContextKey = urlWallet !== null && urlChainId !== null ? `${urlWallet}|${urlChainId}` : null;

  const [walletAddress, setWalletAddress] = useState(urlWallet ?? "");
  const [chainId, setChainId] = useState(
    urlChainId !== null ? String(urlChainId) : DEFAULT_CHAIN_ID,
  );
  const [submittedParams, setSubmittedParams] = useState<SubmittedParams | null>(null);
  const [submittedWalletSource, setSubmittedWalletSource] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [hasInteracted, setHasInteracted] = useState(false);

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

  // Synchronize draft fields when the URL navigation context changes while
  // mounted (e.g. browser back/forward). Keyed on the applied context so it
  // never loops and never overwrites in-progress typing without a real
  // search-param change. Submitted state is untouched — no auto-submit.
  const appliedUrlContextKeyRef = useRef<string | null>(urlContextKey);
  useEffect(() => {
    if (urlWallet === null || urlChainId === null) return;
    const key = `${urlWallet}|${urlChainId}`;
    if (appliedUrlContextKeyRef.current === key) return;
    appliedUrlContextKeyRef.current = key;
    setWalletAddress(urlWallet);
    setChainId(String(urlChainId));
  }, [urlWallet, urlChainId]);

  // Auto-load first tracked wallet on initial page view, but not after the user
  // has started editing the form — hasInteracted guards against overwriting
  // in-progress manual input with wallets[0]. A valid URL wallet context also
  // suppresses the auto-load so it cannot overwrite the URL-derived draft.
  const autoLoadedRef = useRef(false);
  useEffect(() => {
    if (autoLoadedRef.current || hasInteracted || submittedParams !== null) return;
    if (urlContextKey !== null) return;
    if (!trackedWalletsQuery.isSuccess) return;
    const wallets = trackedWalletsQuery.data?.wallets ?? [];
    if (wallets.length === 0) return;
    autoLoadedRef.current = true;
    const first = wallets[0];
    const params: SubmittedParams = { walletAddress: first.address.toLowerCase(), chainId: first.chainId };
    setValidationError(null);
    setWalletAddress(first.address);
    setChainId(String(first.chainId));
    setSubmittedParams(params);
    setSubmittedWalletSource(resolveSubmittedWalletSource(params, wallets));
  }, [hasInteracted, trackedWalletsQuery.isSuccess, trackedWalletsQuery.data, submittedParams, urlContextKey]);

  function handleSelectTrackedWallet(address: string, selectedChainId: string) {
    setHasInteracted(true);
    setWalletAddress(address);
    setChainId(selectedChainId);
  }

  function handleWalletAddressChange(value: string) {
    setHasInteracted(true);
    setWalletAddress(value);
  }

  function handleChainIdChange(value: string) {
    setHasInteracted(true);
    setChainId(value);
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

    // Reflect the validated submission in the URL (navigation context only).
    // Called once per explicit submit — never on keystrokes or tracked-wallet
    // selection. The applied-context ref is pre-set so the sync effect does
    // not re-apply the same values over subsequent edits.
    appliedUrlContextKeyRef.current = `${params.walletAddress}|${params.chainId}`;
    router.replace(
      buildWalletNavHref(pathname ?? "/", {
        walletAddress: params.walletAddress,
        chainId: params.chainId,
      }),
      { scroll: false },
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
        onWalletAddressChange={handleWalletAddressChange}
        onChainIdChange={handleChainIdChange}
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
          <MaterializationIntegritySection
            materialization={dashboardQuery.data.materialization}
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
