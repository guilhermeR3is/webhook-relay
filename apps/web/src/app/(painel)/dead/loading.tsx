import { Skeleton } from "@/components/ui/skeleton";

export default function DeadLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <h1 className="text-2xl font-semibold tracking-tight">Mortas</h1>
      <p role="status" className="sr-only">
        Carregando as entregas mortas
      </p>
      <Skeleton className="h-4 w-full max-w-md" />
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-9 w-28" />
        </div>
        {Array.from({ length: 8 }, (_, index) => (
          <div
            key={index}
            className="flex items-center gap-4 border-b border-border px-4 py-4 last:border-b-0"
          >
            <Skeleton className="size-5" />
            <Skeleton className="h-4 w-1/5" />
            <Skeleton className="hidden h-4 w-1/5 md:block" />
            <Skeleton className="hidden h-4 flex-1 md:block" />
            <Skeleton className="ml-auto h-4 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
