import { execFile, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createDb, type Db } from "@relay/db";
import { z } from "zod";
import { summarizeChaos } from "./chaos-report.ts";
import { loadChaosEnv } from "./env.ts";
import { createLoadTarget, LOAD_ENDPOINT_SLUG, removeLoadTarget } from "./load-target.ts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const resultsDir = `${repoRoot}load/results`;
const run = promisify(execFile);

const env = loadChaosEnv();
const db = createDb(env.DATABASE_URL);
const timeline: Record<string, string> = {};

function mark(event: string, fields: Record<string, unknown> = {}) {
  const at = new Date().toISOString();
  timeline[event] = at;
  process.stdout.write(`${JSON.stringify({ at, event, ...fields })}\n`);
}

function compose(args: string[], extraEnv: Record<string, string> = {}) {
  return run("docker", ["compose", ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv },
  });
}

async function workerContainerId() {
  const { stdout } = await compose(["ps", "-q", "worker"]);
  const id = stdout.trim();
  if (id === "") {
    throw new Error(
      "the worker container is not running: start it with docker compose up -d worker",
    );
  }
  return id;
}

async function waitForReceiver() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await fetch(`${env.RECEIVER_URL}/stats`);
      return;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error(`the receiver did not answer at ${env.RECEIVER_URL}`);
}

function startLoad() {
  const log = openSync(`${resultsDir}/chaos-k6.log`, "w");
  const child = spawn("docker", ["compose", "run", "--rm", "-T", "k6"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      RATE: String(env.CHAOS_RATE),
      DURATION: `${String(env.CHAOS_DURATION_SECONDS)}s`,
    },
    stdio: ["ignore", log, log],
  });
  return new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      closeSync(log);
      resolve(code ?? -1);
    });
  });
}

const loadDeliveries = { event: { endpoint: { slug: LOAD_ENDPOINT_SLUG } } };

function countUnfinished(client: Db) {
  return client.delivery.count({
    where: { ...loadDeliveries, status: { in: ["pending", "in_progress"] } },
  });
}

async function waitUntilSettled(client: Db) {
  const giveUpAt = Date.now() + env.CHAOS_SETTLE_TIMEOUT_SECONDS * 1000;
  let nextProgressAt = 0;
  for (;;) {
    const unfinished = await countUnfinished(client);
    if (unfinished === 0 || Date.now() > giveUpAt) {
      return;
    }
    if (Date.now() >= nextProgressAt) {
      mark("waiting for the queue to drain", { unfinishedDeliveries: unfinished });
      nextProgressAt = Date.now() + 30_000;
    }
    await sleep(5000);
  }
}

const k6SummarySchema = z.object({
  metrics: z.object({ checks: z.object({ passes: z.number() }) }),
});

async function readAcceptedCount() {
  const summary = k6SummarySchema.parse(
    JSON.parse(await readFile(`${resultsDir}/summary.json`, "utf8")),
  );
  return summary.metrics.checks.passes;
}

const receiverStatsSchema = z.object({
  received: z.number(),
  distinct: z.number(),
  duplicates: z.number(),
});

async function collectReport(client: Db, accepted: number) {
  const byStatus = await client.delivery.groupBy({
    by: ["status"],
    where: loadDeliveries,
    _count: true,
  });
  const countOf = (status: string) => byStatus.find((row) => row.status === status)?._count ?? 0;

  return summarizeChaos({
    accepted,
    eventsInDatabase: await client.event.count({
      where: { endpoint: { slug: LOAD_ENDPOINT_SLUG } },
    }),
    deliveries: {
      succeeded: countOf("succeeded"),
      pending: countOf("pending"),
      in_progress: countOf("in_progress"),
      dead: countOf("dead"),
    },
    redeliveredAfterKill: await client.delivery.count({
      where: { ...loadDeliveries, attemptCount: { gt: 1 } },
    }),
    receiver: receiverStatsSchema.parse(await (await fetch(`${env.RECEIVER_URL}/stats`)).json()),
  });
}

try {
  const workerId = await workerContainerId();

  await compose(["--profile", "load", "up", "-d", "--force-recreate", "--no-deps", "receiver"], {
    RECEIVER_DELAY_MS: String(env.CHAOS_RECEIVER_DELAY_MS),
  });
  await waitForReceiver();
  await removeLoadTarget(db);
  await createLoadTarget(db, {
    encryptionKey: Buffer.from(env.ENCRYPTION_KEY, "base64"),
    destinationUrl: env.LOAD_DESTINATION_URL,
  });
  await rm(`${resultsDir}/summary.json`, { force: true });

  mark("load started", { rate: env.CHAOS_RATE, seconds: env.CHAOS_DURATION_SECONDS });
  const loadFinished = startLoad();

  await sleep(env.CHAOS_KILL_AFTER_SECONDS * 1000);
  await run("docker", ["kill", workerId]);
  mark("worker killed with SIGKILL");
  await sleep(env.CHAOS_DOWN_SECONDS * 1000);
  await compose(["start", "worker"]);
  mark("worker started again");

  const k6ExitCode = await loadFinished;
  mark("load finished", { k6ExitCode });

  await waitUntilSettled(db);
  mark("queue drained");

  const report = await collectReport(db, await readAcceptedCount());
  const output = {
    config: {
      rate: env.CHAOS_RATE,
      durationSeconds: env.CHAOS_DURATION_SECONDS,
      receiverDelayMs: env.CHAOS_RECEIVER_DELAY_MS,
      killAfterSeconds: env.CHAOS_KILL_AFTER_SECONDS,
      downSeconds: env.CHAOS_DOWN_SECONDS,
    },
    timeline,
    k6ExitCode,
    ...report,
  };
  await writeFile(`${resultsDir}/chaos-report.json`, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exitCode = report.verdict === "zero events lost" ? 0 : 1;
} finally {
  // um erro entre o kill e o religar não pode deixar o worker derrubado
  await compose(["start", "worker"]);
  await db.$disconnect();
}
