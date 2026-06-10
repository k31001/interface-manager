import { handle } from "@/lib/api";
import { search } from "@/lib/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const q = new URL(req.url).searchParams.get("q") ?? "";
    return { hits: await search(q) };
  });
}
