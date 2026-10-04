"use client";

import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";

export function LoadError({
  heading,
  title,
  error,
  retry,
}: {
  heading: string;
  title: string;
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
      <Notice title={title}>
        <p>Algo falhou ao ler os dados. Tente de novo; se continuar, avise quem mantém o painel.</p>
        {error.digest && (
          <p>
            Código do erro: <span className="font-mono text-foreground">{error.digest}</span>
          </p>
        )}
        <div>
          <Button
            variant="outline"
            size="lg"
            onClick={() => {
              retry();
            }}
          >
            Tentar de novo
          </Button>
        </div>
      </Notice>
    </div>
  );
}
