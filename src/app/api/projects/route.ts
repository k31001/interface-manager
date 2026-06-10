import { handle } from "@/lib/api";
import { readConfig } from "@/lib/config";
import { commitCount, listTags, recentCommits, resolveRepoDir } from "@/lib/git";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const cfg = readConfig();
    const projects = await Promise.all(
      cfg.projects.map(async (p) => {
        try {
          const dir = await resolveRepoDir(p);
          const [tags, commits, last] = await Promise.all([listTags(dir), commitCount(dir), recentCommits(dir, 1)]);
          return {
            ...p,
            status: "ok" as const,
            tagCount: tags.length,
            latestTag: tags[tags.length - 1]?.name ?? null,
            commitCount: commits,
            lastCommit: last[0] ?? null,
          };
        } catch (err) {
          return {
            ...p,
            status: "error" as const,
            error: err instanceof Error ? err.message : String(err),
            tagCount: 0,
            latestTag: null,
            commitCount: 0,
            lastCommit: null,
          };
        }
      })
    );
    return { projects };
  });
}
