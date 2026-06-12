/**
 * Shared seed engine + a reusable library of standard peripheral IPs.
 *
 * Generates a SoC interface project as a real git repository with a plausible
 * multi-month commit history, tags, and reuse-degrading mutations driven by a
 * per-tag reuse target. Project-specific scripts (seed.ts, seed-ssd.ts) supply
 * their own IP/HAL libraries and a ProjectPlan, then call seedProject().
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = process.cwd();

// ---------------------------------------------------------------- rng

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
const pick = <T,>(rng: Rng, arr: T[]): T => arr[Math.floor(rng() * arr.length)];
const irand = (rng: Rng, n: number) => Math.floor(rng() * n);
const chance = (rng: Rng, p: number) => rng() < p;

// ---------------------------------------------------------------- runtime model

interface RField {
  name: string;
  lsb: number;
  width: number;
  sw: string;
  hw: string;
  reset: number;
  desc: string;
  baseline: boolean;
}
interface RReg {
  name: string;
  dispName: string;
  offset: number;
  desc: string;
  fields: RField[];
  array?: number; // instance count when this register is an array (NAME[array])
  stride?: number; // byte stride between array elements (defaults to 4)
  baseline: boolean;
}
interface RModule {
  file: string; // file name e.g. uart-common.rdl
  addrmap: string;
  dispName: string;
  desc: string;
  regs: RReg[];
}
interface RIp {
  name: string;
  subsystem: string;
  modules: RModule[];
  fieldPool: FieldSpec[];
  regPool: RegSpec[];
}

interface RParam {
  type: string;
  name: string;
  desc: string;
  def?: string;
}
interface RFn {
  name: string;
  ret: string;
  params: RParam[];
  isConst: boolean;
  brief: string;
  returns?: string;
  notes: string[];
  warnings: string[];
  deprecated?: string;
  baseline: boolean;
}
interface RClass {
  name: string;
  brief: string;
  fns: RFn[];
}
interface RHalFile {
  file: string; // path under hal include dir, e.g. backbone/uart_hal.h
  brief: string;
  ip: string;
  classes: RClass[];
  fnPool: { cls: string; fn: FnSpec }[];
}

// ---------------------------------------------------------------- spec DSL

export interface FieldSpec {
  name: string;
  width: number;
  desc: string;
  sw?: string;
  hw?: string;
  reset?: number;
  at?: number;
}
export interface RegSpec {
  name: string;
  offset?: number;
  dispName: string;
  desc: string;
  sw?: string;
  hw?: string;
  array?: number; // emit as an array instance NAME[array]
  stride?: number; // byte stride between elements (defaults to 4)
  baseline?: boolean; // false → excluded from reuse-degrading mutations (stays stable)
  fields: FieldSpec[];
}
export const f = (name: string, width: number, desc: string, opts: Partial<FieldSpec> = {}): FieldSpec => ({
  name,
  width,
  desc,
  ...opts,
});
export const r = (name: string, offset: number, dispName: string, desc: string, fields: FieldSpec[], opts: Partial<RegSpec> = {}): RegSpec => ({
  name,
  offset,
  dispName,
  desc,
  fields,
  ...opts,
});

function buildReg(spec: RegSpec, offset: number): RReg {
  let cursor = 0;
  const fields: RField[] = spec.fields.map((fs) => {
    const lsb = fs.at ?? cursor;
    cursor = lsb + fs.width;
    return {
      name: fs.name,
      lsb,
      width: fs.width,
      sw: fs.sw ?? spec.sw ?? "rw",
      hw: fs.hw ?? spec.hw ?? "r",
      reset: fs.reset ?? 0,
      desc: fs.desc,
      baseline: true,
    };
  });
  return { name: spec.name, dispName: spec.dispName, offset, desc: spec.desc, fields, array: spec.array, stride: spec.stride, baseline: spec.baseline ?? true };
}

export interface ParamSpec {
  type: string;
  name: string;
  desc: string;
  def?: string;
}
export interface FnSpec {
  ret: string;
  name: string;
  params: ParamSpec[];
  brief: string;
  returns?: string;
  notes?: string[];
  warnings?: string[];
  isConst?: boolean;
}
export const p = (type: string, name: string, desc: string, def?: string): ParamSpec => ({ type, name, desc, def });
export const fn = (ret: string, name: string, params: ParamSpec[], brief: string, opts: Partial<FnSpec> = {}): FnSpec => ({
  ret,
  name,
  params,
  brief,
  ...opts,
});

function buildFn(spec: FnSpec): RFn {
  return {
    name: spec.name,
    ret: spec.ret,
    params: spec.params.map((ps) => ({ ...ps })),
    isConst: !!spec.isConst,
    brief: spec.brief,
    returns: spec.returns,
    notes: spec.notes ?? [],
    warnings: spec.warnings ?? [],
    baseline: true,
  };
}

// ---------------------------------------------------------------- IP library (SFR)

export type IpDef = {
  modules: { file: string; addrmap: string; dispName: string; desc: string; regs: RegSpec[] }[];
  fieldPool: FieldSpec[];
  regPool: RegSpec[];
};

export const STATUS = { sw: "r", hw: "w" };
export const W1C = { sw: "rw1c", hw: "w" };

export const IP_LIB: Record<string, () => IpDef> = {
  uart: () => ({
    modules: [
      {
        file: "uart-common.rdl",
        addrmap: "uart_common",
        dispName: "UART Common",
        desc: "Core control, status, interrupt and baud-rate registers of the UART controller.",
        regs: [
          r("CTRL", 0x00, "Control", "Global control register.", [
            f("EN", 1, "Enable the UART controller."),
            f("MODE", 2, "Operating mode. 0: normal, 1: IrDA, 2: RS-485."),
            f("PARITY", 2, "Parity selection. 0: none, 1: even, 2: odd."),
            f("STOP_BITS", 1, "Stop bits. 0: one, 1: two."),
            f("LOOPBACK", 1, "Internal loopback enable for self-test."),
            f("TX_EN", 1, "Transmitter enable.", { at: 8, reset: 1 }),
            f("RX_EN", 1, "Receiver enable.", { reset: 1 }),
          ]),
          r("STAT", 0x04, "Status", "Live controller status.", [
            f("TX_BUSY", 1, "Transmitter shift register busy."),
            f("RX_BUSY", 1, "Receiver shift register busy."),
            f("TX_EMPTY", 1, "TX FIFO empty.", { reset: 1 }),
            f("RX_FULL", 1, "RX FIFO full."),
            f("PARITY_ERR", 1, "Parity error detected."),
            f("FRAME_ERR", 1, "Framing error detected."),
            f("OVERRUN", 1, "RX overrun occurred."),
          ], STATUS),
          r("INT_EN", 0x08, "Interrupt Enable", "Per-source interrupt enables.", [
            f("TX_DONE", 1, "Transmit complete interrupt enable."),
            f("RX_READY", 1, "Receive data ready interrupt enable."),
            f("RX_TIMEOUT", 1, "Receive timeout interrupt enable."),
            f("ERR", 1, "Error (parity/frame/overrun) interrupt enable."),
          ]),
          r("INT_STAT", 0x0c, "Interrupt Status", "Sticky interrupt flags. Write 1 to clear.", [
            f("TX_DONE", 1, "Transmit complete."),
            f("RX_READY", 1, "Receive data ready."),
            f("RX_TIMEOUT", 1, "Receive timeout expired."),
            f("ERR", 1, "Line error occurred."),
          ], W1C),
          r("BAUD", 0x10, "Baud Rate", "Baud-rate generator configuration.", [
            f("DIV", 16, "Integer divider from the UART reference clock.", { reset: 0x8b }),
            f("FRAC", 4, "Fractional divider in 1/16 units."),
          ]),
        ],
      },
      {
        file: "uart-config.rdl",
        addrmap: "uart_config",
        dispName: "UART Config",
        desc: "FIFO, flow-control and timeout configuration of the UART controller.",
        regs: [
          r("FIFO_CTRL", 0x00, "FIFO Control", "FIFO threshold and flush control.", [
            f("TX_THRESH", 4, "TX FIFO interrupt threshold.", { reset: 0x8 }),
            f("RX_THRESH", 4, "RX FIFO interrupt threshold.", { reset: 0x8 }),
            f("TX_FLUSH", 1, "Write 1 to flush the TX FIFO.", { sw: "w" }),
            f("RX_FLUSH", 1, "Write 1 to flush the RX FIFO.", { sw: "w" }),
          ]),
          r("FIFO_STAT", 0x04, "FIFO Status", "Current FIFO fill levels.", [
            f("TX_LEVEL", 5, "Number of entries in the TX FIFO."),
            f("RX_LEVEL", 5, "Number of entries in the RX FIFO.", { at: 8 }),
          ], STATUS),
          r("FLOW", 0x08, "Flow Control", "Hardware flow-control configuration.", [
            f("CTS_EN", 1, "Enable CTS-based transmit gating."),
            f("RTS_EN", 1, "Enable RTS generation."),
            f("RTS_THRESH", 4, "RX FIFO level that de-asserts RTS.", { at: 4, reset: 0xc }),
          ]),
          r("TIMEOUT", 0x0c, "RX Timeout", "Idle-time based receive timeout.", [
            f("VAL", 8, "Timeout in bit periods.", { reset: 0x40 }),
            f("EN", 1, "Enable receive timeout detection."),
          ]),
        ],
      },
    ],
    fieldPool: [
      f("DMA_TX_EN", 1, "Enable DMA handshake for TX FIFO."),
      f("DMA_RX_EN", 1, "Enable DMA handshake for RX FIFO."),
      f("RX_INV", 1, "Invert RX line polarity."),
      f("NINE_BIT", 1, "Enable 9-bit multidrop mode."),
      f("ADDR_MATCH", 8, "Address byte to match in multidrop mode."),
    ],
    regPool: [
      r("DBG", 0, "Debug", "Debug visibility into internal state.", [
        f("FSM_STATE", 4, "Internal FSM state.", { sw: "r", hw: "w" }),
        f("RX_SHIFT", 8, "Live RX shift register.", { sw: "r", hw: "w", at: 8 }),
      ]),
      r("ADDR", 0, "Address Match", "RS-485 address match configuration.", [
        f("ADDR", 8, "Station address."),
        f("MASK", 8, "Address compare mask.", { reset: 0xff }),
      ]),
    ],
  }),

  i2c: () => ({
    modules: [
      {
        file: "i2c.rdl",
        addrmap: "i2c_core",
        dispName: "I2C Core",
        desc: "I2C master/slave controller registers.",
        regs: [
          r("CTRL", 0x00, "Control", "Global control register.", [
            f("EN", 1, "Enable the I2C controller."),
            f("MASTER", 1, "1: master mode, 0: slave mode.", { reset: 1 }),
            f("SPEED", 2, "Bus speed. 0: standard, 1: fast, 2: fast+, 3: high-speed."),
            f("ADDR_MODE", 1, "0: 7-bit addressing, 1: 10-bit addressing."),
            f("STRETCH_EN", 1, "Allow clock stretching.", { reset: 1 }),
          ]),
          r("STAT", 0x04, "Status", "Bus and FIFO status.", [
            f("BUSY", 1, "Bus transaction in progress."),
            f("ARB_LOST", 1, "Arbitration lost in master mode."),
            f("NACK", 1, "Last byte was not acknowledged."),
            f("BUS_ERR", 1, "Illegal START/STOP detected."),
            f("TX_EMPTY", 1, "TX buffer empty.", { reset: 1 }),
            f("RX_FULL", 1, "RX buffer full."),
          ], STATUS),
          r("OWN_ADDR", 0x08, "Own Address", "Slave-mode own address.", [
            f("ADDR", 10, "Own address (7 or 10 bit)."),
            f("EN", 1, "Respond to own address.", { at: 12 }),
          ]),
          r("DATA", 0x0c, "Data", "Transmit/receive data window.", [
            f("DATA", 8, "Write to transmit, read to receive."),
          ]),
          r("CLK_DIV", 0x10, "Clock Divider", "SCL timing configuration.", [
            f("SCL_LOW", 8, "SCL low period in ref-clock cycles.", { reset: 0x32 }),
            f("SCL_HIGH", 8, "SCL high period in ref-clock cycles.", { reset: 0x32 }),
            f("SDA_HOLD", 4, "SDA hold time in ref-clock cycles.", { reset: 0x4 }),
          ]),
          r("INT_EN", 0x14, "Interrupt Enable", "Per-source interrupt enables.", [
            f("DONE", 1, "Transfer complete interrupt enable."),
            f("NACK", 1, "NACK received interrupt enable."),
            f("ARB_LOST", 1, "Arbitration lost interrupt enable."),
            f("RX_READY", 1, "RX data ready interrupt enable."),
          ]),
          r("INT_STAT", 0x18, "Interrupt Status", "Sticky interrupt flags. Write 1 to clear.", [
            f("DONE", 1, "Transfer complete."),
            f("NACK", 1, "NACK received."),
            f("ARB_LOST", 1, "Arbitration lost."),
            f("RX_READY", 1, "RX data ready."),
          ], W1C),
        ],
      },
    ],
    fieldPool: [
      f("GCALL_EN", 1, "Respond to general-call address."),
      f("SMBUS_EN", 1, "Enable SMBus timeout semantics."),
      f("FILTER_LEN", 3, "Glitch filter length in ref-clock cycles."),
    ],
    regPool: [
      r("TIMEOUT", 0, "Bus Timeout", "SMBus-style clock-low timeout.", [
        f("VAL", 16, "Timeout in ref-clock cycles.", { reset: 0x9c40 }),
        f("EN", 1, "Enable bus timeout detection."),
      ]),
      r("FIFO_CTRL", 0, "FIFO Control", "FIFO thresholds.", [
        f("TX_THRESH", 3, "TX FIFO threshold.", { reset: 2 }),
        f("RX_THRESH", 3, "RX FIFO threshold.", { at: 4, reset: 2 }),
      ]),
    ],
  }),

  spi: () => ({
    modules: [
      {
        file: "spi-master.rdl",
        addrmap: "spi_master",
        dispName: "SPI Master",
        desc: "SPI master engine: clocking, chip-select and data path.",
        regs: [
          r("CTRL", 0x00, "Control", "Master control register.", [
            f("EN", 1, "Enable the SPI master."),
            f("CPOL", 1, "Clock polarity."),
            f("CPHA", 1, "Clock phase."),
            f("LSB_FIRST", 1, "Transmit LSB first."),
            f("WORD_LEN", 5, "Word length minus one.", { reset: 0x7 }),
            f("CS_AUTO", 1, "Automatic chip-select handling.", { reset: 1 }),
          ]),
          r("CLK_DIV", 0x04, "Clock Divider", "SCK generation.", [
            f("DIV", 12, "Even divider from peripheral clock.", { reset: 0x4 }),
          ]),
          r("CS_CTRL", 0x08, "Chip Select", "Chip-select selection and timing.", [
            f("CS_SEL", 2, "Active chip-select line."),
            f("CS_POL", 4, "Per-line CS polarity.", { at: 4 }),
            f("SETUP_T", 4, "CS setup time in SCK cycles.", { at: 8, reset: 1 }),
            f("HOLD_T", 4, "CS hold time in SCK cycles.", { reset: 1 }),
          ]),
          r("STAT", 0x0c, "Status", "Engine and FIFO status.", [
            f("BUSY", 1, "Transfer in progress."),
            f("TX_EMPTY", 1, "TX FIFO empty.", { reset: 1 }),
            f("RX_FULL", 1, "RX FIFO full."),
            f("UNDERRUN", 1, "TX underrun occurred."),
            f("OVERRUN", 1, "RX overrun occurred."),
          ], STATUS),
          r("DATA", 0x10, "Data", "Transmit/receive data window.", [
            f("DATA", 32, "Write to enqueue TX word, read to dequeue RX word."),
          ]),
          r("INT_EN", 0x14, "Interrupt Enable", "Per-source interrupt enables.", [
            f("DONE", 1, "Transfer complete interrupt enable."),
            f("RX_READY", 1, "RX data ready interrupt enable."),
            f("ERR", 1, "Underrun/overrun interrupt enable."),
          ]),
          r("INT_STAT", 0x18, "Interrupt Status", "Sticky interrupt flags. Write 1 to clear.", [
            f("DONE", 1, "Transfer complete."),
            f("RX_READY", 1, "RX data ready."),
            f("ERR", 1, "FIFO error occurred."),
          ], W1C),
        ],
      },
      {
        file: "spi-slave.rdl",
        addrmap: "spi_slave",
        dispName: "SPI Slave",
        desc: "SPI slave endpoint registers.",
        regs: [
          r("CTRL", 0x00, "Control", "Slave control register.", [
            f("EN", 1, "Enable the SPI slave."),
            f("CPOL", 1, "Expected clock polarity."),
            f("CPHA", 1, "Expected clock phase."),
            f("WORD_LEN", 5, "Word length minus one.", { reset: 0x7 }),
          ]),
          r("STAT", 0x04, "Status", "Slave status.", [
            f("SELECTED", 1, "Chip-select currently asserted."),
            f("RX_FULL", 1, "RX buffer full."),
            f("TX_EMPTY", 1, "TX buffer empty.", { reset: 1 }),
          ], STATUS),
          r("DATA", 0x08, "Data", "Transmit/receive data window.", [
            f("DATA", 32, "Write to stage TX word, read to fetch RX word."),
          ]),
        ],
      },
    ],
    fieldPool: [
      f("DMA_EN", 1, "Enable DMA handshake."),
      f("DUMMY_CYCLES", 4, "Dummy cycles between command and data phase."),
      f("DDR_EN", 1, "Enable double-data-rate sampling."),
    ],
    regPool: [
      r("DLY_CTRL", 0, "Delay Control", "Sampling and drive delay tuning.", [
        f("SAMPLE_DLY", 3, "RX sampling delay in half SCK cycles."),
        f("DRIVE_DLY", 3, "TX drive delay in half SCK cycles.", { at: 4 }),
      ]),
    ],
  }),

  dma: () => ({
    modules: [
      {
        file: "dma-core.rdl",
        addrmap: "dma_core",
        dispName: "DMA Core",
        desc: "Shared DMA engine control and arbitration.",
        regs: [
          r("CTRL", 0x00, "Control", "Engine-level control.", [
            f("EN", 1, "Enable the DMA engine."),
            f("ARB_MODE", 2, "Arbitration. 0: round-robin, 1: fixed priority, 2: weighted."),
            f("HALT", 1, "Gracefully halt at next beat boundary."),
          ]),
          r("STAT", 0x04, "Status", "Engine status.", [
            f("ACTIVE", 1, "Any channel transferring."),
            f("HALTED", 1, "Engine is halted."),
            f("ERR_CH", 4, "Channel index of the last error.", { at: 8 }),
          ], STATUS),
          r("INT_EN", 0x08, "Interrupt Enable", "Per-source interrupt enables.", [
            f("DONE", 1, "Channel done interrupt enable."),
            f("ERR", 1, "Bus error interrupt enable."),
            f("ABORT", 1, "Abort complete interrupt enable."),
          ]),
          r("INT_STAT", 0x0c, "Interrupt Status", "Sticky interrupt flags. Write 1 to clear.", [
            f("DONE", 1, "A channel finished its transfer."),
            f("ERR", 1, "A bus error occurred."),
            f("ABORT", 1, "An abort completed."),
          ], W1C),
          r("PRIO", 0x10, "Priority", "Per-channel arbitration priority.", [
            f("CH0", 2, "Channel 0 priority."),
            f("CH1", 2, "Channel 1 priority."),
            f("CH2", 2, "Channel 2 priority."),
            f("CH3", 2, "Channel 3 priority."),
          ]),
          r("ERR_ADDR", 0x14, "Error Address", "Faulting bus address of the last error.", [
            f("ADDR", 32, "Captured error address."),
          ], STATUS),
        ],
      },
      {
        file: "dma-channel.rdl",
        addrmap: "dma_channel",
        dispName: "DMA Channel",
        desc: "Per-channel transfer configuration (one instance per channel).",
        regs: [
          r("CH_CFG", 0x00, "Channel Config", "Transfer shape configuration.", [
            f("EN", 1, "Arm the channel."),
            f("DIR", 2, "Direction. 0: mem-to-mem, 1: mem-to-periph, 2: periph-to-mem."),
            f("SRC_INC", 1, "Increment source address.", { reset: 1 }),
            f("DST_INC", 1, "Increment destination address.", { reset: 1 }),
            f("BURST", 3, "Burst length, 2^N beats.", { reset: 2 }),
            f("WIDTH", 2, "Beat width. 0: 8-bit, 1: 16-bit, 2: 32-bit.", { reset: 2 }),
          ]),
          r("CH_SRC", 0x04, "Source Address", "Transfer source address.", [
            f("ADDR", 32, "Byte-aligned source address."),
          ]),
          r("CH_DST", 0x08, "Destination Address", "Transfer destination address.", [
            f("ADDR", 32, "Byte-aligned destination address."),
          ]),
          r("CH_LEN", 0x0c, "Length", "Transfer length.", [
            f("BYTES", 24, "Number of bytes to move."),
          ]),
          r("CH_STAT", 0x10, "Channel Status", "Per-channel live status.", [
            f("BUSY", 1, "Channel transferring."),
            f("DONE", 1, "Channel finished."),
            f("ERR", 1, "Channel faulted."),
            f("REMAIN", 24, "Remaining bytes.", { at: 8 }),
          ], STATUS),
          r("SG_DESC", 0x14, "SG Descriptor", "Scatter-gather descriptor table — one buffer pointer per slot.", [
            f("ADDR", 32, "Buffer address for this descriptor slot."),
          ], { array: 8, stride: 4, baseline: false }),
        ],
      },
    ],
    fieldPool: [
      f("LINK_EN", 1, "Enable linked-list descriptor chaining."),
      f("RELOAD_EN", 1, "Auto-reload configuration on completion."),
      f("FLOW_CTRL", 2, "Flow controller. 0: DMA, 1: source, 2: destination."),
      f("QOS", 2, "Bus QoS hint for this channel."),
    ],
    regPool: [
      r("CH_LINK", 0, "Link Address", "Next descriptor address for chaining.", [
        f("ADDR", 32, "Descriptor address, 16-byte aligned."),
      ]),
    ],
  }),

  gpio: () => ({
    modules: [
      {
        file: "gpio.rdl",
        addrmap: "gpio",
        dispName: "GPIO",
        desc: "General-purpose I/O bank (32 pins per bank).",
        regs: [
          r("DATA_IN", 0x00, "Input Data", "Synchronized pin input values.", [
            f("VAL", 32, "Per-pin input level."),
          ], STATUS),
          r("DATA_OUT", 0x04, "Output Data", "Output values for pins configured as outputs.", [
            f("VAL", 32, "Per-pin output level."),
          ]),
          r("DIR", 0x08, "Direction", "Per-pin direction. 0: input, 1: output.", [
            f("VAL", 32, "Per-pin direction bit."),
          ]),
          r("PULL_EN", 0x0c, "Pull Enable", "Per-pin pull resistor enable.", [
            f("VAL", 32, "Per-pin pull enable."),
          ]),
          r("PULL_SEL", 0x10, "Pull Select", "Per-pin pull direction. 0: down, 1: up.", [
            f("VAL", 32, "Per-pin pull selection."),
          ]),
          r("INT_EN", 0x14, "Interrupt Enable", "Per-pin interrupt enable.", [
            f("VAL", 32, "Per-pin interrupt enable."),
          ]),
          r("INT_TYPE", 0x18, "Interrupt Type", "Per-pin trigger type. 0: level, 1: edge.", [
            f("VAL", 32, "Per-pin trigger type."),
          ]),
          r("INT_POL", 0x1c, "Interrupt Polarity", "Per-pin polarity. 0: low/falling, 1: high/rising.", [
            f("VAL", 32, "Per-pin polarity."),
          ]),
          r("INT_STAT", 0x20, "Interrupt Status", "Per-pin sticky interrupt flags. Write 1 to clear.", [
            f("VAL", 32, "Per-pin interrupt pending."),
          ], W1C),
        ],
      },
    ],
    fieldPool: [],
    regPool: [
      r("DEBOUNCE", 0, "Debounce", "Input debounce filter configuration.", [
        f("EN", 1, "Enable debounce filtering."),
        f("CYCLES", 8, "Filter length in slow-clock cycles.", { at: 4, reset: 0x10 }),
      ]),
      r("OUT_SET", 0, "Output Set", "Write 1 to set output bits atomically.", [
        f("VAL", 32, "Per-pin set strobe.", { sw: "w" }),
      ]),
      r("OUT_CLR", 0, "Output Clear", "Write 1 to clear output bits atomically.", [
        f("VAL", 32, "Per-pin clear strobe.", { sw: "w" }),
      ]),
    ],
  }),

  timer: () => ({
    modules: [
      {
        file: "timer-core.rdl",
        addrmap: "timer_core",
        dispName: "Timer Core",
        desc: "General-purpose 32-bit timer with two match channels.",
        regs: [
          r("CTRL", 0x00, "Control", "Timer control.", [
            f("EN", 1, "Enable the counter."),
            f("ONESHOT", 1, "Stop after first wrap/match."),
            f("DIR", 1, "Count direction. 0: up, 1: down."),
            f("PRESCALE", 4, "Clock prescaler, 2^N.", { at: 4 }),
            f("CLK_SEL", 2, "Clock source. 0: bus, 1: ext, 2: slow.", { at: 8 }),
          ]),
          r("LOAD", 0x04, "Load", "Counter reload value.", [
            f("VAL", 32, "Value loaded on wrap or restart."),
          ]),
          r("VALUE", 0x08, "Value", "Live counter value.", [
            f("VAL", 32, "Current count."),
          ], STATUS),
          r("MATCH0", 0x0c, "Match 0", "Match channel 0 compare value.", [
            f("VAL", 32, "Compare value."),
          ]),
          r("MATCH1", 0x10, "Match 1", "Match channel 1 compare value.", [
            f("VAL", 32, "Compare value."),
          ]),
          r("INT_EN", 0x14, "Interrupt Enable", "Per-source interrupt enables.", [
            f("OVF", 1, "Overflow interrupt enable."),
            f("MATCH0", 1, "Match 0 interrupt enable."),
            f("MATCH1", 1, "Match 1 interrupt enable."),
          ]),
          r("INT_STAT", 0x18, "Interrupt Status", "Sticky interrupt flags. Write 1 to clear.", [
            f("OVF", 1, "Counter overflowed."),
            f("MATCH0", 1, "Match 0 hit."),
            f("MATCH1", 1, "Match 1 hit."),
          ], W1C),
        ],
      },
      {
        file: "timer-pwm.rdl",
        addrmap: "timer_pwm",
        dispName: "Timer PWM",
        desc: "PWM output stage attached to the timer core.",
        regs: [
          r("PWM_CTRL", 0x00, "PWM Control", "PWM output control.", [
            f("EN", 1, "Enable PWM output."),
            f("POL", 1, "Output polarity."),
            f("ALIGN", 1, "0: edge aligned, 1: center aligned."),
            f("IDLE_STATE", 1, "Pin level while disabled."),
          ]),
          r("PERIOD", 0x04, "Period", "PWM period.", [
            f("VAL", 16, "Period in timer ticks.", { reset: 0x3ff }),
          ]),
          r("DUTY", 0x08, "Duty", "PWM duty cycle.", [
            f("VAL", 16, "High time in timer ticks.", { reset: 0x1ff }),
          ]),
          r("DEADTIME", 0x0c, "Deadtime", "Complementary output deadtime.", [
            f("RISE", 8, "Rising-edge deadtime in ticks."),
            f("FALL", 8, "Falling-edge deadtime in ticks."),
          ]),
        ],
      },
    ],
    fieldPool: [
      f("SYNC_EN", 1, "Synchronize updates to period boundary."),
      f("FAULT_EN", 1, "Enable fault input to kill PWM output."),
      f("BRAKE_EN", 1, "Enable brake state on fault."),
    ],
    regPool: [
      r("CAPTURE", 0, "Capture", "Input capture value on event.", [
        f("VAL", 32, "Captured counter value.", { sw: "r", hw: "w" }),
      ]),
    ],
  }),

  wdt: () => ({
    modules: [
      {
        file: "wdt.rdl",
        addrmap: "wdt",
        dispName: "Watchdog",
        desc: "System watchdog timer with windowed mode and lock protection.",
        regs: [
          r("CTRL", 0x00, "Control", "Watchdog control.", [
            f("EN", 1, "Enable the watchdog."),
            f("RESET_EN", 1, "Assert system reset on timeout.", { reset: 1 }),
            f("PAUSE_DBG", 1, "Pause while a debugger is attached.", { reset: 1 }),
            f("WIN_EN", 1, "Enable windowed-kick mode."),
          ]),
          r("LOAD", 0x04, "Load", "Timeout reload value.", [
            f("VAL", 24, "Timeout in slow-clock cycles.", { reset: 0xffffff }),
          ]),
          r("VALUE", 0x08, "Value", "Live countdown value.", [
            f("VAL", 24, "Current count."),
          ], STATUS),
          r("KICK", 0x0c, "Kick", "Service register.", [
            f("KEY", 16, "Write 0x5A5A to service the watchdog.", { sw: "w" }),
          ]),
          r("LOCK", 0x10, "Lock", "Configuration lock.", [
            f("KEY", 16, "Write 0xACCE to toggle the lock.", { sw: "w" }),
            f("LOCKED", 1, "Configuration is locked.", { at: 16, sw: "r", hw: "w" }),
          ]),
          r("INT_STAT", 0x14, "Interrupt Status", "Sticky interrupt flags. Write 1 to clear.", [
            f("PRE_TIMEOUT", 1, "Pre-timeout warning fired."),
          ], W1C),
        ],
      },
    ],
    fieldPool: [
      f("PRE_TIMEOUT_EN", 1, "Enable pre-timeout warning interrupt."),
    ],
    regPool: [
      r("WIN_START", 0, "Window Start", "Earliest allowed kick point in windowed mode.", [
        f("VAL", 24, "Window start in slow-clock cycles.", { reset: 0x100 }),
      ]),
    ],
  }),

  rtc: () => ({
    modules: [
      {
        file: "rtc.rdl",
        addrmap: "rtc",
        dispName: "RTC",
        desc: "Real-time clock with alarm and digital calibration.",
        regs: [
          r("CTRL", 0x00, "Control", "RTC control.", [
            f("EN", 1, "Enable the RTC counter."),
            f("ALARM_EN", 1, "Enable alarm comparison."),
            f("TICK_EN", 1, "Enable periodic tick interrupt."),
            f("CAL_EN", 1, "Enable digital calibration."),
          ]),
          r("TIME", 0x04, "Time", "Seconds counter.", [
            f("SEC", 32, "Seconds since epoch."),
          ], STATUS),
          r("SUBSEC", 0x08, "Sub-second", "Sub-second counter.", [
            f("VAL", 15, "Sub-second count (32768 Hz)."),
          ], STATUS),
          r("ALARM", 0x0c, "Alarm", "Alarm compare value.", [
            f("SEC", 32, "Alarm seconds value."),
          ]),
          r("CALIB", 0x10, "Calibration", "Digital frequency calibration.", [
            f("PPM", 9, "Correction magnitude in ppm."),
            f("DIR", 1, "Correction direction. 0: slow down, 1: speed up.", { at: 12 }),
          ]),
          r("INT_STAT", 0x14, "Interrupt Status", "Sticky interrupt flags. Write 1 to clear.", [
            f("ALARM", 1, "Alarm matched."),
            f("TICK", 1, "Periodic tick fired."),
          ], W1C),
        ],
      },
    ],
    fieldPool: [
      f("ALARM_MASK", 4, "Mask alarm comparison per byte lane."),
    ],
    regPool: [
      r("TAMPER_CTRL", 0, "Tamper Control", "Tamper pin detection.", [
        f("EN", 1, "Enable tamper detection."),
        f("POL", 1, "Tamper pin active polarity."),
      ]),
    ],
  }),

  crypto: () => ({
    modules: [
      {
        file: "crypto-aes.rdl",
        addrmap: "crypto_aes",
        dispName: "AES Engine",
        desc: "AES block cipher engine with key-ladder integration.",
        regs: [
          r("CTRL", 0x00, "Control", "Cipher control.", [
            f("EN", 1, "Enable the AES engine."),
            f("MODE", 3, "Cipher mode. 0: ECB, 1: CBC, 2: CTR, 3: GCM, 4: XTS."),
            f("KEY_SIZE", 2, "Key size. 0: 128, 1: 192, 2: 256.", { reset: 2 }),
            f("DECRYPT", 1, "1: decrypt, 0: encrypt."),
            f("BYTE_SWAP", 1, "Byte-swap data words."),
          ]),
          r("STAT", 0x04, "Status", "Engine status.", [
            f("BUSY", 1, "Operation in progress."),
            f("DONE", 1, "Block complete."),
            f("ERR", 1, "Configuration error."),
          ], STATUS),
          r("KEY_CTRL", 0x08, "Key Control", "Key-ladder slot control.", [
            f("SLOT", 3, "Key ladder slot select."),
            f("LOAD", 1, "Strobe: load key from selected slot.", { at: 4, sw: "w" }),
            f("CLEAR", 1, "Strobe: zeroize working key.", { sw: "w" }),
            f("LOCKED", 1, "Selected slot is locked.", { at: 8, sw: "r", hw: "w" }),
          ]),
          r("IV_CTRL", 0x0c, "IV Control", "Initialization vector control.", [
            f("LOAD", 1, "Strobe: latch IV registers.", { sw: "w" }),
            f("IV_SEL", 2, "IV source. 0: software, 1: RNG, 2: chained.", { at: 4 }),
          ]),
          r("DATA_IN", 0x10, "Data In", "Plaintext/ciphertext input window.", [
            f("WORD", 32, "Input data word.", { sw: "w" }),
          ]),
          r("DATA_OUT", 0x14, "Data Out", "Result output window.", [
            f("WORD", 32, "Output data word."),
          ], STATUS),
          r("SUSPEND", 0x18, "Suspend", "Context save/restore for preemption.", [
            f("REQ", 1, "Request context suspend."),
            f("ACK", 1, "Suspend acknowledged.", { sw: "r", hw: "w" }),
            f("CTX_SLOT", 2, "Context save slot.", { at: 4 }),
          ]),
        ],
      },
      {
        file: "crypto-sha.rdl",
        addrmap: "crypto_sha",
        dispName: "SHA Engine",
        desc: "SHA hash engine with HMAC support.",
        regs: [
          r("CTRL", 0x00, "Control", "Hash control.", [
            f("EN", 1, "Enable the SHA engine."),
            f("MODE", 2, "Hash mode. 0: SHA-1, 1: SHA-224, 2: SHA-256, 3: SHA-512.", { reset: 2 }),
            f("HMAC_EN", 1, "Enable HMAC keyed mode."),
          ]),
          r("STAT", 0x04, "Status", "Engine status.", [
            f("BUSY", 1, "Digest round in progress."),
            f("DONE", 1, "Digest ready."),
          ], STATUS),
          r("DATA_IN", 0x08, "Data In", "Message word input window.", [
            f("WORD", 32, "Message data word.", { sw: "w" }),
          ]),
          r("MSG_LEN_LO", 0x0c, "Message Length Low", "Total message length, low word.", [
            f("VAL", 32, "Bit length [31:0]."),
          ]),
          r("MSG_LEN_HI", 0x10, "Message Length High", "Total message length, high word.", [
            f("VAL", 32, "Bit length [63:32]."),
          ]),
          r("DIGEST_IDX", 0x14, "Digest Index", "Digest word read index.", [
            f("IDX", 3, "Digest word index for reads."),
            f("AUTO_INC", 1, "Auto-increment index on read.", { at: 4, reset: 1 }),
          ]),
        ],
      },
    ],
    fieldPool: [
      f("KEY_GEN_EN", 1, "Enable on-die key generation."),
      f("DPA_MASK_EN", 1, "Enable DPA masking countermeasure."),
      f("ZEROIZE", 1, "Strobe: zeroize all engine state.", { sw: "w" }),
      f("PAD_AUTO", 1, "Automatic message padding.", { reset: 1 }),
    ],
    regPool: [
      r("CTX_CTRL", 0, "Context Control", "Cipher context save/restore.", [
        f("SAVE", 1, "Strobe: save context.", { sw: "w" }),
        f("RESTORE", 1, "Strobe: restore context.", { sw: "w" }),
        f("SLOT", 2, "Context slot.", { at: 4 }),
      ]),
      r("DIGEST_DATA", 0, "Digest Data", "Digest word output window.", [
        f("WORD", 32, "Digest word at DIGEST_IDX.", { sw: "r", hw: "w" }),
      ]),
    ],
  }),

  otp: () => ({
    modules: [
      {
        file: "otp.rdl",
        addrmap: "otp_ctrl",
        dispName: "OTP Controller",
        desc: "One-time-programmable fuse macro controller.",
        regs: [
          r("CTRL", 0x00, "Control", "Access control.", [
            f("EN", 1, "Enable the OTP controller."),
            f("PROG_EN", 1, "Arm programming mode."),
            f("ECC_EN", 1, "Enable ECC correction on reads.", { reset: 1 }),
          ]),
          r("STAT", 0x04, "Status", "Operation status.", [
            f("BUSY", 1, "Read/program in progress."),
            f("PROG_DONE", 1, "Programming pulse complete."),
            f("ECC_ERR", 1, "Uncorrectable ECC error."),
            f("LOCK_ERR", 1, "Write to a locked region was rejected."),
          ], STATUS),
          r("ADDR", 0x08, "Address", "Fuse word address.", [
            f("ADDR", 12, "Word address into the fuse array."),
          ]),
          r("RDATA", 0x0c, "Read Data", "Read data window.", [
            f("DATA", 32, "Fuse word read result."),
          ], STATUS),
          r("WDATA", 0x10, "Write Data", "Program data window.", [
            f("DATA", 32, "Fuse word to program."),
          ]),
          r("PROG_KEY", 0x14, "Program Key", "Programming arm key.", [
            f("KEY", 32, "Write 0x50524F47 to arm a program pulse.", { sw: "w" }),
          ]),
          r("LOCK", 0x18, "Region Lock", "Per-region write locks (sticky until reset).", [
            f("REGION0", 1, "Lock region 0 (boot)."),
            f("REGION1", 1, "Lock region 1 (keys)."),
            f("REGION2", 1, "Lock region 2 (calibration)."),
            f("REGION3", 1, "Lock region 3 (user)."),
            f("GLOBAL", 1, "Lock everything including this register.", { at: 8 }),
          ]),
        ],
      },
    ],
    fieldPool: [
      f("BLANK_CHECK", 1, "Strobe: run blank check on region.", { sw: "w" }),
      f("MARGIN_RD", 2, "Margin read level for screening."),
    ],
    regPool: [
      r("ECC_STAT", 0, "ECC Statistics", "ECC event counters.", [
        f("SBE_CNT", 8, "Corrected single-bit errors.", { sw: "r", hw: "w" }),
        f("DBE_CNT", 8, "Detected double-bit errors.", { sw: "r", hw: "w" }),
      ]),
    ],
  }),

  trng: () => ({
    modules: [
      {
        file: "trng.rdl",
        addrmap: "trng",
        dispName: "TRNG",
        desc: "True random number generator with online health tests.",
        regs: [
          r("CTRL", 0x00, "Control", "Generator control.", [
            f("EN", 1, "Enable entropy collection."),
            f("COND_EN", 1, "Enable conditioning (AES-CBC-MAC).", { reset: 1 }),
            f("CLK_DIV", 4, "Ring-oscillator sample divider.", { at: 4, reset: 0x4 }),
          ]),
          r("STAT", 0x04, "Status", "Generator status.", [
            f("READY", 1, "Random word available."),
            f("HEALTH_FAIL", 1, "Health test failure latched."),
            f("FIFO_LEVEL", 4, "Words available in output FIFO.", { at: 8 }),
          ], STATUS),
          r("DATA", 0x08, "Data", "Random data output window.", [
            f("WORD", 32, "Random word (destructive read)."),
          ], STATUS),
          r("HEALTH", 0x0c, "Health Config", "Online health test thresholds.", [
            f("RCT_THRESH", 6, "Repetition count test cutoff.", { reset: 0x1f }),
            f("APT_THRESH", 10, "Adaptive proportion test cutoff.", { at: 8, reset: 0x257 }),
          ]),
          r("INT_EN", 0x10, "Interrupt Enable", "Per-source interrupt enables.", [
            f("READY", 1, "Data ready interrupt enable."),
            f("FAIL", 1, "Health failure interrupt enable."),
          ]),
          r("INT_STAT", 0x14, "Interrupt Status", "Sticky interrupt flags. Write 1 to clear.", [
            f("READY", 1, "Random data became available."),
            f("FAIL", 1, "A health test failed."),
          ], W1C),
        ],
      },
    ],
    fieldPool: [
      f("BIAS_CHK_EN", 1, "Enable startup bias check."),
      f("AUTO_RESTART", 1, "Auto-restart after health failure."),
    ],
    regPool: [
      r("SEED_CTRL", 0, "Seed Control", "Conditioner reseed control.", [
        f("RESEED", 1, "Strobe: force conditioner reseed.", { sw: "w" }),
        f("CNT", 8, "Blocks since last reseed.", { at: 8, sw: "r", hw: "w" }),
      ]),
    ],
  }),

  pmu: () => ({
    modules: [
      {
        file: "pmu.rdl",
        addrmap: "pmu",
        dispName: "PMU",
        desc: "Power management unit: power states, isolation, retention and wake sources.",
        regs: [
          r("CTRL", 0x00, "Control", "PMU control.", [
            f("EN", 1, "Enable PMU sequencing.", { reset: 1 }),
            f("SLEEP_REQ", 1, "Strobe: request sleep entry.", { sw: "w" }),
            f("DEEP_SLEEP", 1, "Select deep-sleep instead of sleep."),
            f("STANDBY_EN", 1, "Allow standby (lowest) state."),
          ]),
          r("PWR_STATE", 0x04, "Power State", "Current and target power FSM state.", [
            f("CUR", 3, "Current power state.", { sw: "r", hw: "w" }),
            f("TARGET", 3, "Requested target state.", { at: 4 }),
          ]),
          r("ISO_CTRL", 0x08, "Isolation", "Per-domain isolation clamps.", [
            f("CPU", 1, "Isolate CPU domain."),
            f("DSP", 1, "Isolate DSP domain."),
            f("PERI", 1, "Isolate peripheral domain."),
            f("MEM", 1, "Isolate memory domain."),
          ]),
          r("RET_CTRL", 0x0c, "Retention", "SRAM retention control.", [
            f("SRAM0", 1, "Retain SRAM bank 0.", { reset: 1 }),
            f("SRAM1", 1, "Retain SRAM bank 1.", { reset: 1 }),
            f("REGFILE", 1, "Retain CPU register file."),
          ]),
          r("WAKE_EN", 0x10, "Wake Enable", "Wake-source enables.", [
            f("GPIO", 1, "Wake on GPIO event."),
            f("RTC", 1, "Wake on RTC alarm.", { reset: 1 }),
            f("UART", 1, "Wake on UART activity."),
            f("WDT", 1, "Wake on watchdog pre-timeout."),
            f("EXT", 1, "Wake on external pin."),
          ]),
          r("WAKE_STAT", 0x14, "Wake Status", "Latched wake reasons. Write 1 to clear.", [
            f("GPIO", 1, "Woken by GPIO."),
            f("RTC", 1, "Woken by RTC."),
            f("UART", 1, "Woken by UART."),
            f("WDT", 1, "Woken by watchdog."),
            f("EXT", 1, "Woken by external pin."),
          ], W1C),
          r("SEQ_DELAY", 0x18, "Sequence Delays", "Power sequencing delays.", [
            f("PWR_UP", 8, "Power-up settle delay (µs).", { reset: 0x10 }),
            f("PWR_DN", 8, "Power-down delay (µs).", { reset: 0x08 }),
            f("ISO", 4, "Isolation-to-power delay (µs).", { at: 16, reset: 0x4 }),
          ]),
        ],
      },
    ],
    fieldPool: [
      f("VDET_EN", 1, "Enable voltage-drop detector."),
      f("OVT_EN", 1, "Enable over-temperature shutdown."),
      f("CLAMP_EN", 1, "Enable bus clamp during transitions."),
    ],
    regPool: [
      r("VDET_CTRL", 0, "Voltage Detect", "Brown-out detector configuration.", [
        f("EN", 1, "Enable detector."),
        f("THRESH", 4, "Trip threshold select.", { at: 4, reset: 0x8 }),
      ]),
      r("PWR_CNT", 0, "Power Counters", "Diagnostics counters.", [
        f("UP_CNT", 16, "Number of power-up events.", { sw: "r", hw: "w" }),
      ]),
    ],
  }),

  clkgen: () => ({
    modules: [
      {
        file: "clkgen.rdl",
        addrmap: "clkgen",
        dispName: "Clock Generator",
        desc: "PLL, clock muxes, dividers and peripheral clock gates.",
        regs: [
          r("PLL_CFG", 0x00, "PLL Config", "Main PLL dividers.", [
            f("FBDIV", 12, "Feedback divider.", { reset: 0x64 }),
            f("PREDIV", 6, "Reference pre-divider.", { at: 12, reset: 0x1 }),
            f("POSTDIV1", 3, "First post-divider.", { at: 20, reset: 0x2 }),
            f("POSTDIV2", 3, "Second post-divider.", { at: 24, reset: 0x1 }),
          ]),
          r("PLL_CTRL", 0x04, "PLL Control", "PLL enable and bypass.", [
            f("EN", 1, "Power up the PLL.", { reset: 1 }),
            f("BYPASS", 1, "Bypass PLL to reference clock."),
            f("FRAC_EN", 1, "Enable fractional mode."),
            f("LOCK", 1, "PLL lock indicator.", { at: 8, sw: "r", hw: "w" }),
          ]),
          r("MUX_SEL", 0x08, "Mux Select", "Per-domain clock source selection.", [
            f("CPU", 2, "CPU clock source. 0: ref, 1: PLL, 2: slow."),
            f("BUS", 2, "Bus clock source."),
            f("PERI", 2, "Peripheral clock source."),
            f("DSP", 2, "DSP clock source."),
          ]),
          r("DIV_CFG0", 0x0c, "Dividers 0", "Primary domain dividers.", [
            f("CPU", 4, "CPU divider minus one.", { reset: 0x0 }),
            f("BUS", 4, "Bus divider minus one.", { reset: 0x1 }),
            f("PERI", 4, "Peripheral divider minus one.", { reset: 0x3 }),
          ]),
          r("DIV_CFG1", 0x10, "Dividers 1", "Secondary domain dividers.", [
            f("DSP", 4, "DSP divider minus one."),
            f("DBG", 4, "Debug divider minus one.", { reset: 0x3 }),
            f("TRACE", 4, "Trace divider minus one.", { reset: 0x3 }),
          ]),
          r("GATE_EN", 0x14, "Clock Gates", "Peripheral clock gate enables.", [
            f("UART", 1, "UART clock enable.", { reset: 1 }),
            f("I2C", 1, "I2C clock enable.", { reset: 1 }),
            f("SPI", 1, "SPI clock enable.", { reset: 1 }),
            f("DMA", 1, "DMA clock enable.", { reset: 1 }),
            f("GPIO", 1, "GPIO clock enable.", { reset: 1 }),
            f("TIMER", 1, "Timer clock enable.", { reset: 1 }),
            f("WDT", 1, "Watchdog clock enable.", { reset: 1 }),
            f("RTC", 1, "RTC clock enable.", { reset: 1 }),
          ]),
          r("STAT", 0x18, "Status", "Clock tree status.", [
            f("PLL_LOCK", 1, "PLL is locked."),
            f("MUX_BUSY", 1, "A glitch-free mux switch is in progress."),
          ], STATUS),
        ],
      },
    ],
    fieldPool: [
      f("SSC_EN", 1, "Enable spread-spectrum modulation."),
      f("AUTO_GATE", 1, "Enable automatic idle clock gating."),
    ],
    regPool: [
      r("SSC_CFG", 0, "Spread Spectrum", "Spread-spectrum modulation settings.", [
        f("DEPTH", 5, "Modulation depth in 0.1% steps.", { reset: 0x5 }),
        f("FREQ", 5, "Modulation frequency select.", { at: 8, reset: 0x3 }),
      ]),
    ],
  }),
};

// ---------------------------------------------------------------- HAL library

export type HalDef = {
  file: string;
  brief: string;
  classes: { name: string; brief: string; fns: FnSpec[] }[];
  fnPool: { cls: string; fn: FnSpec }[];
};

export const HAL_LIB: Record<string, (sub: string) => HalDef> = {
  uart: (sub) => ({
    file: `${sub}/uart_hal.h`,
    brief: "UART hardware abstraction layer.",
    classes: [
      {
        name: "UartHal",
        brief: "Thin driver over the UART SFR block providing blocking and asynchronous transfers.",
        fns: [
          fn("HalStatus", "Init", [p("const UartConfig&", "config", "Initial configuration: baud rate, framing, FIFO thresholds.")],
            "Initialize the UART controller and apply the given configuration.",
            { returns: "HalStatus::Ok on success, HalStatus::InvalidArg on bad configuration." }),
          fn("HalStatus", "Deinit", [], "Disable the controller and release the instance.",
            { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "SetConfig", [p("const UartConfig&", "config", "New configuration to apply.")],
            "Reconfigure the controller at runtime.",
            { returns: "HalStatus::Ok on success, HalStatus::Busy while a transfer is active.", notes: ["The controller must be idle when reconfiguring."] }),
          fn("int32_t", "Send", [p("const uint8_t*", "data", "Pointer to the transmit buffer."), p("size_t", "len", "Number of bytes to send."), p("uint32_t", "timeout_ms", "Timeout in milliseconds.")],
            "Send a buffer over the UART (blocking).",
            { returns: "Number of bytes sent, or a negative HalStatus on error.", notes: ["Blocks until completion or timeout."] }),
          fn("int32_t", "Receive", [p("uint8_t*", "data", "Pointer to the receive buffer."), p("size_t", "len", "Maximum number of bytes to receive."), p("uint32_t", "timeout_ms", "Timeout in milliseconds.")],
            "Receive bytes from the UART (blocking).",
            { returns: "Number of bytes received, or a negative HalStatus on error." }),
          fn("HalStatus", "SendAsync", [p("const uint8_t*", "data", "Pointer to the transmit buffer."), p("size_t", "len", "Number of bytes to send."), p("UartCallback", "cb", "Completion callback invoked from interrupt context.")],
            "Start a non-blocking transmit.",
            { returns: "HalStatus::Ok if the transfer was queued.", warnings: ["The buffer must stay valid until the callback fires."] }),
          fn("HalStatus", "Abort", [], "Abort any in-flight transfer and flush FIFOs.",
            { returns: "HalStatus::Ok on success." }),
          fn("UartStatus", "GetStatus", [], "Read the live controller status.",
            { isConst: true, returns: "Snapshot of the STAT register." }),
          fn("HalStatus", "SetBaudRate", [p("uint32_t", "baud", "Baud rate in bits per second.")],
            "Update the baud-rate divider.",
            { returns: "HalStatus::Ok on success, HalStatus::InvalidArg if unachievable." }),
          fn("HalStatus", "EnableLoopback", [p("bool", "enable", "True to enable internal loopback.")],
            "Enable or disable internal loopback for self-test.",
            { returns: "HalStatus::Ok on success." }),
        ],
      },
    ],
    fnPool: [
      { cls: "UartHal", fn: fn("HalStatus", "SetFlowControl", [p("const UartFlowConfig&", "flow", "RTS/CTS configuration.")], "Configure hardware flow control.", { returns: "HalStatus::Ok on success." }) },
      { cls: "UartHal", fn: fn("HalStatus", "FlushRxFifo", [], "Discard all pending data in the RX FIFO.", { returns: "HalStatus::Ok on success." }) },
      { cls: "UartHal", fn: fn("HalStatus", "GetStatistics", [p("UartStats*", "stats", "Output statistics block.")], "Read accumulated error/throughput counters.", { isConst: true, returns: "HalStatus::Ok on success." }) },
      { cls: "UartHal", fn: fn("HalStatus", "SetRs485Mode", [p("bool", "enable", "Enable RS-485 driver-enable handling.")], "Switch the transceiver mode between RS-232 and RS-485.", { returns: "HalStatus::Ok on success." }) },
    ],
  }),

  i2c: (sub) => ({
    file: `${sub}/i2c_hal.h`,
    brief: "I2C hardware abstraction layer.",
    classes: [
      {
        name: "I2cHal",
        brief: "Master-mode oriented I2C driver with combined transactions.",
        fns: [
          fn("HalStatus", "Init", [p("const I2cConfig&", "config", "Bus speed and addressing configuration.")], "Initialize the I2C controller.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "Deinit", [], "Disable the controller.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "MasterWrite", [p("uint16_t", "addr", "7/10-bit target address."), p("const uint8_t*", "data", "Bytes to write."), p("size_t", "len", "Number of bytes.")],
            "Write a buffer to a target device.", { returns: "HalStatus::Ok, HalStatus::Nack if the target did not acknowledge." }),
          fn("HalStatus", "MasterRead", [p("uint16_t", "addr", "7/10-bit target address."), p("uint8_t*", "data", "Receive buffer."), p("size_t", "len", "Number of bytes.")],
            "Read a buffer from a target device.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "WriteRead", [p("uint16_t", "addr", "7/10-bit target address."), p("const uint8_t*", "tx", "Bytes to write first."), p("size_t", "tx_len", "Write length."), p("uint8_t*", "rx", "Receive buffer."), p("size_t", "rx_len", "Read length.")],
            "Combined write-then-read with repeated START.", { returns: "HalStatus::Ok on success.", notes: ["Uses a repeated START between phases; the bus is never released."] }),
          fn("bool", "Probe", [p("uint16_t", "addr", "Address to probe.")], "Check whether a device acknowledges the given address.", { returns: "True if the device ACKed." }),
          fn("HalStatus", "SetSpeed", [p("I2cSpeed", "speed", "Standard/Fast/Fast+/High-speed.")], "Change the bus speed class.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "Reset", [], "Issue a bus recovery sequence (9 clock pulses + STOP).", { returns: "HalStatus::Ok on success.", warnings: ["Only call when the bus is stuck; ongoing transfers are aborted."] }),
          fn("I2cStatus", "GetStatus", [], "Read controller status flags.", { isConst: true, returns: "Snapshot of the STAT register." }),
        ],
      },
    ],
    fnPool: [
      { cls: "I2cHal", fn: fn("HalStatus", "SetOwnAddress", [p("uint16_t", "addr", "Own slave address.")], "Configure the slave-mode own address.", { returns: "HalStatus::Ok on success." }) },
      { cls: "I2cHal", fn: fn("HalStatus", "EnableSmbus", [p("bool", "enable", "Enable SMBus timeout semantics.")], "Toggle SMBus compatibility mode.", { returns: "HalStatus::Ok on success." }) },
      { cls: "I2cHal", fn: fn("HalStatus", "SetTimeout", [p("uint32_t", "timeout_ms", "Transaction timeout in milliseconds.")], "Set the per-transaction timeout.", { returns: "HalStatus::Ok on success." }) },
    ],
  }),

  spi: (sub) => ({
    file: `${sub}/spi_hal.h`,
    brief: "SPI hardware abstraction layer.",
    classes: [
      {
        name: "SpiHal",
        brief: "Full-duplex SPI master driver.",
        fns: [
          fn("HalStatus", "Init", [p("const SpiConfig&", "config", "Mode, clock and chip-select configuration.")], "Initialize the SPI master.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "Deinit", [], "Disable the controller.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "Transfer", [p("const uint8_t*", "tx", "Transmit buffer (may be null for read-only)."), p("uint8_t*", "rx", "Receive buffer (may be null for write-only)."), p("size_t", "len", "Transfer length in bytes.")],
            "Run a blocking full-duplex transfer.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "TransferAsync", [p("const uint8_t*", "tx", "Transmit buffer."), p("uint8_t*", "rx", "Receive buffer."), p("size_t", "len", "Transfer length in bytes."), p("SpiCallback", "cb", "Completion callback.")],
            "Start a non-blocking full-duplex transfer.", { returns: "HalStatus::Ok if queued.", warnings: ["Buffers must remain valid until completion."] }),
          fn("HalStatus", "SetMode", [p("SpiMode", "mode", "CPOL/CPHA mode 0-3.")], "Change the SPI mode.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "SetClockDiv", [p("uint16_t", "div", "Even divider from the peripheral clock.")], "Change the SCK divider.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "ChipSelect", [p("uint8_t", "cs", "Chip-select index."), p("bool", "assert", "True to assert (active).")],
            "Manually drive a chip-select line.", { returns: "HalStatus::Ok on success.", notes: ["Only valid when CS_AUTO is disabled."] }),
          fn("SpiStatus", "GetStatus", [], "Read engine status flags.", { isConst: true, returns: "Snapshot of the STAT register." }),
        ],
      },
    ],
    fnPool: [
      { cls: "SpiHal", fn: fn("HalStatus", "SetWordLength", [p("uint8_t", "bits", "Word length in bits (4-32).")], "Change the transfer word length.", { returns: "HalStatus::Ok on success." }) },
      { cls: "SpiHal", fn: fn("HalStatus", "EnableDma", [p("bool", "enable", "Enable DMA handshake.")], "Route FIFO service requests to the DMA engine.", { returns: "HalStatus::Ok on success." }) },
      { cls: "SpiHal", fn: fn("HalStatus", "SetDelays", [p("const SpiDelayConfig&", "delays", "Sample/drive delay configuration.")], "Tune sampling and drive delays for high-speed operation.", { returns: "HalStatus::Ok on success." }) },
    ],
  }),

  dma: (sub) => ({
    file: `${sub}/dma_hal.h`,
    brief: "DMA engine hardware abstraction layer.",
    classes: [
      {
        name: "DmaHal",
        brief: "Channel-based DMA driver with per-channel callbacks.",
        fns: [
          fn("HalStatus", "Init", [], "Initialize the DMA engine and reset all channels.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "Deinit", [], "Halt the engine and release all channels.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "ConfigureChannel", [p("uint8_t", "ch", "Channel index."), p("const DmaChannelConfig&", "config", "Source, destination, length and shape.")],
            "Program a channel with a transfer descriptor.", { returns: "HalStatus::Ok on success, HalStatus::Busy if the channel is active." }),
          fn("HalStatus", "Start", [p("uint8_t", "ch", "Channel index.")], "Arm and start a configured channel.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "Stop", [p("uint8_t", "ch", "Channel index.")], "Stop a channel at the next beat boundary.", { returns: "HalStatus::Ok on success." }),
          fn("uint32_t", "GetTransferCount", [p("uint8_t", "ch", "Channel index.")], "Read the number of bytes already transferred.", { isConst: true, returns: "Bytes transferred so far." }),
          fn("HalStatus", "SetPriority", [p("uint8_t", "ch", "Channel index."), p("DmaPriority", "prio", "Arbitration priority.")], "Change a channel's arbitration priority.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "RegisterCallback", [p("uint8_t", "ch", "Channel index."), p("DmaCallback", "cb", "Invoked on done/error from interrupt context.")],
            "Register a per-channel completion callback.", { returns: "HalStatus::Ok on success." }),
          fn("DmaChannelStatus", "GetChannelStatus", [p("uint8_t", "ch", "Channel index.")], "Read live channel status.", { isConst: true, returns: "Snapshot of the CH_STAT register." }),
        ],
      },
    ],
    fnPool: [
      { cls: "DmaHal", fn: fn("HalStatus", "LinkDescriptor", [p("uint8_t", "ch", "Channel index."), p("const DmaDescriptor*", "desc", "Next descriptor in the chain.")], "Chain another descriptor for scatter-gather transfers.", { returns: "HalStatus::Ok on success." }) },
      { cls: "DmaHal", fn: fn("HalStatus", "Suspend", [p("uint8_t", "ch", "Channel index.")], "Suspend a channel preserving its context.", { returns: "HalStatus::Ok on success." }) },
      { cls: "DmaHal", fn: fn("HalStatus", "Resume", [p("uint8_t", "ch", "Channel index.")], "Resume a previously suspended channel.", { returns: "HalStatus::Ok on success." }) },
    ],
  }),

  gpio: (sub) => ({
    file: `${sub}/gpio_hal.h`,
    brief: "GPIO hardware abstraction layer.",
    classes: [
      {
        name: "GpioHal",
        brief: "Pin-level GPIO driver for one 32-pin bank.",
        fns: [
          fn("HalStatus", "Init", [], "Initialize the GPIO bank to reset defaults.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "SetDirection", [p("uint8_t", "pin", "Pin index 0-31."), p("GpioDir", "dir", "Input or output.")], "Configure a pin's direction.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "Write", [p("uint8_t", "pin", "Pin index 0-31."), p("bool", "level", "Output level.")], "Drive an output pin.", { returns: "HalStatus::Ok on success." }),
          fn("bool", "Read", [p("uint8_t", "pin", "Pin index 0-31.")], "Sample an input pin.", { isConst: true, returns: "Current pin level." }),
          fn("HalStatus", "Toggle", [p("uint8_t", "pin", "Pin index 0-31.")], "Toggle an output pin.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "SetPull", [p("uint8_t", "pin", "Pin index 0-31."), p("GpioPull", "pull", "None, up or down.")], "Configure the pin pull resistor.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "EnableInterrupt", [p("uint8_t", "pin", "Pin index 0-31."), p("GpioIntType", "type", "Edge/level and polarity.")], "Enable an interrupt on the pin.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "DisableInterrupt", [p("uint8_t", "pin", "Pin index 0-31.")], "Disable the pin interrupt.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "SetDebounce", [p("uint8_t", "pin", "Pin index 0-31."), p("uint16_t", "cycles", "Filter length in slow-clock cycles.")], "Configure input debouncing for the pin.", { returns: "HalStatus::Ok on success." }),
        ],
      },
    ],
    fnPool: [
      { cls: "GpioHal", fn: fn("HalStatus", "WritePort", [p("uint32_t", "mask", "Pins to affect."), p("uint32_t", "value", "Levels for masked pins.")], "Write multiple pins atomically.", { returns: "HalStatus::Ok on success." }) },
      { cls: "GpioHal", fn: fn("uint32_t", "ReadPort", [], "Sample the whole bank at once.", { isConst: true, returns: "All 32 pin levels." }) },
    ],
  }),

  timer: (sub) => ({
    file: `${sub}/timer_hal.h`,
    brief: "Timer and PWM hardware abstraction layer.",
    classes: [
      {
        name: "TimerHal",
        brief: "General-purpose timer driver with match channels and a PWM output stage.",
        fns: [
          fn("HalStatus", "Init", [p("const TimerConfig&", "config", "Clocking and mode configuration.")], "Initialize the timer.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "Start", [], "Start the counter.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "Stop", [], "Stop the counter, preserving the current value.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "SetPeriod", [p("uint32_t", "ticks", "Period in timer ticks.")], "Set the auto-reload period.", { returns: "HalStatus::Ok on success." }),
          fn("uint32_t", "GetValue", [], "Read the live counter value.", { isConst: true, returns: "Current count." }),
          fn("HalStatus", "EnableInterrupt", [p("TimerIntSource", "src", "Overflow or match channel.")], "Enable an interrupt source.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "SetMatch", [p("uint8_t", "idx", "Match channel 0 or 1."), p("uint32_t", "value", "Compare value.")], "Program a match channel.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "ConfigurePwm", [p("const PwmConfig&", "config", "Polarity, alignment and deadtime.")], "Configure the PWM output stage.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "SetPwmDuty", [p("uint16_t", "duty", "High time in timer ticks.")], "Update the PWM duty cycle.", { returns: "HalStatus::Ok on success.", notes: ["Takes effect at the next period boundary."] }),
        ],
      },
    ],
    fnPool: [
      { cls: "TimerHal", fn: fn("HalStatus", "SetDeadtime", [p("uint8_t", "rise", "Rising-edge deadtime."), p("uint8_t", "fall", "Falling-edge deadtime.")], "Tune complementary output deadtime.", { returns: "HalStatus::Ok on success." }) },
      { cls: "TimerHal", fn: fn("uint32_t", "Capture", [], "Read the last captured counter value.", { isConst: true, returns: "Captured value." }) },
    ],
  }),

  wdt: (sub) => ({
    file: `${sub}/wdt_hal.h`,
    brief: "Watchdog hardware abstraction layer.",
    classes: [
      {
        name: "WdtHal",
        brief: "System watchdog driver.",
        fns: [
          fn("HalStatus", "Init", [p("const WdtConfig&", "config", "Timeout and reset behaviour.")], "Initialize the watchdog (does not start it).", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "Start", [], "Start the watchdog countdown.", { returns: "HalStatus::Ok on success.", warnings: ["Once started, the watchdog cannot be stopped until reset if the lock is engaged."] }),
          fn("HalStatus", "Kick", [], "Service (feed) the watchdog.", { returns: "HalStatus::Ok on success.", notes: ["Safe to call from interrupt context."] }),
          fn("HalStatus", "SetTimeout", [p("uint32_t", "timeout_ms", "Timeout in milliseconds.")], "Change the timeout period.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "Lock", [], "Lock the configuration until the next system reset.", { returns: "HalStatus::Ok on success." }),
          fn("uint32_t", "GetRemaining", [], "Read the remaining time before timeout.", { isConst: true, returns: "Remaining milliseconds." }),
        ],
      },
    ],
    fnPool: [
      { cls: "WdtHal", fn: fn("HalStatus", "SetWindow", [p("uint32_t", "start_ms", "Earliest allowed kick time.")], "Enable windowed mode with the given start.", { returns: "HalStatus::Ok on success." }) },
      { cls: "WdtHal", fn: fn("HalStatus", "EnablePreTimeout", [p("uint32_t", "ms", "Warning lead time before timeout.")], "Enable the pre-timeout warning interrupt.", { returns: "HalStatus::Ok on success." }) },
    ],
  }),

  rtc: (sub) => ({
    file: `${sub}/rtc_hal.h`,
    brief: "Real-time clock hardware abstraction layer.",
    classes: [
      {
        name: "RtcHal",
        brief: "RTC driver with alarm and calibration support.",
        fns: [
          fn("HalStatus", "Init", [], "Initialize the RTC and start the counter if not running.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "SetTime", [p("uint32_t", "unix_sec", "Seconds since the Unix epoch.")], "Set the current time.", { returns: "HalStatus::Ok on success." }),
          fn("uint32_t", "GetTime", [], "Read the current time.", { isConst: true, returns: "Seconds since the Unix epoch." }),
          fn("HalStatus", "SetAlarm", [p("uint32_t", "unix_sec", "Alarm time in seconds since epoch.")], "Arm the alarm.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "ClearAlarm", [], "Disarm the alarm and clear any pending flag.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "Calibrate", [p("int16_t", "ppm", "Signed correction in parts-per-million.")], "Apply digital frequency calibration.", { returns: "HalStatus::Ok on success." }),
        ],
      },
    ],
    fnPool: [
      { cls: "RtcHal", fn: fn("HalStatus", "EnableTick", [p("RtcTickRate", "rate", "Periodic tick rate.")], "Enable the periodic tick interrupt.", { returns: "HalStatus::Ok on success." }) },
      { cls: "RtcHal", fn: fn("uint16_t", "GetSubSeconds", [], "Read the sub-second counter.", { isConst: true, returns: "Sub-second count at 32768 Hz." }) },
    ],
  }),

  crypto: (sub) => ({
    file: `${sub}/crypto_hal.h`,
    brief: "Crypto engine hardware abstraction layer (AES, SHA).",
    classes: [
      {
        name: "AesHal",
        brief: "AES block cipher driver with key-ladder slots and context switching.",
        fns: [
          fn("HalStatus", "Init", [], "Initialize the AES engine.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "SetKey", [p("AesKeySlot", "slot", "Key ladder slot."), p("AesKeySize", "size", "128/192/256-bit.")],
            "Select a key from the hardware key ladder.", { returns: "HalStatus::Ok, HalStatus::Locked if the slot is locked.", notes: ["Raw key material never crosses the bus."] }),
          fn("HalStatus", "SetIv", [p("const uint8_t*", "iv", "Initialization vector."), p("size_t", "len", "IV length in bytes.")], "Load the initialization vector.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "Encrypt", [p("const uint8_t*", "in", "Plaintext input."), p("uint8_t*", "out", "Ciphertext output."), p("size_t", "len", "Length in bytes (multiple of 16).")],
            "Run a blocking encryption.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "Decrypt", [p("const uint8_t*", "in", "Ciphertext input."), p("uint8_t*", "out", "Plaintext output."), p("size_t", "len", "Length in bytes (multiple of 16).")],
            "Run a blocking decryption.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "EncryptAsync", [p("const uint8_t*", "in", "Plaintext input."), p("uint8_t*", "out", "Ciphertext output."), p("size_t", "len", "Length in bytes."), p("AesCallback", "cb", "Completion callback.")],
            "Start a non-blocking encryption.", { returns: "HalStatus::Ok if queued." }),
          fn("HalStatus", "Suspend", [p("AesContext*", "ctx", "Output context storage.")], "Suspend the current operation and save its context.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "Resume", [p("const AesContext&", "ctx", "Previously saved context.")], "Resume a suspended operation.", { returns: "HalStatus::Ok on success." }),
        ],
      },
      {
        name: "ShaHal",
        brief: "SHA hash engine driver with streaming interface.",
        fns: [
          fn("HalStatus", "Init", [p("ShaMode", "mode", "SHA-1/224/256/512.")], "Start a new hash computation.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "Update", [p("const uint8_t*", "data", "Message chunk."), p("size_t", "len", "Chunk length in bytes.")], "Absorb a message chunk.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "Final", [p("uint8_t*", "digest", "Output digest buffer."), p("size_t", "len", "Buffer size in bytes.")], "Finalize and read the digest.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "Digest", [p("const uint8_t*", "data", "Whole message."), p("size_t", "len", "Message length."), p("uint8_t*", "out", "Output digest buffer.")],
            "One-shot convenience hash of a full buffer.", { returns: "HalStatus::Ok on success." }),
        ],
      },
    ],
    fnPool: [
      { cls: "AesHal", fn: fn("HalStatus", "Zeroize", [], "Zeroize all engine state and working keys.", { returns: "HalStatus::Ok on success." }) },
      { cls: "AesHal", fn: fn("HalStatus", "SetGcmAad", [p("const uint8_t*", "aad", "Additional authenticated data."), p("size_t", "len", "AAD length.")], "Provide AAD for GCM mode.", { returns: "HalStatus::Ok on success." }) },
      { cls: "ShaHal", fn: fn("HalStatus", "HmacInit", [p("const uint8_t*", "key", "HMAC key."), p("size_t", "key_len", "Key length in bytes.")], "Start a new HMAC computation.", { returns: "HalStatus::Ok on success." }) },
    ],
  }),

  otp: (sub) => ({
    file: `${sub}/otp_hal.h`,
    brief: "OTP fuse controller hardware abstraction layer.",
    classes: [
      {
        name: "OtpHal",
        brief: "Fuse array access driver with region locking.",
        fns: [
          fn("uint32_t", "Read", [p("uint16_t", "addr", "Fuse word address.")], "Read a fuse word (ECC corrected).", { isConst: true, returns: "Fuse word value." }),
          fn("HalStatus", "Write", [p("uint16_t", "addr", "Fuse word address."), p("uint32_t", "value", "Bits to program (OR semantics).")],
            "Program a fuse word.", { returns: "HalStatus::Ok, HalStatus::Locked if the region is locked.", warnings: ["Programming is irreversible."] }),
          fn("HalStatus", "LockRegion", [p("OtpRegion", "region", "Region to lock.")], "Lock a region until the next reset.", { returns: "HalStatus::Ok on success." }),
          fn("bool", "GetLockStatus", [p("OtpRegion", "region", "Region to query.")], "Check whether a region is locked.", { isConst: true, returns: "True if locked." }),
        ],
      },
    ],
    fnPool: [
      { cls: "OtpHal", fn: fn("HalStatus", "BlankCheck", [p("uint16_t", "addr", "Fuse word address.")], "Verify a word is still unprogrammed.", { isConst: true, returns: "HalStatus::Ok if blank." }) },
      { cls: "OtpHal", fn: fn("HalStatus", "ReadEccStatus", [p("OtpEccStatus*", "status", "Output ECC counters.")], "Read accumulated ECC statistics.", { isConst: true, returns: "HalStatus::Ok on success." }) },
    ],
  }),

  trng: (sub) => ({
    file: `${sub}/trng_hal.h`,
    brief: "True random number generator hardware abstraction layer.",
    classes: [
      {
        name: "TrngHal",
        brief: "Entropy source driver with health monitoring.",
        fns: [
          fn("HalStatus", "Init", [], "Start entropy collection and run startup health tests.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "GetRandom", [p("uint8_t*", "out", "Output buffer."), p("size_t", "len", "Bytes requested.")], "Fill a buffer with conditioned random bytes.", { returns: "HalStatus::Ok, HalStatus::Health if a health test failed." }),
          fn("HalStatus", "RunHealthTest", [], "Force an on-demand health test pass.", { returns: "HalStatus::Ok if all tests pass." }),
          fn("uint32_t", "GetEntropyEstimate", [], "Read the running entropy estimate.", { isConst: true, returns: "Estimated bits of entropy per 1024 samples." }),
        ],
      },
    ],
    fnPool: [
      { cls: "TrngHal", fn: fn("HalStatus", "Reseed", [], "Force a conditioner reseed.", { returns: "HalStatus::Ok on success." }) },
      { cls: "TrngHal", fn: fn("HalStatus", "SetClockDivider", [p("uint8_t", "div", "Ring-oscillator sample divider.")], "Tune the entropy sampling rate.", { returns: "HalStatus::Ok on success." }) },
    ],
  }),

  pmu: (sub) => ({
    file: `${sub}/pmu_hal.h`,
    brief: "Power management unit hardware abstraction layer.",
    classes: [
      {
        name: "PmuHal",
        brief: "Power-state, isolation, retention and wake-source management.",
        fns: [
          fn("HalStatus", "Init", [], "Initialize PMU sequencing with safe defaults.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "SetPowerState", [p("PmuState", "state", "Target power state.")], "Request a power-state transition.", { returns: "HalStatus::Ok once the transition is accepted.", warnings: ["Deeper states lose more context; configure retention first."] }),
          fn("PmuState", "GetPowerState", [], "Read the current power state.", { isConst: true, returns: "Current FSM state." }),
          fn("HalStatus", "EnableWakeSource", [p("PmuWakeSource", "src", "Wake source to enable.")], "Enable a wake source.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "DisableWakeSource", [p("PmuWakeSource", "src", "Wake source to disable.")], "Disable a wake source.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "SetRetention", [p("PmuSramBank", "bank", "SRAM bank."), p("bool", "retain", "Keep contents through low-power states.")],
            "Configure SRAM retention.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "PowerDomainOn", [p("PmuDomain", "domain", "Domain to power up.")], "Power up a domain and release isolation.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "PowerDomainOff", [p("PmuDomain", "domain", "Domain to power down.")], "Isolate and power down a domain.", { returns: "HalStatus::Ok on success." }),
        ],
      },
    ],
    fnPool: [
      { cls: "PmuHal", fn: fn("HalStatus", "SetSequenceDelays", [p("const PmuSeqConfig&", "delays", "Power sequencing delays.")], "Tune power sequencing delays.", { returns: "HalStatus::Ok on success." }) },
      { cls: "PmuHal", fn: fn("PmuWakeSource", "GetWakeReason", [], "Read the latched reason for the last wake.", { isConst: true, returns: "Wake source that triggered the last wake-up." }) },
    ],
  }),

  clkgen: (sub) => ({
    file: `${sub}/clock_hal.h`,
    brief: "Clock tree hardware abstraction layer.",
    classes: [
      {
        name: "ClockHal",
        brief: "PLL, mux, divider and clock-gate management.",
        fns: [
          fn("HalStatus", "Init", [], "Bring up the clock tree to boot defaults.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "ConfigurePll", [p("const PllConfig&", "config", "Divider settings.")], "Reprogram the main PLL.", { returns: "HalStatus::Ok once lock is achieved.", notes: ["Domains on the PLL are switched to the reference clock during relock."] }),
          fn("HalStatus", "SetMux", [p("ClkDomain", "domain", "Clock domain."), p("ClkSource", "src", "New source.")], "Glitch-free switch of a domain clock source.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "SetDivider", [p("ClkDomain", "domain", "Clock domain."), p("uint8_t", "div", "Divider minus one.")], "Change a domain divider.", { returns: "HalStatus::Ok on success." }),
          fn("HalStatus", "GateClock", [p("ClkPeriph", "periph", "Peripheral clock."), p("bool", "enable", "True to enable the clock.")], "Gate or ungate a peripheral clock.", { returns: "HalStatus::Ok on success." }),
          fn("uint32_t", "GetFrequency", [p("ClkDomain", "domain", "Clock domain.")], "Compute the current frequency of a domain.", { isConst: true, returns: "Frequency in Hz." }),
        ],
      },
    ],
    fnPool: [
      { cls: "ClockHal", fn: fn("HalStatus", "EnableSpreadSpectrum", [p("const SscConfig&", "config", "Modulation depth and rate.")], "Enable spread-spectrum modulation for EMI reduction.", { returns: "HalStatus::Ok on success." }) },
      { cls: "ClockHal", fn: fn("HalStatus", "SetAutoGate", [p("bool", "enable", "Enable automatic idle gating.")], "Toggle automatic idle clock gating.", { returns: "HalStatus::Ok on success." }) },
    ],
  }),
};

// ---------------------------------------------------------------- serializers

const hex = (n: number, pad = 0) => "0x" + n.toString(16).toUpperCase().padStart(pad, "0");

function serializeRdl(mod: RModule, system: string): string {
  const L: string[] = [];
  L.push(`// ${mod.file} — ${mod.dispName}`);
  L.push(`// ${system} SoC — SystemRDL register description`);
  L.push("");
  L.push(`addrmap ${mod.addrmap} {`);
  L.push(`    name = "${mod.dispName}";`);
  L.push(`    desc = "${mod.desc}";`);
  L.push(`    default regwidth = 32;`);
  for (const reg of [...mod.regs].sort((a, b) => a.offset - b.offset)) {
    L.push("");
    L.push(`    reg {`);
    L.push(`        name = "${reg.dispName}";`);
    L.push(`        desc = "${reg.desc}";`);
    for (const fl of [...reg.fields].sort((a, b) => a.lsb - b.lsb)) {
      L.push("");
      L.push(`        field {`);
      L.push(`            desc = "${fl.desc}";`);
      L.push(`            sw = ${fl.sw};`);
      L.push(`            hw = ${fl.hw};`);
      L.push(`        } ${fl.name}[${fl.lsb + fl.width - 1}:${fl.lsb}] = ${hex(fl.reset)};`);
    }
    const inst =
      reg.array && reg.array > 1
        ? `${reg.name}[${reg.array}] @ ${hex(reg.offset, 4)} += ${hex(reg.stride ?? 4)}`
        : `${reg.name} @ ${hex(reg.offset, 4)}`;
    L.push(`    } ${inst};`);
  }
  L.push(`};`);
  L.push("");
  return L.join("\n");
}

function serializeHal(file: RHalFile, ns: string, project: string): string {
  const fname = file.file.split("/").pop()!;
  const L: string[] = [];
  L.push(`// ${fname} — ${file.brief}`);
  L.push(`// ${project} SoC HAL — C++ interface header`);
  L.push(`#pragma once`);
  L.push("");
  L.push(`/**`);
  L.push(` * @file ${fname}`);
  L.push(` * @brief ${file.brief}`);
  L.push(` */`);
  L.push("");
  L.push(`#include <cstddef>`);
  L.push(`#include <cstdint>`);
  L.push("");
  L.push(`#include "common/hal_types.h"`);
  L.push("");
  L.push(`namespace ${ns}::hal {`);
  for (const cls of file.classes) {
    L.push("");
    L.push(`/**`);
    L.push(` * @brief ${cls.brief}`);
    L.push(` */`);
    L.push(`class ${cls.name} {`);
    L.push(` public:`);
    for (const fnv of cls.fns) {
      L.push(`    /**`);
      L.push(`     * @brief ${fnv.brief}`);
      if (fnv.deprecated !== undefined) L.push(`     * @deprecated ${fnv.deprecated}`);
      for (const prm of fnv.params) L.push(`     * @param ${prm.name} ${prm.desc}`);
      if (fnv.returns) L.push(`     * @return ${fnv.returns}`);
      for (const n of fnv.notes) L.push(`     * @note ${n}`);
      for (const w of fnv.warnings) L.push(`     * @warning ${w}`);
      L.push(`     */`);
      const ps = fnv.params.map((q) => `${q.type} ${q.name}${q.def ? ` = ${q.def}` : ""}`).join(", ");
      L.push(`    ${fnv.ret} ${fnv.name}(${ps})${fnv.isConst ? " const" : ""};`);
      L.push("");
    }
    L.push(`};`);
  }
  L.push("");
  L.push(`}  // namespace ${ns}::hal`);
  L.push("");
  return L.join("\n");
}

// ---------------------------------------------------------------- HAL .c impl

/** pick the registers a function touches, from the IP's current register names */
function assignRegs(fnName: string, regs: string[]): { reg: string; write: boolean }[] {
  if (!regs.length) return [];
  const find = (...kw: string[]) => regs.find((r) => kw.some((k) => r.toUpperCase().includes(k)));
  const CTRL = find("CTRL", "CFG", "CONFIG") ?? regs[0];
  const STAT = find("STAT", "STATUS") ?? CTRL;
  const out: { reg: string; write: boolean }[] = [];
  const w = (r?: string) => r && out.push({ reg: r, write: true });
  const rd = (r?: string) => r && out.push({ reg: r, write: false });
  const n = fnName;

  if (/^(Init|Configure|Setup|Reset|Enable|Start|Calibrate|Reconfigure)/.test(n)) {
    w(CTRL);
    w(find("TIMING", "DIV", "MODE", "BAUD", "PERIOD", "MR_", "CLK"));
  } else if (/^(Deinit|Disable|Stop|Halt|Suspend|Abort)/.test(n)) {
    w(CTRL);
  } else if (/Interrupt|Irq|ClearError|ClearAlarm|^Clear|^Ack|^Kick|HealthTest|Health/.test(n)) {
    w(find("INT_STAT", "INT_EN", "KICK", "WAKE_STAT") ?? STAT);
  } else if (/^(GetStatus|GetState|GetChannelStatus|GetLinkStatus|ReadStatus)/.test(n)) {
    rd(STAT);
  } else if (/^(Send|Write|Transmit|Transfer|Program|Encrypt|Decrypt|Update|Final|Digest|MasterWrite|Push)/.test(n)) {
    w(find("DATA", "WDATA", "DATA_IN", "TX", "DOUT", "CH_") ?? CTRL);
    rd(STAT);
  } else if (/^(Receive|Recv|Read|MasterRead|GetRandom|Sample|Capture|GetValue|GetTemperature|GetTime|Probe|GetTransferCount|GetFreeBlocks)/.test(n)) {
    rd(find("DATA", "RDATA", "DATA_OUT", "RX", "VALUE", "VAL", "TEMP", "TIME") ?? STAT);
    rd(STAT);
  } else if (/^Set/.test(n)) {
    const x = n.replace(/^Set/, "").toUpperCase();
    w(regs.find((r) => x.includes(r.toUpperCase().split("_")[0]) || r.toUpperCase().includes(x.slice(0, 4))) ?? CTRL);
  } else if (/^(LoadKey|SetKey|Lock|LockRegion|BindLockingRange|CryptoErase|SetLockState)/.test(n)) {
    w(find("KEY_CTRL", "LOCK", "CTRL") ?? CTRL);
  } else {
    w(CTRL);
  }
  // dedupe by reg name (prefer write)
  const m = new Map<string, boolean>();
  for (const e of out) m.set(e.reg, (m.get(e.reg) ?? false) || e.write);
  return [...m.entries()].map(([reg, write]) => ({ reg, write }));
}

function defaultReturn(ret: string): string | null {
  if (ret === "void") return null;
  if (ret === "HalStatus") return "HalStatus::Ok";
  if (ret === "bool") return "false";
  if (/^(u?int\d*_t|size_t|long|short|int|uint\d+|unsigned)/.test(ret)) return "0";
  return "{}";
}

function serializeHalImpl(file: RHalFile, ip: RIp, ns: string, project: string): string {
  const fname = file.file.split("/").pop()!.replace(/\.h$/, ".c");
  const ptr = ip.name.toUpperCase();
  const regNames = ip.modules.flatMap((mod) => mod.regs.map((r) => r.name));
  const L: string[] = [];
  L.push(`// ${fname} — ${file.brief} (implementation)`);
  L.push(`// ${project} SoC HAL — generated reference implementation`);
  L.push("");
  L.push(`#include "${file.file.split("/").pop()}"`);
  L.push(`#include "${ip.name}_regs.h"   // ${ptr} register block`);
  L.push("");
  L.push(`namespace ${ns}::hal {`);

  for (const cls of file.classes) {
    for (const fnv of cls.fns) {
      const ps = fnv.params.map((q) => `${q.type} ${q.name}`).join(", ");
      L.push("");
      L.push(`${fnv.ret} ${cls.name}::${fnv.name}(${ps})${fnv.isConst ? " const" : ""} {`);
      const touched = assignRegs(fnv.name, regNames);
      const writes = touched.filter((t) => t.write);
      const reads = touched.filter((t) => !t.write);
      // pure getter: return the read value directly
      const ret = defaultReturn(fnv.ret);
      if (!writes.length && reads.length === 1 && fnv.ret !== "void" && fnv.ret !== "HalStatus") {
        L.push(`    return (${fnv.ret})(${ptr}->${reads[0].reg});`);
      } else {
        for (const wr of writes) L.push(`    ${ptr}->${wr.reg} = ${fnv.params[0] ? "static_cast<uint32_t>(" + fnv.params[0].name + ")" : "0u"};`);
        if (reads.length) {
          L.push(`    uint32_t _s = 0u;`);
          for (const r of reads) L.push(`    _s |= ${ptr}->${r.reg};`);
          L.push(`    (void)_s;`);
        }
        if (ret) L.push(`    return ${ret};`);
      }
      L.push(`}`);
    }
  }
  L.push("");
  L.push(`}  // namespace ${ns}::hal`);
  L.push("");
  return L.join("\n");
}

export type HalTypesFn = (ns: string, project: string) => string;

export const DEFAULT_HAL_TYPES: HalTypesFn = (ns: string, project: string) => `// hal_types.h — shared HAL types
// ${project} SoC HAL — C++ interface header
#pragma once

#include <cstddef>
#include <cstdint>

namespace ${ns}::hal {

enum class HalStatus : int32_t {
  Ok = 0,
  InvalidArg = -1,
  Busy = -2,
  Timeout = -3,
  Nack = -4,
  Locked = -5,
  Health = -6,
  Unsupported = -7,
};

// Forward declarations of configuration/status aggregates. Full definitions
// live in the platform configuration headers.
struct UartConfig;
struct UartFlowConfig;
struct UartStats;
struct UartStatus;
struct I2cConfig;
struct I2cStatus;
struct SpiConfig;
struct SpiDelayConfig;
struct SpiStatus;
struct DmaChannelConfig;
struct DmaChannelStatus;
struct DmaDescriptor;
struct TimerConfig;
struct PwmConfig;
struct WdtConfig;
struct AesContext;
struct OtpEccStatus;
struct PmuSeqConfig;
struct PllConfig;
struct SscConfig;

using UartCallback = void (*)(HalStatus, size_t);
using SpiCallback = void (*)(HalStatus, size_t);
using DmaCallback = void (*)(HalStatus, uint8_t);
using AesCallback = void (*)(HalStatus);

}  // namespace ${ns}::hal
`;

// ---------------------------------------------------------------- git plumbing

function sh(cwd: string, cmd: string, args: string[], env: Record<string, string> = {}) {
  return execFileSync(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] })
    .toString();
}

export interface Author {
  name: string;
  email: string;
}

class Repo {
  constructor(public dir: string) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    sh(dir, "git", ["init", "-q", "-b", "main"]);
    sh(dir, "git", ["config", "user.name", "SoC Platform Bot"]);
    sh(dir, "git", ["config", "user.email", "platform@auriga-semi.com"]);
  }
  write(rel: string, content: string) {
    const abs = join(this.dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  hasChanges(): boolean {
    return sh(this.dir, "git", ["status", "--porcelain"]).trim().length > 0;
  }
  commit(message: string, dateIso: string, author: Author): boolean {
    sh(this.dir, "git", ["add", "-A"]);
    if (!this.hasChanges()) return false;
    sh(this.dir, "git", ["commit", "-q", "-m", message], {
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      GIT_COMMITTER_NAME: author.name,
      GIT_COMMITTER_EMAIL: author.email,
      GIT_AUTHOR_DATE: dateIso,
      GIT_COMMITTER_DATE: dateIso,
    });
    return true;
  }
  tag(name: string, message: string, dateIso: string, author: Author) {
    sh(this.dir, "git", ["tag", "-a", name, "-m", message], {
      GIT_COMMITTER_NAME: author.name,
      GIT_COMMITTER_EMAIL: author.email,
      GIT_COMMITTER_DATE: dateIso,
    });
  }
  commitCount(): number {
    return parseInt(sh(this.dir, "git", ["rev-list", "--count", "HEAD"]).trim(), 10);
  }
}

// ---------------------------------------------------------------- date helpers (KST workdays)

const DAY_MS = 24 * 3600 * 1000;

/** t0 is a UTC-midnight Date marking week 0 Monday. Returns ISO string with +09:00 offset. */
function kstIso(t0: Date, dayOffset: number, hour: number, minute: number): string {
  const d = new Date(t0.getTime() + dayOffset * DAY_MS);
  const y = d.getUTCFullYear();
  const mo = `${d.getUTCMonth() + 1}`.padStart(2, "0");
  const da = `${d.getUTCDate()}`.padStart(2, "0");
  return `${y}-${mo}-${da}T${`${hour}`.padStart(2, "0")}:${`${minute}`.padStart(2, "0")}:00+09:00`;
}

function isWeekend(t0: Date, dayOffset: number): boolean {
  const wd = new Date(t0.getTime() + dayOffset * DAY_MS).getUTCDay();
  return wd === 0 || wd === 6;
}

/** n strictly-increasing business datetimes in day range [fromDay, toDay). */
function businessTimes(rng: Rng, t0: Date, fromDay: number, toDay: number, n: number): { day: number; hour: number; minute: number }[] {
  const out: { day: number; hour: number; minute: number }[] = [];
  let guard = n * 40;
  while (out.length < n && guard-- > 0) {
    const day = fromDay + irand(rng, Math.max(1, toDay - fromDay));
    if (isWeekend(t0, day)) continue;
    out.push({ day, hour: 9 + irand(rng, 10), minute: irand(rng, 60) });
  }
  out.sort((a, b) => a.day - b.day || a.hour - b.hour || a.minute - b.minute);
  // de-duplicate identical minutes
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    if (cur.day === prev.day && cur.hour === prev.hour && cur.minute <= prev.minute) {
      cur.minute = prev.minute + 1;
      if (cur.minute >= 60) {
        cur.minute = 0;
        cur.hour = Math.min(prev.hour + 1, 22);
        if (cur.hour === prev.hour && prev.minute >= 59) cur.minute = 59;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- mutation engine

interface ProjectModel {
  system: string; // directory name, e.g. "helios"
  ns: string;
  name: string;
  ips: RIp[];
  hal: RHalFile[];
  halTypes: HalTypesFn;
  touchedRegs: Set<string>;
  touchedFns: Set<string>;
  descTweaks: Map<string, number>;
}

const regKey = (ip: RIp, mod: RModule, reg: RReg) => `${ip.subsystem}/${ip.name}/${mod.file}::${reg.name}`;
const fnKey = (file: RHalFile, cls: RClass, fnv: RFn) => `${file.file}::${cls.name}::${fnv.name}`;

function allRegs(m: ProjectModel): { ip: RIp; mod: RModule; reg: RReg }[] {
  const out: { ip: RIp; mod: RModule; reg: RReg }[] = [];
  for (const ip of m.ips) for (const mod of ip.modules) for (const reg of mod.regs) out.push({ ip, mod, reg });
  return out;
}

function allFns(m: ProjectModel): { file: RHalFile; cls: RClass; fnv: RFn }[] {
  const out: { file: RHalFile; cls: RClass; fnv: RFn }[] = [];
  for (const file of m.hal) for (const cls of file.classes) for (const fnv of cls.fns) out.push({ file, cls, fnv });
  return out;
}

function freeBitRun(reg: RReg, width: number): number | null {
  const used = new Array(32).fill(false);
  for (const fl of reg.fields) for (let b = fl.lsb; b < fl.lsb + fl.width; b++) used[b] = true;
  let run = 0;
  for (let b = 0; b < 32; b++) {
    if (!used[b]) {
      run++;
      if (run === width) return b - width + 1;
    } else run = 0;
  }
  return null;
}

/** Apply one reuse-degrading mutation to an untouched baseline register. Returns commit message. */
function damageSfr(m: ProjectModel, rng: Rng, themeIps?: string[]): string | null {
  let candidates = allRegs(m).filter(({ ip, mod, reg }) => reg.baseline && !m.touchedRegs.has(regKey(ip, mod, reg)));
  if (!candidates.length) return null;
  if (themeIps?.length && chance(rng, 0.85)) {
    const themed = candidates.filter(({ ip }) => themeIps.includes(ip.name));
    if (themed.length) candidates = themed;
  }
  const { ip, mod, reg } = pick(rng, candidates);
  m.touchedRegs.add(regKey(ip, mod, reg));

  const roll = rng();
  const fl = pick(rng, reg.fields);

  // remove register (rare, needs >2 regs in module)
  if (roll < 0.06 && mod.regs.length > 2) {
    mod.regs = mod.regs.filter((rr) => rr !== reg);
    return `${ip.name}: remove ${reg.name} register (superseded by platform service)`;
  }
  // add a new field into the baseline register
  if (roll < 0.22 && ip.fieldPool.length) {
    const idx = irand(rng, ip.fieldPool.length);
    const spec = ip.fieldPool[idx];
    const lsb = freeBitRun(reg, spec.width);
    if (lsb !== null && !reg.fields.some((x) => x.name === spec.name)) {
      ip.fieldPool.splice(idx, 1);
      reg.fields.push({
        name: spec.name,
        lsb,
        width: spec.width,
        sw: spec.sw ?? "rw",
        hw: spec.hw ?? "r",
        reset: spec.reset ?? 0,
        desc: spec.desc,
        baseline: false,
      });
      return `${ip.name}: add ${spec.name} field to ${reg.name}`;
    }
  }
  // widen a field
  if (roll < 0.36) {
    const widenable = reg.fields.filter((x) => {
      const top = x.lsb + x.width;
      return top < 32 && !reg.fields.some((y) => y !== x && y.lsb <= top && top < y.lsb + y.width);
    });
    if (widenable.length) {
      const w = pick(rng, widenable);
      w.width += 1;
      return `${ip.name}: widen ${reg.name}.${w.name} to ${w.width} bits`;
    }
  }
  // remove a field
  if (roll < 0.46 && reg.fields.length > 1) {
    const victim = pick(rng, reg.fields);
    reg.fields = reg.fields.filter((x) => x !== victim);
    return `${ip.name}: drop ${reg.name}.${victim.name} (feature removed)`;
  }
  // access policy change
  if (roll < 0.62) {
    if (fl.sw === "rw") {
      fl.sw = "r";
      return `${ip.name}: make ${reg.name}.${fl.name} read-only`;
    }
    if (fl.sw === "r") {
      fl.sw = "rw";
      return `${ip.name}: expose ${reg.name}.${fl.name} as read-write`;
    }
    fl.sw = "rw";
    return `${ip.name}: simplify ${reg.name}.${fl.name} write semantics`;
  }
  // rework: change several field resets/accesses
  if (roll < 0.78 && reg.fields.length >= 2) {
    const n = Math.min(reg.fields.length, 2 + irand(rng, 2));
    const shuffled = [...reg.fields].sort(() => rng() - 0.5).slice(0, n);
    for (const x of shuffled) {
      const mask = 2 ** x.width - 1;
      x.reset = x.width === 1 ? 1 - x.reset : (x.reset + 1 + irand(rng, Math.max(1, mask - 1))) & mask;
    }
    return `${ip.name}: rework ${reg.name} default configuration`;
  }
  // reset value change
  {
    const mask = 2 ** Math.min(fl.width, 30) - 1;
    const next = fl.width === 1 ? 1 - fl.reset : ((fl.reset + 1 + irand(rng, Math.max(1, mask - 1))) & mask) >>> 0;
    fl.reset = next;
    return `${ip.name}: change ${reg.name}.${fl.name} reset to ${hex(next)}`;
  }
}

const GENERIC_PARAMS: ParamSpec[] = [
  p("uint32_t", "flags", "Reserved option flags, pass 0.", "0"),
  p("uint32_t", "timeout_ms", "Operation timeout in milliseconds."),
  p("const HalOptions&", "options", "Extended options block."),
];

function damageHal(m: ProjectModel, rng: Rng, themeIps?: string[]): string | null {
  let candidates = allFns(m).filter(({ file, cls, fnv }) => fnv.baseline && !m.touchedFns.has(fnKey(file, cls, fnv)));
  if (!candidates.length) return null;
  if (themeIps?.length && chance(rng, 0.85)) {
    const themed = candidates.filter(({ file }) => themeIps.includes(file.ip));
    if (themed.length) candidates = themed;
  }
  const { file, cls, fnv } = pick(rng, candidates);
  m.touchedFns.add(fnKey(file, cls, fnv));
  const label = `${cls.name}::${fnv.name}`;

  const roll = rng();
  // deprecate (sometimes adding a replacement from the pool)
  if (roll < 0.2) {
    let repl = "the v2 platform API";
    const poolIdx = file.fnPool.findIndex((x) => x.cls === cls.name);
    if (poolIdx >= 0) {
      const { fn: spec } = file.fnPool.splice(poolIdx, 1)[0];
      if (!cls.fns.some((x) => x.name === spec.name)) {
        const nf = buildFn(spec);
        nf.baseline = false;
        cls.fns.push(nf);
        repl = `${spec.name}()`;
      }
    }
    fnv.deprecated = `Use ${repl} instead.`;
    return `hal(${file.ip}): deprecate ${label} in favor of ${repl.replace("()", "")}`;
  }
  // return type modernization
  if (roll < 0.45) {
    if (fnv.ret === "void") {
      fnv.ret = "HalStatus";
      fnv.returns = "HalStatus::Ok on success.";
      return `hal(${file.ip}): return HalStatus from ${label}`;
    }
    if (fnv.ret === "int32_t") {
      fnv.ret = "HalStatus";
      fnv.returns = "HalStatus::Ok on success, negative status on error.";
      return `hal(${file.ip}): migrate ${label} to HalStatus result`;
    }
    // fall through to param change
  }
  // parameter type change
  if (roll < 0.7 && fnv.params.length) {
    const prm = pick(rng, fnv.params);
    const swaps: Record<string, string> = {
      uint32_t: "uint64_t",
      uint16_t: "uint32_t",
      uint8_t: "uint16_t",
      size_t: "uint32_t",
      int16_t: "int32_t",
    };
    if (swaps[prm.type]) {
      const from = prm.type;
      prm.type = swaps[prm.type];
      return `hal(${file.ip}): widen ${label} ${prm.name} from ${from} to ${prm.type}`;
    }
  }
  // append a parameter
  {
    const candidatesP = GENERIC_PARAMS.filter((g) => !fnv.params.some((x) => x.name === g.name));
    if (candidatesP.length) {
      const g = pick(rng, candidatesP);
      fnv.params.push({ ...g });
      return `hal(${file.ip}): add ${g.name} parameter to ${label}`;
    }
    fnv.ret = fnv.ret === "HalStatus" ? "HalResult" : "HalStatus";
    return `hal(${file.ip}): change ${label} result type`;
  }
}

const DESC_SUFFIXES = [
  " Verified during FPGA bring-up.",
  " See the programming guide for sequencing details.",
  " Requires the controller to be idle.",
  " Cross-checked against RTL behavior.",
];

function fillerOp(m: ProjectModel, rng: Rng): string | null {
  const roll = rng();

  // SFR doc tweak
  if (roll < 0.3) {
    const regs = allRegs(m);
    for (let i = 0; i < 8; i++) {
      const { ip, mod, reg } = pick(rng, regs);
      const fl = pick(rng, reg.fields);
      const key = `${mod.file}:${reg.name}.${fl.name}`;
      const n = m.descTweaks.get(key) ?? 0;
      if (n >= DESC_SUFFIXES.length) continue;
      fl.desc = fl.desc + DESC_SUFFIXES[n];
      m.descTweaks.set(key, n + 1);
      return `docs(${ip.name}): clarify ${reg.name}.${fl.name} description`;
    }
    return null;
  }
  // HAL doc tweak
  if (roll < 0.5) {
    const fns = allFns(m);
    for (let i = 0; i < 8; i++) {
      const { file, cls, fnv } = pick(rng, fns);
      const key = `${file.file}:${cls.name}.${fnv.name}`;
      const n = m.descTweaks.get(key) ?? 0;
      if (n >= 2) continue;
      m.descTweaks.set(key, n + 1);
      if (n === 0) fnv.brief = fnv.brief.replace(/\.$/, "") + " (thread-safe).";
      else fnv.notes.push("Validated by the platform conformance suite.");
      return `docs(hal): polish ${cls.name}::${fnv.name} documentation`;
    }
    return null;
  }
  // HAL param rename (doc-only by functional identity)
  if (roll < 0.62) {
    const renames: Record<string, string> = { cb: "callback", cfg: "config", len: "length", buf: "buffer", prm: "param" };
    const fns = allFns(m).filter(({ fnv }) => fnv.params.some((x) => renames[x.name]));
    if (fns.length) {
      const { file, cls, fnv } = pick(rng, fns);
      const prm = fnv.params.find((x) => renames[x.name])!;
      const from = prm.name;
      prm.name = renames[from];
      return `hal(${file.ip}): rename ${cls.name}::${fnv.name} ${from} param to ${prm.name}`;
    }
    return null;
  }
  // add a brand-new register from the pool
  if (roll < 0.78) {
    const ips = m.ips.filter((ip) => ip.regPool.length);
    if (ips.length) {
      const ip = pick(rng, ips);
      const mod = pick(rng, ip.modules);
      const spec = ip.regPool.shift()!;
      if (!mod.regs.some((x) => x.name === spec.name)) {
        const nextOff = Math.max(...mod.regs.map((x) => x.offset)) + 4;
        const reg = buildReg(spec, nextOff);
        reg.baseline = false;
        for (const x of reg.fields) x.baseline = false;
        mod.regs.push(reg);
        return `${ip.name}: add ${spec.name} register`;
      }
    }
    return null;
  }
  // add a new field to an already-touched or non-baseline register
  if (roll < 0.88) {
    const targets = allRegs(m).filter(
      ({ ip, mod, reg }) => ip.fieldPool.length && (!reg.baseline || m.touchedRegs.has(regKey(ip, mod, reg)))
    );
    if (targets.length) {
      const { ip, reg } = pick(rng, targets);
      const idx = irand(rng, ip.fieldPool.length);
      const spec = ip.fieldPool[idx];
      const lsb = freeBitRun(reg, spec.width);
      if (lsb !== null && !reg.fields.some((x) => x.name === spec.name)) {
        ip.fieldPool.splice(idx, 1);
        reg.fields.push({
          name: spec.name,
          lsb,
          width: spec.width,
          sw: spec.sw ?? "rw",
          hw: spec.hw ?? "r",
          reset: spec.reset ?? 0,
          desc: spec.desc,
          baseline: false,
        });
        return `${ip.name}: add ${spec.name} field to ${reg.name}`;
      }
    }
    return null;
  }
  // add a brand-new HAL function from the pool
  {
    const files = m.hal.filter((x) => x.fnPool.length);
    if (files.length) {
      const file = pick(rng, files);
      const { cls: clsName, fn: spec } = file.fnPool.shift()!;
      const cls = file.classes.find((x) => x.name === clsName)!;
      if (!cls.fns.some((x) => x.name === spec.name)) {
        const nf = buildFn(spec);
        nf.baseline = false;
        cls.fns.push(nf);
        return `hal(${file.ip}): add ${clsName}::${spec.name} API`;
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------- project driver

export interface TagPlan {
  name: string;
  week: number;
  sfr: number; // target register reuse % at this tag
  hal: number; // target function reuse % at this tag
  msg: string;
  theme?: string[];
}

export interface ProjectPlan {
  id: string;
  name: string;
  codename: string;
  description: string;
  system: string;
  ns: string;
  t0: string; // Monday, week 0 (UTC midnight)
  seed: number;
  authors: Author[];
  roster: { subsystem: string; ips: string[] }[];
  tags: TagPlan[];
  opsPerWeek: number; // filler density
  /** absolute output directory; defaults to data/repos/<id> */
  outDir?: string;
  /** override the generated common/hal_types.h (defaults to the app-processor set) */
  halTypes?: HalTypesFn;
  /** override the repo README committed at the initial import */
  readme?: string;
}

export type IpLib = Record<string, () => IpDef>;
export type HalLib = Record<string, (sub: string) => HalDef>;

function buildModel(plan: ProjectPlan, ipLib: IpLib, halLib: HalLib): ProjectModel {
  const ips: RIp[] = [];
  const hal: RHalFile[] = [];
  for (const group of plan.roster) {
    const sub = group.subsystem.replace(/-subsystem$/, "");
    for (const ipName of group.ips) {
      if (!ipLib[ipName]) throw new Error(`Unknown IP in roster: ${ipName}`);
      if (!halLib[ipName]) throw new Error(`Missing HAL for IP: ${ipName}`);
      const def = ipLib[ipName]();
      ips.push({
        name: ipName,
        subsystem: group.subsystem,
        modules: def.modules.map((ms) => ({
          file: ms.file,
          addrmap: ms.addrmap,
          dispName: ms.dispName,
          desc: ms.desc,
          regs: ms.regs.map((rs) => buildReg(rs, rs.offset!)),
        })),
        fieldPool: [...def.fieldPool],
        regPool: [...def.regPool],
      });
      const hd = halLib[ipName](sub);
      hal.push({
        file: hd.file,
        brief: hd.brief,
        ip: ipName,
        classes: hd.classes.map((cs) => ({ name: cs.name, brief: cs.brief, fns: cs.fns.map(buildFn) })),
        fnPool: [...hd.fnPool],
      });
    }
  }
  return {
    system: plan.system,
    ns: plan.ns,
    name: plan.name,
    ips,
    hal,
    halTypes: plan.halTypes ?? DEFAULT_HAL_TYPES,
    touchedRegs: new Set(),
    touchedFns: new Set(),
    descTweaks: new Map(),
  };
}

function writeAll(repo: Repo, m: ProjectModel) {
  for (const ip of m.ips) {
    for (const mod of ip.modules) {
      repo.write(`rdl/${m.system}/${ip.subsystem}/${ip.name}/${mod.file}`, serializeRdl(mod, m.name));
    }
  }
  for (const file of m.hal) {
    repo.write(`hal/include/${file.file}`, serializeHal(file, m.ns, m.name));
    // reference implementation (.c) — used by the SFR↔HAL traceability scanner
    const ip = m.ips.find((x) => x.name === file.ip);
    if (ip) repo.write(`hal/src/${file.file.replace(/\.h$/, ".c")}`, serializeHalImpl(file, ip, m.ns, m.name));
  }
  repo.write(`hal/include/common/hal_types.h`, m.halTypes(m.ns, m.name));
}

export function seedProject(plan: ProjectPlan, ipLib: IpLib, halLib: HalLib) {
  const rng = mulberry32(plan.seed);
  const t0 = new Date(plan.t0 + "T00:00:00Z");
  const repoDir = plan.outDir ?? join(ROOT, "data", "repos", plan.id);
  const repo = new Repo(repoDir);
  const model = buildModel(plan, ipLib, halLib);

  const baseRegCount = allRegs(model).length;
  const baseFnCount = allFns(model).length;

  // initial import
  writeAll(repo, model);
  repo.write(
    "README.md",
    plan.readme ??
      `# ${plan.name} (${plan.codename}) interface tree\n\nSystemRDL register descriptions (\`rdl/\`) and C++ HAL headers (\`hal/include/\`)\nfor the ${plan.name} SoC. Managed by the platform team.\n`
  );
  const a0 = plan.authors[0];
  repo.commit(plan.tags[0].msg, kstIso(t0, 0, 10, 0), a0);
  repo.tag(plan.tags[0].name, plan.tags[0].msg, kstIso(t0, 0, 10, 30), a0);

  // intervals between consecutive tags
  for (let k = 1; k < plan.tags.length; k++) {
    const prev = plan.tags[k - 1];
    const cur = plan.tags[k];

    const sfrTargetTouched = Math.round(((100 - cur.sfr) / 100) * baseRegCount);
    const halTargetTouched = Math.round(((100 - cur.hal) / 100) * baseFnCount);
    const sfrNeeded = Math.max(0, sfrTargetTouched - model.touchedRegs.size);
    const halNeeded = Math.max(0, halTargetTouched - model.touchedFns.size);
    const weeks = cur.week - prev.week;
    const fillerCount = Math.max(2, Math.round(weeks * plan.opsPerWeek + (rng() - 0.5) * 2));

    const ops: ("sfr" | "hal" | "filler")[] = [
      ...Array(sfrNeeded).fill("sfr" as const),
      ...Array(halNeeded).fill("hal" as const),
      ...Array(fillerCount).fill("filler" as const),
    ];
    // shuffle
    for (let i = ops.length - 1; i > 0; i--) {
      const j = irand(rng, i + 1);
      [ops[i], ops[j]] = [ops[j], ops[i]];
    }

    // group into commits of 1-2 ops
    const commits: ("sfr" | "hal" | "filler")[][] = [];
    let i = 0;
    while (i < ops.length) {
      const take = chance(rng, 0.3) && i + 1 < ops.length ? 2 : 1;
      commits.push(ops.slice(i, i + take));
      i += take;
    }

    const times = businessTimes(rng, t0, prev.week * 7 + 1, cur.week * 7, commits.length);
    let lastTime = { day: prev.week * 7 + 1, hour: 10, minute: 0 };

    commits.forEach((group, ci) => {
      const msgs: string[] = [];
      for (const op of group) {
        let msg: string | null = null;
        if (op === "sfr") msg = damageSfr(model, rng, cur.theme);
        else if (op === "hal") msg = damageHal(model, rng, cur.theme);
        else msg = fillerOp(model, rng);
        if (msg) msgs.push(msg);
      }
      if (!msgs.length) return;
      writeAll(repo, model);
      const t = times[Math.min(ci, times.length - 1)];
      lastTime = t;
      const subject = msgs[0];
      const body = msgs.slice(1).map((s) => `- ${s}`).join("\n");
      const full = body ? `${subject}\n\n${body}` : subject;
      repo.commit(full, kstIso(t0, t.day, t.hour, t.minute), pick(rng, plan.authors));
    });

    repo.tag(cur.name, cur.msg, kstIso(t0, Math.max(lastTime.day, prev.week * 7 + 1), 18, 30), pick(rng, plan.authors));
  }

  const summary = {
    id: plan.id,
    commits: repo.commitCount(),
    tags: plan.tags.length,
    baselineRegs: baseRegCount,
    baselineFns: baseFnCount,
    touchedRegs: model.touchedRegs.size,
    touchedFns: model.touchedFns.size,
  };
  console.log(
    `✓ ${plan.name.padEnd(7)} ${summary.commits} commits, ${summary.tags} tags — baseline ${summary.baselineRegs} regs / ${summary.baselineFns} fns, touched ${summary.touchedRegs} regs / ${summary.touchedFns} fns`
  );
  return summary;
}
