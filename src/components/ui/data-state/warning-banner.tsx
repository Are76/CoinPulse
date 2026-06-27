import type { ReactNode } from "react";

import { AlertTriangle, AlertCircle, Ban } from "lucide-react";

export function WarningBanner({
  children,
  tone = "warn",
  title,
}: {
  children: ReactNode;
  tone?: "warn" | "danger" | "info";
  title?: string;
}) {
  const config = {
    warn:   { color: "#f59e0b", bg: "rgba(245,158,11,0.06)",  border: "rgba(245,158,11,0.2)",  Icon: AlertTriangle },
    danger: { color: "#f87171", bg: "rgba(248,113,113,0.06)", border: "rgba(248,113,113,0.2)", Icon: AlertCircle },
    info:   { color: "#60a5fa", bg: "rgba(96,165,250,0.06)",  border: "rgba(96,165,250,0.2)",  Icon: Ban },
  }[tone];

  return (
    <div
      className="flex gap-3 rounded-xl px-4 py-3"
      style={{ background: config.bg, border: `1px solid ${config.border}` }}
    >
      <config.Icon size={15} style={{ color: config.color, flexShrink: 0, marginTop: 1 }} strokeWidth={2} />
      <div className="flex flex-col gap-0.5 min-w-0">
        {title && (
          <span className="text-sm font-semibold" style={{ color: config.color }}>{title}</span>
        )}
        <span className="text-xs leading-relaxed" style={{ color: "#a0a8c0" }}>{children}</span>
      </div>
    </div>
  );
}

export function WarningList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) {
    return <span style={{ color: "#586070" }} className="text-xs">none</span>;
  }

  return (
    <ul className="space-y-1 text-xs leading-5" style={{ color: "#a0a8c0" }}>
      {warnings.map((warning) => (
        <li key={warning} className="flex items-start gap-1.5">
          <span style={{ color: "#f59e0b" }} className="mt-0.5 flex-shrink-0">·</span>
          {warning}
        </li>
      ))}
    </ul>
  );
}
