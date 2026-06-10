import { handle } from "@/lib/api";
import { requireProject } from "@/lib/config";
import { listTags, resolveRepoDir } from "@/lib/git";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const p = requireProject(id);
    const dir = await resolveRepoDir(p);
    const tags = await listTags(dir);
    return { tags };
  });
}
