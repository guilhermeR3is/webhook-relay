export type RawParams = Record<string, string | string[] | undefined>;

export function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
