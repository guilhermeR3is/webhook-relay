import { loadReceiverEnv } from "./env.ts";
import { createReceiver } from "./receiver.ts";

const env = loadReceiverEnv();
const receiver = createReceiver({ delayMs: env.RECEIVER_DELAY_MS });

receiver.listen(env.RECEIVER_PORT, "0.0.0.0", () => {
  process.stdout.write(
    `${JSON.stringify({ level: "info", msg: "receiver listening", port: env.RECEIVER_PORT, delayMs: env.RECEIVER_DELAY_MS })}\n`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    receiver.close();
  });
}
