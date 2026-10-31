import { describe, expect, it } from "vitest";
import type { MisdatedDetail, MisdatedDetailRecord } from "@waitron/fiscal";
import { CLOCK_CONFIRMED_BY_WORDS, CLOCK_MISDATED_EMAIL_WORDS } from "./i18n/box-emails.js";
import { MISDATED_SALES_WORDS } from "./i18n/misdated-sales.js";
import {
  misdatedSalesFileName,
  renderMisdatedSalesCsv,
  type MisdatedSalesInput,
} from "./misdated-sales-csv.js";

type Known = Extract<MisdatedDetail, { known: true }>;
type Language = "en" | "es";

function record(overrides: Partial<MisdatedDetailRecord> = {}): MisdatedDetailRecord {
  return {
    recordId: "r1",
    invoiceNumber: "A/1",
    generatedAt: "2026-10-24T22:30:00.000Z",
    offsetMinutes: 120,
    kind: "issue",
    issueDate: "2026-10-25",
    amount: "12.30",
    ...overrides,
  };
}

function input(
  records: MisdatedDetailRecord[],
  overrides: { closing?: Partial<Known["closing"]>; language?: Language } & Partial<
    Pick<MisdatedSalesInput, "confirmedByName" | "episode">
  > = {},
): MisdatedSalesInput {
  return {
    venue: "Harbour Bar",
    language: overrides.language ?? "en",
    confirmedByName: overrides.confirmedByName === undefined ? "Mario" : overrides.confirmedByName,
    episode: overrides.episode ?? {
      from: "2026-10-24T22:30:00.000Z",
      fromOffsetMinutes: 120,
      to: "2026-10-24T23:10:00.000Z",
      toOffsetMinutes: 120,
    },
    detail: {
      known: true,
      closing: {
        source: "admin",
        personId: "person-1",
        confirmedAt: "2026-10-25T08:00:00.000Z",
        correctedStart: "2026-10-24T21:00:00.000Z",
        partial: false,
        startOffsetMinutes: 120,
        ...overrides.closing,
      },
      records,
    },
  };
}

function text(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
}

// Every cell is quoted, so a line splits at `","`; the fixtures hold no quote of their own.
function rows(bytes: Uint8Array): string[][] {
  return text(bytes)
    .replace(/^\uFEFF/u, "")
    .split("\r\n")
    .filter((line) => line !== "")
    .map((line) => line.slice(1, -1).split('","'));
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/gu, (_, key: string) => values[key]!);
}

describe("renderMisdatedSalesCsv", () => {
  it("writes the stored invoice date, and judges the day by it rather than by a zone (R1)", () => {
    const at = "2026-10-24T22:30:00.000Z";
    const lines = rows(
      renderMisdatedSalesCsv(
        input([
          record({
            invoiceNumber: "A/7",
            generatedAt: at,
            offsetMinutes: 0,
            issueDate: "2026-10-24",
          }),
          record({
            invoiceNumber: "A/8",
            generatedAt: at,
            offsetMinutes: 120,
            issueDate: "2026-10-25",
          }),
        ]),
      ),
    );
    const en = MISDATED_SALES_WORDS.en;
    expect(lines[2]).toEqual([
      "A",
      "7",
      "24/10/2026",
      "24/10/2026 22:30",
      en.unknown,
      "12.30",
      en.differentDay.cannotTell,
    ]);
    expect(lines[3]).toEqual([
      "A",
      "8",
      "25/10/2026",
      "25/10/2026 00:30",
      en.unknown,
      "12.30",
      en.differentDay.yes,
    ]);
  });

  it("cannot tell when the bound is within the margin of the record's midnight (R2)", () => {
    const lines = rows(
      renderMisdatedSalesCsv(
        input([record({ issueDate: "2026-10-25" })], {
          closing: { correctedStart: "2026-10-24T21:59:30.000Z" },
        }),
      ),
    );
    expect(lines[2]![6]).toBe(MISDATED_SALES_WORDS.en.differentDay.cannotTell);
  });

  it("writes a cancellation's stored date, the word for its amount and no day mark", () => {
    for (const language of ["en", "es"] as const) {
      const words = MISDATED_SALES_WORDS[language];
      const lines = rows(
        renderMisdatedSalesCsv(
          input(
            [
              record({
                kind: "cancellation",
                issueDate: "2026-10-20",
                amount: null,
              }),
            ],
            { language },
          ),
        ),
      );
      expect(lines[2]).toEqual([
        "A",
        "1",
        "20/10/2026",
        "25/10/2026 00:30",
        words.unknown,
        words.cancellation,
        words.differentDay.notApplicable,
      ]);
    }
  });

  it("writes amounts with two places and the language's decimal mark, unguarded; guards the rest (R3)", () => {
    const records = [
      record({ amount: "12.3" }),
      record({ amount: "-5.00" }),
      record({ invoiceNumber: "=1+1/3", amount: "7.00" }),
      record({ invoiceNumber: "-1+1/4", amount: "7.00" }),
    ];
    const lines = rows(renderMisdatedSalesCsv(input(records)));
    const linesEs = rows(renderMisdatedSalesCsv(input(records, { language: "es" })));
    expect(lines[2]![5]).toBe("12.30");
    expect(linesEs[2]![5]).toBe("12,30");
    expect(lines[3]![5]).toBe("-5.00");
    expect(linesEs[3]![5]).toBe("-5,00");
    expect(lines[4]!.slice(0, 2)).toEqual(["'=1+1", "3"]);
    expect(lines[5]!.slice(0, 2)).toEqual(["'-1+1", "4"]);
  });

  it("leaves the number empty when the invoice number has none", () => {
    const lines = rows(renderMisdatedSalesCsv(input([record({ invoiceNumber: "LOOSE" })])));
    expect(lines[2]!.slice(0, 2)).toEqual(["LOOSE", ""]);
  });

  it("writes the column headings in the venue's language", () => {
    for (const language of ["en", "es"] as const) {
      const c = MISDATED_SALES_WORDS[language].columns;
      expect(rows(renderMisdatedSalesCsv(input([record()], { language })))[1]).toEqual([
        c.series,
        c.number,
        c.invoiceDate,
        c.timeRecorded,
        c.realTime,
        c.amount,
        c.differentDay,
      ]);
    }
  });

  describe("header", () => {
    it("names the count, the range, the bound and the administrator who confirmed", () => {
      const lines = rows(renderMisdatedSalesCsv(input([record(), record({ recordId: "r2" })])));
      expect(lines[0]).toEqual([
        "Harbour Bar: 2 sales were recorded with a time later than the real one, from 25/10/2026 00:30 to 25/10/2026 01:10. Each was made before 24/10/2026 23:01. The clock was confirmed by an administrator (Mario) on 25/10/2026 10:00.",
      ]);
    });

    it("rounds a bound with seconds up to the next minute", () => {
      const lines = rows(
        renderMisdatedSalesCsv(
          input([record(), record()], { closing: { correctedStart: "2026-10-24T21:59:30.000Z" } }),
        ),
      );
      expect(lines[0]![0]).toContain("Each was made before 25/10/2026 00:01.");
    });

    it("uses the one-sale form, and appends the partial sentence", () => {
      const one = input([record()], {
        closing: { source: "authority", partial: true },
        episode: {
          from: "2026-10-24T22:30:00.000Z",
          fromOffsetMinutes: 120,
          to: "2026-10-24T22:30:00.000Z",
          toOffsetMinutes: 120,
        },
      });
      expect(rows(renderMisdatedSalesCsv(one))[0]).toEqual([
        `Harbour Bar: One sale was recorded with a time later than the real one, at 25/10/2026 00:30. It was made before 24/10/2026 23:01. The clock was confirmed by the tax agency's time on 25/10/2026 10:00. ${CLOCK_MISDATED_EMAIL_WORDS.en.partial}`,
      ]);
    });

    it("names the staff member who confirmed on a till, in English and Spanish", () => {
      for (const language of ["en", "es"] as const) {
        const staff = input([record()], {
          language,
          closing: { source: "staff" },
          confirmedByName: "Ana",
        });
        expect(rows(renderMisdatedSalesCsv(staff))[0]![0]).toContain(
          language === "en"
            ? "confirmed by a staff member (Ana) on a till on"
            : "un miembro del personal (Ana) en una caja",
        );
      }
    });

    it("fills the Spanish template with the same values", () => {
      const lines = rows(
        renderMisdatedSalesCsv(input([record(), record({ recordId: "r2" })], { language: "es" })),
      );
      expect(lines[0]).toEqual([
        fill(MISDATED_SALES_WORDS.es.header.text, {
          venue: "Harbour Bar",
          count: "2",
          from: "25/10/2026 00:30",
          to: "25/10/2026 01:10",
          bound: "24/10/2026 23:01",
          confirmedBy: `${CLOCK_CONFIRMED_BY_WORDS.es.admin} (Mario)`,
          confirmedAt: "25/10/2026 10:00",
        }),
      ]);
    });

    it("counts the rows written", () => {
      const lines = rows(renderMisdatedSalesCsv(input([record(), record(), record()])));
      expect(lines).toHaveLength(5);
      expect(lines[0]![0]).toContain("Harbour Bar: 3 sales were recorded");
    });

    it("writes the bound and confirmation at the first record's offset when the check stored none", () => {
      const lines = rows(
        renderMisdatedSalesCsv(
          input([record({ offsetMinutes: 60 }), record()], {
            closing: { startOffsetMinutes: null },
            confirmedByName: null,
            episode: {
              from: "2026-10-24T22:30:00.000Z",
              fromOffsetMinutes: 60,
              to: "2026-10-24T23:10:00.000Z",
              toOffsetMinutes: 120,
            },
          }),
        ),
      );
      expect(lines[0]![0]).toContain(
        "Each was made before 24/10/2026 22:01. The clock was confirmed by an administrator on 25/10/2026 09:00.",
      );
    });
  });

  it("starts with a byte order mark, ends lines with CRLF and quotes every cell", () => {
    const bytes = renderMisdatedSalesCsv(input([record(), record({ recordId: "r2" })]));
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const body = text(bytes).slice(1);
    expect(body.endsWith("\r\n")).toBe(true);
    const lines = body.split("\r\n").slice(0, -1);
    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(line).not.toContain("\n");
      expect(line).toMatch(/^"(?:[^"]|"")*"(?:,"(?:[^"]|"")*")*$/u);
    }
  });
});

describe("misdatedSalesFileName", () => {
  it("names the file by the episode's start at its stored offset", () => {
    expect(
      misdatedSalesFileName({ from: "2026-10-24T22:30:00.000Z", fromOffsetMinutes: 120 }),
    ).toBe("misdated-sales-2026-10-25.csv");
    expect(misdatedSalesFileName({ from: "2026-10-24T22:30:00.000Z", fromOffsetMinutes: 0 })).toBe(
      "misdated-sales-2026-10-24.csv",
    );
  });
});
