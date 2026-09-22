import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { asAppUser, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin, persons, startManagementSession } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import { mountPurchasingApi } from "./purchasing-api.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import "./errors.js";

/**
 * The purchase-invoice write group's `purchase.manage` gate, on the engine the box now runs.
 *
 * ## What this file was, and the one thing that went with PostgreSQL
 *
 * Its header said it needed the real cluster because every touch ran `withTransaction` + `asAppUser`
 * so the routes executed as the non-superuser app role and that role's table grants were enforced.
 * **There are no roles on this engine**: `asAppUser` is an inert function
 * (`packages/db/src/testing/roles.ts`), there is no `connectAs`, and every call below runs on the one
 * connection. Nothing now checks that the deployment role's grants are part of the refusal.
 *
 * What survives is the reason the file is worth keeping beside `purchasing-api.test.ts`, and the
 * reason it is now named `purchasing-api.gate-sweep.test.ts`: that sibling gates the POST route only
 * (`purchasing-api.test.ts`, "POST as a staff-role session → 403 authorization.not_permitted" — its
 * one `staffCookie` case, 2026-09-22), and the case below sweeps
 * all five routes with PATCH and DELETE aimed at an id that really exists, so a 403 cannot be a
 * not-found in disguise.
 *
 * The per-suite NIF counter went with the shared container: `useVenueDb` opens one fresh SQLite venue
 * per file, so the one venue provisioned here needs no unique-tax-id dance.
 */
const LOCALE = "es-ES";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

/** A no-op logger: only the HTTP responses and the database state matter here. */
const noopLog: Logger = () => {};

interface Venue {
  /** A live MANAGEMENT session cookie for a `manager` (holds `purchase.manage`). */
  managerCookie: string;
  /** A live MANAGEMENT session cookie for a `staff` person (holds nothing — the gate refuses it). */
  staffCookie: string;
}

/** Provision a venue as owner and seed the people and sessions this route fixture needs. */
async function setupVenue(): Promise<Venue> {
  await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: "72000001K",
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

  const { managerSid, staffSid } = await withTransaction(suite.db, async (tx) => {
    await asAppUser(tx);
    // Through the table definition, not raw SQL: `persons.id` is a JavaScript `$defaultFn` generator
    // on this engine (`id text PRIMARY KEY NOT NULL`), which a raw insert never reaches — the
    // refusal is `NOT NULL constraint failed: persons.id`.
    const [mgr] = await tx
      .insert(persons)
      .values({ displayName: "The Manager", pinHash: hashPin("1234"), role: "manager" })
      .returning({ id: persons.id });
    const [stf] = await tx
      .insert(persons)
      .values({ displayName: "The Clerk", pinHash: hashPin("1234"), role: "staff" })
      .returning({ id: persons.id });
    const managerSession = await startManagementSession(tx, { personId: mgr!.id });
    const staffSession = await startManagementSession(tx, { personId: stf!.id });
    return { managerSid: managerSession.id, staffSid: staffSession.id };
  });

  return {
    managerCookie: `${MANAGEMENT_COOKIE}=${managerSid}`,
    staffCookie: `${MANAGEMENT_COOKIE}=${staffSid}`,
  };
}

/** One Hono app per venue — `mountPurchasingApi` takes only `db`, so each venue's
 * routes need their own app (mirrors `catalogue-api.full-manifest.test.ts`). */
function mountApp(): Hono {
  const app = new Hono();
  mountPurchasingApi(app, { db: suite.db }, noopLog);
  return app;
}

/** JSON POST/PATCH/GET/DELETE helper carrying `cookie`. */
async function send(
  app: Hono,
  method: "POST" | "PATCH" | "GET" | "DELETE",
  path: string,
  cookie: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = { cookie };
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function invoiceBody(supplierInvoiceNumber: string): unknown {
  return {
    header: {
      supplierTaxId: "B12345678",
      supplierName: "Distribuciones García SL",
      supplierInvoiceNumber,
      issuedOn: "2026-08-10",
      receivedOn: "2026-08-12",
      total: "121.00",
    },
    lines: [{ rate: "21.00", base: "100.00", tax: "21.00", kind: "ordinary" }],
  };
}

async function createInvoice(app: Hono, cookie: string, number: string): Promise<string> {
  const res = await send(
    app,
    "POST",
    "/management-api/purchase-invoices",
    cookie,
    invoiceBody(number),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe("Purchasing API — the purchase.manage gate over every write route", () => {
  it("refuses every purchase-invoice write route to a staff-role session — 403 authorization.not_permitted", async () => {
    // Prove the `purchase.manage` gate BY DELETION. A `staff`-role management session holds no
    // `purchase.manage`, so `authorizeManager` (inside `gated`) throws `authorization.not_permitted`
    // before any op runs on all four write/read routes.
    //
    // GUARD-BY-DELETION (authorizeManager), re-run on this engine 2026-09-22 — the receipt it replaces
    // was taken against postgres:18, which this branch retired: deleted the
    //   `await authorizeManager(tx, { managementSessionId: sessionId, permission: PURCHASE_WRITE_PERMISSION });`
    // call from `purchasing-api.ts`'s `gated` helper and ran this file. It FAILED at the first
    // assertion, `expected 200 to be 403` — the ungated staff GET served the list. Restored from a
    // byte-for-byte copy, verified with `cmp`, and the file passed again.
    const { managerCookie, staffCookie } = await setupVenue();
    const app = mountApp();

    // A real invoice the manager owns, so the staff PATCH/DELETE target an id that DOES exist — the
    // refusal is the gate, not a not_found masking it.
    const id = await createInvoice(app, managerCookie, "GATE-1");
    const DUMMY = "00000000-0000-0000-0000-000000000000";

    const expect403 = async (res: Response) => {
      expect(res.status).toBe(403);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "authorization.not_permitted" },
      });
    };

    await expect403(await send(app, "GET", "/management-api/purchase-invoices", staffCookie));
    await expect403(await send(app, "GET", `/management-api/purchase-invoices/${id}`, staffCookie));
    await expect403(
      await send(
        app,
        "POST",
        "/management-api/purchase-invoices",
        staffCookie,
        invoiceBody("STAFF-1"),
      ),
    );
    await expect403(
      await send(app, "PATCH", `/management-api/purchase-invoices/${id}`, staffCookie, {
        header: { note: "hack" },
      }),
    );
    await expect403(
      await send(app, "DELETE", `/management-api/purchase-invoices/${DUMMY}`, staffCookie),
    );
  });
});
