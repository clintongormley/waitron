import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  activityLog,
  parties,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { seedPerson, seedVenue, seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  mergePartyAllergies,
  moveBillAllergies,
  readPartyAllergy,
  splitPartyAllergies,
  writePartyAllergy,
} from "./party-allergy.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
let person: string;
const tx = <T>(fn: (t: Transaction) => Promise<T>) => withTransaction(suite.db, fn);
beforeEach(async () => {
  await seedVenue(suite.db, { invoiceLocales: ["en"] });
  person = await seedPerson(suite.db);
});
async function party() {
  const [row] = await suite.db.insert(parties).values({ openedBy: person }).returning();
  return row!.id;
}
const guest = { who: "Window seat", allergens: { milk: {} }, note: "Severe" };
const history = () =>
  suite.db.select().from(activityLog).where(eq(activityLog.kind, "party.allergy_answered"));

it.each(["none", "allergies"] as const)(
  "records the %s answer on the party and in history with only a count",
  async (answer) => {
    const id = await party();
    const guests = answer === "allergies" ? [guest, { ...guest, who: "Blue jumper" }] : [];
    await tx((t) => writePartyAllergy(t, id, { answer, guests }, person));
    const [row] = await suite.db.select().from(parties).where(eq(parties.id, id));
    expect(row).toMatchObject({
      allergyAnswer: answer,
      allergyAnsweredBy: person,
      allergyAnsweredAt: expect.any(String),
    });
    const entries = await history();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ subjectKind: "party", subjectId: id, personId: person });
    expect(entries[0]!.data).toEqual({ answer, guestCount: guests.length });
  },
);

it("combining an unanswered party with no-allergies clears both answers without history", async () => {
  const a = await party(),
    b = await party();
  await tx((t) => writePartyAllergy(t, a, { answer: "none", guests: [] }, person));
  const before = await history();
  await tx((t) => mergePartyAllergies(t, a, b, person));
  for (const id of [a, b])
    expect(await tx((t) => readPartyAllergy(t, id))).toMatchObject({
      answer: null,
      changedBy: null,
      changedAt: null,
      guests: [],
      ticks: [],
    });
  expect(await history()).toEqual(before);
});

it("combining allergy answers preserves guests without adding history", async () => {
  const a = await party(),
    b = await party();
  await tx((t) => writePartyAllergy(t, a, { answer: "allergies", guests: [guest] }, person));
  const before = await history();
  await tx((t) => mergePartyAllergies(t, a, b, person));
  expect(await tx((t) => readPartyAllergy(t, b))).toMatchObject({
    answer: "allergies",
    guests: [expect.objectContaining(guest)],
  });
  expect(await history()).toEqual(before);
});

it("splitting and moving a bill copy the answer without history", async () => {
  const a = await party(),
    b = await party(),
    c = await party();
  const bill = await seedWorkingOrder(suite.db, {
    partyId: a,
    source: "dashboard",
    orderNumber: 1,
  });
  await tx((t) => writePartyAllergy(t, a, { answer: "allergies", guests: [guest] }, person));
  const before = await history();
  await tx((t) => splitPartyAllergies(t, a, b, [], person));
  await tx((t) => moveBillAllergies(t, a, c, bill.id, person));
  for (const id of [b, c])
    expect(await tx((t) => readPartyAllergy(t, id))).toMatchObject({
      answer: "allergies",
      changedBy: person,
      guests: [expect.objectContaining(guest)],
    });
  expect(await history()).toEqual(before);
});
