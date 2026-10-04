import { cn } from "@/lib/utils";
import type { DeliveryStatus } from "@/lib/delivery-status";

// cada estado tem uma forma própria, para a leitura não depender só da cor
export function StatusMark({ status, className }: { status: DeliveryStatus; className?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      data-status={status}
      className={cn("shrink-0", status === "in_progress" && "text-state-in-progress", className)}
    >
      {status === "succeeded" && <circle cx="6" cy="6" r="5" fill="var(--state-succeeded)" />}
      {status === "pending" && (
        <circle cx="6" cy="6" r="4.25" stroke="var(--state-pending)" strokeWidth="2" />
      )}
      {status === "in_progress" && (
        <>
          <circle cx="6" cy="6" r="4.75" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 1.25a4.75 4.75 0 0 1 0 9.5z" fill="currentColor" />
        </>
      )}
      {status === "dead" && (
        <path
          d="M2.5 2.5l7 7m0-7l-7 7"
          stroke="var(--state-dead)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
