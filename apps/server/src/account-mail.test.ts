import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { randomUUID, randomInt } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, personRoles, roles, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  completeAccountAction,
  queueAccountMail,
  saveOwnProfile,
  startManagementSession,
  confirmOwnEmailChange,
  hashPassword,
} from "@waitron/identity";
import { ACCOUNT_EMAIL_WORDS } from "./i18n/account-email.js";
import { accountActionMail } from "./account-mail.js";
import { runMailPass, type MailSenderDeps } from "./mail-sender.js";

vi.mock("node:crypto", async (original) => ({
  ...(await original<typeof import("node:crypto")>()),
  randomInt: vi.fn((await original<typeof import("node:crypto")>()).randomInt),
}));

describe("account mail owner", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  const personId = randomUUID();
  let time: Date, deps: MailSenderDeps;
  let messages: string[];
  let connections: string[];
  beforeEach(async () => {
    time = new Date("2026-11-09T12:00:00.000Z");
    messages = [];
    connections = [];
    await seedPersons(suite.db, {
      id: personId,
      displayName: "Recipient",
      email: "person@example.test",
    });
    deps = {
      db: suite.db,
      now: () => time,
      isPrimary: () => true,
      signal: new AbortController().signal,
      log: vi.fn(),
      owners: [
        accountActionMail({
          emailChangeUrl: "https://box.test/",
          venueLocale: "en-GB",
          readTimeZone: async () => "Europe/Madrid",
          readPrivacyNoticeUrl: async () => null,
        }),
      ],
      resolveDelivery: async (_, rule) => ({
        mode: "smtp",
        smtp: {
          url: rule === "notice" ? "smtp://mail.test" : "smtp://wrong-invoice.test",
          from: "sender",
        },
      }),
      send: async (smtp, message) => {
        connections.push(smtp.url);
        messages.push(message.text as string);
        return { status: "sent" };
      },
    };
  });
  const queue = async (
    purpose: "password_reset" | "invitation" | "email_change" = "password_reset",
  ) =>
    withTransaction(suite.db, (tx) =>
      queueAccountMail(tx, {
        personId,
        purpose,
        ...(purpose === "invitation" ? {} : { origin: "https://entry.test:8443" }),
        now: time,
      }),
    );
  it.each(["invitation", "password_reset"] as const)(
    "sends a usable %s through Cloud instead of capture",
    async (purpose) => {
      if (purpose === "invitation")
        await suite.db.run(sql`update persons set status='pending' where id=${personId}`);
      await queue(purpose);
      const authority = {
        id: randomUUID(),
        revision: 1,
        enabled: true,
        expiresAt: new Date(time.getTime() + 3600000).toISOString(),
      };
      deps.resolveAccountRelay = async () => authority;
      let submitted: import("./cloud-email.js").CloudAccountEmail | undefined;
      let messageId: string | undefined;
      deps.sendCloudEmail = async (g, id, payload) => {
        if ("facts" in payload) throw new Error("Expected an account link or code");
        expect(g).toEqual(authority);
        expect(
          suite.db.get<{ status: string }>(sql`select status from outgoing_mail`)?.status,
        ).toBe("sending");
        messageId = id;
        submitted = payload;
        return { status: "sent" };
      };
      deps.resolveDelivery = async () => ({
        mode: "local_capture",
        smtp: { url: "smtp://capture.test", from: "sender" },
      });
      await runMailPass(deps);
      expect(connections).toEqual([]);
      expect(messageId).toMatch(/^[0-9a-f-]{36}$/);
      expect(submitted).toMatchObject({
        class: purpose,
        recipient: "person@example.test",
        displayName: "Recipient",
        locale: "en-GB",
        timeZone: "Europe/Madrid",
      });
      expect(suite.db.get<{ status: string }>(sql`select status from outgoing_mail`)?.status).toBe(
        "sent",
      );
      expect(JSON.stringify(suite.db.all(sql`select * from outgoing_mail`))).not.toContain(
        submitted!.token,
      );
      expect(
        await withTransaction(suite.db, (tx) =>
          completeAccountAction(tx, {
            token: submitted!.token!,
            purpose,
            password: "a new secure password",
            pin: "123456",
            now: time,
          }),
        ),
      ).toMatchObject({ personId });
    },
  );
  it("ends an ambiguous Cloud claim without retry or SMTP fallback", async () => {
    await queue();
    deps.resolveAccountRelay = async () => ({
      id: randomUUID(),
      revision: 1,
      enabled: true,
      expiresAt: new Date(time.getTime() + 3600000).toISOString(),
    });
    deps.sendCloudEmail = vi.fn(async () => ({
      status: "unknown" as const,
      failureCode: "mail.relay_unknown" as const,
    }));
    await runMailPass(deps);
    time = new Date(time.getTime() + 3600000);
    await runMailPass(deps);
    expect(suite.db.get(sql`select status, failure_code from outgoing_mail`)).toMatchObject({
      status: "unknown",
      failure_code: "mail.relay_unknown",
    });
    expect(deps.sendCloudEmail).toHaveBeenCalledTimes(1);
    expect(connections).toEqual([]);
  });
  it("retries a definitely refused relay with a fresh claim id and action", async () => {
    await queue();
    deps.resolveAccountRelay = async () => ({
      id: randomUUID(),
      revision: 1,
      enabled: true,
      expiresAt: new Date(time.getTime() + 3600000).toISOString(),
    });
    const ids: string[] = [],
      tokens: string[] = [];
    deps.sendCloudEmail = async (_g, id, payload) => {
      if ("facts" in payload) throw new Error("Expected an account link or code");
      ids.push(id);
      tokens.push(payload.token!);
      return ids.length === 1
        ? { status: "rejected", failureCode: "mail.relay_refused", serverRefused: true }
        : { status: "sent" };
    };
    await runMailPass(deps);
    expect(suite.db.get(sql`select status, failure_code from outgoing_mail`)).toMatchObject({
      status: "rejected",
      failure_code: "mail.relay_refused",
    });
    time = new Date(time.getTime() + 60000);
    await runMailPass(deps);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    expect(tokens[0]).not.toBe(tokens[1]);
    expect(suite.db.get(sql`select status from outgoing_mail`)).toMatchObject({ status: "sent" });
    expect(connections).toEqual([]);
  });
  it("uses the saved SMTP route when the relay is explicitly off", async () => {
    await queue();
    deps.resolveAccountRelay = async () => null;
    await runMailPass(deps);
    expect(connections).toEqual(["smtp://mail.test"]);
    expect(suite.db.get(sql`select status from outgoing_mail`)).toMatchObject({ status: "sent" });
  });
  it("expires old account mail without asking Cloud for sending authority", async () => {
    await queue();
    time = new Date(time.getTime() + 1800001);
    deps.resolveAccountRelay = vi.fn(async () => {
      throw new Error("offline");
    });
    await runMailPass(deps);
    expect(suite.db.get(sql`select status from outgoing_mail`)).toMatchObject({
      status: "expired",
    });
    expect(deps.resolveAccountRelay).not.toHaveBeenCalled();
    expect(connections).toEqual([]);
  });
  it("passes the worker stop signal into the grant read", async () => {
    await queue();
    const controller = new AbortController();
    deps.signal = controller.signal;
    let entered = () => {},
      observed: AbortSignal | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    deps.resolveAccountRelay = async (signal) => {
      observed = signal;
      entered();
      if (!signal) return null;
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
      return null;
    };
    const pass = runMailPass(deps);
    await started;
    controller.abort();
    await pass;
    expect(observed).toBe(controller.signal);
    expect(connections).toEqual([]);
  });
  it("leaves an account row arriving after the first snapshot for a prepared pass", async () => {
    await queue();
    time = new Date(time.getTime() + 1800001);
    deps.beforeClaim = async () => {
      await queue();
    };
    deps.resolveAccountRelay = async () => ({
      id: randomUUID(),
      revision: 1,
      enabled: true,
      expiresAt: new Date(time.getTime() + 3600000).toISOString(),
    });
    await runMailPass(deps);
    expect(suite.db.all(sql`select status from outgoing_mail order by seq`)).toEqual([
      { status: "expired" },
      { status: "pending" },
    ]);
    expect(connections).toEqual([]);
  });
  it("waits for unreadable Cloud authority without issuing a token or using SMTP", async () => {
    await queue();
    deps.resolveAccountRelay = async () => {
      throw new Error("unavailable");
    };
    await runMailPass(deps);
    expect(suite.db.get(sql`select status, attempts from outgoing_mail`)).toMatchObject({
      status: "pending",
      attempts: 0,
    });
    expect(suite.db.all(sql`select * from account_actions`)).toEqual([]);
    expect(connections).toEqual([]);
  });
  it("makes a working reset link at send and never stores it in the queue", async () => {
    await queue();
    expect(suite.db.all(sql`select * from account_actions`)).toEqual([]);
    await suite.db.run(
      sql`update outgoing_mail set next_attempt_at = '2026-11-09T12:15:00.001Z' where person_id=${personId}`,
    );
    time = new Date("2026-11-09T12:05:00.000Z");
    await runMailPass(deps);
    expect(connections).toEqual(["smtp://mail.test"]);
    const link = new URL(messages[0]!.split("\n").find((line) => line.startsWith("https://"))!);
    expect(link.pathname).toBe("/account");
    expect(link.origin).toBe("https://entry.test:8443");
    expect(new URLSearchParams(link.hash.slice(1)).get("email")).toBe("person@example.test");
    expect(
      await withTransaction(suite.db, (tx) =>
        completeAccountAction(tx, {
          token: link.searchParams.get("token")!,
          purpose: "password_reset",
          password: "a new secure password",
          now: time,
        }),
      ),
    ).toMatchObject({ personId });
    expect(JSON.stringify(suite.db.all(sql`select params from outgoing_mail`))).not.toContain(
      link.searchParams.get("token"),
    );
  });
  it.each(["smtp", "cloud"] as const)(
    "sends an email change to the newest pending address only over %s",
    async (transport) => {
      const relayCodes: string[] = [];
      if (transport === "cloud") {
        deps.resolveAccountRelay = async () => ({
          id: randomUUID(),
          revision: 1,
          enabled: true,
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        });
        deps.sendCloudEmail = async (_grant, _id, payload) => {
          if ("facts" in payload) throw new Error("Expected an account link or code");
          expect(payload).toMatchObject({
            class: "email_change",
            recipient: "second@example.test",
            timeZone: "Europe/Madrid",
            locale: transport === "cloud" ? "es-ES" : "en-GB",
          });
          expect(payload).not.toHaveProperty("token");
          expect(Date.parse(payload.codeExpiresAt!)).toBeLessThan(Date.parse(payload.expiresAt));
          relayCodes.push(payload.code!);
          return { status: "sent" };
        };
      }
      const keyRing = { current: { version: 1, key: Buffer.alloc(32, 7) } };
      vi.mocked(randomInt)
        .mockReturnValueOnce(111111 as never)
        .mockReturnValueOnce(222222 as never);
      await suite.db.run(
        sql`update persons set password_hash=${hashPassword("correct horse")} where id=${personId}`,
      );
      const session = await withTransaction(suite.db, (tx) =>
        startManagementSession(tx, { method: "password", personId }),
      );
      await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, session.token));
      for (const email of ["first@example.test", "second@example.test"]) {
        await withTransaction(suite.db, (tx) =>
          saveOwnProfile(tx, {
            managementSessionId: session.token,
            displayName: "Recipient",
            email,
            locale: transport === "cloud" ? "es-ES" : "en-GB",
            keyRing,
            queueEmailChange: true,
          }),
        );
      }
      deps.owners = [
        accountActionMail({
          keyRing,
          emailChangeUrl: "https://box.test/",
          venueLocale: "en-GB",
          readTimeZone: async () => "Europe/Madrid",
          readPrivacyNoticeUrl: async () => null,
        }),
      ];
      time = new Date();
      await runMailPass(deps);
      await runMailPass(deps);
      expect(suite.db.all(sql`select recipient, status from outgoing_mail order by seq`)).toEqual([
        { recipient: "second@example.test", status: "sent" },
        { recipient: "second@example.test", status: "sent" },
      ]);
      if (transport === "smtp") {
        expect(messages).toHaveLength(2);
        expect(messages[0]).toContain("111111");
        expect(messages[1]).toContain("222222");
      } else {
        expect(relayCodes).toEqual(["111111", "222222"]);
        expect(connections).toEqual([]);
        expect(JSON.stringify(suite.db.all(sql`select * from outgoing_mail`))).not.toMatch(
          /111111|222222/,
        );
      }
      await expect(
        withTransaction(suite.db, (tx) =>
          confirmOwnEmailChange(tx, {
            managementSessionId: session.token,
            code: "111111",
            keyRing,
          }),
        ),
      ).resolves.toBeNull();
      await expect(
        withTransaction(suite.db, (tx) =>
          confirmOwnEmailChange(tx, {
            managementSessionId: session.token,
            code: "222222",
            keyRing,
          }),
        ),
      ).resolves.toBe("second@example.test");
    },
  );

  it("cancels a reset suspended after queuing", async () => {
    await queue();
    await suite.db.run(sql`update persons set status='suspended' where id=${personId}`);
    await runMailPass(deps);
    expect(suite.db.get<{ status: string }>(sql`select status from outgoing_mail`)?.status).toBe(
      "cancelled",
    );
    expect(messages).toEqual([]);
  });
  it("tries a refused reset at 0, 1, 3, 7 and 17 minutes, and never after its lifetime", async () => {
    await queue();
    const tries: string[] = [];
    deps.send = async () => {
      tries.push(time.toISOString());
      return { status: "rejected", reason: "email.test_refused", serverRefused: true };
    };
    for (let minute = 0; minute <= 31; minute++) {
      time = new Date(Date.parse("2026-11-09T12:00:00.000Z") + minute * 60000);
      await runMailPass(deps);
    }
    expect(tries).toEqual([
      "2026-11-09T12:00:00.000Z",
      "2026-11-09T12:01:00.000Z",
      "2026-11-09T12:03:00.000Z",
      "2026-11-09T12:07:00.000Z",
      "2026-11-09T12:17:00.000Z",
    ]);
    expect(
      vi
        .mocked(deps.log)
        .mock.calls.every((c) => !JSON.stringify(c).includes("person@example.test")),
    ).toBe(true);
  });
  it("lists the roles the person holds when the invitation is sent, and none in a reset", async () => {
    await suite.db.run(sql`update persons set status='pending' where id=${personId}`);
    await queue("invitation");
    await suite.db.insert(roles).values({ id: "bar", name: "Bar", nameFolded: "bar" });
    await suite.db.insert(personRoles).values({ personId, roleId: "bar" });
    await runMailPass(deps);
    await queue("password_reset");
    await runMailPass(deps);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("\nYour roles: Staff, Bar.\n");
    expect(messages[1]).not.toContain("roles");
  });
  it.each(["invitation", "email_change"] as const)(
    "composes %s with its current address and locale",
    async (purpose) => {
      await suite.db.run(
        sql`update persons set status=${purpose === "invitation" ? "pending" : "active"}, pending_email='changed@example.test', pending_email_folded = 'changed@example.test',locale='es-ES' where id=${personId}`,
      );
      deps.owners = [
        accountActionMail({
          emailChangeUrl: "https://box.test/",
          venueLocale: "en-GB",
          readTimeZone: async () => "Europe/Madrid",
          readPrivacyNoticeUrl: async () => "https://box.test/privacy",
        }),
      ];
      await queue(purpose);
      await runMailPass(deps);
      expect(connections).toEqual(["smtp://mail.test"]);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain("https://box.test/privacy");
      expect(messages[0]).toContain(ACCOUNT_EMAIL_WORDS.es.hello("Recipient"));
      const action = messages[0]!.split("\n").find((line) => line.startsWith("https://"));
      if (purpose === "email_change") expect(action).toBe("https://box.test/");
      else expect(new URL(action!).pathname).toBe("/account");
      expect(
        suite.db.get<{ recipient: string }>(sql`select recipient from outgoing_mail`)?.recipient,
      ).toBe(purpose === "email_change" ? "changed@example.test" : "person@example.test");
    },
  );
});
