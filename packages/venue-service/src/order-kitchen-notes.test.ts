import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS, locations, parties, workingOrders, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import * as notes from "./index.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
  timeoutMs: 60_000,
});
let locationId: string;
beforeEach(async () => {
  await seedTenant(suite.db);
  const [row] = await suite.db
    .insert(locations)
    .values({
      name: "Sala",
      invoiceLocales: ["en"],
      operationDescription: "Restaurant",
      timeZone: "UTC",
    })
    .returning();
  locationId = row!.id;
});
async function owner(kind: "order" | "party") {
  if (kind === "party") {
    const [row] = await suite.db.insert(parties).values({ openedBy: randomUUID() }).returning();
    return { partyId: row!.id };
  }
  const [row] = await suite.db
    .insert(workingOrders)
    .values({ locationId, source: "dashboard", orderNumber: 1 })
    .returning();
  return { workingOrderId: row!.id };
}
const tx = <T>(fn: Parameters<typeof withTransaction<T>>[1]) => withTransaction(suite.db, fn);

describe("whole-order note normalisation", () => {
  it.each([
    [null, null],
    ["", null],
    [" \t\r\n\x1b\x1d\x7f\x85 ", null],
    ["  Train at 14:30  ", "Train at 14:30"],
    ["Todo\r\njunto\x1b\x1dprimero\x85niños", "Todo junto primero niños"],
    ["Use <strong> as text & keep $&", "Use <strong> as text & keep $&"],
  ])("normalises %j", (input, expected) => {
    expect(notes.normaliseKitchenNote(input)).toBe(expected);
  });
  it.each([undefined, 12, true, [], {}, ["text"]].map((value) => ({ value })))(
    "refuses malformed note $value with its domain code",
    ({ value }) => {
      expect(() => notes.normaliseKitchenNote(value)).toThrowError(
        expect.objectContaining({ code: "kitchen_note.invalid", params: { field: "note" } }),
      );
    },
  );
  it("accepts 2000 characters after trimming, refuses 2001", () => {
    expect(notes.normaliseKitchenNote(` ${"n".repeat(2000)} `)).toBe("n".repeat(2000));
    expect(() => notes.normaliseKitchenNote("n".repeat(2001))).toThrowError(
      expect.objectContaining({
        code: "kitchen_note.too_long",
        params: { limit: 2000, length: 2001 },
      }),
    );
  });
});

it("builds a table with independent order/party ownership and note revisions", async () => {
  const info = await suite.db.execute<{ name: string }>(
    sql`select name from pragma_table_info('order_kitchen_notes')`,
  );
  expect(info.rows.map((row) => row.name)).toEqual([
    "id",
    "working_order_id",
    "party_id",
    "note",
    "revision",
  ]);
});

it.each(["order", "party"] as const)(
  "saves, reads, clears and retains the %s revision without changing its owner",
  async (kind) => {
    const scope = await owner(kind);
    const key = kind === "party" ? `party:${scope.partyId}` : `order:${scope.workingOrderId}`;
    expect((await tx((t) => notes.readKitchenNotes(t, [scope]))).get(key)).toEqual({
      note: null,
      revision: 0,
    });
    expect(await tx((t) => notes.writeKitchenNote(t, scope, 0, "  Together  "))).toEqual({
      note: "Together",
      revision: 1,
    });
    expect((await tx((t) => notes.readKitchenNotes(t, [scope]))).get(key)).toEqual({
      note: "Together",
      revision: 1,
    });
    expect(await tx((t) => notes.writeKitchenNote(t, scope, 1, "Together"))).toEqual({
      note: "Together",
      revision: 1,
    });
    expect(await tx((t) => notes.writeKitchenNote(t, scope, 1, null))).toEqual({
      note: null,
      revision: 2,
    });
    await expect(tx((t) => notes.writeKitchenNote(t, scope, 1, null))).rejects.toMatchObject({
      code: "kitchen_note.out_of_date",
      params: { revision: 2 },
    });
    expect((await tx((t) => notes.readKitchenNotes(t, [scope]))).get(key)).toEqual({
      note: null,
      revision: 2,
    });
  },
);

it("batch reads only the requested scopes and provides empty defaults without creating rows", async () => {
  const a = await owner("order"),
    b = await owner("party"),
    c = await owner("order");
  await tx((t) => notes.writeKitchenNote(t, a, 0, "Counter instruction"));
  await tx((t) => notes.writeKitchenNote(t, b, 0, "Party instruction"));
  expect([...(await tx((t) => notes.readKitchenNotes(t, [a, b, c]))).entries()]).toEqual([
    [notes.kitchenNoteKey(a), { note: "Counter instruction", revision: 1 }],
    [notes.kitchenNoteKey(b), { note: "Party instruction", revision: 1 }],
    [notes.kitchenNoteKey(c), { note: null, revision: 0 }],
  ]);
  expect([...(await tx((t) => notes.readKitchenNotes(t, []))).entries()]).toEqual([]);
  expect(await tx((t) => notes.writeKitchenNote(t, c, 0, null))).toEqual({
    note: null,
    revision: 0,
  });
});

it.each([-1, 0.5, NaN, Infinity])(
  "refuses invalid expected revision %s without changing the note",
  async (revision) => {
    const scope = await owner("order");
    await expect(
      tx((t) => notes.writeKitchenNote(t, scope, revision, "No write")),
    ).rejects.toMatchObject({ code: "kitchen_note.invalid", params: { field: "revision" } });
    expect(
      (await tx((t) => notes.readKitchenNotes(t, [scope]))).get(notes.kitchenNoteKey(scope)),
    ).toEqual({ note: null, revision: 0 });
  },
);

it.each(
  [null, {}, { workingOrderId: "" }, { partyId: null }, { workingOrderId: "a", partyId: "b" }].map(
    (scope) => ({ scope }),
  ),
)("refuses malformed note scope $scope", ({ scope }) => {
  expect(() => notes.kitchenNoteKey(scope as never)).toThrowError(
    expect.objectContaining({ code: "kitchen_note.invalid", params: { field: "scope" } }),
  );
});

it("updates an existing revision-zero row instead of treating it as absent", async () => {
  const scope = await owner("party");
  await suite.db.insert(notes.orderKitchenNotes).values(scope);
  expect(await tx((t) => notes.writeKitchenNote(t, scope, 0, "First instruction"))).toEqual({
    note: "First instruction",
    revision: 1,
  });
});

it("refuses a row with zero or two owners by its named constraint", async () => {
  const order = await owner("order"),
    party = await owner("party");
  await expect(
    tx((t) => t.insert(notes.orderKitchenNotes).values({ note: "No owner" })),
  ).rejects.toThrow(/order_kitchen_notes_owner_ck/);
  await expect(
    tx((t) => t.insert(notes.orderKitchenNotes).values({ ...order, ...party, note: "Two owners" })),
  ).rejects.toThrow(/order_kitchen_notes_owner_ck/);
});

it("refuses a nonexistent owner and duplicate notes for one owner", async () => {
  await expect(
    tx((t) => t.insert(notes.orderKitchenNotes).values({ partyId: randomUUID() })),
  ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  const scope = await owner("order");
  await tx((t) => notes.writeKitchenNote(t, scope, 0, "Keep this"));
  await expect(
    tx((t) => t.insert(notes.orderKitchenNotes).values({ ...scope, note: "Duplicate" })),
  ).rejects.toThrow(/UNIQUE constraint failed: order_kitchen_notes.working_order_id/);
  expect(
    (await tx((t) => notes.readKitchenNotes(t, [scope]))).get(notes.kitchenNoteKey(scope)),
  ).toEqual({ note: "Keep this", revision: 1 });
});
