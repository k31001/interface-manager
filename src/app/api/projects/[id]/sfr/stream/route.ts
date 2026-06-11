import { ndjsonStream } from "@/lib/api";
import { requireProject } from "@/lib/config";
import { loadSfr } from "@/lib/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ref = new URL(req.url).searchParams.get("ref");
  return ndjsonStream(async (emit) => {
    const p = requireProject(id);
    emit({ type: "phase", phase: "loading", label: "reading SystemRDL" });
    return loadSfr(p, ref, (done, total, label) => emit({ type: "progress", phase: "parse", done, total, label }));
  });
}
