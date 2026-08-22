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
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import { asAppUser, verifyAmendmentChain, withTenant } from "@waitron/db";
import type { Transaction, VerifiableAmendment } from "@waitron/db";
import { listOutstandingSales } from "@waitron/core";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { readOrderFlow } from "./till-config.js";
import type { OrderFlow, TillConfig } from "./till-config.js";
import {
  abandonHeldOrder,
  advanceTicket,
  advanceTicketItem,
  cancelPlacedOrder,
  getHeldOrder,
  listHeldOrders,
  listStationQueue,
  markCollected,
  parkOrder,
  placeOrder,
  sendToPrep,
  updateHeldOrder,
} from "./working-order.js";
import { collectOrder, payWorkingOrder } from "./till-sale.js";
import "./errors.js";

// Real Postgres, not PGlite — mandatory for THIS suite (CLAUDE.md §4). The idempotency + concurrency
// properties are exactly what PGlite CANNOT show: it runs every connection as a superuser (bypassing
// the RLS the app role writes under) and serialises every query onto ONE backend, so a "two concurrent
// pays" test there is a FALSE pass, not a weak one. Every distinct-connection race below opens its own
// backend via `suite.pg.connect()`, and the shared-container globalSetup (`testing/global-setup.ts`)
// THROWS its `dockerRequired` message rather than skipping when Docker is absent, so a vanished suite
// fails loudly instead of reporting a green that proves nothing.
const LOCALE = "es-ES";

// The accountable operator every placing/cancel amendment is attributed to. `order_amendments.actor_id`
// is a plain uuid with NO FK (the sale_voids.voided_by shape), so a fixed fixture uuid stands in for
// the session's `personId` the till supplies in production — the value is only ever compared, never
// joined.
const OPERATOR = "0000ffff-2222-4000-8000-0000000000aa";

const suite = useTemplateDb({ template: "manifest" });

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
    // No integrated card terminal for these working-order RLS suites.
    cardProvider: "none",
    tipsEnabled: false,
    // The venue provisions with the DEFAULT `prepay` mode; a mode-specific test overrides both the
    // cfg field AND the location's `order_flow` column via `modeVenue` (below).
    orderFlow: "prepay",
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
      admin: {
        displayName: "Administradora",
        pinHash: hashPin("1234"),
        passwordHash: hashPassword("dashPass123"),
      },
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

/**
 * A fresh venue set to a specific pay-timing `mode`: `setupVenue` provisions with the DEFAULT `prepay`
 * (planVenue has no mode input), then this flips the location's `order_flow` column to `mode` (as the
 * owner, RLS bypassed) AND sets `cfg.orderFlow` to match — so both the DB (what `readOrderFlow` reads)
 * and the in-memory config (what `placeOrder`/`collectOrder` dispatch on) agree, exactly as boot wires
 * them in production.
 */
async function modeVenue(mode: OrderFlow): Promise<SeededVenue> {
  const venue = await setupVenue();
  await suite.admin.execute(
    sql`update locations set order_flow = ${mode} where id = ${venue.cfg.locationId}`,
  );
  return { ...venue, cfg: { ...venue.cfg, orderFlow: mode } };
}

/** This tenant's OUTSTANDING (issued-but-unsettled) sales, read as the app role under the tenant —
 *  the surface an invoice-first order shows on between placing and collect. */
async function outstandingFor(cfg: TillConfig): Promise<{ saleId: string; amountDue: string }[]> {
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const rows = await listOutstandingSales(tx, cfg.tenantId);
    return rows.map((r) => ({ saleId: r.saleId, amountDue: r.amountDue }));
  });
}

/** How many `sales` rows reference this working order — read as the superuser owner (bypasses RLS). */
async function saleCount(workingOrderId: string): Promise<number> {
  const { rows } = await suite.admin.execute<{ count: string }>(sql`
    select count(*)::text as count from sales where working_order_id = ${workingOrderId}
  `);
  return Number(rows[0]!.count);
}

/** The IMMUTABLE filed `sales.total` for this working order's sale — read as the owner (bypasses RLS).
 *  The witness that a retrieved order files at the LOCKED price, not a re-price at pay. */
async function filedSaleTotal(workingOrderId: string): Promise<string> {
  const { rows } = await suite.admin.execute<{ total: string }>(sql`
    select total from sales where working_order_id = ${workingOrderId}
  `);
  return rows[0]!.total;
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

/** The tenders filed against this working order's sale — method + amount, read as the owner
 *  (bypasses RLS). Ordered by method so a multi-tender assertion is stable. */
async function tendersFor(workingOrderId: string): Promise<{ method: string; amount: string }[]> {
  const { rows } = await suite.admin.execute<{ method: string; amount: string }>(sql`
    select t.method, t.amount
    from tenders t
    join sales s on s.id = t.sale_id
    where s.working_order_id = ${workingOrderId}
    order by t.method
  `);
  return rows.map((r) => ({ method: r.method, amount: r.amount }));
}

/** The `payments` rows for this working order — provider/state/amount, plus whether `sale_id`
 *  actually points at the filed sale (the association witness) — read as the owner (bypasses RLS).
 *  The inner join to `sales` on `working_order_id` (unique per sale) is how `linkedToSale` compares
 *  the payment's `sale_id` against the ONE sale filed from this order. */
async function paymentsFor(
  workingOrderId: string,
): Promise<{ provider: string; state: string; amount: string; linkedToSale: boolean }[]> {
  const { rows } = await suite.admin.execute<{
    provider: string;
    state: string;
    amount: string;
    linked: boolean;
  }>(sql`
    select p.provider, p.state, p.amount,
           (p.sale_id is not null and p.sale_id = s.id) as linked
    from payments p
    join sales s on s.working_order_id = p.working_order_id
    where p.working_order_id = ${workingOrderId}
    order by p.provider
  `);
  return rows.map((r) => ({
    provider: r.provider,
    state: r.state,
    amount: r.amount,
    linkedToSale: r.linked,
  }));
}

/** How many `payments` rows exist for this working order (superuser read) — the idempotency witness:
 *  a card lost-response retry must not file a SECOND captured payment. */
async function paymentCount(workingOrderId: string): Promise<number> {
  const { rows } = await suite.admin.execute<{ count: string }>(sql`
    select count(*)::text as count from payments where working_order_id = ${workingOrderId}
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

/** Whether this order's `collected_at` (customer-handover) marker is set — owner read. The witness that
 *  the collect flow stamped the ORDER-level marker `listStationQueue` excludes on (§3e): a placed order
 *  fired to a station leaves that station's queue once `collectOrder` sets it. Kept separate from
 *  {@link orderState} (whose `toEqual` assertions pin exactly `{status, settledAtSet}`). */
async function collectedAtSet(id: string): Promise<boolean> {
  const { rows } = await suite.admin.execute<{ collected: boolean }>(sql`
    select (collected_at is not null) as collected from working_orders where id = ${id}
  `);
  return rows[0]!.collected;
}

/**
 * This order's whole amendment chain, read back as verifiable rows in chain-position order, as the
 * owner (bypasses RLS — a read-back for verification, not the isolation assertion). `event_at` is
 * projected to a UTC ISO instant with a millisecond field (always `.000`, the stored value being
 * whole-second-truncated) so `verifyAmendmentChain`'s `Date.parse` sees exactly the instant the stored
 * hash committed. Ported verbatim from `append-order-amendment.rls.test.ts`'s own `readAmendments`.
 */
async function readAmendments(id: string): Promise<VerifiableAmendment[]> {
  // An inline row TYPE LITERAL, not `execute<VerifiableAmendment>`: `execute`'s generic is constrained
  // to `Record<string, unknown>`, which an INTERFACE does not satisfy while a structurally-identical
  // type literal does. The literal's fields mirror VerifiableAmendment exactly.
  const { rows } = await suite.admin.execute<{
    sequenceNo: number;
    workingOrderId: string;
    kind: "order_placed" | "order_cancelled";
    actorId: string;
    reason: string | null;
    capturedByTillId: string;
    capturedByNodeId: string;
    eventAt: string;
    eventOffsetMinutes: number;
    entryHash: string;
    prevEntryHash: string | null;
    isFirstEntry: boolean;
  }>(sql`
    select
      sequence_no as "sequenceNo",
      working_order_id as "workingOrderId",
      kind,
      actor_id as "actorId",
      reason,
      captured_by_till_id as "capturedByTillId",
      captured_by_node_id as "capturedByNodeId",
      to_char(event_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "eventAt",
      event_offset_minutes as "eventOffsetMinutes",
      entry_hash as "entryHash",
      prev_entry_hash as "prevEntryHash",
      is_first_entry as "isFirstEntry"
    from order_amendments
    where working_order_id = ${id}
    order by sequence_no
  `);
  return rows;
}

/** The kitchen state of the ticket item fired for this SINGLE-line order, or null when none was fired —
 *  owner read. Placing (Modes I/T, inside `placeOrder`) and send-to-prep (Mode P) fire one `ticket_items`
 *  row per line (KDS-1); a walk-up never fires. The callers here fire SINGLE-line orders, so at most one
 *  row exists — the per-line `ticket_items` successor to the dropped-`order_prep` `prepStateOf`. */
async function ticketStateOf(id: string): Promise<string | null> {
  const { rows } = await suite.admin.execute<{ state: string }>(sql`
    select state from ticket_items where working_order_id = ${id}
  `);
  return rows[0]?.state ?? null;
}

/** The venue's default kitchen station id (`applyVenue` seeds one "Cocina" per location — venue-apply.ts)
 *  — owner read. Every fixture line here carries no product/category route, so it fires to this station;
 *  it is the id the whole-ticket bump and the per-station queue address. */
async function defaultStationId(cfg: TillConfig): Promise<string> {
  const { rows } = await suite.admin.execute<{ id: string }>(sql`
    select id from kitchen_stations
    where location_id = ${cfg.locationId} and is_default and active
  `);
  return rows[0]!.id;
}

/** The ticket item ids fired for an order, in `line_no` order — owner read. The per-line bump targets
 *  for {@link advanceTicketItem}, addressed by index the way the display taps a specific line. */
async function ticketItemIdsFor(orderId: string): Promise<string[]> {
  const { rows } = await suite.admin.execute<{ id: string }>(sql`
    select ti.id
    from ticket_items ti
    join working_order_lines wol
      on wol.id = ti.working_order_line_id and wol.tenant_id = ti.tenant_id
    where ti.working_order_id = ${orderId}
    order by wol.line_no
  `);
  return rows.map((r) => r.id);
}

/**
 * Run one of the tx-based KDS verbs (advanceTicketItem/advanceTicket/listStationQueue) under a cfg's
 * tenant + `app_user` scope. Unlike the old deps-based `advancePrep`, these verbs run on a
 * CALLER-supplied transaction, so the suite opens the `withTenant` + `asAppUser` scope for them — as
 * `app_user`, so RLS is IN FORCE (a foreign tenant's ticket items are invisible), which is what the
 * cross-tenant isolation assertions below rest on.
 */
async function asTenant<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/**
 * A SECOND register on the SAME node — a `cfg` that shares `cfg`'s tenant, node, series and location
 * and differs only in `till_id`. The row is inserted as the OWNER under `withTenant`, exactly as
 * `applyVenue` writes a till (an explicit `tenant_id` satisfies the RLS WITH CHECK whether or not the
 * owner is forced under it). Proving cross-till retrieval needs a genuine second till row because both
 * `working_orders.till_id` and `sales.till_id` FK onto `tills` — a fabricated uuid would fail those.
 */
async function addTill(cfg: TillConfig, name: string): Promise<TillConfig> {
  const id = randomUUID();
  await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await tx.execute(sql`
      insert into tills (id, tenant_id, location_id, name)
      values (${id}, ${cfg.tenantId}, ${cfg.locationId}, ${name})`);
  });
  return { ...cfg, tillId: brandTillId(id) };
}

/**
 * A SECOND node under the SAME tenant + location — a `cfg` differing only in `node_id`. It never
 * sells here; it exists so `listHeldOrders` on it proves the `node_id = cfg.nodeId` filter rather than
 * RLS (which is tenant-scoped and would NOT hide a same-tenant order on another node). Inserted as the
 * owner under `withTenant`, the way `applyVenue`'s create-node does; `filing_module`/`tax_module` are
 * nullable and unused for a listing-only node, so they are left out.
 */
async function addNode(cfg: TillConfig, name: string): Promise<TillConfig> {
  const id = randomUUID();
  await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await tx.execute(sql`
      insert into nodes (id, tenant_id, location_id, name)
      values (${id}, ${cfg.tenantId}, ${cfg.locationId}, ${name})`);
  });
  return { ...cfg, nodeId: brandNodeId(id) };
}

/**
 * A parked order's line count and summed `line_total` (the GROSS draft total the held list shows) —
 * read as the owner and summed in JS, NOT the SQL `listHeldOrders` runs, so its `itemCount`/`total`
 * aggregate is validated rather than restated (CLAUDE.md §1). Cent-magnitude 2dp values sum exactly
 * in float here.
 */
async function draftAggregate(id: string): Promise<{ itemCount: number; total: string }> {
  const { rows } = await suite.admin.execute<{ line_total: string }>(sql`
    select line_total from working_order_lines where working_order_id = ${id}
  `);
  const total = rows.reduce((sum, r) => sum + Number(r.line_total), 0).toFixed(2);
  return { itemCount: rows.length, total };
}

/** The till the SALE was filed under vs the till the working order was PARKED under — the cross-till
 *  witness (parked on A, sold on B). Read as the owner (bypasses RLS). */
async function saleAndOrderTill(
  workingOrderId: string,
): Promise<{ saleTillId: string; orderTillId: string }> {
  const sale = await suite.admin.execute<{ till_id: string }>(sql`
    select till_id from sales where working_order_id = ${workingOrderId}`);
  const order = await suite.admin.execute<{ till_id: string }>(sql`
    select till_id from working_orders where id = ${workingOrderId}`);
  return { saleTillId: sale.rows[0]!.till_id, orderTillId: order.rows[0]!.till_id };
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
    // The FILED line list the receipt renders (Finding 2): the priced walk-up composition — name, the
    // display quantity, and the GROSS the line was filed at. Σ(gross) == total.
    expect(res.lines).toEqual([
      { descriptions: { [LOCALE]: "Café" }, quantity: "1", gross: "1.50" },
    ]);

    // The working order was created AND settled in the one transaction; exactly one sale + one
    // registro reference it.
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
  });

  it("parked: pays the STORED composition at its LOCKED prices and settles it", async () => {
    const { cfg, cafe, agua } = await setupVenue();
    const id = randomUUID();

    // Park café×1 + agua×1 — BOTH added, so both gross units are LOCKED onto their `working_order_lines`
    // rows (design §2, line-add snapshot). Then pay the SAME id with NO client basket (`lines: []`): a
    // retrieved order is filed from its STORED locked lines, not a re-price of anything the till sends.
    // The old model re-priced the sent basket; this one cannot, which is the behaviour under test.
    await parkOrder({ db: suite.admin }, cfg, {
      id,
      lines: [
        { productId: cafe.id, quantity: "1" },
        { productId: agua.id, quantity: "1" },
      ],
      label: "Mesa 4",
    });
    expect(await orderState(id)).toEqual({ status: "open", settledAtSet: false });
    // What the customer was shown at park — the GROSS draft total (sum of the locked line totals).
    const parkedTotal = (await draftAggregate(id)).total;
    expect(parkedTotal).toBe("3.50"); // 1.50 café + 2.00 agua, locked

    const res = await payWorkingOrder({ db: suite.admin, backend, clock }, cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "5.00" },
    });

    // The LOCKED composition, filed from the stored lines: 1.50 + 2.00 = 3.50. Round-trip invariant —
    // the filed total EQUALS the gross the customer was shown at park (`parkedTotal`).
    expect(res.total).toBe("3.50");
    expect(res.total).toBe(parkedTotal);
    expect(res.change).toBe("1.50");
    // The receipt line list is the STORED lock (Finding 2), not any client basket the till sent (it
    // sent none). The stored numeric(_,3) quantities ("1.000") print trailing-zero-trimmed ("1").
    expect(res.lines).toEqual([
      { descriptions: { [LOCALE]: "Café" }, quantity: "1", gross: "1.50" },
      { descriptions: { [LOCALE]: "Agua" }, quantity: "1", gross: "2.00" },
    ]);
    expect(res.invoiceNumber).toBe("A/1");
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
  });

  it("retrieve → edit → pay files the RE-LOCKED edit, not the pre-edit lock (Finding 2 — no silent drop)", async () => {
    const { cfg, cafe } = await setupVenue();
    const id = randomUUID();

    // Park café×1 (locked 1.50) — the composition a retrieve loads onto the till.
    await parkOrder({ db: suite.admin }, cfg, {
      id,
      lines: [{ productId: cafe.id, quantity: "1" }],
    });
    expect((await draftAggregate(id)).total).toBe("1.50");

    // The operator EDITS the retrieved basket (café×1 → café×2); the till re-syncs it BEFORE paying
    // (`updateWorkingOrder` → `updateHeldOrder`), re-locking the new composition. WITHOUT this sync the
    // retrieved-order pay path files the pre-edit lock and the edit is SILENTLY DROPPED — the 7c
    // regression this closes (the till-app side is pinned by `retrieve → edit → pay re-syncs …`).
    await updateHeldOrder({ db: suite.admin }, cfg, id, {
      lines: [{ productId: cafe.id, quantity: "2" }],
    });
    expect((await draftAggregate(id)).total).toBe("3.00"); // the lock now reflects the edit

    // Pay the retrieved order (no client basket — files from the stored lock, which is now the edit).
    const res = await payWorkingOrder({ db: suite.admin, backend, clock }, cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "5.00" },
    });

    // The EDIT is what was charged AND filed: 3.00 (café×2), never the pre-edit 1.50. Its receipt line
    // list carries the edited quantity, and the immutable record's total matches — the edit reached the
    // fiscal record rather than being dropped.
    expect(res.total).toBe("3.00");
    expect(res.change).toBe("2.00");
    expect(res.lines).toEqual([
      { descriptions: { [LOCALE]: "Café" }, quantity: "2", gross: "3.00" },
    ]);
    expect(await filedSaleTotal(id)).toBe("3.00");
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
  });

  it("files a parked line at its LOCKED price after the catalogue price changes (line-add snapshot)", async () => {
    const { cfg, cafe } = await setupVenue();
    const id = randomUUID();

    // Park café×1 at the locked 1.50 — the gross unit is snapshotted onto the line here.
    await parkOrder({ db: suite.admin }, cfg, {
      id,
      lines: [{ productId: cafe.id, quantity: "1" }],
    });

    // Change the catalogue price AFTER the lock — the exact mutation across the park→pay gap that
    // separates the two pricing models (CLAUDE.md §1: a measurement where both answers look alike
    // measures nothing). A re-price at pay would file 9.99; filing from the lock files 1.50.
    await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await tx.execute(sql`update products set unit_price = '9.99' where id = ${cafe.id}`);
    });

    // Pay — files at the LOCKED 1.50, never the new 9.99.
    const res = await payWorkingOrder({ db: suite.admin, backend, clock }, cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "5.00" },
    });

    expect(res.total).toBe("1.50"); // the lock, not 9.99
    expect(res.change).toBe("3.50");
    // The IMMUTABLE fiscal record carries the locked price — read back as the owner (bypasses RLS).
    expect(await filedSaleTotal(id)).toBe("1.50");
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
  });

  it("idempotent replay: a second pay with the same id returns the SAME ticket — filed QR and breakdown, no second record", async () => {
    const { cfg, cafe, agua } = await setupVenue();
    const id = randomUUID();
    const req = {
      id,
      // A DIVERGENCE-PRONE basket at ONE rate (21%): café×1 (gross 1.50 → base 1.24) + agua×2 (gross
      // 4.00 → base 3.31). The FILED difference-method group is base 4.55, tax = 5.50 − 4.55 = 0.95;
      // a naive base×rate recompute gives round(4.55 × 21%) = 0.96 — a DIFFERENT cent. So this basket
      // proves the replay returns the FILED figures (Task 14), not the old reconstruction, which would
      // have made the assertion below fail with 0.96 ≠ 0.95.
      lines: [
        { productId: cafe.id, quantity: "1" },
        { productId: agua.id, quantity: "2" },
      ],
      tender: { method: "cash" as const, amount: "10.00" },
    };
    const deps = { db: suite.admin, backend, clock };

    const first = await payWorkingOrder(deps, cfg, req);
    // The filed breakdown is the difference-method figure (0.95), the divergent value the old replay
    // reconstruction (0.96) could not have produced.
    expect(first.total).toBe("5.50");
    expect(first.vatBreakdown).toEqual([{ rate: "21.00", base: "4.55", tax: "0.95" }]);
    expect(first.qr.length).toBeGreaterThan(0); // a genuine first filing carries the AEAT QR
    // The FILED line list (Finding 2): café×1 (gross 1.50) + agua×2 (gross 4.00). Σ(gross) == 5.50.
    expect(first.lines).toEqual([
      { descriptions: { [LOCALE]: "Café" }, quantity: "1", gross: "1.50" },
      { descriptions: { [LOCALE]: "Agua" }, quantity: "2", gross: "4.00" },
    ]);

    // The retry — same id, same body. Files NOTHING; returns the first ticket.
    const second = await payWorkingOrder(deps, cfg, req);

    expect(second.invoiceNumber).toBe(first.invoiceNumber);
    expect(second.total).toBe(first.total);
    expect(second.issuedAt).toBe(first.issuedAt);
    // The replay now reads the EXACT filed desglose (Task 14), so it equals the original's — the
    // divergence between the difference method and a recompute is gone.
    expect(second.vatBreakdown).toEqual(first.vatBreakdown);
    // The replayed ticket's line list is read back from the order's stored lock (Finding 2), so it is
    // byte-identical to the original's — filed lines both times, never a client basket the retry sent.
    expect(second.lines).toEqual(first.lines);
    // The replayed ticket carries the SAME mandatory Veri*Factu QR the original did, re-derived from
    // the filed record. `change` stays 0.00 — a documented replay limitation: the tendered cash is not
    // persisted and the drawer change was handed over at the ORIGINAL sale.
    expect(second.change).toBe("0.00");
    expect(second.qr).toBe(first.qr);
    expect(second.qr.length).toBeGreaterThan(0);

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

  it("a retrieved pay IGNORES req.lines — even an unknown product there — and files the STORED lock", async () => {
    const { cfg, cafe } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db: suite.admin }, cfg, {
      id,
      lines: [{ productId: cafe.id, quantity: "1" }], // the STORED lock: café×1 at 1.50
    });
    const UUID_NOT_IN_CAT = "00000000-0000-0000-0000-000000000000";

    // A retrieved order files from its STORED locked lines; `req.lines` is IGNORED entirely (design §2,
    // line-add snapshot). Under the OLD re-price-at-pay model this garbage basket — an unknown product —
    // would have thrown `sale.unknown_product`; under the new one it is not even looked at, so the pay
    // SUCCEEDS on the stored café×1. Divergent inputs, opposite outcomes (CLAUDE.md §1): this is the
    // regression guard against anyone re-reading `req.lines` for a retrieved order.
    const res = await payWorkingOrder({ db: suite.admin, backend, clock }, cfg, {
      id,
      lines: [{ productId: UUID_NOT_IN_CAT, quantity: "1" }],
      tender: { method: "cash", amount: "5.00" },
    });

    // Filed the stored lock (1.50), not the garbage basket — settled exactly once.
    expect(res.total).toBe("1.50");
    expect(res.change).toBe("3.50");
    expect(await filedSaleTotal(id)).toBe("1.50");
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
  });

  it("refuses an empty basket and any tender that is neither cash nor card (voucher/transfer/other)", async () => {
    const { cfg, cafe } = await setupVenue();
    const deps = { db: suite.admin, backend, clock };

    await expect(
      payWorkingOrder(deps, cfg, {
        id: randomUUID(),
        lines: [],
        tender: { method: "cash", amount: "0" },
      }),
    ).rejects.toMatchObject({ code: "sale.empty_basket" });

    // cash and card are the supported tenders (slice 7a cash + this slice's manual card); every other
    // `tender_method` enum value is still refused with `sale.unsupported_tender`. The `as unknown` cast
    // is how an untrusted till can send one past the widened `"cash" | "card"` type at runtime.
    for (const method of ["voucher", "transfer", "other"] as const) {
      await expect(
        payWorkingOrder(deps, cfg, {
          id: randomUUID(),
          lines: [{ productId: cafe.id, quantity: "1" }],
          tender: { method: method as unknown as "cash", amount: "1.50" },
        }),
      ).rejects.toMatchObject({ code: "sale.unsupported_tender", params: { method } });
    }
  });
});

describe("parkOrder concurrent replay", () => {
  it("concurrent double-park of the same id parks ONE order — the 23505 replay backstop (two connections)", async () => {
    const { cfg, cafe } = await setupVenue();
    // A fresh id with NO prior row: two DISTINCT backends both `parkOrder` it. One wins the PK, the other
    // blocks on the uncommitted index tuple, then gets 23505, catches it, and REPLAYS the winner's
    // committed `{ id, orderNumber }`. This is the park backstop the sequential PGlite test cannot prove —
    // one backend never races itself. Load-bearing: DISTINCT backend PROCESSES; on PGlite they collapse
    // onto one and the race never happens (a false pass), exactly as the concurrent double-pay tests note.
    const id = randomUUID();
    const lines = [{ productId: cafe.id, quantity: "1" }];

    const [connA, connB] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
    try {
      const pids = await Promise.all(
        [connA, connB].map(async (db) => {
          const { rows } = await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
          return rows[0]!.pid;
        }),
      );
      expect(new Set(pids).size).toBe(2);

      // Both race past `parkOrder`. The loser's INSERT collides on `working_orders_pkey`, catches the
      // 23505, and replays the committed OPEN order's number — so both return the SAME result, neither errors.
      const [resA, resB] = await Promise.all([
        parkOrder({ db: connA }, cfg, { id, lines }),
        parkOrder({ db: connB }, cfg, { id, lines }),
      ]);
      expect(resA).toEqual(resB);
      expect(resA.id).toBe(id);

      // Exactly ONE order and ONE line — the loser replayed, allocating no second number (its counter
      // increment rolled back with the aborted tx) and inserting nothing.
      const { rows: orderRows } = await suite.admin.execute<{ count: number }>(
        sql`select count(*)::int as count from working_orders where id = ${id}`,
      );
      expect(orderRows[0]!.count).toBe(1);
      const { rows: lineRows } = await suite.admin.execute<{ count: number }>(
        sql`select count(*)::int as count from working_order_lines where working_order_id = ${id}`,
      );
      expect(lineRows[0]!.count).toBe(1);
    } finally {
      await Promise.all([connA.close(), connB.close()]);
    }
  });
});

// The manual (unintegrated) card tender — the "datáfono" case: the operator runs the card on a
// SEPARATE bank terminal, taps Card, and the till files the same legal Veri*Factu ticket with a
// `card` tender AND a captured `payments` row, all in the ONE sale transaction (no network call,
// `recordManualCardPayment` commits inline). Real Postgres because a captured payment is a
// privilege/RLS-scoped write under the app role, exactly what THIS suite exists to exercise.
describe("card tender (manual / datáfono)", () => {
  it("files a card sale: a card tender AND a captured manual payment linked to the filed sale; no change", async () => {
    const { cfg, cafe } = await setupVenue();
    const id = randomUUID();

    const res = await payWorkingOrder({ db: suite.admin, backend, clock }, cfg, {
      id,
      lines: [{ productId: cafe.id, quantity: "1" }], // café → 1.50 gross
      tender: { method: "card", amount: "1.50", externalRef: "OP-12345" },
    });

    // A card charges the exact amount on the terminal — nothing is handed back.
    expect(res.total).toBe("1.50");
    expect(res.change).toBe("0.00");
    expect(res.invoiceNumber).toBe("A/1");

    // One sale + one chained registro, exactly as the cash path.
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);

    // The filed tender is a CARD tender at the total.
    expect(await tendersFor(id)).toEqual([{ method: "card", amount: "1.50" }]);

    // A captured MANUAL payment linked to the filed sale — the ledger row the datáfono case adds
    // beside the tender (cash gets no payments row).
    expect(await paymentsFor(id)).toEqual([
      { provider: "manual", state: "captured", amount: "1.50", linkedToSale: true },
    ]);
  });

  it("normalises the card tender to the total — a client over-send does not change the filed amount", async () => {
    const { cfg, cafe, agua } = await setupVenue();
    const id = randomUUID();

    // café + agua = 3.50 total; the till sends a card amount that DISAGREES (5.00). A card charges the
    // exact total on the separate terminal, so both the filed tender and the payment carry 3.50, not
    // 5.00 — there is no over-tender/change path for card. Same state, divergent inputs (CLAUDE.md §1):
    // 5.00 ≠ 3.50, so a would-be pass-through of `req.tender.amount` would show here.
    const res = await payWorkingOrder({ db: suite.admin, backend, clock }, cfg, {
      id,
      lines: [
        { productId: cafe.id, quantity: "1" },
        { productId: agua.id, quantity: "1" },
      ],
      tender: { method: "card", amount: "5.00" },
    });

    expect(res.total).toBe("3.50");
    expect(res.change).toBe("0.00");
    expect(await tendersFor(id)).toEqual([{ method: "card", amount: "3.50" }]);
    expect(await paymentsFor(id)).toEqual([
      { provider: "manual", state: "captured", amount: "3.50", linkedToSale: true },
    ]);
  });

  it("card lost-response retry replays the SAME ticket and files no second payment (7b idempotency covers card)", async () => {
    const { cfg, cafe } = await setupVenue();
    const id = randomUUID();
    const req = {
      id,
      lines: [{ productId: cafe.id, quantity: "1" }],
      tender: { method: "card" as const, amount: "1.50" },
    };
    const deps = { db: suite.admin, backend, clock };

    const first = await payWorkingOrder(deps, cfg, req);
    // The retry — same id, same body (a lost first response). The 7b `sales_working_order_id_key`
    // idempotency replays the ORIGINAL ticket and files NOTHING: no second sale, no second registro,
    // and — the card-specific part — no second captured payment.
    const second = await payWorkingOrder(deps, cfg, req);

    expect(second.invoiceNumber).toBe(first.invoiceNumber);
    expect(second.total).toBe(first.total);
    expect(second.issuedAt).toBe(first.issuedAt);
    expect(second.change).toBe("0.00");

    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
    expect(await paymentCount(id)).toBe(1);
    expect(await paymentsFor(id)).toEqual([
      { provider: "manual", state: "captured", amount: "1.50", linkedToSale: true },
    ]);
  });
});

// The park & retrieve headline (spec §7b): a parked order is HELD BY THE NODE, not by the register
// that parked it, so any till on the node can list, retrieve and pay it. Real Postgres as the app
// role — the cross-tenant/cross-node isolation below is exactly what PGlite's superuser connection
// cannot show (RLS bypassed), the reason THIS suite exists.
describe("cross-till end-to-end", () => {
  it("parks on till A, lists + retrieves + pays on till B (same node), and the chain across two sales verifies", async () => {
    const { cfg: tillA, cafe, agua } = await setupVenue();
    // A SECOND register on the SAME node. It differs from till A ONLY in `till_id`: same tenant, node,
    // series and location. That shared node is the whole point — the held list is node-scoped.
    const tillB = await addTill(tillA, "Caja 2");
    expect(tillB.tillId).not.toBe(tillA.tillId);
    expect(tillB.nodeId).toBe(tillA.nodeId);

    const deps = { db: suite.admin, backend, clock };

    // Sale 1 (A/1): a walk-up cash sale on till A, so the node's huella chain already has one link
    // before the cross-till sale — `checkIntegrity` at the end verifies a chain of TWO that spans two
    // DIFFERENT tills, the concrete proof the chain is per-node, not per-till.
    const walkUp = await payWorkingOrder(deps, tillA, {
      id: randomUUID(),
      lines: [{ productId: cafe.id, quantity: "1" }],
      tender: { method: "cash", amount: "5.00" },
    });
    expect(walkUp.invoiceNumber).toBe("A/1");

    // Park an order on till A: café + agua (one VAT group at 21%), labelled for the counter.
    const orderId = randomUUID();
    const { orderNumber } = await parkOrder({ db: suite.admin }, tillA, {
      id: orderId,
      lines: [
        { productId: cafe.id, quantity: "1" },
        { productId: agua.id, quantity: "1" },
      ],
      label: "Mesa 7",
    });

    // CROSS-TILL VISIBILITY: till B's held list shows the order parked on till A. The aggregate is
    // validated against an owner read summed in JS (`draftAggregate`), not the SQL under test.
    const agg = await draftAggregate(orderId);
    expect(agg.itemCount).toBe(2);
    const heldOnB = await listHeldOrders({ db: suite.admin }, tillB);
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
    const retrieved = await getHeldOrder({ db: suite.admin }, tillB, orderId);
    expect(retrieved.id).toBe(orderId);
    expect(retrieved.label).toBe("Mesa 7");
    expect(retrieved.lines.map((l) => l.productId)).toEqual([cafe.id, agua.id]);

    // PAY on till B (Sale 2, A/2): file the retrieved order from its STORED locked lines (design §2 —
    // `req.lines` is ignored; `retrieved.lines` is passed only to mirror the real till round-trip). The
    // series is per-node, so till B's sale continues till A's chain — A/1 then A/2.
    const paid = await payWorkingOrder(deps, tillB, {
      id: orderId,
      lines: retrieved.lines,
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
    expect((await listHeldOrders({ db: suite.admin }, tillB)).map((o) => o.id)).not.toContain(
      orderId,
    );

    // THE CHAIN: the two sales on this node (A/1 walk-up on till A, A/2 cross-till on till B) verify as
    // one intact huella chain.
    const report = await withTenant(suite.admin, tillA.tenantId, (tx) =>
      backend.checkIntegrity(tx, tillA.tenantId, tillA.nodeId),
    );
    expect(report.ok).toBe(true);
    expect(report.checked).toBe(2);
  });

  it("tenant isolation: a DIFFERENT tenant's register sees NONE of tenant A's held orders", async () => {
    const { cfg: tenantA, cafe } = await setupVenue();
    const { cfg: tenantB } = await setupVenue(); // a wholly separate venue + tenant

    // Park an order under tenant A that stays OPEN, so the two reads below differ in the SAME state:
    // tenant A's list HAS it while tenant B's is empty — not "both empty", which would prove nothing
    // (CLAUDE.md §1). RLS is the mechanism confining a held order to its own tenant across the node
    // boundary; PGlite's superuser connection could not exercise it.
    const orderId = randomUUID();
    await parkOrder({ db: suite.admin }, tenantA, {
      id: orderId,
      lines: [{ productId: cafe.id, quantity: "1" }],
      label: "Mesa 1",
    });

    expect((await listHeldOrders({ db: suite.admin }, tenantA)).map((o) => o.id)).toContain(
      orderId,
    );
    expect(await listHeldOrders({ db: suite.admin }, tenantB)).toEqual([]);
  });

  it("node scope: a same-tenant register on a DIFFERENT node does not list an order parked on node A", async () => {
    const { cfg: nodeA, cafe } = await setupVenue();
    // A second node under the SAME tenant. RLS is tenant-scoped, so it does NOT hide node A's order
    // from node B — only the `node_id = cfg.nodeId` filter does, which is what this asserts. Same
    // state, opposite answers: node A lists it, node B does not.
    const nodeB = await addNode(nodeA, "Servidor 2");

    const orderId = randomUUID();
    await parkOrder({ db: suite.admin }, nodeA, {
      id: orderId,
      lines: [{ productId: cafe.id, quantity: "1" }],
    });

    expect((await listHeldOrders({ db: suite.admin }, nodeA)).map((o) => o.id)).toContain(orderId);
    expect(await listHeldOrders({ db: suite.admin }, nodeB)).toEqual([]);
  });

  it("node scope: the by-id family (get/update/abandon) fails closed on a foreign-node order under RLS", async () => {
    const { cfg: nodeA, cafe } = await setupVenue();
    // A second register under the SAME tenant + location, differing only in node_id. RLS is
    // tenant-scoped, so it does NOT hide node A's order from node B — only the `node_id = cfg.nodeId`
    // filter now in each by-id lookup does. Same state, opposite answers: node A reaches it, node B is
    // refused by all three (getHeldOrder/updateHeldOrder/abandonHeldOrder — the whole by-id family, 7b).
    const nodeB = await addNode(nodeA, "Servidor 2");

    const orderId = randomUUID();
    await parkOrder({ db: suite.admin }, nodeA, {
      id: orderId,
      lines: [{ productId: cafe.id, quantity: "1" }],
    });

    // The owning node reaches it — the order is perfectly usable, so node B's refusals below are the
    // node filter, not a broken order.
    expect((await getHeldOrder({ db: suite.admin }, nodeA, orderId)).id).toBe(orderId);

    // Node B is refused by every by-id lookup, each with its own fail-closed code.
    await expect(getHeldOrder({ db: suite.admin }, nodeB, orderId)).rejects.toMatchObject({
      code: "working_order.not_found",
      params: { workingOrderId: orderId },
    });
    await expect(
      updateHeldOrder({ db: suite.admin }, nodeB, orderId, {
        lines: [{ productId: cafe.id, quantity: "2" }],
      }),
    ).rejects.toMatchObject({
      code: "working_order.not_open",
      params: { workingOrderId: orderId },
    });
    await expect(abandonHeldOrder({ db: suite.admin }, nodeB, orderId)).rejects.toMatchObject({
      code: "working_order.not_open",
      params: { workingOrderId: orderId },
    });

    // Node B's refused attempts had NO side effect: node A's order is still open and still retrievable.
    expect((await getHeldOrder({ db: suite.admin }, nodeA, orderId)).id).toBe(orderId);
  });
});

// Placing (open → placed) opens the art. 29.2.j amendment log with its `order_placed` genesis and
// freezes composition (for free — a placed order's lines are already frozen by require_open_parent);
// cancelling a placed order (placed → abandoned) appends an `order_cancelled` amendment. Real Postgres
// because the amendment writes run as `app_user` under FORCE RLS against an append-only, REVOKE-guarded
// table — exactly what PGlite's superuser connection cannot exercise (CLAUDE.md §4). This slice files
// NO fiscal doc at placing (Mode T / generic); Mode-I's deferred file and the mode dispatch are Task 8.
describe("placeOrder / cancelPlacedOrder (placing + amendment log)", () => {
  it("placeOrder: open → placed, freezes composition, opens the log with a genesis order_placed entry", async () => {
    const { cfg, cafe } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db: suite.admin }, cfg, {
      id,
      lines: [{ productId: cafe.id, quantity: "1" }],
    });

    await placeOrder({ db: suite.admin, backend, clock }, cfg, id, OPERATOR);

    expect(await orderState(id)).toEqual({ status: "placed", settledAtSet: false });

    // Composition freeze: a line write on the now-placed order is rejected. `updateHeldOrder` locks the
    // row, reads status = 'placed' and refuses with `working_order.not_open` (its own app check); the
    // `require_open_parent` trigger is the DB backstop underneath — placing freezes for free (design §3).
    await expect(
      updateHeldOrder({ db: suite.admin }, cfg, id, {
        lines: [{ productId: cafe.id, quantity: "2" }],
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
    const { cfg, cafe } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db: suite.admin }, cfg, {
      id,
      lines: [{ productId: cafe.id, quantity: "1" }],
    });
    await placeOrder({ db: suite.admin, backend, clock }, cfg, id, OPERATOR);

    // Placing is NOT idempotent in Task 7 (Mode-I double-place idempotency arrives with the mode
    // dispatch, Task 8): a second place of the now-`placed` order is refused with
    // `working_order.not_open` (wrong status), before any transition or amendment — so the log still
    // holds exactly its one genesis entry.
    await expect(
      placeOrder({ db: suite.admin, backend, clock }, cfg, id, OPERATOR),
    ).rejects.toMatchObject({ code: "working_order.not_open", params: { workingOrderId: id } });
    expect(await readAmendments(id)).toHaveLength(1);

    // An ABSENT id — the FOR UPDATE locks nothing — is the same fail-closed code (the undefined branch),
    // and opens no log.
    const missing = randomUUID();
    await expect(
      placeOrder({ db: suite.admin, backend, clock }, cfg, missing, OPERATOR),
    ).rejects.toMatchObject({
      code: "working_order.not_open",
      params: { workingOrderId: missing },
    });
    expect(await readAmendments(missing)).toHaveLength(0);
  });

  it("cancelPlacedOrder: placed → abandoned, appends an order_cancelled amendment with the reason", async () => {
    const { cfg, cafe } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db: suite.admin }, cfg, {
      id,
      lines: [{ productId: cafe.id, quantity: "1" }],
    });
    await placeOrder({ db: suite.admin, backend, clock }, cfg, id, OPERATOR);

    await cancelPlacedOrder(
      { db: suite.admin, backend, clock },
      cfg,
      id,
      "customer left",
      OPERATOR,
    );

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
    const { cfg, cafe } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db: suite.admin }, cfg, {
      id,
      lines: [{ productId: cafe.id, quantity: "1" }],
    });
    await placeOrder({ db: suite.admin, backend, clock }, cfg, id, OPERATOR);

    // `order_amendments` carries NO DB CHECK forcing a reason on `order_cancelled` (the column is
    // nullable — null is the genesis's own legitimate value), so the APP contract is the only thing
    // stopping a reasonless cancel (7c carry-forward from Task 3's review). An empty string AND a
    // whitespace-only reason are both refused, with `working_order.reason_required` — NOT `not_placed`,
    // because the order genuinely IS placed here (a false label is the §1 defect class).
    for (const reason of ["", "   "]) {
      await expect(
        cancelPlacedOrder({ db: suite.admin, backend, clock }, cfg, id, reason, OPERATOR),
      ).rejects.toMatchObject({
        code: "working_order.reason_required",
        params: { workingOrderId: id },
      });
    }

    // The refusal is total: the order stays `placed` (no transition) and only the genesis entry exists
    // (no reasonless `order_cancelled` was written). Deleting the reason guard makes this case SUCCEED —
    // the order abandons and a reasonless amendment appends — which is how the guard is proven by
    // deletion (CLAUDE.md §4): these two assertions flip to failing.
    expect(await orderState(id)).toEqual({ status: "placed", settledAtSet: false });
    expect((await readAmendments(id)).map((r) => r.kind)).toEqual(["order_placed"]);
  });

  it("cancelPlacedOrder refuses a non-placed order — an open one, a settled one, and an absent id", async () => {
    const { cfg, cafe } = await setupVenue();

    // An OPEN (parked, never placed) order — the wrong-status branch. A non-empty reason, so the reason
    // guard passes and the STATE check is what refuses. It reports `not_placed`, not `not_open`: cancel
    // is a placed-order operation, and an open order is edited/discarded via update/abandon instead.
    const openId = randomUUID();
    await parkOrder({ db: suite.admin }, cfg, {
      id: openId,
      lines: [{ productId: cafe.id, quantity: "1" }],
    });
    await expect(
      cancelPlacedOrder({ db: suite.admin, backend, clock }, cfg, openId, "changed mind", OPERATOR),
    ).rejects.toMatchObject({
      code: "working_order.not_placed",
      params: { workingOrderId: openId },
    });
    // The refused open order opened NO amendment log.
    expect(await readAmendments(openId)).toHaveLength(0);

    // A SETTLED (walk-up) order — also not placed.
    const settledId = randomUUID();
    await payWorkingOrder({ db: suite.admin, backend, clock }, cfg, {
      id: settledId,
      lines: [{ productId: cafe.id, quantity: "1" }],
      tender: { method: "cash", amount: "5.00" },
    });
    await expect(
      cancelPlacedOrder(
        { db: suite.admin, backend, clock },
        cfg,
        settledId,
        "changed mind",
        OPERATOR,
      ),
    ).rejects.toMatchObject({
      code: "working_order.not_placed",
      params: { workingOrderId: settledId },
    });

    // An ABSENT id — the FOR UPDATE locks nothing (the undefined branch), same fail-closed code.
    const missing = randomUUID();
    await expect(
      cancelPlacedOrder(
        { db: suite.admin, backend, clock },
        cfg,
        missing,
        "changed mind",
        OPERATOR,
      ),
    ).rejects.toMatchObject({
      code: "working_order.not_placed",
      params: { workingOrderId: missing },
    });
  });

  it("a pure walk-up never enters placed and opens no amendment log", async () => {
    const { cfg, cafe } = await setupVenue();
    const id = randomUUID();

    // A walk-up settles open → settled in one transaction (till-sale.ts), never passing through
    // `placed`, so placing's log never opens and no prep row is enqueued (design §3 — a walk-up
    // finalises, pays and issues in one instant, with no placing gap).
    await payWorkingOrder({ db: suite.admin, backend, clock }, cfg, {
      id,
      lines: [{ productId: cafe.id, quantity: "1" }],
      tender: { method: "cash", amount: "5.00" },
    });

    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await readAmendments(id)).toHaveLength(0); // no placing → no log (design §3)
    expect(await ticketStateOf(id)).toBeNull(); // a walk-up never fires — fire is at place/send-to-prep
  });
});

// The pay-timing config + the three-mode dispatch (Modes P/I/T — design §3's state-machine × config
// table). FISCAL-CRITICAL: each mode must fire the right issuance primitive at the right point — a
// wrong dispatch files the wrong kind of unrepairable fiscal record (CLAUDE.md §5). Real Postgres —
// the fiscal writes run as `app_user` under RLS, and the idempotency proofs are genuine two-backend
// races, both of which PGlite's superuser/single-backend connection cannot show (CLAUDE.md §4). No
// primitive is reimplemented here: the dispatch ORCHESTRATES `recordSale` (immediate + deferred),
// `settleSale` and `listOutstandingSales`.
describe("prepare & collect — three-mode dispatch (order_flow)", () => {
  it("readOrderFlow reads the venue's configured mode from its location", async () => {
    const { cfg } = await modeVenue("invoice_first");
    expect(await readOrderFlow(suite.admin, cfg)).toBe("invoice_first");
  });

  // MODE P (prepay): pay + issue at ORDER — open → settled, no placed state. The unchanged
  // walk-up/park-pay `payWorkingOrder`, asserted under an explicit `prepay` cfg so P's contract is
  // pinned beside I and T.
  it("Mode P (prepay): pay at order files an immediate sale, open → settled, nothing outstanding", async () => {
    const { cfg, cafe } = await modeVenue("prepay");
    const id = randomUUID();

    const res = await payWorkingOrder({ db: suite.admin, backend, clock }, cfg, {
      id,
      lines: [{ productId: cafe.id, quantity: "1" }],
      tender: { method: "cash", amount: "5.00" },
    });

    expect(res.invoiceNumber).toBe("A/1");
    expect(res.total).toBe("1.50");
    expect(res.change).toBe("3.50");
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
    // Pay + issue are the same instant, so nothing is ever owed.
    expect(await outstandingFor(cfg)).toEqual([]);
  });

  // MODE I (invoice_first): at PLACE issue a DEFERRED (unpaid) chained invoice, open → placed, and it
  // shows as outstanding; at COLLECT `settleSale` closes it, placed → settled, filing NO second record.
  it("Mode I (invoice_first): place issues a deferred invoice; collect settles it, no second file", async () => {
    const { cfg, cafe, agua } = await modeVenue("invoice_first");
    const id = randomUUID();
    await parkOrder({ db: suite.admin }, cfg, {
      id,
      lines: [
        { productId: cafe.id, quantity: "1" },
        { productId: agua.id, quantity: "1" },
      ],
    });

    // PLACE → the deferred invoice issues HERE (A/1); the order freezes at `placed`, unsettled.
    const placed = await placeOrder({ db: suite.admin, backend, clock }, cfg, id, OPERATOR);
    expect(placed.status).toBe("placed");
    expect(placed.invoiceNumber).toBe("A/1"); // the deferred invoice, issued at placing
    expect(placed.total).toBe("3.50"); // 1.50 café + 2.00 agua
    expect(placed.qr).not.toBe(""); // a genuine chained filing carries the AEAT QR
    expect(await orderState(id)).toEqual({ status: "placed", settledAtSet: false });

    // The chained record exists NOW, before any payment — one sale, one registro — and shows as
    // OUTSTANDING (what is owed).
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
    const outstanding = await outstandingFor(cfg);
    expect(outstanding).toHaveLength(1);
    expect(outstanding[0]!.amountDue).toBe("3.50");

    // COLLECT → settle the EXISTING invoice, placed → settled, filing NOTHING new.
    const collected = await collectOrder({ db: suite.admin, backend, clock }, cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "3.50" },
    });
    expect(collected.invoiceNumber).toBe("A/1"); // the SAME invoice, read back
    expect(collected.total).toBe("3.50");
    expect(collected.change).toBe("0.00");
    // The receipt line list is read back from the order's stored lock (Finding 2 — Mode-I collect
    // returns the already-filed ticket), so it matches the deferred invoice's composition.
    expect(collected.lines).toEqual([
      { descriptions: { [LOCALE]: "Café" }, quantity: "1", gross: "1.50" },
      { descriptions: { [LOCALE]: "Agua" }, quantity: "1", gross: "2.00" },
    ]);
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await saleCount(id)).toBe(1); // STILL one sale — no second file at collect
    expect(await registroCount(id)).toBe(1); // STILL one registro
    expect(await outstandingFor(cfg)).toEqual([]); // settled → no longer owed
    expect(await tendersFor(id)).toEqual([{ method: "cash", amount: "3.50" }]);
  });

  it("Mode I: a covered cash over-tender at collect settles at the total and hands back change", async () => {
    const { cfg, cafe } = await modeVenue("invoice_first");
    const id = randomUUID();
    await parkOrder({ db: suite.admin }, cfg, {
      id,
      lines: [{ productId: cafe.id, quantity: "1" }],
    });
    await placeOrder({ db: suite.admin, backend, clock }, cfg, id, OPERATOR);

    // 5.00 cash against the 1.50 invoice: the SALE settles at the invoice total (1.50) and 3.50 is
    // drawer change — settling at the tendered cash would over-report the fiscal total (§5).
    const collected = await collectOrder({ db: suite.admin, backend, clock }, cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "5.00" },
    });
    expect(collected.total).toBe("1.50");
    expect(collected.change).toBe("3.50");
    expect(await tendersFor(id)).toEqual([{ method: "cash", amount: "1.50" }]);
    expect(await saleCount(id)).toBe(1);
  });

  it("Mode I: a card tender at collect records exactly one captured payment linked to the sale; cash records none", async () => {
    const { cfg, cafe } = await modeVenue("invoice_first");

    // CARD collect: the invoice issued deferred at placing, then a manual-card ("datáfono") tender at
    // collect. The card charges the EXACT invoice total on the separate terminal — no change.
    const cardId = randomUUID();
    await parkOrder({ db: suite.admin }, cfg, {
      id: cardId,
      lines: [{ productId: cafe.id, quantity: "1" }],
    });
    await placeOrder({ db: suite.admin, backend, clock }, cfg, cardId, OPERATOR);
    const collected = await collectOrder({ db: suite.admin, backend, clock }, cfg, {
      id: cardId,
      lines: [],
      tender: { method: "card", amount: "1.50", externalRef: "OP-INV-1" },
    });
    expect(collected.change).toBe("0.00");
    expect(await orderState(cardId)).toEqual({ status: "settled", settledAtSet: true });

    // The card tender AND a captured manual `payments` row linked to the settled sale — the #62
    // side-write, now symmetric with the immediate card paths. Deleting the card branch in
    // `collectOrder` makes `paymentCount`/`paymentsFor` fail here (the invoice-first card collect would
    // become invisible to reconciliation), the regression this fix closes.
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
    await parkOrder({ db: suite.admin }, cfg, {
      id: cashId,
      lines: [{ productId: cafe.id, quantity: "1" }],
    });
    await placeOrder({ db: suite.admin, backend, clock }, cfg, cashId, OPERATOR);
    await collectOrder({ db: suite.admin, backend, clock }, cfg, {
      id: cashId,
      lines: [],
      tender: { method: "cash", amount: "1.50" },
    });
    expect(await paymentCount(cashId)).toBe(0);
  });

  it("Mode I: a double-tap place issues exactly ONE deferred invoice (FOR UPDATE serialises)", async () => {
    const { cfg, cafe } = await modeVenue("invoice_first");
    const id = randomUUID();
    await parkOrder({ db: suite.admin }, cfg, {
      id,
      lines: [{ productId: cafe.id, quantity: "1" }],
    });

    // TWO distinct backends racing to place the SAME order. Load-bearing: distinct backend PROCESSES —
    // on PGlite they collapse onto one and the race never happens (a false pass). The FOR UPDATE lock
    // serialises them: the winner files the deferred invoice and moves the row to `placed`; the loser
    // blocks, re-reads `placed`, and is refused `working_order.not_open` BEFORE it files.
    const [connA, connB] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
    try {
      const results = await Promise.allSettled([
        placeOrder({ db: connA, backend, clock }, cfg, id, OPERATOR),
        placeOrder({ db: connB, backend, clock }, cfg, id, OPERATOR),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toMatchObject({ code: "working_order.not_open" });
    } finally {
      await Promise.all([connA.close(), connB.close()]);
    }

    // ONE deferred invoice, one registro — the unrepairable double-file the dispatch must prevent.
    expect(await orderState(id)).toEqual({ status: "placed", settledAtSet: false });
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
  });

  it("Mode I: a concurrent double collect settles the invoice ONCE and both see the same ticket", async () => {
    const { cfg, cafe } = await modeVenue("invoice_first");
    const id = randomUUID();
    await parkOrder({ db: suite.admin }, cfg, {
      id,
      lines: [{ productId: cafe.id, quantity: "1" }],
    });
    await placeOrder({ db: suite.admin, backend, clock }, cfg, id, OPERATOR);

    const req = { id, lines: [], tender: { method: "cash" as const, amount: "1.50" } };
    const [connA, connB] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
    try {
      // Both collect the placed order on distinct backends. FOR UPDATE serialises: one settles
      // (placed → settled), the other blocks, sees `settled`, and REPLAYS the ticket — neither errors,
      // ONE settlement (no 23505 backstop needed: the placed row always exists to lock).
      const [rA, rB] = await Promise.all([
        collectOrder({ db: connA, backend, clock }, cfg, req, OPERATOR),
        collectOrder({ db: connB, backend, clock }, cfg, req, OPERATOR),
      ]);
      expect(rA.invoiceNumber).toBe(rB.invoiceNumber);
    } finally {
      await Promise.all([connA.close(), connB.close()]);
    }
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
    expect(await tendersFor(id)).toEqual([{ method: "cash", amount: "1.50" }]); // one settlement
    expect(await outstandingFor(cfg)).toEqual([]);
  });

  // MODE T (ticket_then_pay): at PLACE no fiscal doc, open → placed; at COLLECT `recordSale` immediate
  // files + settles, placed → settled.
  it("Mode T (ticket_then_pay): place files no fiscal doc; collect files immediate at collect", async () => {
    const { cfg, cafe } = await modeVenue("ticket_then_pay");
    const id = randomUUID();
    await parkOrder({ db: suite.admin }, cfg, {
      id,
      lines: [{ productId: cafe.id, quantity: "1" }],
    });

    // PLACE → NO fiscal document (design §3). The order freezes at `placed` with nothing filed.
    const placed = await placeOrder({ db: suite.admin, backend, clock }, cfg, id, OPERATOR);
    expect(placed.status).toBe("placed");
    expect(placed.invoiceNumber).toBeUndefined(); // no invoice issued at placing
    expect(await orderState(id)).toEqual({ status: "placed", settledAtSet: false });
    expect(await saleCount(id)).toBe(0); // nothing filed yet
    expect(await outstandingFor(cfg)).toEqual([]); // no issued invoice → nothing outstanding

    // COLLECT → file `recordSale` IMMEDIATE, placed → settled.
    const collected = await collectOrder({ db: suite.admin, backend, clock }, cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "1.50" },
    });
    expect(collected.invoiceNumber).toBe("A/1"); // the FIRST filing is at collect
    expect(collected.total).toBe("1.50");
    expect(collected.change).toBe("0.00");
    // The receipt line list is the just-filed composition (Finding 2 — Mode-T files immediate at
    // collect from the stored lock).
    expect(collected.lines).toEqual([
      { descriptions: { [LOCALE]: "Café" }, quantity: "1", gross: "1.50" },
    ]);
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await saleCount(id)).toBe(1); // filed at collect
    expect(await registroCount(id)).toBe(1);
  });

  it("Mode T: a concurrent double collect-pay files ONE sale, and a later sequential collect replays", async () => {
    const { cfg, cafe } = await modeVenue("ticket_then_pay");
    const id = randomUUID();
    await parkOrder({ db: suite.admin }, cfg, {
      id,
      lines: [{ productId: cafe.id, quantity: "1" }],
    });
    await placeOrder({ db: suite.admin, backend, clock }, cfg, id, OPERATOR);

    const req = { id, lines: [], tender: { method: "cash" as const, amount: "1.50" } };
    const [connA, connB] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
    try {
      // Two collects racing to FILE on distinct backends. FOR UPDATE serialises: one files + settles,
      // the other blocks, sees `settled`, and REPLAYS — ONE sale, no 23505 needed (the placed row
      // always exists to lock, unlike a walk-up).
      const [rA, rB] = await Promise.all([
        collectOrder({ db: connA, backend, clock }, cfg, req, OPERATOR),
        collectOrder({ db: connB, backend, clock }, cfg, req, OPERATOR),
      ]);
      expect(rA.invoiceNumber).toBe(rB.invoiceNumber);
    } finally {
      await Promise.all([connA.close(), connB.close()]);
    }
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);

    // A further SEQUENTIAL collect of the now-settled order deterministically hits the settled-replay
    // branch: it returns the same ticket and files nothing (change 0.00 — the drawer change was given
    // at the original collect).
    const replay = await collectOrder({ db: suite.admin, backend, clock }, cfg, req, OPERATOR);
    expect(replay.invoiceNumber).toBe("A/1");
    expect(replay.change).toBe("0.00");
    expect(await saleCount(id)).toBe(1);
  });

  // Task 6 — the counter COLLECT wires `working_orders.collected_at`, so a collected counter order
  // leaves its station queue. The end-to-end proof through `collectOrder` (not a raw UPDATE): fire a
  // placed order to the default station, confirm it queues, collect it, and confirm it drops — with the
  // fiscal result byte-unchanged. Both modes are pinned: Mode T settles through `fileImmediateSale`,
  // Mode I through the direct settle UPDATE, and BOTH must stamp `collected_at` in the SAME placed →
  // settled transition (the enforce_transition trigger rejects a settled → settled edit).
  it("Mode T: collectOrder stamps collected_at, dropping the order from its station queue, fiscal result unchanged", async () => {
    const { cfg, cafe } = await modeVenue("ticket_then_pay");
    const station = await defaultStationId(cfg);
    const id = randomUUID();
    await parkOrder({ db: suite.admin }, cfg, {
      id,
      lines: [{ productId: cafe.id, quantity: "1" }],
      label: "Mesa 7",
    });
    // PLACE fires one ticket item to the default station; the order shows on that station's queue and
    // its handover marker is unset.
    await placeOrder({ db: suite.admin, backend, clock }, cfg, id, OPERATOR);
    expect(
      (await asTenant(cfg, (tx) => listStationQueue(tx, cfg, station))).map((g) => g.orderId),
    ).toEqual([id]);
    expect(await collectedAtSet(id)).toBe(false);

    // COLLECT → Mode T files immediate at collect AND stamps collected_at in the placed → settled UPDATE.
    const collected = await collectOrder({ db: suite.admin, backend, clock }, cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "1.50" },
    });

    // Fiscal result byte-unchanged: filed once at collect, A/1, one chained registro, one tender.
    expect(collected.invoiceNumber).toBe("A/1");
    expect(collected.total).toBe("1.50");
    expect(collected.change).toBe("0.00");
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
    expect(await tendersFor(id)).toEqual([{ method: "cash", amount: "1.50" }]);
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });

    // The order-level handover marker is now set, so the default station drops the collected order.
    expect(await collectedAtSet(id)).toBe(true);
    expect(await asTenant(cfg, (tx) => listStationQueue(tx, cfg, station))).toEqual([]);
    // The ticket item ITSELF is untouched — collected_at is an ORDER marker, not a ticket kitchen state.
    expect(await ticketStateOf(id)).toBe("queued");
  });

  it("Mode I: collectOrder stamps collected_at, dropping the order from its station queue, no second file", async () => {
    const { cfg, cafe } = await modeVenue("invoice_first");
    const station = await defaultStationId(cfg);
    const id = randomUUID();
    await parkOrder({ db: suite.admin }, cfg, {
      id,
      lines: [{ productId: cafe.id, quantity: "1" }],
    });
    // PLACE issues the deferred invoice AND fires the ticket item to the default station.
    await placeOrder({ db: suite.admin, backend, clock }, cfg, id, OPERATOR);
    expect(
      (await asTenant(cfg, (tx) => listStationQueue(tx, cfg, station))).map((g) => g.orderId),
    ).toEqual([id]);
    expect(await collectedAtSet(id)).toBe(false);

    // COLLECT → settle the EXISTING invoice (file NOTHING new) AND stamp collected_at in the direct
    // placed → settled UPDATE.
    const collected = await collectOrder({ db: suite.admin, backend, clock }, cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "1.50" },
    });
    expect(collected.invoiceNumber).toBe("A/1"); // the SAME deferred invoice, read back
    expect(await saleCount(id)).toBe(1); // no second file at collect
    expect(await registroCount(id)).toBe(1);
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });

    // Set, and the default station drops the collected order.
    expect(await collectedAtSet(id)).toBe(true);
    expect(await asTenant(cfg, (tx) => listStationQueue(tx, cfg, station))).toEqual([]);
  });

  it("collectOrder refuses a non-placed order (open, absent) and an unsupported tender, filing nothing", async () => {
    const { cfg, cafe } = await modeVenue("ticket_then_pay");

    // An OPEN (parked, never placed) order → `working_order.not_placed`, files nothing. `not_placed`,
    // not `not_open`: collect is the placed → settled operation, so an open order is a placing-state
    // error (a false "not open" label would be the §1 defect class).
    const openId = randomUUID();
    await parkOrder({ db: suite.admin }, cfg, {
      id: openId,
      lines: [{ productId: cafe.id, quantity: "1" }],
    });
    await expect(
      collectOrder({ db: suite.admin, backend, clock }, cfg, {
        id: openId,
        lines: [],
        tender: { method: "cash", amount: "1.50" },
      }),
    ).rejects.toMatchObject({
      code: "working_order.not_placed",
      params: { workingOrderId: openId },
    });
    expect(await saleCount(openId)).toBe(0);

    // An ABSENT id → the FOR UPDATE locks nothing (the undefined branch), same fail-closed code.
    const missing = randomUUID();
    await expect(
      collectOrder({ db: suite.admin, backend, clock }, cfg, {
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
    await parkOrder({ db: suite.admin }, cfg, {
      id: placedId,
      lines: [{ productId: cafe.id, quantity: "1" }],
    });
    await placeOrder({ db: suite.admin, backend, clock }, cfg, placedId, OPERATOR);
    await expect(
      collectOrder({ db: suite.admin, backend, clock }, cfg, {
        id: placedId,
        lines: [],
        tender: { method: "voucher" as unknown as "cash", amount: "1.50" },
      }),
    ).rejects.toMatchObject({ code: "sale.unsupported_tender", params: { method: "voucher" } });
    expect(await saleCount(placedId)).toBe(0);
  });
});

// The ticket prep surface (KDS-1 §3c): the per-line advance state machine (`advanceTicketItem`), the
// whole-ticket bump (`advanceTicket`) and the per-station queue read (`listStationQueue`) — over the
// per-line/per-station `ticket_items` that replaced #63's one-row-per-order `order_prep`. Real
// Postgres — `ticket_items` is FORCE-RLS + tenant-isolation-policy scoped (Task 1), and the cross-tenant
// isolation + node scoping below are exactly what PGlite's single-backend, all-superuser connection
// cannot show (CLAUDE.md §4). `sendToPrep` (Mode P) and `placeOrder` (Modes I/T) are the FIRES that put
// items on the queue; their settled-only guard is exercised here too. The verbs run through
// {@link asTenant} (a caller-supplied `withTenant` + `asAppUser` scope), as `app_user`, so RLS is in force.
describe("advanceTicketItem / advanceTicket / listStationQueue (ticket prep surface)", () => {
  it("advanceTicketItem walks a line queued → preparing → ready; a skip, a repeat, a backwards move and to='queued' are all refused", async () => {
    const { cfg, cafe } = await modeVenue("prepay");
    const id = randomUUID();
    await payWorkingOrder(
      { db: suite.admin, backend, clock },
      cfg,
      {
        id,
        lines: [{ productId: cafe.id, quantity: "1" }],
        tender: { method: "cash", amount: "5.00" },
      },
      OPERATOR,
    );
    await sendToPrep({ db: suite.admin }, cfg, id); // Mode-P pickup fires the ticket item on the SETTLED order
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
    const { cfg, cafe, agua } = await modeVenue("ticket_then_pay");
    const id = randomUUID();
    await parkOrder({ db: suite.admin }, cfg, {
      id,
      lines: [
        { productId: cafe.id, quantity: "1" },
        { productId: agua.id, quantity: "1" },
      ],
    });
    await placeOrder({ db: suite.admin, backend, clock }, cfg, id, OPERATOR); // fires two items → default station
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

    const queue = await asTenant(cfg, (tx) => listStationQueue(tx, cfg, station));
    const group = queue.find((g) => g.orderId === id)!;
    expect(group.items.map((i) => i.state).sort()).toEqual(["preparing", "ready"]);
  });

  it("listStationQueue lists this station's items grouped by order oldest-first, dropping collected and abandoned orders", async () => {
    const { cfg, cafe } = await modeVenue("ticket_then_pay");
    const station = await defaultStationId(cfg);

    // Two orders placed oldest-first, each a single line → the default station.
    const id1 = randomUUID();
    await parkOrder({ db: suite.admin }, cfg, {
      id: id1,
      lines: [{ productId: cafe.id, quantity: "1" }],
      label: "Mesa 7",
    });
    await placeOrder({ db: suite.admin, backend, clock }, cfg, id1, OPERATOR);

    const id2 = randomUUID();
    await parkOrder({ db: suite.admin }, cfg, {
      id: id2,
      lines: [{ productId: cafe.id, quantity: "1" }],
      label: "Mesa 3",
    });
    await placeOrder({ db: suite.admin, backend, clock }, cfg, id2, OPERATOR);

    // Both orders show, oldest first, each one line, at `queued`, carrying the order's label + queued_at.
    const queue = await asTenant(cfg, (tx) => listStationQueue(tx, cfg, station));
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
      (await asTenant(cfg, (tx) => listStationQueue(tx, cfg, station))).find(
        (g) => g.orderId === id1,
      )?.items[0]?.state,
    ).toBe("preparing");

    // COLLECT order 1 — the collect flow settles a placed order AND stamps `collected_at` in the one
    // legal placed → settled transition (the enforce_transition trigger forbids editing a placed row
    // any other way). The default-station display drops a collected order (§3e), so it leaves the queue.
    await suite.admin.execute(sql`
      update working_orders set status = 'settled', settled_at = now(), collected_at = now()
      where id = ${id1}`);
    expect(
      (await asTenant(cfg, (tx) => listStationQueue(tx, cfg, station))).map((g) => g.orderId),
    ).toEqual([id2]);

    // CANCEL order 2 (placed → abandoned) — its ticket item is UNCHANGED (cancel never touches
    // `ticket_items`), but `listStationQueue`'s `status != 'abandoned'` join retires it, exactly as
    // `listPrepQueue` relied on the status join rather than a write the cancel makes.
    await cancelPlacedOrder(
      { db: suite.admin, backend, clock },
      cfg,
      id2,
      "customer left",
      OPERATOR,
    );
    expect(await ticketStateOf(id2)).toBe("queued"); // the ticket item itself is untouched by cancel
    expect(await asTenant(cfg, (tx) => listStationQueue(tx, cfg, station))).toEqual([]);
  });

  it("listStationQueue node scope is SYMMETRIC: each node sees only its own order's items, both non-empty", async () => {
    const { cfg: nodeA, cafe } = await modeVenue("ticket_then_pay");
    // A second node under the SAME tenant + location — `addNode`'s established 7b shape: it differs only
    // in `node_id`, so RLS (tenant-scoped) would NOT hide either node's items from the other; only
    // `listStationQueue`'s `node_id = cfg.nodeId` filter does. BOTH nodes fire a genuine order, so this
    // proves "A shows A, B shows B" rather than "one empty, one not" — a measurement where both answers
    // look alike measures nothing (CLAUDE.md §1). Both nodes share the location's one default station.
    const nodeB = await addNode(nodeA, "Servidor 2");
    const station = await defaultStationId(nodeA);

    const idA = randomUUID();
    await parkOrder({ db: suite.admin }, nodeA, {
      id: idA,
      lines: [{ productId: cafe.id, quantity: "1" }],
      label: "Node A order",
    });
    await placeOrder({ db: suite.admin, backend, clock }, nodeA, idA, OPERATOR);

    const idB = randomUUID();
    await parkOrder({ db: suite.admin }, nodeB, {
      id: idB,
      lines: [{ productId: cafe.id, quantity: "1" }],
      label: "Node B order",
    });
    await placeOrder({ db: suite.admin, backend, clock }, nodeB, idB, OPERATOR);

    const queueA = await asTenant(nodeA, (tx) => listStationQueue(tx, nodeA, station));
    const queueB = await asTenant(nodeB, (tx) => listStationQueue(tx, nodeB, station));

    // Same station on both sides, each with exactly one order's items, opposite membership.
    expect(queueA.map((g) => g.orderId)).toEqual([idA]);
    expect(queueB.map((g) => g.orderId)).toEqual([idB]);
  });

  it("cross-tenant isolation: tenant B can neither advance nor see tenant A's ticket items (RLS hides them)", async () => {
    const { cfg: tenantA, cafe } = await modeVenue("ticket_then_pay");
    const { cfg: tenantB } = await modeVenue("ticket_then_pay"); // a wholly separate venue + tenant
    const stationA = await defaultStationId(tenantA);

    const idA = randomUUID();
    await parkOrder({ db: suite.admin }, tenantA, {
      id: idA,
      lines: [{ productId: cafe.id, quantity: "1" }],
    });
    await placeOrder({ db: suite.admin, backend, clock }, tenantA, idA, OPERATOR);
    const [itemA] = await ticketItemIdsFor(idA);
    expect(await ticketStateOf(idA)).toBe("queued");

    // Under tenant B's `app_user` scope the tenant-isolation policy hides A's row, so the conditional
    // UPDATE matches nothing and refuses with the SAME fail-closed `ticket.invalid_transition` an illegal
    // move gets — never a distinct "wrong tenant" code that would confirm A's item exists.
    await expect(
      asTenant(tenantB, (tx) => advanceTicketItem(tx, tenantB, itemA!, "preparing")),
    ).rejects.toMatchObject({
      code: "ticket.invalid_transition",
      params: { ticketItemId: itemA },
    });
    // A whole-ticket bump from tenant B likewise touches nothing (RLS hides every one of A's items).
    await asTenant(tenantB, (tx) => advanceTicket(tx, tenantB, idA, stationA, "preparing"));

    // A's item is UNCHANGED — neither B call reached it (proven as the owner, bypassing RLS).
    expect(await ticketStateOf(idA)).toBe("queued");
    // And tenant B's own queue never surfaces A's items (its node + RLS both exclude them).
    expect(await asTenant(tenantB, (tx) => listStationQueue(tx, tenantB, stationA))).toEqual([]);
  });

  it("sendToPrep refuses to fire an order it may not (working_order.not_settled) — an open one, an absent id, and another tenant's settled order", async () => {
    const { cfg, cafe } = await modeVenue("prepay");

    // OPEN — parked but never paid. `sendToPrep` is Mode P's own pickup (settle happens at ORDER via
    // `payWorkingOrder`); an open order has never reached settlement, so nothing is fired.
    const openId = randomUUID();
    await parkOrder({ db: suite.admin }, cfg, {
      id: openId,
      lines: [{ productId: cafe.id, quantity: "1" }],
    });
    await expect(sendToPrep({ db: suite.admin }, cfg, openId)).rejects.toMatchObject({
      code: "working_order.not_settled",
      params: { workingOrderId: openId },
    });
    expect(await ticketStateOf(openId)).toBeNull(); // the refused call fired nothing

    // An ABSENT id — the existence+status guard catches it before any fire (never a raw FK 500).
    const missing = randomUUID();
    await expect(sendToPrep({ db: suite.admin }, cfg, missing)).rejects.toMatchObject({
      code: "working_order.not_settled",
      params: { workingOrderId: missing },
    });
    expect(await ticketStateOf(missing)).toBeNull();

    // ANOTHER tenant's genuinely-settled order — RLS hides it, so tenant B's `sendToPrep` sees no row
    // and refuses the SAME code, not a distinct "wrong tenant" leak that its real state exists.
    const { cfg: tenantB } = await modeVenue("prepay");
    const foreignId = randomUUID();
    await payWorkingOrder(
      { db: suite.admin, backend, clock },
      cfg,
      {
        id: foreignId,
        lines: [{ productId: cafe.id, quantity: "1" }],
        tender: { method: "cash", amount: "5.00" },
      },
      OPERATOR,
    );
    expect(await orderState(foreignId)).toEqual({ status: "settled", settledAtSet: true }); // settled under tenant A
    await expect(sendToPrep({ db: suite.admin }, tenantB, foreignId)).rejects.toMatchObject({
      code: "working_order.not_settled",
      params: { workingOrderId: foreignId },
    });
    expect(await ticketStateOf(foreignId)).toBeNull(); // tenant B's refused call fired nothing
  });
});

describe("markCollected (Mode-P kitchen-handover marker)", () => {
  // The end-to-end proof the KDS-1 regression is closed. This RESTORES the base suite's "advancePrep
  // walks queued → preparing → ready → collected" assertion on the new ticket model: the branch had
  // rewritten it to stop at `ready` (CLAUDE.md §1 — a test rewritten to match the code hides the very
  // regression it existed to catch). A Mode-P (prepay) order pays at order, is fired via sendToPrep,
  // walks queued → preparing → ready, then is HANDED OVER — markCollected stamps `collected_at`, and it
  // drops off listStationQueue. Before the fix that stamp was impossible (a settled order was immutable),
  // so a fired Mode-P order's tickets lingered on the display forever.
  it("Mode P: fired → ready → markCollected stamps collected_at and drops the order off listStationQueue", async () => {
    const { cfg, cafe } = await modeVenue("prepay");
    const station = await defaultStationId(cfg);
    const id = randomUUID();

    // Pay at order (open → settled in one tx — the Mode-P walk-up), then fire the settled order's lines.
    await payWorkingOrder(
      { db: suite.admin, backend, clock },
      cfg,
      {
        id,
        lines: [{ productId: cafe.id, quantity: "1" }],
        tender: { method: "cash", amount: "5.00" },
      },
      OPERATOR,
    );
    await sendToPrep({ db: suite.admin }, cfg, id);
    expect(
      (await asTenant(cfg, (tx) => listStationQueue(tx, cfg, station))).map((g) => g.orderId),
    ).toEqual([id]);

    // Walk the line all the way to `ready` — a ready line STAYS on the queue until the order collects.
    const [item] = await ticketItemIdsFor(id);
    await asTenant(cfg, (tx) => advanceTicketItem(tx, cfg, item!, "preparing"));
    await asTenant(cfg, (tx) => advanceTicketItem(tx, cfg, item!, "ready"));
    expect(await ticketStateOf(id)).toBe("ready");
    const readyQueue = await asTenant(cfg, (tx) => listStationQueue(tx, cfg, station));
    // Still listed — a ready-but-uncollected order lingers (the bug was that it could NEVER leave) — and
    // the group carries the order's `status`, so the till surfaces the collect action (collectable = settled).
    expect(readyQueue.map((g) => g.orderId)).toEqual([id]);
    expect(readyQueue[0]!.status).toBe("settled");

    // Hand it over. NON-FISCAL — markCollected writes only collected_at (no sale/registro/tender/huella).
    await markCollected({ db: suite.admin }, cfg, id);
    expect(await collectedAtSet(id)).toBe(true);
    // GONE from the station queue — the regression is closed.
    expect(await asTenant(cfg, (tx) => listStationQueue(tx, cfg, station))).toEqual([]);
    // Its fiscal state is untouched — still settled with settled_at intact (only collected_at moved).
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
  });

  it("refuses a non-settled order — an open one, an absent id, and another tenant's settled+fired order (working_order.not_settled)", async () => {
    const { cfg, cafe } = await modeVenue("prepay");

    // OPEN — parked, never paid: not settled, so there is no handover to mark. Fails closed before any write.
    const openId = randomUUID();
    await parkOrder({ db: suite.admin }, cfg, {
      id: openId,
      lines: [{ productId: cafe.id, quantity: "1" }],
    });
    await expect(markCollected({ db: suite.admin }, cfg, openId)).rejects.toMatchObject({
      code: "working_order.not_settled",
      params: { workingOrderId: openId },
    });
    expect(await collectedAtSet(openId)).toBe(false);

    // ABSENT — the existence+status read catches it before any write (never a raw error).
    const missing = randomUUID();
    await expect(markCollected({ db: suite.admin }, cfg, missing)).rejects.toMatchObject({
      code: "working_order.not_settled",
      params: { workingOrderId: missing },
    });

    // ANOTHER tenant's genuinely settled+fired order — RLS hides it, so tenant B sees no row and refuses
    // the SAME fail-closed code (never a distinct "wrong tenant" code confirming A's order exists).
    const { cfg: tenantB } = await modeVenue("prepay");
    const foreignId = randomUUID();
    await payWorkingOrder(
      { db: suite.admin, backend, clock },
      cfg,
      {
        id: foreignId,
        lines: [{ productId: cafe.id, quantity: "1" }],
        tender: { method: "cash", amount: "5.00" },
      },
      OPERATOR,
    );
    await sendToPrep({ db: suite.admin }, cfg, foreignId);
    await expect(markCollected({ db: suite.admin }, tenantB, foreignId)).rejects.toMatchObject({
      code: "working_order.not_settled",
      params: { workingOrderId: foreignId },
    });
    expect(await collectedAtSet(foreignId)).toBe(false); // tenant B's refused call stamped nothing
  });

  it("refuses a settled order that was never fired (ticket.not_fired) — nothing on the kitchen queue to hand over", async () => {
    const { cfg, cafe } = await modeVenue("prepay");
    const id = randomUUID();
    // Settled but NOT sent to prep — no ticket_items exist, so there is nothing on any station display to
    // hand over. Stamping collected_at here would silently hide a LATER sendToPrep's fired lines, so it is
    // refused rather than made a no-op.
    await payWorkingOrder(
      { db: suite.admin, backend, clock },
      cfg,
      {
        id,
        lines: [{ productId: cafe.id, quantity: "1" }],
        tender: { method: "cash", amount: "5.00" },
      },
      OPERATOR,
    );
    await expect(markCollected({ db: suite.admin }, cfg, id)).rejects.toMatchObject({
      code: "ticket.not_fired",
      params: { workingOrderId: id },
    });
    expect(await collectedAtSet(id)).toBe(false);
  });

  it("refuses a re-collect of an already-handed-over order (working_order.already_collected)", async () => {
    const { cfg, cafe } = await modeVenue("prepay");
    const id = randomUUID();
    await payWorkingOrder(
      { db: suite.admin, backend, clock },
      cfg,
      {
        id,
        lines: [{ productId: cafe.id, quantity: "1" }],
        tender: { method: "cash", amount: "5.00" },
      },
      OPERATOR,
    );
    await sendToPrep({ db: suite.admin }, cfg, id);
    await markCollected({ db: suite.admin }, cfg, id); // first handover — allowed
    expect(await collectedAtSet(id)).toBe(true);
    // A second markCollected is refused BEFORE it reaches enforce_transition (whose non-null → non-null
    // collected_at RAISE would otherwise become an opaque 500), with a clean domain code.
    await expect(markCollected({ db: suite.admin }, cfg, id)).rejects.toMatchObject({
      code: "working_order.already_collected",
      params: { workingOrderId: id },
    });
  });
});
