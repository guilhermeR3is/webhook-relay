import { existsSync } from "node:fs";
import type { NextConfig } from "next";

// o Next só lê o .env da própria pasta; o do repositório fica na raiz e não vale sobre variáveis já definidas
const rootEnv = new URL("../../.env", import.meta.url);
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

const nextConfig: NextConfig = {
  output: "standalone",
  // sem isto o next dev recria AGENTS.md e CLAUDE.md na pasta do app a cada execução
  agentRules: false,
  // No monorepo o Next precisa enxergar a raiz para incluir as dependências no build standalone
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
};

export default nextConfig;
