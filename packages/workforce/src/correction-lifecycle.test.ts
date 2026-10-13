import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { CORE_MIGRATIONS, type Transaction, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { jobOrigin, locationId as brandLocationId } from "@waitron/shared";
import { seedLocation, seedEmployment } from "../test/fixtures.js";
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
let personId: string, manager: string, other: string, locationId: string, nodeId: string;
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
      { displayName: "Other worker", pinHash: "scrypt$00$00", role: "staff" },
    ])
    .returning({ id: persons.id });
  [personId, manager, other] = rows.map((r) => r.id) as [string, string, string];
  await seedEmployment(suite.db, { personId });
});
const event = (at: string) => ({ nodeId, personId, locationId, at, offsetMinutes: 0, origin });
async function day(end = true) {
  await run((tx) => backend.clockIn(tx, event("2026-01-05T09:00:00Z")));
  if (end) await run((tx) => backend.clockOut(tx, event("2026-01-05T17:00:00Z")));
  return (await suite.db.select().from(timeEntries).orderBy(timeEntries.sequenceNo)).at(-1)!.id;
}
const targeted = (correctsEntryId: string, actorPersonId = personId) => ({
  nodeId,
  correctsEntryId,
  actorPersonId,
  origin,
  at: "2026-01-05T18:00:00Z",
  offsetMinutes: 0,
  reason: " Finished later ",
});
const missing = (missingEntryKind: "in" | "out" = "out", at = "2026-01-05T18:00:00Z") => ({
  nodeId,
  personId,
  locationId,
  missingEntryKind,
  at,
  offsetMinutes: 0,
  reason: "Forgot to record it",
  actorPersonId: personId,
  origin,
});
const decision = (correctionId: string, actorPersonId = personId) => ({
  nodeId,
  correctionId,
  actorPersonId,
  origin,
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
async function intact() {
  expect(verifyChain(await readChain(suite.db, { nodeId, locationId }))).toEqual({ ok: true });
}
async function unchangedRefusal(action: () => Promise<unknown>, code: string) {
  const before = await suite.db.select().from(timeEntries);
  await expect(action()).rejects.toMatchObject({ code });
  expect(await suite.db.select().from(timeEntries)).toEqual(before);
  await intact();
}

describe("two-party correction decisions", () => {
  it("does not let staff request a change for someone else", async () => {
    const target = await day();
    await unchangedRefusal(
      () => run((tx) => backend.requestCorrection(tx, targeted(target, other))),
      "correction.not_permitted",
    );
  });
  it("does not let a requested or ordinary entry be answered as a pending proposal", async () => {
    const target = await day();
    const request = await run((tx) => backend.requestCorrection(tx, targeted(target)));
    await unchangedRefusal(
      () => run((tx) => backend.requestCorrection(tx, targeted(request))),
      "correction.invalid",
    );
    await unchangedRefusal(
      () =>
        run((tx) =>
          backend.approveCorrection(tx, {
            nodeId,
            correctionId: target,
            approverPersonId: manager,
          }),
        ),
      "correction.not_pending",
    );
    await run((tx) =>
      backend.approveCorrection(tx, { nodeId, correctionId: request, approverPersonId: manager }),
    );
    await unchangedRefusal(
      () => run((tx) => backend.requestCorrection(tx, targeted(target))),
      "correction.not_pending",
    );
  });
  it.each(["break_start", "break_end", "in"] as const)(
    "refuses an inserted %s that conflicts with captured breaks",
    async (missingEntryKind) => {
      await day(false);
      await run((tx) => backend.breakStart(tx, event("2026-01-05T12:00:00Z")));
      await run((tx) => backend.breakEnd(tx, event("2026-01-05T12:30:00Z")));
      await run((tx) => backend.clockOut(tx, event("2026-01-05T17:00:00Z")));
      const at = missingEntryKind === "break_end" ? "2026-01-05T11:00:00Z" : "2026-01-05T12:10:00Z";
      await unchangedRefusal(
        () => run((tx) => backend.requestCorrection(tx, { ...missing(), missingEntryKind, at })),
        "correction.invalid",
      );
    },
  );
  it("records supplied break events and nets their thirty minutes after both approvals", async () => {
    await day();
    const start = await run((tx) =>
      backend.requestCorrection(tx, {
        ...missing(),
        missingEntryKind: "break_start",
        at: "2026-01-05T12:00:00Z",
      }),
    );
    const end = await run((tx) =>
      backend.requestCorrection(tx, {
        ...missing(),
        missingEntryKind: "break_end",
        at: "2026-01-05T12:30:00Z",
      }),
    );
    await run((tx) =>
      backend.approveCorrection(tx, { nodeId, correctionId: start, approverPersonId: manager }),
    );
    await run((tx) =>
      backend.approveCorrection(tx, { nodeId, correctionId: end, approverPersonId: manager }),
    );
    expect(await minutes()).toBe(450);
    await intact();
  });
  it.each(["person", "location", "actor"])(
    "refuses an unknown %s using the existing existence helper",
    async (missingField) => {
      const id = "00000000-0000-4000-8000-000000000088";
      const patch =
        missingField === "person"
          ? { personId: id }
          : missingField === "location"
            ? { locationId: id }
            : { actorPersonId: id };
      await unchangedRefusal(
        () =>
          run((tx) =>
            backend.requestCorrection(tx, { ...missing("in", "2026-01-05T09:00:00Z"), ...patch }),
          ),
        "management.request_invalid",
      );
    },
  );
  it("refuses a timestamp whose UTC year escapes the stored four-digit shape", async () => {
    const target = await day();
    await unchangedRefusal(
      () =>
        run((tx) =>
          backend.requestCorrection(tx, { ...targeted(target), at: "9999-12-31T23:30:00-01:00" }),
        ),
      "correction.invalid",
    );
  });
  it("adds a missing end only after manager approval, preserving the original start and chain", async () => {
    const start = await day(false);
    const original = await suite.db.select().from(timeEntries);
    const request = await run((tx) => backend.requestCorrection(tx, missing()));
    expect(await minutes()).toBe(0);
    const approved = await run((tx) =>
      backend.approveCorrection(tx, { nodeId, correctionId: request, approverPersonId: manager }),
    );
    expect(await minutes()).toBe(540);
    const rows = await suite.db.select().from(timeEntries).orderBy(timeEntries.sequenceNo);
    expect(rows[0]).toEqual(original[0]);
    expect(rows[0]!.id).toBe(start);
    expect(rows[1]).toMatchObject({
      id: request,
      authorKind: "worker",
      recordedByPersonId: personId,
      correctionDirection: "worker_request",
      missingEntryKind: "out",
      correctsEntryId: null,
      correctionStatus: "requested",
      correctionReason: "Forgot to record it",
    });
    expect(rows[2]).toMatchObject({
      id: approved,
      authorKind: "manager",
      recordedByPersonId: manager,
      respondsToEntryId: request,
      missingEntryKind: "out",
      correctionStatus: "approved",
    });
    await intact();
  });
  it("counts a manager proposal only after the subject accepts, with the two actors stored", async () => {
    const target = await day();
    const original = await suite.db.select().from(timeEntries).where(eq(timeEntries.id, target));
    const proposal = await run((tx) => backend.proposeCorrection(tx, targeted(target, manager)));
    expect(await minutes()).toBe(480);
    await unchangedRefusal(
      () =>
        run((tx) =>
          backend.approveCorrection(tx, {
            nodeId,
            correctionId: proposal,
            approverPersonId: manager,
          }),
        ),
      "correction.not_permitted",
    );
    const accepted = await run((tx) => backend.acceptCorrection(tx, decision(proposal)));
    expect(await minutes()).toBe(540);
    expect(await suite.db.select().from(timeEntries).where(eq(timeEntries.id, target))).toEqual(
      original,
    );
    const rows = await suite.db
      .select()
      .from(timeEntries)
      .where(sql`${timeEntries.id} in (${proposal}, ${accepted})`)
      .orderBy(timeEntries.sequenceNo);
    expect(rows[0]).toMatchObject({
      correctionDirection: "manager_proposal",
      authorKind: "manager",
      recordedByPersonId: manager,
      correctionReason: "Finished later",
    });
    expect(rows[1]).toMatchObject({
      correctsEntryId: target,
      respondsToEntryId: proposal,
      correctionStatus: "approved",
      authorKind: "worker",
      recordedByPersonId: personId,
    });
    await intact();
  });
  it("keeps a supervisor request pending as a manager proposal", async () => {
    const target = await day();
    const proposal = await run((tx) => backend.requestCorrection(tx, targeted(target, manager)));
    expect(
      (await suite.db.select().from(timeEntries).where(eq(timeEntries.id, proposal)))[0],
    ).toMatchObject({ correctionStatus: "requested", correctionDirection: "manager_proposal" });
    expect(await minutes()).toBe(480);
    await run((tx) => backend.acceptCorrection(tx, decision(proposal)));
    expect(await minutes()).toBe(540);
  });
  it.each(["disagree", "decline"] as const)(
    "records %s without changing time and refuses another answer",
    async (kind) => {
      const target = await day();
      const request = await run((tx) =>
        kind === "disagree"
          ? backend.proposeCorrection(tx, targeted(target, manager))
          : backend.requestCorrection(tx, targeted(target)),
      );
      const answer = await run((tx) =>
        kind === "disagree"
          ? backend.disagreeCorrection(tx, { ...decision(request), reason: "I left at five" })
          : backend.declineCorrection(tx, decision(request, manager)),
      );
      expect(await minutes()).toBe(480);
      expect(
        (await suite.db.select().from(timeEntries).where(eq(timeEntries.id, answer)))[0],
      ).toMatchObject({
        respondsToEntryId: request,
        correctionStatus: kind === "disagree" ? "disputed" : "declined",
        correctsEntryId: target,
      });
      await unchangedRefusal(
        () =>
          run((tx) =>
            kind === "disagree"
              ? backend.acceptCorrection(tx, decision(request))
              : backend.approveCorrection(tx, {
                  nodeId,
                  correctionId: request,
                  approverPersonId: manager,
                }),
          ),
        "correction.not_pending",
      );
    },
  );
  it.each(["accept", "disagree"] as const)("refuses another worker's %s", async (kind) => {
    const target = await day();
    const request = await run((tx) => backend.proposeCorrection(tx, targeted(target, manager)));
    await unchangedRefusal(
      () =>
        run((tx) =>
          kind === "accept"
            ? backend.acceptCorrection(tx, decision(request, other))
            : backend.disagreeCorrection(tx, {
                ...decision(request, other),
                reason: "wrong person",
              }),
        ),
      "correction.not_permitted",
    );
  });
  it.each(["propose", "approve", "decline"] as const)(
    "refuses staff trying to %s",
    async (kind) => {
      const target = await day();
      const request = await run((tx) => backend.requestCorrection(tx, targeted(target)));
      await unchangedRefusal(
        () =>
          run((tx) =>
            kind === "propose"
              ? backend.proposeCorrection(tx, targeted(target, other))
              : kind === "approve"
                ? backend.approveCorrection(tx, {
                    nodeId,
                    correctionId: request,
                    approverPersonId: other,
                  })
                : backend.declineCorrection(tx, decision(request, other)),
          ),
        "correction.not_permitted",
      );
    },
  );
  it("does not let a requester approve themselves after promotion", async () => {
    const target = await day();
    const correctionId = await run((tx) => backend.requestCorrection(tx, targeted(target)));
    await suite.db.update(persons).set({ role: "manager" }).where(eq(persons.id, personId));
    await unchangedRefusal(
      () =>
        run((tx) =>
          backend.approveCorrection(tx, { nodeId, correctionId, approverPersonId: personId }),
        ),
      "correction.not_permitted",
    );
  });
  it("does not let a manager propose and accept their own change", async () => {
    const target = await day();
    await suite.db.update(persons).set({ role: "manager" }).where(eq(persons.id, personId));
    await unchangedRefusal(
      () => run((tx) => backend.proposeCorrection(tx, targeted(target))),
      "correction.not_permitted",
    );
  });
  it("reserves an effective target on settlement, allowing a further correction of the approval", async () => {
    const target = await day();
    const one = await run((tx) => backend.requestCorrection(tx, targeted(target)));
    const two = await run((tx) =>
      backend.requestCorrection(tx, { ...targeted(target), at: "2026-01-05T19:00:00Z" }),
    );
    const approval = await run((tx) =>
      backend.approveCorrection(tx, { nodeId, correctionId: one, approverPersonId: manager }),
    );
    await unchangedRefusal(
      () =>
        run((tx) =>
          backend.approveCorrection(tx, { nodeId, correctionId: two, approverPersonId: manager }),
        ),
      "correction.not_pending",
    );
    const next = await run((tx) =>
      backend.requestCorrection(tx, { ...targeted(approval), at: "2026-01-05T19:00:00Z" }),
    );
    await run((tx) =>
      backend.approveCorrection(tx, { nodeId, correctionId: next, approverPersonId: manager }),
    );
    expect(await minutes()).toBe(600);
    await intact();
  });
  it.each([
    { reason: "  " },
    { at: "bad date" },
    { at: null },
    { at: "2026-02-31T18:00:00Z" },
    { offsetMinutes: 0.5 },
    { offsetMinutes: 841 },
  ])("refuses malformed request %j without an append", async (patch) => {
    const target = await day();
    await unchangedRefusal(
      () =>
        run((tx) =>
          backend.requestCorrection(tx, { ...targeted(target), ...patch } as Parameters<
            WorkforceBackend["requestCorrection"]
          >[1]),
        ),
      "correction.invalid",
    );
  });
  it.each([
    "before_start",
    "duplicate_end",
    "bad_kind",
    "mixed_target",
    "other_subject",
    "null_location",
  ])("refuses structural missing or retiming error %s", async (kind) => {
    const target = await day();
    const input =
      kind === "before_start"
        ? { ...targeted(target), at: "2026-01-05T08:00:00Z" }
        : kind === "duplicate_end"
          ? missing()
          : kind === "bad_kind"
            ? { ...missing(), missingEntryKind: "correction" }
            : kind === "mixed_target"
              ? { ...missing(), correctsEntryId: target }
              : kind === "other_subject"
                ? { ...targeted(target), personId: other }
                : { ...missing(), locationId: null };
    await unchangedRefusal(
      () =>
        run((tx) =>
          backend.requestCorrection(
            tx,
            input as Parameters<WorkforceBackend["requestCorrection"]>[1],
          ),
        ),
      "correction.invalid",
    );
  });
  it("allows a missing whole session to be approved in chronological order", async () => {
    const start = await run((tx) =>
      backend.requestCorrection(tx, missing("in", "2026-01-05T09:00:00Z")),
    );
    const end = await run((tx) => backend.requestCorrection(tx, missing()));
    await run((tx) =>
      backend.approveCorrection(tx, { nodeId, correctionId: start, approverPersonId: manager }),
    );
    expect(await minutes()).toBe(0);
    await run((tx) =>
      backend.approveCorrection(tx, { nodeId, correctionId: end, approverPersonId: manager }),
    );
    expect(await minutes()).toBe(540);
    await intact();
  });
  it.each(["approval", "acceptance"] as const)(
    "commits one of two concurrent %s calls",
    async (kind) => {
      const target = await day();
      const request = await run((tx) =>
        kind === "approval"
          ? backend.requestCorrection(tx, targeted(target))
          : backend.proposeCorrection(tx, targeted(target, manager)),
      );
      const action = () =>
        run((tx) =>
          kind === "approval"
            ? backend.approveCorrection(tx, {
                nodeId,
                correctionId: request,
                approverPersonId: manager,
              })
            : backend.acceptCorrection(tx, decision(request)),
        );
      const results = await Promise.allSettled([action(), action()]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find((r) => r.status === "rejected")).toMatchObject({
        reason: { code: "correction.not_pending" },
      });
      expect(await minutes()).toBe(540);
      await intact();
    },
  );
});
