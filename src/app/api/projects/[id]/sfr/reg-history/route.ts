import { handle, jsonErr } from "@/lib/api";
import { requireProject } from "@/lib/config";
import { regHistory } from "@/lib/history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  const path = sp.get("path");
  const reg = sp.get("reg");
  if (!path || !reg) return jsonErr("path and reg are required", 400);
  return handle(() => regHistory(requireProject(id), path, reg));
}
