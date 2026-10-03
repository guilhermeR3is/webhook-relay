import type { ReactNode } from "react";

export const metadata = {
  title: "Webhook Relay",
  description: "Entrega de webhooks com retentativas, fila de mortas e reenvio.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
