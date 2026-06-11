import { handle } from "@/lib/api";
import { requireProject } from "@/lib/config";
import { diffHal } from "@/lib/diff";
import { loadHal, projectTags } from "@/lib/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const p = requireProject(id);
    const sp = new URL(req.url).searchParams;
    let from = sp.get("from");
    let to = sp.get("to");
    if (!from || !to) {
      const tags = await projectTags(p, "hal");
      to = to || tags[tags.length - 1]?.name || "HEAD";
      const toIdx = tags.findIndex((t) => t.name === to);
      from = from || (toIdx > 0 ? tags[toIdx - 1].name : tags[0]?.name || "HEAD");
    }
    const [a, b] = await Promise.all([loadHal(p, from), loadHal(p, to)]);
    return diffHal(a, b);
  });
}
