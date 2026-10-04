import { execFile, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postWebhook } from "./post-webhook.js";
import { signWebhook } from "./sign-webhook.js";

const run = promisify(execFile);
const readme = readFileSync(join(import.meta.dirname, "../../../README.md"), "utf8");
const hasPython = spawnSync("python3", ["--version"]).status === 0;

const secret = `whsec_${Buffer.alloc(32, 5).toString("base64")}`;
const otherSecret = `whsec_${Buffer.alloc(32, 6).toString("base64")}`;
const id = "0199aaaa-0000-7000-8000-000000000001";
const textBody = Buffer.from('{"action":"opened","name":"ação ✓"}');
const binaryBody = Buffer.from([0xff, 0xfe, 0x00, 0x80, 0x7b, 0x7d]);

type Headers = Record<string, string>;
type Case = { name: string; secret: string; headers: Headers; body: Buffer; expected: boolean };

let server: Server;
let serverUrl: string;
let received: { headers: Headers; body: Buffer }[];
let cases: Case[];
let workDir: string;

function codeBlock(language: string) {
  const match = new RegExp("```" + language + "\\n([\\s\\S]*?)```").exec(readme);
  if (match?.[1] === undefined) {
    throw new Error(`README has no ${language} block`);
  }
  return match[1];
}

function minutesAgo(minutes: number, body = textBody) {
  return signWebhook({ id, now: new Date(Date.now() - minutes * 60_000), body, secret });
}

// a requisição passa pelo envio de verdade: o corpo e os headers são os que o destino veria
async function sentByWorker(body: Buffer) {
  const headers = signWebhook({ id, now: new Date(), body, secret });
  await postWebhook({
    url: serverUrl,
    body,
    contentType: "application/json",
    headers,
    timeoutMs: 2000,
    allowPrivateAddresses: true,
  });
  const request = received.at(-1);
  if (request === undefined) {
    throw new Error("the server received nothing");
  }
  return request;
}

beforeAll(async () => {
  received = [];
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const headers = Object.fromEntries(
        ["webhook-id", "webhook-timestamp", "webhook-signature"].map((name) => [
          name,
          String(request.headers[name]),
        ]),
      );
      received.push({ headers, body: Buffer.concat(chunks) });
      response.writeHead(200).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  serverUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

  const text = await sentByWorker(textBody);
  const binary = await sentByWorker(binaryBody);
  const sentSignature = text.headers["webhook-signature"] ?? "";
  const withoutId = { ...text.headers };
  delete withoutId["webhook-id"];

  cases = [
    { name: "text body sent by the worker", secret, ...text, expected: true },
    { name: "binary body sent by the worker", secret, ...binary, expected: true },
    {
      name: "altered body",
      secret,
      ...text,
      body: Buffer.concat([text.body, Buffer.from(" ")]),
      expected: false,
    },
    { name: "another secret", secret: otherSecret, ...text, expected: false },
    { name: "missing webhook-id", secret, headers: withoutId, body: text.body, expected: false },
    {
      name: "valid signature after an unrelated one",
      secret,
      headers: {
        ...text.headers,
        "webhook-signature": `v1,${Buffer.alloc(32).toString("base64")} ${sentSignature}`,
      },
      body: text.body,
      expected: true,
    },
    {
      name: "unknown signature version",
      secret,
      headers: { ...text.headers, "webhook-signature": sentSignature.replace("v1,", "v2,") },
      body: text.body,
      expected: false,
    },
    {
      name: "signature with non-ASCII characters",
      secret,
      headers: { ...text.headers, "webhook-signature": "v1,é" },
      body: text.body,
      expected: false,
    },
    {
      name: "timestamp that is not a number",
      secret,
      headers: { ...text.headers, "webhook-timestamp": "abc" },
      body: text.body,
      expected: false,
    },
    {
      name: "signed 4 minutes ago",
      secret,
      headers: minutesAgo(4),
      body: textBody,
      expected: true,
    },
    {
      name: "signed 10 minutes ago",
      secret,
      headers: minutesAgo(10),
      body: textBody,
      expected: false,
    },
    {
      name: "signed 10 minutes ahead",
      secret,
      headers: minutesAgo(-10),
      body: textBody,
      expected: false,
    },
  ];

  workDir = mkdtempSync(join(tmpdir(), "readme-verification-"));
  writeFileSync(
    join(workDir, "cases.json"),
    JSON.stringify(cases.map((c) => ({ ...c, body: c.body.toString("base64") }))),
  );
});

afterAll(() => {
  server.close();
  rmSync(workDir, { recursive: true, force: true });
});

function verdictsOf(output: string) {
  const verdicts = JSON.parse(output) as unknown[];
  return verdicts.map((verdict, index) => [cases[index]?.name, verdict]);
}

describe("verification snippets from the README", () => {
  it("the Node snippet gives the expected verdict for every case", async () => {
    writeFileSync(join(workDir, "snippet.mjs"), codeBlock("js"));
    writeFileSync(
      join(workDir, "run.mjs"),
      `import { readFileSync } from "node:fs";
import { verifyWebhook } from "./snippet.mjs";
const cases = JSON.parse(readFileSync(process.argv[2], "utf8"));
const verdicts = cases.map((c) => {
  try {
    return verifyWebhook(c.secret, c.headers, Buffer.from(c.body, "base64"));
  } catch (error) {
    return String(error);
  }
});
console.log(JSON.stringify(verdicts));
`,
    );

    const { stdout } = await run(process.execPath, ["run.mjs", "cases.json"], { cwd: workDir });

    expect(verdictsOf(stdout)).toEqual(cases.map((c) => [c.name, c.expected]));
  });

  it.skipIf(!hasPython)(
    "the Python snippet gives the expected verdict for every case",
    async () => {
      writeFileSync(join(workDir, "snippet.py"), codeBlock("python"));
      writeFileSync(
        join(workDir, "run.py"),
        `import base64
import json
import sys

from snippet import verify_webhook

verdicts = []
for case in json.load(open(sys.argv[1])):
    try:
        verdicts.append(verify_webhook(case["secret"], case["headers"], base64.b64decode(case["body"])))
    except Exception as error:
        verdicts.append(repr(error))
print(json.dumps(verdicts))
`,
      );

      const { stdout } = await run("python3", ["run.py", "cases.json"], { cwd: workDir });

      expect(verdictsOf(stdout)).toEqual(cases.map((c) => [c.name, c.expected]));
    },
  );
});
