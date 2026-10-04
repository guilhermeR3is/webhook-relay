import { z } from "zod";
import { loadEnv } from "@/env";

const REQUEST_TIMEOUT_MS = 8000;
// o Render devolve 502, 503 ou 504 enquanto o serviço gratuito acorda
const WAKING_STATUSES = new Set([502, 503, 504]);

const errorBody = z.object({ error: z.string() });

export class ApiUnavailableError extends Error {}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`API answered ${String(status)} (${code})`);
  }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const url = new URL(path, loadEnv().API_URL);

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new ApiUnavailableError("the API did not answer", { cause });
  }
  if (WAKING_STATUSES.has(response.status)) {
    throw new ApiUnavailableError(`the API answered ${String(response.status)}`);
  }

  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new ApiError(response.status, errorBody.safeParse(body).data?.error ?? "unknown");
  }
  if (body === undefined) {
    throw new ApiError(response.status, "invalid_response");
  }
  return body;
}
