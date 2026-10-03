import { lookup as resolveName } from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";

const NON_PUBLIC_IPV4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

// 6to4, Teredo e NAT64 carregam um IPv4 dentro do endereço, então ficam de fora por inteiro
const NON_PUBLIC_IPV6: [string, number][] = [
  ["::", 96],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
];

const nonPublicAddresses = new BlockList();
for (const [network, prefix] of NON_PUBLIC_IPV4) {
  nonPublicAddresses.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of NON_PUBLIC_IPV6) {
  nonPublicAddresses.addSubnet(network, prefix, "ipv6");
}

export function isPublicAddress(address: string) {
  const withoutZone = address.split("%")[0] ?? address;
  const family = isIP(withoutZone);
  if (family === 0) {
    return false;
  }
  // o BlockList aplica as regras de IPv4 também a ::ffff:a.b.c.d
  return !nonPublicAddresses.check(withoutZone, family === 4 ? "ipv4" : "ipv6");
}

export function refusalReason(hostname: string, address: string) {
  return hostname === address
    ? `refused: ${address} is not a public address`
    : `refused: ${hostname} resolves to ${address}, which is not a public address`;
}

// o connect não chama o lookup quando o host já é um IP, então esse caso é checado antes
export function literalAddressRefusal(hostname: string) {
  const address = hostname.replace(/^\[|\]$/g, "");
  return isIP(address) !== 0 && !isPublicAddress(address)
    ? refusalReason(address, address)
    : undefined;
}

// valida o IP que o próprio socket vai usar, então um DNS que muda de resposta entre a checagem e a conexão (rebinding) não passa
export function createGuardedLookup(resolve: LookupFunction = resolveName): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, options, (error, address, family) => {
      if (error !== null) {
        callback(error, address, family);
        return;
      }
      const resolved =
        typeof address === "string" ? [address] : address.map((entry) => entry.address);
      const blocked = resolved.find((candidate) => !isPublicAddress(candidate));
      if (blocked !== undefined) {
        callback(new Error(refusalReason(hostname, blocked)), "", undefined);
        return;
      }
      callback(null, address, family);
    });
  };
}
