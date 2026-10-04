import { Skeleton } from "@/components/ui/skeleton";

export default function DestinationsLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <h1 className="text-2xl font-semibold tracking-tight">Destinos</h1>
      <p role="status" className="sr-only">
        Carregando os destinos
      </p>
      <Skeleton className="h-4 w-full max-w-md" />
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="flex flex-col gap-3 border-b border-border px-4 py-4 last:border-b-0 md:flex-row md:items-center md:gap-4"
          >
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-24 md:ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}
