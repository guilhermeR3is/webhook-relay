import { createHmac } from "node:crypto";
import { isIPv6 } from "node:net";

const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/;

function expandIpv6(address: string) {
  const [left = "", right] = address.split("::");
  const leftParts = left === "" ? [] : left.split(":");
  const rightParts = right === undefined || right === "" ? [] : right.split(":");
  const zeros =
    right === undefined ? [] : Array<string>(8 - leftParts.length - rightParts.length).fill("0");
  return [...leftParts, ...zeros, ...rightParts].map((part) => part.padStart(4, "0"));
}

// quem tem IPv6 recebe um bloco inteiro (/64) e troca de endereço à vontade: a cota vale para o bloco
export function normalizeVisitorAddress(address: string) {
  const lower = address.toLowerCase();
  const mapped = IPV4_MAPPED.exec(lower);
  if (mapped?.[1]) return mapped[1];
  if (!isIPv6(lower)) return lower;
  return `${expandIpv6(lower).slice(0, 4).join(":")}::/64`;
}

// o banco guarda só o HMAC: o repositório e o banco da demonstração são públicos e IP é dado pessoal
export function visitorKey(address: string, salt: string) {
  return createHmac("sha256", salt).update(normalizeVisitorAddress(address)).digest("hex");
}
