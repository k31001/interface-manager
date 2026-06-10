import type { HalClass, HalFile, HalFn, HalParam } from "./types";

/**
 * Parser for HAL C++ headers: extracts classes and their public member
 * function declarations documented with Doxygen blocks.
 */

interface DoxyInfo {
  brief?: string;
  params: Record<string, string>;
  returns?: string;
  notes: string[];
  warnings: string[];
  deprecated?: string | null;
}

function parseDoxy(comment: string): DoxyInfo {
  const lines = comment
    .split("\n")
    .map((l) => l.replace(/^\s*\/?\*+\/?\s?/, "").replace(/\*\/\s*$/, ""));
  const info: DoxyInfo = { params: {}, notes: [], warnings: [] };
  let cur: { tag: string; arg?: string; text: string[] } | null = null;

  const flush = () => {
    if (!cur) return;
    const text = cur.text.join(" ").replace(/\s+/g, " ").trim();
    switch (cur.tag) {
      case "brief":
        info.brief = text;
        break;
      case "param":
        if (cur.arg) info.params[cur.arg] = text;
        break;
      case "return":
      case "returns":
        info.returns = text;
        break;
      case "note":
        if (text) info.notes.push(text);
        break;
      case "warning":
        if (text) info.warnings.push(text);
        break;
      case "deprecated":
        info.deprecated = text || null;
        break;
    }
    cur = null;
  };

  for (const line of lines) {
    const m = line.match(/^@(\w+)\s*(.*)$/);
    if (m) {
      flush();
      const tag = m[1];
      let rest = m[2];
      let arg: string | undefined;
      if (tag === "param") {
        const pm = rest.match(/^(?:\[[\w,]+\]\s*)?(\w+)\s*(.*)$/);
        if (pm) {
          arg = pm[1];
          rest = pm[2];
        }
      }
      cur = { tag, arg, text: [rest] };
    } else if (cur) {
      if (line.trim() === "") flush();
      else cur.text.push(line.trim());
    } else if (line.trim() && !info.brief) {
      // first plain text acts as brief
      cur = { tag: "brief", text: [line.trim()] };
    }
  }
  flush();
  return info;
}

function parseParams(raw: string, doxy: DoxyInfo): HalParam[] {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "void") return [];
  return trimmed.split(",").map((part) => {
    let p = part.trim();
    let def: string | undefined;
    const eq = p.indexOf("=");
    if (eq >= 0) {
      def = p.slice(eq + 1).trim();
      p = p.slice(0, eq).trim();
    }
    // last identifier is the param name
    const m = p.match(/^([\s\S]*?)([A-Za-z_]\w*)$/);
    let type = p;
    let name = "";
    if (m && m[1].trim()) {
      type = m[1].trim().replace(/\s+/g, " ").replace(/\s*([*&])\s*/g, "$1 ").trim();
      name = m[2];
    }
    return { type, name, def, desc: doxy.params[name] };
  });
}

function prettySignature(ret: string, name: string, params: HalParam[], isConst: boolean): string {
  const ps = params
    .map((p) => `${p.type} ${p.name}${p.def ? ` = ${p.def}` : ""}`.trim())
    .join(", ");
  return `${ret} ${name}(${ps})${isConst ? " const" : ""}`;
}

/** Functional identity: things that break source/binary compatibility. */
function fnKey(ret: string, name: string, params: HalParam[], isConst: boolean, deprecated: boolean): string {
  const types = params.map((p) => p.type).join(",");
  return `${ret} ${name}(${types})${isConst ? " const" : ""}${deprecated ? " [deprecated]" : ""}`;
}

function parseClassBody(body: string): HalFn[] {
  const fns: HalFn[] = [];
  const re = /\/\*\*([\s\S]*?)\*\//g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const doxy = parseDoxy(m[1]);
    // declaration: from end of comment to next ';'
    const semi = body.indexOf(";", re.lastIndex);
    if (semi < 0) break;
    let decl = body.slice(re.lastIndex, semi).replace(/\s+/g, " ").trim();
    decl = decl.replace(/^(public|private|protected)\s*:\s*/, "");
    // match: [virtual|static] ret name(params) [const] [= 0]
    const dm = decl.match(
      /^(?:(?:virtual|static|inline|explicit)\s+)*([\w:<>,&*\s]+?)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(const)?\s*(?:noexcept)?\s*(?:=\s*0)?\s*(?:override)?$/
    );
    if (!dm) {
      re.lastIndex = semi + 1;
      continue;
    }
    const ret = dm[1].trim().replace(/\s*([*&])\s*/g, "$1 ").trim();
    const name = dm[2];
    const params = parseParams(dm[3], doxy);
    const isConst = !!dm[4];
    const deprecated = doxy.deprecated !== undefined ? (doxy.deprecated ?? null) : undefined;
    fns.push({
      name,
      ret,
      params,
      isConst,
      brief: doxy.brief,
      returns: doxy.returns,
      notes: doxy.notes,
      warnings: doxy.warnings,
      deprecated,
      signature: prettySignature(ret, name, params, isConst),
      key: fnKey(ret, name, params, isConst, deprecated !== undefined),
    });
    re.lastIndex = semi + 1;
  }
  return fns;
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
  throw new Error("Unbalanced braces in header");
}

export function parseHalHeader(src: string, path: string, rel: string): HalFile {
  // file-level @brief from @file comment
  let brief: string | undefined;
  const fileDoc = src.match(/\/\*\*[\s\S]*?@file[\s\S]*?\*\//);
  if (fileDoc) brief = parseDoxy(fileDoc[0]).brief;

  const classes: HalClass[] = [];
  const re = /(?:\/\*\*([\s\S]*?)\*\/\s*)?class\s+([A-Za-z_]\w*)\s*(?::[^{]+)?\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    // skip `enum class` / `struct ... class` false positives
    const before = src.slice(Math.max(0, m.index - 8), m.index + m[0].length);
    if (/enum\s+class\s/.test(before)) {
      re.lastIndex = m.index + m[0].length;
      continue;
    }
    const open = src.indexOf("{", m.index + m[0].length - 1);
    const { body, end } = readBlock(src, open);
    const doxy = m[1] ? parseDoxy(m[1]) : undefined;
    classes.push({ name: m[2], brief: doxy?.brief, fns: parseClassBody(body) });
    re.lastIndex = end;
  }

  return { path, rel, brief, classes };
}
