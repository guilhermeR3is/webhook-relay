import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { createGuardedLookup, isPublicAddress, literalAddressRefusal } from "./address-guard.js";

describe("isPublicAddress", () => {
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "11.0.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "172.15.255.255",
    "172.32.0.1",
    "192.169.0.1",
    "223.255.255.255",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "::ffff:8.8.8.8",
  ])("accepts the public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    ["this network", "0.0.0.0"],
    ["private 10/8", "10.0.0.1"],
    ["private 10/8, upper end", "10.255.255.255"],
    ["shared address space", "100.64.0.1"],
    ["loopback", "127.0.0.1"],
    ["loopback, other host", "127.255.255.254"],
    ["link-local, the cloud metadata address", "169.254.169.254"],
    ["private 172.16/12", "172.16.0.1"],
    ["private 172.16/12, upper end", "172.31.255.255"],
    ["private 192.168/16", "192.168.1.1"],
    ["IETF protocol assignments", "192.0.0.1"],
    ["documentation", "192.0.2.1"],
    ["benchmarking", "198.18.0.1"],
    ["multicast", "224.0.0.1"],
    ["reserved", "240.0.0.1"],
    ["broadcast", "255.255.255.255"],
    ["IPv6 loopback", "::1"],
    ["IPv6 unspecified", "::"],
    ["IPv6 unique local", "fc00::1"],
    ["IPv6 unique local, fd", "fd12:3456:789a::1"],
    ["IPv6 link-local", "fe80::1"],
    ["IPv6 link-local with zone", "fe80::1%eth0"],
    ["IPv6 multicast", "ff02::1"],
    ["IPv6 documentation", "2001:db8::1"],
    ["IPv4-mapped loopback", "::ffff:127.0.0.1"],
    ["IPv4-mapped private", "::ffff:10.0.0.1"],
    ["IPv4-mapped private, hex form", "::ffff:0a00:0001"],
    ["IPv4-mapped metadata address, hex form", "::ffff:a9fe:a9fe"],
    ["IPv4-compatible loopback", "::7f00:1"],
    ["NAT64 carrying a loopback", "64:ff9b::7f00:1"],
    ["6to4 carrying a loopback", "2002:7f00:1::1"],
  ])("refuses %s (%s)", (_label, address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["", "localhost", "not-an-ip", "999.1.1.1", "8.8.8"])(
    "refuses %j because it is not an IP address at all",
    (value) => {
      expect(isPublicAddress(value)).toBe(false);
    },
  );
});

describe("literalAddressRefusal", () => {
  it.each(["127.0.0.1", "10.1.2.3", "169.254.169.254", "[::1]", "[fd00::1]", "[::ffff:7f00:1]"])(
    "refuses the literal host %s",
    (hostname) => {
      expect(literalAddressRefusal(hostname)).toMatch(/^refused: .* is not a public address$/);
    },
  );

  it.each(["8.8.8.8", "[2606:4700:4700::1111]"])(
    "lets the public literal host %s through",
    (hostname) => {
      expect(literalAddressRefusal(hostname)).toBeUndefined();
    },
  );

  it.each(["example.com", "localhost"])(
    "leaves the name %s to the lookup, which sees what it resolves to",
    (hostname) => {
      expect(literalAddressRefusal(hostname)).toBeUndefined();
    },
  );

  it("sees through the disguises the URL parser normalizes", () => {
    for (const disguised of [
      "http://2130706433/",
      "http://0x7f.1/",
      "http://127.1/",
      "http://0/",
    ]) {
      expect(literalAddressRefusal(new URL(disguised).hostname)).toBeDefined();
    }
  });
});

describe("createGuardedLookup", () => {
  function lookupAnswering(...addresses: LookupAddress[]): LookupFunction {
    return (_hostname, options, callback) => {
      if (options.all === true) {
        callback(null, addresses);
        return;
      }
      const [first] = addresses;
      callback(null, first?.address ?? "", first?.family);
    };
  }

  function ask(lookup: LookupFunction, hostname: string, all: boolean) {
    return new Promise<{ error: Error | null; address: unknown }>((resolve) => {
      lookup(hostname, { all }, (error, address) => {
        resolve({ error, address });
      });
    });
  }

  const publicAddress: LookupAddress = { address: "93.184.216.34", family: 4 };
  const privateAddress: LookupAddress = { address: "10.0.0.5", family: 4 };

  it("passes a public answer through untouched, in both lookup modes", async () => {
    const lookup = createGuardedLookup(lookupAnswering(publicAddress));

    expect(await ask(lookup, "example.com", false)).toEqual({
      error: null,
      address: "93.184.216.34",
    });
    expect(await ask(lookup, "example.com", true)).toEqual({
      error: null,
      address: [publicAddress],
    });
  });

  it("refuses a name that resolves to a private address, in both lookup modes", async () => {
    const lookup = createGuardedLookup(lookupAnswering(privateAddress));

    for (const all of [false, true]) {
      const { error } = await ask(lookup, "internal.example.com", all);
      expect(error?.message).toBe(
        "refused: internal.example.com resolves to 10.0.0.5, which is not a public address",
      );
    }
  });

  it("refuses the whole answer when only one of several addresses is private", async () => {
    const lookup = createGuardedLookup(lookupAnswering(publicAddress, privateAddress));

    const { error } = await ask(lookup, "mixed.example.com", true);

    expect(error?.message).toMatch(/resolves to 10\.0\.0\.5/);
  });

  it("forwards a resolution error as it came", async () => {
    const notFound = Object.assign(new Error("getaddrinfo ENOTFOUND nowhere.invalid"), {
      code: "ENOTFOUND",
    });
    const resolve = vi.fn<LookupFunction>((_hostname, _options, callback) => {
      callback(notFound, "");
    });

    const { error } = await ask(createGuardedLookup(resolve), "nowhere.invalid", false);

    expect(error).toBe(notFound);
  });

  it("resolves localhost with the real resolver and refuses it", async () => {
    const { error } = await ask(createGuardedLookup(), "localhost", true);

    expect(error?.message).toMatch(/^refused: localhost resolves to (127\.0\.0\.1|::1)/);
  });
});
