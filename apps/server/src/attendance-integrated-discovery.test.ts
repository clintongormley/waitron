import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  newId,
  locations,
  workingOrders,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { seedTenant, seedNode } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { PAYMENTS_MIGRATIONS, payments } from "@waitron/payments";
import { locationId as brandLocationId } from "@waitron/shared";
import {
  WORKFORCE_MIGRATIONS,
  attendanceOperationFacts,
  attendanceDayWork,
  attendanceSourceState,
} from "@waitron/workforce";
import { beginIntegratedAttendance } from "./attendance-integrated.js";
import { recordAttendanceFact } from "./attendance-capture.js";
import { beginAttendanceDiscovery, discoverAttendanceDays } from "./attendance-discovery.js";
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS, PAYMENTS_MIGRATIONS],
});
const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);
let locationId: string, personId: string, nodeId: string, orderId: string;
const requestAt = new Date("2026-01-05T11:00:00Z"),
  later = new Date("2026-01-09T12:00:00Z");
beforeEach(async () => {
  await seedTenant(suite.db);
  const [place] = await suite.db
    .insert(locations)
    .values({
      name: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "04:00",
      invoiceLocales: ["es"],
      operationDescription: "Restaurant",
    })
    .returning();
  locationId = place!.id;
  nodeId = await seedNode(suite.db, brandLocationId(locationId));
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "Collector", pinHash: "scrypt$00$00" })
    .returning();
  personId = person!.id;
  orderId = newId();
  await suite.db
    .insert(workingOrders)
    .values({ id: orderId, source: "dashboard", locationId, nodeId, orderNumber: 1 });
});
async function request() {
  return run((tx) =>
    beginIntegratedAttendance(
      tx,
      recordAttendanceFact,
      { id: orderId, provider: "fake", personId },
      () => requestAt,
    ),
  );
}
async function payment(
  ref: string,
  state: "attempting" | "captured" | "accepted_offline" | "failed" | "declined",
  provider = "fake",
) {
  const [row] = await suite.db
    .insert(payments)
    .values({
      workingOrderId: orderId,
      provider,
      paymentRef: ref,
      source: "operator_script",
      amount: 100,
      state,
      settledAt: ["captured", "accepted_offline"].includes(state) ? later.toISOString() : null,
    })
    .returning();
  return row!.id;
}
async function discover(at = later) {
  for (let i = 0; i < 100; i++) {
    const result = await run((tx) =>
      discoverAttendanceDays(tx, { locationId, now: at, batchSize: 100 }),
    );
    if (!result.more) {
      await run((tx) => discoverAttendanceDays(tx, { locationId, now: at, batchSize: 100 }));
      return;
    }
  }
  throw new Error("scan did not finish");
}
it.each(["captured", "accepted_offline"] as const)(
  "qualifies a late %s under the original request without recovery",
  async (state) => {
    const key = await request();
    await payment("new-payment", state);
    await run((tx) => beginAttendanceDiscovery(tx, { locationId, generation: "open-one" }));
    const [day] = await suite.db.select().from(attendanceDayWork);
    await suite.db
      .update(attendanceDayWork)
      .set({ evaluatedRevision: day!.dirtyRevision })
      .where(eq(attendanceDayWork.id, day!.id));
    await discover();
    const [fact] = await suite.db.select().from(attendanceOperationFacts);
    expect(fact).toMatchObject({
      key,
      personId,
      locationId,
      at: "2026-01-05T11:00:00.000Z",
      outcome: "qualifying",
    });
    const [work] = await suite.db.select().from(attendanceDayWork);
    expect(work!.dirtyRevision).toBeGreaterThan(work!.evaluatedRevision);
    const before = await suite.db.select().from(attendanceOperationFacts);
    await discover();
    expect(await suite.db.select().from(attendanceOperationFacts)).toEqual(before);
  },
);
it("does not adopt an older same-order charge or another provider's charge", async () => {
  await payment("old-payment", "captured");
  await request();
  await payment("other-provider", "captured", "another");
  await discover();
  expect((await suite.db.select().from(attendanceOperationFacts))[0]!.outcome).toBe("pending");
  await payment("new-payment", "captured");
  await discover(new Date(later.getTime() + 30_000));
  expect((await suite.db.select().from(attendanceOperationFacts))[0]!.outcome).toBe("qualifying");
});
it("keeps two new candidate charges ambiguous rather than choosing a worker fact", async () => {
  await request();
  await payment("candidate-one", "captured");
  await payment("candidate-two", "captured");
  await discover();
  expect((await suite.db.select().from(attendanceOperationFacts))[0]!.outcome).toBe("pending");
});
it("remembers the exact attempted payment across restart and later capture", async () => {
  await request();
  const id = await payment("attempt", "attempting");
  await discover();
  await payment("another-new-charge", "captured");
  await suite.db
    .update(payments)
    .set({ state: "captured", settledAt: later.toISOString() })
    .where(eq(payments.id, id));
  await run((tx) => beginAttendanceDiscovery(tx, { locationId, generation: "open-two" }));
  await discover(new Date(later.getTime() + 30_000));
  expect((await suite.db.select().from(attendanceOperationFacts))[0]!).toMatchObject({
    outcome: "qualifying",
    at: "2026-01-05T11:00:00.000Z",
  });
});
it.each(["failed", "declined"] as const)(
  "refuses a definitively %s payment without qualifying the request",
  async (state) => {
    await request();
    await payment("refused", state);
    await discover();
    expect((await suite.db.select().from(attendanceOperationFacts))[0]!.outcome).toBe("refused");
    const watches = await suite.db
      .select()
      .from(attendanceSourceState)
      .where(eq(attendanceSourceState.source, "whole-payment"));
    expect(watches).toHaveLength(1);
    expect(watches[0]!.nextDueAt).toBeNull();
  },
);
it("a new request cannot qualify its abandoned predecessor", async () => {
  const first = await request();
  const old = await payment("old-attempt", "attempting");
  const second = await request();
  await suite.db
    .update(payments)
    .set({ state: "captured", settledAt: later.toISOString() })
    .where(eq(payments.id, old));
  await discover();
  expect(
    (await suite.db.select().from(attendanceOperationFacts)).map((f) => [f.key, f.outcome]),
  ).toEqual([
    [first, "refused"],
    [second, "pending"],
  ]);
});
