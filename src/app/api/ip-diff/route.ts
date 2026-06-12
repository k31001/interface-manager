import { handle, jsonErr } from "@/lib/api";
import { requireProject } from "@/lib/config";
import { commonIps, loadIpDiff } from "@/lib/ip-diff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const a = sp.get("a");
  const b = sp.get("b");
  const ip = sp.get("ip");
  if (!a || !b) return jsonErr("a and b project ids are required", 400);
  const pa = requireProject(a);
  const pb = requireProject(b);
  if (!ip) return handle(async () => ({ commonIps: await commonIps(pa, pb) }));
  return handle(() => loadIpDiff(pa, pb, ip));
}
