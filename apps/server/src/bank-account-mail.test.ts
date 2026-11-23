import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { eq } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, outgoingMail, withTransaction } from "@waitron/db";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { maskIban } from "@waitron/shared";
import { queueBankAccountChangedMail } from "./bank-account-mail.js";
import { boxAlertMail } from "./box-alert-mail.js";
import { transientBoxAlertMail } from "./box-alert-email.js";
import { fillTemplate } from "./fill-template.js";
import { BANK_ACCOUNT_CHANGED_EMAIL_WORDS } from "./i18n/box-emails.js";
import { runMailPass, type MailSenderDeps } from "./mail-sender.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const now = new Date("2026-11-09T12:00:00.000Z");
const OLD = "ES9121000418450200051332";
const NEW = "GB82WEST12345698765432";
let editorId: string;
let otherId: string;

beforeEach(async () => {
  await seedVenue(suite.db, { name: "Corner Bistro" });
  const [editor, other] = await seedPersons(suite.db, [
    { displayName: "Ana Editor", role: "manager", email: "ana@example.test", locale: "es-ES" },
    { displayName: "Other admin", role: "admin", email: "other@example.test", locale: "en-GB" },
    { displayName: "No email admin", role: "admin", email: null },
  ]);
  editorId = editor!.id;
  otherId = other!.id;
});

async function queue(
  before: { iban: string; bankName: string | null } | null,
  after: { iban: string; bankName: string | null } | null,
) {
  await withTransaction(suite.db, (tx) =>
    queueBankAccountChangedMail(tx, {
      editorId,
      at: "2026-11-09T11:58:00.000Z",
      offsetMinutes: 60,
      before,
      after,
      venueLanguage: "en",
      activityId: "activity-1",
      now,
    }),
  );
}

const rows = () =>
  suite.db
    .select()
    .from(outgoingMail)
    .where(eq(outgoingMail.kind, "box_alert"))
    .orderBy(outgoingMail.dedupeKey);

function deps(send: MailSenderDeps["send"]): MailSenderDeps {
  return {
    db: suite.db,
    owners: [
      boxAlertMail({ previousEpisodeMailIds: new Set(), venueLanguage: "en", log: vi.fn() }),
    ],
    now: () => now,
    isPrimary: () => true,
    signal: new AbortController().signal,
    log: () => {},
    resolveDelivery: async () => ({
      mode: "smtp",
      smtp: { url: "smtp://mail.test", from: "from@example.test" },
    }),
    send,
  };
}

async function sendAll(send: MailSenderDeps["send"]) {
  while ((await runMailPass(deps(send))).processed);
}

it("queues one lasting box alert per administrator with an email, naming masked accounts", async () => {
  await queue({ iban: OLD, bankName: "Openbank" }, { iban: NEW, bankName: null });
  const queued = await rows();
  expect(queued.map((row) => [row.dedupeKey, row.personId, row.subjectId])).toEqual(
    [
      [`bank-account:activity-1:${editorId}`, editorId, null],
      [`bank-account:activity-1:${otherId}`, otherId, null],
    ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
  for (const row of queued) {
    expect(row.notAfter).toBe("2026-11-10T12:00:00.000Z");
    expect(row.params).toEqual({
      code: "venue.bank_account_changed",
      wording: JSON.stringify({
        editorId,
        changedAt: "2026-11-09T11:58:00.000Z",
        changedAtOffset: 60,
        previousAccount: maskIban(OLD),
        newAccount: maskIban(NEW),
      }),
    });
    expect(JSON.stringify(row.params)).not.toContain(NEW);
    expect(JSON.stringify(row.params)).not.toContain(OLD);
  }
  const transient = await suite.db.select().from(outgoingMail).where(transientBoxAlertMail());
  expect(transient).toEqual([]);
});

it("sends each administrator the change in their own language, never the full account", async () => {
  await queue(null, { iban: NEW, bankName: "Openbank" });
  const send = vi.fn(async () => ({ status: "sent" as const }));
  await sendAll(send);
  expect(send).toHaveBeenCalledTimes(2);
  const sent = new Map(
    (send.mock.calls as unknown as [unknown, { to: string; subject: string; text: string }][]).map(
      ([, message]) => [message.to, message],
    ),
  );
  for (const [to, language] of [
    ["ana@example.test", "es"],
    ["other@example.test", "en"],
  ] as const) {
    const words = BANK_ACCOUNT_CHANGED_EMAIL_WORDS[language];
    const message = sent.get(to)!;
    expect(message.subject).toBe(fillTemplate(words.subject, { venue: "Corner Bistro" }));
    expect(message.text).toContain("Ana Editor");
    expect(message.text).toContain("09/11/2026");
    expect(message.text).toContain(fillTemplate(words.previous, { previousAccount: words.none }));
    expect(message.text).toContain(fillTemplate(words.current, { newAccount: maskIban(NEW) }));
    expect(message.text).toContain(words.check);
    expect(message.text).not.toContain(NEW);
    expect(message.text).not.toMatch(/\{\w+\}/);
  }
});

it("names a cleared account as none", async () => {
  await queue({ iban: OLD, bankName: null }, null);
  const send = vi.fn(async () => ({ status: "sent" as const }));
  await sendAll(send);
  const texts = (send.mock.calls as unknown as [unknown, { text: string }][]).map(
    ([, message]) => message.text,
  );
  expect(texts).toHaveLength(2);
  const words = BANK_ACCOUNT_CHANGED_EMAIL_WORDS.en;
  expect(
    texts.some((text) => text.includes(fillTemplate(words.current, { newAccount: words.none }))),
  ).toBe(true);
  for (const text of texts) expect(text).not.toContain(OLD);
});
