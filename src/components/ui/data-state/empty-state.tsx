import { SurfaceCard } from "@/components/ui/surface-card";

export function EmptyState({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <SurfaceCard className="flex flex-col gap-2">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="text-sm leading-6 text-[color:var(--color-text-muted)]">{message}</p>
    </SurfaceCard>
  );
}
