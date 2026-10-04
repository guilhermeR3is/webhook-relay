const TOKEN_LIKE_SEGMENT = /^[\w-]{16,}$/;

// a URL de um destino pode carregar um caminho secreto (webhook do n8n, por exemplo)
export function redactDestinationUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "(invalid URL)";
  }

  const path = parsed.pathname
    .split("/")
    .map((segment) => (TOKEN_LIKE_SEGMENT.test(segment) ? "…" : segment))
    .join("/");
  return `${parsed.protocol}//${parsed.host}${path}`;
}
