import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // No monorepo o Next precisa enxergar a raiz para incluir as dependências no build standalone
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
};

export default nextConfig;
