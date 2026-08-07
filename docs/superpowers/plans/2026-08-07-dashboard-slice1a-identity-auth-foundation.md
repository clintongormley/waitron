# Dashboard Slice 1a — Identity Auth Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `@waitron/identity` with the offline-verifiable auth foundation the management dashboard needs — a browser "management session", password and TOTP credentials behind a small verifier seam, and a `person.manage`-gated admin person list — with no server or UI work.

**Architecture:** All work is inside `packages/identity`. We add two nullable credential columns to `persons` (`password_hash`, `totp_secret`), a new tenant-scoped `management_sessions` table (FORCE RLS, own migration), pure credential functions (`hashPassword`/`verifyPassword`, `generateTotpSecret`/`verifyTotp`) that mirror the existing scrypt `verify-pin.ts` pattern, a session lifecycle (`startManagementSession`/`resolveManagementSession`/`endManagementSession`) that re-reads `persons.status` and enforces a sliding idle timeout, `loginManager` (the verifier seam: password required, TOTP if enrolled, passkey plugs in later), `authorizeManager` (parallels the existing till `authorize()` but for management sessions), and a gated `listPersons`. Existing staff mutations are refactored from a till `actorSessionId` to a `managementSessionId`.

**Tech Stack:** TypeScript (ESM, `verbatimModuleSyntax`), Drizzle ORM `^0.45.2`, PostgreSQL (RLS), Vitest `^3` (PGlite + Testcontainers real-PG), `otplib` (new dep, TOTP), `node:crypto` scrypt.

## Global Constraints

- **Package `@waitron/identity`** — `main: ./src/index.ts`, no `exports` map. It is a `GENERIC_PACKAGE` in `english-only.ts`, so **every new identifier, column, and string literal must be English** (`password`, `totp`, `secret`, `session`, `manager` are all fine — do **not** add Spanish tokens).
- **Coverage thresholds: statements 98 / lines 98 / functions 98 / branches 95** (`packages/identity/vitest.config.ts`). New code needs near-complete branch coverage, including every fail-closed path.
- **Error codes** name the domain concept, lowercase, dot-namespaced (`password.invalid`, never `identity.*`). **Codes are never renamed once shipped.** Every new code is declared in `packages/identity/src/errors.ts`'s `declare module "@waitron/shared"` block; every runtime module that throws one starts with `import "./errors.js";`, and the barrel already re-imports it (reachability rule).
- **Every new `tenant_id`-bearing table needs FORCE RLS + a tenant-isolation policy + grants, hand-written in a `--custom` migration** — `.enableRLS()` alone is insufficient (it emits only `ENABLE`, not `FORCE`). The `packages/fiscal-verifactu` `inmutabilidad` suite scans every table with a `tenant_id` column for `FORCE`, so a miss there stays red.
- **No DELETE grant** on any table — rows are retired via status/`ended_at`, never deleted.
- **`packages/identity/drizzle/meta/_journal.json` conflicts on every concurrent branch touching identity.** This branch must be the sole identity-migration adder, or rebased onto whatever landed first.
- **Every commit uses `git commit -s`** (CI's `dco` job walks the whole PR range).
- **Before claiming green, run `pnpm --filter @waitron/identity test:coverage`** (plain `test` skips the coverage gate) **and** `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` (the FORCE-RLS guard lives in another package).

---

### Task 1: Generic secret-hash helper (extract from PIN, keep PIN behaviour)

**Files:**
- Create: `packages/identity/src/secret-hash.ts`
- Create: `packages/identity/src/secret-hash.test.ts`
- Modify: `packages/identity/src/verify-pin.ts` (delegate to the new helper; signatures unchanged)

**Interfaces:**
- Produces: `hashSecret(secret: string): string` (returns `scrypt$<saltHex>$<keyHex>`), `verifySecret(secret: string, stored: string): boolean` (fail-closed).

- [ ] **Step 1: Write the failing test** — `packages/identity/src/secret-hash.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hashSecret, verifySecret } from "./secret-hash.js";

describe("secret-hash", () => {
  it("accepts the correct secret", () => {
    expect(verifySecret("hunter2", hashSecret("hunter2"))).toBe(true);
  });
  it("rejects a wrong secret", () => {
    expect(verifySecret("nope", hashSecret("hunter2"))).toBe(false);
  });
  it("salts each hash (same input, different output)", () => {
    expect(hashSecret("hunter2")).not.toBe(hashSecret("hunter2"));
  });
  it("tags the algorithm", () => {
    expect(hashSecret("hunter2").startsWith("scrypt$")).toBe(true);
  });
  it("rejects a malformed stored value without throwing", () => {
    expect(verifySecret("x", "not-a-valid-hash")).toBe(false);
  });
  it("rejects an unknown algorithm tag", () => {
    expect(verifySecret("x", "bcrypt$abcd$ef01")).toBe(false);
  });
  it("rejects a wrong-length derived key without throwing", () => {
    expect(verifySecret("x", "scrypt$abcd$ef01")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails** — Run: `pnpm --filter @waitron/identity test secret-hash` · Expected: FAIL, `hashSecret` not found.

- [ ] **Step 3: Implement `secret-hash.ts`:**

```ts
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SALT_BYTES = 16;
const KEY_BYTES = 32;
const ALGORITHM = "scrypt";

export function hashSecret(secret: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(secret, salt, KEY_BYTES);
  return `${ALGORITHM}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifySecret(secret: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  const [algorithm, saltHex, derivedHex] = parts;
  if (algorithm !== ALGORITHM) return false;
  const salt = Buffer.from(saltHex!, "hex");
  const expected = Buffer.from(derivedHex!, "hex");
  const actual = scryptSync(secret, salt, KEY_BYTES);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
```

- [ ] **Step 4: Refactor `verify-pin.ts` to delegate** — replace the bodies of `hashPin`/`verifyPin` so behaviour is identical but the scrypt logic lives once:

```ts
import { hashSecret, verifySecret } from "./secret-hash.js";

export function hashPin(pin: string): string {
  return hashSecret(pin);
}
export function verifyPin(pin: string, stored: string): boolean {
  return verifySecret(pin, stored);
}
```

(Delete the now-unused `node:crypto` imports and constants from `verify-pin.ts`. Keep the exported names and the file — `index.ts` and `credential.ts` import them.)

- [ ] **Step 5: Run both suites, verify they pass** — Run: `pnpm --filter @waitron/identity test secret-hash verify-pin` · Expected: PASS (all existing `verify-pin.test.ts` assertions still green — behaviour preserved).

- [ ] **Step 6: Commit**

```bash
git add packages/identity/src/secret-hash.ts packages/identity/src/secret-hash.test.ts packages/identity/src/verify-pin.ts
git commit -s -m "refactor(identity): extract generic secret-hash from PIN hashing"
```

---

### Task 2: Password credential

**Files:**
- Create: `packages/identity/src/verify-password.ts`
- Create: `packages/identity/src/verify-password.test.ts`
- Modify: `packages/identity/src/errors.ts` (add `password.too_short`, `password.invalid`)
- Modify: `packages/identity/src/index.ts` (export `hashPassword`, `verifyPassword`, `MIN_PASSWORD_LENGTH`, `assertPasswordLength`)

**Interfaces:**
- Consumes: `hashSecret`, `verifySecret` (Task 1).
- Produces: `MIN_PASSWORD_LENGTH: number`, `assertPasswordLength(password: string): void` (throws `password.too_short`), `hashPassword(password: string): string`, `verifyPassword(password: string, stored: string): boolean`.

- [ ] **Step 1: Add error codes** in `packages/identity/src/errors.ts` inside the `interface ErrorParams { … }` block:

```ts
    "password.too_short": { min: number };
    "password.invalid": Record<string, never>;
```

- [ ] **Step 2: Write the failing test** — `packages/identity/src/verify-password.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { assertPasswordLength, hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "./verify-password.js";

describe("password", () => {
  it("round-trips a correct password", () => {
    expect(verifyPassword("correct horse", hashPassword("correct horse"))).toBe(true);
  });
  it("rejects a wrong password", () => {
    expect(verifyPassword("wrong", hashPassword("correct horse"))).toBe(false);
  });
  it("accepts a password at the minimum length", () => {
    expect(() => assertPasswordLength("x".repeat(MIN_PASSWORD_LENGTH))).not.toThrow();
  });
  it("throws password.too_short below the minimum", () => {
    try {
      assertPasswordLength("x".repeat(MIN_PASSWORD_LENGTH - 1));
      throw new Error("expected throw");
    } catch (error) {
      expect(isAppError(error) && error.code).toBe("password.too_short");
    }
  });
});
```

- [ ] **Step 3: Run the test, verify it fails** — Run: `pnpm --filter @waitron/identity test verify-password` · Expected: FAIL, module not found.

- [ ] **Step 4: Implement `verify-password.ts`:**

```ts
import "./errors.js";
import { AppError } from "@waitron/shared";
import { hashSecret, verifySecret } from "./secret-hash.js";

export const MIN_PASSWORD_LENGTH = 8;

export function assertPasswordLength(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AppError("password.too_short", { min: MIN_PASSWORD_LENGTH });
  }
}

export function hashPassword(password: string): string {
  return hashSecret(password);
}

export function verifyPassword(password: string, stored: string): boolean {
  return verifySecret(password, stored);
}
```

- [ ] **Step 5: Export from the barrel** — add to `packages/identity/src/index.ts`:

```ts
export { MIN_PASSWORD_LENGTH, assertPasswordLength, hashPassword, verifyPassword } from "./verify-password.js";
```

- [ ] **Step 6: Run tests, verify pass** — Run: `pnpm --filter @waitron/identity test verify-password` · Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/identity/src/verify-password.ts packages/identity/src/verify-password.test.ts packages/identity/src/errors.ts packages/identity/src/index.ts
git commit -s -m "feat(identity): password credential (hash/verify, min-length gate)"
```

---

### Task 3: TOTP credential

**Files:**
- Modify: `packages/identity/package.json` (add `otplib`)
- Create: `packages/identity/src/totp.ts`
- Create: `packages/identity/src/totp.test.ts`
- Modify: `packages/identity/src/errors.ts` (add `totp.invalid`)
- Modify: `packages/identity/src/index.ts` (export the three functions)

**Interfaces:**
- Produces: `generateTotpSecret(): string` (base32), `totpAuthUri(secret: string, accountName: string): string` (otpauth URI for authenticator apps), `verifyTotp(token: string, secret: string): boolean` (±1 step window, fail-closed).

- [ ] **Step 1: Add the dependency** — in `packages/identity/package.json` add to `dependencies` (keep alphabetical): `"otplib": "^12.0.1"`, then run `pnpm install` and commit the lockfile change with this task.

- [ ] **Step 2: Add error code** in `errors.ts`:

```ts
    "totp.invalid": Record<string, never>;
```

- [ ] **Step 3: Write the failing test** — `packages/identity/src/totp.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { authenticator } from "otplib";
import { generateTotpSecret, totpAuthUri, verifyTotp } from "./totp.js";

describe("totp", () => {
  it("verifies a token generated from the same secret", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(authenticator.generate(secret), secret)).toBe(true);
  });
  it("rejects a wrong token", () => {
    expect(verifyTotp("000000", generateTotpSecret())).toBe(false);
  });
  it("rejects a malformed token without throwing", () => {
    expect(verifyTotp("not-a-code", generateTotpSecret())).toBe(false);
  });
  it("rejects a malformed secret without throwing", () => {
    expect(verifyTotp("123456", "!!!not-base32!!!")).toBe(false);
  });
  it("builds an otpauth uri naming the issuer", () => {
    const uri = totpAuthUri(generateTotpSecret(), "ada@example.com");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain("issuer=Waitron");
  });
});
```

- [ ] **Step 4: Run the test, verify it fails** — Run: `pnpm --filter @waitron/identity test totp` · Expected: FAIL, module not found.

- [ ] **Step 5: Implement `totp.ts`:**

```ts
import { authenticator } from "otplib";

const ISSUER = "Waitron";

authenticator.options = { window: 1 };

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function totpAuthUri(secret: string, accountName: string): string {
  return authenticator.keyuri(accountName, ISSUER, secret);
}

export function verifyTotp(token: string, secret: string): boolean {
  try {
    return authenticator.check(token, secret);
  } catch {
    return false; // otplib throws on malformed base32 / non-numeric token — fail closed
  }
}
```

- [ ] **Step 6: Export from the barrel** — add to `index.ts`:

```ts
export { generateTotpSecret, totpAuthUri, verifyTotp } from "./totp.js";
```

- [ ] **Step 7: Run tests, verify pass** — Run: `pnpm --filter @waitron/identity test totp` · Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/identity/package.json packages/identity/src/totp.ts packages/identity/src/totp.test.ts packages/identity/src/errors.ts packages/identity/src/index.ts ../../pnpm-lock.yaml
git commit -s -m "feat(identity): TOTP credential (secret gen, otpauth uri, verify)"
```

---

### Task 4: `persons` credential columns (migration)

**Files:**
- Modify: `packages/identity/src/schema/persons.ts` (add two nullable columns + checks)
- Generate: `packages/identity/drizzle/0004_*.sql` (+ `meta/_journal.json`, snapshot)
- Modify: `packages/identity/src/index.test.ts` (exercise the new `extraConfig` so function coverage stays ≥98)

**Interfaces:**
- Produces: `persons.passwordHash` (`text`, nullable), `persons.totpSecret` (`text`, nullable).

- [ ] **Step 1: Add the columns** in `packages/identity/src/schema/persons.ts` — inside the column object, after `pinHash`:

```ts
    passwordHash: text("password_hash"),
    totpSecret: text("totp_secret"),
```

and inside the `(t) => [ … ]` extra-config array, after the existing checks:

```ts
    check("persons_password_hash_ck", sql`${t.passwordHash} is null or length(${t.passwordHash}) > 0`),
    check("persons_totp_secret_ck", sql`${t.totpSecret} is null or length(${t.totpSecret}) > 0`),
```

- [ ] **Step 2: Generate the migration** — Run: `pnpm --filter @waitron/identity db:generate` · Expected: a new `packages/identity/drizzle/0004_<name>.sql` doing `ALTER TABLE "persons" ADD COLUMN "password_hash" text` etc. plus the two checks, with a `_journal.json` entry (idx 4) and snapshot. **Read the generated SQL** to confirm it only adds columns/checks (no table drop). No RLS migration is needed — `persons` already has FORCE RLS from `0001_identity_rls.sql`, and new columns inherit it.

- [ ] **Step 3: Keep function coverage** — in `packages/identity/src/index.test.ts`, the test that calls `getTableConfig(persons)` to force lazy `extraConfig` evaluation now also covers the two new checks automatically; confirm by running coverage in Step 4. If a new callback needs forcing, add `getTableConfig(persons)` there.

- [ ] **Step 4: Run coverage, verify green** — Run: `pnpm --filter @waitron/identity test:coverage` · Expected: PASS, thresholds met.

- [ ] **Step 5: Commit**

```bash
git add packages/identity/src/schema/persons.ts packages/identity/drizzle/0004_* packages/identity/drizzle/meta packages/identity/src/index.test.ts
git commit -s -m "feat(identity): add nullable password_hash/totp_secret to persons"
```

---

### Task 5: `management_sessions` table + schema-ownership

**Files:**
- Create: `packages/identity/src/schema/management-sessions.ts`
- Modify: `packages/identity/src/schema/index.ts` (export the new table)
- Modify: `packages/identity/src/schema-ownership.test.ts` (add `"management_sessions"` to `OWNED`)
- Generate: `packages/identity/drizzle/0005_*.sql` (+ journal, snapshot)

**Interfaces:**
- Produces: `managementSessions` Drizzle table with columns `id`, `tenantId`, `personId`, `createdAt`, `lastSeenAt`, `endedAt`.

- [ ] **Step 1: Add `"management_sessions"` to `OWNED`** in `schema-ownership.test.ts` (this makes the test fail first — the guard proving we register exactly the owned tables). Run: `pnpm --filter @waitron/identity test schema-ownership` · Expected: FAIL (table not yet exported).

- [ ] **Step 2: Create the table** — `packages/identity/src/schema/management-sessions.ts`:

```ts
import { tenants } from "@waitron/db";
import { foreignKey, index, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { persons } from "./persons.js";

export const managementSessions = pgTable(
  "management_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    personId: uuid("person_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id], name: "management_sessions_tenant_fk" }).onDelete("restrict"),
    foreignKey({ columns: [t.personId], foreignColumns: [persons.id], name: "management_sessions_person_fk" }).onDelete("restrict"),
    index("management_sessions_tenant_id_idx").on(t.tenantId),
    index("management_sessions_open_idx").on(t.tenantId, t.personId),
  ],
).enableRLS();
```

- [ ] **Step 3: Export from the schema barrel** — add to `packages/identity/src/schema/index.ts`: `export { managementSessions } from "./management-sessions.js";`

- [ ] **Step 4: Generate the table migration** — Run: `pnpm --filter @waitron/identity db:generate` · Expected: `0005_<name>.sql` with `CREATE TABLE "management_sessions" … ENABLE ROW LEVEL SECURITY`, two FKs, two indexes, journal idx 5, snapshot. Read it to confirm.

- [ ] **Step 5: Run schema-ownership + typecheck** — Run: `pnpm --filter @waitron/identity test schema-ownership && pnpm --filter @waitron/identity typecheck` · Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/identity/src/schema/management-sessions.ts packages/identity/src/schema/index.ts packages/identity/src/schema-ownership.test.ts packages/identity/drizzle/0005_* packages/identity/drizzle/meta
git commit -s -m "feat(identity): management_sessions table (ENABLE RLS + FKs)"
```

---

### Task 6: `management_sessions` FORCE RLS (custom migration + real-PG proof)

**Files:**
- Create (via `db:generate:custom`): `packages/identity/drizzle/0006_*.sql`
- Create: `packages/identity/src/management-sessions.rls.test.ts`

**Interfaces:**
- Produces: FORCE RLS + `management_sessions_tenant_isolation` policy + `app_user` GRANT (SELECT, INSERT, UPDATE) on `management_sessions`.

- [ ] **Step 1: Generate an empty custom migration** — Run: `pnpm --filter @waitron/identity db:generate:custom` · Expected: an empty `0006_<name>.sql` + journal idx 6.

- [ ] **Step 2: Hand-write the RLS SQL** into that `0006_*.sql` (mirror `0001_identity_rls.sql` exactly — `current_tenant_id()` is NOT redefined, it comes from core):

```sql
--> statement-breakpoint
ALTER TABLE "management_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "management_sessions_tenant_isolation" ON "management_sessions"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

REVOKE ALL ON "management_sessions" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "management_sessions" TO app_user;
```

- [ ] **Step 3: Write the failing real-PG RLS test** — `packages/identity/src/management-sessions.rls.test.ts` (mirror `persons.rls.test.ts`; requires Docker + `TESTCONTAINERS_RYUK_DISABLED=true` locally):

```ts
import { asAppUser, withTenant } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { sql } from "drizzle-orm";
import { pgErrorCode } from "@waitron/db/testing/errors.js";
import { describe, expect, it } from "vitest";
import { startRealPostgres } from "./testing/postgres.js";
import { seedPerson } from "../test/fixtures.js";

const PROBE_ROLE = "mgmt_sessions_rls_probe";
const PROBE_PASSWORD = "probe";

const suite = useRealPostgres({
  start: startRealPostgres,
  probeRole: { name: PROBE_ROLE, password: PROBE_PASSWORD, inRole: "app_user" },
});

async function insertOpenSession(db: typeof suite.admin, tenantId: string, personId: string): Promise<string> {
  return withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    const [row] = await tx.execute(
      sql`insert into management_sessions (tenant_id, person_id) values (${tenantId}, ${personId}) returning id`,
    );
    return (row as { id: string }).id;
  });
}

describe("management_sessions RLS (real Postgres)", () => {
  it("hides another tenant's sessions and refuses DELETE", async () => {
    const tenantA = await seedTenant(suite.admin);
    const tenantB = await seedTenant(suite.admin);
    const personA = await seedPerson(suite.admin, tenantA);
    const sessionA = await insertOpenSession(suite.admin, tenantA, personA);

    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // Own tenant sees its row.
      const own = await withTenant(probe, tenantA, (tx) =>
        tx.execute(sql`select id from management_sessions`),
      );
      expect(own.length).toBe(1);
      // Cross-tenant is invisible.
      const cross = await withTenant(probe, tenantB, (tx) =>
        tx.execute(sql`select id from management_sessions`),
      );
      expect(cross.length).toBe(0);
      // DELETE is refused (no grant).
      const deleteError = await withTenant(probe, tenantA, async (tx) => {
        try {
          await tx.execute(sql`delete from management_sessions where id = ${sessionA}`);
          return null;
        } catch (error) {
          return pgErrorCode(error);
        }
      });
      expect(deleteError).toBe("42501");
    } finally {
      await probe.close();
    }
  });
});
```

(Adjust imports of `pgErrorCode`/`connectAs`/`seedPerson` to the exact paths confirmed in the sibling `persons.rls.test.ts` if they differ.)

- [ ] **Step 4: Run the RLS test, verify it passes** — Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/identity test management-sessions.rls` · Expected: PASS (own-tenant visible, cross-tenant hidden, DELETE → 42501).

- [ ] **Step 5: Run the FORCE-RLS guard in the other package** — Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` · Expected: PASS — `management_sessions` is auto-discovered (it has `tenant_id`) and must show `relforcerowsecurity = true`. If it lists `management_sessions` as non-compliant, FORCE RLS in Step 2 is missing.

- [ ] **Step 6: Commit**

```bash
git add packages/identity/drizzle/0006_* packages/identity/drizzle/meta packages/identity/src/management-sessions.rls.test.ts
git commit -s -m "feat(identity): FORCE RLS + tenant isolation for management_sessions"
```

---

### Task 7: Management session lifecycle (start / resolve / end)

**Files:**
- Create: `packages/identity/src/management-session.ts`
- Create: `packages/identity/src/management-session.test.ts`
- Modify: `packages/identity/src/errors.ts` (add `management_session.required`, `management_session.expired`)
- Modify: `packages/identity/src/index.ts` (export the lifecycle + type)

**Interfaces:**
- Consumes: `managementSessions` (Task 5), `persons` schema, `PersonRoleValue`.
- Produces:
  - `IDLE_TIMEOUT_MS: number`
  - `interface ManagementSession { id: string; tenantId: string; personId: string }`
  - `startManagementSession(tx, input: { tenantId: string; personId: string }): Promise<ManagementSession>`
  - `resolveManagementSession(tx, sessionId: string): Promise<{ personId: string; role: PersonRoleValue }>` — throws `management_session.required` (missing/ended), `management_session.expired` (idle), `person.suspended` (status re-check); bumps `last_seen_at` (sliding window).
  - `endManagementSession(tx, sessionId: string): Promise<boolean>`

- [ ] **Step 1: Add error codes** in `errors.ts`:

```ts
    "management_session.required": Record<string, never>;
    "management_session.expired": Record<string, never>;
```

- [ ] **Step 2: Write the failing test** — `packages/identity/src/management-session.test.ts` (PGlite; PGlite is superuser so RLS is a no-op here — this suite tests *logic*, RLS is proven in Task 6):

```ts
import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { seedPerson } from "../test/fixtures.js";
import { codeOf } from "@waitron/db/testing/errors.js";
import { endManagementSession, resolveManagementSession, startManagementSession } from "./management-session.js";
import { suspendPerson } from "./staff.js"; // NOTE: Task 9 changes suspendPerson's signature; until then, suspend via raw update below.

let tenantId: string;
const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  setup: async (db) => { tenantId = await seedTenant(db); },
});
const run = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTenant(suite.db, tenantId, fn);

describe("management session lifecycle", () => {
  it("starts and resolves a session, returning the person's role", async () => {
    const personId = await seedPerson(suite.db, tenantId, "manager");
    const session = await run((tx) => startManagementSession(tx, { tenantId, personId }));
    const resolved = await run((tx) => resolveManagementSession(tx, session.id));
    expect(resolved).toEqual({ personId, role: "manager" });
  });

  it("throws management_session.required for an unknown id", async () => {
    const code = await run((tx) =>
      codeOf(() => resolveManagementSession(tx, "00000000-0000-4000-8000-000000000000")),
    );
    expect(code).toBe("management_session.required");
  });

  it("throws management_session.required after endManagementSession", async () => {
    const personId = await seedPerson(suite.db, tenantId, "manager");
    const session = await run((tx) => startManagementSession(tx, { tenantId, personId }));
    expect(await run((tx) => endManagementSession(tx, session.id))).toBe(true);
    const code = await run((tx) => codeOf(() => resolveManagementSession(tx, session.id)));
    expect(code).toBe("management_session.required");
  });

  it("throws management_session.expired past the idle timeout", async () => {
    const personId = await seedPerson(suite.db, tenantId, "manager");
    const session = await run((tx) => startManagementSession(tx, { tenantId, personId }));
    // Age last_seen_at beyond the timeout.
    await run((tx) =>
      tx.execute(sql`update management_sessions set last_seen_at = now() - interval '2 days' where id = ${session.id}`),
    );
    const code = await run((tx) => codeOf(() => resolveManagementSession(tx, session.id)));
    expect(code).toBe("management_session.expired");
  });

  it("throws person.suspended when the person is suspended mid-session", async () => {
    const personId = await seedPerson(suite.db, tenantId, "manager");
    const session = await run((tx) => startManagementSession(tx, { tenantId, personId }));
    await run((tx) => tx.execute(sql`update persons set status = 'suspended' where id = ${personId}`));
    const code = await run((tx) => codeOf(() => resolveManagementSession(tx, session.id)));
    expect(code).toBe("person.suspended");
  });
});
```

(Remove the unused `suspendPerson` import — the suspend test uses a raw `update`, which keeps this suite independent of Task 9's signature change.)

- [ ] **Step 3: Run the test, verify it fails** — Run: `pnpm --filter @waitron/identity test management-session` · Expected: FAIL, module not found.

- [ ] **Step 4: Implement `management-session.ts`:**

```ts
import "./errors.js";
import { AppError } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { managementSessions } from "./schema/management-sessions.js";
import { persons } from "./schema/persons.js";
import type { PersonRoleValue } from "./permissions.js";

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes, sliding

export interface ManagementSession {
  id: string;
  tenantId: string;
  personId: string;
}

export async function startManagementSession(
  tx: Transaction,
  input: { tenantId: string; personId: string },
): Promise<ManagementSession> {
  const [row] = await tx
    .insert(managementSessions)
    .values({ tenantId: input.tenantId, personId: input.personId })
    .returning({ id: managementSessions.id });
  return { id: row!.id, tenantId: input.tenantId, personId: input.personId };
}

export async function resolveManagementSession(
  tx: Transaction,
  sessionId: string,
): Promise<{ personId: string; role: PersonRoleValue }> {
  const [row] = await tx
    .select({
      personId: managementSessions.personId,
      lastSeenAt: managementSessions.lastSeenAt,
      role: persons.role,
      status: persons.status,
    })
    .from(managementSessions)
    .innerJoin(persons, eq(persons.id, managementSessions.personId))
    .where(and(eq(managementSessions.id, sessionId), isNull(managementSessions.endedAt)));
  if (row === undefined) throw new AppError("management_session.required", {});
  if (Date.now() - Date.parse(row.lastSeenAt) > IDLE_TIMEOUT_MS) {
    throw new AppError("management_session.expired", {});
  }
  if (row.status === "suspended") throw new AppError("person.suspended", { personId: row.personId });
  await tx.update(managementSessions).set({ lastSeenAt: sql`now()` }).where(eq(managementSessions.id, sessionId));
  return { personId: row.personId, role: row.role as PersonRoleValue };
}

export async function endManagementSession(tx: Transaction, sessionId: string): Promise<boolean> {
  const updated = await tx
    .update(managementSessions)
    .set({ endedAt: sql`now()` })
    .where(and(eq(managementSessions.id, sessionId), isNull(managementSessions.endedAt)))
    .returning({ id: managementSessions.id });
  return updated.length > 0;
}
```

- [ ] **Step 5: Export from the barrel** — add to `index.ts`:

```ts
export { IDLE_TIMEOUT_MS, startManagementSession, resolveManagementSession, endManagementSession } from "./management-session.js";
export type { ManagementSession } from "./management-session.js";
```

- [ ] **Step 6: Run tests, verify pass** — Run: `pnpm --filter @waitron/identity test management-session` · Expected: PASS (all five cases).

- [ ] **Step 7: Commit**

```bash
git add packages/identity/src/management-session.ts packages/identity/src/management-session.test.ts packages/identity/src/errors.ts packages/identity/src/index.ts
git commit -s -m "feat(identity): management session lifecycle (idle timeout + status recheck)"
```

---

### Task 8: `authorizeManager` + `loginManager` (the verifier seam)

**Files:**
- Create: `packages/identity/src/manager-login.ts`
- Create: `packages/identity/src/manager-login.test.ts`
- Modify: `packages/identity/src/index.ts` (export `authorizeManager`, `loginManager`)

**Interfaces:**
- Consumes: `resolveManagementSession`, `startManagementSession` (Task 7); `verifyPassword` (Task 2); `verifyTotp` (Task 3); `roleHasPermission`, `Permission` (`permissions.ts`); `persons` schema.
- Produces:
  - `authorizeManager(tx, args: { managementSessionId: string; permission: Permission }): Promise<{ authorizedBy: string }>` — throws `authorization.not_permitted` (and propagates `management_session.*` / `person.suspended`).
  - `loginManager(tx, input: { tenantId: string; personId: string; password: string; totp?: string }): Promise<ManagementSession>` — the verifier seam: password required; TOTP required **iff** enrolled; passkey plugs in here later. Throws `person.not_found`, `person.suspended`, `password.invalid`, `totp.invalid`.

- [ ] **Step 1: Write the failing test** — `packages/identity/src/manager-login.test.ts`:

```ts
import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { authenticator } from "otplib";
import { sql } from "drizzle-orm";
import { codeOf } from "@waitron/db/testing/errors.js";
import { describe, expect, it } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { seedPerson } from "../test/fixtures.js";
import { hashPassword } from "./verify-password.js";
import { authorizeManager, loginManager } from "./manager-login.js";

let tenantId: string;
const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  setup: async (db) => { tenantId = await seedTenant(db); },
});
const run = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTenant(suite.db, tenantId, fn);

async function seedManagerWithPassword(role = "manager"): Promise<string> {
  const personId = await seedPerson(suite.db, tenantId, role);
  await run((tx) => tx.execute(sql`update persons set password_hash = ${hashPassword("correct horse")} where id = ${personId}`));
  return personId;
}

describe("loginManager", () => {
  it("logs in with a correct password (no TOTP enrolled)", async () => {
    const personId = await seedManagerWithPassword();
    const session = await run((tx) => loginManager(tx, { tenantId, personId, password: "correct horse" }));
    expect(session.personId).toBe(personId);
  });
  it("rejects a wrong password with password.invalid", async () => {
    const personId = await seedManagerWithPassword();
    const code = await run((tx) => codeOf(() => loginManager(tx, { tenantId, personId, password: "wrong" })));
    expect(code).toBe("password.invalid");
  });
  it("rejects password.invalid when no password is set", async () => {
    const personId = await seedPerson(suite.db, tenantId, "manager");
    const code = await run((tx) => codeOf(() => loginManager(tx, { tenantId, personId, password: "anything" })));
    expect(code).toBe("password.invalid");
  });
  it("requires a valid TOTP when one is enrolled", async () => {
    const personId = await seedManagerWithPassword();
    const secret = authenticator.generateSecret();
    await run((tx) => tx.execute(sql`update persons set totp_secret = ${secret} where id = ${personId}`));
    const missing = await run((tx) => codeOf(() => loginManager(tx, { tenantId, personId, password: "correct horse" })));
    expect(missing).toBe("totp.invalid");
    const session = await run((tx) =>
      loginManager(tx, { tenantId, personId, password: "correct horse", totp: authenticator.generate(secret) }),
    );
    expect(session.personId).toBe(personId);
  });
  it("rejects login for a suspended person", async () => {
    const personId = await seedManagerWithPassword();
    await run((tx) => tx.execute(sql`update persons set status = 'suspended' where id = ${personId}`));
    const code = await run((tx) => codeOf(() => loginManager(tx, { tenantId, personId, password: "correct horse" })));
    expect(code).toBe("person.suspended");
  });
});

describe("authorizeManager", () => {
  it("permits a manager for person.manage", async () => {
    const personId = await seedManagerWithPassword("manager");
    const session = await run((tx) => loginManager(tx, { tenantId, personId, password: "correct horse" }));
    const auth = await run((tx) => authorizeManager(tx, { managementSessionId: session.id, permission: "person.manage" }));
    expect(auth.authorizedBy).toBe(personId);
  });
  it("refuses a staff role for person.manage", async () => {
    const personId = await seedManagerWithPassword("staff");
    const session = await run((tx) => loginManager(tx, { tenantId, personId, password: "correct horse" }));
    const code = await run((tx) =>
      codeOf(() => authorizeManager(tx, { managementSessionId: session.id, permission: "person.manage" })),
    );
    expect(code).toBe("authorization.not_permitted");
  });
});
```

- [ ] **Step 2: Run the test, verify it fails** — Run: `pnpm --filter @waitron/identity test manager-login` · Expected: FAIL, module not found.

- [ ] **Step 3: Implement `manager-login.ts`:**

```ts
import "./errors.js";
import { AppError } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { eq } from "drizzle-orm";
import { persons } from "./schema/persons.js";
import { verifyPassword } from "./verify-password.js";
import { verifyTotp } from "./totp.js";
import { roleHasPermission, type Permission } from "./permissions.js";
import { resolveManagementSession, startManagementSession, type ManagementSession } from "./management-session.js";

export async function loginManager(
  tx: Transaction,
  input: { tenantId: string; personId: string; password: string; totp?: string },
): Promise<ManagementSession> {
  const [person] = await tx
    .select({ status: persons.status, passwordHash: persons.passwordHash, totpSecret: persons.totpSecret })
    .from(persons)
    .where(eq(persons.id, input.personId));
  if (person === undefined) throw new AppError("person.not_found", { personId: input.personId });
  if (person.status === "suspended") throw new AppError("person.suspended", { personId: input.personId });
  if (person.passwordHash === null || !verifyPassword(input.password, person.passwordHash)) {
    throw new AppError("password.invalid", {});
  }
  if (person.totpSecret !== null) {
    if (input.totp === undefined || !verifyTotp(input.totp, person.totpSecret)) {
      throw new AppError("totp.invalid", {});
    }
  }
  // Verifier seam: a passkey path (slice 1d) adds an alternative branch here that also ends in startManagementSession.
  return startManagementSession(tx, { tenantId: input.tenantId, personId: input.personId });
}

export async function authorizeManager(
  tx: Transaction,
  args: { managementSessionId: string; permission: Permission },
): Promise<{ authorizedBy: string }> {
  const { personId, role } = await resolveManagementSession(tx, args.managementSessionId);
  if (!roleHasPermission(role, args.permission)) {
    throw new AppError("authorization.not_permitted", { permission: args.permission });
  }
  return { authorizedBy: personId };
}
```

- [ ] **Step 4: Export from the barrel** — add to `index.ts`: `export { loginManager, authorizeManager } from "./manager-login.js";`

- [ ] **Step 5: Run tests, verify pass** — Run: `pnpm --filter @waitron/identity test manager-login` · Expected: PASS (all seven cases).

- [ ] **Step 6: Commit**

```bash
git add packages/identity/src/manager-login.ts packages/identity/src/manager-login.test.ts packages/identity/src/index.ts
git commit -s -m "feat(identity): loginManager (verifier seam) + authorizeManager"
```

---

### Task 9: Point staff mutations at management sessions

**Design note:** the existing staff mutations (`createPerson`/`setRole`/`resetPin`/`suspendPerson`/`reactivatePerson`) gate via `authorize(tx, { sessionId: actorSessionId, permission: "person.manage" })`, which reads the **till** `sessions` table. The dashboard actor is a **management** session. There is no production HTTP caller of these mutations today (identity shipped headless in #58), so we repoint them at `authorizeManager` with the least churn. The till's `authorize()` stays for the fiscal void/correction paths. Unifying both session kinds behind one resolved-actor argument is a possible later refactor (YAGNI now).

**Files:**
- Modify: `packages/identity/src/staff.ts` (swap `actorSessionId` → `managementSessionId`, call `authorizeManager`)
- Modify: `packages/identity/src/staff.test.ts` (open a management session in setup instead of a till session)
- Modify: `packages/identity/test/fixtures.ts` (add `openManagementSession` helper)

**Interfaces:**
- Consumes: `authorizeManager`, `loginManager` (Task 8).
- Produces (changed signatures): `createPerson(tx, { tenantId; managementSessionId; displayName; role; pin })`, `setRole(tx, { managementSessionId; personId; role })`, `resetPin(tx, { managementSessionId; personId; pin })`, `suspendPerson(tx, { managementSessionId; personId })`, `reactivatePerson(tx, { managementSessionId; personId })`.

- [ ] **Step 1: Add the fixture helper** in `packages/identity/test/fixtures.ts`:

```ts
import { hashPassword } from "../src/verify-password.js";
import { loginManager } from "../src/manager-login.js";

// Seeds a manager with a known password and returns an open management session id.
export async function openManagementSession(
  db: Database,
  tenantId: string,
  role: PersonRoleValue = "manager",
): Promise<{ personId: string; sessionId: string }> {
  const personId = await seedPerson(db, tenantId, role);
  await withTenant(db, tenantId, (tx) =>
    tx.execute(sql`update persons set password_hash = ${hashPassword("correct horse")} where id = ${personId}`),
  );
  const session = await withTenant(db, tenantId, (tx) =>
    loginManager(tx, { tenantId, personId, password: "correct horse" }),
  );
  return { personId, sessionId: session.id };
}
```

(Match the file's existing imports for `Database`, `PersonRoleValue`, `withTenant`, `sql`, `seedPerson`.)

- [ ] **Step 2: Update `staff.ts`** — for each mutation, change the input field and the authorize call. Example for `createPerson`:

```ts
export async function createPerson(
  tx: Transaction,
  input: { tenantId: string; managementSessionId: string; displayName: string; role: PersonRoleValue; pin: string },
): Promise<{ id: string }> {
  await authorizeManager(tx, { managementSessionId: input.managementSessionId, permission: "person.manage" });
  assertPinLength(input.pin);
  const [row] = await tx
    .insert(persons)
    .values({ tenantId: input.tenantId, displayName: input.displayName, pinHash: hashPin(input.pin), role: input.role })
    .returning({ id: persons.id });
  return { id: row!.id };
}
```

Apply the same swap (`actorSessionId` → `managementSessionId`, `authorize(...)` → `authorizeManager({ managementSessionId, permission: "person.manage" })`) to `setRole`, `resetPin`, `suspendPerson`, `reactivatePerson`. Update the `import` at the top from `./authorize.js` to `./manager-login.js` (drop the now-unused `authorize` import if nothing else uses it in this file).

- [ ] **Step 3: Update `staff.test.ts`** — replace the till-session setup (`openSession`/`loginWithPin`) with `openManagementSession`, and pass `managementSessionId` to each mutation. Preserve every behavioural assertion (a `staff` role is refused `person.manage`; a `manager` succeeds; `pin.too_short` still fires; suspend then reactivate flips status). Example:

```ts
const { sessionId } = await openManagementSession(suite.db, tenantId, "manager");
const created = await run((tx) =>
  createPerson(tx, { tenantId, managementSessionId: sessionId, displayName: "Ada", role: "staff", pin: "4321" }),
);
```

and the refusal case:

```ts
const { sessionId: staffSession } = await openManagementSession(suite.db, tenantId, "staff");
const code = await run((tx) =>
  codeOf(() => createPerson(tx, { tenantId, managementSessionId: staffSession, displayName: "X", role: "staff", pin: "4321" })),
);
expect(code).toBe("authorization.not_permitted");
```

- [ ] **Step 4: Run staff tests, verify pass** — Run: `pnpm --filter @waitron/identity test staff` · Expected: PASS (behaviour preserved; actor is now a management session).

- [ ] **Step 5: Typecheck the package** (catches any remaining `actorSessionId` caller) — Run: `pnpm --filter @waitron/identity typecheck` · Expected: PASS. If a non-test caller surfaces (e.g. a provisioning seed), note it — it belongs to slice 1b's provisioning follow-up, not here; if it is only a demo/script, update it to open a management session.

- [ ] **Step 6: Commit**

```bash
git add packages/identity/src/staff.ts packages/identity/src/staff.test.ts packages/identity/test/fixtures.ts
git commit -s -m "refactor(identity): staff mutations authorize via management session"
```

---

### Task 10: `listPersons` (admin roster, gated, secrets never leak)

**Files:**
- Modify: `packages/identity/src/staff.ts` (add `listPersons` + `PersonSummary`)
- Modify: `packages/identity/src/staff.test.ts` (add coverage)
- Modify: `packages/identity/src/index.ts` (export `listPersons`, `PersonSummary`)

**Interfaces:**
- Consumes: `authorizeManager` (Task 8).
- Produces: `interface PersonSummary { personId: string; displayName: string; role: PersonRoleValue; status: "active" | "suspended"; hasPassword: boolean; hasTotp: boolean }`, `listPersons(tx, args: { managementSessionId: string }): Promise<PersonSummary[]>` — gated on `person.manage`; returns all persons of the tenant ordered by name; **never returns `pin_hash`, `password_hash`, or `totp_secret`** (only booleans).

- [ ] **Step 1: Write the failing test** — add to `packages/identity/src/staff.test.ts`:

```ts
it("listPersons returns a roster with credential booleans, no secrets", async () => {
  const { sessionId, personId: manager } = await openManagementSession(suite.db, tenantId, "manager");
  await run((tx) =>
    createPerson(tx, { tenantId, managementSessionId: sessionId, displayName: "Ada", role: "staff", pin: "4321" }),
  );
  const roster = await run((tx) => listPersons(tx, { managementSessionId: sessionId }));
  const names = roster.map((p) => p.displayName);
  expect(names).toContain("Ada");
  const self = roster.find((p) => p.personId === manager)!;
  expect(self.hasPassword).toBe(true);
  expect(self.hasTotp).toBe(false);
  expect(Object.keys(roster[0]!)).toEqual(
    expect.arrayContaining(["personId", "displayName", "role", "status", "hasPassword", "hasTotp"]),
  );
  expect(JSON.stringify(roster)).not.toContain("scrypt$");
});

it("listPersons refuses a staff role", async () => {
  const { sessionId } = await openManagementSession(suite.db, tenantId, "staff");
  const code = await run((tx) => codeOf(() => listPersons(tx, { managementSessionId: sessionId })));
  expect(code).toBe("authorization.not_permitted");
});
```

- [ ] **Step 2: Run, verify it fails** — Run: `pnpm --filter @waitron/identity test staff` · Expected: FAIL, `listPersons` not defined.

- [ ] **Step 3: Implement `listPersons`** in `staff.ts`:

```ts
export interface PersonSummary {
  personId: string;
  displayName: string;
  role: PersonRoleValue;
  status: "active" | "suspended";
  hasPassword: boolean;
  hasTotp: boolean;
}

export async function listPersons(
  tx: Transaction,
  args: { managementSessionId: string },
): Promise<PersonSummary[]> {
  await authorizeManager(tx, { managementSessionId: args.managementSessionId, permission: "person.manage" });
  const rows = await tx
    .select({
      personId: persons.id,
      displayName: persons.displayName,
      role: persons.role,
      status: persons.status,
      passwordHash: persons.passwordHash,
      totpSecret: persons.totpSecret,
    })
    .from(persons)
    .orderBy(persons.displayName);
  return rows.map((r) => ({
    personId: r.personId,
    displayName: r.displayName,
    role: r.role as PersonRoleValue,
    status: r.status as "active" | "suspended",
    hasPassword: r.passwordHash !== null,
    hasTotp: r.totpSecret !== null,
  }));
}
```

- [ ] **Step 4: Export from the barrel** — add to `index.ts`: `export { listPersons } from "./staff.js";` and `export type { PersonSummary } from "./staff.js";`

- [ ] **Step 5: Run tests, verify pass** — Run: `pnpm --filter @waitron/identity test staff` · Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/identity/src/staff.ts packages/identity/src/staff.test.ts packages/identity/src/index.ts
git commit -s -m "feat(identity): person.manage-gated listPersons (secrets never leak)"
```

---

### Task 11: Full-package green + guard sweep

**Files:** none (verification only).

- [ ] **Step 1: Reachability of new error codes** — Run: `pnpm --filter @waitron/identity test errors.reachability` · Expected: PASS. If it fails, a new throwing module is missing `import "./errors.js";` or the code is not declared in `errors.ts`. (The six new codes: `password.too_short`, `password.invalid`, `totp.invalid`, `management_session.required`, `management_session.expired` — plus existing `person.*`/`authorization.*` reused.)

- [ ] **Step 2: Full identity coverage gate** — Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/identity test:coverage` · Expected: PASS at 98/98/98/95. This runs the whole package unfiltered (including `errors.reachability`, `schema-ownership`, and the real-PG RLS suites) — a name-filtered run would skip the cross-cutting guards.

- [ ] **Step 3: FORCE-RLS guard (other package)** — Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` · Expected: PASS — `management_sessions` discovered with `relforcerowsecurity = true`.

- [ ] **Step 4: Manifest / vocabulary pins** — this slice adds **no** new migration set and **no** new generic package (identity already owns both), so `packages/migrations/src/manifest.test.ts`, `scripts/english-only.test.ts`, and `packages/fiscal-verifactu/src/vocabulary-scope.test.ts` are unaffected. Confirm: Run: `pnpm --filter @waitron/migrations test manifest` · Expected: PASS (unchanged).

- [ ] **Step 5: Workspace gate** — Run from repo root: `pnpm lint && pnpm typecheck && pnpm format:check` · Expected: PASS. (`pnpm install` was already run in Task 3 for `otplib`; confirm the lockfile is committed so `--frozen-lockfile` in CI/pre-push passes.)

- [ ] **Step 6: No commit** — verification task; if any step failed, fix under the owning task and re-run.

---

## Self-Review

**Spec coverage (against `2026-08-07-management-dashboard-design.md` §4b + §3):**
- §4b passkey-primary — **deferred to slice 1d** (stated in the plan header and Task 8's verifier-seam comment). ✅ (in-scope for 1a: the seam it plugs into.)
- §4b password + TOTP, both offline-verifiable, behind a verifier seam — Tasks 2, 3, 8. ✅
- §4b "TOTP not stacked on a passkey; TOTP pairs with password" — `loginManager` enforces TOTP only when enrolled, independent of any passkey. ✅
- §4d management session, idle timeout, re-reads `persons.status` — Task 7. ✅
- §3 `listPersons` (the "small read that may need adding"), `person.manage`-gated — Task 10. ✅
- §3 staff-admin actions (create/setRole/resetPin/suspend/reactivate) usable by the dashboard actor — Task 9. ✅
- §9 testing: real-PG RLS tenant isolation, prove-by-guard, credential unit tests mirroring PIN — Tasks 1/2/3 (unit), 6 (RLS), 11 (guards). ✅
- **Out of 1a (correctly): server API (1b), dashboard app (1c), passkeys (1d), federated/magic-link, auth-policy config, password/TOTP enrollment UX** — none appear as tasks. Bootstrapping the first admin's password is a **slice-1b provisioning concern** (noted in Task 9 Step 5).

**Placeholder scan:** no TBD/TODO; every code step has real code. ✅

**Type consistency:** `managementSessionId` is used uniformly across Tasks 8–10; `resolveManagementSession` returns `{ personId, role }` consumed identically by `authorizeManager`; `ManagementSession { id, tenantId, personId }` returned by `startManagementSession`/`loginManager` and consumed by `openManagementSession`; `PersonSummary` fields match the `listPersons` mapping. ✅

---

## Execution Handoff

Filled in by the brainstorming/writing-plans flow after save.
