import { handle } from "@/lib/api";
import { repoFor, requireProject } from "@/lib/config";
import { listTags, resolveRepoDir } from "@/lib/git";
import type { InterfaceKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const p = requireProject(id);
    const kind: InterfaceKind = new URL(req.url).searchParams.get("kind") === "hal" ? "hal" : "sfr";
    const dir = await resolveRepoDir(repoFor(p, kind));
    const tags = await listTags(dir);
    return { tags };
  });
}
