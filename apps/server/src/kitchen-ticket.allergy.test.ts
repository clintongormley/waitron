import { describe, expect, it } from "vitest";
import type { KitchenAllergyBlock } from "@waitron/module";
import { columnsFor, type EscSetting } from "@waitron/printing";
import {
  arrangeTicketItems,
  formatCorrectionSlip,
  formatKitchenTicket,
  formatMovedSlip,
  joinKitchenTickets,
} from "./kitchen-ticket.js";
import {
  ALLERGEN_NAMES,
  ALLERGEN_KIND_NAMES,
  KITCHEN_ALLERGY_WORDS,
} from "./i18n/kitchen-allergy.js";
import { printedCommands, printedLines } from "./testing/decode-ticket.js";

const allergy: KitchenAllergyBlock = {
  who: "Window guest",
  allergens: { gluten: { kinds: ["wheat"] }, milk: {} },
  note: "Separate pan",
  clashes: { milk: {} },
  labels: {
    en: { avoids: ["Cereals containing gluten (Wheat)", "Milk"], clashes: ["Milk"] },
    es: {
      avoids: [
        `${ALLERGEN_NAMES.gluten.es} (${ALLERGEN_KIND_NAMES.wheat!.es})`,
        ALLERGEN_NAMES.milk.es,
      ],
      clashes: [ALLERGEN_NAMES.milk.es],
    },
  },
};
const item = {
  qty: 1,
  name: "Grilled dish",
  modifiers: ["Extra sauce"],
  crossRefs: ["with SIDE from Fryer"],
  note: "Dish note",
  allergy,
};
const header = {
  stationName: "Grill",
  tableLabel: "Table 4",
  orderNumber: "17",
  firedAt: new Date("2026-10-20T10:00:00Z"),
};
const layouts = [
  { paperWidth: "58mm", resolution: "180dpi", dots: 360 },
  { paperWidth: "58mm", resolution: "203dpi", dots: 384 },
  { paperWidth: "80mm", resolution: "180dpi", dots: 512 },
  { paperWidth: "80mm", resolution: "203dpi", dots: 576 },
] satisfies (EscSetting & { dots: number })[];

function ticket(locale = "en-GB") {
  return { ...header, scope: "station" as const, locale, items: [item] };
}
function words(lines: string[]) {
  return lines
    .map((line) => line.trim())
    .join(" ")
    .replace(/ +/g, " ");
}
function expectArea(bytes: Uint8Array, width: number) {
  const commands = printedCommands(bytes);
  expect(commands.slice(0, 3).map((c) => [...c.bytes])).toEqual([
    [0x1b, 0x40],
    [0x1d, 0x4c, 0, 0],
    [0x1d, 0x57, width & 255, width >> 8],
  ]);
  expect(commands.filter((c) => c.name === "GS v 0").map((c) => c.widthDots)).not.toHaveLength(0);
  for (const command of commands.filter((c) => c.name === "GS v 0"))
    expect(command.widthDots).toBe(width);
  expect(commands.map((c) => c.name)).toEqual([
    "ESC @",
    "GS L",
    "GS W",
    ...commands.filter((c) => c.name === "GS v 0").map(() => "GS v 0"),
    "ESC d",
    "GS V",
  ]);
}

describe.each(layouts)("A669 paper $paperWidth $resolution", (layout) => {
  it("prints the guest block after dish details and before the next dish", () => {
    const bytes = formatKitchenTicket(
      { ...ticket(), items: [item, { qty: 1, name: "Plain dish" }] },
      layout,
    );
    const lines = printedLines(bytes);
    const text = words(lines);
    expect(text).toContain("!!! ALLERGY ON THIS TICKET !!!");
    expect(text).toContain("*** ALLERGY: Window guest ***");
    expect(text).toContain("CEREALS CONTAINING GLUTEN (WHEAT), MILK");
    expect(text).toContain("Separate pan");
    expect(text).toContain("!! CONTAINS MILK — SENT ANYWAY");
    expect(text.indexOf("Dish note")).toBeLessThan(text.indexOf("*** ALLERGY:"));
    expect(text.indexOf("Separate pan")).toBeLessThan(text.indexOf("Plain dish"));
    expect(text.match(/\*\*\* ALLERGY:/g)).toHaveLength(1);
    expect(lines.every((line) => line.length <= columnsFor(layout.paperWidth))).toBe(true);
    expectArea(bytes, layout.dots);
  });

  it("selects captured Spanish labels for regional Spanish and English for other locales", () => {
    for (const locale of ["es-ES", "es-MX", "fr-FR"]) {
      const text = words(printedLines(formatKitchenTicket(ticket(locale), layout)));
      if (locale.startsWith("es")) {
        expect(text).toContain(KITCHEN_ALLERGY_WORDS.es.ticketHeading);
        expect(text).toContain(
          KITCHEN_ALLERGY_WORDS.es.guestHeading.replace("{who}", "Window guest"),
        );
        expect(text).toContain(allergy.labels.es.avoids.join(", ").toUpperCase());
        expect(text).toContain(
          KITCHEN_ALLERGY_WORDS.es.clash.replace(
            "{allergens}",
            ALLERGEN_NAMES.milk.es.toUpperCase(),
          ),
        );
      } else {
        expect(text).toContain("!!! ALLERGY ON THIS TICKET !!!");
        expect(text).toContain("CEREALS CONTAINING GLUTEN (WHEAT), MILK");
      }
    }
  });

  it("does not mark a reference to an allergic dish at another station", () => {
    const own = { ...item, allergy: null };
    const bytes = formatKitchenTicket(
      {
        ...ticket(),
        items: [own],
        alsoOnOrder: {
          locale: "en-GB",
          items: [{ qty: 1, name: "Other dish", stationName: "Fryer", held: false }],
        },
      },
      layout,
    );
    expect(words(printedLines(bytes))).not.toContain("ALLERGY");
    expectArea(bytes, layout.dots);
  });

  it("marks multi-station, reprint, HOLD, FIRE and moved paper using the same original block", () => {
    const multi = {
      ...header,
      locale: "en-GB",
      scope: "stations" as const,
      stations: [
        { stationName: "Grill", items: [item] },
        { stationName: "Bar", items: [{ qty: 1, name: "Water" }] },
      ],
    };
    const payloads = [
      formatKitchenTicket(multi, layout),
      ...[{ reprint: true }, { mark: "HOLD" as const }, { mark: "FIRE" as const }].map((flags) =>
        formatKitchenTicket({ ...ticket(), ...flags }, layout),
      ),
      formatMovedSlip(
        {
          stationName: "Grill",
          fromNumber: "17",
          fromText: "Table 4",
          toText: "Table 5",
          at: header.firedAt.toISOString(),
          items: [item],
          held: [{ group: 2, items: [item] }],
          locale: "en-GB",
        },
        layout,
      ),
    ];
    for (const bytes of payloads) {
      expect(words(printedLines(bytes))).toContain("!!! ALLERGY ON THIS TICKET !!!");
      expect(words(printedLines(bytes))).toContain("*** ALLERGY: Window guest ***");
      expectArea(bytes, layout.dots);
    }
    const joined = joinKitchenTickets(payloads[2]!, payloads[3]!);
    expect(words(printedLines(joined)).match(/\*\*\* ALLERGY:/g)).toHaveLength(2);
    expect(printedCommands(joined).filter((c) => c.name === "GS V")).toHaveLength(1);
  });

  it("prints only the replacement on changed slips and no original block on removal", () => {
    const next = { ...allergy, who: "Door guest", note: "New pan" };
    for (const locale of ["en-GB", "es-ES"]) {
      for (const removed of [false, true]) {
        const change = removed
          ? { kind: "ALLERGY REMOVED" as const, allergyBlock: null, locale }
          : { kind: "ALLERGY CHANGED" as const, allergyBlock: next, locale };
        const bytes = formatCorrectionSlip(
          {
            ...change,
            stationName: "Grill",
            tableLabel: "Table 4",
            orderNumber: "17",
            at: header.firedAt.toISOString(),
            item,
          },
          layout,
        );
        const text = words(printedLines(bytes));
        expect(text).toContain(
          locale.startsWith("es")
            ? `*** ${removed ? KITCHEN_ALLERGY_WORDS.es.removed : KITCHEN_ALLERGY_WORDS.es.changed} ***`
            : removed
              ? "*** ALLERGY REMOVED ***"
              : "*** ALLERGY CHANGED ***",
        );
        expect(text).not.toContain("Window guest");
        expect(text).not.toContain("Separate pan");
        if (removed) expect(text).not.toContain("Door guest");
        else expect(text).toContain("Door guest");
        expectArea(bytes, layout.dots);
      }
    }
  });

  it("sanitises control characters before wrapping while retaining literal HTML and dollar text", () => {
    const malicious = {
      ...allergy,
      who: "A\u001bp\u0000\u0001\u0002\u0010\u0014\u0000\u0001\u0002\u007f\u0085B <b>$</b>",
      note: "First\r\n\u009fsecond <script>$</script>",
    };
    const bytes = formatKitchenTicket(
      { ...ticket(), items: [{ ...item, allergy: malicious }] },
      layout,
    );
    const text = words(printedLines(bytes));
    expect(text).toContain("*** ALLERGY: A p B <b>$</b> ***");
    expect(text).toContain("First second <script>$</script>");
    expectArea(bytes, layout.dots);
  });
});

describe("A669 paper grouping", () => {
  it("keeps different guests, notes, kinds, captured names and clashes separate", () => {
    for (const different of [
      { ...allergy, who: "Door guest" },
      { ...allergy, note: "Clean gloves" },
      {
        ...allergy,
        labels: {
          ...allergy.labels,
          en: { ...allergy.labels.en, avoids: ["Cereals containing gluten (Rye)", "Milk"] },
        },
      },
      {
        ...allergy,
        labels: {
          ...allergy.labels,
          es: { ...allergy.labels.es, avoids: ["Changed dictionary label"] },
        },
      },
      { ...allergy, labels: { ...allergy.labels, en: { ...allergy.labels.en, clashes: [] } } },
      null,
    ]) {
      expect(arrangeTicketItems([item, { ...item, allergy: different }], "combined")).toHaveLength(
        2,
      );
    }
    expect(
      arrangeTicketItems([item, { ...item, allergy: structuredClone(allergy) }], "combined"),
    ).toEqual([{ ...item, qty: "2.000" }]);
    expect(arrangeTicketItems([{ ...item, qty: 2 }], "separate")).toEqual([
      { ...item, qty: "1.000" },
      { ...item, qty: "1.000" },
    ]);
    const portions = [
      { ...item, qty: "0.350", unit: "kg", printedAsSold: true },
      { ...item, qty: "0.350", unit: "kg", printedAsSold: true },
    ];
    expect(arrangeTicketItems(portions, "combined")).toEqual(portions);
    expect(arrangeTicketItems(portions, "separate")).toEqual(portions);
  });
});
