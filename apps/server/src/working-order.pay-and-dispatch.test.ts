import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
  EACH_UNIT,
  listAvailableProducts,
} from "@waitron/catalogue";
import type { AvailableProduct } from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import {
  diningTables,
  nodes,
  nowIso,
  orderAmendments,
  saleLines,
  sales,
  tills,
  verifyAmendmentChain,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction, VerifiableAmendment } from "@waitron/db";
import { listOutstandingSales } from "@waitron/core";
import {
  addDecimal,
  decimal,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  rawCentsToDecimal,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import { readOrderFlow } from "./till-config.js";
import type { OrderFlow, TillConfig } from "./till-config.js";
import {
  abandonHeldOrder,
  addTabRound,
  advanceTicket,
  advanceTicketItem,
  cancelPlacedOrder,
  fireCourse,
  getHeldOrder,
  listExpoQueue,
  listHeldOrders,
  listStationQueue,
  markCollected,
  openTab,
  parkOrder,
  placeOrder,
  recallLines,
  sendLines,
  sendToPrep,
  setLineCourse,
  updateHeldOrder,
} from "./working-order.js";
import { createCourse, setProductCourse } from "./kitchen.js";
import { createPrinter } from "@waitron/printing";
import type { PrintConfig } from "@waitron/printing";
import { attachPrinterToStation } from "./station-printers.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { offerProducts } from "./testing/zone-offers.js";
import { collectOrder, payWorkingOrder } from "./till-sale.js";
import "./errors.js";

// The working-order verbs driven on a venue provisioned through `applyVenue`, with a real
// `VerifactuBackend` on the settle path, so a case here can follow an order through
// pay/place/collect to the record it files and on to the kitchen queue.
//
// The overlapping-call cases start both calls on one handle, and `withTransaction` IS the write
// lock (`packages/db/src/tenancy.ts`), so the second body runs only after the first has committed.
// They pin the OUTCOME (one sale filed, one order parked, a fired line never re-coursed, a held line
// never left without its RECALLED slip) and that the second call reaches its replay or refusal
// branch; they cannot observe two writers genuinely overlapping. The queue runs the bodies in the
// order handed to it, so each coursing case reaches only ONE of its two outcomes.
const LOCALE = "es-ES";
// A filed line freezes the unit's ABBREVIATION as its printed label, not the unit's name — so the
// legacy `each` unit files as its short form (`ea`/`ud`/`u`), matching `seedLegacySellingUnits`.
const EACH_UNIT_SNAPSHOT = {
  unitName: { en: "ea", es: "ud", ca: "u", gl: "u", eu: "u" },
  unitPrecision: 0,
} as const;

// The accountable operator every placing/cancel amendment is attributed to. `order_amendments.actor_id`
// is a plain uuid with NO FK (the sale_voids.voided_by shape), so a fixed fixture uuid stands in for
// the session's `personId` the till supplies in production — the value is only ever compared, never
// joined.
const OPERATOR = "0000ffff-2222-4000-8000-0000000000aa";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

let backend: FiscalBackend;
let clock: TrustedClock;

/** The system wall clock, reported confident/anchored. */
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
      throw new Error("working-order.pay-and-dispatch.test: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

// `tenants_country_tax_id_key` is unique (`packages/db/drizzle/0000_baseline.sql:38`), so each
// provisioned venue takes its own NIF.
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
    tipsEnabled: false,
    // The venue provisions with the DEFAULT `prepay` mode; a mode-specific test overrides both the
    // cfg field AND the location's `order_flow` column via `modeVenue` (below).
    orderFlow: "prepay",
  };
}

/** A product and the counter zone's offer of it — `menuItemId` is what a sale line names. */
type OfferedProduct = AvailableProduct & { menuItemId: string };

interface SeededVenue {
  cfg: TillConfig;
  available: AvailableProduct[];
  /** The venue's counter-default zone, whose mode matches `cfg.orderFlow`. */
  zoneId: string;
  /** "Café" — each, 1.50 gross, general(21%). */
  cafe: OfferedProduct;
  /** "Agua" — each, 2.00 gross, general(21%). Same rate as café, so a two-line basket has one VAT group. */
  agua: OfferedProduct;
}

/**
 * Stand up a fresh chained venue + registered SIF, then seed a catalogue and read back two
 * `each`/general(21%) products. Each test gets its OWN tenant so its sale / registro counts are
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
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );

  const cfg = tillConfigFromVenue(venue);
  const available = await withTransaction(suite.db, async (tx) => {
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
  return offerAtCounter(cfg, available);
}

async function offerAtCounter(
  cfg: TillConfig,
  available: AvailableProduct[],
): Promise<SeededVenue> {
  const offers = await withTransaction(suite.db, (tx) => offerProducts(tx, cfg));
  const offered = (name: string): OfferedProduct => {
    const product = available.find((p) => p.name === name)!;
    return { ...product, menuItemId: offers.offerFor(product.id) };
  };
  return {
    cfg,
    available,
    zoneId: offers.zoneId,
    cafe: offered("Café"),
    agua: offered("Agua"),
  };
}

/**
 * A fresh venue set to a specific pay-timing `mode`: `setupVenue` provisions with the DEFAULT
 * `prepay` (planVenue has no mode input), then this flips the location's `order_flow` column to
 * `mode`, sets `cfg.orderFlow` to match, and sets the counter zone to `mode` too — a zoned order's
 * pay timing is its zone's (`serviceContext?.serviceMode ?? cfg.orderFlow`, till-sale.ts), so all
 * three agree.
 */
async function modeVenue(mode: OrderFlow): Promise<SeededVenue> {
  const venue = await setupVenue();
  await suite.db.execute(
    sql`update locations set order_flow = ${mode} where id = ${venue.cfg.locationId}`,
  );
  return offerAtCounter({ ...venue.cfg, orderFlow: mode }, venue.available);
}

/** The OUTSTANDING (issued-but-unsettled) sales — the surface an invoice-first order shows on
 *  between placing and collect. */
async function outstanding(): Promise<{ saleId: string; amountDue: string }[]> {
  return withTransaction(suite.db, async (tx) => {
    const rows = await listOutstandingSales(tx);
    return rows.map((r) => ({ saleId: r.saleId, amountDue: r.amountDue }));
  });
}

/** How many `sales` rows reference this working order. */
async function saleCount(workingOrderId: string): Promise<number> {
  const { rows } = await suite.db.execute<{ count: string }>(sql`
    select cast(count(*) as text) as count from sales where working_order_id = ${workingOrderId}
  `);
  return Number(rows[0]!.count);
}

/**
 * The IMMUTABLE filed `sales.total` for this working order's sale. The witness that a retrieved
 * order files at the LOCKED price, not a re-price at pay.
 */
async function filedSaleTotal(workingOrderId: string): Promise<string> {
  const { rows } = await suite.db.execute<{ total: string }>(sql`
    select cast(total as text) as total from sales where working_order_id = ${workingOrderId}
  `);
  return rawCentsToDecimal(rows[0]!.total);
}

/**
 * The frozen printed unit label on this order's filed line, read straight from the persisted
 * tables: the working-order line where the add-time freeze writes it, and the sale line the filing
 * copies it onto. The witness that the freeze puts the unit's ABBREVIATION (its short form), not
 * the unit's full name, onto a filed line.
 */
async function frozenUnitLabels(
  workingOrderId: string,
): Promise<{ workingOrderLine: Record<string, string>; saleLine: Record<string, string> }> {
  // Through the Drizzle exports, not raw SQL: `unit_name` is a `json` column, and a raw `select`
  // reaches no column mapping, so the value arrives as the stored TEXT rather than the name map the
  // caller compares.
  const orderLine = await suite.db
    .select({ unitName: workingOrderLines.unitName })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, workingOrderId));
  const saleLine = await suite.db
    .select({ unitName: saleLines.unitName })
    .from(saleLines)
    .innerJoin(sales, eq(sales.id, saleLines.saleId))
    .where(eq(sales.workingOrderId, workingOrderId));
  return {
    workingOrderLine: orderLine[0]!.unitName!,
    saleLine: saleLine[0]!.unitName!,
  };
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

/**
 * The tenders filed against this working order's sale — method + amount. Ordered by method so a
 * multi-tender assertion is stable.
 */
async function tendersFor(workingOrderId: string): Promise<{ method: string; amount: string }[]> {
  const { rows } = await suite.db.execute<{ method: string; amount: string }>(sql`
    select t.method, cast(t.amount as text) as amount
    from tenders t
    join sales s on s.id = t.sale_id
    where s.working_order_id = ${workingOrderId}
    order by t.method
  `);
  return rows.map((r) => ({ method: r.method, amount: rawCentsToDecimal(r.amount) }));
}

/**
 * The `payments` rows for this working order — provider/state/amount, plus whether `sale_id`
 * actually points at the filed sale (the association witness). The inner join to `sales` on
 * `working_order_id` (unique per sale) is how `linkedToSale` compares the payment's `sale_id`
 * against the ONE sale filed from this order.
 */
async function paymentsFor(
  workingOrderId: string,
): Promise<{ provider: string; state: string; amount: string; linkedToSale: boolean }[]> {
  const { rows } = await suite.db.execute<{
    provider: string;
    state: string;
    amount: string;
    linked: number;
  }>(sql`
    -- payments.amount counts whole cents, read raw and converted by rawCentsToDecimal in the
    -- mapping below, which returns the amount the callers assert on.
    -- The "linked" column is a SQL comparison, so this engine answers it with the integer 1 or 0 and
    -- no column mapping stands between that and the caller; the mapping below turns it into the
    -- boolean the toEqual assertions pin.
    select p.provider, p.state, cast(p.amount as text) as amount,
           (p.sale_id is not null and p.sale_id = s.id) as linked
    from payments p
    join sales s on s.working_order_id = p.working_order_id
    where p.working_order_id = ${workingOrderId}
    order by p.provider
  `);
  return rows.map((r) => ({
    provider: r.provider,
    state: r.state,
    amount: rawCentsToDecimal(r.amount),
    linkedToSale: r.linked === 1,
  }));
}

/** How many `payments` rows exist for this working order — the idempotency witness:
 *  a card lost-response retry must not file a SECOND captured payment. */
async function paymentCount(workingOrderId: string): Promise<number> {
  const { rows } = await suite.db.execute<{ count: string }>(sql`
    select cast(count(*) as text) as count from payments where working_order_id = ${workingOrderId}
  `);
  return Number(rows[0]!.count);
}

/** The working order's own state — status + whether settled_at is set (the biconditional's witness). */
async function orderState(id: string): Promise<{ status: string; settledAtSet: boolean }> {
  // Through the Drizzle export: a raw `(settled_at is not null)` is 0 or 1 on this engine, and the
  // `toEqual` assertions below pin `true`/`false`. Reading the column itself and testing it in
  // JavaScript is the same question with no cast in the way.
  const rows = await suite.db
    .select({ status: workingOrders.status, settledAt: workingOrders.settledAt })
    .from(workingOrders)
    .where(eq(workingOrders.id, id));
  return { status: rows[0]!.status, settledAtSet: rows[0]!.settledAt !== null };
}

/** Whether this order's `collected_at` (customer-handover) marker is set. The witness that the
 *  collect flow stamped the ORDER-level marker `listStationQueue` excludes on (§3e): a placed order
 *  fired to a station leaves that station's queue once `collectOrder` sets it. Kept separate from
 *  {@link orderState} (whose `toEqual` assertions pin exactly `{status, settledAtSet}`). */
async function collectedAtSet(id: string): Promise<boolean> {
  // Through the Drizzle export, for the reason {@link orderState} gives.
  const rows = await suite.db
    .select({ collectedAt: workingOrders.collectedAt })
    .from(workingOrders)
    .where(eq(workingOrders.id, id));
  return rows[0]!.collectedAt !== null;
}

/**
 * This order's whole amendment chain, read back as verifiable rows in chain-position order (a
 * read-back for verification, not part of the behaviour under test).
 *
 * Through the Drizzle export rather than raw SQL, for the two reasons `append-order-amendment.test.ts`
 * records against its own copy of this helper: a raw `select` of `is_first_entry` returns 0 or 1
 * where `verifyAmendmentChain` compares it against a boolean with `!==`
 * (`packages/db/src/order-amendment-hash.ts`), and `event_at` needs no projection at all — it is
 * a `tsString` column holding the exact ISO instant `appendOrderAmendment` truncated to whole
 * seconds, which a CHECK constraint pins (`packages/db/src/schema/order-amendments.ts`).
 */
async function readAmendments(id: string): Promise<VerifiableAmendment[]> {
  return suite.db
    .select({
      sequenceNo: orderAmendments.sequenceNo,
      workingOrderId: orderAmendments.workingOrderId,
      kind: orderAmendments.kind,
      actorId: orderAmendments.actorId,
      reason: orderAmendments.reason,
      capturedByTillId: orderAmendments.capturedByTillId,
      capturedByNodeId: orderAmendments.capturedByNodeId,
      eventAt: orderAmendments.eventAt,
      eventOffsetMinutes: orderAmendments.eventOffsetMinutes,
      entryHash: orderAmendments.entryHash,
      prevEntryHash: orderAmendments.prevEntryHash,
      isFirstEntry: orderAmendments.isFirstEntry,
    })
    .from(orderAmendments)
    .where(eq(orderAmendments.workingOrderId, id))
    .orderBy(asc(orderAmendments.sequenceNo));
}

/** The kitchen state of the ticket item fired for this SINGLE-line order, or null when none was
 *  fired. Placing (Modes I/T, inside `placeOrder`) and send-to-prep (Mode P) fire one
 *  `ticket_items` row per line (KDS-1); a walk-up never fires. The callers here fire SINGLE-line
 *  orders, so at most one row exists. */
async function ticketStateOf(id: string): Promise<string | null> {
  const { rows } = await suite.db.execute<{ state: string }>(sql`
    select state from ticket_items where working_order_id = ${id}
  `);
  return rows[0]?.state ?? null;
}

/** The venue's default kitchen station id (`applyVenue` seeds one "Cocina" per location —
 *  venue-apply.ts). No fixture product names a station, itself or through its category, so the
 *  routes `offerProducts` writes send every line here; it is the id the whole-ticket bump and the
 *  per-station queue address. */
async function defaultStationId(cfg: TillConfig): Promise<string> {
  const { rows } = await suite.db.execute<{ id: string }>(sql`
    select id from kitchen_stations
    where location_id = ${cfg.locationId} and is_default and active
  `);
  return rows[0]!.id;
}

/** The ticket item ids fired for an order, in `line_no` order. The per-line bump targets for
 *  {@link advanceTicketItem}, addressed by index the way the display taps a specific line. */
async function ticketItemIdsFor(orderId: string): Promise<string[]> {
  const { rows } = await suite.db.execute<{ id: string }>(sql`
    select ti.id
    from ticket_items ti
    join working_order_lines wol
      on wol.id = ti.working_order_line_id
    where ti.working_order_id = ${orderId}
    order by wol.line_no
  `);
  return rows.map((r) => r.id);
}

/**
 * Run one of the tx-based KDS verbs (advanceTicketItem/advanceTicket/listStationQueue) in a
 * `withTransaction` scope — they run on a CALLER-supplied transaction.
 */
async function asTenant<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  void cfg;
  return withTransaction(suite.db, async (tx) => {
    return fn(tx);
  });
}

/**
 * A SECOND register on the SAME node — a `cfg` that shares `cfg`'s node, series and location and
 * differs only in `till_id`. Proving cross-till retrieval needs a genuine second till row because both
 * `working_orders.till_id` and `sales.till_id` FK onto `tills` — a fabricated uuid would fail
 * those.
 */
async function addTill(cfg: TillConfig, name: string): Promise<TillConfig> {
  const id = randomUUID();
  await withTransaction(suite.db, async (tx) => {
    // Through the table, not a raw `insert`: `tills.created_at` is supplied by a `$defaultFn` in
    // JavaScript rather than by a SQL DEFAULT, so a raw insert naming only the other three columns is
    // refused `NOT NULL constraint failed: tills.created_at`. `id` is a `$defaultFn` too and is
    // passed explicitly here because the caller needs the value back.
    await tx.insert(tills).values({ id, locationId: cfg.locationId, name });
  });
  return { ...cfg, tillId: brandTillId(id) };
}

/**
 * The deployment holds one tenant per database. A SECOND node under the SAME tenant + location —
 * a `cfg` differing only in `node_id`. It never sells here; it exists so reads run under it prove
 * they are venue-wide (till-reroute §3.6): a node reaches the venue's open tabs regardless of the
 * `node_id` they carry. `filing_module`/`tax_module` are nullable and unused for a listing-only node, so left out.
 */
async function addNode(cfg: TillConfig, name: string): Promise<TillConfig> {
  const id = randomUUID();
  await withTransaction(suite.db, async (tx) => {
    // Through the table, for the reason {@link addTill} gives: `nodes.created_at` is a `$defaultFn`.
    await tx.insert(nodes).values({ id, locationId: cfg.locationId, name });
  });
  return { ...cfg, nodeId: brandNodeId(id) };
}

/**
 * A parked order's line count and summed `line_total` (the GROSS draft total the held list shows) —
 * read and summed in JS, NOT the SQL `listHeldOrders` runs, so its `itemCount`/`total` aggregate is
 * validated rather than restated (CLAUDE.md §1). `line_total` counts whole cents, read raw and
 * converted per row by `rawCentsToDecimal`, then added exactly — giving the amount the caller
 * compares with the list's. The empty case is "0.00", the same literal `listHeldOrders` renders for
 * an order with no lines.
 */
async function draftAggregate(id: string): Promise<{ itemCount: number; total: string }> {
  const { rows } = await suite.db.execute<{ line_total: string }>(sql`
    select cast(line_total as text) as line_total from working_order_lines where working_order_id = ${id}
  `);
  const total = rows.reduce<Decimal>(
    (sum, r) => addDecimal(sum, rawCentsToDecimal(r.line_total)),
    decimal("0.00"),
  );
  return { itemCount: rows.length, total };
}

/**
 * The till the SALE was filed under vs the till the working order was PARKED under — the
 * cross-till witness (parked on A, sold on B).
 */
async function saleAndOrderTill(
  workingOrderId: string,
): Promise<{ saleTillId: string; orderTillId: string }> {
  const sale = await suite.db.execute<{ till_id: string }>(sql`
    select till_id from sales where working_order_id = ${workingOrderId}`);
  const order = await suite.db.execute<{ till_id: string }>(sql`
    select till_id from working_orders where id = ${workingOrderId}`);
  return { saleTillId: sale.rows[0]!.till_id, orderTillId: order.rows[0]!.till_id };
}

beforeAll(() => {
  clock = systemClock();
  backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(
        new Error(
          "working-order.pay-and-dispatch.test: resolveClient must never be called by recordSale",
        ),
      ),
  });
});

describe("payWorkingOrder", () => {
  it("walk-up: creates an open working order, files, and settles it in one tx", async () => {
    const { cfg, cafe, zoneId } = await setupVenue();
    const id = randomUUID();

    const res = await payWorkingOrder({ db: suite.db, backend, clock }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
      tender: { method: "cash", amount: "5.00" },
    });

    // First sale of a fresh venue's series → A/1. Change is 5.00 tendered − 1.50.
    expect(res.invoiceNumber).toBe("A/1");
    expect(res.total).toBe("1.50");
    expect(res.tender).toEqual({ method: "cash", change: "3.50" });
    expect(res.vatBreakdown).toEqual([{ rate: "21.00", base: "1.24", tax: "0.26" }]);
    // The FILED line list the receipt renders: the priced walk-up composition — name, the
    // display quantity, and the GROSS the line was filed at. Σ(gross) == total.
    expect(res.lines).toEqual([
      {
        descriptions: { [LOCALE]: "Café" },
        quantity: "1",
        gross: "1.50",
        parentLineNo: null,
        optionSnapshots: [],
        ...EACH_UNIT_SNAPSHOT,
      },
    ]);

    // The working order was created AND settled in the one transaction; exactly one sale + one
    // registro reference it.
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
  });

  it("parked: pays the STORED composition at its LOCKED prices and settles it", async () => {
    const { cfg, cafe, agua, zoneId } = await setupVenue();
    const id = randomUUID();

    // Park café×1 + agua×1 — BOTH added, so both gross units are LOCKED onto their `working_order_lines`
    // rows (design §2, line-add snapshot). Then pay the SAME id with NO client basket (`lines: []`): a
    // retrieved order is filed from its STORED locked lines, not a re-price of anything the till sends.
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId,
      lines: [
        { menuItemId: cafe.menuItemId, quantity: "1" },
        { menuItemId: agua.menuItemId, quantity: "1" },
      ],
      label: "Mesa 4",
    });
    expect(await orderState(id)).toEqual({ status: "open", settledAtSet: false });
    // What the customer was shown at park — the GROSS draft total (sum of the locked line totals).
    const parkedTotal = (await draftAggregate(id)).total;
    expect(parkedTotal).toBe("3.50"); // 1.50 café + 2.00 agua, locked

    const res = await payWorkingOrder({ db: suite.db, backend, clock }, cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "5.00" },
    });

    // The LOCKED composition, filed from the stored lines: 1.50 + 2.00 = 3.50. Round-trip invariant —
    // the filed total EQUALS the gross the customer was shown at park (`parkedTotal`).
    expect(res.total).toBe("3.50");
    expect(res.total).toBe(parkedTotal);
    expect(res.tender).toEqual({ method: "cash", change: "1.50" });
    // The receipt line list is the STORED lock, not any client basket the till sent (it
    // sent none). A stored quantity reads back at three places ("1.000") and prints
    // trailing-zero-trimmed ("1").
    expect(res.lines).toEqual([
      {
        descriptions: { [LOCALE]: "Café" },
        quantity: "1",
        gross: "1.50",
        parentLineNo: null,
        optionSnapshots: [],
        ...EACH_UNIT_SNAPSHOT,
      },
      {
        descriptions: { [LOCALE]: "Agua" },
        quantity: "1",
        gross: "2.00",
        parentLineNo: null,
        optionSnapshots: [],
        ...EACH_UNIT_SNAPSHOT,
      },
    ]);
    expect(res.invoiceNumber).toBe("A/1");
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
  });

  it("retrieve → edit → pay files the RE-LOCKED edit, not the pre-edit lock (Finding 2 — no silent drop)", async () => {
    const { cfg, cafe, zoneId } = await setupVenue();
    const id = randomUUID();

    // Park café×1 (locked 1.50) — the composition a retrieve loads onto the till.
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });
    expect((await draftAggregate(id)).total).toBe("1.50");

    // The operator EDITS the retrieved basket (café×1 → café×2); the till re-syncs it BEFORE paying
    // (`updateWorkingOrder` → `updateHeldOrder`), re-locking the new composition. WITHOUT this sync the
    // retrieved-order pay path files the pre-edit lock and the edit is SILENTLY DROPPED (the till-app
    // side is pinned by `retrieve → edit → pay re-syncs …`).
    await updateHeldOrder({ db: suite.db }, cfg, id, {
      revision: await revisionOf(id),
      lines: [{ menuItemId: cafe.menuItemId, quantity: "2" }],
    });
    expect((await draftAggregate(id)).total).toBe("3.00"); // the lock now reflects the edit

    // Pay the retrieved order (no client basket — files from the stored lock, which is now the edit).
    const res = await payWorkingOrder({ db: suite.db, backend, clock }, cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "5.00" },
    });

    // The EDIT is what was charged AND filed: 3.00 (café×2), never the pre-edit 1.50. Its receipt line
    // list carries the edited quantity, and the immutable record's total matches — the edit reached the
    // fiscal record rather than being dropped.
    expect(res.total).toBe("3.00");
    expect(res.tender).toEqual({ method: "cash", change: "2.00" });
    expect(res.lines).toEqual([
      {
        descriptions: { [LOCALE]: "Café" },
        quantity: "2",
        gross: "3.00",
        parentLineNo: null,
        optionSnapshots: [],
        ...EACH_UNIT_SNAPSHOT,
      },
    ]);
    expect(await filedSaleTotal(id)).toBe("3.00");
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
  });

  it("files a parked line at its LOCKED price after the catalogue price changes (line-add snapshot)", async () => {
    const { cfg, cafe, zoneId } = await setupVenue();
    const id = randomUUID();

    // Park café×1 at the locked 1.50 — the gross unit is snapshotted onto the line here.
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });

    // Change the catalogue price AFTER the lock — the exact mutation across the park→pay gap that
    // separates the two pricing models (CLAUDE.md §1: a measurement where both answers look alike
    // measures nothing). A re-price at pay would file 9.99; filing from the lock files 1.50.
    await withTransaction(suite.db, async (tx) => {
      await tx.execute(sql`update products set unit_price = 999 where id = ${cafe.id}`);
    });

    // Pay — files at the LOCKED 1.50, never the new 9.99.
    const res = await payWorkingOrder({ db: suite.db, backend, clock }, cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "5.00" },
    });

    expect(res.total).toBe("1.50"); // the lock, not 9.99
    expect(res.tender).toEqual({ method: "cash", change: "3.50" });
    // The IMMUTABLE fiscal record carries the locked price.
    expect(await filedSaleTotal(id)).toBe("1.50");
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
  });

  it("idempotent replay: a second pay with the same id returns the SAME ticket — filed QR and breakdown, no second record", async () => {
    const { cfg, cafe, agua, zoneId } = await setupVenue();
    const id = randomUUID();
    const req = {
      id,
      zoneId,
      // A DIVERGENCE-PRONE basket at ONE rate (21%): café×1 (gross 1.50 → base 1.24) + agua×2 (gross
      // 4.00 → base 3.31). The FILED difference-method group is base 4.55, tax = 5.50 − 4.55 = 0.95;
      // a naive base×rate recompute gives round(4.55 × 21%) = 0.96 — a DIFFERENT cent.
      lines: [
        { menuItemId: cafe.menuItemId, quantity: "1" },
        { menuItemId: agua.menuItemId, quantity: "2" },
      ],
      tender: { method: "cash" as const, amount: "10.00" },
    };
    const deps = { db: suite.db, backend, clock };

    const first = await payWorkingOrder(deps, cfg, req);
    // The filed breakdown is the difference-method figure (0.95).
    expect(first.total).toBe("5.50");
    expect(first.vatBreakdown).toEqual([{ rate: "21.00", base: "4.55", tax: "0.95" }]);
    expect(first.qr.length).toBeGreaterThan(0); // a genuine first filing carries the AEAT QR
    // The FILED line list: café×1 (gross 1.50) + agua×2 (gross 4.00). Σ(gross) == 5.50.
    expect(first.lines).toEqual([
      {
        descriptions: { [LOCALE]: "Café" },
        quantity: "1",
        gross: "1.50",
        parentLineNo: null,
        optionSnapshots: [],
        ...EACH_UNIT_SNAPSHOT,
      },
      {
        descriptions: { [LOCALE]: "Agua" },
        quantity: "2",
        gross: "4.00",
        parentLineNo: null,
        optionSnapshots: [],
        ...EACH_UNIT_SNAPSHOT,
      },
    ]);

    // The retry — same id, same body. Files NOTHING; returns the first ticket.
    const second = await payWorkingOrder(deps, cfg, req);

    expect(second.invoiceNumber).toBe(first.invoiceNumber);
    expect(second.total).toBe(first.total);
    expect(second.issuedAt).toBe(first.issuedAt);
    // The replay reads the EXACT filed desglose, so it equals the original's.
    expect(second.vatBreakdown).toEqual(first.vatBreakdown);
    // The replayed ticket's line list is read back from the order's stored lock, so it is
    // byte-identical to the original's — filed lines both times, never a client basket the retry sent.
    expect(second.lines).toEqual(first.lines);
    // The replay reports the same persisted cash facts and filed QR without another drawer action.
    expect(first.tender).toEqual({ method: "cash", change: "4.50" });
    expect(second.tender).toEqual(first.tender);
    expect(second.qr).toBe(first.qr);
    expect(second.qr.length).toBeGreaterThan(0);

    // No double filing: STILL exactly one sale + one registro after the retry.
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
  });

  it("concurrent double-pay of a PARKED order files ONE sale (two callers, same id)", async () => {
    const { cfg, cafe, zoneId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });

    const req = {
      id,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
      tender: { method: "cash" as const, amount: "5.00" },
    };
    // Two overlapping pays of ONE order id, both started before either has finished. The write queue
    // admits the second only once the first has committed, so the second reads `settled` and REPLAYS
    // — which is the branch this case exists to pin. Neither errors.
    const [resA, resB] = await Promise.all([
      payWorkingOrder({ db: suite.db, backend, clock }, cfg, req),
      payWorkingOrder({ db: suite.db, backend, clock }, cfg, req),
    ]);

    // Same ticket from both; exactly ONE sale and ONE registro — the loser replayed, did not file.
    expect(resA.invoiceNumber).toBe(resB.invoiceNumber);
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
  });

  it("concurrent double-pay of a WALK-UP (no prior row) files ONE sale — the 23505 backstop", async () => {
    const { cfg, cafe, zoneId } = await setupVenue();
    // The case name is stale: the write queue admits the second call only once the first has
    // committed, so it finds the row already `settled` and replays, as the PARKED case above does.
    // `payWorkingOrder`'s duplicate-key catch for a walk-up is not reached here.
    const id = randomUUID();

    const req = {
      id,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
      tender: { method: "cash" as const, amount: "5.00" },
    };
    const [resA, resB] = await Promise.all([
      payWorkingOrder({ db: suite.db, backend, clock }, cfg, req),
      payWorkingOrder({ db: suite.db, backend, clock }, cfg, req),
    ]);

    expect(resA.invoiceNumber).toBe(resB.invoiceNumber);
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
  });

  it("refuses paying an ABANDONED order (working_order.not_open) and files nothing", async () => {
    const { cfg, cafe, zoneId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });
    await withTransaction(suite.db, async (tx) => {
      await tx.execute(sql`update working_orders set status = 'abandoned' where id = ${id}`);
    });

    await expect(
      payWorkingOrder({ db: suite.db, backend, clock }, cfg, {
        id,
        zoneId,
        lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
        tender: { method: "cash", amount: "5.00" },
      }),
    ).rejects.toMatchObject({ code: "working_order.not_open", params: { workingOrderId: id } });

    expect(await saleCount(id)).toBe(0);
    expect(await registroCount(id)).toBe(0);
  });

  it("a retrieved pay IGNORES req.lines — even an unknown offer there — and files the STORED lock", async () => {
    const { cfg, cafe, zoneId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }], // the STORED lock: café×1 at 1.50
    });
    const UUID_NOT_IN_CAT = "00000000-0000-0000-0000-000000000000";

    // A retrieved order files from its STORED locked lines; `req.lines` is IGNORED entirely (design §2,
    // line-add snapshot), so this garbage basket — an unknown offer — is not looked at and the pay
    // SUCCEEDS on the stored café×1. The guard against anyone re-reading `req.lines` for a retrieved
    // order.
    const res = await payWorkingOrder({ db: suite.db, backend, clock }, cfg, {
      id,
      lines: [{ menuItemId: UUID_NOT_IN_CAT, quantity: "1" }],
      tender: { method: "cash", amount: "5.00" },
    });

    // Filed the stored lock (1.50), not the garbage basket — settled exactly once.
    expect(res.total).toBe("1.50");
    expect(res.tender).toEqual({ method: "cash", change: "3.50" });
    expect(await filedSaleTotal(id)).toBe("1.50");
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
  });

  it("refuses an empty basket and any tender that is neither cash nor card (voucher/transfer/other)", async () => {
    const { cfg, cafe, zoneId } = await setupVenue();
    const deps = { db: suite.db, backend, clock };

    await expect(
      payWorkingOrder(deps, cfg, {
        id: randomUUID(),
        lines: [],
        tender: { method: "cash", amount: "0" },
      }),
    ).rejects.toMatchObject({ code: "sale.empty_basket" });

    // cash and card are the supported tenders; every other
    // `tender_method` enum value is still refused with `sale.unsupported_tender`. The `as unknown` cast
    // is how an untrusted till can send one past the widened `"cash" | "card"` type at runtime.
    for (const method of ["voucher", "transfer", "other"] as const) {
      await expect(
        payWorkingOrder(deps, cfg, {
          id: randomUUID(),
          zoneId,
          lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
          tender: { method: method as unknown as "cash", amount: "1.50" },
        }),
      ).rejects.toMatchObject({ code: "sale.unsupported_tender", params: { method } });
    }
  });
});

describe("parkOrder concurrent replay", () => {
  it("concurrent double-park of the same id parks ONE order — the 23505 replay backstop (two concurrent callers)", async () => {
    const { cfg, cafe, zoneId } = await setupVenue();
    // A fresh id with NO prior row, parked twice with both calls in flight at once. Unlike
    // `payWorkingOrder`, `parkOrder` reads no existing row first, so the second call's insert
    // collides on `working_orders`' primary key and `parkOrder`'s duplicate-key catch returns the
    // winner's committed `{ id, orderNumber }`. The catch re-throws anything `isUniqueViolation` fails
    // to classify, so an unrecognised refusal would surface here as a rejection. The 23505 in the case
    // name is stale.
    const id = randomUUID();
    const lines = [{ menuItemId: cafe.menuItemId, quantity: "1" }];

    const [resA, resB] = await Promise.all([
      parkOrder({ db: suite.db }, cfg, { id, zoneId, lines }),
      parkOrder({ db: suite.db }, cfg, { id, zoneId, lines }),
    ]);
    expect(resA).toEqual(resB);
    expect(resA.id).toBe(id);

    // Exactly ONE order and ONE line — the loser replayed, allocating no second number (its counter
    // increment rolled back with the aborted tx) and inserting nothing.
    const { rows: orderRows } = await suite.db.execute<{ count: number }>(
      sql`select cast(count(*) as int) as count from working_orders where id = ${id}`,
    );
    expect(orderRows[0]!.count).toBe(1);
    const { rows: lineRows } = await suite.db.execute<{ count: number }>(
      sql`select cast(count(*) as int) as count from working_order_lines where working_order_id = ${id}`,
    );
    expect(lineRows[0]!.count).toBe(1);
  });
});

// The manual (unintegrated) card tender — the "datáfono" case: the operator runs the card on a
// SEPARATE bank terminal, taps Card, and the till files the same legal Veri*Factu ticket with a
// `card` tender AND a captured `payments` row, all in the ONE sale transaction (no network call,
// `recordManualCardPayment` commits inline).
describe("card tender (manual / datáfono)", () => {
  it("files a card sale: a card tender AND a captured manual payment linked to the filed sale; no change", async () => {
    const { cfg, cafe, zoneId } = await setupVenue();
    const id = randomUUID();

    const res = await payWorkingOrder({ db: suite.db, backend, clock }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }], // café → 1.50 gross
      tender: { method: "card", amount: "1.50", externalRef: "OP-12345" },
    });

    // A card charges the exact amount on the terminal — nothing is handed back.
    expect(res.total).toBe("1.50");
    expect(res.tender.method).toBe("card");
    // The operator's hand-keyed acquirer reference rides through end to end onto the ticket's tender
    // block (a manual tender carries `reference`, `card: null`).
    expect(res.tender).toMatchObject({ method: "card", reference: "OP-12345" });
    expect(res.invoiceNumber).toBe("A/1");

    // One sale + one chained registro, exactly as the cash path.
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);

    expect(await tendersFor(id)).toEqual([{ method: "card", amount: "1.50" }]);

    // A captured MANUAL payment linked to the filed sale — the ledger row the datáfono case adds
    // beside the tender (cash gets no payments row).
    expect(await paymentsFor(id)).toEqual([
      { provider: "manual", state: "captured", amount: "1.50", linkedToSale: true },
    ]);
  });

  it("normalises the card tender to the total — a client over-send does not change the filed amount", async () => {
    const { cfg, cafe, agua, zoneId } = await setupVenue();
    const id = randomUUID();

    // café + agua = 3.50 total; the till sends a card amount that DISAGREES (5.00). A card charges the
    // exact total on the separate terminal, so both the filed tender and the payment carry 3.50, not
    // 5.00 — there is no over-tender/change path for card. Same state, divergent inputs (CLAUDE.md §1):
    // 5.00 ≠ 3.50, so a would-be pass-through of `req.tender.amount` would show here.
    const res = await payWorkingOrder({ db: suite.db, backend, clock }, cfg, {
      id,
      zoneId,
      lines: [
        { menuItemId: cafe.menuItemId, quantity: "1" },
        { menuItemId: agua.menuItemId, quantity: "1" },
      ],
      tender: { method: "card", amount: "5.00" },
    });

    expect(res.total).toBe("3.50");
    expect(res.tender.method).toBe("card");
    expect(await tendersFor(id)).toEqual([{ method: "card", amount: "3.50" }]);
    expect(await paymentsFor(id)).toEqual([
      { provider: "manual", state: "captured", amount: "3.50", linkedToSale: true },
    ]);
  });

  it("card lost-response retry replays the SAME ticket and files no second payment (7b idempotency covers card)", async () => {
    const { cfg, cafe, zoneId } = await setupVenue();
    const id = randomUUID();
    const req = {
      id,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
      tender: { method: "card" as const, amount: "1.50" },
    };
    const deps = { db: suite.db, backend, clock };

    const first = await payWorkingOrder(deps, cfg, req);
    // The retry — same id, same body (a lost first response). The `sales_working_order_id_key`
    // idempotency replays the ORIGINAL ticket and files NOTHING: no second sale, no second registro,
    // and — the card-specific part — no second captured payment.
    const second = await payWorkingOrder(deps, cfg, req);

    expect(second.invoiceNumber).toBe(first.invoiceNumber);
    expect(second.total).toBe(first.total);
    expect(second.issuedAt).toBe(first.issuedAt);
    expect(second.tender.method).toBe("card");

    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
    expect(await paymentCount(id)).toBe(1);
    expect(await paymentsFor(id)).toEqual([
      { provider: "manual", state: "captured", amount: "1.50", linkedToSale: true },
    ]);
  });
});

// The park & retrieve headline (spec §7b): a parked order is HELD BY THE NODE, not by the register
// that parked it, so any till on the node can list, retrieve and pay it.
describe("cross-till end-to-end", () => {
  it("parks on till A, lists + retrieves + pays on till B (same node), and the chain across two sales verifies", async () => {
    const { cfg: tillA, cafe, agua, zoneId } = await setupVenue();
    // A SECOND register on the SAME node. It differs from till A ONLY in `till_id`: same tenant, node,
    // series and location — the shared node is the whole point of this cross-till, same-node path.
    const tillB = await addTill(tillA, "Caja 2");
    expect(tillB.tillId).not.toBe(tillA.tillId);
    expect(tillB.nodeId).toBe(tillA.nodeId);

    const deps = { db: suite.db, backend, clock };

    // Sale 1 (A/1): a walk-up cash sale on till A, so the node's huella chain already has one link
    // before the cross-till sale — `checkIntegrity` at the end verifies a chain of TWO that spans two
    // DIFFERENT tills, the concrete proof the chain is per-node, not per-till.
    const walkUp = await payWorkingOrder(deps, tillA, {
      id: randomUUID(),
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
      tender: { method: "cash", amount: "5.00" },
    });
    expect(walkUp.invoiceNumber).toBe("A/1");

    // Park an order on till A: café + agua (one VAT group at 21%), labelled for the counter.
    const orderId = randomUUID();
    const { orderNumber } = await parkOrder({ db: suite.db }, tillA, {
      id: orderId,
      zoneId,
      lines: [
        { menuItemId: cafe.menuItemId, quantity: "1" },
        { menuItemId: agua.menuItemId, quantity: "1" },
      ],
      label: "Mesa 7",
    });

    // CROSS-TILL VISIBILITY: till B's held list shows the order parked on till A. The aggregate is
    // validated against a read summed in JS (`draftAggregate`), not the SQL under test.
    const agg = await draftAggregate(orderId);
    expect(agg.itemCount).toBe(2);
    const heldOnB = await listHeldOrders({ db: suite.db }, tillB);
    expect(heldOnB).toContainEqual(
      expect.objectContaining({
        id: orderId,
        orderNumber,
        label: "Mesa 7",
        itemCount: agg.itemCount,
        total: agg.total,
      }),
    );

    // CROSS-TILL RETRIEVE: till B rebuilds the basket from the parked order's pricing inputs.
    const retrieved = await getHeldOrder({ db: suite.db }, tillB, orderId);
    expect(retrieved.id).toBe(orderId);
    expect(retrieved.label).toBe("Mesa 7");
    expect(retrieved.lines.map((l) => l.productId)).toEqual([cafe.id, agua.id]);

    // PAY on till B (Sale 2, A/2): file the retrieved order from its STORED locked lines (design §2 —
    // `req.lines` is ignored; `retrieved.lines` is passed only to mirror the real till round-trip). The
    // series is per-node, so till B's sale continues till A's chain — A/1 then A/2.
    const paid = await payWorkingOrder(deps, tillB, {
      id: orderId,
      // A retrieved order IGNORES req.lines (design §2); these are passed only to mirror the till
      // round-trip, which sends each retrieved line's offer.
      lines: retrieved.lines.map((l) => ({ menuItemId: l.menuItemId!, quantity: l.quantity })),
      tender: { method: "cash", amount: "10.00" },
    });
    expect(paid.invoiceNumber).toBe("A/2");
    expect(paid.total).toBe("3.50"); // 1.50 café + 2.00 agua, gross (the ticket total, not the net-base list sum)
    expect(paid.qr).not.toBe(""); // a FRESH file (not a replay) carries its verification URL

    // Settled exactly once, and the cross-till witness at the row level: the SALE is filed under till
    // B while the working order stays stamped with the till it was PARKED on (A).
    expect(await orderState(orderId)).toEqual({ status: "settled", settledAtSet: true });
    expect(await saleCount(orderId)).toBe(1);
    expect(await registroCount(orderId)).toBe(1);
    expect(await saleAndOrderTill(orderId)).toEqual({
      orderTillId: tillA.tillId,
      saleTillId: tillB.tillId,
    });

    // Once paid it leaves EVERY register's held list — till B no longer shows it.
    expect((await listHeldOrders({ db: suite.db }, tillB)).map((o) => o.id)).not.toContain(orderId);

    // THE CHAIN: the two sales on this node (A/1 walk-up on till A, A/2 cross-till on till B) verify as
    // one intact huella chain.
    const report = await withTransaction(suite.db, (tx) =>
      backend.checkIntegrity(tx, tillA.nodeId),
    );
    expect(report.ok).toBe(true);
    expect(report.checked).toBe(2);
  });

  it("venue-wide reads: a same-tenant register on a DIFFERENT node lists an order parked on node A (till-reroute §3.6)", async () => {
    const { cfg: nodeA, cafe, zoneId } = await setupVenue();
    // A second node under the SAME tenant. Reads are venue-wide, so both nodes see the order — a
    // promoted node inherits the venue's open tabs regardless of the `node_id` they carry.
    const nodeB = await addNode(nodeA, "Servidor 2");

    const orderId = randomUUID();
    await parkOrder({ db: suite.db }, nodeA, {
      id: orderId,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });

    expect((await listHeldOrders({ db: suite.db }, nodeA)).map((o) => o.id)).toContain(orderId);
    expect((await listHeldOrders({ db: suite.db }, nodeB)).map((o) => o.id)).toContain(orderId);
  });

  it("venue-wide reads: the by-id family (get/update/abandon) reaches a foreign-node order (till-reroute §3.6)", async () => {
    const { cfg: nodeA, cafe, zoneId } = await setupVenue();
    // A second register under the SAME tenant + location, differing only in node_id. Reads are
    // venue-wide, so every by-id lookup on node B reaches node A's order — a promoted node serves
    // the tabs it inherited (getHeldOrder/updateHeldOrder/abandonHeldOrder — the whole by-id family).
    const nodeB = await addNode(nodeA, "Servidor 2");

    const orderId = randomUUID();
    await parkOrder({ db: suite.db }, nodeA, {
      id: orderId,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });

    // Node B retrieves the foreign-node order and edits it like its own.
    expect((await getHeldOrder({ db: suite.db }, nodeB, orderId)).id).toBe(orderId);
    await expect(
      updateHeldOrder({ db: suite.db }, nodeB, orderId, {
        revision: await revisionOf(orderId),
        lines: [{ menuItemId: cafe.menuItemId, quantity: "2" }],
      }),
    ).resolves.toBe(1);

    // The edit landed on the shared row: node A sees node B's rewritten basket (quantity 1 → 2).
    const afterEdit = await getHeldOrder({ db: suite.db }, nodeA, orderId);
    expect(afterEdit.lines).toHaveLength(1);
    expect(afterEdit.lines[0]!.productId).toBe(cafe.id);
    expect(Number(afterEdit.lines[0]!.quantity)).toBe(2);

    // Node B abandons it; the order flips terminal for the whole venue.
    await expect(abandonHeldOrder({ db: suite.db }, nodeB, orderId)).resolves.toBeUndefined();
    await expect(getHeldOrder({ db: suite.db }, nodeA, orderId)).rejects.toMatchObject({
      code: "working_order.not_found",
      params: { workingOrderId: orderId },
    });
  });
});

// Placing (open → placed) opens the art. 29.2.j amendment log with its `order_placed` genesis and
// freezes composition (for free — a placed order's lines are already frozen by require_open_parent);
// cancelling a placed order (placed → abandoned) appends an `order_cancelled` amendment.
// The append-only guarantee on `order_amendments` is a trigger this suite's database carries
// (`installAppendOnlyTriggers`, applied per migration set by `useVenueDb`), so a rewrite is refused
// by the trigger alone.
describe("placeOrder / cancelPlacedOrder (placing + amendment log)", () => {
  it("placeOrder: open → placed, freezes composition, opens the log with a genesis order_placed entry", async () => {
    const { cfg, cafe, zoneId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });

    await placeOrder({ db: suite.db, backend, clock }, cfg, id, OPERATOR, cfg.tillId);

    expect(await orderState(id)).toEqual({ status: "placed", settledAtSet: false });

    // Composition freeze: a line write on the now-placed order is rejected. `updateHeldOrder`
    // reads status = 'placed' and refuses with `working_order.not_open` (its own app check); the
    // `require_open_parent` trigger is the DB backstop underneath — placing freezes for free (design §3).
    await expect(
      updateHeldOrder({ db: suite.db }, cfg, id, {
        revision: await revisionOf(id),
        lines: [{ menuItemId: cafe.menuItemId, quantity: "2" }],
      }),
    ).rejects.toMatchObject({ code: "working_order.not_open" });

    // The log opened: exactly one amendment, the genesis `order_placed` (seq 1, isFirstEntry, no
    // contest reason), attributed to the operator, and the chain verifies against its stored hash.
    const rows = await readAmendments(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "order_placed",
      sequenceNo: 1,
      isFirstEntry: true,
      actorId: OPERATOR,
      reason: null,
    });
    expect(verifyAmendmentChain(rows)).toEqual({ ok: true });

    // Placing FIRED the order's one line to the kitchen (KDS-1 §3b): a `ticket_items` row at `queued`
    // on the default station — the item the KDS bump verbs advance.
    expect(await ticketStateOf(id)).toBe("queued");
  });

  it("placeOrder refuses a non-open order — a re-place of a placed one, and an absent id — writing no second log", async () => {
    const { cfg, cafe, zoneId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });
    await placeOrder({ db: suite.db, backend, clock }, cfg, id, OPERATOR, cfg.tillId);

    // Placing is NOT idempotent: a second place of the now-`placed` order is refused with
    // `working_order.not_open` (wrong status), before any transition or amendment — so the log still
    // holds exactly its one genesis entry.
    await expect(
      placeOrder({ db: suite.db, backend, clock }, cfg, id, OPERATOR, cfg.tillId),
    ).rejects.toMatchObject({ code: "working_order.not_open", params: { workingOrderId: id } });
    expect(await readAmendments(id)).toHaveLength(1);

    // An ABSENT id — the status read returns no row — is the same fail-closed code (the undefined
    // branch), and opens no log.
    const missing = randomUUID();
    await expect(
      placeOrder({ db: suite.db, backend, clock }, cfg, missing, OPERATOR, cfg.tillId),
    ).rejects.toMatchObject({
      code: "working_order.not_open",
      params: { workingOrderId: missing },
    });
    expect(await readAmendments(missing)).toHaveLength(0);
  });

  it("cancelPlacedOrder: placed → abandoned, appends an order_cancelled amendment with the reason", async () => {
    const { cfg, cafe, zoneId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });
    await placeOrder({ db: suite.db, backend, clock }, cfg, id, OPERATOR, cfg.tillId);

    await cancelPlacedOrder({ db: suite.db, backend, clock }, cfg, id, "customer left", OPERATOR);

    expect(await orderState(id)).toEqual({ status: "abandoned", settledAtSet: false });

    const rows = await readAmendments(id);
    expect(rows.map((r) => r.kind)).toEqual(["order_placed", "order_cancelled"]);
    expect(rows[1]).toMatchObject({
      sequenceNo: 2,
      kind: "order_cancelled",
      reason: "customer left",
      actorId: OPERATOR,
      prevEntryHash: rows[0]!.entryHash,
    });
    // A genuine 2-entry chain — the cancel links to the genesis's stored hash and re-verifies end to end.
    expect(verifyAmendmentChain(rows)).toEqual({ ok: true });
  });

  it("cancelPlacedOrder refuses an empty or whitespace reason (working_order.reason_required), changing nothing", async () => {
    const { cfg, cafe, zoneId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });
    await placeOrder({ db: suite.db, backend, clock }, cfg, id, OPERATOR, cfg.tillId);

    // `order_amendments` carries NO DB CHECK forcing a reason on `order_cancelled` (the column is
    // nullable — null is the genesis's own legitimate value), so the APP contract is the only thing
    // stopping a reasonless cancel. An empty string AND a
    // whitespace-only reason are both refused, with `working_order.reason_required` — NOT `not_placed`,
    // because the order genuinely IS placed here (a false label is the §1 defect class).
    for (const reason of ["", "   "]) {
      await expect(
        cancelPlacedOrder({ db: suite.db, backend, clock }, cfg, id, reason, OPERATOR),
      ).rejects.toMatchObject({
        code: "working_order.reason_required",
        params: { workingOrderId: id },
      });
    }

    // The refusal is total: the order stays `placed` (no transition) and only the genesis entry exists
    // (no reasonless `order_cancelled` was written).
    expect(await orderState(id)).toEqual({ status: "placed", settledAtSet: false });
    expect((await readAmendments(id)).map((r) => r.kind)).toEqual(["order_placed"]);
  });

  it("cancelPlacedOrder refuses a non-placed order — an open one, a settled one, and an absent id", async () => {
    const { cfg, cafe, zoneId } = await setupVenue();

    // An OPEN (parked, never placed) order — the wrong-status branch. A non-empty reason, so the reason
    // guard passes and the STATE check is what refuses. It reports `not_placed`, not `not_open`: cancel
    // is a placed-order operation, and an open order is edited/discarded via update/abandon instead.
    const openId = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id: openId,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });
    await expect(
      cancelPlacedOrder({ db: suite.db, backend, clock }, cfg, openId, "changed mind", OPERATOR),
    ).rejects.toMatchObject({
      code: "working_order.not_placed",
      params: { workingOrderId: openId },
    });
    expect(await readAmendments(openId)).toHaveLength(0);

    // A SETTLED (walk-up) order — also not placed.
    const settledId = randomUUID();
    await payWorkingOrder({ db: suite.db, backend, clock }, cfg, {
      id: settledId,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
      tender: { method: "cash", amount: "5.00" },
    });
    await expect(
      cancelPlacedOrder({ db: suite.db, backend, clock }, cfg, settledId, "changed mind", OPERATOR),
    ).rejects.toMatchObject({
      code: "working_order.not_placed",
      params: { workingOrderId: settledId },
    });

    // An ABSENT id — the status read returns no row (the undefined branch), same fail-closed code.
    const missing = randomUUID();
    await expect(
      cancelPlacedOrder({ db: suite.db, backend, clock }, cfg, missing, "changed mind", OPERATOR),
    ).rejects.toMatchObject({
      code: "working_order.not_placed",
      params: { workingOrderId: missing },
    });
  });

  it("a pure prepay walk-up settles without placing and fires preparation", async () => {
    const { cfg, cafe, zoneId } = await setupVenue();
    const id = randomUUID();

    // A walk-up settles open → settled in one transaction (till-sale.ts), never passing through
    // `placed`, so placing's log never opens. Prepay fires preparation in that same sale transaction.
    await payWorkingOrder({ db: suite.db, backend, clock }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
      tender: { method: "cash", amount: "5.00" },
    });

    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await readAmendments(id)).toHaveLength(0); // no placing → no log (design §3)
    expect(await ticketStateOf(id)).toBe("queued");
  });
});

// The pay-timing config + the three-mode dispatch (Modes P/I/T — design §3's state-machine ×
// config table). FISCAL-CRITICAL: each mode must fire the right issuance primitive at the right
// point — a wrong dispatch files the wrong kind of unrepairable fiscal record (CLAUDE.md §5).
// The idempotency proofs below run as two transactions on one handle; the file header states what
// that shows and what it does not. No primitive is reimplemented here: the dispatch ORCHESTRATES `recordSale`
// (immediate + deferred), `settleSale` and `listOutstandingSales`.
describe("prepare & collect — three-mode dispatch (order_flow)", () => {
  it("readOrderFlow reads the venue's configured mode from its location", async () => {
    const { cfg } = await modeVenue("invoice_first");
    expect(await readOrderFlow(suite.db, cfg)).toBe("invoice_first");
  });

  // MODE P (prepay): pay + issue at ORDER — open → settled, no placed state. The
  // walk-up/park-pay `payWorkingOrder`, asserted under an explicit `prepay` cfg so P's contract is
  // pinned beside I and T.
  it("Mode P (prepay): pay at order files an immediate sale, open → settled, nothing outstanding", async () => {
    const { cfg, cafe, zoneId } = await modeVenue("prepay");
    const id = randomUUID();

    const res = await payWorkingOrder({ db: suite.db, backend, clock }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
      tender: { method: "cash", amount: "5.00" },
    });

    expect(res.invoiceNumber).toBe("A/1");
    expect(res.total).toBe("1.50");
    expect(res.tender).toEqual({ method: "cash", change: "3.50" });
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
    // Pay + issue are the same instant, so nothing is ever owed.
    expect(await outstanding()).toEqual([]);
  });

  // The unit-abbreviation freeze, end to end. The café sits on the legacy `each` unit, whose NAME
  // ("each"/"unidad"/…) and ABBREVIATION ("ea"/"ud"/…) differ (`seedLegacySellingUnits`), so a filed
  // line can only carry one of them — and the printed label is the abbreviation. Reads the persisted
  // `working_order_lines` (where the add-time freeze writes it) and `sale_lines` (where filing
  // copies it) directly.
  it("freezes the unit's abbreviation, not its name, onto the filed line", async () => {
    const { cfg, cafe, zoneId } = await modeVenue("prepay");
    const id = randomUUID();

    await payWorkingOrder({ db: suite.db, backend, clock }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
      tender: { method: "cash", amount: "1.50" },
    });

    const abbreviation = { en: "ea", es: "ud", ca: "u", gl: "u", eu: "u" };
    const labels = await frozenUnitLabels(id);
    expect(labels.workingOrderLine).toEqual(abbreviation);
    expect(labels.saleLine).toEqual(abbreviation);
    // The live "Each" unit is the synthetic `EACH_UNIT` defined in code, so its name comes from there.
    expect(EACH_UNIT.name.en.toLowerCase()).toBe("each");
    expect(labels.saleLine).not.toEqual(EACH_UNIT.name);
  });

  // MODE I (invoice_first): at PLACE issue a DEFERRED (unpaid) chained invoice, open → placed, and it
  // shows as outstanding; at COLLECT `settleSale` closes it, placed → settled, filing NO second record.
  it("Mode I (invoice_first): place issues a deferred invoice; collect settles it, no second file", async () => {
    const { cfg, cafe, agua, zoneId } = await modeVenue("invoice_first");
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId,
      lines: [
        { menuItemId: cafe.menuItemId, quantity: "1" },
        { menuItemId: agua.menuItemId, quantity: "1" },
      ],
    });

    // PLACE → the deferred invoice issues HERE (A/1); the order freezes at `placed`, unsettled.
    const placed = await placeOrder(
      { db: suite.db, backend, clock },
      cfg,
      id,
      OPERATOR,
      cfg.tillId,
    );
    expect(placed.status).toBe("placed");
    expect(placed.invoiceNumber).toBe("A/1"); // the deferred invoice, issued at placing
    expect(placed.total).toBe("3.50"); // 1.50 café + 2.00 agua
    expect(placed.qr).not.toBe(""); // a genuine chained filing carries the AEAT QR
    expect(await orderState(id)).toEqual({ status: "placed", settledAtSet: false });

    // The chained record exists NOW, before any payment — one sale, one registro — and shows as
    // OUTSTANDING (what is owed).
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
    const due = await outstanding();
    expect(due).toHaveLength(1);
    expect(due[0]!.amountDue).toBe("3.50");

    // COLLECT → settle the EXISTING invoice, placed → settled, filing NOTHING new.
    const collected = await collectOrder({ db: suite.db, backend, clock }, cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "3.50" },
    });
    expect(collected.invoiceNumber).toBe("A/1"); // the SAME invoice, read back
    expect(collected.total).toBe("3.50");
    expect(collected.tender).toEqual({ method: "cash", change: "0.00" });
    // The receipt line list is read back from the order's stored lock (Mode-I collect returns the
    // already-filed ticket), so it matches the deferred invoice's composition.
    expect(collected.lines).toEqual([
      {
        descriptions: { [LOCALE]: "Café" },
        quantity: "1",
        gross: "1.50",
        parentLineNo: null,
        optionSnapshots: [],
        ...EACH_UNIT_SNAPSHOT,
      },
      {
        descriptions: { [LOCALE]: "Agua" },
        quantity: "1",
        gross: "2.00",
        parentLineNo: null,
        optionSnapshots: [],
        ...EACH_UNIT_SNAPSHOT,
      },
    ]);
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await saleCount(id)).toBe(1); // STILL one sale — no second file at collect
    expect(await registroCount(id)).toBe(1); // STILL one registro
    expect(await outstanding()).toEqual([]); // settled → no longer owed
    expect(await tendersFor(id)).toEqual([{ method: "cash", amount: "3.50" }]);
  });

  it("Mode I: a covered cash over-tender at collect settles at the total and hands back change", async () => {
    const { cfg, cafe, zoneId } = await modeVenue("invoice_first");
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });
    await placeOrder({ db: suite.db, backend, clock }, cfg, id, OPERATOR, cfg.tillId);

    // 5.00 cash against the 1.50 invoice: the SALE settles at the invoice total (1.50) and 3.50 is
    // drawer change — settling at the tendered cash would over-report the fiscal total (§5).
    const collected = await collectOrder({ db: suite.db, backend, clock }, cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "5.00" },
    });
    expect(collected.total).toBe("1.50");
    expect(collected.tender).toEqual({ method: "cash", change: "3.50" });
    expect(await tendersFor(id)).toEqual([{ method: "cash", amount: "1.50" }]);
    expect(await saleCount(id)).toBe(1);
  });

  it("Mode I: a card tender at collect records exactly one captured payment linked to the sale; cash records none", async () => {
    const { cfg, cafe, zoneId } = await modeVenue("invoice_first");

    // CARD collect: the invoice issued deferred at placing, then a manual-card ("datáfono") tender at
    // collect. The card charges the EXACT invoice total on the separate terminal — no change.
    const cardId = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id: cardId,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });
    await placeOrder({ db: suite.db, backend, clock }, cfg, cardId, OPERATOR, cfg.tillId);
    const collected = await collectOrder({ db: suite.db, backend, clock }, cfg, {
      id: cardId,
      lines: [],
      tender: { method: "card", amount: "1.50", externalRef: "OP-INV-1" },
    });
    expect(collected.tender.method).toBe("card");
    expect(await orderState(cardId)).toEqual({ status: "settled", settledAtSet: true });

    // The card tender AND a captured manual `payments` row linked to the settled sale; without the row
    // the invoice-first card collect would be invisible to reconciliation.
    expect(await tendersFor(cardId)).toEqual([{ method: "card", amount: "1.50" }]);
    expect(await paymentCount(cardId)).toBe(1);
    expect(await paymentsFor(cardId)).toEqual([
      { provider: "manual", state: "captured", amount: "1.50", linkedToSale: true },
    ]);
    // Still exactly ONE sale + ONE registro — the ledger row rides ALONGSIDE the settlement, never a
    // second fiscal file (§5).
    expect(await saleCount(cardId)).toBe(1);
    expect(await registroCount(cardId)).toBe(1);

    // CASH collect of a SEPARATE invoice-first order → NO payments row (cash is a tender only), the
    // other branch of the card side-write. Same-state divergence (CLAUDE.md §1): card writes 1, cash 0.
    const cashId = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id: cashId,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });
    await placeOrder({ db: suite.db, backend, clock }, cfg, cashId, OPERATOR, cfg.tillId);
    await collectOrder({ db: suite.db, backend, clock }, cfg, {
      id: cashId,
      lines: [],
      tender: { method: "cash", amount: "1.50" },
    });
    expect(await paymentCount(cashId)).toBe(0);
  });

  it("Mode I: a double-tap place issues exactly ONE deferred invoice (the two placements serialise)", async () => {
    const { cfg, cafe, zoneId } = await modeVenue("invoice_first");
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });

    // Two overlapping places of the SAME order. The write queue admits the second only once the first
    // has committed: the winner files the deferred invoice and moves the row to `placed`, the loser
    // re-reads `placed` and is refused `working_order.not_open` BEFORE it files. That refusal is the
    // branch this case exists to pin.
    const results = await Promise.allSettled([
      placeOrder({ db: suite.db, backend, clock }, cfg, id, OPERATOR, cfg.tillId),
      placeOrder({ db: suite.db, backend, clock }, cfg, id, OPERATOR, cfg.tillId),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: "working_order.not_open" });

    // ONE deferred invoice, one registro — the unrepairable double-file the dispatch must prevent.
    expect(await orderState(id)).toEqual({ status: "placed", settledAtSet: false });
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
  });

  it("Mode I: a concurrent double collect settles the invoice ONCE and both see the same ticket", async () => {
    const { cfg, cafe, zoneId } = await modeVenue("invoice_first");
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });
    await placeOrder({ db: suite.db, backend, clock }, cfg, id, OPERATOR, cfg.tillId);

    const req = { id, lines: [], tender: { method: "cash" as const, amount: "1.50" } };
    // Two overlapping collects of the placed order. The write queue admits the second only once the
    // first has committed, so it sees `settled` and REPLAYS the ticket — neither errors and there
    // is ONE settlement. The equal invoice numbers below are what witness the replay.
    const [rA, rB] = await Promise.all([
      collectOrder({ db: suite.db, backend, clock }, cfg, req, OPERATOR),
      collectOrder({ db: suite.db, backend, clock }, cfg, req, OPERATOR),
    ]);
    expect(rA.invoiceNumber).toBe(rB.invoiceNumber);
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
    expect(await tendersFor(id)).toEqual([{ method: "cash", amount: "1.50" }]); // one settlement
    expect(await outstanding()).toEqual([]);
  });

  // MODE T (ticket_then_pay): at PLACE no fiscal doc, open → placed; at COLLECT `recordSale` immediate
  // files + settles, placed → settled.
  it("Mode T (ticket_then_pay): place files no fiscal doc; collect files immediate at collect", async () => {
    const { cfg, cafe, zoneId } = await modeVenue("ticket_then_pay");
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });

    // PLACE → NO fiscal document (design §3). The order freezes at `placed` with nothing filed.
    const placed = await placeOrder(
      { db: suite.db, backend, clock },
      cfg,
      id,
      OPERATOR,
      cfg.tillId,
    );
    expect(placed.status).toBe("placed");
    expect(placed.invoiceNumber).toBeUndefined(); // no invoice issued at placing
    expect(await orderState(id)).toEqual({ status: "placed", settledAtSet: false });
    expect(await saleCount(id)).toBe(0); // nothing filed yet
    expect(await outstanding()).toEqual([]); // no issued invoice → nothing outstanding

    // COLLECT → file `recordSale` IMMEDIATE, placed → settled.
    const collected = await collectOrder({ db: suite.db, backend, clock }, cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "1.50" },
    });
    expect(collected.invoiceNumber).toBe("A/1"); // the FIRST filing is at collect
    expect(collected.total).toBe("1.50");
    expect(collected.tender).toEqual({ method: "cash", change: "0.00" });
    // The receipt line list is the just-filed composition (Mode-T files immediate at collect from
    // the stored lock).
    expect(collected.lines).toEqual([
      {
        descriptions: { [LOCALE]: "Café" },
        quantity: "1",
        gross: "1.50",
        parentLineNo: null,
        optionSnapshots: [],
        ...EACH_UNIT_SNAPSHOT,
      },
    ]);
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await saleCount(id)).toBe(1); // filed at collect
    expect(await registroCount(id)).toBe(1);
  });

  it("Mode T: a concurrent double collect-pay files ONE sale, and a later sequential collect replays", async () => {
    const { cfg, cafe, zoneId } = await modeVenue("ticket_then_pay");
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });
    await placeOrder({ db: suite.db, backend, clock }, cfg, id, OPERATOR, cfg.tillId);

    const req = { id, lines: [], tender: { method: "cash" as const, amount: "1.50" } };
    // Two overlapping collects, both of which would FILE. The write queue admits the second only once
    // the first has committed, so it sees `settled` and REPLAYS — ONE sale. The equal invoice
    // numbers below are what witness the replay.
    const [rA, rB] = await Promise.all([
      collectOrder({ db: suite.db, backend, clock }, cfg, req, OPERATOR),
      collectOrder({ db: suite.db, backend, clock }, cfg, req, OPERATOR),
    ]);
    expect(rA.invoiceNumber).toBe(rB.invoiceNumber);
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);

    // A further SEQUENTIAL collect of the now-settled order deterministically hits the settled-replay
    // branch: it returns the same ticket and files nothing. Exact cash has zero change.
    const replay = await collectOrder({ db: suite.db, backend, clock }, cfg, req, OPERATOR);
    expect(replay.invoiceNumber).toBe("A/1");
    expect(replay.tender).toEqual({ method: "cash", change: "0.00" });
    expect(await saleCount(id)).toBe(1);
  });

  // The counter COLLECT wires `working_orders.collected_at`, so a collected counter order
  // leaves its station queue. The end-to-end proof through `collectOrder` (not a raw UPDATE): fire a
  // placed order to the default station, confirm it queues, collect it, and confirm it drops — with the
  // fiscal result byte-unchanged. Both modes are pinned: Mode T settles through `fileImmediateSale`,
  // Mode I through the direct settle UPDATE, and both stamp `collected_at` in the UPDATE that
  // settles the order; these cases check only that it ends up set.
  it("Mode T: collectOrder stamps collected_at, dropping the order from its station queue, fiscal result unchanged", async () => {
    const { cfg, cafe, zoneId } = await modeVenue("ticket_then_pay");
    const station = await defaultStationId(cfg);
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
      label: "Mesa 7",
    });
    // PLACE fires one ticket item to the default station; the order shows on that station's queue and
    // its handover marker is unset.
    await placeOrder({ db: suite.db, backend, clock }, cfg, id, OPERATOR, cfg.tillId);
    expect(
      (await asTenant(cfg, (tx) => listStationQueue(tx, station))).map((g) => g.orderId),
    ).toEqual([id]);
    expect(await collectedAtSet(id)).toBe(false);

    // COLLECT → Mode T files immediate at collect AND stamps collected_at in the placed → settled UPDATE.
    const collected = await collectOrder({ db: suite.db, backend, clock }, cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "1.50" },
    });

    // Fiscal result byte-unchanged: filed once at collect, A/1, one chained registro, one tender.
    expect(collected.invoiceNumber).toBe("A/1");
    expect(collected.total).toBe("1.50");
    expect(collected.tender).toEqual({ method: "cash", change: "0.00" });
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
    expect(await tendersFor(id)).toEqual([{ method: "cash", amount: "1.50" }]);
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });

    // The order-level handover marker is now set, so the default station drops the collected order.
    expect(await collectedAtSet(id)).toBe(true);
    expect(await asTenant(cfg, (tx) => listStationQueue(tx, station))).toEqual([]);
    // The ticket item ITSELF is untouched — collected_at is an ORDER marker, not a ticket kitchen state.
    expect(await ticketStateOf(id)).toBe("queued");
  });

  it("Mode I: collectOrder stamps collected_at, dropping the order from its station queue, no second file", async () => {
    const { cfg, cafe, zoneId } = await modeVenue("invoice_first");
    const station = await defaultStationId(cfg);
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });
    // PLACE issues the deferred invoice AND fires the ticket item to the default station.
    await placeOrder({ db: suite.db, backend, clock }, cfg, id, OPERATOR, cfg.tillId);
    expect(
      (await asTenant(cfg, (tx) => listStationQueue(tx, station))).map((g) => g.orderId),
    ).toEqual([id]);
    expect(await collectedAtSet(id)).toBe(false);

    // COLLECT → settle the EXISTING invoice (file NOTHING new) AND stamp collected_at in the direct
    // placed → settled UPDATE.
    const collected = await collectOrder({ db: suite.db, backend, clock }, cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "1.50" },
    });
    expect(collected.invoiceNumber).toBe("A/1"); // the SAME deferred invoice, read back
    expect(await saleCount(id)).toBe(1); // no second file at collect
    expect(await registroCount(id)).toBe(1);
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });

    expect(await collectedAtSet(id)).toBe(true);
    expect(await asTenant(cfg, (tx) => listStationQueue(tx, station))).toEqual([]);
  });

  it("collectOrder refuses a non-placed order (open, absent) and an unsupported tender, filing nothing", async () => {
    const { cfg, cafe, zoneId } = await modeVenue("ticket_then_pay");

    // An OPEN (parked, never placed) order → `working_order.not_placed`, files nothing. `not_placed`,
    // not `not_open`: collect is the placed → settled operation, so an open order is a placing-state
    // error (a false "not open" label would be the §1 defect class).
    const openId = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id: openId,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });
    await expect(
      collectOrder({ db: suite.db, backend, clock }, cfg, {
        id: openId,
        lines: [],
        tender: { method: "cash", amount: "1.50" },
      }),
    ).rejects.toMatchObject({
      code: "working_order.not_placed",
      params: { workingOrderId: openId },
    });
    expect(await saleCount(openId)).toBe(0);

    // An ABSENT id (the undefined branch) → the same fail-closed code.
    const missing = randomUUID();
    await expect(
      collectOrder({ db: suite.db, backend, clock }, cfg, {
        id: missing,
        lines: [],
        tender: { method: "cash", amount: "1.50" },
      }),
    ).rejects.toMatchObject({
      code: "working_order.not_placed",
      params: { workingOrderId: missing },
    });

    // A PLACED order with an UNSUPPORTED tender → `sale.unsupported_tender`, files nothing. The `as
    // unknown` cast is how an untrusted till sends one past the widened `"cash" | "card"` type.
    const placedId = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id: placedId,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });
    await placeOrder({ db: suite.db, backend, clock }, cfg, placedId, OPERATOR, cfg.tillId);
    await expect(
      collectOrder({ db: suite.db, backend, clock }, cfg, {
        id: placedId,
        lines: [],
        tender: { method: "voucher" as unknown as "cash", amount: "1.50" },
      }),
    ).rejects.toMatchObject({ code: "sale.unsupported_tender", params: { method: "voucher" } });
    expect(await saleCount(placedId)).toBe(0);
  });
});

// The ticket prep surface (KDS-1 §3c): the per-line advance state machine (`advanceTicketItem`), the
// whole-ticket bump (`advanceTicket`) and the per-station queue read (`listStationQueue`) over
// `ticket_items`. `sendToPrep` (Mode P) and `placeOrder` (Modes I/T) are the FIRES that put items on
// the queue; their settled-only guard is exercised here too.
describe("advanceTicketItem / advanceTicket / listStationQueue (ticket prep surface)", () => {
  it("advanceTicketItem walks a line queued → preparing → ready; a skip, a repeat, a backwards move and to='queued' are all refused", async () => {
    const { cfg, cafe, zoneId } = await modeVenue("prepay");
    const id = randomUUID();
    await payWorkingOrder(
      { db: suite.db, backend, clock },
      cfg,
      {
        id,
        zoneId,
        lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
        tender: { method: "cash", amount: "5.00" },
      },
      OPERATOR,
    );
    expect(await ticketStateOf(id)).toBe("queued");
    const [item] = await ticketItemIdsFor(id);

    // Skipping `preparing` (queued → ready) matches no row — `ready`'s only legal predecessor is
    // `preparing` — so the empty `returning` refuses it, naming the offending item.
    await expect(
      asTenant(cfg, (tx) => advanceTicketItem(tx, cfg, item!, "ready")),
    ).rejects.toMatchObject({
      code: "ticket.invalid_transition",
      params: { ticketItemId: item },
    });
    expect(await ticketStateOf(id)).toBe("queued"); // the refused skip changed nothing

    // The forward walk, one legal step at a time — the timestamps are stamped as it goes.
    await asTenant(cfg, (tx) => advanceTicketItem(tx, cfg, item!, "preparing"));
    expect(await ticketStateOf(id)).toBe("preparing");
    await asTenant(cfg, (tx) => advanceTicketItem(tx, cfg, item!, "ready"));
    expect(await ticketStateOf(id)).toBe("ready");

    // A repeat (ready → ready) and a backwards move (ready → preparing) both match no row now.
    for (const to of ["ready", "preparing"] as const) {
      await expect(
        asTenant(cfg, (tx) => advanceTicketItem(tx, cfg, item!, to)),
      ).rejects.toMatchObject({
        code: "ticket.invalid_transition",
        params: { ticketItemId: item },
      });
    }
    // No kitchen state advances INTO `queued` — refused before any query (reaching queued is a fire's job).
    await expect(
      asTenant(cfg, (tx) => advanceTicketItem(tx, cfg, item!, "queued")),
    ).rejects.toMatchObject({
      code: "ticket.invalid_transition",
      params: { ticketItemId: item },
    });
    expect(await ticketStateOf(id)).toBe("ready"); // every refusal left the item untouched
  });

  it("advanceTicket bumps every not-yet-`to` line of an order at a station together, leaving already-advanced lines alone", async () => {
    const { cfg, cafe, agua, zoneId } = await modeVenue("ticket_then_pay");
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId,
      lines: [
        { menuItemId: cafe.menuItemId, quantity: "1" },
        { menuItemId: agua.menuItemId, quantity: "1" },
      ],
    });
    await placeOrder({ db: suite.db, backend, clock }, cfg, id, OPERATOR, cfg.tillId); // fires two items → default station
    const station = await defaultStationId(cfg);
    const items = await ticketItemIdsFor(id);
    expect(items).toHaveLength(2);

    // Push item[0] all the way to `ready` first, so the whole-ticket bump must SKIP it (it is no longer
    // at the `queued` predecessor).
    await asTenant(cfg, async (tx) => {
      await advanceTicketItem(tx, cfg, items[0]!, "preparing");
      await advanceTicketItem(tx, cfg, items[0]!, "ready");
    });

    // Whole-ticket bump to `preparing`: only the still-queued item[1] advances; item[0] (ready) is untouched.
    await asTenant(cfg, (tx) => advanceTicket(tx, cfg, id, station, "preparing"));

    const queue = await asTenant(cfg, (tx) => listStationQueue(tx, station));
    const group = queue.find((g) => g.orderId === id)!;
    expect(group.items.map((i) => i.state).sort()).toEqual(["preparing", "ready"]);
  });

  it("listStationQueue lists this station's items grouped by order oldest-first, dropping collected and abandoned orders", async () => {
    const { cfg, cafe, zoneId } = await modeVenue("ticket_then_pay");
    const station = await defaultStationId(cfg);

    // Two orders placed oldest-first, each a single line → the default station.
    const id1 = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id: id1,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
      label: "Mesa 7",
    });
    await placeOrder({ db: suite.db, backend, clock }, cfg, id1, OPERATOR, cfg.tillId);

    const id2 = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id: id2,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
      label: "Mesa 3",
    });
    await placeOrder({ db: suite.db, backend, clock }, cfg, id2, OPERATOR, cfg.tillId);

    // Both orders show, oldest first, each one line, at `queued`, carrying the order's label + queued_at.
    const queue = await asTenant(cfg, (tx) => listStationQueue(tx, station));
    expect(queue.map((g) => g.orderId)).toEqual([id1, id2]);
    expect(queue[0]).toMatchObject({
      orderId: id1,
      label: "Mesa 7",
      orderNumber: expect.any(Number),
      queuedAt: expect.any(String),
    });
    expect(queue[0]!.items).toHaveLength(1);
    expect(queue[0]!.items[0]!.state).toBe("queued");

    // Advancing order 1's line keeps it on the queue (a `preparing`/`ready` line stays until collected).
    const [item1] = await ticketItemIdsFor(id1);
    await asTenant(cfg, (tx) => advanceTicketItem(tx, cfg, item1!, "preparing"));
    expect(
      (await asTenant(cfg, (tx) => listStationQueue(tx, station))).find((g) => g.orderId === id1)
        ?.items[0]?.state,
    ).toBe("preparing");

    // COLLECT order 1 — the collect flow settles a placed order AND stamps `collected_at` in the one
    // legal placed → settled transition (the enforce_transition trigger forbids editing a placed row
    // any other way). The default-station display drops a collected order (§3e), so it leaves the queue.
    // ONE clock reading bound to both columns, so they hold the same instant.
    const settledNow = nowIso();
    await suite.db.execute(sql`
      update working_orders set status = 'settled', settled_at = ${settledNow}, collected_at = ${settledNow}
      where id = ${id1}`);
    expect(
      (await asTenant(cfg, (tx) => listStationQueue(tx, station))).map((g) => g.orderId),
    ).toEqual([id2]);

    // CANCEL order 2 (placed → abandoned) — its ticket item is UNCHANGED (cancel never touches
    // `ticket_items`), but `listStationQueue`'s `status != 'abandoned'` join retires it.
    await cancelPlacedOrder({ db: suite.db, backend, clock }, cfg, id2, "customer left", OPERATOR);
    expect(await ticketStateOf(id2)).toBe("queued"); // the ticket item itself is untouched by cancel
    expect(await asTenant(cfg, (tx) => listStationQueue(tx, station))).toEqual([]);
  });

  it("listStationQueue is VENUE-WIDE: each node sees the venue's items, regardless of node (till-reroute §3.6)", async () => {
    const { cfg: nodeA, cafe, zoneId } = await modeVenue("ticket_then_pay");
    // A second node under the SAME tenant + location, differing only in `node_id`. Reads are venue-wide, so BOTH nodes fire a genuine order and BOTH queues show
    // both — a measurement where each side holds two orders, not "one empty, one not" (CLAUDE.md §1).
    // Both nodes share the location's one default station.
    const nodeB = await addNode(nodeA, "Servidor 2");
    const station = await defaultStationId(nodeA);

    const idA = randomUUID();
    await parkOrder({ db: suite.db }, nodeA, {
      id: idA,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
      label: "Node A order",
    });
    await placeOrder({ db: suite.db, backend, clock }, nodeA, idA, OPERATOR, nodeA.tillId);

    const idB = randomUUID();
    await parkOrder({ db: suite.db }, nodeB, {
      id: idB,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
      label: "Node B order",
    });
    await placeOrder({ db: suite.db, backend, clock }, nodeB, idB, OPERATOR, nodeB.tillId);

    const queueA = await asTenant(nodeA, (tx) => listStationQueue(tx, station));
    const queueB = await asTenant(nodeB, (tx) => listStationQueue(tx, station));

    // Same station on both sides, each holding BOTH orders (oldest-first: A fired before B) — the
    // reads do not separate by node.
    expect(queueA.map((g) => g.orderId)).toEqual([idA, idB]);
    expect(queueB.map((g) => g.orderId)).toEqual([idA, idB]);
  });

  it("sendToPrep refuses to fire an order it may not (working_order.not_settled) — an open one and an absent id", async () => {
    const { cfg, cafe, zoneId } = await modeVenue("prepay");

    // OPEN — parked but never paid. `sendToPrep` is Mode P's own pickup (settle happens at ORDER via
    // `payWorkingOrder`); an open order has never reached settlement, so nothing is fired.
    const openId = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id: openId,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });
    await expect(sendToPrep({ db: suite.db }, cfg, openId)).rejects.toMatchObject({
      code: "working_order.not_settled",
      params: { workingOrderId: openId },
    });
    expect(await ticketStateOf(openId)).toBeNull(); // the refused call fired nothing

    // An ABSENT id — the existence+status guard catches it before any fire (never a raw FK 500).
    const missing = randomUUID();
    await expect(sendToPrep({ db: suite.db }, cfg, missing)).rejects.toMatchObject({
      code: "working_order.not_settled",
      params: { workingOrderId: missing },
    });
    expect(await ticketStateOf(missing)).toBeNull();
  });
});

// The cross-station expo/pass read. `listExpoQueue` gathers every order that is not abandoned
// or collected and has an item not yet away (open, placed or settled) across ALL stations; unlike
// the per-station `listStationQueue` it takes NO station arg, and it is not node-scoped either
// (till-reroute §3.6). `working-order.test.ts` covers the join/grouping/exclusions; this case takes
// the SAME venue-wide shape the `listStationQueue` test above uses.
describe("listExpoQueue (KDS-3 cross-station expo/pass read) — venue-wide", () => {
  it("is VENUE-WIDE: each node's expo board shows the venue's orders, regardless of node (till-reroute §3.6)", async () => {
    const { cfg: nodeA, cafe, zoneId } = await modeVenue("ticket_then_pay");
    // A second node under the SAME tenant + location. Reads are venue-wide, so
    // BOTH nodes fire a genuine order and BOTH expo boards show both — a measurement where each side
    // holds two orders, not "one empty, one not" (CLAUDE.md §1).
    const nodeB = await addNode(nodeA, "Servidor 2");

    const idA = randomUUID();
    await parkOrder({ db: suite.db }, nodeA, {
      id: idA,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
      label: "Node A order",
    });
    await placeOrder({ db: suite.db, backend, clock }, nodeA, idA, OPERATOR, nodeA.tillId);

    const idB = randomUUID();
    await parkOrder({ db: suite.db }, nodeB, {
      id: idB,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
      label: "Node B order",
    });
    await placeOrder({ db: suite.db, backend, clock }, nodeB, idB, OPERATOR, nodeB.tillId);

    const expoA = await asTenant(nodeA, (tx) => listExpoQueue(tx, nodeA));
    const expoB = await asTenant(nodeB, (tx) => listExpoQueue(tx, nodeB));

    // Same tenant + location on both sides, each expo board holding BOTH orders (oldest-first: A
    // fired before B) — the reads do not separate by node.
    expect(expoA.map((o) => o.orderId)).toEqual([idA, idB]);
    expect(expoB.map((o) => o.orderId)).toEqual([idA, idB]);
  });
});

describe("markCollected (Mode-P kitchen-handover marker)", () => {
  // A Mode-P (prepay) order pays and fires at order, walks queued → preparing → ready, then is
  // HANDED OVER — markCollected stamps `collected_at`, and it drops off listStationQueue. Until that
  // stamp, a ready order stays on the queue.
  it("Mode P: fired → ready → markCollected stamps collected_at and drops the order off listStationQueue", async () => {
    const { cfg, cafe, zoneId } = await modeVenue("prepay");
    const station = await defaultStationId(cfg);
    const id = randomUUID();

    // Pay and fire at order (open → settled in one transaction — the Mode-P walk-up).
    await payWorkingOrder(
      { db: suite.db, backend, clock },
      cfg,
      {
        id,
        zoneId,
        lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
        tender: { method: "cash", amount: "5.00" },
      },
      OPERATOR,
    );
    expect(
      (await asTenant(cfg, (tx) => listStationQueue(tx, station))).map((g) => g.orderId),
    ).toEqual([id]);

    // Walk the line all the way to `ready` — a ready line STAYS on the queue until the order collects.
    const [item] = await ticketItemIdsFor(id);
    await asTenant(cfg, (tx) => advanceTicketItem(tx, cfg, item!, "preparing"));
    await asTenant(cfg, (tx) => advanceTicketItem(tx, cfg, item!, "ready"));
    expect(await ticketStateOf(id)).toBe("ready");
    const readyQueue = await asTenant(cfg, (tx) => listStationQueue(tx, station));
    // Still listed — a ready-but-uncollected order lingers — and
    // the group carries the order's `status`, so the till surfaces the collect action (collectable = settled).
    expect(readyQueue.map((g) => g.orderId)).toEqual([id]);
    expect(readyQueue[0]!.status).toBe("settled");

    // Hand it over. NON-FISCAL — markCollected writes only collected_at (no sale/registro/tender/huella).
    await markCollected({ db: suite.db }, cfg, id);
    expect(await collectedAtSet(id)).toBe(true);
    expect(await asTenant(cfg, (tx) => listStationQueue(tx, station))).toEqual([]);
    // Its fiscal state is untouched — still settled with settled_at intact (only collected_at moved).
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
  });

  it("refuses a non-settled order — an open one and an absent id (working_order.not_settled)", async () => {
    const { cfg, cafe, zoneId } = await modeVenue("prepay");

    // OPEN — parked, never paid: not settled, so there is no handover to mark. Fails closed before any write.
    const openId = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id: openId,
      zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });
    await expect(markCollected({ db: suite.db }, cfg, openId)).rejects.toMatchObject({
      code: "working_order.not_settled",
      params: { workingOrderId: openId },
    });
    expect(await collectedAtSet(openId)).toBe(false);

    // ABSENT — the existence+status read catches it before any write (never a raw error).
    const missing = randomUUID();
    await expect(markCollected({ db: suite.db }, cfg, missing)).rejects.toMatchObject({
      code: "working_order.not_settled",
      params: { workingOrderId: missing },
    });
  });

  it("refuses a settled order that was never fired (ticket.not_fired) — nothing on the kitchen queue to hand over", async () => {
    const { cfg, cafe, zoneId } = await modeVenue("ticket_then_pay");
    const id = randomUUID();
    // A walk-up in a ticket-then-pay zone settled through the direct pay primitive has no ticket item
    // (only a prepay walk-up fires at pay), so there is nothing on any station display to hand over.
    await payWorkingOrder(
      { db: suite.db, backend, clock },
      cfg,
      {
        id,
        zoneId,
        lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
        tender: { method: "cash", amount: "5.00" },
      },
      OPERATOR,
    );
    await expect(markCollected({ db: suite.db }, cfg, id)).rejects.toMatchObject({
      code: "ticket.not_fired",
      params: { workingOrderId: id },
    });
    expect(await collectedAtSet(id)).toBe(false);
  });

  it("refuses a re-collect of an already-handed-over order (working_order.already_collected)", async () => {
    const { cfg, cafe, zoneId } = await modeVenue("prepay");
    const id = randomUUID();
    await payWorkingOrder(
      { db: suite.db, backend, clock },
      cfg,
      {
        id,
        zoneId,
        lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
        tender: { method: "cash", amount: "5.00" },
      },
      OPERATOR,
    );
    await markCollected({ db: suite.db }, cfg, id); // first handover — allowed
    expect(await collectedAtSet(id)).toBe(true);
    // A second markCollected is refused BEFORE it reaches enforce_transition (whose non-null → non-null
    // collected_at RAISE would otherwise become an opaque 500), with a clean domain code.
    await expect(markCollected({ db: suite.db }, cfg, id)).rejects.toMatchObject({
      code: "working_order.already_collected",
      params: { workingOrderId: id },
    });
  });
});

// Coursing editing verbs — the serialisation properties for the tab verbs
// `setLineCourse`/`sendLines`/`recallLines`. `working-order.test.ts` covers their LOGIC; the cases
// below cover a `sendLines` racing a `recallLines` (or a `fireCourse`) on the SAME line ending in
// one clean serial outcome with no lost update. The file header states what serialises them.

/** Insert an active dining table in `zoneId` under `cfg`'s location and return its id — the `openTab`
 *  → `addTabRound` entry point. */
async function addTable(tx: Transaction, cfg: TillConfig, zoneId: string): Promise<string> {
  // Through the table, for the reason {@link addTill} gives — and here BOTH `dining_tables.id` and
  // `dining_tables.created_at` are `$defaultFn` columns, so a raw insert naming neither is refused
  // `NOT NULL constraint failed: dining_tables.id`.
  const rows = await tx
    .insert(diningTables)
    .values({ locationId: cfg.locationId, zoneId, label: `T-${randomUUID().slice(0, 8)}` })
    .returning({ id: diningTables.id });
  return rows[0]!.id;
}

/** A snapshot of a tab's lines joined to their ticket items, keyed by `line_no`: the tab line's
 *  `course_id`, the held item's `course_id` snapshot, whether the item has fired, and its kitchen state.
 *  The witness of the race's winner (fired or not). */
async function tabSnapshot(tabId: string): Promise<
  {
    lineNo: number;
    lineCourse: string | null;
    itemCourse: string | null;
    fired: boolean;
    state: string;
  }[]
> {
  // `fired` is a SQL comparison answered as the integer 1 or 0 on this engine, with no column
  // mapping in the way; the mapping below turns it into the boolean the `toEqual` assertions pin.
  const { rows } = await suite.db.execute<{
    line_no: number;
    line_course: string | null;
    item_course: string | null;
    fired: number;
    state: string;
  }>(sql`
    select wol.line_no,
           wol.course_id as line_course,
           ti.course_id  as item_course,
           (ti.fired_at is not null) as fired,
           ti.state
    from working_order_lines wol
    join ticket_items ti
      on ti.working_order_line_id = wol.id
    where wol.working_order_id = ${tabId}
    order by wol.line_no`);
  return rows.map((r) => ({
    lineNo: r.line_no,
    lineCourse: r.line_course,
    itemCourse: r.item_course,
    fired: r.fired === 1,
    state: r.state,
  }));
}

/** Every `print_jobs` id — the before-set the race diffs against to find slips enqueued by the two
 *  racing verbs. */
async function printJobIds(): Promise<Set<string>> {
  const { rows } = await suite.db.execute<{ id: string }>(sql`select id from print_jobs `);
  return new Set(rows.map((r) => r.id));
}

/** Count the RECALLED correction slips a tenant gained since `before` — a print job whose decoded ESC/POS
 *  payload carries the "RECALLED" header `formatCorrectionSlip` writes. A `sendLines` fire enqueues a
 *  plain kitchen ticket (no such header); only a `recallLines` of a fired line enqueues a RECALLED slip. */
async function recalledSlipsSince(before: Set<string>): Promise<number> {
  // `payload` is a BLOB, which this engine's driver hands back as a plain `Uint8Array`
  // (`packages/db/src/schema/columns.ts`'s `bytes` custom type records the same measurement);
  // `decodeTicket` takes either that or a `Buffer`.
  const { rows } = await suite.db.execute<{ id: string; payload: Uint8Array }>(
    sql`select id, payload from print_jobs `,
  );
  return rows.filter((r) => !before.has(r.id) && decodeTicket(r.payload).includes("RECALLED"))
    .length;
}

describe("coursing editing verbs — sendLines racing recallLines (Task B1, two concurrent callers)", () => {
  it("concurrent sendLines + recallLines on the same held line serialise — one clean winner, no lost update", async () => {
    const { cfg, cafe } = await setupVenue();

    // A printer on the venue's default station, so a fire enqueues a kitchen ticket and a recall of a
    // fired line enqueues a RECALLED correction slip — the paper trail the no-lost-update invariant reads.
    const station = await defaultStationId(cfg);
    await withTransaction(suite.db, async (tx) => {
      const printCfg: PrintConfig = { locationId: cfg.locationId };
      const { id: printerId } = await createPrinter(tx, printCfg, {
        name: "P-Cocina",
        transport: "cloud_poll",
        pollId: `poll-${randomUUID()}`,
      });
      await attachPrinterToStation(tx, { stationId: station, printerId });
    });

    // Open a tab whose ONE line is HELD (`hold: true`) — fired_at null, state queued, routed to the
    // default station. Nothing has printed yet.
    const tabId = await withTransaction(suite.db, async (tx) => {
      const tables = await offerProducts(tx, cfg, { zone: "tables" });
      const tableId = await addTable(tx, cfg, tables.zoneId);
      const { tabId } = await openTab(tx, cfg, { tableId });
      await addTabRound(
        tx,
        cfg,
        tabId,
        tables.toOfferLines([{ productId: cafe.id, quantity: "1", hold: true }]),
      );
      return tabId;
    });
    expect(await tabSnapshot(tabId)).toEqual([
      { lineNo: 1, lineCourse: null, itemCourse: null, fired: false, state: "queued" },
    ]);
    const jobsBefore = await printJobIds();

    // The INVERSE verbs on the SAME held line, both transactions started before either has finished.
    // `sendLines` fires the held line; `recallLines` un-fires a fired-and-queued line. They cannot
    // interleave: the write queue runs whichever it admitted first to completion and commits it, then
    // runs the other against that committed result. Both verbs are legal on this line in either
    // order, so BOTH succeed. The queue takes them in the order handed to it, so only ONE of the
    // invariant's two outcomes is reached here (`sendLines` first: the line ends HELD with one
    // RECALLED slip); the invariant below is written both ways because it is what must hold.
    const results = await Promise.allSettled([
      withTransaction(suite.db, async (tx) => {
        await sendLines(tx, cfg, tabId, [1]);
      }),
      withTransaction(suite.db, async (tx) => {
        await recallLines(tx, cfg, tabId, [1]);
      }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);

    // The outcome is ONE clean serial result, never a torn interleave: still exactly one ticket item,
    // still state queued (neither verb moves the kitchen state).
    const after = await tabSnapshot(tabId);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ lineNo: 1, state: "queued" });

    // NO-LOST-UPDATE INVARIANT, order-independent (holds whichever verb goes first):
    //  • send goes last  → line FIRED (fired true), send enqueued a kitchen ticket, recall found the
    //    line still held and enqueued NO recalled slip.
    //  • recall goes last → line HELD (fired false); because recall read the fired line after the send
    //    had committed, it MUST have enqueued a RECALLED slip.
    // So `fired === false` ⟺ `≥1 RECALLED slip`. A held-line-with-no-slip pairing is exactly the lost
    // update serialisation prevents (recall un-firing off a stale pre-send read, the paper kitchen
    // never told to pull the printed line) — this assertion fails on that torn state.
    const recalledSlips = await recalledSlipsSince(jobsBefore);
    expect(after[0]!.fired === false).toBe(recalledSlips >= 1);
  });
});

describe("coursing editing verbs — setLineCourse racing fireCourse (Copilot #191, two concurrent callers)", () => {
  it("concurrent setLineCourse + fireCourse on the same held line never re-courses a fired line", async () => {
    const { cfg, cafe } = await setupVenue();

    // A printer on the venue's default station so a fire enqueues a kitchen ticket (the fired line's
    // paper trail); the invariant below reads the tab snapshot, not paper, but a real fire path is the
    // faithful racer.
    const station = await defaultStationId(cfg);
    await withTransaction(suite.db, async (tx) => {
      const printCfg: PrintConfig = { locationId: cfg.locationId };
      const { id: printerId } = await createPrinter(tx, printCfg, {
        name: "P-Cocina",
        transport: "cloud_poll",
        pollId: `poll-${randomUUID()}`,
      });
      await attachPrinterToStation(tx, { stationId: station, printerId });
    });

    // Two live courses. `café` is routed to `postres`, so its HELD line 1 sits in `postres`; the racer
    // `fireCourse(postres)` fires exactly that line, while `setLineCourse(line 1 → otros)` tries to move
    // it out from under the pass.
    const { postres, otros, tabId } = await withTransaction(suite.db, async (tx) => {
      const postres = await createCourse(tx, cfg, { name: "Postres", displayOrder: 9 });
      const otros = await createCourse(tx, cfg, { name: "Otros", displayOrder: 10 });
      await setProductCourse(tx, cfg, cafe.id, postres.id);
      const tables = await offerProducts(tx, cfg, { zone: "tables" });
      const tableId = await addTable(tx, cfg, tables.zoneId);
      const { tabId } = await openTab(tx, cfg, { tableId });
      await addTabRound(
        tx,
        cfg,
        tabId,
        tables.toOfferLines([{ productId: cafe.id, quantity: "1", hold: true }]),
      );
      return { postres, otros, tabId };
    });
    // Baseline: one HELD line in `postres`, nothing fired.
    expect(await tabSnapshot(tabId)).toEqual([
      { lineNo: 1, lineCourse: postres.id, itemCourse: postres.id, fired: false, state: "queued" },
    ]);

    // `setLineCourse` (move the held line to `otros`) against `fireCourse` (fire `postres`, which the
    // held line is in), both transactions started before either has finished. `fireCourse` makes no
    // open-tab check of its own; what keeps the two apart is the write queue, which runs whichever it
    // admitted first to completion before starting the other. It takes them in the order handed to
    // it, so only ONE of the invariant's two outcomes is reached here (`setLineCourse` first: the line
    // ends re-coursed to `otros` and still HELD); the invariant below is written both ways because it
    // is what must hold.
    const [sc, fc] = await Promise.allSettled([
      withTransaction(suite.db, async (tx) => {
        await setLineCourse(tx, cfg, tabId, 1, otros.id);
      }),
      withTransaction(suite.db, async (tx) => {
        await fireCourse(tx, cfg, tabId, postres.id);
      }),
    ]);
    // `fireCourse` is legal in either order — it fires the held line (setLineCourse went second) or
    // matches nothing because the line has moved to `otros` (setLineCourse went first) — so it NEVER
    // throws.
    expect(fc.status).toBe("fulfilled");
    const scStatus: "fulfilled" | "rejected" = sc.status;
    const scReason: unknown = sc.status === "rejected" ? sc.reason : undefined;

    const after = (await tabSnapshot(tabId))[0]!;
    expect(after.state).toBe("queued"); // neither verb moves the kitchen state

    // THE INVARIANT (order-independent, holds whichever verb goes first): a line that FIRED never ends
    // up with a course changed after firing. Exactly two outcomes, and serialisation forbids any third:
    //  • fireCourse went first → line FIRED, still in `postres` (course NOT moved), and setLineCourse read
    //    `fired_at` set and threw `ticket.already_fired`.
    //  • setLineCourse went first → line re-coursed to `otros` and still HELD; fireCourse then re-read the
    //    moved row, its `course_id = postres` predicate no longer matched, and it fired nothing.
    // A fired line sitting in `otros` (course moved post-fire) is precisely the torn state serialisation
    // prevents — this assertion fails on it.
    if (after.fired) {
      expect(after.lineCourse).toBe(postres.id);
      expect(after.itemCourse).toBe(postres.id);
      expect(scStatus).toBe("rejected");
      expect(scReason).toMatchObject({
        code: "ticket.already_fired",
        params: { workingOrderId: tabId },
      });
    } else {
      expect(after.lineCourse).toBe(otros.id);
      expect(after.itemCourse).toBe(otros.id);
      expect(scStatus).toBe("fulfilled");
    }
  });
});

describe("coursing editing verbs — recallLines racing fireCourse (Copilot #191, two concurrent callers)", () => {
  it("concurrent recallLines + fireCourse on the same held line never un-fires a printed line without a RECALLED slip", async () => {
    const { cfg, cafe } = await setupVenue();

    // A printer on the venue's default station, so a fire enqueues a kitchen ticket and a recall of a
    // fired line enqueues a RECALLED correction slip — the paper trail the invariant reads.
    const station = await defaultStationId(cfg);
    await withTransaction(suite.db, async (tx) => {
      const printCfg: PrintConfig = { locationId: cfg.locationId };
      const { id: printerId } = await createPrinter(tx, printCfg, {
        name: "P-Cocina",
        transport: "cloud_poll",
        pollId: `poll-${randomUUID()}`,
      });
      await attachPrinterToStation(tx, { stationId: station, printerId });
    });

    // `café` routed to `postres`, added HELD (line 1) — so `fireCourse(postres)` fires exactly that line
    // and `recallLines([1])` targets it. Nothing printed yet.
    const { postres, tabId } = await withTransaction(suite.db, async (tx) => {
      const postres = await createCourse(tx, cfg, { name: "Postres", displayOrder: 9 });
      await setProductCourse(tx, cfg, cafe.id, postres.id);
      const tables = await offerProducts(tx, cfg, { zone: "tables" });
      const tableId = await addTable(tx, cfg, tables.zoneId);
      const { tabId } = await openTab(tx, cfg, { tableId });
      await addTabRound(
        tx,
        cfg,
        tabId,
        tables.toOfferLines([{ productId: cafe.id, quantity: "1", hold: true }]),
      );
      return { postres, tabId };
    });
    expect(await tabSnapshot(tabId)).toEqual([
      { lineNo: 1, lineCourse: postres.id, itemCourse: postres.id, fired: false, state: "queued" },
    ]);
    const jobsBefore = await printJobIds();

    // `recallLines([1])` (un-fire the line) against `fireCourse(postres)` (fire it), both transactions
    // started before either has finished. `fireCourse` makes no open-tab check of its own; what keeps
    // the two apart is the write queue, which runs whichever it admitted first to completion before
    // starting the other. Both are legal on this line in either order, so BOTH succeed. The queue
    // takes them in the order handed to it, so only ONE of the invariant's two outcomes is reached
    // here (`recallLines` first: the line ends FIRED with zero RECALLED slips); the invariant below is
    // written both ways because it is what must hold.
    const results = await Promise.allSettled([
      withTransaction(suite.db, async (tx) => {
        await recallLines(tx, cfg, tabId, [1]);
      }),
      withTransaction(suite.db, async (tx) => {
        await fireCourse(tx, cfg, tabId, postres.id);
      }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);

    const after = await tabSnapshot(tabId);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ lineNo: 1, state: "queued" }); // neither verb moves the kitchen state

    // THE INVARIANT (order-independent, holds whichever verb goes first): a line that FIRED (and
    // PRINTED) is never un-fired by recall WITHOUT a RECALLED slip. Exactly two outcomes, and
    // serialisation forbids any third:
    //  • recall went first → it read the line HELD, un-fired a no-op, enqueued NO slip; `fireCourse` then
    //    fired the still-held line and PRINTED it → line FIRED (fired true), no recalled slip (correct: the
    //    printed ticket stands, nothing to pull).
    //  • fireCourse went first → line FIRED + PRINTED; recall then read it as previously-fired, un-fired
    //    it AND enqueued a RECALLED slip → line HELD (fired false) with ≥1 recalled slip.
    // So `fired === false` ⟺ `≥1 RECALLED slip`. A held-line-with-no-slip pairing is exactly the torn state
    // serialisation prevents (recall un-firing off a stale pre-fire read, the paper kitchen never told to
    // pull the ticket `fireCourse` printed) — this assertion fails on it.
    const recalledSlips = await recalledSlipsSince(jobsBefore);
    expect(after[0]!.fired === false).toBe(recalledSlips >= 1);
  });
});

/** The order's current revision, for an edit whose test is not about the out-of-date check. */
async function revisionOf(orderId: string): Promise<number> {
  const [row] = await suite.db
    .select({ revision: workingOrders.revision })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  return row!.revision;
}
