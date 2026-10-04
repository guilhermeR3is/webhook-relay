"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Brand } from "./brand";

const lines = [
  { href: "/events", label: "Eventos" },
  { href: "/dead", label: "Mortas" },
  { href: "/destinations", label: "Destinos" },
] as const;

function isCurrent(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavRail() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Principal"
      className="fixed inset-x-0 bottom-0 z-20 flex h-16 border-t border-sidebar-border bg-sidebar text-sidebar-foreground md:inset-y-0 md:right-auto md:h-auto md:w-55 md:flex-col md:border-t-0 md:border-r md:px-5 md:py-7"
    >
      <Link
        href="/events"
        className="mb-10 hidden rounded-sm text-sidebar-foreground outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring md:block"
      >
        <Brand />
      </Link>
      <ul className="relative flex flex-1 md:flex-none md:flex-col md:gap-1 md:before:absolute md:before:top-5 md:before:bottom-5 md:before:left-2.75 md:before:w-px md:before:bg-sidebar-border">
        {lines.map((line) => {
          const current = isCurrent(pathname, line.href);
          return (
            <li key={line.href} className="flex flex-1 md:block">
              <Link
                href={line.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "relative flex flex-1 flex-col items-center justify-center gap-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring md:flex-none md:flex-row md:justify-start md:gap-0 md:rounded-sm md:py-2.5 md:pl-9",
                  current
                    ? "font-semibold text-sidebar-accent-foreground"
                    : "text-sidebar-muted-foreground hover:text-sidebar-accent-foreground",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-3 rounded-full border-2 md:absolute md:top-1/2 md:left-1.5 md:-translate-y-1/2 md:bg-sidebar",
                    current
                      ? "border-sidebar-primary bg-sidebar-primary md:bg-sidebar-primary"
                      : "border-sidebar-muted-foreground",
                  )}
                />
                {line.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
