import Link from "next/link";
import type { ReactNode } from "react";
import { StatusMark } from "@/components/status-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deliveryStatuses, statusLabels } from "@/lib/delivery-status";
import { MAX_SEARCH_LENGTH, eventsHref, type EventsQuery } from "@/lib/events-query";
import { cn } from "@/lib/utils";

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex h-11 items-center gap-2 rounded-sm border px-2.5 text-sm font-medium outline-none md:h-9 transition-[background-color,scale] duration-150 ease-out-strong focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-safe:active:scale-[0.97]",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card text-foreground hover:bg-muted",
      )}
    >
      {children}
    </Link>
  );
}

export function EventsToolbar({ query }: { query: EventsQuery }) {
  const filtered = Boolean(query.status ?? query.search);

  return (
    <div className="flex flex-col gap-4">
      <form action="/events" method="get" role="search" className="flex gap-2">
        {query.status && <input type="hidden" name="status" value={query.status} />}
        <Input
          type="search"
          name="search"
          defaultValue={query.search}
          maxLength={MAX_SEARCH_LENGTH}
          placeholder="Tipo, chave ou id"
          aria-label="Buscar eventos"
          className="h-11 max-w-md md:h-9"
        />
        <Button type="submit" variant="outline" size="lg">
          Buscar
        </Button>
      </form>
      <nav aria-label="Filtrar pelo estado das entregas">
        <ul className="flex flex-wrap items-center gap-2">
          <li>
            <FilterChip href={eventsHref({ search: query.search })} active={!query.status}>
              Todos
            </FilterChip>
          </li>
          {deliveryStatuses.map((status) => (
            <li key={status}>
              <FilterChip
                href={eventsHref({ status, search: query.search })}
                active={query.status === status}
              >
                <StatusMark
                  status={status}
                  className={query.status === status ? "text-background" : ""}
                />
                <span className="block first-letter:uppercase">{statusLabels[status].many}</span>
              </FilterChip>
            </li>
          ))}
          {filtered && (
            <li>
              <Link
                href="/events"
                className="inline-flex h-11 items-center rounded-sm px-2 text-sm text-muted-foreground md:h-9 underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                Limpar filtros
              </Link>
            </li>
          )}
        </ul>
      </nav>
    </div>
  );
}
