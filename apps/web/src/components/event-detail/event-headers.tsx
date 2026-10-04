export function EventHeaders({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers);

  return (
    <section aria-labelledby="headers-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="headers-heading" className="text-lg font-semibold tracking-tight">
          Cabeçalhos guardados
        </h2>
        <p className="text-sm text-muted-foreground">
          Só uma lista curta de cabeçalhos é guardada; assinaturas e credenciais não.
        </p>
      </div>
      {entries.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          Nenhum cabeçalho foi guardado para este evento.
        </p>
      ) : (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 rounded-lg border border-border bg-card p-4 text-sm">
          {entries.map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="font-mono text-xs text-muted-foreground">{name}</dt>
              <dd className="font-mono text-xs wrap-anywhere">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
