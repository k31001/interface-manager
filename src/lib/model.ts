import { cached } from "./cache";
import { listFilesAt, listTags, readFileAt, resolveRepoDir, revParse } from "./git";
import { parseHalHeader } from "./hal";
import { parseRdl } from "./rdl";
import type {
  HalModel,
  ProjectConfig,
  SfrIp,
  SfrModel,
  SfrModule,
  SfrSubsystem,
  SfrSystem,
  TagInfo,
} from "./types";

export async function projectTags(p: ProjectConfig): Promise<TagInfo[]> {
  const dir = await resolveRepoDir(p);
  return listTags(dir);
}

/** Resolve a ref string ("" or "latest" means newest tag, falling back to HEAD). */
export async function resolveRef(p: ProjectConfig, ref?: string | null): Promise<string> {
  if (ref && ref !== "latest") return ref;
  const tags = await projectTags(p);
  return tags.length ? tags[tags.length - 1].name : "HEAD";
}

export async function loadSfr(p: ProjectConfig, refInput?: string | null): Promise<SfrModel> {
  const ref = await resolveRef(p, refInput);
  const dir = await resolveRepoDir(p);
  const sha = await revParse(dir, ref);

  return cached(`sfr:${dir}:${sha}:${p.rdlDir}`, async () => {
    const files = await listFilesAt(dir, sha, p.rdlDir, ".rdl");
    const modules = await Promise.all(
      files.map(async (f) => ({ file: f, mod: parseRdl(await readFileAt(dir, sha, f), f) }))
    );

    // hierarchy from path: <rdlDir>/<system>/<subsystem>/<ip>/<file>.rdl
    const systems = new Map<string, Map<string, Map<string, SfrModule[]>>>();
    const prefix = p.rdlDir.replace(/\/+$/, "") + "/";
    for (const { file, mod } of modules) {
      const rel = file.startsWith(prefix) ? file.slice(prefix.length) : file;
      const parts = rel.split("/");
      const [sys, subsys, ip] = [
        parts[0] ?? "system",
        parts.length > 2 ? parts[1] : "common",
        parts.length > 3 ? parts[2] : parts[parts.length - 2] ?? "misc",
      ];
      if (!systems.has(sys)) systems.set(sys, new Map());
      const subs = systems.get(sys)!;
      if (!subs.has(subsys)) subs.set(subsys, new Map());
      const ips = subs.get(subsys)!;
      if (!ips.has(ip)) ips.set(ip, []);
      ips.get(ip)!.push(mod);
    }

    const sysArr: SfrSystem[] = [...systems.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([sysName, subs]) => ({
        name: sysName,
        subsystems: [...subs.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(
            ([subName, ips]): SfrSubsystem => ({
              name: subName,
              ips: [...ips.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([ipName, mods]): SfrIp => ({
                  name: ipName,
                  modules: mods.sort((a, b) => a.file.localeCompare(b.file)),
                })),
            })
          ),
      }));

    let regs = 0;
    let fields = 0;
    for (const { mod } of modules) {
      regs += mod.regs.length;
      for (const r of mod.regs) fields += r.fields.length;
    }

    return {
      project: p.id,
      ref,
      sha,
      systems: sysArr,
      totals: { modules: modules.length, regs, fields },
    } satisfies SfrModel;
  });
}

export async function loadHal(p: ProjectConfig, refInput?: string | null): Promise<HalModel> {
  const ref = await resolveRef(p, refInput);
  const dir = await resolveRepoDir(p);
  const sha = await revParse(dir, ref);

  return cached(`hal:${dir}:${sha}:${p.halDir}`, async () => {
    const prefix = p.halDir.replace(/\/+$/, "") + "/";
    const paths = await listFilesAt(dir, sha, p.halDir, ".h");
    const files = await Promise.all(
      paths.map(async (f) => {
        const rel = f.startsWith(prefix) ? f.slice(prefix.length) : f;
        return parseHalHeader(await readFileAt(dir, sha, f), f, rel);
      })
    );
    const withClasses = files.filter((f) => f.classes.length > 0).sort((a, b) => a.rel.localeCompare(b.rel));
    let classes = 0;
    let fns = 0;
    for (const f of withClasses) {
      classes += f.classes.length;
      for (const c of f.classes) fns += c.fns.length;
    }
    return {
      project: p.id,
      ref,
      sha,
      files: withClasses,
      totals: { files: withClasses.length, classes, fns },
    } satisfies HalModel;
  });
}

/** Flatten SFR model into module list with hierarchy context. */
export function flattenModules(model: SfrModel): { system: string; subsystem: string; ip: string; mod: SfrModule }[] {
  const out: { system: string; subsystem: string; ip: string; mod: SfrModule }[] = [];
  for (const sys of model.systems)
    for (const sub of sys.subsystems)
      for (const ip of sub.ips)
        for (const mod of ip.modules) out.push({ system: sys.name, subsystem: sub.name, ip: ip.name, mod });
  return out;
}
