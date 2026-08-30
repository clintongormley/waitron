# Dashboard grouped sidebar + email/password login — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard's flat 16-tab nav with a grouped static sidebar, and replace the pre-login roster dropdown with email + password login (persons gain an `email`).

**Architecture:** Bottom-up. Part B (email login) lands schema → identity → server → dashboard client → screens; Part A (sidebar) restructures the dashboard shell. Person `email` is a nullable, per-tenant-unique (case-insensitive) column; login resolves by email with enumeration hardening. The sidebar is data-driven app-level markup from existing `wt-*` primitives — no new primitive, no icons.

**Tech Stack:** TypeScript, Drizzle ORM + PostgreSQL (RLS), Hono (server), Lit + `@waitron/ui` (`wt-*`/`--wt-*`), Vitest (`@vitest/browser` Chromium for UI), Testcontainers for real-PG.

**Spec:** `docs/superpowers/specs/2026-08-30-dashboard-sidebar-email-login-design.md` — read it alongside this plan.

## Global Constraints

- **TDD**: failing test first, watch it fail, minimal impl, watch it pass, commit. Every commit `git commit -s`.
- **Design system**: in any dashboard view/component, no hardcoded chrome — colours/spacing/radii/font-size via `--wt-*` tokens only; build from `wt-*` primitives. Enforced by `packages/ui/src/no-hardcoded-chrome.test.ts`.
- **Error codes** name the domain concept and are never renamed once shipped. New codes: `person.email_invalid`, `person.email_taken` (existing `person.*` namespace). Every file that throws a code imports its registry (`import "./errors.js"`).
- **No backfill / no backwards-compat** (pre-production): schema drops/recreates, new column is nullable, no data migration.
- **English identifiers** (`packages/identity`, `packages/db` are in scope for the english-only guard): `email`, `setEmail` etc. are English; Spanish only as fiscal schema tokens (none here).
- **`TESTCONTAINERS_RYUK_DISABLED=true`** for any real-PG suite locally; run `pnpm reap` if a run is interrupted.
- **Before the PR**: run the whole workspace (a scoped green is evidence only about packages that ran), and explicitly `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` after the persons migration.

---

## Task 1: `email` column on `persons` + case-insensitive per-tenant unique index

**Files:**
- Modify: `packages/identity/src/schema/persons.ts` (add the column)
- Create: `packages/db/drizzle/0075_persons_email.sql` (auto — add column) and `packages/db/drizzle/0076_persons_email_unique.sql` (custom — functional partial index). Numbers are illustrative; **regenerate if main advanced — never hand-edit snapshots** (see spec §8 / memory `drizzle-migration-rebase-collision`).
- Test: `packages/identity/src/schema/persons.email.rls.test.ts` (real Postgres)

**Interfaces:**
- Produces: `persons.email` (`text`, nullable); DB index `persons_tenant_email_uq` on `(tenant_id, lower(email)) WHERE email IS NOT NULL`.

- [ ] **Step 1: Write the failing test** (real Postgres via `describeEachTarget`/`useRealPostgres` — PGlite cannot show a unique-constraint under the deployment role). Insert as owner using the existing test harness pattern in `packages/identity/src/schema/*.rls.test.ts`.

```ts
// persons.email.rls.test.ts — the three properties of the index
test("rejects a second person with the same email (case-insensitively) in one tenant", async () => {
  await insertPerson(tx, { tenantId: t1, displayName: "A", email: "Owner@x.com" });
  await expect(
    insertPerson(tx, { tenantId: t1, displayName: "B", email: "owner@x.com" }),
  ).rejects.toThrow(/persons_tenant_email_uq|unique/i);
});

test("allows the same email in different tenants", async () => {
  await insertPerson(tx, { tenantId: t1, displayName: "A", email: "owner@x.com" });
  await expect(
    insertPerson(tx, { tenantId: t2, displayName: "A", email: "owner@x.com" }),
  ).resolves.toBeDefined();
});

test("allows multiple persons with NULL email in one tenant", async () => {
  await insertPerson(tx, { tenantId: t1, displayName: "A", email: null });
  await expect(
    insertPerson(tx, { tenantId: t1, displayName: "B", email: null }),
  ).resolves.toBeDefined();
});
```

(`insertPerson` is a local helper inserting a `persons` row with a valid `pinHash`, mirroring the sibling RLS tests' setup. Use the file's existing owner/app connections.)

- [ ] **Step 2: Run test to verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/identity test persons.email`
Expected: FAIL — column `email` does not exist.

- [ ] **Step 3: Add the column to the schema**

In `packages/identity/src/schema/persons.ts`, add after `locale`:

```ts
    /** The person's login email — the identifier for dashboard (management) sign-in. Nullable:
     * till-only staff who authenticate with a PIN need none. Unique per tenant, case-insensitively,
     * enforced by the functional partial index persons_tenant_email_uq (custom migration), not a
     * column constraint. Validated/normalized at the write boundary (setEmail/createPerson), so no
     * DB format check here. */
    email: text("email"),
```

- [ ] **Step 4: Generate the column migration**

Run: `pnpm --filter @waitron/db db:generate`
Expected: a new migration adding `ALTER TABLE "persons" ADD COLUMN "email" text;`. Inspect it; do not hand-edit the snapshot.

- [ ] **Step 5: Add the custom unique-index migration**

Run: `pnpm --filter @waitron/db db:generate:custom` and write into the emitted file:

```sql
CREATE UNIQUE INDEX "persons_tenant_email_uq"
  ON "persons" ("tenant_id", lower("email"))
  WHERE "email" IS NOT NULL;
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/identity test persons.email`
Expected: PASS (all three).

- [ ] **Step 7: Verify the fiscal guard is still green**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`
Expected: PASS (persons stays FORCE-RLS with its policy; a new nullable column changes nothing).

- [ ] **Step 8: Commit**

```bash
git add packages/identity/src/schema/persons.ts packages/db/drizzle packages/identity/src/schema/persons.email.rls.test.ts
git commit -s -m "feat(identity): add persons.email + case-insensitive per-tenant unique index"
```

---

## Task 2: identity email helpers + error codes

**Files:**
- Create: `packages/identity/src/email.ts` + `packages/identity/src/email.test.ts`
- Modify: `packages/identity/src/errors.ts` (declare the two codes)
- Modify: `packages/identity/src/index.ts` (export the helpers if consumed cross-package; otherwise internal)

**Interfaces:**
- Produces: `normalizeEmail(raw: string): string` (trim + lowercase); `isValidEmail(raw: string): boolean`; error codes `person.email_invalid` (`{}`), `person.email_taken` (`{ email: string }`).

- [ ] **Step 1: Write the failing test**

```ts
// email.test.ts
import { normalizeEmail, isValidEmail } from "./email.js";
test("normalizeEmail trims and lowercases", () => {
  expect(normalizeEmail("  Owner@X.COM ")).toBe("owner@x.com");
});
test("isValidEmail accepts a plain address and rejects malformed", () => {
  expect(isValidEmail("owner@x.com")).toBe(true);
  expect(isValidEmail("nope")).toBe(false);
  expect(isValidEmail("a@b")).toBe(false);
  expect(isValidEmail("")).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/identity test email`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

```ts
// email.ts
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
// Deliberately conservative: one @, a dot in the domain, no spaces. Not RFC-complete — it screens
// obvious typos at the write boundary; uniqueness/identity is enforced by the DB index + login lookup.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(raw: string): boolean {
  return EMAIL_RE.test(raw.trim());
}
```

- [ ] **Step 4: Declare the error codes** in `packages/identity/src/errors.ts` (follow the existing `person.*` augmentation entries exactly):

```ts
    "person.email_invalid": Record<string, never>;
    "person.email_taken": { email: string };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @waitron/identity test email`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/identity/src/email.ts packages/identity/src/email.test.ts packages/identity/src/errors.ts packages/identity/src/index.ts
git commit -s -m "feat(identity): email normalize/validate helpers + person.email_* codes"
```

---

## Task 3: `loginManager` resolves by email (with enumeration hardening)

**Files:**
- Modify: `packages/identity/src/manager-login.ts`
- Test: `packages/identity/src/manager-login.test.ts` (extend)

**Interfaces:**
- Consumes: `normalizeEmail` (Task 2), `persons.email` (Task 1).
- Produces: `loginManager(tx, { tenantId, email, password, totp? }): Promise<ManagementSession>`.

- [ ] **Step 1: Write the failing test** (extend the existing suite; keep every behavioural assertion — rewrite setup to seed an `email`, not to assert less):

```ts
test("logs in by email, case-insensitively", async () => {
  await seedManager(tx, { email: "owner@x.com", password: "pw12345678" });
  const s = await loginManager(tx, { tenantId, email: "OWNER@x.com", password: "pw12345678" });
  expect(s.personId).toBeDefined();
});
test("unknown email throws password.invalid (no enumeration)", async () => {
  await expect(
    loginManager(tx, { tenantId, email: "ghost@x.com", password: "pw12345678" }),
  ).rejects.toMatchObject({ code: "password.invalid" });
});
test("wrong password throws password.invalid", async () => {
  await seedManager(tx, { email: "owner@x.com", password: "pw12345678" });
  await expect(
    loginManager(tx, { tenantId, email: "owner@x.com", password: "wrong" }),
  ).rejects.toMatchObject({ code: "password.invalid" });
});
test("suspended person throws person.suspended", async () => {
  await seedManager(tx, { email: "owner@x.com", password: "pw12345678", status: "suspended" });
  await expect(
    loginManager(tx, { tenantId, email: "owner@x.com", password: "pw12345678" }),
  ).rejects.toMatchObject({ code: "person.suspended" });
});
```

Also keep/adapt the existing TOTP-enrolled cases (missing/wrong `totp` → `totp.invalid`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/identity test manager-login`
Expected: FAIL — `loginManager` still expects `personId`.

- [ ] **Step 3: Rewrite the lookup**

```ts
export async function loginManager(
  tx: Transaction,
  input: { tenantId: string; email: string; password: string; totp?: string },
): Promise<ManagementSession> {
  const email = normalizeEmail(input.email);
  const [person] = await tx
    .select({
      id: persons.id,
      status: persons.status,
      passwordHash: persons.passwordHash,
      totpSecret: persons.totpSecret,
    })
    .from(persons)
    .where(and(eq(persons.tenantId, input.tenantId), eq(sql`lower(${persons.email})`, email)));
  // Unknown email is indistinguishable from a wrong password on the public login form.
  if (person === undefined) throw new AppError("password.invalid", {});
  if (person.status === "suspended")
    throw new AppError("person.suspended", { personId: person.id });
  if (person.passwordHash === null || !verifyPassword(input.password, person.passwordHash)) {
    throw new AppError("password.invalid", {});
  }
  if (person.totpSecret !== null) {
    if (input.totp === undefined || !verifyTotp(input.totp, person.totpSecret)) {
      throw new AppError("totp.invalid", {});
    }
  }
  return startManagementSession(tx, { tenantId: input.tenantId, personId: person.id });
}
```

(Add the `sql` import from `drizzle-orm` and `normalizeEmail` from `./email.js`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @waitron/identity test manager-login`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/identity/src/manager-login.ts packages/identity/src/manager-login.test.ts
git commit -s -m "feat(identity): loginManager resolves by email; unknown email == wrong password"
```

---

## Task 4: `createPerson` email param + `setEmail` mutator

**Files:**
- Modify: `packages/identity/src/staff.ts`, `packages/identity/src/index.ts`
- Test: `packages/identity/src/staff.test.ts` (extend)

**Interfaces:**
- Consumes: `normalizeEmail`/`isValidEmail` (Task 2), `person.email_invalid`/`person.email_taken` (Task 2).
- Produces: `createPerson` input gains `email?: string`; `setEmail(tx, { managementSessionId, personId, email }): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
test("createPerson stores a normalized email", async () => {
  const { id } = await createPerson(tx, { ...base, email: "Owner@X.com" });
  const [row] = await tx.select({ email: persons.email }).from(persons).where(eq(persons.id, id));
  expect(row.email).toBe("owner@x.com");
});
test("createPerson rejects a malformed email", async () => {
  await expect(createPerson(tx, { ...base, email: "nope" }))
    .rejects.toMatchObject({ code: "person.email_invalid" });
});
test("setEmail rejects a duplicate within a tenant", async () => {
  await createPerson(tx, { ...base, displayName: "A", email: "owner@x.com" });
  const { id } = await createPerson(tx, { ...base, displayName: "B" });
  await expect(setEmail(tx, { managementSessionId, personId: id, email: "owner@x.com" }))
    .rejects.toMatchObject({ code: "person.email_taken" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/identity test staff`
Expected: FAIL — `email` not accepted / `setEmail` missing.

- [ ] **Step 3: Implement**

In `createPerson`, after `assertPinLength`, screen email when present and include it in `.values`:

```ts
  const email = input.email === undefined ? null : normalizeEmail(input.email);
  if (email !== null && !isValidEmail(email)) throw new AppError("person.email_invalid", {});
  // …in .values({ … email })
```

Wrap the insert (and `setEmail`'s update) in a unique-violation translator:

```ts
function pgErrorCode(err: unknown): string | undefined {
  // Postgres unique_violation = 23505. drizzle may surface it directly (`.code`) or wrapped (`.cause`).
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code ?? e?.cause?.code;
}
function asEmailTaken(err: unknown, email: string): never {
  if (pgErrorCode(err) === "23505") throw new AppError("person.email_taken", { email });
  throw err;
}
```

The duplicate-email test **runs on real Postgres** (like Task 1): the `email_taken` path depends on the DB unique index and the exact error `.code`, which a real server pins and PGlite need not reproduce faithfully.

```ts
export async function setEmail(
  tx: Transaction,
  input: { managementSessionId: string; personId: string; email: string },
): Promise<void> {
  await authorizeManager(tx, { managementSessionId: input.managementSessionId, permission: "person.manage" });
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) throw new AppError("person.email_invalid", {});
  try {
    await tx.update(persons).set({ email }).where(eq(persons.id, input.personId));
  } catch (err) {
    asEmailTaken(err, email);
  }
}
```

Export `setEmail` from `index.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @waitron/identity test staff`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/identity/src/staff.ts packages/identity/src/index.ts packages/identity/src/staff.test.ts
git commit -s -m "feat(identity): createPerson email + setEmail mutator (email_taken on duplicate)"
```

---

## Task 5: server session route accepts `{ email, password, totp }`

**Files:**
- Modify: `apps/server/src/management-api.ts` (the `POST /management-api/session` route + its comment block, and the `STATUS` map if needed)
- Test: `apps/server/src/management-api.test.ts` and/or `management-api.rls.test.ts` (extend the session-login cases)

**Interfaces:**
- Consumes: `loginManager({ email, … })` (Task 3).
- Produces: `POST /management-api/session` body `{ email?, password?, totp? }` → sets cookie, returns `{ personId }`.

- [ ] **Step 1: Write the failing test** (adapt the existing session-login tests — the old ones seed a person and POST `personId`; reseed with `email` and POST `email`; keep every behavioural assertion, add the enumeration one):

```ts
test("logs in with email + password and sets the cookie", async () => {
  await seedManager({ email: "owner@x.com", password: "pw12345678" });
  const res = await app.request("/management-api/session", {
    method: "POST",
    body: JSON.stringify({ email: "owner@x.com", password: "pw12345678" }),
    headers: { "content-type": "application/json" },
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("set-cookie")).toMatch(/management/i);
});
test("unknown email returns 401 password.invalid", async () => {
  const res = await app.request("/management-api/session", {
    method: "POST",
    body: JSON.stringify({ email: "ghost@x.com", password: "pw12345678" }),
    headers: { "content-type": "application/json" },
  });
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({ code: "password.invalid" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test management-api`
Expected: FAIL — route still screens `personId`.

- [ ] **Step 3: Rewrite the route body screen**

```ts
      const body = await readJsonBody<{ email?: string; password?: string; totp?: string }>(c);
      if (
        typeof body.email !== "string" ||
        body.email.trim() === "" ||
        typeof body.password !== "string" ||
        (body.totp !== undefined && typeof body.totp !== "string")
      ) {
        throw new AppError("password.invalid", {});
      }
      const { email, password, totp } = body;
      const session = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return loginManager(tx, { tenantId: deps.cfg.tenantId, email, password, totp });
      });
```

- [ ] **Step 4: Audit the comments in this route block.** Rewrite the ~150–181 and ~446–476 comments that describe the `personId` behaviour ("an unknown `personId` surfaces 404", "non-UUID `personId`", the `isUuid` screen) to the email behaviour: unknown-or-suspended-or-wrong-password uniformity, email screened as a non-empty string, format validated at write-time. Remove the now-irrelevant `isUuid(body.personId)` reasoning. (House rule: editing this file is not auditing it — read the whole block.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test management-api`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/management-api.ts apps/server/src/management-api.test.ts apps/server/src/management-api.rls.test.ts
git commit -s -m "feat(server): session login by email; audit the personId-era route comments"
```

---

## Task 6: server staff create + edit carry `email`

**Files:**
- Modify: `apps/server/src/management-api.ts` (`POST /management-api/staff`, `PATCH /management-api/staff/:id`, and the `GET /management-api/staff` projection)
- Test: `apps/server/src/management-api.test.ts` (extend)

**Interfaces:**
- Consumes: `createPerson({ …, email? })`, `setEmail` (Task 4).
- Produces: `POST /management-api/staff` body gains `email?`; `PATCH /management-api/staff/:id` body gains `email?` (server calls `setEmail` when present); `GET /management-api/staff` rows include `email`.

- [ ] **Step 1: Write the failing test**

```ts
test("creates a person with an email and lists it back", async () => {
  const created = await postStaff({ displayName: "Owner", role: "manager", pin: "1234", email: "owner@x.com" });
  const list = await getStaff();
  expect(list.find((p) => p.personId === created.id)?.email).toBe("owner@x.com");
});
test("PATCH sets a person's email", async () => {
  const { id } = await postStaff({ displayName: "A", role: "staff", pin: "1234" });
  const res = await patchStaff(id, { email: "a@x.com" });
  expect(res.status).toBe(204);
  expect((await getStaff()).find((p) => p.personId === id)?.email).toBe("a@x.com");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test management-api`
Expected: FAIL — email not accepted/projected.

- [ ] **Step 3: Implement** — thread `email` through the create route into `createPerson`; in the PATCH route, when `body.email` is a string, call `setEmail` (alongside the existing role/status handling); add `email: persons.email` (or the identity list projection's field) to the `GET /management-api/staff` select so `PersonSummary` carries it. Screen `email` as a string in both routes (validation proper is in identity).

- [ ] **Step 4: Run tests to verify they pass**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test management-api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/management-api.ts apps/server/src/management-api.test.ts
git commit -s -m "feat(server): staff create/edit + listing carry email"
```

---

## Task 7: dashboard API client — email in login / create / edit / listing

**Files:**
- Modify: `apps/dashboard/src/api/client.ts`
- Test: `apps/dashboard/src/api/client.test.ts` (extend)

**Interfaces:**
- Produces: `login({ email, password, totp? })`; `createPerson({ displayName, role, pin, email? })`; `updatePerson(id, { role?, status?, email? })`; `PersonSummary` gains `email: string | null`.
- **Keep** `getStaffRoster`/`RosterEntry` — `my-schedule-screen.ts` still uses them (verified). Only the login screen (Task 8) stops calling `getStaffRoster`.

- [ ] **Step 1: Write the failing test**

```ts
test("login posts email/password to the session route", async () => {
  const fetchMock = mockJson({ personId: "p1" });
  const api = new DashboardApi(fetchMock);
  await api.login({ email: "owner@x.com", password: "pw" });
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("/management-api/session"),
    expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "owner@x.com", password: "pw" }) }),
  );
});
```

(Follow the existing `client.test.ts` mock-fetch conventions for the exact assertion shape.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/dashboard test client`
Expected: FAIL — `login` still typed `{ personId }`.

- [ ] **Step 3: Implement** — change `login`'s param to `{ email: string; password: string; totp?: string }`; add `email?: string` to `createPerson`'s input and to `updatePerson`'s `patch`; add `email: string | null` to `PersonSummary`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @waitron/dashboard test client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/api/client.ts apps/dashboard/src/api/client.test.ts
git commit -s -m "feat(dashboard): api client email in login/create/edit/listing"
```

---

## Task 8: login screen — email field replaces the roster dropdown

**Files:**
- Modify: `apps/dashboard/src/screens/login-screen.ts`, `apps/dashboard/src/i18n/strings.ts` (+ locale files)
- Test: `apps/dashboard/src/screens/login-screen.test.ts`, `login-screen.a11y.test.ts`

**Interfaces:**
- Consumes: `api.login({ email, … })` (Task 7).

- [ ] **Step 1: Write the failing test** (keep the behavioural assertions — a successful submit still dispatches `logged-in`; error still renders the `role="alert"` banner):

```ts
test("submits the typed email + password", async () => {
  const api = fakeApi({ login: vi.fn().mockResolvedValue({ personId: "p1" }) });
  const el = await mountLogin(api);
  setInput(el, "email", "owner@x.com");
  setInput(el, "password", "pw");
  clickSubmit(el);
  await el.updateComplete;
  expect(api.login).toHaveBeenCalledWith({ email: "owner@x.com", password: "pw", totp: undefined });
});
test("does not fetch the roster on connect", async () => {
  const api = fakeApi({ getStaffRoster: vi.fn() });
  await mountLogin(api);
  expect(api.getStaffRoster).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/dashboard test login-screen`
Expected: FAIL — still a roster select; `getStaffRoster` still called.

- [ ] **Step 3: Implement** — remove `roster`/`selected` state, `#loadRoster`, `#rosterSelect`, the `updated()` reconcile, `#onRosterChange`, the `connectedCallback` roster fetch, and the `RosterEntry`/`ref`/`createRef` imports. Add `@state() private email = ""` and an email field; `#submit` sends `{ email: this.email, password, totp }`:

```ts
html`<wt-input class="field" label=${t("login.email")} type="email"
      .value=${this.email}
      @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onEmailChange(e)}></wt-input>`
```

Add `login.email` to `strings.ts` (`"login.email": "Email"`), and to every locale file. Leave `login.roster` string in place only if still referenced elsewhere; otherwise remove it. Passkey + TOTP + password fields unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @waitron/dashboard test login-screen`
Expected: PASS. Also run `login-screen.a11y` (axe) and fix any label wiring.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/screens/login-screen.ts apps/dashboard/src/screens/login-screen.test.ts apps/dashboard/src/screens/login-screen.a11y.test.ts apps/dashboard/src/i18n
git commit -s -m "feat(dashboard): email field login, drop the pre-login roster dropdown"
```

---

## Task 9: Users form — email field (create + edit)

**Files:**
- Modify: `apps/dashboard/src/widgets/person-form.ts` (create), `apps/dashboard/src/widgets/person-edit.ts` (edit), `apps/dashboard/src/widgets/staff-list.ts` (show email), `apps/dashboard/src/screens/staff-screen.ts` (wire the new events), `apps/dashboard/src/i18n/strings.ts` + `i18n/codes` (email label + code copy)
- Test: the widgets' `.test.ts` + `.a11y.test.ts`, `staff-screen.test.ts`

**Interfaces:**
- Consumes: `api.createPerson({ …, email? })`, `api.updatePerson(id, { …, email? })` (Task 7), `PersonSummary.email`.

- [ ] **Step 1: Write the failing test** (create emits email; edit emits email; malformed shows the banner):

```ts
// person-form.test.ts
test("create-person carries the typed email", async () => {
  const el = await mount(html`<dashboard-person-form></dashboard-person-form>`);
  setField(el, "displayName", "Owner"); setField(el, "pin", "1234"); setField(el, "email", "owner@x.com");
  const ev = await captureEvent(el, "create-person", () => clickConfirm(el));
  expect(ev.detail).toMatchObject({ email: "owner@x.com" });
});
```

```ts
// staff-screen.test.ts — the code banner
test("renders person.email_taken from a rejected create", async () => {
  const api = fakeApi({ createPerson: vi.fn().mockRejectedValue({ code: "person.email_taken" }) });
  const el = await mountStaff(api);
  await triggerCreate(el, { displayName: "A", role: "staff", pin: "1234", email: "dupe@x.com" });
  expect(bannerText(el)).toContain(codeMessage("person.email_taken"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/dashboard test person-form staff-screen`
Expected: FAIL — no email field/plumbing.

- [ ] **Step 3: Implement** — add an email `wt-input` to `person-form` and `person-edit`, grouped with the password control under a "dashboard sign-in" heading (PIN stays separate as the till credential). Extend the `create-person` / edit events' detail with `email`. In `staff-screen.ts`, forward `email` into `api.createPerson` / `api.updatePerson`. In `staff-list.ts`, show the email column. Add `person.email` label to `strings.ts` and `person.email_invalid`/`person.email_taken` copy to the i18n `codes` map. Follow the existing single-flight/`stopPropagation`/error-banner patterns (`purchases-screen.ts` is the reference).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @waitron/dashboard test person-form person-edit staff-list staff-screen`
Expected: PASS. Run the `.a11y` suites for the two forms and fix label wiring.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/widgets/person-form.ts apps/dashboard/src/widgets/person-edit.ts apps/dashboard/src/widgets/staff-list.ts apps/dashboard/src/screens/staff-screen.ts apps/dashboard/src/i18n
git commit -s -m "feat(dashboard): manage a person's login email in the Users form"
```

---

## Task 10: demo seed sets emails

**Files:**
- Modify: `apps/server/scripts/demo-seed/seed-staff.ts` (+ its data in `staff.ts` if the persons are listed there), `apps/server/scripts/dev-setup.ts` (the "Administradora" person)
- Test: `apps/server/scripts/demo-seed/seed-staff.test.ts` (assert the seeded manager/admin has an email)

**Interfaces:**
- Consumes: `createPerson({ …, email })` / `setEmail` (Task 4).

- [ ] **Step 1: Write the failing test**

```ts
test("seeds the admin with a login email", async () => {
  const ids = await seedStaff(tx, tenantId, managementSessionId);
  const [row] = await tx.select({ email: persons.email }).from(persons).where(eq(persons.id, ids.adminId));
  expect(row.email).toMatch(/@/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test seed-staff`
Expected: FAIL — no email seeded.

- [ ] **Step 3: Implement** — pass `email` (e.g. `owner@demo.waitron.local`, `manager@demo.waitron.local`) when seeding the admin/manager persons in `seed-staff.ts` and `dev-setup.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test seed-staff`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/scripts/demo-seed apps/server/scripts/dev-setup.ts
git commit -s -m "feat(server): seed demo persons with login emails"
```

---

## Task 11: grouped static sidebar (desktop)

**Files:**
- Modify: `apps/dashboard/src/dashboard-app.ts` (the `#nav()` + `render()` chrome + styles), `apps/dashboard/src/i18n/strings.ts` (group labels)
- Test: `apps/dashboard/src/dashboard-app.test.ts`, `dashboard-app.a11y.test.ts`

**Interfaces:**
- Produces: `NAV_GROUPS` module constant; a `<nav aria-label>` sidebar rendering every group + item, each item keeping `data-test="nav-<screen>"`.

- [ ] **Step 1: Write the failing test** (preserve the existing behavioural assertions — every `nav-<screen>` still switches `screen`; add the grouping assertions):

```ts
test("renders each nav group header and all 16 nav items", async () => {
  const el = await mountApp({ role: "manager" });
  for (const key of ["nav.group.menu","nav.group.service","nav.group.team","nav.group.purchasing","nav.group.configuration"])
    expect(text(el)).toContain(t(key));
  for (const s of ALL_SCREENS) expect(el.shadowRoot!.querySelector(`[data-test="nav-${s}"]`)).toBeTruthy();
});
test("clicking a nav item switches the screen and marks it current", async () => {
  const el = await mountApp({ role: "manager" });
  click(el, '[data-test="nav-catalogue"]');
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector('[data-test="nav-catalogue"]')!.getAttribute("aria-current")).toBe("page");
});
test("a staff session still gets no nav", async () => {
  const el = await mountApp({ role: "staff" });
  expect(el.shadowRoot!.querySelector('nav[aria-label]')).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/dashboard test dashboard-app`
Expected: FAIL — flat nav, no group headers/`aria-current`.

- [ ] **Step 3: Implement** — add the data structure and rewrite `#nav()`:

```ts
type NavItem = { screen: Screen; labelKey: string };
type NavGroup = { headerKey?: string; items: NavItem[] };
const NAV_GROUPS: NavGroup[] = [
  { items: [ { screen: "overview", labelKey: "nav.overview" }, { screen: "sales", labelKey: "nav.sales" } ] },
  { headerKey: "nav.group.menu", items: [ { screen: "catalogue", labelKey: "nav.catalogue" }, { screen: "recipe", labelKey: "nav.recipe" } ] },
  { headerKey: "nav.group.service", items: [ { screen: "floor", labelKey: "nav.floor" }, { screen: "statuses", labelKey: "nav.statuses" }, { screen: "kitchen", labelKey: "nav.kitchen" } ] },
  { headerKey: "nav.group.team", items: [ { screen: "staff", labelKey: "nav.staff" }, { screen: "roster", labelKey: "nav.roster" }, { screen: "approvals", labelKey: "nav.approvals" }, { screen: "planned-actual", labelKey: "nav.planned_actual" } ] },
  { headerKey: "nav.group.purchasing", items: [ { screen: "purchases", labelKey: "nav.purchases" } ] },
  { headerKey: "nav.group.configuration", items: [ { screen: "layout", labelKey: "nav.layout" }, { screen: "receipt", labelKey: "nav.receipt" }, { screen: "devices", labelKey: "nav.devices" }, { screen: "printers", labelKey: "nav.printers" } ] },
];
```

```ts
#nav(): TemplateResult {
  return html`<nav class="nav" aria-label=${t("nav.sections")}>
    ${NAV_GROUPS.map((g) => html`
      ${g.headerKey ? html`<h2 class="nav-group">${t(g.headerKey)}</h2>` : nothing}
      ${g.items.map((it) => html`<wt-button
        class="nav-item"
        variant=${this.screen === it.screen ? "primary" : "secondary"}
        aria-current=${this.screen === it.screen ? "page" : nothing}
        data-test="nav-${it.screen}"
        @click=${() => (this.screen = it.screen)}
      >${t(it.labelKey)}</wt-button>`)}
    `)}
  </nav>`;
}
```

Restructure `render()` into `.layout` (`aside.sidebar` + `.main` > `header.topbar` + `.body`); move the language-chooser + logout into `.topbar`. Style with `--wt-*` tokens only (sidebar width via a token/const, group headers `--wt-color-text-muted` + `--wt-font-size-sm`, vertical scroll on the aside). Add the five `nav.group.*` strings to `strings.ts` + locales.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @waitron/dashboard test dashboard-app` (+ the a11y suite; + `pnpm --filter @waitron/ui test no-hardcoded-chrome` is unaffected since this is app-level, but run the dashboard build to confirm no token regressions).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/dashboard-app.ts apps/dashboard/src/dashboard-app.test.ts apps/dashboard/src/dashboard-app.a11y.test.ts apps/dashboard/src/i18n
git commit -s -m "feat(dashboard): grouped static sidebar nav"
```

---

## Task 12: responsive sidebar drawer

**Files:**
- Modify: `apps/dashboard/src/dashboard-app.ts` (drawer state + hamburger + scrim + styles), `apps/dashboard/src/i18n/strings.ts` (`nav.toggle` aria-label)
- Test: `apps/dashboard/src/dashboard-app.test.ts` (extend), `dashboard-app.a11y.test.ts`

**Interfaces:**
- Consumes: the sidebar from Task 11.

- [ ] **Step 1: Write the failing test**

```ts
test("hamburger toggles the drawer open, a nav click closes it", async () => {
  const el = await mountApp({ role: "manager" });
  expect(el.shadowRoot!.querySelector(".layout")!.classList.contains("drawer-open")).toBe(false);
  click(el, '[data-test="nav-toggle"]');
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".layout")!.classList.contains("drawer-open")).toBe(true);
  click(el, '[data-test="nav-catalogue"]');
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".layout")!.classList.contains("drawer-open")).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/dashboard test dashboard-app`
Expected: FAIL — no toggle/drawer.

- [ ] **Step 3: Implement** — add `@state() private drawerOpen = false`; a hamburger `wt-button` (`data-test="nav-toggle"`, `aria-label=${t("nav.toggle")}`) in `.topbar`; a `.scrim` element (click → close) shown when open. Toggle `drawer-open` on `.layout`. In CSS, below a token/const breakpoint make `.sidebar` `position: fixed` off-canvas and slide in when `.drawer-open`; the scrim uses `--wt-color-scrim`. Selecting any nav item sets `drawerOpen = false`. Add `nav.toggle` string.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @waitron/dashboard test dashboard-app` (+ a11y).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/dashboard-app.ts apps/dashboard/src/dashboard-app.test.ts apps/dashboard/src/dashboard-app.a11y.test.ts apps/dashboard/src/i18n
git commit -s -m "feat(dashboard): responsive sidebar drawer for narrow screens"
```

---

## Final verification (before opening the PR)

- [ ] Whole-workspace gate: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`
- [ ] Coverage (CI runs `test:coverage`): `TESTCONTAINERS_RYUK_DISABLED=true pnpm -r test:coverage`
- [ ] Fiscal guard: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`
- [ ] `pnpm install` + commit the lockfile if anything moved between deps/devDeps (none expected).
- [ ] Update `docs/backlog.md` Tier A #2 to LANDED in the `/land-branch` step.
