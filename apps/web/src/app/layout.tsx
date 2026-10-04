import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Public_Sans } from "next/font/google";
import "./globals.css";

const publicSans = Public_Sans({ subsets: ["latin"], variable: "--font-public-sans" });

export const metadata: Metadata = {
  title: { default: "Webhook Relay", template: "%s · Webhook Relay" },
  description: "Entrega de webhooks com retentativas, fila de mortas e reenvio.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={publicSans.variable}>
      <body>{children}</body>
    </html>
  );
}
