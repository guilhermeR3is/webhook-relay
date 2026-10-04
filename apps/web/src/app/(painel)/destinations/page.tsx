import type { Metadata } from "next";
import { DestinationsTable } from "@/components/destinations/destinations-table";
import { explainLoadError } from "@/components/explain-load-error";
import { LiveAnnouncer } from "@/components/live-announcer";
import { LiveRefresh } from "@/components/live-refresh";
import { Notice } from "@/components/notice";
import { describeCircuits, needsCircuitWatch, sortByTrouble } from "@/lib/circuit";
import { fetchDestinations, type DestinationsList } from "@/lib/destinations";

export const metadata: Metadata = { title: "Destinos" };

function PageTitle() {
  return <h1 className="text-2xl font-semibold tracking-tight">Destinos</h1>;
}

export default async function DestinationsPage() {
  let list: DestinationsList;
  try {
    list = await fetchDestinations();
  } catch (error) {
    const explanation = explainLoadError(error);
    if (!explanation) throw error;
    return (
      <div className="flex flex-col gap-6">
        <PageTitle />
        {explanation}
      </div>
    );
  }

  const now = new Date();
  const destinations = sortByTrouble(list.destinations, now);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <PageTitle />
        <LiveAnnouncer report={describeCircuits(destinations, now)} />
        {needsCircuitWatch(destinations, now) && <LiveRefresh />}
      </div>
      <p className="max-w-prose text-sm text-muted-foreground">
        Para onde cada evento é entregue. Depois de {list.failureThreshold} falhas seguidas o
        circuito do destino abre: as entregas esperam sem chamar o destino e, passada a pausa, uma
        única entrega testa se ele voltou.
      </p>
      {destinations.length === 0 ? (
        <Notice title="Nenhum destino cadastrado">
          <p>
            Quem cadastra os destinos é o dono do projeto. Quando houver algum, ele aparece aqui com
            o estado do circuito.
          </p>
        </Notice>
      ) : (
        <DestinationsTable
          destinations={destinations}
          threshold={list.failureThreshold}
          now={now}
        />
      )}
    </div>
  );
}
