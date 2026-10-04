"use client";

import { LoadError } from "@/components/load-error";

export default function EventDetailError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <LoadError
      heading="Evento"
      title="Não foi possível carregar o evento"
      error={error}
      retry={retry}
    />
  );
}
