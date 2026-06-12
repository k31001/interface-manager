import { flattenModules } from "./model";
import type {
  DiffCounts,
  FieldDiff,
  HalDiff,
  HalFileDiff,
  HalFn,
  HalModel,
  ModuleDiff,
  PropChange,
  SfrField,
  SfrModel,
  SfrReg,
} from "./types";

const hex = (n: number | undefined) => (n === undefined ? "—" : "0x" + n.toString(16).toUpperCase());
const bits = (f: SfrField) => (f.width === 1 ? `[${f.lsb}]` : `[${f.msb}:${f.lsb}]`);

function emptyCounts(): DiffCounts {
  return { added: 0, removed: 0, modified: 0, doc: 0 };
}

function diffField(a: SfrField, b: SfrField): PropChange[] {
  const ch: PropChange[] = [];
  if (a.lsb !== b.lsb || a.msb !== b.msb)
    ch.push({ prop: "bits", from: bits(a), to: bits(b), docOnly: false });
  if (a.sw !== b.sw) ch.push({ prop: "sw access", from: a.sw, to: b.sw, docOnly: false });
  if (a.hw !== b.hw) ch.push({ prop: "hw access", from: a.hw, to: b.hw, docOnly: false });
  if ((a.reset ?? 0) !== (b.reset ?? 0))
    ch.push({ prop: "reset", from: hex(a.reset ?? 0), to: hex(b.reset ?? 0), docOnly: false });
  if ((a.desc ?? "") !== (b.desc ?? ""))
    ch.push({ prop: "desc", from: a.desc ?? "", to: b.desc ?? "", docOnly: true });
  return ch;
}

export function diffReg(a: SfrReg, b: SfrReg): { reg: PropChange[]; fields: FieldDiff[] } {
  const reg: PropChange[] = [];
  if (a.offset !== b.offset) reg.push({ prop: "offset", from: hex(a.offset), to: hex(b.offset), docOnly: false });
  if (a.width !== b.width) reg.push({ prop: "width", from: `${a.width}`, to: `${b.width}`, docOnly: false });
  if ((a.desc ?? "") !== (b.desc ?? "")) reg.push({ prop: "desc", from: a.desc ?? "", to: b.desc ?? "", docOnly: true });

  const fields: FieldDiff[] = [];
  const aMap = new Map(a.fields.map((f) => [f.name, f]));
  const bMap = new Map(b.fields.map((f) => [f.name, f]));
  for (const [name, bf] of bMap) {
    const af = aMap.get(name);
    if (!af) {
      fields.push({ name, status: "added", bits: bits(bf), changes: [] });
    } else {
      const ch = diffField(af, bf);
      if (ch.length) {
        const functional = ch.some((c) => !c.docOnly);
        fields.push({ name, status: functional ? "modified" : "doc", bits: bits(bf), changes: ch });
      }
    }
  }
  for (const [name, af] of aMap) {
    if (!bMap.has(name)) fields.push({ name, status: "removed", bits: bits(af), changes: [] });
  }
  return { reg, fields };
}

/** True when the register is functionally identical (ignoring descriptions). */
export function regFunctionallyEqual(a: SfrReg, b: SfrReg): boolean {
  if (a.offset !== b.offset || a.width !== b.width) return false;
  if (a.fields.length !== b.fields.length) return false;
  const bMap = new Map(b.fields.map((f) => [f.name, f]));
  for (const af of a.fields) {
    const bf = bMap.get(af.name);
    if (!bf) return false;
    if (af.lsb !== bf.lsb || af.msb !== bf.msb || af.sw !== bf.sw || af.hw !== bf.hw || (af.reset ?? 0) !== (bf.reset ?? 0))
      return false;
  }
  return true;
}

export function fieldFunctionallyEqual(a: SfrField, b: SfrField): boolean {
  return a.lsb === b.lsb && a.msb === b.msb && a.sw === b.sw && a.hw === b.hw && (a.reset ?? 0) === (b.reset ?? 0);
}

export function diffSfr(from: SfrModel, to: SfrModel): SfrDiffResult {
  const fromMods = flattenModules(from);
  const toMods = flattenModules(to);
  const fromMap = new Map(fromMods.map((m) => [m.mod.path, m]));
  const toMap = new Map(toMods.map((m) => [m.mod.path, m]));

  const modules: ModuleDiff[] = [];
  const regCounts = emptyCounts();
  const fieldCounts = emptyCounts();

  const allPaths = [...new Set([...fromMap.keys(), ...toMap.keys()])].sort();
  for (const path of allPaths) {
    const a = fromMap.get(path);
    const b = toMap.get(path);
    const ctx = b ?? a!;
    const md: ModuleDiff = {
      path,
      ip: ctx.ip,
      subsystem: ctx.subsystem,
      status: !a ? "added" : !b ? "removed" : "modified",
      regs: [],
    };

    if (!a || !b) {
      const regs = (a ?? b)!.mod.regs;
      for (const r of regs) {
        md.regs.push({ name: r.name, status: !a ? "added" : "removed", offset: r.offset, changes: [], fields: [], snapshot: r });
        regCounts[!a ? "added" : "removed"]++;
        fieldCounts[!a ? "added" : "removed"] += r.fields.length;
      }
      modules.push(md);
      continue;
    }

    const aRegs = new Map(a.mod.regs.map((r) => [r.name, r]));
    const bRegs = new Map(b.mod.regs.map((r) => [r.name, r]));
    for (const [name, br] of bRegs) {
      const ar = aRegs.get(name);
      if (!ar) {
        md.regs.push({ name, status: "added", offset: br.offset, changes: [], fields: [], snapshot: br });
        regCounts.added++;
        fieldCounts.added += br.fields.length;
      } else {
        const { reg, fields } = diffReg(ar, br);
        if (reg.length || fields.length) {
          const functional =
            reg.some((c) => !c.docOnly) || fields.some((f) => f.status !== "doc");
          md.regs.push({ name, status: functional ? "modified" : "doc", offset: br.offset, changes: reg, fields, snapshot: br });
          regCounts[functional ? "modified" : "doc"]++;
          for (const f of fields) {
            if (f.status === "added") fieldCounts.added++;
            else if (f.status === "removed") fieldCounts.removed++;
            else if (f.status === "modified") fieldCounts.modified++;
            else fieldCounts.doc++;
          }
        }
      }
    }
    for (const [name, ar] of aRegs) {
      if (!bRegs.has(name)) {
        md.regs.push({ name, status: "removed", offset: ar.offset, changes: [], fields: [], snapshot: ar });
        regCounts.removed++;
        fieldCounts.removed += ar.fields.length;
      }
    }
    if (md.regs.length) modules.push(md);
  }

  return {
    from: from.ref,
    to: to.ref,
    modules,
    summary: { regs: regCounts, fields: fieldCounts },
  };
}

export type SfrDiffResult = {
  from: string;
  to: string;
  modules: ModuleDiff[];
  summary: { regs: DiffCounts; fields: DiffCounts };
};

// ---------- HAL ----------

function diffFn(a: HalFn, b: HalFn): PropChange[] {
  const ch: PropChange[] = [];
  if (a.ret !== b.ret) ch.push({ prop: "return type", from: a.ret, to: b.ret, docOnly: false });
  const aTypes = a.params.map((p) => p.type).join(", ");
  const bTypes = b.params.map((p) => p.type).join(", ");
  if (aTypes !== bTypes) ch.push({ prop: "parameters", from: aTypes || "void", to: bTypes || "void", docOnly: false });
  if (a.isConst !== b.isConst) ch.push({ prop: "constness", from: `${a.isConst}`, to: `${b.isConst}`, docOnly: false });
  const aDep = a.deprecated !== undefined;
  const bDep = b.deprecated !== undefined;
  if (aDep !== bDep) ch.push({ prop: "deprecated", from: `${aDep}`, to: `${bDep}`, docOnly: false });
  const aNames = a.params.map((p) => p.name).join(", ");
  const bNames = b.params.map((p) => p.name).join(", ");
  if (aTypes === bTypes && aNames !== bNames)
    ch.push({ prop: "param names", from: aNames, to: bNames, docOnly: true });
  if ((a.brief ?? "") !== (b.brief ?? "")) ch.push({ prop: "brief", from: a.brief ?? "", to: b.brief ?? "", docOnly: true });
  else if ((a.returns ?? "") !== (b.returns ?? "") || a.params.map((p) => p.desc ?? "").join("|") !== b.params.map((p) => p.desc ?? "").join("|"))
    ch.push({ prop: "documentation", from: "", to: "updated", docOnly: true });
  return ch;
}

export function diffHal(from: HalModel, to: HalModel): HalDiff {
  const counts = emptyCounts();
  const files: HalFileDiff[] = [];
  const aFiles = new Map(from.files.map((f) => [f.path, f]));
  const bFiles = new Map(to.files.map((f) => [f.path, f]));
  const allPaths = [...new Set([...aFiles.keys(), ...bFiles.keys()])].sort();

  for (const path of allPaths) {
    const a = aFiles.get(path);
    const b = bFiles.get(path);
    const fd: HalFileDiff = {
      path,
      rel: (b ?? a)!.rel,
      status: !a ? "added" : !b ? "removed" : "modified",
      fns: [],
    };

    const aFns = new Map<string, { cls: string; fn: HalFn }>();
    const bFns = new Map<string, { cls: string; fn: HalFn }>();
    for (const c of a?.classes ?? []) for (const fn of c.fns) aFns.set(`${c.name}::${fn.name}`, { cls: c.name, fn });
    for (const c of b?.classes ?? []) for (const fn of c.fns) bFns.set(`${c.name}::${fn.name}`, { cls: c.name, fn });

    for (const [key, { cls, fn }] of bFns) {
      const prev = aFns.get(key);
      if (!prev) {
        fd.fns.push({ name: fn.name, cls, status: "added", sigTo: fn.signature, changes: [], snapshot: fn });
        counts.added++;
      } else {
        const ch = diffFn(prev.fn, fn);
        if (ch.length) {
          const functional = ch.some((c) => !c.docOnly);
          fd.fns.push({
            name: fn.name,
            cls,
            status: functional ? "modified" : "doc",
            sigFrom: prev.fn.signature,
            sigTo: fn.signature,
            changes: ch,
            snapshot: fn,
          });
          counts[functional ? "modified" : "doc"]++;
        }
      }
    }
    for (const [key, { cls, fn }] of aFns) {
      if (!bFns.has(key)) {
        fd.fns.push({ name: fn.name, cls, status: "removed", sigFrom: fn.signature, changes: [], snapshot: fn });
        counts.removed++;
      }
    }
    if (fd.fns.length) files.push(fd);
  }

  return { from: from.ref, to: to.ref, files, summary: { fns: counts } };
}
