import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  engineErrorMessage,
  kitchenStations,
  locations,
  parties,
  ticketItems,
  workingOrderLines,
  workingOrders,
  withTransaction,
} from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { VENUE_SERVICE_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";
import { VENUE_SERVICE_CLASSIFICATION, VENUE_SERVICE_CHANGE_SOURCES } from "./classification.js";
import { readPartyAllergy, savePartyAllergy } from "./party-allergy.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
const actor = randomUUID();
const original = {
  who: "Window guest",
  allergens: { gluten: { kinds: ["wheat"] }, milk: {} },
  note: "Use a separate pan",
  clashes: { milk: {} },
  labels: {
    en: { avoids: ["Gluten (wheat)", "Milk"], clashes: ["Milk"] },
    es: { avoids: ["Stored gluten label", "Stored milk label"], clashes: ["Stored milk label"] },
  },
};
let partyId: string;
let orderId: string;
let stationId: string;
let ticketId: string;
beforeEach(async () => {
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({
      name: "Dining room",
      invoiceLocales: ["en"],
      operationDescription: "Restaurant",
    })
    .returning();
  const nodeId = await seedNode(suite.db, locationId(location!.id));
  const [station] = await suite.db
    .insert(kitchenStations)
    .values({
      locationId: location!.id,
      name: "Grill",
    })
    .returning();
  stationId = station!.id;
  const [party] = await suite.db.insert(parties).values({ openedBy: actor }).returning();
  partyId = party!.id;
  const [order] = await suite.db
    .insert(workingOrders)
    .values({
      locationId: location!.id,
      partyId,
      orderNumber: 1,
      source: "dashboard",
    })
    .returning();
  orderId = order!.id;
  const [line] = await suite.db
    .insert(workingOrderLines)
    .values({
      workingOrderId: orderId,
      lineNo: 1,
      name: "Staff dish",
      kitchenName: "GRILL DISH",
      descriptions: { en: "Customer dish" },
      quantity: 1000,
      unitPriceGross: 700,
      lineTotal: 700,
      vatClass: "reduced",
    })
    .returning();
  const [ticket] = await suite.db
    .insert(ticketItems)
    .values({
      nodeId,
      workingOrderId: orderId,
      workingOrderLineId: line!.id,
      stationId,
      quantity: 1000,
      firedAt: "2026-10-20T10:00:00Z",
    })
    .returning();
  ticketId = ticket!.id;
});

function hasStorage(): void {
  expect(
    suite.db
      .all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`)
      .map((row) => row.name),
  ).toContain("ticket_item_allergies");
  expect(
    suite.db
      .all<{ name: string }>(sql`select name from pragma_table_info('kitchen_notices')`)
      .map((row) => row.name),
  ).toContain("allergy_block");
}
async function putCopy(before: unknown = original, after: unknown = original): Promise<void> {
  await withTransaction(suite.db, async (tx) => {
    await tx.execute(sql`insert into ticket_item_allergies(ticket_item_id, original_block, current_block)
      values (${ticketId}, ${before === null ? null : JSON.stringify(before)},
        ${after === null ? null : JSON.stringify(after)})`);
  });
}
async function putNotice(
  kind: string,
  block: unknown,
  options: {
    direction?: string;
    cancelledExtra?: string;
    movedTo?: string;
    reroutedTo?: string;
    orderNoteChange?: unknown;
  } = {},
): Promise<void> {
  await withTransaction(suite.db, async (tx) => {
    await tx.execute(sql`insert into kitchen_notices
      (id, station_id, working_order_id, order_label, kind, line_name, quantity, created_at,
       allergy_block, direction, cancelled_extra, moved_to, rerouted_to, order_note_change)
      values (${randomUUID()}, ${stationId}, ${orderId}, '#1', ${kind}, 'GRILL DISH', 1000,
       '2026-10-20T10:00:00Z', ${block === null ? null : JSON.stringify(block)},
       ${options.direction ?? null}, ${options.cancelledExtra ?? null}, ${options.movedTo ?? null},
       ${options.reroutedTo ?? null}, ${options.orderNoteChange === undefined ? null : JSON.stringify(options.orderNoteChange)})`);
  });
}

describe("A669 storage", () => {
  it("keeps the original and corrected copy by value, with explicit frozen null distinct from absence", async () => {
    hasStorage();
    expect(suite.db.all(sql`select * from ticket_item_allergies`)).toEqual([]);
    await putCopy(original, null);
    expect(suite.db.all(sql`select * from ticket_item_allergies`)).toEqual([
      {
        ticket_item_id: ticketId,
        original_block: JSON.stringify(original),
        current_block: null,
      },
    ]);
    await suite.db.delete(ticketItems).where(eq(ticketItems.id, ticketId));
    expect(suite.db.all(sql`select * from ticket_item_allergies`)).toEqual([]);
  });

  it("stores a frozen unticked row and refuses orphan ticket copies", async () => {
    hasStorage();
    await putCopy(null, null);
    expect(suite.db.all(sql`select * from ticket_item_allergies`)).toEqual([
      {
        ticket_item_id: ticketId,
        original_block: null,
        current_block: null,
      },
    ]);
    ticketId = randomUUID();
    const error = await putCopy().catch((error: unknown) => error);
    expect(engineErrorMessage(error)).toContain("FOREIGN KEY constraint failed");
  });

  it("keeps the kitchen copy when the last live guest is deleted", async () => {
    hasStorage();
    await withTransaction(suite.db, (tx) =>
      savePartyAllergy(
        tx,
        partyId,
        0,
        {
          answer: "allergies",
          guests: [{ who: original.who, allergens: original.allergens }],
        },
        actor,
      ),
    );
    await putCopy();
    await withTransaction(suite.db, (tx) =>
      savePartyAllergy(
        tx,
        partyId,
        1,
        {
          answer: "none",
          guests: [],
        },
        actor,
      ),
    );
    expect((await withTransaction(suite.db, (tx) => readPartyAllergy(tx, partyId))).guests).toEqual(
      [],
    );
    expect(
      suite.db.all(sql`select original_block, current_block from ticket_item_allergies`),
    ).toEqual([
      {
        original_block: JSON.stringify(original),
        current_block: JSON.stringify(original),
      },
    ]);
  });

  it.each(
    [
      {},
      [],
      "not a block",
      { ...original, who: null },
      { ...original, who: "" },
      { ...original, allergens: [] },
      { ...original, allergens: {} },
      { ...original, clashes: [] },
      { ...original, note: 3 },
      { ...original, labels: {} },
      { ...original, labels: { en: original.labels.en } },
      { ...original, labels: { ...original.labels, es: { avoids: "label", clashes: [] } } },
    ].map((block) => ({ block })),
  )("refuses malformed snapshot $block", async ({ block }) => {
    hasStorage();
    for (const column of ["original", "current"] as const) {
      const error = await putCopy(
        column === "original" ? block : original,
        column === "current" ? block : original,
      ).catch((error: unknown) => error);
      expect(engineErrorMessage(error)).toContain(`ticket_item_allergies_${column}_ck`);
    }
    expect(suite.db.all(sql`select * from ticket_item_allergies`)).toEqual([]);
  });

  it("stores changed and removed notices with their separate payload", async () => {
    hasStorage();
    await putNotice("allergy_changed", original);
    await putNotice("allergy_removed", null);
    expect(
      suite.db.all(
        sql`select kind, allergy_block, order_note_change from kitchen_notices order by rowid`,
      ),
    ).toEqual([
      { kind: "allergy_changed", allergy_block: JSON.stringify(original), order_note_change: null },
      { kind: "allergy_removed", allergy_block: null, order_note_change: null },
    ]);
  });

  it.each([
    { kind: "allergy_changed", block: null, options: {} },
    { kind: "allergy_changed", block: {}, options: {} },
    { kind: "allergy_removed", block: original, options: {} },
    { kind: "changed", block: original, options: {} },
    { kind: "void", block: original, options: {} },
    { kind: "unknown", block: null, options: {} },
    { kind: "allergy_changed", block: original, options: { direction: "added" } },
    { kind: "allergy_changed", block: original, options: { cancelledExtra: "Pickles" } },
    { kind: "allergy_changed", block: original, options: { movedTo: "Table 2" } },
    { kind: "allergy_changed", block: original, options: { reroutedTo: "Cold" } },
    {
      kind: "allergy_changed",
      block: original,
      options: { orderNoteChange: { before: null, after: "Together" } },
    },
    {
      kind: "allergy_removed",
      block: null,
      options: { orderNoteChange: { before: "Together", after: null } },
    },
  ])("refuses a mixed/invalid notice $kind $options", async ({ kind, block, options }) => {
    hasStorage();
    const error = await putNotice(kind, block, options).catch((error: unknown) => error);
    expect(engineErrorMessage(error)).toMatch(/CHECK constraint failed: kitchen_notices_/);
    expect(suite.db.all(sql`select * from kitchen_notices`)).toEqual([]);
  });

  it("replicates the copy as state without exporting it as setup configuration", () => {
    hasStorage();
    expect(
      VENUE_SERVICE_CLASSIFICATION.filter((entry) => entry.table === "ticket_item_allergies").map(
        ({ table, class: kind }) => [table, kind],
      ),
    ).toEqual([["ticket_item_allergies", "state"]]);
    expect(VENUE_SERVICE_CHANGE_SOURCES).toContainEqual({
      table: "ticket_item_allergies",
      type: "ticket_item_allergies",
    });
    expect(VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.map(({ name }) => name)).not.toContain(
      "ticket_item_allergies",
    );
  });
});
