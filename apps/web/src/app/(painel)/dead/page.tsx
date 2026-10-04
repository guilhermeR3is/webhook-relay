import type { Metadata } from "next";
import Link from "next/link";
import { DeadQueue } from "@/components/dead/dead-queue";
import { explainLoadError } from "@/components/explain-load-error";
import { Button } from "@/components/ui/button";
import { fetchDeadDeliveries, type DeadDeliveriesPage } from "@/lib/dead-deliveries";
import { deadHref, parseDeadQuery } from "@/lib/dead-query";

export const metadata: Metadata = { title: "Mortas" };

function PageTitle() {
  return <h1 className="text-2xl font-semibold tracking-tight">Mortas</h1>;
}

function BackToStart() {
  return (
    <Button asChild variant="outline" size="lg">
      <Link href="/dead">Voltar ao início</Link>
    </Button>
  );
}

export default async function DeadPage({ searchParams }: PageProps<"/dead">) {
  const query = parseDeadQuery(await searchParams);

  let page: DeadDeliveriesPage;
  try {
    page = await fetchDeadDeliveries(query);
  } catch (error) {
    const explanation = explainLoadError(error, {
      text: "O ponto de partida dessa página da fila não é reconhecido.",
      action: <BackToStart />,
    });
    if (!explanation) throw error;
    return (
      <div className="flex flex-col gap-6">
        <PageTitle />
        {explanation}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle />
      <p className="max-w-prose text-sm text-muted-foreground">
        Entregas que esgotaram as tentativas ou foram recusadas pelo destino. Reenviar devolve cada
        uma à fila.
      </p>
      <DeadQueue
        key={query.cursor ?? "first"}
        deliveries={page.deliveries}
        now={new Date()}
        firstPage={!query.cursor}
      />
      {(query.cursor ?? page.nextCursor) && (
        <nav aria-label="Páginas da fila" className="flex items-center gap-3">
          {query.cursor && (
            <Button asChild variant="ghost" size="lg">
              <Link href="/dead">Voltar ao início</Link>
            </Button>
          )}
          {page.nextCursor && (
            <Button asChild variant="outline" size="lg">
              <Link href={deadHref({ cursor: page.nextCursor })} rel="next">
                Mais antigas
              </Link>
            </Button>
          )}
        </nav>
      )}
    </div>
  );
}
