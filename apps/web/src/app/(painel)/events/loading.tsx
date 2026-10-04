import { Skeleton } from "@/components/ui/skeleton";

export default function EventsLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <h1 className="text-2xl font-semibold tracking-tight">Eventos</h1>
      <p role="status" className="sr-only">
        Carregando os eventos
      </p>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-full max-w-md" />
        <div className="flex gap-2">
          {[24, 28, 32, 36, 28].map((width, index) => (
            <Skeleton key={index} className="h-9" style={{ width: `${String(width * 4)}px` }} />
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {Array.from({ length: 8 }, (_, index) => (
          <div
            key={index}
            className="flex items-center gap-4 border-b border-border px-4 py-4 last:border-b-0"
          >
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="hidden h-4 flex-1 md:block" />
            <Skeleton className="ml-auto h-4 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
