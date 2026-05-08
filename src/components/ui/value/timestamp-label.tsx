export function TimestampLabel({
  label,
  value,
  fallback = "Not provided",
}: {
  label?: string;
  value: string | null | undefined;
  fallback?: string;
}) {
  const renderedValue = value
    ? new Date(value).toLocaleString("en-GB", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : fallback;

  return (
    <span className="text-xs text-[color:var(--color-text-muted)]">
      {label ? `${label} ${renderedValue}` : renderedValue}
    </span>
  );
}
