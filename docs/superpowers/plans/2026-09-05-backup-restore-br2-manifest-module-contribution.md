# Backup/Restore BR-2 — manifest + module `backup` contribution (media + secrets capture) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a backup **complete** — a single encrypted archive per destination containing a manifest (module→schemaVersion + environment), the DB dump, the media blob store, and the on-box secrets — driven by a new `backup` contribution kind on the `WaitronModule` contract.

**Architecture:** BR-1 fans out one encrypted artifact (`waitron-<ts>.dump.enc`, the DB dump). BR-2 turns that single artifact into a **backup archive** (`waitron-<ts>.backup.enc`): the orchestrator collects the DB dump + each enabled module's declared non-DB state (core → the content-addressed media store) + the `stateDir` secrets (the vault master key, TLS, `trading.env`) + a plaintext-in-archive manifest, packs them into one deterministic binary container, and encrypts the whole thing once under the operator recovery key. Prune and freshness stay trivial (one archive = one backup). No restore (BR-3) and no fiscal `restore` body (BR-4).

**Tech Stack:** TypeScript (ESM, `.js` specifiers), `@waitron/module` (`WaitronModule`), `@waitron/migrations` (`appliedSchemaVersion`), Node `node:crypto`/`node:fs/promises`, Vitest (DI fakes + `useTemplateDb` where `appliedSchemaVersion` needs a real journal).

**Spec:** `docs/superpowers/specs/2026-09-04-backup-restore-regime-design.md` (BR-2 is §7's second slice; the `backup?: { nonDbState?, restore? }` contribution shape and its coordination with the module-system session are in §4/§9).

## Global Constraints

- **The `backup` contribution kind is coordinated with the module-system session** (additive, open-set): add ONE optional field to `WaitronModule` (`packages/module/src/module.ts`); it must NOT force any other descriptor to change. `@waitron/module` stays dependency-free — type `nonDbState` as pure data (a source *reference*, resolved to a path by the composition root) and `restore` as an `unknown` seat (its body is BR-4). **Sequence note for the PR:** SP-2 will move descriptors out of the centralized `ALL_MODULES` into packages; whoever lands second carries the other's fields across — flag it.
- **Error codes name the DOMAIN CONCEPT** (`backup.*`); declaration-merge block in `apps/server/src/errors.ts`; `import "./errors.js"` in every throwing file; never renamed once shipped; grep the ~12 siblings before minting one.
- **No backwards-compat code** (pre-production). The BR-1 artifact suffix may change from `.dump.enc` to `.backup.enc`; update BR-1's tests in the same change.
- **Fail-visible, not silent:** a backup that cannot capture the secrets or media it needs must FAIL the tick (logged `backup.failed`, retried) rather than ship an incomplete archive — an incomplete backup is a false safety net on the cold-recovery path (CLAUDE.md §5). `collectStateSecrets` already throws `recovery.state_incomplete` on a missing file; let it.
- **Encryption unchanged:** reuse `encryptArtifact(bytes, recoveryKey)` (BR-1) — encrypt the WHOLE archive once. Recovery key is the operator's, never the box key.
- **In-memory for v1** (a single-venue DB + a few dozen images is modest); streaming the archive is a named follow-on, same as BR-1's dump.
- **Coverage (apps/server):** 98/98/98/95. Run `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage` before claiming green.

---

## File structure

**Create:**
- `apps/server/src/backup-archive.ts` — `packArchive`/`unpackArchive`: a deterministic length-prefixed binary container of named entries. `apps/server/src/backup-archive.test.ts`.
- `apps/server/src/backup-manifest.ts` — `buildManifest` (module→schemaVersion + environment + createdAt) + the `BackupManifest` type. `apps/server/src/backup-manifest.test.ts`.
- `apps/server/src/backup-sources.ts` — `collectModuleNonDbState`: resolve each enabled module's declared `backup.nonDbState` source refs to on-disk files (source `"media"` → `config.mediaDir` content-addressed blobs). `apps/server/src/backup-sources.test.ts`.

**Modify:**
- `packages/module/src/module.ts` — add the `backup?` seat to `WaitronModule`.
- `apps/server/src/modules.ts` — the `core` descriptor declares `backup: { nonDbState: [{ kind: "content-addressed-dir", source: "media" }] }`.
- `apps/server/src/backup-sweep.ts` — `runOnce` builds and encrypts the full archive; `BackupSweepDeps` gains the collectors + manifest inputs; artifact key → `.backup.enc`.
- `apps/server/src/backup-status.ts` — freshness prefix/suffix stays working for `.backup.enc` (verify; likely no change since it scans `BACKUP_KEY_PREFIX`).
- `apps/server/src/boot.ts` — thread `mediaDir`, the secrets collector, `db`, `ALL_MODULES`, `config.environment`, and the resolved non-DB sources into the sweep.
- `apps/server/src/errors.ts` — any new `backup.*` codes (e.g. `backup.source_unresolved`).

**Reuse as-is:** `encryptArtifact` (`artifact-cipher.ts`), `collectStateSecrets` + `RECOVERY_FILES` (`state-secrets.ts`), `dumpFileName`/`BACKUP_KEY_PREFIX`/`realPgDump` (`pg-dump.ts`), `appliedSchemaVersion` (`@waitron/migrations`), `StorageBackend`/`buildBackend`.

---

## Task 1: The `backup` contribution kind + `core` declares media

Add the open-set seat to the module contract and have `core` declare the media store as its non-DB state. Pure declaration — no capture yet.

**Files:**
- Modify: `packages/module/src/module.ts`, `apps/server/src/modules.ts`
- Test: `packages/module/src/module.test.ts` (or the modules test in apps/server — follow where the existing descriptor tests live)

**Interfaces:**
- Produces (in `@waitron/module`):
  ```typescript
  /** A reference to non-DB state a module owns, resolved to a path by the composition root. */
  export type NonDbSource = { readonly kind: "content-addressed-dir"; readonly source: string };
  export interface ModuleBackupContribution {
    readonly nonDbState?: readonly NonDbSource[];
    readonly restore?: unknown; // seat — a root-wired hook; body lands in BR-3/BR-4
  }
  // added to WaitronModule:  readonly backup?: ModuleBackupContribution;
  ```

- [ ] **Step 1: Write the failing test** — assert `core`'s descriptor declares media as non-DB state, and that a module without `backup` is still valid (open set).

```typescript
// in the descriptor test file (mirror the existing ALL_MODULES test's imports)
import { ALL_MODULES } from "./modules.js";
it("core declares the media store as non-DB backup state", () => {
  const core = ALL_MODULES.find((m) => m.name === "core");
  expect(core?.backup?.nonDbState).toEqual([{ kind: "content-addressed-dir", source: "media" }]);
});
it("a module may omit backup (open contribution set)", () => {
  const sync = ALL_MODULES.find((m) => m.name === "sync");
  expect(sync?.backup).toBeUndefined();
});
```

- [ ] **Step 2: Run — FAIL** (`backup` not on the type / not on core).
  Run: `pnpm --filter @waitron/server exec vitest run src/modules.test.ts`

- [ ] **Step 3: Implement** — add `NonDbSource`/`ModuleBackupContribution` + `readonly backup?: ModuleBackupContribution;` to `WaitronModule` in `packages/module/src/module.ts` (export the new types from the barrel `index.ts`), and add `backup: { nonDbState: [{ kind: "content-addressed-dir", source: "media" }] }` to the `core` object literal in `apps/server/src/modules.ts`. Add a one-line comment on the seat matching the "declared now, unpopulated here" style of the sibling seats.

- [ ] **Step 4: Run — PASS**, plus `pnpm --filter @waitron/module test` and `pnpm --filter @waitron/module typecheck` (the new types compile and export).

- [ ] **Step 5: Commit** — `feat(module): backup contribution kind on WaitronModule; core declares media as non-DB state`

---

## Task 2: The archive container (`backup-archive.ts`)

A deterministic, binary-safe container of named entries — the thing the whole backup is packed into before one encryption. Format: `MAGIC(4) | version(1) | entryCount(u32) | [ nameLen(u32) | name(utf8) | dataLen(u64 LE) | data ]*`.

**Files:** Create `apps/server/src/backup-archive.ts`, `apps/server/src/backup-archive.test.ts`

**Interfaces:**
- Produces: `type ArchiveEntry = { name: string; bytes: Uint8Array }`; `packArchive(entries: ArchiveEntry[]): Buffer`; `unpackArchive(buf: Uint8Array): ArchiveEntry[]` (throws `AppError("backup.archive_invalid", { reason })` on a malformed/truncated container).

- [ ] **Step 1: Write the failing test**

```typescript
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { packArchive, unpackArchive } from "./backup-archive.js";

describe("backup archive", () => {
  it("roundtrips named binary entries in order", () => {
    const entries = [
      { name: "manifest.json", bytes: Buffer.from('{"v":1}') },
      { name: "db.dump", bytes: randomBytes(5000) },
      { name: "media/abc.jpg", bytes: randomBytes(1234) },
    ];
    const out = unpackArchive(packArchive(entries));
    expect(out.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    expect(Buffer.from(out[1].bytes).equals(Buffer.from(entries[1].bytes))).toBe(true);
  });
  it("handles an empty entry and an empty archive", () => {
    expect(unpackArchive(packArchive([]))).toEqual([]);
    const out = unpackArchive(packArchive([{ name: "empty", bytes: new Uint8Array(0) }]));
    expect(out[0].bytes).toHaveLength(0);
  });
  it("rejects a truncated container", () => {
    const good = packArchive([{ name: "x", bytes: Buffer.from("y") }]);
    expect(() => unpackArchive(good.subarray(0, good.length - 1))).toThrowError(
      expect.objectContaining({ code: "backup.archive_invalid" }),
    );
  });
  it("rejects a bad magic", () => {
    expect(() => unpackArchive(Buffer.alloc(9))).toThrowError(
      expect.objectContaining({ code: "backup.archive_invalid" }),
    );
  });
});
```

- [ ] **Step 2: Run — FAIL** (module missing). Add `backup.archive_invalid: { reason: string }` to `errors.ts`.

- [ ] **Step 3: Implement** — length-prefixed writer/reader. Use `Buffer.writeUInt32LE`/`writeBigUInt64LE`. Validate MAGIC, version, and that every declared length stays within bounds (a truncated/oversized length → `backup.archive_invalid`). Keep it in-memory (`Buffer.concat`); no streaming (v1).

- [ ] **Step 4: Run — PASS** (4 tests).

- [ ] **Step 5: Commit** — `feat(server): deterministic backup archive container (pack/unpack)`

---

## Task 3: The manifest (`backup-manifest.ts`)

The archive's index/compatibility record: which modules + their **migrated** schema versions, and the environment. Plaintext JSON *inside* the (encrypted) archive — it names no secrets, and BR-3's restore reads it first to refuse an incompatible target.

**Files:** Create `apps/server/src/backup-manifest.ts`, `apps/server/src/backup-manifest.test.ts`

**Interfaces:**
- Consumes: `appliedSchemaVersion` (`@waitron/migrations`), `WaitronModule` (`@waitron/module`).
- Produces:
  ```typescript
  type BackupManifest = {
    manifestVersion: 1;
    createdAt: string;              // ISO
    environment: "production" | "preproduction";
    modules: Record<string, number>; // name → applied schema version
  };
  function buildManifest(deps: {
    db: Database; modules: readonly WaitronModule[];
    environment: "production" | "preproduction"; now: Date;
  }): Promise<BackupManifest>;
  ```

- [ ] **Step 1: Write the failing test** — use a real template DB (so `appliedSchemaVersion` reads real journal tables), assert the manifest maps each module to a non-negative version and stamps the environment + createdAt. Follow `backup-sweep.test.ts`'s `useTemplateDb` import for the real-PG harness.

```typescript
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { ALL_MODULES } from "./modules.js";
import { buildManifest } from "./backup-manifest.js";
const suite = useTemplateDb({ template: "manifest" });
it("stamps environment, createdAt, and a version per module", async () => {
  const db = suite.db();
  const m = await buildManifest({ db, modules: ALL_MODULES, environment: "preproduction", now: new Date("2026-09-05T00:00:00Z") });
  expect(m).toMatchObject({ manifestVersion: 1, environment: "preproduction", createdAt: "2026-09-05T00:00:00.000Z" });
  expect(Object.keys(m.modules)).toEqual(expect.arrayContaining(["core", "fiscal"]));
  expect(m.modules.core).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run — FAIL** (`TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run src/backup-manifest.test.ts`).

- [ ] **Step 3: Implement** — `modules: Object.fromEntries(await Promise.all(modules.map(async (m) => [m.name, await appliedSchemaVersion(db, m.migrations)])))`; stamp `createdAt: now.toISOString()`, `environment`, `manifestVersion: 1`.

- [ ] **Step 4: Run — PASS**.

- [ ] **Step 5: Commit** — `feat(server): backup manifest builder (module schema versions + environment)`

---

## Task 4: Resolve module non-DB sources (`backup-sources.ts`)

Turn each enabled module's declared `backup.nonDbState` source refs into actual files to capture. v1 knows one source, `"media"` → the content-addressed blobs under `config.mediaDir`.

**Files:** Create `apps/server/src/backup-sources.ts`, `apps/server/src/backup-sources.test.ts`

**Interfaces:**
- Consumes: `WaitronModule`/`NonDbSource` (Task 1), `MEDIA_FILENAME`-shaped dir reads.
- Produces:
  ```typescript
  // resolvers map a source id to an absolute dir; the composition root supplies { media: config.mediaDir }
  function collectModuleNonDbState(
    modules: readonly WaitronModule[],
    resolvers: Record<string, string>,
  ): Promise<ArchiveEntry[]>; // e.g. [{ name: "media/<sha>.jpg", bytes }, ...]
  ```
  An unknown `source` (no resolver) → `AppError("backup.source_unresolved", { source })` (fail-visible).

- [ ] **Step 1: Write the failing test** — a temp dir with two fake image files; `core`'s media source resolves to it; assert both files come back as `media/<name>` entries; an unknown source throws.

- [ ] **Step 2: Run — FAIL**. Add `backup.source_unresolved: { source: string }` to `errors.ts`.

- [ ] **Step 3: Implement** — for each module with `backup?.nonDbState`, for each source ref: look up `resolvers[ref.source]` (throw `backup.source_unresolved` if absent), `readdir` the dir, read each file, emit `{ name: \`${ref.source}/${filename}\`, bytes }`. Tolerate a missing dir as empty (ENOENT → no entries) — a venue with no images is valid. Keep entry order stable (sort by filename) for deterministic archives.

- [ ] **Step 4: Run — PASS**.

- [ ] **Step 5: Commit** — `feat(server): resolve module-declared non-DB backup sources (media)`

---

## Task 5: Orchestrator builds the full backup archive + boot wiring

Extend `runOnce` to assemble `[manifest.json, db.dump, <non-db state…>, secrets/<path>…]` into one archive, encrypt once, fan out as `waitron-<ts>.backup.enc`. Prune/freshness unchanged (still one artifact per backup). Wire boot.

**Files:** Modify `apps/server/src/backup-sweep.ts`, `apps/server/src/backup-status.ts` (verify), `apps/server/src/boot.ts`; extend `backup-sweep.test.ts`.

**Interfaces:**
- Consumes: `packArchive` (T2), `buildManifest` (T3), `collectModuleNonDbState` (T4), `collectStateSecrets` (`state-secrets.ts`), `encryptArtifact`, `realPgDump`/`dumpFileName`/`BACKUP_KEY_PREFIX`.
- Produces: `BackupSweepDeps` gains `db: Database`, `modules: readonly WaitronModule[]`, `environment`, `mediaDir` (via `resolvers`), `stateDir`. Artifact key becomes `${BACKUP_KEY_PREFIX}${basicISO}.backup.enc`.

- [ ] **Step 1: Write the failing test** — with fake backends + injected `runDump`, a temp `mediaDir` holding one blob, a temp `stateDir` holding the RECOVERY_FILES, and a DI-able manifest/db: assert the fanned-out artifact key ends `.backup.enc`, decrypts + `unpackArchive`s to a set of entries containing `manifest.json`, `db.dump`, `media/<blob>`, and `secrets/secrets.env`; the manifest parses; a failing backend still doesn't stop the others; staging is cleaned up. (Where `buildManifest` needs a real DB, use `useTemplateDb`; otherwise inject a manifest builder so the fan-out test stays pure-DI.)

- [ ] **Step 2: Run — FAIL**.

- [ ] **Step 3: Implement** — in `runOnce`: dump DB to staging → read dump bytes → `entries = [{name:"manifest.json", bytes: Buffer.from(JSON.stringify(await buildManifest(...)))}, {name:"db.dump", bytes: dumpBytes}, ...await collectModuleNonDbState(modules, resolvers), ...secretsEntries]` where `secretsEntries` maps `collectStateSecrets(stateDir)` (a `Record<path,string>`) to `{ name: \`secrets/${path}\`, bytes: Buffer.from(contents) }` → `ciphertext = encryptArtifact(packArchive(entries), recoveryKey)` → fan out under `.backup.enc` (same `Promise.allSettled` per-destination best-effort + prune) → `finally` cleanup. Keep encrypt-once. Let `collectStateSecrets`'/`buildManifest`'s throws propagate to the tick's `backup.failed` (fail-visible).

- [ ] **Step 4: Boot wiring** (`boot.ts`, at the existing sweep wiring ~1490-1533): pass `db`, `modules: ALL_MODULES`, `environment: config.environment`, `resolvers: { media: config.mediaDir }`, `stateDir: config.stateDir` into `runBackupSweep`. The RLS probe (`assertBackupCanReadFiscal`) stays. Confirm `readBackupStatus` still reads freshness (it scans `BACKUP_KEY_PREFIX`, suffix-agnostic — add a test that a `.backup.enc` object reads FRESH).

- [ ] **Step 5: Gate + commit** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage`, typecheck, lint, format:check. Commit: `feat(server): backup archive — dump + media + secrets + manifest, encrypted as one artifact`

---

## Self-review notes (checked against the spec)

- **Spec §7 BR-2 covered:** the `backup` contribution kind (T1) + manifest (T3) + media & secrets capture (T4/T5). The single-archive decision is a simplification of the spec's "artifacts[]" manifest — the archive's own index is the artifact list, and one encrypted archive keeps BR-1's prune/freshness intact; the manifest still carries module→schemaVersion + environment for BR-3's compatibility gate.
- **Deferred, deliberately:** the fiscal `restore` hook body (BR-4); per-blob media dedup/incremental (the archive is a full snapshot — BR-1's incremental seam); streaming the archive; BR-3's restore/unpack consumer (which will use `unpackArchive` + read `manifest.json` first).
- **Coordination:** T1 adds one optional field to `WaitronModule` — flag the SP-2 per-package-descriptor-move carry-across in the PR.
- **No placeholders; type consistency:** `ArchiveEntry` (T2) is the currency of T4 and T5; `NonDbSource`/`ModuleBackupContribution` (T1) are consumed by T4; `BackupManifest` (T3) is serialized in T5.
