"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { HalClass, HalFile, HalFn, HalModel, TagInfo } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { IconDoc, IconFn, IconFolder } from "./icons";
import { PageHeader } from "./shell";
import { TagSelect } from "./tag-select";
import { Badge, Card, ErrorBox, SectionLabel, Spinner, cx } from "./ui";

// ---------- signature rendering ----------

export function Signature({ fn, compact }: { fn: HalFn; compact?: boolean }) {
  const multi = !compact && fn.params.length > 2;
  return (
    <code className="block font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
      <span className="text-neutral-500">{fn.ret}</span> <span className="font-bold text-neutral-900">{fn.name}</span>
      <span className="text-neutral-400">(</span>
      {fn.params.map((p, i) => (
        <span key={i}>
          {multi && <br />}
          {multi && <span>{"    "}</span>}
          <span className="text-neutral-500">{p.type}</span> <span className="text-neutral-800">{p.name}</span>
          {p.def && <span className="text-neutral-400"> = {p.def}</span>}
          {i < fn.params.length - 1 && <span className="text-neutral-400">, </span>}
        </span>
      ))}
      {multi && <br />}
      <span className="text-neutral-400">)</span>
      {fn.isConst && <span className="text-neutral-500"> const</span>}
    </code>
  );
}

export function FunctionCard({ cls, fn, flash, anchorId }: { cls: string; fn: HalFn; flash?: boolean; anchorId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (flash) ref.current?.scrollIntoView({ block: "center" });
  }, [flash]);

  return (
    <Card className={cx("fade-up overflow-hidden", flash && "flash-ring")}>
      <div ref={ref} id={anchorId} className="border-b border-neutral-200 bg-neutral-50/60 px-4 py-3">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="font-mono text-[10.5px] text-neutral-400">{cls}::</span>
          <span className="-ml-1.5 font-mono text-[13px] font-bold">{fn.name}</span>
          {fn.deprecated !== undefined && <Badge kind="warn">deprecated</Badge>}
          {fn.isConst && <Badge kind="outline">const</Badge>}
        </div>
        <Signature fn={fn} />
      </div>
      <div className="flex flex-col gap-2.5 px-4 py-3">
        {fn.brief && <p className="text-xs leading-relaxed text-neutral-700">{fn.brief}</p>}
        {fn.deprecated && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11.5px] text-red-700">
            <span className="font-semibold">Deprecated.</span> {fn.deprecated}
          </p>
        )}
        {fn.params.length > 0 && (
          <table className="w-full text-xs">
            <tbody>
              {fn.params.map((p) => (
                <tr key={p.name} className="border-t border-neutral-100 first:border-0">
                  <td className="w-36 py-1.5 pr-3 align-top font-mono text-[11px] font-semibold whitespace-nowrap">{p.name}</td>
                  <td className="w-44 py-1.5 pr-3 align-top font-mono text-[10.5px] whitespace-nowrap text-neutral-400">{p.type}</td>
                  <td className="py-1.5 leading-relaxed text-neutral-500">{p.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {fn.returns && (
          <div className="flex gap-2 text-xs">
            <span className="shrink-0 font-mono text-[10px] tracking-wider text-neutral-400 uppercase">returns</span>
            <span className="leading-relaxed text-neutral-600">{fn.returns}</span>
          </div>
        )}
        {fn.notes.map((n, i) => (
          <div key={i} className="flex gap-2 rounded-md bg-neutral-50 px-3 py-2 text-[11.5px] text-neutral-500">
            <span className="font-mono text-[10px] tracking-wider text-neutral-400 uppercase">note</span>
            {n}
          </div>
        ))}
        {fn.warnings.map((w, i) => (
          <div key={i} className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800">
            <span className="font-mono text-[10px] tracking-wider uppercase">warning</span>
            {w}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------- tree ----------

function HalTree({ model, sel, onSelect, filter }: { model: HalModel; sel?: string | null; onSelect: (rel: string) => void; filter: string }) {
  const f = filter.trim().toLowerCase();
  const groups = useMemo(() => {
    const map = new Map<string, HalFile[]>();
    for (const file of model.files) {
      const dir = file.rel.includes("/") ? file.rel.split("/")[0] : ".";
      if (!map.has(dir)) map.set(dir, []);
      map.get(dir)!.push(file);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [model]);

  return (
    <div className="flex flex-col gap-0.5 text-[12.5px]">
      {groups.map(([dir, files]) => {
        const visible = files.filter(
          (file) =>
            !f ||
            file.rel.toLowerCase().includes(f) ||
            file.classes.some((c) => c.name.toLowerCase().includes(f) || c.fns.some((x) => x.name.toLowerCase().includes(f)))
        );
        if (!visible.length) return null;
        return (
          <div key={dir}>
            <div className="flex items-center gap-1.5 px-2 py-1.5 font-medium text-neutral-700">
              <IconFolder size={13} className="text-neutral-400" />
              {dir}/
            </div>
            {visible.map((file) => (
              <div key={file.rel}>
                <button
                  onClick={() => onSelect(file.rel)}
                  className={cx(
                    "flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1.5 pr-2 pl-6 text-left font-mono text-[11.5px] transition-colors",
                    sel === file.rel ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"
                  )}
                >
                  <IconDoc size={11} className="shrink-0 opacity-60" />
                  <span className="truncate">{file.rel.split("/").pop()}</span>
                  <span className={cx("ml-auto font-mono text-[9.5px]", "text-neutral-400")}>
                    {file.classes.reduce((n, c) => n + c.fns.length, 0)}
                  </span>
                </button>
                {sel === file.rel &&
                  file.classes.map((c) => (
                    <div key={c.name} className="border-l border-neutral-200 py-0.5 pl-8 font-mono text-[10.5px] text-neutral-400">
                      class {c.name}
                    </div>
                  ))}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ---------- class doc ----------

function ClassDoc({ cls, fnFilter, highlightFn }: { cls: HalClass; fnFilter: string; highlightFn?: string | null }) {
  const f = fnFilter.trim().toLowerCase();
  const fns = cls.fns.filter((x) => !f || x.name.toLowerCase().includes(f) || (x.brief ?? "").toLowerCase().includes(f));
  return (
    <div className="flex flex-col gap-3">
      <div className="mt-2 flex flex-wrap items-baseline gap-3">
        <h3 className="font-mono text-base font-bold tracking-tight">
          <span className="font-normal text-neutral-400">class</span> {cls.name}
        </h3>
        <Badge kind="outline">{cls.fns.length} functions</Badge>
        {cls.fns.some((x) => x.deprecated !== undefined) && (
          <Badge kind="warn">{cls.fns.filter((x) => x.deprecated !== undefined).length} deprecated</Badge>
        )}
      </div>
      {cls.brief && <p className="max-w-3xl text-xs leading-relaxed text-neutral-500">{cls.brief}</p>}
      {fns.map((x) => (
        <FunctionCard
          key={x.name}
          cls={cls.name}
          fn={x}
          anchorId={`fn-${cls.name}-${x.name}`}
          flash={highlightFn === `${cls.name}::${x.name}`}
        />
      ))}
    </div>
  );
}

// ---------- orchestrator ----------

export function HalViewer({ project, projectName }: { project: string; projectName: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const tag = sp.get("tag");
  const file = sp.get("file");
  const fnSel = sp.get("fn");
  const [filter, setFilter] = useState("");
  const [fnFilter, setFnFilter] = useState("");

  const { data: tagsData } = useApi<{ tags: TagInfo[] }>(`/api/projects/${project}/tags`);
  const { data: model, error, loading } = useApi<HalModel>(
    `/api/projects/${project}/hal${tag ? `?ref=${encodeURIComponent(tag)}` : ""}`
  );

  const setParams = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };

  const selFile = model?.files.find((x) => x.rel === file);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={
          <>
            HAL Viewer <span className="ml-1 font-mono text-xs font-normal text-neutral-400">{projectName}</span>
          </>
        }
        sub={
          model
            ? `${model.totals.files} headers · ${model.totals.classes} classes · ${model.totals.fns} functions @ ${model.ref}`
            : " "
        }
      >
        {tagsData && <TagSelect tags={tagsData.tags} value={tag} onChange={(t) => setParams({ tag: t, fn: null })} />}
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-white">
          <div className="p-2.5 pb-1">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter headers…"
              className="h-7 w-full rounded-md border border-neutral-200 bg-neutral-50 px-2 text-xs outline-none placeholder:text-neutral-400 focus:border-neutral-500"
            />
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {model ? <HalTree model={model} sel={file} onSelect={(rel) => setParams({ file: rel, fn: null })} filter={filter} /> : <Spinner />}
          </div>
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto p-6">
          {error && <ErrorBox message={error} />}
          {loading && !model && <Spinner label="Parsing headers…" />}

          {model && !selFile && (
            <div className="fade-up grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {model.files.map((x) => (
                <Card key={x.rel} hover className="cursor-pointer p-4" >
                  <button onClick={() => setParams({ file: x.rel })} className="w-full cursor-pointer text-left">
                    <div className="flex items-center gap-2">
                      <IconFn size={14} className="text-neutral-400" />
                      <span className="font-mono text-[12.5px] font-semibold">{x.rel}</span>
                    </div>
                    {x.brief && <p className="mt-1.5 text-[11.5px] leading-relaxed text-neutral-500">{x.brief}</p>}
                    <div className="mt-2.5 flex gap-1.5">
                      {x.classes.map((c) => (
                        <Badge key={c.name} kind="outline">
                          {c.name} · {c.fns.length}
                        </Badge>
                      ))}
                    </div>
                  </button>
                </Card>
              ))}
            </div>
          )}

          {model && selFile && (
            <div className="fade-up mx-auto flex max-w-4xl flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => setParams({ file: null, fn: null })}
                  className="cursor-pointer font-mono text-xs text-neutral-400 underline-offset-2 hover:text-neutral-900 hover:underline"
                >
                  ← headers
                </button>
                <h2 className="font-mono text-lg font-bold tracking-tight">{selFile.rel}</h2>
                <input
                  value={fnFilter}
                  onChange={(e) => setFnFilter(e.target.value)}
                  placeholder="Filter functions…"
                  className="ml-auto h-7 w-44 rounded-md border border-neutral-200 bg-white px-2 text-xs outline-none placeholder:text-neutral-400 focus:border-neutral-500"
                />
              </div>
              {selFile.brief && <p className="-mt-1 text-xs text-neutral-500">{selFile.brief}</p>}
              <SectionLabel>api reference @ {model.ref}</SectionLabel>
              {selFile.classes.map((c) => (
                <ClassDoc key={c.name} cls={c} fnFilter={fnFilter} highlightFn={fnSel} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
