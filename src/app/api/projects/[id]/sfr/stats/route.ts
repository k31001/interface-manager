import { handle } from "@/lib/api";
import { requireProject } from "@/lib/config";
import { computeSfrStats } from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const baseline = new URL(req.url).searchParams.get("baseline") ?? undefined;
    return computeSfrStats(requireProject(id), baseline);
  });
}
