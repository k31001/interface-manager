import { cached, diskCached } from "./cache";
import { dedupeChannels } from "./channels";
import { baselineFor, dirFor, repoFor } from "./config";
import { blobShaAt, listBlobsAt, listFilesAt, listTags, readFileAt, readFilesAt, resolveRepoDir, revParse } from "./git";
import { parseHalHeader } from "./hal";
import { parseRdl } from "./rdl";

/** progress callback: (filesDone, filesTotal, currentLabel) */
export type Progress = (done: number, total: number, label: string) => void;
import type {
  HalFile,
  HalModel,
  InterfaceKind,
  ProjectConfig,
  SfrIp,
  SfrModel,
  SfrModule,
  SfrSubsystem,
  SfrSystem,
  SfrTree,
  TagInfo,
} from "./types";

export { baselineFor, dirFor, repoFor };

/** Bump if the parsed SfrModule/HalFile shape changes (per-blob parse cache). */
const PARSE_VER = "v1";

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

// ---------------------------------------------------------------- SFR

function parseSfrSafe(src: string, path: string): SfrModule {
  try {
    return parseRdl(src, path);
  } catch (e) {
    // Isolate per-file failures: a single unparseable .rdl must never abort the
    // whole load (which would silently drop every later subsystem).
    console.warn(`[sfr] failed to parse ${path}: ${(e as Error).message}`);
    const base = path.split("/").pop() ?? path;
    return { path, file: base, addrmap: base.replace(/\.rdl$/, ""), regs: [] };
  }
}

/** Parse one .rdl, cached by blob sha so identical content (across tags / files)
 *  parses once. path/file are overridden when the cached blob came from elsewhere. */
async function parseSfrBlob(sha: string, src: string, path: string): Promise<SfrModule> {
  const mod = await cached(`psfr:${PARSE_VER}:${sha}`, async () => parseSfrSafe(src, path));
  return mod.path === path ? mod : { ...mod, path, file: path.split("/").pop() ?? path };
}

/** Build the system→subsystem→ip→module hierarchy from per-file modules.
 *  Subsystems live directly under rdlDir; the SoC is the single system. */
function buildSfrSystems<T extends { path: string; file: string }>(
  modules: T[],
  rdlDir: string,
  projectName: string
): { name: string; subsystems: { name: string; ips: { name: string; modules: T[] }[] }[] }[] {
  const subsystems = new Map<string, Map<string, T[]>>();
  const prefix = rdlDir.replace(/\/+$/, "") + "/";
  for (const mod of modules) {
    const rel = mod.path.startsWith(prefix) ? mod.path.slice(prefix.length) : mod.path;
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
  return [
    {
      name: projectName,
      subsystems: [...subsystems.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([subName, ips]) => ({
          name: subName,
          ips: [...ips.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([ipName, mods]) => ({
              name: ipName,
              modules: mods.sort((a, b) => a.file.localeCompare(b.file)),
            })),
        })),
    },
  ];
}

/** Full SFR model for a tag (every module's registers + fields). */
export async function loadSfr(p: ProjectConfig, refInput?: string | null, onProgress?: Progress): Promise<SfrModel> {
  const dir = await resolveRepoDir(repoFor(p, "sfr"));
  const rdlDir = dirFor(p, "sfr");
  const ref = await resolveRef(p, refInput, "sfr");
  const sha = await revParse(dir, ref);

  return diskCached(`sfr:${dir}:${sha}:${rdlDir}`, async () => {
    const blobs = await listBlobsAt(dir, sha, rdlDir, ".rdl");
    const contents = await readFilesAt(dir, sha, blobs.map((b) => b.path)); // one git process for all blobs
    const modules: SfrModule[] = [];
    for (let i = 0; i < blobs.length; i++) {
      const { path, sha: blobSha } = blobs[i];
      onProgress?.(i + 1, blobs.length, path.split("/").pop() ?? path);
      modules.push(await parseSfrBlob(blobSha, contents.get(path) ?? "", path));
    }

    const systems: SfrSystem[] = buildSfrSystems(modules, rdlDir, p.name).map((sys) => ({
      name: sys.name,
      subsystems: sys.subsystems.map(
        (sub): SfrSubsystem => ({ name: sub.name, ips: sub.ips.map((ip): SfrIp => ({ name: ip.name, modules: ip.modules })) })
      ),
    }));

    let regs = 0;
    let fields = 0;
    for (const mod of modules) {
      regs += mod.regs.length;
      for (const r of mod.regs) fields += r.fields.length;
    }

    return {
      project: p.id,
      ref,
      sha,
      systems,
      totals: { modules: modules.length, regs, fields },
    } satisfies SfrModel;
  });
}

/** Lightweight SFR hierarchy with per-module deduped counts and no field detail. */
export async function loadSfrTree(p: ProjectConfig, refInput?: string | null, onProgress?: Progress): Promise<SfrTree> {
  const dir = await resolveRepoDir(repoFor(p, "sfr"));
  const rdlDir = dirFor(p, "sfr");
  const ref = await resolveRef(p, refInput, "sfr");
  const sha = await revParse(dir, ref);

  return diskCached(`sfrtree:${PARSE_VER}:${dir}:${sha}:${rdlDir}`, async () => {
    const blobs = await listBlobsAt(dir, sha, rdlDir, ".rdl");
    const contents = await readFilesAt(dir, sha, blobs.map((b) => b.path));
    const modules: SfrModule[] = [];
    for (let i = 0; i < blobs.length; i++) {
      const { path, sha: blobSha } = blobs[i];
      onProgress?.(i + 1, blobs.length, path.split("/").pop() ?? path);
      modules.push(await parseSfrBlob(blobSha, contents.get(path) ?? "", path));
    }

    let totRegs = 0;
    let totFields = 0;
    const systems = buildSfrSystems(modules, rdlDir, p.name).map((sys) => ({
      name: sys.name,
      subsystems: sys.subsystems.map((sub) => ({
        name: sub.name,
        ips: sub.ips.map((ip) => ({
          name: ip.name,
          modules: ip.modules.map((mod) => {
            const deduped = dedupeChannels(mod.regs);
            const regs = deduped.length;
            const fields = deduped.reduce((n, r) => n + r.fields.length, 0);
            totRegs += regs;
            totFields += fields;
            return { path: mod.path, file: mod.file, addrmap: mod.addrmap, dispName: mod.dispName, desc: mod.desc, regs, fields };
          }),
        })),
      })),
    }));

    return {
      project: p.id,
      ref,
      sha,
      systems,
      totals: { modules: modules.length, regs: totRegs, fields: totFields },
    } satisfies SfrTree;
  });
}

/** On-demand: parse a single module's full register map. */
export async function loadSfrModule(p: ProjectConfig, refInput: string | null | undefined, modulePath: string): Promise<SfrModule> {
  const dir = await resolveRepoDir(repoFor(p, "sfr"));
  const ref = await resolveRef(p, refInput, "sfr");
  const blobSha = await blobShaAt(dir, ref, modulePath);
  const src = await readFileAt(dir, ref, modulePath);
  return parseSfrBlob(blobSha, src, modulePath);
}

// ---------------------------------------------------------------- HAL

async function parseHalBlob(sha: string, src: string, path: string, rel: string): Promise<HalFile> {
  const file = await cached(`phal:${PARSE_VER}:${sha}`, async () => parseHalHeader(src, path, rel));
  return file.path === path ? file : { ...file, path, rel };
}

export async function loadHal(p: ProjectConfig, refInput?: string | null, onProgress?: Progress): Promise<HalModel> {
  const dir = await resolveRepoDir(repoFor(p, "hal"));
  const halDir = dirFor(p, "hal");
  const ref = await resolveRef(p, refInput, "hal");
  const sha = await revParse(dir, ref);

  return diskCached(`hal:${dir}:${sha}:${halDir}`, async () => {
    const prefix = halDir.replace(/\/+$/, "") + "/";
    const blobs = await listBlobsAt(dir, sha, halDir, ".h");
    const contents = await readFilesAt(dir, sha, blobs.map((b) => b.path)); // one git process for all headers
    const files: HalFile[] = [];
    for (let i = 0; i < blobs.length; i++) {
      const { path, sha: blobSha } = blobs[i];
      onProgress?.(i + 1, blobs.length, path.split("/").pop() ?? path);
      const rel = path.startsWith(prefix) ? path.slice(prefix.length) : path;
      files.push(await parseHalBlob(blobSha, contents.get(path) ?? "", path, rel));
    }
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

// re-export so callers that only need file listing keep working
export { listFilesAt };
