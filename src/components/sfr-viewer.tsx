"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { hex } from "@/lib/format";
import type { TraceResult } from "@/lib/trace";
import type { SfrIp, SfrModel, SfrModule, SfrSubsystem, SfrSystem, TagInfo } from "@/lib/types";
import { useApi, useStream } from "@/lib/use-api";
import { IconChevron, IconDoc, IconFolder } from "./icons";
import { AccessLegend, RegmapTable } from "./regmap";
import { ModuleDetail } from "./register-detail";
import { PageHeader } from "./shell";
import { TagSelect } from "./tag-select";
import { Badge, Card, ErrorBox, ProgressPanel, Spinner, cx } from "./ui";

type FlatMod = { system: string; subsystem: string; ip: string; mod: SfrModule };

function flatten(model: SfrModel): FlatMod[] {
  const out: FlatMod[] = [];
  for (const sys of model.systems)
    for (const sub of sys.subsystems)
      for (const ip of sub.ips)
        for (const mod of ip.modules) out.push({ system: sys.name, subsystem: sub.name, ip: ip.name, mod });
  return out;
}

// ---------------- tree ----------------

function Tree({
  model,
  sel,
  onSelect,
  filter,
}: {
  model: SfrModel;
  sel?: string | null;
  onSelect: (sel: string) => void;
  filter: string;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const f = filter.trim().toLowerCase();
  const matches = (s: string) => !f || s.toLowerCase().includes(f);

  return (
    <div className="flex flex-col gap-0.5 text-[12.5px]">
      {model.systems.map((sys: SfrSystem) => (
        <div key={sys.name}>
          {sys.subsystems.map((sub: SfrSubsystem) => {
            const subId = `${sys.name}/${sub.name}`;
            const subCollapsed = collapsed.has(subId) && !f;
            const visibleIps = sub.ips.filter(
              (ip) => matches(ip.name) || ip.modules.some((m) => matches(m.file) || m.regs.some((r) => matches(r.name)))
            );
            if (f && !visibleIps.length && !matches(sub.name)) return null;
            return (
              <div key={sub.name}>
                <button
                  onClick={() => toggle(subId)}
                  className="flex w-full cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-left font-medium text-neutral-700 transition-colors hover:bg-neutral-100"
                >
                  <IconChevron size={11} className={cx("text-neutral-400 transition-transform duration-200", !subCollapsed && "rotate-90")} />
                  <IconFolder size={13} className="text-neutral-400" />
                  {sub.name}
                </button>
                <div
                  className={cx(
                    "grid transition-[grid-template-rows] duration-200",
                    subCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
                  )}
                >
                  <div className="overflow-hidden">
                    {(f ? visibleIps : sub.ips).map((ip: SfrIp) => {
                      const ipId = `ip:${sys.name}/${sub.name}/${ip.name}`;
                      const ipCollapsed = collapsed.has(ipId) && !f;
                      const regCount = ip.modules.reduce((n, m) => n + m.regs.length, 0);
                      return (
                        <div key={ip.name}>
                          <div
                            className={cx(
                              "group flex items-center rounded-md transition-colors",
                              sel === ipId ? "bg-neutral-900 text-white" : "hover:bg-neutral-100"
                            )}
                          >
                            <button
                              onClick={() => toggle(ipId)}
                              className="cursor-pointer py-1 pl-5"
                              aria-label="expand"
                            >
                              <IconChevron
                                size={11}
                                className={cx("transition-transform duration-200", sel === ipId ? "text-neutral-400" : "text-neutral-400", !ipCollapsed && "rotate-90")}
                              />
                            </button>
                            <button
                              onClick={() => onSelect(ipId)}
                              className="flex flex-1 cursor-pointer items-center gap-1.5 py-1 pl-1 text-left font-mono text-[12px]"
                            >
                              {ip.name}
                              <span className={cx("ml-auto pr-2 font-mono text-[9.5px]", sel === ipId ? "text-neutral-400" : "text-neutral-400")}>
                                {regCount}
                              </span>
                            </button>
                          </div>
                          <div
                            className={cx(
                              "grid transition-[grid-template-rows] duration-200",
                              ipCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
                            )}
                          >
                            <div className="overflow-hidden">
                              {ip.modules
                                .filter((m) => !f || matches(m.file) || m.regs.some((r) => matches(r.name)))
                                .map((mod) => (
                                  <button
                                    key={mod.path}
                                    onClick={() => onSelect(mod.path)}
                                    className={cx(
                                      "flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 pl-10 text-left font-mono text-[11.5px] transition-colors",
                                      sel === mod.path ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
                                    )}
                                  >
                                    <IconDoc size={11} className="shrink-0 opacity-60" />
                                    <span className="truncate">{mod.file}</span>
                                  </button>
                                ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ---------------- main views ----------------

function OverviewCards({ model, onSelect }: { model: SfrModel; onSelect: (sel: string) => void }) {
  return (
    <div className="fade-up flex flex-col gap-6">
      {model.systems.map((sys) => (
        <div key={sys.name}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sys.subsystems.map((sub) => (
              <Card key={sub.name} hover className="p-4">
                <div className="mb-2 flex items-center gap-2">
                  <IconFolder size={14} className="text-neutral-400" />
                  <span className="text-[13px] font-semibold">{sub.name}</span>
                  <span className="ml-auto text-[10.5px] text-neutral-400">
                    {sub.ips.length} IPs ·{" "}
                    {sub.ips.reduce((n, ip) => n + ip.modules.reduce((m, x) => m + x.regs.length, 0), 0)} regs
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {sub.ips.map((ip) => (
                    <button
                      key={ip.name}
                      onClick={() => onSelect(`ip:${sys.name}/${sub.name}/${ip.name}`)}
                      className="cursor-pointer rounded-md border border-neutral-200 px-2 py-1 font-mono text-[11px] text-neutral-600 transition-all duration-150 hover:border-neutral-900 hover:bg-neutral-900 hover:text-white"
                    >
                      {ip.name}
                    </button>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function IpRegmap({
  model,
  ipSel,
  onSelectModule,
  onFieldClick,
}: {
  model: SfrModel;
  ipSel: string; // ip:sys/sub/ip
  onSelectModule: (path: string) => void;
  onFieldClick: (modPath: string, reg: string, field: string) => void;
}) {
  const [, path] = ipSel.split(":");
  const [sysName, subName, ipName] = path.split("/");
  const sys = model.systems.find((s) => s.name === sysName);
  const sub = sys?.subsystems.find((s) => s.name === subName);
  const ip = sub?.ips.find((i) => i.name === ipName);
  if (!ip) return <ErrorBox message={`IP not found: ${path}`} />;

  const regCount = ip.modules.reduce((n, m) => n + m.regs.length, 0);
  const fieldCount = ip.modules.reduce((n, m) => n + m.regs.reduce((x, r) => x + r.fields.length, 0), 0);

  return (
    <div className="fade-up flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-mono text-lg font-bold tracking-tight">{ip.name}</h2>
        <span className="text-xs text-neutral-400">
          {subName}
        </span>
        <span className="ml-auto flex gap-2">
          <Badge kind="outline">{ip.modules.length} modules</Badge>
          <Badge kind="outline">{regCount} registers</Badge>
          <Badge kind="outline">{fieldCount} fields</Badge>
        </span>
      </div>
      <p className="-mt-2 text-[11px] text-neutral-400">
        Register map at a glance — hover a field for details, click to open the register table, click a module name for
        the detailed view.
      </p>
      <AccessLegend regs={ip.modules.flatMap((m) => m.regs)} />
      <RegmapTable
        groups={ip.modules.map((m) => ({
          id: m.path,
          title: m.file,
          sub: `addrmap ${m.addrmap}`,
          regs: m.regs,
        }))}
        onGroupClick={onSelectModule}
        onFieldClick={(modPath, reg, field) => onFieldClick(modPath, reg.name, field.name)}
      />
    </div>
  );
}

function ModuleView({
  flat,
  path,
  reg,
  field,
  onBack,
  project,
  tag,
}: {
  flat: FlatMod[];
  path: string;
  reg?: string | null;
  field?: string | null;
  onBack: (ipSel: string) => void;
  project: string;
  tag?: string | null;
}) {
  const { data: trace } = useApi<TraceResult>(`/api/projects/${project}/trace${tag ? `?ref=${encodeURIComponent(tag)}` : ""}`);
  const entry = flat.find((x) => x.mod.path === path);
  if (!entry) return <ErrorBox message={`Module not found at this tag: ${path}`} />;
  const { system, subsystem, ip, mod } = entry;
  const addrSpan = mod.regs.length
    ? `${hex(Math.min(...mod.regs.map((r) => r.offset)), 4)} – ${hex(Math.max(...mod.regs.map((r) => r.offset)), 4)}`
    : "—";

  return (
    <div className="fade-up flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <button
          onClick={() => onBack(`ip:${system}/${subsystem}/${ip}`)}
          className="cursor-pointer font-mono text-xs text-neutral-400 underline-offset-2 transition-colors hover:text-neutral-900 hover:underline"
        >
          ← {ip}
        </button>
        <h2 className="font-mono text-lg font-bold tracking-tight">{mod.file}</h2>
        <span className="text-xs text-neutral-400">addrmap {mod.addrmap}</span>
        <span className="ml-auto flex gap-2">
          <Badge kind="outline">{mod.regs.length} registers</Badge>
          <Badge kind="outline">{addrSpan}</Badge>
        </span>
      </div>
      {mod.desc && <p className="-mt-2 max-w-3xl text-xs leading-relaxed text-neutral-500">{mod.desc}</p>}
      <ModuleDetail mod={mod} highlightReg={reg} highlightField={field} project={project} regUsedBy={trace?.regUsedBy} />
    </div>
  );
}

// ---------------- orchestrator ----------------

export function SfrViewer({ project, projectName }: { project: string; projectName: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const tag = sp.get("tag");
  const sel = sp.get("sel");
  const reg = sp.get("reg");
  const field = sp.get("field");
  const [filter, setFilter] = useState("");

  const { data: tagsData } = useApi<{ tags: TagInfo[] }>(`/api/projects/${project}/tags?kind=sfr`);
  const { data: model, error, loading, progress } = useStream<SfrModel>(
    `/api/projects/${project}/sfr/stream${tag ? `?ref=${encodeURIComponent(tag)}` : ""}`
  );

  const flat = useMemo(() => (model ? flatten(model) : []), [model]);

  const setParams = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };

  // scroll to highlighted register
  useEffect(() => {
    if (reg && sel && !sel.startsWith("ip:") && model) {
      const el = document.getElementById(`reg-${sel}-${reg}`);
      el?.scrollIntoView({ block: "center" });
    }
  }, [reg, sel, model]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={
          <>
            SFR Viewer <span className="ml-1 font-mono text-xs font-normal text-neutral-400">{projectName}</span>
          </>
        }
        sub={
          model
            ? `${model.totals.modules} modules · ${model.totals.regs} registers · ${model.totals.fields} fields @ ${model.ref}`
            : " "
        }
      >
        {tagsData && <TagSelect tags={tagsData.tags} value={tag} onChange={(t) => setParams({ tag: t, reg: null, field: null })} />}
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-white">
          <div className="p-2.5 pb-1">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter tree…"
              className="h-7 w-full rounded-md border border-neutral-200 bg-neutral-50 px-2 text-xs outline-none placeholder:text-neutral-400 focus:border-neutral-500"
            />
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {model ? (
              <Tree model={model} sel={sel} onSelect={(s) => setParams({ sel: s, reg: null, field: null })} filter={filter} />
            ) : (
              <Spinner />
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto p-6">
          {error && <ErrorBox message={error} />}
          {loading && !model && (
            <ProgressPanel title="Parsing SystemRDL…" label={progress?.label} done={progress?.done} total={progress?.total} />
          )}
          {model && !sel && <OverviewCards model={model} onSelect={(s) => setParams({ sel: s })} />}
          {model && sel?.startsWith("ip:") && (
            <IpRegmap
              model={model}
              ipSel={sel}
              onSelectModule={(path) => setParams({ sel: path })}
              onFieldClick={(modPath, r, f) => setParams({ sel: modPath, reg: r, field: f })}
            />
          )}
          {model && sel && !sel.startsWith("ip:") && (
            <ModuleView flat={flat} path={sel} reg={reg} field={field} project={project} tag={tag} onBack={(ipSel) => setParams({ sel: ipSel, reg: null, field: null })} />
          )}
        </div>
      </div>
    </div>
  );
}
