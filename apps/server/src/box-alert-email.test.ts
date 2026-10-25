import { describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, incidents } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  boxEmailMessage,
  isBoxEmailCode,
  readOpenClockIncidents,
  STORAGE_EMAIL_CODES,
  type BoxEmailCode,
} from "./box-alert-email.js";
import {
  BOX_EMAIL_WORDS,
  CLOCK_CONFIRMED_BY_WORDS,
  CLOCK_MISDATED_EMAIL_WORDS,
  CLOCK_RESTARTED_EMAIL_WORDS,
} from "./i18n/box-emails.js";

const CODES = Object.keys(BOX_EMAIL_WORDS) as BoxEmailCode[];
const LANGUAGES = ["en", "es"] as const;
const CASES = CODES.flatMap((code) => LANGUAGES.map((language) => [code, language] as const));

describe("boxEmailMessage", () => {
  it.each(CASES)("words %s in %s with the venue's name", (code, language) => {
    const message = boxEmailMessage(code, language, "Corner Bistro", {
      clockAt: "2025-03-14T08:12:00.000Z",
      offsetMinutes: 60,
      lastRecordAt: "2026-10-18T21:40:00.000Z",
      lastRecordOffsetMinutes: 120,
    });
    const words = BOX_EMAIL_WORDS[code][language];
    const filled = (template: string) =>
      template
        .replaceAll("{venue}", "Corner Bistro")
        .replaceAll("{clockAt}", "14/03/2025 09:12")
        .replaceAll("{lastRecordAt}", "18/10/2026 23:40");
    expect(message).toEqual({
      subject: filled(words.subject),
      text: filled(words.text),
    });
    expect(message.subject).not.toContain("{");
    expect(message.text).not.toContain("{");
  });

  it("keeps a venue name that looks like a replacement pattern", () => {
    const message = boxEmailMessage("storage.disk_full", "en", "$& Bar");
    expect(message.subject).toContain("$& Bar");
    expect(message.text).toContain("$& Bar");
  });

  it("every code has a subject and a text in both languages, none blank", () => {
    expect(CODES.length).toBeGreaterThan(0);
    for (const code of CODES) {
      for (const language of LANGUAGES) {
        expect(BOX_EMAIL_WORDS[code][language].subject.trim()).not.toBe("");
        expect(BOX_EMAIL_WORDS[code][language].text.trim()).not.toBe("");
      }
    }
  });

  it("tells the storage codes from the rest", () => {
    expect(isBoxEmailCode("clock.unusable")).toBe(true);
    expect(isBoxEmailCode("fiscal.records_unsent")).toBe(false);
    expect(isBoxEmailCode("clock.behind_chain")).toBe(true);
    expect(STORAGE_EMAIL_CODES).toEqual(["storage.space_low", "storage.disk_full"]);
  });
});

describe("boxEmailMessage for a clock stop", () => {
  const PARAMS = {
    clockAt: "2025-03-14T08:12:00.000Z",
    offsetMinutes: 60,
    lastRecordAt: "2026-10-18T21:40:00.000Z",
    lastRecordOffsetMinutes: 120,
  };

  it("writes both times, each in its own offset, in English", () => {
    expect(boxEmailMessage("clock.behind_chain", "en", "Corner Bistro", PARAMS)).toEqual({
      subject:
        "Payments stopped at Corner Bistro: the box's clock reads earlier than its last sale",
      text: "The box's clock (14/03/2025 09:12) reads earlier than its last recorded sale (18/10/2026 23:40). Since then no device can take payment. Orders can still be taken and sent to the kitchen. What to do: • If the box's clock is wrong (usual after a power cut): connect the box to the internet so it corrects itself, or call whoever installed it. • If you think the box's clock is right: look at the Box status page (in the dashboard, Settings → Box status), where an administrator can confirm the clock with their own phone; with the internet or two tills switched on, the box does it by itself.",
    });
  });

  it("writes both times, each in its own offset, in Spanish", () => {
    const words = BOX_EMAIL_WORDS["clock.behind_chain"].es;
    expect(words.text).toContain("({clockAt})");
    expect(words.text).toContain("({lastRecordAt})");
    expect(boxEmailMessage("clock.behind_chain", "es", "Corner Bistro", PARAMS)).toEqual({
      subject: words.subject.replaceAll("{venue}", "Corner Bistro"),
      text: words.text
        .replaceAll("{clockAt}", "14/03/2025 09:12")
        .replaceAll("{lastRecordAt}", "18/10/2026 23:40"),
    });
  });

  it("keeps the wall clock of each offset whatever the host's zone", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    try {
      const { text } = boxEmailMessage("clock.behind_chain", "en", "Corner Bistro", PARAMS);
      expect(text).toContain("(14/03/2025 09:12)");
      expect(text).toContain("(18/10/2026 23:40)");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("boxEmailMessage for payments restarted", () => {
  const RESTARTED = {
    confirmationId: "c-1",
    person: null,
    clockAt: "2025-03-14T08:12:00.000Z",
    lastRecordAt: "2026-10-18T21:40:00.000Z",
  };

  const ES = CLOCK_RESTARTED_EMAIL_WORDS.es;

  it.each([
    ["authority", "the tax agency's time"],
    ["devices", "two tills or handhelds"],
    ["admin", "an administrator"],
  ] as const)("names what confirmed the clock (%s) in both languages", (confirmedBy, en) => {
    const params = { ...RESTARTED, confirmedBy };
    expect(boxEmailMessage("clock.behind_chain_restarted", "en", "Corner Bistro", params)).toEqual({
      subject: "Payments restarted at Corner Bistro",
      text: `The box's clock was confirmed by ${en} and payments started again. Sales recorded with a later time than the real one are listed on the Box status page (in the dashboard, Settings → Box status).`,
    });
    expect(boxEmailMessage("clock.behind_chain_restarted", "es", "Corner Bistro", params)).toEqual({
      subject: ES.subject.replaceAll("{venue}", "Corner Bistro"),
      text: ES.text.replaceAll("{confirmedBy}", CLOCK_CONFIRMED_BY_WORDS.es[confirmedBy]),
    });
  });

  it("words a source it does not know as a check recorded on the box", () => {
    const params = { ...RESTARTED, confirmedBy: "sundial" };
    expect(
      boxEmailMessage("clock.behind_chain_restarted", "en", "Corner Bistro", params).text,
    ).toContain("confirmed by a check recorded on the box and");
    expect(
      boxEmailMessage("clock.behind_chain_restarted", "es", "Corner Bistro", params).text,
    ).toBe(ES.text.replaceAll("{confirmedBy}", CLOCK_CONFIRMED_BY_WORDS.es.otherwise));
  });
});

describe("boxEmailMessage for wrongly dated sales", () => {
  const LISTED = {
    confirmationId: "c-1",
    count: 3,
    from: "2026-10-18T19:05:00.000Z",
    fromOffsetMinutes: 120,
    to: "2026-10-26T09:30:00.000Z",
    toOffsetMinutes: 60,
    partial: false,
    unconfirmed: false,
  };
  const ES = CLOCK_MISDATED_EMAIL_WORDS.es;
  const SUBJECT = {
    en: "Sales dated wrongly at Corner Bistro: check them with your tax adviser",
    es: ES.subject.replaceAll("{venue}", "Corner Bistro"),
  };

  it("counts the sales and writes each end in its own offset, in both languages", () => {
    expect(boxEmailMessage("clock.records_misdated", "en", "Corner Bistro", LISTED)).toEqual({
      subject: SUBJECT.en,
      text: "3 sales were recorded with a time later than the real time, from 18/10/2026 21:05 to 26/10/2026 10:30. They stay as recorded. The list is on the Box status page; go through it with your tax adviser and then mark the alert as handled.",
    });
    expect(boxEmailMessage("clock.records_misdated", "es", "Corner Bistro", LISTED)).toEqual({
      subject: SUBJECT.es,
      text: ES.text
        .replace("{count}", "3")
        .replace("{from}", "18/10/2026 21:05")
        .replace("{to}", "26/10/2026 10:30"),
    });
  });

  it("says the list may be short after the text when it is partial", () => {
    const params = { ...LISTED, partial: true };
    expect(boxEmailMessage("clock.records_misdated", "en", "Corner Bistro", params).text).toMatch(
      /mark the alert as handled\. The box restarted during the stop, so the list may be short\.$/,
    );
    expect(boxEmailMessage("clock.records_misdated", "es", "Corner Bistro", params).text).toBe(
      `${boxEmailMessage("clock.records_misdated", "es", "Corner Bistro", LISTED).text} ${ES.partial}`,
    );
  });

  it("words a single sale as one, in both languages", () => {
    const params = { ...LISTED, count: 1, to: LISTED.from, toOffsetMinutes: 120 };
    const en = boxEmailMessage("clock.records_misdated", "en", "Corner Bistro", params);
    const es = boxEmailMessage("clock.records_misdated", "es", "Corner Bistro", params);
    expect(en).toEqual({
      subject: SUBJECT.en,
      text: "One sale was recorded with a time later than the real time, at 18/10/2026 21:05. It stays as recorded. The list is on the Box status page; go through it with your tax adviser and then mark the alert as handled.",
    });
    expect(es).toEqual({
      subject: SUBJECT.es,
      text: ES.one.replace("{from}", "18/10/2026 21:05"),
    });
    expect(ES.one).not.toContain("{count}");
    for (const { text } of [en, es]) expect(text).not.toMatch(/\b1 \p{L}/u);
  });

  it("says the box cannot tell which sales when nothing confirmed the clock, in both languages", () => {
    const params = {
      confirmationId: "c-2",
      count: 0,
      from: "2026-10-18T19:05:00.000Z",
      fromOffsetMinutes: 120,
      partial: false,
      unconfirmed: true,
    };
    const en = boxEmailMessage("clock.records_misdated", "en", "Corner Bistro", params);
    const es = boxEmailMessage("clock.records_misdated", "es", "Corner Bistro", params);
    expect(en).toEqual({
      subject: "Sales may be dated wrongly at Corner Bistro: check them with your tax adviser",
      text: "The payment stop that began at 18/10/2026 21:05 ended by itself, but nothing confirmed the box's clock, so the box cannot tell which sales were dated wrongly. Check the box's clock, and go through the sales since then with your tax adviser; then mark the alert as handled.",
    });
    expect(es).toEqual({
      subject: ES.unconfirmed.subject.replaceAll("{venue}", "Corner Bistro"),
      text: ES.unconfirmed.text.replace("{from}", "18/10/2026 21:05"),
    });
    expect(ES.unconfirmed.text).not.toMatch(/\{(count|to)\}/);
    expect(ES.unconfirmed.subject).not.toBe(ES.subject);
    for (const message of [en, es]) {
      expect(message.text).not.toMatch(/\b0 \p{L}/u);
      expect(message.text).not.toMatch(/\{|undefined/);
    }
    const partial = { ...params, partial: true };
    expect(boxEmailMessage("clock.records_misdated", "en", "Corner Bistro", partial)).toEqual(en);
  });
});

describe("every clock email", () => {
  const STOP = {
    clockAt: "2025-03-14T08:12:00.000Z",
    offsetMinutes: 60,
    lastRecordAt: "2026-10-18T21:40:00.000Z",
    lastRecordOffsetMinutes: 120,
  };
  const MISDATED = {
    confirmationId: "c-1",
    count: 3,
    from: "2026-10-18T19:05:00.000Z",
    fromOffsetMinutes: 120,
    to: "2026-10-26T09:30:00.000Z",
    toOffsetMinutes: 60,
    partial: false,
    unconfirmed: false,
  };
  const EMAILS = [
    ["clock.unusable", STOP],
    ["clock.behind_chain", STOP],
    ...(["authority", "devices", "admin", "someone else"] as const).map(
      (confirmedBy) =>
        ["clock.behind_chain_restarted", { confirmationId: "c-1", confirmedBy }] as const,
    ),
    ["clock.records_misdated", MISDATED],
    ["clock.records_misdated", { ...MISDATED, count: 1 }],
    ["clock.records_misdated", { ...MISDATED, partial: true }],
    ["clock.records_misdated", { ...MISDATED, count: 1, partial: true }],
    ["clock.records_misdated", { ...MISDATED, count: 0, unconfirmed: true }],
  ] as const;
  const EVERY = EMAILS.flatMap(([code, params]) =>
    LANGUAGES.map((language) => [code, language, params] as const),
  );

  it.each(EVERY)("leaves no placeholder brace in %s in %s (%o)", (code, language, params) => {
    const { subject, text } = boxEmailMessage(code, language, "Corner Bistro", params);
    expect(subject).not.toMatch(/[{}]/);
    expect(text).not.toMatch(/[{}]/);
  });
});

describe("readOpenClockIncidents", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it("reads the open restart and wrongly dated alerts, oldest first, and no handled or other one", async () => {
    const row = (code: string, detectedAt: string, acknowledgedAt: string | null = null) => ({
      source: "dashboard" as const,
      code,
      params: { at: detectedAt },
      severity: "warning" as const,
      detectedAt,
      acknowledgedAt,
    });
    await suite.db
      .insert(incidents)
      .values([
        row("clock.records_misdated", "2026-10-22T09:31:00.000Z"),
        row("clock.behind_chain_restarted", "2026-10-22T09:30:00.000Z"),
        row("clock.behind_chain_restarted", "2026-10-21T09:30:00.000Z", "2026-10-21T10:00:00.000Z"),
        row("clock.behind_chain", "2026-10-22T09:29:00.000Z"),
      ]);
    const open = await readOpenClockIncidents(suite.db);
    expect(open.map(({ code, params }) => ({ code, params }))).toEqual([
      { code: "clock.behind_chain_restarted", params: { at: "2026-10-22T09:30:00.000Z" } },
      { code: "clock.records_misdated", params: { at: "2026-10-22T09:31:00.000Z" } },
    ]);
    expect(open.every(({ id }) => typeof id === "string" && id !== "")).toBe(true);
  });
});
