import type { SfrField, SfrModule, SfrReg } from "./types";

/**
 * Parser for the SystemRDL subset used by this tool:
 *
 *   addrmap uart_common {
 *       name = "UART Common";
 *       desc = "...";
 *       default regwidth = 32;
 *
 *       reg {
 *           name = "Control";
 *           desc = "...";
 *           field {
 *               desc = "Enable";
 *               sw = rw;
 *               hw = r;
 *           } EN[0:0] = 0x0;
 *       } CTRL @ 0x0000;
 *   };
 */

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Find `{ ... }` block starting at openIdx (which must point at '{'). Returns content + index after '}'. */
function readBlock(src: string, openIdx: number): { body: string; end: number } {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return { body: src.slice(openIdx + 1, i), end: i + 1 };
    }
  }
  throw new Error("Unbalanced braces in RDL source");
}

function parseStr(v: string): string {
  const m = v.trim().match(/^"([\s\S]*)"$/);
  return m ? m[1] : v.trim();
}

function parseNum(v: string): number {
  const t = v.trim();
  if (/^0x/i.test(t)) return parseInt(t, 16);
  return parseInt(t, 10);
}

/** Extract `key = value;` properties at top level of a block body (ignoring nested blocks). */
function topLevelProps(body: string): Record<string, string> {
  const props: Record<string, string> = {};
  let depth = 0;
  let buf = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "{") depth++;
    if (c === "}") depth--;
    if (depth === 0 && c === ";") {
      const stmt = buf.trim();
      const m = stmt.match(/^(?:default\s+)?(\w+)\s*=\s*([\s\S]+)$/);
      if (m) props[m[1]] = m[2].trim();
      buf = "";
    } else if (depth === 0) {
      buf += c;
    } else if (depth === 1 && c === "{") {
      buf = ""; // entering nested block: discard accumulated header text
    }
  }
  return props;
}

function parseField(body: string, suffix: string): SfrField | null {
  // suffix: NAME[msb:lsb] (= reset)?
  const m = suffix.trim().match(/^(\w+)\s*\[\s*(\d+)\s*:\s*(\d+)\s*\]\s*(?:=\s*([\w']+))?$/);
  if (!m) return null;
  const props = topLevelProps(body);
  const msb = parseInt(m[2], 10);
  const lsb = parseInt(m[3], 10);
  const field: SfrField = {
    name: m[1],
    msb,
    lsb,
    width: msb - lsb + 1,
    sw: props.sw ?? "rw",
    hw: props.hw ?? "r",
    desc: props.desc ? parseStr(props.desc) : undefined,
  };
  if (m[4] !== undefined) field.reset = parseNum(m[4]);
  else if (props.reset !== undefined) field.reset = parseNum(props.reset);
  return field;
}

function parseReg(body: string, suffix: string, defaultWidth: number): SfrReg | null {
  // suffix: NAME @ 0x0000
  const m = suffix.trim().match(/^(\w+)\s*@\s*(0x[0-9a-fA-F]+|\d+)$/);
  if (!m) return null;
  const props = topLevelProps(body);
  const fields: SfrField[] = [];

  // scan for `field { ... } SUFFIX;`
  const re = /\bfield\b/g;
  let fm: RegExpExecArray | null;
  while ((fm = re.exec(body))) {
    const open = body.indexOf("{", fm.index);
    if (open < 0) break;
    const { body: fbody, end } = readBlock(body, open);
    const semi = body.indexOf(";", end);
    const suffixStr = body.slice(end, semi >= 0 ? semi : undefined);
    const f = parseField(fbody, suffixStr);
    if (f) fields.push(f);
    re.lastIndex = semi >= 0 ? semi + 1 : end;
  }

  fields.sort((a, b) => a.lsb - b.lsb);
  return {
    name: m[1],
    offset: parseNum(m[2]),
    width: props.regwidth ? parseNum(props.regwidth) : defaultWidth,
    dispName: props.name ? parseStr(props.name) : undefined,
    desc: props.desc ? parseStr(props.desc) : undefined,
    fields,
  };
}

export function parseRdl(src: string, path: string): SfrModule {
  const clean = stripComments(src);
  const am = clean.match(/\baddrmap\s+(\w+)\s*\{/);
  if (!am || am.index === undefined) {
    throw new Error(`No addrmap found in ${path}`);
  }
  const open = clean.indexOf("{", am.index);
  const { body } = readBlock(clean, open);
  const props = topLevelProps(body);
  const defaultWidth = props.regwidth ? parseNum(props.regwidth) : 32;

  const regs: SfrReg[] = [];
  // scan for `reg { ... } NAME @ offset;` — skip `field` keyword hits inside reg blocks by linear scan
  let i = 0;
  while (i < body.length) {
    const idx = body.indexOf("reg", i);
    if (idx < 0) break;
    // must be standalone keyword
    const before = body[idx - 1];
    const after = body[idx + 3];
    if ((before && /\w/.test(before)) || (after && /\w/.test(after) === false && after !== " " && after !== "\n" && after !== "\t" && after !== "{")) {
      // fallthrough to detailed check below
    }
    if ((before && /\w/.test(before)) || (after && /\w/.test(after))) {
      i = idx + 3;
      continue;
    }
    const open2 = body.indexOf("{", idx);
    if (open2 < 0) break;
    // ensure only whitespace between keyword and brace
    if (body.slice(idx + 3, open2).trim() !== "") {
      i = idx + 3;
      continue;
    }
    const { body: rbody, end } = readBlock(body, open2);
    const semi = body.indexOf(";", end);
    const suffix = body.slice(end, semi >= 0 ? semi : undefined);
    const r = parseReg(rbody, suffix, defaultWidth);
    if (r) regs.push(r);
    i = semi >= 0 ? semi + 1 : end;
  }

  regs.sort((a, b) => a.offset - b.offset);
  const file = path.split("/").pop() ?? path;
  return {
    path,
    file,
    addrmap: am[1],
    dispName: props.name ? parseStr(props.name) : undefined,
    desc: props.desc ? parseStr(props.desc) : undefined,
    regs,
  };
}

/** Compute register reset value from field resets (as hex string). */
export function regResetHex(reg: SfrReg): string {
  let v = 0;
  for (const f of reg.fields) {
    if (f.reset) v += f.reset * 2 ** f.lsb;
  }
  const digits = Math.max(1, Math.ceil(reg.width / 4));
  return "0x" + v.toString(16).toUpperCase().padStart(digits, "0");
}
