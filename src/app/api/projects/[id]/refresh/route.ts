import { handle } from "@/lib/api";
import { invalidateAll } from "@/lib/cache";
import { requireProject } from "@/lib/config";
import { resolveRepoDir } from "@/lib/git";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const p = requireProject(id);
    await resolveRepoDir(p, { fetch: true });
    invalidateAll();
    return { ok: true };
  });
}
