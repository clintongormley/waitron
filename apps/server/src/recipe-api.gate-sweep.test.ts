import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin, persons, startManagementSession } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { createCatalogue, createProduct } from "@waitron/catalogue";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import { mountRecipeApi } from "./recipe-api.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import "./errors.js";

/**
 * The recipe-authoring write group's `recipe.manage` gate, on the engine the box now runs.
 *
 * ## The one thing that went with PostgreSQL
 *
 * **There are no roles on this engine**: there is no `connectAs`, and every call below runs on the
 * one handle. Nothing now checks that the deployment role's grants are part of the refusal.
 *
 * What survives is the reason the file is worth keeping beside `recipe-api.test.ts`, and the reason
 * it is now named `recipe-api.gate-sweep.test.ts`: that sibling gates the ingredients LIST route
 * only ("rejects an absent session with 401 and a staff session with 403" — its one `staffCookie`
 * case, 2026-09-22), and the case below sweeps all five authoring routes with the PATCH and the two `/recipe`
 * routes aimed at ids that really exist, so a 403 cannot be a not-found in disguise.
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

// The uuid handed to `mountRecipeApi`'s `cfg.nodeId`. No route reads it (`recipe-api.ts`'s
// `RecipeApiDeps` doc), so any valid uuid serves.
const NODE_ID = "11111111-1111-4111-8111-111111111111";

interface Venue {
  /** A live MANAGEMENT session cookie for a `manager` (holds `recipe.manage`). */
  managerCookie: string;
  /** A live MANAGEMENT session cookie for a `staff` person (holds nothing — the gate refuses it). */
  staffCookie: string;
  /** A seeded product, so the two `/products/:id/recipe` routes can be gated against a real id. */
  productId: string;
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

  const { managerSid, staffSid, productId } = await withTransaction(suite.db, async (tx) => {
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
    const catalogue = await createCatalogue(tx, {
      name: "Recipe catalogue",
    });
    const product = await createProduct(tx, {
      catalogueId: catalogue.id,
      categoryId: null,
      name: "Tostada",
      pricingUnit: "each",
      unitPrice: "1.00",
      vatClass: "general",
    });
    return { managerSid: managerSession.id, staffSid: staffSession.id, productId: product.id };
  });

  return {
    managerCookie: `${MANAGEMENT_COOKIE}=${managerSid}`,
    staffCookie: `${MANAGEMENT_COOKIE}=${staffSid}`,
    productId,
  };
}

/** A Hono app with the recipe routes mounted — the same per-suite shape
 * `purchasing-api.gate-sweep.test.ts` uses. `mountRecipeApi` reads `cfg.nodeId` in no route
 * (`recipe-api.ts`'s `RecipeApiDeps` doc), so the app is bound to nothing but `db`. */
function mountApp(): Hono {
  const app = new Hono();
  mountRecipeApi(app, { db: suite.db, cfg: { nodeId: NODE_ID } }, noopLog);
  return app;
}

/** JSON GET/POST/PATCH/PUT helper carrying `cookie`. */
async function send(
  app: Hono,
  method: "GET" | "POST" | "PATCH" | "PUT",
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

function ingredientBody(name: string): unknown {
  return { name, allergens: { gluten: { presence: "contains" } } };
}

async function createIngredient(app: Hono, cookie: string, name: string): Promise<string> {
  const res = await send(app, "POST", "/management-api/ingredients", cookie, ingredientBody(name));
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe("Recipe API — the recipe.manage gate over every authoring route", () => {
  it("refuses every recipe-authoring route to a staff-role session — 403 authorization.not_permitted", async () => {
    // Prove the `recipe.manage` gate BY DELETION. A `staff`-role management session holds no
    // `recipe.manage`, so `authorizeManager` (inside `gated`) throws `authorization.not_permitted`
    // before any op runs on all five routes, while the manager (who holds it) gets 200 on the same list.
    //
    // GUARD-BY-DELETION (authorizeManager), re-run on this engine 2026-09-22 — the receipt it replaces
    // was taken against postgres:18, which this branch retired: deleted the
    //   `await authorizeManager(tx, { managementSessionId: sessionId, permission: RECIPE_WRITE_PERMISSION });`
    // call from `recipe-api.ts`'s `gated` helper and ran this file. It FAILED at the FIRST staff
    // assertion, `expected 200 to be 403` on `GET /management-api/ingredients`. (The other four routes
    // funnel through the SAME `gated` chokepoint, so they lose the gate identically; the run stops at
    // the first failed assertion, so 200 on the list is the only status this deletion was OBSERVED to
    // produce.) Restored from a byte-for-byte copy, verified with `cmp`, and the file passed again.
    const { managerCookie, staffCookie, productId } = await setupVenue();
    const app = mountApp();

    // A real ingredient the manager owns, so the staff PATCH targets an id that DOES exist — the refusal
    // is the gate, not a not_found masking it. Also proves the manager (who holds `recipe.manage`) is
    // NOT refused: this create is a 201.
    const ingredientId = await createIngredient(app, managerCookie, "GATE-ing");

    // The manager gets 200 on the list — the positive control the gate must let through.
    const mgrList = await send(app, "GET", "/management-api/ingredients", managerCookie);
    expect(mgrList.status).toBe(200);

    const expect403 = async (res: Response) => {
      expect(res.status).toBe(403);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "authorization.not_permitted" },
      });
    };

    await expect403(await send(app, "GET", "/management-api/ingredients", staffCookie));
    await expect403(
      await send(
        app,
        "POST",
        "/management-api/ingredients",
        staffCookie,
        ingredientBody("STAFF-1"),
      ),
    );
    await expect403(
      await send(app, "PATCH", `/management-api/ingredients/${ingredientId}`, staffCookie, {
        name: "hack",
      }),
    );
    await expect403(
      await send(app, "GET", `/management-api/products/${productId}/recipe`, staffCookie),
    );
    await expect403(
      await send(app, "PUT", `/management-api/products/${productId}/recipe`, staffCookie, {
        ingredientIds: [ingredientId],
      }),
    );
  });
});
