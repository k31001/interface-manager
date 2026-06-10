"use client";

import { type ReactNode, useEffect, useState } from "react";
import { CommandPalette } from "./command-palette";
import { type ProjectMeta, Sidebar } from "./sidebar";

export function Shell({ projects, children }: { projects: ProjectMeta[]; children: ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar projects={projects} onOpenSearch={() => setSearchOpen(true)} />
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      <CommandPalette key={searchOpen ? "open" : "closed"} open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

export function PageHeader({
  title,
  sub,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-30 flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b border-neutral-200 bg-[#fafafa]/90 px-6 py-2.5 backdrop-blur">
      <div>
        <h1 className="text-[15px] font-semibold tracking-tight text-neutral-900">{title}</h1>
        {sub && <div className="text-[11px] text-neutral-400">{sub}</div>}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
