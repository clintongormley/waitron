import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, type Transaction, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { deviceOrigin, jobOrigin, locationId as brandLocationId } from "@waitron/shared";
import { seedEmployment, seedLocation } from "../test/fixtures.js";
import { WorkforceBackend } from "./clocking.js";
import { readChain } from "./chain.js";
import { verifyChain } from "./chain-hash.js";
import { timeEntries } from "./schema/time-entries.js";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
const backend = new WorkforceBackend();
const origin = jobOrigin("dashboard");
let personId: string,
  other: string,
  manager: string,
  locationId: string,
  nodeId: string,
  openEntryId: string;
const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);
const event = (at: string) => ({ nodeId, personId, locationId, at, offsetMinutes: 0, origin });
const input = () => ({ ...event("2026-01-05T17:00:00Z"), openEntryId });
const confirm = (entryId: string, workerPersonId = personId) => ({
  nodeId,
  entryId,
  workerPersonId,
  origin,
});
beforeEach(async () => {
  await seedTenant(suite.db);
  locationId = await seedLocation(suite.db);
  nodeId = await seedNode(suite.db, brandLocationId(locationId));
  const rows = await suite.db
    .insert(persons)
    .values([
      { displayName: "Worker", pinHash: "scrypt$00$00", role: "staff" },
      { displayName: "Other", pinHash: "scrypt$00$00", role: "staff" },
      { displayName: "Manager", pinHash: "scrypt$00$00", role: "manager" },
    ])
    .returning({ id: persons.id });
  [personId, other, manager] = rows.map((r) => r.id) as [string, string, string];
  await seedEmployment(suite.db, { personId });
  await run((tx) => backend.clockIn(tx, event("2026-01-05T09:00:00Z")));
  openEntryId = (await suite.db.select().from(timeEntries))[0]!.id;
});
async function minutes() {
  return (
    await run((tx) =>
      backend.workSummary(
        tx,
        { personId, period: { start: "2026-01-05", end: "2026-01-12" } },
        { workingDaysPerWeek: 5, overtimeModel: "daily-accrual", dailyTargetMinutes: null },
      ),
    )
  ).workedMinutes;
}
async function unchanged(action: () => Promise<unknown>, code: string) {
  const before = await suite.db.select().from(timeEntries);
  await expect(action()).rejects.toMatchObject({ code });
  expect(await suite.db.select().from(timeEntries)).toEqual(before);
}
describe("automatic closes and worker confirmation", () => {
  it("accepts the last break event itself as later activity without inventing a later departure", async () => {
    await run((tx) => backend.breakStart(tx, event("2026-01-05T16:00:00Z")));
    const end = await run((tx) =>
      backend.recordAutomaticClose(tx, { ...input(), at: "2026-01-05T16:00:00Z" }),
    );
    await run((tx) => backend.confirmAutomaticEntry(tx, confirm(end)));
    expect(await minutes()).toBe(420);
    expect(
      (await suite.db.select().from(timeEntries).where(eq(timeEntries.id, end)))[0]!.eventAt,
    ).toBe("2026-01-05T16:00:00.000Z");
  });
  it("nets a trailing break through an agreed automatic-end correction", async () => {
    await run((tx) => backend.breakStart(tx, event("2026-01-05T16:00:00Z")));
    const end = await run((tx) => backend.recordAutomaticClose(tx, input()));
    const request = await run((tx) =>
      backend.requestCorrection(tx, {
        nodeId,
        correctsEntryId: end,
        at: "2026-01-05T18:00:00Z",
        offsetMinutes: 0,
        reason: "Left later, still on break",
        actorPersonId: personId,
        origin,
      }),
    );
    await run((tx) =>
      backend.approveCorrection(tx, { nodeId, correctionId: request, approverPersonId: manager }),
    );
    expect(await minutes()).toBe(420);
  });
  it("refuses an automatic end before an agreed corrected start", async () => {
    const request = await run((tx) =>
      backend.requestCorrection(tx, {
        nodeId,
        correctsEntryId: openEntryId,
        at: "2026-01-05T18:00:00Z",
        offsetMinutes: 0,
        reason: "Started later",
        actorPersonId: personId,
        origin,
      }),
    );
    await run((tx) =>
      backend.approveCorrection(tx, { nodeId, correctionId: request, approverPersonId: manager }),
    );
    await unchanged(
      () => run((tx) => backend.recordAutomaticClose(tx, input())),
      "attendance.invalid",
    );
  });
  it("refuses confirmation of an unknown entry", async () => {
    await unchanged(
      () =>
        run((tx) =>
          backend.confirmAutomaticEntry(tx, confirm("00000000-0000-4000-8000-000000000099")),
        ),
      "attendance.not_pending",
    );
  });
  it("closes live state but waits for the worker before counting time, preserving automatic authorship", async () => {
    const end = await run((tx) => backend.recordAutomaticClose(tx, input()));
    expect(await minutes()).toBe(0);
    const original = await suite.db.select().from(timeEntries).where(eq(timeEntries.id, end));
    expect(original[0]).toMatchObject({
      entryKind: "out",
      eventAt: "2026-01-05T17:00:00.000Z",
      authorKind: "automatic",
      recordedByPersonId: null,
    });
    await run((tx) => backend.clockIn(tx, event("2026-01-06T09:00:00Z")));
    const answer = await run((tx) => backend.confirmAutomaticEntry(tx, confirm(end)));
    expect(await minutes()).toBe(480);
    expect(await suite.db.select().from(timeEntries).where(eq(timeEntries.id, end))).toEqual(
      original,
    );
    expect(
      (await suite.db.select().from(timeEntries).where(eq(timeEntries.id, answer)))[0],
    ).toMatchObject({
      entryKind: "confirmation",
      respondsToEntryId: end,
      authorKind: "worker",
      recordedByPersonId: personId,
    });
    await unchanged(
      () => run((tx) => backend.clockIn(tx, event("2026-01-06T10:00:00Z"))),
      "attendance.already_open",
    );
    expect(verifyChain(await readChain(suite.db, { nodeId, locationId }))).toEqual({ ok: true });
  });
  it("closes a trailing break at the supplied end when it is confirmed", async () => {
    await run((tx) => backend.breakStart(tx, event("2026-01-05T16:00:00Z")));
    const end = await run((tx) => backend.recordAutomaticClose(tx, input()));
    expect(await minutes()).toBe(0);
    await run((tx) => backend.confirmAutomaticEntry(tx, confirm(end)));
    expect(await minutes()).toBe(420);
    expect((await suite.db.select().from(timeEntries)).map((r) => r.entryKind)).toEqual([
      "in",
      "break_start",
      "out",
      "confirmation",
    ]);
  });
  it.each(["approve", "accept"] as const)(
    "counts an agreed correction before closure on %s without reauthoring the automatic end",
    async (kind) => {
      const end = await run((tx) => backend.recordAutomaticClose(tx, input()));
      const request = {
        nodeId,
        correctsEntryId: end,
        at: "2026-01-05T18:00:00Z",
        offsetMinutes: 0,
        reason: "Actual departure",
        actorPersonId: kind === "approve" ? personId : manager,
        origin,
      };
      const id = await run((tx) =>
        kind === "approve"
          ? backend.requestCorrection(tx, request)
          : backend.proposeCorrection(tx, request),
      );
      expect(await minutes()).toBe(0);
      await run((tx) =>
        kind === "approve"
          ? backend.approveCorrection(tx, { nodeId, correctionId: id, approverPersonId: manager })
          : backend.acceptCorrection(tx, {
              nodeId,
              correctionId: id,
              actorPersonId: personId,
              origin,
            }),
      );
      expect(await minutes()).toBe(540);
      expect(
        (await suite.db.select().from(timeEntries).where(eq(timeEntries.id, end)))[0],
      ).toMatchObject({
        authorKind: "automatic",
        recordedByPersonId: null,
        eventAt: "2026-01-05T17:00:00.000Z",
      });
    },
  );
  it.each(["decline", "disagree"] as const)(
    "keeps an automatic end uncounted after %s",
    async (kind) => {
      const end = await run((tx) => backend.recordAutomaticClose(tx, input()));
      const request = {
        nodeId,
        correctsEntryId: end,
        at: "2026-01-05T18:00:00Z",
        offsetMinutes: 0,
        reason: "Actual departure",
        actorPersonId: kind === "decline" ? personId : manager,
        origin,
      };
      const id = await run((tx) => backend.requestCorrection(tx, request));
      await run((tx) =>
        kind === "decline"
          ? backend.declineCorrection(tx, {
              nodeId,
              correctionId: id,
              actorPersonId: manager,
              origin,
            })
          : backend.disagreeCorrection(tx, {
              nodeId,
              correctionId: id,
              actorPersonId: personId,
              origin,
              reason: "Not my time",
            }),
      );
      expect(await minutes()).toBe(0);
    },
  );
  it.each([
    "same_time",
    "same_second",
    "before",
    "invalid",
    "fractional",
    "wrong_person",
    "wrong_location",
    "wrong_origin",
  ])("refuses automatic close %s before an append", async (kind) => {
    const patch =
      kind === "same_time"
        ? { at: "2026-01-05T09:00:00Z" }
        : kind === "same_second"
          ? { at: "2026-01-05T09:00:00.999Z" }
          : kind === "before"
            ? { at: "2026-01-05T08:00:00Z" }
            : kind === "invalid"
              ? { at: null }
              : kind === "fractional"
                ? { offsetMinutes: 0.5 }
                : kind === "wrong_person"
                  ? { personId: other }
                  : kind === "wrong_location"
                    ? { locationId: await seedLocation(suite.db) }
                    : { origin: deviceOrigin("00000000-0000-4000-8000-000000000001") };
    await unchanged(
      () =>
        run((tx) =>
          backend.recordAutomaticClose(tx, { ...input(), ...patch } as Parameters<
            WorkforceBackend["recordAutomaticClose"]
          >[1]),
        ),
      kind.startsWith("wrong_") && kind !== "wrong_origin"
        ? "attendance.not_pending"
        : "attendance.invalid",
    );
  });
  it("refuses a closed or replaced open entry", async () => {
    await run((tx) => backend.clockOut(tx, event("2026-01-05T17:00:00Z")));
    await unchanged(
      () => run((tx) => backend.recordAutomaticClose(tx, input())),
      "attendance.not_pending",
    );
    await run((tx) => backend.clockIn(tx, event("2026-01-06T09:00:00Z")));
    await unchanged(
      () =>
        run((tx) => backend.recordAutomaticClose(tx, { ...input(), at: "2026-01-06T17:00:00Z" })),
      "attendance.not_pending",
    );
  });
  it("refuses another worker, a nonautomatic end and a second human confirmation", async () => {
    const end = await run((tx) => backend.recordAutomaticClose(tx, input()));
    await unchanged(
      () => run((tx) => backend.confirmAutomaticEntry(tx, confirm(end, other))),
      "attendance.not_permitted",
    );
    await unchanged(
      () => run((tx) => backend.confirmAutomaticEntry(tx, confirm(openEntryId))),
      "attendance.not_pending",
    );
    await run((tx) => backend.confirmAutomaticEntry(tx, confirm(end)));
    await unchanged(
      () => run((tx) => backend.confirmAutomaticEntry(tx, confirm(end))),
      "attendance.not_pending",
    );
  });
  it("commits exactly one of two concurrent confirmations and keeps the chain contiguous", async () => {
    const end = await run((tx) => backend.recordAutomaticClose(tx, input()));
    const action = () => run((tx) => backend.confirmAutomaticEntry(tx, confirm(end)));
    const results = await Promise.allSettled([action(), action()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "attendance.not_pending" },
    });
    expect(await minutes()).toBe(480);
    expect(verifyChain(await readChain(suite.db, { nodeId, locationId }))).toEqual({ ok: true });
  });
  it("records the actual ordinary recorder's role at append and retains it after role changes", async () => {
    await run((tx) =>
      backend.clockOut(tx, { ...event("2026-01-05T17:00:00Z"), recordedByPersonId: manager }),
    );
    await suite.db.update(persons).set({ role: "staff" }).where(eq(persons.id, manager));
    const rows = await suite.db.select().from(timeEntries).orderBy(timeEntries.sequenceNo);
    expect(rows[0]).toMatchObject({ authorKind: "worker", recordedByPersonId: personId });
    expect(rows[1]).toMatchObject({ authorKind: "manager", recordedByPersonId: manager });
    expect(verifyChain(await readChain(suite.db, { nodeId, locationId }))).toEqual({ ok: true });
  });
});
