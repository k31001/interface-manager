import { ndjsonStream } from "@/lib/api";
import { requireProject } from "@/lib/config";
import { computeSfrStats } from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const baseline = new URL(req.url).searchParams.get("baseline") ?? undefined;
  return ndjsonStream(async (emit) => {
    const p = requireProject(id);
    emit({ type: "phase", phase: "loading", label: "computing reuse statistics" });
    return computeSfrStats(p, baseline, (done, total, label) =>
      emit({ type: "progress", phase: "tags", done, total, label: `tag ${label}` })
    );
  });
}
