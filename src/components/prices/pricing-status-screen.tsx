"use client";

import type { ReactNode } from "react";

import { OperatorToolsNav } from "@/components/debug/operator-tools-nav";
import { EmptyState } from "@/components/ui/data-state/empty-state";
import { ErrorState } from "@/components/ui/data-state/error-state";
import { LoadingState } from "@/components/ui/data-state/loading-state";
import { PageContainer } from "@/components/ui/page-container";
import { SectionCard } from "@/components/ui/section-card";
import {
  LabelBadge,
  type BadgeTone,
} from "@/components/ui/status/status-badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { TimestampLabel } from "@/components/ui/value/timestamp-label";
import type {
  PricingStatusDto,
  PricingStatusSourceDto,
} from "@/lib/api/prices-client";
import { usePricingStatusQuery } from "@/lib/query/use-pricing-status-query";

export function PricingStatusScreen() {
  const { data, error, isPending } = usePricingStatusQuery();

  return (
    <PageContainer className="flex flex-col gap-6">
      <SurfaceCard className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-muted)]">
              CoinPulse
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              Pricing status
            </h1>
            <p className="mt-3 max-w-3xl leading-7 text-[color:var(--color-text-muted)]">
              Operator-facing view of backend pricing source health.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <LabelBadge
              label={
                data
                  ? `overall ${data.status}`
                  : error
                    ? "pricing error"
                    : "pricing loading"
              }
              tone={
                data
                  ? getStatusTone(data.status)
                  : error
                    ? "danger"
                    : "warn"
              }
            />
            {data ? (
              <LabelBadge
                label={`${data.sources.length} source${data.sources.length === 1 ? "" : "s"}`}
                tone="neutral"
              />
            ) : null}
          </div>
        </div>
      </SurfaceCard>

      <OperatorToolsNav />

      {isPending ? (
        <SectionCard
          title="Loading pricing status"
          subtitle="Fetching backend pricing source health."
        >
          <LoadingState blocks={3} className="grid gap-4 md:grid-cols-3" />
        </SectionCard>
      ) : null}

      {error ? (
        <ErrorState
          title="Failed to load pricing status"
          message={error instanceof Error ? error.message : "Unknown error."}
        />
      ) : null}

      {data ? (
        <>
          <SectionCard
            title="Overview"
            subtitle="Backend-owned pricing status fields rendered without frontend health inference."
          >
            <div className="mt-2 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SummaryValue label="Schema version" value={data.schemaVersion} />
              <SummaryValue label="Overall status">
                <LabelBadge
                  label={data.status}
                  tone={getStatusTone(data.status)}
                />
              </SummaryValue>
              <SummaryValue label="As of">
                <TimestampLabel value={data.asOf} />
              </SummaryValue>
              <SummaryValue
                label="Source count"
                value={`${data.sources.length}`}
              />
            </div>
          </SectionCard>

          {data.sources.length === 0 ? (
            <EmptyState
              title="No pricing sources"
              message="Pricing source status will appear after backend pricing observations exist."
            />
          ) : (
            <SectionCard
              title="Sources"
              subtitle={`Schema version: ${data.schemaVersion} · ${data.sources.length} source${data.sources.length === 1 ? "" : "s"} reported by the backend.`}
            >
              <div className="flex flex-col gap-4">
                {data.sources.map((source) => (
                  <PricingSourceRow key={source.sourceType} source={source} />
                ))}
              </div>
            </SectionCard>
          )}
        </>
      ) : null}
    </PageContainer>
  );
}

function PricingSourceRow({ source }: { source: PricingStatusSourceDto }) {
  return (
    <SurfaceCard className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <LabelBadge label={source.sourceType} tone="neutral" />
          <LabelBadge
            label={source.status}
            tone={getStatusTone(source.status)}
          />
        </div>
        <TimestampLabel
          label="Latest observed:"
          value={source.latestObservedAt}
          fallback="Not observed"
        />
      </div>

      <dl className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricValue
          label="Stale after (s)"
          value={
            source.staleAfterSeconds === null
              ? "Not provided"
              : String(source.staleAfterSeconds)
          }
        />
        <MetricValue
          label="Observations"
          value={String(source.observationsCount)}
        />
        <MetricValue
          label="Rejected"
          value={String(source.rejectedCount)}
        />
        <MetricValue
          label="Reason"
          value={source.reason ?? "Not provided"}
        />
        <MetricValue label="Latest observed at">
          <TimestampLabel
            value={source.latestObservedAt}
            fallback="Not provided"
          />
        </MetricValue>
      </dl>
    </SurfaceCard>
  );
}

function SummaryValue({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-[color:var(--color-border-soft)] bg-[color:var(--color-surface-2)] px-4 py-3">
      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]">
        {label}
      </span>
      {value ? <span className="text-sm font-medium">{value}</span> : children}
    </div>
  );
}

function MetricValue({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-[color:var(--color-border-soft)] bg-[color:var(--color-surface-2)] px-3 py-2">
      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]">
        {label}
      </dt>
      <dd className="text-sm font-medium">{children ?? value}</dd>
    </div>
  );
}

function getStatusTone(
  status: PricingStatusDto["status"] | PricingStatusSourceDto["status"],
): BadgeTone {
  if (status === "ok") {
    return "fresh";
  }

  if (status === "degraded") {
    return "warn";
  }

  if (status === "unknown") {
    return "neutral";
  }

  return "neutral";
}
