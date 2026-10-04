"use client";

import { LoadError } from "@/components/load-error";

export default function EventsError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <LoadError
      heading="Eventos"
      title="Não foi possível carregar os eventos"
      error={error}
      retry={retry}
    />
  );
}
