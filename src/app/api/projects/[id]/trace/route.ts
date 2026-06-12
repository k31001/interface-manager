import { handle } from "@/lib/api";
import { requireProject } from "@/lib/config";
import { loadTrace } from "@/lib/trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ref = new URL(req.url).searchParams.get("ref");
  return handle(() => loadTrace(requireProject(id), ref));
}
