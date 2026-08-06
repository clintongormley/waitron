import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
  listAvailableProducts,
} from "@waitron/catalogue";
import type { AvailableProduct } from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import { asAppUser, withTenant } from "@waitron/db";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import type { TillConfig } from "./till-config.js";
import { parkOrder } from "./working-order.js";
import { payWorkingOrder } from "./till-sale.js";
import { startRealPostgres } from "./testing/postgres.js";
import "./errors.js";

// Real Postgres, not PGlite — mandatory for THIS suite (CLAUDE.md §4). The idempotency + concurrency
// properties are exactly what PGlite CANNOT show: it runs every connection as a superuser (bypassing
// the RLS the app role writes under) and serialises every query onto ONE backend, so a "two concurrent
// pays" test there is a FALSE pass, not a weak one. Every distinct-connection race below opens its own
// backend via `suite.pg.connect()`, and `startRealPostgres` THROWS rather than skipping when Docker is
// absent, so a vanished suite fails loudly instead of reporting a green that proves nothing.
const LOCALE = "es-ES";

const suite = useRealPostgres({ start: startRealPostgres, timeoutMs: 180_000 });

let backend: FiscalBackend;
let clock: TrustedClock;

/** The system wall clock, reported confident/anchored — the identical stub `till-sale.test.ts` uses. */
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
      throw new Error("working-order.rls.test: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the same shape `till-sale.test.ts`/`provision-till.test.ts` use.
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
  };
}

interface SeededVenue {
  cfg: TillConfig;
  available: AvailableProduct[];
  /** "Café" — each, 1.50 gross, general(21%). */
  cafe: AvailableProduct;
  /** "Agua" — each, 2.00 gross, general(21%). Same rate as café, so a two-line basket has one VAT group. */
  agua: AvailableProduct;
}

/**
 * Stand up a fresh chained venue + registered SIF (as the owner), then seed a catalogue as the app
 * role and read back two `each`/general(21%) products. Each test gets its OWN tenant so its sale /
 * registro counts are order-independent (CLAUDE.md §4).
 */
async function setupVenue(): Promise<SeededVenue> {
  const venue = await applyVenue(
    planVenue({
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
      admin: { displayName: "Administradora", pinHash: hashPin("1234") },
    }),
    { db: suite.admin },
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
    return listAvailableProducts(tx, cfg.locationId);
  });
  const cafe = available.find((p) => p.descriptions[LOCALE] === "Café")!;
  const agua = available.find((p) => p.descriptions[LOCALE] === "Agua")!;
  return { cfg, available, cafe, agua };
}

/** How many `sales` rows reference this working order — read as the superuser owner (bypasses RLS). */
async function saleCount(workingOrderId: string): Promise<number> {
  const { rows } = await suite.admin.execute<{ count: string }>(sql`
    select count(*)::text as count from sales where working_order_id = ${workingOrderId}
  `);
  return Number(rows[0]!.count);
}

/** How many chained `registros_facturacion` rows exist for this working order's sale (superuser read). */
async function registroCount(workingOrderId: string): Promise<number> {
  const { rows } = await suite.admin.execute<{ count: string }>(sql`
    select count(*)::text as count
    from registros_facturacion r
    join sales s on s.id = r.sale_id
    where s.working_order_id = ${workingOrderId}
  `);
  return Number(rows[0]!.count);
}

/** The working order's own state — status + whether settled_at is set (the biconditional's witness). */
async function orderState(id: string): Promise<{ status: string; settledAtSet: boolean }> {
  const { rows } = await suite.admin.execute<{ status: string; settled: boolean }>(sql`
    select status, (settled_at is not null) as settled from working_orders where id = ${id}
  `);
  return { status: rows[0]!.status, settledAtSet: rows[0]!.settled };
}

beforeAll(() => {
  clock = systemClock();
  backend = new VerifactuBackend({
    clock,
    db: suite.admin,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(
        new Error("working-order.rls.test: resolveClient must never be called by recordSale"),
      ),
  });
});

describe("payWorkingOrder", () => {
  it("walk-up: creates an open working order, files, and settles it in one tx", async () => {
    const { cfg, cafe } = await setupVenue();
    const id = randomUUID();

    const res = await payWorkingOrder({ db: suite.admin, backend, clock }, cfg, {
      id,
      lines: [{ productId: cafe.id, quantity: "1" }],
      tender: { method: "cash", amount: "5.00" },
    });

    // First sale of a fresh venue's series → A/1. Change is 5.00 tendered − 1.50.
    expect(res.invoiceNumber).toBe("A/1");
    expect(res.total).toBe("1.50");
    expect(res.change).toBe("3.50");
    expect(res.vatBreakdown).toEqual([{ rate: "21.00", base: "1.24", tax: "0.26" }]);

    // The working order was created AND settled in the one transaction; exactly one sale + one
    // registro reference it.
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
  });

  it("parked: pays an existing open order at CURRENT prices and settles it", async () => {
    const { cfg, cafe, agua } = await setupVenue();
    const id = randomUUID();

    // Park an open order (its stored draft lines are café×1), then PAY a DIFFERENT current basket
    // (café×1 + agua×1). The pay re-prices what is SENT, not the stored draft (spec §3/§4).
    await parkOrder({ db: suite.admin }, cfg, {
      id,
      lines: [{ productId: cafe.id, quantity: "1" }],
      label: "Mesa 4",
    });
    expect(await orderState(id)).toEqual({ status: "open", settledAtSet: false });

    const res = await payWorkingOrder({ db: suite.admin, backend, clock }, cfg, {
      id,
      lines: [
        { productId: cafe.id, quantity: "1" },
        { productId: agua.id, quantity: "1" },
      ],
      tender: { method: "cash", amount: "5.00" },
    });

    // 1.50 + 2.00 = 3.50 gross (the CURRENT basket), not the parked 1.50.
    expect(res.total).toBe("3.50");
    expect(res.change).toBe("1.50");
    expect(res.invoiceNumber).toBe("A/1");
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
  });

  it("idempotent replay: a second pay with the same id returns the SAME ticket and files no second record", async () => {
    const { cfg, cafe, agua } = await setupVenue();
    const id = randomUUID();
    const req = {
      id,
      // Two lines at the SAME rate (21%), so the replayed VAT desglose is reconstructed by SUMMING
      // both lines' bases into one group.
      lines: [
        { productId: cafe.id, quantity: "1" },
        { productId: agua.id, quantity: "1" },
      ],
      tender: { method: "cash" as const, amount: "10.00" },
    };
    const deps = { db: suite.admin, backend, clock };

    const first = await payWorkingOrder(deps, cfg, req);
    // The retry — same id, same body. Files NOTHING; returns the first ticket.
    const second = await payWorkingOrder(deps, cfg, req);

    expect(second.invoiceNumber).toBe(first.invoiceNumber);
    expect(second.total).toBe(first.total);
    expect(second.issuedAt).toBe(first.issuedAt);
    expect(second.vatBreakdown).toEqual(first.vatBreakdown);
    // Replay ticket: change is 0.00 (the drawer change was handed over at the original sale) and the
    // QR is empty (a documented limitation — it lives only on the inaccessible fiscal record).
    expect(second.change).toBe("0.00");
    expect(second.qr).toBe("");

    // The unrepairable double-file the whole task exists to prevent: STILL exactly one sale + one
    // registro after the retry.
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
  });

  it("concurrent double-pay of a PARKED order files ONE sale (two connections, same id)", async () => {
    const { cfg, cafe } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db: suite.admin }, cfg, {
      id,
      lines: [{ productId: cafe.id, quantity: "1" }],
    });

    // TWO distinct backends racing on ONE order id. Load-bearing: distinct backend PROCESSES — on
    // PGlite these collapse onto one and the race never happens (a false pass).
    const [connA, connB] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
    try {
      const pids = await Promise.all(
        [connA, connB].map(async (db) => {
          const { rows } = await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
          return rows[0]!.pid;
        }),
      );
      expect(new Set(pids).size).toBe(2);

      const req = {
        id,
        lines: [{ productId: cafe.id, quantity: "1" }],
        tender: { method: "cash" as const, amount: "5.00" },
      };
      // Both race past `payWorkingOrder`. The FOR UPDATE lock serialises them: one settles, the other
      // blocks then sees `settled` and REPLAYS. Neither errors.
      const [resA, resB] = await Promise.all([
        payWorkingOrder({ db: connA, backend, clock }, cfg, req),
        payWorkingOrder({ db: connB, backend, clock }, cfg, req),
      ]);

      // Same ticket from both; exactly ONE sale and ONE registro — the loser replayed, did not file.
      expect(resA.invoiceNumber).toBe(resB.invoiceNumber);
      expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
      expect(await saleCount(id)).toBe(1);
      expect(await registroCount(id)).toBe(1);
    } finally {
      await Promise.all([connA.close(), connB.close()]);
    }
  });

  it("concurrent double-pay of a WALK-UP (no prior row) files ONE sale — the 23505 backstop", async () => {
    const { cfg, cafe } = await setupVenue();
    // A fresh id with NO parked order: the FOR UPDATE locks nothing (there is no row), so the
    // concurrent backstop here is the 23505 catch (both create-then-file; the loser collides on
    // `working_orders_pkey`, catches it, and replays the winner's sale).
    const id = randomUUID();

    const [connA, connB] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
    try {
      const req = {
        id,
        lines: [{ productId: cafe.id, quantity: "1" }],
        tender: { method: "cash" as const, amount: "5.00" },
      };
      const [resA, resB] = await Promise.all([
        payWorkingOrder({ db: connA, backend, clock }, cfg, req),
        payWorkingOrder({ db: connB, backend, clock }, cfg, req),
      ]);

      expect(resA.invoiceNumber).toBe(resB.invoiceNumber);
      expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
      expect(await saleCount(id)).toBe(1);
      expect(await registroCount(id)).toBe(1);
    } finally {
      await Promise.all([connA.close(), connB.close()]);
    }
  });

  it("refuses paying an ABANDONED order (working_order.not_open) and files nothing", async () => {
    const { cfg, cafe } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db: suite.admin }, cfg, {
      id,
      lines: [{ productId: cafe.id, quantity: "1" }],
    });
    // Abandon it (open → abandoned), then try to pay.
    await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await tx.execute(sql`update working_orders set status = 'abandoned' where id = ${id}`);
    });

    await expect(
      payWorkingOrder({ db: suite.admin, backend, clock }, cfg, {
        id,
        lines: [{ productId: cafe.id, quantity: "1" }],
        tender: { method: "cash", amount: "5.00" },
      }),
    ).rejects.toMatchObject({ code: "working_order.not_open", params: { workingOrderId: id } });

    expect(await saleCount(id)).toBe(0);
    expect(await registroCount(id)).toBe(0);
  });

  it("refuses an unknown product in a parked pay's basket, leaving the order open and nothing filed", async () => {
    const { cfg, cafe } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db: suite.admin }, cfg, {
      id,
      lines: [{ productId: cafe.id, quantity: "1" }],
    });
    const UUID_NOT_IN_CAT = "00000000-0000-0000-0000-000000000000";

    // A parked pay re-prices the SENT basket; an unknown product there is refused at the filing step
    // (the order already exists, so `createOpenOrder` is skipped and this is the first pricing).
    await expect(
      payWorkingOrder({ db: suite.admin, backend, clock }, cfg, {
        id,
        lines: [{ productId: UUID_NOT_IN_CAT, quantity: "1" }],
        tender: { method: "cash", amount: "5.00" },
      }),
    ).rejects.toMatchObject({
      code: "sale.unknown_product",
      params: { productId: UUID_NOT_IN_CAT },
    });

    // The refusal aborts the transaction: the parked order is untouched (still open) and no sale filed.
    expect(await orderState(id)).toEqual({ status: "open", settledAtSet: false });
    expect(await saleCount(id)).toBe(0);
    expect(await registroCount(id)).toBe(0);
  });

  it("refuses an empty basket and a non-cash tender directly (payWorkingOrder guards its own filing path)", async () => {
    const { cfg, cafe } = await setupVenue();
    const deps = { db: suite.admin, backend, clock };

    await expect(
      payWorkingOrder(deps, cfg, {
        id: randomUUID(),
        lines: [],
        tender: { method: "cash", amount: "0" },
      }),
    ).rejects.toMatchObject({ code: "sale.empty_basket" });

    await expect(
      payWorkingOrder(deps, cfg, {
        id: randomUUID(),
        lines: [{ productId: cafe.id, quantity: "1" }],
        tender: { method: "card" as unknown as "cash", amount: "1.50" },
      }),
    ).rejects.toMatchObject({ code: "sale.unsupported_tender", params: { method: "card" } });
  });
});
