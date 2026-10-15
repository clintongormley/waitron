import { beforeEach, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { CORE_MIGRATIONS, type Transaction, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { deviceOrigin, jobOrigin, locationId as brandLocationId } from "@waitron/shared";
import { seedLocation, seedEmployment } from "../test/fixtures.js";
import { WorkforceBackend } from "./clocking.js";
import * as corrections from "./corrections.js";
import type { CorrectionRequestInput } from "./corrections.js";
import { readChain } from "./chain.js";
import { verifyChain } from "./chain-hash.js";
import { workforceChains } from "./schema/workforce-chains.js";
import { timeEntries } from "./schema/time-entries.js";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
const backend = new WorkforceBackend();
const origin = jobOrigin("dashboard");
let personId: string, manager: string, locationId: string, nodeId: string;
const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);
beforeEach(async () => {
  await seedTenant(suite.db);
  locationId = await seedLocation(suite.db);
  nodeId = await seedNode(suite.db, brandLocationId(locationId));
  const rows = await suite.db
    .insert(persons)
    .values([
      { displayName: "Worker", pinHash: "scrypt$00$00", role: "staff" },
      { displayName: "Manager", pinHash: "scrypt$00$00", role: "manager" },
    ])
    .returning({ id: persons.id });
  [personId, manager] = rows.map((r) => r.id) as [string, string];
  await seedEmployment(suite.db, { personId });
});
function pair(
  kinds: readonly ["in" | "break_start", "out" | "break_end"] = ["in", "out"],
  actorPersonId = personId,
): Extract<CorrectionRequestInput, { personId: string }>[] {
  return kinds.map((missingEntryKind, i) => ({
    nodeId,
    personId,
    locationId,
    missingEntryKind,
    actorPersonId,
    origin,
    at: `2026-01-05T${i === 0 ? "09" : "10"}:00:00Z`,
    offsetMinutes: 0,
    reason: "Forgot both times",
  }));
}
async function clock(kind: "clockIn" | "clockOut" | "breakStart" | "breakEnd", at: string) {
  return run((tx) =>
    backend[kind](tx, { nodeId, personId, locationId, at, offsetMinutes: 0, origin }),
  );
}
async function record() {
  return run((tx) =>
    backend.timeRecord(tx, { personId, period: { start: "2026-01-01", end: "2026-02-01" } }),
  );
}
async function intact() {
  expect(verifyChain(await readChain(suite.db, { nodeId, locationId }))).toEqual({ ok: true });
}

it("requests and approves a historical missing shift before later real events as one valid sequence", async () => {
  await clock("clockIn", "2026-01-06T09:00:00Z");
  await clock("clockOut", "2026-01-06T17:00:00Z");
  expect(corrections).toHaveProperty("requestCorrectionGroup", expect.any(Function));
  const ids = await run((tx) => corrections.requestCorrectionGroup(tx, pair(), "request"));
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
  expect((await record()).sessions.map((s) => s.workedMinutes)).toEqual([480]);
  expect(corrections).toHaveProperty("decideCorrectionGroup", expect.any(Function));
  const answers = await run((tx) =>
    corrections.decideCorrectionGroup(
      tx,
      {
        nodeId,
        correctionIds: ids,
        actorPersonId: manager,
        origin,
      },
      "approve",
    ),
  );
  expect(answers).toHaveLength(2);
  expect((await record()).sessions.map((s) => s.workedMinutes)).toEqual([60, 480]);
  const rows = await suite.db.select().from(timeEntries).orderBy(timeEntries.sequenceNo);
  expect(
    rows
      .slice(-2)
      .map((r) => [
        r.respondsToEntryId,
        r.correctionStatus,
        r.recordedByPersonId,
        r.capturedBySource,
        r.correctionDirection,
      ]),
  ).toEqual(ids.map((id) => [id, "approved", manager, "dashboard", "worker_request"]));
  await intact();
});

it("requests and approves a historical missing break before later breaks as one valid sequence", async () => {
  await clock("clockIn", "2026-01-05T08:00:00Z");
  await clock("breakStart", "2026-01-05T12:00:00Z");
  await clock("breakEnd", "2026-01-05T12:30:00Z");
  await clock("clockOut", "2026-01-05T17:00:00Z");
  expect(corrections).toHaveProperty("requestCorrectionGroup", expect.any(Function));
  const ids = await run((tx) =>
    corrections.requestCorrectionGroup(tx, pair(["break_start", "break_end"]), "request"),
  );
  expect((await record()).sessions.map((s) => s.workedMinutes)).toEqual([510]);
  await run((tx) =>
    corrections.decideCorrectionGroup(
      tx,
      { nodeId, correctionIds: ids, actorPersonId: manager, origin },
      "approve",
    ),
  );
  expect((await record()).sessions.map((s) => s.workedMinutes)).toEqual([450]);
  await intact();
});

it("proposes a historical manager pair and applies it only after the worker accepts", async () => {
  await clock("clockIn", "2026-01-06T09:00:00Z");
  await clock("clockOut", "2026-01-06T17:00:00Z");
  expect(corrections).toHaveProperty("requestCorrectionGroup", expect.any(Function));
  const ids = await run((tx) =>
    corrections.requestCorrectionGroup(tx, pair(["in", "out"], manager), "propose"),
  );
  expect((await record()).sessions.map((s) => s.workedMinutes)).toEqual([480]);
  await run((tx) =>
    corrections.decideCorrectionGroup(
      tx,
      { nodeId, correctionIds: ids, actorPersonId: personId, origin },
      "accept",
    ),
  );
  expect((await record()).sessions.map((s) => s.workedMinutes)).toEqual([60, 480]);
  const rows = await suite.db.select().from(timeEntries).orderBy(timeEntries.sequenceNo);
  expect(
    rows
      .slice(-2)
      .map((r) => [r.respondsToEntryId, r.authorKind, r.recordedByPersonId, r.correctionDirection]),
  ).toEqual(ids.map((id) => [id, "worker", personId, "manager_proposal"]));
  await intact();
});

async function snapshot() {
  return {
    entries: await suite.db.select().from(timeEntries).orderBy(timeEntries.id),
    heads: await suite.db
      .select()
      .from(workforceChains)
      .orderBy(workforceChains.nodeId, workforceChains.locationId),
  };
}
async function refused(action: () => Promise<unknown>, code = "correction.invalid") {
  const before = await snapshot();
  await expect(action()).rejects.toMatchObject({ code });
  expect(await snapshot()).toEqual(before);
  await intact();
}

it.each([
  "empty",
  "three",
  "reverse",
  "different-node",
  "different-actor",
  "different-person",
  "different-location",
  "different-origin",
  "duplicate-kind",
  "equal-times",
] as const)("refuses %s request bundles without changing rows or heads", async (shape) => {
  const inputs = pair();
  if (shape === "empty") inputs.length = 0;
  if (shape === "three") inputs.push({ ...inputs[1]! });
  if (shape === "reverse") inputs.reverse();
  if (shape === "different-node")
    inputs[1]!.nodeId = await seedNode(suite.db, brandLocationId(locationId));
  if (shape === "different-actor") {
    await suite.db.update(persons).set({ role: "manager" }).where(eq(persons.id, personId));
    inputs[1]!.actorPersonId = manager;
    inputs[1]!.personId = manager;
    inputs[0]!.personId = manager;
  }
  if (shape === "different-person") {
    inputs[0]!.actorPersonId = manager;
    inputs[1]!.actorPersonId = manager;
    inputs[1]!.personId = manager;
  }
  if (shape === "different-location") inputs[1]!.locationId = await seedLocation(suite.db);
  if (shape === "different-origin") inputs[1]!.origin = jobOrigin("operator_script");
  if (shape === "duplicate-kind") inputs[1]!.missingEntryKind = "in";
  if (shape === "equal-times") inputs[1]!.at = inputs[0]!.at;
  await refused(() => run((tx) => corrections.requestCorrectionGroup(tx, inputs, "request")));
});

it.each(["empty", "duplicate", "reverse", "unrelated"] as const)(
  "refuses %s decline bundles before appending a response",
  async (shape) => {
    const ids = await run((tx) => corrections.requestCorrectionGroup(tx, pair(), "request"));
    if (shape === "empty") ids.length = 0;
    if (shape === "duplicate") ids[1] = ids[0]!;
    if (shape === "reverse") ids.reverse();
    if (shape === "unrelated") {
      const later = pair().map((p) => ({ ...p, at: p.at.replace("01-05", "01-07") }));
      const more = await run((tx) => corrections.requestCorrectionGroup(tx, later, "request"));
      ids[1] = more[0]!;
    }
    await refused(() =>
      run((tx) =>
        corrections.decideCorrectionGroup(
          tx,
          { nodeId, correctionIds: ids, actorPersonId: manager, origin },
          "decline",
        ),
      ),
    );
  },
);

it("retains a singleton missing end request even before its missing start is supplied", async () => {
  const ids = await run((tx) => corrections.requestCorrectionGroup(tx, [pair()[1]!], "request"));
  expect(ids).toHaveLength(1);
  await refused(() =>
    run((tx) =>
      corrections.decideCorrectionGroup(
        tx,
        { nodeId, correctionIds: ids, actorPersonId: manager, origin },
        "approve",
      ),
    ),
  );
  const answers = await run((tx) =>
    corrections.decideCorrectionGroup(
      tx,
      { nodeId, correctionIds: ids, actorPersonId: manager, origin },
      "decline",
    ),
  );
  expect(answers).toHaveLength(1);
  expect((await record()).sessions).toEqual([]);
  await intact();
});

it("records the selected till device on both request and decision rows", async () => {
  const { deviceId } = await seedDevice(suite.db, { locationId });
  const till = deviceOrigin(deviceId);
  const ids = await run((tx) =>
    corrections.requestCorrectionGroup(
      tx,
      pair().map((p) => ({ ...p, origin: till })),
      "request",
    ),
  );
  await run((tx) =>
    corrections.decideCorrectionGroup(
      tx,
      { nodeId, correctionIds: ids, actorPersonId: manager, origin: till },
      "approve",
    ),
  );
  const rows = await suite.db.select().from(timeEntries).orderBy(timeEntries.sequenceNo);
  expect(rows.map((r) => [r.capturedBySource, r.capturedByDeviceId, r.recordedByPersonId])).toEqual(
    [
      ["device", deviceId, personId],
      ["device", deviceId, personId],
      ["device", deviceId, manager],
      ["device", deviceId, manager],
    ],
  );
  await intact();
});

it("refuses an overlapping missing pair without an append", async () => {
  await clock("clockIn", "2026-01-05T08:00:00Z");
  await clock("clockOut", "2026-01-05T17:00:00Z");
  await refused(() => run((tx) => corrections.requestCorrectionGroup(tx, pair(), "request")));
});

it.each(["request", "approve"] as const)(
  "rolls back the first %s append and its head if the second append fails",
  async (phase) => {
    const ids =
      phase === "approve"
        ? await run((tx) => corrections.requestCorrectionGroup(tx, pair(), "request"))
        : [];
    const before = await snapshot();
    const pending = run(async (tx) => {
      await tx.execute(sql`create trigger reject_second_group_entry before insert on time_entries
      when new.missing_entry_kind = 'out'
      begin select raise(abort, 'group_second_append'); end`);
      if (phase === "request") return corrections.requestCorrectionGroup(tx, pair(), "request");
      return corrections.decideCorrectionGroup(
        tx,
        { nodeId, correctionIds: ids, actorPersonId: manager, origin },
        "approve",
      );
    });
    await expect(pending).rejects.toMatchObject({ message: "group_second_append", errcode: 1811 });
    expect(await snapshot()).toEqual(before);
    await intact();
  },
);

it("rechecks the whole effective sequence when actual work overtakes a pending pair", async () => {
  const ids = await run((tx) => corrections.requestCorrectionGroup(tx, pair(), "request"));
  await clock("clockIn", "2026-01-05T08:00:00Z");
  await clock("clockOut", "2026-01-05T17:00:00Z");
  await refused(() =>
    run((tx) =>
      corrections.decideCorrectionGroup(
        tx,
        { nodeId, correctionIds: ids, actorPersonId: manager, origin },
        "approve",
      ),
    ),
  );
  const answers = await run((tx) =>
    corrections.decideCorrectionGroup(
      tx,
      { nodeId, correctionIds: ids, actorPersonId: manager, origin },
      "decline",
    ),
  );
  expect(answers).toHaveLength(2);
  expect((await record()).sessions.map((s) => s.workedMinutes)).toEqual([540]);
  const rows = await suite.db.select().from(timeEntries).orderBy(timeEntries.sequenceNo);
  expect(rows.slice(-2).map((r) => [r.respondsToEntryId, r.correctionStatus])).toEqual(
    ids.map((id) => [id, "declined"]),
  );
  await intact();
});

it.each(["approve", "decline"] as const)(
  "refuses %s of a partially answered pair without appending the other response",
  async (action) => {
    const ids = await run((tx) => corrections.requestCorrectionGroup(tx, pair(), "request"));
    await run((tx) =>
      backend.declineCorrection(tx, {
        nodeId,
        correctionId: ids[1]!,
        actorPersonId: manager,
        origin,
      }),
    );
    await refused(
      () =>
        run((tx) =>
          corrections.decideCorrectionGroup(
            tx,
            { nodeId, correctionIds: ids, actorPersonId: manager, origin },
            action,
          ),
        ),
      "correction.not_pending",
    );
  },
);

it.each(["staff", "supervisor", "manager"] as const)(
  "refuses current %s self-approval of the entire bundle",
  async (role) => {
    await suite.db.update(persons).set({ role: "admin" }).where(eq(persons.id, personId));
    const ids = await run((tx) => corrections.requestCorrectionGroup(tx, pair(), "request"));
    await suite.db.update(persons).set({ role }).where(eq(persons.id, personId));
    await refused(
      () =>
        run((tx) =>
          corrections.decideCorrectionGroup(
            tx,
            { nodeId, correctionIds: ids, actorPersonId: personId, origin },
            "approve",
          ),
        ),
      "correction.not_permitted",
    );
  },
);

it("stores current-admin self-approval on both hashed responses", async () => {
  await suite.db.update(persons).set({ role: "admin" }).where(eq(persons.id, personId));
  const ids = await run((tx) => corrections.requestCorrectionGroup(tx, pair(), "request"));
  await run((tx) =>
    corrections.decideCorrectionGroup(
      tx,
      { nodeId, correctionIds: ids, actorPersonId: personId, origin },
      "approve",
    ),
  );
  const rows = await suite.db.select().from(timeEntries).orderBy(timeEntries.sequenceNo);
  expect(
    rows
      .slice(-2)
      .map((r) => [r.respondsToEntryId, r.selfApproved, r.authorKind, r.recordedByPersonId]),
  ).toEqual(ids.map((id) => [id, true, "manager", personId]));
  expect((await record()).sessions.map((s) => s.workedMinutes)).toEqual([60]);
  await suite.db.update(persons).set({ role: "staff" }).where(eq(persons.id, personId));
  expect(
    (await record()).entries.filter((e) => e.selfApproved).map((e) => e.entry.entryId),
  ).toEqual(rows.slice(-2).map((r) => r.id));
  await intact();
});

it("records a worker's disagreement on both manager proposals and leaves actual hours unchanged", async () => {
  await clock("clockIn", "2026-01-06T09:00:00Z");
  await clock("clockOut", "2026-01-06T17:00:00Z");
  const ids = await run((tx) =>
    corrections.requestCorrectionGroup(tx, pair(["in", "out"], manager), "propose"),
  );
  await refused(() =>
    run((tx) =>
      corrections.decideCorrectionGroup(
        tx,
        { nodeId, correctionIds: ids, actorPersonId: personId, origin, reason: "  " },
        "disagree",
      ),
    ),
  );
  await run((tx) =>
    corrections.decideCorrectionGroup(
      tx,
      {
        nodeId,
        correctionIds: ids,
        actorPersonId: personId,
        origin,
        reason: " I did not work those hours ",
      },
      "disagree",
    ),
  );
  expect((await record()).sessions.map((s) => s.workedMinutes)).toEqual([480]);
  const rows = await suite.db.select().from(timeEntries).orderBy(timeEntries.sequenceNo);
  expect(
    rows
      .slice(-2)
      .map((r) => [
        r.respondsToEntryId,
        r.correctionStatus,
        r.correctionReason,
        r.recordedByPersonId,
      ]),
  ).toEqual(ids.map((id) => [id, "disputed", "I did not work those hours", personId]));
  await intact();
});

it("answers an earlier node's pair on a new node without changing its chain", async () => {
  const ids = await run((tx) => corrections.requestCorrectionGroup(tx, pair(), "request"));
  const oldChain = await readChain(suite.db, { nodeId, locationId });
  const nextNode = await seedNode(suite.db, brandLocationId(locationId));
  await run((tx) =>
    corrections.decideCorrectionGroup(
      tx,
      { nodeId: nextNode, correctionIds: ids, actorPersonId: manager, origin },
      "approve",
    ),
  );
  expect(await readChain(suite.db, { nodeId, locationId })).toEqual(oldChain);
  expect(verifyChain(await readChain(suite.db, { nodeId: nextNode, locationId }))).toEqual({
    ok: true,
  });
  expect((await record()).sessions.map((s) => s.workedMinutes)).toEqual([60]);
  await refused(
    () =>
      run((tx) =>
        corrections.decideCorrectionGroup(
          tx,
          { nodeId, correctionIds: ids, actorPersonId: manager, origin },
          "decline",
        ),
      ),
    "correction.not_pending",
  );
  await intact();
});

it("refuses two different managers' same-direction proposal rows as one bundle", async () => {
  const [other] = await suite.db
    .insert(persons)
    .values({ displayName: "Other manager", pinHash: "scrypt$00$00", role: "manager" })
    .returning({ id: persons.id });
  const inputs = pair(["in", "out"], manager);
  inputs[1]!.actorPersonId = other!.id;
  await refused(() => run((tx) => corrections.requestCorrectionGroup(tx, inputs, "propose")));
});

it.each(["approve", "accept"] as const)(
  "refuses %s by the wrong party before appending either decision",
  async (action) => {
    const managerProposal = action === "accept";
    const ids = await run((tx) =>
      corrections.requestCorrectionGroup(
        tx,
        pair(["in", "out"], managerProposal ? manager : personId),
        managerProposal ? "propose" : "request",
      ),
    );
    await refused(
      () =>
        run((tx) =>
          corrections.decideCorrectionGroup(
            tx,
            {
              nodeId,
              correctionIds: ids,
              actorPersonId: managerProposal ? manager : personId,
              origin,
            },
            action,
          ),
        ),
      "correction.not_permitted",
    );
  },
);
