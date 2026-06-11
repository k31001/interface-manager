/* Parser self-test: regression on the demo subset + SystemRDL 2.0 features. Run: npx tsx scripts/test-rdl.ts */
import { parseRdl, regResetHex } from "../src/lib/rdl";

let fail = 0;
function ok(cond: boolean, label: string, extra?: unknown) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}`, extra ?? "");
    fail++;
  }
}

// ---------------- 1. demo subset (regression) ----------------
console.log("demo subset:");
{
  const m = parseRdl(
    `addrmap uart_common {
       name = "UART Common";
       desc = "Core control.";
       default regwidth = 32;
       reg {
         name = "Control";
         field { desc = "Enable"; sw = rw; hw = r; } EN[0:0] = 0x0;
         field { desc = "Mode"; sw = rw; hw = r; } MODE[2:1] = 0x0;
         field { sw = r; hw = w; } BUSY[8:8] = 0x1;
       } CTRL @ 0x0000;
       reg { field { sw=rw; hw=r; } DIV[15:0] = 0x8B; } BAUD @ 0x0010;
     };`,
    "uart-common.rdl"
  );
  ok(m.addrmap === "uart_common", "addrmap name", m.addrmap);
  ok(m.dispName === "UART Common", "addrmap disp name", m.dispName);
  ok(m.regs.length === 2, "2 regs", m.regs.length);
  const ctrl = m.regs.find((r) => r.name === "CTRL")!;
  ok(ctrl.offset === 0x0, "CTRL offset 0", ctrl.offset);
  ok(ctrl.width === 32, "CTRL width 32", ctrl.width);
  ok(ctrl.fields.length === 3, "CTRL 3 fields", ctrl.fields.length);
  const mode = ctrl.fields.find((f) => f.name === "MODE")!;
  ok(mode.msb === 2 && mode.lsb === 1, "MODE [2:1]", `${mode.msb}:${mode.lsb}`);
  const busy = ctrl.fields.find((f) => f.name === "BUSY")!;
  ok(busy.sw === "r" && busy.reset === 1, "BUSY ro reset 1", `${busy.sw}/${busy.reset}`);
  const baud = m.regs.find((r) => r.name === "BAUD")!;
  ok(baud.fields[0].reset === 0x8b, "BAUD.DIV reset 0x8B", baud.fields[0].reset);
}

// ---------------- 2. parameterized addrmap + arrays ----------------
console.log("parameters + arrays:");
{
  const m = parseRdl(
    `addrmap dma #(longint unsigned NCH = 4, bit [5:0] AW = 12) {
       name = "DMA";
       reg {
         field { sw=rw; hw=r; } EN[0:0] = 0;
         field { sw=rw; hw=r; } ADDR[AW-1:0] = 0;
       } CH[NCH] @ 0x100 += 0x20;
     };`,
    "dma.rdl"
  );
  ok(m.regs.length === 4, "NCH=4 → 4 channel regs", m.regs.length);
  ok(m.regs[0].name === "CH_0" && m.regs[0].offset === 0x100, "CH_0 @ 0x100", `${m.regs[0].name}@${m.regs[0].offset.toString(16)}`);
  ok(m.regs[3].offset === 0x100 + 3 * 0x20, "CH_3 @ 0x160 (stride 0x20)", m.regs[3].offset.toString(16));
  const addr = m.regs[0].fields.find((f) => f.name === "ADDR")!;
  ok(addr.msb === 11 && addr.lsb === 0, "ADDR width from AW=12 → [11:0]", `${addr.msb}:${addr.lsb}`);
}

// ---------------- 3. named def + param override + regfile nesting ----------------
console.log("named def + override + regfile:");
{
  const m = parseRdl(
    `reg my_ctrl #(bit [4:0] W = 8) {
       field { sw=rw; hw=r; } VAL[W-1:0] = 0;
     };
     regfile bank {
       my_ctrl #(.W(16)) WIDE @ 0x0;
       my_ctrl NARROW @ 0x4;
     };
     addrmap top {
       bank B0 @ 0x000;
       bank B1 @ 0x100;
     };`,
    "top.rdl"
  );
  ok(m.regs.length === 4, "2 banks × 2 regs = 4", m.regs.length);
  const wide0 = m.regs.find((r) => r.name === "B0_WIDE")!;
  ok(!!wide0, "regfile-prefixed name B0_WIDE", m.regs.map((r) => r.name).join(","));
  ok(wide0.fields[0].msb === 15, "WIDE override W=16 → [15:0]", wide0.fields[0].msb);
  const b1 = m.regs.find((r) => r.name === "B1_NARROW")!;
  ok(b1.offset === 0x104, "B1_NARROW @ 0x104", b1.offset.toString(16));
}

// ---------------- 4. enum + default + onwrite + dynamic assign ----------------
console.log("enum + default + onwrite + dynamic:");
{
  const m = parseRdl(
    `enum mode_e { OFF = 0; ON = 1; AUTO = 2; };
     addrmap p {
       default sw = rw;
       default hw = r;
       reg {
         field { } M[1:0] = mode_e::AUTO;
         field { onwrite = woclr; } FLAG[4:4] = 0;
         field { sw = r; } ST[8:8];
       } R0 @ 0x0;
       R0.ST->hw = w;
     };`,
    "p.rdl"
  );
  const r0 = m.regs[0];
  const mf = r0.fields.find((f) => f.name === "M")!;
  ok(mf.reset === 2, "M reset from enum AUTO=2", mf.reset);
  ok(mf.sw === "rw", "M inherits default sw=rw", mf.sw);
  const flag = r0.fields.find((f) => f.name === "FLAG")!;
  ok(flag.sw === "rw1c", "FLAG onwrite=woclr → rw1c", flag.sw);
  const st = r0.fields.find((f) => f.name === "ST")!;
  ok(st.hw === "w", "ST hw set to w via dynamic assign", st.hw);
}

// ---------------- 5. addrmap #() with no instances (the reported bug) + sized numbers ----------------
console.log("addrmap #() header + sized numbers:");
{
  const m = parseRdl(
    `addrmap ctrl_blk #(longint unsigned BASE = 0) {
       reg { field { sw=rw; hw=r; } V[7:0] = 8'hA5; } REG0 @ 0x0;
       reg { field { sw=rw; hw=r; } V[3:0] = 4'b1010; } REG1 @ 0x4;
     };`,
    "ctrl.rdl"
  );
  ok(m.addrmap === "ctrl_blk", "parameterized addrmap header parsed", m.addrmap);
  ok(m.regs.length === 2, "2 regs", m.regs.length);
  ok(m.regs[0].fields[0].reset === 0xa5, "REG0.V reset 8'hA5", m.regs[0].fields[0].reset?.toString(16));
  ok(m.regs[1].fields[0].reset === 0b1010, "REG1.V reset 4'b1010", m.regs[1].fields[0].reset);
  ok(regResetHex(m.regs[0]) === "0x000000A5", "regResetHex REG0", regResetHex(m.regs[0]));
}

console.log(fail ? `\n${fail} assertion(s) failed` : "\nAll parser tests passed.");
process.exit(fail ? 1 : 0);
