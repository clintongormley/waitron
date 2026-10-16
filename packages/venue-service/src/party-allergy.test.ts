import { randomUUID } from "node:crypto";
import { beforeEach, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  locations,
  parties,
  orderDrafts,
  orderDraftLines,
  workingOrders,
  workingOrderLines,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import * as allergy from "./index.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
const actor = randomUUID();
const tx = <T>(fn: (t: Transaction) => Promise<T>) => withTransaction(suite.db, fn);
let partyId: string;
let locationId: string;
beforeEach(async () => {
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({
      name: "Sala",
      invoiceLocales: ["en"],
      operationDescription: "Restaurant",
      timeZone: "UTC",
    })
    .returning();
  locationId = location!.id;
  const [party] = await suite.db.insert(parties).values({ openedBy: actor }).returning();
  partyId = party!.id;
});
const guest = {
  who: "Seat three",
  allergens: { gluten: { kinds: ["wheat"] } },
  note: "Coeliac, severe",
};
function read(id = partyId) {
  return tx((t) => allergy.readPartyAllergy(t, id));
}
function save(input: unknown, revision = 0, id = partyId) {
  return tx((t) => allergy.savePartyAllergy(t, id, revision, input, actor));
}
async function draftLine(id = partyId) {
  const [draft] = await suite.db
    .insert(orderDrafts)
    .values({ partyId: id, ownerId: actor })
    .returning();
  const [line] = await suite.db
    .insert(orderDraftLines)
    .values({
      draftId: draft!.id,
      position: 0,
      menuItemId: randomUUID(),
      options: [],
      extras: [],
      quantity: 1000,
    })
    .returning();
  return line!.id;
}
async function workingLine(id = partyId, parentLineId?: string) {
  const [order] = await suite.db
    .insert(workingOrders)
    .values({ locationId, partyId: id, orderNumber: 1, source: "dashboard" })
    .returning();
  const [line] = await suite.db
    .insert(workingOrderLines)
    .values({
      workingOrderId: order!.id,
      lineNo: 1,
      name: "Dish",
      descriptions: { en: "Dish" },
      quantity: 1000,
      unitPriceGross: 500,
      lineTotal: 500,
      vatClass: "general",
      parentLineId,
    })
    .returning();
  return line!.id;
}

it("starts unanswered, records the editor and time, and advances the party revision", async () => {
  expect(await read()).toEqual({
    answer: null,
    guests: [],
    ticks: [],
    changedBy: null,
    changedAt: null,
    revision: 0,
  });
  const result = await save({ answer: "allergies", guests: [guest] });
  expect(result).toMatchObject({
    answer: "allergies",
    changedBy: actor,
    revision: 1,
    guests: [{ position: 0, ...guest }],
    ticks: [],
  });
  expect(result.changedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect((await read()).guests[0]!.id).toBe(result.guests[0]!.id);
});

it("keeps guest ids and ticks on edit, clears them on deletion and retains an empty Allergies answer", async () => {
  const first = await save({
    answer: "allergies",
    guests: [guest, { who: "Guest B", allergens: { milk: {} } }],
  });
  const draftLineId = await draftLine();
  await tx((t) =>
    allergy.setAllergyLineTicks(t, partyId, [{ guestId: first.guests[0]!.id, draftLineId }]),
  );
  const edited = await save(
    {
      answer: "allergies",
      guests: [{ ...first.guests[0]!, who: "Window seat" }, first.guests[1]!],
    },
    1,
  );
  expect(edited.guests.map((g) => g.id)).toEqual(first.guests.map((g) => g.id));
  expect(edited.ticks).toEqual([
    { guestId: first.guests[0]!.id, draftLineId, workingLineId: null },
  ]);
  const removed = await save({ answer: "allergies", guests: [] }, 2);
  expect(removed).toMatchObject({ answer: "allergies", guests: [], ticks: [], revision: 3 });
});

it("No allergies clears every guest and both kinds of tick", async () => {
  const first = await save({ answer: "allergies", guests: [guest] });
  const draftLineId = await draftLine();
  const workingLineId = await workingLine();
  await tx((t) =>
    allergy.setAllergyLineTicks(t, partyId, [
      { guestId: first.guests[0]!.id, draftLineId },
      { guestId: first.guests[0]!.id, workingLineId },
    ]),
  );
  expect(await save({ answer: "none", guests: [] }, 1)).toMatchObject({
    answer: "none",
    guests: [],
    ticks: [],
    revision: 2,
  });
});

it("refuses a stale save without losing guests, ticks or the winning revision", async () => {
  const first = await save({ answer: "allergies", guests: [guest] });
  const draftLineId = await draftLine();
  await tx((t) =>
    allergy.setAllergyLineTicks(t, partyId, [{ guestId: first.guests[0]!.id, draftLineId }]),
  );
  const before = await read();
  await expect(save({ answer: "none", guests: [] })).rejects.toMatchObject({
    code: "allergy.out_of_date",
    params: { revision: 1 },
  });
  expect(await read()).toEqual(before);
});

it.each([
  [null, "answer"],
  [{ answer: null, guests: [] }, "answer"],
  [{ answer: ["none"], guests: [] }, "answer"],
  [{ answer: "none", guests: [guest] }, "guests"],
  [{ answer: "allergies", guests: null }, "guests"],
  [{ answer: "allergies", guests: [{ ...guest, who: " " }] }, "guests.0.who"],
  [{ answer: "allergies", guests: [{ ...guest, who: "x".repeat(41) }] }, "guests.0.who"],
  [{ answer: "allergies", guests: [{ ...guest, allergens: {} }] }, "guests.0.allergens"],
  [{ answer: "allergies", guests: [{ ...guest, allergens: null }] }, "guests.0.allergens"],
  [{ answer: "allergies", guests: [{ ...guest, note: "x".repeat(2001) }] }, "guests.0.note"],
  [{ answer: "allergies", guests: [{ ...guest, id: randomUUID() }] }, "guests.0.id"],
])("refuses invalid allergy input %j before writing", async (input, field) => {
  await expect(save(input)).rejects.toMatchObject({ code: "allergy.invalid", params: { field } });
  expect(await read()).toMatchObject({ answer: null, guests: [], revision: 0 });
});

it("uses the catalogue kind validator and normalises printable guest text", async () => {
  await expect(
    save({ answer: "allergies", guests: [{ ...guest, allergens: { gluten: {} } }] }),
  ).rejects.toMatchObject({ code: "allergy.invalid", params: { field: "guests.0.allergens" } });
  await expect(
    save({
      answer: "allergies",
      guests: [{ ...guest, allergens: { nuts: { kinds: ["wheat"] } } }],
    }),
  ).rejects.toMatchObject({ code: "allergy.invalid", params: { field: "guests.0.allergens" } });
  const result = await save({
    answer: "allergies",
    guests: [{ who: ` Seat\n3 `, allergens: { milk: {} }, note: "  no\x1bmilk\nplease  " }],
  });
  expect(result.guests[0]).toMatchObject({
    who: "Seat 3",
    note: "no milk please",
    allergens: { milk: {} },
  });
});

it("reassigns and clears whole lines without duplicating them", async () => {
  const first = await save({
    answer: "allergies",
    guests: [guest, { who: "Guest B", allergens: { eggs: {} } }],
  });
  const draftLineId = await draftLine();
  await tx((t) =>
    allergy.setAllergyLineTicks(t, partyId, [{ guestId: first.guests[0]!.id, draftLineId }]),
  );
  await tx((t) =>
    allergy.setAllergyLineTicks(t, partyId, [{ guestId: first.guests[1]!.id, draftLineId }]),
  );
  expect((await read()).ticks).toEqual([
    { guestId: first.guests[1]!.id, draftLineId, workingLineId: null },
  ]);
  await tx((t) => allergy.setAllergyLineTicks(t, partyId, [{ guestId: null, draftLineId }]));
  expect((await read()).ticks).toEqual([]);
});

it("rejects another party's guest and line without changing any assignment", async () => {
  const [other] = await suite.db.insert(parties).values({ openedBy: actor }).returning();
  const a = await save({ answer: "allergies", guests: [guest] });
  const b = await save({ answer: "allergies", guests: [guest] }, 0, other!.id);
  const draftLineId = await draftLine();
  const otherLine = await draftLine(other!.id);
  await expect(
    tx((t) => allergy.setAllergyLineTicks(t, partyId, [{ guestId: b.guests[0]!.id, draftLineId }])),
  ).rejects.toMatchObject({ code: "allergy.invalid", params: { field: "ticks.0.guestId" } });
  await expect(
    tx((t) =>
      allergy.setAllergyLineTicks(t, partyId, [
        { guestId: a.guests[0]!.id, draftLineId: otherLine },
      ]),
    ),
  ).rejects.toMatchObject({ code: "allergy.invalid", params: { field: "ticks.0.line" } });
  expect((await read()).ticks).toEqual([]);
});

it("enforces one target and one guest per line at the database boundary", async () => {
  const a = await save({ answer: "allergies", guests: [guest] });
  const draftLineId = await draftLine();
  const guestId = a.guests[0]!.id;
  await expect(tx((t) => t.insert(allergy.allergyLineTicks).values({ guestId }))).rejects.toThrow(
    /allergy_line_ticks_target_ck/,
  );
  await tx((t) => t.insert(allergy.allergyLineTicks).values({ guestId, draftLineId }));
  await expect(
    tx((t) => t.insert(allergy.allergyLineTicks).values({ guestId, draftLineId })),
  ).rejects.toThrow(/UNIQUE/);
  await tx((t) => t.delete(orderDraftLines).where(eq(orderDraftLines.id, draftLineId)));
  expect((await read()).ticks).toEqual([]);
  const tables = await suite.db.execute<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name in ('party_allergy','party_allergy_guests','allergy_line_ticks')`,
  );
  expect(tables.rows.map((r) => r.name).sort()).toEqual([
    "allergy_line_ticks",
    "party_allergy",
    "party_allergy_guests",
  ]);
});

it("moves a draft tick to its corresponding working dish and keeps unsubmitted ticks", async () => {
  const state = await save({ answer: "allergies", guests: [guest] });
  const a = await draftLine();
  const [draft] = await suite.db.select().from(orderDrafts).where(eq(orderDrafts.partyId, partyId));
  const [b] = await suite.db
    .insert(orderDraftLines)
    .values({
      draftId: draft!.id,
      position: 1,
      menuItemId: randomUUID(),
      options: [],
      extras: [],
      quantity: 1000,
    })
    .returning();
  const workingLineId = await workingLine();
  await tx((t) =>
    allergy.setAllergyLineTicks(t, partyId, [
      { guestId: state.guests[0]!.id, draftLineId: a },
      { guestId: state.guests[0]!.id, draftLineId: b!.id },
    ]),
  );
  await tx((t) => allergy.moveAllergyDraftTicks(t, partyId, [{ draftLineId: a, workingLineId }]));
  expect((await read()).ticks).toEqual(
    expect.arrayContaining([
      { guestId: state.guests[0]!.id, draftLineId: null, workingLineId },
      { guestId: state.guests[0]!.id, draftLineId: b!.id, workingLineId: null },
    ]),
  );
  await tx((t) => t.delete(orderDraftLines).where(eq(orderDraftLines.id, a)));
  expect((await read()).ticks).toHaveLength(2);
});

it("merges guests with identical Who labels without losing ids or ticks", async () => {
  const [other] = await suite.db.insert(parties).values({ openedBy: actor }).returning();
  const a = await save({ answer: "allergies", guests: [guest] });
  const b = await save(
    { answer: "allergies", guests: [{ ...guest, allergens: { milk: {} } }] },
    0,
    other!.id,
  );
  const draftLineId = await draftLine(other!.id);
  await tx((t) =>
    allergy.setAllergyLineTicks(t, other!.id, [{ guestId: b.guests[0]!.id, draftLineId }]),
  );
  await tx((t) => allergy.mergePartyAllergies(t, other!.id, partyId, actor));
  const result = await read();
  expect(result.guests.map((g) => [g.id, g.position, g.allergens])).toEqual([
    [a.guests[0]!.id, 0, { gluten: { kinds: ["wheat"] } }],
    [b.guests[0]!.id, 1, { milk: {} }],
  ]);
  expect(result.ticks).toEqual([{ guestId: b.guests[0]!.id, draftLineId, workingLineId: null }]);
  expect(await read(other!.id)).toMatchObject({ answer: null, guests: [], ticks: [] });
});

it.each([null, "none", "allergies"] as const)(
  "joining an unanswered party cannot erase the survivor's %s answer",
  async (answer) => {
    const [other] = await suite.db.insert(parties).values({ openedBy: actor }).returning();
    if (answer !== null) await save({ answer, guests: answer === "none" ? [] : [guest] });
    await tx((t) => allergy.mergePartyAllergies(t, other!.id, partyId, actor));
    expect((await read()).answer).toBe(answer);
  },
);

it("split copies every guest, moving only the leaving bill's ticks to new ids", async () => {
  const [other] = await suite.db.insert(parties).values({ openedBy: actor }).returning();
  const state = await save({
    answer: "allergies",
    guests: [guest, { who: "Guest B", allergens: { eggs: {} } }],
  });
  const staying = await workingLine();
  const leaving = await workingLine();
  const [line] = await suite.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.id, leaving));
  await tx((t) =>
    allergy.setAllergyLineTicks(t, partyId, [
      { guestId: state.guests[0]!.id, workingLineId: staying },
      { guestId: state.guests[1]!.id, workingLineId: leaving },
    ]),
  );
  await tx((t) => allergy.splitPartyAllergies(t, partyId, other!.id, line!.workingOrderId, actor));
  const source = await read();
  const target = await read(other!.id);
  expect(source.guests).toEqual(state.guests);
  expect(source.ticks).toEqual([
    { guestId: state.guests[0]!.id, draftLineId: null, workingLineId: staying },
  ]);
  expect(target.guests.map((g) => [g.who, g.allergens])).toEqual([
    ["Seat three", { gluten: { kinds: ["wheat"] } }],
    ["Guest B", { eggs: {} }],
  ]);
  expect(target.guests.every((g) => !state.guests.some((old) => old.id === g.id))).toBe(true);
  expect(target.ticks).toEqual([
    { guestId: target.guests[1]!.id, draftLineId: null, workingLineId: leaving },
  ]);
});

it.each([-1, 0.5, NaN, Infinity])(
  "refuses invalid revision %s without creating an answer",
  async (revision) => {
    await expect(save({ answer: "none", guests: [] }, revision)).rejects.toMatchObject({
      code: "allergy.invalid",
      params: { field: "revision" },
    });
    expect((await read()).answer).toBeNull();
  },
);

it("refuses missing and closed parties and duplicate guest ids", async () => {
  await expect(read(randomUUID())).rejects.toMatchObject({
    code: "allergy.invalid",
    params: { field: "partyId" },
  });
  await expect(save({ answer: "none", guests: [] }, 0, randomUUID())).rejects.toMatchObject({
    code: "allergy.invalid",
    params: { field: "partyId" },
  });
  const state = await save({ answer: "allergies", guests: [guest] });
  await expect(
    save({ answer: "allergies", guests: [state.guests[0], state.guests[0]] }, 1),
  ).rejects.toMatchObject({ code: "allergy.invalid", params: { field: "guests.1.id" } });
  await tx((t) =>
    t
      .update(parties)
      .set({ state: "closed", closedAt: new Date().toISOString(), closedBy: actor })
      .where(eq(parties.id, partyId)),
  );
  await expect(save({ answer: "none", guests: [] }, 1)).rejects.toMatchObject({
    code: "allergy.invalid",
    params: { field: "partyId" },
  });
  expect((await read()).guests).toEqual(state.guests);
});

it.each([
  [{ answer: "allergies", guests: [null] }, "guests.0.who"],
  [{ answer: "allergies", guests: [{ ...guest, who: 7 }] }, "guests.0.who"],
  [{ answer: "allergies", guests: [{ ...guest, note: [] }] }, "guests.0.note"],
  [{ answer: "allergies", guests: [{ ...guest, id: null }] }, "guests.0.id"],
])("rejects malformed guest fields %j", async (input, field) => {
  await expect(save(input)).rejects.toMatchObject({ code: "allergy.invalid", params: { field } });
  expect((await read()).guests).toEqual([]);
});

it.each([
  [null, "ticks"],
  [[], null],
  [[null], "ticks.0.line"],
  [[{}], "ticks.0.line"],
  [[{ draftLineId: "bad", guestId: null }], "ticks.0.line"],
  [[{ draftLineId: randomUUID(), workingLineId: randomUUID(), guestId: null }], "ticks.0.line"],
  [[{ workingLineId: randomUUID(), guestId: null }], "ticks.0.line"],
])("validates assignment shapes %j before touching lines", async (input, field) => {
  if (field === null) await tx((t) => allergy.setAllergyLineTicks(t, partyId, input));
  else
    await expect(tx((t) => allergy.setAllergyLineTicks(t, partyId, input))).rejects.toMatchObject({
      code: "allergy.invalid",
      params: { field },
    });
  expect((await read()).ticks).toEqual([]);
});

it("rejects duplicate line ids and extras children while keeping existing assignments", async () => {
  const state = await save({ answer: "allergies", guests: [guest] });
  const workingLineId = await workingLine();
  const [parent] = await suite.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.id, workingLineId));
  const [extra] = await suite.db
    .insert(workingOrderLines)
    .values({
      workingOrderId: parent!.workingOrderId,
      lineNo: 2,
      parentLineId: workingLineId,
      name: "Sauce",
      descriptions: { en: "Sauce" },
      quantity: 1000,
      unitPriceGross: 100,
      lineTotal: 100,
      vatClass: "general",
    })
    .returning();
  const tick = { guestId: state.guests[0]!.id, workingLineId };
  await tx((t) => allergy.setAllergyLineTicks(t, partyId, [tick]));
  const before = (await read()).ticks;
  await expect(
    tx((t) => allergy.setAllergyLineTicks(t, partyId, [tick, tick])),
  ).rejects.toMatchObject({ code: "allergy.invalid", params: { field: "ticks.1.line" } });
  await expect(
    tx((t) => allergy.setAllergyLineTicks(t, partyId, [{ ...tick, workingLineId: extra!.id }])),
  ).rejects.toMatchObject({ code: "allergy.invalid", params: { field: "ticks.0.line" } });
  expect((await read()).ticks).toEqual(before);
  await tx((t) => allergy.setAllergyLineTicks(t, partyId, [{ guestId: null, workingLineId }]));
  expect((await read()).ticks).toEqual([]);
});

it.each([
  ["none", null, "none"],
  ["none", "allergies", "allergies"],
  ["allergies", "none", "allergies"],
] as const)("merges source %s into target %s as %s", async (from, into, expected) => {
  const [other] = await suite.db.insert(parties).values({ openedBy: actor }).returning();
  await save({ answer: from, guests: from === "none" ? [] : [guest] }, 0, other!.id);
  if (into !== null) await save({ answer: into, guests: into === "none" ? [] : [guest] });
  await tx((t) => allergy.mergePartyAllergies(t, other!.id, partyId, actor));
  expect((await read()).answer).toBe(expected);
  expect((await read(other!.id)).guests).toEqual([]);
});

it.each([null, "none", "allergies"] as const)(
  "copies a split's %s answer without a bill and a self-merge changes nothing",
  async (answer) => {
    const [other] = await suite.db.insert(parties).values({ openedBy: actor }).returning();
    if (answer !== null) await save({ answer, guests: answer === "none" ? [] : [guest] });
    const before = await read();
    await tx((t) => allergy.mergePartyAllergies(t, partyId, partyId, actor));
    expect(await read()).toEqual(before);
    await tx((t) => allergy.splitPartyAllergies(t, partyId, other!.id, null, actor));
    expect((await read(other!.id)).answer).toBe(answer);
    expect((await read(other!.id)).ticks).toEqual([]);
  },
);

it("accepts a working dish from a party merged into this party, while keeping unrelated parties out", async () => {
  const [source] = await suite.db.insert(parties).values({ openedBy: actor }).returning();
  const state = await save({ answer: "allergies", guests: [guest] });
  const workingLineId = await workingLine(source!.id);
  await tx((t) =>
    t
      .update(parties)
      .set({
        state: "closed",
        closedAt: new Date().toISOString(),
        closedBy: actor,
        mergedIntoPartyId: partyId,
      })
      .where(eq(parties.id, source!.id)),
  );
  await tx((t) =>
    allergy.setAllergyLineTicks(t, partyId, [{ guestId: state.guests[0]!.id, workingLineId }]),
  );
  expect((await read()).ticks).toEqual([
    { guestId: state.guests[0]!.id, draftLineId: null, workingLineId },
  ]);
});

it("refuses dish assignments once the party is closed", async () => {
  const state = await save({ answer: "allergies", guests: [guest] });
  const draftLineId = await draftLine();
  await tx((t) =>
    t
      .update(parties)
      .set({ state: "closed", closedAt: new Date().toISOString(), closedBy: actor })
      .where(eq(parties.id, partyId)),
  );
  await expect(
    tx((t) =>
      allergy.setAllergyLineTicks(t, partyId, [{ guestId: state.guests[0]!.id, draftLineId }]),
    ),
  ).rejects.toMatchObject({ code: "allergy.invalid", params: { field: "partyId" } });
  expect((await read()).ticks).toEqual([]);
});

it("identifies the guest whose allergen declaration is invalid", async () => {
  await expect(
    save({
      answer: "allergies",
      guests: [guest, { who: "Second guest", allergens: { bogus: {} } }],
    }),
  ).rejects.toMatchObject({ code: "allergy.invalid", params: { field: "guests.1.allergens" } });
  expect((await read()).guests).toEqual([]);
});
