import type { ReactNode } from "react";
import { Brand } from "./brand";
import { NavRail } from "./nav-rail";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <a
        href="#conteudo"
        className="sr-only z-30 rounded-sm bg-primary px-3 py-2 text-sm text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Ir para o conteúdo
      </a>
      <NavRail />
      <div className="pb-16 md:pb-0 md:pl-55">
        <header className="flex h-12 items-center bg-sidebar px-4 text-sidebar-foreground md:hidden">
          <Brand />
        </header>
        <main id="conteudo" className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-9">
          {children}
        </main>
      </div>
    </div>
  );
}
