export type PageCursor = { at: Date; id: string };

const cursorPattern =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

// opaco de propósito: quem consome a API não deve depender do formato
export function encodeCursor({ at, id }: PageCursor) {
  return Buffer.from(`${at.toISOString()}_${id}`).toString("base64url");
}

export function decodeCursor(value: string): PageCursor | null {
  const match = cursorPattern.exec(Buffer.from(value, "base64url").toString("utf8"));
  if (match === null) return null;

  const [, isoDate = "", id = ""] = match;
  const at = new Date(isoDate);
  return Number.isNaN(at.getTime()) ? null : { at, id };
}
