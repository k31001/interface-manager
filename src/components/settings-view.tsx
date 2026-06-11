"use client";

import { useState } from "react";
import type { AppConfig, ProjectConfig } from "@/lib/types";
import { clearApiCache, useApi } from "@/lib/use-api";
import { IconPlus, IconRefresh, IconX } from "./icons";
import { PageHeader } from "./shell";
import { Badge, Btn, Card, ErrorBox, SectionLabel, Spinner, cx } from "./ui";

type ProjectStatus = ProjectConfig & {
  status: "ok" | "error";
  error?: string;
  tagCount: number;
  latestTag: string | null;
  commitCount: number;
  halStatus?: { repo: string; tagCount: number; latestTag: string | null } | null;
};

function Field({
  label,
  value,
  onChange,
  mono = true,
  placeholder,
  hint,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] font-medium tracking-wider text-neutral-400 uppercase">{label}</span>
      <input
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cx(
          "h-8 rounded-md border border-neutral-200 bg-white px-2.5 text-xs transition-colors outline-none placeholder:text-neutral-300 focus:border-neutral-900 disabled:bg-neutral-50 disabled:text-neutral-400",
          mono && "font-mono"
        )}
      />
      {hint && <span className="text-[10px] text-neutral-400">{hint}</span>}
    </label>
  );
}

export function SettingsView() {
  const { data: statusData, reload: reloadStatus } = useApi<{ projects: ProjectStatus[] }>("/api/projects");
  const { data: cfg, error, loading } = useApi<AppConfig>("/api/config");
  const [draftState, setDraftState] = useState<ProjectConfig[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);

  // until the user edits something, the draft mirrors the saved config
  const draft = draftState ?? (cfg ? structuredClone(cfg.projects) : null);
  const setDraft = (fn: (d: ProjectConfig[]) => ProjectConfig[]) => {
    if (draft) setDraftState(fn(draft));
  };

  const update = (i: number, patch: Partial<ProjectConfig>) => {
    setDraft((d) => d.map((q, j) => (j === i ? { ...q, ...patch } : q)));
    setSaveMsg(null);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projects: draft }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      clearApiCache();
      reloadStatus();
      setSaveMsg("Saved. Caches invalidated — viewers will re-read the repositories.");
    } catch (e) {
      setSaveMsg(`Save failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  };

  const refresh = async (id: string) => {
    setRefreshing(id);
    try {
      await fetch(`/api/projects/${id}/refresh`, { method: "POST" });
      clearApiCache();
      reloadStatus();
    } finally {
      setRefreshing(null);
    }
  };

  const addProject = () => {
    setDraftState([
      ...(draft ?? []),
      {
        id: `project-${(draft?.length ?? 0) + 1}`,
        name: "New Project",
        codename: "",
        description: "",
        repo: "data/repos/…  or  https://git.example.com/soc/project.git",
        rdlDir: "rdl",
        halDir: "hal/include",
        baseline: "v0.1.0",
        warnThresholdPct: 4,
      },
    ]);
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Settings" sub="project repositories, interface directories and statistics baselines">
        <Btn onClick={addProject}>
          <IconPlus size={13} /> Add project
        </Btn>
        <Btn primary onClick={save} disabled={saving || !draft}>
          {saving ? "Saving…" : "Save changes"}
        </Btn>
      </PageHeader>

      <div className="flex-1 overflow-y-auto p-6">
        {error && <ErrorBox message={error} />}
        {loading && !draft && <Spinner />}
        {saveMsg && (
          <div
            className={cx(
              "fade-up mx-auto mb-4 max-w-4xl rounded-md border px-4 py-2.5 text-xs",
              saveMsg.startsWith("Save failed")
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            )}
          >
            {saveMsg}
          </div>
        )}

        {draft && (
          <div className="mx-auto flex max-w-4xl flex-col gap-4">
            {draft.map((p, i) => {
              const st = statusData?.projects.find((q) => q.id === p.id);
              return (
                <Card key={i} className="fade-up p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <span className="text-sm font-bold">{p.name || p.id}</span>
                    {st &&
                      (st.status === "ok" ? (
                        <>
                          <Badge kind="added">
                            ● SFR · {st.tagCount} tags · latest {st.latestTag}
                          </Badge>
                          {st.halStatus && (
                            <Badge kind="added">
                              ● HAL · {st.halStatus.tagCount} tags · latest {st.halStatus.latestTag}
                            </Badge>
                          )}
                        </>
                      ) : (
                        <Badge kind="removed">● {st.error}</Badge>
                      ))}
                    <span className="ml-auto flex gap-2">
                      <Btn onClick={() => refresh(p.id)} disabled={refreshing === p.id} title="git fetch + cache invalidate">
                        <IconRefresh size={13} className={refreshing === p.id ? "animate-spin" : ""} />
                        Refresh repo
                      </Btn>
                      <Btn onClick={() => setDraft((d) => d.filter((_, j) => j !== i))} title="Remove project">
                        <IconX size={13} />
                      </Btn>
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <Field label="id" value={p.id} onChange={(v) => update(i, { id: v })} hint="lowercase, used in URLs" />
                    <Field label="display name" value={p.name} mono={false} onChange={(v) => update(i, { name: v })} />
                    <Field label="codename" value={p.codename ?? ""} onChange={(v) => update(i, { codename: v })} />
                    <Field
                      label="description"
                      value={p.description ?? ""}
                      mono={false}
                      onChange={(v) => update(i, { description: v })}
                    />
                    <div className="md:col-span-2">
                      <Field
                        label="default git repository"
                        value={p.repo}
                        onChange={(v) => update(i, { repo: v })}
                        hint="local path (relative to the app root) or remote URL — used for SFR and HAL unless overridden below. Remote repos are cloned into data/cache and fetched on refresh."
                      />
                    </div>

                    <div className="md:col-span-2 mt-1 flex items-center gap-2">
                      <span className="text-[10px] font-medium tracking-wider text-neutral-400 uppercase">SFR source · SystemRDL</span>
                      <span className="h-px flex-1 bg-neutral-100" />
                    </div>
                    <Field
                      label="sfr repository (optional override)"
                      value={p.sfrRepo ?? ""}
                      placeholder="(uses default repo)"
                      onChange={(v) => update(i, { sfrRepo: v || undefined })}
                      hint="leave blank to use the default repository"
                    />
                    <Field
                      label="rdl directory"
                      value={p.rdlDir}
                      onChange={(v) => update(i, { rdlDir: v })}
                      hint="repo-relative; layout <system>/<subsystem>/<ip>/*.rdl"
                    />

                    <div className="md:col-span-2 mt-1 flex items-center gap-2">
                      <span className="text-[10px] font-medium tracking-wider text-neutral-400 uppercase">HAL source · C++ headers</span>
                      <span className="h-px flex-1 bg-neutral-100" />
                    </div>
                    <Field
                      label="hal repository (optional override)"
                      value={p.halRepo ?? ""}
                      placeholder="(uses default repo)"
                      onChange={(v) => update(i, { halRepo: v || undefined })}
                      hint="set when HAL lives in a separate git repository"
                    />
                    <Field
                      label="hal directory"
                      value={p.halDir}
                      onChange={(v) => update(i, { halDir: v })}
                      hint="repo-relative; C++ headers with doxygen comments"
                    />

                    <div className="md:col-span-2 mt-1 flex items-center gap-2">
                      <span className="text-[10px] font-medium tracking-wider text-neutral-400 uppercase">Statistics</span>
                      <span className="h-px flex-1 bg-neutral-100" />
                    </div>
                    <Field
                      label="baseline"
                      value={p.baseline}
                      onChange={(v) => update(i, { baseline: v })}
                      hint="tag or commit id the reuse rate is measured against"
                    />
                    <Field
                      label="hal baseline (optional)"
                      value={p.halBaseline ?? ""}
                      placeholder="(uses baseline)"
                      onChange={(v) => update(i, { halBaseline: v || undefined })}
                      hint="set when the HAL repo tags independently of SFR"
                    />
                    <Field
                      label="warning threshold (pp)"
                      value={String(p.warnThresholdPct)}
                      onChange={(v) => update(i, { warnThresholdPct: Number(v) || 0 })}
                      hint="reuse drop between consecutive tags that raises a warning"
                    />
                  </div>
                </Card>
              );
            })}

            <SectionLabel className="px-1">
              changes are written to data/config.json — repositories are read directly via git (ls-tree / show), nothing
              is copied
            </SectionLabel>
          </div>
        )}
      </div>
    </div>
  );
}
