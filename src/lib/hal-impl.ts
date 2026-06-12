/**
 * HAL implementation scanner — derives which SFR registers each HAL function
 * reads/writes by looking at the C/C++ *implementation* (no Doxygen tags needed).
 *
 * It recognizes memory-mapped register accesses of the form `PTR->REG` / `PTR.REG`
 * where PTR resolves to a known IP (by name) and REG is one of that IP's registers,
 * then classifies read vs write from the surrounding assignment context. This is a
 * pragmatic scanner (not a full C parser) but robust for the common register-struct
 * idiom used by modern HALs.
 */

export type Access = "r" | "w" | "rw";

export interface IpRegs {
  name: string; // ip name, e.g. "uart"
  regs: Set<string>; // register names in this IP
  /** module path per register (for cross-linking back to the SFR tree) */
  modulePath: Map<string, string>;
}

export interface RegRef {
  ip: string;
  reg: string;
  access: Access;
  modulePath?: string;
}

const COMPOUND2 = new Set(["|=", "&=", "^=", "+=", "-=", "*=", "/=", "%=", "++", "--"]);

/** classify the access at `i` (just past the REG token), skipping .field / ->field / [idx] chains */
function classify(body: string, i: number): Access {
  const n = body.length;
  for (;;) {
    while (i < n && /\s/.test(body[i])) i++;
    if (body[i] === "[") {
      let d = 0;
      while (i < n) {
        if (body[i] === "[") d++;
        else if (body[i] === "]") {
          d--;
          if (d === 0) {
            i++;
            break;
          }
        }
        i++;
      }
      continue;
    }
    if (body[i] === "." || body.slice(i, i + 2) === "->") {
      i += body.slice(i, i + 2) === "->" ? 2 : 1;
      while (i < n && /\s/.test(body[i])) i++;
      while (i < n && /\w/.test(body[i])) i++;
      continue;
    }
    break;
  }
  while (i < n && /\s/.test(body[i])) i++;
  const op3 = body.slice(i, i + 3);
  if (op3 === "<<=" || op3 === ">>=") return "w";
  const op2 = body.slice(i, i + 2);
  if (COMPOUND2.has(op2)) return "w";
  if (body[i] === "=" && body[i + 1] !== "=") return "w";
  return "r";
}

function readBlock(src: string, openIdx: number): { body: string; end: number } {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return { body: src.slice(openIdx + 1, i), end: i + 1 };
    }
  }
  return { body: src.slice(openIdx + 1), end: src.length };
}

const merge = (a: Access | undefined, b: Access): Access => (!a ? b : a === b ? a : "rw");

/**
 * Scan one .c/.cpp source. `ipsByPtr` maps an UPPERCASE pointer alias (the IP name
 * uppercased) to that IP's register set. Returns Class::Method → register accesses.
 */
export function scanHalImpl(src: string, ipsByPtr: Map<string, IpRegs>): Map<string, RegRef[]> {
  const out = new Map<string, RegRef[]>();
  // method definitions:  [Ret] Class::Method(params) [const] {
  const fnRe = /([A-Za-z_]\w*)::([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:const\s*)?(?:noexcept\s*)?\{/g;
  let m: RegExpExecArray | null;
  while ((m = fnRe.exec(src))) {
    const cls = m[1];
    const method = m[2];
    const openIdx = src.indexOf("{", m.index + m[0].length - 1);
    const { body, end } = readBlock(src, openIdx);
    fnRe.lastIndex = end;

    const acc = new Map<string, RegRef>(); // key ip::reg
    const refRe = /([A-Za-z_]\w*)\s*(?:->|\.)\s*([A-Za-z_]\w*)/g;
    let r: RegExpExecArray | null;
    while ((r = refRe.exec(body))) {
      const ip = ipsByPtr.get(r[1].toUpperCase());
      if (!ip || !ip.regs.has(r[2])) continue;
      const access = classify(body, r.index + r[0].length);
      const key = `${ip.name}::${r[2]}`;
      const prev = acc.get(key);
      acc.set(key, { ip: ip.name, reg: r[2], access: merge(prev?.access, access), modulePath: ip.modulePath.get(r[2]) });
    }
    if (acc.size) out.set(`${cls}::${method}`, [...acc.values()].sort((a, b) => a.reg.localeCompare(b.reg)));
  }
  return out;
}
