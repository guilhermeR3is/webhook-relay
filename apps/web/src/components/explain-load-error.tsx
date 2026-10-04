import type { ReactElement, ReactNode } from "react";
import { Notice } from "@/components/notice";
import { WakingUp } from "@/components/waking-up";
import { ApiError, ApiUnavailableError } from "@/lib/api";

type InvalidCursorNotice = { text: string; action: ReactNode };

// os outros erros voltam como null e a página os relança para o error.tsx
export function explainLoadError(
  error: unknown,
  invalidCursor?: InvalidCursorNotice,
): ReactElement | null {
  if (error instanceof ApiUnavailableError) return <WakingUp />;
  if (error instanceof ApiError && error.code === "demo_endpoint_not_found") {
    return (
      <Notice title="Endpoint de demonstração não encontrado">
        <p>
          A API não achou o endpoint cujo slug está em DEMO_ENDPOINT_SLUG. Crie o endpoint ou ajuste
          a variável.
        </p>
      </Notice>
    );
  }
  if (invalidCursor && error instanceof ApiError && error.code === "invalid_cursor") {
    return (
      <Notice title="Esse link de página não vale mais">
        <p>{invalidCursor.text}</p>
        <div>{invalidCursor.action}</div>
      </Notice>
    );
  }
  return null;
}
