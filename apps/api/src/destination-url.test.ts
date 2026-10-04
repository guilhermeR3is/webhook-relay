import { describe, expect, it } from "vitest";
import { redactDestinationUrl } from "./destination-url.js";

describe("redactDestinationUrl", () => {
  it("keeps a plain URL as it is", () => {
    expect(redactDestinationUrl("https://relay.example.com/demo/flaky")).toBe(
      "https://relay.example.com/demo/flaky",
    );
  });

  it("drops credentials, query string and fragment", () => {
    expect(
      redactDestinationUrl("https://user:pass@hooks.example.com:8443/hook?token=abc#top"),
    ).toBe("https://hooks.example.com:8443/hook");
  });

  it("hides a path segment that looks like a token, keeping the rest of the path", () => {
    expect(
      redactDestinationUrl(
        "https://n8n.example.com/webhook/3f1c2d4e-9a7b-4c1d-8e2f-5a6b7c8d9e0f/test",
      ),
    ).toBe("https://n8n.example.com/webhook/…/test");
  });

  it("hides segments of 16 characters or more and keeps shorter ones", () => {
    expect(redactDestinationUrl("https://h.example.com/aaaaaaaaaaaaaaaa/aaaaaaaaaaaaaaa")).toBe(
      "https://h.example.com/…/aaaaaaaaaaaaaaa",
    );
  });

  it("keeps the brackets of an IPv6 host", () => {
    expect(redactDestinationUrl("http://[::1]:4010/hook")).toBe("http://[::1]:4010/hook");
  });

  it("answers with a fixed text when the stored URL cannot be parsed", () => {
    expect(redactDestinationUrl("not a url")).toBe("(invalid URL)");
  });
});
