import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { CORE_MIGRATIONS, locations, withTransaction, type Transaction } from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { jobOrigin, locationId as brandedLocationId } from "@waitron/shared";
import {
  WORKFORCE_MIGRATIONS,
  WorkforceBackend,
  attendanceMail,
  attendanceQuestions,
  attendanceDayWork,
  enqueueAttendanceDay,
  processAttendanceDay,
  rosterVersions,
  shifts,
  timeEntries,
  claimAttendanceMail,
  reportAttendanceMail,
  executeAttendanceCommand,
  readAttendanceInbox,
} from "@waitron/workforce";
import { recordAttendanceFact } from "./attendance-capture.js";
import { readAttendanceFacts, readPlannedAttendanceShifts } from "./attendance-facts.js";
import type { EmailDelivery } from "./email-delivery.js";
import type { AttendanceEmailSender } from "./attendance-email.js";
import { realSleep } from "./loop.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
const backend = new WorkforceBackend();
let locationId: string,
  nodeId: string,
  personId: string,
  primary: boolean,
  now: Date,
  controller: AbortController;
let send: ReturnType<typeof vi.fn<AttendanceEmailSender>>;
const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { resolve, promise };
};
const day = (date = "2026-01-05") => ({
  locationId,
  businessDay: date,
  startAt: `${date}T04:00:00.000Z`,
  endAt: `${date.slice(0, 8)}${String(Number(date.slice(8)) + 1).padStart(2, "0")}T04:00:00.000Z`,
});
const smtp = { url: "smtp://127.0.0.1:1025", from: "venue@example.test" };
const deps = () => ({
  db: suite.db,
  nodeId,
  locationId,
  holder: "node:attendance",
  now: () => now,
  isPrimary: () => primary,
  signal: controller.signal,
  venueLocale: "en" as "en" | "es",
  locationName: "Madrid",
  resolveDelivery: async (): Promise<EmailDelivery> => ({ mode: "smtp", smtp }),
  send,
});
const pass = async (overrides: Partial<ReturnType<typeof deps>> = {}) =>
  (await import("./attendance-email-worker.js")).runAttendanceEmailPass({
    ...deps(),
    ...overrides,
  });
const mail = () => suite.db.select().from(attendanceMail).orderBy(attendanceMail.nextAttemptAt);
const questions = () => suite.db.select().from(attendanceQuestions);
const event = (at: string) => ({
  nodeId,
  locationId,
  personId,
  at,
  offsetMinutes: 60,
  origin: jobOrigin("dashboard"),
});
async function process(date = "2026-01-05") {
  return run(async (tx) =>
    processAttendanceDay(tx, {
      day: day(date),
      nodeId,
      now,
      facts: await readAttendanceFacts(tx, day(date)),
      planned: await readPlannedAttendanceShifts(tx, day(date)),
    }),
  );
}
async function seedMissing(date = "2026-01-05", open = false) {
  await run(async (tx) => {
    await enqueueAttendanceDay(tx, day(date));
    if (open) await backend.clockIn(tx, event(`${date}T09:00:00Z`));
    else
      await recordAttendanceFact(tx, {
        source: "order",
        key: `order:${date}`,
        locationId,
        personId,
        kind: "order",
        at: `${date}T10:00:00Z`,
        offsetMinutes: 60,
        outcome: "qualified",
      });
  });
  await process(date);
}
async function seedRota() {
  const versionId = await run((tx) =>
    backend.createRosterVersion(tx, { locationId, period: "2026-01-05" }),
  );
  const shiftId = await run((tx) =>
    backend.addShift(tx, {
      locationId,
      personId,
      versionId,
      role: null,
      startsAt: "2026-01-05T09:00:00Z",
      endsAt: "2026-01-05T17:00:00Z",
      startsOffsetMinutes: 60,
      endsOffsetMinutes: 60,
    }),
  );
  await run((tx) => backend.publishRoster(tx, { versionId }));
  await run((tx) => enqueueAttendanceDay(tx, day()));
  await process();
  return { shiftId, versionId };
}
beforeEach(async () => {
  primary = true;
  now = new Date("2026-01-08T06:00:00Z");
  controller = new AbortController();
  send = vi.fn<AttendanceEmailSender>(async () => "sent");
  await seedTenant(suite.db);
  const [place] = await suite.db
    .insert(locations)
    .values({
      name: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
      invoiceLocales: ["es"],
      operationDescription: "Restaurant",
    })
    .returning();
  locationId = place!.id;
  nodeId = await seedNode(suite.db, brandedLocationId(locationId));
  const [person] = await suite.db
    .insert(persons)
    .values({
      displayName: "Worker",
      email: "worker@example.test",
      pendingEmail: "unverified@example.test",
      locale: "es-ES",
    })
    .returning();
  personId = person!.id;
  await import("./attendance-email-worker.js");
});

describe("missing-attendance delivery worker", () => {
  it.each(["pending", "sending", "sent", "unknown"] as const)(
    "reopens a declined submitted pair before a split-shift claim and preserves %s mail",
    async (status) => {
      const { versionId, shiftId } = await seedRota();
      await suite.db.insert(shifts).values({
        locationId,
        personId,
        rosterVersionId: versionId,
        startsAt: "2026-01-05T18:00:00.000Z",
        endsAt: "2026-01-05T22:00:00.000Z",
        startsOffsetMinutes: 60,
        endsOffsetMinutes: 60,
      });
      await process();
      const originalQuestions = (await questions()).sort(
        (a, b) =>
          Number(b.shiftKey === `rota:${shiftId}`) - Number(a.shiftKey === `rota:${shiftId}`),
      );
      expect(originalQuestions).toHaveLength(2);
      const [first] = originalQuestions;
      if (status !== "pending")
        await run(async (tx) => {
          const pending = (await mail()).find((m) => m.questionId === first!.id)!;
          const claim = await claimAttendanceMail(tx, {
            id: pending.id,
            holder: "previous-sender",
            recipient: "saved@example.test",
            now,
          });
          expect(claim).not.toBeNull();
          if (status !== "sending") await reportAttendanceMail(tx, claim!, status, now);
        });
      const [manager] = await suite.db
        .insert(persons)
        .values({ displayName: "Approver", role: "admin" })
        .returning();
      const result = await run(async (tx) =>
        executeAttendanceCommand(tx, {
          nodeId,
          requestedByPersonId: personId,
          authorizedByPersonId: personId,
          origin: jobOrigin("dashboard"),
          now,
          command: {
            commandId: randomUUID(),
            expectedRevision: (await readAttendanceInbox(tx, personId)).revision,
            action: "request",
            questionId: first!.id,
            locationId,
            reason: "Missing shift",
            changes: [
              { target: { missingKind: "in" }, at: "2026-01-05T09:00:00Z", offsetMinutes: 60 },
              { target: { missingKind: "out" }, at: "2026-01-05T17:00:00Z", offsetMinutes: 60 },
            ],
          },
        }),
      );
      expect(result.entryIds).toHaveLength(2);
      const submitted = (await questions()).find((q) => q.id === first!.id)!;
      expect(submitted.resolvedByEntryId).toBe(result.entryIds[0]);
      const cancelled = (await mail()).find((m) => m.questionId === first!.id)!;
      expect(cancelled.status).toBe(status === "pending" ? "cancelled" : status);
      await pass({
        resolveDelivery: async () => {
          await run(async (tx) => {
            for (const correctionId of result.entryIds)
              await backend.declineCorrection(tx, {
                nodeId,
                correctionId,
                actorPersonId: manager!.id,
                origin: jobOrigin("dashboard"),
              });
          });
          return { mode: "smtp", smtp };
        },
      });
      expect((await questions()).find((q) => q.id === first!.id)!.resolvedByEntryId).toBeNull();
      expect((await mail()).find((m) => m.questionId === first!.id)).toEqual(cancelled);
      const second = originalQuestions[1]!;
      expect((await questions()).find((q) => q.id === second.id)!.resolvedByEntryId).toBeNull();
      expect((await mail()).find((m) => m.questionId === second.id)).toMatchObject({
        status: "sent",
        recipient: "worker@example.test",
      });
      expect(send).toHaveBeenCalledTimes(1);
      await pass();
      expect(send).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    ["es-ES", "en", "es"],
    ["en-GB", "es", "en"],
  ] as const)(
    "uses the saved %s preference ahead of venue %s",
    async (locale, venueLocale, expected) => {
      await seedMissing();
      await suite.db.update(persons).set({ locale }).where(eq(persons.id, personId));
      await pass({ venueLocale });
      expect(send.mock.calls[0]![0].locale).toBe(expected);
    },
  );
  it("does not send if storage refuses to retain the claim", async () => {
    await seedMissing();
    const before = await mail();
    await suite.db
      .execute(sql`create trigger ignore_attendance_claim before update on attendance_mail
      when new.status = 'sending' begin select raise(ignore); end`);
    try {
      await pass();
    } finally {
      await suite.db.execute(sql`drop trigger ignore_attendance_claim`);
    }
    expect(send).not.toHaveBeenCalled();
    expect(await mail()).toEqual(before);
  });
  it.each(["non-primary", "stopped"])(
    "rechecks %s after configuration but inside the queued claim",
    async (reason) => {
      await seedMissing();
      const entered = gate(),
        held = gate(),
        queued = gate();
      const original = suite.db.withWriteLock.bind(suite.db);
      let holding: Promise<void> | undefined, spy: ReturnType<typeof vi.spyOn> | undefined;
      const before = await mail();
      const work = pass({
        resolveDelivery: async () => {
          holding = run(async () => {
            entered.resolve();
            await held.promise;
          });
          await entered.promise;
          spy = vi
            .spyOn(suite.db, "withWriteLock")
            .mockImplementation(async <T>(body: () => Promise<T>) => {
              queued.resolve();
              return original(body);
            });
          return { mode: "smtp", smtp };
        },
      });
      try {
        await queued.promise;
        if (reason === "non-primary") primary = false;
        else controller.abort();
      } finally {
        held.resolve();
      }
      try {
        await holding;
        await work;
      } finally {
        spy?.mockRestore();
      }
      expect(send).not.toHaveBeenCalled();
      expect(await mail()).toEqual(before);
    },
  );
  it("uses the current missing finish after a late rota clock-in", async () => {
    await seedRota();
    await pass({
      resolveDelivery: async () => {
        await run((tx) => backend.clockIn(tx, event("2026-01-05T09:00:00Z")));
        return { mode: "smtp", smtp };
      },
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].missingKinds).toEqual(["out"]);
    expect(await mail()).toHaveLength(2);
    expect((await mail()).filter((m) => m.status === "sent")).toHaveLength(1);
  });
  it("does not send before the current rota shift's extended end", async () => {
    now = new Date("2026-01-06T04:01:00Z");
    const { shiftId } = await seedRota();
    await pass({
      resolveDelivery: async () => {
        await suite.db
          .update(shifts)
          .set({ endsAt: "2026-01-06T05:00:00.000Z" })
          .where(eq(shifts.id, shiftId));
        return { mode: "smtp", smtp };
      },
    });
    expect(send).not.toHaveBeenCalled();
    expect((await mail())[0]).toMatchObject({ status: "pending", claimToken: null });
    now = new Date("2026-01-06T05:00:00Z");
    await pass();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("expires a crash-abandoned claim even when delivery is unconfigured", async () => {
    await seedMissing();
    const [pending] = await mail();
    const current = await run((tx) =>
      claimAttendanceMail(tx, {
        id: pending!.id,
        holder: "dead-process",
        recipient: "worker@example.test",
        now,
      }),
    );
    now = new Date(now.getTime() + 60_000);
    expect(await pass({ resolveDelivery: async () => ({ mode: "unconfigured" }) })).toEqual({
      processed: true,
    });
    expect(await mail()).toMatchObject([
      { status: "unknown", outcome: "unknown", claimToken: current!.token },
    ]);
    await pass();
    expect(send).not.toHaveBeenCalled();
    expect(await questions()).toHaveLength(1);
  });
  it("does not let a late rejection change an already expired unknown claim", async () => {
    await seedMissing();
    const entered = gate(),
      release = gate();
    send.mockImplementation(async () => {
      entered.resolve();
      await release.promise;
      return "rejected";
    });
    const work = pass();
    try {
      await entered.promise;
      now = new Date(now.getTime() + 60_000);
      await pass();
      expect((await mail())[0]!.status).toBe("unknown");
    } finally {
      release.resolve();
    }
    await work;
    now = new Date(now.getTime() + 60 * 60_000);
    await pass();
    expect(send).toHaveBeenCalledTimes(1);
    expect((await mail())[0]!.status).toBe("unknown");
  });
  it.each(["non-primary", "stopped"])(
    "settles an unstarted committed claim as unknown when %s",
    async (reason) => {
      await seedMissing();
      const original = suite.db.withWriteLock.bind(suite.db);
      const spy = vi
        .spyOn(suite.db, "withWriteLock")
        .mockImplementation(async <T>(body: () => Promise<T>) => {
          const value = await original(body);
          if ((await mail()).some((m) => m.status === "sending")) {
            if (reason === "non-primary") primary = false;
            else controller.abort();
          }
          return value;
        });
      try {
        await pass();
      } finally {
        spy.mockRestore();
      }
      expect(send).not.toHaveBeenCalled();
      expect(await mail()).toMatchObject([
        { status: "unknown", recipient: "worker@example.test", claimToken: expect.any(String) },
      ]);
    },
  );
  it.each(["non-primary", "stopped"])(
    "rechecks %s inside a queued claim transaction",
    async (reason) => {
      await seedMissing();
      const entered = gate(),
        held = gate(),
        queued = gate();
      const holding = run(async () => {
        entered.resolve();
        await held.promise;
      });
      await entered.promise;
      const original = suite.db.withWriteLock.bind(suite.db);
      const spy = vi
        .spyOn(suite.db, "withWriteLock")
        .mockImplementation(async <T>(body: () => Promise<T>) => {
          queued.resolve();
          return original(body);
        });
      const before = await mail(),
        work = pass();
      try {
        await queued.promise;
        if (reason === "non-primary") primary = false;
        else controller.abort();
      } finally {
        held.resolve();
      }
      try {
        await holding;
        await work;
      } finally {
        spy.mockRestore();
      }
      expect(send).not.toHaveBeenCalled();
      expect(await mail()).toEqual(before);
    },
  );
  it.each(["sent", "unknown"] as const)(
    "keeps one combined reminder after %s, restarts and address changes",
    async (outcome) => {
      await seedMissing();
      send.mockResolvedValue(outcome);
      expect(await pass()).toEqual({ processed: true });
      expect(send).toHaveBeenCalledExactlyOnceWith({
        smtp,
        recipient: "worker@example.test",
        locale: "es",
        businessDay: "2026-01-05",
        locationName: "Madrid",
        missingKinds: ["in", "out"],
      });
      await suite.db
        .update(persons)
        .set({ email: "replacement@example.test" })
        .where(eq(persons.id, personId));
      expect(await pass()).toEqual({ processed: false });
      now = new Date("2026-01-10T06:00:00Z");
      await pass();
      expect(send).toHaveBeenCalledTimes(1);
      expect(await mail()).toMatchObject([
        { status: outcome, outcome, recipient: "worker@example.test" },
      ]);
      expect(await questions()).toMatchObject([{ active: true, resolvedByEntryId: null }]);
      await seedMissing("2026-01-06");
      await pass();
      expect(send).toHaveBeenCalledTimes(2);
      expect((await questions()).map((q) => q.businessDay).sort()).toEqual([
        "2026-01-05",
        "2026-01-06",
      ]);
    },
  );
  it("leaves unconfigured mail untouched and sends after configuration becomes available", async () => {
    await seedMissing();
    const before = await mail();
    expect(await pass({ resolveDelivery: async () => ({ mode: "unconfigured" }) })).toEqual({
      processed: false,
    });
    expect(await mail()).toEqual(before);
    expect(send).not.toHaveBeenCalled();
    await pass();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([null, "", "   "])(
    "leaves questions with unusable email=%s unclaimed and later uses the current email",
    async (email) => {
      await seedMissing();
      await suite.db.update(persons).set({ email }).where(eq(persons.id, personId));
      const before = await mail();
      await pass();
      expect(await mail()).toEqual(before);
      expect(send).not.toHaveBeenCalled();
      await suite.db
        .update(persons)
        .set({ email: "added@example.test" })
        .where(eq(persons.id, personId));
      await pass();
      expect(send.mock.calls[0]![0].recipient).toBe("added@example.test");
    },
  );
  it.each(["suspended", "pending"] as const)(
    "does not claim for a %s worker and retains their question",
    async (status) => {
      await seedMissing();
      await suite.db.update(persons).set({ status }).where(eq(persons.id, personId));
      const before = await mail();
      await pass();
      expect(send).not.toHaveBeenCalled();
      expect(await mail()).toEqual(before);
      expect(await questions()).toHaveLength(1);
      await suite.db.update(persons).set({ status: "active" }).where(eq(persons.id, personId));
      await pass();
      expect(send).toHaveBeenCalledTimes(1);
    },
  );
  it.each([null, "fr"])("uses the venue fallback for locale=%s", async (locale) => {
    await seedMissing();
    await suite.db.update(persons).set({ locale }).where(eq(persons.id, personId));
    await pass();
    expect(send.mock.calls[0]![0].locale).toBe("en");
  });
  it("an unaddressed oldest question cannot starve a later eligible worker", async () => {
    await seedMissing();
    await suite.db.update(persons).set({ email: null }).where(eq(persons.id, personId));
    const oldPerson = personId;
    const [person] = await suite.db
      .insert(persons)
      .values({ displayName: "Second", email: "second@example.test" })
      .returning();
    personId = person!.id;
    await seedMissing("2026-01-06");
    await pass();
    expect(send.mock.calls[0]![0].recipient).toBe("second@example.test");
    const q = (await questions()).find((q) => q.personId === oldPerson)!;
    expect((await mail()).find((m) => m.questionId === q.id)).toMatchObject({
      status: "pending",
      claimToken: null,
    });
  });
  it("resolves delivery outside the write lock and rechecks the recipient at claim time", async () => {
    await seedMissing();
    const entered = gate(),
      release = gate();
    const work = pass({
      resolveDelivery: async () => {
        entered.resolve();
        await release.promise;
        return { mode: "local_capture", smtp };
      },
    });
    try {
      await entered.promise;
      await run(async (tx) => {
        await tx.update(persons).set({ email: "new@example.test" }).where(eq(persons.id, personId));
      });
    } finally {
      release.resolve();
    }
    await work;
    expect(send.mock.calls[0]![0].recipient).toBe("new@example.test");
    expect(await mail()).toMatchObject([{ recipient: "new@example.test", status: "sent" }]);
  });
  it("commits its claim before SMTP and lets another write commit while sending", async () => {
    await seedMissing();
    const entered = gate(),
      release = gate();
    send.mockImplementation(async () => {
      entered.resolve();
      await release.promise;
      return "sent";
    });
    const work = pass();
    try {
      await entered.promise;
      expect(await mail()).toMatchObject([
        { status: "sending", claimToken: expect.any(String), recipient: "worker@example.test" },
      ]);
      await run(async (tx) => {
        await tx.update(persons).set({ telephone: "123" }).where(eq(persons.id, personId));
      });
      expect((await suite.db.select().from(persons))[0]!.telephone).toBe("123");
      expect(await pass()).toEqual({ processed: false });
    } finally {
      release.resolve();
    }
    await work;
    expect(send).toHaveBeenCalledTimes(1);
    expect((await mail())[0]!.status).toBe("sent");
  });
  it("retries proven rejection only after its durable fifteen-minute delay", async () => {
    await seedMissing();
    send.mockResolvedValue("rejected");
    await pass();
    expect((await mail())[0]!.nextAttemptAt).toBe("2026-01-08T06:15:00.000Z");
    now = new Date("2026-01-08T06:14:59.999Z");
    await pass();
    expect(send).toHaveBeenCalledTimes(1);
    now = new Date("2026-01-08T06:15:00Z");
    await pass();
    expect(send).toHaveBeenCalledTimes(2);
    send.mockResolvedValue("sent");
    now = new Date("2026-01-08T06:30:00Z");
    await pass();
    await pass();
    expect(send).toHaveBeenCalledTimes(3);
    expect((await mail())[0]!.status).toBe("sent");
  });
  it("treats a thrown transport as unknown and keeps the worker question", async () => {
    await seedMissing();
    send.mockRejectedValue(new Error("private transport detail"));
    await pass();
    now = new Date("2026-01-10T06:00:00Z");
    await pass();
    expect(send).toHaveBeenCalledTimes(1);
    expect((await mail())[0]!.status).toBe("unknown");
    expect(await questions()).toMatchObject([{ resolvedByEntryId: null }]);
  });
  it.each(["non-primary", "stopped"])(
    "does not resolve or mutate mail while %s",
    async (reason) => {
      await seedMissing();
      if (reason === "non-primary") primary = false;
      else controller.abort();
      const resolveDelivery = vi.fn(deps().resolveDelivery),
        before = await mail();
      expect(await pass({ resolveDelivery })).toEqual({ processed: false });
      expect(resolveDelivery).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
      expect(await mail()).toEqual(before);
    },
  );
  it.each(["non-primary", "stopped"])(
    "rechecks %s after waiting for delivery configuration",
    async (reason) => {
      await seedMissing();
      const before = await mail();
      await pass({
        resolveDelivery: async () => {
          if (reason === "non-primary") primary = false;
          else controller.abort();
          return { mode: "smtp", smtp };
        },
      });
      expect(send).not.toHaveBeenCalled();
      expect(await mail()).toEqual(before);
    },
  );
  it("cancels a stale reminder when a real clock-out arrives before claim", async () => {
    await seedMissing("2026-01-05", true);
    await pass({
      resolveDelivery: async () => {
        await run((tx) => backend.clockOut(tx, event("2026-01-05T17:00:00Z")));
        return { mode: "smtp", smtp };
      },
    });
    expect(send).not.toHaveBeenCalled();
    expect((await mail())[0]!.status).toBe("cancelled");
    expect((await questions())[0]!.resolvedByEntryId).toBe(
      (await suite.db.select().from(timeEntries)).at(-1)!.id,
    );
  });
  it("reconciles late activity before claim and never emails an automatic-out acknowledgment", async () => {
    await seedMissing("2026-01-05", true);
    await pass({
      resolveDelivery: async () => {
        await run((tx) =>
          recordAttendanceFact(tx, {
            source: "order",
            key: "late",
            locationId,
            personId,
            kind: "order",
            at: "2026-01-05T16:40:00Z",
            offsetMinutes: 60,
            outcome: "qualified",
          }),
        );
        return { mode: "smtp", smtp };
      },
    });
    expect(send).not.toHaveBeenCalled();
    expect((await questions())[0]).toMatchObject({ kind: "automatic-out", missingKinds: [] });
    expect((await mail())[0]!.status).toBe("cancelled");
    expect((await suite.db.select().from(timeEntries)).at(-1)).toMatchObject({
      authorKind: "automatic",
      eventAt: "2026-01-05T16:40:00.000Z",
    });
    const [work] = await suite.db.select().from(attendanceDayWork);
    expect(work!.dirtyRevision).toBeGreaterThan(work!.evaluatedRevision);
  });
  it("cancels a current-question reminder when its published rota is superseded before claim", async () => {
    const [version] = await suite.db
      .insert(rosterVersions)
      .values({
        locationId,
        periodStart: "2026-01-05",
        periodEnd: "2026-01-11",
        status: "published",
        publishedAt: "2026-01-01T00:00:00Z",
      })
      .returning();
    await suite.db.insert(shifts).values({
      locationId,
      personId,
      rosterVersionId: version!.id,
      startsAt: "2026-01-05T09:00:00.000Z",
      endsAt: "2026-01-05T17:00:00.000Z",
      startsOffsetMinutes: 60,
      endsOffsetMinutes: 60,
    });
    await run((tx) => enqueueAttendanceDay(tx, day()));
    await process();
    await pass({
      resolveDelivery: async () => {
        await suite.db
          .update(rosterVersions)
          .set({ status: "superseded" })
          .where(eq(rosterVersions.id, version!.id));
        return { mode: "smtp", smtp };
      },
    });
    expect(send).not.toHaveBeenCalled();
    expect((await questions())[0]).toMatchObject({
      active: false,
      inactiveReason: "rota_superseded",
    });
    expect((await mail())[0]!.status).toBe("cancelled");
  });
  it("awaits an in-flight send and its report when shutdown arrives", async () => {
    await seedMissing();
    const entered = gate(),
      release = gate();
    let done = false;
    send.mockImplementation(async () => {
      entered.resolve();
      await release.promise;
      return "sent";
    });
    const work = pass().finally(() => {
      done = true;
    });
    try {
      await entered.promise;
      controller.abort();
      await Promise.resolve();
      expect(done).toBe(false);
    } finally {
      release.resolve();
    }
    await work;
    expect((await mail())[0]!.status).toBe("sent");
  });
});

describe("attendance email duty lifecycle", () => {
  it("an already aborted loop uses no database, configuration or sender", async () => {
    const { runAttendanceEmailLoop } = await import("./attendance-email-worker.js");
    await seedMissing();
    const before = await mail(),
      resolveDelivery = vi.fn(deps().resolveDelivery);
    controller.abort();
    await runAttendanceEmailLoop({
      ...deps(),
      resolveDelivery,
      onError: (error) => {
        throw error;
      },
    });
    expect(resolveDelivery).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(await mail()).toEqual(before);
  });
  it("aborts the actual idle sleep and awaits its completion", async () => {
    const { runAttendanceEmailLoop } = await import("./attendance-email-worker.js");
    const entered = gate();
    let finished = false;
    const work = runAttendanceEmailLoop({
      ...deps(),
      onError: (error) => {
        throw error;
      },
      sleep: async (ms, signal) => {
        entered.resolve();
        await realSleep(ms, signal);
      },
    }).then(() => {
      finished = true;
    });
    await entered.promise;
    expect(finished).toBe(false);
    controller.abort();
    await work;
    expect(finished).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });
  it.each([false, true])("uses the %s work interval and stops its sleep", async (pending) => {
    const { runAttendanceEmailLoop } = await import("./attendance-email-worker.js");
    if (pending) await seedMissing();
    const sleeps: number[] = [];
    await runAttendanceEmailLoop({
      ...deps(),
      onError: (error) => {
        throw error;
      },
      sleep: async (ms, signal) => {
        sleeps.push(ms);
        expect(signal).toBe(controller.signal);
        controller.abort();
      },
    });
    expect(sleeps).toEqual([pending ? 500 : 30_000]);
    expect(send).toHaveBeenCalledTimes(pending ? 1 : 0);
  });
  it("reports a configuration error and then sends the retained reminder", async () => {
    const { runAttendanceEmailLoop } = await import("./attendance-email-worker.js");
    await seedMissing();
    const failure = new Error("credential lookup refused"),
      errors: unknown[] = [],
      sleeps: number[] = [];
    const resolveDelivery = vi.fn(deps().resolveDelivery).mockRejectedValueOnce(failure);
    await runAttendanceEmailLoop({
      ...deps(),
      resolveDelivery,
      onError: (error) => errors.push(error),
      sleep: async (ms) => {
        sleeps.push(ms);
        if (sleeps.length === 2) controller.abort();
      },
    });
    expect(errors).toEqual([failure]);
    expect(sleeps).toEqual([500, 500]);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await mail())[0]!.status).toBe("sent");
  });
  it("reports an unexpected sleep failure and still services the next pass", async () => {
    const { runAttendanceEmailLoop } = await import("./attendance-email-worker.js");
    const failure = new Error("sleep failed"),
      errors: unknown[] = [];
    let sleeps = 0;
    await runAttendanceEmailLoop({
      ...deps(),
      onError: (error) => errors.push(error),
      sleep: async () => {
        if (++sleeps === 1) throw failure;
        controller.abort();
      },
    });
    expect(errors).toEqual([failure]);
    expect(sleeps).toBe(2);
  });
  it("shutdown waits for an active sender and report without starting another sleep", async () => {
    const { runAttendanceEmailLoop } = await import("./attendance-email-worker.js");
    await seedMissing();
    const entered = gate(),
      release = gate();
    send.mockImplementation(async () => {
      entered.resolve();
      await release.promise;
      return "sent";
    });
    const sleep = vi.fn(async () => {});
    let completed = false;
    const work = runAttendanceEmailLoop({
      ...deps(),
      sleep,
      onError: (error) => {
        throw error;
      },
    }).finally(() => {
      completed = true;
    });
    try {
      await entered.promise;
      controller.abort();
      await Promise.resolve();
      expect(completed).toBe(false);
    } finally {
      release.resolve();
    }
    await work;
    expect(sleep).not.toHaveBeenCalled();
    expect((await mail())[0]!.status).toBe("sent");
  });
});
