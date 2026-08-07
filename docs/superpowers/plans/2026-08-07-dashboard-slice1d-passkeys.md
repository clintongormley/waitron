# Dashboard Slice 1d — Passkeys (WebAuthn) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add passkeys (WebAuthn) as the primary, phishing-resistant login for the management dashboard — registration and authentication ceremonies across `@waitron/identity`, the management API, and `apps/dashboard` — plugging into the verifier seam slice 1a established.

**Architecture:** `@waitron/identity` gains two tenant-scoped tables (`webauthn_credentials`, `webauthn_challenges`), the `@simplewebauthn/server` ceremony wrapped in four functions, and a passkey branch of the verifier seam that ends — like `loginManager` — in `startManagementSession`. The management API exposes four routes (register options/verify, auth options/verify); the RP ID and origin come from config (the canonical dashboard hostname — §4c of the spec). `apps/dashboard` uses `@simplewebauthn/browser` to drive the browser ceremony.

**Tech Stack:** `@simplewebauthn/server ^13`, `@simplewebauthn/browser ^13`, Drizzle (two new tables + RLS), Vitest (unit tests mock the ceremony verify; a Playwright virtual-authenticator integration test is a flagged stretch).

**Depends on:** slices 1a (verifier seam, `startManagementSession`, `resolveManagementSession`), 1b (management API + cookie), 1c (dashboard login screen + `DashboardApi`).

> **API-version caveat:** the `@simplewebauthn/server` v13 signatures below are written from its documented shape (four functions; `generateRegistrationOptions`/`generateAuthenticationOptions` are **async**; `userID` is a **`Uint8Array`**; challenges are single-use, stored between options and verify; `verifyRegistrationResponse` → `{ verified, registrationInfo }`; `verifyAuthenticationResponse` → `{ verified, authenticationInfo: { newCounter } }`). **Confirm exact field names against the installed package's `.d.ts` at implementation time** and adjust — do not assume.

## Global Constraints

- **RP ID = the canonical dashboard hostname, one value LAN and remote** (spec §4c) — a passkey is bound to its origin. RP ID and origin are **config**, never hardcoded in identity. In browser tests the origin is `http://localhost:<port>` and RP ID is `localhost`.
- **A passkey is already two-factor** — do NOT gate a passkey login behind TOTP.
- **New `tenant_id` tables need FORCE RLS** (identity 1a Task 6 pattern); the `inmutabilidad` guard will scan them.
- **`packages/identity/drizzle/meta/_journal.json` conflicts across concurrent identity branches** — sequence this after 1a's migrations (0004–0006); these add 0007+.
- **Coverage 98/98/98/95 (identity, server), 95/95/90/88 (dashboard).** Every commit `-s`. Real-PG/inmutabilidad runs need `TESTCONTAINERS_RYUK_DISABLED=true`.
- **Never store a private key** — WebAuthn stores only the credential's **public key** + a signature counter. Secrets never leave the authenticator.

---

### Task 1: `webauthn_credentials` + `webauthn_challenges` tables (+ RLS)

**Files:**
- Create: `packages/identity/src/schema/webauthn.ts`
- Modify: `packages/identity/src/schema/index.ts`, `packages/identity/src/schema-ownership.test.ts` (add both table names to `OWNED`)
- Generate: `packages/identity/drizzle/0007_*.sql` (tables), `0008_*.sql` (custom RLS)
- Create: `packages/identity/src/webauthn.rls.test.ts`

**Interfaces:**
- Produces `webauthnCredentials` (`id`, `tenantId`, `personId`, `credentialId` text unique-per-tenant, `publicKey` text (base64url), `counter` bigint, `transports` text, `createdAt`) and `webauthnChallenges` (`id`, `tenantId`, `personId` nullable, `challenge` text, `createdAt`).

- [ ] **Step 1: Add both table names to `OWNED`** in `schema-ownership.test.ts` (fails first). Run: `pnpm --filter @waitron/identity test schema-ownership` · Expected: FAIL.

- [ ] **Step 2: Create `schema/webauthn.ts`:**

```ts
import { tenants } from "@waitron/db";
import { bigint, foreignKey, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { persons } from "./persons.js";

export const webauthnCredentials = pgTable(
  "webauthn_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    personId: uuid("person_id").notNull(),
    credentialId: text("credential_id").notNull(),   // base64url
    publicKey: text("public_key").notNull(),          // base64url of the COSE public key
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: text("transports"),                   // JSON array string, optional
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id], name: "webauthn_credentials_tenant_fk" }).onDelete("restrict"),
    foreignKey({ columns: [t.personId], foreignColumns: [persons.id], name: "webauthn_credentials_person_fk" }).onDelete("restrict"),
    unique("webauthn_credentials_credential_id_uq").on(t.tenantId, t.credentialId),
    index("webauthn_credentials_person_idx").on(t.tenantId, t.personId),
  ],
).enableRLS();

export const webauthnChallenges = pgTable(
  "webauthn_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    personId: uuid("person_id"),                      // null for a login (discoverable) ceremony
    challenge: text("challenge").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id], name: "webauthn_challenges_tenant_fk" }).onDelete("restrict"),
    index("webauthn_challenges_tenant_idx").on(t.tenantId),
  ],
).enableRLS();
```

- [ ] **Step 3: Export both** from `schema/index.ts`; **generate** the table migration: `pnpm --filter @waitron/identity db:generate` → `0007_*.sql`. Read it.

- [ ] **Step 4: Generate + hand-write the RLS migration** — `pnpm --filter @waitron/identity db:generate:custom` → `0008_*.sql`; for **each** table write the `0001_identity_rls.sql` pattern (FORCE RLS + `<table>_tenant_isolation` policy `USING/WITH CHECK (tenant_id = current_tenant_id())` + `REVOKE ALL … FROM app_user` + `GRANT SELECT, INSERT, UPDATE, DELETE ON <table> TO app_user`). **DELETE is granted here** — challenges are consumed (deleted) after use, and a stale credential may be removed; both are live config, not an audit trail (mirror `packages/credentials`'s DELETE grant, not the sessions no-DELETE rule).

- [ ] **Step 5: Write the RLS test** — `webauthn.rls.test.ts` mirroring `management-sessions.rls.test.ts` (Task 6 of 1a): own-tenant read/write on `webauthn_credentials`, cross-tenant hidden, and (since DELETE is granted) prove DELETE **succeeds** within-tenant and cross-tenant DELETE affects zero rows. Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/identity test webauthn.rls` · Expected: PASS.

- [ ] **Step 6: FORCE-RLS guard** — Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` · Expected: PASS — both new tables discovered with `relforcerowsecurity = true`.

- [ ] **Step 7: Commit**

```bash
git add packages/identity/src/schema/webauthn.ts packages/identity/src/schema/index.ts packages/identity/src/schema-ownership.test.ts packages/identity/drizzle/0007_* packages/identity/drizzle/0008_* packages/identity/drizzle/meta packages/identity/src/webauthn.rls.test.ts
git commit -s -m "feat(identity): webauthn credential + challenge tables (FORCE RLS)"
```

---

### Task 2: Passkey registration ceremony

**Files:**
- Modify: `packages/identity/package.json` (add `@simplewebauthn/server ^13`)
- Create: `packages/identity/src/passkey.ts`, `packages/identity/src/passkey.test.ts`
- Modify: `packages/identity/src/errors.ts` (`passkey.not_registered`, `passkey.verification_failed`, `passkey.challenge_expired`)
- Modify: `packages/identity/src/index.ts` (export the registration functions + types)

**Interfaces:**
- Produces:
  - `CHALLENGE_TTL_MS: number`
  - `beginPasskeyRegistration(tx, input: { managementSessionId: string; tenantId: string; rpId: string; rpName: string }): Promise<{ challengeHandle: string; options: PublicKeyCredentialCreationOptionsJSON }>`
  - `finishPasskeyRegistration(tx, input: { managementSessionId: string; tenantId: string; challengeHandle: string; response: RegistrationResponseJSON; rpId: string; origin: string }): Promise<{ credentialId: string }>`

- [ ] **Step 1: Add the dependency** — `packages/identity/package.json` `dependencies`: `"@simplewebauthn/server": "^13.0.0"`; run `pnpm install`; commit lockfile with this task.

- [ ] **Step 2: Add error codes** in `errors.ts`:

```ts
    "passkey.not_registered": Record<string, never>;
    "passkey.verification_failed": Record<string, never>;
    "passkey.challenge_expired": Record<string, never>;
```

- [ ] **Step 3: Write the failing test** — `passkey.test.ts`. WebAuthn attestation cannot be synthesised in a unit test, so **mock `@simplewebauthn/server`'s verify function** and assert OUR wiring (challenge stored then consumed, credential persisted with counter, person resolved from the session):

```ts
import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { openManagementSession } from "../test/fixtures.js";

vi.mock("@simplewebauthn/server", async (orig) => ({
  ...(await orig<typeof import("@simplewebauthn/server")>()),
  verifyRegistrationResponse: vi.fn().mockResolvedValue({
    verified: true,
    registrationInfo: { credential: { id: "cred-abc", publicKey: new Uint8Array([1, 2, 3]), counter: 0 } },
  }),
}));

let tenantId: string;
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS], setup: async (db) => { tenantId = await seedTenant(db); } });
const run = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTenant(suite.db, tenantId, fn);

describe("passkey registration", () => {
  it("issues options, stores a challenge, then persists the credential", async () => {
    const { sessionId } = await openManagementSession(suite.db, tenantId, "admin");
    const { beginPasskeyRegistration, finishPasskeyRegistration } = await import("./passkey.js");
    const begun = await run((tx) =>
      beginPasskeyRegistration(tx, { managementSessionId: sessionId, tenantId, rpId: "localhost", rpName: "Waitron" }),
    );
    expect(begun.challengeHandle).toBeTruthy();
    expect(begun.options.challenge).toBeTruthy();

    const done = await run((tx) =>
      finishPasskeyRegistration(tx, {
        managementSessionId: sessionId, tenantId, challengeHandle: begun.challengeHandle,
        response: {} as never, rpId: "localhost", origin: "http://localhost",
      }),
    );
    expect(done.credentialId).toBe("cred-abc");

    // Credential row landed; challenge consumed.
    const creds = await run((tx) => tx.execute(sql`select credential_id from webauthn_credentials`));
    expect(creds.length).toBe(1);
    const chal = await run((tx) => tx.execute(sql`select id from webauthn_challenges where id = ${begun.challengeHandle}`));
    expect(chal.length).toBe(0);
  });

  it("throws passkey.verification_failed when the ceremony does not verify", async () => {
    const mod = await import("@simplewebauthn/server");
    (mod.verifyRegistrationResponse as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ verified: false });
    const { sessionId } = await openManagementSession(suite.db, tenantId, "admin");
    const { beginPasskeyRegistration, finishPasskeyRegistration } = await import("./passkey.js");
    const begun = await run((tx) => beginPasskeyRegistration(tx, { managementSessionId: sessionId, tenantId, rpId: "localhost", rpName: "Waitron" }));
    await expect(
      run((tx) => finishPasskeyRegistration(tx, { managementSessionId: sessionId, tenantId, challengeHandle: begun.challengeHandle, response: {} as never, rpId: "localhost", origin: "http://localhost" })),
    ).rejects.toMatchObject({ code: "passkey.verification_failed" });
  });
});
```

- [ ] **Step 4: Run, verify it fails** — Run: `pnpm --filter @waitron/identity test passkey` · Expected: FAIL, module not found.

- [ ] **Step 5: Implement `passkey.ts` (registration half)** — resolve the session for the person, issue options, store the challenge, verify, persist. **Confirm every `@simplewebauthn/server` field against its types.**

```ts
import "./errors.js";
import { AppError } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { and, eq, sql } from "drizzle-orm";
import { generateRegistrationOptions, verifyRegistrationResponse } from "@simplewebauthn/server";
import type { PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { persons } from "./schema/persons.js";
import { webauthnCredentials, webauthnChallenges } from "./schema/webauthn.js";
import { resolveManagementSession } from "./management-session.js";

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export async function beginPasskeyRegistration(
  tx: Transaction,
  input: { managementSessionId: string; tenantId: string; rpId: string; rpName: string },
): Promise<{ challengeHandle: string; options: PublicKeyCredentialCreationOptionsJSON }> {
  const { personId } = await resolveManagementSession(tx, input.managementSessionId);
  const [person] = await tx.select({ displayName: persons.displayName }).from(persons).where(eq(persons.id, personId));
  const existing = await tx.select({ credentialId: webauthnCredentials.credentialId })
    .from(webauthnCredentials).where(eq(webauthnCredentials.personId, personId));
  const options = await generateRegistrationOptions({
    rpID: input.rpId,
    rpName: input.rpName,
    userID: textToBytes(personId),          // Uint8Array (v10+)
    userName: person!.displayName,
    excludeCredentials: existing.map((c) => ({ id: c.credentialId })),
  });
  const [row] = await tx.insert(webauthnChallenges)
    .values({ tenantId: input.tenantId, personId, challenge: options.challenge })
    .returning({ id: webauthnChallenges.id });
  return { challengeHandle: row!.id, options };
}

export async function finishPasskeyRegistration(
  tx: Transaction,
  input: { managementSessionId: string; tenantId: string; challengeHandle: string; response: RegistrationResponseJSON; rpId: string; origin: string },
): Promise<{ credentialId: string }> {
  const { personId } = await resolveManagementSession(tx, input.managementSessionId);
  const [challenge] = await tx.select({ challenge: webauthnChallenges.challenge, createdAt: webauthnChallenges.createdAt })
    .from(webauthnChallenges).where(eq(webauthnChallenges.id, input.challengeHandle));
  if (challenge === undefined) throw new AppError("passkey.verification_failed", {});
  if (Date.now() - Date.parse(challenge.createdAt) > CHALLENGE_TTL_MS) {
    await tx.delete(webauthnChallenges).where(eq(webauthnChallenges.id, input.challengeHandle));
    throw new AppError("passkey.challenge_expired", {});
  }
  const verification = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: input.origin,
    expectedRPID: input.rpId,
  });
  await tx.delete(webauthnChallenges).where(eq(webauthnChallenges.id, input.challengeHandle)); // single-use
  if (!verification.verified || verification.registrationInfo === undefined) {
    throw new AppError("passkey.verification_failed", {});
  }
  const cred = verification.registrationInfo.credential; // { id, publicKey, counter } — confirm shape vs .d.ts
  await tx.insert(webauthnCredentials).values({
    tenantId: input.tenantId, personId,
    credentialId: cred.id,
    publicKey: b64url(cred.publicKey),
    counter: cred.counter,
  });
  return { credentialId: cred.id };
}
```

- [ ] **Step 6: Export + run** — export `beginPasskeyRegistration`, `finishPasskeyRegistration`, `CHALLENGE_TTL_MS` from `index.ts`. Run: `pnpm --filter @waitron/identity test passkey` · Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/identity/package.json packages/identity/src/passkey.ts packages/identity/src/passkey.test.ts packages/identity/src/errors.ts packages/identity/src/index.ts ../../pnpm-lock.yaml
git commit -s -m "feat(identity): passkey registration ceremony"
```

---

### Task 3: Passkey authentication ceremony (verifier-seam completion)

**Files:**
- Modify: `packages/identity/src/passkey.ts` (+ `passkey.test.ts`)
- Modify: `packages/identity/src/index.ts`

**Interfaces:**
- Produces:
  - `beginPasskeyAuthentication(tx, input: { tenantId: string; rpId: string }): Promise<{ challengeHandle: string; options: PublicKeyCredentialRequestOptionsJSON }>`
  - `finishPasskeyAuthentication(tx, input: { tenantId: string; challengeHandle: string; response: AuthenticationResponseJSON; rpId: string; origin: string }): Promise<ManagementSession>` — the passkey branch of the verifier seam: verifies, bumps the stored counter, resolves the credential's person, and (like `loginManager`) ends in `startManagementSession`. Throws `passkey.not_registered` / `passkey.verification_failed` / `passkey.challenge_expired`.

- [ ] **Step 1: Write the failing test** — add to `passkey.test.ts`; mock `verifyAuthenticationResponse` to return `{ verified: true, authenticationInfo: { newCounter: 1 } }`, seed a credential row, and assert `finishPasskeyAuthentication` returns a session whose `personId` is the credential's owner and that the stored counter advanced:

```ts
it("authenticates a registered passkey into a management session", async () => {
  const mod = await import("@simplewebauthn/server");
  (mod.verifyAuthenticationResponse as unknown as ReturnType<typeof vi.fn>) ??= vi.fn();
  const personId = /* seedPerson admin */ "";
  // …seed a webauthn_credentials row for personId with credential_id "cred-abc", counter 0…
  const { beginPasskeyAuthentication, finishPasskeyAuthentication } = await import("./passkey.js");
  const begun = await run((tx) => beginPasskeyAuthentication(tx, { tenantId, rpId: "localhost" }));
  const session = await run((tx) => finishPasskeyAuthentication(tx, {
    tenantId, challengeHandle: begun.challengeHandle,
    response: { id: "cred-abc" } as never, rpId: "localhost", origin: "http://localhost",
  }));
  expect(session.personId).toBe(personId);
});
```

(Add the `vi.mock` for `verifyAuthenticationResponse` alongside the registration mock at the top of the file. Fill the seeding against the `webauthnCredentials` insert used in Task 2.)

- [ ] **Step 2: Run, verify fails** — Run: `pnpm --filter @waitron/identity test passkey` · Expected: FAIL.

- [ ] **Step 3: Implement the authentication half** in `passkey.ts`:

```ts
import { generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import { startManagementSession, type ManagementSession } from "./management-session.js";

export async function beginPasskeyAuthentication(
  tx: Transaction,
  input: { tenantId: string; rpId: string },
): Promise<{ challengeHandle: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  const options = await generateAuthenticationOptions({ rpID: input.rpId }); // discoverable: no allowCredentials
  const [row] = await tx.insert(webauthnChallenges)
    .values({ tenantId: input.tenantId, challenge: options.challenge })
    .returning({ id: webauthnChallenges.id });
  return { challengeHandle: row!.id, options };
}

export async function finishPasskeyAuthentication(
  tx: Transaction,
  input: { tenantId: string; challengeHandle: string; response: AuthenticationResponseJSON; rpId: string; origin: string },
): Promise<ManagementSession> {
  const [challenge] = await tx.select({ challenge: webauthnChallenges.challenge, createdAt: webauthnChallenges.createdAt })
    .from(webauthnChallenges).where(eq(webauthnChallenges.id, input.challengeHandle));
  if (challenge === undefined) throw new AppError("passkey.verification_failed", {});
  if (Date.now() - Date.parse(challenge.createdAt) > CHALLENGE_TTL_MS) {
    await tx.delete(webauthnChallenges).where(eq(webauthnChallenges.id, input.challengeHandle));
    throw new AppError("passkey.challenge_expired", {});
  }
  const [cred] = await tx.select({
    id: webauthnCredentials.id, personId: webauthnCredentials.personId,
    publicKey: webauthnCredentials.publicKey, counter: webauthnCredentials.counter, credentialId: webauthnCredentials.credentialId,
  }).from(webauthnCredentials).where(eq(webauthnCredentials.credentialId, input.response.id));
  if (cred === undefined) throw new AppError("passkey.not_registered", {});

  const verification = await verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: input.origin,
    expectedRPID: input.rpId,
    credential: { id: cred.credentialId, publicKey: Buffer.from(cred.publicKey, "base64url"), counter: cred.counter },
  });
  await tx.delete(webauthnChallenges).where(eq(webauthnChallenges.id, input.challengeHandle)); // single-use
  if (!verification.verified) throw new AppError("passkey.verification_failed", {});

  await tx.update(webauthnCredentials)
    .set({ counter: verification.authenticationInfo.newCounter })
    .where(eq(webauthnCredentials.id, cred.id));
  // Verifier seam: like loginManager, a successful passkey ends in a management session.
  return startManagementSession(tx, { tenantId: input.tenantId, personId: cred.personId });
}
```

- [ ] **Step 4: Export + run** — export both from `index.ts`. Run: `pnpm --filter @waitron/identity test passkey` · Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/identity/src/passkey.ts packages/identity/src/passkey.test.ts packages/identity/src/index.ts
git commit -s -m "feat(identity): passkey authentication → management session (verifier seam)"
```

---

### Task 4: Config (RP ID + origin) + management-API passkey routes

**Files:**
- Modify: `apps/server/src/config.ts` (add `WAITRON_MANAGEMENT_RP_ID`, `WAITRON_MANAGEMENT_ORIGIN`)
- Modify: `apps/server/src/boot.ts` (thread them into `ManagementApiDeps`)
- Modify: `apps/server/src/management-api.ts` (four passkey routes + widen `ManagementApiDeps` + STATUS entries)

**Interfaces:**
- `ManagementApiDeps` gains `rpId: string; origin: string`. STATUS gains `passkey.not_registered → 401`, `passkey.verification_failed → 401`, `passkey.challenge_expired → 400`.

- [ ] **Step 1: Add config** in `config.ts` — resolve `WAITRON_MANAGEMENT_RP_ID` and `WAITRON_MANAGEMENT_ORIGIN` (both required only when the dashboard is served; for dev/tests default `rpId="localhost"`, `origin="http://localhost:5191"`). Add to `ServerConfig` and to the object built in `loadConfig`. Follow the existing `required`/default helpers.

- [ ] **Step 2: Thread into boot** — update the `mountManagementApi(app, { db, cfg: { tenantId: till.tenantId }, secureCookies, rpId: config.managementRpId, origin: config.managementOrigin }, log)` call.

- [ ] **Step 3: Add the four routes** in `management-api.ts` (register = gated; auth = ungated). Import the four identity functions.

```ts
  // Passkey registration (gated).
  app.post("/management-api/passkey/register/options", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const out = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return beginPasskeyRegistration(tx, { managementSessionId: sessionId, tenantId: deps.cfg.tenantId, rpId: deps.rpId, rpName: "Waitron" });
      });
      return c.json(out);
    }),
  );
  app.post("/management-api/passkey/register/verify", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await c.req.json<{ challengeHandle: string; response: unknown }>();
      const out = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return finishPasskeyRegistration(tx, {
          managementSessionId: sessionId, tenantId: deps.cfg.tenantId,
          challengeHandle: body.challengeHandle, response: body.response as never, rpId: deps.rpId, origin: deps.origin,
        });
      });
      return c.json(out);
    }),
  );

  // Passkey authentication (ungated — this IS the login).
  app.post("/management-api/passkey/auth/options", (c) =>
    run(c, log, async () => {
      const out = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return beginPasskeyAuthentication(tx, { tenantId: deps.cfg.tenantId, rpId: deps.rpId });
      });
      return c.json(out);
    }),
  );
  app.post("/management-api/passkey/auth/verify", (c) =>
    run(c, log, async () => {
      const body = await c.req.json<{ challengeHandle: string; response: unknown }>();
      const session = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return finishPasskeyAuthentication(tx, {
          tenantId: deps.cfg.tenantId, challengeHandle: body.challengeHandle,
          response: body.response as never, rpId: deps.rpId, origin: deps.origin,
        });
      });
      setManagementCookie(c, session.id, deps.secureCookies);
      return c.json({ personId: session.personId });
    }),
  );
```

- [ ] **Step 4: Typecheck** — Run: `pnpm --filter @waitron/server typecheck` · Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/config.ts apps/server/src/boot.ts apps/server/src/management-api.ts
git commit -s -m "feat(server): passkey config + management-API passkey routes"
```

---

### Task 5: Server passkey route tests (mocked ceremony)

**Files:**
- Create: `apps/server/src/management-api-passkey.rls.test.ts`

- [ ] **Step 1: Write the test** — mirror the 1b RLS harness; `vi.mock("@simplewebauthn/server", …)` so `verifyRegistrationResponse`/`verifyAuthenticationResponse` return verified fixtures. Assert: register-options (gated, 401 without a cookie), register-verify persists a credential; auth-options (ungated) returns a handle; auth-verify sets a `waitron_management_session` cookie and returns the right `personId`. Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test management-api-passkey.rls` · Expected: PASS.

- [ ] **Step 2: Commit**

```bash
git add apps/server/src/management-api-passkey.rls.test.ts
git commit -s -m "test(server): passkey routes (mocked ceremony, cookie, RLS)"
```

---

### Task 6: `DashboardApi` passkey methods + browser dep

**Files:**
- Modify: `apps/dashboard/package.json` (add `@simplewebauthn/browser ^13`)
- Modify: `apps/dashboard/src/api/client.ts` (+ `client.test.ts`)

**Interfaces:**
- Adds `passkeyRegisterOptions()`, `passkeyRegisterVerify(body)`, `passkeyAuthOptions()`, `passkeyAuthVerify(body)` to `DashboardApi` (all `/management-api/passkey/*`).

- [ ] **Step 1: Add the dependency** — `apps/dashboard/package.json` `dependencies`: `"@simplewebauthn/browser": "^13.0.0"`; `pnpm install`; commit lockfile.

- [ ] **Step 2: Write the failing test** — assert each new method hits the right path with `credentials: "include"` (mirror Task 2 of 1c). Run: `pnpm --filter @waitron/dashboard test client` · Expected: FAIL.

- [ ] **Step 3: Implement** the four methods on `DashboardApi` using the existing `#request` funnel (e.g. `passkeyAuthOptions() { return this.#request("/management-api/passkey/auth/options", "POST"); }`). Run: `pnpm --filter @waitron/dashboard test client` · Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/package.json apps/dashboard/src/api ../../pnpm-lock.yaml
git commit -s -m "feat(dashboard): DashboardApi passkey methods"
```

---

### Task 7: Passkey UI — login button + register button

**Files:**
- Modify: `apps/dashboard/src/screens/login-screen.ts` (+ test): add "Entrar con passkey"
- Modify: `apps/dashboard/src/screens/staff-screen.ts` (or a new account widget) (+ test): add "Añadir passkey"

**Interfaces:** uses `@simplewebauthn/browser`'s `startAuthentication(options)` and `startRegistration(options)`.

- [ ] **Step 1: Write the failing login test** — stub `api.passkeyAuthOptions` (returns `{ challengeHandle, options }`), stub `startAuthentication` (mock the module), stub `api.passkeyAuthVerify` (returns `{ personId }`); assert clicking "Entrar con passkey" calls the chain and emits `logged-in`. Mock `@simplewebauthn/browser`:

```ts
vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: vi.fn().mockResolvedValue({ id: "cred-abc" }),
  startRegistration: vi.fn().mockResolvedValue({ id: "cred-abc" }),
}));
```

- [ ] **Step 2: Run, verify fails.** Run: `pnpm --filter @waitron/dashboard test login-screen` · Expected: FAIL.

- [ ] **Step 3: Implement the login passkey button** — add a `wt-button` whose handler runs:

```ts
async #passkeyLogin(): Promise<void> {
  this.errorKey = null;
  try {
    const { challengeHandle, options } = await this.api.passkeyAuthOptions();
    const response = await startAuthentication(options);
    const out = await this.api.passkeyAuthVerify({ challengeHandle, response });
    this.dispatchEvent(new CustomEvent("logged-in", { detail: out, bubbles: true, composed: true }));
  } catch (error) {
    this.errorKey = (error as { code?: string }).code ?? "passkey.verification_failed";
  }
}
```

- [ ] **Step 4: Implement the register button** on the staff/account surface — the symmetric `startRegistration` flow calling `passkeyRegisterOptions` → `startRegistration` → `passkeyRegisterVerify`. Add its test.

- [ ] **Step 5: Run both, verify pass.** Run: `pnpm --filter @waitron/dashboard test login-screen staff-screen` · Expected: PASS (incl. a11y).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/screens
git commit -s -m "feat(dashboard): passkey login + registration UI"
```

---

### Task 8: Full green + real-ceremony follow-up note

- [ ] **Step 1: Identity coverage** — Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/identity test:coverage` · Expected: PASS 98/98/98/95 (incl. `webauthn.rls`, `errors.reachability` for the three passkey codes).
- [ ] **Step 2: Server coverage** — Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage` · Expected: PASS.
- [ ] **Step 3: Dashboard coverage** — Run: `pnpm --filter @waitron/dashboard test:coverage` · Expected: PASS 95/95/90/88.
- [ ] **Step 4: inmutabilidad + workspace gate** — Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` then from root `pnpm lint && pnpm typecheck && pnpm format:check` · Expected: PASS.
- [ ] **Step 5: Record the real-ceremony follow-up** — the unit/route tests mock `@simplewebauthn/server`'s verify, proving OUR wiring but not a genuine attestation. A **Playwright virtual-authenticator** integration test (CDP `WebAuthn.enable` + `addVirtualAuthenticator`, driving `@simplewebauthn/browser` against the real `@simplewebauthn/server` verify) is the true end-to-end proof — a strong follow-up, flagged in the PR / *Debt and odd jobs*, not built here.
- [ ] **Step 6:** no commit — verification only.

---

## Self-Review

**Spec coverage (§4b passkey primary, §4c origin binding):**
- Passkey registration + authentication ceremonies, phishing-resistant, verified locally (no IdP) — Tasks 2, 3. ✅
- Passkey as the verifier-seam branch ending in `startManagementSession`, not stacked with TOTP — Task 3. ✅
- RP ID / origin as one-canonical-hostname config, `localhost` in tests — Task 4. ✅
- Public key only, counter tracked, challenges single-use + TTL — Tasks 1–3. ✅
- Login "with passkey" + "add passkey" UI — Task 7. ✅
- Real-ceremony (virtual authenticator) follow-up surfaced, not silently skipped — Task 8. ✅

**Placeholder scan:** Task 3's test has a labelled seeding gap ("…seed a credential row…") that must be filled against Task 2's insert — flagged inline, not a silent TBD; the `@simplewebauthn` field-name caveat is stated up front and at each use. No other placeholders. ✅

**Type consistency:** `challengeHandle` + `response` are the body shape across identity, server routes, and client for all four ceremony steps; `ManagementSession` returned by `finishPasskeyAuthentication` matches `loginManager`'s (slice 1a), so the cookie-set path in the server is identical; `webauthnCredentials`/`webauthnChallenges` column names are stable across Tasks 1–3. ✅
