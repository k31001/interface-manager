import { ndjsonStream } from "@/lib/api";
import { repoFor, requireProject } from "@/lib/config";
import { resolveRepoDir } from "@/lib/git";
import { loadHal } from "@/lib/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ref = new URL(req.url).searchParams.get("ref");
  return ndjsonStream(async (emit) => {
    const p = requireProject(id);
    await resolveRepoDir(repoFor(p, "hal"), { onClone: () => emit({ type: "phase", phase: "clone", label: "cloning repository (first load)…" }) });
    emit({ type: "phase", phase: "loading", label: "reading HAL headers" });
    return loadHal(p, ref, (done, total, label) => emit({ type: "progress", phase: "parse", done, total, label }));
  });
}
