import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, persons, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { completeAccountAction, queueAccountMail } from "@waitron/identity";
import { ACCOUNT_EMAIL_WORDS } from "./i18n/account-email.js";
import { accountActionMail } from "./account-mail.js";
import { runMailPass, type MailSenderDeps } from "./mail-sender.js";

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
    await suite.db
      .insert(persons)
      .values({ id: personId, displayName: "Recipient", email: "person@example.test" });
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
  it("makes a working reset link at send and never stores it in the queue", async () => {
    await queue();
    expect(suite.db.all(sql`select * from management_account_actions`)).toEqual([]);
    await suite.db.run(
      sql`update outgoing_mail set next_attempt_at = '2026-11-09T12:15:00.001Z' where person_id=${personId}`,
    );
    time = new Date("2026-11-09T12:05:00.000Z");
    await runMailPass(deps);
    expect(connections).toEqual(["smtp://mail.test"]);
    const link = new URL(messages[0]!.split("\n").find((line) => line.startsWith("https://"))!);
    expect(link.pathname).toBe("/manage/account");
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
  it.each(["invitation", "email_change"] as const)(
    "composes %s with its current address and locale",
    async (purpose) => {
      await suite.db.run(
        sql`update persons set status=${purpose === "invitation" ? "pending" : "active"}, pending_email='changed@example.test',locale='es-ES' where id=${personId}`,
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
      else expect(new URL(action!).pathname).toBe("/manage/account");
      expect(
        suite.db.get<{ recipient: string }>(sql`select recipient from outgoing_mail`)?.recipient,
      ).toBe(purpose === "email_change" ? "changed@example.test" : "person@example.test");
    },
  );
});
