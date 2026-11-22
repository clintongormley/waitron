import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { staffNoticeText } from "./staff-notices.js";
import { en, es } from "./strings.js";
import { clockTime, setLocale } from "./t.js";

afterEach(() => {
  setLocale("en-GB");
});

const LANGUAGES = [
  ["en-GB", en],
  ["es-ES", es],
] as const;

const TICKET_FAILED = {
  "en-GB": { main: "Printer “Kitchen” could not print a ticket", hint: "Reprint it" },
  "es-ES": { main: "Impresora «Cocina» no pudo imprimir un ticket", hint: "Vuelve a imprimirlo" },
} as const;

describe.each(LANGUAGES)("staffNoticeText in %s", (locale, words) => {
  it("words a full disk with its own words and the tell-a-manager hint", () => {
    setLocale(locale);
    expect(staffNoticeText({ code: "storage.disk_full", params: {} })).toEqual({
      main: words["staff_notice.storage.disk_full"],
      hint: words["staff_notice.tell_manager"],
    });
  });

  it.each(["clock.unusable", "storage.space_low", "clock.check_time"])(
    "words %s with its own words and the see-Box-status hint",
    (code) => {
      setLocale(locale);
      expect(staffNoticeText({ code, params: {} })).toEqual({
        main: words[`staff_notice.${code}` as keyof typeof words],
        hint: words["staff_notice.see_box_status"],
      });
    },
  );

  it("words the check-the-time marker with its own words", () => {
    setLocale(locale);
    expect(staffNoticeText({ code: "clock.check_time", params: {} }).main).toBe(
      words["staff_notice.clock.check_time"],
    );
  });

  it("says this device's own time is wrong and hints to correct it in its settings", () => {
    setLocale(locale);
    expect(staffNoticeText({ code: "clock.device_wrong", params: {} }, true)).toEqual(
      locale === "en-GB"
        ? {
            main: "This device's time is wrong",
            hint: "Correct it in this device's settings",
          }
        : {
            main: "La hora de este dispositivo es incorrecta",
            hint: "Corrígela en los ajustes del dispositivo",
          },
    );
  });

  it.each([
    {},
    { agreed: 2, cause: "start" },
    { agreed: -1, cause: "start" },
    { agreed: 0.5, cause: "start" },
    { agreed: "1", cause: "start" },
  ])("words the waiting start as unknown when its count is %o", (params) => {
    setLocale(locale);
    expect(staffNoticeText({ code: "clock.unconfirmed", params }).main).toBe(
      words["staff_notice.unknown"],
    );
  });

  it.each([
    ["start", "staff_notice.clock.unconfirmed"],
    ["clock_jumped", "staff_notice.clock.unconfirmed_jumped"],
    ["future_date_refused", "staff_notice.clock.unconfirmed_future_date"],
  ] as const)("words the wait by its cause %s, with its count", (cause, key) => {
    setLocale(locale);
    expect(staffNoticeText({ code: "clock.unconfirmed", params: { agreed: 1, cause } })).toEqual({
      main: words[key].replace("{agreed}", "1"),
      hint: words["staff_notice.see_box_status"],
    });
  });

  it("words a wait after a future-date refusal with no device count, and Check the time", () => {
    setLocale(locale);
    const notice = {
      code: "clock.unconfirmed",
      params: { agreed: 1, cause: "future_date_refused" },
    };
    expect(staffNoticeText(notice, true)).toEqual({
      main: {
        "en-GB":
          "The tax agency refused a sale because the server's date was ahead. Payments wait until someone checks the time.",
        "es-ES":
          "Hacienda rechazó una venta porque la fecha del servidor iba adelantada. Los cobros esperan hasta que alguien compruebe la hora.",
      }[locale],
      hint: words["staff_notice.check_time"],
    });
  });

  it.each([undefined, "later_cause"])("words the wait as unknown when its cause is %o", (cause) => {
    setLocale(locale);
    expect(staffNoticeText({ code: "clock.unconfirmed", params: { agreed: 1, cause } }).main).toBe(
      words["staff_notice.unknown"],
    );
  });

  it("words the unsent count with its number and the retried hint while nothing is held", () => {
    setLocale(locale);
    expect(
      staffNoticeText({ code: "fiscal.records_unsent", params: { count: 12, held: 0 } }),
    ).toEqual({
      main: words["staff_notice.fiscal.records_unsent"].replace("{n}", "12"),
      hint: words["staff_notice.retried"],
    });
  });

  it("gives the unsent count the tell-a-manager hint while a held record is counted", () => {
    setLocale(locale);
    expect(
      staffNoticeText({ code: "fiscal.records_unsent", params: { count: 12, held: 1 } }),
    ).toEqual({
      main: words["staff_notice.fiscal.records_unsent"].replace("{n}", "12"),
      hint: words["staff_notice.tell_manager"],
    });
  });

  it.each([
    ["missing", { count: 12 }],
    ["a string", { count: 12, held: "0" }],
  ])("gives the unsent count the tell-a-manager hint when the held count is %s", (_, params) => {
    setLocale(locale);
    expect(staffNoticeText({ code: "fiscal.records_unsent", params })).toEqual({
      main: words["staff_notice.fiscal.records_unsent"].replace("{n}", "12"),
      hint: words["staff_notice.tell_manager"],
    });
  });

  it("words a count of one with the singular", () => {
    setLocale(locale);
    expect(
      staffNoticeText({ code: "fiscal.records_unsent", params: { count: 1, held: 0 } }),
    ).toEqual({
      main: words["staff_notice.fiscal.records_unsent_one"],
      hint: words["staff_notice.retried"],
    });
  });

  it.each([
    ["zero", { count: 0, held: 0 }],
    ["a string", { count: "12", held: 0 }],
    ["a fraction", { count: 1.5, held: 0 }],
    ["missing", { held: 0 }],
  ])("words an unsent count that is %s as unknown", (_label, params) => {
    setLocale(locale);
    expect(staffNoticeText({ code: "fiscal.records_unsent", params })).toEqual({
      main: words["staff_notice.unknown"],
      hint: words["staff_notice.see_box_status"],
    });
  });

  it("words a printer notice with the printer's name and the time its oldest ticket was sent", () => {
    setLocale(locale);
    expect(words["staff_notice.printer.jobs_waiting"]).toBeTypeOf("string");
    expect(words["staff_notice.since"]).toBeTypeOf("string");
    const since = "2026-10-23T19:16:00.000Z";
    expect(
      staffNoticeText({ code: "printer.jobs_waiting", params: { printer: "Kitchen", since } }),
    ).toEqual({
      main: words["staff_notice.printer.jobs_waiting"].replace("{printer}", "Kitchen"),
      hint: words["staff_notice.since"].replace("{time}", clockTime(Date.parse(since))),
    });
  });

  const since = "2026-10-23T19:16:00.000Z";
  it.each([
    {},
    { printer: "", since },
    { printer: "Kitchen" },
    { printer: "Kitchen", since: "not a time" },
    { printer: 7, since },
  ])("words a printer notice with %j as unknown", (params) => {
    setLocale(locale);
    expect(staffNoticeText({ code: "printer.jobs_waiting", params })).toEqual({
      main: words["staff_notice.unknown"],
      hint: words["staff_notice.see_box_status"],
    });
  });

  it("keeps a printer name that looks like a replacement pattern", () => {
    setLocale(locale);
    expect(
      staffNoticeText({ code: "printer.jobs_waiting", params: { printer: "$& {time}", since } })
        .main,
    ).toContain("$& {time}");
  });

  it("words a failed ticket's notice with the printer's name and asks for a reprint", () => {
    setLocale(locale);
    const printer = locale === "es-ES" ? "Cocina" : "Kitchen";
    expect(staffNoticeText({ code: "printer.ticket_failed", params: { printer } })).toEqual(
      TICKET_FAILED[locale],
    );
  });

  it("keeps a failed ticket's printer name that looks like a replacement pattern", () => {
    setLocale(locale);
    expect(
      staffNoticeText({ code: "printer.ticket_failed", params: { printer: "$& {printer}" } }).main,
    ).toContain("$& {printer}");
  });

  it.each([{}, { printer: "" }, { printer: 7 }])(
    "words a failed ticket's notice with %j as unknown",
    (params) => {
      setLocale(locale);
      expect(staffNoticeText({ code: "printer.ticket_failed", params })).toEqual({
        main: words["staff_notice.unknown"],
        hint: words["staff_notice.see_box_status"],
      });
    },
  );

  it("words a code the till does not know as unknown", () => {
    setLocale(locale);
    expect(staffNoticeText({ code: "printer.offline", params: {} })).toEqual({
      main: words["staff_notice.unknown"],
      hint: words["staff_notice.see_box_status"],
    });
  });
});

describe.each(LANGUAGES)(
  "staffNoticeText while the box offers Check the time, in %s",
  (locale, words) => {
    it.each(["clock.unusable"])("gives %s the Check the time words as its hint", (code) => {
      setLocale(locale);
      expect(staffNoticeText({ code, params: {} }, true)).toEqual({
        main: words[`staff_notice.${code}` as keyof typeof words],
        hint: words["staff_notice.check_time"],
      });
    });

    it("gives the waiting start the Check the time words as its hint", () => {
      setLocale(locale);
      expect(
        staffNoticeText({ code: "clock.unconfirmed", params: { agreed: 1, cause: "start" } }, true)
          .hint,
      ).toBe(words["staff_notice.check_time"]);
    });

    it("leaves every other notice's hint as it is", () => {
      setLocale(locale);
      expect(staffNoticeText({ code: "storage.disk_full", params: {} }, true).hint).toBe(
        words["staff_notice.tell_manager"],
      );
    });
  },
);

describe("staffNoticeText for an invoice waiting at an office printer", () => {
  beforeEach(() => setLocale("en-GB"));
  const office = (params: Record<string, unknown>) =>
    staffNoticeText({ code: "invoice_delivery.office_print", params });

  it.each([{}, { printer: "" }, { printer: 3 }])(
    "words the notice as unknown when its printer is %o",
    (params) => {
      expect(office(params).main).toBe(en["staff_notice.unknown"]);
    },
  );

  it("names the printer an invoice failed at", () => {
    expect(office({ printer: "Office", reason: "failed" })).toEqual({
      main: "An invoice failed to print at Office. Check the printer before trying again.",
      hint: "",
    });
  });

  it.each(["uncertain", "uncertain_held"])(
    "says an invoice may have printed when its outcome is %s",
    (reason) => {
      expect(office({ printer: "Office", reason })).toEqual({
        main: "An invoice may have printed at Office. Check the printer before trying again.",
        hint: "",
      });
    },
  );

  it("words a hold the till knows with its reason and the printer", () => {
    expect(office({ printer: "Office", hold: "paper_jam" })).toEqual({
      main: "A full invoice is waiting to print.",
      hint: "Waiting at Office (paper jam). Check the printer. It will print when ready.",
    });
  });

  it("words a hold the till does not know without a reason", () => {
    expect(office({ printer: "Office", hold: "on_fire" })).toEqual({
      main: "A full invoice is waiting to print.",
      hint: "Waiting at the office printer.",
    });
  });
});
