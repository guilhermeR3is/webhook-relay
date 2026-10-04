export function Brand() {
  return (
    <span className="flex items-center gap-2.5">
      <svg width="30" height="12" viewBox="0 0 30 12" fill="none" aria-hidden="true">
        <path d="M2 6H28" stroke="currentColor" strokeWidth="1.5" />
        <circle
          cx="4"
          cy="6"
          r="2.5"
          fill="var(--sidebar)"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <circle
          cx="15"
          cy="6"
          r="2.5"
          fill="var(--sidebar)"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <circle
          cx="26"
          cy="6"
          r="2.5"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
      <span className="text-[0.9375rem] font-semibold tracking-tight">Webhook Relay</span>
    </span>
  );
}
