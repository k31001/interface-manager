import { handle } from "@/lib/api";
import { readConfig, repoFor } from "@/lib/config";
import { commitCount, listTags, recentCommits, resolveRepoDir } from "@/lib/git";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const cfg = readConfig();
    const projects = await Promise.all(
      cfg.projects.map(async (p) => {
        try {
          const sfrRepo = repoFor(p, "sfr");
          const halRepo = repoFor(p, "hal");
          const dir = await resolveRepoDir(sfrRepo);
          const [tags, commits, last] = await Promise.all([listTags(dir), commitCount(dir), recentCommits(dir, 1)]);
          // surface HAL-repo status only when it differs from the SFR repo
          let halStatus: { repo: string; tagCount: number; latestTag: string | null } | null = null;
          if (halRepo !== sfrRepo) {
            try {
              const hdir = await resolveRepoDir(halRepo);
              const htags = await listTags(hdir);
              halStatus = { repo: halRepo, tagCount: htags.length, latestTag: htags[htags.length - 1]?.name ?? null };
            } catch {
              halStatus = { repo: halRepo, tagCount: 0, latestTag: null };
            }
          }
          return {
            ...p,
            status: "ok" as const,
            tagCount: tags.length,
            latestTag: tags[tags.length - 1]?.name ?? null,
            commitCount: commits,
            lastCommit: last[0] ?? null,
            halStatus,
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
