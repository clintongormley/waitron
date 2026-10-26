import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import type { Database } from "@waitron/db";
import { personalDataParts } from "@waitron/module";
import {
  INVOICE_CUSTOMER_README_WORDS,
  PERSONAL_DATA_README_WORDS,
} from "./i18n/personal-data-readme.js";
import { actionsPersonalData } from "./personal-data-actions.js";
import {
  invoiceCustomerReadme,
  personalDataReadme,
  type InvoiceCustomerReadmeInput,
  type PersonalDataReadmeInput,
} from "./personal-data-readme.js";
import { timeRecordPersonalData } from "./personal-data-time-record.js";

const base: PersonalDataReadmeInput = {
  language: "en",
  venue: "Example Bar S.L.",
  person: "Marta López",
  date: "2026-10-05",
  privacyNoticeUrl: "https://examplebar.example/privacy",
  files: ["profile.json", "sign-in.json"],
};

const PROFILE_LINE =
  "- profile.json: your name, contact details, language, role and account status, and any device profile set to let you in or keep you out. Used to run the venue, contact you and decide what you may do.";
const SIGN_IN_LINE =
  "- sign-in.json: how you sign in: whether you have a PIN, a password, an authenticator app or a Google login (never the secrets themselves), your passkeys, how many recovery codes you have, your sign-ins, the account emails issued to you and any setup you started but did not finish. Used to keep your account secure.";
const MACHINE = "The .json files are a machine-readable copy you can take to another service.";
const ORIGIN = `Where it came from
You, or a supervisor, manager or admin at the venue, entered your details, or they were imported when the box was set up; the rest was recorded automatically as you used Waitron.`;
const BACKUP =
  "- If the venue has set up backups, they hold a copy of the whole database, this data included, wherever the venue keeps them.";
const CONFIG_EXPORT =
  "- A manager or admin can download a configuration export that holds your name, contact details, language, role and account status, and any device profile set to let you in or keep you out, including after you leave; they protect it with a passphrase they choose.";
const EMAIL =
  "- Account emails (invitations, password resets and email-change codes) are sent through the email service the venue set up, when it has one.";
const GOOGLE =
  "- If you link a Google login, the box asks Google to confirm who you are each time you link or use it, and keeps Google's identifier for your account; this file says only whether one is linked.";
const PROFILE_KEPT =
  "- Your profile stays on the box after your account is disabled: nothing in the box deletes it.";
const DISABLE_KEPT =
  "- When your account is disabled, your PIN, password, passkeys, authenticator app, recovery codes and Google login are deleted from the box.";
const SESSIONS_KEPT = "- Your sign-in sessions stay on the box after they end.";
const CLEANUP_KEPT =
  "- The record of an account email that was used or has expired is deleted when another of the same kind is issued to you; an unfinished Google link is deleted the next time anyone starts a Google sign-in or link after it has expired.";
const DECIDES = "- Ask the venue how long it keeps your data and why; its privacy notice may say.";
const RIGHTS = `Your rights
You may ask the venue to correct or delete your data, to limit its use, or to give you another copy in a form you can take to another service, and you may object to its use. It must answer within one month; if it needs longer, up to two more months, it must tell you so, and why, within that first month. You may also complain to a data-protection authority.`;
const HEAD = `Your data held by Example Bar S.L.
Prepared for Marta López on 2026-10-05.`;
const ASK =
  "Contact Example Bar S.L. to ask. Its privacy notice: https://examplebar.example/privacy";

function spanishReadme(files: readonly string[]): string {
  const w = PERSONAL_DATA_README_WORDS.es;
  const words = files.map((name) => w.files[name]!);
  const venue = "Example Bar S.L.";
  const lines = [
    w.title.replace("{venue}", () => venue),
    w.prepared.replace("{name}", () => "Marta López").replace("{date}", () => "2026-10-05"),
    "",
    w.filesHeading,
    ...files.map((name, index) => `- ${name}: ${words[index]!.holds} ${words[index]!.use}`),
    w.machineReadable,
    "",
    w.originHeading,
    w.origin,
    "",
    w.sentToHeading,
    `- ${w.backup}`,
    ...words.flatMap((file) => file.sentTo ?? []).map((s) => `- ${s}`),
    "",
    w.keptHeading,
    ...words.flatMap((file) => file.kept ?? []).map((s) => `- ${s}`),
    `- ${w.decides}`,
    "",
    w.rightsHeading,
    w.rights,
    `${w.ask.replace("{venue}", () => venue)} ${w.notice.replace("{url}", () => "https://examplebar.example/privacy")}`,
  ];
  return `${lines.join("\n")}\n`;
}

describe("personalDataReadme", () => {
  it("writes every section in English", () => {
    expect(personalDataReadme(base)).toBe(`${HEAD}

What each file holds
${PROFILE_LINE}
${SIGN_IN_LINE}
${MACHINE}

${ORIGIN}

Who else receives it
${BACKUP}
${CONFIG_EXPORT}
${EMAIL}
${GOOGLE}

How long it is kept
${PROFILE_KEPT}
${DISABLE_KEPT}
${SESSIONS_KEPT}
${CLEANUP_KEPT}
${DECIDES}

${RIGHTS}
${ASK}
`);
  });

  it("writes every section in Spanish from the Spanish words", () => {
    const w = PERSONAL_DATA_README_WORDS.es;
    const profile = w.files["profile.json"]!;
    const signIn = w.files["sign-in.json"]!;
    expect(profile.sentTo).toHaveLength(1);
    expect(signIn.sentTo).toHaveLength(2);
    expect(profile.kept).toHaveLength(1);
    expect(signIn.kept).toHaveLength(3);
    expect(personalDataReadme({ ...base, language: "es" })).toBe(
      spanishReadme(["profile.json", "sign-in.json"]),
    );
  });

  it("never prints a double full stop after a legal name ending in one", () => {
    for (const language of ["en", "es"] as const) {
      const lines = personalDataReadme({ ...base, language }).split("\n");
      expect(
        lines.filter((line) => line.includes("..")),
        language,
      ).toEqual([]);
    }
  });

  it("leaves out the files block and every file's lines when there are no files", () => {
    expect(personalDataReadme({ ...base, files: [] })).toBe(`${HEAD}

${ORIGIN}

Who else receives it
${BACKUP}

How long it is kept
${DECIDES}

${RIGHTS}
${ASK}
`);
  });

  it("prints only the lines of the one file present", () => {
    expect(personalDataReadme({ ...base, files: ["profile.json"] })).toBe(`${HEAD}

What each file holds
${PROFILE_LINE}
${MACHINE}

${ORIGIN}

Who else receives it
${BACKUP}
${CONFIG_EXPORT}

How long it is kept
${PROFILE_KEPT}
${DECIDES}

${RIGHTS}
${ASK}
`);
  });

  it("names a file with no words alone", () => {
    expect(personalDataReadme({ ...base, files: ["profile.json", "extra.json"] })).toBe(`${HEAD}

What each file holds
${PROFILE_LINE}
- extra.json
${MACHINE}

${ORIGIN}

Who else receives it
${BACKUP}
${CONFIG_EXPORT}

How long it is kept
${PROFILE_KEPT}
${DECIDES}

${RIGHTS}
${ASK}
`);
  });

  it("prints no machine-readable line when no file ends .json", () => {
    expect(personalDataReadme({ ...base, files: ["notes.csv"] })).toBe(`${HEAD}

What each file holds
- notes.csv

${ORIGIN}

Who else receives it
${BACKUP}

How long it is kept
${DECIDES}

${RIGHTS}
${ASK}
`);
  });

  it("treats a file named after an inherited object key as a file with no words", () => {
    expect(personalDataReadme({ ...base, files: ["constructor"] })).toBe(`${HEAD}

What each file holds
- constructor

${ORIGIN}

Who else receives it
${BACKUP}

How long it is kept
${DECIDES}

${RIGHTS}
${ASK}
`);
  });

  it("names the venue generically and ends at the ask line with no name and no notice", () => {
    const { privacyNoticeUrl: _omitted, ...rest } = base;
    void _omitted;
    const text = personalDataReadme({ ...rest, venue: null, files: [] });
    expect(text).toBe(`Your data held by the venue
Prepared for Marta López on 2026-10-05.

${ORIGIN}

Who else receives it
${BACKUP}

How long it is kept
${DECIDES}

${RIGHTS}
Contact the venue to ask.
`);
  });

  it("puts the venue and person in literally, replacement patterns included", () => {
    const text = personalDataReadme({ ...base, venue: "$& Bar", person: "$1 Ana", files: [] });
    expect(text).toBe(`Your data held by $& Bar
Prepared for $1 Ana on 2026-10-05.

${ORIGIN}

Who else receives it
${BACKUP}

How long it is kept
${DECIDES}

${RIGHTS}
Contact $& Bar to ask. Its privacy notice: https://examplebar.example/privacy
`);
  });

  // Weaker than its name: it sees module parts only, not a file the server adds itself.
  it("has words in both languages for every module file", () => {
    const names = personalDataParts(ALL_MODULES).flatMap((p) => p.part.files);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(PERSONAL_DATA_README_WORDS.en.files[name], `en ${name}`).toBeDefined();
      expect(PERSONAL_DATA_README_WORDS.es.files[name], `es ${name}`).toBeDefined();
    }
    const en = PERSONAL_DATA_README_WORDS.en.files;
    const es = PERSONAL_DATA_README_WORDS.es.files;
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    for (const name of Object.keys(en)) {
      expect(es[name]?.sentTo?.length ?? 0, `${name} sentTo`).toBe(en[name]?.sentTo?.length ?? 0);
      expect(es[name]?.kept?.length ?? 0, `${name} kept`).toBe(en[name]?.kept?.length ?? 0);
    }
  });
  it("has words in both languages for every file the server adds itself", () => {
    const stubDb = {} as Database;
    const names = [...timeRecordPersonalData(ALL_MODULES), ...actionsPersonalData(stubDb)].flatMap(
      (p) => p.part.files,
    );
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(PERSONAL_DATA_README_WORDS.en.files[name], `en ${name}`).toBeDefined();
      expect(PERSONAL_DATA_README_WORDS.es.files[name], `es ${name}`).toBeDefined();
    }
  });

  const WORKFORCE_FILES = [
    "profile.json",
    "sign-in.json",
    "employment.json",
    "rota.json",
    "absences.json",
    "attendance.json",
    "staff-roles.json",
    "time-record.pdf",
    "time-record.csv",
  ];

  it("writes every section in English with the workforce and time-record files", () => {
    expect(personalDataReadme({ ...base, files: WORKFORCE_FILES })).toBe(`${HEAD}

What each file holds
${PROFILE_LINE}
${SIGN_IN_LINE}
- employment.json: your employment contracts: the contract type, contracted minutes per week, start and end dates and pay rate. Used to manage your employment and pay; your contracted minutes are the baseline for overtime.
- rota.json: your shifts (their times, location and the state of the rota each is on), the availability recorded for you, and the shift swaps you asked for or were offered, with the other person's name and who decided them. Used to plan the rota.
- absences.json: your absences: the kind (holiday, sick leave, other leave or unpaid), the dates, whether it was approved, who decided it and any note. Used to plan the rota around your time off.
- attendance.json: the questions the box asked you about missing clock-in or clock-out times or an automatic clock-out, the reminder email about a question on missing times, if the box prepared one, the answers you or a supervisor, manager or admin gave and who authorised them, and the activity (sign-ins, orders, payments, breaks) the box records to notice them. Used to keep your working-time record complete.
- staff-roles.json: the staff roles you can fill, and the area and staff role of each of your shifts that has been given one. Used to plan who covers each area.
- time-record.pdf: your working-time record at this venue: when you started and finished work, your breaks, every correction and decision, and the closed periods, as the working-time export shows it. Kept as the venue's record of the hours you worked.
- time-record.csv: the same working-time record as time-record.pdf, as a spreadsheet file. Kept as the venue's record of the hours you worked.
${MACHINE}

${ORIGIN}

Who else receives it
${BACKUP}
${CONFIG_EXPORT}
${EMAIL}
${GOOGLE}
- A manager or admin can download a configuration export that holds your employment contracts, pay rate included, including after you leave.
- A manager or admin can download a configuration export that holds your availability, including after you leave.
- Reminder emails are sent through the email service the venue set up, when it has one.
- A manager or admin can download a configuration export that holds the staff roles you can fill, including after you leave.
- A manager or admin can download the working-time record, yours included; the record names who has the right to see it.

How long it is kept
${PROFILE_KEPT}
${DISABLE_KEPT}
${SESSIONS_KEPT}
${CLEANUP_KEPT}
- Nothing in the box deletes an employment contract.
- A shift can be deleted only while its rota is a draft or while it is on no rota, and deleting it deletes the swaps that offer it; nothing in the box deletes your availability or your other swaps.
- Nothing in the box deletes an absence.
- Nothing in the box deletes these questions, emails, answers or activity records.
- A staff role is taken from you when a manager or admin changes who holds it or deletes the role; a shift's area and role are deleted with the shift.
- Nothing in the box deletes your working-time record, and the box refuses to change or delete an entry in it: a correction is added as a new entry.
- The record's "Keep until" date marks the end of the legal keeping time counted from the end of the period this copy covers, not from each entry's date.
${DECIDES}

${RIGHTS}
${ASK}
`);
  });

  it("writes every section in Spanish with the workforce and time-record files", () => {
    const w = PERSONAL_DATA_README_WORDS.es;
    const words = WORKFORCE_FILES.map((name) => ({ name, file: w.files[name] }));
    for (const { name, file } of words) expect(file, name).toBeDefined();
    expect(words.flatMap(({ file }) => file!.sentTo ?? [])).toHaveLength(8);
    expect(words.flatMap(({ file }) => file!.kept ?? [])).toHaveLength(11);
    expect(personalDataReadme({ ...base, language: "es", files: WORKFORCE_FILES })).toBe(
      spanishReadme(WORKFORCE_FILES),
    );
  });

  it("prints the time record's shared lines once when both its files are present", () => {
    const lines = personalDataReadme({
      ...base,
      files: ["time-record.pdf", "time-record.csv"],
    }).split("\n");
    expect(
      lines.filter((line) =>
        line.startsWith("- A manager or admin can download the working-time record"),
      ),
    ).toHaveLength(1);
    expect(
      lines.filter((line) => line.startsWith('- The record\'s "Keep until" date')),
    ).toHaveLength(1);
  });

  const ACTIONS_FILES_SET = ["profile.json", "sign-in.json", "actions.json"];

  it("writes every section in English with the actions file", () => {
    expect(personalDataReadme({ ...base, files: ACTIONS_FILES_SET })).toBe(`${HEAD}

What each file holds
${PROFILE_LINE}
${SIGN_IN_LINE}
- actions.json: the whole sales already recorded whose void you authorised, the refunds you asked for, authorised or recorded the outcome of, and the cash-drawer openings you made or authorised: how many of each; for each one, the invoice number where there is one, the amount where there is one and when it happened; for each refund, the tip it gave back, whether it was cash or card and whether it went through, failed or is still waiting; for each opening, why the drawer opened and whether another person authorised it for the person who opened it; and for each refund and opening, your part in it. Kept to account for the money the venue takes and gives back.
${MACHINE}

${ORIGIN}

Who else receives it
${BACKUP}
${CONFIG_EXPORT}
${EMAIL}
${GOOGLE}

How long it is kept
${PROFILE_KEPT}
${DISABLE_KEPT}
${SESSIONS_KEPT}
${CLEANUP_KEPT}
- Nothing in the box deletes a voided sale, a refund or a cash-drawer opening.
${DECIDES}

${RIGHTS}
${ASK}
`);
  });

  it("writes every section in Spanish with the actions file", () => {
    const w = PERSONAL_DATA_README_WORDS.es;
    const words = ACTIONS_FILES_SET.map((name) => ({ name, file: w.files[name] }));
    for (const { name, file } of words) expect(file, name).toBeDefined();
    const actions = w.files["actions.json"]!;
    expect(actions.sentTo).toBeUndefined();
    expect(actions.kept).toHaveLength(1);
    expect(personalDataReadme({ ...base, language: "es", files: ACTIONS_FILES_SET })).toBe(
      spanishReadme(ACTIONS_FILES_SET),
    );
  });

  const ADJUSTMENTS_FILES_SET = ["profile.json", "sign-in.json", "adjustments.json"];

  it("writes every section in English with the adjustments file", () => {
    expect(personalDataReadme({ ...base, files: ADJUSTMENTS_FILES_SET })).toBe(`${HEAD}

What each file holds
${PROFILE_LINE}
${SIGN_IN_LINE}
- adjustments.json: the voids, comps and discounts on a bill that you made giving a reason, or approved for someone else: how many of each kind (cancel for a void, comp for an item given free, discount_percent and discount_amount); for each one, when it happened, the order number, the item and how much of it (none for a discount on the whole bill), the percentage of a percentage discount, the amount it took off the bill, the list value of what it applied to (the item, or the whole bill), the reason chosen, how far the item had got (unsent, held, fired or served), whether the charge was kept, whether preparation had started, and your part in it. Kept to account for what is taken off the venue's bills, and who decided it.
${MACHINE}

${ORIGIN}

Who else receives it
${BACKUP}
${CONFIG_EXPORT}
${EMAIL}
${GOOGLE}

How long it is kept
${PROFILE_KEPT}
${DISABLE_KEPT}
${SESSIONS_KEPT}
${CLEANUP_KEPT}
- Nothing in the box deletes or changes a void, comp or discount once it is recorded.
${DECIDES}

${RIGHTS}
${ASK}
`);
  });

  it("writes every section in Spanish with the adjustments file", () => {
    const w = PERSONAL_DATA_README_WORDS.es;
    const words = ADJUSTMENTS_FILES_SET.map((name) => ({ name, file: w.files[name] }));
    for (const { name, file } of words) expect(file, name).toBeDefined();
    const adjustments = w.files["adjustments.json"]!;
    expect(adjustments.sentTo).toBeUndefined();
    expect(adjustments.kept).toHaveLength(1);
    expect(personalDataReadme({ ...base, language: "es", files: ADJUSTMENTS_FILES_SET })).toBe(
      spanishReadme(ADJUSTMENTS_FILES_SET),
    );
  });
});

const jordi: InvoiceCustomerReadmeInput = {
  language: "en",
  venue: "Example Bar S.L.",
  customer: "Jordi Puig",
  date: "2026-10-26",
  privacyNoticeUrl: "https://examplebar.example/privacy",
  anyTaxRecord: true,
  anyEmail: true,
};

const INVOICE_TAX_RECORD =
  '- For each invoice marked "taxRecord": true in invoices.json, the box keeps a tax record that it sends to the tax authority (in Spain, the Agencia Tributaria); that record holds your name and tax number, not your address.';
const INVOICE_EMAIL =
  "- Invoices emailed to you are sent through the email service the venue set up.";

describe("invoiceCustomerReadme", () => {
  it("writes every section in English", () => {
    expect(invoiceCustomerReadme(jordi)).toBe(`Your data held by Example Bar S.L.
Prepared for Jordi Puig on 2026-10-26.

What each file holds
- invoices.json: the full invoices the venue issued to your tax number: for each one, its number, when it was issued, the name, tax number, country and address on it, its total, the PDF copy in this download, whether the box keeps a tax record of it, and each email address it was sent to, with when the email was asked for, whether it went and when. Kept because an invoice must name its customer and the venue must keep a copy of each invoice it issues.
- invoices/: a copy of each of those invoices as a PDF, marked as a copy.
${MACHINE}
This copy holds your full invoices and the emails that sent them. The box also keeps the details staff typed for an invoice on the bill itself and in printer records; ask the venue for those. Anything else the venue holds about you, such as a booking, is not found by tax number.

Where it came from
Staff at the venue entered your name, tax number and address when you asked for a full invoice; the rest was recorded as each invoice was issued and sent.

Who else receives it
${BACKUP}
${INVOICE_TAX_RECORD}
${INVOICE_EMAIL}

How long it is kept
- Nothing in the box deletes or changes an issued invoice: the box refuses to.
- Nothing in the box deletes the record of an invoice email.
${DECIDES}

${RIGHTS}
${ASK}
`);
  });

  it("writes every section in Spanish from the Spanish words", () => {
    const w = PERSONAL_DATA_README_WORDS.es;
    const own = INVOICE_CUSTOMER_README_WORDS.es;
    const venue = "Example Bar S.L.";
    const lines = [
      w.title.replace("{venue}", () => venue),
      w.prepared.replace("{name}", () => "Jordi Puig").replace("{date}", () => "2026-10-26"),
      "",
      w.filesHeading,
      `- invoices.json: ${own.holds} ${own.use}`,
      `- invoices/: ${own.pdfs}`,
      w.machineReadable,
      own.notFound,
      "",
      w.originHeading,
      own.origin,
      "",
      w.sentToHeading,
      `- ${w.backup}`,
      `- ${own.taxRecord}`,
      `- ${own.email}`,
      "",
      w.keptHeading,
      ...own.kept.map((s) => `- ${s}`),
      `- ${w.decides}`,
      "",
      w.rightsHeading,
      w.rights,
      `${w.ask.replace("{venue}", () => venue)} ${w.notice.replace("{url}", () => "https://examplebar.example/privacy")}`,
    ];
    expect(own.kept).toHaveLength(2);
    expect(invoiceCustomerReadme({ ...jordi, language: "es" })).toBe(`${lines.join("\n")}\n`);
  });

  it("leaves out the tax-record and email lines when no invoice has either", () => {
    for (const language of ["en", "es"] as const) {
      const own = INVOICE_CUSTOMER_README_WORDS[language];
      const lines = invoiceCustomerReadme({
        ...jordi,
        language,
        anyTaxRecord: false,
        anyEmail: false,
      }).split("\n");
      const sentTo = lines.indexOf(PERSONAL_DATA_README_WORDS[language].sentToHeading);
      expect(lines.slice(sentTo, sentTo + 3)).toEqual([
        PERSONAL_DATA_README_WORDS[language].sentToHeading,
        `- ${PERSONAL_DATA_README_WORDS[language].backup}`,
        "",
      ]);
      expect(lines).not.toContain(`- ${own.taxRecord}`);
      expect(lines).not.toContain(`- ${own.email}`);
    }
  });

  it("prints only the tax-record line when no invoice was emailed", () => {
    const text = invoiceCustomerReadme({ ...jordi, anyEmail: false });
    expect(text).toContain(`${BACKUP}\n${INVOICE_TAX_RECORD}\n\nHow long it is kept`);
  });

  it("prints only the email line when no invoice has a tax record", () => {
    const text = invoiceCustomerReadme({ ...jordi, anyTaxRecord: false });
    expect(text).toContain(`${BACKUP}\n${INVOICE_EMAIL}\n\nHow long it is kept`);
  });

  it("puts the venue and customer in literally, replacement patterns included", () => {
    const lines = invoiceCustomerReadme({
      ...jordi,
      venue: "Bar $& $1 S.L.",
      customer: "Jordi $& Puig",
    }).split("\n");
    expect(lines[0]).toBe("Your data held by Bar $& $1 S.L.");
    expect(lines[1]).toBe("Prepared for Jordi $& Puig on 2026-10-26.");
    expect(lines.at(-2)).toBe(
      "Contact Bar $& $1 S.L. to ask. Its privacy notice: https://examplebar.example/privacy",
    );
  });

  it("names the venue generically and ends at the ask line with no name and no notice", () => {
    const { privacyNoticeUrl: _, ...noNotice } = jordi;
    const lines = invoiceCustomerReadme({ ...noNotice, venue: null }).split("\n");
    expect(lines[0]).toBe("Your data held by the venue");
    expect(lines.at(-2)).toBe("Contact the venue to ask.");
  });

  it("has the same words in both languages", () => {
    expect(Object.keys(INVOICE_CUSTOMER_README_WORDS.es).sort()).toEqual(
      Object.keys(INVOICE_CUSTOMER_README_WORDS.en).sort(),
    );
    expect(INVOICE_CUSTOMER_README_WORDS.es.kept).toHaveLength(
      INVOICE_CUSTOMER_README_WORDS.en.kept.length,
    );
  });
});
