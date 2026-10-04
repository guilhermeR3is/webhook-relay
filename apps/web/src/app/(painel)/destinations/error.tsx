"use client";

import { LoadError } from "@/components/load-error";

export default function DestinationsError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <LoadError
      heading="Destinos"
      title="Não foi possível carregar os destinos"
      error={error}
      retry={retry}
    />
  );
}
