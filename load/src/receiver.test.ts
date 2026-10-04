import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createReceiver, type ReceiverStats } from "./receiver.ts";

const servers: Server[] = [];

async function startReceiver(delayMs = 0) {
  const receiver = createReceiver({ delayMs });
  servers.push(receiver);
  await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  const { port } = receiver.address() as AddressInfo;
  const base = `http://127.0.0.1:${String(port)}`;

  return {
    hook: (webhookId: string | null) =>
      fetch(`${base}/hook`, {
        method: "POST",
        headers: webhookId === null ? {} : { "webhook-id": webhookId },
        body: '{"n":1}',
      }),
    stats: async () => (await fetch(`${base}/stats`)).json() as Promise<ReceiverStats>,
    reset: () => fetch(`${base}/reset`, { method: "POST" }),
  };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
          server.closeAllConnections();
        }),
    ),
  );
});

describe("receiver", () => {
  it("answers 200 to each delivery and counts the distinct ids", async () => {
    const receiver = await startReceiver();

    const answers = await Promise.all(["a", "b", "c"].map((id) => receiver.hook(id)));

    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200]);
    expect(await receiver.stats()).toEqual({ received: 3, distinct: 3, duplicates: 0 });
  });

  it("counts the same webhook-id arriving again as a duplicate", async () => {
    const receiver = await startReceiver();

    await receiver.hook("same");
    await receiver.hook("same");
    await receiver.hook("same");
    await receiver.hook("other");

    expect(await receiver.stats()).toEqual({ received: 4, distinct: 2, duplicates: 2 });
  });

  it("refuses a delivery without webhook-id and does not count it", async () => {
    const receiver = await startReceiver();

    const answer = await receiver.hook(null);

    expect(answer.status).toBe(400);
    expect(await receiver.stats()).toEqual({ received: 0, distinct: 0, duplicates: 0 });
  });

  it("counts a delivery when it arrives, even if the answer is still delayed", async () => {
    const receiver = await startReceiver(150);

    const pending = receiver.hook("slow");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const whileWaiting = await receiver.stats();
    await pending;

    expect(whileWaiting.received).toBe(1);
  });

  it("holds the answer for the configured delay", async () => {
    const receiver = await startReceiver(120);
    const startedAt = performance.now();

    await receiver.hook("delayed");

    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(110);
  });

  it("starts counting from zero after a reset", async () => {
    const receiver = await startReceiver();
    await receiver.hook("a");
    await receiver.hook("a");

    await receiver.reset();

    expect(await receiver.stats()).toEqual({ received: 0, distinct: 0, duplicates: 0 });
  });
});
