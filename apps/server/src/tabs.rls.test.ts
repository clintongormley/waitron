import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
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
import { asAppUser, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import type { TillConfig } from "./till-config.js";
import { createTable } from "./tables.js";
import { addTabRound, openTab } from "./working-order.js";
import { payWorkingOrder, recordTillSale } from "./till-sale.js";
import "./errors.js";

// ── H2: the huella is independent of table/tab membership — the grep receipts (Task 7, TS-1) ──
// The fiscal core is UNTOUCHED by table-service: pay reuses `payWorkingOrder`/`recordSale` verbatim,
// and no table/tab column reaches the hash. Two static receipts, both re-run and verified 2026-08-18:
//
// Step 1 — neither the fiscal core (`recordSale`) nor the alta builder (`VerifactuBackend`) reads any
//   table column. In the revised model the tab link is a back-pointer on `dining_tables.tab_id`, so
//   the filed `working_orders` row carries no tab field at all; `delivery_table_id` is the ONLY table
//   column on `working_orders` and nothing on this path reads it.
//     $ grep -nE "table_id|delivery_table_id|tableId|deliveryTableId" \
//         packages/core/src/record-sale.ts packages/fiscal-verifactu/src/backend.ts
//     → (no output; exit 1)
//   `RecordSaleInput` carries `workingOrderId` but no table column, and `computeHuella`
//   (packages/verifactu/src/huella.ts:45-58) hashes ONLY the eight AEAT alta fields — IDEmisorFactura
//   (issuer NIF), NumSerieFactura, FechaExpedicionFactura, TipoFactura, CuotaTotal, ImporteTotal, the
//   previous Huella, and FechaHoraHusoGenRegistro — none of which is a table column.
//
// Step 1b — a tab lives in `open` and settles straight to `settled`; it never enters `placed`, so it
//   files nothing until pay (design §5/§10). `placed` under Mode I (`invoice_first`) would file a
//   DEFERRED invoice, which a tab must never do.
//     $ grep -n "invoice_first" apps/server/src/working-order.ts
//     → 739: * ... `invoice_first` (Mode I): file `recordSale` DEFERRED here ...
//     → 793:       if (cfg.orderFlow === "invoice_first") {
//     $ grep -nE "placeOrder|status.*placed" apps/server/src/working-order.ts \
//         | grep -iE "openTab|addTabRound|voidTabLine"
//     → (no output; exit 1)   ← no tab verb transitions to `placed` or calls `placeOrder`
//   A tab is created `open` (`createOpenOrder` sets `status: "open"`) and pay settles it open → settled
//   via `payWorkingOrder`, so it is never at `placed`.
//
// Real Postgres, not PGlite — mandatory for THIS suite (CLAUDE.md §4). The per-table `FOR UPDATE`
// concurrency guard is exactly what PGlite CANNOT show: it runs every connection as a superuser and
// serialises every query onto ONE backend, so a "two concurrent openTabs" test there is a FALSE pass,
// not a weak one. The race below opens its own backend via `suite.pg.connect()`, and the
// shared-container globalSetup (`testing/global-setup.ts`) THROWS its `dockerRequired` message rather
// than skipping when Docker is absent, so a vanished suite fails loudly instead of reporting a green
// that proves nothing.
//
// This scaffolding (`useTemplateDb` `suite`, `nextNif`, `tillConfigFromVenue`, `setupVenue`) is
// verb-agnostic (owner-read SQL + venue setup), a sibling of `working-order.rls.test.ts`. Each task
// adds only the verb imports and owner-read helpers IT uses — this task imports `openTab` +
// `createTable` and reads `open` working-order counts; Tasks 5/7/8 extend it.
const LOCALE = "es-ES";

const suite = useTemplateDb({ template: "manifest" });

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the same shape `working-order.rls.test.ts` uses.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(60_000_000 + nifCounter).padStart(8, "0")}K`;
}

function tillConfigFromVenue(venue: VenueResult): TillConfig {
  return {
    tenantId: brandTenantId(venue.tenantId),
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    // planVenue emits the standard series first, then the rectificative one.
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    // No integrated card terminal for these working-order RLS suites.
    cardProvider: "none",
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
async function setupVenue(): Promise<SeededVenue> {
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
        },
      },
      ALL_MODULES,
    ),
    { db: suite.admin, modules: ALL_MODULES },
  );

  const cfg = tillConfigFromVenue(venue);
  const available = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, { name: "Delicatessen" });
    const bebidas = await createCategory(tx, { name: "Bebidas" });
    await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Café" },
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Agua" },
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, venue.locationId, cat.id);
    return (await listAvailableProducts(tx, cfg.locationId)).products;
  });
  const cafe = available.find((p) => p.descriptions[LOCALE] === "Café")!;
  const agua = available.find((p) => p.descriptions[LOCALE] === "Agua")!;
  return { cfg, cafe, agua };
}

/** Seed one active dining table in the venue as the app role; returns its id. */
async function seedTable(cfg: TillConfig, label: string): Promise<string> {
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const { id } = await createTable(tx, cfg, { label });
    return id;
  });
}

/** How many OPEN working orders exist for the tenant — owner read (bypasses RLS). With the per-table
 *  FOR UPDATE lock, a race yields exactly ONE (the loser refuses BEFORE creating its order); without the
 *  lock, both create one → 2, and the table's single tab_id points at only one, orphaning the other. */
async function openOrderCount(cfg: TillConfig): Promise<number> {
  const { rows } = await suite.admin.execute<{ n: string }>(
    sql`select count(*)::text as n from working_orders where tenant_id = ${cfg.tenantId} and status = 'open'`,
  );
  return Number(rows[0]!.n);
}

// The fiscal backend + clock the pay path files through — ported from `working-order.rls.test.ts`'s
// own scaffolding (the pay-closes-tab and huella tests file real chained records, so the suite needs a
// real `VerifactuBackend`). `resolveClient` REJECTS: `recordSale` must never contact AEAT (spec §4).
let backend: FiscalBackend;
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
      throw new Error("tabs.rls.test: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

beforeAll(() => {
  clock = systemClock();
  backend = new VerifactuBackend({
    clock,
    db: suite.admin,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(new Error("tabs.rls.test: resolveClient must never be called by recordSale")),
  });
});

/** The working order's own state — status + whether settled_at is set (the biconditional's witness). */
async function orderState(id: string): Promise<{ status: string; settledAtSet: boolean }> {
  const { rows } = await suite.admin.execute<{ status: string; settled: boolean }>(sql`
    select status, (settled_at is not null) as settled from working_orders where id = ${id}
  `);
  return { status: rows[0]!.status, settledAtSet: rows[0]!.settled };
}

/** How many `sales` rows reference this working order — read as the owner (bypasses RLS). */
async function saleCount(workingOrderId: string): Promise<number> {
  const { rows } = await suite.admin.execute<{ count: string }>(sql`
    select count(*)::text as count from sales where working_order_id = ${workingOrderId}
  `);
  return Number(rows[0]!.count);
}

/** How many chained `registros_facturacion` rows exist for this working order's sale (owner read). */
async function registroCount(workingOrderId: string): Promise<number> {
  const { rows } = await suite.admin.execute<{ count: string }>(sql`
    select count(*)::text as count
    from registros_facturacion r
    join sales s on s.id = r.sale_id
    where s.working_order_id = ${workingOrderId}
  `);
  return Number(rows[0]!.count);
}

describe("openTab concurrency (one open tab per table; the per-table lock IS the guard)", () => {
  it("two backends racing to open a tab on the SAME table → exactly one wins, the other gets tab.already_open", async () => {
    const { cfg, cafe } = await setupVenue();
    const tableId = await seedTable(cfg, "Race-1");

    const [connA, connB] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
    try {
      const pids = await Promise.all(
        [connA, connB].map((d) =>
          d
            .execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)
            .then((r) => r.rows[0]!.pid),
        ),
      );
      expect(new Set(pids).size).toBe(2); // distinct backends — on PGlite these collapse (false pass).

      const attempt = (d: Database) =>
        withTenant(d, cfg.tenantId, async (tx) => {
          await asAppUser(tx);
          return openTab(tx, cfg, { tableId, lines: [{ productId: cafe.id, quantity: "1" }] });
        });

      const results = await Promise.allSettled([attempt(connA), attempt(connB)]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: "tab.already_open",
        params: { tableId },
      });
      // The corruption observable: exactly ONE open working order exists. Without the lock both would be
      // created (the loser reads a stale tab_id=null) → 2, one orphaned by the single tab_id column.
      expect(await openOrderCount(cfg)).toBe(1);
    } finally {
      await Promise.all([connA.close(), connB.close()]);
    }
  });
});

describe("addTabRound concurrency (distinct line_no under load)", () => {
  const ROUNDS = 10;
  it("N backends appending one line each to ONE tab all land with distinct contiguous line_nos", async () => {
    const { cfg, cafe } = await setupVenue();
    const tableId = await seedTable(cfg, "Race-2");
    // Open the tab EMPTY (no initial round) so the appended line_nos are exactly 1..N.
    const { tabId } = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return openTab(tx, cfg, { tableId });
    });

    const dbs = await Promise.all(Array.from({ length: ROUNDS }, () => suite.pg.connect()));
    try {
      const pids = await Promise.all(
        dbs.map((d) =>
          d
            .execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)
            .then((r) => r.rows[0]!.pid),
        ),
      );
      expect(new Set(pids).size).toBe(ROUNDS); // distinct backends — the race is real.

      await Promise.all(
        dbs.map((d) =>
          withTenant(d, cfg.tenantId, async (tx) => {
            await asAppUser(tx);
            return addTabRound(tx, cfg, tabId, [{ productId: cafe.id, quantity: "1" }]);
          }),
        ),
      );

      const { rows } = await suite.admin.execute<{ line_no: number }>(
        sql`select line_no from working_order_lines where working_order_id = ${tabId} order by line_no`,
      );
      expect(rows.map((r) => r.line_no)).toEqual(Array.from({ length: ROUNDS }, (_, i) => i + 1));
    } finally {
      await Promise.all(dbs.map((d) => d.close()));
    }
  });
});

describe("pay closes the tab (reuses payWorkingOrder → recordSale UNCHANGED)", () => {
  it("openTab + addTabRound → payWorkingOrder settles it, files one sale + registro, table reads free", async () => {
    const { cfg, cafe, agua } = await setupVenue();
    const tableId = await seedTable(cfg, "Pay-1");
    const deps = { db: suite.admin, backend, clock };

    const { tabId } = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return openTab(tx, cfg, { tableId, lines: [{ productId: cafe.id, quantity: "1" }] });
    });
    await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
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
    const { rows } = await suite.admin.execute<{ n: string }>(sql`
      select count(*)::text as n
      from dining_tables dt join working_orders wo on wo.id = dt.tab_id and wo.tenant_id = dt.tenant_id
      where dt.id = ${tableId} and wo.status = 'open'`);
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it("paying an EMPTY tab is refused sale.empty_basket (a domain 4xx), files nothing — not an opaque 500", async () => {
    const { cfg } = await setupVenue();
    const tableId = await seedTable(cfg, "Empty-pay");
    const deps = { db: suite.admin, backend, clock };

    // openTab with NO initial round → a lineless `open` working order (a first-class supported state,
    // tabs.test.ts "opens a tab with NO initial round"). Closing it before ordering routes
    // payWorkingOrder → priceStoredOrder → readLockedLines on a zero-line order — the exact
    // empty-tab-pay flow that used to throw a RAW Error → opaque `server.internal` 500.
    const { tabId } = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
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
      throw new Error("tabs.rls.test: anchor() unused");
    },
    currentAnchor: () => null,
  };
}

/** Tenant A's NIF — its `tenants.tax_id` (for a Spanish tenant, tax_id IS the NIF). This is the issuer
 *  identifier (`IDEmisorFactura`) `recordSale` files under, and the field the two filings must SHARE for
 *  their huellas to match. Owner read (bypasses RLS). */
async function nifOf(cfg: TillConfig): Promise<string> {
  const { rows } = await suite.admin.execute<{ tax_id: string }>(
    sql`select tax_id from tenants where id = ${cfg.tenantId}`,
  );
  return rows[0]!.tax_id;
}

/**
 * A SECOND, wholly separate venue (its own tenant) whose node files under `nif` — tenant A's NIF —
 * rather than its own. This is the crux of the H2 proof, and it MUST be a second TENANT, not a second
 * node under one tenant: `registros_identidad_uq`
 * (packages/fiscal-verifactu/src/schema/registros.ts:177) is keyed
 * (tenant_id, id_emisor_factura, num_serie_factura, fecha_expedicion_factura, tipo_registro) — NODE-
 * AGNOSTIC, because AEAT record identity is per-obligado NIF (a duplicate is AEAT error 3000). Two
 * filings with the IDENTICAL huella necessarily share (NIF, "A/1", date), which under ONE tenant
 * violates that unique — verified by receipt: the same basket on a second node of ONE tenant fails
 * `chain.append_contention` (the retried identity-unique violation). A DIFFERENT tenant_id lets both
 * `A/1` rows coexist, while re-registering this venue's node SIF under tenant A's `nif` makes
 * `IDEmisorFactura` — hence the huella input — identical. This mirrors `fiscal-verifactu`'s own
 * `entorno is not part of the huella` proof, which files two same-huella records from two fresh tenants
 * sharing a FIXED `IDEmisorFactura` (verify.test.ts + testing/seed.ts's `TEST_NIF` / `altaFor`).
 *
 * `setupVenue` provisions tenant B fully (tenant, node, series "A" at next_number 1, catalogue, till,
 * and its OWN SIF under its OWN nif); `registerSif` then RE-registers node B under `nif`, which also
 * resets node B's chain head so its first sale is a primer_registro. It mints a fresh installation
 * number under (`nif`, "W1") — "W1" is `WAITRON_ID_SISTEMA` (`@waitron/fiscal-verifactu`, the id the
 * fiscal seed registers under; inlined so the literal reads beside the tuple it keys), and NONE of
 * the SIF identity (IdSistemaInformatico / NumeroInstalacion) enters `computeHuella`
 * (huella.ts:45-58 hashes eight invoice fields only), so the
 * distinct installation numbers do not move the huella. The re-registration is LOAD-BEARING and proven
 * by deletion: remove it and tenant B keeps `setupVenue`'s own-nif SIF, so its filing carries a
 * DIFFERENT `IDEmisorFactura` and the two huellas diverge (verified: `D251…` vs the walk-up's `1E79…`)
 * — it is the shared NIF, not tenant identity, that the matching huella depends on.
 */
async function secondVenueSharingNif(nif: string): Promise<SeededVenue> {
  const venue = await setupVenue();
  await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
    await registerSif(tx, {
      tenantId: venue.cfg.tenantId,
      nodeId: venue.cfg.nodeId,
      nif,
      idSistemaInformatico: "W1",
    });
  });
  return venue;
}

/** The filed huella for a working order's sale — owner read (bypasses RLS). */
async function filedHuella(workingOrderId: string): Promise<string> {
  const { rows } = await suite.admin.execute<{ huella: string }>(sql`
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
    const deps = { db: suite.admin, backend, clock: clockFixed };

    // Tenant A — a WALK-UP, no table → A/1, primer_registro, filed under A's own NIF.
    const { cfg: cfgA, cafe: cafeA } = await setupVenue();
    const nifA = await nifOf(cfgA);
    const walkUpId = randomUUID();
    await payWorkingOrder(deps, cfgA, {
      id: walkUpId,
      lines: [{ productId: cafeA.id, quantity: "1" }],
      tender: { method: "cash", amount: "5.00" },
    });

    // Tenant B (a SEPARATE tenant SHARING A's NIF, series "A") — a TAB on a table (dining_tables.tab_id
    // → the order) → also A/1, primer_registro. A distinct tenant_id lets both `A/1` rows coexist under
    // the node-agnostic `registros_identidad_uq`; the shared NIF makes IDEmisorFactura — hence the
    // huella input — identical. (A second NODE of ONE tenant cannot: it collides on that unique, which
    // is the receipt `secondVenueSharingNif` documents.)
    const { cfg: cfgB, cafe: cafeB } = await secondVenueSharingNif(nifA);
    const tableId = await seedTable(cfgB, "H2-tab");
    const { tabId } = await withTenant(suite.admin, cfgB.tenantId, async (tx) => {
      await asAppUser(tx);
      return openTab(tx, cfgB, { tableId, lines: [{ productId: cafeB.id, quantity: "1" }] });
    });
    await payWorkingOrder(deps, cfgB, {
      id: tabId,
      lines: [],
      tender: { method: "cash", amount: "5.00" },
    });

    // Non-vacuity control (mirrors the `entorno is not part of the huella` precedent's read-back): the
    // two orders GENUINELY differ in table-ness — the TAB order is pointed at by a `dining_tables` row,
    // the WALK-UP order by none. Owner reads (bypass RLS; the uuids are globally unique, so the
    // cross-tenant count is exact). Without this, a regression where `openTab` stopped setting `tab_id`
    // would leave both filings table-less and make the equality below vacuously true.
    const tabPointers = await suite.admin.execute<{ n: string }>(
      sql`select count(*)::text as n from dining_tables where tab_id = ${tabId}`,
    );
    const walkUpPointers = await suite.admin.execute<{ n: string }>(
      sql`select count(*)::text as n from dining_tables where tab_id = ${walkUpId}`,
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
    expect(await filedHuella(tabId)).toBe(await filedHuella(walkUpId));
  });
});

/** The delivery_table_id stamped on a working order — owner read. */
async function deliveryTableOf(workingOrderId: string): Promise<string | null> {
  const { rows } = await suite.admin.execute<{ d: string | null }>(
    sql`select delivery_table_id as d from working_orders where id = ${workingOrderId}`,
  );
  return rows[0]!.d;
}

describe("counter delivery (deliveryTableId on a walk-up sale)", () => {
  it("records delivery_table_id on the walk-up order and files one sale (it is NOT a tab)", async () => {
    const { cfg, cafe } = await setupVenue();
    const tableId = await seedTable(cfg, "Del-1");
    const deps = { db: suite.admin, backend, clock };

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
    const { rows } = await suite.admin.execute<{ n: string }>(
      sql`select count(*)::text as n from dining_tables where tab_id = ${id}`,
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it("a deliveryTableId naming no table is refused table.not_found (a domain 4xx, not a raw 500)", async () => {
    const { cfg, cafe } = await setupVenue();
    const deps = { db: suite.admin, backend, clock };
    const orderId = randomUUID();
    const missingTableId = randomUUID(); // a well-formed uuid that names no dining table

    // The FK `working_orders_delivery_table_fk` (23503) is the DB backstop; the app pre-check surfaces
    // the actionable domain code instead of the opaque `server.internal` 500 a raw 23503 would become.
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
    const { rows } = await suite.admin.execute<{ n: string }>(
      sql`select count(*)::text as n from working_orders where id = ${orderId}`,
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
    const deps = { db: suite.admin, backend, clock: clockFixed };

    // Tenant A — a counter sale DELIVERED to a table → A/1, primer_registro, filed under A's own NIF.
    const { cfg: cfgA, cafe: cafeA } = await setupVenue();
    const nifA = await nifOf(cfgA);
    const tableA = await seedTable(cfgA, "H2col-A");
    const deliveredId = randomUUID();
    await recordTillSale(deps, cfgA, {
      workingOrderId: deliveredId,
      lines: [{ productId: cafeA.id, quantity: "1" }],
      tender: { method: "cash", amount: "5.00" },
      deliveryTableId: tableA,
    });

    // Tenant B (a SEPARATE tenant SHARING A's NIF, series "A") — a plain walk-up, NO delivery table →
    // also A/1, primer_registro. The shared NIF makes IDEmisorFactura — hence the huella input —
    // identical; a distinct tenant_id lets both `A/1` rows coexist under the node-agnostic
    // `registros_identidad_uq` (the same trick `secondVenueSharingNif` documents for the tab H2 test).
    const { cfg: cfgB, cafe: cafeB } = await secondVenueSharingNif(nifA);
    const walkUpId = randomUUID();
    await recordTillSale(deps, cfgB, {
      workingOrderId: walkUpId,
      lines: [{ productId: cafeB.id, quantity: "1" }],
      tender: { method: "cash", amount: "5.00" },
    });

    // Non-vacuity control: the two orders GENUINELY differ in the one column under test — A carries the
    // real table, B carries NULL. Owner reads (bypass RLS; the uuids are globally unique).
    expect(await deliveryTableOf(deliveredId)).toBe(tableA);
    expect(await deliveryTableOf(walkUpId)).toBe(null);

    // Same NIF + same "A/1" + same fixed timestamp + same amount + both primer_registro, differing ONLY
    // in delivery_table_id ⇒ identical huella. This is the EMPIRICAL proof — possible for the first time
    // now the column is settable — that the newly-threaded delivery_table_id does NOT leak into the hash:
    // two rows differing solely in it hash alike (the fiscal core never reads it, per the Step-1 grep).
    expect(await filedHuella(deliveredId)).toBe(await filedHuella(walkUpId));
  });
});
