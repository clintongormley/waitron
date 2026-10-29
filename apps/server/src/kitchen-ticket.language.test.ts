import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";
import { KITCHEN_ALLERGY_WORDS } from "./i18n/kitchen-allergy.js";
import { describe, expect, it } from "vitest";
import {
  formatCorrectionSlip,
  formatKitchenTicket,
  formatMovedSlip,
  formatKitchenNoteChangeSlip,
  movedPlaceText,
  crossRefText,
  type CorrectionSlip,
} from "./kitchen-ticket.js";
import { printedLines } from "./testing/decode-ticket.js";

const layout = { paperWidth: "80mm", resolution: "180dpi" } as const;
const firedAt = new Date(2026, 9, 29, 13, 24);
const item = { qty: "2.000", name: "Pass roast", group: 3 };

describe("A964 frame catalogue", () => {
  it.each(["HOLD", "FIRE"] as const)("translates Spanish %s, group and reprint markers", (mark) => {
    const lines = printedLines(
      formatKitchenTicket(
        {
          locale: "ES-mx",
          scope: "station",
          stationName: "Grill",
          tableLabel: "Table 7",
          orderNumber: "12",
          firedAt,
          reprintedAt: firedAt,
          mark,
          items: [item],
        },
        layout,
      ),
    );
    expect(lines).not.toContain(`*** ${mark} ***`);
    expect(lines).not.toContain("*** REPRINT 13:24 ***");
    expect(lines).not.toContain("GROUP 3");
    expect(lines).toContain("2.000 x Pass roast");
  });
  it.each(["VOID", "RECALLED", "HOLD CANCELLED"] as const)(
    "translates Spanish %s corrections",
    (kind) => {
      const lines = printedLines(
        formatCorrectionSlip(
          {
            locale: "es",
            kind,
            stationName: "Grill",
            tableLabel: "Table 7",
            orderNumber: "12",
            at: firedAt.toISOString(),
            item,
          },
          layout,
        ),
      );
      expect(lines).not.toContain(`*** ${kind} ***`);
      expect(lines).not.toContain("GROUP 3");
      expect(lines).toContain("2.000 x Pass roast");
    },
  );
  it.each(["added", "removed"] as const)(
    "translates held changes while retaining the %s sign",
    (direction) => {
      const lines = printedLines(
        formatCorrectionSlip(
          {
            locale: "es",
            kind: "HOLD CHANGED",
            direction,
            stationName: "Grill",
            tableLabel: "Table 7",
            orderNumber: "12",
            at: firedAt.toISOString(),
            item,
          },
          layout,
        ),
      );
      expect(lines).not.toContain("*** HOLD CHANGED ***");
      expect(lines).toContain(`${direction === "added" ? "+" : "-"}2.000 x Pass roast`);
    },
  );
  it("translates moved held and group headings", () => {
    const lines = printedLines(
      formatMovedSlip(
        {
          locale: "es",
          stationName: "Grill",
          fromNumber: "12",
          fromText: "Table 7",
          toText: "Table 8",
          at: firedAt.toISOString(),
          items: [],
          held: [{ group: 3, items: [item] }],
        },
        layout,
      ),
    );
    expect(lines).not.toContain("HOLD");
    expect(lines).not.toContain("GROUP 3");
    expect(lines).toContain("2.000 x Pass roast");
  });
  it("preserves the complete English frame and quantity", () => {
    expect(
      printedLines(
        formatKitchenTicket(
          {
            locale: "en-GB",
            scope: "station",
            stationName: "Grill",
            tableLabel: "Table 7",
            orderNumber: "12",
            firedAt,
            reprintedAt: firedAt,
            mark: "HOLD",
            items: [item],
          },
          layout,
        ),
      ),
    ).toEqual([
      "*** REPRINT 13:24 ***",
      "*** HOLD ***",
      "Grill",
      "Table 7",
      "12",
      "13:24",
      "GROUP 3",
      "2.000 x Pass roast",
      "",
    ]);
  });
});

describe("A964 complete paper frames", () => {
  it.each(["en", "es"])(
    "keeps shared-station header, names, references and rest of order in %s",
    (locale) => {
      const w = kitchenTicketWords(locale);
      expect(
        printedLines(
          formatKitchenTicket(
            {
              locale,
              scope: "stations",
              stations: [
                {
                  stationName: "Grill",
                  items: [
                    {
                      qty: 2,
                      name: "Pass roast",
                      group: 3,
                      modifiers: ["Large"],
                      crossRefs: [
                        crossRefText(
                          { kind: "with", name: "$& roast", stationName: "$& fryer" },
                          locale,
                        ),
                      ],
                      note: "No salt",
                    },
                  ],
                },
                { stationName: "Fryer", items: [{ qty: 1, name: "Pass chips", group: 3 }] },
              ],
              tableLabel: "Table 7",
              orderNumber: "12",
              firedAt,
              from: { stationName: "Bar", locale },
              party: { name: "Alex", locale },
              kitchenNote: { text: "Together", locale },
              alsoOnOrder: {
                locale,
                items: [{ qty: 1, name: "Water", stationName: "Bar", held: true }],
              },
            },
            layout,
          ),
        ),
      ).toEqual([
        "Grill · Fryer",
        "Table 7",
        `${w.order} 12 · Alex`,
        "13:24",
        `${w.fromStation} Bar`,
        `${w.forKitchen}Together`,
        `${w.group} 3`,
        "Grill",
        "2 x Pass roast",
        "  + Large",
        `  > ${w.withRef.replace("{name}", () => "$& roast").replace("{station}", () => "$& fryer")}`,
        "  * No salt",
        "Fryer",
        "1 x Pass chips",
        `-- ${w.alsoOnOrder} --`,
        `1 x Water — Bar ${w.onHold}`,
        "",
      ]);
    },
  );
  it.each(["en", "es"])("renders every correction kind with exact fields in %s", (locale) => {
    const w = kitchenTicketWords(locale);
    const block = {
      allergens: { milk: {} },
      clashes: {},
      who: "Alex",
      note: null,
      labels: {
        en: { avoids: ["Milk"], clashes: [] },
        es: { avoids: ["Stored milk"], clashes: [] },
      },
    };
    const base = {
      locale,
      stationName: "Grill",
      tableLabel: "Table 7",
      orderNumber: "12",
      at: firedAt.toISOString(),
      item,
    };
    const cases: [CorrectionSlip, string, string, string[]][] = [
      [{ ...base, kind: "VOID" }, w.void, "", []],
      [{ ...base, kind: "RECALLED" }, w.recalled, "", []],
      [{ ...base, kind: "HOLD CHANGED", direction: "added" }, w.holdChanged, "+", []],
      [{ ...base, kind: "HOLD CHANGED", direction: "removed" }, w.holdChanged, "-", []],
      [{ ...base, kind: "HOLD CANCELLED" }, w.holdCancelled, "", []],
      [{ ...base, kind: "TO STATION", toStation: "Fryer" }, `${w.movedTo} FRYER`, "", []],
      [
        { ...base, kind: "EXTRA CANCELLED", held: true, cancelledExtra: "Pickles" },
        w.holdChanged,
        "",
        [`  ${w.cancel} Pickles`],
      ],
      [
        { ...base, kind: "EXTRA CANCELLED", held: false, cancelledExtra: "Pickles" },
        w.changed,
        "",
        [`  ${w.cancel} Pickles`],
      ],
      [
        { ...base, kind: "ALLERGY REMOVED", allergyBlock: null },
        KITCHEN_ALLERGY_WORDS[locale as "en" | "es"].removed,
        "",
        [],
      ],
      [
        { ...base, kind: "ALLERGY CHANGED", allergyBlock: block },
        KITCHEN_ALLERGY_WORDS[locale as "en" | "es"].changed,
        "",
        [
          `  ${KITCHEN_ALLERGY_WORDS[locale as "en" | "es"].guestHeading.replace("{who}", () => "Alex")}`,
          `  ${block.labels[locale as "en" | "es"].avoids[0]!.toUpperCase()}`,
        ],
      ],
    ];
    for (const [slip, header, sign, tail] of cases)
      expect(printedLines(formatCorrectionSlip(slip, layout))).toEqual([
        `*** ${header} ***`,
        "Grill",
        "Table 7",
        "12",
        "13:24",
        `${w.group} 3`,
        `${sign}2.000 x Pass roast`,
        ...tail,
        "",
      ]);
  });
  it.each(["en", "es"])("preserves note removal and moved-counter fields in %s", (locale) => {
    const w = kitchenTicketWords(locale);
    expect(
      printedLines(
        formatKitchenNoteChangeSlip(
          {
            locale,
            stations: [{ stationName: "Grill", items: [item] }],
            tableLabel: null,
            orderNumber: "12",
            at: firedAt.toISOString(),
            orderNoteChange: { before: "$& Together", after: null },
          },
          layout,
        ),
      ),
    ).toEqual([
      `*** ${w.noteRemoved} ***`,
      "Grill",
      "12",
      "13:24",
      w.noteRemovedBody,
      `${w.was}: $& Together`,
      `${w.group} 3`,
      "2.000 x Pass roast",
      "",
    ]);
    expect(
      printedLines(
        formatMovedSlip(
          {
            locale,
            stationName: "Grill",
            fromNumber: "12",
            toNumber: "14",
            fromText: movedPlaceText({ counter: true, names: [] }, locale),
            toText: movedPlaceText({ counter: false, names: ["Table 8"] }, locale),
            at: firedAt.toISOString(),
            items: [],
            held: [{ group: 3, items: [item] }],
          },
          layout,
        ),
      ),
    ).toEqual([
      `*** ${w.moved} ***`,
      "Grill",
      `${w.order} 12 -> 14`,
      `${w.fromPlace}${w.counter}`,
      `${w.toPlace}Table 8`,
      "13:24",
      w.hold,
      `${w.group} 3`,
      "2.000 x Pass roast",
      "",
    ]);
  });
  it.each(["en", "es"])("keeps placeholder-like and replacement text verbatim in %s", (locale) => {
    const w = kitchenTicketWords(locale);
    for (const ref of [
      { kind: "with", name: "$& {station}", stationName: "$` Station" },
      { kind: "for", name: "$& {station}", stationName: "$` Station" },
      { kind: "for", name: "$& {station}", stationName: null },
    ] as const) {
      const template =
        ref.kind === "with" ? w.withRef : ref.stationName === null ? w.forNoPreparation : w.forRef;
      expect(crossRefText(ref, locale)).toBe(
        template.replace(/\{(name|station)\}/g, (_, key: string) =>
          key === "name" ? ref.name : ref.stationName!,
        ),
      );
    }
  });
});
