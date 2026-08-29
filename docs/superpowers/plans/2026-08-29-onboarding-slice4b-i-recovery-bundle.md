# Onboarding Slice 4b-i — Recovery Bundle (+ 4a follow-ups) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator download a passphrase-encrypted **recovery bundle** — the box's unrecoverable secret state (vault master key + venue identity + box CA/leaf), so a lost box can be rebuilt — and prove the bundle genuinely decrypts back; plus fold in the four slice-4a follow-ups.

**Architecture:** A pure crypto envelope module (`recovery-bundle.ts`: scrypt-derived AES-256-GCM over a `{path→contents}` map, no new dependency) sits beneath a file-mapping module (`state-secrets.ts`: gather the fixed set of state-dir secret files, and its inverse — unpack them back to a dir). A management-gated `POST /api/box/recovery-bundle` route packs + encrypts + streams the envelope as a file download; a thin `bin-recovery.ts unpack` CLI reverses it. The recoverability is pinned by a round-trip test that decrypts the exact bytes the HTTP route returns. The 4a follow-ups extend `box-status` (`singletonRole`, fail-loud replication) and its tests (fractional-day cert expiry; a real `sync_tailer`-pool `withTenant` prove-by-deletion).

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Node built-in `crypto` (`scryptSync`, `createCipheriv`/`createDecipheriv` AES-256-GCM), Hono, Drizzle, Vitest, `@waitron/db` testcontainers harness (`useTemplateDb`), `@waitron/identity` (`authorizeManager`), `@waitron/sync` (`lagFor`).

**Spec:** `docs/superpowers/specs/2026-08-26-appliance-onboarding-design.md` §12 (Backup, recovery, and break-glass). This is the **4b-i** carve-out of Slice 4b, decided with the owner 2026-08-29: recovery bundle first; scheduled `pg_dump` backup (4b-ii — pg_dump chosen, WAL rejected as too much overhead) and the cold-restore/fresh-chain runbook (4b-iii) are separate later plans.

## Global Constraints

- **No backwards-compatibility / data-migration code** — nothing is deployed (CLAUDE.md §3).
- **Error codes name the DOMAIN CONCEPT** (`recovery.*`), never the throwing package; codes are **never renamed once shipped**. Every file that throws a code does `import "./errors.js";` (CLAUDE.md §3). `apps/server/src/errors.ts` already declares domain codes beyond `server.*` (`sale.*`, `device.*`, `setup.*`), so `recovery.*` belongs there.
- **The gate:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`. Per task run the changed package's `pnpm --filter @waitron/server test:coverage` (CI runs coverage, not plain `test` — CLAUDE.md §2). Coverage floor for `apps/server`: **95/95/90/88** (its config).
- **Every commit `-s`** (DCO).
- **Real Postgres, not PGlite, for anything touching RLS / the deployment role / a non-superuser member** — PGlite connects as superuser and is a false pass (CLAUDE.md §4). Crypto and file-mapping modules need no DB and are plain unit tests.
- **Guard every hand-rolled teardown:** a suite that opens its own pool closes it in `finally` / a guarded `afterAll` (`if (pool !== undefined) await pool.close()`) — CLAUDE.md §4.
- **`TESTCONTAINERS_RYUK_DISABLED=true`** locally, or container suites hang to the 180s timeout (CLAUDE.md §4).
- **Never widen a grant to make a test pass** (CLAUDE.md §3).

---

## File Structure

**New files (all under `apps/server/src/`):**
- `recovery-bundle.ts` — pure crypto envelope: `encryptBundle` / `decryptBundle` over a `BundleFiles` map. One responsibility: the passphrase→AES-GCM container. No file I/O, no DB.
- `recovery-bundle.test.ts` — round-trip, wrong-passphrase, tamper, too-short, malformed-envelope, DoS-param-cap.
- `state-secrets.ts` — the state-dir ↔ `BundleFiles` mapping: `RECOVERY_FILES`, `collectStateSecrets(stateDir)` and its inverse `unpackBundleToDir(files, destDir)`. One responsibility: which files are in a bundle and how they land on disk.
- `state-secrets.test.ts` — gather-then-unpack round-trip on a temp dir; missing-file throws; 0600 modes; tls/ subdir created.
- `recovery-bundle-api.ts` — `mountRecoveryBundleApi`: the gated `POST /api/box/recovery-bundle` route.
- `recovery-bundle-api.test.ts` — real-PG, manager-login route test incl. end-to-end decrypt of the downloaded bytes.
- `bin-recovery.ts` — thin `waitron-recovery unpack <envelope> <destDir>` CLI (reads passphrase from `WAITRON_RECOVERY_PASSPHRASE`).

**Modified files:**
- `apps/server/src/errors.ts` — declare the five `recovery.*` codes.
- `apps/server/src/box-status.ts` — add `singletonRole` to the wire type, readers, `collectBoxStatus`, deps, route (follow-up ii); replication stays fail-loud (follow-up iii — the code already is; a test pins it).
- `apps/server/src/boot.ts` — mount the recovery route; wire `readSingletonRole` into box-status.
- `apps/server/src/box-status.test.ts` — singletonRole in the unit readers; a fail-loud replication test (follow-up iii).
- `apps/server/src/box-status.route.test.ts`, `apps/server/src/box-status.replication.test.ts` — thread `readSingletonRole` into `buildApp`; assert `singletonRole` in the body.
- `apps/server/src/cert-expiry.test.ts` — fractional-day cases (follow-up iv).
- New `apps/server/src/box-status.replication.tailer.test.ts` — the real `sync_applier`-pool `withTenant` prove-by-deletion (follow-up i).

**Deliberately NOT in this plan** (recorded so a reviewer does not flag them as gaps): the scheduled `pg_dump` backup + wiring the box-status `backup` field (stays `{configured:false}`) — that is **4b-ii**; the cold-restore/fresh-chain **runbook** and a re-provision-from-bundle flow — that is **4b-iii**. `bin-recovery.ts` gives the operator a real opener now, but the full restore procedure is 4b-iii.

---

## Task 1: Recovery-bundle crypto envelope (`recovery-bundle.ts`)

**Files:**
- Create: `apps/server/src/recovery-bundle.ts`
- Create: `apps/server/src/recovery-bundle.test.ts`
- Modify: `apps/server/src/errors.ts` (add three codes)

**Interfaces:**
- Produces: `MIN_PASSPHRASE_LENGTH: number` (= 12); `type BundleFiles = Record<string, string>`; `encryptBundle(files: BundleFiles, passphrase: string): string` (returns a JSON envelope string); `decryptBundle(envelopeJson: string, passphrase: string): BundleFiles`.
- Consumes: `AppError` from `@waitron/shared`; Node `node:crypto`.
- Error codes thrown: `recovery.passphrase_too_short` `{ min: number }`, `recovery.passphrase_invalid` `Record<string, never>`, `recovery.bundle_invalid` `{ reason: string }`.

- [ ] **Step 1: Declare the three error codes**

In `apps/server/src/errors.ts`, inside the `declare module "@waitron/shared" { interface ErrorParams { … } }` block, add (near the other domain codes — placement is cosmetic, declaration-merging is order-free):

```typescript
    /** A recovery-bundle passphrase shorter than the minimum. `min` is `MIN_PASSPHRASE_LENGTH`. */
    "recovery.passphrase_too_short": { min: number };
    /** Recovery-bundle decryption failed its GCM auth tag — a wrong passphrase OR a tampered
     * bundle, deliberately indistinguishable (revealing which would help an attacker). */
    "recovery.passphrase_invalid": Record<string, never>;
    /** A recovery-bundle envelope that is not the expected JSON shape/version, or whose KDF
     * parameters are out of the accepted bounds. `reason` is a coarse cause, never bundle contents. */
    "recovery.bundle_invalid": { reason: string };
```

- [ ] **Step 2: Write the failing test**

Create `apps/server/src/recovery-bundle.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import {
  MIN_PASSPHRASE_LENGTH,
  encryptBundle,
  decryptBundle,
  type BundleFiles,
} from "./recovery-bundle.js";

const FILES: BundleFiles = {
  "secrets.env": "WAITRON_CREDENTIALS_KEY=abc\nWAITRON_CREDENTIALS_KEY_VERSION=1\n",
  "tls/ca.crt": "-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----\n",
};
const PASS = "correct horse battery"; // ≥ MIN_PASSPHRASE_LENGTH

describe("recovery-bundle envelope", () => {
  it("round-trips the file map through encrypt→decrypt", () => {
    const out = decryptBundle(encryptBundle(FILES, PASS), PASS);
    expect(out).toEqual(FILES);
  });

  it("produces a fresh salt+iv each call (ciphertext is not deterministic)", () => {
    expect(encryptBundle(FILES, PASS)).not.toBe(encryptBundle(FILES, PASS));
  });

  it("rejects a passphrase shorter than the minimum", () => {
    const short = "x".repeat(MIN_PASSPHRASE_LENGTH - 1);
    expect(() => encryptBundle(FILES, short)).toThrow(
      new AppError("recovery.passphrase_too_short", { min: MIN_PASSPHRASE_LENGTH }),
    );
  });

  it("fails decryption on the wrong passphrase (GCM auth) with recovery.passphrase_invalid", () => {
    const env = encryptBundle(FILES, PASS);
    expect(() => decryptBundle(env, PASS + "!")).toThrow(
      new AppError("recovery.passphrase_invalid", {}),
    );
  });

  it("fails on a tampered ciphertext with recovery.passphrase_invalid", () => {
    const env = JSON.parse(encryptBundle(FILES, PASS));
    const ct = Buffer.from(env.ct, "base64");
    ct[0] ^= 0xff;
    env.ct = ct.toString("base64");
    expect(() => decryptBundle(JSON.stringify(env), PASS)).toThrow(
      new AppError("recovery.passphrase_invalid", {}),
    );
  });

  it("rejects a non-JSON envelope with recovery.bundle_invalid", () => {
    expect(() => decryptBundle("not json", PASS)).toThrow(
      new AppError("recovery.bundle_invalid", { reason: "not_json" }),
    );
  });

  it("rejects a malformed envelope shape with recovery.bundle_invalid", () => {
    expect(() => decryptBundle(JSON.stringify({ v: 1 }), PASS)).toThrow(
      new AppError("recovery.bundle_invalid", { reason: "malformed" }),
    );
  });

  it("rejects an envelope whose KDF cost is out of bounds (DoS guard)", () => {
    const env = JSON.parse(encryptBundle(FILES, PASS));
    env.kdf.N = 2 ** 30; // absurd scrypt cost
    expect(() => decryptBundle(JSON.stringify(env), PASS)).toThrow(
      new AppError("recovery.bundle_invalid", { reason: "malformed" }),
    );
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @waitron/server test recovery-bundle`
Expected: FAIL — `Cannot find module './recovery-bundle.js'`.

- [ ] **Step 4: Implement `recovery-bundle.ts`**

Create `apps/server/src/recovery-bundle.ts`:

```typescript
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import { AppError } from "@waitron/shared";
import "./errors.js";

/** The floor for a bundle passphrase. The bundle wraps the unrecoverable vault master key, so a weak
 * passphrase is the whole risk surface; 12 chars is the operator-facing minimum (spec §12). */
export const MIN_PASSPHRASE_LENGTH = 12;

/** A recovery bundle's plaintext: relative posix path → UTF-8 file contents. */
export type BundleFiles = Record<string, string>;

const ENVELOPE_VERSION = 1;
// scrypt work factor. N=2^15 with r=8,p=1 needs ~32MB (128*N*r); maxmem is set well above that on both
// sides so a future N bump does not silently fail. keylen 32 = AES-256.
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 32, maxmem: 128 * 1024 * 1024 } as const;
// Bounds an UNTRUSTED envelope's KDF cost so a hand-edited bundle cannot make decrypt allocate wildly.
// The operator runs decrypt on their own bundle, so this is defence-in-depth, not a security boundary.
const MAX_SCRYPT_N = 2 ** 20;

interface Envelope {
  v: number;
  kdf: { name: string; N: number; r: number; p: number; salt: string };
  cipher: string;
  iv: string;
  tag: string;
  ct: string;
}

function deriveKey(passphrase: string, salt: Buffer, N: number, r: number, p: number): Buffer {
  return scryptSync(passphrase, salt, SCRYPT.keylen, { N, r, p, maxmem: SCRYPT.maxmem });
}

export function encryptBundle(files: BundleFiles, passphrase: string): string {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new AppError("recovery.passphrase_too_short", { min: MIN_PASSPHRASE_LENGTH });
  }
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(files), "utf8")), cipher.final()]);
  const envelope: Envelope = {
    v: ENVELOPE_VERSION,
    kdf: { name: "scrypt", N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString("base64") },
    cipher: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ct: ct.toString("base64"),
  };
  return JSON.stringify(envelope);
}

function parseEnvelope(envelopeJson: string): Envelope {
  let env: unknown;
  try {
    env = JSON.parse(envelopeJson);
  } catch {
    throw new AppError("recovery.bundle_invalid", { reason: "not_json" });
  }
  const e = env as Partial<Envelope>;
  const kdf = e.kdf as Partial<Envelope["kdf"]> | undefined;
  if (
    e.v !== ENVELOPE_VERSION ||
    e.cipher !== "aes-256-gcm" ||
    kdf?.name !== "scrypt" ||
    typeof kdf.salt !== "string" ||
    typeof e.iv !== "string" ||
    typeof e.tag !== "string" ||
    typeof e.ct !== "string" ||
    !Number.isInteger(kdf.N) ||
    !Number.isInteger(kdf.r) ||
    !Number.isInteger(kdf.p) ||
    (kdf.N as number) < 2 ||
    (kdf.N as number) > MAX_SCRYPT_N ||
    (kdf.r as number) < 1 ||
    (kdf.r as number) > 32 ||
    (kdf.p as number) < 1 ||
    (kdf.p as number) > 16
  ) {
    throw new AppError("recovery.bundle_invalid", { reason: "malformed" });
  }
  return e as Envelope;
}

export function decryptBundle(envelopeJson: string, passphrase: string): BundleFiles {
  const env = parseEnvelope(envelopeJson);
  const key = deriveKey(
    passphrase,
    Buffer.from(env.kdf.salt, "base64"),
    env.kdf.N,
    env.kdf.r,
    env.kdf.p,
  );
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(env.iv, "base64"));
  decipher.setAuthTag(Buffer.from(env.tag, "base64"));
  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(Buffer.from(env.ct, "base64")), decipher.final()]);
  } catch {
    // GCM authentication failed: wrong passphrase OR tampered bundle — deliberately one code.
    throw new AppError("recovery.passphrase_invalid", {});
  }
  return JSON.parse(plaintext.toString("utf8")) as BundleFiles;
}
```

- [ ] **Step 5: Run tests to green**

Run: `pnpm --filter @waitron/server test recovery-bundle`
Expected: PASS (all 8).

- [ ] **Step 6: Prove the DoS-guard and tamper tests by deletion**

Temporarily change the `kdf.N` upper-bound check to `> 2 ** 40`, re-run — the DoS test must FAIL. Restore. Temporarily replace the `decipher.final()` `catch` body with `throw new AppError("recovery.bundle_invalid", { reason: "x" })` — the wrong-passphrase and tamper tests must FAIL on the wrong code. Restore, re-run green (CLAUDE.md §4 "prove a guard by deletion").

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/recovery-bundle.ts apps/server/src/recovery-bundle.test.ts apps/server/src/errors.ts
git commit -s -m "feat(onboarding): recovery-bundle crypto envelope (scrypt + AES-256-GCM) (4b-i)"
```

---

## Task 2: State-dir secret gathering + unpack (`state-secrets.ts`)

**Files:**
- Create: `apps/server/src/state-secrets.ts`
- Create: `apps/server/src/state-secrets.test.ts`
- Modify: `apps/server/src/errors.ts` (add one code)

**Interfaces:**
- Consumes: `BundleFiles` from `./recovery-bundle.js`; `writeFileAtomic` from `./fs-atomic.js`; Node `node:fs/promises`, `node:path`; `AppError`.
- Produces: `RECOVERY_FILES: readonly string[]`; `collectStateSecrets(stateDir: string): Promise<BundleFiles>`; `unpackBundleToDir(files: BundleFiles, destDir: string): Promise<void>`.
- Error code thrown: `recovery.state_incomplete` `{ missing: string }`.

- [ ] **Step 1: Declare the error code** in `apps/server/src/errors.ts`:

```typescript
    /** The box is missing one of its own persisted secret files, so a complete recovery bundle
     * cannot be built. `missing` is the state-dir-relative path (e.g. `secrets.env`). A server
     * fault, not a client error: the box has lost part of its own unrecoverable state. */
    "recovery.state_incomplete": { missing: string };
```

- [ ] **Step 2: Write the failing test**

Create `apps/server/src/state-secrets.test.ts`:

```typescript
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { RECOVERY_FILES, collectStateSecrets, unpackBundleToDir } from "./state-secrets.js";

/** Materialise a state dir holding every RECOVERY_FILES path with recognisable contents. */
async function seedStateDir(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "state-secrets-"));
  await mkdir(join(dir, "tls"), { recursive: true });
  for (const rel of RECOVERY_FILES) {
    await writeFile(join(dir, rel), `contents-of-${rel}\n`, { mode: 0o600 });
  }
  return dir;
}

describe("state-secrets", () => {
  it("gathers exactly the RECOVERY_FILES set, keyed by relative posix path", async () => {
    const dir = await seedStateDir();
    const files = await collectStateSecrets(dir);
    expect(Object.keys(files).sort()).toEqual([...RECOVERY_FILES].sort());
    expect(files["secrets.env"]).toBe("contents-of-secrets.env\n");
    expect(files["tls/ca.crt"]).toBe("contents-of-tls/ca.crt\n");
  });

  it("throws recovery.state_incomplete naming the first missing file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "state-secrets-empty-"));
    await expect(collectStateSecrets(dir)).rejects.toThrow(
      new AppError("recovery.state_incomplete", { missing: "secrets.env" }),
    );
  });

  it("unpacks a bundle to a dir with 0600 files and a tls/ subdir, round-tripping contents", async () => {
    const src = await seedStateDir();
    const files = await collectStateSecrets(src);
    const dest = mkdtempSync(join(tmpdir(), "state-secrets-out-"));
    await unpackBundleToDir(files, dest);
    for (const rel of RECOVERY_FILES) {
      expect(await readFile(join(dest, rel), "utf8")).toBe(files[rel]);
      expect((await stat(join(dest, rel))).mode & 0o777).toBe(0o600);
    }
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @waitron/server test state-secrets`
Expected: FAIL — `Cannot find module './state-secrets.js'`.

- [ ] **Step 4: Implement `state-secrets.ts`**

Create `apps/server/src/state-secrets.ts`:

```typescript
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AppError } from "@waitron/shared";
import { BundleFiles } from "./recovery-bundle.js";
import { writeFileAtomic } from "./fs-atomic.js";
import "./errors.js";

/**
 * The fixed set of state-dir secret/identity files a recovery bundle carries — the box's UNRECOVERABLE
 * material (the vault master key in `secrets.env`), its fiscal identity (`trading.env`), and the CA +
 * leaf that let a restored box keep the same trusted identity so already-trusting devices need not
 * re-trust. Relative to `stateDir`, posix-slashed. NOT the database — that is a separate scheduled
 * backup (slice 4b-ii). The layout mirrors `box-secrets.ts`/`trading-config.ts` which WROTE these.
 */
export const RECOVERY_FILES = [
  "secrets.env",
  "trading.env",
  "tls/ca.crt",
  "tls/ca.key",
  "tls/server.crt",
  "tls/server.key",
] as const;

/**
 * Read every `RECOVERY_FILES` path under `stateDir` into a `BundleFiles` map. A missing file is a
 * fatal `recovery.state_incomplete` (a bundle without the vault key is worthless — fail loud, name
 * the file), not a silently short bundle. Any other read error propagates unchanged.
 */
export async function collectStateSecrets(stateDir: string): Promise<BundleFiles> {
  const files: BundleFiles = {};
  for (const rel of RECOVERY_FILES) {
    try {
      files[rel] = await readFile(join(stateDir, rel), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new AppError("recovery.state_incomplete", { missing: rel });
      }
      throw err;
    }
  }
  return files;
}

/**
 * Write a decrypted `BundleFiles` map back under `destDir` — the inverse of `collectStateSecrets`,
 * used by the `waitron-recovery unpack` CLI and by tests. Each file is created 0600 via
 * `writeFileAtomic` (temp-then-rename, so a reader never sees a torn file), and any parent (`tls/`)
 * is made 0700 first. Keys are trusted here (a decrypted bundle we just authenticated), so no path
 * traversal guard beyond joining under `destDir`.
 */
export async function unpackBundleToDir(files: BundleFiles, destDir: string): Promise<void> {
  for (const [rel, contents] of Object.entries(files)) {
    const target = join(destDir, rel);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFileAtomic(target, contents, 0o600);
  }
}
```

Note: import `BundleFiles` as a value-style `import { BundleFiles }` will trip `verbatimModuleSyntax` if the repo uses it — check `apps/server/tsconfig`; if so, use `import { type BundleFiles }`. Verify with `pnpm --filter @waitron/server typecheck`.

- [ ] **Step 5: Run tests to green**

Run: `pnpm --filter @waitron/server test state-secrets`
Expected: PASS (3).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/state-secrets.ts apps/server/src/state-secrets.test.ts apps/server/src/errors.ts
git commit -s -m "feat(onboarding): gather + unpack state-dir secrets for the recovery bundle (4b-i)"
```

---

## Task 3: `waitron-recovery unpack` CLI (`bin-recovery.ts`)

**Files:**
- Create: `apps/server/src/bin-recovery.ts`
- Create: `apps/server/src/bin-recovery.test.ts`
- Modify: `apps/server/package.json` (register the bin, mirroring the existing `waitron-*` bins)

**Interfaces:**
- Consumes: `decryptBundle` (`./recovery-bundle.js`), `unpackBundleToDir` (`./state-secrets.js`).
- Produces: an exported `runRecoveryUnpack(argv: string[], env: NodeJS.ProcessEnv): Promise<void>` the thin `#!/usr/bin/env node` wrapper calls, so the logic is unit-testable without spawning a process.

- [ ] **Step 1: Inspect an existing bin's package.json wiring**

Run: `grep -n "bin-sync\|\"bin\"\|waitron-sync" apps/server/package.json`
Confirm the `"bin"` map + build shape you must mirror for `waitron-recovery` → `dist/bin-recovery.js`.

- [ ] **Step 2: Write the failing test**

Create `apps/server/src/bin-recovery.test.ts`:

```typescript
import { mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encryptBundle, type BundleFiles } from "./recovery-bundle.js";
import { runRecoveryUnpack } from "./bin-recovery.js";

const FILES: BundleFiles = { "secrets.env": "WAITRON_CREDENTIALS_KEY=k\n", "tls/ca.crt": "PEM\n" };
const PASS = "correct horse battery";

describe("waitron-recovery unpack", () => {
  it("decrypts an envelope file and writes its contents under destDir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bin-recovery-"));
    const envPath = join(dir, "bundle.wrb");
    await writeFile(envPath, encryptBundle(FILES, PASS));
    const dest = join(dir, "out");
    await runRecoveryUnpack(["unpack", envPath, dest], { WAITRON_RECOVERY_PASSPHRASE: PASS });
    expect(await readFile(join(dest, "secrets.env"), "utf8")).toBe(FILES["secrets.env"]);
    expect(await readFile(join(dest, "tls/ca.crt"), "utf8")).toBe(FILES["tls/ca.crt"]);
  });

  it("rejects a missing passphrase env var", async () => {
    await expect(runRecoveryUnpack(["unpack", "x", "y"], {})).rejects.toThrow(
      /WAITRON_RECOVERY_PASSPHRASE/,
    );
  });

  it("rejects an unknown subcommand", async () => {
    await expect(runRecoveryUnpack(["frobnicate"], {})).rejects.toThrow(/usage/i);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @waitron/server test bin-recovery`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `bin-recovery.ts`**

Create `apps/server/src/bin-recovery.ts`:

```typescript
#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { decryptBundle } from "./recovery-bundle.js";
import { unpackBundleToDir } from "./state-secrets.js";

/**
 * `waitron-recovery unpack <envelope-file> <dest-dir>` — decrypt a downloaded recovery bundle and
 * write its files under `dest-dir`. The passphrase comes from `WAITRON_RECOVERY_PASSPHRASE` (never an
 * argv, which leaks into the process table). Exported so the flow is unit-tested without a subprocess;
 * the module's bottom invokes it only when run as the entry point. The full "re-provision a fresh box
 * from these files" procedure is the 4b-iii runbook — this only recovers the files.
 */
export async function runRecoveryUnpack(argv: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const [cmd, envelopePath, destDir] = argv;
  if (cmd !== "unpack" || envelopePath === undefined || destDir === undefined) {
    throw new Error("usage: waitron-recovery unpack <envelope-file> <dest-dir>");
  }
  const passphrase = env.WAITRON_RECOVERY_PASSPHRASE;
  if (passphrase === undefined || passphrase === "") {
    throw new Error("WAITRON_RECOVERY_PASSPHRASE must be set to the bundle's passphrase");
  }
  const files = decryptBundle(await readFile(envelopePath, "utf8"), passphrase);
  await unpackBundleToDir(files, destDir);
}

// Invoked as the bin entry point (not when imported by a test). `import.meta.url` ends with this
// module's path only when it is the process entry; the guard keeps the test import side-effect-free.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  runRecoveryUnpack(process.argv.slice(2), process.env).catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 5: Register the bin** in `apps/server/package.json` — add to the `"bin"` map, mirroring the sibling `waitron-sync-*` entries exactly (same `dist/…js` shape):

```json
    "waitron-recovery": "dist/bin-recovery.js"
```

- [ ] **Step 6: Run tests to green**

Run: `pnpm --filter @waitron/server test bin-recovery`
Expected: PASS (3).

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/bin-recovery.ts apps/server/src/bin-recovery.test.ts apps/server/package.json
git commit -s -m "feat(onboarding): waitron-recovery unpack CLI (4b-i)"
```

---

## Task 4: The download route (`recovery-bundle-api.ts`)

**Files:**
- Create: `apps/server/src/recovery-bundle-api.ts`
- Create: `apps/server/src/recovery-bundle-api.test.ts`
- Modify: `apps/server/src/errors.ts` (add one code)

**Interfaces:**
- Consumes: `collectStateSecrets` (`./state-secrets.js`), `encryptBundle`/`decryptBundle` (`./recovery-bundle.js`), `requireManagementSession` (`./management-session.js`), `createErrorBoundary` (`./error-boundary.js`), `readJsonBody` (`./read-json-body.js`), `authorizeManager` (`@waitron/identity`), `asAppUser`/`withTenant`/`Database` (`@waitron/db`), `Logger` (`./logger.js`), `Hono`, `ContentfulStatusCode`.
- Produces: `type RecoveryBundleDeps = { db: Database; cfg: { tenantId: string }; stateDir: string; now: () => Date }`; `mountRecoveryBundleApi(app: Hono, deps: RecoveryBundleDeps, log: Logger): void` registering `POST /api/box/recovery-bundle`.
- Error code thrown: `recovery.passphrase_required` `Record<string, never>`.

- [ ] **Step 1: Declare the error code** in `apps/server/src/errors.ts`:

```typescript
    /** The recovery-bundle download request carried no `passphrase` string (or an empty one). A
     * client error — the operator must supply the passphrase the bundle will be encrypted under. */
    "recovery.passphrase_required": Record<string, never>;
```

- [ ] **Step 2: Write the failing test**

Create `apps/server/src/recovery-bundle-api.test.ts`. It mirrors `box-status.route.test.ts`'s manager-login scaffolding (real Postgres — the route authorizes under RLS) and additionally seeds a state dir on disk, then proves the DOWNLOADED bytes decrypt back to those files.

```typescript
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { mountManagementApi } from "./management-api.js";
import { mountRecoveryBundleApi } from "./recovery-bundle-api.js";
import { decryptBundle } from "./recovery-bundle.js";
import { RECOVERY_FILES } from "./state-secrets.js";

const LOCALE = "es-ES";
const PASSWORD = "correct horse"; // the seeded manager's dashboard password
const BUNDLE_PASS = "recovery pass phrase"; // ≥ MIN_PASSPHRASE_LENGTH

const suite = useTemplateDb({ template: "manifest" });

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(74_000_000 + nifCounter).padStart(8, "0")}K`;
}

// Same manager-login scaffolding as box-status.route.test.ts.
async function setupTenant(): Promise<{ tenantId: string; managerId: string }> {
  const venue = await applyVenue(
    planVenue({
      country: "ES",
      taxId: nextNif(),
      legalName: "Deli Test SL",
      location: {
        name: "Sala principal",
        fiscalTerritory: "ES-common",
        invoiceLocales: [LOCALE],
        operationDescription: "Venta en establecimiento",
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
      },
      tillName: "Caja 1",
      seriesCode: "A",
      rectificativeSeriesCode: "R",
      admin: {
        displayName: "Administradora",
        pinHash: hashPin("1234"),
        passwordHash: hashPassword("dashPass123"),
      },
    }),
    { db: suite.admin },
  );
  const managerId = await withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    const m = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, password_hash, role)
      values (current_tenant_id(), 'The Manager', ${hashPin("1234")}, ${hashPassword(PASSWORD)}, 'manager')
      returning id`);
    return m.rows[0]!.id;
  });
  return { tenantId: venue.tenantId, managerId };
}

async function seedStateDir(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "recovery-state-"));
  await mkdir(join(dir, "tls"), { recursive: true });
  for (const rel of RECOVERY_FILES) await writeFile(join(dir, rel), `contents-of-${rel}\n`);
  return dir;
}

function buildApp(tenantId: string, stateDir: string): Hono {
  const app = new Hono();
  mountManagementApi(
    app,
    { db: suite.admin, cfg: { tenantId }, secureCookies: false, rpId: "localhost", origin: "http://localhost" },
    () => {},
  );
  mountRecoveryBundleApi(
    app,
    { db: suite.admin, cfg: { tenantId }, stateDir, now: () => new Date("2026-08-29T10:00:00Z") },
    () => {},
  );
  return app;
}

async function login(app: Hono, personId: string): Promise<string> {
  const res = await app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ personId, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

describe("POST /api/box/recovery-bundle (real postgres)", () => {
  let app: Hono;
  let cookie: string;

  beforeAll(async () => {
    const { tenantId, managerId } = await setupTenant();
    app = buildApp(tenantId, await seedStateDir());
    cookie = await login(app, managerId);
  });

  it("401s without a management session", async () => {
    const res = await app.request("/api/box/recovery-bundle", { method: "POST" });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "management_session.required" } });
  });

  it("400s when no passphrase is supplied", async () => {
    const res = await app.request("/api/box/recovery-bundle", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "recovery.passphrase_required" } });
  });

  it("400s on a too-short passphrase", async () => {
    const res = await app.request("/api/box/recovery-bundle", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ passphrase: "short" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "recovery.passphrase_too_short" } });
  });

  it("returns an attachment whose bytes decrypt back to the state-dir secrets", async () => {
    const res = await app.request("/api/box/recovery-bundle", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ passphrase: BUNDLE_PASS }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="waitron-recovery-/);
    const files = decryptBundle(await res.text(), BUNDLE_PASS);
    expect(Object.keys(files).sort()).toEqual([...RECOVERY_FILES].sort());
    expect(files["secrets.env"]).toBe("contents-of-secrets.env\n");
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @waitron/server test recovery-bundle-api`
Expected: FAIL — `mountRecoveryBundleApi` not found.

- [ ] **Step 4: Implement `recovery-bundle-api.ts`**

Create `apps/server/src/recovery-bundle-api.ts` (gating pattern copied verbatim from `box-status.ts`; file response copied from `discovery-api.ts`'s `c.body(pem, 200, {…attachment…})`):

```typescript
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { asAppUser, withTenant, type Database } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { collectStateSecrets } from "./state-secrets.js";
import { encryptBundle } from "./recovery-bundle.js";
import { requireManagementSession } from "./management-session.js";
import { createErrorBoundary } from "./error-boundary.js";
import { readJsonBody } from "./read-json-body.js";
import type { Logger } from "./logger.js";
import "./errors.js";

export type RecoveryBundleDeps = {
  db: Database;
  cfg: { tenantId: string };
  /** The box's persisted state dir — the secret files the bundle packs live here (`config.stateDir`). */
  stateDir: string;
  now: () => Date;
};

/**
 * Code→HTTP status for this route. The management gate's codes match `box-status.ts` exactly (401/403).
 * `recovery.passphrase_required` and `recovery.passphrase_too_short` are client errors (400).
 * `recovery.state_incomplete` is deliberately ABSENT — a box missing its own secret files is a server
 * fault, so the boundary answers it (and any other throw) with an opaque 500.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "recovery.passphrase_required": 400,
  "recovery.passphrase_too_short": 400,
};

/**
 * `POST /api/box/recovery-bundle` — download the box's passphrase-encrypted recovery bundle. Gated
 * exactly like `GET /api/box/status`: `requireManagementSession` → 401, then `withTenant` + `asAppUser`
 * + `authorizeManager("till.configure")`. The passphrase rides the JSON body (never the URL/query — it
 * is a secret). The bundle carries the box's UNRECOVERABLE state (vault master key + fiscal identity +
 * CA/leaf), so it is streamed as an attachment and logged (session id only, never the passphrase or
 * any secret). POST, not GET: it carries a secret and produces a sensitive artifact.
 */
export function mountRecoveryBundleApi(app: Hono, deps: RecoveryBundleDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "recovery-bundle.failed");
  app.post("/api/box/recovery-bundle", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c); // throws 401 if absent
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await authorizeManager(tx, { managementSessionId: sessionId, permission: "till.configure" });
      });
      const body = await readJsonBody<{ passphrase?: unknown }>(c);
      if (typeof body.passphrase !== "string" || body.passphrase === "") {
        throw new AppError("recovery.passphrase_required", {});
      }
      // encryptBundle enforces MIN_PASSPHRASE_LENGTH (→ recovery.passphrase_too_short, 400).
      const envelope = encryptBundle(await collectStateSecrets(deps.stateDir), body.passphrase);
      const date = deps.now().toISOString().slice(0, 10);
      log("info", "recovery.bundle_downloaded", { sessionId });
      return c.body(envelope, 200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="waitron-recovery-${date}.wrb"`,
      });
    }),
  );
}
```

- [ ] **Step 5: Verify `authorizeManager`'s exact call shape**

Run: `grep -n "export async function authorizeManager\|export function authorizeManager" packages/identity/src/*.ts` and confirm the `{ managementSessionId, permission }` argument object matches `box-status.ts:130`. Adjust the call if the signature differs.

- [ ] **Step 6: Run tests to green**

Run: `pnpm --filter @waitron/server test recovery-bundle-api`
Expected: PASS (4).

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/recovery-bundle-api.ts apps/server/src/recovery-bundle-api.test.ts apps/server/src/errors.ts
git commit -s -m "feat(onboarding): POST /api/box/recovery-bundle download route (4b-i)"
```

---

## Task 5: Mount the recovery route in the trading boot

**Files:**
- Modify: `apps/server/src/boot.ts` (mount beside `mountBoxStatusApi`)
- Modify: `apps/server/src/boot.test.ts` (assert the route is reachable / gated)

**Interfaces:**
- Consumes: `mountRecoveryBundleApi` (`./recovery-bundle-api.js`); the already-in-scope `app`, `db`, `till.tenantId`, `config.stateDir`, `now`, `log`.

- [ ] **Step 1: Add a failing boot assertion**

In `apps/server/src/boot.test.ts`, find the trading-boot test that exercises mounted routes (the one that boots a real server / app and requests a path). Add an assertion that `POST /api/box/recovery-bundle` **without** a session returns 401 (proving it is mounted + gated), mirroring how the box-status route's presence is asserted there. If `boot.test.ts` has no such request harness, add the assertion to whichever existing trading-boot test issues HTTP requests against the booted app; use its existing request helper.

Run: `pnpm --filter @waitron/server test boot` → the new assertion FAILs (route unmounted → 404, not 401).

- [ ] **Step 2: Mount the route**

In `apps/server/src/boot.ts`, immediately after the `mountBoxStatusApi(app, { … }, log);` call (ends `boot.ts:1065`), add:

```typescript
  // The recovery-bundle download (slice 4b-i): the same management gate as box-status, packing the
  // box's persisted secret files (config.stateDir) into a passphrase-encrypted bundle. Mounted in the
  // trading branch only — a setup box has no provisioned identity to recover.
  mountRecoveryBundleApi(
    app,
    { db, cfg: { tenantId: till.tenantId }, stateDir: config.stateDir, now },
    log,
  );
```

Add the import beside the existing `import { mountBoxStatusApi } from "./box-status.js";` (`boot.ts:79`):

```typescript
import { mountRecoveryBundleApi } from "./recovery-bundle-api.js";
```

- [ ] **Step 3: Run to green**

Run: `pnpm --filter @waitron/server test boot`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/boot.ts apps/server/src/boot.test.ts
git commit -s -m "feat(onboarding): mount the recovery-bundle route in trading boot (4b-i)"
```

---

## Task 6: Follow-up (ii) — surface `singletonRole` in box-status

**Files:**
- Modify: `apps/server/src/box-status.ts`
- Modify: `apps/server/src/boot.ts` (wire the reader)
- Modify: `apps/server/src/box-status.test.ts`, `box-status.route.test.ts`, `box-status.replication.test.ts` (thread reader + assert)

**Interfaces:**
- Consumes: `SingletonRole` from `@waitron/db`; `singletonRoleHolder` (already in scope in `boot.ts:648`).
- Produces: `BoxStatus.singletonRole: SingletonRole`; `BoxStatusReaders.singletonRole: () => Promise<SingletonRole>`; `BoxStatusDeps.readSingletonRole: () => SingletonRole`.

- [ ] **Step 1: Extend the unit test (failing)**

`box-status.test.ts` shares a `const base: BoxStatusReaders = { … }` object every case spreads. Make three edits:

1. Add `singletonRole: async () => "primary",` to `base` (beside `mode`).
2. In the existing "composes every field" case, add `singletonRole: "primary",` to its `toEqual({ … })` literal (it asserts the WHOLE object, so it fails without the new field).
3. Add a focused case (spread `base`, don't re-specify readers):

```typescript
it("passes singletonRole through from its reader", async () => {
  const status = await collectBoxStatus({ ...base, singletonRole: async () => "secondary" });
  expect(status.singletonRole).toBe("secondary");
});
```

For reference, the file's `base` uses `time: async () => ({ synced: true, source: "timedatectl", warn: false })` and `chain: async () => ({ height: 7, lastAt: "…" })` — the real `TimeHealth` (`{ synced, source, warn }`) and `ChainHeight` (`{ height, lastAt }`) shapes; do not invent others.

Run: `pnpm --filter @waitron/server test box-status.test` → FAIL (`singletonRole` not on the type; `base` + `toEqual` don't compile/match until Step 2).

- [ ] **Step 2: Extend `box-status.ts`**

- Add to the `BoxStatus` type (after `chain`): `singletonRole: SingletonRole;`
- Import the type: extend the `@waitron/db` import with `type SingletonRole`.
- Add to `BoxStatusReaders`: `singletonRole: () => Promise<SingletonRole>;`
- In `collectBoxStatus`, add `readers.singletonRole()` to the `Promise.all` destructure and include `singletonRole` in the returned object:

```typescript
  const [mode, time, chain, singletonRole] = await Promise.all([
    readers.mode(),
    readers.time(),
    readers.chain(),
    readers.singletonRole(),
  ]);
```
  …and `singletonRole,` in the return literal.
- Add to `BoxStatusDeps`: `readSingletonRole: () => SingletonRole;`
- In `mountBoxStatusApi`'s `collectBoxStatus({…})` call, add: `singletonRole: () => Promise.resolve(deps.readSingletonRole()),`

- [ ] **Step 3: Wire the reader in `boot.ts`**

In the `mountBoxStatusApi(app, { … }, log)` deps object (`boot.ts:1048`), add beside `readMode`:

```typescript
      // The live singleton role (primary/secondary), read per-request from the same holder the
      // duty loop reads — box-status now shows BOTH deployment axes (mode + singleton_role, #158).
      readSingletonRole: () => singletonRoleHolder.current,
```

- [ ] **Step 4: Update the two real-PG route suites**

In `box-status.route.test.ts` and `box-status.replication.test.ts`, add `readSingletonRole: () => "primary",` to each `buildApp` `mountBoxStatusApi` deps object, and extend the happy-path body assertion with `expect(body.singletonRole).toBe("primary");`.

- [ ] **Step 5: Run to green**

Run: `pnpm --filter @waitron/server test box-status`
Expected: PASS (all box-status suites).

- [ ] **Step 6: Prove by deletion**

Remove `singletonRole` from `collectBoxStatus`'s return literal, re-run — the unit + route assertions FAIL. Restore, green.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/box-status.ts apps/server/src/boot.ts apps/server/src/box-status.test.ts apps/server/src/box-status.route.test.ts apps/server/src/box-status.replication.test.ts
git commit -s -m "feat(onboarding): surface singleton_role in box-status (4a follow-up ii)"
```

---

## Task 7: Follow-up (iii) — pin replication fail-loud

**Files:**
- Modify: `apps/server/src/box-status.test.ts`

**Interfaces:** consumes `collectBoxStatus`.

- [ ] **Step 1: Write the failing/guarding test**

`collectBoxStatus` already lets a `replicationLag` reader rejection propagate (unlike `cert`, which has a try/catch fallback) — a lag-read fault must 500, never fall back to a false-healthy `{configured:false}`. Spread the shared `base` (which by now carries `singletonRole` from Task 6) and override only `replicationLag`. Add to `box-status.test.ts`:

```typescript
it("propagates a replicationLag reader fault (fail-loud, no configured:false fallback)", async () => {
  await expect(
    collectBoxStatus({ ...base, replicationLag: () => Promise.reject(new Error("lag read failed")) }),
  ).rejects.toThrow("lag read failed");
});
```

- [ ] **Step 2: Run — it should already PASS** (the code is already fail-loud). This test PINS that behaviour.

Run: `pnpm --filter @waitron/server test box-status.test`
Expected: PASS.

- [ ] **Step 3: Prove it guards the behaviour**

Temporarily wrap the `replicationLag` block in `collectBoxStatus` in a `try { … } catch { replication = { configured: false }; }`. Re-run — this test must FAIL (it would now resolve, not reject). Restore. Re-run green. This is the regression the test exists to catch.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/box-status.test.ts
git commit -s -m "test(onboarding): pin box-status replication fail-loud (4a follow-up iii)"
```

---

## Task 8: Follow-up (iv) — fractional-day cert-expiry cases

**Files:**
- Modify: `apps/server/src/cert-expiry.test.ts`

**Interfaces:** consumes `readCertExpiry`, `FIXTURE_CERT_PEM` (`./testing/tls-fixture.js`).

`readCertExpiry` floors: `daysRemaining = Math.floor((notAfter - now)/86_400_000)`. The fixture's `notAfter` is `2036-08-26T13:07:51.000Z` (per `box-status.route.test.ts:187`).

- [ ] **Step 1: Read the existing test** for how it writes the PEM to a temp path + calls `readCertExpiry`. Reuse that harness.

- [ ] **Step 2: Add the fractional-day cases**

```typescript
it("floors a fractional remaining day (1.5 days → 1)", async () => {
  // 2036-08-25T01:07:51Z is 1.5 days before the fixture notAfter.
  const c = await readCertExpiry(certPath, new Date("2036-08-25T01:07:51.000Z"));
  expect(c.daysRemaining).toBe(1);
});

it("floors sub-day remaining to 0 (~12h left)", async () => {
  const c = await readCertExpiry(certPath, new Date("2036-08-26T01:07:51.000Z"));
  expect(c.daysRemaining).toBe(0);
});

it("returns a negative daysRemaining for an already-expired leaf", async () => {
  // 2h after notAfter → -0.083 day → floor -1.
  const c = await readCertExpiry(certPath, new Date("2036-08-26T15:07:51.000Z"));
  expect(c.daysRemaining).toBe(-1);
});
```

(If the existing test's `certPath` is a local `const` inside a single `it`, hoist the PEM-write into a `beforeAll`/shared `certPath` so these three can reuse it — matching the fixture pattern in `box-status.route.test.ts:172-173`.)

- [ ] **Step 3: Run to green**

Run: `pnpm --filter @waitron/server test cert-expiry`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/cert-expiry.test.ts
git commit -s -m "test(onboarding): fractional-day cert-expiry cases (4a follow-up iv)"
```

---

## Task 9: Follow-up (i) — real `sync_tailer`-pool `withTenant` prove-by-deletion

**Files:**
- Create: `apps/server/src/box-status.replication.tailer.test.ts`

**Interfaces:** consumes `lagFor` (`@waitron/sync`), `withTenant` (`@waitron/db`), `useTemplateDb` + `suite.pg.connectAs` (`@waitron/db/testing/lifecycle.js`), `applyVenue`/`planVenue` (`@waitron/provisioning`).

**Why this exists:** the box-status replication summary reader is, in `boot.ts:1058`, `() => withTenant(lagPool, till.tenantId, (tx) => lagFor(tx))`, where `lagPool` connects as a `sync_tailer + app_user` member. Today `box-status.replication.test.ts` drives `lagFor(suite.admin)` — the OWNER, RLS-bypassed — so it cannot show that the `withTenant` wrap is load-bearing. `packages/sync`'s `retention.gate.test.ts` guards the semantic but in that package, not through the shape boot uses. This test closes that gap: a real `sync_applier` pool (apps/server's global-setup already creates `sync_applier` = `app_user` + `sync_tailer`, password `ap`), proving `withTenant`-wrapped `lagFor` sees the tenant's rows while a **bare** `lagFor` sees zero (false-healthy lag 0) — the exact false-healthy `boot.ts:1034-1046` warns about.

- [ ] **Step 1: Write the test**

Create `apps/server/src/box-status.replication.tailer.test.ts`:

```typescript
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { lagFor } from "@waitron/sync";

// Real Postgres, and specifically a REAL sync_tailer member (sync_applier), not the owner: FORCE RLS
// on sync_log only bites a non-superuser, so this is the one connection shape that can show the
// withTenant wrap is load-bearing. Owner reads (box-status.replication.test.ts) bypass RLS and can't.
const ORIGIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const suite = useTemplateDb({ template: "manifest" });

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(75_000_000 + nifCounter).padStart(8, "0")}K`;
}

async function setupTenant(): Promise<string> {
  const venue = await applyVenue(
    planVenue({
      country: "ES",
      taxId: nextNif(),
      legalName: "Deli Test SL",
      location: {
        name: "Sala principal",
        fiscalTerritory: "ES-common",
        invoiceLocales: ["es-ES"],
        operationDescription: "Venta en establecimiento",
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
      },
      tillName: "Caja 1",
      seriesCode: "A",
      rectificativeSeriesCode: "R",
      admin: {
        displayName: "Administradora",
        pinHash: hashPin("1234"),
        passwordHash: hashPassword("dashPass123"),
      },
    }),
    { db: suite.admin },
  );
  // One sync_log row at seq 10 for this tenant; one cursor at 3 → lag 7 under the tenant, 0 without.
  await suite.admin.execute(
    sql`insert into sync_log (seq, origin_id, table_name, op, tenant_id, row_image)
        overriding system value
        values (10, ${ORIGIN}::uuid, 'products', 'insert', ${venue.tenantId}::uuid, '{}'::jsonb)`,
  );
  await suite.admin.execute(
    sql`insert into sync_cursor (subscriber_id, origin_id, last_applied_seq, alive, lane)
        values ('s1', ${ORIGIN}::uuid, 3, true, 'ordered')`,
  );
  return venue.tenantId;
}

describe("box-status replication reader through a real sync_tailer pool", () => {
  let tailer: Database | undefined;
  let tenantId: string;

  beforeAll(async () => {
    tenantId = await setupTenant();
    tailer = await suite.pg.connectAs("sync_applier", "ap"); // app_user + sync_tailer member
  });

  afterAll(async () => {
    if (tailer !== undefined) await tailer.close(); // guarded teardown (CLAUDE.md §4)
  });

  it("withTenant-wrapped lagFor sees the tenant's real lag", async () => {
    const lags = await withTenant(tailer!, tenantId, (tx) => lagFor(tx));
    expect(lags[0]?.lag).toBe(7n);
  });

  it("bare lagFor (no tenant context) reads a false-healthy lag 0 — the wrap is load-bearing", async () => {
    const lags = await lagFor(tailer!);
    for (const l of lags) expect(l.lag).toBe(0n);
  });
});
```

- [ ] **Step 2: Run it**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test box-status.replication.tailer`
Expected: PASS. The two cases DISAGREE (7n vs 0n) on the same pool + same seeded rows — the with/without-`withTenant` difference, which is the whole point.

- [ ] **Step 3: Confirm the disagreement is real (not both-zero)**

If the first case reads `0n` too, the seed's `tenant_id` did not match `withTenant`'s tenant, or `sync_applier` lacks `sync_log` SELECT — investigate before proceeding (a both-zero pass would prove nothing, CLAUDE.md §1). The second case reading `7n` would mean the bare call is NOT tenant-fenced — a real finding.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/box-status.replication.tailer.test.ts
git commit -s -m "test(onboarding): pin box-status lagFor withTenant through a real sync_tailer pool (4a follow-up i)"
```

---

## Task 10: Plan-completion sweep + docs

**Files:**
- Modify: `docs/backlog.md`

- [ ] **Step 1: Full gate**

Run: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm --filter @waitron/server test:coverage`
Fix anything red. Confirm `apps/server` coverage still meets 95/95/90/88.

- [ ] **Step 2: Update the backlog**

In `docs/backlog.md`, update the Slice 4 rows: **4b-i (recovery bundle + 4a follow-ups) LANDED** (with the PR number once merged); note **4b-ii** (scheduled `pg_dump` backup + box-status `backup` field — pg_dump chosen, WAL rejected) and **4b-iii** (cold-restore/fresh-chain runbook) are the remaining 4b work. Record that the recovery bundle carries `secrets.env` + `trading.env` + the `tls/` quartet (NOT the DB), passphrase-encrypted (scrypt + AES-256-GCM, 12-char floor), downloaded via `POST /api/box/recovery-bundle` and opened with `waitron-recovery unpack`.

- [ ] **Step 3: Commit**

```bash
git add docs/backlog.md
git commit -s -m "docs(backlog): recovery bundle (4b-i) landed; 4b-ii/4b-iii next"
```

---

## Self-Review notes (for the executor)

- **Spec coverage.** §12 free-tier "download your recovery bundle (vault key + box config), encrypted under an operator-held recovery phrase" → Tasks 1–5. The "or file" wrapping option was scoped OUT with the owner (passphrase only). Scheduled local DB backup + "last backup" status → **4b-ii** (out of this plan, recorded in Task 10). Break-glass admin recovery → 4c. Backlog 4a follow-ups i–iv → Tasks 9, 6, 7, 8.
- **Type consistency.** `BundleFiles` (Task 1) is consumed unchanged by Tasks 2–4. `collectStateSecrets`/`unpackBundleToDir` names are identical in Tasks 2, 3, 4. `RecoveryBundleDeps` (Task 4) matches the boot call (Task 5). `singletonRole`/`readSingletonRole` names are identical across Task 6's edits and its test updates.
- **Error codes:** `recovery.passphrase_too_short`, `recovery.passphrase_invalid`, `recovery.bundle_invalid` (Task 1), `recovery.state_incomplete` (Task 2), `recovery.passphrase_required` (Task 4) — all `recovery.*` domain-concept, declared in `apps/server/src/errors.ts`, thrown from files that `import "./errors.js"`.
- **Verify-don't-assume flags for the executor:** `authorizeManager`'s argument object (Task 4 Step 5); `verbatimModuleSyntax` on the `BundleFiles` value-import (Task 2 Step 4); the exact `"bin"` map shape (Task 3 Step 1); `box-status.test.ts`'s existing reader-object literal + `TimeHealth`/`ChainHeight` shapes (Tasks 6/7 — copy them, don't invent); `boot.test.ts`'s HTTP request harness (Task 5 Step 1).
