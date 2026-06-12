"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  IconChip,
  IconCode,
  IconCompare,
  IconDelta,
  IconGear,
  IconGrid,
  IconPulse,
  IconSearch,
} from "./icons";
import { Logo } from "./logo";
import { SectionLabel, cx } from "./ui";

export interface ProjectMeta {
  id: string;
  name: string;
  codename?: string;
}

function NavLink({ href, active, children, icon }: { href: string; active: boolean; children: ReactNode; icon?: ReactNode }) {
  return (
    <Link
      href={href}
      className={cx(
        "group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-all duration-150",
        active ? "bg-neutral-900 font-medium text-white" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
      )}
    >
      <span className={cx("transition-colors", active ? "text-neutral-300" : "text-neutral-400 group-hover:text-neutral-600")}>
        {icon}
      </span>
      {children}
    </Link>
  );
}

export function Sidebar({ projects, onOpenSearch }: { projects: ProjectMeta[]; onOpenSearch: () => void }) {
  const pathname = usePathname();
  const router = useRouter();

  const seg = pathname.split("/").filter(Boolean);
  const activeProject = projects.find((p) => p.id === seg[0])?.id ?? projects[0]?.id;
  const subPath = projects.some((p) => p.id === seg[0]) ? seg.slice(1).join("/") : "";

  const switchProject = (id: string) => {
    router.push(`/${id}/${subPath || "sfr"}`);
  };

  const is = (suffix: string) => pathname === `/${activeProject}/${suffix}`;

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-neutral-200 bg-white">
      <Link href="/" className="group/logo flex items-center gap-2.5 px-4 pt-5 pb-4 text-neutral-900">
        <Logo className="h-8 w-8" />
        <span className="text-[13px] leading-tight font-semibold tracking-tight">
          Interface
          <br />
          Manager
        </span>
      </Link>

      <button
        onClick={onOpenSearch}
        className="mx-3 mb-4 flex h-8 cursor-pointer items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-2.5 text-xs text-neutral-400 transition-colors hover:border-neutral-400 hover:text-neutral-600"
      >
        <IconSearch size={13} />
        Search…
        <kbd className="ml-auto rounded border border-neutral-200 bg-white px-1 font-mono text-[10px] text-neutral-400">⌘K</kbd>
      </button>

      <div className="px-3">
        <SectionLabel className="px-1 pb-1.5">Project</SectionLabel>
        <div className="mb-4 flex flex-col gap-0.5 rounded-lg border border-neutral-200 p-1">
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => switchProject(p.id)}
              className={cx(
                "flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] transition-all duration-150",
                p.id === activeProject ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"
              )}
            >
              <span className="font-medium">{p.name}</span>
              <span className={cx("font-mono text-[9.5px]", p.id === activeProject ? "text-neutral-400" : "text-neutral-400")}>
                {p.codename}
              </span>
            </button>
          ))}
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3">
        <SectionLabel className="px-1 pt-1 pb-1.5">SFR — Register Level</SectionLabel>
        <NavLink href={`/${activeProject}/sfr`} active={is("sfr")} icon={<IconChip size={15} />}>
          Viewer
        </NavLink>
        <NavLink href={`/${activeProject}/sfr/changelog`} active={is("sfr/changelog")} icon={<IconDelta size={14} />}>
          Changelog
        </NavLink>
        <NavLink href={`/${activeProject}/sfr/stats`} active={is("sfr/stats")} icon={<IconPulse size={15} />}>
          Statistics
        </NavLink>

        <SectionLabel className="px-1 pt-4 pb-1.5">HAL — Function Level</SectionLabel>
        <NavLink href={`/${activeProject}/hal`} active={is("hal")} icon={<IconCode size={15} />}>
          Viewer
        </NavLink>
        <NavLink href={`/${activeProject}/hal/changelog`} active={is("hal/changelog")} icon={<IconDelta size={14} />}>
          Changelog
        </NavLink>
        <NavLink href={`/${activeProject}/hal/stats`} active={is("hal/stats")} icon={<IconPulse size={15} />}>
          Statistics
        </NavLink>

        <SectionLabel className="px-1 pt-4 pb-1.5">Analysis</SectionLabel>
        <NavLink href="/" active={pathname === "/"} icon={<IconGrid size={15} />}>
          Overview
        </NavLink>
        <NavLink href="/compare" active={pathname === "/compare"} icon={<IconCompare size={15} />}>
          Project Compare
        </NavLink>
        <NavLink href="/ip-diff" active={pathname === "/ip-diff"} icon={<IconChip size={15} />}>
          IP Compare
        </NavLink>
      </nav>

      <div className="border-t border-neutral-200 px-3 py-3">
        <NavLink href="/settings" active={pathname === "/settings"} icon={<IconGear size={15} />}>
          Settings
        </NavLink>
      </div>
    </aside>
  );
}
