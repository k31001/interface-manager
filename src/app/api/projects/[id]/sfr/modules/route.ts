import { handle, jsonErr } from "@/lib/api";
import { requireProject } from "@/lib/config";
import { loadSfrModules } from "@/lib/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET …/sfr/modules?ref=<tag>&paths=<enc>,<enc>  → SfrModule[] (one IP's maps, on demand)
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const ref = url.searchParams.get("ref");
  const pathsParam = url.searchParams.get("paths");
  if (!pathsParam) return jsonErr("paths query param is required", 400);
  const paths = pathsParam.split(",").map((s) => decodeURIComponent(s)).filter(Boolean);
  return handle(() => loadSfrModules(requireProject(id), ref, paths));
}
