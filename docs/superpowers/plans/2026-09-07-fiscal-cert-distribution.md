# Fiscal Certificate Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a promoted cloud node file with AEAT — the standby receives the certificate at adopt wrapped under the break-glass secret and sealed dormant, unwraps it into the live `fiscal.aeat` row on promotion (or via a new unlock endpoint), a new install/replace endpoint doubles as the renewal path, and cloud nodes take the vault key from the environment so no snapshot/dump/backup yields a usable certificate.

**Architecture:** The AEAT cert is a `@waitron/credentials` vault row. `fiscal.aeat` and a new `fiscal.aeat.dormant` are **generic** credential purposes, so `apps/server` reads/writes them without importing the fiscal regime; only a *fresh* operator-supplied cert reaches the regime through the existing `FISCAL_SLOT.provisioningSecret.validate`/`seal` seat for `certKind` validation. The dormant copy is double-wrapped: the vault ring key opens the row to a scrypt+AES-GCM envelope that only the break-glass secret opens. All install/unlock endpoints are primary-only (the read-only gate refuses mirror writes). Cloud vault keys come from `WAITRON_CREDENTIALS_KEY` in the process environment; on-prem boxes keep the on-disk `secrets.env`.

**Tech Stack:** TypeScript, pnpm workspaces, Drizzle ORM, Postgres (PGlite + Testcontainers), Vitest, Hono, `node:crypto` (scrypt + AES-256-GCM).

**Spec:** [docs/superpowers/specs/2026-09-07-fiscal-cert-distribution-design.md](../specs/2026-09-07-fiscal-cert-distribution-design.md) — read it alongside this plan; the plan argues from it.

## Global Constraints

- **No new Spanish** identifiers or copy; the only Spanish (`sello`, `representante`) is unchanged and already in `FISCAL_VOCABULARY` (CLAUDE.md §3).
- **Error codes name the domain concept, never the throwing package**, and are never renamed once shipped (CLAUDE.md §3). New codes: `fiscal.certificate_dormant_missing`, `fiscal.certificate_unlock_failed`, `restore.credentials_key_external` — all declared in `apps/server/src/errors.ts` (`@waitron/server`).
- **`apps/server/src` imports no fiscal-regime package** outside the composition-provided contribution seat (`scripts/module-seams.test.ts`). `fiscal.aeat`/`fiscal.aeat.dormant` are generic `@waitron/credentials` purposes — using those purpose strings is not a regime import.
- **Every vault write validates before sealing**; a fresh operator cert is validated through the regime seat before any write (the mint is otherwise unrepairable — CLAUDE.md §5). The cert value/passphrase is **never** put in a log line or an `AppError` param.
- **Real Postgres (Testcontainers) for anything about privileges, triggers as the deployment role, or the two-node flow**; PGlite for hermetic crypto/logic (say why in a comment). Local real-PG needs `TESTCONTAINERS_RYUK_DISABLED=true`.
- **Every commit is `git commit -s`.** Per-package gate: `pnpm --filter <pkg> test:coverage`; cross-package sanity: `pnpm typecheck`. Coverage floors: the six fiscal/data packages (incl. `credentials`) are `98/98/98/95`; `@waitron/server` is `90/90/85/85`.
- **The break-glass secret is 32 base64url chars** (`generatePassword()`), clearing the envelope's `MIN_PASSPHRASE_LENGTH = 12`.

---

## File Structure

**New files (`@waitron/server` = apps/server):**
- `apps/server/src/secret-envelope.ts` — `encryptSecretEnvelope` / `decryptSecretEnvelope` (extracted from `recovery-bundle.ts`).
- `apps/server/src/fiscal-cert.ts` — generic cert-distribution logic: store dormant, read+unwrap dormant, seal live, delete corrupt dormant, read status.
- `apps/server/src/fiscal-cert-api.ts` — `POST /management-api/fiscal-certificate` (install/replace) and `.../unlock`.
- Their `*.test.ts` siblings, plus a two-node e2e `apps/server/src/fiscal-cert-distribution-e2e.test.ts`.

**Modified:**
- `packages/credentials/src/purposes.ts` (add dormant purpose), `.../classification.ts` (state→local).
- `packages/identity/src/permissions.ts` (add `fiscal.configure`).
- `apps/server/src/errors.ts`, `recovery-bundle.ts`, `mirror-bundle.ts`, `adopt.ts`, `promote.ts`, `promote-api.ts`, `box-status.ts`, `box-secrets.ts`, `state-secrets.ts`, `backup-sweep.ts`/`restore.ts` (manifest key), `boot.ts` (wiring).
- `apps/setup/src/screens/done-screen.ts` (break-glass copy).
- `docs/superpowers/specs/2026-08-29-promotion-runbook-design.md` (dated pointers).

---

## Task 1: Extract the shared secret-envelope primitive

**Files:**
- Create: `apps/server/src/secret-envelope.ts`
- Modify: `apps/server/src/recovery-bundle.ts`
- Test: `apps/server/src/secret-envelope.test.ts`

**Interfaces:**
- Produces: `encryptSecretEnvelope(plaintext: string, passphrase: string): string`, `decryptSecretEnvelope(envelopeJson: string, passphrase: string): string`, `MIN_PASSPHRASE_LENGTH`. Same scrypt KDF + AES-256-GCM + self-describing envelope + untrusted-input bounds as today's `encryptBundle`/`decryptBundle`; the envelope codes stay `recovery.passphrase_too_short` / `recovery.passphrase_invalid` / `recovery.bundle_invalid`.

This is a behaviour-preserving refactor: `recovery-bundle.ts`'s `encryptBundle`/`decryptBundle` become thin wrappers (`JSON.stringify(files)` → `encryptSecretEnvelope`, and `decryptSecretEnvelope` → parse+shape-check → `BundleFiles`). The envelope operates on an opaque `string`; the `BundleFiles` shape-validation stays in `recovery-bundle.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/secret-envelope.test.ts
import { describe, it, expect } from "vitest";
import { encryptSecretEnvelope, decryptSecretEnvelope } from "./secret-envelope.js";

// Hermetic crypto — PGlite/real PG not involved; no DB.
describe("secret envelope", () => {
  const pass = "a-sufficiently-long-passphrase"; // ≥ 12
  it("round-trips an arbitrary string", () => {
    const env = encryptSecretEnvelope('{"pfxBase64":"QQ==","passphrase":"x","certKind":"sello"}', pass);
    expect(decryptSecretEnvelope(env, pass)).toBe('{"pfxBase64":"QQ==","passphrase":"x","certKind":"sello"}');
  });
  it("throws recovery.passphrase_invalid for the wrong passphrase", () => {
    const env = encryptSecretEnvelope("secret", pass);
    expect(() => decryptSecretEnvelope(env, "another-long-passphrase")).toThrowError(/passphrase_invalid/);
  });
  it("rejects a too-short passphrase on encrypt", () => {
    expect(() => encryptSecretEnvelope("x", "short")).toThrowError(/passphrase_too_short/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/server test -- secret-envelope`
Expected: FAIL — `Cannot find module './secret-envelope.js'`.

- [ ] **Step 3: Create `secret-envelope.ts` by moving the envelope internals**

Move `MIN_PASSPHRASE_LENGTH`, `ENVELOPE_VERSION`, `MAX_SCRYPT_N`, `MAX_PLAINTEXT_BYTES`, `MAX_CT_BASE64_LENGTH`, `interface Envelope`, and `parseEnvelope` from `recovery-bundle.ts` into `secret-envelope.ts`. Add:

```ts
export function encryptSecretEnvelope(plaintext: string, passphrase: string): string {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new AppError("recovery.passphrase_too_short", { min: MIN_PASSPHRASE_LENGTH });
  }
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
  const envelope: Envelope = {
    v: ENVELOPE_VERSION,
    kdf: { name: "scrypt", N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p, salt: salt.toString("base64") },
    cipher: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ct: ct.toString("base64"),
  };
  return JSON.stringify(envelope);
}

export function decryptSecretEnvelope(envelopeJson: string, passphrase: string): string {
  const env = parseEnvelope(envelopeJson);
  let decipher: DecipherGCM;
  try {
    const key = deriveKey(passphrase, Buffer.from(env.kdf.salt, "base64"), {
      N: env.kdf.N, r: env.kdf.r, p: env.kdf.p, keylen: SCRYPT_PARAMS.keylen, maxmem: SCRYPT_PARAMS.maxmem,
    });
    decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(env.iv, "base64"));
    decipher.setAuthTag(Buffer.from(env.tag, "base64"));
  } catch {
    throw new AppError("recovery.bundle_invalid", { reason: "malformed" });
  }
  try {
    return Buffer.concat([decipher.update(Buffer.from(env.ct, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new AppError("recovery.passphrase_invalid", {});
  }
}
```

Keep `import "./errors.js"` in `secret-envelope.ts`.

- [ ] **Step 4: Rewrite `recovery-bundle.ts` to consume it**

`recovery-bundle.ts` keeps `BundleFiles` and the string-map shape check, and delegates the crypto:

```ts
import { encryptSecretEnvelope, decryptSecretEnvelope, MIN_PASSPHRASE_LENGTH } from "./secret-envelope.js";
export { MIN_PASSPHRASE_LENGTH };

export function encryptBundle(files: BundleFiles, passphrase: string): string {
  return encryptSecretEnvelope(JSON.stringify(files), passphrase);
}

export function decryptBundle(envelopeJson: string, passphrase: string): BundleFiles {
  const plaintext = decryptSecretEnvelope(envelopeJson, passphrase);
  let parsed: unknown;
  try { parsed = JSON.parse(plaintext); } catch { throw new AppError("recovery.bundle_invalid", { reason: "malformed" }); }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || !Object.values(parsed).every((v) => typeof v === "string")) {
    throw new AppError("recovery.bundle_invalid", { reason: "malformed" });
  }
  return parsed as BundleFiles;
}
```

Note: preserve the existing `recovery-bundle.test.ts` behavioural assertions (CLAUDE.md — a refactor keeps them); update only imports if a test imported a now-moved constant.

- [ ] **Step 5: Run the new test and the existing bundle test**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test -- secret-envelope recovery-bundle`
Expected: PASS (both files).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/secret-envelope.ts apps/server/src/secret-envelope.test.ts apps/server/src/recovery-bundle.ts
git commit -s -m "refactor(server): extract secret-envelope from recovery-bundle"
```

---

## Task 2: Add the `fiscal.aeat.dormant` vault purpose

**Files:**
- Modify: `packages/credentials/src/purposes.ts`
- Test: `packages/credentials/src/purposes.test.ts`

**Interfaces:**
- Produces: purpose `"fiscal.aeat.dormant"` with payload `["envelope"]` (a single non-empty string).

- [ ] **Step 1: Extend the pinned-list test**

In `purposes.test.ts` (which pins the exact `PURPOSES` keys/fields), add `"fiscal.aeat.dormant": ["envelope"]` to the expected map and assert `isPurpose("fiscal.aeat.dormant")` is `true`.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/credentials test -- purposes`
Expected: FAIL — the list assertion mismatches; `isPurpose` returns false.

- [ ] **Step 3: Add the purpose**

In `purposes.ts`, inside `PURPOSES`, after `"fiscal.aeat"`:

```ts
  /** The DORMANT copy of a standby's AEAT certificate: the plaintext `fiscal.aeat` cert wrapped in a
   * scrypt+AES-GCM envelope under the node's break-glass secret (cert-distribution design §2.2), then
   * sealed here under the vault ring like any credential — double-wrapped, so neither the vault key nor
   * a disk/dump/snapshot alone opens the cert. The drain reads `fiscal.aeat`, never this, so a dormant
   * standby is not a filing node. One field: the envelope string. */
  "fiscal.aeat.dormant": ["envelope"],
```

- [ ] **Step 4: Run the test to green**

Run: `pnpm --filter @waitron/credentials test:coverage -- purposes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/credentials/src/purposes.ts packages/credentials/src/purposes.test.ts
git commit -s -m "feat(credentials): add fiscal.aeat.dormant vault purpose"
```

---

## Task 3: Reclassify `tenant_credentials` as `local`

**Files:**
- Modify: `packages/credentials/src/classification.ts`
- Test: `packages/credentials/src/classification.test.ts` (and root `scripts/classification-complete.test.ts` re-runs unchanged)

**Interfaces:**
- Produces: `CREDENTIALS_CLASSIFICATION` classifying `tenant_credentials` as `"local"`.

Rationale (put it in the `classify(...)` reason string): a vault row is sealed under the node's own box key, so a replicated copy is undecryptable on the peer and collides on the `(tenant_id, purpose)` PK with the peer's own `membership.node_key`/`sync.mirror_token`. Secrets a standby needs cross by re-sealing at adopt, never by replication (cert-distribution design §2.4).

- [ ] **Step 1: Update the classification test**

In `classification.test.ts`, change the expected class for `tenant_credentials` from `state` to `local`.

- [ ] **Step 2: Grep for any consumer that depends on the `state` class**

Run: `grep -rn "tenant_credentials" packages apps scripts | grep -i "state\|publication\|tablesForPublication"`
Expected: no runtime consumer (publications are unbuilt — `apps/server/src/modules.ts` comments them "DERIVED, not yet consumed"). Record the finding in the commit body. If a consumer *does* appear, stop and escalate (the reclassification premise needs re-checking).

- [ ] **Step 3: Reclassify**

```ts
const LOCAL =
  "box-key sealed: a row sealed under one node's vault key is undecryptable on any other node " +
  "(purposes.ts), so these rows are per-node identity/config, never replicated; a standby's secrets " +
  "are re-sealed under its own key at adopt (sync.mirror_token; fiscal.aeat.dormant), never copied.";

export const CREDENTIALS_CLASSIFICATION: readonly ClassifiedTable[] = [
  classify("tenant_credentials", "local", LOCAL),
];
```

- [ ] **Step 4: Run the package + the root classification guards**

Run: `pnpm --filter @waitron/credentials test:coverage -- classification`
Then: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter root test -- classification-complete classification`
Expected: PASS — every table still classified exactly once; `tenant_credentials` now `local`.

- [ ] **Step 5: Commit**

```bash
git add packages/credentials/src/classification.ts packages/credentials/src/classification.test.ts
git commit -s -m "fix(credentials): classify tenant_credentials local, not state

A box-key-sealed row is undecryptable on any other node, so it must never
replicate; once publications land, a state classification would copy the
cert to a standby that cannot open it (silent filing outage). No runtime
consumer depends on the state class today (publications unbuilt)."
```

---

## Task 4: Add the `fiscal.configure` permission

**Files:**
- Modify: `packages/identity/src/permissions.ts`
- Test: `packages/identity/src/permissions.test.ts`

**Interfaces:**
- Produces: `Permission` union gains `"fiscal.configure"`; admin-only (reaches `admin` via `ALL`, absent from `SUPERVISOR`/`MANAGER`).

- [ ] **Step 1: Extend the pinned admin-only test**

`permissions.test.ts` pins the admin-only set (`ADMIN_ONLY = {mirror.create, node.promote, …}`). Add `"fiscal.configure"` to the expected admin-only set and assert it is absent from `SUPERVISOR` and `MANAGER`.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/identity test -- permissions`
Expected: FAIL — `fiscal.configure` not a `Permission`.

- [ ] **Step 3: Add the permission**

In `permissions.ts`, in the `PERMISSIONS` array beside `node.promote`:

```ts
  // Installing or replacing the venue's AEAT signing certificate on a primary (cert-distribution
  // design §3.3) — an operator control action, so admin-only. Not in SUPERVISOR/MANAGER; reaches
  // `admin` via ALL. Codes/permissions are never renamed once shipped.
  "fiscal.configure",
```

- [ ] **Step 4: Run to green**

Run: `pnpm --filter @waitron/identity test:coverage -- permissions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/identity/src/permissions.ts packages/identity/src/permissions.test.ts
git commit -s -m "feat(identity): add admin-only fiscal.configure permission"
```

---

## Task 5: Register the new error codes

**Files:**
- Modify: `apps/server/src/errors.ts`
- Test: `apps/server/src/fiscal-cert-errors.test.ts`

**Interfaces:**
- Produces: `fiscal.certificate_dormant_missing { tenantId: string }`, `fiscal.certificate_unlock_failed { tenantId: string }`, `restore.credentials_key_external Record<string, never>`.

The root `errors-reachable.test.ts` excludes `apps/*` by construction, so this task adds a **local** reachability assertion (the codes are constructed somewhere in the branch; here we prove they're declared and constructible).

- [ ] **Step 1: Write the failing reachability test**

```ts
// apps/server/src/fiscal-cert-errors.test.ts
import { describe, it, expect } from "vitest";
import { AppError } from "@waitron/shared";
import "./errors.js";

describe("fiscal-cert error codes", () => {
  it("constructs each new code with its params", () => {
    expect(new AppError("fiscal.certificate_dormant_missing", { tenantId: "t" }).code).toBe("fiscal.certificate_dormant_missing");
    expect(new AppError("fiscal.certificate_unlock_failed", { tenantId: "t" }).code).toBe("fiscal.certificate_unlock_failed");
    expect(new AppError("restore.credentials_key_external", {}).code).toBe("restore.credentials_key_external");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/server test -- fiscal-cert-errors`
Expected: FAIL — the codes are not in the registry (a `tsc`/registry error).

- [ ] **Step 3: Declare the codes**

In `errors.ts`, in the `fiscal.*` block add (with a one-line doc each, no history):

```ts
    /** `/management-api/fiscal-certificate/unlock` on a primary that holds no dormant cert copy. */
    "fiscal.certificate_dormant_missing": { tenantId: string };
    /** The break-glass secret verified but the dormant envelope would not open (corrupt / wrapped
     * under a different secret). On /unlock a 4xx; on the promotion path a logged status. The corrupt
     * dormant row is deleted so status falls to "none" (install by hand), never a retry loop. */
    "fiscal.certificate_unlock_failed": { tenantId: string };
```

In the `restore.*` block:

```ts
    /** Restoring an artifact whose vault key is held externally (a cloud node) onto a node with no
     * WAITRON_CREDENTIALS_KEY in the environment — the vault would be unopenable. Supply the key. */
    "restore.credentials_key_external": Record<string, never>;
```

- [ ] **Step 4: Run to green + typecheck**

Run: `pnpm --filter @waitron/server test -- fiscal-cert-errors && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/errors.ts apps/server/src/fiscal-cert-errors.test.ts
git commit -s -m "feat(server): register fiscal-cert + external-key error codes"
```

---

## Task 6: `fiscal-cert.ts` — the generic cert-distribution core

**Files:**
- Create: `apps/server/src/fiscal-cert.ts`
- Test: `apps/server/src/fiscal-cert.test.ts` (real Postgres — vault privileges as the deployment role)

**Interfaces:**
- Consumes: `encryptSecretEnvelope`/`decryptSecretEnvelope` (Task 1); `@waitron/credentials` `getCredential`, `tryGetCredential`, `putCredential`, `deleteCredential`; `withTenant` from `@waitron/db`.
- Produces:
  - `type AeatCertMaterial = { pfxBase64: string; passphrase: string; certKind: string }`
  - `storeDormantCert(tx, ring, tenantId, cert: AeatCertMaterial, breakGlass: string): Promise<void>` — wrap `JSON.stringify(cert)` under `breakGlass`, `putCredential` under `fiscal.aeat.dormant`.
  - `unwrapDormantCert(tx, ring, tenantId, breakGlass): Promise<AeatCertMaterial | "absent" | "corrupt">` — read the dormant row; `"absent"` if none; decrypt+parse; `"corrupt"` if the envelope will not open or the JSON is not an `AeatCertMaterial`.
  - `sealLiveCertTx(tx, ring, tenantId, cert: AeatCertMaterial): Promise<void>` — `putCredential` under `fiscal.aeat` (generic; the value round-tripped from a validated cert, so `putCredential`'s field check suffices).
  - `deleteDormantCert(tx, tenantId): Promise<void>` — `deleteCredential(tx, { tenantId, purpose: "fiscal.aeat.dormant" })`.
  - `readCertStatus(tx, ring, tenantId): Promise<"live" | "dormant" | "none">` — **existence** check only (never `getCredential`, which throws on an undecryptable row): a `fiscal.aeat` row → `"live"`; else a `fiscal.aeat.dormant` row → `"dormant"`; else `"none"`. Use a `select` that returns just the `purpose` column for the two purposes.

Purpose strings are `Purpose`-typed; brand the tenant id via `tenantId as brandTenantId` from `@waitron/shared` where the credentials API needs a `TenantId`.

- [ ] **Step 1: Write the failing test (real PG)**

```ts
// apps/server/src/fiscal-cert.test.ts
import { describe, it, expect } from "vitest";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
// helpers that seed a tenant row + a key ring — reuse the credentials/test seed pattern.
import { storeDormantCert, unwrapDormantCert, sealLiveCertTx, deleteDormantCert, readCertStatus } from "./fiscal-cert.js";

const CERT = { pfxBase64: "QQ==", passphrase: "pw", certKind: "sello" };
const BG = "break-glass-secret-32-chars-abcd"; // ≥ 12

describe("fiscal-cert core (real PG)", () => {
  const pg = useRealPostgres(); // gives db + ring + a seeded tenantId; see credentials store.test.ts
  it("stores a dormant copy and reads status dormant", async () => {
    const { db, ring, tenantId } = pg.ctx();
    await withTenant(db, tenantId, (tx) => storeDormantCert(tx, ring, tenantId, CERT, BG));
    expect(await withTenant(db, tenantId, (tx) => readCertStatus(tx, ring, tenantId))).toBe("dormant");
  });
  it("unwraps the dormant copy with the right secret", async () => {
    const { db, ring, tenantId } = pg.ctx();
    await withTenant(db, tenantId, (tx) => storeDormantCert(tx, ring, tenantId, CERT, BG));
    const out = await withTenant(db, tenantId, (tx) => unwrapDormantCert(tx, ring, tenantId, BG));
    expect(out).toEqual(CERT);
  });
  it("reports corrupt for the wrong break-glass secret", async () => {
    const { db, ring, tenantId } = pg.ctx();
    await withTenant(db, tenantId, (tx) => storeDormantCert(tx, ring, tenantId, CERT, BG));
    expect(await withTenant(db, tenantId, (tx) => unwrapDormantCert(tx, ring, tenantId, "another-long-secret"))).toBe("corrupt");
  });
  it("reports absent when there is no dormant row", async () => {
    const { db, ring, tenantId } = pg.ctx();
    expect(await withTenant(db, tenantId, (tx) => unwrapDormantCert(tx, ring, tenantId, BG))).toBe("absent");
  });
  it("seal live then status live; delete dormant leaves status live", async () => {
    const { db, ring, tenantId } = pg.ctx();
    await withTenant(db, tenantId, (tx) => storeDormantCert(tx, ring, tenantId, CERT, BG));
    await withTenant(db, tenantId, (tx) => sealLiveCertTx(tx, ring, tenantId, CERT));
    await withTenant(db, tenantId, (tx) => deleteDormantCert(tx, tenantId));
    expect(await withTenant(db, tenantId, (tx) => readCertStatus(tx, ring, tenantId))).toBe("live");
  });
});
```

(Adapt `useRealPostgres`/`pg.ctx()` to the exact shape `packages/credentials/src/store.test.ts` uses to obtain `{ db, ring, tenantId }`; that test is the reference for seeding a tenant row and a key ring against the credentials schema.)

- [ ] **Step 2: Run it and watch it fail**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test -- fiscal-cert.test`
Expected: FAIL — `Cannot find module './fiscal-cert.js'`.

- [ ] **Step 3: Implement `fiscal-cert.ts`**

`tenantCredentials` is exported from the `@waitron/credentials` barrel (`packages/credentials/src/index.ts:7`) and the package has no `exports` map, so the direct import below is legitimate — no deep-import and no new credentials-package reader is needed.

```ts
import { and, eq } from "drizzle-orm";
import { tenantId as brandTenantId, type TenantId } from "@waitron/shared";
import { tryGetCredential, putCredential, deleteCredential, tenantCredentials, type KeyRing } from "@waitron/credentials";
import type { Transaction } from "@waitron/db";
import { encryptSecretEnvelope, decryptSecretEnvelope } from "./secret-envelope.js";
import "./errors.js";

export interface AeatCertMaterial { pfxBase64: string; passphrase: string; certKind: string; }

export async function storeDormantCert(tx: Transaction, ring: KeyRing, tenantId: string, cert: AeatCertMaterial, breakGlass: string): Promise<void> {
  const envelope = encryptSecretEnvelope(JSON.stringify(cert), breakGlass);
  await putCredential(tx, ring, { tenantId: brandTenantId(tenantId), purpose: "fiscal.aeat.dormant", value: { envelope } });
}

export async function unwrapDormantCert(tx: Transaction, ring: KeyRing, tenantId: string, breakGlass: string): Promise<AeatCertMaterial | "absent" | "corrupt"> {
  const row = await tryGetCredential(tx, ring, { tenantId: brandTenantId(tenantId), purpose: "fiscal.aeat.dormant" });
  if (row === null) return "absent";
  let plaintext: string;
  try { plaintext = decryptSecretEnvelope(row.envelope, breakGlass); } catch { return "corrupt"; }
  let parsed: unknown;
  try { parsed = JSON.parse(plaintext); } catch { return "corrupt"; }
  if (typeof parsed !== "object" || parsed === null || typeof (parsed as AeatCertMaterial).pfxBase64 !== "string"
      || typeof (parsed as AeatCertMaterial).passphrase !== "string" || typeof (parsed as AeatCertMaterial).certKind !== "string") {
    return "corrupt";
  }
  const c = parsed as AeatCertMaterial;
  return { pfxBase64: c.pfxBase64, passphrase: c.passphrase, certKind: c.certKind };
}

export async function sealLiveCertTx(tx: Transaction, ring: KeyRing, tenantId: string, cert: AeatCertMaterial): Promise<void> {
  await putCredential(tx, ring, { tenantId: brandTenantId(tenantId), purpose: "fiscal.aeat", value: { ...cert } });
}

export async function deleteDormantCert(tx: Transaction, tenantId: string): Promise<void> {
  await deleteCredential(tx, { tenantId: brandTenantId(tenantId), purpose: "fiscal.aeat.dormant" });
}

export async function readCertStatus(tx: Transaction, _ring: KeyRing, tenantId: string): Promise<"live" | "dormant" | "none"> {
  const rows = await tx.select({ purpose: tenantCredentials.purpose }).from(tenantCredentials)
    .where(and(eq(tenantCredentials.tenantId, brandTenantId(tenantId)))); // one tenant per db; filter kept explicit
  const purposes = new Set(rows.map((r) => r.purpose));
  if (purposes.has("fiscal.aeat")) return "live";
  if (purposes.has("fiscal.aeat.dormant")) return "dormant";
  return "none";
}
```

- [ ] **Step 4: Run to green**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage -- fiscal-cert.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/fiscal-cert.ts apps/server/src/fiscal-cert.test.ts
git commit -s -m "feat(server): fiscal-cert core — dormant store/unwrap/seal/status"
```

---

## Task 7: Carry the certificate in the mirror bundle

**Files:**
- Modify: `apps/server/src/mirror-bundle.ts`
- Test: `apps/server/src/mirror-bundle.test.ts`

**Interfaces:**
- Produces: `MirrorBundle.aeatCert?: { pfxBase64: string; passphrase: string; certKind: string }` — present only when the primary holds a `fiscal.aeat` row.

- [ ] **Step 1: Write the failing test**

Extend `mirror-bundle.test.ts`: when the primary's vault holds a `fiscal.aeat` credential, `assembleMirrorBundle` returns `bundle.aeatCert` equal to that cert; when it holds none, `bundle.aeatCert` is `undefined`.

```ts
it("carries the primary's AEAT cert when present", async () => {
  // seed fiscal.aeat via putCredential(...) for the designated tenant
  const bundle = await assembleMirrorBundle(deps);
  expect(bundle.aeatCert).toEqual({ pfxBase64: "QQ==", passphrase: "pw", certKind: "sello" });
});
it("omits aeatCert when the primary holds none", async () => {
  const bundle = await assembleMirrorBundle(deps);
  expect(bundle.aeatCert).toBeUndefined();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test -- mirror-bundle`
Expected: FAIL — `aeatCert` missing on the type / undefined when seeded.

- [ ] **Step 3: Read the cert into the bundle (generic)**

In `MirrorBundle`, add `aeatCert?: { pfxBase64: string; passphrase: string; certKind: string };` (doc: the venue's AEAT cert, present only when the primary holds one; the mirror seals it dormant under its break-glass secret at adopt — cert-distribution design §2.1).

In `assembleMirrorBundle`, read it generically inside a `withTenant` transaction (add to the existing parallel reads or a small sequential read):

```ts
import { tryGetCredential } from "@waitron/credentials";
// ...
const aeatRow = await withTenant(deps.appDb, deps.designated.tenantId, (tx) =>
  tryGetCredential(tx, deps.ring, { tenantId: brandTenantId(deps.designated.tenantId), purpose: "fiscal.aeat" }));
const aeatCert = aeatRow === null ? undefined
  : { pfxBase64: aeatRow.pfxBase64, passphrase: aeatRow.passphrase, certKind: aeatRow.certKind };
```

Add `aeatCert` to the returned object. `app_user` holds SELECT on `tenant_credentials` (baseline), so no wider connection is needed (CLAUDE.md §3).

- [ ] **Step 4: Run to green**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage -- mirror-bundle`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/mirror-bundle.ts apps/server/src/mirror-bundle.test.ts
git commit -s -m "feat(server): carry the AEAT cert in the mirror bundle"
```

---

## Task 8: Store the dormant copy at adopt

**Files:**
- Modify: `apps/server/src/adopt.ts`
- Test: `apps/server/src/adopt.test.ts`

**Interfaces:**
- Consumes: `storeDormantCert` (Task 6); `bundle.aeatCert` (Task 7); the `breakGlassSecret` already minted at `adopt.ts:211`.
- Produces: after adopt, when the bundle carried a cert, a `fiscal.aeat.dormant` vault row exists and no `fiscal.aeat` row does.

- [ ] **Step 1: Write the failing test**

In `adopt.test.ts`, drive `adoptFromPrimary` with a hand-built bundle that includes `aeatCert`; assert afterward that `readCertStatus(...) === "dormant"` and `unwrapDormantCert(..., result.breakGlassSecret)` returns the cert. Add a second case: a bundle with no `aeatCert` leaves status `"none"`.

- [ ] **Step 2: Run it and watch it fail**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test -- adopt.test`
Expected: FAIL — no dormant row after adopt.

- [ ] **Step 3: Store the dormant copy after minting break-glass**

In `adoptFromPrimary`, after `const breakGlassSecret = await mintBreakGlassSecret(deps.ownerDb);` and before `return`:

```ts
// Seal the venue's AEAT cert DORMANT under the break-glass secret (cert-distribution design §2.2):
// double-wrapped (vault ring + break-glass), so neither the cloud disk nor a dump opens it. Only when
// the primary carried one — a preproduction venue may have none. Runs on the owner pool inside its own
// withTenant tx (the vault FK is restrict; the tenant row already exists from adoptVenue above).
if (bundle.aeatCert !== undefined) {
  await withTenant(deps.ownerDb, brandTenantId(designated.tenantId), (tx) =>
    storeDormantCert(tx, deps.ring, designated.tenantId, bundle.aeatCert!, breakGlassSecret));
  deps.log?.("info", "fiscal.certificate_dormant_stored", { tenantId: designated.tenantId });
}
```

Add the imports (`withTenant`, `tenantId as brandTenantId`, `storeDormantCert`). If `AdoptDeps` has no `log`, either add one (bound in boot to the server logger) or drop the log line — the log event is spec §5's `fiscal.certificate_dormant_stored`; check whether `adoptFromPrimary` already has a logger in scope and use it, else add the dep. Update `adoptFromPrimary`'s header comment to name the dormant-copy step (a behaviour change retires the old claim — CLAUDE.md §1).

- [ ] **Step 4: Run to green**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage -- adopt.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/adopt.ts apps/server/src/adopt.test.ts
git commit -s -m "feat(server): store the AEAT cert dormant at adopt"
```

---

## Task 9: Unlock at promotion (break-glass path)

**Files:**
- Modify: `apps/server/src/promote.ts`, `apps/server/src/promote-api.ts`, `apps/server/src/boot.ts`
- Test: `apps/server/src/boot.promote.test.ts` (extend), `apps/server/src/promote-api.test.ts`

**Interfaces:**
- `commitMirrorPromotionTx(tx, document, sealLiveCert?)` — new optional third arg `sealLiveCert?: (tx: Transaction) => Promise<void>`, awaited inside the PONR tx after the membership write. (Verified only two callers — `promote.ts:301`, `promote.test.ts:521` — both 2-arg, so an optional param breaks neither.)
- `MirrorPromoteDeps` gains `sealLiveCert?: (tx: Transaction) => Promise<void>`.
- `PromoteApiDeps.run` becomes `(attestation: FenceAttestation, ctx: { breakGlass?: string }) => Promise<PromoteRunResult>` — the endpoint passes the verified break-glass secret through.
- **The in-process `StartedServer.promoteMirrorToPrimary` surface must widen too** — `promoteMirrorRun` is passed as `{ kind: "mirror", run: promoteMirrorRun }` (`boot.ts:2168`) → the `promote` union `run` type (`boot.ts:403`) → exposed as `StartedServer.promoteMirrorToPrimary` (`boot.ts:171`). All three signatures gain `ctx: { breakGlass?: string }`, and `boot.promote.test.ts`'s call sites (e.g. `:524`, `server.promoteMirrorToPrimary!({ oldNodeNeutralised: true })`) pass a second `{ breakGlass }` arg for the break-glass cases.
- Boot's `promoteMirrorRun` unwraps the dormant cert (before PONR) and builds `sealLiveCert`; on `"corrupt"` it deletes the dormant row + logs `fiscal.certificate_unlock_failed` and passes no closure; on `"absent"` or no break-glass it passes none.
- **Already-primary path (spec §3.1 requirement):** an already-primary node takes the non-mirror branch (`boot.ts:1983-1989`) and `promoteMirrorToPrimary` early-returns before `commitMirrorPromotionTx` (`promote.ts:268-272`), so a break-glass promote there would silently skip the unlock. The plan must NOT leave `ctx.breakGlass` discarded: on an already-primary node, the endpoint returns `{ alreadyPrimary: true }` unchanged AND the response/log directs the operator to `/management-api/fiscal-certificate/unlock` (spec §3.1 permits "told to use /unlock"). Implement in Step 5 as an explicit branch.

- [ ] **Step 1: Write the failing tests**

In `boot.promote.test.ts` (real PG, drives the in-process mirror promote): seed a dormant cert; promote with the break-glass secret; assert afterward `readCertStatus === "live"` and the unwrapped-then-sealed cert matches. Add a corrupt case: a dormant row wrapped under a *different* secret → promote still succeeds (`restarting: true`), `readCertStatus === "none"` (dormant deleted), and a `fiscal.certificate_unlock_failed` log line was emitted. Add an absent case: no dormant row → promote succeeds, status `"none"`, no throw.

In `promote-api.test.ts`: assert the endpoint threads `breakGlass` into `run` (spy on the injected `run`, expect `ctx.breakGlass` set when the body carried it).

- [ ] **Step 2: Run and watch fail**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test -- boot.promote promote-api`
Expected: FAIL — `sealLiveCert` unknown; `run` arity mismatch.

- [ ] **Step 3: Thread the seal into `commitMirrorPromotionTx` and `promoteMirrorToPrimary`**

`commitMirrorPromotionTx`:

```ts
export async function commitMirrorPromotionTx(
  tx: Transaction,
  document: SignedMembershipDocument,
  sealLiveCert?: (tx: Transaction) => Promise<void>,
): Promise<void> {
  await setDeploymentModeTx(tx, "primary");
  await setSingletonRoleTx(tx, "primary");
  const accepted = await persistNodeMembershipIfNewerTx(tx, document);
  if (!accepted) { /* unchanged throw */ }
  // Seal the unlocked AEAT cert in the SAME PONR tx (cert-distribution design §3.1): "became primary"
  // and "holds the filing cert" commit or roll back together. The scrypt open already happened before
  // this tx; only the putCredential is inside. Undefined when there was nothing to unlock.
  if (sealLiveCert !== undefined) await sealLiveCert(tx);
}
```

In `promoteMirrorToPrimary`, pass `deps.sealLiveCert` through: `await deps.ownerDb.transaction((tx) => commitMirrorPromotionTx(tx, document, deps.sealLiveCert));` and add `sealLiveCert?` to `MirrorPromoteDeps` with a doc pointing here.

- [ ] **Step 4: Thread break-glass through the endpoint**

In `promote-api.ts`, change `PromoteApiDeps.run` to `(attestation, ctx: { breakGlass?: string }) => Promise<PromoteRunResult>`. In the handler, after the break-glass branch verifies the secret, capture it; call `deps.run(attestation, { breakGlass: verifiedBreakGlass })` (the admin-login path passes `{}`). `verifiedBreakGlass` is `typeof body.breakGlass === "string"` ? `body.breakGlass` : `undefined`.

- [ ] **Step 5: Build `sealLiveCert` in boot's `promoteMirrorRun`**

In `boot.ts`'s `promoteMirrorRun` (currently `async (attestation) => …`), take the break-glass secret and unwrap before the promote:

```ts
const promoteMirrorRun = async (attestation: FenceAttestation, ctx: { breakGlass?: string }): Promise<PromoteRunResult> => {
  let sealLiveCert: ((tx: Transaction) => Promise<void>) | undefined;
  if (ctx.breakGlass !== undefined) {
    const material = await withTenant(db, config.till.tenantId, (tx) =>
      unwrapDormantCert(tx, ring, config.till.tenantId, ctx.breakGlass!));
    if (material === "corrupt") {
      // The real owner-pool handle is `withOwnerDb` (boot.ts:1918); it hands the closure a
      // `PromoteDeps` (with `.ownerDb`), NOT a bare tx — so open a tenant tx on `deps.ownerDb`.
      await withOwnerDb((deps) =>
        withTenant(deps.ownerDb, brandTenantId(config.till.tenantId), (tx) =>
          deleteDormantCert(tx, config.till.tenantId)));
      log("warn", "fiscal.certificate_unlock_failed", { tenantId: config.till.tenantId });
    } else if (material !== "absent") {
      sealLiveCert = (tx) => sealLiveCertTx(tx, ring, config.till.tenantId, material);
      log("info", "fiscal.certificate_unlocked", { tenantId: config.till.tenantId });
    }
  }
  const result = await promoteMirrorToPrimary({ /* existing deps */, sealLiveCert }, attestation);
  // existing restart/return handling
};
```

`withOwnerDb` (`boot.ts:1918`), `ring`, and `db` (app pool) are all in scope here. Update `mountPromoteApi(app, { …, run: promoteRun }, log)` so `promoteRun`'s signature becomes `(attestation, ctx)` and forwards `ctx` to `promoteMirrorRun` (mirror branch) — and on the non-mirror already-primary branch (`boot.ts:1983-1989`), if `ctx.breakGlass` is set, still return `{ alreadyPrimary: true }` but log a line pointing the operator at `/unlock` (the already-primary requirement above).

Register `fiscal.certificate_unlocked` / `fiscal.certificate_unlock_failed` as **log events** — if the logger enforces a registered event list, add them there; otherwise they are free-form log lines (match the existing `fiscal.awaiting_certificate` log-event convention in `pass.ts`).

- [ ] **Step 6: Run to green + typecheck**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage -- boot.promote promote-api promote.test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/promote.ts apps/server/src/promote-api.ts apps/server/src/boot.ts apps/server/src/*.test.ts
git commit -s -m "feat(server): unlock the dormant AEAT cert on break-glass promotion"
```

---

## Task 10: The unlock + install/replace endpoints

**Files:**
- Create: `apps/server/src/fiscal-cert-api.ts`
- Modify: `apps/server/src/boot.ts` (mount on the management surface, primary path)
- Test: `apps/server/src/fiscal-cert-api.test.ts`

**Interfaces:**
- `mountFiscalCertApi(app, deps, log)` where `deps = { appDb, ownerDb, ring, tenantId, sealFreshCert(tenantId, raw): Promise<void>, validateFreshCert(raw): void }`.
- `POST /management-api/fiscal-certificate/unlock { breakGlass }` — admin-authorization is unnecessary (the break-glass secret IS the authorization, matching promote); verify via `verifyBreakGlass`, then `unwrapDormantCert`; `"absent"` → `fiscal.certificate_dormant_missing` (409); `"corrupt"` → delete dormant + `fiscal.certificate_unlock_failed` (409); material → `sealLiveCertTx` in a `withTenant(ownerDb)` tx (200). A wrong secret → `promotion.break_glass_invalid` (401).
- `POST /management-api/fiscal-certificate { personId, password, totp?, aeatCert }` — admin login authorizing `fiscal.configure`, then `validateFreshCert(aeatCert)` (regime seat) → `sealFreshCert(tenantId, aeatCert)` (regime seat, its own tx). Malformed cert → `setup.request_invalid` (400).
- Both are mounted only on a **primary**; on a mirror the read-only gate answers `node.read_only` first (no new exemption). Confirm the management surface these mount on is behind the read-only gate for a mirror (it is — only `/api/box/retire`, `/management-api/promote`, `/sync-api/cursor` are exempt).

- [ ] **Step 1: Write the failing tests**

Real-PG suite driving a booted primary (reuse the `boot.test.ts` server harness): seed a dormant cert; `POST /unlock` with the right break-glass → 200, `readCertStatus === "live"`; wrong secret → 401 `promotion.break_glass_invalid`; no dormant row → 409 `fiscal.certificate_dormant_missing`; corrupt dormant → 409 `fiscal.certificate_unlock_failed` and status `"none"`. For install: admin login + valid `aeatCert` → 200 and status `"live"` (overwrite); a malformed `certKind` → 400 `setup.request_invalid` and the vault unchanged; a non-admin login → 403. On a **mirror** server, `POST /management-api/fiscal-certificate` → 403 `node.read_only`.

- [ ] **Step 2: Run and watch fail**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test -- fiscal-cert-api`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `fiscal-cert-api.ts`**

Mirror the shape of `promote-api.ts` (error boundary, `readJsonBody`, `withTenant`/`asAppUser` for the admin-login path, `loginManagerById` → `authorizeManager("fiscal.configure")` → `endManagementSession`). Use `verifyBreakGlass(deps.appDb, secret)` for `/unlock`. Seal live via `sealLiveCertTx` inside `withTenant(deps.ownerDb, tenantId)`; after a successful install, emit `log("info", "fiscal.certificate_installed", { tenantId: deps.tenantId })` (spec §5). Map codes to statuses in a local `STATUS` table (`promotion.break_glass_invalid`→401, `fiscal.certificate_dormant_missing`→409, `fiscal.certificate_unlock_failed`→409, `setup.request_invalid`→400, admin-login codes as in `promote-api.ts`).

- [ ] **Step 4: Wire in boot (primary only)**

In `boot.ts`, alongside `mountPromoteApi`, mount `mountFiscalCertApi` on the same management app, wiring `sealFreshCert`/`validateFreshCert` from the composition-provided fiscal contribution seat (`contribution?.provisioningSecret.seal` / `.validate`) — the same seat `setup-api.ts` uses, so boot imports no regime package. `ownerDb`/`ring`/`appDb`/`config.till.tenantId` are already in scope. The management surface is only served with write verbs reachable on a primary; on a mirror the read-only gate refuses first, so no code branch is needed.

- [ ] **Step 5: Run to green + typecheck**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage -- fiscal-cert-api && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/fiscal-cert-api.ts apps/server/src/fiscal-cert-api.test.ts apps/server/src/boot.ts
git commit -s -m "feat(server): fiscal-certificate unlock + install/replace endpoints"
```

---

## Task 11: Surface certificate status on box-status

**Files:**
- Modify: `apps/server/src/box-status.ts`, `apps/server/src/boot.ts`
- Test: `apps/server/src/box-status.test.ts`

**Interfaces:**
- `BoxStatus` gains `fiscalCertificate: "live" | "dormant" | "none"`.
- `BoxStatusReaders` gains `fiscalCertificate: () => Promise<"live" | "dormant" | "none">`, wired in boot to `() => withTenant(db, config.till.tenantId, (tx) => readCertStatus(tx, ring, config.till.tenantId))`.

- [ ] **Step 1: Write the failing test**

In `box-status.test.ts`, add `fiscalCertificate` to a reader stub and assert `collectBoxStatus` includes it; add cases for `"live"`, `"dormant"`, `"none"`.

- [ ] **Step 2: Run and watch fail**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test -- box-status`
Expected: FAIL — property missing.

- [ ] **Step 3: Add the field + reader + collect**

Add `fiscalCertificate` to `BoxStatus` (doc: distinct from `cert`, the server TLS leaf; the AEAT cert's presence — `"dormant"` means "present your break-glass secret to unlock", `"none"` means "install a certificate"). Add to `BoxStatusReaders`, and include it in the `Promise.all` in `collectBoxStatus`. Wire the reader in boot beside `readAwaitingFiscalCertificate`.

- [ ] **Step 4: Run to green**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage -- box-status && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/box-status.ts apps/server/src/boot.ts apps/server/src/box-status.test.ts
git commit -s -m "feat(server): report fiscalCertificate live/dormant/none on box-status"
```

---

## Task 12: Accept the vault key from the environment (cloud nodes)

**Files:**
- Modify: `apps/server/src/box-secrets.ts`, `apps/server/src/boot.ts`
- Test: `apps/server/src/box-secrets.test.ts`, `apps/server/src/boot.test.ts` (setup-branch case)

**Interfaces:**
- `ensureBoxSecrets` gains awareness of an env-supplied key: when `WAITRON_CREDENTIALS_KEY` is present in the environment, it writes **no** `secrets.env` (still writes TLS PEMs) and its result signals the key is external.
- The setup boot branch (`boot.ts:704-713`) builds the ring **env-first, file-fallback**.
- **Precedence, one place:** env key wins; if a usable env key AND a `secrets.env` both exist and differ, the node refuses to boot loudly.

- [ ] **Step 1: Write the failing tests**

`box-secrets.test.ts`: with `WAITRON_CREDENTIALS_KEY` set in the passed env, `ensureBoxSecrets` writes the TLS files but **no** `secrets.env` (assert `!existsSync(secrets.env)`), and returns `credentialsKey: "external"`; with no env key, it mints `secrets.env` and returns `credentialsKey: "embedded"` (existing behaviour).

`boot.test.ts` (setup branch): booting setup mode with an env key and no `secrets.env` on disk builds a working ring and can seal a credential (today it would `ENOENT` on `readFileSync`). And: an env key present AND a differing `secrets.env` on disk → boot fails with a specific loud error.

- [ ] **Step 2: Run and watch fail**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test -- box-secrets boot.test`
Expected: FAIL — `secrets.env` still written; setup boot `ENOENT`.

- [ ] **Step 3: Env-aware `ensureBoxSecrets`**

Add an `env: Record<string, string | undefined>` dep (default `process.env`) and a `credentialsKey: "embedded" | "external"` to its result. Guard the `secrets.env` write:

```ts
const envKey = deps.env?.WAITRON_CREDENTIALS_KEY;
const secretsFile = join(deps.stateDir, "secrets.env");
if (isUnset(envKey)) {
  if (!(await exists(secretsFile))) { /* existing mint */ }
  // credentialsKey = "embedded"
} else {
  // The vault key is injected by the platform (Waitron Cloud's secrets service); never mint a file.
  // credentialsKey = "external"
}
```

(Use `isUnset` for `""`-is-unset semantics — it lives in `apps/server/src/env-value.ts` (NOT `@waitron/shared`); import it as `import { isUnset } from "./env-value.js"`, the same way `config.ts`/`restore.ts` do.)

- [ ] **Step 4: Env-first ring in the setup branch + precedence guard**

In `boot.ts:704-713`, replace the unconditional `readFileSync` with env-first, file-fallback, and a single precedence check. Add `existsSync` to boot's `node:fs` import (today only `mkdirSync, readFileSync`); `parseEnvFile`, `readFileSync`, `AppError`, and `env` are already in scope:

```ts
const fileText = existsSync(secretsPath) ? readFileSync(secretsPath, "utf8") : null;
const envKey = env.WAITRON_CREDENTIALS_KEY;
if (!isUnset(envKey) && fileText !== null) {
  const fileKey = parseEnvFile(fileText).WAITRON_CREDENTIALS_KEY;
  if (fileKey !== undefined && fileKey !== envKey) {
    throw new AppError("server.credentials_key_conflict", {}); // declared in Step 4b
  }
}
const ring = loadKeyRing(!isUnset(envKey) ? env : parseEnvFile(fileText ?? ""));
```

Keep the trading branch reading from `env` (unchanged — it already wins there).

- [ ] **Step 4b: Declare the boot-conflict code**

The concept is a process-boot fact (an env key and an on-disk key disagree), so name it in the `server.*` domain — reserved for facts about the process itself (CLAUDE.md §3) — declared in `apps/server/src/errors.ts`, NOT in `@waitron/credentials` (declaring a stray `credentials.*` code from `apps/server` is the inconsistency the plan review flagged):

```ts
    /** Boot found WAITRON_CREDENTIALS_KEY in the environment AND a differing key in secrets.env —
     * refuse rather than seal under one ring and read under the other. Env key wins; remove one. */
    "server.credentials_key_conflict": Record<string, never>;
```

Add a one-line construction assertion to `fiscal-cert-errors.test.ts` (Task 5's file) or a boot test.

- [ ] **Step 5: Run to green**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage -- box-secrets boot.test && pnpm --filter @waitron/credentials test:coverage && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/box-secrets.ts apps/server/src/boot.ts apps/server/src/*.test.ts packages/credentials/src/*
git commit -s -m "feat(server): cloud nodes take the vault key from the environment"
```

---

## Task 13: Backups from an env-keyed node carry no key

**Files:**
- Modify: `apps/server/src/state-secrets.ts` (optional `secrets.env`), `apps/server/src/backup-manifest.ts` (`BackupManifest` + `buildManifest` + `ManifestBuilder` gain `credentialsKey`), `apps/server/src/backup-sweep.ts` + `apps/server/src/recovery-bundle-api.ts` (the two `collectStateSecrets` callers — `backup-sweep.ts:135`, `recovery-bundle-api.ts:67` — pass the new opt), `apps/server/src/restore.ts` / `restore-gate.ts` (validation reads the manifest field), `apps/server/src/boot.ts` (thread `ensureBoxSecrets().credentialsKey` into both mount sites)
- Test: `apps/server/src/state-secrets.test.ts`, `apps/server/src/restore.test.ts`

Note (verified): `restoreSecrets` (`restore.ts:377-383`) iterates the archive entries actually present, not the fixed `RECOVERY_FILES`, so an "external" artifact with no `secrets.env` entry simply writes fewer files — making `secrets.env` conditional does NOT break restore's write path.

**Interfaces:**
- `collectStateSecrets(stateDir, opts: { credentialsKey: "embedded" | "external" })` — when `"external"`, `secrets.env` is **optional** (skipped, not a `recovery.state_incomplete`).
- Backup manifest records `credentialsKey: "embedded" | "external"`.
- Restore of an `"external"` artifact onto a node with no `WAITRON_CREDENTIALS_KEY` in the environment throws `restore.credentials_key_external`.

- [ ] **Step 1: Write the failing tests**

`state-secrets.test.ts`: `collectStateSecrets(dir, { credentialsKey: "external" })` on a dir with no `secrets.env` succeeds and the map has no `secrets.env` key; with `"embedded"` and a missing `secrets.env` it still throws `recovery.state_incomplete` (unchanged).

`restore.test.ts`: restoring an artifact whose manifest says `credentialsKey: "external"` onto a target with no env key → `restore.credentials_key_external`; with the env key present → proceeds.

- [ ] **Step 2: Run and watch fail**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test -- state-secrets restore.test`
Expected: FAIL.

- [ ] **Step 3: Make `secrets.env` optional when external**

Split `RECOVERY_FILES` into the always-present set (`trading.env`, the 4 TLS files) and the conditional `secrets.env`. `collectStateSecrets` takes an `opts: { credentialsKey }` and skips `secrets.env` when `"external"` — update BOTH callers (`backup-sweep.ts:135`, `recovery-bundle-api.ts:67`) or their typecheck fails. Extend `BackupManifest` (`backup-manifest.ts:16`), `buildManifest` and the injectable `ManifestBuilder` (`backup-sweep.ts:49`) with `credentialsKey`. Thread the `credentialsKey` from `ensureBoxSecrets`'s result (Task 12) into both mount sites in `boot.ts`.

- [ ] **Step 4: Enforce on restore**

In restore validation (`restore-gate.ts` or `restore.ts`'s artifact validation, beside `restore.environment_mismatch`): if the manifest's `credentialsKey === "external"` and `isUnset(env.WAITRON_CREDENTIALS_KEY)`, throw `restore.credentials_key_external`. When present, skip writing `secrets.env` (there is none in the artifact) and let the ring come from the environment.

- [ ] **Step 5: Run to green**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage -- state-secrets restore backup && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/state-secrets.ts apps/server/src/backup-manifest.ts apps/server/src/backup-sweep.ts apps/server/src/recovery-bundle-api.ts apps/server/src/restore*.ts apps/server/src/boot.ts apps/server/src/*.test.ts
git commit -s -m "feat(server): env-keyed node backups carry no vault key"
```

---

## Task 14: Reword the adopt UI copy and add dated pointers

**Files:**
- Modify: `apps/setup/src/screens/done-screen.ts` (the break-glass secret panel)
- Modify: `docs/superpowers/specs/2026-08-29-promotion-runbook-design.md` (dated pointers)
- Test: `apps/setup/src/screens/done-screen.test.ts` (browser-mode — check what else is testing first, CLAUDE.md §4)

**Interfaces:**
- The once-shown break-glass panel copy states the secret "authorizes promotion **and** unlocks your fiscal certificate — without it a promoted node sells but cannot file until you install the certificate by hand."

- [ ] **Step 1: Update the copy test**

In `done-screen.test.ts`, assert the panel renders the new sentence (or the key phrase "unlocks your fiscal certificate"). Find the exact screen/component that renders the break-glass secret (grep `breakGlass` under `apps/setup/src`).

- [ ] **Step 2: Run and watch fail**

Run: `pnpm --filter @waitron/setup test -- done-screen` (browser-mode; check `memory_pressure | grep free` and other running Chromiums first — CLAUDE.md §4)
Expected: FAIL — old copy.

- [ ] **Step 3: Reword the panel**

Update the copy string. Keep it plain and short.

- [ ] **Step 4: Dated pointers in the 08-29 spec**

Add a dated banner to `2026-08-29-promotion-runbook-design.md` §4–5 (do not rewrite history): "> 2026-09-07: cert distribution is now designed and built (2026-09-07-fiscal-cert-distribution-design.md). The 'unlock the key ring to unseal a replicated cert blob' framing here is superseded — there was never a replicated blob; the standby now holds a break-glass-wrapped dormant copy. §7's 'abort promotion if the cert cannot be unsealed' is replaced by 'withhold filing, never selling'."

- [ ] **Step 5: Run to green**

Run: `pnpm --filter @waitron/setup test:coverage -- done-screen`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/setup/src/screens/done-screen.ts apps/setup/src/screens/done-screen.test.ts docs/superpowers/specs/2026-08-29-promotion-runbook-design.md
git commit -s -m "docs+setup: reword break-glass copy for cert unlock; date the 08-29 pointers"
```

---

## Task 15: Two-node end-to-end proof (run-it)

**Files:**
- Create: `apps/server/src/fiscal-cert-distribution-e2e.test.ts` (real PG, two in-process nodes)

**Interfaces:**
- Consumes everything above. This is the spec's §7 test 1 — proved by RUNNING, not reading.

**Do not extend `promote-endpoint-e2e.test.ts` in place** — it mocks `undici.fetch` to reject **globally** (so a real filing cannot pass, and un-mocking revives background dials). Use a **per-host** fetch mock: the AEAT host reaches the `FakeAeat` SOAP stub (`packages/verifactu/src/testing/fake-aeat.ts`); every other host rejects (matching the existing suite's intent). The mTLS handshake is real (the test CA + PKCS#12 fixture at `apps/server/src/testing/tls.ts`).

- [ ] **Step 1: Write the e2e**

Boot A (primary, seeded with a real `fiscal.aeat` from the test PKCS#12) and B (mirror) on two real-PG databases, one venue two nodes. Assertions:
1. After B adopts A's bundle: B has a `fiscal.aeat.dormant` row and **no** `fiscal.aeat` row (`readCertStatus(B) === "dormant"`).
2. Promote B **with break-glass** → `readCertStatus(B) === "live"`; B's drain does a real mTLS handshake with `FakeAeat` and files (a registro with a real `estado`); `awaitingFiscalCertificate` stays `false`.
3. Fresh B: promote **with admin login** → `readCertStatus === "dormant"`, `awaitingFiscalCertificate === true`, no live row; then `POST /management-api/fiscal-certificate/unlock` with break-glass → `readCertStatus === "live"`, next drain files.
4. Fresh B: **wrong** break-glass on `/unlock` → 401 `promotion.break_glass_invalid`, still no live row.

- [ ] **Step 2: Run and watch it fail (then pass as tasks land)**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test -- fiscal-cert-distribution-e2e`
Expected: FAIL first, PASS once wired.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/fiscal-cert-distribution-e2e.test.ts
git commit -s -m "test(server): two-node e2e — dormant cert, unlock, file with real mTLS"
```

---

## Final verification (before `/finish-branch`)

- [ ] **Whole-package gate** (a value more than one suite asserts — the purpose registry, the classification list, the permission set — was changed, so run the changed packages unfiltered plus dependents):

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/credentials --filter @waitron/identity --filter @waitron/server test:coverage
pnpm typecheck && pnpm lint && pnpm format:check
```

- [ ] **Root guards** (schema/registry/classification touched):

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter root test -- classification-complete classification append-only-enable-always errors-reachable module-seams english-only
```

Expected: all PASS. `module-seams` proves `apps/server` still imports no regime package (the fiscal seat is composition-provided). `classification` proves `tenant_credentials` is `local`.

- [ ] **Update the backlog** Track B item 3 "STILL OWED" entry: mark cert-distribution **LANDED** (leave re-admission's live-cert-deletion note and the deferred §4.3 fast-follow), in the same change (CLAUDE.md §6). Then run `/finish-branch`.

---

## Self-review (writing-plans)

- **Spec coverage:** §2.1 bundle→Task 7; §2.2 dormant wrap→Tasks 6,8; §2.3 envelope→Task 1; §2.4 reclassify→Task 3; §3.1 promote unlock→Task 9; §3.2 `/unlock`→Task 10; §3.3 install→Task 10; §4.1 env key→Task 12; §4.2 no-key backups→Task 13; §5 status field→Task 11, UI copy→Task 14; §6.1 purpose→Task 2; §6.2 permission→Task 4; §6.3 codes→Task 5; §7 tests→each task + Task 15; §8 §4.3 is out of scope (not planned here); §9 pointers→Task 14. Covered.
- **Type consistency:** `AeatCertMaterial` (Task 6) is the shape carried by `MirrorBundle.aeatCert` (Task 7), stored/unwrapped (Task 6), sealed via `sealLiveCert` (Task 9). `sealLiveCert?: (tx: Transaction) => Promise<void>` is consistent across `commitMirrorPromotionTx`/`MirrorPromoteDeps` (Task 9). `readCertStatus` returns the same union used by `BoxStatus.fiscalCertificate` (Task 11). `credentialsKey: "embedded" | "external"` is consistent across Tasks 12–13.
- **Placeholder scan:** every code step carries real code; test steps carry real assertions; commands are runnable. The one deliberate implementer-adaptation note is the `useRealPostgres`/`pg.ctx()` seeding shape (Task 6) — pinned to `packages/credentials/src/store.test.ts` as the reference — because the exact test-harness accessor differs per suite and must follow the sibling pattern rather than a guessed signature.

## What the fresh-context plan-vs-spec review changed (2026-09-07)

Folded before any implementer ran: **(1)** Task 9 now widens the in-process `StartedServer.promoteMirrorToPrimary` surface and its union type (not just the HTTP path) and updates `boot.promote.test.ts` call sites; **(2)** the corrupt-dormant delete uses the real `withOwnerDb` handle (which hands a `PromoteDeps`, not a `tx`), opening a tenant tx on `deps.ownerDb`; **(3)** the already-primary break-glass path no longer silently drops the unlock — it directs the operator to `/unlock` (spec §3.1); **(4)** Task 13 names the real manifest home (`backup-manifest.ts`) and both `collectStateSecrets` callers (`recovery-bundle-api.ts`, `backup-sweep.ts`) plus the boot wiring; **(5)** Task 6 drops the unnecessary credentials-package reader (`tenantCredentials` is barrel-exported, no `exports` map); **(6)** Task 12 fixes `isUnset`'s provenance (`./env-value.js`, not shared), adds the `existsSync` import, and declares the boot-conflict code as `server.credentials_key_conflict` in `apps/server` (not a stray `credentials.*`); **(7)** the two missing log events (`fiscal.certificate_dormant_stored`, `fiscal.certificate_installed`) are wired (Tasks 8, 10). Confirmed sound and unchanged: module-seams (credentials + the `"fiscal.aeat"` string are not regime imports), `/unlock` needs no admin auth, the read-only gate refuses mirror writes, `certKind: string` (not the regime's `CertKind`).
