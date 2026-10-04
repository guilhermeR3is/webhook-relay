import type { Metadata } from "next";
import Link from "next/link";
import { EventsTable } from "@/components/events/events-table";
import { EventsToolbar } from "@/components/events/events-toolbar";
import { SendTestEvent } from "@/components/events/send-test-event";
import { explainLoadError } from "@/components/explain-load-error";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { loadEnv } from "@/env";
import { fetchEvents, type EventsPage } from "@/lib/events";
import { eventsHref, parseEventsQuery } from "@/lib/events-query";

export const metadata: Metadata = { title: "Eventos" };

function PageTitle() {
  return <h1 className="text-2xl font-semibold tracking-tight">Eventos</h1>;
}

function BackToStart() {
  return (
    <Button asChild variant="outline" size="lg">
      <Link href="/events">Voltar ao início</Link>
    </Button>
  );
}

export default async function EventsPage({ searchParams }: PageProps<"/events">) {
  const query = parseEventsQuery(await searchParams);

  let page: EventsPage;
  try {
    page = await fetchEvents(query);
  } catch (error) {
    const explanation = explainLoadError(error, {
      text: "O ponto de partida dessa página da lista não é reconhecido.",
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

  const filtered = Boolean(query.status ?? query.search);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <PageTitle />
        <SendTestEvent apiUrl={loadEnv().PUBLIC_API_URL} />
      </div>
      <EventsToolbar query={query} />
      {page.events.length === 0 ? (
        filtered ? (
          <Notice title="Nenhum evento com esse filtro">
            <p>Tente outro estado ou outro texto de busca.</p>
          </Notice>
        ) : (
          <Notice title="Nenhum evento ainda">
            <p>Quando um webhook chegar ao endpoint de demonstração, ele aparece aqui.</p>
          </Notice>
        )
      ) : (
        <EventsTable events={page.events} now={new Date()} />
      )}
      {(query.cursor ?? page.nextCursor) && (
        <nav aria-label="Páginas da lista" className="flex items-center gap-3">
          {query.cursor && (
            <Button asChild variant="ghost" size="lg">
              <Link href={eventsHref({ ...query, cursor: undefined })}>Voltar ao início</Link>
            </Button>
          )}
          {page.nextCursor && (
            <Button asChild variant="outline" size="lg">
              <Link href={eventsHref({ ...query, cursor: page.nextCursor })} rel="next">
                Mais antigos
              </Link>
            </Button>
          )}
        </nav>
      )}
    </div>
  );
}
