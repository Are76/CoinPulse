import { WarningBanner } from "@/components/ui/data-state/warning-banner";

export function ErrorState({
  title = "Request failed",
  message,
}: {
  title?: string;
  message: string;
}) {
  return (
    <WarningBanner tone="danger">
      <div className="flex flex-col gap-1">
        <strong className="font-semibold">{title}</strong>
        <span>{message}</span>
      </div>
    </WarningBanner>
  );
}
