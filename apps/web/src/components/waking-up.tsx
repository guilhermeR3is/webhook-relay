"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";

const RETRY_EVERY_MS = 4000;
const SLOW_AFTER_MS = 90_000;

export function WakingUp() {
  const router = useRouter();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const retry = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, RETRY_EVERY_MS);
    const slowTimer = setTimeout(() => {
      setSlow(true);
    }, SLOW_AFTER_MS);
    return () => {
      clearInterval(retry);
      clearTimeout(slowTimer);
    };
  }, [router]);

  return (
    <div role="status">
      <Notice title="Acordando a demonstração">
        <p>
          O serviço gratuito dorme depois de 15 minutos sem uso e leva até um minuto para voltar.
          Esta página tenta de novo sozinha.
        </p>
        <div className="h-1 w-full max-w-xs overflow-hidden rounded-full bg-muted motion-reduce:hidden">
          <div className="h-full w-1/3 animate-waking rounded-full bg-primary" />
        </div>
        {slow && (
          <>
            <p className="text-foreground">Está demorando mais do que o normal.</p>
            <div>
              <Button
                variant="outline"
                size="lg"
                onClick={() => {
                  router.refresh();
                }}
              >
                Tentar agora
              </Button>
            </div>
          </>
        )}
      </Notice>
    </div>
  );
}
