import { handle } from "@/lib/api";
import { requireProject } from "@/lib/config";
import { loadHal } from "@/lib/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const ref = new URL(req.url).searchParams.get("ref");
    return loadHal(requireProject(id), ref);
  });
}
