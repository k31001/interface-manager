/**
 * SSD-controller-specific IP library (SFR + HAL) for the Pulsar demo.
 *
 * Host path:   nvme, pcie, hdma
 * Media path:  nandc, ecc, fdma
 * Memory:      ddrc, sbm
 * Security:    aes (AES-XTS for SED/Opal)
 * Platform:    thermal
 *
 * Standard peripherals (uart, i2c, gpio, timer, wdt, pmu, clkgen, otp) are
 * reused from seedlib's common IP_LIB/HAL_LIB.
 */
import { type HalLib, type IpLib, STATUS, W1C, f, fn, p, r } from "./seedlib";

// ---------------------------------------------------------------- SFR

export const SSD_IP_LIB: IpLib = {
  // ============================================================ host
  nvme: () => ({
    modules: [
      {
        file: "nvme-ctrl.rdl",
        addrmap: "nvme_ctrl",
        dispName: "NVMe Controller",
        desc: "NVMe controller capability, configuration and status registers (PCIe register interface).",
        regs: [
          r("CAP", 0x00, "Capabilities", "Controller capabilities advertised to the host.", [
            f("MQES", 16, "Maximum queue entries supported, zero-based.", { sw: "r", hw: "w", reset: 0x03ff }),
            f("CQR", 1, "Contiguous queues required.", { sw: "r", hw: "w", reset: 1 }),
            f("DSTRD", 4, "Doorbell stride.", { sw: "r", hw: "w" }),
            f("MPSMIN", 4, "Minimum host memory page size.", { at: 24, sw: "r", hw: "w" }),
            f("MPSMAX", 4, "Maximum host memory page size.", { at: 28, sw: "r", hw: "w", reset: 0x4 }),
          ]),
          r("VS", 0x08, "Version", "NVMe specification version implemented.", [
            f("TER", 8, "Tertiary version.", { sw: "r", hw: "w" }),
            f("MNR", 8, "Minor version.", { sw: "r", hw: "w", reset: 0x04 }),
            f("MJR", 16, "Major version.", { sw: "r", hw: "w", reset: 0x0002 }),
          ], STATUS),
          r("CC", 0x14, "Controller Configuration", "Host-programmed controller configuration.", [
            f("EN", 1, "Controller enable."),
            f("CSS", 3, "I/O command set selected.", { at: 4 }),
            f("MPS", 4, "Host memory page size.", { at: 7 }),
            f("AMS", 3, "Arbitration mechanism selected.", { at: 11 }),
            f("SHN", 2, "Shutdown notification.", { at: 14 }),
            f("IOSQES", 4, "I/O submission queue entry size.", { at: 16, reset: 0x6 }),
            f("IOCQES", 4, "I/O completion queue entry size.", { at: 20, reset: 0x4 }),
          ]),
          r("CSTS", 0x1c, "Controller Status", "Live controller status.", [
            f("RDY", 1, "Controller ready."),
            f("CFS", 1, "Controller fatal status."),
            f("SHST", 2, "Shutdown status.", { at: 2 }),
            f("NSSRO", 1, "NVM subsystem reset occurred.", { at: 4 }),
            f("PP", 1, "Processing paused.", { at: 5 }),
          ], STATUS),
          r("AQA", 0x24, "Admin Queue Attributes", "Admin queue sizes.", [
            f("ASQS", 12, "Admin submission queue size, zero-based.", { reset: 0x01f }),
            f("ACQS", 12, "Admin completion queue size, zero-based.", { at: 16, reset: 0x01f }),
          ]),
          r("ASQ", 0x28, "Admin Submission Queue Base", "Admin submission queue base address (low word).", [
            f("ASQB", 32, "Admin submission queue base address [31:12].", { sw: "rw" }),
          ]),
          r("ACQ", 0x30, "Admin Completion Queue Base", "Admin completion queue base address (low word).", [
            f("ACQB", 32, "Admin completion queue base address [31:12].", { sw: "rw" }),
          ]),
          r("INTMS", 0x0c, "Interrupt Mask Set", "Write 1 to mask the corresponding interrupt vector.", [
            f("IVMS", 32, "Interrupt vector mask set."),
          ]),
        ],
      },
      {
        file: "nvme-queue.rdl",
        addrmap: "nvme_queue",
        dispName: "NVMe Queue Engine",
        desc: "I/O submission/completion queue management and command arbitration.",
        regs: [
          r("SQ_CFG", 0x00, "SQ Config", "I/O submission queue configuration.", [
            f("EN", 1, "Enable this submission queue."),
            f("PRIO", 2, "Queue priority for weighted arbitration.", { at: 1 }),
            f("QID", 6, "Queue identifier.", { at: 4 }),
            f("DEPTH", 12, "Queue depth, zero-based.", { at: 16, reset: 0x0ff }),
          ]),
          r("CQ_CFG", 0x04, "CQ Config", "I/O completion queue configuration.", [
            f("EN", 1, "Enable this completion queue."),
            f("IEN", 1, "Interrupts enabled for this queue.", { reset: 1 }),
            f("QID", 6, "Queue identifier.", { at: 4 }),
            f("IV", 6, "Interrupt vector.", { at: 10 }),
            f("DEPTH", 12, "Queue depth, zero-based.", { at: 16, reset: 0x0ff }),
          ]),
          r("SQ_TAIL", 0x08, "SQ Tail Doorbell", "Submission queue tail doorbell.", [
            f("TAIL", 16, "New submission queue tail pointer.", { sw: "w" }),
          ]),
          r("CQ_HEAD", 0x0c, "CQ Head Doorbell", "Completion queue head doorbell.", [
            f("HEAD", 16, "New completion queue head pointer.", { sw: "w" }),
          ]),
          r("ARB", 0x10, "Arbitration", "Weighted round-robin arbitration burst weights.", [
            f("AB", 3, "Arbitration burst.", { reset: 0x3 }),
            f("LPW", 8, "Low priority weight.", { at: 8, reset: 0x4 }),
            f("MPW", 8, "Medium priority weight.", { at: 16, reset: 0x8 }),
            f("HPW", 8, "High priority weight.", { at: 24, reset: 0x10 }),
          ]),
          r("QSTAT", 0x14, "Queue Status", "Aggregate queue engine status.", [
            f("ACTIVE", 8, "Number of active I/O queues."),
            f("FULL", 1, "At least one SQ is full.", { at: 8 }),
            f("EMPTY", 1, "All CQs empty.", { at: 9, reset: 1 }),
          ], STATUS),
        ],
      },
    ],
    fieldPool: [
      f("SGL_EN", 1, "Enable scatter-gather list support."),
      f("WRR_URGENT", 1, "Treat this queue as the urgent strict-priority class."),
      f("CMB_EN", 1, "Enable controller memory buffer for this queue."),
      f("ABORT_EN", 1, "Enable fast abort handling."),
    ],
    regPool: [
      r("CMBLOC", 0, "CMB Location", "Controller memory buffer location.", [
        f("BIR", 3, "Base indicator register."),
        f("OFST", 24, "Offset in CMB size units.", { at: 12 }),
      ]),
      r("DSTRD_CFG", 0, "Doorbell Stride Config", "Programmable doorbell stride for shadow doorbells.", [
        f("STRIDE", 4, "Doorbell stride.", { reset: 0x0 }),
        f("SHADOW_EN", 1, "Enable shadow doorbell buffer.", { at: 4 }),
      ]),
    ],
  }),

  pcie: () => ({
    modules: [
      {
        file: "pcie-core.rdl",
        addrmap: "pcie_core",
        dispName: "PCIe Core",
        desc: "PCIe Gen5 link controller: LTSSM, link control and error reporting.",
        regs: [
          r("LINK_CTRL", 0x00, "Link Control", "Link-level control.", [
            f("EN", 1, "Enable the link controller.", { reset: 1 }),
            f("TARGET_SPEED", 3, "Target link speed. 1:Gen1 … 5:Gen5.", { at: 4, reset: 0x5 }),
            f("TARGET_WIDTH", 4, "Target link width.", { at: 8, reset: 0x4 }),
            f("ASPM", 2, "Active-state power management policy.", { at: 12 }),
            f("RETRAIN", 1, "Strobe: force link retrain.", { at: 16, sw: "w" }),
          ]),
          r("LINK_STAT", 0x04, "Link Status", "Negotiated link status.", [
            f("CUR_SPEED", 3, "Current link speed."),
            f("CUR_WIDTH", 4, "Current link width.", { at: 4 }),
            f("LINK_UP", 1, "Data link layer up.", { at: 8 }),
            f("TRAINING", 1, "Link training in progress.", { at: 9 }),
          ], STATUS),
          r("LTSSM", 0x08, "LTSSM State", "Link training and status state machine.", [
            f("STATE", 6, "Current LTSSM state.", { sw: "r", hw: "w" }),
            f("L0_REACHED", 1, "L0 has been reached since reset.", { at: 8, sw: "r", hw: "w" }),
          ], STATUS),
          r("DEV_CTRL", 0x0c, "Device Control", "Device-level control.", [
            f("MAX_PAYLOAD", 3, "Maximum payload size.", { reset: 0x1 }),
            f("MAX_RDREQ", 3, "Maximum read request size.", { at: 12, reset: 0x2 }),
            f("RELAXED_ORD", 1, "Enable relaxed ordering.", { at: 4 }),
            f("NO_SNOOP", 1, "Enable no-snoop.", { at: 11 }),
          ]),
          r("AER_CTRL", 0x10, "AER Control", "Advanced error reporting control.", [
            f("CORR_EN", 1, "Report correctable errors.", { reset: 1 }),
            f("NONFATAL_EN", 1, "Report non-fatal errors.", { reset: 1 }),
            f("FATAL_EN", 1, "Report fatal errors.", { reset: 1 }),
          ]),
          r("AER_STAT", 0x14, "AER Status", "Latched error status. Write 1 to clear.", [
            f("BAD_TLP", 1, "Bad TLP received."),
            f("BAD_DLLP", 1, "Bad DLLP received."),
            f("REPLAY_TO", 1, "Replay timer timeout."),
            f("FC_TO", 1, "Flow-control protocol error."),
          ], W1C),
        ],
      },
      {
        file: "pcie-phy.rdl",
        addrmap: "pcie_phy",
        dispName: "PCIe PHY",
        desc: "PCIe Gen5 PHY: equalization, lane and de-emphasis control.",
        regs: [
          r("PHY_CTRL", 0x00, "PHY Control", "PHY power and reset control.", [
            f("PWR_EN", 1, "Power up the PHY.", { reset: 1 }),
            f("RST_N", 1, "PHY reset, active low.", { reset: 1 }),
            f("REF_SEL", 2, "Reference clock source.", { at: 4 }),
          ]),
          r("EQ_CTRL", 0x04, "Equalization Control", "Gen4/5 equalization control.", [
            f("EQ_MODE", 2, "Equalization mode."),
            f("PRESET", 4, "Requested TX preset.", { at: 4, reset: 0x7 }),
            f("BYPASS_PH2", 1, "Bypass equalization phase 2.", { at: 8 }),
            f("BYPASS_PH3", 1, "Bypass equalization phase 3.", { at: 9 }),
          ]),
          r("LANE_EN", 0x08, "Lane Enable", "Per-lane enable.", [
            f("LANE", 16, "Per-lane enable bitmap.", { reset: 0x000f }),
          ]),
          r("TX_PRESET", 0x0c, "TX Preset", "Transmitter de-emphasis and preshoot.", [
            f("PRE", 6, "Pre-cursor coefficient."),
            f("MAIN", 6, "Main-cursor coefficient.", { at: 8, reset: 0x2c }),
            f("POST", 6, "Post-cursor coefficient.", { at: 16 }),
          ]),
          r("RX_STAT", 0x10, "RX Status", "Receiver adaptation status.", [
            f("CDR_LOCK", 16, "Per-lane CDR lock.", { sw: "r", hw: "w" }),
          ], STATUS),
        ],
      },
    ],
    fieldPool: [
      f("L1SS_EN", 1, "Enable L1 sub-states."),
      f("SRIS_EN", 1, "Enable separate reference clock with independent SSC."),
      f("MARGIN_EN", 1, "Enable lane margining at receiver."),
      f("SKP_CTRL", 4, "SKP ordered-set insertion interval control."),
    ],
    regPool: [
      r("MARGIN", 0, "Lane Margining", "Receiver lane-margining control.", [
        f("LANE_SEL", 4, "Lane under test."),
        f("VOLT_STEP", 7, "Voltage margin step.", { at: 8 }),
        f("TIME_STEP", 6, "Timing margin step.", { at: 16 }),
      ]),
    ],
  }),

  hdma: () => ({
    modules: [
      {
        file: "hdma.rdl",
        addrmap: "host_dma",
        dispName: "Host DMA",
        desc: "Host-side data-transfer DMA between PCIe and on-chip buffers (PRP/SGL descriptors).",
        regs: [
          r("CTRL", 0x00, "Control", "Engine control.", [
            f("EN", 1, "Enable the host DMA engine."),
            f("DESC_MODE", 1, "Descriptor mode. 0:PRP, 1:SGL.", { reset: 1 }),
            f("ARB", 2, "Channel arbitration policy.", { at: 4 }),
            f("HALT", 1, "Gracefully halt at the next descriptor boundary.", { at: 8 }),
          ]),
          r("DESC_BASE_LO", 0x04, "Descriptor Base Low", "Descriptor ring base address, low word.", [
            f("ADDR", 32, "Descriptor base [31:0]."),
          ]),
          r("DESC_BASE_HI", 0x08, "Descriptor Base High", "Descriptor ring base address, high word.", [
            f("ADDR", 32, "Descriptor base [63:32]."),
          ]),
          r("CH_CTRL", 0x0c, "Channel Control", "Per-channel arm/abort control.", [
            f("ARM", 8, "Per-channel arm bitmap.", { sw: "w" }),
            f("ABORT", 8, "Per-channel abort bitmap.", { at: 8, sw: "w" }),
          ]),
          r("CH_STAT", 0x10, "Channel Status", "Per-channel busy status.", [
            f("BUSY", 8, "Per-channel busy bitmap."),
            f("ERR", 8, "Per-channel error bitmap.", { at: 8 }),
          ], STATUS),
          r("INT_EN", 0x14, "Interrupt Enable", "Per-source interrupt enables.", [
            f("DONE", 1, "Transfer-complete interrupt enable."),
            f("ERR", 1, "Bus-error interrupt enable."),
          ]),
          r("INT_STAT", 0x18, "Interrupt Status", "Sticky interrupt flags. Write 1 to clear.", [
            f("DONE", 1, "A channel completed."),
            f("ERR", 1, "A bus error occurred."),
          ], W1C),
        ],
      },
    ],
    fieldPool: [
      f("PREFETCH_EN", 1, "Enable descriptor prefetching."),
      f("COALESCE", 4, "Completion interrupt coalescing count."),
      f("QOS", 2, "Bus QoS class for host traffic."),
    ],
    regPool: [
      r("PERF_CNT", 0, "Performance Counter", "Throughput diagnostics.", [
        f("BYTES_LO", 32, "Bytes transferred, low word.", { sw: "r", hw: "w" }),
      ]),
    ],
  }),

  // ============================================================ media
  nandc: () => ({
    modules: [
      {
        file: "nandc-core.rdl",
        addrmap: "nand_core",
        dispName: "NAND Channel Core",
        desc: "NAND flash channel controller: per-channel timing, drive strength and mode (ONFI/Toggle).",
        regs: [
          r("CTRL", 0x00, "Control", "Channel control.", [
            f("EN", 1, "Enable the channel."),
            f("CE_SEL", 3, "Active chip-enable (target) select.", { at: 1 }),
            f("IF_MODE", 2, "Interface mode. 0:legacy, 1:ONFI DDR, 2:Toggle.", { at: 4, reset: 0x1 }),
            f("WP_N", 1, "Write-protect, active low.", { at: 8, reset: 1 }),
          ]),
          r("CH_EN", 0x04, "Channel Enable", "Multi-channel enable bitmap.", [
            f("CH", 8, "Per-channel enable.", { reset: 0x0f }),
          ]),
          r("MODE", 0x08, "Timing Mode", "ONFI/Toggle speed mode selection.", [
            f("ONFI_MODE", 4, "ONFI timing mode 0-7.", { reset: 0x4 }),
            f("TOGGLE_MODE", 4, "Toggle timing mode.", { at: 4 }),
            f("SYNC", 1, "Synchronous (DDR) data interface.", { at: 8, reset: 1 }),
          ]),
          r("TIMING0", 0x0c, "Timing 0", "Command/address cycle timing.", [
            f("TWP", 5, "Write-pulse width, cycles.", { reset: 0x4 }),
            f("TWH", 5, "Write-hold, cycles.", { at: 8, reset: 0x4 }),
            f("TRP", 5, "Read-pulse width, cycles.", { at: 16, reset: 0x4 }),
            f("TREH", 5, "Read-hold, cycles.", { at: 24, reset: 0x4 }),
          ]),
          r("TIMING1", 0x10, "Timing 1", "Data and turnaround timing.", [
            f("TADL", 8, "ALE-to-data delay, cycles.", { reset: 0x20 }),
            f("TWHR", 8, "Write-to-read turnaround, cycles.", { at: 8, reset: 0x20 }),
            f("TCS", 6, "Chip-select setup, cycles.", { at: 16, reset: 0x10 }),
          ]),
          r("DRIVE", 0x14, "Drive Strength", "I/O pad drive configuration.", [
            f("STRENGTH", 2, "Output drive strength.", { reset: 0x1 }),
            f("ODT", 3, "On-die termination select.", { at: 4 }),
            f("SLEW", 2, "Slew-rate control.", { at: 8 }),
          ]),
          r("STAT", 0x18, "Status", "Channel status.", [
            f("RDY", 8, "Per-target ready/busy.", { reset: 0xff }),
            f("CH_BUSY", 1, "Channel transferring.", { at: 8 }),
          ], STATUS),
        ],
      },
      {
        file: "nandc-seq.rdl",
        addrmap: "nand_seq",
        dispName: "NAND Sequencer",
        desc: "Programmable NAND command sequencer and page-transfer engine.",
        regs: [
          r("SEQ_CTRL", 0x00, "Sequencer Control", "Sequencer execution control.", [
            f("START", 1, "Strobe: start the programmed sequence.", { sw: "w" }),
            f("ABORT", 1, "Strobe: abort the running sequence.", { sw: "w" }),
            f("AUTO_ECC", 1, "Route page data through the ECC engine.", { at: 4, reset: 1 }),
            f("AUTO_RANDOMIZE", 1, "Apply the data randomizer.", { at: 5, reset: 1 }),
          ]),
          r("CMD", 0x04, "Command", "NAND command codes for the sequence.", [
            f("CMD0", 8, "First command code."),
            f("CMD1", 8, "Second command code.", { at: 8 }),
            f("CMD2", 8, "Third command code.", { at: 16 }),
            f("NUM_CMD", 2, "Number of command phases.", { at: 24, reset: 0x1 }),
          ]),
          r("ADDR_LO", 0x08, "Address Low", "Row/column address, low word.", [
            f("ADDR", 32, "Address [31:0]."),
          ]),
          r("ADDR_HI", 0x0c, "Address High", "Row address, high word.", [
            f("ADDR", 8, "Address [39:32]."),
            f("NUM_CYCLES", 3, "Number of address cycles.", { at: 8, reset: 0x5 }),
          ]),
          r("XFER_CFG", 0x10, "Transfer Config", "Page/data transfer configuration.", [
            f("LEN", 16, "Transfer length in bytes.", { reset: 0x1000 }),
            f("DIR", 1, "Direction. 0:read, 1:program.", { at: 16 }),
            f("PLANE", 2, "Target plane.", { at: 17 }),
          ]),
          r("SEQ_STAT", 0x14, "Sequencer Status", "Sequencer status.", [
            f("BUSY", 1, "Sequence in progress."),
            f("DONE", 1, "Sequence complete."),
            f("TIMEOUT", 1, "Ready/busy wait timed out."),
          ], STATUS),
          r("INT_STAT", 0x18, "Interrupt Status", "Sticky interrupt flags. Write 1 to clear.", [
            f("DONE", 1, "Sequence completed."),
            f("ERR", 1, "Sequence error."),
            f("ECC_FAIL", 1, "Uncorrectable ECC on read."),
          ], W1C),
        ],
      },
    ],
    fieldPool: [
      f("CACHE_OP", 1, "Enable cache read/program operations."),
      f("MULTI_PLANE", 1, "Enable multi-plane operation."),
      f("SCRAMBLE_SEED", 16, "Per-page randomizer seed."),
      f("ZQ_CAL", 1, "Strobe: run ZQ calibration.", { sw: "w" }),
    ],
    regPool: [
      r("FEATURE", 0, "Set Feature", "ONFI set-feature shadow.", [
        f("ADDR", 8, "Feature address."),
        f("DATA", 8, "Feature data byte 0.", { at: 8 }),
      ]),
      r("RB_TIMEOUT", 0, "R/B Timeout", "Ready/busy wait timeout.", [
        f("VAL", 24, "Timeout in channel-clock cycles.", { reset: 0x0fffff }),
      ]),
    ],
  }),

  ecc: () => ({
    modules: [
      {
        file: "ecc-ldpc.rdl",
        addrmap: "ecc_ldpc",
        dispName: "LDPC ECC Engine",
        desc: "LDPC encoder/decoder for NAND user data with hard- and soft-decision decoding.",
        regs: [
          r("CTRL", 0x00, "Control", "Engine control.", [
            f("EN", 1, "Enable the LDPC engine."),
            f("MODE", 1, "0:decode, 1:encode."),
            f("SOFT_EN", 1, "Enable soft-decision decoding.", { at: 2 }),
            f("BYPASS", 1, "Bypass ECC (raw data path).", { at: 3 }),
          ]),
          r("CODE_SEL", 0x04, "Code Select", "Active code rate / frame geometry.", [
            f("RATE", 3, "Code rate index.", { reset: 0x2 }),
            f("FRAME_LEN", 13, "Codeword length in bytes.", { at: 4, reset: 0x1000 }),
            f("PARITY_LEN", 12, "Parity length in bytes.", { at: 16, reset: 0x100 }),
          ]),
          r("ITER_CFG", 0x08, "Iteration Config", "Decoder iteration limits.", [
            f("MAX_ITER", 8, "Maximum decode iterations.", { reset: 0x10 }),
            f("EARLY_TERM", 1, "Enable early termination.", { at: 8, reset: 1 }),
          ]),
          r("SOFT_CFG", 0x0c, "Soft Config", "Soft-decision LLR configuration.", [
            f("LLR_BITS", 3, "LLR quantization bits.", { reset: 0x4 }),
            f("READ_RETRY", 4, "Soft read-retry levels.", { at: 4, reset: 0x7 }),
          ]),
          r("STAT", 0x10, "Status", "Engine status.", [
            f("BUSY", 1, "Codeword in flight."),
            f("DONE", 1, "Codeword complete."),
            f("FAIL", 1, "Uncorrectable codeword."),
            f("ITER_USED", 8, "Iterations used by the last codeword.", { at: 8 }),
          ], STATUS),
          r("ERR_STAT", 0x14, "Error Statistics", "Corrected error counters.", [
            f("BIT_ERR", 16, "Corrected bit errors in the last codeword.", { sw: "r", hw: "w" }),
            f("SYND_W", 12, "Residual syndrome weight.", { at: 16, sw: "r", hw: "w" }),
          ], STATUS),
        ],
      },
      {
        file: "ecc-bch.rdl",
        addrmap: "ecc_bch",
        dispName: "BCH ECC Engine",
        desc: "BCH codec for metadata and boot regions.",
        regs: [
          r("CTRL", 0x00, "Control", "BCH control.", [
            f("EN", 1, "Enable the BCH engine."),
            f("MODE", 1, "0:decode, 1:encode."),
          ]),
          r("STRENGTH", 0x04, "Strength", "Correction strength configuration.", [
            f("T", 7, "Correctable bits per codeword.", { reset: 0x28 }),
            f("BLK_LEN", 12, "Block length in bytes.", { at: 8, reset: 0x200 }),
          ]),
          r("STAT", 0x08, "Status", "BCH status.", [
            f("BUSY", 1, "Operation in progress."),
            f("FAIL", 1, "Uncorrectable block."),
            f("ERR_CNT", 7, "Corrected errors in the last block.", { at: 8 }),
          ], STATUS),
        ],
      },
    ],
    fieldPool: [
      f("DETAG_EN", 1, "Enable end-to-end data-integrity tag check."),
      f("CHIPKILL_EN", 1, "Enable cross-die XOR recovery assist."),
      f("FLIP_HIST_EN", 1, "Collect bit-flip histograms for read-level tracking."),
    ],
    regPool: [
      r("HIST", 0, "Flip Histogram", "Bit-flip histogram readback.", [
        f("BIN", 16, "Histogram bin count.", { sw: "r", hw: "w" }),
        f("IDX", 4, "Histogram bin index.", { at: 16 }),
      ]),
      r("THRESH", 0, "Fail Threshold", "Codeword-fail escalation threshold.", [
        f("WARN", 16, "Warn above this bit-error count.", { reset: 0x0040 }),
      ]),
    ],
  }),

  fdma: () => ({
    modules: [
      {
        file: "fdma.rdl",
        addrmap: "flash_dma",
        dispName: "Flash DMA",
        desc: "Data-mover between the NAND channels, ECC engine and on-chip buffers.",
        regs: [
          r("CTRL", 0x00, "Control", "Engine control.", [
            f("EN", 1, "Enable the flash DMA engine."),
            f("ARB", 2, "Channel arbitration.", { at: 4 }),
          ]),
          r("CH_CFG", 0x04, "Channel Config", "Active channel configuration.", [
            f("CH_SEL", 3, "Channel select."),
            f("DIR", 1, "Direction. 0:flash→buf, 1:buf→flash.", { at: 4 }),
            f("BURST", 3, "Burst length, 2^N beats.", { at: 8, reset: 0x3 }),
          ]),
          r("SRC_ADDR", 0x08, "Source Address", "Transfer source address.", [
            f("ADDR", 32, "Byte-aligned source address."),
          ]),
          r("DST_ADDR", 0x0c, "Destination Address", "Transfer destination address.", [
            f("ADDR", 32, "Byte-aligned destination address."),
          ]),
          r("LEN", 0x10, "Length", "Transfer length.", [
            f("BYTES", 20, "Bytes to move."),
          ]),
          r("STAT", 0x14, "Status", "Engine status.", [
            f("BUSY", 1, "Transfer in progress."),
            f("DONE", 1, "Transfer complete."),
            f("ERR", 1, "Bus error."),
          ], STATUS),
        ],
      },
    ],
    fieldPool: [
      f("XOR_EN", 1, "Enable inline XOR accumulation for RAID rebuild."),
      f("DESC_EN", 1, "Enable descriptor-chained operation."),
    ],
    regPool: [
      r("XOR_ADDR", 0, "XOR Buffer", "Inline XOR accumulation buffer address.", [
        f("ADDR", 32, "XOR buffer base address."),
      ]),
    ],
  }),

  // ============================================================ memory
  ddrc: () => ({
    modules: [
      {
        file: "ddrc-core.rdl",
        addrmap: "ddr_core",
        dispName: "DRAM Controller Core",
        desc: "On-board DRAM cache controller (LPDDR4/DDR4): mode registers, refresh and timing.",
        regs: [
          r("CTRL", 0x00, "Control", "Controller control.", [
            f("EN", 1, "Enable the DRAM controller."),
            f("DRAM_TYPE", 2, "DRAM type. 0:DDR4, 1:LPDDR4.", { at: 1, reset: 0x1 }),
            f("BANK_GROUPS", 2, "Bank-group configuration.", { at: 4 }),
            f("AUTO_REF", 1, "Enable auto-refresh.", { at: 8, reset: 1 }),
          ]),
          r("MR_CTRL", 0x04, "Mode Register Control", "Mode-register access control.", [
            f("MR_ADDR", 4, "Mode register address."),
            f("WR", 1, "Strobe: issue MR write.", { at: 4, sw: "w" }),
            f("RANK", 2, "Target rank.", { at: 8 }),
          ]),
          r("MR_DATA", 0x08, "Mode Register Data", "Mode-register write data.", [
            f("DATA", 18, "Mode register payload."),
          ]),
          r("REFRESH", 0x0c, "Refresh", "Refresh interval configuration.", [
            f("TREFI", 16, "Average refresh interval, clocks.", { reset: 0x1860 }),
            f("BURST", 4, "Refresh burst count.", { at: 16, reset: 0x1 }),
          ]),
          r("TIMING0", 0x10, "Timing 0", "Core DRAM timing parameters.", [
            f("TRCD", 6, "RAS-to-CAS delay.", { reset: 0x12 }),
            f("TRP", 6, "Row precharge time.", { at: 8, reset: 0x12 }),
            f("TRAS", 7, "Row active time.", { at: 16, reset: 0x28 }),
          ]),
          r("TIMING1", 0x14, "Timing 1", "Data-path timing parameters.", [
            f("CL", 6, "CAS latency.", { reset: 0x16 }),
            f("CWL", 6, "CAS write latency.", { at: 8, reset: 0x10 }),
            f("TWR", 6, "Write recovery time.", { at: 16, reset: 0x18 }),
          ]),
          r("ZQ_CTRL", 0x18, "ZQ Control", "ZQ calibration control.", [
            f("ZQCAL", 1, "Strobe: run ZQ calibration.", { sw: "w" }),
            f("PERIOD", 16, "Periodic ZQ interval, ms.", { at: 8, reset: 0x0100 }),
          ]),
          r("STAT", 0x1c, "Status", "Controller status.", [
            f("INIT_DONE", 1, "DRAM initialization complete."),
            f("IN_SELF_REF", 1, "DRAM in self-refresh.", { at: 1 }),
          ], STATUS),
        ],
      },
      {
        file: "ddrc-phy.rdl",
        addrmap: "ddr_phy",
        dispName: "DRAM PHY",
        desc: "DRAM PHY: DLL, read/write leveling and DQ calibration.",
        regs: [
          r("PHY_CTRL", 0x00, "PHY Control", "PHY power and reset.", [
            f("PWR_EN", 1, "Power up the PHY.", { reset: 1 }),
            f("RST_N", 1, "PHY reset, active low.", { reset: 1 }),
          ]),
          r("DLL_CTRL", 0x04, "DLL Control", "Delay-locked loop control.", [
            f("EN", 1, "Enable the DLL.", { reset: 1 }),
            f("CODE", 9, "Manual DLL code override.", { at: 4 }),
            f("LOCK", 1, "DLL locked.", { at: 16, sw: "r", hw: "w" }),
          ]),
          r("DQ_CAL", 0x08, "DQ Calibration", "Write-leveling / DQ calibration control.", [
            f("WR_LVL", 1, "Strobe: run write leveling.", { sw: "w" }),
            f("GATE_TRAIN", 1, "Strobe: run read-gate training.", { at: 1, sw: "w" }),
            f("VREF", 7, "DQ Vref code.", { at: 8, reset: 0x40 }),
          ]),
          r("STAT", 0x0c, "Status", "PHY calibration status.", [
            f("CAL_DONE", 1, "Calibration complete."),
            f("CAL_ERR", 1, "Calibration error."),
          ], STATUS),
        ],
      },
    ],
    fieldPool: [
      f("ECC_EN", 1, "Enable inline DRAM ECC."),
      f("PWR_DOWN_EN", 1, "Enable automatic DRAM power-down."),
      f("SCRUB_EN", 1, "Enable background ECC scrubbing."),
    ],
    regPool: [
      r("ECC_STAT", 0, "DRAM ECC Status", "Inline-ECC event counters.", [
        f("CE_CNT", 16, "Corrected errors.", { sw: "r", hw: "w" }),
        f("UE_CNT", 8, "Uncorrected errors.", { at: 16, sw: "r", hw: "w" }),
      ]),
    ],
  }),

  sbm: () => ({
    modules: [
      {
        file: "sbm.rdl",
        addrmap: "sram_buf",
        dispName: "SRAM Buffer Manager",
        desc: "On-chip SRAM buffer pool allocator shared by the host and media data paths.",
        regs: [
          r("CTRL", 0x00, "Control", "Allocator control.", [
            f("EN", 1, "Enable the buffer manager.", { reset: 1 }),
            f("POLICY", 2, "Allocation policy. 0:FIFO, 1:LRU, 2:priority.", { at: 4 }),
          ]),
          r("POOL_CFG", 0x04, "Pool Config", "Buffer pool geometry.", [
            f("BLK_SIZE", 4, "Block size, 2^(9+N) bytes.", { reset: 0x3 }),
            f("NUM_BLK", 16, "Number of blocks in the pool.", { at: 8, reset: 0x0400 }),
          ]),
          r("ALLOC", 0x08, "Allocate", "Allocation request window.", [
            f("COUNT", 8, "Blocks to allocate.", { sw: "w" }),
            f("TOKEN", 16, "Returned allocation token.", { at: 8, sw: "r", hw: "w" }),
          ]),
          r("FREE", 0x0c, "Free", "Free request window.", [
            f("TOKEN", 16, "Allocation token to free.", { sw: "w" }),
          ]),
          r("WMARK", 0x10, "Watermark", "Backpressure watermarks.", [
            f("LOW", 16, "Low watermark.", { reset: 0x0040 }),
            f("HIGH", 16, "High watermark.", { at: 16, reset: 0x0380 }),
          ]),
          r("STAT", 0x14, "Status", "Pool occupancy status.", [
            f("FREE_BLK", 16, "Free blocks remaining."),
            f("FULL", 1, "Pool exhausted.", { at: 16 }),
          ], STATUS),
        ],
      },
    ],
    fieldPool: [
      f("ECC_EN", 1, "Enable SRAM ECC protection."),
      f("PARTITION_EN", 1, "Enable host/media pool partitioning."),
    ],
    regPool: [
      r("PARTITION", 0, "Partition", "Host/media pool split.", [
        f("HOST_BLK", 16, "Blocks reserved for the host path.", { reset: 0x0200 }),
      ]),
    ],
  }),

  // ============================================================ security
  aes: () => ({
    modules: [
      {
        file: "aes-xts.rdl",
        addrmap: "aes_xts",
        dispName: "AES-XTS Engine",
        desc: "Inline AES-XTS engine for self-encrypting-drive (TCG Opal) media protection.",
        regs: [
          r("CTRL", 0x00, "Control", "Cipher control.", [
            f("EN", 1, "Enable inline encryption."),
            f("KEY_SIZE", 1, "0:XTS-256, 1:XTS-512."),
            f("DECRYPT", 1, "1:decrypt, 0:encrypt.", { at: 2 }),
            f("BYPASS", 1, "Bypass cipher (plaintext path).", { at: 3 }),
          ]),
          r("KEY_CTRL", 0x04, "Key Control", "Key-slot selection and loading.", [
            f("SLOT", 5, "Key slot select."),
            f("LOAD", 1, "Strobe: load key from the secure key store.", { at: 5, sw: "w" }),
            f("FLUSH", 1, "Strobe: zeroize the working key.", { at: 6, sw: "w" }),
            f("LOCKED", 1, "Selected slot is locked.", { at: 8, sw: "r", hw: "w" }),
          ]),
          r("SECTOR_SIZE", 0x08, "Sector Size", "XTS data-unit (sector) size.", [
            f("SIZE", 4, "Data-unit size, 2^(9+N) bytes.", { reset: 0x3 }),
          ]),
          r("LBA_LO", 0x0c, "Tweak LBA Low", "Initial XTS tweak (LBA), low word.", [
            f("LBA", 32, "Logical block address [31:0]."),
          ]),
          r("LBA_HI", 0x10, "Tweak LBA High", "Initial XTS tweak (LBA), high word.", [
            f("LBA", 32, "Logical block address [63:32]."),
          ]),
          r("STAT", 0x14, "Status", "Engine status.", [
            f("BUSY", 1, "Sector in flight."),
            f("KEY_VALID", 1, "A valid key is loaded.", { at: 1 }),
          ], STATUS),
          r("INT_STAT", 0x18, "Interrupt Status", "Sticky interrupt flags. Write 1 to clear.", [
            f("KEY_ERR", 1, "Key load failed (locked or invalid)."),
            f("BUS_ERR", 1, "Data-path bus error."),
          ], W1C),
        ],
      },
    ],
    fieldPool: [
      f("KEY_WRAP_EN", 1, "Require wrapped keys from the secure store."),
      f("CRYPTO_ERASE", 1, "Strobe: crypto-erase the selected key slot.", { sw: "w" }),
      f("DPA_MASK_EN", 1, "Enable DPA masking countermeasure."),
    ],
    regPool: [
      r("RANGE_CTRL", 0, "Locking Range", "Opal locking-range binding.", [
        f("RANGE", 4, "Locking range index."),
        f("RD_LOCK", 1, "Read-locked.", { at: 8 }),
        f("WR_LOCK", 1, "Write-locked.", { at: 9 }),
      ]),
    ],
  }),

  // ============================================================ platform
  thermal: () => ({
    modules: [
      {
        file: "thermal.rdl",
        addrmap: "thermal",
        dispName: "Thermal Sensor",
        desc: "On-die thermal sensor with warning/critical thresholds and performance throttling.",
        regs: [
          r("CTRL", 0x00, "Control", "Sensor control.", [
            f("EN", 1, "Enable thermal monitoring.", { reset: 1 }),
            f("RATE", 3, "Sampling rate select.", { at: 4, reset: 0x3 }),
            f("THROTTLE_EN", 1, "Enable automatic throttling.", { at: 8, reset: 1 }),
          ]),
          r("TEMP", 0x04, "Temperature", "Current die temperature.", [
            f("VAL", 12, "Temperature, signed 0.0625°C steps.", { sw: "r", hw: "w" }),
            f("VALID", 1, "Reading valid.", { at: 12, sw: "r", hw: "w" }),
          ], STATUS),
          r("THRESH_WARN", 0x08, "Warning Threshold", "Composite temperature warning level.", [
            f("VAL", 12, "Warning threshold.", { reset: 0x0550 }),
          ]),
          r("THRESH_CRIT", 0x0c, "Critical Threshold", "Critical (shutdown) temperature level.", [
            f("VAL", 12, "Critical threshold.", { reset: 0x0640 }),
          ]),
          r("THROTTLE_CFG", 0x10, "Throttle Config", "Throttling policy.", [
            f("L1_PCT", 7, "Level-1 throughput cap, percent.", { reset: 0x50 }),
            f("L2_PCT", 7, "Level-2 throughput cap, percent.", { at: 8, reset: 0x28 }),
            f("HYST", 6, "Recovery hysteresis, °C.", { at: 16, reset: 0x05 }),
          ]),
          r("STAT", 0x14, "Status", "Throttle status.", [
            f("WARN", 1, "Above warning threshold."),
            f("CRIT", 1, "Above critical threshold."),
            f("THROTTLE_LVL", 2, "Active throttle level.", { at: 4 }),
          ], STATUS),
          r("INT_STAT", 0x18, "Interrupt Status", "Sticky interrupt flags. Write 1 to clear.", [
            f("WARN", 1, "Warning threshold crossed."),
            f("CRIT", 1, "Critical threshold crossed."),
          ], W1C),
        ],
      },
    ],
    fieldPool: [
      f("AVG_EN", 1, "Enable rolling-average filtering."),
      f("EXT_SENSOR_EN", 1, "Include the external board sensor in the composite."),
    ],
    regPool: [
      r("PEAK", 0, "Peak Temperature", "Peak temperature since reset.", [
        f("VAL", 12, "Peak temperature.", { sw: "r", hw: "w" }),
      ]),
    ],
  }),
};

// ---------------------------------------------------------------- HAL

const HS = "HalStatus";

export const SSD_HAL_LIB: HalLib = {
  nvme: (sub) => ({
    file: `${sub}/nvme_hal.h`,
    brief: "NVMe controller hardware abstraction layer.",
    classes: [
      {
        name: "NvmeHal",
        brief: "Driver for the NVMe register interface: controller bring-up and I/O queue management.",
        fns: [
          fn(HS, "Init", [p("const NvmeConfig&", "config", "Controller configuration (queue sizes, page size).")], "Initialize and enable the NVMe controller.", { returns: "HalStatus::Ok once CSTS.RDY is set." }),
          fn(HS, "Shutdown", [p("bool", "abrupt", "True for an abrupt shutdown, false for a normal one.")], "Request a controller shutdown.", { returns: "HalStatus::Ok once the shutdown completes." }),
          fn(HS, "CreateIoQueue", [p("uint16_t", "qid", "Queue identifier."), p("const QueueConfig&", "config", "Submission/completion queue configuration.")], "Create an I/O submission/completion queue pair.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "DeleteIoQueue", [p("uint16_t", "qid", "Queue identifier.")], "Delete an I/O queue pair.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "RingSubmissionDoorbell", [p("uint16_t", "qid", "Queue identifier."), p("uint16_t", "tail", "New tail pointer.")], "Ring a submission-queue tail doorbell.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "RingCompletionDoorbell", [p("uint16_t", "qid", "Queue identifier."), p("uint16_t", "head", "New head pointer.")], "Ring a completion-queue head doorbell.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "SetArbitration", [p("const ArbConfig&", "arb", "Weighted round-robin burst weights.")], "Configure command arbitration.", { returns: "HalStatus::Ok on success." }),
          fn("NvmeStatus", "GetStatus", [], "Read the controller status register.", { isConst: true, returns: "Snapshot of CSTS." }),
        ],
      },
    ],
    fnPool: [
      { cls: "NvmeHal", fn: fn(HS, "EnableCmb", [p("uint8_t", "bir", "Base indicator register."), p("uint32_t", "size_mb", "Controller-memory-buffer size in MiB.")], "Enable the controller memory buffer.", { returns: "HalStatus::Ok on success." }) },
      { cls: "NvmeHal", fn: fn(HS, "ConfigureShadowDoorbells", [p("uint64_t", "db_base", "Shadow doorbell buffer address."), p("uint64_t", "ei_base", "Event-index buffer address.")], "Enable shadow doorbells to reduce MMIO traffic.", { returns: "HalStatus::Ok on success." }) },
      { cls: "NvmeHal", fn: fn(HS, "SetInterruptCoalescing", [p("uint8_t", "threshold", "Aggregation threshold."), p("uint8_t", "time", "Aggregation time, 100µs units.")], "Configure completion interrupt coalescing.", { returns: "HalStatus::Ok on success." }) },
    ],
  }),

  pcie: (sub) => ({
    file: `${sub}/pcie_hal.h`,
    brief: "PCIe Gen5 link hardware abstraction layer.",
    classes: [
      {
        name: "PcieHal",
        brief: "PCIe link bring-up, speed/width management and error reporting.",
        fns: [
          fn(HS, "Init", [p("const PcieConfig&", "config", "Target speed, width and ASPM policy.")], "Initialize the PCIe controller and PHY.", { returns: "HalStatus::Ok once the link reaches L0." }),
          fn(HS, "Retrain", [], "Force a link retrain.", { returns: "HalStatus::Ok once retraining completes.", warnings: ["Traffic is briefly quiesced during retraining."] }),
          fn(HS, "SetSpeed", [p("PcieSpeed", "speed", "Target link speed (Gen1-Gen5).")], "Change the target link speed.", { returns: "HalStatus::Ok on success." }),
          fn("PcieLinkStatus", "GetLinkStatus", [], "Read negotiated link speed/width and up state.", { isConst: true, returns: "Snapshot of LINK_STAT." }),
          fn("uint8_t", "GetLtssmState", [], "Read the current LTSSM state.", { isConst: true, returns: "LTSSM state code." }),
          fn(HS, "ConfigureEqualization", [p("const EqConfig&", "eq", "Equalization presets and phase bypass.")], "Configure Gen4/5 equalization.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "ClearErrors", [], "Clear latched AER error status.", { returns: "HalStatus::Ok on success." }),
        ],
      },
    ],
    fnPool: [
      { cls: "PcieHal", fn: fn(HS, "EnableL1Substates", [p("bool", "enable", "Enable L1.1/L1.2 sub-states.")], "Toggle L1 power sub-states.", { returns: "HalStatus::Ok on success." }) },
      { cls: "PcieHal", fn: fn(HS, "RunLaneMargining", [p("uint8_t", "lane", "Lane under test."), p("MarginResult*", "result", "Output margin result.")], "Run receiver lane margining.", { returns: "HalStatus::Ok on success." }) },
    ],
  }),

  hdma: (sub) => ({
    file: `${sub}/host_dma_hal.h`,
    brief: "Host DMA hardware abstraction layer.",
    classes: [
      {
        name: "HostDmaHal",
        brief: "Host-side PRP/SGL data-mover driver.",
        fns: [
          fn(HS, "Init", [p("uint64_t", "desc_base", "Descriptor ring base address.")], "Initialize the host DMA engine.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "SetDescriptorMode", [p("DmaDescMode", "mode", "PRP or SGL descriptor mode.")], "Select the descriptor format.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "StartChannel", [p("uint8_t", "ch", "Channel index.")], "Arm and start a channel.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "AbortChannel", [p("uint8_t", "ch", "Channel index.")], "Abort a running channel.", { returns: "HalStatus::Ok on success." }),
          fn("DmaChannelStatus", "GetChannelStatus", [p("uint8_t", "ch", "Channel index.")], "Read per-channel status.", { isConst: true, returns: "Snapshot of CH_STAT." }),
          fn(HS, "RegisterCallback", [p("DmaCallback", "cb", "Completion callback invoked from interrupt context.")], "Register a completion callback.", { returns: "HalStatus::Ok on success." }),
        ],
      },
    ],
    fnPool: [
      { cls: "HostDmaHal", fn: fn(HS, "SetCoalescing", [p("uint8_t", "count", "Completions per interrupt.")], "Configure completion coalescing.", { returns: "HalStatus::Ok on success." }) },
      { cls: "HostDmaHal", fn: fn("uint64_t", "GetThroughput", [], "Read the throughput performance counter.", { isConst: true, returns: "Bytes transferred since the last clear." }) },
    ],
  }),

  nandc: (sub) => ({
    file: `${sub}/nand_hal.h`,
    brief: "NAND flash channel hardware abstraction layer.",
    classes: [
      {
        name: "NandHal",
        brief: "NAND channel driver: timing setup and sequenced page operations.",
        fns: [
          fn(HS, "Init", [p("const NandConfig&", "config", "Channel count, interface mode and timing.")], "Initialize the NAND channels.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "SetTimingMode", [p("uint8_t", "ch", "Channel index."), p("NandTimingMode", "mode", "ONFI/Toggle timing mode.")], "Configure a channel's timing mode.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "ResetTarget", [p("uint8_t", "ch", "Channel index."), p("uint8_t", "ce", "Chip-enable index.")], "Issue a reset to a NAND target.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "ReadPage", [p("const NandAddr&", "addr", "Block/page/plane address."), p("uint8_t*", "data", "Output buffer."), p("uint8_t*", "meta", "Output metadata buffer.")], "Read a page through the sequencer with ECC.", { returns: "HalStatus::Ok, HalStatus::EccFail on uncorrectable data.", notes: ["Data is routed through the LDPC engine when AUTO_ECC is set."] }),
          fn(HS, "ProgramPage", [p("const NandAddr&", "addr", "Block/page/plane address."), p("const uint8_t*", "data", "Page data."), p("const uint8_t*", "meta", "Page metadata.")], "Program a page through the sequencer.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "EraseBlock", [p("const NandAddr&", "addr", "Block address.")], "Erase a block.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "SetFeature", [p("uint8_t", "ch", "Channel index."), p("uint8_t", "addr", "Feature address."), p("uint32_t", "value", "Feature value.")], "Issue an ONFI set-feature.", { returns: "HalStatus::Ok on success." }),
          fn("NandStatus", "GetStatus", [p("uint8_t", "ch", "Channel index.")], "Read channel status.", { isConst: true, returns: "Snapshot of the channel STAT register." }),
        ],
      },
    ],
    fnPool: [
      { cls: "NandHal", fn: fn(HS, "ReadPageMultiPlane", [p("const NandAddr&", "addr", "Base address."), p("uint8_t", "planes", "Plane bitmap."), p("uint8_t*", "data", "Output buffer.")], "Multi-plane page read.", { returns: "HalStatus::Ok on success." }) },
      { cls: "NandHal", fn: fn(HS, "SetRandomizerSeed", [p("uint16_t", "seed", "Per-page randomizer seed.")], "Program the data-randomizer seed.", { returns: "HalStatus::Ok on success." }) },
      { cls: "NandHal", fn: fn(HS, "RunZqCalibration", [p("uint8_t", "ch", "Channel index.")], "Run channel ZQ calibration.", { returns: "HalStatus::Ok on success." }) },
    ],
  }),

  ecc: (sub) => ({
    file: `${sub}/ecc_hal.h`,
    brief: "ECC engine hardware abstraction layer (LDPC + BCH).",
    classes: [
      {
        name: "LdpcHal",
        brief: "LDPC codec driver with hard/soft-decision decoding.",
        fns: [
          fn(HS, "Init", [p("const LdpcConfig&", "config", "Code rate, frame geometry and iteration limits.")], "Initialize the LDPC engine.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "SetCodeRate", [p("LdpcRate", "rate", "Code-rate index.")], "Select the active code rate.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "Decode", [p("const uint8_t*", "codeword", "Input codeword."), p("uint8_t*", "data", "Decoded data output."), p("LdpcResult*", "result", "Decode result (iterations, bit errors).")], "Hard-decision decode of a codeword.", { returns: "HalStatus::Ok, HalStatus::EccFail if uncorrectable." }),
          fn(HS, "DecodeSoft", [p("const int8_t*", "llr", "Input LLR values."), p("uint8_t*", "data", "Decoded data output."), p("LdpcResult*", "result", "Decode result.")], "Soft-decision decode using LLR inputs.", { returns: "HalStatus::Ok, HalStatus::EccFail if uncorrectable.", notes: ["Used after hard-decision decoding fails; requires soft read-retry data."] }),
          fn(HS, "Encode", [p("const uint8_t*", "data", "Input data."), p("uint8_t*", "codeword", "Output codeword.")], "Encode a data block.", { returns: "HalStatus::Ok on success." }),
          fn("uint32_t", "GetLastBitErrors", [], "Read the corrected bit-error count of the last codeword.", { isConst: true, returns: "Corrected bit errors." }),
        ],
      },
      {
        name: "BchHal",
        brief: "BCH codec driver for metadata and boot regions.",
        fns: [
          fn(HS, "Init", [p("uint8_t", "strength", "Correctable bits per codeword.")], "Initialize the BCH engine.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "Decode", [p("const uint8_t*", "block", "Input block."), p("uint8_t*", "data", "Decoded output.")], "Decode a BCH block.", { returns: "HalStatus::Ok, HalStatus::EccFail if uncorrectable." }),
          fn(HS, "Encode", [p("const uint8_t*", "data", "Input data."), p("uint8_t*", "block", "Output block.")], "Encode a BCH block.", { returns: "HalStatus::Ok on success." }),
        ],
      },
    ],
    fnPool: [
      { cls: "LdpcHal", fn: fn(HS, "ReadFlipHistogram", [p("uint16_t*", "bins", "Output histogram bins."), p("size_t", "count", "Number of bins.")], "Read the bit-flip histogram for read-level tracking.", { isConst: true, returns: "HalStatus::Ok on success." }) },
      { cls: "LdpcHal", fn: fn(HS, "SetReadRetryLevels", [p("uint8_t", "levels", "Number of soft read-retry levels.")], "Configure soft read-retry depth.", { returns: "HalStatus::Ok on success." }) },
    ],
  }),

  fdma: (sub) => ({
    file: `${sub}/flash_dma_hal.h`,
    brief: "Flash DMA hardware abstraction layer.",
    classes: [
      {
        name: "FlashDmaHal",
        brief: "Data-mover driver between NAND channels, ECC and buffers.",
        fns: [
          fn(HS, "Init", [], "Initialize the flash DMA engine.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "Transfer", [p("const FdmaDesc&", "desc", "Source, destination, length and direction.")], "Run a blocking transfer.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "TransferAsync", [p("const FdmaDesc&", "desc", "Transfer descriptor."), p("FdmaCallback", "cb", "Completion callback.")], "Start a non-blocking transfer.", { returns: "HalStatus::Ok if queued.", warnings: ["Buffers must remain valid until completion."] }),
          fn("FdmaStatus", "GetStatus", [p("uint8_t", "ch", "Channel index.")], "Read channel status.", { isConst: true, returns: "Snapshot of STAT." }),
        ],
      },
    ],
    fnPool: [
      { cls: "FlashDmaHal", fn: fn(HS, "EnableXor", [p("uint64_t", "xor_buf", "XOR accumulation buffer address.")], "Enable inline XOR accumulation for RAID rebuild.", { returns: "HalStatus::Ok on success." }) },
    ],
  }),

  ddrc: (sub) => ({
    file: `${sub}/ddr_hal.h`,
    brief: "DRAM controller hardware abstraction layer.",
    classes: [
      {
        name: "DdrHal",
        brief: "DRAM cache controller driver: bring-up, mode registers and calibration.",
        fns: [
          fn(HS, "Init", [p("const DdrConfig&", "config", "DRAM type, geometry and timing.")], "Initialize and train the DRAM interface.", { returns: "HalStatus::Ok once initialization completes.", notes: ["Runs write-leveling and DQ calibration before returning."] }),
          fn(HS, "WriteModeRegister", [p("uint8_t", "rank", "Target rank."), p("uint8_t", "mr", "Mode register index."), p("uint32_t", "value", "Payload.")], "Issue a mode-register write.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "SetRefreshRate", [p("uint16_t", "trefi", "Average refresh interval in clocks.")], "Adjust the refresh interval (e.g. for temperature).", { returns: "HalStatus::Ok on success." }),
          fn(HS, "RunZqCalibration", [], "Run a ZQ calibration cycle.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "EnterSelfRefresh", [], "Place the DRAM into self-refresh.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "ExitSelfRefresh", [], "Bring the DRAM out of self-refresh.", { returns: "HalStatus::Ok on success." }),
          fn("DdrStatus", "GetStatus", [], "Read controller status.", { isConst: true, returns: "Snapshot of STAT." }),
        ],
      },
    ],
    fnPool: [
      { cls: "DdrHal", fn: fn(HS, "EnableScrubbing", [p("uint32_t", "period_ms", "Scrub period in milliseconds.")], "Enable background ECC scrubbing.", { returns: "HalStatus::Ok on success." }) },
      { cls: "DdrHal", fn: fn(HS, "ReadEccStats", [p("DdrEccStats*", "stats", "Output ECC counters.")], "Read inline-ECC statistics.", { isConst: true, returns: "HalStatus::Ok on success." }) },
    ],
  }),

  sbm: (sub) => ({
    file: `${sub}/buffer_hal.h`,
    brief: "SRAM buffer manager hardware abstraction layer.",
    classes: [
      {
        name: "BufferHal",
        brief: "On-chip buffer-pool allocator driver.",
        fns: [
          fn(HS, "Init", [p("const BufferPoolConfig&", "config", "Block size and pool depth.")], "Initialize the buffer pool.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "Alloc", [p("uint8_t", "count", "Blocks to allocate."), p("uint16_t*", "token", "Output allocation token.")], "Allocate buffer blocks.", { returns: "HalStatus::Ok, HalStatus::NoSpace if the pool is exhausted." }),
          fn(HS, "Free", [p("uint16_t", "token", "Allocation token to release.")], "Free a previous allocation.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "SetWatermarks", [p("uint16_t", "low", "Low watermark."), p("uint16_t", "high", "High watermark.")], "Configure backpressure watermarks.", { returns: "HalStatus::Ok on success." }),
          fn("uint16_t", "GetFreeBlocks", [], "Read the number of free blocks.", { isConst: true, returns: "Free block count." }),
        ],
      },
    ],
    fnPool: [
      { cls: "BufferHal", fn: fn(HS, "SetPartition", [p("uint16_t", "host_blocks", "Blocks reserved for the host path.")], "Partition the pool between host and media paths.", { returns: "HalStatus::Ok on success." }) },
    ],
  }),

  aes: (sub) => ({
    file: `${sub}/crypto_hal.h`,
    brief: "AES-XTS engine hardware abstraction layer (SED/Opal).",
    classes: [
      {
        name: "AesXtsHal",
        brief: "Inline AES-XTS media-encryption driver with hardware key slots.",
        fns: [
          fn(HS, "Init", [], "Initialize the AES-XTS engine.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "LoadKey", [p("uint8_t", "slot", "Key slot index.")], "Load a key from the secure key store into the working register.", { returns: "HalStatus::Ok, HalStatus::Locked if the slot is locked.", notes: ["Raw key material never crosses the register bus."] }),
          fn(HS, "SetSectorSize", [p("uint32_t", "bytes", "XTS data-unit size in bytes.")], "Configure the XTS sector size.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "Enable", [p("bool", "enable", "True to enable inline encryption.")], "Enable or bypass the inline cipher.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "BindLockingRange", [p("uint8_t", "range", "Opal locking-range index."), p("uint8_t", "slot", "Key slot bound to the range.")], "Bind a key slot to a TCG Opal locking range.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "CryptoErase", [p("uint8_t", "slot", "Key slot to erase.")], "Crypto-erase a key slot.", { returns: "HalStatus::Ok on success.", warnings: ["Data encrypted with this key becomes permanently unrecoverable."] }),
          fn("AesXtsStatus", "GetStatus", [], "Read engine status.", { isConst: true, returns: "Snapshot of STAT." }),
        ],
      },
    ],
    fnPool: [
      { cls: "AesXtsHal", fn: fn(HS, "SetLockState", [p("uint8_t", "range", "Locking-range index."), p("bool", "read_lock", "Read-lock state."), p("bool", "write_lock", "Write-lock state.")], "Set the read/write lock state of a range.", { returns: "HalStatus::Ok on success." }) },
    ],
  }),

  thermal: (sub) => ({
    file: `${sub}/thermal_hal.h`,
    brief: "Thermal sensor and throttling hardware abstraction layer.",
    classes: [
      {
        name: "ThermalHal",
        brief: "Die-temperature monitoring and automatic throttling driver.",
        fns: [
          fn(HS, "Init", [p("const ThermalConfig&", "config", "Sampling rate and thresholds.")], "Initialize thermal monitoring.", { returns: "HalStatus::Ok on success." }),
          fn("int16_t", "ReadTemperature", [], "Read the current die temperature.", { isConst: true, returns: "Temperature in 0.0625°C units." }),
          fn(HS, "SetThresholds", [p("int16_t", "warn", "Warning threshold."), p("int16_t", "crit", "Critical threshold.")], "Configure warning/critical thresholds.", { returns: "HalStatus::Ok on success." }),
          fn(HS, "ConfigureThrottle", [p("const ThrottleConfig&", "config", "Per-level throughput caps and hysteresis.")], "Configure the throttling policy.", { returns: "HalStatus::Ok on success." }),
          fn("ThrottleLevel", "GetThrottleLevel", [], "Read the active throttle level.", { isConst: true, returns: "Current throttle level." }),
          fn(HS, "RegisterCallback", [p("ThermalCallback", "cb", "Invoked on threshold crossings.")], "Register a thermal-event callback.", { returns: "HalStatus::Ok on success." }),
        ],
      },
    ],
    fnPool: [
      { cls: "ThermalHal", fn: fn("int16_t", "GetPeakTemperature", [], "Read the peak temperature since reset.", { isConst: true, returns: "Peak temperature." }) },
    ],
  }),
};
