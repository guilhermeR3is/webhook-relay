import { formatBodySize } from "@/lib/body-size";
import type { EventDetail } from "@/lib/event-detail";

export function BodyPreview({ body }: { body: EventDetail["body"] }) {
  return (
    <section aria-labelledby="body-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="body-heading" className="text-lg font-semibold tracking-tight">
          Corpo recebido
        </h2>
        <p className="text-sm text-muted-foreground">
          {formatBodySize(body.size)}
          {body.truncated && ", mostrando só o começo"}
        </p>
      </div>
      {body.text === null ? (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          O corpo é binário ou não está em UTF-8, então não dá para mostrar como texto. Ele foi
          guardado byte a byte e é enviado igual a cada tentativa.
        </p>
      ) : body.text === "" ? (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          O corpo está vazio.
        </p>
      ) : (
        <pre
          tabIndex={0}
          aria-labelledby="body-heading"
          className="max-h-96 overflow-auto rounded-lg border border-border bg-card p-4 font-mono text-xs break-words whitespace-pre-wrap outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {body.text}
        </pre>
      )}
    </section>
  );
}
