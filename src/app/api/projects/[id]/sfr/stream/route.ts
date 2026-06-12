import { ndjsonStream } from "@/lib/api";
import { repoFor, requireProject } from "@/lib/config";
import { resolveRepoDir } from "@/lib/git";
import { loadSfr } from "@/lib/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ref = new URL(req.url).searchParams.get("ref");
  return ndjsonStream(async (emit) => {
    const p = requireProject(id);
    // surface the one-time network clone so the first load doesn't look frozen
    await resolveRepoDir(repoFor(p, "sfr"), { onClone: () => emit({ type: "phase", phase: "clone", label: "cloning repository (first load)…" }) });
    emit({ type: "phase", phase: "loading", label: "reading SystemRDL" });
    return loadSfr(p, ref, (done, total, label) => emit({ type: "progress", phase: "parse", done, total, label }));
  });
}
