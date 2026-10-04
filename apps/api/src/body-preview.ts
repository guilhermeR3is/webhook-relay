import { isUtf8 } from "node:buffer";

const PREVIEW_BYTES = 16 * 1024;

export type BodyPreview = { size: number; text: string | null; truncated: boolean };

export function previewBody(body: Uint8Array): BodyPreview {
  const size = body.byteLength;
  if (!isUtf8(body)) return { size, text: null, truncated: false };

  const truncated = size > PREVIEW_BYTES;
  // stream descarta o pedaço de caractere que o corte deixou pela metade, em vez de virar U+FFFD
  const text = new TextDecoder().decode(body.subarray(0, PREVIEW_BYTES), { stream: truncated });
  return { size, text, truncated };
}
