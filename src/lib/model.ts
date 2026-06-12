import { diskCached } from "./cache";
import { baselineFor, dirFor, repoFor } from "./config";
import { listFilesAt, listTags, readFilesAt, resolveRepoDir, revParse } from "./git";
import { parseHalHeader } from "./hal";
import { parseRdl } from "./rdl";

/** progress callback: (filesDone, filesTotal, currentLabel) */
export type Progress = (done: number, total: number, label: string) => void;
import type {
  HalModel,
  InterfaceKind,
  ProjectConfig,
  SfrIp,
  SfrModel,
  SfrModule,
  SfrSubsystem,
  SfrSystem,
  TagInfo,
} from "./types";

export { baselineFor, dirFor, repoFor };

export async function projectTags(p: ProjectConfig, kind: InterfaceKind = "sfr"): Promise<TagInfo[]> {
  const dir = await resolveRepoDir(repoFor(p, kind));
  return listTags(dir);
}

/** Resolve a ref string ("" or "latest" means newest tag, falling back to HEAD). */
export async function resolveRef(p: ProjectConfig, ref: string | null | undefined, kind: InterfaceKind): Promise<string> {
  if (ref && ref !== "latest") return ref;
  const tags = await projectTags(p, kind);
  return tags.length ? tags[tags.length - 1].name : "HEAD";
}

export async function loadSfr(p: ProjectConfig, refInput?: string | null, onProgress?: Progress): Promise<SfrModel> {
  const dir = await resolveRepoDir(repoFor(p, "sfr"));
  const rdlDir = dirFor(p, "sfr");
  const ref = await resolveRef(p, refInput, "sfr");
  const sha = await revParse(dir, ref);

  return diskCached(`sfr:${dir}:${sha}:${rdlDir}`, async () => {
    const files = await listFilesAt(dir, sha, rdlDir, ".rdl");
    const contents = await readFilesAt(dir, sha, files); // one git process for all blobs
    const modules = files.map((f, i) => {
      onProgress?.(i + 1, files.length, f.split("/").pop() ?? f);
      return { file: f, mod: parseRdl(contents.get(f) ?? "", f) };
    });

    // hierarchy from path under rdlDir: <subsystem>/<ip>/<file>.rdl
    // subsystems live directly under the configured dir; the SoC itself is the
    // single system, named after the project.
    const subsystems = new Map<string, Map<string, SfrModule[]>>();
    const prefix = rdlDir.replace(/\/+$/, "") + "/";
    for (const { file, mod } of modules) {
      const rel = file.startsWith(prefix) ? file.slice(prefix.length) : file;
      const parts = rel.split("/");
      const [subsys, ip] = [
        parts.length > 1 ? parts[0] : "common",
        parts.length > 2 ? parts[1] : parts[parts.length - 2] ?? "misc",
      ];
      if (!subsystems.has(subsys)) subsystems.set(subsys, new Map());
      const ips = subsystems.get(subsys)!;
      if (!ips.has(ip)) ips.set(ip, []);
      ips.get(ip)!.push(mod);
    }

    const sysArr: SfrSystem[] = [
      {
        name: p.name,
        subsystems: [...subsystems.entries()]
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
      },
    ];

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

export async function loadHal(p: ProjectConfig, refInput?: string | null, onProgress?: Progress): Promise<HalModel> {
  const dir = await resolveRepoDir(repoFor(p, "hal"));
  const halDir = dirFor(p, "hal");
  const ref = await resolveRef(p, refInput, "hal");
  const sha = await revParse(dir, ref);

  return diskCached(`hal:${dir}:${sha}:${halDir}`, async () => {
    const prefix = halDir.replace(/\/+$/, "") + "/";
    const paths = await listFilesAt(dir, sha, halDir, ".h");
    const contents = await readFilesAt(dir, sha, paths); // one git process for all headers
    const files = paths.map((f, i) => {
      onProgress?.(i + 1, paths.length, f.split("/").pop() ?? f);
      const rel = f.startsWith(prefix) ? f.slice(prefix.length) : f;
      return parseHalHeader(contents.get(f) ?? "", f, rel);
    });
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
