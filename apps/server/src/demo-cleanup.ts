type CleanupLog = {
  info: (fields: object, message: string) => void;
  error: (fields: object, message: string) => void;
};

type DemoCleanupOptions = {
  run: () => Promise<Record<string, number>>;
  intervalMs: number;
  log: CleanupLog;
};

export function startDemoCleanup({ run, intervalMs, log }: DemoCleanupOptions) {
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> = Promise.resolve();
  let stopped = false;

  const tick = () => {
    inFlight = run()
      .then(
        (deleted) => {
          log.info({ job: "demo-cleanup", ...deleted }, "demo cleanup finished");
        },
        (error: unknown) => {
          log.error({ job: "demo-cleanup", err: error }, "demo cleanup failed");
        },
      )
      .finally(() => {
        // a próxima só é marcada depois que esta termina, então duas nunca rodam juntas
        if (!stopped) timer = setTimeout(tick, intervalMs);
      });
  };
  tick();

  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await inFlight;
    },
  };
}
