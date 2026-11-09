import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  CORE_CHANGE_SOURCES,
  enqueueMail,
  installChangeFeed,
  outgoingMail,
  persons,
  readMail,
  subscribeToChanges,
  withTransaction,
} from "@waitron/db";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { resolveMailDeliveryIn } from "./email-delivery.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { changeSubscriber, LiveEvents } from "./live-api.js";
import {
  abandonMailClaims,
  runMailPass,
  runMailLoop,
  startMailSender,
  type MailKindOwner,
  type MailSenderDeps,
} from "./mail-sender.js";

describe("one mail sender", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let time: Date, controller: AbortController, primary: boolean;
  let owner: MailKindOwner, deps: MailSenderDeps;
  const personId = randomUUID();
  beforeEach(async () => {
    time = new Date("2026-11-09T12:00:00.000Z");
    controller = new AbortController();
    primary = true;
    await suite.db.insert(persons).values({ id: personId, displayName: "Mail recipient" });
    owner = {
      kind: "box_alert",
      deliveryRule: "notice",
      retryDelaysMs: [5000, 30000],
      longestWaitMs: 30000,
      claim: vi.fn(async () => ({ recipient: "private@example.test", prepared: {} })),
      compose: vi.fn(async () => ({ subject: "Notice", text: "Message" })),
      settle: vi.fn(async () => {}),
    };
    deps = {
      db: suite.db,
      owners: [owner],
      now: () => time,
      isPrimary: () => primary,
      signal: controller.signal,
      resolveDelivery: vi.fn(async () => ({
        mode: "smtp" as const,
        smtp: { url: "smtp://mail.test", from: "from@example.test" },
      })),
      send: vi.fn(async () => ({ status: "sent" as const })),
      log: vi.fn(),
    };
  });
  const queue = async (key = "one", patch = {}) =>
    withTransaction(suite.db, (tx) =>
      enqueueMail(tx, {
        kind: "box_alert",
        personId,
        dedupeKey: key,
        notAfter: new Date(time.getTime() + 3600000),
        now: time,
        ...patch,
      }),
    );
  const row = (key = "one") => readMail(suite.db, key);
  const update = async (patch: Partial<typeof outgoingMail.$inferInsert>, key = "one") => {
    await suite.db.update(outgoingMail).set(patch).where(eq(outgoingMail.dedupeKey, key));
  };
  it("resolves delivery in the claim transaction and commits before sending", async () => {
    await queue();
    deps.resolveDelivery = async (tx) => {
      await tx
        .update(persons)
        .set({ displayName: "Resolved in claim" })
        .where(eq(persons.id, personId));
      return { mode: "smtp" as const, smtp: { url: "smtp://mail.test", from: "sender" } };
    };
    deps.send = async () => {
      expect(await row()).toMatchObject({
        status: "sending",
        attempts: 1,
        recipient: "private@example.test",
        claimToken: expect.any(String),
      });
      return { status: "sent" };
    };
    expect(await runMailPass(deps)).toMatchObject({ processed: true, mailId: expect.any(String) });
    expect(await row()).toMatchObject({ status: "sent", finishedAt: time.toISOString() });
  });
  it("leaves unconfigured rows untouched without error, then sends when configured", async () => {
    await queue();
    const before = await row();
    const configured = deps.resolveDelivery;
    deps.resolveDelivery = async () => ({ mode: "unconfigured" });
    for (let n = 0; n < 3; n++)
      expect(await runMailPass(deps)).toEqual({ processed: false, emailUnconfigured: true });
    expect(await row()).toEqual(before);
    expect(deps.log).not.toHaveBeenCalled();
    deps.resolveDelivery = configured;
    await runMailPass(deps);
    expect((await row())?.status).toBe("sent");
  });
  it.each([10000, 86400000])(
    "puts an unready row back for %s ms, bounded by its longest wait",
    async (laterMs) => {
      const { id } = await queue();
      owner.claim = async () => ({ later: new Date(time.getTime() + laterMs) });
      expect(await runMailPass(deps)).toEqual({ processed: true, mailId: id, subjectId: null });
      expect(await row()).toMatchObject({
        status: "pending",
        attempts: 0,
        claimToken: null,
        recipient: null,
        nextAttemptAt: laterMs === 10000 ? "2026-11-09T12:00:10.000Z" : "2026-11-09T12:00:30.000Z",
      });
      expect(deps.send).not.toHaveBeenCalled();
      expect(owner.settle).not.toHaveBeenCalled();
    },
  );
  it("a row put back does not block the row behind it", async () => {
    await queue();
    await queue("two");
    owner.claim = async (_tx, mail) =>
      mail.dedupeKey === "one"
        ? { later: new Date(time.getTime() + 10000) }
        : { recipient: "second@example.test", prepared: {} };
    await runMailPass(deps);
    await runMailPass(deps);
    expect((await row())?.status).toBe("pending");
    expect((await row("two"))?.status).toBe("sent");
    expect(deps.send).toHaveBeenCalledTimes(1);
  });
  it("two passes started together claim a due row once", async () => {
    await queue();
    await Promise.all([runMailPass(deps), runMailPass(deps)]);
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect((await row())?.status).toBe("sent");
  });
  it("a report under a lapsed claim changes nothing", async () => {
    await queue();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const sending = new Promise<void>((resolve) => {
      entered = resolve;
    });
    deps.send = async () => {
      entered();
      await held;
      return { status: "sent" };
    };
    const pass = runMailPass(deps);
    await sending;
    time = new Date(time.getTime() + 60000);
    await runMailPass(deps);
    const abandoned = await row();
    release();
    await pass;
    expect(abandoned).toMatchObject({ status: "unknown", failureCode: "mail.claim_abandoned" });
    expect(await row()).toEqual(abandoned);
  });
  it("cancels what the owner no longer wants", async () => {
    await queue();
    owner.claim = async () => null;
    await runMailPass(deps);
    expect(await row()).toMatchObject({
      status: "cancelled",
      finishedAt: time.toISOString(),
      attempts: 0,
    });
    expect(deps.send).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    "retries rejected mail with serverRefused %s, then finishes",
    async (serverRefused) => {
      await queue();
      deps.send = async () => ({ status: "rejected", reason: "email.test_refused", serverRefused });
      for (const [attempt, delay] of [
        [1, 5000],
        [2, 30000],
        [3, 0],
      ]) {
        await runMailPass(deps);
        expect(await row()).toMatchObject({
          status: "rejected",
          attempts: attempt,
          finishedAt: delay ? null : time.toISOString(),
          claimToken: delay ? null : expect.any(String),
          recipient: delay ? null : "private@example.test",
          claimedAt: delay ? null : time.toISOString(),
        });
        if (delay) {
          expect((await row())?.nextAttemptAt).toBe(new Date(time.getTime() + delay).toISOString());
          expect(await runMailPass(deps)).toEqual({ processed: false });
          time = new Date(time.getTime() + delay);
        }
      }
      expect(owner.settle).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.anything(),
        { status: "rejected", failureCode: "email.test_refused", serverRefused },
        time,
        {},
      );
    },
  );
  it("backs off a throwing claim without blocking the next row or keeping its writes", async () => {
    await queue();
    await queue("two");
    deps.resolveDelivery = async (tx) => {
      await tx
        .update(persons)
        .set({ displayName: "Delivery resolver write" })
        .where(eq(persons.id, personId));
      return { mode: "smtp" as const, smtp: { url: "smtp://mail.test", from: "sender" } };
    };
    owner.claim = async (tx, mail) => {
      if (mail.dedupeKey === "one") {
        await tx
          .update(persons)
          .set({ displayName: "Rolled back" })
          .where(eq(persons.id, personId));
        throw new Error("private provider text");
      }
      return { recipient: "private@example.test", prepared: {} };
    };
    await runMailPass(deps);
    expect(await row()).toMatchObject({
      status: "rejected",
      failureCode: "mail.claim_failed",
      attempts: 1,
      claimToken: null,
      recipient: null,
      nextAttemptAt: "2026-11-09T12:00:05.000Z",
    });
    expect((await suite.db.select().from(persons))[0]?.displayName).toBe("Mail recipient");
    await runMailPass(deps);
    expect((await row("two"))?.status).toBe("sent");
  });
  it.each(["unknown", "throws"] as const)(
    "never retries a transport outcome %s",
    async (status) => {
      await queue();
      deps.send = vi.fn(async () => {
        if (status === "throws") throw new Error("secret");
        return { status: "unknown" as const, reason: "email.test_timeout" as const };
      });
      await runMailPass(deps);
      time = new Date(time.getTime() + 60000);
      await runMailPass(deps);
      expect(await row()).toMatchObject({ status: "unknown", attempts: 1 });
      expect(deps.send).toHaveBeenCalledTimes(1);
    },
  );
  it("retries wording failure without calling the transport", async () => {
    await queue();
    owner.compose = async () => {
      throw new Error("private");
    };
    await runMailPass(deps);
    expect(await row()).toMatchObject({
      status: "rejected",
      failureCode: "mail.compose_failed",
      recipient: null,
    });
    expect(deps.send).not.toHaveBeenCalled();
  });
  it("ends a sending row only at claim lapse, even past its lifetime", async () => {
    await queue();
    await update({
      status: "sending",
      claimToken: "token",
      recipient: "private@example.test",
      claimedAt: time.toISOString(),
      notAfter: new Date(time.getTime() + 1).toISOString(),
    });
    time = new Date(time.getTime() + 2);
    expect(await runMailPass(deps)).toEqual({ processed: false });
    time = new Date("2026-11-09T12:01:00.000Z");
    expect(await runMailPass(deps)).toEqual({ processed: true, mailId: null, subjectId: null });
    expect(await row()).toMatchObject({ status: "unknown", failureCode: "mail.claim_abandoned" });
  });
  it("abandons owned claims at startup and tells their owner without prepared data", async () => {
    await queue();
    await queue("waiting");
    const waitingBefore = await row("waiting");
    await update({
      status: "sending",
      claimToken: "token",
      recipient: "private@example.test",
      claimedAt: time.toISOString(),
    });
    expect(await withTransaction(suite.db, (tx) => abandonMailClaims(tx, [owner], time))).toBe(1);
    expect((await row())?.status).toBe("unknown");
    expect(await row("waiting")).toEqual(waitingBefore);
    expect(owner.settle).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { status: "unknown", failureCode: "mail.claim_abandoned" },
      time,
    );
  });
  it("expires a restored backlog in batches and never sends the old rows beyond that batch", async () => {
    for (let n = 0; n < 25; n++) await queue(`old${n}`, { notAfter: new Date(time.getTime() + 1) });
    time = new Date(time.getTime() + 2);
    await queue("good");
    await runMailPass(deps);
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect((await row("good"))?.status).toBe("sent");
    expect((await row("old20"))?.status).toBe("pending");
    expect(
      vi.mocked(owner.settle).mock.calls.filter((c) => c[2].status === "expired"),
    ).toHaveLength(20);
    await runMailPass(deps);
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(owner.settle).mock.calls.filter((c) => c[2].status === "expired"),
    ).toHaveLength(25);
  });
  it.each([0, 1])(
    "expires at the boundary and sends one millisecond inside (%s)",
    async (remaining) => {
      await queue();
      time = new Date(time.getTime() + 3600000 - remaining);
      const result = await runMailPass(deps);
      expect((await row())?.status).toBe(remaining ? "sent" : "expired");
      if (!remaining) expect(result).toEqual({ processed: true, mailId: null, subjectId: null });
    },
  );
  it("leaves unowned expired waiting rows and abandoned sending rows unchanged", async () => {
    await queue("one", { kind: "invoice" });
    await queue("two", { kind: "invoice" });
    await update(
      {
        status: "sending",
        claimToken: "token",
        claimedAt: time.toISOString(),
        recipient: "private@example.test",
      },
      "two",
    );
    const before = await suite.db.select().from(outgoingMail);
    time = new Date(time.getTime() + 86400000);
    await runMailPass(deps);
    await withTransaction(suite.db, (tx) => abandonMailClaims(tx, [owner], time));
    expect(await suite.db.select().from(outgoingMail)).toEqual(before);
  });
  it("uses queue sequence when due and queued times are equal, regardless of random id order", async () => {
    for (const key of ["A", "B", "C"]) await queue(key);
    await update({ id: "z" }, "A");
    await update({ id: "a" }, "B");
    await update({ id: "m" }, "C");
    await update({ status: "rejected" }, "B");
    const restored = await suite.db.select().from(outgoingMail);
    await suite.db.delete(outgoingMail);
    await suite.db.insert(outgoingMail).values(restored.reverse());
    const sent: string[] = [];
    owner.compose = async (_, mail) => {
      sent.push(mail.dedupeKey);
      return { subject: "x", text: "x" };
    };
    for (let n = 0; n < 3; n++) await runMailPass(deps);
    expect(sent).toEqual(["A", "B", "C"]);
  });
  it.each(["abort", "stepdown"])(
    "claims nothing when %s happens before the claim",
    async (action) => {
      await queue();
      const before = await row();
      deps.beforeClaim = async () => {
        if (action === "abort") controller.abort();
        else primary = false;
      };
      expect(await runMailPass(deps)).toEqual({ processed: false });
      expect(await row()).toEqual(before);
    },
  );
  it.each(["abort", "stepdown"])(
    "releases a claim when %s happens before sending",
    async (action) => {
      await queue();
      owner.compose = async () => {
        if (action === "abort") controller.abort();
        else primary = false;
        return { subject: "x", text: "x" };
      };
      await runMailPass(deps);
      expect(await row()).toMatchObject({
        status: "pending",
        attempts: 0,
        claimToken: null,
        claimedAt: null,
        recipient: null,
      });
      expect(deps.send).not.toHaveBeenCalled();
      expect(owner.settle).not.toHaveBeenCalled();
    },
  );
  it("takes no read turn after a stop or stepdown already happened", async () => {
    await queue();
    const before = await row();
    controller.abort();
    expect(await runMailPass(deps)).toEqual({ processed: false });
    deps.signal = new AbortController().signal;
    primary = false;
    expect(await runMailPass(deps)).toEqual({ processed: false });
    expect(await row()).toEqual(before);
  });
  it("rechecks a row cancelled while waiting for the claim turn", async () => {
    await queue();
    deps.beforeClaim = async () => update({ status: "cancelled", finishedAt: time.toISOString() });
    expect(await runMailPass(deps)).toEqual({ processed: false });
    expect(deps.send).not.toHaveBeenCalled();
  });
  it("propagates email-settings read failures without claiming the row", async () => {
    await queue();
    const before = await row();
    deps.resolveDelivery = async () => {
      throw new Error("settings unavailable");
    };
    await expect(runMailPass(deps)).rejects.toThrow("settings unavailable");
    expect(await row()).toEqual(before);
  });
  it("records a send already handed over when stopped", async () => {
    await queue();
    deps.send = async () => {
      controller.abort();
      return { status: "sent" };
    };
    await runMailPass(deps);
    expect((await row())?.status).toBe("sent");
  });
  it("logs only fixed codes, never provider text or addresses", async () => {
    await queue();
    deps.send = async () => {
      throw new Error("private@example.test password=secret");
    };
    await runMailPass(deps);
    expect(deps.log).toHaveBeenCalledWith("error", "mail.send_failed", {
      kind: "box_alert",
      mailId: expect.any(String),
      errorCode: "email.test_refused",
    });
    expect(JSON.stringify(vi.mocked(deps.log).mock.calls)).not.toMatch(/private|secret/);
  });
  it.each(["waiting", "sending"])("handles a backward clock step for %s", async (status) => {
    await queue();
    if (status === "waiting") await update({ nextAttemptAt: "2027-12-14T12:00:00.000Z" });
    else
      await update({
        status: "sending",
        claimToken: "token",
        claimedAt: "2027-12-14T12:00:00.000Z",
        recipient: "private@example.test",
      });
    await runMailPass(deps);
    expect((await row())?.status).toBe(status === "waiting" ? "sent" : "unknown");
  });
  it("an idle pass takes no write turn", async () => {
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((r) => {
      entered = r;
    });
    const hold = new Promise<void>((r) => {
      release = r;
    });
    const writer = withTransaction(suite.db, async () => {
      entered();
      await hold;
    });
    await ready;
    try {
      expect(
        await Promise.race([
          runMailPass(deps),
          new Promise((r) => setTimeout(() => r("blocked"), 500)),
        ]),
      ).toEqual({ processed: false });
    } finally {
      release();
      await writer;
    }
  });
  it("an unreadable SMTP credential waits quietly while expired mail leaves pending, then recovers", async () => {
    await seedVenue(suite.db);
    const ring = loadKeyRing({
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
    });
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, ring, {
        purpose: "email.smtp",
        value: { url: "smtp://user:secret@mail.test", from: "from@example.test" },
      }),
    );
    const version = async (keyVersion: number) =>
      suite.db.run(
        sql`update tenant_credentials set key_version=${keyVersion} where purpose='email.smtp'`,
      );
    await version(99);
    await queue("expired", { notAfter: new Date(time.getTime() + 1) });
    await queue("waiting");
    time = new Date(time.getTime() + 2);
    deps.owners = [owner, { ...owner, kind: "invoice", deliveryRule: "invoice" }];
    deps.resolveDelivery = (tx, rule) =>
      resolveMailDeliveryIn(tx, ring, { devMode: false, onboardingIntent: undefined }, rule);
    const sleeps: number[] = [];
    let expiredAtFirstSleep: string | undefined;
    await runMailLoop({
      ...deps,
      sleep: async (ms) => {
        sleeps.push(ms);
        if (sleeps.length === 1) expiredAtFirstSleep = (await row("expired"))?.status;
        if (sleeps.length === 2) await version(1);
        if (sleeps.length === 4) {
          await version(99);
          await queue("later");
        }
        if (sleeps.length === 5) controller.abort();
      },
    });
    expect(expiredAtFirstSleep).toBe("expired");
    expect(sleeps).toEqual([500, 60000, 500, 60000, 60000]);
    expect((await row("waiting"))?.status).toBe("sent");
    const failures = vi
      .mocked(deps.log)
      .mock.calls.filter((c) => c[1] === "mail.delivery_unavailable");
    expect(failures.map((c) => c[2])).toEqual([
      { rule: "notice", errorCode: "credentials.key_version_unknown" },
      { rule: "invoice", errorCode: "credentials.key_version_unknown" },
      { rule: "notice", errorCode: "credentials.key_version_unknown" },
      { rule: "invoice", errorCode: "credentials.key_version_unknown" },
    ]);
    expect(vi.mocked(deps.log).mock.calls.some((c) => c[1] === "mail.pass.threw")).toBe(false);
    expect(JSON.stringify(vi.mocked(deps.log).mock.calls)).not.toContain("secret");
  });
  it("logs an unconfigured wait once across expiry and a later request", async () => {
    await queue();
    deps.resolveDelivery = async () => ({ mode: "unconfigured" });
    let passes = 0;
    const sleeps: number[] = [];
    await runMailLoop({
      ...deps,
      sleep: async (ms) => {
        sleeps.push(ms);
        if (++passes === 1) {
          time = new Date(time.getTime() + 7200000);
        } else if (passes === 2) {
          await queue("later");
        } else {
          controller.abort();
        }
      },
    });
    expect(sleeps).toEqual([60000, 500, 60000]);
    expect(vi.mocked(deps.log).mock.calls.map((c) => c[1])).toContain("mail.loop.sleeping");
    expect(vi.mocked(deps.log).mock.calls.map((c) => c[1])).not.toContain("loop.sleeping");
    expect(
      vi.mocked(deps.log).mock.calls.filter((c) => c[1] === "mail.waiting_for_email_setup"),
    ).toHaveLength(1);
  });
  it("sleeps until a scheduled row or an active claim is due", async () => {
    await queue("scheduled", { nextAttemptAt: new Date(time.getTime() + 10000) });
    const sleeps: number[] = [];
    await runMailLoop({
      ...deps,
      sleep: async (ms) => {
        sleeps.push(ms);
        if (sleeps.length === 1)
          await update(
            {
              status: "sending",
              claimToken: "token",
              claimedAt: new Date(time.getTime() - 15000).toISOString(),
              recipient: "private@example.test",
            },
            "scheduled",
          );
        else controller.abort();
      },
    });
    expect(sleeps).toEqual([10000, 45000]);
  });
  it("resolves notice and invoice rules separately so an unconfigured kind blocks no other kind", async () => {
    await queue();
    await queue("invoice", { kind: "invoice", personId: null });
    deps.owners = [owner, { ...owner, kind: "invoice", deliveryRule: "invoice" }];
    deps.resolveDelivery = async (_, rule) =>
      rule === "notice"
        ? { mode: "unconfigured" }
        : { mode: "smtp", smtp: { url: "smtp://mail.test", from: "sender" } };
    await runMailPass(deps);
    expect((await row())?.status).toBe("pending");
    expect((await row("invoice"))?.status).toBe("sent");
  });
  it("records no outcome or settlement over a claim another process abandoned", async () => {
    await queue();
    deps.send = async () => {
      await withTransaction(suite.db, (tx) => abandonMailClaims(tx, [owner], time));
      return { status: "sent" };
    };
    await runMailPass(deps);
    expect((await row())?.status).toBe("unknown");
    expect(owner.settle).toHaveBeenCalledTimes(1);
    expect(owner.settle).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { status: "unknown", failureCode: "mail.claim_abandoned" },
      time,
    );
  });
  it.each([true, false])(
    "a committed insert wakes the sender only with the change-feed subscription (%s)",
    async (connected) => {
      await installChangeFeed(
        suite.db,
        CORE_CHANGE_SOURCES.filter((s) => s.table === "outgoing_mail"),
      );
      const bus = new LiveEvents();
      const unsubscribe = connected
        ? subscribeToChanges(changeSubscriber(bus, deps.log))
        : () => {};
      const sent = vi.fn(async () => ({ status: "sent" as const }));
      let sleeping!: () => void;
      const asleep = new Promise<void>((r) => {
        sleeping = r;
      });
      deps.log = (_level, event) => {
        if (event === "mail.loop.sleeping") sleeping();
      };
      const loop = startMailSender({ ...deps, bus, send: sent });
      try {
        await asleep;
        await queue();
        if (connected)
          await vi.waitFor(() => expect(sent).toHaveBeenCalledTimes(1), { timeout: 2000 });
        else {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          expect(sent).not.toHaveBeenCalled();
        }
      } finally {
        controller.abort();
        await loop;
        unsubscribe();
      }
      expect(bus.subscriberCount).toBe(0);
    },
  );
  it("refuses duplicate owners and a longest wait shorter than retry delays", async () => {
    await expect(startMailSender({ ...deps, owners: [owner, owner] })).rejects.toThrow(/owner/i);
    await expect(
      startMailSender({ ...deps, owners: [{ ...owner, longestWaitMs: 1 }] }),
    ).rejects.toThrow(/wait/i);
  });
});
