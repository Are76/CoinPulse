export function LoadingState({
  blocks = 4,
  className = "grid gap-4 md:grid-cols-4",
}: {
  blocks?: number;
  className?: string;
}) {
  return (
    <div className={className}>
      {Array.from({ length: blocks }, (_, index) => (
        <div
          key={`loading-block-${index}`}
          className="h-32 animate-pulse rounded-[var(--radius-md)] border border-[color:var(--color-border-soft)] bg-[color:var(--color-surface-2)]"
        />
      ))}
    </div>
  );
}
