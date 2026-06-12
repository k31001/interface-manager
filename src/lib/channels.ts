import type { SfrModel, SfrReg } from "./types";

/**
 * Collapse array-expanded register channels to a single representative.
 * Array instances (e.g. CH[8]) are expanded by the RDL parser into one register
 * per channel, tagged with arrayIndex. Since every channel shares the same
 * structure, the viewer shows only channel 0; the kept register carries
 * arrayCount for a "×N" badge.
 */
export function dedupeChannels(regs: SfrReg[]): SfrReg[] {
  return regs.filter((r) => r.arrayIndex === undefined || r.arrayIndex === 0);
}

/**
 * Display label for the kept representative of an array group, using RDL array
 * notation instead of the expanded "_0" suffix:
 *   DUMMY_0  -> DUMMY[100]        (register array)
 *   CH_0_CFG -> CH[8]_CFG         (component-instance array)
 * Non-array registers return their own name unchanged.
 */
export function channelLabel(reg: SfrReg): string {
  const { arrayGroup, arrayIndex, arrayCount } = reg;
  if (arrayGroup === undefined || arrayIndex === undefined || arrayCount === undefined) return reg.name;
  const prefix = `${arrayGroup}_${arrayIndex}`;
  if (reg.name === prefix) return `${arrayGroup}[${arrayCount}]`;
  if (reg.name.startsWith(prefix + "_")) return `${arrayGroup}[${arrayCount}]_${reg.name.slice(prefix.length + 1)}`;
  return reg.name;
}

/** Return a copy of the model with every module's registers channel-deduped,
 *  with the register/field totals recomputed to match the collapsed view. */
export function dedupeModelChannels(model: SfrModel): SfrModel {
  let regs = 0;
  let fields = 0;
  const systems = model.systems.map((sys) => ({
    ...sys,
    subsystems: sys.subsystems.map((sub) => ({
      ...sub,
      ips: sub.ips.map((ip) => ({
        ...ip,
        modules: ip.modules.map((mod) => {
          const deduped = dedupeChannels(mod.regs);
          regs += deduped.length;
          for (const r of deduped) fields += r.fields.length;
          return { ...mod, regs: deduped };
        }),
      })),
    })),
  }));
  return { ...model, systems, totals: { ...model.totals, regs, fields } };
}
