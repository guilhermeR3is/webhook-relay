import type { ReactNode } from "react";

export function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-6 md:p-8">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="mt-2 flex max-w-prose flex-col gap-3 text-sm [&>p]:text-muted-foreground">
        {children}
      </div>
    </section>
  );
}
