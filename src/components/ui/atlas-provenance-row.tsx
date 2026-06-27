import { AtlasStatusBadge } from "@/components/ui/atlas-status-badge";
import type { BadgeVariant } from "@/components/ui/atlas-status-badge";
import { TimestampLabel } from "@/components/ui/value/timestamp-label";

interface AtlasProvenanceRowProps {
  source?: string | null;
  observedAt?: string | null;
  schemaVersion?: string | null;
  evidenceStatus?: BadgeVariant;
  operator?: boolean;
  sourceFamily?: string | null;
  syncStatus?: BadgeVariant;
  warningCodes?: string[];
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs" style={{ color: "#586070" }}>{label}</span>
      <span
        className="text-xs"
        style={{ color: "#a0a8c0", fontFamily: mono ? "var(--font-mono-data), monospace" : "inherit" }}
      >
        {value}
      </span>
    </div>
  );
}

export function AtlasProvenanceRow({
  source,
  observedAt,
  schemaVersion,
  evidenceStatus = "evidence-available",
  operator = false,
  sourceFamily,
  syncStatus,
  warningCodes,
}: AtlasProvenanceRowProps) {
  return (
    <div
      className="rounded-lg flex flex-col gap-2 px-3 py-2.5"
      style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.055)" }}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {source && <Field label="Source" value={source} />}
        {observedAt && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs" style={{ color: "#586070" }}>As of</span>
            <TimestampLabel value={observedAt} />
          </div>
        )}
        {schemaVersion && <Field label="Version" value={schemaVersion} mono />}
        <div className="flex items-center gap-1.5">
          <span className="text-xs" style={{ color: "#586070" }}>Evidence</span>
          <AtlasStatusBadge variant={evidenceStatus} size="sm" />
        </div>
      </div>

      {operator && (sourceFamily || syncStatus || (warningCodes && warningCodes.length > 0)) && (
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-2"
          style={{ borderTop: "1px solid rgba(255,255,255,0.045)" }}
        >
          <span
            className="text-xs font-semibold uppercase w-full"
            style={{ color: "#586070", letterSpacing: "0.08em", fontSize: "9px" }}
          >
            Operator detail
          </span>
          {sourceFamily && <Field label="Source family" value={sourceFamily} />}
          {syncStatus && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs" style={{ color: "#586070" }}>Sync</span>
              <AtlasStatusBadge variant={syncStatus} size="sm" />
            </div>
          )}
          {warningCodes && warningCodes.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs" style={{ color: "#586070" }}>Warnings</span>
              <span
                className="text-xs"
                style={{ color: "#f59e0b", fontFamily: "var(--font-mono-data), monospace" }}
              >
                {warningCodes.join(" · ")}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
