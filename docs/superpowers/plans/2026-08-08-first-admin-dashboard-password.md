# First venue admin's initial dashboard password — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `waitron-provision venue` to seed the first admin's dashboard **password**
(`persons.password_hash`) alongside the till PIN, so a real first management-dashboard login is possible.

**Architecture:** Thread a required `passwordHash` from the CLI boundary (read from
`WAITRON_ADMIN_PASSWORD` env or an echo-off prompt, validated ≥8, hashed with `hashPassword`) through
`VenueRequest.admin` → the `seed-admin` `VenueAction` → the `applyVenue` `persons` insert — exactly
mirroring the existing PIN handling. No schema migration (the nullable `persons.password_hash` column
already exists) and no grant change (`applyVenue` runs as the table owner).

**Tech Stack:** TypeScript monorepo (pnpm), `@waitron/provisioning` (the CLI + plan/apply),
`@waitron/identity` (`hashPassword`/`assertPasswordLength`/`verifyPassword`/`loginManager`), Drizzle
`sql` templates (parameterised), Vitest (PGlite for wiring/logic, Testcontainers for real-PG).

## Global Constraints

- **Design spec:** `docs/superpowers/specs/2026-08-08-first-admin-dashboard-password-design.md`.
- **Password is REQUIRED at provisioning** (owner decision); **no** force-change-on-first-login.
- **Secret discipline (CLAUDE.md §3):** the password is NEVER an argv flag — read from
  `WAITRON_ADMIN_PASSWORD` env var or an echo-off `promptSecret`, and from nowhere else. The `parse`
  call stays `strict` (no `--password`/`--admin-password` declared → parse error). NEVER printed or
  logged (plan summary + `Cluster:` line + `describeVenueAction` stay name/host-only). Hashed at the
  CLI boundary with `hashPassword`, so only `passwordHash` flows through the plan/action/apply.
- **Length floor ≥8** via `assertPasswordLength` (`password.too_short { min: 8 }`) at the boundary,
  the analogue of `assertPinLength`. An empty answer fails there — no separate "missing" code.
- **No schema migration; no grant change.** `persons.password_hash` is a nullable `text` column
  (CHECK `password_hash is null or length > 0`); the admin row will always carry a hash. `applyVenue`
  runs as the table OWNER under the tenant GUC — it already inserts into `persons`.
- **SQL is Drizzle-parameterised** (`${...}` → `$n` binds); never string-concatenated. The seed-admin
  insert is not a utility statement, so no `quoteLiteral`.
- **Coverage tier 98/98/98/95** for `@waitron/provisioning` and `@waitron/identity`. TDD (failing
  test first; watch it fail). Prove each guard by deletion where applicable.
- **Container (real-PG) tests need `TESTCONTAINERS_RYUK_DISABLED=true`** locally.
- **Every commit `git commit -s`** (DCO).

---

### Task 1: Thread the required initial admin password (CLI → plan → apply, with unit tests)

Adding a **required** `passwordHash` to `VenueRequest.admin` and the `seed-admin` action is a single
type-coupled change: it breaks every `VenueRequest`/`seed-admin` constructor until each is updated, so
all three production layers and every fixture move together in this one task. The task ends with the
whole `@waitron/provisioning` package green.

**Files:**
- Modify: `packages/provisioning/src/venue-plan.ts` (interface + action + `planVenue` threading)
- Modify: `packages/provisioning/src/venue-apply.ts` (the `seed-admin` insert)
- Modify: `packages/provisioning/src/cli.ts` (read + validate + hash + `readAdminPassword` helper + USAGE)
- Test: `packages/provisioning/src/venue-plan.test.ts` (seed-admin carries `passwordHash`; describe never prints it)
- Test: `packages/provisioning/src/venue-apply.test.ts` (PGlite read-back asserts `password_hash`; fixtures)
- Test: `packages/provisioning/src/cli.test.ts` (env path, echo-off prompt path + order, too-short password; `VENUE_ENV`)
- Modify (fixtures only, to keep the package typechecking): `packages/provisioning/src/venue-apply.e2e.test.ts:77` and `packages/provisioning/src/venue-apply.node-privilege.rls.test.ts:34` — add `passwordHash: "scrypt$00$00"` to each `admin: { ... }` request fixture.

**Interfaces:**
- Consumes: `hashPassword`, `assertPasswordLength`, `verifyPassword` from `@waitron/identity`
  (`packages/identity/src/verify-password.ts`); the existing `readAdminPin` pattern.
- Produces: `VenueRequest.admin.passwordHash: string`; `VenueAction` `seed-admin.passwordHash: string`;
  `applyVenue` writes `persons.password_hash`. Task 2 (e2e) relies on the seeded hash verifying via
  `loginManager`.

- [ ] **Step 1: Write the failing plan test** — extend the seed-admin assertion in `venue-plan.test.ts`.

In the `request()` helper (line 27), change the admin fixture to carry a password hash:

```typescript
    admin: { displayName: "Owner", pinHash: "scrypt$00$00", passwordHash: "scrypt$aa$bb" },
```

Extend the "seeds the admin immediately after ensure-tenant" test (lines 53-57) to expect the hash:

```typescript
    expect(actions[1]).toEqual({
      kind: "seed-admin",
      displayName: "Owner",
      pinHash: "scrypt$00$00",
      passwordHash: "scrypt$aa$bb",
    });
```

Extend the "names the admin but NEVER the pin hash" describe test (lines 200-208) to also seed a
distinctive password hash and assert it never appears:

```typescript
    const line = describeVenueAction({
      kind: "seed-admin",
      displayName: "Alicia",
      pinHash: "scrypt$deadbeef$cafef00d",
      passwordHash: "scrypt$feedface$0ddba11",
    });
    expect(line).toBe("seed admin Alicia");
    expect(line).not.toContain("scrypt");
    expect(line).not.toContain("deadbeef");
    expect(line).not.toContain("cafef00d");
    expect(line).not.toContain("feedface");
    expect(line).not.toContain("0ddba11");
```

- [ ] **Step 2: Run the plan test to verify it fails**

Run: `pnpm --filter @waitron/provisioning test venue-plan`
Expected: FAIL — a TypeScript error that `passwordHash` is not a property of `VenueRequest.admin` /
the `seed-admin` action, and/or the `toEqual` mismatch.

- [ ] **Step 3: Add `passwordHash` to the plan types and thread it**

In `packages/provisioning/src/venue-plan.ts`:

Update the `admin` field on `VenueRequest` (line 35) and its doc comment (lines 31-34) to cover the
password too:

```typescript
  /** The initial ADMIN person a freshly provisioned venue needs, so someone can log in and
   * authorize privileged actions from day one. Both secrets are already HASHED here (hashed at the CLI
   * boundary by `hashPin` / `hashPassword`) — `pinHash` for the till, `passwordHash` for the dashboard,
   * never a plaintext secret, so neither enters the plan or any action. */
  admin: { displayName: string; pinHash: string; passwordHash: string };
```

Update the `seed-admin` variant of `VenueAction` (line 40):

```typescript
  | { kind: "seed-admin"; displayName: string; pinHash: string; passwordHash: string }
```

In `planVenue`, add `passwordHash` to the emitted seed-admin action (lines 118-122):

```typescript
    {
      kind: "seed-admin",
      displayName: request.admin.displayName,
      pinHash: request.admin.pinHash,
      passwordHash: request.admin.passwordHash,
    },
```

`describeVenueAction`'s `seed-admin` case needs NO change — it already returns the name only.

- [ ] **Step 4: Run the plan test to verify it passes**

Run: `pnpm --filter @waitron/provisioning test venue-plan`
Expected: PASS (the plan test compiles and passes; other files may still fail typecheck — that is
addressed in the steps below, all within this task).

- [ ] **Step 5: Write the failing apply test** — assert the seeded `password_hash` in `venue-apply.test.ts`.

Update the `request()` helper (line 44):

```typescript
    admin: { displayName: "Owner", pinHash: "scrypt$00$00", passwordHash: "scrypt$00$00" },
```

Update the seed-admin override (line 85) and its read-back (lines 88-99) to include `password_hash`:

```typescript
    seedRequest.admin = {
      displayName: "Alicia",
      pinHash: "scrypt$abc$def",
      passwordHash: "scrypt$pwd$hash",
    };
    const result = await applyVenue(planVenue(seedRequest), { db: suite.db });

    const people = await suite.db.execute<{
      display_name: string;
      role: string;
      pin_hash: string;
      password_hash: string;
    }>(sql`
      select display_name, role, pin_hash, password_hash
      from persons where tenant_id = ${result.tenantId}`);
    expect(people.rows).toHaveLength(1);
    expect(people.rows[0]).toEqual({
      display_name: "Alicia",
      role: "admin",
      pin_hash: "scrypt$abc$def",
      password_hash: "scrypt$pwd$hash",
    });
```

- [ ] **Step 6: Run the apply test to verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/provisioning test venue-apply.test`
Expected: FAIL — the read-back `password_hash` is `null` (the insert does not write it yet), so the
`toEqual` mismatches.

- [ ] **Step 7: Add `password_hash` to the seed-admin insert**

In `packages/provisioning/src/venue-apply.ts`, update the `seed-admin` insert (lines 87-91) and its
comment (append a sentence noting both hashes):

```typescript
          await tx.execute(sql`
            insert into persons (tenant_id, display_name, pin_hash, password_hash, role)
            select ${tenantId}, ${action.displayName}, ${action.pinHash}, ${action.passwordHash}, 'admin'
            where not exists (
              select 1 from persons where tenant_id = ${tenantId} and role = 'admin')`);
```

In the comment above it (around line 85), replace the "`pin_hash` is already a scrypt hash" sentence
with one covering both: "`pin_hash` (till) and `password_hash` (dashboard) are already scrypt hashes,
hashed at the CLI boundary, never a plaintext secret."

- [ ] **Step 8: Run the apply test to verify it passes**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/provisioning test venue-apply.test`
Expected: PASS. Prove the write by deletion: temporarily drop `password_hash` from the insert column
list → the test reads `null` and fails → restore.

- [ ] **Step 9: Update the two remaining request fixtures so the package typechecks**

Add `passwordHash: "scrypt$00$00"` to the `admin: { ... }` fixture in BOTH:
- `packages/provisioning/src/venue-apply.e2e.test.ts` (line 77)
- `packages/provisioning/src/venue-apply.node-privilege.rls.test.ts` (line 34)

```typescript
    admin: { displayName: "Owner", pinHash: "scrypt$00$00", passwordHash: "scrypt$00$00" },
```

- [ ] **Step 10: Write the failing CLI tests** — env path, prompt path, too-short, in `cli.test.ts`.

Add `verifyPassword` to the identity import (line 5):

```typescript
import { verifyPassword, verifyPin } from "@waitron/identity";
```

Add the password to `VENUE_ENV` (line 77) and update its doc comment to mention the password:

```typescript
const VENUE_ENV = {
  WAITRON_ADMIN_DATABASE_URL: ADMIN_URI,
  WAITRON_ADMIN_PIN: "4321",
  WAITRON_ADMIN_PASSWORD: "dashPass123",
};
```

In the main "reads the stamp, applies…" test, after the `verifyPin` assertion (line 1041) add:

```typescript
    expect(seedAdmin?.kind === "seed-admin" && verifyPassword("dashPass123", seedAdmin.passwordHash)).toBe(
      true,
    );
```

And in that test's "no secret anywhere" block (after line 1073) add:

```typescript
    expect(printed).not.toContain("dashPass123");
```

In the "reads the admin PIN echo-OFF from a prompt" test (lines 1085-1102): the password now also
falls through to a prompt (it is not in that test's env), read AFTER the PIN. Update the harness and
assertions:

```typescript
    const h = harness({
      env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI },
      secrets: ["4321", "dashPass123"],
    });
    // ...
    expect(h.askedSecretly).toEqual([
      "admin PIN (not shown): ",
      "admin password (not shown): ",
    ]);
    // ...after the existing verifyPin assertion (line 1099):
    expect(seedAdmin?.kind === "seed-admin" && verifyPassword("dashPass123", seedAdmin.passwordHash)).toBe(
      true,
    );
    // ...and assert the password never reached the transcript:
    expect(transcript).not.toContain("dashPass123");
```

Add a NEW test after the too-short-PIN test (after line 1137), mirroring it for the password. The PIN
is valid here so the flow reaches the password check:

```typescript
  it("refuses a too-short admin password and applies nothing — the floor loginManager needs", async () => {
    // `hashPassword` validates nothing, so without a length check at the boundary an operator could
    // seed the admin with a trivially short dashboard password. The CLI applies the same
    // MIN_PASSWORD_LENGTH floor `setPassword` does. `shortpw` (length 7) is below it and is a
    // distinctive string absent from every other arg, so the leak-safety assertion is real.
    const h = harness({
      env: {
        WAITRON_ADMIN_DATABASE_URL: ADMIN_URI,
        WAITRON_ADMIN_PIN: "4321",
        WAITRON_ADMIN_PASSWORD: "shortpw",
      },
    });
    const code = await runCli([...VENUE_ARGS, "--yes"], h.deps);
    expect(code).toBe(1);
    expect(h.lines.join("\n")).toContain('password.too_short {"min":8}');
    expect(h.lines.join("\n")).not.toContain("shortpw");
    expect(h.applyVenue).not.toHaveBeenCalled();
    expect(h.connect).not.toHaveBeenCalled();
  });
```

In the full-prompt-sequence test (around line 1399), the password also prompts (URL-only env). Update
`secrets` and the `askedSecretly` assertion (line 1435):

```typescript
      secrets: ["4321", "dashPass123"],
      // ...
    expect(h.askedSecretly).toEqual([
      "admin PIN (not shown): ",
      "admin password (not shown): ",
    ]);
```

(The visible `asked` list at lines 1410-1432 is unchanged — the password prompt is echo-off.)

- [ ] **Step 11: Run the CLI tests to verify they fail**

Run: `pnpm --filter @waitron/provisioning test cli`
Expected: FAIL — `readAdminPassword` / `ADMIN_PASSWORD_VARIABLE` do not exist yet and the request
builder does not set `passwordHash`, so the venue tests error (typecheck / missing prompt / `password.too_short`
not thrown).

- [ ] **Step 12: Implement the CLI read + validate + hash + helper + USAGE**

In `packages/provisioning/src/cli.ts`:

Add to the identity import (line 9):

```typescript
import { assertPasswordLength, assertPinLength, hashPassword, hashPin } from "@waitron/identity";
```

Add the env-var constant after `ADMIN_PIN_VARIABLE` (after line 69):

```typescript
/** The env var the admin dashboard PASSWORD is read from. Like the PIN and the admin connection
 * string, a login secret never comes from argv (`argv` is world-readable in `ps` and lands in shell
 * history): it comes from this variable or an echo-off prompt, and from nowhere else. `parse` declares
 * no `--password`/`--admin-password`, so `strict: true` turns either into a parse error. */
const ADMIN_PASSWORD_VARIABLE = "WAITRON_ADMIN_PASSWORD";
```

In `venue()`, after `assertPinLength(adminPin);` (line 411), read and validate the password (update the
comment block at 404-414 to say "the PIN and dashboard password are SECRETS, resolved exactly as the
admin connection string is…"):

```typescript
    const adminPassword = await readAdminPassword(deps);
    assertPasswordLength(adminPassword);
```

In the request builder (line 435), set `passwordHash`:

```typescript
      admin: {
        displayName: adminName,
        pinHash: hashPin(adminPin),
        passwordHash: hashPassword(adminPassword),
      },
```

Add the `readAdminPassword` helper after `readAdminPin` (after line 738), mirroring it:

```typescript
/**
 * The admin dashboard PASSWORD, from WAITRON_ADMIN_PASSWORD or an echo-off prompt — and from nowhere
 * else, for the same reason `readAdminPin` refuses a flag: a password is a login secret. Structurally
 * mirrors `readAdminPin`. Deliberately NOT trimmed (every character is significant), and the caller
 * checks its length against `MIN_PASSWORD_LENGTH` via `assertPasswordLength` — so an empty answer
 * (Ctrl+D, exhausted stdin) is rejected there as `password.too_short`, and no separate "missing" code
 * is needed.
 */
async function readAdminPassword(deps: CliDeps): Promise<string> {
  const fromEnv = deps.env[ADMIN_PASSWORD_VARIABLE];
  if (typeof fromEnv === "string" && fromEnv !== "") return fromEnv;
  return deps.io.promptSecret("admin password (not shown): ");
}
```

Update the USAGE text (lines 94-96) to cover both secrets:

```typescript
  "The admin PIN and dashboard password (venue) are NOT options either, for the same reason: a",
  "login secret must not reach argv, so each is read from WAITRON_ADMIN_PIN /",
  "WAITRON_ADMIN_PASSWORD or an echo-off prompt — and from nowhere else. The admin display name",
  "(--admin-name) is not a secret and stays a flag.",
```

- [ ] **Step 13: Run the CLI tests to verify they pass**

Run: `pnpm --filter @waitron/provisioning test cli`
Expected: PASS. Confirm the existing "refuses any flag that would put a secret in argv" test (which
already lists `--admin-password`) stays green — the `strict` parser still rejects it, no change needed.

- [ ] **Step 14: Run the whole package (coverage) + typecheck + lint**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/provisioning test:coverage`
Then: `pnpm --filter @waitron/provisioning typecheck && pnpm --filter @waitron/provisioning lint`
Expected: all green; coverage ≥ 98/98/98/95. (The real-PG `venue-apply.node-privilege.rls.test.ts`
runs here — it must stay green with the fixture change.)

- [ ] **Step 15: Commit**

```bash
git add packages/provisioning/src
git commit -s -m "feat(provisioning): seed the first admin's dashboard password in venue"
```

---

### Task 2: Gap-closing end-to-end — loginManager succeeds after venue

Proves the whole point: after `applyVenue`, the seeded admin can actually log into the dashboard.

**Files:**
- Test: `packages/provisioning/src/venue-apply.e2e.test.ts` (add one `describe`/`it`)

**Interfaces:**
- Consumes: `applyVenue` + `planVenue` (Task 1); `loginManager`, `hashPassword` from `@waitron/identity`;
  the admin `persons` row seeded by Task 1 (read its `id` by `tenant_id` + `role = 'admin'`).

- [ ] **Step 1: Write the failing end-to-end login test**

In `packages/provisioning/src/venue-apply.e2e.test.ts`, add `loginManager` and `hashPassword` to the
`@waitron/identity` import, and set the fixture's `passwordHash` from a known plaintext so login can be
attempted. Change the `request()` helper's admin (line 77) to:

```typescript
    admin: {
      displayName: "Owner",
      pinHash: "scrypt$00$00",
      passwordHash: hashPassword("dashPass123"),
    },
```

Add the test (uses the same PGlite `suite.db` as the file's other tests; the identity migrations are
already loaded, so `management_sessions` exists):

```typescript
describe("the seeded admin can perform a first dashboard login", () => {
  it("loginManager succeeds with the provisioned password and rejects a wrong one", async () => {
    const venue = await applyVenue(planVenue(request("B33333333")), { db: suite.db });

    // Read back the admin the seed created — its id is generated, so fetch it by tenant + role.
    const admin = await suite.db.execute<{ id: string }>(sql`
      select id from persons where tenant_id = ${venue.tenantId} and role = 'admin'`);
    const personId = admin.rows[0]?.id;
    expect(personId).toBeDefined();

    // The gap this whole feature closes: a first dashboard login now works.
    const session = await withTenant(suite.db, venue.tenantId, (tx) =>
      loginManager(tx, { tenantId: venue.tenantId, personId: personId!, password: "dashPass123" }),
    );
    expect(session.personId).toBe(personId);

    // Negative control: the wrong password is refused.
    await expect(
      withTenant(suite.db, venue.tenantId, (tx) =>
        loginManager(tx, { tenantId: venue.tenantId, personId: personId!, password: "wrongpass1" }),
      ),
    ).rejects.toMatchObject({ code: "password.invalid" });
  });
});
```

Notes for the implementer:
- Import `withTenant` from `@waitron/db` and `sql` from `drizzle-orm` if not already imported in this
  file; check the existing imports first and add only what is missing.
- `ManagementSession`'s shape: confirm the returned session field name against
  `packages/identity/src/management-session.ts` (`startManagementSession`'s return). If the property is
  not `personId`, assert on whatever field carries the person id there; do not invent one.
- Use a fresh `taxId` (`"B33333333"`) so this test's tenant is isolated from the file's other tests,
  which share one PGlite database.

- [ ] **Step 2: Run it to verify it fails first (guard check)**

Before Task 1's insert change is present this would fail; with Task 1 landed it should pass directly.
To prove the test is real, temporarily set the fixture `passwordHash` to a hash of a DIFFERENT
plaintext (e.g. `hashPassword("somethingElse9")`) and run:

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/provisioning test venue-apply.e2e`
Expected: FAIL on the positive login (`password.invalid`) — proving the assertion exercises the real
verify. Then restore `hashPassword("dashPass123")`.

- [ ] **Step 3: Run it to verify it passes**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/provisioning test venue-apply.e2e`
Expected: PASS.

- [ ] **Step 4: Coverage + commit**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/provisioning test:coverage`
Expected: green, ≥ 98/98/98/95.

```bash
git add packages/provisioning/src/venue-apply.e2e.test.ts
git commit -s -m "test(provisioning): prove a first dashboard login works after venue"
```

---

### Task 3: Update the operator runbooks

Both runbooks are stale for the admin seed; correct them and document the new env var (a README that
paraphrases behaviour is a receipt that goes stale — CLAUDE.md §1).

**Files:**
- Modify: `packages/provisioning/README.md` (the `venue` section, ~197-232)
- Modify: `apps/server/README.md` ("Provisioning a venue", ~264-300)

**Interfaces:** none (documentation).

- [ ] **Step 1: Read both sections in full**

Read `packages/provisioning/README.md` around the `venue` section and its "Secrets" table, and
`apps/server/README.md`'s "Provisioning a venue" section. Note the exact current wording before
editing (do not guess line numbers — grep for `WAITRON_ADMIN_PIN`, `venue`, `Secrets`).

- [ ] **Step 2: Update `packages/provisioning/README.md`**

- Document `WAITRON_ADMIN_PASSWORD` alongside `WAITRON_ADMIN_PIN` wherever the venue secrets are
  described (both are env-or-echo-off-prompt, never argv).
- Add both `WAITRON_ADMIN_PIN` and `WAITRON_ADMIN_PASSWORD` to the "Secrets" table (the PIN is
  currently missing from it too).
- Add a one-line "first dashboard login" note: after `venue`, sign in to the management dashboard with
  the admin's display name + this password.

- [ ] **Step 3: Update `apps/server/README.md`**

- Fix the worked `venue` example: it currently omits `--admin-name` (now required/prompted) and any
  mention of `WAITRON_ADMIN_PIN`. Add `--admin-name`, and show `WAITRON_ADMIN_PIN` and
  `WAITRON_ADMIN_PASSWORD` being supplied via the environment (never as flags).
- Add the same one-line "first dashboard login" note.

- [ ] **Step 4: Verify docs gate**

Run: `pnpm exec prettier --check apps/server/README.md`
Expected: PASS (root-level `README.md` is format-checked; `docs/` and `packages/*/README.md` are under
`.prettierignore`, but check anyway). Fix any formatting the checker flags.

- [ ] **Step 5: Commit**

```bash
git add packages/provisioning/README.md apps/server/README.md
git commit -s -m "docs(provisioning): document WAITRON_ADMIN_PASSWORD + fix the stale venue runbook"
```

---

## Self-Review

**Spec coverage:**
- CLI reads `WAITRON_ADMIN_PASSWORD` / echo-off prompt, ≥8, hashed at boundary → Task 1 (steps 10-13).
- Plan threads `passwordHash` → Task 1 (steps 1-4). Apply writes `password_hash` → Task 1 (steps 5-8).
- No schema migration, no grant change → honoured (Task 1 uses the existing column + owner insert; the
  real-PG `node-privilege` test stays green at step 14).
- Secret discipline (never argv/printed; length floor) → Task 1 (steps 10, 12; `describeVenueAction`
  negative test in step 1; too-short test in step 10; `--admin-password` refusal already covered).
- Runbooks corrected → Task 3.
- Gap-closing e2e (`loginManager` succeeds) → Task 2.
- Out-of-scope (standalone command, force-change) → not implemented, as specified.

**Placeholder scan:** none — every step carries concrete code or an exact command. The two soft spots
are explicitly bounded: Task 2 step 1 tells the implementer to confirm the `ManagementSession` field
name against source rather than assume, and Task 3 step 1 tells them to read the READMEs before editing
rather than trust line numbers.

**Type consistency:** `passwordHash: string` is used identically on `VenueRequest.admin`, the
`seed-admin` action, and every fixture; `hashPassword`/`assertPasswordLength`/`verifyPassword`/
`loginManager` are the real exports from `@waitron/identity` (`packages/identity/src/index.ts:14,42-47`);
the insert column is `password_hash` (matching `persons.password_hash`). The test password is
`"dashPass123"` throughout; the too-short value is `"shortpw"` (7 < 8).
