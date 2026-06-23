import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

// App version + build identity, resolved at build time and exposed to the client
// as NEXT_PUBLIC_* so the sidebar/settings can show "v0.1.0 · a1b2c3d". Git data
// is best-effort — falls back gracefully when git or .git is unavailable.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version?: string };

function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version ?? "0.0.0",
    NEXT_PUBLIC_GIT_SHA: git("rev-parse --short HEAD"),
    NEXT_PUBLIC_BUILD_DATE: new Date().toISOString().slice(0, 10),
  },
};

export default nextConfig;
