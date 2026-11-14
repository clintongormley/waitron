import { afterEach, describe, expect, it } from "vitest";
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
  it.each(["storage.disk_full", "clock.unusable", "storage.space_low"])(
    "words %s with its own words and the tell-a-manager hint",
    (code) => {
      setLocale(locale);
      expect(staffNoticeText({ code, params: {} })).toEqual({
        main: words[`staff_notice.${code}` as keyof typeof words],
        hint: words["staff_notice.tell_manager"],
      });
    },
  );

  it("words the check-the-time marker with its own words", () => {
    setLocale(locale);
    expect(staffNoticeText({ code: "clock.check_time", params: {} }).main).toBe(
      words["staff_notice.clock.check_time"],
    );
  });

  it.each([{}, { agreed: 2 }, { agreed: -1 }, { agreed: 0.5 }, { agreed: "1" }])(
    "words the waiting start as unknown when its count is %o",
    (params) => {
      setLocale(locale);
      expect(staffNoticeText({ code: "clock.unconfirmed", params }).main).toBe(
        words["staff_notice.unknown"],
      );
    },
  );

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
      hint: words["staff_notice.tell_manager"],
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
      hint: words["staff_notice.tell_manager"],
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
        hint: words["staff_notice.tell_manager"],
      });
    },
  );

  it("words a code the till does not know as unknown", () => {
    setLocale(locale);
    expect(staffNoticeText({ code: "printer.offline", params: {} })).toEqual({
      main: words["staff_notice.unknown"],
      hint: words["staff_notice.tell_manager"],
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
      expect(staffNoticeText({ code: "clock.unconfirmed", params: { agreed: 1 } }, true).hint).toBe(
        words["staff_notice.check_time"],
      );
    });

    it("leaves every other notice's hint as it is", () => {
      setLocale(locale);
      expect(staffNoticeText({ code: "storage.disk_full", params: {} }, true).hint).toBe(
        words["staff_notice.tell_manager"],
      );
    });
  },
);
