import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  locations,
  withTransaction,
  type Transaction,
  venueLocationId,
} from "@waitron/db";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons } from "@waitron/identity";
import { jobOrigin } from "@waitron/shared";
import {
  WORKFORCE_MIGRATIONS,
  WorkforceBackend,
  attendanceQuestions,
  attendanceDayWork,
  enqueueAttendanceDay,
  processAttendanceDay,
  rosterVersions,
  shifts,
  timeEntries,
  executeAttendanceCommand,
  readAttendanceInbox,
} from "@waitron/workforce";
import { recordAttendanceFact } from "./attendance-capture.js";
import { readAttendanceFacts, readPlannedAttendanceShifts } from "./attendance-facts.js";
import type { EmailDelivery } from "./email-delivery.js";
import { attendanceReminderMail } from "./attendance-email.js";
import { runMailPass, type MailSenderDeps, type MailTransport } from "./mail-sender.js";
import { attendanceMailRows, setAttendanceMail } from "@waitron/workforce/test/fixtures.js";

import { attendanceReminderMessage } from "./attendance-email.js";
import { sendSmtpMessage } from "./smtp-send.js";
import { createServer, type AddressInfo, type Socket } from "node:net";
import { once } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Reply = "accepted" | "recipient-refused" | "data-refused" | "lost-ack" | "silent";
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { resolve, promise };
};
async function smtpRig(reply: Reply) {
  const sockets = new Set<Socket>();
  const messages: string[] = [];
  const dataReceived = gate();
  const connectionClosed = gate();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
      connectionClosed.resolve();
    });
    socket.on("error", () => {});
    socket.setEncoding("utf8");
    socket.write("220 attendance-test ESMTP\r\n");
    let buffer = "";
    let data: string[] | undefined;
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data !== undefined) {
          if (line !== ".") {
            data.push(line);
            continue;
          }
          messages.push(data.join("\r\n"));
          data = undefined;
          dataReceived.resolve();
          if (reply === "lost-ack") socket.destroy();
          else if (reply === "data-refused") socket.write("451 private-smtp-detail refused\r\n");
          else if (reply === "accepted") socket.end("250 accepted\r\n");
        } else if (line.startsWith("EHLO") || line.startsWith("HELO")) {
          socket.write("250 attendance-test\r\n");
        } else if (line.startsWith("RCPT")) {
          socket.write(
            reply === "recipient-refused" ? "550 private-detail unknown\r\n" : "250 ok\r\n",
          );
        } else if (line === "DATA") {
          data = [];
          socket.write("354 send message\r\n");
        } else socket.write("250 ok\r\n");
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    smtp: {
      url: `smtp://127.0.0.1:${(server.address() as AddressInfo).port}`,
      from: "venue@example.test",
    },
    messages,
    dataReceived: dataReceived.promise,
    connectionClosed: connectionClosed.promise,
    sockets,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
const message = {
  recipient: "worker@example.test",
  locale: "en" as const,
  businessDay: "2026-01-05",
  venueName: "Madrid",
  missingKinds: ["in", "out"] as const,
};
function decode(message: string) {
  const [headers, ...body] = message.split("\r\n\r\n");
  const value = body.join("\r\n\r\n");
  if (headers!.includes("Content-Transfer-Encoding: base64"))
    return Buffer.from(value.replace(/\s/g, ""), "base64").toString("utf8");
  return value
    .replace(/=\r\n/g, "")
    .replace(/(?:=[\dA-F]{2})+/g, (part) =>
      Buffer.from(part.replaceAll("=", ""), "hex").toString("utf8"),
    );
}

describe("missing-attendance SMTP", () => {
  it.each([
    ["accepted", "sent"],
    ["recipient-refused", "rejected"],
    ["data-refused", "rejected"],
    ["lost-ack", "unknown"],
  ] as const)("reports %s as %s through the real transport", async (reply, expected) => {
    const rig = await smtpRig(reply);
    try {
      expect(
        await sendSmtpMessage(rig.smtp, {
          to: message.recipient,
          ...attendanceReminderMessage(message),
        }),
      ).toMatchObject({ status: expected });
      await rig.connectionClosed;
      expect(rig.sockets.size).toBe(0);
      expect(rig.messages).toHaveLength(reply === "recipient-refused" ? 0 : 1);
    } finally {
      await rig.close();
    }
  });

  it.each([
    ["en", ["in", "out"], "clock in or out", "next clock-in"],
    ["en", ["out"], "clock out", "next clock-in"],
    ["en", ["in"], "clock in", "next clock-in"],
    ["es", ["in"], "fichar la entrada", "próximo fichaje"],
    ["es", ["out"], "fichar la salida", "próximo fichaje"],
    ["es", ["in", "out"], "fichar la entrada o la salida", "próximo fichaje"],
  ] as const)(
    "sends one localized plain message for %s %s",
    async (locale, missingKinds, missing, action) => {
      const rig = await smtpRig("accepted");
      try {
        expect(
          await sendSmtpMessage(rig.smtp, {
            to: message.recipient,
            ...attendanceReminderMessage({ ...message, locale, missingKinds }),
          }),
        ).toMatchObject({ status: "sent" });
        expect(rig.messages).toHaveLength(1);
        const raw = rig.messages[0]!;
        expect(raw).toContain("From: venue@example.test");
        expect(raw).toContain("To: worker@example.test");
        expect(decode(raw)).toContain("2026-01-05");
        expect(decode(raw)).toContain("Madrid");
        expect(decode(raw)).toContain(missing);
        expect(decode(raw)).toContain(action);
        expect(raw).not.toContain("Content-Disposition: attachment");
        expect(decode(raw)).not.toMatch(/https?:|unconfirmed|sin confirmar/i);
      } finally {
        await rig.close();
      }
    },
  );

  it("expires a silent DATA exchange at 30 seconds and closes its real socket", async () => {
    const rig = await smtpRig("silent");
    let expire: (() => void) | undefined;
    const realTimeout = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: (...args: unknown[]) => void,
      ms?: number,
      ...args: unknown[]
    ) => {
      if (ms === 30_000 && expire === undefined) expire = fn as () => void;
      return realTimeout(fn, ms, ...args);
    }) as typeof setTimeout);
    try {
      const sending = sendSmtpMessage(rig.smtp, {
        to: message.recipient,
        ...attendanceReminderMessage(message),
      });
      await rig.dataReceived;
      expect(expire).toBeTypeOf("function");
      expire!();
      expect(await sending).toMatchObject({ status: "unknown" });
      await rig.connectionClosed;
      expect(rig.sockets.size).toBe(0);
      expect(rig.messages).toHaveLength(1);
    } finally {
      spy.mockRestore();
      await rig.close();
    }
  });
});

it.each([
  ["accepted", "sent", []],
  ["data-refused", "rejected", ["email.test_refused"]],
  ["lost-ack", "unknown", ["email.test_refused"]],
] as const)(
  "reports structured attendance failure without changing %s outcome",
  async (reply, expected, reasons) => {
    const { smtpRig: diagnosticRig } = await import("./testing/smtp-settings-fixture.js");
    const rig = await diagnosticRig(reply);
    try {
      const outcome = await sendSmtpMessage(rig.config, {
        to: message.recipient,
        ...attendanceReminderMessage(message),
      });
      expect(outcome.status).toBe(expected);
      const reasonsSeen = outcome.status === "sent" ? [] : [outcome.reason];
      expect(reasonsSeen).toEqual(reasons);
      expect(JSON.stringify(outcome)).not.toContain("secret-smtp-password");
      await rig.connectionClosed;
      expect(rig.sockets.size).toBe(0);
    } finally {
      await rig.close();
    }
  },
);

it.each(["venue@example.test", { name: "Harbour Kitchen", address: "venue@example.test" }])(
  "keeps the attendance sender envelope %j",
  async (from) => {
    const { smtpRig: diagnosticRig } = await import("./testing/smtp-settings-fixture.js");
    const rig = await diagnosticRig("accepted");
    try {
      expect(
        await sendSmtpMessage(
          { ...rig.config, from },
          { to: message.recipient, ...attendanceReminderMessage(message) },
        ),
      ).toMatchObject({ status: "sent" });
      expect(rig.messages[0]).toContain(
        typeof from === "string"
          ? "From: venue@example.test"
          : "From: Harbour Kitchen <venue@example.test>",
      );
      expect(decode(rig.messages[0]!)).toContain(message.businessDay);
      expect(decode(rig.messages[0]!)).toContain(message.venueName);
    } finally {
      await rig.close();
    }
  },
);

it("reports an attendance deadline as unknown with only its safe diagnostic", async () => {
  const { smtpRig: diagnosticRig } = await import("./testing/smtp-settings-fixture.js");
  const rig = await diagnosticRig("silent");
  const realTimeout = globalThis.setTimeout;
  let expire!: () => void;
  const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    fn: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ) => {
    if (ms === 30_000 && expire === undefined) expire = fn as () => void;
    return realTimeout(fn, ms, ...args);
  }) as typeof setTimeout);
  try {
    const sending = sendSmtpMessage(rig.config, {
      to: message.recipient,
      ...attendanceReminderMessage(message),
    });
    await rig.dataReceived;
    expire();
    expect(await sending).toMatchObject({ status: "unknown", reason: "email.test_timeout" });
    await rig.connectionClosed;
    expect(rig.sockets.size).toBe(0);
  } finally {
    spy.mockRestore();
    await rig.close();
  }
});

describe("attendance_question queue owner", () => {
  const suite = useVenueDb({
    migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS],
  });
  const backend = new WorkforceBackend();
  let locationId: string,
    nodeId: string,
    personId: string,
    primary: boolean,
    now: Date,
    controller: AbortController;
  let send: ReturnType<typeof vi.fn<MailTransport>>;
  const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);
  const day = (date = "2026-01-05") => ({
    businessDay: date,
    startAt: `${date}T04:00:00.000Z`,
    endAt: `${date.slice(0, 8)}${String(Number(date.slice(8)) + 1).padStart(2, "0")}T04:00:00.000Z`,
  });
  const smtp = { url: "smtp://127.0.0.1:1025", from: "venue@example.test" };
  const pass = async ({
    venueLocale = "en",
    ...overrides
  }: Partial<MailSenderDeps> & { venueLocale?: "en" | "es" } = {}) =>
    runMailPass({
      db: suite.db,
      owners: [attendanceReminderMail({ nodeId, venueLanguage: venueLocale })],
      now: () => now,
      isPrimary: () => primary,
      signal: controller.signal,
      resolveDelivery: async (): Promise<EmailDelivery> => ({ mode: "smtp", smtp }),
      send,
      log: () => {},
      ...overrides,
    });
  const mail = () => attendanceMailRows(suite.db);
  const sent = () => send.mock.calls.map(([, message]) => message);
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
    const versionId = await run((tx) => backend.createRosterVersion(tx, { period: "2026-01-05" }));
    const shiftId = await run((tx) =>
      backend.addShift(tx, {
        personId,
        versionId,
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
    send = vi.fn<MailTransport>(async () => ({ status: "sent" }));
    await seedVenue(suite.db, {
      name: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
      invoiceLocales: ["es"],
      operationDescription: "Restaurant",
    });
    locationId = await venueLocationId(suite.db);
    nodeId = await seedNode(suite.db);
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
  });

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
        await setAttendanceMail(suite.db, first!.id, {
          status,
          claimToken: "previous-sender",
          claimedAt: now.toISOString(),
          recipient: "saved@example.test",
          outcome: status === "sending" ? null : status,
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
        beforeClaim: async () => {
          await run(async (tx) => {
            for (const correctionId of result.entryIds)
              await backend.declineCorrection(tx, {
                nodeId,
                correctionId,
                actorPersonId: manager!.id,
                origin: jobOrigin("dashboard"),
              });
          });
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
      expect(sent()[0]).toMatchObject(
        attendanceReminderMessage({
          locale: expected,
          businessDay: "2026-01-05",
          venueName: "Madrid",
          missingKinds: ["in", "out"],
        }),
      );
    },
  );
  it("sends a reminder naming the venue without being told a location", async () => {
    await seedMissing();
    await suite.db.update(locations).set({ name: "Sevilla" }).where(eq(locations.id, locationId));
    expect(await pass()).toMatchObject({ processed: true });
    expect(send).toHaveBeenCalledOnce();
    expect(sent()[0]).toMatchObject(
      attendanceReminderMessage({
        locale: "es",
        businessDay: "2026-01-05",
        venueName: "Sevilla",
        missingKinds: ["in", "out"],
      }),
    );
  });
  it("uses the current missing finish after a late rota clock-in", async () => {
    await seedRota();
    await pass({
      beforeClaim: async () => {
        await run((tx) => backend.clockIn(tx, event("2026-01-05T09:00:00Z")));
      },
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(sent()[0]).toMatchObject(
      attendanceReminderMessage({
        locale: "es",
        businessDay: "2026-01-05",
        venueName: "Madrid",
        missingKinds: ["out"],
      }),
    );
    expect(await mail()).toHaveLength(2);
    expect((await mail()).filter((m) => m.status === "sent")).toHaveLength(1);
  });
  it("does not send before the current rota shift's extended end", async () => {
    now = new Date("2026-01-06T04:01:00Z");
    const { shiftId } = await seedRota();
    await pass({
      beforeClaim: async () => {
        await suite.db
          .update(shifts)
          .set({ endsAt: "2026-01-06T05:00:00.000Z" })
          .where(eq(shifts.id, shiftId));
      },
    });
    expect(send).not.toHaveBeenCalled();
    expect((await mail())[0]).toMatchObject({ status: "pending", claimToken: null });
    now = new Date("2026-01-06T05:00:00Z");
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
      expect(await mail()).toEqual(
        before.map((row) => ({ ...row, nextAttemptAt: "2026-01-08T06:15:00.000Z" })),
      );
      expect(send).not.toHaveBeenCalled();
      await suite.db
        .update(persons)
        .set({ email: "added@example.test" })
        .where(eq(persons.id, personId));
      now = new Date("2026-01-08T06:15:00Z");
      await pass();
      expect(sent()[0]!.to).toBe("added@example.test");
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
      expect(await mail()).toEqual(
        before.map((row) => ({ ...row, nextAttemptAt: "2026-01-08T06:15:00.000Z" })),
      );
      expect(await questions()).toHaveLength(1);
      await suite.db.update(persons).set({ status: "active" }).where(eq(persons.id, personId));
      now = new Date("2026-01-08T06:15:00Z");
      await pass();
      expect(send).toHaveBeenCalledTimes(1);
    },
  );
  it.each([null, "fr"])("uses the venue fallback for locale=%s", async (locale) => {
    await seedMissing();
    await suite.db.update(persons).set({ locale }).where(eq(persons.id, personId));
    await pass();
    expect(sent()[0]).toMatchObject(
      attendanceReminderMessage({
        locale: "en",
        businessDay: "2026-01-05",
        venueName: "Madrid",
        missingKinds: ["in", "out"],
      }),
    );
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
    await pass();
    expect(sent()[0]!.to).toBe("second@example.test");
    const q = (await questions()).find((q) => q.personId === oldPerson)!;
    expect((await mail()).find((m) => m.questionId === q.id)).toMatchObject({
      status: "pending",
      claimToken: null,
    });
  });
  it("resolves delivery in the claim and uses the address current at the claim", async () => {
    await seedMissing();
    await pass({
      beforeClaim: async () => {
        await run(async (tx) => {
          await tx
            .update(persons)
            .set({ email: "new@example.test" })
            .where(eq(persons.id, personId));
        });
      },
    });
    expect(sent()[0]!.to).toBe("new@example.test");
    expect(await mail()).toMatchObject([{ recipient: "new@example.test", status: "sent" }]);
  });
  it("retries proven rejection only after its durable fifteen-minute delay", async () => {
    await seedMissing();
    send.mockResolvedValue({
      status: "rejected",
      serverRefused: true,
      reason: "email.test_refused",
    });
    await pass();
    expect((await mail())[0]!.nextAttemptAt).toBe("2026-01-08T06:15:00.000Z");
    now = new Date("2026-01-08T06:14:59.999Z");
    await pass();
    expect(send).toHaveBeenCalledTimes(1);
    now = new Date("2026-01-08T06:15:00Z");
    await pass();
    expect(send).toHaveBeenCalledTimes(2);
    send.mockResolvedValue({ status: "sent" });
    now = new Date("2026-01-08T06:30:00Z");
    await pass();
    await pass();
    expect(send).toHaveBeenCalledTimes(3);
    expect((await mail())[0]!.status).toBe("sent");
  });
  it("sends a retry stamped more than its fifteen-minute delay ahead, as after a step back", async () => {
    await seedMissing();
    send.mockResolvedValue({
      status: "rejected",
      serverRefused: true,
      reason: "email.test_refused",
    });
    await pass();
    expect((await mail())[0]!.nextAttemptAt).toBe("2026-01-08T06:15:00.000Z");
    now = new Date("2026-01-08T00:00:00Z");
    send.mockResolvedValue({ status: "sent" });
    await pass();
    expect(send).toHaveBeenCalledTimes(2);
    expect((await mail())[0]!.status).toBe("sent");
  });
  it("cancels a stale reminder when a real clock-out arrives before claim", async () => {
    await seedMissing("2026-01-05", true);
    await pass({
      beforeClaim: async () => {
        await run((tx) => backend.clockOut(tx, event("2026-01-05T17:00:00Z")));
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
      beforeClaim: async () => {
        await run((tx) =>
          recordAttendanceFact(tx, {
            source: "order",
            key: "late",
            personId,
            kind: "order",
            at: "2026-01-05T16:40:00Z",
            offsetMinutes: 60,
            outcome: "qualified",
          }),
        );
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
      beforeClaim: async () => {
        await suite.db
          .update(rosterVersions)
          .set({ status: "superseded" })
          .where(eq(rosterVersions.id, version!.id));
      },
    });
    expect(send).not.toHaveBeenCalled();
    expect((await questions())[0]).toMatchObject({
      active: false,
      inactiveReason: "rota_superseded",
    });
    expect((await mail())[0]!.status).toBe("cancelled");
  });
});
