export function countOf(amount: number, one: string, many: string) {
  return `${String(amount)} ${amount === 1 ? one : many}`;
}
