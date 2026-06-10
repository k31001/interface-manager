import { cached } from "./cache";
import { resolveRepoDir, revParse } from "./git";
import { flattenModules, loadHal, loadSfr, resolveRef } from "./model";
import { readConfig } from "./config";
import type { ProjectConfig, SearchHit } from "./types";

interface IndexEntry extends SearchHit {
  /** lowercase haystack */
  hay: string;
}

async function buildProjectIndex(p: ProjectConfig): Promise<IndexEntry[]> {
  const dir = await resolveRepoDir(p);
  const ref = await resolveRef(p);
  const sha = await revParse(dir, ref);

  return cached(`searchidx:${dir}:${sha}`, async () => {
    const entries: IndexEntry[] = [];
    const [sfr, hal] = await Promise.all([loadSfr(p, ref), loadHal(p, ref)]);

    for (const { subsystem, ip, mod } of flattenModules(sfr)) {
      const modHref = `/${p.id}/sfr?sel=${encodeURIComponent(mod.path)}`;
      entries.push({
        type: "module",
        project: p.id,
        projectName: p.name,
        label: mod.file,
        context: `${subsystem} / ${ip}`,
        href: modHref,
        hay: `${mod.file} ${mod.addrmap} ${ip}`.toLowerCase(),
      });
      for (const r of mod.regs) {
        entries.push({
          type: "register",
          project: p.id,
          projectName: p.name,
          label: r.name,
          context: `${ip} / ${mod.file} @ 0x${r.offset.toString(16).toUpperCase().padStart(4, "0")}`,
          href: `${modHref}&reg=${encodeURIComponent(r.name)}`,
          hay: `${r.name} ${r.dispName ?? ""} ${ip}`.toLowerCase(),
        });
        for (const f of r.fields) {
          entries.push({
            type: "field",
            project: p.id,
            projectName: p.name,
            label: `${r.name}.${f.name}`,
            context: `${ip} / ${mod.file} [${f.msb}:${f.lsb}]`,
            href: `${modHref}&reg=${encodeURIComponent(r.name)}&field=${encodeURIComponent(f.name)}`,
            hay: `${f.name} ${r.name}.${f.name}`.toLowerCase(),
          });
        }
      }
    }

    for (const file of hal.files) {
      const fileHref = `/${p.id}/hal?file=${encodeURIComponent(file.rel)}`;
      for (const cls of file.classes) {
        entries.push({
          type: "class",
          project: p.id,
          projectName: p.name,
          label: cls.name,
          context: file.rel,
          href: fileHref,
          hay: cls.name.toLowerCase(),
        });
        for (const fn of cls.fns) {
          entries.push({
            type: "function",
            project: p.id,
            projectName: p.name,
            label: `${cls.name}::${fn.name}()`,
            context: fn.brief ?? file.rel,
            href: `${fileHref}&fn=${encodeURIComponent(`${cls.name}::${fn.name}`)}`,
            hay: `${fn.name} ${cls.name}::${fn.name} ${fn.brief ?? ""}`.toLowerCase(),
          });
        }
      }
    }

    return entries;
  });
}

function score(hay: string, label: string, q: string): number {
  const labelLc = label.toLowerCase();
  if (labelLc === q) return 100;
  if (labelLc.startsWith(q)) return 80;
  // word-boundary match within label
  if (new RegExp(`[._:\\s/\\[(]${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(labelLc)) return 60;
  if (labelLc.includes(q)) return 40;
  if (hay.includes(q)) return 20;
  return 0;
}

export async function search(q: string, limit = 24): Promise<SearchHit[]> {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const cfg = readConfig();
  const indexes = await Promise.all(
    cfg.projects.map((p) => buildProjectIndex(p).catch(() => [] as IndexEntry[]))
  );
  const scored: { hit: IndexEntry; s: number }[] = [];
  for (const idx of indexes) {
    for (const e of idx) {
      const s = score(e.hay, e.label, query);
      if (s > 0) scored.push({ hit: e, s });
    }
  }
  scored.sort((a, b) => b.s - a.s || a.hit.label.length - b.hit.label.length);
  return scored.slice(0, limit).map(({ hit }) => {
    const rest = { ...hit } as Partial<IndexEntry>;
    delete rest.hay;
    return rest as SearchHit;
  });
}
