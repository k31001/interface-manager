import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import type { CommitInfo, ProjectConfig, TagInfo } from "./types";

const run = promisify(execFile);

async function git(repoDir: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", repoDir, ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

function isRemoteUrl(repo: string): boolean {
  return /^(https?:\/\/|git@|ssh:\/\/|git:\/\/)/.test(repo);
}

/**
 * Resolve a project's repo setting to a local directory.
 * Remote URLs are cloned (bare) into data/cache and fetched on refresh.
 */
export async function resolveRepoDir(p: ProjectConfig, opts?: { fetch?: boolean }): Promise<string> {
  if (isRemoteUrl(p.repo)) {
    const hash = createHash("sha1").update(p.repo).digest("hex").slice(0, 10);
    const dir = join(process.cwd(), "data", "cache", `${p.id}-${hash}.git`);
    if (!existsSync(dir)) {
      mkdirSync(join(process.cwd(), "data", "cache"), { recursive: true });
      await run("git", ["clone", "--bare", p.repo, dir], { maxBuffer: 64 * 1024 * 1024 });
    } else if (opts?.fetch) {
      await git(dir, ["fetch", "--tags", "--force", "origin"]);
    }
    return dir;
  }
  const dir = isAbsolute(p.repo) ? p.repo : join(process.cwd(), p.repo);
  if (!existsSync(dir)) throw new Error(`Repository path not found: ${p.repo}`);
  return dir;
}

export async function listTags(repoDir: string): Promise<TagInfo[]> {
  const fmt =
    "%(refname:short)%09%(if)%(*objectname)%(then)%(*objectname)%(else)%(objectname)%(end)%09%(creatordate:iso-strict)%09%(contents:subject)";
  const out = await git(repoDir, ["for-each-ref", "refs/tags", "--sort=creatordate", `--format=${fmt}`]);
  return out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, sha, date, subject] = line.split("\t");
      return { name, sha, date, subject: subject ?? "" };
    });
}

export async function latestTag(repoDir: string): Promise<TagInfo | undefined> {
  const tags = await listTags(repoDir);
  return tags[tags.length - 1];
}

export async function revParse(repoDir: string, ref: string): Promise<string> {
  return (await git(repoDir, ["rev-parse", `${ref}^{commit}`])).trim();
}

export async function refDate(repoDir: string, ref: string): Promise<string> {
  return (await git(repoDir, ["log", "-1", "--format=%aI", ref])).trim();
}

export async function refSubject(repoDir: string, ref: string): Promise<string> {
  return (await git(repoDir, ["log", "-1", "--format=%s", ref])).trim();
}

/** List files under `subDir` at `ref` matching an extension. */
export async function listFilesAt(repoDir: string, ref: string, subDir: string, ext: string): Promise<string[]> {
  const out = await git(repoDir, ["ls-tree", "-r", "--name-only", ref, "--", subDir]);
  return out
    .trim()
    .split("\n")
    .filter((f) => f && f.endsWith(ext));
}

export async function readFileAt(repoDir: string, ref: string, path: string): Promise<string> {
  return git(repoDir, ["show", `${ref}:${path}`]);
}

export async function recentCommits(repoDir: string, n: number, ref = "HEAD"): Promise<CommitInfo[]> {
  const out = await git(repoDir, ["log", `-${n}`, "--format=%H%x09%an%x09%aI%x09%s", ref]);
  return out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, author, date, subject] = line.split("\t");
      return { sha, author, date, subject };
    });
}

export async function commitCount(repoDir: string, ref = "HEAD"): Promise<number> {
  return parseInt((await git(repoDir, ["rev-list", "--count", ref])).trim(), 10);
}
