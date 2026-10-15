import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locations, withTransaction } from "@waitron/db";
import {
  departmentReceipts,
  zoneServicePolicies,
  createDepartment,
  configureZone,
} from "@waitron/venue-service";
import { enabledModules, fiscalSlot, parseModuleConfig } from "@waitron/module";
import { ALL_MODULES } from "./modules.js";
import { venueModuleConfig } from "./provision.js";
import { decimal } from "@waitron/shared";
import { insertCapturedPayment, SimulatorPaymentProvider } from "@waitron/payments";
import { loginWithPin } from "@waitron/identity";
import { creditWholeInvoice, readOrderInvoice } from "./cancel-credit.js";
import {
  payWorkingOrderIntegratedOrchestration as payIntegrated,
  payWorkingOrder,
} from "./till-sale.js";
import { createOpenOrder, placeOrder } from "./working-order.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { provisionBillVenue, tabWith, send, type BillVenue } from "./testing/bill-venue.js";
import { offerProducts } from "./testing/zone-offers.js";

let venue: BillVenue;
let departmentId: string;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    const [zone] = await db
      .select()
      .from(zoneServicePolicies)
      .where(eq(zoneServicePolicies.zoneId, venue.zoneId));
    departmentId = zone!.departmentId;
    await db
      .update(locations)
      .set({ operationDescription: "Generic location service" })
      .where(eq(locations.id, venue.cfg.locationId));
    await authored("Dining meals");
  },
});

beforeEach(async () => {
  await withTransaction(venue.db, (tx) =>
    configureZone(tx, venue.cfg, { zoneId: venue.zoneId, departmentId }),
  );
  await authored("Dining meals");
});

async function authored(description?: string) {
  const receipt = description === undefined ? {} : { operationDescription: description };
  await venue.db
    .insert(departmentReceipts)
    .values({ departmentId, receipt })
    .onConflictDoUpdate({ target: departmentReceipts.departmentId, set: { receipt } });
}
function records(orderId: string) {
  return venue.db.all<{ description: string }>(sql`
    select r.descripcion_operacion as description from registros_facturacion r
    join sales s on s.id = r.sale_id
    where s.working_order_id = ${orderId} or s.corrects_sale_id in
      (select id from sales where working_order_id = ${orderId})
    order by r.secuencia
  `);
}
function facts() {
  return {
    sales: venue.db.all(sql`select * from sales order by id`),
    fiscal: venue.db.all(sql`select * from registros_facturacion order by id`),
    series: venue.db.all(sql`select * from invoice_series order by id`),
    payments: venue.db.all<Record<string, unknown>>(sql`select * from payments order by id`),
    billPayments: venue.db.all(sql`select * from bill_payments order by id`),
    jobs: venue.db.all(sql`select * from print_jobs order by id`),
    drawers: venue.db.all(sql`select * from drawer_opens order by id`),
  };
}
const deps = () => ({ db: venue.db, backend: venue.backend, clock: venue.clock });
const request = (id = randomUUID()) => ({
  id,
  zoneId: venue.zoneId,
  lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }],
  simulationOutcome: "captured" as const,
});
async function open() {
  const input = request();
  await withTransaction(venue.db, (tx) =>
    createOpenOrder(tx, venue.cfg, input.id, input.lines, null, { zoneId: venue.zoneId }),
  );
  return input.id;
}
const payBill = (id: string, method: "cash" | "card", entry?: "reader") =>
  send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
    submissionId: randomUUID(),
    kind: "contribution",
    amount: "3.00",
    applied: "3.00",
    tip: "0.00",
    method,
    ...(method === "cash" ? { tendered: "3.00" } : { entry }),
  });

it("integrated capture files the department description and replay keeps its filed facts", async () => {
  const provider = new SimulatorPaymentProvider(venue.db);
  const input = request();
  const first = await payIntegrated({ ...deps(), provider }, venue.cfg, input);
  expect(first.outcome).toBe("captured");
  expect(records(input.id)).toEqual([{ description: "Dining meals" }]);
  const before = facts();
  await authored("New dining menu");
  expect(await payIntegrated({ ...deps(), provider }, venue.cfg, input)).toEqual(first);
  expect(facts()).toEqual(before);
  expect(records(input.id)).toEqual([{ description: "Dining meals" }]);
});

it("a counter sale sent without a zone records the selected zone and files that department's description", async () => {
  const counter = await withTransaction(venue.db, async (tx) => {
    const offers = await offerProducts(tx, venue.cfg, { zone: "counter" });
    const [zone] = await tx
      .select()
      .from(zoneServicePolicies)
      .where(eq(zoneServicePolicies.zoneId, offers.zoneId));
    await tx
      .update(departmentReceipts)
      .set({ receipt: { operationDescription: "Counter drinks" } })
      .where(eq(departmentReceipts.departmentId, zone!.departmentId));
    return { ...offers, departmentId: zone!.departmentId };
  });
  const product = venue.db.all<{ id: string }>(
    sql`select product_id as id from menu_items where id = ${venue.offerFor("Caña")}`,
  )[0]!;
  const id = randomUUID();
  const result = await send(venue.app, venue.cookie, "POST", "/api/sales", {
    workingOrderId: id,
    lines: [{ menuItemId: counter.offerFor(product.id), quantity: "1" }],
    tender: { method: "cash", amount: "3.00" },
  });
  expect(result.status).toBe(200);
  expect(
    venue.db.all(
      sql`select zone_id as zoneId, department_id as departmentId from order_service_contexts where working_order_id = ${id}`,
    ),
  ).toEqual([{ zoneId: counter.zoneId, departmentId: counter.departmentId }]);
  expect(records(id)).toEqual([{ description: "Counter drinks" }]);
});

it.each(["cash", "card"] as const)(
  "an immediate %s sale files the department value rather than the location value",
  async (method) => {
    const input = request();
    const result = await payWorkingOrder(deps(), venue.cfg, {
      ...input,
      tender: { method, amount: "3.00" },
    });
    expect(result.total).toBe("3.00");
    expect(records(input.id)).toEqual([{ description: "Dining meals" }]);
  },
);

it("a zone moved before capture selects the same current department for description and receipt header", async () => {
  const id = await open();
  const next = await withTransaction(venue.db, async (tx) => {
    const department = await createDepartment(tx, venue.cfg, {
      name: `Terrace ${randomUUID()}`,
      orderStart: "table",
    });
    await tx
      .insert(departmentReceipts)
      .values({ departmentId: department.id, receipt: { operationDescription: "Terrace drinks" } });
    await configureZone(tx, venue.cfg, { zoneId: venue.zoneId, departmentId: department.id });
    return department.id;
  });
  const result = await payIntegrated(
    { ...deps(), provider: new SimulatorPaymentProvider(venue.db) },
    venue.cfg,
    { id, lines: [], simulationOutcome: "captured" },
  );
  expect(result.outcome).toBe("captured");
  if (result.outcome !== "captured") throw new Error("Expected a captured sale");
  expect(
    venue.db.all<{ departmentId: string }>(
      sql`select h.department_id as departmentId from sale_receipt_headers h join sales s on s.id = h.sale_id where s.working_order_id = ${id}`,
    ),
  ).toEqual([{ departmentId: next }]);
  expect(records(id)).toEqual([{ description: "Terrace drinks" }]);
});

it("recovery files the current department description without charging the card again", async () => {
  const id = await open();
  await withTransaction(venue.db, (tx) =>
    insertCapturedPayment(tx, {
      origin: venue.cfg.origin,
      workingOrderId: id,
      provider: "simulator",
      paymentRef: randomUUID(),
      amount: decimal("3.00"),
      settledAt: new Date(),
      externalRef: randomUUID(),
    }),
  );
  const provider = new SimulatorPaymentProvider(venue.db);
  const collect = vi.spyOn(provider, "collect");
  await authored("Recovered dining meals");
  expect((await payIntegrated({ ...deps(), provider }, venue.cfg, { id, lines: [] })).outcome).toBe(
    "captured",
  );
  expect(records(id)).toEqual([{ description: "Recovered dining meals" }]);
  expect(collect).not.toHaveBeenCalled();
  const before = facts();
  await authored();
  expect((await payIntegrated({ ...deps(), provider }, venue.cfg, { id, lines: [] })).outcome).toBe(
    "captured",
  );
  expect(facts()).toEqual(before);
});

it("unpaid issuance files the department description and correction uses its retained department", async () => {
  const id = await open();
  await issueOrderInvoice(deps(), venue.cfg, id, venue.operatorId);
  expect(records(id)).toEqual([{ description: "Dining meals" }]);
  await authored("Corrected dining service");
  await withTransaction(venue.db, async (tx) => {
    const next = await createDepartment(tx, venue.cfg, {
      name: `Terrace ${randomUUID()}`,
      orderStart: "table",
    });
    await tx
      .insert(departmentReceipts)
      .values({ departmentId: next.id, receipt: { operationDescription: "Terrace drinks" } });
    await configureZone(tx, venue.cfg, { zoneId: venue.zoneId, departmentId: next.id });
  });
  const session = await withTransaction(venue.db, (tx) =>
    loginWithPin(tx, { deviceId: venue.deviceId, personId: venue.adminId, pin: "1234" }),
  );
  await withTransaction(venue.db, async (tx) => {
    const invoice = await readOrderInvoice(tx, id);
    await creditWholeInvoice(tx, deps(), venue.cfg, invoice!, { sessionId: session.id });
  });
  expect(records(id)).toEqual([
    { description: "Dining meals" },
    { description: "Corrected dining service" },
  ]);
});

it("a correction refuses a missing retained-department description without a new record", async () => {
  const id = await open();
  await issueOrderInvoice(deps(), venue.cfg, id, venue.operatorId);
  const session = await withTransaction(venue.db, (tx) =>
    loginWithPin(tx, { deviceId: venue.deviceId, personId: venue.adminId, pin: "1234" }),
  );
  await authored();
  const before = facts();
  await expect(
    withTransaction(venue.db, async (tx) =>
      creditWholeInvoice(tx, deps(), venue.cfg, (await readOrderInvoice(tx, id))!, {
        sessionId: session.id,
      }),
    ),
  ).rejects.toMatchObject({ code: "department.operation_description_required" });
  expect(facts()).toEqual(before);
});

it("a description cleared during capture leaves payment recovery pending, then resumes without a second charge", async () => {
  const provider = new SimulatorPaymentProvider(venue.db);
  const collect = provider.collect.bind(provider);
  const charged = vi.spyOn(provider, "collect").mockImplementationOnce(async (input) => {
    const result = await collect(input);
    await authored();
    return result;
  });
  const input = request();
  const before = facts();
  await expect(payIntegrated({ ...deps(), provider }, venue.cfg, input)).rejects.toMatchObject({
    code: "department.operation_description_required",
  });
  const after = facts();
  expect(after.sales).toEqual(before.sales);
  expect(after.fiscal).toEqual(before.fiscal);
  expect(after.series).toEqual(before.series);
  expect(after.jobs).toEqual(before.jobs);
  expect(after.drawers).toEqual(before.drawers);
  expect(after.payments).toHaveLength(before.payments.length + 1);
  expect(after.payments.find((row) => row.working_order_id === input.id)).toMatchObject({
    state: "captured",
    sale_id: null,
  });
  await authored("Recovered new menu");
  expect(
    (await payIntegrated({ ...deps(), provider }, venue.cfg, { id: input.id, lines: [] })).outcome,
  ).toBe("captured");
  expect(records(input.id)).toEqual([{ description: "Recovered new menu" }]);
  expect(charged).toHaveBeenCalledTimes(1);
});

it("a concurrent winner is replayed even when its department description is subsequently cleared", async () => {
  const id = await tabWith(venue, "Caña");
  await placeOrder(deps(), venue.cfg, id, venue.operatorId);
  const provider = new SimulatorPaymentProvider(venue.db);
  const collect = provider.collect.bind(provider);
  let winningFacts: ReturnType<typeof facts> | undefined;
  const charged = vi.spyOn(provider, "collect").mockImplementationOnce(async (input) => {
    const result = await collect(input);
    await payIntegrated({ ...deps(), provider }, venue.cfg, { id, lines: [] }, venue.operatorId);
    winningFacts = facts();
    await authored();
    return result;
  });
  const result = await payIntegrated({ ...deps(), provider }, venue.cfg, {
    id,
    lines: [],
    simulationOutcome: "captured",
  });
  expect(result.outcome).toBe("captured");
  expect(charged).toHaveBeenCalledTimes(1);
  expect(records(id)).toEqual([{ description: "Dining meals" }]);
  expect(facts()).toEqual(winningFacts);
});

it.each(["cash", "integrated"] as const)(
  "a no-description fiscal contribution issues a %s sale with no department or location fallback",
  async (method) => {
    await authored();
    const modules = enabledModules(
      ALL_MODULES,
      venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "GB-vat"),
    );
    const fiscal = fiscalSlot(modules, null);
    expect(fiscal.venueFields).toBeUndefined();
    const backend = fiscal.makeBackend({
      db: venue.db,
      clock: venue.clock,
      environment: "preproduction",
    });
    const filed = vi.spyOn(backend, "recordSale");
    const cfg = { ...venue.cfg, operationDescriptionRequired: false };
    const input = request();
    if (method === "cash") {
      await payWorkingOrder({ ...deps(), backend }, cfg, {
        ...input,
        tender: { method: "cash", amount: "3.00" },
      });
    } else {
      await payIntegrated(
        { ...deps(), backend, provider: new SimulatorPaymentProvider(venue.db) },
        cfg,
        input,
      );
    }
    expect(filed).toHaveBeenCalledTimes(1);
    expect(filed.mock.calls[0]![1].descriptionOfOperation).toBe("");
    expect(
      venue.db.all(
        sql`select total, fiscal_backend from sales where working_order_id = ${input.id}`,
      ),
    ).toEqual([{ total: 300, fiscal_backend: "none" }]);
    expect(records(input.id)).toEqual([]);
  },
);

it.each(["cash", "card"] as const)(
  "a fully funded %s bill files its department description",
  async (method) => {
    const id = await tabWith(venue, "Caña");
    const answer = await payBill(id, method, method === "card" ? "reader" : undefined);
    expect(answer.status).toBe(200);
    expect(records(id)).toEqual([{ description: "Dining meals" }]);
  },
);

it.each(["cash", "integrated"] as const)(
  "a fiscal contribution with no description field still refuses a damaged %s order before money or filing",
  async (method) => {
    const id = await open();
    await venue.db.run(sql`delete from order_service_contexts where working_order_id = ${id}`);
    const modules = enabledModules(
      ALL_MODULES,
      venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "GB-vat"),
    );
    const backend = fiscalSlot(modules, null).makeBackend({
      db: venue.db,
      clock: venue.clock,
      environment: "preproduction",
    });
    const cfg = { ...venue.cfg, operationDescriptionRequired: false };
    const provider = new SimulatorPaymentProvider(venue.db);
    const collect = vi.spyOn(provider, "collect");
    const before = facts();
    const pay =
      method === "cash"
        ? payWorkingOrder({ ...deps(), backend }, cfg, {
            id,
            lines: [],
            tender: { method: "cash", amount: "3.00" },
          })
        : payIntegrated({ ...deps(), backend, provider }, cfg, {
            id,
            lines: [],
            simulationOutcome: "captured",
          });
    await expect(pay).rejects.toMatchObject({
      code: "order.service_context_missing",
      params: { workingOrderId: id },
    });
    expect(collect).not.toHaveBeenCalled();
    expect(facts()).toEqual(before);
    expect(venue.db.all(sql`select status from working_orders where id = ${id}`)).toEqual([
      { status: "open" },
    ]);
  },
);

it.each([undefined, "", "   "])(
  "a missing/blank description (%j) refuses before integrated dispatch",
  async (description) => {
    await authored(description);
    const provider = new SimulatorPaymentProvider(venue.db);
    const collect = vi.spyOn(provider, "collect");
    const before = facts();
    await expect(
      payIntegrated({ ...deps(), provider }, venue.cfg, request()),
    ).rejects.toMatchObject({ code: "department.operation_description_required" });
    expect(collect).not.toHaveBeenCalled();
    expect(facts()).toEqual(before);
  },
);

it.each(["cash", "card"] as const)(
  "a missing description refuses a new %s bill payment before money or drawer work",
  async (method) => {
    const id = await tabWith(venue, "Caña");
    await authored();
    const before = facts();
    const calls = venue.card.collectCalls.length;
    const answer = await payBill(id, method, method === "card" ? "reader" : undefined);
    expect(answer.json).toMatchObject({ code: "department.operation_description_required" });
    expect(facts()).toEqual(before);
    expect(venue.card.collectCalls).toHaveLength(calls);
  },
);

it("missing description refuses unpaid issuance without allocating an invoice", async () => {
  const id = await open();
  await authored();
  const before = facts();
  await expect(issueOrderInvoice(deps(), venue.cfg, id, venue.operatorId)).rejects.toMatchObject({
    code: "department.operation_description_required",
  });
  expect(facts()).toEqual(before);
});

it("missing description leaves an unfiled capture recoverable without touching the reader", async () => {
  const id = await open();
  await withTransaction(venue.db, (tx) =>
    insertCapturedPayment(tx, {
      origin: venue.cfg.origin,
      workingOrderId: id,
      provider: "simulator",
      paymentRef: randomUUID(),
      amount: decimal("3.00"),
      settledAt: new Date(),
      externalRef: randomUUID(),
    }),
  );
  await authored();
  const provider = new SimulatorPaymentProvider(venue.db);
  const collect = vi.spyOn(provider, "collect");
  const before = facts();
  await expect(
    payIntegrated({ ...deps(), provider }, venue.cfg, { id, lines: [] }),
  ).rejects.toMatchObject({ code: "department.operation_description_required" });
  expect(facts()).toEqual(before);
  expect(collect).not.toHaveBeenCalled();
});

it.each(["cash", "card"] as const)(
  "a missing department refuses a %s bill payment with its own code before money or drawer work",
  async (method) => {
    const id = await tabWith(venue, "Caña");
    await venue.db.run(sql`delete from order_service_contexts where working_order_id = ${id}`);
    const before = facts();
    const calls = venue.card.collectCalls.length;
    const answer = await payBill(id, method, method === "card" ? "reader" : undefined);
    expect(answer.status).toBe(400);
    expect(answer.json).toEqual({ code: "sale.department_missing", params: {} });
    expect(facts()).toEqual(before);
    expect(venue.card.collectCalls).toHaveLength(calls);
  },
);
