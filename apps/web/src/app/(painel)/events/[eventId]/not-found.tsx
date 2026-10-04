import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Notice } from "@/components/notice";

export default function EventNotFound() {
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Evento</h1>
      <Notice title="Evento não encontrado">
        <p>
          Esse evento não existe ou já foi apagado. Os eventos de demonstração são apagados depois
          de 7 dias.
        </p>
        <Link
          href="/events"
          className="inline-flex w-fit items-center gap-1 rounded-sm text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Voltar para os eventos
        </Link>
      </Notice>
    </div>
  );
}
