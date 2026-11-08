# A1308 jr9 — the backup copy on a worker thread (built only if measure 9 says so) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Build this only if** jr8's measure 9 verdict was "jr9 is built" and the watcher confirmed it. Otherwise
this plan is not built, and the part summary records why.

**Owner lands:** no (rules §6).

**Goal:** The copy of `venue.db` a backup takes (`VACUUM INTO`, today one synchronous statement on the
main thread, `packages/store/src/archive.ts:24-34`) runs on a worker thread with its own read
connection, so sales and screens do not wait while it copies.

**Architecture:** Inside the same process (jobs.md §1: one program; a worker thread keeps the change
feed and the venue lock). `packages/store` gains `archiveInWorker(path, target)`, which starts a
`worker_threads` worker that opens its own read connection to the venue file, runs `VACUUM INTO`,
and closes it; the main thread awaits a message. `BackupSupervisor`'s `archive` dependency
(`apps/server/src/backup-supervisor.ts:319`, `archive: (outFile) => venue.venue.archiveTo(outFile)`)
calls it. Writes stay on the main thread.

**Spec:** [jobs.md §1 "Heavy read-only work and the backup copy can use a worker thread"; §5 measure 9](../specs/2026-11-02-rationalisation/jobs.md);
README §7; CLAUDE.md §3 ("One process owns a venue folder at a time"; Litestream's
`_litestream_seq`, `_litestream_lock` and `.venue.db-litestream/`). Slice rules apply.

## What it builds

`archiveInWorker`, its use by the backup sweep, and a test that the main thread keeps answering
while a copy runs.

## What it leaves out

Heavy reads (reports, exports) on a worker: not in this part (jr8's measure lists them for the watcher).

## Files

- Create: `packages/store/src/archive-worker.ts`, `packages/store/src/archive-worker.test.ts`
- Modify: `packages/store/src/index.ts` (export; `StoreHandle.archiveTo` stays for other callers),
  `apps/server/src/backup-supervisor.ts` (`:319`), `backup-supervisor.test.ts`

## Size

Code ~125 (worker script 60, launcher 45, supervisor 5, exports 15); tests ~180. **~305.**

## Finish line

1. `pnpm --filter @waitron/store exec vitest run src/archive-worker.test.ts src/archive.test.ts` and
   `pnpm --filter @waitron/server exec vitest run src/backup-supervisor.test.ts src/backup-sweep.test.ts` — pass, `Tests` counts printed.
2. jr8's measure 9 run again on the branch: the copy's longest main-thread stall is under 50 ms.
3. Typecheck, format; `packages/store`'s coverage and mutation floors hold (CLAUDE.md §2: `store` is
   not mutation-tested, so only coverage); protection list EQUAL.

## Expected protection-list difference

**EQUAL.**

## Stop points (beyond rules §5)

1. The worker's copy differs from a main-thread copy of the same quiet database (Task 1's equality
   case fails). 2. Finish line 2 fails.

## Needs

jr8 and its measure 9 verdict.

## Global Constraints

- The worker opens a **read** connection (as `openReadConnection` does), never a writer, and never
  takes the venue lock; it runs only while this process holds the lock.
- The worker keeps every safety step `archiveTo` has (`packages/store/src/archive.ts:25-37`): the
  same working file (`workingName(path)`), removed first, then pre-created owner-only (0600) so the
  engine fills it at that mode, then renamed to `path` only once complete, and removed on failure.
  A reviewer's stand-in run showed `VACUUM INTO` from a worker's read-only connection works beside a
  writer but leaves a file it creates itself at mode 644, which is why the pre-creation matters.
- A copy is complete or absent: a worker that fails or is terminated leaves no `path`, and its
  working file is removed (the sweep's existing clean-up, `backup-sweep.ts:338-339`, removes `path`).
- The worker is terminated on the sweep's abort signal.

## Review Focus

1. **A copy taken while a sale commits.** The copy is a consistent snapshot (`VACUUM INTO` reads in
   one transaction); the sale is not blocked. Task 1's "sales keep committing during a copy".
2. **Litestream running.** The worker's connection must not checkpoint or touch Litestream's tables.
3. **An abort mid-copy.** The worker ends, the partial file is removed, the main thread is not left
   waiting. Task 1.
4. **The worker failing to start** (resource limit). The error reaches `runOnce`, which records the
   run stopped, as any copy failure does today.
5. **Two copies at once.** Impossible through the staging turn (`backup-sweep.ts:501-516`); the
   launcher does not need its own guard.

---

### Task 1: `archiveInWorker`

**Interfaces:** `archiveInWorker(sourcePath: string, targetPath: string, signal?: AbortSignal): Promise<void>`.

- [ ] **Step 1: Failing tests** (`archive-worker.test.ts`, a real file in `mkdtemp`):
  `"copies the database to the target, equal to a main-thread copy of the same quiet file"` (compare
  every table's rows); `"the main thread's timer keeps firing every 20 ms during a copy of a 100 MB file"`
  (longest gap under 50 ms), **with its control** in the same file: `"the same copy on the main thread stalls the timer"`
  (`archiveTo` on the same file: longest gap over 50 ms — if the control does not stall, the file is
  too small to prove anything; grow it); `"the copy is created owner-only and appears only when complete"`
  (mode 0600; no `path` while the working file exists); `"sales keep committing during a copy"`;
  `"an abort ends the worker and leaves neither the target nor its working file"`;
  `"a worker that fails rejects with its error"`.
- [ ] **Step 2–4:** FAIL; implement (worker file resolved with `new URL("./archive-worker-main.js", import.meta.url)` or an inline `eval: true` script, whichever the store's build ships; read its `tsconfig`/build first); PASS.
  Commit: "Copy the venue database for a backup on a worker thread".

### Task 2: Use it for backups

- [ ] **Step 1:** `backup-supervisor.ts:319` → `archive: (outFile) => archiveInWorker(join(this.#deps.venueDir, VENUE_FILE), outFile, signal)`
  (the reload's signal). A supervisor test asserts the sweep's archive calls the worker.
- [ ] **Step 2:** Run the Finish line, including measure 9 again. Commit: "Take backup copies off the main thread".
