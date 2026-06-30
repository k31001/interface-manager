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

**Background prefetch (so on-demand never feels slow).** After the skeleton
loads, a client-side store (`src/lib/module-store.tsx`) quietly fetches every
module's register map one at a time during browser idle time, caching each by
path. A subtle 2px top bar shows progress and fades when done. Clicking an
IP/module fetches it immediately (ahead of the queue) and biases the queue toward
**nearby tree locations** (same IP → same subsystem → rest), so the registers a
user is likely to open next are warmed first. Once warmed, clicks are instant.
Trade-off: the client eventually holds every module again (cap/LRU if a project
is enormous), but first paint stays skeleton-fast and clicks never block.

The HAL viewer still loads its model in full, but now benefits from the per-blob
parse cache (the big stats/multi-tag win); applying the same tree/detail split to
the HAL viewer is the next step.

Net effect: the SFR initial render needs only the skeleton; opening a module
parses (and transfers) one file; stats reuses per-blob parses across tags.

## Phase 2 — stats tag-walk (implemented)

`computeSfrStats`/`computeHalStats` now load every tag's model with bounded
concurrency (`mapPool`, 8 at a time) and diff consecutively afterwards — the
per-tag git I/O and first-occurrence parses overlap. Measured on Pulsar (12
tags): cold `computeSfrStats` **605 ms → 248 ms (~2.4×)**, identical results
(verify passes). This helps the first-ever stats computation; results are still
disk-cached, so every later open stays instant.

## Phase 3 — polish (implemented)

- **Trace per-blob scan cache.** `loadTrace` caches each source file's scan by
  `(blob sha, SFR sha)`, so an evolving HAL only re-scans the files that actually
  changed (analogous to Phase 1's parse cache).
- **Off-screen register cards** use `content-visibility: auto` so a module with
  thousands of registers only lays out / paints the visible cards. The flash
  scroll re-anchors on the next frame so scroll-to-register stays accurate
  despite the intrinsic-size estimate.

Remaining ideas if a project pushes further: the same tree/detail split for the
HAL viewer, regmap-table row virtualization, and a cheap structural count to skip
the SFR skeleton's first parse.
