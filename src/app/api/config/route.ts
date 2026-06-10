import { handle, jsonErr, jsonOk } from "@/lib/api";
import { invalidateAll } from "@/lib/cache";
import { readConfig, writeConfig } from "@/lib/config";
import type { AppConfig, ProjectConfig } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => readConfig());
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as AppConfig;
    if (!Array.isArray(body.projects)) return jsonErr("projects must be an array", 400);
    for (const p of body.projects as ProjectConfig[]) {
      if (!p.id || !/^[a-z0-9-]+$/.test(p.id)) return jsonErr(`invalid project id: ${p.id}`, 400);
      if (!p.repo) return jsonErr(`project ${p.id}: repo is required`, 400);
      p.rdlDir = p.rdlDir || "rdl";
      p.halDir = p.halDir || "hal/include";
      p.baseline = p.baseline || "v0.1.0";
      p.warnThresholdPct = Number(p.warnThresholdPct) || 4;
    }
    writeConfig(body);
    invalidateAll();
    return jsonOk({ ok: true });
  } catch (err) {
    return jsonErr(err);
  }
}
