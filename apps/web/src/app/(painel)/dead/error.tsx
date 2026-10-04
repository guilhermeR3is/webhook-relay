"use client";

import { LoadError } from "@/components/load-error";

export default function DeadError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <LoadError
      heading="Mortas"
      title="Não foi possível carregar as entregas mortas"
      error={error}
      retry={retry}
    />
  );
}
