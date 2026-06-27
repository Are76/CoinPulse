export function TimestampLabel({
  label,
  value,
  fallback = "—",
}: {
  label?: string;
  value: string | null | undefined;
  fallback?: string;
}) {
  const formatted = value
    ? new Date(value).toLocaleString("en-GB", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : fallback;

  return (
    <span
      className="text-xs whitespace-nowrap"
      style={{ color: "#586070", fontFamily: value ? "var(--font-mono-data), monospace" : "inherit" }}
    >
      {label ? `${label} ` : ""}
      {formatted}
    </span>
  );
}
