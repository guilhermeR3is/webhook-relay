import { Skeleton } from "@/components/ui/skeleton";

export default function EventDetailLoading() {
  return (
    <div className="flex max-w-4xl flex-col gap-8" aria-busy="true">
      <p role="status" className="sr-only">
        Carregando o evento
      </p>
      <header className="flex flex-col gap-3">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-8 w-72 max-w-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-64 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
      </header>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-6 w-24" />
        <div className="rounded-lg border border-border bg-card p-6">
          <Skeleton className="h-5 w-60 max-w-full" />
          <div className="mt-6 flex flex-col gap-5">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center gap-4">
                <Skeleton className="size-3 rounded-full" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-10" />
                <Skeleton className="h-2 flex-1" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
