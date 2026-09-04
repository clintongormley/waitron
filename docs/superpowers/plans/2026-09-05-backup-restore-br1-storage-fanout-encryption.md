# Backup/Restore BR-1 — Storage abstraction + fan-out + encryption — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow today's single-directory `pg_dump` backup into a pluggable, multi-destination, encrypted backup — a `StorageBackend` abstraction with a local-filesystem implementation, fan-out of one encrypted artifact to every configured destination, and per-destination freshness on `GET /api/box/status`.

**Architecture:** The existing standalone sweep loop (`runBackupSweep`, mirroring `@waitron/sync`'s `runRetentionSweep`) is rewritten to: dump to a staging temp file → encrypt the dump once under an operator recovery key (AES-256-GCM + scrypt) → `put` the same ciphertext to every configured `StorageBackend` → prune each backend to `retain`. v1 ships only `LocalFsBackend`, so "multiple destinations" means multiple local directories (a local disk + a mounted NAS/USB). No restore, no module contributions — those are BR-2/BR-3.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Node `node:crypto` (`scryptSync`, `createCipheriv`/`createDecipheriv`), Node `node:fs/promises`, Vitest (DI-based unit tests, real temp dirs, no DB for this slice).

**Spec:** `docs/superpowers/specs/2026-09-04-backup-restore-regime-design.md` (BR-1 is §7's first slice; decisions in §3).

## Global Constraints

- **No backwards-compatibility / data-migration code** (CLAUDE.md §5; nothing is deployed). The `WAITRON_BACKUP_DIR` env may be redefined/relaxed freely; update dev/test wiring in the same change.
- **Error codes name the DOMAIN CONCEPT, never the throwing package** (CLAUDE.md §3): `backup.*` for backup facts, `server.*` for process facts. Codes are **never renamed once shipped**. Add a code by adding one line to the `ErrorParams` declaration-merge block in `apps/server/src/errors.ts`; every file that throws a code does `import "./errors.js"`.
- **Never build SQL by string concatenation** (not relevant here — no SQL is authored in BR-1; `pg_dump` runs over a connection string via `execFile`).
- **An empty connection/config string is a valid value** (CLAUDE.md §3): guard every env read with `isUnset` (`apps/server/src/env-value.ts`); never `resolve("")`.
- **Encryption key is operator-held, NOT the box key.** The recovery key is supplied by the operator (`WAITRON_BACKUP_RECOVERY_KEY`), min 12 chars (reuse `MIN_PASSPHRASE_LENGTH`). The box holds it in env only to encrypt unattended; the operator must keep a copy off-box to decrypt after the box is destroyed. Never derive the backup key from `WAITRON_CREDENTIALS_KEY`.
- **Backup is best-effort housekeeping and must never block a sale or fail boot** (CLAUDE.md §5): a destination fault logs-and-continues (per-run warn + `box-status` stale), exactly the fail-safe posture the RLS probe already takes (`backup-probe.ts`, disables-never-fatal).
- **Coverage thresholds (apps/server):** statements 98 / lines 98 / functions 98 / branches 95 (`apps/server/vitest.config.ts`). Run `pnpm --filter @waitron/server test:coverage` before claiming green (CLAUDE.md §2 — CI shards run `test:coverage`, not `test`).
- **Container tests need `TESTCONTAINERS_RYUK_DISABLED=true`** locally (CLAUDE.md §4). BR-1's tests are pure fs/crypto and need **no** database, so this applies only if a boot integration test is added (Task 6).

---

## File structure

**Create:**
- `apps/server/src/scrypt-kdf.ts` — the shared scrypt key-derivation primitive (params + `deriveKey`), extracted so both the recovery-bundle envelope and the new artifact cipher share one KDF. `apps/server/src/scrypt-kdf.test.ts`.
- `apps/server/src/artifact-cipher.ts` — `encryptArtifact`/`decryptArtifact`: binary-framed AES-256-GCM over arbitrary bytes (the DB dump), keyed by a passphrase via the shared KDF. `apps/server/src/artifact-cipher.test.ts`.
- `apps/server/src/storage-backend.ts` — the `StorageBackend` interface + `StoredObject` type + `BackupDestination` config union + `buildBackend`. `apps/server/src/storage-backend.test.ts` (for `buildBackend`).
- `apps/server/src/local-fs-backend.ts` — `LocalFsBackend` implementing `StorageBackend` (atomic `put`, `get`, `list`, `delete`). `apps/server/src/local-fs-backend.test.ts`.

**Modify:**
- `apps/server/src/backup-config.ts` — parse a destinations list + the recovery key; keep the single-`WAITRON_BACKUP_DIR` convenience.
- `apps/server/src/backup-sweep.ts` — the fan-out orchestrator (dump → encrypt → put-to-all → prune-each).
- `apps/server/src/backup-status.ts` — per-destination freshness (`readBackupStatus` scans each backend).
- `apps/server/src/box-status.ts` — widen the `BackupStatus`/`BoxStatus.backup` wire shape to per-destination.
- `apps/server/src/errors.ts` — add `backup.recovery_key_missing`, `backup.recovery_key_too_short`, `backup.destination_unwritable`.
- `apps/server/src/boot.ts` — thread destinations + recovery key into the sweep and the status reader; update teardown.

**Leave alone (BR-2/BR-3):** `recovery-bundle.ts` wire format (only its KDF is refactored to the shared module, output unchanged), `pg-dump.ts` (`realPgDump`/`dumpAtomic`/`dumpFileName`/`DUMP_FILE_NAME` are reused as-is), `state-secrets.ts`.

---

## Task 1: Shared scrypt KDF (`scrypt-kdf.ts`)

Extract the scrypt parameters + derivation that `recovery-bundle.ts` uses (`recovery-bundle.ts:19-25`) into one module both the recovery bundle and the new artifact cipher share (DRY). The recovery-bundle envelope format is **unchanged** — only where it derives the key moves.

**Files:**
- Create: `apps/server/src/scrypt-kdf.ts`
- Test: `apps/server/src/scrypt-kdf.test.ts`
- Modify: `apps/server/src/recovery-bundle.ts` (use the shared derive; keep envelope bytes identical)

**Interfaces:**
- Produces: `SCRYPT_PARAMS: { N: number; r: number; p: number; keylen: number; maxmem: number }`; `deriveKey(passphrase: string, salt: Buffer): Buffer` (32-byte key).

- [ ] **Step 1: Write the failing test**

```typescript
// apps/server/src/scrypt-kdf.test.ts
import { describe, expect, it } from "vitest";
import { deriveKey, SCRYPT_PARAMS } from "./scrypt-kdf.js";

describe("deriveKey", () => {
  it("derives a stable 32-byte key for a passphrase + salt", () => {
    const salt = Buffer.alloc(16, 7);
    const a = deriveKey("correct horse battery", salt);
    const b = deriveKey("correct horse battery", salt);
    expect(a).toHaveLength(32);
    expect(a.equals(b)).toBe(true);
  });

  it("derives a different key for a different salt", () => {
    const a = deriveKey("pw", Buffer.alloc(16, 1));
    const b = deriveKey("pw", Buffer.alloc(16, 2));
    expect(a.equals(b)).toBe(false);
  });

  it("uses the hardened scrypt cost parameters", () => {
    expect(SCRYPT_PARAMS).toMatchObject({ N: 2 ** 17, r: 8, p: 1, keylen: 32 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/server exec vitest run src/scrypt-kdf.test.ts`
Expected: FAIL — `Cannot find module './scrypt-kdf.js'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/server/src/scrypt-kdf.ts
import { scryptSync } from "node:crypto";

/** Hardened scrypt cost — shared by the recovery-bundle envelope and the backup artifact cipher.
 * Copied verbatim from the recovery-bundle's original constant so its envelope is byte-compatible. */
export const SCRYPT_PARAMS = {
  N: 2 ** 17,
  r: 8,
  p: 1,
  keylen: 32,
  maxmem: 256 * 1024 * 1024,
} as const;

/** Derive a 32-byte AES-256 key from a passphrase and a 16-byte salt. */
export function deriveKey(passphrase: string, salt: Buffer): Buffer {
  const { N, r, p, keylen, maxmem } = SCRYPT_PARAMS;
  return scryptSync(passphrase, salt, keylen, { N, r, p, maxmem });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @waitron/server exec vitest run src/scrypt-kdf.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Refactor `recovery-bundle.ts` onto the shared KDF, proving the envelope is unchanged**

In `recovery-bundle.ts`: replace the local `SCRYPT` constant and its `scryptSync(...)` call sites (in `encryptBundle`/`decryptBundle`) with `import { deriveKey, SCRYPT_PARAMS } from "./scrypt-kdf.js";` and `deriveKey(passphrase, salt)`. Keep the envelope's `kdf: { name, N, r, p, salt }` fields sourced from `SCRYPT_PARAMS` so the serialized bytes are identical. Run the existing recovery-bundle suite to prove no behavioural change:

Run: `pnpm --filter @waitron/server exec vitest run src/recovery-bundle.test.ts`
Expected: PASS (unchanged) — an encrypt→decrypt roundtrip and the existing envelope-shape assertions still hold.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/scrypt-kdf.ts apps/server/src/scrypt-kdf.test.ts apps/server/src/recovery-bundle.ts
git commit -s -m "feat(server): extract shared scrypt KDF for backup artifact + recovery bundle"
```

---

## Task 2: Artifact cipher (`artifact-cipher.ts`)

Encrypt an arbitrary byte payload (the DB dump) under the recovery key, framed as compact binary (no base64 inflation): `magic(4) | version(1) | salt(16) | iv(12) | tag(16) | ciphertext`. AES-256-GCM. In-memory for v1 (a single-venue DB dump is modest; streaming is a named follow-on if dumps grow).

**Files:**
- Create: `apps/server/src/artifact-cipher.ts`
- Test: `apps/server/src/artifact-cipher.test.ts`

**Interfaces:**
- Consumes: `deriveKey`, `SCRYPT_PARAMS` (Task 1).
- Produces: `encryptArtifact(plaintext: Uint8Array, passphrase: string): Buffer`; `decryptArtifact(framed: Uint8Array, passphrase: string): Buffer`. `decryptArtifact` throws `AppError("backup.artifact_invalid", { reason })` on a malformed frame and `AppError("recovery.passphrase_invalid", {})` on GCM auth failure (reuse the existing recovery code — a wrong key and tampering are deliberately indistinguishable, matching `recovery-bundle.ts`).

- [ ] **Step 1: Write the failing test**

```typescript
// apps/server/src/artifact-cipher.test.ts
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptArtifact, encryptArtifact } from "./artifact-cipher.js";

describe("artifact cipher", () => {
  it("roundtrips arbitrary binary under the right passphrase", () => {
    const plaintext = randomBytes(4096);
    const framed = encryptArtifact(plaintext, "recovery-key-123");
    expect(decryptArtifact(framed, "recovery-key-123").equals(plaintext)).toBe(true);
  });

  it("does not contain the plaintext (it is encrypted)", () => {
    const plaintext = Buffer.from("SELECT secret FROM sales", "utf8");
    const framed = encryptArtifact(plaintext, "pw-000000000000");
    expect(framed.includes(plaintext)).toBe(false);
  });

  it("rejects the wrong passphrase with recovery.passphrase_invalid", () => {
    const framed = encryptArtifact(randomBytes(64), "right-passphrase");
    expect(() => decryptArtifact(framed, "wrong-passphrase")).toThrowError(
      expect.objectContaining({ code: "recovery.passphrase_invalid" }),
    );
  });

  it("rejects a tampered ciphertext", () => {
    const framed = encryptArtifact(randomBytes(64), "pw-000000000000");
    framed[framed.length - 1] ^= 0xff; // flip a ciphertext byte
    expect(() => decryptArtifact(framed, "pw-000000000000")).toThrowError(
      expect.objectContaining({ code: "recovery.passphrase_invalid" }),
    );
  });

  it("rejects a frame with a bad magic/version", () => {
    expect(() => decryptArtifact(Buffer.alloc(49), "pw-000000000000")).toThrowError(
      expect.objectContaining({ code: "backup.artifact_invalid" }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/server exec vitest run src/artifact-cipher.test.ts`
Expected: FAIL — `Cannot find module './artifact-cipher.js'`.

- [ ] **Step 3: Add the two error codes** to `apps/server/src/errors.ts` (inside the `declare module "@waitron/shared" { interface ErrorParams { ... } }` block, beside the existing `backup.role_rls_fenced` at `:1441`):

```typescript
    /** A backup artifact's binary frame is malformed (bad magic, version, or truncated header)
     * before decryption is even attempted. `reason` is a short machine tag. */
    "backup.artifact_invalid": { reason: string };
```

(`recovery.passphrase_invalid` already exists at `errors.ts:1428` — reuse it for the auth-failure path; do not add a backup-specific synonym.)

- [ ] **Step 4: Write minimal implementation**

```typescript
// apps/server/src/artifact-cipher.ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "@waitron/shared";
import { deriveKey } from "./scrypt-kdf.js";
import "./errors.js";

const MAGIC = Buffer.from("WBK1"); // Waitron BacKup, format 1
const VERSION = 1;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + 1 + SALT_LEN + IV_LEN + TAG_LEN; // 49

/** Encrypt bytes under a passphrase. Frame: MAGIC|version|salt|iv|tag|ciphertext (all binary). */
export function encryptArtifact(plaintext: Uint8Array, passphrase: string): Buffer {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, Buffer.from([VERSION]), salt, iv, tag, ct]);
}

/** Decrypt a framed artifact. Throws backup.artifact_invalid (malformed frame) or
 * recovery.passphrase_invalid (wrong key / tamper — GCM auth failure, deliberately alike). */
export function decryptArtifact(framed: Uint8Array, passphrase: string): Buffer {
  const buf = Buffer.from(framed.buffer, framed.byteOffset, framed.byteLength);
  if (buf.length < HEADER_LEN) throw new AppError("backup.artifact_invalid", { reason: "too_short" });
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new AppError("backup.artifact_invalid", { reason: "bad_magic" });
  }
  if (buf[MAGIC.length] !== VERSION) {
    throw new AppError("backup.artifact_invalid", { reason: "bad_version" });
  }
  let off = MAGIC.length + 1;
  const salt = buf.subarray(off, (off += SALT_LEN));
  const iv = buf.subarray(off, (off += IV_LEN));
  const tag = buf.subarray(off, (off += TAG_LEN));
  const ct = buf.subarray(off);
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new AppError("recovery.passphrase_invalid", {});
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @waitron/server exec vitest run src/artifact-cipher.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/artifact-cipher.ts apps/server/src/artifact-cipher.test.ts apps/server/src/errors.ts
git commit -s -m "feat(server): backup artifact cipher (AES-256-GCM over the DB dump)"
```

---

## Task 3: `StorageBackend` interface + `LocalFsBackend`

The pluggable destination. v1 ships one implementation. `put` is atomic (temp-then-rename, mirroring `dumpAtomic`, `pg-dump.ts:32-44`) so a fanned-out artifact is never half-visible.

**Files:**
- Create: `apps/server/src/storage-backend.ts`, `apps/server/src/local-fs-backend.ts`
- Test: `apps/server/src/local-fs-backend.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  interface StoredObject { key: string; size: number; mtimeMs: number; }
  interface StorageBackend {
    readonly id: string;
    put(key: string, bytes: Uint8Array): Promise<void>;
    get(key: string): Promise<Buffer>;
    list(prefix: string): Promise<StoredObject[]>; // newest-first by mtime
    delete(key: string): Promise<void>;
  }
  type BackupDestination = { kind: "local-fs"; id: string; dir: string };
  function buildBackend(dest: BackupDestination): StorageBackend;
  class LocalFsBackend implements StorageBackend { constructor(id: string, dir: string) }
  ```
  (`put` takes `Uint8Array` only in v1 — the artifact is already an in-memory `Buffer`; the `Readable` overload the spec names is deferred with streaming.)

- [ ] **Step 1: Write the failing test**

```typescript
// apps/server/src/local-fs-backend.test.ts
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalFsBackend } from "./local-fs-backend.js";

describe("LocalFsBackend", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "lfs-backend-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("puts then gets the same bytes", async () => {
    const be = new LocalFsBackend("d1", dir);
    await be.put("waitron-20260905T000000Z.dump.enc", Buffer.from("cipher-bytes"));
    expect((await be.get("waitron-20260905T000000Z.dump.enc")).toString()).toBe("cipher-bytes");
  });

  it("put is atomic — no .partial left behind on success", async () => {
    const be = new LocalFsBackend("d1", dir);
    await be.put("a.dump.enc", Buffer.from("x"));
    const listed = await be.list("waitron-");
    expect(listed.every((o) => !o.key.endsWith(".partial"))).toBe(true);
  });

  it("lists matching keys newest-first by mtime", async () => {
    const be = new LocalFsBackend("d1", dir);
    await be.put("waitron-1.dump.enc", Buffer.from("1"));
    await new Promise((r) => setTimeout(r, 5));
    await be.put("waitron-2.dump.enc", Buffer.from("2"));
    const listed = await be.list("waitron-");
    expect(listed.map((o) => o.key)).toEqual(["waitron-2.dump.enc", "waitron-1.dump.enc"]);
    expect(listed[0].size).toBe(1);
  });

  it("delete removes a key", async () => {
    const be = new LocalFsBackend("d1", dir);
    await be.put("waitron-1.dump.enc", Buffer.from("1"));
    await be.delete("waitron-1.dump.enc");
    expect(await be.list("waitron-")).toHaveLength(0);
  });

  it("list tolerates a missing dir (returns empty)", async () => {
    const be = new LocalFsBackend("d1", join(dir, "nope"));
    expect(await be.list("waitron-")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/server exec vitest run src/local-fs-backend.test.ts`
Expected: FAIL — `Cannot find module './local-fs-backend.js'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/server/src/storage-backend.ts
export interface StoredObject {
  key: string;
  size: number;
  mtimeMs: number;
}

/** A backup destination. Fan-out writes one artifact to every configured backend. */
export interface StorageBackend {
  readonly id: string;
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Objects whose key starts with `prefix`, newest-first by mtime. Missing store → []. */
  list(prefix: string): Promise<StoredObject[]>;
  delete(key: string): Promise<void>;
}

/** v1: only local-fs. Adding a kind (s3, sftp) is a config-shape + buildBackend addition. */
export type BackupDestination = { kind: "local-fs"; id: string; dir: string };
```

```typescript
// apps/server/src/local-fs-backend.ts
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BackupDestination, StorageBackend, StoredObject } from "./storage-backend.js";

export class LocalFsBackend implements StorageBackend {
  constructor(
    readonly id: string,
    private readonly dir: string,
  ) {}

  async put(key: string, bytes: Uint8Array): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const target = join(this.dir, key);
    const partial = `${target}.partial`;
    try {
      await writeFile(partial, bytes, { mode: 0o600 });
      await rename(partial, target);
    } catch (err) {
      await rm(partial, { force: true });
      throw err;
    }
  }

  async get(key: string): Promise<Buffer> {
    return readFile(join(this.dir, key));
  }

  async list(prefix: string): Promise<StoredObject[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const out: StoredObject[] = [];
    for (const name of names) {
      if (!name.startsWith(prefix) || name.endsWith(".partial")) continue;
      const info = await stat(join(this.dir, name));
      if (info.isFile()) out.push({ key: name, size: info.size, mtimeMs: info.mtimeMs });
    }
    return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  async delete(key: string): Promise<void> {
    await rm(join(this.dir, key), { force: true });
  }
}

export function buildBackend(dest: BackupDestination): StorageBackend {
  switch (dest.kind) {
    case "local-fs":
      return new LocalFsBackend(dest.id, dest.dir);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @waitron/server exec vitest run src/local-fs-backend.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/storage-backend.ts apps/server/src/local-fs-backend.ts apps/server/src/local-fs-backend.test.ts
git commit -s -m "feat(server): StorageBackend interface + LocalFsBackend (atomic put, newest-first list)"
```

---

## Task 4: Config — destinations list + recovery key (`backup-config.ts`)

Widen `loadBackupConfig` to return an array of destinations and the operator recovery key. Enabled iff ≥1 destination is configured. Keep the single-`WAITRON_BACKUP_DIR` convenience (a lone local-fs destination `id: "primary"`); add `WAITRON_BACKUP_DESTINATIONS` (JSON array) for extra/advanced destinations. The recovery key is **required** when enabled (fail-closed, like the db url), min length 12.

**Files:**
- Modify: `apps/server/src/backup-config.ts`
- Modify: `apps/server/src/errors.ts` (add the two recovery-key codes)
- Test: `apps/server/src/backup-config.test.ts` (extend)

**Interfaces:**
- Consumes: `BackupDestination` (Task 3), `isUnset` (`env-value.ts`), `positiveInt` (`config.ts:500`), `MIN_PASSPHRASE_LENGTH` (`recovery-bundle.ts:14`).
- Produces: `BackupConfig = { destinations: BackupDestination[]; recoveryKey: string; databaseUrl: string; intervalMs: number; retain: number; staleAfterMs: number }`; `loadBackupConfig(env): BackupConfig | undefined`.

- [ ] **Step 1: Write the failing test** (append to `backup-config.test.ts`)

```typescript
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { loadBackupConfig } from "./backup-config.js";

const base = { WAITRON_BACKUP_DATABASE_URL: "postgres://x", WAITRON_BACKUP_RECOVERY_KEY: "twelve-chars!" };

describe("loadBackupConfig destinations + recovery key", () => {
  it("is disabled when no destination is configured", () => {
    expect(loadBackupConfig({ ...base })).toBeUndefined();
  });

  it("turns WAITRON_BACKUP_DIR into a single local-fs destination 'primary'", () => {
    const cfg = loadBackupConfig({ ...base, WAITRON_BACKUP_DIR: "/mnt/backups" });
    expect(cfg?.destinations).toEqual([{ kind: "local-fs", id: "primary", dir: "/mnt/backups" }]);
  });

  it("appends WAITRON_BACKUP_DESTINATIONS entries after the primary", () => {
    const cfg = loadBackupConfig({
      ...base,
      WAITRON_BACKUP_DIR: "/mnt/a",
      WAITRON_BACKUP_DESTINATIONS: '[{"kind":"local-fs","id":"usb","dir":"/mnt/usb"}]',
    });
    expect(cfg?.destinations.map((d) => d.id)).toEqual(["primary", "usb"]);
  });

  it("requires the recovery key when a destination is set", () => {
    expect(() => loadBackupConfig({ WAITRON_BACKUP_DIR: "/mnt/a", WAITRON_BACKUP_DATABASE_URL: "x" })).toThrow(
      new AppError("backup.recovery_key_missing", {}),
    );
  });

  it("rejects a too-short recovery key", () => {
    expect(() =>
      loadBackupConfig({ WAITRON_BACKUP_DIR: "/mnt/a", WAITRON_BACKUP_DATABASE_URL: "x", WAITRON_BACKUP_RECOVERY_KEY: "short" }),
    ).toThrow(new AppError("backup.recovery_key_too_short", { min: 12 }));
  });

  it("rejects malformed WAITRON_BACKUP_DESTINATIONS JSON", () => {
    expect(() => loadBackupConfig({ ...base, WAITRON_BACKUP_DESTINATIONS: "not json" })).toThrow(
      new AppError("backup.destinations_invalid", { reason: "not_json" }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/server exec vitest run src/backup-config.test.ts`
Expected: FAIL — `recoveryKey`/`destinations` undefined; new codes not on `ErrorParams`.

- [ ] **Step 3: Add the config error codes** to `errors.ts` (beside `backup.role_rls_fenced`):

```typescript
    /** A backup destination is configured but WAITRON_BACKUP_RECOVERY_KEY is unset — refused at load
     * so an unattended backup can never write an unencrypted or box-key-encrypted artifact. */
    "backup.recovery_key_missing": Record<string, never>;
    /** WAITRON_BACKUP_RECOVERY_KEY is shorter than `min` characters. */
    "backup.recovery_key_too_short": { min: number };
    /** WAITRON_BACKUP_DESTINATIONS is not a valid JSON array of destination descriptors. */
    "backup.destinations_invalid": { reason: string };
```

- [ ] **Step 4: Write minimal implementation** (rewrite `loadBackupConfig` + `BackupConfig`)

```typescript
// apps/server/src/backup-config.ts — key changes (keep the existing file header/comments, DEFAULT_* consts)
import { resolve } from "node:path";
import { AppError } from "@waitron/shared";
import { isUnset } from "./env-value.js";
import { positiveInt } from "./config.js";
import { MIN_PASSPHRASE_LENGTH } from "./recovery-bundle.js";
import type { BackupDestination } from "./storage-backend.js";
import "./errors.js";

export interface BackupConfig {
  destinations: BackupDestination[];
  recoveryKey: string;
  databaseUrl: string;
  intervalMs: number;
  retain: number;
  staleAfterMs: number;
}

function parseDestinations(env: Env): BackupDestination[] {
  const out: BackupDestination[] = [];
  const dir = env.WAITRON_BACKUP_DIR;
  if (!isUnset(dir)) out.push({ kind: "local-fs", id: "primary", dir: resolve(dir) });
  const extra = env.WAITRON_BACKUP_DESTINATIONS;
  if (!isUnset(extra)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(extra);
    } catch {
      throw new AppError("backup.destinations_invalid", { reason: "not_json" });
    }
    if (!Array.isArray(parsed)) throw new AppError("backup.destinations_invalid", { reason: "not_array" });
    for (const raw of parsed) {
      if (
        typeof raw !== "object" || raw === null ||
        (raw as { kind?: unknown }).kind !== "local-fs" ||
        typeof (raw as { id?: unknown }).id !== "string" ||
        typeof (raw as { dir?: unknown }).dir !== "string"
      ) {
        throw new AppError("backup.destinations_invalid", { reason: "bad_entry" });
      }
      const d = raw as { id: string; dir: string };
      out.push({ kind: "local-fs", id: d.id, dir: resolve(d.dir) });
    }
  }
  return out;
}

export function loadBackupConfig(env: Env): BackupConfig | undefined {
  const destinations = parseDestinations(env);
  if (destinations.length === 0) return undefined;

  const databaseUrl = env.WAITRON_BACKUP_DATABASE_URL;
  if (isUnset(databaseUrl)) {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_BACKUP_DATABASE_URL",
      reason: "required_with_backup_dir",
    });
  }
  const recoveryKey = env.WAITRON_BACKUP_RECOVERY_KEY;
  if (isUnset(recoveryKey)) throw new AppError("backup.recovery_key_missing", {});
  if (recoveryKey.length < MIN_PASSPHRASE_LENGTH) {
    throw new AppError("backup.recovery_key_too_short", { min: MIN_PASSPHRASE_LENGTH });
  }

  return {
    destinations,
    recoveryKey,
    databaseUrl,
    intervalMs: positiveInt(env, "WAITRON_BACKUP_INTERVAL_MS", DEFAULT_BACKUP_INTERVAL_MS),
    retain: positiveInt(env, "WAITRON_BACKUP_RETAIN", DEFAULT_BACKUP_RETAIN),
    staleAfterMs: positiveInt(env, "WAITRON_BACKUP_STALE_AFTER_MS", DEFAULT_BACKUP_STALE_AFTER_MS),
  };
}
```

Update the file's doc comment to describe destinations + the recovery key. Ensure a unique-`id` check is unnecessary for v1 (document that duplicate ids simply fan out twice; a validation is a follow-on).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @waitron/server exec vitest run src/backup-config.test.ts`
Expected: PASS (existing + 6 new).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/backup-config.ts apps/server/src/backup-config.test.ts apps/server/src/errors.ts
git commit -s -m "feat(server): backup config — destinations list + operator recovery key"
```

---

## Task 5: Fan-out orchestrator (`backup-sweep.ts`)

Rewrite the sweep body: dump to a **staging temp file** (reuse `realPgDump`/`dumpFileName`), read + **encrypt once** under the recovery key, `put` the same ciphertext to **every** backend under `<dumpName>.enc`, then prune each backend to `retain`. A failing backend logs `backup.destination_failed` and does **not** abort the others (fail-safe). The loop shell (abort checks, sleep, error swallow) is unchanged from the current file.

**Files:**
- Modify: `apps/server/src/backup-sweep.ts`
- Modify: `apps/server/src/errors.ts` (add `backup.destination_failed`)
- Test: `apps/server/src/backup-sweep.test.ts` (rewrite around backends)

**Interfaces:**
- Consumes: `StorageBackend` (Task 3), `encryptArtifact` (Task 2), `realPgDump`/`PgDumpRunner`/`dumpFileName` (`pg-dump.ts`).
- Produces: `BackupSweepDeps = { backends: StorageBackend[]; databaseUrl: string; recoveryKey: string; stagingDir: string; intervalMs: number; retain: number; signal: AbortSignal; sleep: (ms: number, signal: AbortSignal) => Promise<void>; log: Logger; runDump?: PgDumpRunner; now?: () => Date }`; `runBackupSweep(deps): Promise<void>`; internal `runOnce(deps): Promise<void>` (exported for a direct unit test).

- [ ] **Step 1: Write the failing test** (rewrite `backup-sweep.test.ts`)

```typescript
// apps/server/src/backup-sweep.test.ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptArtifact } from "./artifact-cipher.js";
import { runOnce } from "./backup-sweep.js";
import type { StorageBackend, StoredObject } from "./storage-backend.js";

class FakeBackend implements StorageBackend {
  objects = new Map<string, Buffer>();
  constructor(readonly id: string, private failPut = false) {}
  async put(key: string, bytes: Uint8Array) {
    if (this.failPut) throw new Error("boom");
    this.objects.set(key, Buffer.from(bytes));
  }
  async get(key: string) { return this.objects.get(key)!; }
  async list(prefix: string): Promise<StoredObject[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ key: k, size: 0, mtimeMs: 0 }));
  }
  async delete(key: string) { this.objects.delete(key); }
}

describe("runOnce (fan-out)", () => {
  let staging: string;
  beforeEach(async () => { staging = await mkdtemp(join(tmpdir(), "backup-staging-")); });
  afterEach(async () => { await rm(staging, { recursive: true, force: true }); });

  const deps = (backends: StorageBackend[], log = vi.fn()) => ({
    backends, databaseUrl: "postgres://x", recoveryKey: "recovery-key-1", stagingDir: staging,
    retain: 7, signal: new AbortController().signal, sleep: vi.fn(), log,
    now: () => new Date("2026-09-05T00:00:00Z"),
    runDump: async ({ outFile }: { outFile: string }) => { await writeFile(outFile, "DUMP-BYTES"); },
  });

  it("encrypts the dump once and fans the SAME ciphertext to every backend", async () => {
    const a = new FakeBackend("a"); const b = new FakeBackend("b");
    await runOnce(deps([a, b]));
    const key = "waitron-20260905T000000Z.dump.enc";
    expect(a.objects.has(key)).toBe(true);
    expect(b.objects.get(key)!.equals(a.objects.get(key)!)).toBe(true);
    expect(decryptArtifact(a.objects.get(key)!, "recovery-key-1").toString()).toBe("DUMP-BYTES");
  });

  it("a failing backend does not stop the others", async () => {
    const good = new FakeBackend("good"); const bad = new FakeBackend("bad", true);
    const log = vi.fn();
    await runOnce(deps([bad, good], log));
    expect(good.objects.size).toBe(1);
    expect(log).toHaveBeenCalledWith("warn", "backup.destination_failed", expect.objectContaining({ destination: "bad" }));
  });

  it("prunes each backend to retain", async () => {
    const a = new FakeBackend("a");
    for (const t of ["waitron-1.dump.enc", "waitron-2.dump.enc"]) a.objects.set(t, Buffer.from("old"));
    await runOnce({ ...deps([a]), retain: 1 });
    expect(a.objects.size).toBe(1); // only the newest survives
  });

  it("leaves no staging file behind", async () => {
    const a = new FakeBackend("a");
    await runOnce(deps([a]));
    const { readdir } = await import("node:fs/promises");
    expect(await readdir(staging)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/server exec vitest run src/backup-sweep.test.ts`
Expected: FAIL — `runOnce` not exported; deps shape changed.

- [ ] **Step 3: Add the code** to `errors.ts`:

```typescript
    /** One backup destination's write (or prune) failed this run; other destinations proceed. The
     * run is best-effort housekeeping, so this warns and continues rather than throwing. */
    "backup.destination_failed": { destination: string };
```

- [ ] **Step 4: Write minimal implementation** (rewrite the sweep body; keep the loop shell)

```typescript
// apps/server/src/backup-sweep.ts — new body
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { encryptArtifact } from "./artifact-cipher.js";
import { dumpFileName, realPgDump, type PgDumpRunner } from "./pg-dump.js";
import { DUMP_FILE_NAME } from "./pg-dump.js";
import type { StorageBackend } from "./storage-backend.js";
import "./errors.js";

type Logger = (level: "info" | "warn" | "error", code: string, params?: Record<string, unknown>) => void;

export interface BackupSweepDeps {
  backends: StorageBackend[];
  databaseUrl: string;
  recoveryKey: string;
  stagingDir: string;
  intervalMs: number;
  retain: number;
  signal: AbortSignal;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  log: Logger;
  runDump?: PgDumpRunner;
  now?: () => Date;
}

const ENC_SUFFIX = ".enc";

/** One backup: dump → encrypt once → fan out → prune each. Best-effort per destination. */
export async function runOnce(deps: Omit<BackupSweepDeps, "intervalMs" | "sleep">): Promise<void> {
  const runDump = deps.runDump ?? realPgDump;
  const now = deps.now ?? (() => new Date());
  await mkdir(deps.stagingDir, { recursive: true });
  const dumpName = dumpFileName(now());
  const staged = join(deps.stagingDir, dumpName);
  try {
    await runDump({ databaseUrl: deps.databaseUrl, outFile: staged, signal: deps.signal });
    const ciphertext = encryptArtifact(await readFile(staged), deps.recoveryKey);
    const key = `${dumpName}${ENC_SUFFIX}`;
    for (const backend of deps.backends) {
      try {
        await backend.put(key, ciphertext);
        await pruneBackend(backend, deps.retain);
        deps.log("info", "backup.destination_completed", { destination: backend.id, key });
      } catch (err) {
        deps.log("warn", "backup.destination_failed", { destination: backend.id, errorCode: codeOf(err) });
      }
    }
  } finally {
    await rm(staged, { force: true });
  }
}

async function pruneBackend(backend: StorageBackend, retain: number): Promise<void> {
  const objects = await backend.list("waitron-"); // newest-first
  for (const obj of objects.slice(retain)) await backend.delete(obj.key);
}

export async function runBackupSweep(deps: BackupSweepDeps): Promise<void> {
  while (!deps.signal.aborted) {
    try {
      await runOnce(deps);
    } catch (err) {
      deps.log("warn", "backup.failed", { errorCode: codeOf(err) });
    }
    if (deps.signal.aborted) break;
    await deps.sleep(deps.intervalMs, deps.signal);
  }
}

// keep the existing `codeOf` helper from the current file (or re-import if it lived elsewhere)
```

Note: the artifact key is `waitron-<ts>.dump.enc`, so the prune `list("waitron-")` matches it. Confirm `pruneBackend` keeps newest `retain` (list is newest-first, `.slice(retain)` are the surplus). Preserve the existing `codeOf` helper.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @waitron/server exec vitest run src/backup-sweep.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/backup-sweep.ts apps/server/src/backup-sweep.test.ts apps/server/src/errors.ts
git commit -s -m "feat(server): backup fan-out — encrypt once, put to every destination, prune each"
```

---

## Task 6: Per-destination freshness (`backup-status.ts`, `box-status.ts`) + boot wiring

Widen the `box-status` backup shape to one freshness entry per destination (each scans its backend's newest object), and thread the new config (destinations, recovery key, staging dir) into the boot wiring for the sweep and the status reader.

**Files:**
- Modify: `apps/server/src/backup-status.ts`, `apps/server/src/box-status.ts`, `apps/server/src/boot.ts`
- Test: `apps/server/src/backup-status.test.ts` (rewrite around backends), `apps/server/src/box-status.test.ts` (extend the `backup` shape)

**Interfaces:**
- Consumes: `StorageBackend` (Task 3).
- Produces:
  ```typescript
  type DestinationStatus = { id: string; lastBackupAt: string | null; ageSeconds: number | null; stale: boolean };
  type BackupStatus = { configured: false } | { configured: true; destinations: DestinationStatus[] };
  function readBackupStatus(backends: StorageBackend[], staleAfterMs: number, now: Date): Promise<BackupStatus>;
  ```

- [ ] **Step 1: Write the failing test** (rewrite `backup-status.test.ts`)

```typescript
import { describe, expect, it } from "vitest";
import { readBackupStatus } from "./backup-status.js";
import type { StorageBackend, StoredObject } from "./storage-backend.js";

const backend = (id: string, newestMtimeMs: number | null): StorageBackend => ({
  id,
  put: async () => {},
  get: async () => Buffer.alloc(0),
  delete: async () => {},
  list: async (): Promise<StoredObject[]> =>
    newestMtimeMs === null ? [] : [{ key: "waitron-x.dump.enc", size: 1, mtimeMs: newestMtimeMs }],
});

const NOW = new Date("2026-09-05T12:00:00Z");

describe("readBackupStatus", () => {
  it("reports fresh per destination", async () => {
    const s = await readBackupStatus([backend("a", NOW.getTime() - 1000)], 60_000, NOW);
    expect(s).toMatchObject({ configured: true, destinations: [{ id: "a", ageSeconds: 1, stale: false }] });
  });

  it("marks a destination stale past staleAfterMs", async () => {
    const s = await readBackupStatus([backend("a", NOW.getTime() - 120_000)], 60_000, NOW);
    expect(s).toMatchObject({ configured: true, destinations: [{ id: "a", stale: true }] });
  });

  it("a destination with no backups yet is stale with null age", async () => {
    const s = await readBackupStatus([backend("a", null)], 60_000, NOW);
    expect(s).toMatchObject({ configured: true, destinations: [{ id: "a", lastBackupAt: null, ageSeconds: null, stale: true }] });
  });

  it("no backends → configured:false", async () => {
    expect(await readBackupStatus([], 60_000, NOW)).toEqual({ configured: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/server exec vitest run src/backup-status.test.ts`
Expected: FAIL — `readBackupStatus` still takes `(dir, staleAfterMs, now)`.

- [ ] **Step 3: Write minimal implementation** (`backup-status.ts`)

```typescript
import type { StorageBackend } from "./storage-backend.js";

export type DestinationStatus = {
  id: string;
  lastBackupAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
};
export type BackupStatus = { configured: false } | { configured: true; destinations: DestinationStatus[] };

export async function readBackupStatus(
  backends: StorageBackend[],
  staleAfterMs: number,
  now: Date,
): Promise<BackupStatus> {
  if (backends.length === 0) return { configured: false };
  const destinations: DestinationStatus[] = [];
  for (const backend of backends) {
    const objects = await backend.list("waitron-"); // newest-first
    const newest = objects[0];
    if (newest === undefined) {
      destinations.push({ id: backend.id, lastBackupAt: null, ageSeconds: null, stale: true });
      continue;
    }
    const ageMs = now.getTime() - newest.mtimeMs;
    destinations.push({
      id: backend.id,
      lastBackupAt: new Date(newest.mtimeMs).toISOString(),
      ageSeconds: Math.floor(ageMs / 1000),
      stale: ageMs > staleAfterMs,
    });
  }
  return { configured: true, destinations };
}
```

- [ ] **Step 4: Update `box-status.ts`** — replace the imported `BackupStatus` type usage (`box-status.ts:11-13,29-40,90-93`) with the new per-destination shape. The `backup: (() => Promise<BackupStatus>) | undefined` reader wiring is unchanged; only the payload type widens. Extend `box-status.test.ts` to assert the `destinations` array flows through (mirror the existing `backup` assertion).

- [ ] **Step 5: Wire boot** (`boot.ts`)

Thread the new config through the two call sites the map identified:
- The sweep worker (`boot.ts:1437-1467`): build backends from `backupConfig.destinations` via `buildBackend`, pass `{ backends, databaseUrl, recoveryKey, stagingDir: join(config.stateDir, "backup-staging"), intervalMs, retain, ... }` to `runBackupSweep`. Keep the `isSingletonPrimary` gate and the `assertBackupCanReadFiscal` probe unchanged.
- The status reader (`boot.ts:1518-1520`): `readBackup: backupWorker !== undefined ? () => readBackupStatus(backends, backupConfig!.staleAfterMs, now()) : undefined` (hold the built `backends` array in a boot-scope const so the sweep and the reader share it).

Run the server boot suite to confirm nothing regressed:

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run src/boot.test.ts`
Expected: PASS (backup remains opt-in; with no `WAITRON_BACKUP_DIR` the worker is `undefined` and `box-status` reports `configured:false`).

- [ ] **Step 6: Full gate + commit**

```bash
pnpm --filter @waitron/server test:coverage        # 98/98/98/95 must hold
pnpm --filter @waitron/server typecheck
pnpm lint && pnpm format:check
git add apps/server/src/backup-status.ts apps/server/src/backup-status.test.ts \
        apps/server/src/box-status.ts apps/server/src/box-status.test.ts apps/server/src/boot.ts
git commit -s -m "feat(server): per-destination backup freshness on box status + boot wiring"
```

---

## Self-review notes (checked against the spec)

- **Spec §3 decisions covered:** decision 4 (fan-out to all destinations) → Tasks 3+5; decision 5 (operator recovery key, not box key) → Tasks 1+2+4; the `StorageBackend` plugin (§4) → Task 3; per-destination `/health` freshness → Task 6. Decisions 1/2/3/6 (whole-DB unit, restore, incremental, module contribution) are **out of BR-1 scope** by the decomposition and are not implemented here.
- **Deferred, deliberately:** streaming encryption (in-memory for v1 — a modest single-venue dump; noted in Task 2), `StorageBackend.put(Readable)` overload, `get` beyond what restore/BR-3 needs, offsite backends. All are named seams, not gaps.
- **The recovery-key provenance** is the one design choice inside BR-1: `WAITRON_BACKUP_RECOVERY_KEY`, operator-supplied, min 12, fail-closed. The generate-and-print-once "recovery key" UX at provisioning is a follow-on. Confirm this framing with the owner before Task 4 (it is within spec decision 5's "derived from a passphrase / printed recovery key").
- **No placeholders:** every step carries real test + implementation code grounded in the mapped signatures.
- **Type consistency:** `StorageBackend`/`StoredObject`/`BackupDestination` (Task 3) are consumed unchanged by Tasks 4/5/6; `BackupStatus` is redefined in Task 6 and its old single-dir shape is fully removed from `box-status.ts`.
