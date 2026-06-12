"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { hex } from "@/lib/format";
import type { IpDiffResult, IpRegDiff } from "@/lib/ip-diff";
import { useApi } from "@/lib/use-api";
import { ChangeLine, CountChips } from "./changelog-common";
import { IconArrowRight, IconChip } from "./icons";
import { PageHeader } from "./shell";
import { Badge, Card, Empty, ErrorBox, SectionLabel, Select, Spinner, StatusBadge, cx } from "./ui";

interface ProjectMeta {
  id: string;
  name: string;
  codename?: string;
}

function RegRow({ rd }: { rd: IpRegDiff }) {
  if (rd.status === "same") {
    return (
      <div className="flex items-center gap-2.5 border-t border-neutral-100 px-4 py-1.5 text-neutral-400">
        <Badge kind="neutral">= same</Badge>
        <span className="font-mono text-[11.5px]">{rd.name}</span>
        <span className="font-mono text-[10px]">{hex(rd.offset, 4)}</span>
      </div>
    );
  }
  return (
    <div className="border-t border-neutral-100 px-4 py-2 first:border-0">
      <div className="flex flex-wrap items-center gap-2.5">
        <StatusBadge status={rd.status} />
        <span className="font-mono text-[12px] font-bold">{rd.name}</span>
        <span className="font-mono text-[10px] text-neutral-400">{hex(rd.offset, 4)}</span>
        <span className="ml-auto flex flex-wrap gap-x-3">
          {rd.changes
            .filter((c) => c.prop !== "desc")
            .map((c, i) => (
              <ChangeLine key={i} prop={c.prop} from={c.from} to={c.to} />
            ))}
        </span>
      </div>
      {rd.fields.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1">
          {rd.fields.map((fd) => (
            <span key={`${fd.name}-${fd.status}`} className="inline-flex flex-wrap items-center gap-1.5 pl-6">
              <StatusBadge status={fd.status} />
              <span className="font-mono text-[11px] font-medium">{fd.name}</span>
              {fd.bits && <span className="font-mono text-[10px] text-neutral-400">{fd.bits}</span>}
              {fd.changes
                .filter((c) => c.prop !== "desc")
                .map((c, i) => (
                  <ChangeLine key={i} prop={c.prop} from={c.from} to={c.to} />
                ))}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function IpDiffView({ projects }: { projects: ProjectMeta[] }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const a = sp.get("a") ?? projects[0]?.id ?? "";
  const b = sp.get("b") ?? projects[1]?.id ?? projects[0]?.id ?? "";
  const ip = sp.get("ip");

  const set = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };

  const { data, error, loading } = useApi<IpDiffResult>(
    a && b ? `/api/ip-diff?a=${a}&b=${b}${ip ? `&ip=${encodeURIComponent(ip)}` : ""}` : null
  );
  const ips = data?.commonIps ?? [];
  const showDiff = !!ip && !!data?.modules;
  const onlyChanges = data?.modules?.flatMap((m) => m.regs).every((r) => r.status === "same");

  const nameOf = (id: string) => projects.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="IP Compare" sub="diff the same IP across two projects — see where a derivative diverged from its base">
        {projects.length > 0 && (
          <span className="flex items-center gap-1.5">
            <Select value={a} onChange={(e) => set({ a: e.target.value })} className="w-32">
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <IconArrowRight size={13} className="text-neutral-400" />
            <Select value={b} onChange={(e) => set({ b: e.target.value })} className="w-32">
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </span>
        )}
      </PageHeader>

      <div className="flex-1 overflow-y-auto p-6">
        {projects.length < 2 ? (
          <ErrorBox message="Need at least two configured projects to compare IPs." />
        ) : (
          <div className="mx-auto flex max-w-5xl flex-col gap-4">
            {/* IP picker */}
            {ips.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <SectionLabel className="mr-1">common IP</SectionLabel>
                {ips.map((name) => (
                  <button
                    key={name}
                    onClick={() => set({ ip: name })}
                    className={cx(
                      "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 font-mono text-xs transition-all duration-150",
                      ip === name ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400"
                    )}
                  >
                    <IconChip size={12} />
                    {name}
                  </button>
                ))}
              </div>
            )}

            {error && <ErrorBox message={error} />}
            {loading && !data && <Spinner label="Loading projects…" />}
            {data && !ip && ips.length > 0 && <Empty>Pick a common IP above to compare {nameOf(a)} vs {nameOf(b)}.</Empty>}
            {data && !ip && ips.length === 0 && <Empty>{nameOf(a)} and {nameOf(b)} share no IP of the same name.</Empty>}

            {showDiff && data && (
              <>
                <div className="fade-up flex flex-wrap items-center gap-x-6 gap-y-2">
                  <span className="flex items-center gap-2 font-mono text-sm font-bold">
                    <IconChip size={15} />
                    {data.ip}
                    <span className="font-sans text-[11px] font-normal text-neutral-400">
                      {nameOf(a)} <span className="font-mono">{data.a.ref}</span> → {nameOf(b)} <span className="font-mono">{data.b.ref}</span>
                    </span>
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    <SectionLabel>registers</SectionLabel>
                    <CountChips counts={data.summary.regs} noun="register" />
                  </span>
                  <span className="flex items-center gap-2">
                    <SectionLabel>fields</SectionLabel>
                    <CountChips counts={data.summary.fields} noun="field" />
                  </span>
                </div>

                {onlyChanges && (
                  <Empty>
                    {data.ip} is identical in {nameOf(a)} and {nameOf(b)} — full reuse.
                  </Empty>
                )}

                {data.modules.map((m) => {
                  const changed = m.regs.filter((r) => r.status !== "same");
                  if (!changed.length && m.status === "common") return null;
                  return (
                    <Card key={m.file} className="fade-up overflow-hidden">
                      <div
                        className={cx(
                          "flex flex-wrap items-center gap-2.5 border-b border-neutral-200 px-4 py-2",
                          m.status === "added" ? "bg-emerald-50/50" : m.status === "removed" ? "bg-red-50/50" : "bg-neutral-50/60"
                        )}
                      >
                        <span className="font-mono text-[11.5px] font-semibold text-neutral-700">{m.file}</span>
                        {m.status !== "common" && <StatusBadge status={m.status} />}
                        <span className="ml-auto font-mono text-[10px] text-neutral-400">
                          {changed.length} of {m.regs.length} registers differ
                        </span>
                      </div>
                      {m.regs.map((rd) => (
                        <RegRow key={`${rd.name}-${rd.status}`} rd={rd} />
                      ))}
                    </Card>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
