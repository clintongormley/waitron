import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, incidents } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { formatDuration } from "@waitron/shared";
import {
  boxEmailMessage,
  isBoxEmailCode,
  readOpenEmailedIncidents,
  STORAGE_EMAIL_CODES,
  type BoxEmailCode,
} from "./box-alert-email.js";
import { BOX_EMAIL_WORDS, CLOCK_CORRECTED_EMAIL_WORDS } from "./i18n/box-emails.js";

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
    expect(STORAGE_EMAIL_CODES).toEqual(["storage.space_low", "storage.disk_full"]);
  });
});

describe("the full-disk email", () => {
  it("sends nobody elsewhere, and names the page that frees space", () => {
    const { en, es } = BOX_EMAIL_WORDS["storage.disk_full"];
    expect(en.text).not.toMatch(/install|support/i);
    expect(es.text).not.toMatch(/instal|soporte/i);
    expect(en.text).toContain("Settings → Box status");
    expect(es.text).toContain("Ajustes → Estado del servidor");
  });
});

describe("the clock stop emails", () => {
  it.each(["clock.unusable"] as const)(
    "%s sends nobody to whoever installed the box, and names the pages and button that fix it",
    (code) => {
      const { en, es } = BOX_EMAIL_WORDS[code];
      expect(en.text).not.toMatch(/install|support|manager/i);
      expect(es.text).not.toMatch(/instal|soporte|encargad|gerente/i);
      expect(en.text).toContain("an administrator can usually set it");
      expect(es.text).toContain("un administrador normalmente puede ponerla en hora");
      expect(en.text).toContain("Settings → Box status");
      expect(es.text).toContain("Ajustes → Estado del servidor");
      expect(en.text).toContain("“Check the time”");
      expect(es.text).toContain("«Comprobar la hora»");
    },
  );
});

describe("the clock stop emails' till offer", () => {
  it.each(["clock.unusable"] as const)(
    "%s offers a till for a stop the box started with, never for one just after a start",
    (code) => {
      const { en, es } = BOX_EMAIL_WORDS[code];
      expect(en.text).not.toMatch(/just started|just after a start/);
      expect(es.text).not.toMatch(/acaba de arrancar|justo después de arrancar/);
      expect(en.text).toMatch(/if the box started with (its clock wrong|payments stopped)/);
      expect(es.text).toMatch(/si el servidor arrancó con (la hora mal|los cobros parados)/);
    },
  );
});

describe("boxEmailMessage for the box setting its clock", () => {
  const DAY = 86_400_000;
  const STEP = {
    confirmationId: "c-step",
    source: "admin",
    person: "Ben",
    deviceId: null,
    device: null,
    before: "2025-03-14T08:12:00.000Z",
    beforeOffsetMinutes: 60,
    after: "2026-10-18T21:40:00.000Z",
    afterOffsetMinutes: 120,
    stepMs: 2 * DAY + 3 * 3_600_000,
    direction: "forward",
    verified: true,
    unverified: false,
    byAdmin: true,
    byStaff: false,
  };
  const ES = CLOCK_CORRECTED_EMAIL_WORDS.es;
  const message = (language: "en" | "es", params: Record<string, unknown>) =>
    boxEmailMessage("clock.corrected", language, "Corner Bistro", params);

  it("says the setup or restore page's device set it, naming the administrator on first setup", () => {
    const named = { ...STEP, source: "setup", person: "Ben", bySetupAdmin: true };
    expect(message("en", named).text).toBe(
      "The box's clock was set from the device showing the setup or restore page, by Ben: moved forward 2 days and 3 hours, from 14/03/2025 09:12 to 18/10/2026 23:40.",
    );
    expect(message("es", named).text).toBe(
      `El reloj del servidor se puso en hora con el dispositivo que mostraba la página de configuración o restauración, por Ben: adelantado ${formatDuration(STEP.stepMs, "es-ES")}, de 14/03/2025 09:12 a 18/10/2026 23:40.`,
    );
    const nobody = { ...STEP, source: "setup", person: null, bySetup: true };
    expect(message("en", nobody).text).toBe(
      "The box's clock was set from the device showing the setup or restore page: moved forward 2 days and 3 hours, from 14/03/2025 09:12 to 18/10/2026 23:40.",
    );
    expect(message("es", nobody).text).toBe(
      `El reloj del servidor se puso en hora con el dispositivo que mostraba la página de configuración o restauración: adelantado ${formatDuration(STEP.stepMs, "es-ES")}, de 14/03/2025 09:12 a 18/10/2026 23:40.`,
    );
    expect(message("en", { ...nobody, verified: false, unverified: true }).subject).toBe(
      "Corner Bistro: the box could not confirm it set its clock",
    );
  });

  it("names the administrator whose device set it, in both languages", () => {
    const params = { ...STEP, source: "admin", person: "Ben", byAdmin: true };
    expect(message("en", params).text).toBe(
      "The box's clock was set from Ben's device: moved forward 2 days and 3 hours, from 14/03/2025 09:12 to 18/10/2026 23:40.",
    );
    expect(message("es", params).text).toBe(
      ES.admin
        .replaceAll("{person}", "Ben")
        .replaceAll(
          "{step}",
          ES.forward.replaceAll("{duration}", formatDuration(STEP.stepMs, "es-ES")),
        )
        .replaceAll("{before}", "14/03/2025 09:12")
        .replaceAll("{after}", "18/10/2026 23:40"),
    );
  });

  it("names the staff member who confirmed it and the till that proposed it, in both languages", () => {
    const params = {
      ...STEP,
      source: "staff",
      person: "Anna",
      deviceId: "d-bar",
      device: "Bar",
      byStaff: true,
      direction: "back",
      stepMs: -DAY,
    };
    expect(message("en", params).text).toBe(
      "The box's clock was set from the time on till Bar, confirmed by Anna, a staff member: moved back 1 day, from 14/03/2025 09:12 to 18/10/2026 23:40.",
    );
    expect(message("es", params).text).toBe(
      ES.staff
        .replaceAll("{till}", ES.namedTill.replaceAll("{device}", "Bar"))
        .replaceAll("{person}", "Anna")
        .replaceAll("{step}", ES.back.replaceAll("{duration}", formatDuration(-DAY, "es-ES")))
        .replaceAll("{before}", "14/03/2025 09:12")
        .replaceAll("{after}", "18/10/2026 23:40"),
    );
    expect(message("es", params).text).toContain("la caja Bar");
  });

  it("names a till without a label as a till", () => {
    const params = { ...STEP, source: "staff", person: "Anna", byStaff: true };
    expect(message("en", params).text).toContain("from the time on a till, confirmed by Anna,");
    expect(message("es", params).text).toContain(
      ES.staff.split("{till}")[0]!.concat(ES.unnamedTill),
    );
  });

  it("names the till exactly as typed when its name spells the staff member's slot", () => {
    const params = {
      ...STEP,
      source: "staff",
      person: "Anna",
      device: "Bar {person}",
      byStaff: true,
    };
    expect(message("en", params).text).toContain(
      "from the time on till Bar {person}, confirmed by Anna, a staff member:",
    );
  });

  it("names the administrator exactly as typed when the name spells the step's or a time's slot", () => {
    const params = { ...STEP, source: "admin", person: "Ben {step} {before}", byAdmin: true };
    expect(message("en", params).text).toBe(
      "The box's clock was set from Ben {step} {before}'s device: moved forward 2 days and 3 hours, from 14/03/2025 09:12 to 18/10/2026 23:40.",
    );
  });

  it("leaves a time's slot as it is when the alert carries no such time", () => {
    expect(message("en", { ...STEP, after: undefined }).text).toBe(
      "The box's clock was set from Ben's device: moved forward 2 days and 3 hours, from 14/03/2025 09:12 to {after}.",
    );
  });

  it("names the venue exactly as typed when its name spells a time's slot", () => {
    expect(boxEmailMessage("clock.corrected", "en", "Bistro {after} $&", STEP).subject).toBe(
      "Bistro {after} $&: the box's clock was set",
    );
  });

  it("says a step it could not confirm was only tried, and what the clock read before and after", () => {
    const params = {
      ...STEP,
      confirmationId: null,
      verified: false,
      unverified: true,
      source: "admin",
      person: "Ben",
      byAdmin: true,
    };
    expect(message("en", params)).toEqual({
      subject: "Corner Bistro: the box could not confirm it set its clock",
      text: "The box tried to set its clock but could not confirm the change took. Its clock read 14/03/2025 09:12 before and 18/10/2026 23:40 after (moved forward 2 days and 3 hours). Check the box's clock on the Box status page (in the dashboard, Settings → Box status).",
    });
    expect(message("es", params)).toEqual({
      subject: ES.unverifiedSubject.replaceAll("{venue}", "Corner Bistro"),
      text: ES.unverified
        .replaceAll(
          "{step}",
          ES.forward.replaceAll("{duration}", formatDuration(STEP.stepMs, "es-ES")),
        )
        .replaceAll("{before}", "14/03/2025 09:12")
        .replaceAll("{after}", "18/10/2026 23:40"),
    });
  });

  it("words a person's step as theirs even without their name, never as the tax agency's", () => {
    for (const source of ["admin", "staff"]) {
      const text = message("en", { ...STEP, source, person: null }).text;
      expect(text).not.toContain("tax agency");
      expect(text).toContain("—");
    }
  });

  it("words a step of exactly one day and one of 400 days", () => {
    expect(message("en", { ...STEP, stepMs: DAY }).text).toContain("moved forward 1 day, from");
    expect(message("en", { ...STEP, stepMs: 400 * DAY }).text).toContain(
      "moved forward 400 days, from",
    );
    expect(message("es", { ...STEP, stepMs: 400 * DAY }).text).toContain(
      ES.forward.replaceAll("{duration}", formatDuration(400 * DAY, "es-ES")),
    );
  });

  it("words a direction it does not know as moved", () => {
    expect(message("en", { ...STEP, direction: "sideways" }).text).toContain(
      "device: moved 2 days and 3 hours, from",
    );
    expect(message("es", { ...STEP, direction: "sideways" }).text).toContain(
      ES.moved.replaceAll("{duration}", formatDuration(STEP.stepMs, "es-ES")),
    );
  });
});

describe("every clock email", () => {
  const STOP = { clockAt: "2025-03-14T08:12:00.000Z", offsetMinutes: 60 };
  const EMAILS = [
    ["clock.unusable", STOP],
    ...[
      { source: "admin", person: "Ben", device: null, byAdmin: true },
      { source: "staff", person: "Anna", device: "Bar", byStaff: true },
      { source: "staff", person: "Anna", device: null, byStaff: true },
      { source: "admin", person: "Ben", device: null, unverified: true },
    ].map(
      (who) =>
        [
          "clock.corrected",
          {
            before: "2025-03-14T08:12:00.000Z",
            beforeOffsetMinutes: 60,
            after: "2026-10-18T21:40:00.000Z",
            afterOffsetMinutes: 120,
            stepMs: 86_400_000,
            direction: "forward",
            ...who,
          },
        ] as const,
    ),
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

describe("readOpenEmailedIncidents for the box setting its clock", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it("reads an open clock.corrected alert and no handled one", async () => {
    const row = (detectedAt: string, acknowledgedAt: string | null) => ({
      source: "dashboard" as const,
      code: "clock.corrected",
      params: { at: detectedAt },
      severity: "warning" as const,
      detectedAt,
      acknowledgedAt,
    });
    await suite.db
      .insert(incidents)
      .values([
        row("2026-10-22T09:30:00.000Z", "2026-10-22T09:31:00.000Z"),
        row("2026-10-22T09:31:00.000Z", null),
      ]);
    const open = await readOpenEmailedIncidents(suite.db);
    expect(open.map(({ code, params }) => ({ code, params }))).toEqual([
      { code: "clock.corrected", params: { at: "2026-10-22T09:31:00.000Z" } },
    ]);
  });
});

describe("boxEmailMessage for old backups deleted", () => {
  it("words one deleted backup and the day it was taken, with the venue first in the subject, in both languages", () => {
    expect(
      boxEmailMessage("backup.archives_deleted", "en", "Corner Bistro", {
        count: 1,
        date: "2026-10-28",
        lastDate: "2026-10-28",
        severalDays: false,
      }),
    ).toEqual({
      subject: "Corner Bistro: Old backups deleted: low disk space",
      text: "Low disk space: the box deleted its oldest backup (28 Oct 2026).",
    });
    expect(
      boxEmailMessage("backup.archives_deleted", "es", "Corner Bistro", {
        count: 1,
        date: "2026-10-28",
        lastDate: "2026-10-28",
        severalDays: false,
      }),
    ).toEqual({
      subject: "Corner Bistro: Copias antiguas borradas: poco espacio en disco",
      text: "Poco espacio en disco: el servidor borró su copia de seguridad más antigua (28 oct 2026).",
    });
  });

  it("words several deleted backups, in both languages", () => {
    expect(
      boxEmailMessage("backup.archives_deleted", "en", "Corner Bistro", {
        count: 3,
        date: "2026-10-28",
        lastDate: "2026-10-28",
        severalDays: false,
      }).text,
    ).toBe("Low disk space: the box deleted its 3 oldest backups (28 Oct 2026).");
    expect(
      boxEmailMessage("backup.archives_deleted", "es", "Corner Bistro", {
        count: 3,
        date: "2026-10-28",
        lastDate: "2026-10-28",
        severalDays: false,
      }).text,
    ).toBe("Poco espacio en disco: el servidor borró sus 3 copias más antiguas (28 oct 2026).");
  });

  it("words several deleted backups taken on different days by their first and last day, in both languages", () => {
    const params = { count: 3, date: "2026-10-21", lastDate: "2026-10-24", severalDays: true };
    expect(boxEmailMessage("backup.archives_deleted", "en", "Corner Bistro", params).text).toBe(
      "Low disk space: the box deleted its 3 oldest backups (21 Oct 2026 to 24 Oct 2026).",
    );
    expect(boxEmailMessage("backup.archives_deleted", "es", "Corner Bistro", params).text).toBe(
      "Poco espacio en disco: el servidor borró sus 3 copias más antiguas (del 21 oct 2026 al 24 oct 2026).",
    );
  });

  it("draws the day as the bell does", () => {
    // The bell's strings for 2026-10-28, pinned in apps/dashboard/src/i18n/alerts.test.ts.
    const bell = { en: "28 Oct 2026", es: "28 oct 2026" };
    for (const language of LANGUAGES) {
      const { text } = boxEmailMessage("backup.archives_deleted", language, "Corner Bistro", {
        count: 1,
        date: "2026-10-28",
        lastDate: "2026-10-28",
        severalDays: false,
      });
      expect(text).toContain(`(${bell[language]}).`);
    }
  });
});

describe("boxEmailMessage for a backup refused for lack of room", () => {
  const sizes = { neededBytes: 6_300_000_000, availableBytes: 1_900_000_000 };

  it("words both sizes, with the venue first in the subject, in English", () => {
    expect(boxEmailMessage("backup.run_stopped", "en", "Corner Bistro", sizes)).toEqual({
      subject: "Corner Bistro: Backup not made: low disk space",
      text: "Backup not made: it needs 6.3 GB free and the disk has 1.9 GB.",
    });
  });

  it("words both sizes, with the venue first in the subject, in Spanish", () => {
    expect(boxEmailMessage("backup.run_stopped", "es", "Corner Bistro", sizes)).toEqual({
      subject: "Corner Bistro: Copia no hecha: poco espacio en disco",
      text: "Copia no hecha: necesita 6,3 GB libres y el disco tiene 1,9 GB.",
    });
  });
});

describe("readOpenEmailedIncidents for backups", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it("reads an open old-backups-deleted alert and no handled one", async () => {
    const row = (detectedAt: string, date: string, acknowledgedAt: string | null = null) => ({
      source: "backup" as const,
      code: "backup.archives_deleted",
      params: { count: 2, date, lastDate: date, severalDays: false },
      severity: "warning" as const,
      detectedAt,
      acknowledgedAt,
    });
    await suite.db
      .insert(incidents)
      .values([
        row("2026-10-27T03:00:00.000Z", "2026-10-19", "2026-10-27T09:00:00.000Z"),
        row("2026-10-28T03:00:00.000Z", "2026-10-20"),
      ]);
    const open = await readOpenEmailedIncidents(suite.db);
    expect(open.map(({ code, params }) => ({ code, params }))).toEqual([
      {
        code: "backup.archives_deleted",
        params: { count: 2, date: "2026-10-20", lastDate: "2026-10-20", severalDays: false },
      },
    ]);
  });
});
