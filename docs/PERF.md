# Performance: scaling SFR/HAL loading

How the app loads interface data today, where it gets slow as a project grows
(hundreds of IPs / thousands of registers / dozens of tags), and the plan to
keep it fast. Phase 1 (on-demand loading) is implemented; phases 2–3 are noted
for later.

## Current architecture

| Path | What it does | Cost as data grows |
|---|---|---|
| `loadSfr` (`src/lib/model.ts`) | `git ls-tree` → one `git cat-file --batch` for all blobs → `parseRdl` **every** `.rdl` → full `SfrModel` | O(all registers/fields) — parses everything to show one module |
| `loadHal` (`src/lib/model.ts`) | same shape, parses **every** `.h` | O(all functions) |
| `computeSfrStats` / `computeHalStats` (`src/lib/stats.ts`) | loops over **every tag**, `loadSfr`/`loadHal` per tag, diffs consecutive | **O(tags × files)** — the heaviest op |
| `loadTrace` (`src/lib/trace.ts`) | lists + reads + scans **all** `.c`/`.cpp` under `halSrcDir` | O(source files) |
| Client | `useStream<SfrModel>` transfers the **entire** model; the tree/overview use only names+counts | Large JSON payload + client memory |

**Already good (kept):** single-process batched git reads (`readFilesAt`),
versioned disk cache (`diskCached`), NDJSON streaming with progress, virtualized
changelog, lazy stats/trace as separate fetches, channel dedup. The bottleneck
isn't I/O — it's **eager full parsing**: rendering the tree + one open module
parses *all* files, and stats multiplies that by the tag count.

## Phase 1 — two-tier on-demand loading (implemented)

Split each model into a cheap **skeleton** loaded up front and **detail** loaded
on demand.

**Server (`src/lib/model.ts`)**
- **Per-blob-sha parse cache.** `listBlobsAt` returns `(path, blobSha)` and each
  file is parsed through a cache keyed by its blob sha. Identical file content at
  different tags now parses **once**, not once per tag — the big win for stats
  and multi-tag browsing. `loadSfr`/`loadHal` use it transparently.
- **Skeleton loader** `loadSfrTree`: the full hierarchy with per-module register
  **counts** but no field detail. Counts are exact (from the per-blob-cached
  parse) so the tree/overview match the detail view; the payload to the client
  is a small counts-only tree. A cheap structural count that avoids even the
  first parse is a noted follow-up.
- **Detail loaders** `loadSfrModule(path)` / `loadSfrModules(paths)`: parse one
  module / one IP's modules on demand (through the per-blob cache).

**Routes**
- `GET …/sfr/tree/stream` (skeleton) and `GET …/sfr/modules?paths=` (detail).

**Client**
- The SFR viewer loads the tree skeleton for the tree + overview, then fetches a
  module's register map when an IP/module is opened (`IpRegmap`, `ModuleView`).
  The browser no longer receives or holds the whole SFR model.

The HAL viewer still loads its model in full, but now benefits from the per-blob
parse cache (the big stats/multi-tag win); applying the same tree/detail split to
the HAL viewer is the next step.

Net effect: the SFR initial render needs only the skeleton; opening a module
parses (and transfers) one file; stats reuses per-blob parses across tags.

## Phase 2 — stats tag-walk (planned)

`computeSfrStats`/`computeHalStats` load tags sequentially. The diffs need
consecutive models but the *loads* are independent — run them with bounded
concurrency, then diff in order. With the per-blob cache from Phase 1 this makes
cold stats for a large project scale with the number of *unique* file versions
rather than tags × files.

## Phase 3 — polish (planned)

- Virtualize the register-card list / regmap rows for a single huge module
  (reuse the changelog's `@tanstack/react-virtual` pattern).
- Scope trace to the open IP (`regUsedBy` for one IP) or cache per-file scans so
  new sources don't re-scan everything.
- Profile `parseRdl`'s tokenizer once the above lands.
