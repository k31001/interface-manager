/**
 * Generates the two bundled demo projects as real git repositories with
 * ~6 months of plausible commit history, tags, and one "incident" tag each.
 *
 *   Helios — flagship AP, aggressive redesign  -> low SFR/HAL reuse
 *   Selene — cost-optimized derivative         -> high SFR/HAL reuse
 *
 * Run: npm run seed
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HAL_LIB, IP_LIB, type ProjectPlan, seedProject } from "./seedlib";

const ROOT = process.cwd();

const HELIOS: ProjectPlan = {
  id: "helios",
  name: "Helios",
  codename: "AUR-H5000",
  description: "Next-gen flagship application processor. Aggressive re-architecture on top of the Titan platform.",
  system: "helios",
  ns: "helios",
  t0: "2025-09-08",
  seed: 0xc0ffee,
  authors: [
    { name: "Jihoon Park", email: "jihoon.park@auriga-semi.com" },
    { name: "Minseo Kim", email: "minseo.kim@auriga-semi.com" },
    { name: "Hyunwoo Lee", email: "hyunwoo.lee@auriga-semi.com" },
    { name: "Sora Yoon", email: "sora.yoon@auriga-semi.com" },
    { name: "Daniel Chung", email: "daniel.chung@auriga-semi.com" },
  ],
  roster: [
    { subsystem: "backbone-subsystem", ips: ["uart", "i2c", "spi", "dma"] },
    { subsystem: "peripheral-subsystem", ips: ["gpio", "timer", "wdt", "rtc"] },
    { subsystem: "security-subsystem", ips: ["crypto", "otp", "trng"] },
  ],
  tags: [
    { name: "v0.1.0", week: 0, sfr: 100, hal: 100, msg: "Initial SFR/HAL import from Titan v1.0 platform baseline" },
    { name: "v0.2.0", week: 3, sfr: 96.5, hal: 98, msg: "M1 — bring-up feedback: UART/I2C parameter tuning" },
    { name: "v0.3.0", week: 6, sfr: 93.5, hal: 95.5, msg: "M2 — DMA channel scaling for NPU traffic" },
    { name: "v0.4.0", week: 10, sfr: 90.5, hal: 92.5, msg: "M3 — peripheral consolidation and timer rework" },
    {
      name: "v0.5.0", week: 13, sfr: 79, hal: 83,
      msg: "SEC-ARCH — security architecture overhaul: secure-boot key ladder and DMA isolation rework (CISO directive)",
      theme: ["crypto", "otp", "trng", "dma"],
    },
    { name: "v0.6.0", week: 17, sfr: 76, hal: 80, msg: "M4 — post-overhaul stabilization" },
    { name: "v0.7.0", week: 20, sfr: 73.5, hal: 77.5, msg: "M5 — power/performance tuning pass" },
    { name: "v0.8.0", week: 23, sfr: 71, hal: 75.5, msg: "M6 — pre-freeze cleanup" },
    { name: "v1.0.0", week: 25, sfr: 69.5, hal: 74, msg: "SFR freeze for TO1 tapeout" },
  ],
  opsPerWeek: 1.6,
};

const SELENE: ProjectPlan = {
  id: "selene",
  name: "Selene",
  codename: "AUR-S3200",
  description: "Cost-optimized derivative SoC reusing the Luna v2.1 platform with minimal interface churn.",
  system: "selene",
  ns: "selene",
  t0: "2025-12-01",
  seed: 0x5e1e9e,
  authors: [
    { name: "Yuna Choi", email: "yuna.choi@auriga-semi.com" },
    { name: "Kyungho Shin", email: "kyungho.shin@auriga-semi.com" },
    { name: "Mira Han", email: "mira.han@auriga-semi.com" },
    { name: "Jaeyoung Oh", email: "jaeyoung.oh@auriga-semi.com" },
  ],
  roster: [
    { subsystem: "backbone-subsystem", ips: ["uart", "i2c", "spi", "dma"] },
    { subsystem: "peripheral-subsystem", ips: ["gpio", "timer", "wdt", "rtc"] },
    { subsystem: "power-subsystem", ips: ["pmu", "clkgen"] },
  ],
  tags: [
    { name: "v0.1.0", week: 0, sfr: 100, hal: 100, msg: "Initial SFR/HAL import from Luna v2.1 production baseline" },
    { name: "v0.2.0", week: 4, sfr: 99, hal: 99.5, msg: "M1 — bring-up: minor UART/GPIO trims" },
    { name: "v0.3.0", week: 8, sfr: 97.5, hal: 98.5, msg: "M2 — clock tree parameterization" },
    {
      name: "v0.4.0", week: 12, sfr: 92.5, hal: 95,
      msg: "PWR-REMAP — power island remap for the new PMIC (PMU/CLKGEN affected)",
      theme: ["pmu", "clkgen"],
    },
    { name: "v0.5.0", week: 16, sfr: 92, hal: 94.5, msg: "M3 — stabilization" },
    { name: "v0.6.0", week: 20, sfr: 91.5, hal: 94, msg: "M4 — RTL CR alignment" },
    { name: "v0.7.0", week: 24, sfr: 90.4, hal: 93.5, msg: "M5 — pre-freeze audit" },
    { name: "v0.8.0", week: 26, sfr: 89.2, hal: 93, msg: "SFR freeze candidate for MP" },
  ],
  opsPerWeek: 1.1,
};

console.log("Seeding demo repositories…\n");
seedProject(HELIOS, IP_LIB, HAL_LIB);
seedProject(SELENE, IP_LIB, HAL_LIB);

const config = {
  projects: [
    {
      id: "helios",
      name: "Helios",
      codename: HELIOS.codename,
      description: HELIOS.description,
      repo: "data/repos/helios",
      rdlDir: `rdl/${HELIOS.system}`,
      halDir: "hal/include",
      halSrcDir: "hal/src",
      baseline: "v0.1.0",
      warnThresholdPct: 4,
    },
    {
      id: "selene",
      name: "Selene",
      codename: SELENE.codename,
      description: SELENE.description,
      repo: "data/repos/selene",
      rdlDir: `rdl/${SELENE.system}`,
      halDir: "hal/include",
      halSrcDir: "hal/src",
      baseline: "v0.1.0",
      warnThresholdPct: 4,
    },
  ],
};
mkdirSync(join(ROOT, "data"), { recursive: true });
writeFileSync(join(ROOT, "data", "config.json"), JSON.stringify(config, null, 2) + "\n");
console.log("\n✓ data/config.json written");
