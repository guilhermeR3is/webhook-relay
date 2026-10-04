import { describe, expect, it } from "vitest";
import { loadAddEndpointEnv, parseAddEndpointArgs } from "./endpoint-add.js";

const minimal = { slug: "github", "destination-url": "https://n8n.example.com/webhook/abc" };

describe("parseAddEndpointArgs", () => {
  it("fills the defaults: name from the slug, generic_hmac and every event type", () => {
    expect(parseAddEndpointArgs(minimal)).toEqual({
      slug: "github",
      name: "github",
      scheme: "generic_hmac",
      destinationUrl: "https://n8n.example.com/webhook/abc",
      eventTypes: ["*"],
    });
  });

  it("reads the scheme, the name and a list of event types with spaces", () => {
    const args = parseAddEndpointArgs({
      ...minimal,
      scheme: "github",
      name: "GitHub do portfolio",
      "event-types": "push, pull_request ,issues",
    });

    expect(args.scheme).toBe("github");
    expect(args.name).toBe("GitHub do portfolio");
    expect(args.eventTypes).toEqual(["push", "pull_request", "issues"]);
  });

  it.each(["GitHub", "my endpoint", "-github", "github-", "a--b", "git_hub", "a".repeat(65)])(
    "rejects the slug %j, which would not be a clean part of the /in/ path",
    (slug) => {
      expect(() => parseAddEndpointArgs({ ...minimal, slug })).toThrow(/slug/);
    },
  );

  it("requires the slug and the destination URL", () => {
    expect(() => parseAddEndpointArgs({ "destination-url": minimal["destination-url"] })).toThrow(
      /slug/,
    );
    expect(() => parseAddEndpointArgs({ slug: "github" })).toThrow(/destination-url/);
  });

  it.each(["ftp://example.com/hook", "javascript:alert(1)", "not a url", "n8n.example.com/hook"])(
    "rejects the destination %j, which is not an http(s) URL",
    (url) => {
      expect(() => parseAddEndpointArgs({ ...minimal, "destination-url": url })).toThrow(
        /destination-url/,
      );
    },
  );

  it.each([
    "http://localhost:5678/webhook/github-push",
    "http://127.0.0.1:4000/hook",
    "http://receiver:4000/hook",
    "https://n8n.example.com/webhook/abc",
  ])("accepts the local or public destination %j", (url) => {
    expect(parseAddEndpointArgs({ ...minimal, "destination-url": url }).destinationUrl).toBe(url);
  });

  it("rejects an unknown scheme", () => {
    expect(() => parseAddEndpointArgs({ ...minimal, scheme: "stripe" })).toThrow(/scheme/);
  });

  it.each(["push,,issues", " ", "push,", "pu sh"])("rejects the event types %j", (types) => {
    expect(() => parseAddEndpointArgs({ ...minimal, "event-types": types })).toThrow(/event-types/);
  });
});

describe("loadAddEndpointEnv", () => {
  const base = {
    DATABASE_URL: "postgresql://relay:relay@localhost:5433/relay",
    ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  };

  it("accepts the two variables the command needs", () => {
    expect(loadAddEndpointEnv(base).DATABASE_URL).toBe(base.DATABASE_URL);
  });

  it("rejects a key that is not 32 bytes and a missing database URL", () => {
    expect(() =>
      loadAddEndpointEnv({ ...base, ENCRYPTION_KEY: Buffer.alloc(16, 1).toString("base64") }),
    ).toThrow(/ENCRYPTION_KEY/);
    expect(() => loadAddEndpointEnv({ ...base, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });
});
