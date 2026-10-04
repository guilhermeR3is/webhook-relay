const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export function formatBodySize(bytes: number) {
  if (bytes < 1024) return `${String(bytes)} ${bytes === 1 ? "byte" : "bytes"}`;
  const kibibytes = Math.round((bytes / 1024) * 10) / 10;
  if (kibibytes < 1024) return `${decimal.format(kibibytes)} KiB`;
  return `${decimal.format(bytes / (1024 * 1024))} MiB`;
}
