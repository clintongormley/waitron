# Per-user Language Preference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each staff member pick their own interface language (stored on their `persons` row), applied in the till and dashboard before and after login, while the printed receipt keeps the venue's language.

**Architecture:** A nullable `persons.locale` column holds the preference. `packages/shared` gains the supported-locale list, the geography-derived venue-default resolver, and the active-locale resolver — all pure, shared by server and both front-ends. The server exposes the venue default + the supported list (public), returns each person's locale on their session, and offers two `PUT …/locale` write routes. Both Lit front-ends turn `setLocale` into "set + notify" so a live switch repaints, add a link-triggered chooser widget that fetches the list on open, and resolve the active locale from `person.locale ?? venueDefault ?? en-GB`.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers, `verbatimModuleSyntax`), Drizzle ORM + drizzle-kit, PostgreSQL 18 (RLS), Hono (server), Lit (front-ends), Vitest (+ v8 coverage, Testcontainers for real-PG suites).

**Spec:** `docs/superpowers/specs/2026-08-26-per-user-language-preference-design.md` — read it alongside this plan.

## Global Constraints

- **TDD.** Failing test first, watch it fail, minimal implementation, watch it pass, commit. Prove each new guard/branch by deletion where practical.
- **Every commit is signed off:** `git commit -s`. Work happens in the worktree `~/workspace/worktrees/waitron-feat-per-user-locale` (branch `feat/per-user-locale`), never on `main`.
- **Real Postgres** (not PGlite) for anything about RLS or the `app_user` role. Real-PG suites need `TESTCONTAINERS_RYUK_DISABLED=true` locally or they hang to the 180s hook timeout.
- **Error codes name the DOMAIN CONCEPT, never the package** — `locale.unsupported`, never `identity.*`/`server.*`/`shared.locale_*`. Codes are never renamed once shipped.
- **Never leak our own metadata into a fiscal hash; never make the receipt/`invoiceLocale` depend on the operator.** The per-user preference drives on-screen UI only.
- **Spanish domain vocabulary** stays (the `english-only` guard). Locale codes and country codes are English identifiers and are fine.
- **Coverage thresholds:** `packages/shared`, `packages/identity`, `apps/server` = 98/98/98/95; `apps/till` = 95/95/90/88; `apps/dashboard` = 98/98/98/95 (confirm from its `vitest.config.ts` before relying on it). CI shards run `test:coverage`, not `test`.
- **`resolveActiveLocale`/`resolveVenueLocale` never return an unsupported code.** `setLocale` is never handed a locale without a catalogue.

---

## Task 1: Shared locale foundations (`packages/shared`)

The supported list, the geography maps, the two resolvers, and the `locale.unsupported` error code — the pure core every other task consumes.

**Files:**
- Create: `packages/shared/src/locales.ts`
- Create: `packages/shared/src/locales.test.ts`
- Modify: `packages/shared/src/errors.ts` (add `locale.unsupported` to the native `ErrorParams` interface, ~lines 83-87)
- Modify: `packages/shared/src/index.ts` (re-export the new bindings, after line 60)
- Modify: `packages/shared/src/index.test.ts` (assert the new re-exports exist)

**Interfaces:**
- Produces:
  - `SUPPORTED_LOCALES: ReadonlyArray<{ code: string; label: string }>` — `[{code:"es-ES",label:"Español"},{code:"en-GB",label:"English"}]`
  - `type SupportedLocale = "es-ES" | "en-GB"`
  - `SUPPORTED_LOCALE_CODES: readonly string[]`
  - `FALLBACK_LOCALE = "en-GB"`
  - `COUNTRY_DEFAULT_LOCALE: Record<string,string>` = `{ ES: "es-ES" }`
  - `PROVINCE_DEFAULT_LOCALE: Record<string,string>` = `{}`
  - `isSupportedLocale(code: string | null | undefined): code is SupportedLocale`
  - `assertSupportedLocale(code: string): SupportedLocale` — throws `AppError("locale.unsupported", { locale })`
  - `resolveVenueLocale(input: { override?: string|null; province?: string|null; country?: string|null }): SupportedLocale`
  - `resolveActiveLocale(personLocale: string|null|undefined, venueLocale: string): SupportedLocale`
  - Error code `locale.unsupported` with params `{ locale: string }`

- [ ] **Step 1: Add the error code (registry first, so the throw typechecks).**

In `packages/shared/src/errors.ts`, add to the native `ErrorParams` interface (the block currently holding the three `shared.*` codes, ~line 83):

```ts
  "locale.unsupported": { locale: string };
```

- [ ] **Step 2: Write the failing test** `packages/shared/src/locales.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AppError } from "./errors.js";
import {
  assertSupportedLocale,
  isSupportedLocale,
  resolveActiveLocale,
  resolveVenueLocale,
  SUPPORTED_LOCALE_CODES,
} from "./locales.js";

describe("isSupportedLocale", () => {
  it("accepts the shipped codes and rejects others / nullish", () => {
    expect(isSupportedLocale("es-ES")).toBe(true);
    expect(isSupportedLocale("en-GB")).toBe(true);
    expect(isSupportedLocale("ca-ES")).toBe(false);
    expect(isSupportedLocale(null)).toBe(false);
    expect(isSupportedLocale(undefined)).toBe(false);
  });
});

describe("assertSupportedLocale", () => {
  it("returns a supported code unchanged", () => {
    expect(assertSupportedLocale("es-ES")).toBe("es-ES");
  });
  it("throws locale.unsupported carrying the bad value", () => {
    try {
      assertSupportedLocale("ca-ES");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("locale.unsupported");
      expect((err as AppError).params).toEqual({ locale: "ca-ES" });
    }
  });
});

describe("resolveVenueLocale (province → country → English floor)", () => {
  it("Madrid (country ES, no regional catalogue) → es-ES", () => {
    expect(resolveVenueLocale({ province: "Madrid", country: "ES" })).toBe("es-ES");
  });
  it("Cataluña → es-ES today (province→Catalan deferred, falls to country), NOT English", () => {
    expect(resolveVenueLocale({ province: "Barcelona", country: "ES" })).toBe("es-ES");
  });
  it("unsupported country → the English floor", () => {
    expect(resolveVenueLocale({ province: null, country: "FR" })).toBe("en-GB");
  });
  it("a supported override wins", () => {
    expect(resolveVenueLocale({ override: "en-GB", country: "ES" })).toBe("en-GB");
  });
  it("an unsupported override is ignored", () => {
    expect(resolveVenueLocale({ override: "ca-ES", country: "ES" })).toBe("es-ES");
  });
  it("nothing available anywhere → English floor", () => {
    expect(resolveVenueLocale({})).toBe("en-GB");
  });
});

describe("resolveActiveLocale (person ?? venue, always supported)", () => {
  it("a supported personal choice wins", () => {
    expect(resolveActiveLocale("en-GB", "es-ES")).toBe("en-GB");
  });
  it("null/unsupported personal choice falls to the (supported) venue default", () => {
    expect(resolveActiveLocale(null, "es-ES")).toBe("es-ES");
    expect(resolveActiveLocale("ca-ES", "es-ES")).toBe("es-ES");
  });
  it("an unsupported venue default degrades to the English floor", () => {
    expect(resolveActiveLocale(null, "ca-ES")).toBe("en-GB");
  });
});

it("SUPPORTED_LOCALE_CODES matches the shipped catalogue set", () => {
  expect([...SUPPORTED_LOCALE_CODES]).toEqual(["es-ES", "en-GB"]);
});
```

- [ ] **Step 3: Run it, watch it fail** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/shared test locales`
  Expected: FAIL (`Cannot find module './locales.js'`).

- [ ] **Step 4: Implement** `packages/shared/src/locales.ts`:

```ts
import { AppError } from "./errors.js";

/**
 * The languages the apps can actually render (a catalogue exists for each).
 * `label` is the language's own endonym, shown in the picker. Adding a locale
 * is: a catalogue in each app's strings.ts + one entry here — no migration.
 */
export const SUPPORTED_LOCALES = [
  { code: "es-ES", label: "Español" },
  { code: "en-GB", label: "English" },
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]["code"];

export const SUPPORTED_LOCALE_CODES: readonly string[] = SUPPORTED_LOCALES.map((l) => l.code);

/** The absolute floor — reached only when neither province nor country yields
 * an available language. */
export const FALLBACK_LOCALE: SupportedLocale = "en-GB";

/** country → its default UI language. One meaningful entry today; a country
 * absent here falls through to FALLBACK_LOCALE. */
export const COUNTRY_DEFAULT_LOCALE: Record<string, string> = { ES: "es-ES" };

/** province → its regional language. DEFERRED: empty until a regional catalogue
 * (e.g. Catalan) ships, so every province falls through to the country step. */
export const PROVINCE_DEFAULT_LOCALE: Record<string, string> = {};

export function isSupportedLocale(code: string | null | undefined): code is SupportedLocale {
  return code != null && SUPPORTED_LOCALE_CODES.includes(code);
}

/** Validate a locale being written. Throws rather than falls back — a write of
 * an unknown locale is a bug, not a preference. */
export function assertSupportedLocale(code: string): SupportedLocale {
  if (!isSupportedLocale(code)) throw new AppError("locale.unsupported", { locale: code });
  return code;
}

/**
 * The venue's default UI language: the first AVAILABLE of
 * override → province language (deferred) → country language → English floor.
 * Always returns a supported code, so the apps never receive `ca-ES`.
 */
export function resolveVenueLocale(input: {
  override?: string | null;
  province?: string | null;
  country?: string | null;
}): SupportedLocale {
  const candidates = [
    input.override ?? undefined,
    input.province != null ? PROVINCE_DEFAULT_LOCALE[input.province] : undefined,
    input.country != null ? COUNTRY_DEFAULT_LOCALE[input.country] : undefined,
    FALLBACK_LOCALE,
  ];
  for (const candidate of candidates) {
    if (isSupportedLocale(candidate)) return candidate;
  }
  return FALLBACK_LOCALE;
}

/**
 * The active UI language for a person: their supported choice, else the venue
 * default (itself already supported), else the English floor. Never returns an
 * unsupported code.
 */
export function resolveActiveLocale(
  personLocale: string | null | undefined,
  venueLocale: string,
): SupportedLocale {
  if (isSupportedLocale(personLocale)) return personLocale;
  if (isSupportedLocale(venueLocale)) return venueLocale;
  return FALLBACK_LOCALE;
}
```

- [ ] **Step 5: Re-export from the barrel.** In `packages/shared/src/index.ts`, after the last existing block (~line 60), add:

```ts
export {
  SUPPORTED_LOCALES,
  SUPPORTED_LOCALE_CODES,
  FALLBACK_LOCALE,
  COUNTRY_DEFAULT_LOCALE,
  PROVINCE_DEFAULT_LOCALE,
  isSupportedLocale,
  assertSupportedLocale,
  resolveVenueLocale,
  resolveActiveLocale,
} from "./locales.js";
export type { SupportedLocale } from "./locales.js";
```

- [ ] **Step 6: Update the barrel test.** `packages/shared/src/index.test.ts` asserts every public binding is re-exported (coverage-v8 flags a re-export otherwise). Add assertions mirroring the existing ones, e.g.:

```ts
import * as shared from "./index.js";
// ...
expect(shared.resolveVenueLocale).toBeTypeOf("function");
expect(shared.resolveActiveLocale).toBeTypeOf("function");
expect(shared.SUPPORTED_LOCALES).toBeDefined();
```
Match the file's existing assertion style (read it first).

- [ ] **Step 7: Run the package suite (coverage) and watch it pass** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/shared test:coverage`
  Expected: PASS, thresholds met. (`conventions.test.ts` auto-includes `locales.ts` and requires `AppError`-only throws — satisfied.)

- [ ] **Step 8: Prove the throw by deletion.** Temporarily change `assertSupportedLocale` to `return code as SupportedLocale;` (no throw), run the test, confirm the `locale.unsupported` test FAILS, restore.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/locales.ts packages/shared/src/locales.test.ts \
        packages/shared/src/errors.ts packages/shared/src/index.ts packages/shared/src/index.test.ts
git commit -s -m "feat(shared): supported-locale list, venue/active resolvers, locale.unsupported"
```

---

## Task 2: `persons.locale` column + RLS migration proof (`packages/identity`)

**Files:**
- Modify: `packages/identity/src/schema/persons.ts` (add the column + CHECK)
- Create: `packages/identity/drizzle/00NN_<slug>.sql` (generated) + `drizzle/meta/*` (generated)
- Create: `packages/identity/src/persons-locale.rls.test.ts` (real-PG, mirrors `persons.rls.test.ts`)

**Interfaces:**
- Produces: `persons.locale` — nullable `text`, `null` = "no preference".

- [ ] **Step 1: Write the failing real-PG test** `packages/identity/src/persons-locale.rls.test.ts`, modelled on `packages/identity/src/persons.rls.test.ts` (read it first for `seedTenant`, `useTemplateDb`, `connectAs`, `withTenant`). Assert the app-role probe can UPDATE `locale` on a row in its own tenant, and read it back:

```ts
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { withTenant } from "@waitron/db";
import { hashPin } from "./verify-pin.js";
import { seedTenant } from "./test/fixtures.js"; // use whatever persons.rls.test.ts imports

const PROBE_ROLE = "identity_rls_probe";
const PROBE_PASSWORD = "probe";
const suite = useTemplateDb({ template: "core_identity" });

describe("persons.locale under RLS", () => {
  it("app_user can set and read its own tenant's person.locale", async () => {
    const tenantId = await seedTenant(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const personId = await withTenant(probe, tenantId, async (tx) => {
        const [row] = (
          await tx.execute(sql`
            insert into persons (tenant_id, display_name, pin_hash, locale)
            values (${tenantId}, 'Ana', ${hashPin("1234")}, 'en-GB')
            returning id`)
        ).rows as { id: string }[];
        return row.id;
      });
      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`update persons set locale = 'es-ES' where id = ${personId}`),
      );
      const rows = await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`select locale from persons where id = ${personId}`),
      );
      expect(rows.rows).toEqual([{ locale: "es-ES" }]);
    } finally {
      await probe.close();
    }
  });
});
```
(Adjust imports to match `persons.rls.test.ts` exactly — helper names, `connectAs` signature, and how it reads `.rows`.)

- [ ] **Step 2: Run it, watch it fail** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/identity test persons-locale`
  Expected: FAIL (`column "locale" of relation "persons" does not exist`).

- [ ] **Step 3: Add the column** to `packages/identity/src/schema/persons.ts` — among the columns (after `totpSecret`, before `role`):

```ts
    /** The person's preferred UI language (a SUPPORTED_LOCALES code). Null = no
     * preference; the app falls back to the venue default. Validated at the
     * write boundary (setPersonLocale), not by a DB enum, so a new locale is a
     * catalogue + constant change with no migration. */
    locale: text("locale"),
```
and in the constraints array (after `persons_totp_secret_ck`):

```ts
    check("persons_locale_ck", sql`${t.locale} is null or length(${t.locale}) > 0`),
```
(`text`, `check`, `sql` are already imported.)

- [ ] **Step 4: Generate the migration** — `pnpm --filter @waitron/identity db:generate`
  Expected: a new `packages/identity/drizzle/00NN_<slug>.sql` containing `ALTER TABLE "persons" ADD COLUMN "locale" text;` + the `ADD CONSTRAINT "persons_locale_ck" CHECK (...)`, plus updated `drizzle/meta/*`. Confirm it did NOT touch RLS/policy/grants (a plain column-add, like `0004_nosy_naoko.sql`). Read the generated SQL to verify.

- [ ] **Step 5: Run the test, watch it pass** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/identity test persons-locale`
  Expected: PASS. (The template DB is remigrated on the next run because the migration set changed.)

- [ ] **Step 6: Run the whole identity suite (coverage)** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/identity test:coverage`
  Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/identity/src/schema/persons.ts packages/identity/drizzle \
        packages/identity/src/persons-locale.rls.test.ts
git commit -s -m "feat(identity): add nullable persons.locale column"
```

---

## Task 3: `setPersonLocale` verb + locale on session reads (`packages/identity`)

**Files:**
- Modify: `packages/identity/src/staff.ts` (add `setPersonLocale`) — or a new `packages/identity/src/person-locale.ts` if you prefer a dedicated file; `staff.ts` matches the `setRole`/`setPassword` neighbours.
- Modify: `packages/identity/src/credential.ts` (`verifyPersonCredential` returns `locale`)
- Modify: `packages/identity/src/login.ts` (`Session` gains `locale`; `loginWithPin` returns it)
- Modify: `packages/identity/src/management-session.ts` (`resolveManagementSession` returns `locale`)
- Modify: `packages/identity/src/index.ts` (export `setPersonLocale`)
- Create/Modify: `packages/identity/src/person-locale.test.ts` (verb behaviour) and extend the existing login/management-session/credential tests for the new field.

**Interfaces:**
- Consumes: `assertSupportedLocale`, `AppError` from `@waitron/shared` (Task 1).
- Produces:
  - `setPersonLocale(tx: Transaction, input: { tenantId: string; personId: string; locale: string }): Promise<void>`
  - `verifyPersonCredential(...) -> { role: PersonRoleValue; locale: string | null }`
  - `Session` interface gains `locale: string | null`; `loginWithPin(...)` returns it.
  - `resolveManagementSession(...) -> { personId: string; role: PersonRoleValue; locale: string | null }`

> **Design note (call out in review):** unlike the other `staff.ts` mutators, `setPersonLocale` takes `tenantId` and does NOT call `authorizeManager` — a person sets their OWN language. The server routes always pass the SESSION's `personId` (never a body value), and RLS scopes the UPDATE to the current tenant, so no permission gate is correct here.

- [ ] **Step 1: Write the failing verb test** `packages/identity/src/person-locale.test.ts`. Use the same DB seam the sibling logic tests use (PGlite via the `test/fixtures.ts` seeders is fine for verb logic — RLS is proven in Task 2). Read a sibling like `staff.test.ts` first. Assert: a supported locale is written to the person's row; an unsupported locale throws `locale.unsupported` and writes nothing.

```ts
// sketch — align imports/seeders with staff.test.ts
it("writes a supported locale", async () => {
  const { tx, tenantId, personId } = await seedPersonFixture();
  await setPersonLocale(tx, { tenantId, personId, locale: "en-GB" });
  const [row] = await tx.select({ locale: persons.locale }).from(persons).where(eq(persons.id, personId));
  expect(row.locale).toBe("en-GB");
});

it("rejects an unsupported locale and writes nothing", async () => {
  const { tx, tenantId, personId } = await seedPersonFixture();
  await expect(setPersonLocale(tx, { tenantId, personId, locale: "ca-ES" })).rejects.toMatchObject({
    code: "locale.unsupported",
  });
  const [row] = await tx.select({ locale: persons.locale }).from(persons).where(eq(persons.id, personId));
  expect(row.locale).toBeNull();
});
```

- [ ] **Step 2: Run it, watch it fail** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/identity test person-locale`
  Expected: FAIL (`setPersonLocale is not exported`).

- [ ] **Step 3: Implement `setPersonLocale`** in `packages/identity/src/staff.ts` (imports `assertSupportedLocale` from `@waitron/shared`; `persons`, `eq` already imported):

```ts
/** Set a person's preferred UI language. Validates against the supported set
 * (throws locale.unsupported). No authorizeManager gate: a person sets their
 * OWN locale — the caller passes the session's personId, RLS scopes the tenant. */
export async function setPersonLocale(
  tx: Transaction,
  input: { tenantId: string; personId: string; locale: string },
): Promise<void> {
  const locale = assertSupportedLocale(input.locale);
  await tx.update(persons).set({ locale }).where(eq(persons.id, input.personId));
}
```
Add `export { setPersonLocale } from "./staff.js";` (or extend the existing staff export line) in `packages/identity/src/index.ts`.

- [ ] **Step 4: Thread `locale` onto the session reads.**
  - `credential.ts`: add `locale: persons.locale` to the `.select({...})`, widen the return type to `{ role: PersonRoleValue; locale: string | null }`, and return `locale: person.locale`.
  - `login.ts`: add `locale: string | null` to the `Session` interface; in `loginWithPin`, capture `locale` from `verifyPersonCredential` and include it in the returned object.
  - `management-session.ts`: add `locale: persons.locale` to the `.select({...})`, widen the return type to include `locale: string | null`, return `locale: row.locale`.

- [ ] **Step 5: Extend the sibling tests** that assert those return shapes (login, management-session, credential) to include `locale` (default `null` for a person with no preference; a set value when seeded). Read each test first and add the field to its existing expectations rather than rewriting them.

- [ ] **Step 6: Run the package suite (coverage), watch it pass** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/identity test:coverage`
  Expected: PASS.

- [ ] **Step 7: Prove the validation by deletion.** Temporarily drop the `assertSupportedLocale` call (assign `input.locale` directly), confirm the "rejects an unsupported locale" test FAILS, restore.

- [ ] **Step 8: Commit**

```bash
git add packages/identity/src
git commit -s -m "feat(identity): setPersonLocale verb + locale on session reads"
```

---

## Task 4: Venue-default locale + public list endpoints (`apps/server`)

Compute the venue default once at boot (`province → country → English`, with `WAITRON_TILL_LOCALE` as an explicit override), thread it into the surfaces, and expose it + the supported list publicly. The fiscal `cfg.locale`/`invoiceLocales` are left exactly as they are.

**Files:**
- Create: `apps/server/src/venue-locale.ts` + `apps/server/src/venue-locale.test.ts`
- Modify: `apps/server/src/till-config.ts` (add `localeOverride` to `TillConfig` + its loader)
- Modify: `apps/server/src/boot.ts` (compute `venueLocale` after building `till` at ~line 294; pass it into the till + me mounts)
- Modify: `apps/server/src/till-api.ts` (`TillApiDeps` gains `venueLocale`; `GET /api/till` `locale` field becomes it; add public `GET /api/locales`)
- Modify: `apps/server/src/me-api.ts` (`MeApiDeps` gains `venueLocale`; add public `GET /management-api/locales`)
- Modify: `apps/server/src/till-api.test.ts`, `apps/server/src/me-api.test.ts` (assert the new fields/routes)

**Interfaces:**
- Consumes: `resolveVenueLocale`, `SUPPORTED_LOCALES`, `type SupportedLocale` from `@waitron/shared` (Task 1); `tenants`, `locations`, `withTenant`, `asAppUser`, `type Database` from `@waitron/db`.
- Produces:
  - `readVenueLocale(db: Database, params: { tenantId: string; locationId: string; override?: string }): Promise<SupportedLocale>`
  - `TillConfig.localeOverride?: string` (raw `WAITRON_TILL_LOCALE`, `undefined` when unset/empty)
  - `TillApiDeps.venueLocale: string`, `MeApiDeps.venueLocale: string`
  - `GET /api/locales` and `GET /management-api/locales` → `{ locales: typeof SUPPORTED_LOCALES; venueDefault: string }`
  - `GET /api/till`'s `locale` field is now the derived venue default (was `cfg.locale`)

- [ ] **Step 1: Write the failing helper test** `apps/server/src/venue-locale.test.ts`. Use the same DB seam `till-api.test.ts` uses (`usePgliteDb` with CORE+IDENTITY migrations + a `setup` that seeds a tenant with `country` and a location with `province`; read `till-api.test.ts:35-124` for the seed helpers). Assert:

```ts
it("derives the country default when no override and no regional catalogue", async () => {
  // seed tenant country 'ES', location province 'Barcelona'
  const got = await readVenueLocale(suite.db, { tenantId, locationId, override: undefined });
  expect(got).toBe("es-ES"); // province→Catalan deferred → country ES → es-ES
});
it("honours a supported override", async () => {
  const got = await readVenueLocale(suite.db, { tenantId, locationId, override: "en-GB" });
  expect(got).toBe("en-GB");
});
it("ignores an unsupported override, falls to country", async () => {
  const got = await readVenueLocale(suite.db, { tenantId, locationId, override: "ca-ES" });
  expect(got).toBe("es-ES");
});
```

- [ ] **Step 2: Run it, watch it fail** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test venue-locale`
  Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `apps/server/src/venue-locale.ts`:

```ts
import { eq } from "drizzle-orm";
import { asAppUser, locations, tenants, withTenant, type Database } from "@waitron/db";
import { resolveVenueLocale, type SupportedLocale } from "@waitron/shared";

/** The venue's default UI locale, resolved ONCE at boot from geography +
 * optional env override. Reads the tenant's country and the location's province
 * under the app role, then applies the shared `province → country → English`
 * chain. This is a DISPLAY value; the fiscal `cfg.invoiceLocales` is separate
 * and unchanged. */
export async function readVenueLocale(
  db: Database,
  params: { tenantId: string; locationId: string; override?: string },
): Promise<SupportedLocale> {
  return withTenant(db, params.tenantId, async (tx) => {
    await asAppUser(tx);
    const [t] = await tx
      .select({ country: tenants.country })
      .from(tenants)
      .where(eq(tenants.id, params.tenantId));
    const [loc] = await tx
      .select({ province: locations.province })
      .from(locations)
      .where(eq(locations.id, params.locationId));
    return resolveVenueLocale({
      override: params.override,
      province: loc?.province ?? null,
      country: t?.country ?? null,
    });
  });
}
```
(Confirm `tenants`/`locations` are exported from `@waitron/db` — `GET /api/till` already imports them; if it imports from a subpath, match that.)

- [ ] **Step 4: Run it, watch it pass** — same command. Expected: PASS.

- [ ] **Step 5: Add `localeOverride` to `TillConfig`.** In `apps/server/src/till-config.ts`: add `localeOverride?: string;` to the `TillConfig` interface (near `locale`), and in the loader (~line 127, where `const rawLocale = env.WAITRON_TILL_LOCALE`) set it WITHOUT changing `locale`/`invoiceLocales`:

```ts
    localeOverride: rawLocale === undefined || rawLocale === "" ? undefined : rawLocale,
```
Leave `locale`/`invoiceLocales` exactly as they are (fiscal). Add/extend a `till-config.test.ts` case asserting `localeOverride` is the raw value when set and `undefined` when unset — while `locale` still defaults to `es-ES`.

- [ ] **Step 6: Thread `venueLocale` at boot.** In `apps/server/src/boot.ts`, right after `const till: TillConfig = { ...config.till, orderFlow: await readOrderFlow(db, config.till) };` (~line 294), add:

```ts
const venueLocale = await readVenueLocale(db, {
  tenantId: till.tenantId,
  locationId: till.locationId,
  override: till.localeOverride,
});
```
Then add `venueLocale` to the `mountTillApi(app, { db, cfg: till, /* ... */ }, log)` deps object (~line 308-314) and to `mountMeApi(app, { db, cfg: { tenantId: till.tenantId }, venueLocale }, log)` (~line 409). Import `readVenueLocale` at the top.

- [ ] **Step 7: Add `venueLocale` to the deps types + use it.**
  - `apps/server/src/till-api.ts`: add `venueLocale: string;` to `TillApiDeps` (~line 89-103). In `GET /api/till` change `locale: deps.cfg.locale` (~line 494) to `locale: deps.venueLocale`. Add the public list route near `GET /api/till`:

```ts
app.get("/api/locales", (c) =>
  run(c, log, async () => c.json({ locales: SUPPORTED_LOCALES, venueDefault: deps.venueLocale })),
);
```
Import `SUPPORTED_LOCALES` from `@waitron/shared`.
  - `apps/server/src/me-api.ts`: add `venueLocale: string;` to `MeApiDeps` (~line 32-35). Add the public list route:

```ts
app.get("/management-api/locales", (c) =>
  run(c, log, async () => c.json({ locales: SUPPORTED_LOCALES, venueDefault: deps.venueLocale })),
);
```
Import `SUPPORTED_LOCALES` from `@waitron/shared`.

- [ ] **Step 8: Update the route tests.**
  - `till-api.test.ts`: the `GET /api/till` `toEqual({...})` test (~line 462-495) — the seeded venue's country is `ES`, so `locale` stays `"es-ES"` (now derived, same value); add the `venueLocale`/`localeOverride` plumbing to `makeCfg`/mount as needed. Add a `GET /api/locales` test asserting `{ locales: [{code:"es-ES",...},{code:"en-GB",...}], venueDefault: "es-ES" }`.
  - `me-api.test.ts`: pass `venueLocale` into `mountApp`'s deps; add a `GET /management-api/locales` test (public — no cookie) asserting the same body.

- [ ] **Step 9: Run both suites (coverage)** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage`
  Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/server/src/venue-locale.ts apps/server/src/venue-locale.test.ts \
        apps/server/src/till-config.ts apps/server/src/boot.ts \
        apps/server/src/till-api.ts apps/server/src/me-api.ts \
        apps/server/src/till-api.test.ts apps/server/src/me-api.test.ts \
        apps/server/src/till-config.test.ts
git commit -s -m "feat(server): derive venue-default locale + public GET /api/locales endpoints"
```

---

## Task 5: Return each person's locale on their session (`apps/server`)

**Files:**
- Modify: `apps/server/src/till-api.ts` (`POST /api/session` response gains `locale`)
- Modify: `apps/server/src/me-api.ts` (`GET /management-api/session/me` gains `locale`)
- Modify: `apps/server/src/till-api.test.ts`, `apps/server/src/me-api.test.ts`

**Interfaces:**
- Consumes: `loginWithPin(...)` now returns `Session.locale`; `resolveManagementSession(...)` now returns `locale` (Task 3).
- Produces: `POST /api/session` → `{ personId, canConfigureTill, locale: string | null }`; `GET /management-api/session/me` → `{ personId, role, locale: string | null, venueLocale: string }`.

- [ ] **Step 1: Write the failing tests.**
  - `me-api.test.ts`: extend the whoami test (~line 112-121) — seed a person with `locale = 'en-GB'`, expect `toEqual({ personId, role: "staff", locale: "en-GB", venueLocale: "es-ES" })`; and a person with no locale → `locale: null`.
  - `till-api.test.ts`: extend the login test (~line 228-260) — a seeded person with `locale = 'en-GB'`, expect the response to include `locale: "en-GB"`; a no-preference person → `locale: null`.

- [ ] **Step 2: Run them, watch them fail** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test -- session/me till/session` (or run each suite). Expected: FAIL (missing `locale`/`venueLocale`).

- [ ] **Step 3: Implement.**
  - `me-api.ts` (~line 94-100): `const { personId, role, locale } = await asStaff((tx) => resolveManagementSession(tx, sessionId)); return c.json({ personId, role, locale, venueLocale: deps.venueLocale });`
  - `till-api.ts` (~line 361-383): `loginWithPin` returns `session.locale`; change the response to `return c.json({ personId: session.personId, canConfigureTill, locale: session.locale });`

- [ ] **Step 4: Run both suites (coverage), watch them pass** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/till-api.ts apps/server/src/me-api.ts \
        apps/server/src/till-api.test.ts apps/server/src/me-api.test.ts
git commit -s -m "feat(server): return the logged-in person's locale on their session"
```

---

## Task 6: Write routes to set your own locale (`apps/server`)

**Files:**
- Modify: `apps/server/src/till-api.ts` (`PUT /api/session/locale`, `STATUS` gains `locale.unsupported`)
- Modify: `apps/server/src/me-api.ts` (`PUT /management-api/session/me/locale`, `STATUS` gains `locale.unsupported`)
- Modify: `apps/server/src/till-api.test.ts`, `apps/server/src/me-api.test.ts`

**Interfaces:**
- Consumes: `setPersonLocale(tx, { tenantId, personId, locale })` from `@waitron/identity` (Task 3); `requireSession` (till), `requireManagementSession`+`resolveManagementSession` (me).
- Produces: `PUT /api/session/locale` and `PUT /management-api/session/me/locale`, body `{ locale: string }`, 204 on success, `locale.unsupported` (400) on a non-supported value. Identity always comes from the session; the body carries only `locale`.

- [ ] **Step 1: Write the failing tests.**
  - `till-api.test.ts`: with a live shift-session cookie, `PUT /api/session/locale` body `{locale:"en-GB"}` → 204, and the person's row now has `locale="en-GB"`; body `{locale:"ca-ES"}` → 400 with `{ error: { code: "locale.unsupported" } }`; no cookie → 401 (`session.required`).
  - `me-api.test.ts`: with a management-session cookie, `PUT /management-api/session/me/locale` body `{locale:"en-GB"}` → 204 and row updated; a body `personId` naming ANOTHER person is IGNORED (the session's own row changes, the other's does not); `{locale:"ca-ES"}` → 400 `locale.unsupported`.

- [ ] **Step 2: Run them, watch them fail** — Expected: FAIL (routes 404 / missing).

- [ ] **Step 3: Implement the till route** (`till-api.ts`) — add to `STATUS` `"locale.unsupported": 400,` and the route:

```ts
app.put("/api/session/locale", (c) =>
  run(c, log, async () => {
    const { personId } = await requireSession(deps, c);
    const body = (await c.req.json<{ locale?: unknown }>()) ?? {};
    const locale = typeof body.locale === "string" ? body.locale : "";
    await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await setPersonLocale(tx, { tenantId: deps.cfg.tenantId, personId, locale });
    });
    return c.body(null, 204);
  }),
);
```
Import `setPersonLocale` from `@waitron/identity`. (A missing/non-string body → `""` → `setPersonLocale` throws `locale.unsupported`, so that is the one rejection code.)

- [ ] **Step 4: Implement the me route** (`me-api.ts`) — add `"locale.unsupported": 400,` to `STATUS` and:

```ts
app.put("/management-api/session/me/locale", (c) =>
  run(c, log, async () => {
    const sessionId = requireManagementSession(c);
    const body = (await c.req.json<{ locale?: unknown }>()) ?? {};
    const locale = typeof body.locale === "string" ? body.locale : "";
    await asStaff(async (tx) => {
      const { personId } = await resolveManagementSession(tx, sessionId);
      await setPersonLocale(tx, { tenantId: deps.cfg.tenantId, personId, locale });
    });
    return c.body(null, 204);
  }),
);
```
Import `setPersonLocale` from `@waitron/identity` (`resolveManagementSession` is already imported).

- [ ] **Step 5: Run both suites (coverage), watch them pass** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage`. Expected: PASS.

- [ ] **Step 6: Prove the session-identity guard by deletion.** In the me route, temporarily read `personId` from `body.personId` instead of the session; confirm the "another person's id is ignored" test FAILS; restore.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/till-api.ts apps/server/src/me-api.ts \
        apps/server/src/till-api.test.ts apps/server/src/me-api.test.ts
git commit -s -m "feat(server): PUT routes to set your own UI locale"
```

---

## Task 7: Live-switch mechanism — `setLocale` notify + `LocaleChangeController` + `en-GB` catalogue (both apps)

`t.ts` is byte-for-byte identical between the two apps (only comments differ); apply the executable change to BOTH. The `scripts/allergen-names-drift.test.ts` guard keeps the i18n copies aligned — keep them in lockstep.

**Files:**
- Modify: `apps/till/src/i18n/t.ts` and `apps/dashboard/src/i18n/t.ts` (add `subscribeLocale`; `setLocale` notifies)
- Modify: `apps/till/src/i18n/strings.ts` and `apps/dashboard/src/i18n/strings.ts` (add `"en-GB": en` to `catalogues`)
- Create: `apps/till/src/state/locale-controller.ts` and `apps/dashboard/src/state/locale-controller.ts`
- Modify: `apps/till/src/i18n/t.test.ts` and `apps/dashboard/src/i18n/t.test.ts`
- Create: `apps/till/src/state/locale-controller.test.ts` and `apps/dashboard/src/state/locale-controller.test.ts`

**Interfaces:**
- Produces (in each app): `subscribeLocale(listener: () => void): () => void`; `setLocale` now notifies; `class LocaleChangeController` (constructor `(host: ReactiveControllerHost, handler?: () => void)`, default handler `() => host.requestUpdate()`).

- [ ] **Step 1: Write the failing i18n test.** Add to `apps/till/src/i18n/t.test.ts` (keep the existing `afterEach(() => setLocale("es-ES"))` reset):

```ts
it("notifies subscribers on setLocale and stops after unsubscribe", () => {
  let calls = 0;
  const off = subscribeLocale(() => { calls += 1; });
  setLocale("en-GB");
  expect(calls).toBe(1);
  off();
  setLocale("es-ES");
  expect(calls).toBe(1);
});

it("resolves en-GB directly from its own catalogue entry", () => {
  // after adding "en-GB": en, an explicit en-GB request hits the catalogue, not just the fallback
  expect(t("action.logout", "en-GB")).toBe(t("action.logout", "en"));
});
```
Add the same to the dashboard's `t.test.ts` (pick a `StringKey` that exists in the dashboard catalogue).

- [ ] **Step 2: Run, watch fail** — `pnpm --filter @waitron/till test i18n/t` (browser). Expected: FAIL (`subscribeLocale` undefined).

- [ ] **Step 3: Implement `setLocale` notify** — in BOTH `t.ts` files, replace the `setLocale` body and add the emitter (identical text):

```ts
type LocaleListener = () => void;
const localeListeners = new Set<LocaleListener>();

/** Subscribe to locale changes; returns a disposer. Mirrors the working-order
 * store's pub/sub so a LocaleChangeController can requestUpdate() on a live
 * switch (setLocale is module-global; a switch must repaint the tree). */
export function subscribeLocale(listener: LocaleListener): () => void {
  localeListeners.add(listener);
  return () => localeListeners.delete(listener);
}

export function setLocale(l: string): void {
  locale = l;
  for (const listener of localeListeners) listener();
}
```
And add `"en-GB": en,` to the `catalogues` object in BOTH `strings.ts` files (alongside `en`, `es`, `"es-ES": es`).

- [ ] **Step 4: Write the failing controller test** `apps/till/src/state/locale-controller.test.ts` — mount a trivial Lit host that renders `t(...)`, attach the controller, switch the locale, assert it repainted. Use `mountWidget`/`cleanupWidgets` (see `apps/till/src/widgets/total.test.ts`). A minimal host defined in-test:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { LocaleChangeController } from "./locale-controller.js";

@customElement("locale-probe")
class LocaleProbe extends LitElement {
  constructor() { super(); new LocaleChangeController(this); }
  render() { return html`<span>${t("action.logout")}</span>`; }
}

afterEach(() => { cleanupWidgets(); setLocale("es-ES"); });

describe("LocaleChangeController", () => {
  it("repaints the host when the locale changes", async () => {
    const { el } = await mountWidget<LocaleProbe>("locale-probe", {});
    expect(el.shadowRoot!.textContent).toContain(t("action.logout", "es-ES"));
    setLocale("en-GB");
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain(t("action.logout", "en-GB"));
  });
});
```
Mirror it in `apps/dashboard/src/state/locale-controller.test.ts`.

- [ ] **Step 5: Run, watch fail** — Expected: FAIL (`locale-controller.js` missing).

- [ ] **Step 6: Implement the controller** in BOTH apps (`apps/<app>/src/state/locale-controller.ts`, identical):

```ts
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { subscribeLocale } from "../i18n/t.js";

/** Re-renders its host on a live locale switch — the i18n twin of
 * StoreChangeController. Add `new LocaleChangeController(this)` in a component
 * that renders translated text and must repaint when the language changes. */
export class LocaleChangeController implements ReactiveController {
  readonly #host: ReactiveControllerHost;
  readonly #handler: () => void;
  #dispose?: () => void;

  constructor(host: ReactiveControllerHost, handler?: () => void) {
    this.#host = host;
    this.#handler = handler ?? (() => this.#host.requestUpdate());
    host.addController(this);
  }

  hostConnected(): void {
    this.#dispose = subscribeLocale(this.#handler);
  }

  hostDisconnected(): void {
    this.#dispose?.();
    this.#dispose = undefined;
  }
}
```
(`apps/dashboard/src/state/` is a new directory — the dashboard has no `state/` today.)

- [ ] **Step 7: Run both apps' suites (coverage), watch pass** — `pnpm --filter @waitron/till test:coverage` and `pnpm --filter @waitron/dashboard test:coverage`. Expected: PASS.

- [ ] **Step 8: Prove the notify by deletion.** Temporarily make `setLocale` not call the listeners; confirm the controller test FAILS; restore.

- [ ] **Step 9: Commit**

```bash
git add apps/till/src/i18n apps/dashboard/src/i18n \
        apps/till/src/state/locale-controller.ts apps/dashboard/src/state/locale-controller.ts \
        apps/till/src/state/locale-controller.test.ts apps/dashboard/src/state/locale-controller.test.ts
git commit -s -m "feat(ui): setLocale notify + LocaleChangeController + en-GB catalogue"
```

---

## Task 8: The chooser widget + `getLocales` client method (both apps)

A collapsed link that shows the current language and, on click, fetches the list and shows a menu; picking emits `locale-selected`. Presentational: it calls neither `setLocale` nor the write API.

**Files:**
- Create: `apps/till/src/widgets/language-chooser.ts` + `.test.ts`
- Create: `apps/dashboard/src/widgets/language-chooser.ts` + `.test.ts`
- Modify: `apps/till/src/api/client.ts` (add `getLocales`) + `apps/dashboard/src/api/client.ts` (add `getLocales`)
- Modify: the client tests for each app

**Interfaces:**
- Consumes: `currentLocale` + `LocaleChangeController` (Task 7); `SUPPORTED_LOCALES` shape.
- Produces (each app):
  - Client `getLocales(): Promise<{ locales: Array<{ code: string; label: string }>; venueDefault: string }>`
  - `<{till,dashboard}-language-chooser>` element with `@property loadLocales: () => Promise<Array<{ code: string; label: string }>>`; emits `CustomEvent<{ code: string }>("locale-selected", { bubbles: true, composed: true })`.

- [ ] **Step 1: Write the failing client test.** In the till client test (mirror the file's existing style — a stubbed `fetch` returning JSON), assert `getLocales()` GETs `/api/locales` and returns the parsed body. Dashboard: same against `/management-api/locales`.

- [ ] **Step 2: Implement `getLocales`.**
  - `apps/till/src/api/client.ts`: `getLocales(): Promise<{ locales: Array<{ code: string; label: string }>; venueDefault: string }> { return this.#request("/api/locales", "GET"); }`
  - `apps/dashboard/src/api/client.ts`: same body, path `/management-api/locales`.

- [ ] **Step 3: Write the failing widget test** `apps/till/src/widgets/language-chooser.test.ts`. Mount with a stub `loadLocales`; assert (a) collapsed it shows the current language and did NOT call `loadLocales`; (b) after activating the trigger it calls `loadLocales` and renders both options; (c) picking an option dispatches `locale-selected` with the code; (d) it does NOT call `setLocale` itself.

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { LanguageChooser } from "./language-chooser.js";

afterEach(() => { cleanupWidgets(); setLocale("es-ES"); });

describe("till-language-chooser", () => {
  it("is collapsed and lazy — no fetch until opened", async () => {
    const loadLocales = vi.fn(async () => [
      { code: "es-ES", label: "Español" }, { code: "en-GB", label: "English" },
    ]);
    const { el } = await mountWidget<LanguageChooser>("till-language-chooser", { loadLocales });
    expect(loadLocales).not.toHaveBeenCalled();
    // ...activate the trigger (click the button in el.shadowRoot), await updateComplete...
    expect(loadLocales).toHaveBeenCalledTimes(1);
    // ...assert both labels present...
  });

  it("emits locale-selected and does not call setLocale itself", async () => {
    const before = currentLocale();
    const { el } = await mountWidget<LanguageChooser>("till-language-chooser", {
      loadLocales: async () => [{ code: "en-GB", label: "English" }],
    });
    const selected = new Promise<string>((res) =>
      el.addEventListener("locale-selected", (e) => res((e as CustomEvent<{ code: string }>).detail.code)),
    );
    // ...open, click the en-GB option...
    expect(await selected).toBe("en-GB");
    expect(currentLocale()).toBe(before); // widget must NOT setLocale
  });
});
```
Mirror in `apps/dashboard/src/widgets/language-chooser.test.ts` (tag `dashboard-language-chooser`).

- [ ] **Step 4: Run, watch fail** — Expected: FAIL (widget missing).

- [ ] **Step 5: Implement the widget** (each app; use that app's `wt-button`/`wt-icon` primitives and `t`/`currentLocale`/`LocaleChangeController`). Sketch (till; dashboard identical but its tag + imports):

```ts
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { currentLocale } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import "@waitron/ui"; // wt-button etc.

@customElement("till-language-chooser")
export class LanguageChooser extends LitElement {
  @property({ attribute: false }) loadLocales!: () => Promise<Array<{ code: string; label: string }>>;
  @state() private open = false;
  @state() private locales?: Array<{ code: string; label: string }>;

  constructor() { super(); new LocaleChangeController(this); } // reflect the active language live

  async #toggle() {
    if (!this.open && this.locales === undefined) this.locales = await this.loadLocales(); // fetch once, cache
    this.open = !this.open;
  }
  #pick(code: string) {
    this.open = false;
    this.dispatchEvent(new CustomEvent("locale-selected", { detail: { code }, bubbles: true, composed: true }));
  }
  #label(code: string) { return this.locales?.find((l) => l.code === code)?.label ?? code; }

  render() {
    const active = currentLocale();
    return html`
      <wt-button variant="secondary" data-test="lang-trigger" @click=${() => void this.#toggle()}>
        ${this.#label(active)}
      </wt-button>
      ${this.open && this.locales
        ? html`<ul class="menu" role="menu">
            ${this.locales.map((l) => html`
              <li><wt-button variant="ghost" role="menuitemradio"
                    aria-checked=${l.code === active} data-test=${`lang-${l.code}`}
                    @click=${() => this.#pick(l.code)}>${l.label}</wt-button></li>`)}
          </ul>`
        : nothing}
    `;
  }
}
```
Add a `static styles` block using the app's design tokens (mirror a sibling widget). Register the element (the `@customElement` decorator does this).

- [ ] **Step 6: Run both apps' suites (coverage), watch pass** — `pnpm --filter @waitron/till test:coverage` and `pnpm --filter @waitron/dashboard test:coverage`. Expected: PASS. (Watch the 90/88 function/branch thresholds — cover the closed and open states and the pick path.)

- [ ] **Step 7: Commit**

```bash
git add apps/till/src/widgets/language-chooser.ts apps/till/src/widgets/language-chooser.test.ts \
        apps/dashboard/src/widgets/language-chooser.ts apps/dashboard/src/widgets/language-chooser.test.ts \
        apps/till/src/api/client.ts apps/dashboard/src/api/client.ts \
        apps/till/src/api/client.test.ts apps/dashboard/src/api/client.test.ts
git commit -s -m "feat(ui): language-chooser widget + getLocales client method"
```

---

## Task 9: Till wiring — apply/persist/switch (`apps/till`)

Central rule: `till-app` owns the locale lifecycle and a single `locale-selected` handler that persists ONLY when logged in. The chooser widget just emits (bubbling); `till-app` decides.

**Files:**
- Modify: `apps/till/src/api/client.ts` (`SessionResult` gains `locale`; add `putLocale`)
- Modify: `apps/till/src/screens/till-lock-screen.ts` (chooser; thread `locale` into the `logged-in` event)
- Modify: `apps/till/src/till-app.ts` (lifecycle + `keyed` + handler)
- Modify: `apps/till/src/screens/till-counter-screen.ts` (chooser in the `.session` row)
- Modify: their `.test.ts` siblings

**Interfaces:**
- Consumes: `getLocales` (Task 8), `resolveActiveLocale` (Task 1), `setLocale`/`currentLocale`/`LocaleChangeController` (Task 7). `GET /api/till`'s `locale` is the venue default (Task 4). `POST /api/session` returns `locale` (Task 5).
- Produces: `TillApi.putLocale(code: string): Promise<void>` → `PUT /api/session/locale`; `SessionResult.locale: string | null`; `LoggedInDetail.locale: string | null`.

- [ ] **Step 1: Client — failing test then implement.** Test: `putLocale("en-GB")` PUTs `/api/session/locale` with body `{locale:"en-GB"}`; `SessionResult` from `login` includes `locale`. Implement in `apps/till/src/api/client.ts`: add `locale: string | null` to the `SessionResult` interface (~line 106); add `putLocale(code: string): Promise<void> { return this.#request("/api/session/locale", "PUT", { locale: code }); }`.

- [ ] **Step 2: Lock screen — thread locale + add the transient chooser.** In `till-lock-screen.ts`: add `locale: string | null` to `LoggedInDetail` (~line 17) and include `locale: result.locale` in the `logged-in` `detail` (~line 193, where `api.login` resolves). In `#renderList()` (~line 211), render the chooser near the `.device-setup` block:

```ts
<till-language-chooser
  .loadLocales=${() => this.api.getLocales().then((r) => r.locales)}
></till-language-chooser>
```
Import the widget (`import "../widgets/language-chooser.js";`). The chooser's `locale-selected` bubbles to `till-app`; the lock screen does NOT handle it.

- [ ] **Step 3: till-app — lifecycle + keyed + handler.** In `apps/till/src/till-app.ts`:
  - Imports: add `currentLocale`, `subscribeLocale` not needed (use the controller); `import { LocaleChangeController } from "./state/locale-controller.js";`; `import { resolveActiveLocale } from "@waitron/shared";`; `import { keyed } from "lit/directives/keyed.js";`. (`setLocale`, `t` already imported.)
  - Add `@state() private uiLocale = currentLocale();` and `#venueLocale = "es-ES";`
  - In the constructor: `new LocaleChangeController(this, () => { this.uiLocale = currentLocale(); });`
  - `#boot` (~line 403): keep `setLocale(till.locale)`; add `this.#venueLocale = till.locale;` (the derived venue default). Leave `this.invoiceLocale = till.locale` as is.
  - `#onLoggedIn` (~line 446): after reading the detail, `setLocale(resolveActiveLocale(event.detail.locale, this.#venueLocale));`
  - `#onLogout` (~line 1157): after logout, `setLocale(this.#venueLocale);`
  - Add the handler:

```ts
async #onLocaleSelected(event: CustomEvent<{ code: string }>): Promise<void> {
  const { code } = event.detail;
  if (this.screen === "lock") { setLocale(code); return; }      // pre-login: transient
  try { await this.api.putLocale(code); setLocale(code); }       // logged-in: persist, then switch
  catch { this.errorKey = "locale.save_failed"; }                // add this StringKey to both catalogues
}
```
  - `render()` (~line 1188): add `@locale-selected=${(e: CustomEvent<{ code: string }>) => void this.#onLocaleSelected(e)}` to the root `<div class="app">`; wrap the screen output in `keyed(this.uiLocale, this.#renderScreen())` and the lock screen in `keyed(this.uiLocale, html\`<till-lock-screen .api=${this.api}></till-lock-screen>\`)` so a switch recreates the subtree.
  - Add a `login.locale.save_failed`-style `StringKey` (`"locale.save_failed"`) to BOTH `strings.ts` catalogues (`en` + `es`), keeping the drift guard happy.

- [ ] **Step 4: Counter screen — post-login chooser.** In `till-counter-screen.ts`, add the chooser to the `.session` row (~line 263-283, beside the logout `wt-button`):

```ts
<till-language-chooser
  .loadLocales=${() => this.api.getLocales().then((r) => r.locales)}
></till-language-chooser>
```
Import the widget. Confirm the counter screen has an `api` property; if not, thread `.api=${this.api}` from `till-app`'s `#renderScreen()`. Its `locale-selected` bubbles to `till-app` (Step 3), which persists.

- [ ] **Step 5: Tests.** Extend `till-app.test.ts` (stub `api`: `getTill` → `{ locale: "es-ES", ... }`, `login` → `{ personId, canConfigureTill, locale: "en-GB" }`, `getLocales`, `putLocale` a spy):
  - after boot, `currentLocale()` is the venue default; after a `logged-in` carrying `locale:"en-GB"`, the UI is English (assert a deep child's text via `keyed` recreation);
  - after logout, `currentLocale()` returns to the venue default;
  - a `locale-selected` while on `lock` calls `setLocale` but NOT `putLocale`; while logged in, calls `putLocale` then `setLocale`; a rejected `putLocale` leaves the language unchanged and sets the error key.
  Add lock-screen and counter-screen tests asserting the chooser renders and its `locale-selected` bubbles. Reset `setLocale("es-ES")` in `afterEach`.

- [ ] **Step 6: Run the till suite (coverage), watch pass** — `pnpm --filter @waitron/till test:coverage`. Expected: PASS.

- [ ] **Step 7: Prove the persist-gate by deletion.** Temporarily drop the `this.screen === "lock"` guard so it always `putLocale`s; confirm the "transient while on lock" test FAILS; restore.

- [ ] **Step 8: Commit**

```bash
git add apps/till/src
git commit -s -m "feat(till): per-user locale — apply on login, revert on logout, switch + persist"
```

---

## Task 10: Dashboard wiring — seed/apply/persist/switch (`apps/dashboard`)

Mirrors Task 9. The dashboard additionally SEEDS the venue default at boot (it has no venue locale until now) so the login screen is in the venue's language. Also add the `@waitron/shared` dependency (the dashboard does not depend on it today).

**Files:**
- Modify: `apps/dashboard/package.json` (add `"@waitron/shared": "workspace:*"`), then `pnpm install` and commit the lockfile
- Modify: `apps/dashboard/src/api/client.ts` (`getMe` gains `locale` + `venueLocale`; add `putLocale`)
- Modify: `apps/dashboard/src/dashboard-app.ts` (seed + apply + `keyed` + handler + header chooser)
- Modify: `apps/dashboard/src/screens/login-screen.ts` (transient chooser)
- Modify: their `.test.ts` siblings

**Interfaces:**
- Consumes: `getLocales` (Task 8), `resolveActiveLocale` (Task 1), `setLocale`/`currentLocale`/`LocaleChangeController` (Task 7). `GET /management-api/session/me` returns `locale` + `venueLocale` (Task 5).
- Produces: `DashboardApi.getMe(): Promise<{ personId; role: PersonRole; locale: string | null; venueLocale: string }>`; `DashboardApi.putLocale(code: string): Promise<void>` → `PUT /management-api/session/me/locale`.

- [ ] **Step 1: Add the shared dependency.** Add `"@waitron/shared": "workspace:*"` to `apps/dashboard/package.json` dependencies; run `pnpm install`; commit `pnpm-lock.yaml`. (Confirm `pnpm --filter @waitron/dashboard typecheck` still passes.)

- [ ] **Step 2: Client — failing test then implement.** Test: `getMe()` returns `locale` + `venueLocale`; `putLocale("en-GB")` PUTs `/management-api/session/me/locale` body `{locale:"en-GB"}`. Implement: widen the `getMe` return type (~line 1253) to `{ personId: string; role: PersonRole; locale: string | null; venueLocale: string }`; add `putLocale(code: string): Promise<void> { return this.#request("/management-api/session/me/locale", "PUT", { locale: code }); }`.

- [ ] **Step 3: dashboard-app — seed + apply + keyed + handler.** In `apps/dashboard/src/dashboard-app.ts`:
  - Imports: `setLocale`, `currentLocale` (add `setLocale`, `currentLocale` to the existing `t` import); `import { LocaleChangeController } from "./state/locale-controller.js";`; `import { resolveActiveLocale } from "@waitron/shared";`; `import { keyed } from "lit/directives/keyed.js";`; `import "./widgets/language-chooser.js";`.
  - Add `@state() private uiLocale = currentLocale();` and `#venueLocale = "es-ES";`
  - Constructor: `new LocaleChangeController(this, () => { this.uiLocale = currentLocale(); });`
  - `firstUpdated` (~line 145): add `void this.#seedLocale();` alongside `void this.#probeSession();`, and:

```ts
async #seedLocale(): Promise<void> {
  try {
    const { venueDefault } = await this.api.getLocales();
    this.#venueLocale = venueDefault;
    setLocale(venueDefault);                       // pre-auth: login screen in the venue's language
  } catch { /* stay on the module default */ }
}
```
  - `#applyMe` (~line 170): add `this.#venueLocale = me.venueLocale; setLocale(resolveActiveLocale(me.locale, me.venueLocale));`
  - Add the handler (same shape as till):

```ts
async #onLocaleSelected(event: CustomEvent<{ code: string }>): Promise<void> {
  const { code } = event.detail;
  if (this.screen === "login") { setLocale(code); return; }
  try { await this.api.putLocale(code); setLocale(code); } catch { /* leave language unchanged */ }
}
```
  - `render()` (~line 202): add `@locale-selected=${(e: CustomEvent<{ code: string }>) => void this.#onLocaleSelected(e)}` to the outermost element; wrap `this.#renderScreen()` in `keyed(this.uiLocale, this.#renderScreen())`. In the logged-in `<header class="chrome">` (~line 212), add the chooser beside the logout button:

```ts
<dashboard-language-chooser
  .loadLocales=${() => this.api.getLocales().then((r) => r.locales)}
></dashboard-language-chooser>
```

- [ ] **Step 4: Login screen — transient chooser.** In `login-screen.ts` `render()` (~line 170, before the roster label), add:

```ts
<dashboard-language-chooser
  .loadLocales=${() => this.api.getLocales().then((r) => r.locales)}
></dashboard-language-chooser>
```
Import the widget. Its `locale-selected` bubbles to `dashboard-app` (Step 3), which switches transiently while on `login`.

- [ ] **Step 5: Tests.** Extend `dashboard-app.test.ts` (stub `api`: `getLocales` → `{ locales, venueDefault: "es-ES" }`, `getMe` → `{ personId, role:"staff", locale:"en-GB", venueLocale:"es-ES" }`, `putLocale` a spy):
  - on boot the login screen is seeded to the venue default;
  - after the probe resolves, `#applyMe` switches to the person's `en-GB` (assert a deep child via `keyed`);
  - `locale-selected` while on `login` calls `setLocale` not `putLocale`; while logged in, `putLocale` then `setLocale`.
  Add a `login-screen.test.ts` case: the chooser renders and its `locale-selected` bubbles. Reset `setLocale("es-ES")` in `afterEach`.

- [ ] **Step 6: Run the dashboard suite (coverage), watch pass** — `pnpm --filter @waitron/dashboard test:coverage`. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard
git commit -s -m "feat(dashboard): per-user locale — seed venue default, apply on login, switch + persist"
```

---

## Final verification (before opening the PR)

- [ ] **Whole-workspace gate:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, then per-package `test:coverage` for every package touched (`shared`, `identity`, `server`, `till`, `dashboard`) with `TESTCONTAINERS_RYUK_DISABLED=true`.
- [ ] **`pnpm install` clean + lockfile committed** (the dashboard gained `@waitron/shared`).
- [ ] **Guards that live elsewhere:** run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` is NOT needed (no new `tenant_id` table), but DO run the whole `packages/identity` suite unfiltered (the migration changed the shared template) and the root guards (`pnpm vitest run --coverage` for `scripts/**`).
- [ ] **Manual smoke:** `WAITRON_TILL_LOCALE=` unset → till + dashboard default to Spanish (country ES); set `WAITRON_TILL_LOCALE=en-GB` → both default to English; log in as a person with `locale='en-GB'` at a Spanish venue → their UI is English while a printed receipt stays Spanish (`invoiceLocale`); switch language from the login screen → transient; switch post-login → persists across logout/login.
- [ ] **Finish the branch** with the `finish-branch` skill (simplify + two-reviewer phase), per the repo workflow.

## Self-review notes (spec coverage)

| Spec section | Task(s) |
| --- | --- |
| `persons.locale` column, RLS-safe | 2 |
| `SUPPORTED_LOCALES` / resolvers / `locale.unsupported` | 1 |
| Venue default `province → country → English`, always supported | 1 (resolver), 4 (server wiring) |
| Receipt/`invoiceLocale` untouched | 4 (leaves `cfg.locale`/`invoiceLocales`), verified in Task 5/9 receipt-locale reasoning |
| `setPersonLocale` verb, session-scoped, role-blind | 3 (verb), 6 (routes) |
| `session/me` + login response carry `locale`; `venueLocale` exposed | 5, 4 |
| Public `GET …/locales` returning `{ locales, venueDefault }` | 4 |
| `PUT …/locale` write routes, identity from session | 6 |
| Live re-render (`setLocale` notify + controller + `keyed`) | 7, 9, 10 |
| Chooser widget: collapsed link, fetch-on-open, emits only | 8 |
| Login-screen choosers (transient), superseded on login | 9 (till), 10 (dashboard) |
| Post-login switchers (persist) | 9, 10 |
| `en-GB` catalogue key | 7 |
| Dashboard depends on `@waitron/shared` | 10 |



