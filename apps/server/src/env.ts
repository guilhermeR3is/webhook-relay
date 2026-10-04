import { loadEnv as loadApiEnv } from "@relay/api";
import { loadEnv as loadWorkerEnv } from "@relay/worker";

// o Render define a porta pública em PORT e o commit em RENDER_GIT_COMMIT; o worker fica na WORKER_PORT, sem exposição externa
export function loadServerEnv(source: NodeJS.ProcessEnv = process.env) {
  const shared = {
    ...source,
    GIT_COMMIT: source.GIT_COMMIT ?? source.RENDER_GIT_COMMIT?.slice(0, 7),
  };
  return {
    api: loadApiEnv({ ...shared, API_PORT: source.PORT ?? source.API_PORT }),
    worker: loadWorkerEnv(shared),
  };
}
