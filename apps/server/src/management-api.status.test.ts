import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { mountManagementApi } from "./management-api.js";
import { ALL_MODULES } from "./modules.js";

/**
 * The `/management-api/service-statuses` surface end to end: create, list, edit, deactivate, the
 * body screens, and both gates (a staff session 403, no session 401).
 *
 * ## What went with PostgreSQL
 *
 * The file's stated reason was `SET ROLE app_user` — every query ran as the non-owner deployment
 * role so that a missing GRANT showed up. SQLite has no roles and no grants; `asAppUser` is an
 * inert function (`packages/db/src/testing/roles.ts`) and every call below runs on the one
 * connection. Nothing here now says anything about which identity the routes reach the database
 * as. The 403 and 401 gates are unaffected: both are `authorizeManager` and
 * `requireManagementSession`, never a privilege, and both cases still pass.
 *
 * **Two deletion receipts written into the cases below are retired by the column types, and are
 * flagged where they sit** (the int4-range screen at `parseDisplayOrder`, and the `isUuid` screen
 * on `:id`). Measured 2026-09-22 on Node v26.7.0 against `node:sqlite` directly, over the columns
 * `packages/db/drizzle/0000_baseline.sql:516-523` now declares for this table — `id` text primary
 * key, `display_order` integer: the out-of-int4-range insert is ACCEPTED and stores 2147483648, and
 * `where id = 'not-a-uuid'` returns zero rows rather than raising. Neither case can any longer
 * tell its screen from the absence of it; both still pin the response.
 */
const LOCALE = "es-ES";
const PASSWORD = "correct horse"; // ≥ MIN_PASSWORD_LENGTH; the manager's & staff's seeded password.
// Dashboard sign-in resolves the person by EMAIL, so each seeded person carries a login email
// (unique on `lower(email)` across the database — persons_tenant_email_uq).
const MANAGER_EMAIL = "manager@x.com";
const STAFF_EMAIL = "clerk@x.com";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});

/** A no-op logger: only the HTTP responses and the database state matter here. */
const noopLog: Logger = () => {};

// One NIF per provisioned venue. Kept as a counter rather than a constant because `setupTenant` is
// exported and a second caller inside this database would need a second NIF.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(72_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** A label unique within the tenant, so tests are order-independent (CLAUDE.md §4) — `resetPerTest`
 *  is off, so the status set accumulates across tests and a fixed label would collide. */
function uniqueLabel(base: string): string {
  return `${base}-${randomUUID().slice(0, 8)}`;
}

/** Provision a venue as owner and seed the people and sessions this route fixture needs. */
export async function setupTenant(): Promise<{ managerId: string; staffId: string }> {
  await applyVenue(
    planVenue(
      {
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
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );

  // Seeded through the table definition, not by raw SQL: `persons.id` and `persons.created_at` are
  // `$defaultFn` generators on this engine, which a raw insert never reaches while the columns are
  // NOT NULL (`apps/server/src/testing/fiscal-fixtures.ts` took the same change).
  const { managerId, staffId } = await withTransaction(suite.db, async (tx) => {
    const seed = async (displayName: string, email: string, role: "manager" | "staff") => {
      const [person] = await tx
        .insert(persons)
        .values({
          displayName,
          email,
          pinHash: hashPin("1234"),
          passwordHash: hashPassword(PASSWORD),
          role,
        })
        .returning({ id: persons.id });
      return person!.id;
    };
    return {
      managerId: await seed("The Manager", MANAGER_EMAIL, "manager"),
      staffId: await seed("The Clerk", STAFF_EMAIL, "staff"),
    };
  });
  return { managerId, staffId };
}

function mountApp(): Hono {
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.db,
      // The all-zero node id (the capture default): this suite exercises the staff-status routes, not
      // origin attribution, so the sentinel keeps its enrolled writes' origin exactly as before Task 6.
      cfg: { nodeId: "00000000-0000-0000-0000-000000000000" },
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
    },
    noopLog,
  );
  return app;
}

/** Log in over HTTP by `email`, returning just the `waitron_management_session=…` cookie pair. */
async function login(app: Hono, email: string): Promise<string> {
  const res = await app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

// One provisioned tenant + a manager and a staff cookie, shared across the tests. Each test uses a
// UNIQUE label so the accumulating status set never collides (CLAUDE.md §4) and every list assertion is
// a membership check, never an exact-list one.
let app: Hono;
let managerCookie: string;
let staffCookie: string;
const json = { "content-type": "application/json" };

beforeAll(async () => {
  await setupTenant();
  app = mountApp();
  managerCookie = await login(app, MANAGER_EMAIL);
  staffCookie = await login(app, STAFF_EMAIL);
});

/** POST/GET/PATCH/DELETE a `/management-api/service-statuses[...]` path with the given cookie. */
async function request(path: string, init: RequestInit, cookie?: string): Promise<Response> {
  return app.request(`/management-api/service-statuses${path}`, {
    ...init,
    headers: { ...json, ...(cookie ? { cookie } : {}), ...init.headers },
  });
}

describe("/management-api/service-statuses", () => {
  it("POST creates (201 { id }) + GET lists it (manager)", async () => {
    const label = uniqueLabel("Bill requested");
    const create = await request(
      "",
      { method: "POST", body: JSON.stringify({ label, color: "#ef4444", displayOrder: 0 }) },
      managerCookie,
    );
    // 201 Created, matching every other management-surface create (createPerson/staff, catalogues).
    expect(create.status).toBe(201);
    const { id } = (await create.json()) as { id: string };
    expect(id).toBeDefined();

    const list = (await (await request("", { method: "GET" }, managerCookie)).json()) as {
      id: string;
      label: string;
      active: boolean;
    }[];
    expect(list.find((s) => s.id === id)).toMatchObject({ label, active: true });
  });

  it("POST without displayOrder defaults it to 0", async () => {
    const label = uniqueLabel("Needs cleaning");
    const create = await request(
      "",
      { method: "POST", body: JSON.stringify({ label, color: "amber-500" }) },
      managerCookie,
    );
    expect(create.status).toBe(201);
    const { id } = (await create.json()) as { id: string };
    const list = (await (await request("", { method: "GET" }, managerCookie)).json()) as {
      id: string;
      displayOrder: number;
    }[];
    expect(list.find((s) => s.id === id)).toMatchObject({ displayOrder: 0 });
  });

  it("POST with a duplicate label → 409 status.label_taken", async () => {
    const label = uniqueLabel("Reserved");
    await request(
      "",
      { method: "POST", body: JSON.stringify({ label, color: "#3b82f6" }) },
      managerCookie,
    );
    const dup = await request(
      "",
      { method: "POST", body: JSON.stringify({ label, color: "#000" }) },
      managerCookie,
    );
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: { code: "status.label_taken" } });
  });

  it("POST with a bad color → 400 management.request_invalid (naming the field)", async () => {
    const res = await request(
      "",
      {
        method: "POST",
        body: JSON.stringify({ label: uniqueLabel("Bad"), color: "red; drop table x" }),
      },
      managerCookie,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "color" } },
    });
  });

  it("POST body screens: a null body, a missing/non-string label/color, a non-integer OR non-number displayOrder → 400", async () => {
    // null body → coerced to {} then the label screen fires (field "body" only fires for a non-object
    // truthy body such as an array).
    const nullBody = await request("", { method: "POST", body: "null" }, managerCookie);
    expect(nullBody.status).toBe(400);
    expect(await nullBody.json()).toMatchObject({ error: { code: "management.request_invalid" } });

    // A JSON array is a non-object body → field "body".
    const arrayBody = await request("", { method: "POST", body: "[]" }, managerCookie);
    expect(arrayBody.status).toBe(400);
    expect(await arrayBody.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });

    const missingLabel = await request(
      "",
      { method: "POST", body: JSON.stringify({ color: "#000" }) },
      managerCookie,
    );
    expect(missingLabel.status).toBe(400);
    expect(await missingLabel.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "label" } },
    });

    const noColor = await request(
      "",
      { method: "POST", body: JSON.stringify({ label: uniqueLabel("X") }) },
      managerCookie,
    );
    expect(noColor.status).toBe(400);
    expect(await noColor.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "color" } },
    });

    const badOrder = await request(
      "",
      {
        method: "POST",
        body: JSON.stringify({ label: uniqueLabel("Y"), color: "#000", displayOrder: 1.5 }),
      },
      managerCookie,
    );
    expect(badOrder.status).toBe(400);
    expect(await badOrder.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "displayOrder" } },
    });

    // A NON-NUMBER displayOrder (here `null`) is rejected, not coerced: a bare `Number(null)` is 0, so
    // the pre-fix `Number` + `Number.isInteger` check silently accepted it (→ displayOrder 0). The
    // typeof-first screen refuses it — the prove-by-behaviour for the `parseDisplayOrder` type check.
    const nullOrder = await request(
      "",
      {
        method: "POST",
        body: JSON.stringify({ label: uniqueLabel("Z"), color: "#000", displayOrder: null }),
      },
      managerCookie,
    );
    expect(nullOrder.status).toBe(400);
    expect(await nullOrder.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "displayOrder" } },
    });

    // An integer OUTSIDE int4 range is refused with a clean 400 by `parseDisplayOrder`'s range bound.
    // The receipt that bound was written against is gone: it rested on a PostgreSQL `integer` column
    // raising 22003, and `display_order` is now a SQLite INTEGER which stores 2147483648 without
    // complaint (measured, see this file's header). The case pins the 400; it no longer shows the
    // range check is needed.
    const hugeOrder = await request(
      "",
      {
        method: "POST",
        body: JSON.stringify({
          label: uniqueLabel("W"),
          color: "#000",
          displayOrder: 2_147_483_648,
        }),
      },
      managerCookie,
    );
    expect(hugeOrder.status).toBe(400);
    expect(await hugeOrder.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "displayOrder" } },
    });
  });

  it("PATCH edits label/color/displayOrder/active (204), then GET reflects it", async () => {
    const { id } = (await (
      await request(
        "",
        {
          method: "POST",
          body: JSON.stringify({ label: uniqueLabel("Occupied"), color: "#f97316" }),
        },
        managerCookie,
      )
    ).json()) as { id: string };

    const newLabel = uniqueLabel("Occupied-edited");
    const patch = await request(
      `/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ label: newLabel, color: "#22c55e", displayOrder: 5, active: false }),
      },
      managerCookie,
    );
    expect(patch.status).toBe(204);
    expect(await patch.text()).toBe("");

    const list = (await (await request("", { method: "GET" }, managerCookie)).json()) as {
      id: string;
      label: string;
      color: string;
      displayOrder: number;
      active: boolean;
    }[];
    expect(list.find((s) => s.id === id)).toMatchObject({
      label: newLabel,
      color: "#22c55e",
      displayOrder: 5,
      active: false,
    });
  });

  it("PATCH an unknown id → 404 status.not_found; a malformed :id → 404 too (isUuid guard)", async () => {
    const unknown = await request(
      "/00000000-0000-4000-8000-000000000000",
      { method: "PATCH", body: JSON.stringify({ label: uniqueLabel("X") }) },
      managerCookie,
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "status.not_found" } });

    // The `if (!isUuid(id))` guard used to be provable here: without it a malformed id reached a
    // PostgreSQL `uuid` column and came back a 500 (raw `22P02`). `id` is a text column now, so the
    // same query matches nothing and the route answers 404 either way (measured, see this file's
    // header). The 404 is still the right answer; the guard is what has stopped being observable.
    const malformed = await request(
      "/not-a-uuid",
      { method: "PATCH", body: JSON.stringify({ label: uniqueLabel("X") }) },
      managerCookie,
    );
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toMatchObject({ error: { code: "status.not_found" } });
  });

  it("PATCH body screens: an array body → 400 (field body); non-string label/color, non-integer OR non-number displayOrder, non-boolean active → 400", async () => {
    const id = randomUUID(); // a well-formed uuid, so the isUuid screen passes and the body screens fire

    // A JSON array is a non-object body → field "body".
    const arrayBody = await request(`/${id}`, { method: "PATCH", body: "[]" }, managerCookie);
    expect(arrayBody.status).toBe(400);
    expect(await arrayBody.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });

    const badLabel = await request(
      `/${id}`,
      { method: "PATCH", body: JSON.stringify({ label: 123 }) },
      managerCookie,
    );
    expect(badLabel.status).toBe(400);
    expect(await badLabel.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "label" } },
    });

    const badColor = await request(
      `/${id}`,
      { method: "PATCH", body: JSON.stringify({ color: 123 }) },
      managerCookie,
    );
    expect(badColor.status).toBe(400);
    expect(await badColor.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "color" } },
    });

    const badOrder = await request(
      `/${id}`,
      { method: "PATCH", body: JSON.stringify({ displayOrder: "x" }) },
      managerCookie,
    );
    expect(badOrder.status).toBe(400);
    expect(await badOrder.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "displayOrder" } },
    });

    // A NON-NUMBER displayOrder (here `null`) is rejected, not coerced — an explicit `null` on PATCH
    // would otherwise have reset displayOrder to 0 (`Number(null)` → 0). See the POST screen above.
    const nullOrder = await request(
      `/${id}`,
      { method: "PATCH", body: JSON.stringify({ displayOrder: null }) },
      managerCookie,
    );
    expect(nullOrder.status).toBe(400);
    expect(await nullOrder.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "displayOrder" } },
    });

    const badActive = await request(
      `/${id}`,
      { method: "PATCH", body: JSON.stringify({ active: "yes" }) },
      managerCookie,
    );
    expect(badActive.status).toBe(400);
    expect(await badActive.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "active" } },
    });
  });

  it("PATCH with a null / empty body → 204 no-op (never a 500), the status unchanged", async () => {
    // A `null` body coerces to `{}` (`?? {}`) and carries no mutable field: the route answers a 204
    // no-op WITHOUT reaching updateStatus's empty `.set()` (which Drizzle rejects → a 500). Mirrors the
    // staff PATCH route's "null body → 204 no-op" (management-api.accounts-and-receipt-config.test.ts).
    const { id } = (await (
      await request(
        "",
        {
          method: "POST",
          body: JSON.stringify({
            label: uniqueLabel("Unchanged"),
            color: "#123456",
            displayOrder: 3,
          }),
        },
        managerCookie,
      )
    ).json()) as { id: string };

    const nullBody = await request(`/${id}`, { method: "PATCH", body: "null" }, managerCookie);
    expect(nullBody.status).toBe(204);
    expect(await nullBody.text()).toBe("");

    const emptyBody = await request(`/${id}`, { method: "PATCH", body: "{}" }, managerCookie);
    expect(emptyBody.status).toBe(204);

    // The status is untouched by either no-op.
    const list = (await (await request("", { method: "GET" }, managerCookie)).json()) as {
      id: string;
      color: string;
      displayOrder: number;
      active: boolean;
    }[];
    expect(list.find((s) => s.id === id)).toMatchObject({
      color: "#123456",
      displayOrder: 3,
      active: true,
    });
  });

  it("DELETE deactivates a status (204), then GET shows it inactive", async () => {
    const { id } = (await (
      await request(
        "",
        { method: "POST", body: JSON.stringify({ label: uniqueLabel("ToRetire"), color: "#000" }) },
        managerCookie,
      )
    ).json()) as { id: string };

    const del = await request(`/${id}`, { method: "DELETE" }, managerCookie);
    expect(del.status).toBe(204);
    expect(await del.text()).toBe("");

    const list = (await (await request("", { method: "GET" }, managerCookie)).json()) as {
      id: string;
      active: boolean;
    }[];
    expect(list.find((s) => s.id === id)).toMatchObject({ active: false });
  });

  it("DELETE an unknown id → 404 status.not_found; a malformed :id → 404 too (isUuid guard)", async () => {
    const unknown = await request(
      "/00000000-0000-4000-8000-000000000000",
      { method: "DELETE" },
      managerCookie,
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "status.not_found" } });

    const malformed = await request("/not-a-uuid", { method: "DELETE" }, managerCookie);
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toMatchObject({ error: { code: "status.not_found" } });
  });

  it("a STAFF session is refused on every route (403 authorization.not_permitted)", async () => {
    // A staff person CAN log in but holds no `venue.configure`, so each verb's `authorizeManager`
    // refuses it 403 — after the route's session guard + body/id screens, before any write. Deleting
    // the authorize call from a verb flips its case to a 2xx (proven by deletion in
    // `service-statuses.test.ts`); here the same 403 is exercised end-to-end over HTTP.
    const someId = randomUUID();
    const cases = [
      request(
        "",
        { method: "POST", body: JSON.stringify({ label: uniqueLabel("Nope"), color: "#000" }) },
        staffCookie,
      ),
      request("", { method: "GET" }, staffCookie),
      request(
        `/${someId}`,
        { method: "PATCH", body: JSON.stringify({ label: uniqueLabel("Z") }) },
        staffCookie,
      ),
      request(`/${someId}`, { method: "DELETE" }, staffCookie),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    }
  });

  it("no session → 401 management_session.required on every route", async () => {
    // `requireManagementSession` runs FIRST on each route, so an unauthenticated request is refused
    // before any DB work — the deletion proof for the route-level session gate.
    const someId = randomUUID();
    const cases = [
      request(
        "",
        { method: "POST", body: JSON.stringify({ label: "Nope", color: "#000" }) },
        undefined,
      ),
      request("", { method: "GET" }, undefined),
      request(`/${someId}`, { method: "PATCH", body: JSON.stringify({ label: "Z" }) }, undefined),
      request(`/${someId}`, { method: "DELETE" }, undefined),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "management_session.required" } });
    }
  });
});
