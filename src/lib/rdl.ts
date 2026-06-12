import type { SfrField, SfrModule, SfrReg } from "./types";

/**
 * SystemRDL 2.0 parser.
 *
 * Pipeline: tokenize → recursive-descent parse into an AST of component
 * definitions / instantiations → elaborate (resolve parameters, expand arrays,
 * compute addresses, flatten regfile/addrmap nesting) into a flat register map.
 *
 * Supported 2.0 constructs:
 *  - parameterized components:  addrmap NAME #(longint W = 8) { ... }
 *  - parameter overrides:       my_reg #(.W(16)) INST;
 *  - component nesting:         addrmap > regfile > reg > field
 *  - named + anonymous defs and instantiation of named types
 *  - arrays + address allocation:  R[4] @ 0x100 += 0x10 %= 0x40
 *  - default property blocks:    default sw = rw;
 *  - enums + enum references:    enum E { A = 0; B = 1; };   field f = E::B;
 *  - dynamic (post-inst) assigns:  R.F->reset = 1;
 *  - expressions + Verilog sized numbers (8'hFF, 4'b0010, 'd100), 0x.., 0b..
 *  - onread/onwrite/access modifiers folded into an effective access token
 *
 * Unsupported/rare constructs (UDP bodies, struct/constraint blocks, casts) are
 * skipped gracefully so a single odd file never blanks the whole map.
 */

// ----------------------------------------------------------------- tokenizer

type TokType = "id" | "num" | "str" | "punct";
interface Tok {
  t: TokType;
  v: string;
  n?: number; // numeric value for num tokens
}

const PUNCT3 = ["**="];
const PUNCT2 = ["->", "+=", "-=", "*=", "/=", "%=", "<<", ">>", "<=", ">=", "==", "!=", "&&", "||", "**", "::"];

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    // whitespace
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      i++;
      continue;
    }
    // comments
    if (c === "/" && src[i + 1] === "/") {
      i += 2;
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    // string
    if (c === '"') {
      let j = i + 1;
      let s = "";
      while (j < n && src[j] !== '"') {
        if (src[j] === "\\" && j + 1 < n) {
          s += src[j + 1];
          j += 2;
        } else {
          s += src[j];
          j++;
        }
      }
      toks.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    // number (decimal / hex / binary / Verilog sized)  — sized may start with ' (no width)
    const numMatch = matchNumber(src, i);
    if (numMatch) {
      toks.push({ t: "num", v: numMatch.raw, n: numMatch.value });
      i += numMatch.raw.length;
      continue;
    }
    // identifier / keyword
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      toks.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    // punctuation (longest match first)
    const three = src.slice(i, i + 3);
    if (PUNCT3.includes(three)) {
      toks.push({ t: "punct", v: three });
      i += 3;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (PUNCT2.includes(two)) {
      toks.push({ t: "punct", v: two });
      i += 2;
      continue;
    }
    toks.push({ t: "punct", v: c });
    i++;
  }
  return toks;
}

function matchNumber(src: string, i: number): { raw: string; value: number } | null {
  const rest = src.slice(i);
  // Verilog sized: [width]'[s]base digits      e.g. 8'hFF  4'b0010  'd100  16'sh1F
  let m = rest.match(/^(\d+)?'[sS]?([bBoOdDhH])([0-9a-fA-FxXzZ?_]+)/);
  if (m) {
    const baseChar = m[2].toLowerCase();
    const base = baseChar === "b" ? 2 : baseChar === "o" ? 8 : baseChar === "d" ? 10 : 16;
    const digits = m[3].replace(/[_xz?]/gi, (ch) => (/[_]/.test(ch) ? "" : "0"));
    const value = parseInt(digits || "0", base);
    return { raw: m[0], value: Number.isFinite(value) ? value : 0 };
  }
  // hex 0x.. / binary 0b..
  m = rest.match(/^0[xX][0-9a-fA-F_]+/);
  if (m) return { raw: m[0], value: parseInt(m[0].replace(/_/g, "").slice(2), 16) };
  m = rest.match(/^0[bB][01_]+/);
  if (m) return { raw: m[0], value: parseInt(m[0].replace(/_/g, "").slice(2), 2) };
  // decimal (not part of an identifier; tokenizer already handled ids)
  m = rest.match(/^\d[\d_]*/);
  if (m) return { raw: m[0], value: parseInt(m[0].replace(/_/g, ""), 10) };
  return null;
}

// ----------------------------------------------------------------- token cursor

class TS {
  i = 0;
  constructor(public toks: Tok[]) {}
  peek(o = 0): Tok | undefined {
    return this.toks[this.i + o];
  }
  next(): Tok | undefined {
    return this.toks[this.i++];
  }
  atEnd(): boolean {
    return this.i >= this.toks.length;
  }
  isPunct(v: string, o = 0): boolean {
    const t = this.peek(o);
    return !!t && t.t === "punct" && t.v === v;
  }
  isId(v?: string, o = 0): boolean {
    const t = this.peek(o);
    return !!t && t.t === "id" && (v === undefined || t.v === v);
  }
  eatPunct(v: string): boolean {
    if (this.isPunct(v)) {
      this.i++;
      return true;
    }
    return false;
  }
  /** skip tokens until after the next top-level ';' (brace-aware) — error recovery */
  skipStatement() {
    let depth = 0;
    while (!this.atEnd()) {
      const t = this.next()!;
      if (t.t === "punct") {
        if (t.v === "{" || t.v === "(" || t.v === "[") depth++;
        else if (t.v === "}" || t.v === ")" || t.v === "]") depth = Math.max(0, depth - 1);
        else if (t.v === ";" && depth === 0) return;
      }
    }
  }
}

// ----------------------------------------------------------------- expression AST

type Expr =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "id"; name: string }
  | { k: "enum"; e: string; m: string }
  | { k: "un"; op: string; a: Expr }
  | { k: "bin"; op: string; a: Expr; b: Expr }
  | { k: "tern"; c: Expr; a: Expr; b: Expr };

// precedence climbing
const BIN_PREC: Record<string, number> = {
  "||": 1, "&&": 2, "|": 3, "^": 4, "&": 5,
  "==": 6, "!=": 6, "<": 7, "<=": 7, ">": 7, ">=": 7,
  "<<": 8, ">>": 8, "+": 9, "-": 9, "*": 10, "/": 10, "%": 10, "**": 11,
};

function parseExpr(ts: TS, minPrec = 0): Expr {
  let left = parseUnary(ts);
  for (;;) {
    const t = ts.peek();
    if (!t || t.t !== "punct") break;
    if (t.v === "?") {
      // ternary (lowest, right-assoc)
      if (minPrec > 0) break;
      ts.next();
      const a = parseExpr(ts, 0);
      ts.eatPunct(":");
      const b = parseExpr(ts, 0);
      left = { k: "tern", c: left, a, b };
      continue;
    }
    const prec = BIN_PREC[t.v];
    if (prec === undefined || prec < minPrec) break;
    ts.next();
    const right = parseExpr(ts, prec + 1);
    left = { k: "bin", op: t.v, a: left, b: right };
  }
  return left;
}

function parseUnary(ts: TS): Expr {
  const t = ts.peek();
  if (t && t.t === "punct" && (t.v === "-" || t.v === "+" || t.v === "!" || t.v === "~")) {
    ts.next();
    return { k: "un", op: t.v, a: parseUnary(ts) };
  }
  return parsePrimary(ts);
}

function parsePrimary(ts: TS): Expr {
  const t = ts.peek();
  if (!t) return { k: "num", v: 0 };
  if (t.t === "num") {
    ts.next();
    return { k: "num", v: t.n ?? 0 };
  }
  if (t.t === "str") {
    ts.next();
    return { k: "str", v: t.v };
  }
  if (t.t === "punct" && t.v === "(") {
    ts.next();
    const e = parseExpr(ts, 0);
    ts.eatPunct(")");
    return e;
  }
  if (t.t === "punct" && t.v === "{") {
    // concatenation / replication — skip to matching brace, treat as 0
    skipBraced(ts, "{", "}");
    return { k: "num", v: 0 };
  }
  if (t.t === "id") {
    ts.next();
    if (t.v === "true") return { k: "num", v: 1 };
    if (t.v === "false") return { k: "num", v: 0 };
    // enum reference  E::M
    if (ts.isPunct("::")) {
      ts.next();
      const m = ts.next();
      return { k: "enum", e: t.v, m: m?.v ?? "" };
    }
    // property/instance ref a.b->c — consume the chain, value resolves to 0
    while (ts.isPunct(".") || ts.isPunct("->")) {
      ts.next();
      if (ts.peek()?.t === "id") ts.next();
    }
    return { k: "id", name: t.v };
  }
  ts.next();
  return { k: "num", v: 0 };
}

function skipBraced(ts: TS, open: string, close: string) {
  if (!ts.eatPunct(open)) return;
  let depth = 1;
  while (!ts.atEnd() && depth > 0) {
    const t = ts.next()!;
    if (t.t === "punct" && t.v === open) depth++;
    else if (t.t === "punct" && t.v === close) depth--;
  }
}

interface EvalCtx {
  params: Map<string, number | string>;
  enums: Map<string, Map<string, number>>;
}

function evalExpr(e: Expr, ctx: EvalCtx): number {
  switch (e.k) {
    case "num":
      return e.v;
    case "str":
      return 0;
    case "id": {
      const p = ctx.params.get(e.name);
      return typeof p === "number" ? p : 0;
    }
    case "enum":
      return ctx.enums.get(e.e)?.get(e.m) ?? 0;
    case "un":
      return e.op === "-" ? -evalExpr(e.a, ctx) : e.op === "!" ? (evalExpr(e.a, ctx) ? 0 : 1) : e.op === "~" ? ~evalExpr(e.a, ctx) : evalExpr(e.a, ctx);
    case "tern":
      return evalExpr(e.c, ctx) ? evalExpr(e.a, ctx) : evalExpr(e.b, ctx);
    case "bin": {
      const a = evalExpr(e.a, ctx);
      const b = evalExpr(e.b, ctx);
      switch (e.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return b ? Math.trunc(a / b) : 0;
        case "%": return b ? a % b : 0;
        case "**": return a ** b;
        case "<<": return a << b;
        case ">>": return a >> b;
        case "&": return a & b;
        case "|": return a | b;
        case "^": return a ^ b;
        case "&&": return a && b ? 1 : 0;
        case "||": return a || b ? 1 : 0;
        case "==": return a === b ? 1 : 0;
        case "!=": return a !== b ? 1 : 0;
        case "<": return a < b ? 1 : 0;
        case "<=": return a <= b ? 1 : 0;
        case ">": return a > b ? 1 : 0;
        case ">=": return a >= b ? 1 : 0;
        default: return 0;
      }
    }
  }
}

function evalStr(e: Expr | undefined, ctx: EvalCtx): string | undefined {
  if (!e) return undefined;
  if (e.k === "str") return e.v;
  if (e.k === "id") {
    const p = ctx.params.get(e.name);
    if (typeof p === "string") return p;
  }
  return undefined;
}

// ----------------------------------------------------------------- statement AST

const COMP_TYPES = new Set(["addrmap", "regfile", "reg", "field", "mem", "signal"]);

interface ParamDef {
  name: string;
  def?: Expr;
}
interface Inst {
  name: string;
  array?: Expr; // [N]
  range?: [Expr, Expr]; // [msb:lsb]
  reset?: Expr; // = value
  addr?: Expr; // @
  stride?: Expr; // +=
  align?: Expr; // %=
  overrides: { name: string; val: Expr }[];
}
interface CompDef {
  type: string;
  name?: string;
  params: ParamDef[];
  members: Member[];
}
type Member =
  | { k: "prop"; isDefault: boolean; name: string; value?: Expr }
  | { k: "dyn"; path: string[]; prop: string; value?: Expr }
  | { k: "comp"; def: CompDef; insts: Inst[]; overrides: { name: string; val: Expr }[] }
  | { k: "inst"; typeName: string; insts: Inst[]; overrides: { name: string; val: Expr }[] }
  | { k: "enum"; name: string; entries: { name: string; value?: Expr }[] };

function parseMembers(ts: TS): Member[] {
  const out: Member[] = [];
  while (!ts.atEnd() && !ts.isPunct("}")) {
    if (ts.eatPunct(";")) continue;
    const start = ts.i;
    try {
      const m = parseMember(ts);
      if (m) out.push(...m);
      if (ts.i === start) ts.next(); // guarantee progress
    } catch {
      ts.i = start;
      ts.skipStatement();
    }
  }
  return out;
}

function parseParamDefs(ts: TS): ParamDef[] {
  // assumes current token is '#'
  const params: ParamDef[] = [];
  ts.next(); // #
  if (!ts.eatPunct("(")) return params;
  while (!ts.atEnd() && !ts.isPunct(")")) {
    // data_type ID array? (= expr)?  — the param name is the last id before '=', ',', ')', or '['
    const ids: Tok[] = [];
    while (!ts.atEnd() && !ts.isPunct(",") && !ts.isPunct(")") && !ts.isPunct("=")) {
      if (ts.isPunct("[")) skipBraced(ts, "[", "]");
      else {
        const t = ts.next()!;
        if (t.t === "id") ids.push(t);
      }
    }
    const nameTok = ids[ids.length - 1];
    let def: Expr | undefined;
    if (ts.eatPunct("=")) def = parseExpr(ts, 0);
    if (nameTok) params.push({ name: nameTok.v, def });
    ts.eatPunct(",");
  }
  ts.eatPunct(")");
  return params;
}

function parseParamOverrides(ts: TS): { name: string; val: Expr }[] {
  const ov: { name: string; val: Expr }[] = [];
  ts.next(); // #
  if (!ts.eatPunct("(")) return ov;
  while (!ts.atEnd() && !ts.isPunct(")")) {
    if (ts.eatPunct(".")) {
      const name = ts.next();
      ts.eatPunct("(");
      const val = parseExpr(ts, 0);
      ts.eatPunct(")");
      if (name) ov.push({ name: name.v, val });
    } else {
      ts.next();
    }
    ts.eatPunct(",");
  }
  ts.eatPunct(")");
  return ov;
}

function parseInstList(ts: TS): Inst[] {
  const insts: Inst[] = [];
  for (;;) {
    const nameTok = ts.peek();
    if (!nameTok || nameTok.t !== "id") break;
    ts.next();
    const inst: Inst = { name: nameTok.v, overrides: [] };
    // array or range suffix(es)
    while (ts.isPunct("[")) {
      ts.next();
      const first = parseExpr(ts, 0);
      if (ts.eatPunct(":")) {
        const second = parseExpr(ts, 0);
        inst.range = [first, second];
      } else {
        inst.array = first;
      }
      ts.eatPunct("]");
    }
    // = reset
    if (ts.eatPunct("=")) inst.reset = parseExpr(ts, 0);
    // @ addr / += stride / %= align (any order, but spec order is @ += %=)
    for (;;) {
      if (ts.eatPunct("@")) inst.addr = parseExpr(ts, 0);
      else if (ts.eatPunct("+=")) inst.stride = parseExpr(ts, 0);
      else if (ts.eatPunct("%=")) inst.align = parseExpr(ts, 0);
      else break;
    }
    insts.push(inst);
    if (!ts.eatPunct(",")) break;
  }
  return insts;
}

function parseMember(ts: TS): Member[] | null {
  // default property assignment
  if (ts.isId("default")) {
    ts.next();
    const name = ts.next();
    let value: Expr | undefined;
    if (ts.eatPunct("=")) value = parseExpr(ts, 0);
    ts.eatPunct(";");
    return name ? [{ k: "prop", isDefault: true, name: name.v, value }] : null;
  }
  // enum definition
  if (ts.isId("enum")) {
    ts.next();
    const name = ts.next();
    const entries: { name: string; value?: Expr }[] = [];
    if (ts.eatPunct("{")) {
      while (!ts.atEnd() && !ts.isPunct("}")) {
        if (ts.eatPunct(";")) continue;
        const en = ts.next();
        let value: Expr | undefined;
        if (ts.eatPunct("=")) value = parseExpr(ts, 0);
        if (ts.isPunct("{")) skipBraced(ts, "{", "}"); // per-entry property block
        ts.eatPunct(";");
        if (en && en.t === "id") entries.push({ name: en.v, value });
      }
      ts.eatPunct("}");
    }
    ts.eatPunct(";");
    return name ? [{ k: "enum", name: name.v, entries }] : null;
  }
  // user-defined property / struct / constraint — skip the whole construct
  if (ts.isId("property") || ts.isId("struct") || ts.isId("constraint") || ts.isId("abstract")) {
    // skip optional name, a braced body, and trailing ';'
    ts.next();
    while (!ts.atEnd() && !ts.isPunct("{") && !ts.isPunct(";")) ts.next();
    if (ts.isPunct("{")) skipBraced(ts, "{", "}");
    ts.eatPunct(";");
    return [];
  }

  // component definition (possibly with external/internal/alias prefixes)
  let prefixed = false;
  while (ts.isId("external") || ts.isId("internal") || ts.isId("alias")) {
    if (ts.isId("alias")) {
      ts.next();
      ts.next(); // alias target ID
    } else {
      ts.next();
    }
    prefixed = true;
  }

  const head = ts.peek();
  if (head && head.t === "id" && COMP_TYPES.has(head.v)) {
    return parseCompDef(ts);
  }

  // an ID that's not a component keyword: either
  //   - property assignment:  name = expr;   or  boolprop;
  //   - dynamic assignment:    a.b->prop = expr;
  //   - instantiation of a named type:  mytype #(..) i1, i2;
  if (head && head.t === "id") {
    // look ahead to classify
    const save = ts.i;
    const id = ts.next()!.v;
    // dynamic ref?
    if (ts.isPunct(".") || ts.isPunct("->")) {
      const path = [id];
      while (ts.eatPunct(".")) {
        const seg = ts.next();
        if (seg) path.push(seg.v);
        while (ts.isPunct("[")) skipBraced(ts, "[", "]");
      }
      if (ts.eatPunct("->")) {
        const prop = ts.next();
        let value: Expr | undefined;
        if (ts.eatPunct("=")) value = parseExpr(ts, 0);
        ts.eatPunct(";");
        return prop ? [{ k: "dyn", path, prop: prop.v, value }] : [];
      }
      ts.i = save;
    }
    // property assignment:  ID = expr ;   |   ID ;
    if (ts.isPunct("=")) {
      ts.next();
      const value = parseExpr(ts, 0);
      ts.eatPunct(";");
      return [{ k: "prop", isDefault: false, name: id, value }];
    }
    if (ts.isPunct(";") && !prefixed) {
      ts.next();
      return [{ k: "prop", isDefault: false, name: id, value: { k: "num", v: 1 } }];
    }
    // instantiation of a named type
    let overrides: { name: string; val: Expr }[] = [];
    if (ts.isPunct("#")) overrides = parseParamOverrides(ts);
    const insts = parseInstList(ts);
    ts.eatPunct(";");
    if (insts.length) return [{ k: "inst", typeName: id, insts, overrides }];
    return [];
  }

  return null;
}

function parseCompDef(ts: TS): Member[] {
  const type = ts.next()!.v; // component type keyword
  let name: string | undefined;
  let overrides: { name: string; val: Expr }[] = [];
  if (ts.peek()?.t === "id" && !ts.isPunct("{", 0)) {
    // named def: TYPE NAME #(params)? { ... }
    name = ts.next()!.v;
  }
  let params: ParamDef[] = [];
  if (ts.isPunct("#")) {
    // could be param def (.X not present) — peek for '.' to tell override from def
    if (ts.peek(2)?.t === "punct" && ts.peek(2)?.v === ".") overrides = parseParamOverrides(ts);
    else params = parseParamDefs(ts);
  }
  if (!ts.isPunct("{")) {
    // not a real def; bail
    ts.skipStatement();
    return [];
  }
  const open = ts.i;
  skipToBraceStart(ts); // ensure cursor at '{'
  ts.eatPunct("{");
  const members = parseMembers(ts);
  ts.eatPunct("}");
  void open;

  const def: CompDef = { type, name, params, members };
  // optional param overrides between '}' and instances:  } #(.X(1)) inst;
  if (ts.isPunct("#")) overrides = parseParamOverrides(ts);
  const insts = parseInstList(ts);
  ts.eatPunct(";");
  return [{ k: "comp", def, insts, overrides }];
}

function skipToBraceStart(ts: TS) {
  // no-op guard: cursor should already be at '{'
  while (!ts.atEnd() && !ts.isPunct("{")) {
    if (ts.isPunct(";")) return;
    ts.next();
  }
}

// ----------------------------------------------------------------- elaboration

interface Scope {
  params: Map<string, number | string>;
  enums: Map<string, Map<string, number>>;
  defs: Map<string, CompDef>;
  defaults: Map<string, Expr>;
}

function childScope(s: Scope): Scope {
  return {
    params: new Map(s.params),
    enums: new Map(s.enums),
    defs: new Map(s.defs),
    defaults: new Map(s.defaults),
  };
}

function ctxOf(s: Scope): EvalCtx {
  return { params: s.params, enums: s.enums };
}

/** evaluate an instance/def's parameter bindings into a fresh scope */
function bindParams(def: CompDef, overrides: { name: string; val: Expr }[], parent: Scope): Scope {
  const s = childScope(parent);
  // start from defaults declared in the def
  for (const p of def.params) {
    if (p.def) s.params.set(p.name, evalExpr(p.def, ctxOf(parent)));
  }
  // apply overrides (evaluated in the parent scope)
  for (const o of overrides) {
    const sv = evalStr(o.val, ctxOf(parent));
    s.params.set(o.name, sv !== undefined ? sv : evalExpr(o.val, ctxOf(parent)));
  }
  return s;
}

const ACCESS_TOKENS = new Set(["rw", "wr", "r", "w", "rw1", "w1", "na"]);
const ONWRITE_SUFFIX: Record<string, string> = {
  woclr: "1c", woset: "1s", wzc: "0c", wzs: "0s", wot: "1t", wzt: "0t", wclr: "clr", wset: "set",
};

/** fold sw access + onread/onwrite modifiers into a single display token (e.g. rw + woclr -> rw1c) */
function effectiveAccess(props: Map<string, Expr>, ctx: EvalCtx): string {
  const raw = (idValue(props.get("sw")) ?? "rw").toLowerCase();
  // raw may already be a combined/colloquial token (rw1c, rw1s, w1c, w1s, rclr, …) — keep it.
  // only when it's a plain access (rw/r/w/na/wr/rw1/w1) do we fold in onread/onwrite modifiers.
  if (!ACCESS_TOKENS.has(raw)) return raw;

  const onwrite = idValue(props.get("onwrite"));
  const onread = idValue(props.get("onread"));
  let suffix = "";
  if (onwrite && ONWRITE_SUFFIX[onwrite]) suffix = ONWRITE_SUFFIX[onwrite];
  else {
    for (const k of Object.keys(ONWRITE_SUFFIX)) if (isTrue(props.get(k), ctx)) suffix = ONWRITE_SUFFIX[k];
  }
  let token = raw + suffix;
  if (onread === "rclr" || isTrue(props.get("rclr"), ctx)) token = token + "/rc";
  else if (onread === "rset" || isTrue(props.get("rset"), ctx)) token = token + "/rs";
  return token;
}

function idValue(e: Expr | undefined): string | undefined {
  if (e && e.k === "id") return e.name;
  if (e && e.k === "str") return e.v;
  return undefined;
}
function isTrue(e: Expr | undefined, ctx: EvalCtx): boolean {
  return e !== undefined && evalExpr(e, ctx) !== 0;
}

/** gather direct property assignments of a component body (last wins), keeping default fallback */
function gatherProps(members: Member[], defaults: Map<string, Expr>): Map<string, Expr> {
  const props = new Map(defaults);
  for (const m of members) if (m.k === "prop" && !m.isDefault) props.set(m.name, m.value ?? { k: "num", v: 1 });
  return props;
}

function regByteWidth(width: number): number {
  return Math.max(1, Math.ceil(width / 8));
}

function alignUp(v: number, a: number): number {
  return a > 1 ? Math.ceil(v / a) * a : v;
}

/** elaborate a `reg` component into a concrete register (fields resolved) */
function elabReg(def: CompDef, scope: Scope, defaultWidth: number): SfrReg {
  const ctx = ctxOf(scope);
  const props = gatherProps(def.members, scope.defaults);
  const width = props.has("regwidth") ? evalExpr(props.get("regwidth")!, ctx) : defaultWidth;

  const fields: SfrField[] = [];
  // running defaults inside the reg (default sw = ...;), updated in order
  const localDefaults = new Map(scope.defaults);
  const localDefs = new Map(scope.defs);
  let nextLsb = 0;

  const instantiateField = (fdef: CompDef, insts: Inst[], ov: { name: string; val: Expr }[]) => {
    const fScopeBase = bindParams(fdef, ov, { ...scope, defaults: localDefaults });
    for (const inst of insts) {
      const fProps = gatherProps(fdef.members, localDefaults);
      // instance-level field reset (= expr) and explicit width/range
      let msb: number;
      let lsb: number;
      if (inst.range) {
        msb = evalExpr(inst.range[0], ctxOf(fScopeBase));
        lsb = evalExpr(inst.range[1], ctxOf(fScopeBase));
        if (msb < lsb) [msb, lsb] = [lsb, msb];
      } else {
        const w = inst.array
          ? evalExpr(inst.array, ctxOf(fScopeBase))
          : fProps.has("fieldwidth")
            ? evalExpr(fProps.get("fieldwidth")!, ctxOf(fScopeBase))
            : 1;
        lsb = nextLsb;
        msb = lsb + Math.max(1, w) - 1;
      }
      const fctx = ctxOf(fScopeBase);
      const resetExpr = inst.reset ?? fProps.get("reset");
      const f: SfrField = {
        name: inst.name,
        msb,
        lsb,
        width: msb - lsb + 1,
        sw: effectiveAccess(fProps, fctx),
        hw: idValue(fProps.get("hw")) ?? "r",
        desc: evalStr(fProps.get("desc"), fctx),
      };
      if (resetExpr) f.reset = evalExpr(resetExpr, fctx);
      fields.push(f);
      nextLsb = Math.max(nextLsb, msb + 1);
    }
  };

  for (const m of def.members) {
    if (m.k === "prop" && m.isDefault) localDefaults.set(m.name, m.value ?? { k: "num", v: 1 });
    else if (m.k === "comp" && m.def.type === "field") {
      if (m.def.name) localDefs.set(m.def.name, m.def);
      if (m.insts.length) instantiateField(m.def, m.insts, m.overrides);
    } else if (m.k === "inst") {
      const fdef = localDefs.get(m.typeName);
      if (fdef && fdef.type === "field") instantiateField(fdef, m.insts, m.overrides);
    }
  }

  // dynamic assignments targeting fields:  F->reset = ..;  F->sw = ..;
  for (const m of def.members) {
    if (m.k !== "dyn") continue;
    const target = fields.find((f) => f.name === m.path[m.path.length - 1] || f.name === m.path[0]);
    if (!target) continue;
    applyDynToField(target, m.prop, m.value, ctx);
  }

  fields.sort((a, b) => a.lsb - b.lsb);
  return {
    name: "",
    offset: 0,
    width,
    dispName: evalStr(props.get("name"), ctx),
    desc: evalStr(props.get("desc"), ctx),
    fields,
  };
}

function applyDynToField(f: SfrField, prop: string, value: Expr | undefined, ctx: EvalCtx) {
  if (prop === "reset" && value) f.reset = evalExpr(value, ctx);
  else if (prop === "sw" && value && value.k === "id") f.sw = value.name;
  else if (prop === "hw" && value && value.k === "id") f.hw = value.name;
  else if (prop === "desc" && value) f.desc = evalStr(value, ctx) ?? f.desc;
  else if (ONWRITE_SUFFIX[prop]) f.sw = f.sw.replace(/\/.*/, "") + ONWRITE_SUFFIX[prop];
}

/** recursively flatten an addrmap/regfile body into registers with absolute byte offsets */
function collectRegs(members: Member[], scope: Scope, base: number, defaultWidth: number): SfrReg[] {
  const regs: SfrReg[] = [];
  const defaults = new Map(scope.defaults);
  const defs = new Map(scope.defs);
  let cursor = 0;

  const place = (def: CompDef, inst: Inst, ov: { name: string; val: Expr }[]) => {
    const sc: Scope = { ...childScope(scope), defaults, defs };
    const bound = bindParams(def, ov, sc);
    const ictx = ctxOf(bound);
    const count = inst.array ? Math.max(1, evalExpr(inst.array, ictx)) : inst.range ? Math.max(1, evalExpr(inst.range[0], ictx) - evalExpr(inst.range[1], ictx) + 1) : 1;

    if (def.type === "reg") {
      const proto = elabReg(def, bound, defaultWidth);
      const size = regByteWidth(proto.width);
      const start = inst.addr != null ? evalExpr(inst.addr, ictx) : alignUp(cursor, inst.align ? evalExpr(inst.align, ictx) : size);
      const stride = inst.stride != null ? evalExpr(inst.stride, ictx) : size;
      for (let k = 0; k < count; k++) {
        const reg: SfrReg = {
          ...proto,
          fields: proto.fields.map((f) => ({ ...f })),
          name: count > 1 ? `${inst.name}_${k}` : inst.name,
          dispName: count > 1 && proto.dispName ? `${proto.dispName} ${k}` : proto.dispName,
          offset: base + start + k * stride,
        };
        regs.push(reg);
      }
      cursor = Math.max(cursor, start + count * stride);
    } else if (def.type === "regfile" || def.type === "addrmap") {
      // size = extent of one instance
      const childRegs0 = collectRegs(def.members, bound, 0, defaultWidth);
      const extent = childRegs0.reduce((mx, r) => Math.max(mx, r.offset + regByteWidth(r.width)), 0);
      const size = alignUp(extent, 4);
      const start = inst.addr != null ? evalExpr(inst.addr, ictx) : alignUp(cursor, inst.align ? evalExpr(inst.align, ictx) : Math.max(4, size));
      const stride = inst.stride != null ? evalExpr(inst.stride, ictx) : size;
      for (let k = 0; k < count; k++) {
        // namespace nested regfile/addrmap children by the instance (hierarchical path)
        const prefix = count > 1 ? `${inst.name}_${k}_` : `${inst.name}_`;
        for (const r of childRegs0) {
          regs.push({
            ...r,
            fields: r.fields.map((f) => ({ ...f })),
            name: prefix + r.name,
            offset: base + start + k * stride + r.offset,
          });
        }
      }
      cursor = Math.max(cursor, start + count * stride);
    }
    // signal / mem: not part of the register map view → skipped
  };

  for (const m of members) {
    if (m.k === "prop" && m.isDefault) defaults.set(m.name, m.value ?? { k: "num", v: 1 });
    else if (m.k === "comp") {
      if (m.def.name) defs.set(m.def.name, m.def);
      for (const inst of m.insts) place(m.def, inst, m.overrides);
    } else if (m.k === "inst") {
      const def = defs.get(m.typeName);
      if (def) for (const inst of m.insts) place(def, inst, m.overrides);
    }
  }

  // dynamic assignments to registers' fields: R.F->prop or R->prop
  for (const m of members) {
    if (m.k !== "dyn" || m.path.length < 1) continue;
    const reg = regs.find((r) => r.name === m.path[0] || r.name.startsWith(m.path[0] + "_"));
    if (!reg) continue;
    if (m.path.length >= 2) {
      const f = reg.fields.find((x) => x.name === m.path[1]);
      if (f) applyDynToField(f, m.prop, m.value, ctxOf(scope));
    }
  }

  return regs;
}

// ----------------------------------------------------------------- entry

export function parseRdl(src: string, path: string): SfrModule {
  const file = path.split("/").pop() ?? path;
  let members: Member[];
  try {
    members = parseMembers(new TS(tokenize(src)));
  } catch {
    members = [];
  }

  // global enums + named defs at file scope
  const scope: Scope = {
    params: new Map(),
    enums: new Map(),
    defs: new Map(),
    defaults: new Map(),
  };
  for (const m of members) {
    if (m.k === "enum") {
      const map = new Map<string, number>();
      let auto = 0;
      for (const e of m.entries) {
        const v = e.value ? evalExpr(e.value, ctxOf(scope)) : auto;
        map.set(e.name, v);
        auto = v + 1;
      }
      scope.enums.set(m.name, map);
    } else if (m.k === "comp" && m.def.name) {
      scope.defs.set(m.def.name, m.def);
    } else if (m.k === "prop" && m.isDefault) {
      scope.defaults.set(m.name, m.value ?? { k: "num", v: 1 });
    }
  }

  // pick the top addrmap: prefer an addrmap that is instantiated, else the first addrmap def
  const addrmaps = members.filter((m): m is Extract<Member, { k: "comp" }> => m.k === "comp" && m.def.type === "addrmap");
  const top = addrmaps.find((m) => m.insts.length > 0) ?? addrmaps[0];

  if (!top) {
    // no addrmap — maybe the file is a single regfile or bare regs; wrap them
    const looseRegs = collectRegs(members, scope, 0, defaultWidthOf(scope, 32));
    if (looseRegs.length) {
      return { path, file, addrmap: file.replace(/\.rdl$/, ""), regs: dedupeSort(looseRegs) };
    }
    // Empty, comment-only, or otherwise register-less .rdl (e.g. a placeholder
    // for a WIP subsystem). Return an empty module rather than throwing, so one
    // such file can't abort the whole SFR load and drop the later subsystems.
    return { path, file, addrmap: file.replace(/\.rdl$/, ""), regs: [] };
  }

  const inst = top.insts[0];
  const bound = bindParams(top.def, top.overrides, scope);
  const dw = defaultWidthOf(bound, 32);
  const props = gatherProps(top.def.members, bound.defaults);
  const regs = collectRegs(top.def.members, bound, 0, dw);

  return {
    path,
    file,
    addrmap: top.def.name ?? inst?.name ?? file.replace(/\.rdl$/, ""),
    dispName: evalStr(props.get("name"), ctxOf(bound)),
    desc: evalStr(props.get("desc"), ctxOf(bound)),
    regs: dedupeSort(regs),
  };
}

function defaultWidthOf(scope: Scope, fallback: number): number {
  const d = scope.defaults.get("regwidth") ?? scope.defaults.get("accesswidth");
  return d ? evalExpr(d, ctxOf(scope)) : fallback;
}

function dedupeSort(regs: SfrReg[]): SfrReg[] {
  const seen = new Set<string>();
  const out: SfrReg[] = [];
  for (const r of regs.sort((a, b) => a.offset - b.offset)) {
    const key = `${r.name}@${r.offset}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
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
