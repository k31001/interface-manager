import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import type { CommitInfo, TagInfo } from "./types";

const run = promisify(execFile);

/**
 * Dedupe concurrent cold clones of the same repo within this process. A cold SFR
 * load fires several endpoints at once (stream, tags, trace) and each used to run
 * its own `git clone` into the same dir, racing to "destination already exists".
 * Callers now await one shared in-flight clone instead.
 */
const inflightClones = new Map<string, Promise<void>>();

async function ensureBareClone(repo: string, dir: string, onClone?: () => void): Promise<boolean> {
  if (existsSync(dir)) return false; // already cached
  let p = inflightClones.get(dir);
  if (!p) {
    p = (async () => {
      onClone?.(); // first load: signal the (potentially slow) network clone
      mkdirSync(join(process.cwd(), "data", "cache"), { recursive: true });
      // Clone into a temp dir and atomically rename on success, so an interrupted
      // clone never leaves a half-populated dir that existsSync treats as complete.
      const tmp = `${dir}.partial`;
      rmSync(tmp, { recursive: true, force: true });
      await run("git", ["clone", "--bare", repo, tmp], { maxBuffer: 64 * 1024 * 1024 });
      renameSync(tmp, dir);
    })();
    inflightClones.set(dir, p);
    p.finally(() => inflightClones.delete(dir)).catch(() => {});
  }
  await p;
  return true;
}

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
 * Resolve a repo spec (local path or remote URL) to a local directory.
 * Remote URLs are cloned (bare) into data/cache, keyed on the URL so a project
 * that points SFR and HAL at the same repo only clones it once. Fetched on refresh.
 */
export async function resolveRepoDir(repo: string, opts?: { fetch?: boolean; onClone?: () => void }): Promise<string> {
  if (isRemoteUrl(repo)) {
    const hash = createHash("sha1").update(repo).digest("hex").slice(0, 12);
    const dir = join(process.cwd(), "data", "cache", `${hash}.git`);
    const freshlyCloned = await ensureBareClone(repo, dir, opts?.onClone);
    if (!freshlyCloned && opts?.fetch) {
      // bare clones have no fetch refspec, so force-sync all heads + tags explicitly.
      // This also picks up rewritten history (e.g. a force-push), not just new tags.
      await git(dir, [
        "fetch",
        "--prune",
        "--force",
        "origin",
        "+refs/heads/*:refs/heads/*",
        "+refs/tags/*:refs/tags/*",
      ]);
    }
    return dir;
  }
  const dir = isAbsolute(repo) ? repo : join(process.cwd(), repo);
  if (!existsSync(dir)) throw new Error(`Repository path not found: ${repo}`);
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

/** List files under `subDir` (whole tree if empty) at `ref` matching an extension. */
export async function listFilesAt(repoDir: string, ref: string, subDir: string, ext: string): Promise<string[]> {
  const args = ["ls-tree", "-r", "--name-only", ref];
  if (subDir) args.push("--", subDir);
  const out = await git(repoDir, args);
  return out
    .trim()
    .split("\n")
    .filter((f) => f && f.endsWith(ext));
}

export async function readFileAt(repoDir: string, ref: string, path: string): Promise<string> {
  return git(repoDir, ["show", `${ref}:${path}`]);
}

/**
 * Read many blobs at a single commit in ONE `git cat-file --batch` process,
 * instead of spawning `git show` per file. The dominant speedup for repos with
 * many .rdl/.h files (and for stats, which re-reads every file at every tag).
 * Returns a map keyed by the input path; missing paths are omitted.
 */
export async function readFilesAt(repoDir: string, sha: string, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!paths.length) return out;

  return new Promise<Map<string, string>>((resolve, reject) => {
    const cp = spawn("git", ["-C", repoDir, "cat-file", "--batch"], { stdio: ["pipe", "pipe", "pipe"] });
    const buffers: Buffer[] = [];
    let err = "";
    cp.stdout.on("data", (d: Buffer) => buffers.push(d));
    cp.stderr.on("data", (d: Buffer) => (err += d.toString()));
    cp.on("error", reject);
    cp.on("close", (code) => {
      if (code !== 0 && !buffers.length) return reject(new Error(`git cat-file failed: ${err}`));
      const buf = Buffer.concat(buffers);
      let off = 0;
      for (const path of paths) {
        // header line: "<sha> <type> <size>\n"  OR  "<query> missing\n"
        const nl = buf.indexOf(0x0a, off);
        if (nl < 0) break;
        const header = buf.toString("utf8", off, nl);
        off = nl + 1;
        const m = header.match(/ (\w+) (\d+)$/);
        if (!m) continue; // "missing" — skip this path (header had no size)
        const size = parseInt(m[2], 10);
        out.set(path, buf.toString("utf8", off, off + size));
        off += size + 1; // skip the trailing newline git appends after the blob
      }
      resolve(out);
    });
    cp.stdin.write(paths.map((p) => `${sha}:${p}`).join("\n") + "\n");
    cp.stdin.end();
  });
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
