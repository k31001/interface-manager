// ---------- Config ----------

export interface ProjectConfig {
  id: string;
  name: string;
  codename?: string;
  description?: string;
  /** Local path (relative to app root or absolute) or remote git URL */
  repo: string;
  /** Directory inside the repo containing SystemRDL trees (system/subsystem/ip/*.rdl) */
  rdlDir: string;
  /** Directory inside the repo containing HAL C++ headers */
  halDir: string;
  /** Baseline ref (tag or commit id) used for reuse statistics */
  baseline: string;
  /** Reuse-rate drop (percent points) between consecutive tags that triggers a warning */
  warnThresholdPct: number;
}

export interface AppConfig {
  projects: ProjectConfig[];
}

// ---------- Git ----------

export interface TagInfo {
  name: string;
  /** commit sha the tag points to */
  sha: string;
  /** ISO date of the tagged commit */
  date: string;
  /** annotation subject (or commit subject) */
  subject: string;
}

export interface CommitInfo {
  sha: string;
  author: string;
  date: string;
  subject: string;
}

// ---------- SFR model ----------

export interface SfrField {
  name: string;
  lsb: number;
  msb: number;
  width: number;
  sw: string; // rw | r | w | rw1c ...
  hw: string;
  reset?: number;
  desc?: string;
}

export interface SfrReg {
  name: string;
  dispName?: string;
  offset: number;
  width: number; // regwidth in bits
  desc?: string;
  fields: SfrField[];
}

export interface SfrModule {
  /** repo-relative path of the .rdl file */
  path: string;
  file: string; // file name
  addrmap: string;
  dispName?: string;
  desc?: string;
  regs: SfrReg[];
}

export interface SfrIp {
  name: string;
  modules: SfrModule[];
}

export interface SfrSubsystem {
  name: string;
  ips: SfrIp[];
}

export interface SfrSystem {
  name: string;
  subsystems: SfrSubsystem[];
}

export interface SfrModel {
  project: string;
  ref: string;
  sha: string;
  systems: SfrSystem[];
  totals: { modules: number; regs: number; fields: number };
}

// ---------- HAL model ----------

export interface HalParam {
  type: string;
  name: string;
  def?: string; // default value
  desc?: string;
}

export interface HalFn {
  name: string;
  ret: string;
  params: HalParam[];
  isConst: boolean;
  brief?: string;
  returns?: string;
  notes: string[];
  warnings: string[];
  deprecated?: string | null; // reason text, or null
  /** pretty one-line signature */
  signature: string;
  /** functional identity (return + param types + const + deprecated) */
  key: string;
}

export interface HalClass {
  name: string;
  brief?: string;
  fns: HalFn[];
}

export interface HalFile {
  /** repo-relative path */
  path: string;
  /** path relative to halDir */
  rel: string;
  brief?: string;
  classes: HalClass[];
}

export interface HalModel {
  project: string;
  ref: string;
  sha: string;
  files: HalFile[];
  totals: { files: number; classes: number; fns: number };
}

// ---------- Diff ----------

export type DiffStatus = "added" | "removed" | "modified" | "doc";

export interface PropChange {
  prop: string;
  from: string;
  to: string;
  docOnly: boolean;
}

export interface FieldDiff {
  name: string;
  status: DiffStatus;
  bits?: string; // current/new bit range label
  changes: PropChange[];
}

export interface RegDiff {
  name: string;
  status: DiffStatus;
  offset: number;
  changes: PropChange[]; // reg-level changes (offset, desc, width)
  fields: FieldDiff[];
  /** snapshot for added/removed rendering */
  snapshot?: SfrReg;
}

export interface ModuleDiff {
  path: string;
  ip: string;
  subsystem: string;
  status: DiffStatus;
  regs: RegDiff[];
}

export interface DiffCounts {
  added: number;
  removed: number;
  modified: number;
  doc: number;
}

export interface SfrDiff {
  from: string;
  to: string;
  modules: ModuleDiff[];
  summary: { regs: DiffCounts; fields: DiffCounts };
}

export interface FnDiff {
  name: string;
  cls: string;
  status: DiffStatus;
  sigFrom?: string;
  sigTo?: string;
  changes: PropChange[];
  snapshot?: HalFn;
}

export interface HalFileDiff {
  path: string;
  rel: string;
  status: DiffStatus;
  fns: FnDiff[];
}

export interface HalDiff {
  from: string;
  to: string;
  files: HalFileDiff[];
  summary: { fns: DiffCounts };
}

// ---------- Stats ----------

export interface StatsWarning {
  tag: string;
  date: string;
  metric: string; // "register" | "field" | "function"
  dropPct: number;
  prevTag: string;
}

export interface StatsPoint {
  ref: string;
  sha: string;
  date: string;
  subject: string;
  daysFromBaseline: number;
  /** totals at this ref */
  total: Record<string, number>;
  /** unchanged baseline items at this ref */
  unchanged: Record<string, number>;
  /** reuse percentage per metric (0-100) */
  reusePct: Record<string, number>;
  /** percent-point delta vs previous point per metric */
  deltaPct: Record<string, number>;
  /** change counts vs previous tag */
  counts: DiffCounts & { metric?: string };
  topChanged: { path: string; count: number }[];
  warning?: StatsWarning;
}

export interface StatsResult {
  project: string;
  kind: "sfr" | "hal";
  baseline: { ref: string; sha: string; date: string };
  baselineTotal: Record<string, number>;
  points: StatsPoint[];
  warnings: StatsWarning[];
}

// ---------- Search ----------

export interface SearchHit {
  type: "register" | "field" | "function" | "module" | "class";
  project: string;
  projectName: string;
  label: string;
  context: string;
  href: string;
}
