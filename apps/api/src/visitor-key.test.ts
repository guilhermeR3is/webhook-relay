import { describe, expect, it } from "vitest";
import { normalizeVisitorAddress, visitorKey } from "./visitor-key.js";

const salt = "a-salt-with-enough-characters";

describe("normalizeVisitorAddress", () => {
  it("leaves an IPv4 address as it is", () => {
    expect(normalizeVisitorAddress("203.0.113.7")).toBe("203.0.113.7");
  });

  it("reads an IPv4 address inside an IPv6 one as the IPv4 address", () => {
    expect(normalizeVisitorAddress("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(normalizeVisitorAddress("::FFFF:203.0.113.7")).toBe("203.0.113.7");
  });

  it("keeps only the /64 block of an IPv6 address", () => {
    expect(normalizeVisitorAddress("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe(
      "2001:0db8:0001:0002::/64",
    );
  });

  it("gives the same block for the compressed and the written out forms", () => {
    const compressed = normalizeVisitorAddress("2001:db8::1");
    const full = normalizeVisitorAddress("2001:0db8:0000:0000:0000:0000:0000:0001");

    expect(compressed).toBe(full);
    expect(compressed).toBe("2001:0db8:0000:0000::/64");
  });

  it("gives the same block to two addresses of the same /64 and another to a different /64", () => {
    const base = normalizeVisitorAddress("2001:db8:0:1::10");

    expect(normalizeVisitorAddress("2001:db8:0:1:ffff:ffff:ffff:ffff")).toBe(base);
    expect(normalizeVisitorAddress("2001:db8:0:2::10")).not.toBe(base);
  });

  it("expands the loopback and the unspecified address", () => {
    expect(normalizeVisitorAddress("::1")).toBe("0000:0000:0000:0000::/64");
    expect(normalizeVisitorAddress("::")).toBe("0000:0000:0000:0000::/64");
  });

  it("ignores the zone of a link-local address and the case of the letters", () => {
    expect(normalizeVisitorAddress("FE80::1%eth0")).toBe(normalizeVisitorAddress("fe80::1"));
  });

  it("leaves text that is not an IP address alone, in lower case", () => {
    expect(normalizeVisitorAddress("Unknown")).toBe("unknown");
    expect(normalizeVisitorAddress("")).toBe("");
  });
});

describe("visitorKey", () => {
  it("is a SHA-256 in hexadecimal that does not contain the address", () => {
    const key = visitorKey("203.0.113.7", salt);

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("203");
  });

  it("is the same for the same visitor, however the address is written", () => {
    expect(visitorKey("203.0.113.7", salt)).toBe(visitorKey("::ffff:203.0.113.7", salt));
  });

  it("differs between visitors", () => {
    expect(visitorKey("203.0.113.7", salt)).not.toBe(visitorKey("203.0.113.8", salt));
  });

  it("depends on the salt, so a table of known addresses does not work against it", () => {
    expect(visitorKey("203.0.113.7", salt)).not.toBe(visitorKey("203.0.113.7", `${salt}-other`));
  });
});
