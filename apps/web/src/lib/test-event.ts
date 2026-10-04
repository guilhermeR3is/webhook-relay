import { z } from "zod";
import { countOf } from "./plural";
import { formatMinutes } from "./time";

const REQUEST_TIMEOUT_MS = 10_000;
// o Render devolve 502, 503 ou 504 enquanto o serviço gratuito acorda
const WAKING_STATUSES = new Set([502, 503, 504]);

const sentBody = z.object({ eventId: z.string() });
const quotaBody = z.object({
  error: z.literal("quota_exceeded"),
  scope: z.enum(["ip", "global"]),
  limit: z.number().int().positive(),
  retryAt: z.coerce.date(),
});

export type TestEventResult =
  | { kind: "sent"; eventId: string }
  | { kind: "quota"; scope: "ip" | "global"; limit: number; retryAt: Date }
  | { kind: "unavailable" }
  | { kind: "failed"; status: number };

// POST sem corpo e sem cabeçalhos próprios é uma requisição "simples" do navegador: dispensa o preflight de CORS
export async function sendTestEvent(apiUrl: string): Promise<TestEventResult> {
  let response: Response;
  try {
    response = await fetch(new URL("/panel/test-event", apiUrl), {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { kind: "unavailable" };
  }
  if (WAKING_STATUSES.has(response.status)) return { kind: "unavailable" };

  const body: unknown = await response.json().catch(() => undefined);
  if (response.status === 201) {
    const sent = sentBody.safeParse(body);
    if (sent.success) return { kind: "sent", eventId: sent.data.eventId };
  }
  if (response.status === 429) {
    const quota = quotaBody.safeParse(body);
    if (quota.success) {
      const { scope, limit, retryAt } = quota.data;
      return { kind: "quota", scope, limit, retryAt };
    }
  }
  return { kind: "failed", status: response.status };
}

export function describeTestEventFailure(result: Exclude<TestEventResult, { kind: "sent" }>) {
  switch (result.kind) {
    case "quota":
      return result.scope === "ip"
        ? `Você já enviou ${countOf(result.limit, "evento de teste", "eventos de teste")} nesta hora. Tente de novo às ${formatMinutes(result.retryAt)}.`
        : `O limite de ${countOf(result.limit, "evento de teste", "eventos de teste")} por dia foi atingido. Volta amanhã.`;
    case "unavailable":
      return "A API não respondeu. Tente de novo.";
    case "failed":
      return `Não foi possível enviar o evento de teste (código ${String(result.status)}).`;
  }
}
