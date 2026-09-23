import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
  listAvailableProducts,
} from "@waitron/catalogue";
import type { AvailableProduct } from "@waitron/catalogue";
import { registerSif, VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import { withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import type { TillConfig } from "./till-config.js";
import { createTable } from "./tables.js";
import { addTabRound, openTab } from "./working-order.js";
import { payWorkingOrder, recordTillSale } from "./till-sale.js";
import "./errors.js";

/**
 * Tabs end to end — opening, appending rounds, paying, and what the pay FILES.
 *
 * Named `tabs.filing.test.ts` because paying is what separates it from its sibling: every case here
 * drives `payWorkingOrder` or `recordTillSale` through a real `VerifactuBackend`, either to assert
 * what gets filed or to assert that a refusal files nothing, and
 * `grep -n 'payWorkingOrder\|VerifactuBackend' apps/server/src/tabs.test.ts` prints nothing (exit 1,
 * run 2026-09-22), so the sibling stops at what the tab verbs write and never reaches the record a
 * settle files.
 *
 * ## H2: the huella is independent of table/tab membership — the static receipts
 *
 * The fiscal core is UNTOUCHED by table-service: pay reuses `payWorkingOrder`/`recordSale`
 * verbatim, and no table/tab column reaches the hash. Two receipts, both re-run 2026-09-22:
 *
 * Step 1 — neither the fiscal core (`recordSale`) nor the alta builder (`VerifactuBackend`) reads
 *   any table column. The tab link is a back-pointer on `dining_tables.tab_id`, so the filed
 *   `working_orders` row carries no tab field at all; `delivery_table_id` is the ONLY table column
 *   on `working_orders` and nothing on this path reads it.
 *     $ grep -nE "table_id|delivery_table_id|tableId|deliveryTableId" \
 *         packages/core/src/record-sale.ts packages/fiscal-verifactu/src/backend.ts
 *     → (no output; exit 1)
 *   `RecordSaleInput` carries `workingOrderId` but no table column, and `computeHuella`
 *   (`@waitron/verifactu`'s huella computation) hashes ONLY the eight AEAT alta fields — IDEmisorFactura
 *   (issuer NIF), NumSerieFactura, FechaExpedicionFactura, TipoFactura, CuotaTotal, ImporteTotal,
 *   the previous Huella, and FechaHoraHusoGenRegistro — none of which is a table column.
 *
 * Step 1b — a tab lives in `open` and settles straight to `settled`; it never enters `placed`, so
 *   it files nothing until pay (design §5/§10). `placed` under Mode I (`invoice_first`) would file
 *   a DEFERRED invoice, which a tab must never do.
 *     $ grep -n '"placed"' apps/server/src/working-order.ts
 *     → six hits, every one inside `placeOrder` or its docstring — no other function writes the
 *       status, and no tab verb calls `placeOrder`.
 *   The narrower grep this receipt used to run — `grep -nE "placeOrder|status.*placed"` piped
 *   through `grep -iE "openTab|addTabRound|voidTabLine"` — no longer returns nothing: it now
 *   prints two COMMENT lines in the shared fire chokepoint that happen to name `placeOrder` and
 *   `addTabRound` in one sentence. It is a text match on prose, so it was never the check it read
 *   as; the grep above is.
 *
 * ## The two cases this file LOST
 *
 * Both staged several PostgreSQL backends through `suite.pg.connect()` and asserted
 * `pg_backend_pid()` was distinct. **There is no second connection to stage them on**: one venue
 * file, one write transaction at a time, which is wider than the per-table `select … for update`
 * they were written against — every one of those in `working-order.ts` is gone
 * (`assertAnchoredTabOpen` in `apps/server/src/working-order.ts` carries the chain and the
 * receipt). Deleted:
 *
 * 1. **Two backends racing `openTab` on ONE table**, the loser getting `tab.already_open` and
 *    exactly one `open` working order surviving. The sequential refusal is covered by
 *    `tabs.test.ts`, "refuses a second tab on a table that already has an OPEN one
 *    (tab.already_open)"; the RACE and the one-open-order corruption observable are not.
 * 2. **Ten backends each appending one round to ONE tab, landing at contiguous `line_no`s 1..10.**
 *    The sequential append is covered by `tabs.test.ts`, "appends a round with the NEXT line_no,
 *    without deleting or re-pricing existing lines"; the contiguity-under-load property is covered
 *    by nothing.
 *
 * **Also lost, and not replaced:** the deployment role. These writes ran after `set local role
 * app_user` on a non-superuser connection; `asAppUser` is an empty body now
 * (`packages/db/src/testing/roles.ts`).
 *
 * ## Why there are still TWO databases
 *
 * The two H2 cases file two records carrying the IDENTICAL AEAT identity, and
 * `registros_identidad_uq` is global — there is no tenant column to hold them apart. Each filing
 * therefore needs its own database, which two `useVenueDb` calls give directly (see
 * `secondVenueSharingNif`). Every other case uses `suite` alone.
 */
const LOCALE = "es-ES";

const venueDbOptions = { migrations: migrationOptionsFor(manifestSets(), null), timeoutMs: 60_000 };

const suite = useVenueDb(venueDbOptions);
// A SECOND, independent venue database for the H2 huella-comparison cases, for the reason the file
// header states. The helpers below default to `suite.db` and take `suiteB.db` only on the H2 path.
const suiteB = useVenueDb(venueDbOptions);

// This counter was here because tenants accumulated for the life of the shared PostgreSQL
// container. They do not now: each suite gets its own database file and the per-test reset empties
// `tenants` (`packages/db/src/testing/venue-db.ts`). It is kept because a distinct NIF per call
// costs nothing — and the H2 cases read tenant A's NIF back rather than assuming it.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(60_000_000 + nifCounter).padStart(8, "0")}K`;
}

function tillConfigFromVenue(venue: VenueResult): TillConfig {
  return {
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    // planVenue emits the standard series first, then the rectificative one.
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    // No integrated card terminal for these tab suites.
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

interface SeededVenue {
  cfg: TillConfig;
  /** "Café" — each, 1.50 gross, general(21%). */
  cafe: AvailableProduct;
  /** "Agua" — each, 2.00 gross, general(21%). Same rate as café, so a two-line basket has one VAT group. */
  agua: AvailableProduct;
}

/**
 * Stand up a fresh chained venue + registered SIF (as the owner), then seed a catalogue as the app
 * role and read back two `each`/general(21%) products. Each test gets its OWN tenant so its counts are
 * order-independent (CLAUDE.md §4).
 */
async function setupVenue(db: Database = suite.db): Promise<SeededVenue> {
  const venue = await applyVenue(
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
    { db, modules: ALL_MODULES },
  );

  const cfg = tillConfigFromVenue(venue);
  const available = await withTransaction(db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Delicatessen" });
    const bebidas = await createCategory(tx, { name: { [LOCALE]: "Bebidas" } });
    await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      name: "Café",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      name: "Agua",
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, venue.locationId, cat.id);
    return (await listAvailableProducts(tx, cfg.locationId)).products;
  });
  const cafe = available.find((p) => p.name === "Café")!;
  const agua = available.find((p) => p.name === "Agua")!;
  return { cfg, cafe, agua };
}

/** Seed one active dining table in the venue as the app role; returns its id. */
async function seedTable(cfg: TillConfig, label: string, db: Database = suite.db): Promise<string> {
  return withTransaction(db, async (tx) => {
    const { id } = await createTable(tx, cfg, { label });
    return id;
  });
}

// The fiscal backend + clock the pay path files through — ported from `working-order.pay-and-dispatch.test.ts`'s
// own scaffolding (the pay-closes-tab and huella tests file real chained records, so the suite needs a
// real `VerifactuBackend`). `resolveClient` REJECTS: `recordSale` must never contact AEAT (spec §4).
let backend: FiscalBackend;
// The H2 tests file tenant B in `suiteB`, so they need a backend bound to that database.
let backendB: FiscalBackend;
let clock: TrustedClock;

/** The system wall clock, reported confident/anchored — the identical stub the sibling suites use. */
function systemClock(): TrustedClock {
  return {
    now: () => {
      const instant = new Date();
      return {
        instant,
        offsetMinutes: -instant.getTimezoneOffset(),
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      };
    },
    anchor: () => {
      throw new Error("tabs.filing.test: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

beforeAll(() => {
  clock = systemClock();
  const makeBackend = (db: Database): FiscalBackend =>
    new VerifactuBackend({
      clock,
      db,
      environment: deploymentEnvironment(process.env),
      deploymentEnvironment: deploymentEnvironment(process.env),
      resolveClient: () =>
        Promise.reject(
          new Error("tabs.filing.test: resolveClient must never be called by recordSale"),
        ),
    });
  backend = makeBackend(suite.db);
  backendB = makeBackend(suiteB.db);
});

/**
 * The working order's own state — status + whether settled_at is set (the biconditional's witness).
 *
 * The `is not null` projection is read RAW, so no drizzle mapper runs and SQLite hands the
 * predicate back as the integer 1 or 0; the coercion is here in the READER, leaving every caller's
 * `settledAtSet: true/false` expectation as it was.
 */
async function orderState(id: string): Promise<{ status: string; settledAtSet: boolean }> {
  const { rows } = await suite.db.execute<{ status: string; settled: number }>(sql`
    select status, (settled_at is not null) as settled from working_orders where id = ${id}
  `);
  return { status: rows[0]!.status, settledAtSet: rows[0]!.settled === 1 };
}

/** How many `sales` rows reference this working order. */
async function saleCount(workingOrderId: string): Promise<number> {
  const { rows } = await suite.db.execute<{ count: string }>(sql`
    select cast(count(*) as text) as count from sales where working_order_id = ${workingOrderId}
  `);
  return Number(rows[0]!.count);
}

/** How many chained `registros_facturacion` rows exist for this working order's sale. */
async function registroCount(workingOrderId: string): Promise<number> {
  const { rows } = await suite.db.execute<{ count: string }>(sql`
    select cast(count(*) as text) as count
    from registros_facturacion r
    join sales s on s.id = r.sale_id
    where s.working_order_id = ${workingOrderId}
  `);
  return Number(rows[0]!.count);
}

describe("pay closes the tab (reuses payWorkingOrder → recordSale UNCHANGED)", () => {
  it("openTab + addTabRound → payWorkingOrder settles it, files one sale + registro, table reads free", async () => {
    const { cfg, cafe, agua } = await setupVenue();
    const tableId = await seedTable(cfg, "Pay-1");
    const deps = { db: suite.db, backend, clock };

    const { tabId } = await withTransaction(suite.db, async (tx) => {
      return openTab(tx, cfg, { tableId, lines: [{ productId: cafe.id, quantity: "1" }] });
    });
    await withTransaction(suite.db, async (tx) => {
      return addTabRound(tx, cfg, tabId, [{ productId: agua.id, quantity: "1" }]);
    });

    // Pay the tab by its id — the retrieved-order path (files the STORED lines; req.lines ignored).
    const res = await payWorkingOrder(deps, cfg, {
      id: tabId,
      lines: [],
      tender: { method: "cash", amount: "5.00" },
    });
    expect(res.total).toBe("3.50"); // 1.50 café + 2.00 agua
    expect(res.invoiceNumber).toBe("A/1");
    expect(await orderState(tabId)).toEqual({ status: "settled", settledAtSet: true });
    expect(await saleCount(tabId)).toBe(1);
    expect(await registroCount(tabId)).toBe(1);

    // The table now reads free: its tab_id STILL points at the order (no settle-time write), but the
    // order is settled, so the "open tab" join finds nothing (occupancy — Task 9).
    const { rows } = await suite.db.execute<{ n: string }>(sql`
      select cast(count(*) as text) as n
      from dining_tables dt join working_orders wo on wo.id = dt.tab_id
      where dt.id = ${tableId} and wo.status = 'open'`);
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it("paying an EMPTY tab is refused sale.empty_basket (a domain 4xx), files nothing — not an opaque 500", async () => {
    const { cfg } = await setupVenue();
    const tableId = await seedTable(cfg, "Empty-pay");
    const deps = { db: suite.db, backend, clock };

    // openTab with NO initial round → a lineless `open` working order (a first-class supported state,
    // tabs.test.ts "opens a tab with NO initial round"). Closing it before ordering routes
    // payWorkingOrder → priceStoredOrder → readLockedLines on a zero-line order — the exact
    // empty-tab-pay flow that used to throw a RAW Error → opaque `server.internal` 500.
    const { tabId } = await withTransaction(suite.db, async (tx) => {
      return openTab(tx, cfg, { tableId });
    });

    // The domain code the boundary maps to 400, NOT the opaque 500 a raw Error becomes through `run`.
    // Prove by deletion: reverting readLockedLines to `throw new Error(...)` makes this reject with a
    // plain Error carrying no `code`, so this `toMatchObject({ code })` fails (a 500 at the HTTP edge).
    await expect(
      payWorkingOrder(deps, cfg, {
        id: tabId,
        lines: [],
        tender: { method: "cash", amount: "5.00" },
      }),
    ).rejects.toMatchObject({ code: "sale.empty_basket" });

    // The refusal is BEFORE recordSale (the tx rolled back): NOTHING filed, the tab stays open. This is
    // the fiscal-safety check — no sale, no chained registro, no half-written record (CLAUDE.md §5).
    expect(await orderState(tabId)).toEqual({ status: "open", settledAtSet: false });
    expect(await saleCount(tabId)).toBe(0);
    expect(await registroCount(tabId)).toBe(0);
  });
});

/** A trusted clock pinned to ONE instant, so two independent filings hash the same
 *  FechaHoraHusoGenRegistro / FechaExpedicionFactura — the control that isolates the tab-ness. */
function fixedClock(instant: Date): TrustedClock {
  return {
    now: () => ({
      instant,
      offsetMinutes: 60,
      confident: true,
      confidence: "anchored",
      anchorAgeSeconds: 0,
    }),
    anchor: () => {
      throw new Error("tabs.filing.test: anchor() unused");
    },
    currentAnchor: () => null,
  };
}

/**
 * Tenant A's NIF — its `tenants.tax_id` (for a Spanish tenant, tax_id IS the NIF). This is the
 * issuer identifier (`IDEmisorFactura`) `recordSale` files under, and the field the two filings
 * must SHARE for their huellas to match.
 */
async function nifOf(db: Database = suite.db): Promise<string> {
  const { rows } = await db.execute<{ tax_id: string }>(
    sql`select tax_id from tenants where id = 1`,
  );
  return rows[0]!.tax_id;
}

/**
 * A SECOND, wholly separate venue whose node files under `nif` — tenant A's NIF — rather than its own,
 * provisioned in a SECOND database (`db`, defaulting to `suiteB.db`). This is the crux of the H2
 * proof, and it MUST be a second DATABASE, not a second tenant or node in one database:
 * `registros_identidad_uq` (packages/fiscal-verifactu/src/schema/registros.ts) is keyed on
 * (id_emisor_factura, num_serie_factura, fecha_expedicion_factura, tipo_registro) — record identity is
 * per-obligado NIF, because a duplicate is AEAT error 3000. Two filings with the IDENTICAL huella
 * necessarily share (NIF, "A/1", date), so under ONE database they collide on that unique. Under
 * one-tenant-per-database there is no tenant column to hold them apart (the unique is global), so each
 * filing goes in its OWN database; re-registering this venue's node SIF under `nif` makes
 * `IDEmisorFactura` — hence the huella input — identical across the two databases. This mirrors
 * `fiscal-verifactu`'s own `entorno is not part of the huella` proof, which files two same-huella
 * records sharing a FIXED `IDEmisorFactura` (verify.test.ts + testing/seed.ts's `TEST_NIF` / `altaFor`).
 *
 * `setupVenue(db)` provisions the venue fully in `db` (tenant, node, series "A" at next_number 1,
 * catalogue, till, and its OWN SIF under its OWN nif); `registerSif` then RE-registers the node under
 * `nif`, which also resets the node's chain head so its first sale is a primer_registro. It mints a
 * fresh installation number under (`nif`, "W1") — "W1" is `WAITRON_ID_SISTEMA` (`@waitron/fiscal-verifactu`,
 * the id the fiscal seed registers under; inlined so the literal reads beside the tuple it keys), and
 * NONE of the SIF identity (IdSistemaInformatico / NumeroInstalacion) enters `computeHuella`
 * (`@waitron/verifactu` hashes eight invoice fields only), so the installation number does not move the
 * huella. The re-registration is proven by deletion: remove it and this venue keeps `setupVenue`'s
 * own-nif SIF, so its filing carries a DIFFERENT `IDEmisorFactura` and the two huellas diverge — it is
 * the shared NIF, not any tenant identity, that the matching huella depends on.
 */
async function secondVenueSharingNif(nif: string, db: Database = suiteB.db): Promise<SeededVenue> {
  const venue = await setupVenue(db);
  await withTransaction(db, async (tx) => {
    await registerSif(tx, {
      nodeId: venue.cfg.nodeId,
      nif,
      idSistemaInformatico: "W1",
    });
  });
  return venue;
}

/** The filed huella for a working order's sale. */
async function filedHuella(workingOrderId: string, db: Database = suite.db): Promise<string> {
  const { rows } = await db.execute<{ huella: string }>(sql`
    select r.huella from registros_facturacion r
    join sales s on s.id = r.sale_id
    where s.working_order_id = ${workingOrderId}`);
  return rows[0]!.huella;
}

describe("H2: the huella is independent of whether the order was a tab", () => {
  // Receipt (Step 1): `grep -nE 'table_id|delivery_table_id|tableId|deliveryTableId'
  // packages/core/src/record-sale.ts packages/fiscal-verifactu/src/backend.ts` → zero matches. The filed
  // working_orders row carries NO tab-membership (the tab link is a back-pointer on dining_tables), and
  // delivery_table_id is not read; the huella hashes only the AEAT invoice fields.
  it("the SAME basket filed walk-up and from a tab yields the identical huella", async () => {
    const at = new Date("2026-08-17T19:20:30+01:00");
    const clockFixed = fixedClock(at);
    const depsA = { db: suite.db, backend, clock: clockFixed };
    const depsB = { db: suiteB.db, backend: backendB, clock: clockFixed };

    // Tenant A — a WALK-UP, no table → A/1, primer_registro, filed under A's own NIF (database `suite`).
    const { cfg: cfgA, cafe: cafeA } = await setupVenue();
    const nifA = await nifOf();
    const walkUpId = randomUUID();
    await payWorkingOrder(depsA, cfgA, {
      id: walkUpId,
      lines: [{ productId: cafeA.id, quantity: "1" }],
      tender: { method: "cash", amount: "5.00" },
    });

    // Tenant B (a SEPARATE database SHARING A's NIF, series "A") — a TAB on a table (dining_tables.tab_id
    // → the order) → also A/1, primer_registro. A separate database lets both `A/1` rows exist without
    // colliding on the (now global) `registros_identidad_uq`; the shared NIF makes IDEmisorFactura —
    // hence the huella input — identical (the receipt `secondVenueSharingNif` documents).
    const { cfg: cfgB, cafe: cafeB } = await secondVenueSharingNif(nifA);
    const tableId = await seedTable(cfgB, "H2-tab", suiteB.db);
    const { tabId } = await withTransaction(suiteB.db, async (tx) => {
      return openTab(tx, cfgB, { tableId, lines: [{ productId: cafeB.id, quantity: "1" }] });
    });
    await payWorkingOrder(depsB, cfgB, {
      id: tabId,
      lines: [],
      tender: { method: "cash", amount: "5.00" },
    });

    // Non-vacuity control (mirrors the `entorno is not part of the huella` precedent's read-back): the
    // two orders GENUINELY differ in table-ness — the TAB order (in `suiteB`) is pointed at by a
    // `dining_tables` row, the WALK-UP order (in `suite`) by none. Each read goes to the database its
    // order lives in. Without this, a regression where `openTab` stopped setting `tab_id` would leave
    // both filings table-less and make the equality below vacuously true.
    const tabPointers = await suiteB.db.execute<{ n: string }>(
      sql`select cast(count(*) as text) as n from dining_tables where tab_id = ${tabId}`,
    );
    const walkUpPointers = await suite.db.execute<{ n: string }>(
      sql`select cast(count(*) as text) as n from dining_tables where tab_id = ${walkUpId}`,
    );
    expect(Number(tabPointers.rows[0]!.n)).toBe(1); // the tab IS a table's running tab
    expect(Number(walkUpPointers.rows[0]!.n)).toBe(0); // the walk-up is anchored to no table

    // Same NIF + same "A/1" + same fixed timestamp + same amounts + both primer_registro ⇒ identical
    // huella. What this EMPIRICAL test proves is precisely that the huella is independent of the
    // `dining_tables.tab_id` BACK-POINTER — the one thing that actually differs between the two filings
    // (asserted just above). It does NOT, on its own, prove `delivery_table_id`-COLUMN independence:
    // `openTab`→`createOpenOrder` never sets `working_orders.delivery_table_id`, so BOTH orders carry
    // NULL there, and a hypothetical `computeHuella` reading that column would see NULL for both and this
    // equality would STILL hold. Column-independence is established SEPARATELY and dispositively by
    // (i) the UNTOUCHED fiscal core — this whole diff is test-only (`git diff --stat`) — and (ii) the
    // Step-1 grep-proof that `recordSale`/`computeHuella`/the alta builder never reference the column.
    expect(await filedHuella(tabId, suiteB.db)).toBe(await filedHuella(walkUpId, suite.db));
  });
});

/** The delivery_table_id stamped on a working order. */
async function deliveryTableOf(
  workingOrderId: string,
  db: Database = suite.db,
): Promise<string | null> {
  const { rows } = await db.execute<{ d: string | null }>(
    sql`select delivery_table_id as d from working_orders where id = ${workingOrderId}`,
  );
  return rows[0]!.d;
}

describe("counter delivery (deliveryTableId on a walk-up sale)", () => {
  it("records delivery_table_id on the walk-up order and files one sale (it is NOT a tab)", async () => {
    const { cfg, cafe } = await setupVenue();
    const tableId = await seedTable(cfg, "Del-1");
    const deps = { db: suite.db, backend, clock };

    const id = randomUUID();
    const res = await recordTillSale(deps, cfg, {
      workingOrderId: id,
      lines: [{ productId: cafe.id, quantity: "1" }],
      tender: { method: "cash", amount: "5.00" },
      deliveryTableId: tableId,
    });
    expect(res.invoiceNumber).toBe("A/1");
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await deliveryTableOf(id)).toBe(tableId);
    // A delivery is NOT a tab — no dining_tables row points at it.
    const { rows } = await suite.db.execute<{ n: string }>(
      sql`select cast(count(*) as text) as n from dining_tables where tab_id = ${id}`,
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it("a deliveryTableId naming no table is refused table.not_found (a domain 4xx, not a raw 500)", async () => {
    const { cfg, cafe } = await setupVenue();
    const deps = { db: suite.db, backend, clock };
    const orderId = randomUUID();
    const missingTableId = randomUUID(); // a well-formed uuid that names no dining table

    // The column's FOREIGN KEY to `dining_tables` is the database's own backstop
    // (`packages/db/drizzle/0000_baseline.sql`, the `working_orders` table); what this case asserts is
    // the app pre-check in front of it, which names an actionable domain code where a raw
    // constraint error would surface as an opaque `server.internal` 500.
    await expect(
      recordTillSale(deps, cfg, {
        workingOrderId: orderId,
        lines: [{ productId: cafe.id, quantity: "1" }],
        tender: { method: "cash", amount: "5.00" },
        deliveryTableId: missingTableId,
      }),
    ).rejects.toMatchObject({ code: "table.not_found", params: { tableId: missingTableId } });

    // Nothing was filed and no order was created — the guard fires before any write (the tx rolls back).
    expect(await saleCount(orderId)).toBe(0);
    const { rows } = await suite.db.execute<{ n: string }>(
      sql`select cast(count(*) as text) as n from working_orders where id = ${orderId}`,
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });
});

describe("H2 (column): the huella is independent of delivery_table_id", () => {
  // Task 7 could prove delivery_table_id-COLUMN independence only by grep + untouched-core, because
  // nothing could SET the column. Task 8 makes it settable, so this proves it EMPIRICALLY: two counter
  // sales that differ ONLY in delivery_table_id (one carries a real table, the other NULL) file the
  // IDENTICAL huella. The non-vacuity control below asserts the two orders genuinely differ in that one
  // column, so the equality is not vacuously true (a regression that stopped writing the column would
  // leave both NULL and pass a weaker test).
  it("two counter sales differing ONLY in delivery_table_id yield the identical huella", async () => {
    const at = new Date("2026-08-17T19:20:30+01:00");
    const clockFixed = fixedClock(at);
    const depsA = { db: suite.db, backend, clock: clockFixed };
    const depsB = { db: suiteB.db, backend: backendB, clock: clockFixed };

    // Tenant A — a counter sale DELIVERED to a table → A/1, primer_registro, filed under A's own NIF
    // (database `suite`).
    const { cfg: cfgA, cafe: cafeA } = await setupVenue();
    const nifA = await nifOf();
    const tableA = await seedTable(cfgA, "H2col-A");
    const deliveredId = randomUUID();
    await recordTillSale(depsA, cfgA, {
      workingOrderId: deliveredId,
      lines: [{ productId: cafeA.id, quantity: "1" }],
      tender: { method: "cash", amount: "5.00" },
      deliveryTableId: tableA,
    });

    // Tenant B (a SEPARATE database SHARING A's NIF, series "A") — a plain walk-up, NO delivery table →
    // also A/1, primer_registro. The shared NIF makes IDEmisorFactura — hence the huella input —
    // identical; a separate database lets both `A/1` rows exist without colliding on the (now global)
    // `registros_identidad_uq` (the same trick `secondVenueSharingNif` documents for the tab H2 test).
    const { cfg: cfgB, cafe: cafeB } = await secondVenueSharingNif(nifA);
    const walkUpId = randomUUID();
    await recordTillSale(depsB, cfgB, {
      workingOrderId: walkUpId,
      lines: [{ productId: cafeB.id, quantity: "1" }],
      tender: { method: "cash", amount: "5.00" },
    });

    // Non-vacuity control: the two orders GENUINELY differ in the one column under test — A (in `suite`)
    // carries the real table, B (in `suiteB`) carries NULL. Each read goes to its own database.
    expect(await deliveryTableOf(deliveredId, suite.db)).toBe(tableA);
    expect(await deliveryTableOf(walkUpId, suiteB.db)).toBe(null);

    // Same NIF + same "A/1" + same fixed timestamp + same amount + both primer_registro, differing ONLY
    // in delivery_table_id ⇒ identical huella. This is the EMPIRICAL proof — possible for the first time
    // now the column is settable — that the newly-threaded delivery_table_id does NOT leak into the hash:
    // two rows differing solely in it hash alike (the fiscal core never reads it, per the Step-1 grep).
    expect(await filedHuella(deliveredId, suite.db)).toBe(await filedHuella(walkUpId, suiteB.db));
  });
});
