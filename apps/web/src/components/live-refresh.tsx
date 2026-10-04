"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const REFRESH_EVERY_MS = 3000;
const GIVE_UP_AFTER_MS = 10 * 60_000;

export function LiveRefresh() {
  const router = useRouter();
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const refresh = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_EVERY_MS);
    const giveUp = setTimeout(() => {
      setPaused(true);
    }, GIVE_UP_AFTER_MS);
    return () => {
      clearInterval(refresh);
      clearTimeout(giveUp);
    };
  }, [router, paused]);

  return (
    <div className="flex items-center gap-2">
      <p
        role="status"
        className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground"
      >
        {paused ? (
          <span aria-hidden="true" className="size-2 rounded-full border border-muted-foreground" />
        ) : (
          <span
            aria-hidden="true"
            className="size-2 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
          />
        )}
        {paused ? "Atualização pausada" : "Atualizando sozinha"}
      </p>
      {paused && (
        <Button
          variant="outline"
          size="sm"
          className="relative after:absolute after:-inset-2"
          onClick={() => {
            router.refresh();
            setPaused(false);
          }}
        >
          Atualizar
        </Button>
      )}
    </div>
  );
}
