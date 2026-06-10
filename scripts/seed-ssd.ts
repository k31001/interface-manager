/**
 * Generates the "Pulsar" SSD-controller demo as a standalone git repository
 * with ~8 months of plausible commit history, intended to be pushed to GitHub
 * and registered in Interface Manager as a remote test project.
 *
 *   Pulsar (AUR-P9100) — flagship PCIe Gen5 / NVMe 2.0 enterprise SSD controller.
 *   Imported from the previous-gen Polaris (Gen4) platform; one major incident
 *   when the media path is migrated to BiCS8 NAND.
 *
 * Run: npm run seed:ssd            -> writes to ../pulsar (sibling of this repo)
 *      npm run seed:ssd -- <dir>   -> writes to <dir>
 */
import { resolve } from "node:path";
import { HAL_LIB, type HalTypesFn, IP_LIB, type ProjectPlan, seedProject } from "./seedlib";
import { SSD_HAL_LIB, SSD_IP_LIB } from "./ssd-ip";

const outDir = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(process.cwd(), "..", "pulsar");

// Combined library: SSD blocks + reused standard peripherals.
const ipLib = { ...IP_LIB, ...SSD_IP_LIB };
const halLib = { ...HAL_LIB, ...SSD_HAL_LIB };

const HAL_TYPES: HalTypesFn = (ns, project) => `// hal_types.h — shared HAL types
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
  EccFail = -6,
  NoSpace = -7,
  CryptoErr = -8,
  Unsupported = -9,
};

// Forward declarations of configuration/status aggregates. Full definitions
// live in the platform configuration headers.
struct NvmeConfig;
struct QueueConfig;
struct ArbConfig;
struct NvmeStatus;
struct PcieConfig;
struct PcieLinkStatus;
struct EqConfig;
struct MarginResult;
struct NandConfig;
struct NandAddr;
struct NandStatus;
struct LdpcConfig;
struct LdpcResult;
struct FdmaDesc;
struct FdmaStatus;
struct DdrConfig;
struct DdrStatus;
struct DdrEccStats;
struct BufferPoolConfig;
struct ThrottleConfig;
struct ThermalConfig;
struct AesXtsStatus;
struct DmaChannelStatus;
struct UartConfig;
struct I2cConfig;
struct TimerConfig;
struct PwmConfig;
struct WdtConfig;

using DmaCallback = void (*)(HalStatus, uint8_t);
using FdmaCallback = void (*)(HalStatus, uint8_t);
using ThermalCallback = void (*)(HalStatus, int16_t);
using UartCallback = void (*)(HalStatus, size_t);

}  // namespace ${ns}::hal
`;

const README = `# Pulsar (AUR-P9100) — SSD controller interface tree

Hardware/software interface definitions for the **Pulsar** PCIe Gen5 / NVMe 2.0
enterprise SSD controller, imported from the previous-generation **Polaris (Gen4)**
platform and maintained by the platform team.

- \`rdl/\`         — SystemRDL register descriptions, laid out as
  \`pulsar/<subsystem>/<ip>/<module>.rdl\`.
- \`hal/include/\` — C++ HAL headers with Doxygen API documentation.

## Subsystems

| Subsystem | IPs |
| --- | --- |
| host-subsystem    | \`nvme\` (NVMe controller), \`pcie\` (Gen5 link + PHY), \`hdma\` (host DMA) |
| media-subsystem   | \`nandc\` (NAND channel + sequencer), \`ecc\` (LDPC + BCH), \`fdma\` (flash DMA) |
| memory-subsystem  | \`ddrc\` (DRAM cache controller + PHY), \`sbm\` (SRAM buffer manager) |
| security-subsystem| \`aes\` (AES-XTS for TCG Opal / SED), \`otp\` (key fuses) |
| platform-subsystem| \`uart\`, \`i2c\`, \`gpio\`, \`timer\`, \`wdt\` |
| power-subsystem   | \`pmu\`, \`clkgen\`, \`thermal\` |

## Using with Interface Manager

Register this repository in Interface Manager → Settings:

- **git repository**: this repo's URL (or a local path)
- **rdl directory**: \`rdl\`
- **hal directory**: \`hal/include\`
- **statistics baseline**: \`v0.1.0\` (initial Polaris import)

Tags track the program from initial import to the A0 tapeout SFR freeze.
`;

const PULSAR: ProjectPlan = {
  id: "pulsar",
  name: "Pulsar",
  codename: "AUR-P9100",
  description:
    "Flagship PCIe Gen5 / NVMe 2.0 enterprise SSD controller. Imported from the Polaris Gen4 platform; media path re-architected for BiCS8 NAND.",
  system: "pulsar",
  ns: "pulsar",
  t0: "2025-10-06", // Monday, ~8 months before the freeze
  seed: 0x5d_b007,
  outDir,
  halTypes: HAL_TYPES,
  readme: README,
  authors: [
    { name: "Seungwoo Bae", email: "seungwoo.bae@auriga-semi.com" },
    { name: "Hana Jeong", email: "hana.jeong@auriga-semi.com" },
    { name: "Taeyang Noh", email: "taeyang.noh@auriga-semi.com" },
    { name: "Eunji Seo", email: "eunji.seo@auriga-semi.com" },
    { name: "Wonjae Lim", email: "wonjae.lim@auriga-semi.com" },
    { name: "Ariel Kovac", email: "ariel.kovac@auriga-semi.com" },
  ],
  roster: [
    { subsystem: "host-subsystem", ips: ["nvme", "pcie", "hdma"] },
    { subsystem: "media-subsystem", ips: ["nandc", "ecc", "fdma"] },
    { subsystem: "memory-subsystem", ips: ["ddrc", "sbm"] },
    { subsystem: "security-subsystem", ips: ["aes", "otp"] },
    { subsystem: "platform-subsystem", ips: ["uart", "i2c", "gpio", "timer", "wdt"] },
    { subsystem: "power-subsystem", ips: ["pmu", "clkgen", "thermal"] },
  ],
  tags: [
    { name: "v0.1.0", week: 0, sfr: 100, hal: 100, msg: "Initial SFR/HAL import from Polaris Gen4 (AUR-P7400) platform baseline" },
    { name: "v0.2.0", week: 3, sfr: 97.5, hal: 98.5, msg: "M1 — PCIe Gen5 link bring-up and equalization tuning" },
    { name: "v0.3.0", week: 6, sfr: 95, hal: 96.5, msg: "M2 — NVMe 2.0 admin command set alignment" },
    { name: "v0.4.0", week: 9, sfr: 92.5, hal: 94, msg: "M3 — LDPC decoder throughput and read-retry tuning" },
    {
      name: "v0.5.0", week: 13, sfr: 82, hal: 85,
      msg: "MEDIA-REWORK — BiCS8 NAND migration: channel timing, sequencer and ECC frame geometry re-architected (program pivot)",
      theme: ["nandc", "ecc", "fdma"],
    },
    { name: "v0.6.0", week: 16, sfr: 80, hal: 83.5, msg: "M4 — post-migration media stabilization" },
    { name: "v0.7.0", week: 19, sfr: 78.5, hal: 82, msg: "M5 — DRAM cache controller DDR5 enablement" },
    { name: "v0.8.0", week: 22, sfr: 77, hal: 80.5, msg: "M6 — SED/Opal crypto path hardening" },
    { name: "v0.9.0", week: 25, sfr: 75.5, hal: 79, msg: "M7 — thermal throttling policy rework" },
    { name: "v0.10.0", week: 28, sfr: 74.5, hal: 78, msg: "M8 — power-state and host-DMA latency optimization" },
    { name: "v0.11.0", week: 31, sfr: 73.5, hal: 77, msg: "M9 — pre-freeze cleanup and CR alignment" },
    { name: "v1.0.0", week: 34, sfr: 72.5, hal: 76, msg: "SFR freeze for A0 tapeout" },
  ],
  opsPerWeek: 1.5,
};

console.log(`Seeding Pulsar SSD-controller repo → ${outDir}\n`);
const summary = seedProject(PULSAR, ipLib, halLib);
console.log(`
Done. To publish:

  cd ${outDir}
  git remote add origin <your-github-repo-url>
  git push -u origin main --tags

Then in Interface Manager → Settings, add a project:
  repo            = <your-github-repo-url>   (or ${outDir})
  rdl directory   = rdl
  hal directory   = hal/include
  baseline        = v0.1.0
`);

void summary;
