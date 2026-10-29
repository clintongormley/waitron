import { commands, page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setContentLanguages } from "@waitron/ui";
import type { StationThresholds } from "@waitron/shared";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget, pageAt, resetPage, textRects } from "./test-helpers.js";
import { allergenName } from "../i18n/allergen-names.js";
import { TillStationQueue, stationColumnNames } from "./station-queue.js";
import { type ColumnKey, STATION_COLUMNS } from "../state/kitchen-columns.js";
import { CARD_COLUMN_TEXT_WIDTHS, OVERVIEW_COLUMN_REMS } from "../state/kitchen-board-fit.js";
import type { KitchenNotice, StationQueueGroup, StationQueueItem } from "../api/client.js";

// The shipped DB defaults.
const DEFAULT_THRESHOLDS: StationThresholds = {
  warmAfterMinutes: 5,
  overdueAfterMinutes: 10,
  forgottenAfterMinutes: 15,
};

// One item in each of the three kitchen states, so the three columns can be asserted from a single
// mount.
const groupA: StationQueueGroup = {
  kitchenNote: null,
  orderId: "wo-1",
  orderNumber: 5,
  label: "Mesa 4",
  queuedAt: "2026-08-17T10:00:00.000Z",
  status: "placed",
  thresholds: DEFAULT_THRESHOLDS,
  bumpMode: "line",
  items: [
    {
      allergy: null,
      id: "ti-1",
      workingOrderLineId: "wol-1",
      state: "queued",
      name: "Paella",
      quantity: "2.000",
      course: null,
      firedAt: "2026-08-17T10:00:00.000Z",
      queuedAt: "2026-08-17T10:00:00.000Z",
    },
    {
      allergy: null,
      id: "ti-2",
      workingOrderLineId: "wol-2",
      state: "preparing",
      name: "Agua",
      quantity: "1.000",
      course: null,
      firedAt: "2026-08-17T10:00:00.000Z",
      queuedAt: "2026-08-17T10:00:00.000Z",
    },
  ],
};

const groupB: StationQueueGroup = {
  kitchenNote: null,
  orderId: "wo-2",
  orderNumber: 6,
  label: null,
  queuedAt: "2026-08-17T10:05:00.000Z",
  status: "settled",
  thresholds: DEFAULT_THRESHOLDS,
  bumpMode: "line",
  items: [
    {
      allergy: null,
      id: "ti-3",
      workingOrderLineId: "wol-3",
      state: "ready",
      name: "Café",
      quantity: "3.000",
      course: null,
      firedAt: "2026-08-17T10:05:00.000Z",
      queuedAt: "2026-08-17T10:05:00.000Z",
    },
  ],
};

const groups = [groupA, groupB];

const withElsewhere: StationQueueGroup = {
  ...groupA,
  elsewhere: [
    {
      id: "other-burger",
      name: "Burger",
      quantity: "2.000",
      unitName: null,
      unitPrecision: null,
      soldInEach: true,
      stationName: "Grill",
      state: "preparing",
      held: false,
    },
    {
      id: "other-fries",
      name: "Fries",
      quantity: "1.000",
      unitName: null,
      unitPrecision: null,
      soldInEach: true,
      stationName: "Fryer",
      state: "queued",
      held: true,
    },
    {
      id: "other-steak",
      name: "Steak",
      quantity: "0.750",
      unitName: { "en-GB": "lb", "es-ES": "kg" },
      unitPrecision: 3,
      soldInEach: false,
      stationName: "Grill",
      state: "ready",
      held: false,
    },
  ],
};

beforeEach(async () => {
  await page.viewport(1280, 900);
});
afterEach(resetPage);
afterEach(cleanupWidgets);

describe("till-station-queue", () => {
  it("rail shows other stations' dishes and their progress without bump controls", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [withElsewhere],
      stationId: "st-1",
    });
    const section = el.shadowRoot!.querySelector('[data-elsewhere="wo-1"]')!;
    expect(section.querySelector("h3")!.textContent).toBe("Also on this order");
    const burger = section.querySelector('[data-elsewhere-item="other-burger"]')!;
    expect(burger.textContent).toContain("2× Burger");
    expect(burger.textContent).toContain("Grill");
    expect(burger.textContent).toContain("Preparing");
    const fries = section.querySelector('[data-elsewhere-item="other-fries"]')!;
    expect(fries.textContent).toContain("On hold");
    const steak = section.querySelector('[data-elsewhere-item="other-steak"]')!;
    expect(steak.textContent).toContain("0.75 lb× Steak");
    expect(steak.textContent).toContain("Ready");
    expect(section.querySelector("button, wt-button")).toBeNull();
  });

  it("rail omits the other-stations section when its list is empty or absent", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [{ ...withElsewhere, elsewhere: [] }, groupB],
      stationId: "st-1",
    });
    expect(el.shadowRoot!.querySelector(".elsewhere")).toBeNull();
  });

  it("board: the bill's card shows its other stations' dishes", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [withElsewhere],
      stationId: "st-1",
    });
    const section = el.shadowRoot!.querySelector('[data-card] [data-elsewhere="wo-1"]')!;
    expect(section.querySelector('[data-elsewhere-item="other-burger"]')!.textContent).toContain(
      "2× Burger",
    );
  });

  it("rail translates the other-stations heading and held state into Spanish", async () => {
    const previousLocale = currentLocale();
    setLocale("es-ES");
    try {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [withElsewhere],
        stationId: "st-1",
      });
      const section = el.shadowRoot!.querySelector(".elsewhere")!;
      expect(section.querySelector("h3")!.textContent).toBe("También en este pedido");
      expect(section.querySelector('[data-elsewhere-item="other-burger"]')!.textContent).toContain(
        "Preparando",
      );
      expect(section.querySelector('[data-elsewhere-item="other-fries"]')!.textContent).toContain(
        "En espera",
      );
      expect(section.querySelector('[data-elsewhere-item="other-steak"]')!.textContent).toContain(
        "0.75 kg× Steak",
      );
    } finally {
      setLocale(previousLocale);
    }
  });

  it("keeps dish and modifier receipt snapshots visible with an unrelated content default", async () => {
    const previousLocale = currentLocale();
    setLocale("en-GB");
    setContentLanguages({ defaultLanguage: "ca", languages: ["ca"] });
    try {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [
          {
            ...groupA,
            items: [
              { ...groupA.items[0]!, modifiers: [{ descriptions: { "es-ES": "Mantequilla" } }] },
            ],
          },
        ],
        stationId: "st-1",
      });
      expect(el.shadowRoot!.textContent).toContain("2× Paella");
      expect(el.shadowRoot!.textContent).toContain("Mantequilla");
    } finally {
      setLocale(previousLocale);
    }
  });

  it("registers as a custom element", () => {
    expect(customElements.get("till-station-queue")).toBe(TillStationQueue);
  });

  it("shows the empty placeholder and no tickets when the station queue is empty", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", { groups: [] });
    expect(el.shadowRoot!.textContent).toContain(t("station.empty"));
    expect(el.shadowRoot!.querySelectorAll("[data-item]")).toHaveLength(0);
  });

  it("rail view renders one ticket card per order with its number and label", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    const tickets = el.shadowRoot!.querySelectorAll(".ticket");
    expect(tickets).toHaveLength(2);
    expect(tickets[0]!.textContent).toContain("5");
    expect(tickets[0]!.textContent).toContain("Mesa 4");
    expect(tickets[0]!.querySelector('[data-item="ti-1"]')).not.toBeNull();
    expect(tickets[0]!.querySelector('[data-item="ti-2"]')).not.toBeNull();
  });

  it("rail: each line shows its quantity × dish name (the cook's line), not a bare line number", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    expect(el.shadowRoot!.querySelector('[data-item="ti-1"]')!.textContent).toContain("2× Paella");
    expect(el.shadowRoot!.querySelector('[data-item="ti-2"]')!.textContent).toContain("1× Agua");
  });

  it("renders a fractional line with its snapshotted unit", async () => {
    const fractional: StationQueueGroup = {
      ...groupA,
      items: [
        {
          ...groupA.items[0]!,
          quantity: "0.375",
          unitName: { "es-ES": "kg" },
          unitPrecision: 3,
        },
      ],
    };
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [fractional],
      stationId: "st-1",
    });
    expect(el.shadowRoot!.querySelector('[data-item="ti-1"]')!.textContent).toContain(
      "0.375 kg× Paella",
    );
  });

  it("leaves out the unit of a line sold in Each, and keeps every other unit's", async () => {
    const counted: StationQueueGroup = {
      ...groupA,
      items: [
        {
          ...groupA.items[0]!,
          id: "ti-each",
          name: "Croqueta",
          quantity: "2.000",
          unitName: { "es-ES": "ud" },
          unitPrecision: 0,
          soldInEach: true,
        },
        {
          ...groupA.items[0]!,
          id: "ti-kg",
          name: "Pulpo",
          quantity: "0.500",
          unitName: { "es-ES": "kg" },
          unitPrecision: 3,
          soldInEach: false,
        },
        {
          ...groupA.items[0]!,
          id: "ti-g",
          name: "Almendras",
          quantity: "200.000",
          unitName: { "es-ES": "g" },
          unitPrecision: 0,
          soldInEach: false,
        },
      ],
    };
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [counted],
      stationId: "st-1",
    });
    const text = (id: string) =>
      el.shadowRoot!.querySelector(`[data-item="${id}"]`)!.textContent!.replace(/\s+/g, " ");
    expect(text("ti-each")).toContain("2× Croqueta");
    expect(text("ti-each")).not.toContain("ud");
    expect(text("ti-kg")).toContain("0.5 kg× Pulpo");
    expect(text("ti-g")).toContain("200 g× Almendras");
  });

  it("board: each dish shows its quantity × dish name, and its card's heading the order number", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    const cell = el.shadowRoot!.querySelector('[data-column="queued"] [data-item="ti-1"]')!;
    expect(cell.textContent).toContain("2× Paella");
    const number = cell.closest("[data-card]")!.querySelector(".ticket-head .number")!;
    expect(number.textContent!.trim()).toBe("#5");
  });

  describe("the numbers an order's dishes were sent to the kitchen under", () => {
    const moved = (formerNumbers?: number[]): StationQueueGroup => ({
      ...groupA,
      orderNumber: 27,
      label: null,
      ...(formerNumbers ? { formerNumbers } : {}),
    });
    const flat = (el: Element) => el.textContent!.replace(/\s+/g, " ").trim();

    it.each([
      ["en-GB", [28], "#27 (was 28)"],
      ["es-ES", [28], "#27 (antes 28)"],
      ["en-GB", [28, 30], "#27 (was 28, 30)"],
    ])("follow the number on the card's head (%s, %j)", async (locale, formerNumbers, text) => {
      const previousLocale = currentLocale();
      setLocale(locale);
      try {
        const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
          groups: [moved(formerNumbers)],
          stationId: "st-1",
        });
        const heads = el.shadowRoot!.querySelectorAll("[data-card] .ticket-head .number");
        expect([...heads].map(flat)).toEqual([text]);
        expect(el.shadowRoot!.querySelector("[data-item] .number")).toBeNull();
      } finally {
        setLocale(previousLocale);
      }
    });

    it("leave a plain number on an order that never moved", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [moved()],
        stationId: "st-1",
      });
      expect(flat(el.shadowRoot!.querySelector("[data-card] .ticket-head .number")!)).toBe("#27");
    });

    it.each([
      [390, undefined],
      [390, [28, 30]],
    ])(
      "leave a card's dish name uncut at %s px wide (former numbers %j)",
      async (width, formerNumbers) => {
        const previous = { width: innerWidth, height: innerHeight };
        await page.viewport(width, 844);
        try {
          const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
            groups: [{ ...moved(formerNumbers), label: "Mesa 91" }],
            stationId: "st-1",
          });
          el.shadowRoot!.querySelector<HTMLButtonElement>('[data-column-tab="waiting"]')!.click();
          await el.updateComplete;
          const name = el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-1"] .line-name')!;
          expect(flat(name)).toBe("2× Paella");
          expect(name.clientWidth).toBeGreaterThan(0);
          expect(name.scrollWidth).toBeLessThanOrEqual(name.clientWidth);
        } finally {
          await page.viewport(previous.width, previous.height);
        }
      },
    );
  });

  it("renders the dish name verbatim, with no locale resolution left to fall back from", async () => {
    const group: StationQueueGroup = {
      kitchenNote: null,
      orderId: "wo-9",
      orderNumber: 9,
      label: null,
      queuedAt: "2026-08-17T10:00:00.000Z",
      status: "settled",
      thresholds: DEFAULT_THRESHOLDS,
      bumpMode: "line",
      items: [
        {
          allergy: null,
          id: "ti-x",
          workingOrderLineId: "wol-x",
          state: "queued",
          // `name` is the server-resolved kitchen label (a plain string, not a locale map) — the
          // widget renders it as sent.
          name: "Fish",
          quantity: "1.000",
          course: null,
          firedAt: "2026-08-17T10:00:00.000Z",
          queuedAt: "2026-08-17T10:00:00.000Z",
        },
      ],
    };
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [group],
      stationId: "st-1",
    });
    expect(el.shadowRoot!.querySelector('[data-item="ti-x"]')!.textContent).toContain("1× Fish");
  });

  describe("ordering modifiers (Task 14): selected options as indented sub-text under the dish", () => {
    const withModifiers: StationQueueGroup = {
      kitchenNote: null,
      orderId: "wo-9",
      orderNumber: 9,
      label: null,
      queuedAt: "2026-08-17T10:00:00.000Z",
      thresholds: DEFAULT_THRESHOLDS,
      bumpMode: "line",
      status: "placed",
      items: [
        {
          allergy: null,
          id: "ti-9",
          workingOrderLineId: "wol-9",
          state: "queued",
          name: "Cortado",
          quantity: "1.000",
          course: null,
          firedAt: "2026-08-17T10:00:00.000Z",
          queuedAt: "2026-08-17T10:00:00.000Z",
          modifiers: [
            { descriptions: { "es-ES": "Grande" } },
            { descriptions: { "es-ES": "Leche avena" } },
          ],
        },
      ],
    };

    it("renders the dish then its two options as indented '+ name' sub-text", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [withModifiers],
        stationId: "st-9",
      });
      const item = el.shadowRoot!.querySelector('[data-column="queued"] [data-item="ti-9"]')!;
      expect(item.textContent).toContain("1× Cortado");
      expect(item.textContent).toContain("+ Grande");
      expect(item.textContent).toContain("+ Leche avena");
      const html = item.innerHTML;
      expect(html.indexOf("Cortado")).toBeLessThan(html.indexOf("Grande"));
      expect(html.indexOf("Grande")).toBeLessThan(html.indexOf("Leche avena"));
    });

    it("a modifier-free item renders flat, with no modifiers sub-text at all (regression-safe)", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups, // the top-level fixture — no item here carries `modifiers`
        stationId: "st-1",
      });
      expect(el.shadowRoot!.querySelectorAll(".line-modifiers")).toHaveLength(0);
    });

    it("shows each extra's own allergens and diet on the line, distinct from the dish's own", async () => {
      const withExtraNutrition: StationQueueGroup = {
        ...withModifiers,
        items: [
          {
            ...withModifiers.items[0]!,
            // The DISH declares its own gluten; the EXTRA declares its own milk + halal.
            asServed: { allergens: { gluten: { kinds: ["wheat" as const] } }, pending: false },
            modifiers: [
              {
                descriptions: { "es-ES": "Bacon" },
                addAllergens: { milk: {} },
                suitableFor: ["halal"],
              },
            ],
          },
        ],
      };
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [withExtraNutrition],
        stationId: "st-9",
      });
      const milkName = allergenName("milk", currentLocale());
      const optAllergens = el.shadowRoot!.querySelector(
        '[data-test="item-modifier-allergens-ti-9-0"]',
      );
      expect(optAllergens).not.toBeNull();
      expect(optAllergens!.textContent).toContain(milkName);
      const optDiet = el.shadowRoot!.querySelector('[data-test="item-modifier-diet-ti-9-0"]');
      expect(optDiet).not.toBeNull();
      expect(optDiet!.querySelector("[data-diet='halal']")).not.toBeNull();
      // The dish's OWN allergen row shows its gluten, a node distinct from the extra's milk (no fold).
      const dishAllergens = el.shadowRoot!.querySelector('[data-item-allergens="ti-9"]');
      expect(dishAllergens!.textContent).toMatch(/gluten/i);
      expect(dishAllergens!.textContent).not.toContain(milkName);
    });
  });

  describe("per-line customisation (Task 5): the snapshotted note as sub-text under the dish", () => {
    const withCustomisation: StationQueueGroup = {
      kitchenNote: null,
      orderId: "wo-c",
      orderNumber: 12,
      label: null,
      queuedAt: "2026-08-17T10:00:00.000Z",
      thresholds: DEFAULT_THRESHOLDS,
      bumpMode: "line",
      status: "placed",
      items: [
        {
          allergy: null,
          id: "ti-c",
          workingOrderLineId: "wol-c",
          state: "queued",
          name: "Chuletón",
          quantity: "1.000",
          course: null,
          firedAt: "2026-08-17T10:00:00.000Z",
          queuedAt: "2026-08-17T10:00:00.000Z",
          note: "sin sal",
        },
      ],
    };

    it("renders the note as sub-text beneath the dish", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [withCustomisation],
        stationId: "st-c",
      });
      const item = el.shadowRoot!.querySelector('[data-column="queued"] [data-item="ti-c"]')!;
      expect(item.textContent).toContain("1× Chuletón");
      expect(item.querySelector("[data-note]")!.textContent).toContain("sin sal");
    });

    it("an EMPTY note renders no customisation row (an empty string is not a note)", async () => {
      const emptyNote: StationQueueGroup = {
        ...withCustomisation,
        items: [{ ...withCustomisation.items[0]!, note: "" }],
      };
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [emptyNote],
        stationId: "st-c",
      });
      const item = el.shadowRoot!.querySelector('[data-item="ti-c"]')!;
      expect(item.querySelector("[data-note]")).toBeNull();
      expect(item.querySelector(".line-customisation")).toBeNull();
    });

    it("a null note renders no customisation row", async () => {
      const noNote: StationQueueGroup = {
        ...withCustomisation,
        items: [{ ...withCustomisation.items[0]!, note: null }],
      };
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [noNote],
        stationId: "st-c",
      });
      const item = el.shadowRoot!.querySelector('[data-item="ti-c"]')!;
      expect(item.querySelector(".line-customisation")).toBeNull();
    });

    it("a plain item (no note) renders no customisation row at all (regression-safe)", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups, // the top-level fixture — no item carries a note
        stationId: "st-1",
      });
      expect(el.shadowRoot!.querySelectorAll(".line-customisation")).toHaveLength(0);
    });
  });

  describe("as-served allergens: the dish's own contains chips + not-reviewed note", () => {
    const withAllergens: StationQueueGroup = {
      kitchenNote: null,
      orderId: "wo-a",
      orderNumber: 11,
      label: null,
      queuedAt: "2026-08-17T10:00:00.000Z",
      thresholds: DEFAULT_THRESHOLDS,
      bumpMode: "line",
      status: "placed",
      items: [
        {
          allergy: null,
          id: "ti-a",
          workingOrderLineId: "wol-a",
          state: "queued",
          name: "Hamburguesa",
          quantity: "1.000",
          course: null,
          firedAt: "2026-08-17T10:00:00.000Z",
          queuedAt: "2026-08-17T10:00:00.000Z",
          asServed: { allergens: { milk: {} }, pending: false },
        },
      ],
    };

    const pendingItem: StationQueueGroup = {
      kitchenNote: null,
      orderId: "wo-p",
      orderNumber: 12,
      label: null,
      queuedAt: "2026-08-17T10:00:00.000Z",
      thresholds: DEFAULT_THRESHOLDS,
      bumpMode: "line",
      status: "placed",
      items: [
        {
          allergy: null,
          id: "ti-p",
          workingOrderLineId: "wol-p",
          state: "queued",
          name: "Especial",
          quantity: "1.000",
          course: null,
          firedAt: "2026-08-17T10:00:00.000Z",
          queuedAt: "2026-08-17T10:00:00.000Z",
          asServed: { allergens: {}, pending: true },
        },
      ],
    };

    it("shows the dish's own localised 'Milk' contains chip", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [withAllergens],
        stationId: "st-a",
      });
      const item = el.shadowRoot!.querySelector('[data-column="queued"] [data-item="ti-a"]')!;
      expect(item.textContent).toMatch(/milk/i);
    });

    it("omits the retired not-reviewed warning when the dish's own allergens are pending", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [pendingItem],
        stationId: "st-p",
      });
      const item = el.shadowRoot!.querySelector('[data-item="ti-p"]')!;
      expect(item.querySelector(".allergen-pending")).toBeNull();
      expect(item.textContent).not.toMatch(/review|revisi/i);
    });

    it("a plain item with no as-served profile renders no allergen row (regression-safe)", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups, // the top-level fixture — no item carries asServed
        stationId: "st-1",
      });
      expect(el.shadowRoot!.querySelectorAll(".line-allergens")).toHaveLength(0);
    });
  });

  describe("an advanceable line's accessible name", () => {
    const dishWithAllergens: StationQueueGroup = {
      ...groupA,
      items: [{ ...groupA.items[0]!, asServed: { allergens: { gluten: {} }, pending: false } }],
    };

    {
      it("starts with the dish, carries its allergens and ends with the bump label", async () => {
        const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
          groups: [dishWithAllergens],
          stationId: "st-1",
        });
        const line = el.shadowRoot!.querySelector<HTMLButtonElement>('button[data-item="ti-1"]')!;
        const advance = `${t("station.advance")} #5`;
        const gluten = allergenName("gluten", currentLocale());
        await expect
          .element(page.elementLocator(line))
          .toHaveAccessibleName(
            new RegExp(`^2× Paella .*${gluten}.*${advance.replace("#", "\\#")}$`, "i"),
          );
        const hidden = line.querySelector(".visually-hidden")!;
        expect(hidden.textContent).toBe(advance);
        expect(hidden.getBoundingClientRect().width).toBeLessThanOrEqual(1);
      });
    }
  });

  describe("as-served diet badges", () => {
    const veganItem: StationQueueGroup = {
      kitchenNote: null,
      orderId: "wo-v",
      orderNumber: 21,
      label: null,
      queuedAt: "2026-08-17T10:00:00.000Z",
      thresholds: DEFAULT_THRESHOLDS,
      bumpMode: "line",
      status: "placed",
      items: [
        {
          allergy: null,
          id: "ti-v",
          workingOrderLineId: "wol-v",
          state: "queued",
          name: "Ensalada",
          quantity: "1.000",
          course: null,
          firedAt: "2026-08-17T10:00:00.000Z",
          queuedAt: "2026-08-17T10:00:00.000Z",
          asServedDiet: { vegan: "yes", vegetarian: "yes", contains: [] },
        },
      ],
    };

    const meatItem: StationQueueGroup = {
      ...veganItem,
      items: [
        {
          ...veganItem.items[0]!,
          id: "ti-m",
          asServedDiet: { vegan: "no", vegetarian: "no", contains: ["meat"] },
        },
      ],
    };

    const pendingDiet: StationQueueGroup = {
      ...veganItem,
      items: [
        {
          ...veganItem.items[0]!,
          id: "ti-pd",
          asServedDiet: { vegan: "unknown", vegetarian: "unknown", contains: [] },
        },
      ],
    };

    it("shows vegan + vegetarian badges for a plant-only plate", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [veganItem],
        stationId: "st-v",
      });
      const item = el.shadowRoot!.querySelector('[data-item="ti-v"]')!;
      expect(item.querySelector("[data-diet='vegan']")).not.toBeNull();
      expect(item.querySelector("[data-diet='vegetarian']")).not.toBeNull();
      expect(item.textContent).not.toMatch(/review|revisi/i);
    });

    it("shows a contains-meat chip and no positive badge for a meat plate", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [meatItem],
        stationId: "st-m",
      });
      const item = el.shadowRoot!.querySelector('[data-item="ti-m"]')!;
      expect(item.querySelector("[data-diet-contains='meat']")).not.toBeNull();
      expect(item.querySelector("[data-diet='vegan']")).toBeNull();
    });

    it("shows the NEUTRAL 'not reviewed' state for a pending diet, never a positive claim", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [pendingDiet],
        stationId: "st-pd",
      });
      const item = el.shadowRoot!.querySelector('[data-item="ti-pd"]')!;
      expect(item.querySelector("[data-diet-pending]")).not.toBeNull();
      expect(item.querySelector("[data-diet='vegan']")).toBeNull();
    });

    it("renders no diet row for an item carrying no asServedDiet (regression-safe)", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups, // no item carries asServedDiet
        stationId: "st-1",
      });
      expect(el.shadowRoot!.querySelectorAll(".line-diet")).toHaveLength(0);
    });
  });

  it("line mode: tapping a queued line emits advance-ticket-item { itemId, stationId, to: 'preparing' }", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    const spy = vi.fn();
    el.addEventListener("advance-ticket-item", (e) => spy((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-1"]')!.click();
    expect(spy).toHaveBeenCalledWith({ itemId: "ti-1", stationId: "st-1", to: "preparing" });
  });

  it("line mode: tapping a preparing line emits advance-ticket-item { itemId, stationId, to: 'ready' }", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    const spy = vi.fn();
    el.addEventListener("advance-ticket-item", (e) => spy((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-2"]')!.click();
    expect(spy).toHaveBeenCalledWith({ itemId: "ti-2", stationId: "st-1", to: "ready" });
  });

  it("a ready line renders no bump control (its kitchen state is terminal)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    expect(el.shadowRoot!.querySelector('[data-item="ti-3"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('button[data-item="ti-3"]')).toBeNull();
  });

  it("ticket mode: tapping a line emits advance-dishes { itemIds, stationId, to } for its card's dishes at its stage", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: groups.map((g) => ({ ...g, bumpMode: "ticket" as const })),
      stationId: "st-1",
    });
    const item = vi.fn();
    const dishes = vi.fn();
    el.addEventListener("advance-ticket-item", (e) => item((e as CustomEvent).detail));
    el.addEventListener("advance-dishes", (e) => dishes((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-1"]')!.click();
    expect(item).not.toHaveBeenCalled();
    expect(dishes).toHaveBeenCalledWith({ itemIds: ["ti-1"], stationId: "st-1", to: "preparing" });
  });

  it("ticket mode without a stationId cannot fire a whole-ticket bump (the route is station-keyed)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: groups.map((g) => ({ ...g, bumpMode: "ticket" as const })), // no stationId
    });
    const spy = vi.fn();
    el.addEventListener("advance-dishes", (e) => spy((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-1"]')!.click();
    expect(spy).not.toHaveBeenCalled();
  });

  it("the advance events are composed and bubble", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    let captured: CustomEvent | undefined;
    el.addEventListener("advance-ticket-item", (e) => (captured = e as CustomEvent));
    el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-1"]')!.click();
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it("line mode: a merged queue's bump names the dish's own station, not the widget's", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [
        { ...groupA, stationId: "st-1" },
        {
          ...groupB,
          stationId: "st-2",
          items: [{ ...groupB.items[0]!, id: "ti-4", state: "queued" as const }],
        },
      ],
      stationId: "st-9",
    });
    const spy = vi.fn();
    el.addEventListener("advance-ticket-item", (e) => spy((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-1"]')!.click();
    el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-4"]')!.click();
    expect(spy.mock.calls.map(([detail]) => detail as unknown)).toEqual([
      { itemId: "ti-1", stationId: "st-1", to: "preparing" },
      { itemId: "ti-4", stationId: "st-2", to: "preparing" },
    ]);
  });

  it("line mode without any station cannot bump a line (the route checks the dish's station)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", { groups });
    const spy = vi.fn();
    el.addEventListener("advance-ticket-item", spy);
    el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-1"]')!.click();
    expect(spy).not.toHaveBeenCalled();
  });

  it("rail: a SETTLED (collectable) order shows a per-order collect button; a placed one does not", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    // groupB (wo-2) is settled → the Mode-P handover is offered; groupA (wo-1) is placed → not.
    const collectB = el.shadowRoot!.querySelector<HTMLElement>('[data-collect="wo-2"]');
    expect(collectB).not.toBeNull();
    expect(collectB!.textContent).toContain(t("station.collect"));
    expect(el.shadowRoot!.querySelector('[data-collect="wo-1"]')).toBeNull();
  });

  it("rail: tapping the collect button emits mark-collected { orderId }, composed and bubbling", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    let captured: CustomEvent | undefined;
    el.addEventListener("mark-collected", (e) => (captured = e as CustomEvent));
    el.shadowRoot!.querySelector<HTMLElement>('[data-collect="wo-2"]')!.click();
    expect(captured!.detail).toEqual({ orderId: "wo-2" });
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it("board: a settled bill's card shows its collect button; a placed bill's card does not", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    expect(el.shadowRoot!.querySelector('[data-order="6"] [data-collect="wo-2"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-order="5"] [data-collect]')).toBeNull();
  });

  it("advanceOnly: suppresses the collect button on a settled order (device mode has no collect route, §3d)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups, // groupB (wo-2) is settled → normally collectable
      stationId: "st-1",
      advanceOnly: true,
    });
    expect(el.shadowRoot!.querySelector("[data-collect]")).toBeNull();
  });

  it("rail: showReprint renders a per-order reprint button on every card; off by default", async () => {
    const off = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    expect(off.el.shadowRoot!.querySelector("[data-reprint]")).toBeNull();

    // Both a placed and a settled order get it: reprint is status-independent, unlike collect.
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      showReprint: true,
    });
    const one = el.shadowRoot!.querySelector<HTMLElement>('[data-reprint="wo-1"]');
    expect(one).not.toBeNull();
    expect(one!.textContent).toContain(t("station.reprint"));
    expect(el.shadowRoot!.querySelector('[data-reprint="wo-2"]')).not.toBeNull();
  });

  it("board: showReprint puts a reprint button on each bill's card", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      showReprint: true,
    });
    expect(el.shadowRoot!.querySelector('[data-order="5"] [data-reprint="wo-1"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-order="6"] [data-reprint="wo-2"]')).not.toBeNull();
  });

  it("rail: tapping the reprint button emits reprint-order { orderId }, composed and bubbling", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      showReprint: true,
    });
    let captured: CustomEvent | undefined;
    el.addEventListener("reprint-order", (e) => (captured = e as CustomEvent));
    el.shadowRoot!.querySelector<HTMLElement>('[data-reprint="wo-1"]')!.click();
    expect(captured!.detail).toEqual({ orderId: "wo-1" });
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it("age-colours each ticket by how long its oldest line has waited (fresh / warm / overdue)", async () => {
    // `now` is injected so the bands are deterministic. groupA queued at 10:00Z, groupB at 10:05Z.
    const now = Date.parse("2026-08-17T10:12:00.000Z"); // A: 12 min → overdue, B: 7 min → warm
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      now,
    });
    const tickets = el.shadowRoot!.querySelectorAll(".ticket");
    expect(tickets[0]!.classList.contains("age-overdue")).toBe(true);
    expect(tickets[1]!.classList.contains("age-warm")).toBe(true);
  });

  it("age-colours a just-queued ticket as fresh", async () => {
    const now = Date.parse("2026-08-17T10:01:00.000Z"); // A: 1 min → fresh
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [groupA],
      now,
    });
    expect(el.shadowRoot!.querySelector(".ticket")!.classList.contains("age-fresh")).toBe(true);
  });

  it("a line 16 minutes old escalates to forgotten (past the default 15-minute threshold)", async () => {
    const now = Date.parse("2026-08-17T10:16:00.000Z"); // A: 16 min → forgotten
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [groupA],
      now,
    });
    expect(el.shadowRoot!.querySelector(".ticket")!.classList.contains("age-forgotten")).toBe(true);
  });

  it("board: the age accent is on the dish's card", async () => {
    const now = Date.parse("2026-08-17T10:12:00.000Z"); // A: 12 min → overdue
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [groupA],
      now,
    });
    const card = el.shadowRoot!.querySelector('[data-item="ti-1"]')!.closest("[data-card]")!;
    expect(card.classList.contains("age-overdue")).toBe(true);
  });

  it("forgotten flashes by default (motion allowed) — the flash class rides alongside the steady accent", async () => {
    const now = Date.parse("2026-08-17T10:16:00.000Z"); // A: 16 min → forgotten
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [groupA],
      now,
      reducedMotion: false,
    });
    const ticket = el.shadowRoot!.querySelector(".ticket")!;
    expect(ticket.classList.contains("age-forgotten")).toBe(true);
    expect(ticket.classList.contains("flash")).toBe(true);
  });

  it("reduced motion: a forgotten ticket renders the steady-red class with NO flash/animation class", async () => {
    const now = Date.parse("2026-08-17T10:16:00.000Z"); // A: 16 min → forgotten
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [groupA],
      now,
      reducedMotion: true,
    });
    const ticket = el.shadowRoot!.querySelector(".ticket")!;
    // Still the steady red accent — just never the class the flashing @keyframes is scoped to.
    expect(ticket.classList.contains("age-forgotten")).toBe(true);
    expect(ticket.classList.contains("flash")).toBe(false);
  });

  it("reduced motion never applies flash to a merely-overdue (non-forgotten) ticket either", async () => {
    const now = Date.parse("2026-08-17T10:12:00.000Z"); // A: 12 min → overdue, not forgotten
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [groupA],
      now,
      reducedMotion: false,
    });
    const ticket = el.shadowRoot!.querySelector(".ticket")!;
    expect(ticket.classList.contains("age-overdue")).toBe(true);
    expect(ticket.classList.contains("flash")).toBe(false);
  });
});

// The fixture is one order with three courses listed OUT of display order — a held later course first,
// then a fired middle course, then the fired null (bread) course — so a passing grouping test proves the
// widget re-orders (null, then by display_order) rather than echoing the item order.
const coursedOrder: StationQueueGroup = {
  kitchenNote: null,
  orderId: "wo-c",
  orderNumber: 7,
  label: "Mesa 2",
  queuedAt: "2026-08-17T10:00:00.000Z",
  status: "placed",
  thresholds: DEFAULT_THRESHOLDS,
  bumpMode: "line",
  items: [
    {
      allergy: null,
      id: "it-main",
      workingOrderLineId: "wl-main",
      state: "queued",
      name: "Solomillo",
      quantity: "1.000",
      // Principales — HELD (fired_at null), display_order 2: must render LAST despite being listed first.
      course: { id: "co-main", name: "Principales", displayOrder: 2 },
      firedAt: null,
      queuedAt: "2026-08-17T10:00:00.000Z",
    },
    {
      allergy: null,
      id: "it-start",
      workingOrderLineId: "wl-start",
      state: "preparing",
      name: "Ensalada",
      quantity: "1.000",
      // Entrantes — FIRED, display_order 1: renders after the null course, before Principales.
      course: { id: "co-start", name: "Entrantes", displayOrder: 1 },
      firedAt: "2026-08-17T10:00:00.000Z",
      queuedAt: "2026-08-17T10:00:00.000Z",
    },
    {
      allergy: null,
      id: "it-bread",
      workingOrderLineId: "wl-bread",
      state: "queued",
      name: "Pan",
      quantity: "1.000",
      // The null course must render FIRST, and carries no header.
      course: null,
      firedAt: "2026-08-17T10:00:00.000Z",
      queuedAt: "2026-08-17T10:00:00.000Z",
    },
  ],
};

describe("till-station-queue — KDS-2 courses & fire", () => {
  it.each(["waiter", "kitchen", "expo"] as const)(
    "A773 waiter authority: legacy %s mode cannot start held food",
    async (fireControl) => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [coursedOrder, partyOrder],
        ...{ fireControl },
        stationId: "st-1",
      });
      const fire = vi.fn();
      const advance = vi.fn();
      el.addEventListener("fire-course", fire);
      el.addEventListener("fire-kitchen-group", fire);
      el.addEventListener("advance-ticket-item", advance);
      expect(el.shadowRoot!.querySelectorAll("[data-fire], [data-fire-group]")).toHaveLength(0);
      for (const id of ["it-main", "it-steak", "it-fish", "it-flan"]) {
        const held = el.shadowRoot!.querySelector<HTMLElement>(`[data-item="${id}"]`)!;
        expect(held.tagName).toBe("SPAN");
        expect(held.classList.contains("held")).toBe(true);
        held.click();
      }
      expect(fire).not.toHaveBeenCalled();
      expect(advance).not.toHaveBeenCalled();
    },
  );

  it("rail: groups a card's lines by course, header per named course, ordered null-course-first then by displayOrder", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      stationId: "st-1",
    });
    const sections = [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-course]")];
    expect(sections.map((s) => s.dataset.course)).toEqual(["none", "co-start", "co-main"]);
    expect(sections[0]!.querySelector(".course-head")).toBeNull();
    expect(sections[0]!.querySelector('[data-item="it-bread"]')).not.toBeNull();
    expect(sections[1]!.querySelector(".course-head")!.textContent).toContain("Entrantes");
    expect(sections[2]!.querySelector(".course-head")!.textContent).toContain("Principales");
  });

  it("rail: a HELD course's line renders greyed (held) and non-advanceable — a span, never a bump button", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      stationId: "st-1",
    });
    const held = el.shadowRoot!.querySelector('[data-item="it-main"]')!;
    expect(held.classList.contains("held")).toBe(true);
    expect(el.shadowRoot!.querySelector('button[data-item="it-main"]')).toBeNull();
    expect(held.tagName).toBe("SPAN");
  });

  it("a held line is dashed, keeping the solid left edge every dish row's state colours", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      stationId: "st-1",
    });
    const style = getComputedStyle(el.shadowRoot!.querySelector('[data-item="it-main"]')!);
    expect(style.borderLeftStyle).toBe("solid");
    expect(style.borderTopStyle).toBe("dashed");
    expect(style.borderRightStyle).toBe("dashed");
    expect(style.borderBottomStyle).toBe("dashed");
  });

  it("rail: a held line does not emit an advance when clicked (it is not a bump target)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      stationId: "st-1",
    });
    const spy = vi.fn();
    el.addEventListener("advance-ticket-item", spy);
    el.shadowRoot!.querySelector<HTMLElement>('[data-item="it-main"]')!.click();
    expect(spy).not.toHaveBeenCalled();
  });

  it("rail: a FIRED course's line stays advanceable (KDS-1 behaviour is unchanged for fired items)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      stationId: "st-1",
    });
    const spy = vi.fn();
    el.addEventListener("advance-ticket-item", (e) => spy((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>('button[data-item="it-start"]')!.click();
    expect(spy).toHaveBeenCalledWith({ itemId: "it-start", stationId: "st-1", to: "ready" });
  });

  it("A773 waiter authority: a held course cannot request cooking from the station", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      stationId: "st-1",
      ...{ fireControl: "kitchen" },
    });
    const fire = vi.fn();
    const advance = vi.fn();
    el.addEventListener("fire-course", fire);
    el.addEventListener("advance-ticket-item", advance);
    expect(el.shadowRoot!.querySelector("[data-fire]")).toBeNull();
    const held = el.shadowRoot!.querySelector<HTMLElement>('[data-item="it-main"]')!;
    expect(held.tagName).toBe("SPAN");
    expect(held.classList.contains("held")).toBe(true);
    held.click();
    expect(fire).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
  });

  it("A773 waiter authority: released and unassigned courses have no Fire button", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      stationId: "st-1",
      ...{ fireControl: "kitchen" },
    });
    expect(el.shadowRoot!.querySelectorAll("[data-fire]")).toHaveLength(0);
    expect(el.shadowRoot!.querySelector('[data-fire="co-start"]')).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-fire="none"]')).toBeNull();
  });

  it("waiter fire: the display shows no fire button even for a held course (the tab screen fires — Task 7)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      stationId: "st-1",
      ...{ fireControl: "waiter" },
    });
    expect(el.shadowRoot!.querySelector("[data-fire]")).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-item="it-main"]')!.classList.contains("held")).toBe(
      true,
    );
  });

  it("kanban: a held line renders greyed and non-advanceable in its state column too", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      stationId: "st-1",
    });
    const held = el.shadowRoot!.querySelector('[data-column="queued"] [data-item="it-main"]')!;
    expect(held.classList.contains("held")).toBe(true);
    expect(el.shadowRoot!.querySelector('button[data-item="it-main"]')).toBeNull();
  });

  it("kanban: held food has no Fire button", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      stationId: "st-1",
      ...{ fireControl: "kitchen" },
    });
    expect(el.shadowRoot!.querySelector("[data-fire]")).toBeNull();
  });

  it("advanceOnly: held food has no Fire button and stays non-advanceable", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      stationId: "st-1",
      ...{ fireControl: "kitchen" },
      advanceOnly: true,
    });
    expect(el.shadowRoot!.querySelector("[data-fire]")).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-item="it-main"]')!.classList.contains("held")).toBe(
      true,
    );
  });
});

it("shows saved nonprice modifier answers in the kitchen without HTML interpretation", async () => {
  const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
    groups: [
      {
        ...groupA,
        items: [
          {
            ...groupA.items[0]!,
            optionSnapshots: [
              {
                listName: { es: "Dedicatoria" },
                listCustomerName: null,
                listKitchenName: null,
                labelName: { es: "<b>Happy day</b>" },
                labelCustomerName: null,
                labelKitchenName: null,
              },
            ],
          },
        ],
      },
    ],
    stationId: "st-1",
  });
  expect(el.shadowRoot!.querySelector(".modifier-answer")!.textContent).toBe(
    "Dedicatoria: <b>Happy day</b>",
  );
  expect(el.shadowRoot!.querySelector(".modifier-answer b")).toBeNull();
});

it("shows a dish's frozen options answers in the KITCHEN's wording", async () => {
  // Three different texts per name, so the assertion fails if the card reads the staff or the
  // customer side by mistake (CLAUDE.md §3).
  const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
    groups: [
      {
        ...groupA,
        items: [
          {
            ...groupA.items[0]!,
            optionSnapshots: [
              {
                listName: { es: "Punto personal" },
                listCustomerName: { "es-ES": "¿Cómo lo quiere?" },
                listKitchenName: "PTO",
                labelName: { es: "Poco personal" },
                labelCustomerName: { "es-ES": "Poco hecho" },
                labelKitchenName: "PH",
              },
            ],
          },
        ],
      },
    ],
    stationId: "st-1",
  });
  expect(el.shadowRoot!.querySelector(".modifier-answer")!.textContent).toBe("PTO: PH");
});

describe("till-station-queue — kitchen notices strip", () => {
  const notice = (overrides: Partial<KitchenNotice>): KitchenNotice => ({
    id: "kn-1",
    stationId: "st-1",
    workingOrderId: "wo-1",
    orderLabel: "#5 · Mesa 4",
    kind: "void",
    lineName: "Burger",
    unitName: null,
    soldInEach: false,
    quantity: "1.000",
    note: null,
    wasStarted: false,
    movedTo: null,
    reroutedTo: null,
    direction: null,
    cancelledExtra: null,
    createdAt: "2026-08-17T10:10:00.000Z",
    ...overrides,
  });

  const fourKinds: KitchenNotice[] = [
    notice({ id: "kn-void", kind: "void", wasStarted: true }),
    notice({ id: "kn-recalled", kind: "recalled", lineName: "Paella", quantity: "2.000" }),
    notice({ id: "kn-changed", kind: "changed", note: "no onions" }),
    notice({ id: "kn-moved", kind: "moved", movedTo: "Mesa 9", orderLabel: "#7" }),
  ];

  const rows = (el: TillStationQueue) => [
    ...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-notice]"),
  ];

  it("renders the notices ABOVE the queue items, in the order the server sent them", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      notices: fourKinds,
    });
    expect(rows(el).map((row) => row.dataset.notice)).toEqual([
      "kn-void",
      "kn-recalled",
      "kn-changed",
      "kn-moved",
    ]);
    const strip = el.shadowRoot!.querySelector(".notices")!;
    const firstItem = el.shadowRoot!.querySelector("[data-item]")!;
    expect(
      strip.compareDocumentPosition(firstItem) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("names each kind in TEXT and with its own icon, never by colour alone", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      notices: fourKinds,
    });
    const kinds = rows(el).map((row) => row.querySelector(".notice-kind")!.textContent!.trim());
    expect(kinds).toEqual([
      t("station.notice.void"),
      t("station.notice.recalled"),
      t("station.notice.changed"),
      t("station.notice.moved"),
    ]);
    const icons = rows(el).map((row) => row.querySelector("wt-icon")!);
    expect(icons.map((icon) => icon.getAttribute("name"))).toEqual([
      "notice-void",
      "notice-recalled",
      "notice-changed",
      "notice-moved",
    ]);
    // An unregistered icon name renders nothing, so each must actually draw a path, and a distinct one.
    await Promise.all(
      icons.map(
        (icon) => (icon as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete,
      ),
    );
    const paths = icons.map((icon) => icon.shadowRoot!.querySelector("path")?.getAttribute("d"));
    expect(paths.every((d) => typeof d === "string" && d.length > 0)).toBe(true);
    expect(new Set(paths).size).toBe(4);
  });

  it("shows the line, its quantity formatted like the queue's, and the order label", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      notices: [
        notice({ quantity: "1.000" }),
        notice({ id: "kn-2", quantity: "0.250", lineName: "Jamón" }),
      ],
    });
    const [first, second] = rows(el);
    expect(first!.querySelector(".notice-line")!.textContent!.trim()).toBe("1× Burger");
    expect(first!.querySelector(".notice-order")!.textContent!.trim()).toBe("#5 · Mesa 4");
    expect(second!.querySelector(".notice-line")!.textContent!.trim()).toBe("0.25× Jamón");
  });

  it("shows the line's unit as the queue row does, and none when the line recorded none", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      notices: [
        notice({ quantity: "0.500", lineName: "Pulpo", unitName: { "es-ES": "kg" } }),
        notice({
          id: "kn-2",
          quantity: "2.000",
          lineName: "Croqueta",
          unitName: { "es-ES": "ud" },
        }),
        notice({ id: "kn-3", quantity: "2.000", lineName: "Gilda", unitName: null }),
      ],
    });
    const [weighed, counted, noUnit] = rows(el);
    expect(weighed!.querySelector(".notice-line")!.textContent!.trim()).toBe("0.5 kg× Pulpo");
    expect(counted!.querySelector(".notice-line")!.textContent!.trim()).toBe("2 ud× Croqueta");
    expect(noUnit!.querySelector(".notice-line")!.textContent!.trim()).toBe("2× Gilda");
  });

  it("leaves out the unit of a notice for a line sold in Each, and keeps every other unit's", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      notices: [
        notice({
          quantity: "2.000",
          lineName: "Croqueta",
          unitName: { "es-ES": "ud" },
          soldInEach: true,
        }),
        notice({
          id: "kn-2",
          quantity: "0.500",
          lineName: "Pulpo",
          unitName: { "es-ES": "kg" },
          soldInEach: false,
        }),
        notice({
          id: "kn-3",
          quantity: "200.000",
          lineName: "Almendras",
          unitName: { "es-ES": "g" },
          soldInEach: false,
        }),
      ],
    });
    expect(rows(el).map((row) => row.querySelector(".notice-line")!.textContent!.trim())).toEqual([
      "2× Croqueta",
      "0.5 kg× Pulpo",
      "200 g× Almendras",
    ]);
  });

  // Fails if a HOLD correction's "-1" and "+1" notices read the same on the screen.
  it("signs a changed notice's quantity by its direction, and leaves an unsigned one as it was", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      notices: [
        notice({ kind: "changed", direction: "removed", lineName: "Steak" }),
        notice({ id: "kn-2", kind: "changed", direction: "added", lineName: "Steak" }),
        notice({ id: "kn-3", kind: "changed", quantity: "2.000", unitName: { "es-ES": "ud" } }),
      ],
    });
    const lines = rows(el).map((row) => row.querySelector(".notice-line")!.textContent!.trim());
    expect(lines).toEqual(["\u22121× Steak", "+1× Steak", "2 ud× Burger"]);
    const label = rows(el)[0]!.querySelector("[data-acknowledge]")!.getAttribute("aria-label");
    expect(label).toContain("\u22121× Steak");
  });

  it("marks a started void as started, and says nothing of it on one that was not", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      notices: [notice({ wasStarted: true }), notice({ id: "kn-2", wasStarted: false })],
    });
    const [started, notStarted] = rows(el);
    expect(started!.querySelector(".notice-started")!.textContent!.trim()).toBe(
      t("station.notice.started"),
    );
    expect(notStarted!.querySelector(".notice-started")).toBeNull();
  });

  it("shows a changed notice's new note, and the table a moved notice now belongs to", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      notices: fourKinds,
    });
    const [voided, , changed, moved] = rows(el);
    expect(changed!.querySelector(".notice-note")!.textContent!.trim()).toBe("no onions");
    expect(moved!.querySelector(".notice-moved")!.textContent!.trim()).toBe(
      t("station.notice.moved_to").replace("{table}", "Mesa 9"),
    );
    expect(voided!.querySelector(".notice-note")).toBeNull();
    expect(voided!.querySelector(".notice-moved")).toBeNull();
  });

  it("shows a moved-to table label exactly as typed, `$` sequences included", async () => {
    const label = "Terraza $& $` $'";
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      notices: [notice({ kind: "moved", movedTo: label })],
    });
    expect(rows(el)[0]!.querySelector(".notice-moved")!.textContent!.trim()).toBe(
      t("station.notice.moved_to").split("{table}").join(label),
    );
  });

  it.each([
    ["en-GB", "Moved to the counter"],
    ["es-ES", "Pasado al mostrador"],
  ])(
    "shows a moved notice with no table, in %s, as moved to the counter, under its order as recorded",
    async (locale, sentence) => {
      const previousLocale = currentLocale();
      setLocale(locale);
      try {
        const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
          groups,
          stationId: "st-1",
          notices: [notice({ kind: "moved", movedTo: null, orderLabel: "#28 → #27" })],
        });
        const row = rows(el)[0]!;
        expect(row.querySelector(".notice-moved")!.textContent!.trim()).toBe(sentence);
        expect(row.querySelector(".notice-order")!.textContent!.trim()).toBe("#28 → #27");
      } finally {
        setLocale(previousLocale);
      }
    },
  );

  it.each([
    ["en-GB", "Moved station", "Moved to Grill"],
    ["es-ES", "Cambio de estación", "Pasado a Grill"],
  ])(
    "shows a rerouted notice in %s and acknowledges its destination",
    async (locale, kind, moved) => {
      const previousLocale = currentLocale();
      setLocale(locale);
      try {
        const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
          groups,
          stationId: "st-1",
          notices: [
            notice({ id: "kn-rerouted", kind: "rerouted", reroutedTo: "Grill" }),
            notice({ id: "kn-moved", kind: "moved", movedTo: "Mesa 9" }),
          ],
        });
        const row = rows(el)[0]!;
        expect(row.querySelector(".notice-kind")!.textContent!.trim()).toBe(kind);
        const icon = row.querySelector("wt-icon")!;
        await (icon as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
        expect(icon.getAttribute("name")).toBe("notice-rerouted");
        expect(icon.shadowRoot!.querySelector("path")?.getAttribute("d")).toBeTruthy();
        const movedIcon = rows(el)[1]!.querySelector("wt-icon")!;
        await (movedIcon as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
        expect(icon.shadowRoot!.querySelector("path")!.getAttribute("d")).toBe(
          movedIcon.shadowRoot!.querySelector("path")!.getAttribute("d"),
        );
        expect(row.querySelector(".notice-rerouted")!.textContent!.trim()).toBe(moved);
        const button = row.querySelector<HTMLElement>("[data-acknowledge]")!;
        expect(button.getAttribute("aria-label")).toContain(kind);
        expect(button.getAttribute("aria-label")).toContain(moved);
        const handler = vi.fn();
        document.addEventListener("acknowledge-notice", handler);
        try {
          button.click();
        } finally {
          document.removeEventListener("acknowledge-notice", handler);
        }
        expect((handler.mock.calls[0]![0] as CustomEvent).detail).toEqual({
          noticeId: "kn-rerouted",
        });
      } finally {
        setLocale(previousLocale);
      }
    },
  );

  it("shows a rerouted station name exactly as typed, `$` sequences included", async () => {
    const name = "Grill $& $` $'";
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      notices: [notice({ kind: "rerouted", reroutedTo: name })],
    });
    expect(rows(el)[0]!.querySelector(".notice-rerouted")!.textContent!.trim()).toBe(
      `Moved to ${name}`,
    );
    expect(rows(el)[0]!.querySelector("[data-acknowledge]")!.getAttribute("aria-label")).toContain(
      `Moved to ${name}`,
    );
  });

  it("Acknowledge emits acknowledge-notice with the notice's id, bubbling and composed", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      notices: fourKinds,
    });
    const handler = vi.fn();
    document.addEventListener("acknowledge-notice", handler);
    try {
      rows(el)[2]!.querySelector<HTMLElement>("[data-acknowledge]")!.click();
    } finally {
      document.removeEventListener("acknowledge-notice", handler);
    }
    expect(handler).toHaveBeenCalledOnce();
    expect((handler.mock.calls[0]![0] as CustomEvent).detail).toEqual({ noticeId: "kn-changed" });
  });

  it("each Acknowledge button's name starts with its visible text and says which notice it clears", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      notices: fourKinds,
    });
    const label = rows(el)[0]!.querySelector("[data-acknowledge]")!.getAttribute("aria-label")!;
    expect(label.startsWith(t("station.notice.acknowledge"))).toBe(true);
    expect(label).toContain(t("station.notice.void"));
    expect(label).toContain("1× Burger");
    expect(label).toContain("#5 · Mesa 4");
  });

  // Fails if a change that took an extra off a dish does not say which extra, on screen and to a
  // screen reader.
  it.each([
    ["en-GB", "Cancel: Gherkins"],
    ["es-ES", "Quitar: Gherkins"],
  ])("names the extra a change took off the dish (%s)", async (locale, shown) => {
    const previousLocale = currentLocale();
    setLocale(locale);
    try {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups,
        stationId: "st-1",
        notices: [
          notice({ id: "kn-extra", kind: "changed", cancelledExtra: "Gherkins" }),
          notice({ id: "kn-plain", kind: "changed" }),
        ],
      });
      const [extra, plain] = rows(el);
      expect(extra!.querySelector(".notice-extra")!.textContent!.trim()).toBe(shown);
      expect(t("station.notice.cancelled_extra").replace("{extra}", "Gherkins")).toBe(shown);
      expect(plain!.querySelector(".notice-extra")).toBeNull();
      const label = extra!.querySelector("[data-acknowledge]")!.getAttribute("aria-label")!;
      expect(label).toContain(shown);
      expect(plain!.querySelector("[data-acknowledge]")!.getAttribute("aria-label")).not.toContain(
        t("station.notice.cancelled_extra").split("{extra}")[0]!,
      );
    } finally {
      setLocale(previousLocale);
    }
  });

  it("shows a cancelled extra's name exactly as sent, `$` sequences included", async () => {
    const name = "Salsa $& $` $'";
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      notices: [notice({ kind: "changed", cancelledExtra: name })],
    });
    expect(rows(el)[0]!.querySelector(".notice-extra")!.textContent!.trim()).toBe(
      t("station.notice.cancelled_extra").split("{extra}").join(name),
    );
  });

  it("keeps the notices on screen when the queue itself is empty (a void can take the last item)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [],
      notices: [notice({})],
    });
    expect(rows(el)).toHaveLength(1);
    expect(el.shadowRoot!.textContent).toContain(t("station.empty"));
  });

  it("renders no strip at all when there are no notices", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    expect(el.shadowRoot!.querySelector(".notices")).toBeNull();
  });
});

// A seated party's bill: listed out of position order, with a line moved in from another bill (no
// group) and each item still carrying a course, so a passing test proves the card sections by GROUP.
const partyOrder: StationQueueGroup = {
  kitchenNote: null,
  orderId: "wo-p",
  orderNumber: 9,
  label: "Mesa 4",
  queuedAt: "2026-08-17T10:00:00.000Z",
  status: "open",
  thresholds: DEFAULT_THRESHOLDS,
  bumpMode: "line",
  party: { id: "v-4", revision: 12 },
  items: [
    {
      allergy: null,
      id: "it-steak",
      workingOrderLineId: "wl-steak",
      state: "queued",
      name: "Solomillo",
      quantity: "2.000",
      course: { id: "co-main", name: "Principales", displayOrder: 2 },
      group: { id: "g-3", position: 3, displayNumber: 3, numberPartyId: "v-4", state: "held" },
      firedAt: null,
      queuedAt: "2026-08-17T10:00:00.000Z",
    },
    {
      allergy: null,
      id: "it-salad",
      workingOrderLineId: "wl-salad",
      state: "preparing",
      name: "Ensalada",
      quantity: "1.000",
      course: { id: "co-start", name: "Entrantes", displayOrder: 1 },
      group: { id: "g-2", position: 2, displayNumber: 2, numberPartyId: "v-4", state: "fired" },
      firedAt: "2026-08-17T10:00:00.000Z",
      queuedAt: "2026-08-17T10:00:00.000Z",
    },
    {
      allergy: null,
      id: "it-moved",
      workingOrderLineId: "wl-moved",
      state: "queued",
      name: "Pan",
      quantity: "1.000",
      course: null,
      firedAt: "2026-08-17T10:00:00.000Z",
      queuedAt: "2026-08-17T10:00:00.000Z",
    },
    {
      allergy: null,
      id: "it-flan",
      workingOrderLineId: "wl-flan",
      state: "queued",
      name: "Flan",
      quantity: "1.000",
      course: { id: "co-dessert", name: "Postres", displayOrder: 3 },
      group: { id: "g-4", position: 4, displayNumber: 4, numberPartyId: "v-4", state: "held" },
      firedAt: null,
      queuedAt: "2026-08-17T10:00:00.000Z",
    },
    {
      allergy: null,
      id: "it-fish",
      workingOrderLineId: "wl-fish",
      state: "queued",
      name: "Merluza",
      quantity: "1.000",
      course: { id: "co-main", name: "Principales", displayOrder: 2 },
      group: { id: "g-3", position: 3, displayNumber: 3, numberPartyId: "v-4", state: "held" },
      firedAt: null,
      queuedAt: "2026-08-17T10:00:00.000Z",
    },
  ],
};

describe("till-station-queue — a seated party's groups", () => {
  const cards = (el: TillStationQueue) => [
    ...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-card]"),
  ];

  it("keeps permanent heading numbers when firing positions change", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [
        {
          ...partyOrder,
          items: partyOrder.items.map((item) => ({
            ...item,
            ...(item.group === undefined
              ? {}
              : {
                  group: {
                    ...item.group,
                    displayNumber: item.group.position,
                    numberPartyId: "v-4",
                    ...(item.group.id === "g-4" ? { numberPartyLabel: "Terrace 7" } : {}),
                    position: item.group.id === "g-4" ? 1 : item.group.position,
                  },
                }),
          })),
        },
      ],
      stationId: "st-1",
      ...{ fireControl: "kitchen" },
    });
    expect(cards(el).map((c) => c.dataset.cardGroup)).toEqual(["none", "g-4", "g-3", "g-2"]);
    expect(cards(el)[1]!.querySelector(".ticket-head")!.textContent).toContain(
      `${t("table.group_n").replace("{n}", "4")} · Terrace 7`,
    );
    expect(el.shadowRoot!.querySelector('[data-fire-group="g-4"]')).toBeNull();
  });

  it("draws a party's bill as one card per sent group, the dishes with no group first, each card's one course in its heading", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [partyOrder],
      stationId: "st-1",
    });
    expect(cards(el).map((c) => c.dataset.cardGroup)).toEqual(["none", "g-3", "g-4", "g-2"]);
    const [moved, held, , fired] = cards(el);
    expect(moved!.querySelector(".group-name")).toBeNull();
    expect(moved!.querySelector('[data-item="it-moved"]')).not.toBeNull();
    expect(fired!.querySelector(".ticket-head")!.textContent).toContain(
      t("table.group_n").replace("{n}", "2"),
    );
    expect(
      [...held!.querySelectorAll<HTMLElement>("[data-item]")].map((i) => i.dataset.item),
    ).toEqual(["it-steak", "it-fish"]);
    expect(el.shadowRoot!.querySelector(".course-head")).toBeNull();
    expect(held!.querySelector(".ticket-head")!.textContent).toContain(
      partyOrder.items[0]!.course!.name,
    );
  });

  it("a held group's card says it is held, not released, and its lines are greyed and not bump targets", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [partyOrder],
      stationId: "st-1",
    });
    const [, held, , fired] = cards(el);
    expect(held!.querySelector("[data-group-held]")!.textContent).toContain(
      t("station.group_held"),
    );
    expect(fired!.querySelector("[data-group-held]")).toBeNull();
    expect(held!.querySelector('[data-item="it-steak"]')!.classList.contains("held")).toBe(true);
    expect(el.shadowRoot!.querySelector('button[data-item="it-steak"]')).toBeNull();
  });

  it("A773 waiter authority: held groups cannot request cooking from the station", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [partyOrder],
      stationId: "st-1",
      ...{ fireControl: "kitchen" },
    });
    const fire = vi.fn();
    const advance = vi.fn();
    el.addEventListener("fire-kitchen-group", fire);
    el.addEventListener("advance-ticket-item", advance);
    expect(el.shadowRoot!.querySelectorAll("[data-fire-group], [data-fire]")).toHaveLength(0);
    for (const id of ["it-steak", "it-fish", "it-flan"]) {
      const held = el.shadowRoot!.querySelector<HTMLElement>(`[data-item="${id}"]`)!;
      expect(held.tagName).toBe("SPAN");
      expect(held.classList.contains("held")).toBe(true);
      held.click();
    }
    expect(fire).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
  });

  it.each(["waiter", "expo"] as const)(
    "fire control %s: no Fire on a held group",
    async (fireControl) => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [partyOrder],
        stationId: "st-1",
        ...{ fireControl },
      });
      expect(el.shadowRoot!.querySelector("[data-fire-group]")).toBeNull();
    },
  );

  it("advanceOnly: a device display never offers Fire on a held group", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [partyOrder],
      stationId: "st-1",
      ...{ fireControl: "kitchen" },
      advanceOnly: true,
    });
    expect(el.shadowRoot!.querySelector("[data-fire-group]")).toBeNull();
  });

  it("kanban: no Fire on a held group", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [partyOrder],
      stationId: "st-1",
      ...{ fireControl: "kitchen" },
    });
    expect(el.shadowRoot!.querySelector("[data-fire-group]")).toBeNull();
  });

  it("a card with no party keeps its course sections beside a party's card", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder, partyOrder],
      stationId: "st-1",
      ...{ fireControl: "kitchen" },
    });
    const counter = el.shadowRoot!.querySelector('[data-order="7"]')!;
    expect(
      [...counter.querySelectorAll<HTMLElement>("[data-course]")].map((s) => s.dataset.course),
    ).toEqual(["none", "co-start", "co-main"]);
    expect(counter.querySelector("[data-group-section]")).toBeNull();
    expect(counter.querySelector('[data-fire="co-main"]')).toBeNull();
  });
});

describe("till-station-queue — printing problems", () => {
  const troubled: StationQueueGroup = { ...groupA, printProblem: true };

  it("rail: a card whose ticket has not printed says so; another card does not", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [troubled, groupB],
      stationId: "st-1",
    });
    const card = el.shadowRoot!.querySelector('[data-order="5"]')!;
    expect(card.querySelector("[data-print-problem]")!.textContent).toContain(
      t("station.print_problem"),
    );
    expect(el.shadowRoot!.querySelector('[data-order="6"] [data-print-problem]')).toBeNull();
  });

  it("rail: Reprint is on the troubled card only where the widget shows Reprint", async () => {
    const operator = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [troubled],
      stationId: "st-1",
      showReprint: true,
    });
    expect(
      operator.el.shadowRoot!.querySelector('[data-order="5"] [data-reprint="wo-1"]'),
    ).not.toBeNull();
    const device = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [troubled],
      stationId: "st-1",
      advanceOnly: true,
    });
    expect(device.el.shadowRoot!.querySelector("[data-print-problem]")).not.toBeNull();
    expect(device.el.shadowRoot!.querySelector("[data-reprint]")).toBeNull();
  });
});

describe("cross-station extra references", () => {
  it("renders the extra beside its dish without a second modifier line", async () => {
    const item = {
      ...groupA.items[0]!,
      modifiers: [{ descriptions: { "es-ES": "Queso" } }],
      crossRefs: [
        {
          kind: "with" as const,
          name: "CHIPS",
          perDish: 2,
          stationName: "Fryer",
          addAllergens: { gluten: { kinds: ["wheat" as const] } },
          suitableFor: [],
        },
      ],
    };
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [{ ...groupA, items: [item] }],
      stationId: "st-1",
    });
    const line = el.shadowRoot!.querySelector('[data-item="ti-1"]')!;
    expect(line.querySelector("[data-crossref]")!.textContent).toContain(
      "with CHIPS x2 from Fryer",
    );
    expect(line.querySelector("[data-crossref]")!.textContent).toContain(
      allergenName("gluten", currentLocale()),
    );
    expect(line.textContent).not.toContain("+ CHIPS");
    expect(line.textContent).toContain("Queso");
  });
  it("renders the dish station and no-preparation parent in both locales", async () => {
    const previousLocale = currentLocale();
    try {
      for (const [locale, expected] of [
        ["en-GB", ["for BURG at Grill", "for AGUA, no preparation"]],
        ["es-ES", ["para BURG en Grill", "para AGUA, sin preparación"]],
      ] as const) {
        setLocale(locale);
        const item = {
          ...groupA.items[0]!,
          crossRefs: [
            { kind: "for" as const, name: "BURG", stationName: "Grill" },
            { kind: "for" as const, name: "AGUA", stationName: null },
          ],
        };
        const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
          groups: [{ ...groupA, items: [item] }],
          stationId: "st-1",
        });
        expect(
          [...el.shadowRoot!.querySelectorAll("[data-crossref]")].map((node) =>
            node.textContent!.trim(),
          ),
        ).toEqual(expected);
      }
    } finally {
      setLocale(previousLocale);
    }
  });
  it("omits a cross reference when an item has none", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [groupA],
      stationId: "st-1",
    });
    expect(el.shadowRoot!.querySelector(".crossref")).toBeNull();
  });
});

describe("Spanish split extra wording", () => {
  it("names the split extra and its station", async () => {
    const previousLocale = currentLocale();
    setLocale("es-ES");
    try {
      const item = {
        ...groupA.items[0]!,
        crossRefs: [{ kind: "with" as const, name: "CHIPS", perDish: 2, stationName: "Fryer" }],
      };
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [{ ...groupA, items: [item] }],
        stationId: "st-1",
      });
      expect(el.shadowRoot!.querySelector("[data-crossref]")!.textContent).toContain(
        "con CHIPS x2 de Fryer",
      );
    } finally {
      setLocale(previousLocale);
    }
  });
});

describe("till-station-queue — a merged queue's station labels", () => {
  const stationNames = new Map([
    ["st-1", "Cocina"],
    ["st-2", "Barra"],
  ]);
  const merged = [
    { ...groupA, stationId: "st-1" },
    { ...groupB, stationId: "st-2" },
  ];
  const label = (el: TillStationQueue, itemId: string) =>
    el
      .shadowRoot!.querySelector(`[data-item="${itemId}"] [data-line-station]`)
      ?.textContent?.trim();

  it("each dish names its own group's station", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: merged,
      stationNames,
    });
    expect(label(el, "ti-1")).toBe("Cocina");
    expect(label(el, "ti-2")).toBe("Cocina");
    expect(label(el, "ti-3")).toBe("Barra");
  });

  it("shows no station label without station names", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: merged,
      stationId: "st-1",
    });
    expect(el.shadowRoot!.querySelector("[data-line-station]")).toBeNull();
  });

  it("a whole-ticket bump carries the group's own station, not the widget's", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: merged.map((g) => ({ ...g, bumpMode: "ticket" as const })),
      stationNames,
      stationId: "st-2",
    });
    const dishes = vi.fn();
    el.addEventListener("advance-dishes", (e) => dishes((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-1"]')!.click();
    expect(dishes).toHaveBeenCalledWith({ itemIds: ["ti-1"], stationId: "st-1", to: "preparing" });
  });

  it("a merged queue bumps each order by its own station's mode", async () => {
    const queuedAtBar = {
      ...groupB,
      items: [{ ...groupB.items[0]!, id: "ti-4", state: "queued" as const }],
    };
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [
        { ...groupA, stationId: "st-1", bumpMode: "ticket" as const },
        { ...queuedAtBar, stationId: "st-2", bumpMode: "line" as const },
      ],
      stationNames,
    });
    const item = vi.fn();
    const ticket = vi.fn();
    el.addEventListener("advance-ticket-item", (e) => item((e as CustomEvent).detail));
    el.addEventListener("advance-dishes", (e) => ticket((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-1"]')!.click();
    expect(ticket).toHaveBeenCalledOnce();
    expect(ticket).toHaveBeenCalledWith({ itemIds: ["ti-1"], stationId: "st-1", to: "preparing" });
    expect(item).not.toHaveBeenCalled();
    el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-4"]')!.click();
    expect(item).toHaveBeenCalledOnce();
    expect(item).toHaveBeenCalledWith({ itemId: "ti-4", stationId: "st-2", to: "preparing" });
    expect(ticket).toHaveBeenCalledOnce();
    const bumpLabel = (itemId: string) =>
      el.shadowRoot!.querySelector(`button[data-item="${itemId}"] .visually-hidden`)?.textContent;
    expect(bumpLabel("ti-1")).toBe("Advance ticket #5");
    expect(bumpLabel("ti-4")).toBe("Advance #6");
  });

  describe("a whole-ticket order is marked so a cook sees it before tapping", () => {
    const queuedAtBar = {
      ...groupB,
      items: [{ ...groupB.items[0]!, id: "ti-4", state: "queued" as const }],
    };
    const readyAtKitchen = { ...groupB.items[0]!, id: "ti-5", state: "ready" as const };
    const mixed = [
      {
        ...groupA,
        stationId: "st-1",
        bumpMode: "ticket" as const,
        items: [...groupA.items, readyAtKitchen],
      },
      { ...queuedAtBar, stationId: "st-2", bumpMode: "line" as const },
    ];
    // A sighted cook can read it: a real box, not the 1px clipped box `.visually-hidden` draws.
    const readable = (node: Element) => {
      const box = node.getBoundingClientRect();
      return (
        box.width > 1 &&
        box.height > 1 &&
        getComputedStyle(node).clip !== "rect(0px, 0px, 0px, 0px)"
      );
    };
    const mark = "[data-whole-ticket]";
    const tap = (el: TillStationQueue) => {
      const item = vi.fn();
      const ticket = vi.fn();
      el.addEventListener("advance-ticket-item", (e) => item((e as CustomEvent).detail));
      el.addEventListener("advance-dishes", (e) => ticket((e as CustomEvent).detail));
      el.shadowRoot!.querySelector<HTMLElement>('button[data-item="ti-1"]')!.click();
      expect(ticket).toHaveBeenCalledExactlyOnceWith({
        itemIds: ["ti-1"],
        stationId: "st-1",
        to: "preparing",
      });
      expect(item).not.toHaveBeenCalled();
      el.shadowRoot!.querySelector<HTMLElement>('button[data-item="ti-4"]')!.click();
      expect(item).toHaveBeenCalledExactlyOnceWith({
        itemId: "ti-4",
        stationId: "st-2",
        to: "preparing",
      });
      expect(ticket).toHaveBeenCalledOnce();
    };

    it("rail: a ticket-mode card with no dish left to bump shows no mark", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [{ ...groupB, stationId: "st-1", bumpMode: "ticket" as const }],
        stationNames,
      });
      expect(el.shadowRoot!.querySelector('article[data-order="6"]')).not.toBeNull();
      expect(el.shadowRoot!.querySelector(mark)).toBeNull();
    });

    it("a ticket-mode order whose only unfinished dish is held shows no mark", async () => {
      const held = { ...groupA.items[0]!, id: "ti-held", firedAt: null };
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [
          {
            ...groupB,
            stationId: "st-1",
            bumpMode: "ticket" as const,
            items: [...groupB.items, held],
          },
        ],
        stationNames,
      });
      expect(el.shadowRoot!.querySelector('[data-item="ti-held"]')).not.toBeNull();
      expect(el.shadowRoot!.querySelector(mark)).toBeNull();
    });

    it("the ticket-mode card shows the mark once and the line-mode card none", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: mixed,
        stationNames,
      });
      const card = (itemId: string) =>
        el.shadowRoot!.querySelector(`[data-item="${itemId}"]`)!.closest("[data-card]")!;
      const marks = card("ti-1").querySelectorAll(mark);
      expect(marks).toHaveLength(1);
      expect(marks[0]!.textContent!.trim()).toBe("Whole ticket");
      expect(readable(marks[0]!)).toBe(true);
      expect(readable(card("ti-1").querySelector(".visually-hidden")!)).toBe(false);
      // The control: the hidden label the mark stands beside is still there, and is not readable.
      const hidden = card("ti-1").querySelector('button[data-item="ti-1"] .visually-hidden')!;
      expect(hidden.textContent).toBe("Advance ticket #5");
      expect(readable(hidden)).toBe(false);
      expect(card("ti-5")).toBe(card("ti-1"));
      expect(card("ti-4").querySelector(mark)).toBeNull();
      expect(
        card("ti-4").querySelector('button[data-item="ti-4"] .visually-hidden')!.textContent,
      ).toBe("Advance #6");
      expect(el.shadowRoot!.querySelectorAll(mark)).toHaveLength(1);
      tap(el);
    });

    it("the mark reads in Spanish", async () => {
      const previousLocale = currentLocale();
      setLocale("es-ES");
      try {
        const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
          groups: mixed,
          stationNames,
        });
        const marks = [...el.shadowRoot!.querySelectorAll(mark)];
        expect(marks.length).toBeGreaterThan(0);
        for (const node of marks) expect(node.textContent!.trim()).toBe("Toda la comanda");
      } finally {
        setLocale(previousLocale);
      }
    });
  });

  it("each notice names its station", async () => {
    const base: KitchenNotice = {
      id: "kn-1",
      stationId: "st-2",
      workingOrderId: "wo-2",
      orderLabel: "#6",
      kind: "void",
      lineName: "Café",
      unitName: null,
      soldInEach: false,
      quantity: "1.000",
      note: null,
      wasStarted: false,
      movedTo: null,
      reroutedTo: null,
      direction: null,
      cancelledExtra: null,
      createdAt: "2026-08-17T10:10:00.000Z",
    };
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: merged,
      stationNames,
      notices: [base],
    });
    const notice = el.shadowRoot!.querySelector('[data-notice="kn-1"]')!;
    const station = notice.querySelector<HTMLElement>("[data-notice-station]")!;
    expect(station.textContent!.trim()).toBe("Barra");
    // As a dish carries it: under the content, never between the kind and the dish.
    const line = notice.querySelector<HTMLElement>(".notice-line")!;
    const order = notice.querySelector<HTMLElement>(".notice-order")!;
    expect(order.compareDocumentPosition(station) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(station.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      line.getBoundingClientRect().bottom,
    );
  });
});

describe("till-station-queue — moving a dish to another station", () => {
  const order: StationQueueGroup = {
    kitchenNote: null,
    orderId: "wo-m",
    orderNumber: 8,
    label: "Mesa 3",
    queuedAt: "2026-08-17T10:00:00.000Z",
    status: "placed",
    thresholds: DEFAULT_THRESHOLDS,
    bumpMode: "line",
    items: [
      {
        allergy: null,
        id: "ti-fired",
        workingOrderLineId: "wol-fired",
        state: "queued",
        name: "Paella",
        quantity: "2.000",
        course: null,
        firedAt: "2026-08-17T10:00:00.000Z",
        queuedAt: "2026-08-17T10:00:00.000Z",
      },
      {
        allergy: null,
        id: "ti-held",
        workingOrderLineId: "wol-held",
        state: "queued",
        name: "Solomillo",
        quantity: "1.000",
        course: { id: "co-main", name: "Principales", displayOrder: 2 },
        firedAt: null,
        queuedAt: "2026-08-17T10:00:00.000Z",
      },
      {
        allergy: null,
        id: "ti-preparing",
        workingOrderLineId: "wol-preparing",
        state: "preparing",
        name: "Agua",
        quantity: "1.000",
        course: null,
        firedAt: "2026-08-17T10:00:00.000Z",
        queuedAt: "2026-08-17T10:00:00.000Z",
      },
      {
        allergy: null,
        id: "ti-ready",
        workingOrderLineId: "wol-ready",
        state: "ready",
        name: "Café",
        quantity: "1.000",
        course: null,
        firedAt: "2026-08-17T10:00:00.000Z",
        queuedAt: "2026-08-17T10:00:00.000Z",
      },
      // An extra prepared at its own station is its own queue item, named "for" its dish
      // (apps/server/src/split-off-extras.queue.test.ts); the till moves dishes only.
      {
        allergy: null,
        id: "ti-extra",
        workingOrderLineId: "wol-extra",
        state: "queued",
        name: "CHIPS",
        quantity: "2.000",
        course: null,
        firedAt: "2026-08-17T10:00:00.000Z",
        queuedAt: "2026-08-17T10:00:00.000Z",
        crossRefs: [{ kind: "for", name: "BURG", stationName: "Grill" }],
      },
    ],
  };
  const moveButtons = (el: TillStationQueue) =>
    [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-move-station]")].map(
      (button) => button.dataset.moveStation,
    );

  it("draws no Move without canMove", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [order],
      stationId: "st-1",
    });
    expect(moveButtons(el)).toEqual([]);
  });

  it("draws Move on held and fired queued dishes only, never on a started dish or an extra", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [order],
      stationId: "st-1",
      canMove: true,
    });
    expect(moveButtons(el).sort()).toEqual(["ti-fired", "ti-held"]);
    const button = el.shadowRoot!.querySelector<HTMLElement>('[data-move-station="ti-fired"]')!;
    expect(button.tagName).toBe("WT-BUTTON");
    expect(button.getAttribute("size")).toBe("sm");
    expect(button.getAttribute("variant")).toBe("secondary");
    expect(button.getAttribute("aria-label")).toBe(`${t("table.move_station")} · Paella`);
    expect(button.textContent!.trim()).toBe(t("table.move_station"));
    expect(button.closest("[data-item]")).toBeNull();
  });

  it("pressing Move asks to move that dish from this station, and bumps nothing", async () => {
    const { el, host } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [order],
      stationId: "st-1",
      canMove: true,
    });
    const moves: CustomEvent[] = [];
    host.addEventListener("move-station", (e) => moves.push(e as CustomEvent));
    const bumps = vi.fn();
    el.addEventListener("advance-ticket-item", bumps);
    el.addEventListener("advance-ticket", bumps);
    el.shadowRoot!.querySelector<HTMLElement>('[data-move-station="ti-fired"]')!.click();
    el.shadowRoot!.querySelector<HTMLElement>('[data-move-station="ti-held"]')!.click();
    expect(moves.map((e) => e.detail)).toEqual([
      { workingOrderId: "wo-m", lineId: "wol-fired", name: "Paella", stationId: "st-1" },
      { workingOrderId: "wo-m", lineId: "wol-held", name: "Solomillo", stationId: "st-1" },
    ]);
    expect(moves.every((e) => e.bubbles && e.composed)).toBe(true);
    expect(bumps).not.toHaveBeenCalled();
  });

  it("a merged queue's Move names the dish's own station, not the widget's", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [{ ...order, stationId: "st-2" }],
      stationNames: new Map([["st-2", "Barra"]]),
      stationId: "st-1",
      canMove: true,
    });
    const moved = vi.fn();
    el.addEventListener("move-station", (e) => moved((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>('[data-move-station="ti-fired"]')!.click();
    expect(moved).toHaveBeenCalledWith({
      workingOrderId: "wo-m",
      lineId: "wol-fired",
      name: "Paella",
      stationId: "st-2",
    });
  });
});

describe("till-station-queue — where Move sits", () => {
  const dish = (id: string, name: string): StationQueueItem => ({
    allergy: null,
    id,
    workingOrderLineId: `wol-${id}`,
    state: "queued",
    name,
    quantity: "1.000",
    course: null,
    firedAt: "2026-08-17T10:00:00.000Z",
    queuedAt: "2026-08-17T10:00:00.000Z",
  });
  const order: StationQueueGroup = {
    kitchenNote: null,
    orderId: "wo-g",
    orderNumber: 9,
    label: null,
    queuedAt: "2026-08-17T10:00:00.000Z",
    status: "placed",
    thresholds: DEFAULT_THRESHOLDS,
    bumpMode: "line",
    items: [dish("ti-a", "Ensalada mixta"), dish("ti-b", "Pan")],
  };
  const box = (el: TillStationQueue, selector: string) =>
    el.shadowRoot!.querySelector<HTMLElement>(selector)!.getBoundingClientRect();

  it("kanban: Move does not widen the dish it sits under", async () => {
    const plain = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [order],
      stationId: "st-1",
    });
    const movable = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [order],
      stationId: "st-1",
      canMove: true,
    });
    expect(box(movable.el, '[data-item="ti-a"]').width).toBe(
      box(plain.el, '[data-item="ti-a"]').width,
    );
  });

  it("rail: Move sits nearer its own dish than the next one", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [order],
      stationId: "st-1",
      canMove: true,
    });
    const own = box(el, '[data-item="ti-a"]');
    const move = box(el, '[data-move-station="ti-a"]');
    const next = box(el, '[data-item="ti-b"]');
    expect(move.top - own.bottom).toBeLessThan(next.top - move.bottom);
  });
});

describe("station move attribution", () => {
  it.each(["en-GB", "es-ES"] as const)("shows the mover on the card in %s", async (locale) => {
    const previous = currentLocale();
    setLocale(locale);
    try {
      {
        const movedAt = new Date(2026, 9, 10, 20, 12).toISOString();
        const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
          stationId: "st-1",
          canMove: true,
          groups: [
            {
              ...groupA,
              items: [
                {
                  ...groupA.items[0]!,
                  lastMove: {
                    fromStationName: "Grill $&",
                    personName: "Luis",
                    deviceName: "Till 2",
                    movedAt,
                  },
                },
                {
                  ...groupA.items[1]!,
                  lastMove: {
                    fromStationName: "Bar",
                    personName: "Ana",
                    deviceName: null,
                    movedAt,
                  },
                },
                {
                  ...groupB.items[0]!,
                  lastMove: {
                    fromStationName: "Grill",
                    personName: null,
                    deviceName: "Kitchen display",
                    movedAt,
                  },
                },
                { ...groupB.items[0]!, id: "unmoved" },
              ],
            },
          ],
        });
        const prefix = locale === "es-ES" ? "Pasado de" : "Moved from";
        const text = (id: string) =>
          el.shadowRoot!.querySelector(`[data-item="${id}"] [data-last-move]`)?.textContent?.trim();
        const time = "20:12";
        expect(text("ti-1")).toBe(`${prefix} Grill $& · Luis · Till 2 · ${time}`);
        expect(text("ti-2")).toBe(`${prefix} Bar · Ana · ${time}`);
        expect(text("ti-3")).toBe(`${prefix} Grill · Kitchen display · ${time}`);
        expect(text("unmoved")).toBeUndefined();
      }
    } finally {
      setLocale(previous);
    }
  });
});

describe("till-station-queue — a dish sent after its period", () => {
  const starters = { id: "co-start", name: "Starters", displayOrder: 1 };
  const mains = { id: "co-main", name: "Mains", displayOrder: 2 };
  const line = (
    id: string,
    course: StationQueueItem["course"],
    afterPeriod?: string,
  ): StationQueueItem => ({
    ...groupA.items[0]!,
    id,
    workingOrderLineId: `wl-${id}`,
    name: id,
    course,
    ...(afterPeriod === undefined ? {} : { afterPeriod }),
  });
  const lateOrder = (items: StationQueueItem[]): StationQueueGroup => ({ ...groupA, items });
  // Each section's lines in order: a mark row reads as its words, a dish as its id.
  const rows = (el: TillStationQueue) =>
    [...el.shadowRoot!.querySelectorAll<HTMLElement>(".course")].map((section) =>
      [...section.querySelectorAll<HTMLElement>("[data-after-period], [data-item]")].map(
        (row) => row.dataset.item ?? row.textContent!.trim(),
      ),
    );
  const mount = async (items: StationQueueItem[], extra: Partial<TillStationQueue> = {}) =>
    (
      await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [lateOrder(items)],
        stationId: "st-1",
        ...extra,
      })
    ).el;

  it("puts one mark above two consecutive dishes marked with the same period under one head", async () => {
    const el = await mount([
      line("tortilla", starters, "Lunch"),
      line("entrecot", starters, "Lunch"),
    ]);
    expect(rows(el)).toEqual([["After Lunch — agreed", "tortilla", "entrecot"]]);
  });

  it("marks again after an unmarked dish between two marked ones", async () => {
    const el = await mount([
      line("tortilla", starters, "Lunch"),
      line("bread", starters),
      line("entrecot", starters, "Lunch"),
    ]);
    expect(rows(el)).toEqual([
      ["After Lunch — agreed", "tortilla", "bread", "After Lunch — agreed", "entrecot"],
    ]);
  });

  it("marks under each course head, never one row across two heads", async () => {
    const el = await mount([line("tortilla", starters, "Lunch"), line("entrecot", mains, "Lunch")]);
    expect(rows(el)).toEqual([
      ["After Lunch — agreed", "tortilla"],
      ["After Lunch — agreed", "entrecot"],
    ]);
  });

  it("marks under each of a seated party's sent groups", async () => {
    const sent = (id: string, position: number) => ({
      id,
      position,
      displayNumber: position,
      numberPartyId: "v-4",
      state: "fired" as const,
    });
    const el = (
      await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [
          {
            ...lateOrder([
              { ...line("tortilla", starters, "Lunch"), group: sent("g-1", 1) },
              { ...line("entrecot", starters, "Lunch"), group: sent("g-2", 2) },
            ]),
            party: { id: "v-4", revision: 1 },
          },
        ],
        stationId: "st-1",
      })
    ).el;
    const cardRows = [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-card]")].map((card) =>
      [...card.querySelectorAll<HTMLElement>("[data-after-period], [data-item]")].map(
        (row) => row.dataset.item ?? row.textContent!.trim(),
      ),
    );
    expect(cardRows).toEqual([
      ["After Lunch — agreed", "tortilla"],
      ["After Lunch — agreed", "entrecot"],
    ]);
  });

  it("gives each period its own mark", async () => {
    const el = await mount([line("tortilla", starters, "Lunch"), line("cava", starters, "Brunch")]);
    expect(rows(el)).toEqual([
      ["After Lunch — agreed", "tortilla", "After Brunch — agreed", "cava"],
    ]);
  });

  it("draws no mark when no dish is marked", async () => {
    const el = await mount([line("tortilla", starters), line("entrecot", mains)]);
    expect(el.shadowRoot!.querySelector("[data-after-period]")).toBeNull();
  });

  it("board: marks a marked dish within its card, and not an unmarked one", async () => {
    const el = await mount([line("tortilla", starters, "Lunch"), line("bread", starters)]);
    expect(el.shadowRoot!.querySelectorAll("[data-card]")).toHaveLength(1);
    expect(rows(el)).toEqual([["After Lunch — agreed", "tortilla", "bread"]]);
  });

  it("board: words the mark in Spanish", async () => {
    const previous = currentLocale();
    setLocale("es-ES");
    try {
      const el = await mount([line("tortilla", starters, "Lunch $&")]);
      const expected = t("station.after_period").replace("{period}", () => "Lunch $&");
      expect(expected).not.toContain("After");
      expect(
        el.shadowRoot!.querySelector("[data-card] [data-after-period]")!.textContent!.trim(),
      ).toBe(expected);
    } finally {
      setLocale(previous);
    }
  });

  it("words the mark in Spanish", async () => {
    const previous = currentLocale();
    setLocale("es-ES");
    try {
      const el = await mount([line("tortilla", starters, "Lunch $&")]);
      const expected = t("station.after_period").replace("{period}", () => "Lunch $&");
      expect(expected).not.toContain("After");
      expect(rows(el)).toEqual([[expected, "tortilla"]]);
    } finally {
      setLocale(previous);
    }
  });
});

describe("the board's cards", () => {
  const sent = (id: string, position: number, state: "held" | "fired" = "fired") => ({
    id,
    position,
    displayNumber: position,
    numberPartyId: "pa-1",
    state,
  });
  const dish = (
    id: string,
    firedAt: string | null,
    extra: Partial<StationQueueItem> = {},
  ): StationQueueItem => ({
    ...groupA.items[0]!,
    id,
    workingOrderLineId: `wol-${id}`,
    name: `Dish ${id}`,
    firedAt,
    queuedAt: firedAt ?? "2026-08-17T10:00:00.000Z",
    ...extra,
  });
  const bill = (
    orderId: string,
    orderNumber: number,
    items: StationQueueItem[],
  ): StationQueueGroup => ({
    ...groupA,
    orderId,
    orderNumber,
    label: "Table 7",
    party: { id: "pa-1", revision: 1 },
    items,
  });
  const cardsIn = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>("[data-card]")];
  const dishesOn = (card: Element) =>
    [...card.querySelectorAll<HTMLElement>("[data-item]")].map((node) => node.dataset.item);
  const flat = (node: Element) => node.textContent!.replace(/\s+/g, " ").trim();
  const column = (el: TillStationQueue, state: string) =>
    el.shadowRoot!.querySelector(`[data-column="${state}"]`)!;

  it("draws three columns of cards, each in its least advanced dish's column", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    expect(column(el, "queued").querySelector(".column-title")!.textContent).toBe(
      t("station.state.queued"),
    );
    const waiting = cardsIn(column(el, "queued"));
    expect(waiting.map((card) => card.dataset.order)).toEqual(["5"]);
    expect(dishesOn(waiting[0]!)).toEqual(["ti-1", "ti-2"]);
    expect(waiting[0]!.dataset.cardGroup).toBe("none");
    expect(cardsIn(column(el, "preparing"))).toHaveLength(0);
    const ready = cardsIn(column(el, "ready"));
    expect(ready.map((card) => card.dataset.order)).toEqual(["6"]);
    expect(dishesOn(ready[0]!)).toEqual(["ti-3"]);
  });

  it("names the first column Waiting, in Spanish Esperando", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    expect(flat(column(el, "queued").querySelector(".column-title")!)).toBe("Waiting");
    const previousLocale = currentLocale();
    setLocale("es");
    try {
      const spanish = await mountWidget<TillStationQueue>("till-station-queue", {
        groups,
        stationId: "st-1",
      });
      const title = flat(column(spanish.el, "queued").querySelector(".column-title")!);
      expect(title).toBe(t("station.state.queued"));
      expect(title).not.toBe("Waiting");
    } finally {
      setLocale(previousLocale);
    }
  });

  it("gives a party one card per sent group and the dishes with no group their own, oldest first", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [
        bill("wo-1", 5, [
          dish("late", "2026-08-17T10:42:00.000Z", { group: sent("g-2", 2) }),
          dish("first", "2026-08-17T10:00:00.000Z", { group: sent("g-1", 1) }),
          dish("moved", "2026-08-17T10:20:00.000Z"),
        ]),
      ],
      stationId: "st-1",
      now: Date.parse("2026-08-17T10:45:00.000Z"),
      reducedMotion: true,
    });
    const cards = cardsIn(column(el, "queued"));
    expect(cards.map((card) => card.dataset.cardGroup)).toEqual(["g-1", "none", "g-2"]);
    expect(cards.map(dishesOn)).toEqual([["first"], ["moved"], ["late"]]);
    expect(cards.map((card) => flat(card.querySelector(".ticket-head .age")!))).toEqual([
      `45 ${t("station.min")}`,
      `25 ${t("station.min")}`,
      `3 ${t("station.min")}`,
    ]);
    expect(cards[0]!.classList.contains("age-forgotten")).toBe(true);
    expect(cards[2]!.classList.contains("age-fresh")).toBe(true);
    expect(flat(cards[0]!.querySelector(".ticket-head")!)).toContain(
      t("table.group_n").replace("{n}", "1"),
    );
    expect(flat(cards[2]!.querySelector(".ticket-head")!)).toContain(
      t("table.group_n").replace("{n}", "2"),
    );
  });

  it("draws one card for a group sent across two bills, with both bills' numbers", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [
        bill("wo-1", 12, [
          dish("bill-1-dish", "2026-08-17T10:00:00.000Z", { group: sent("g-2", 2) }),
        ]),
        bill("wo-2", 13, [
          dish("bill-2-dish", "2026-08-17T10:00:00.000Z", { group: sent("g-2", 2) }),
        ]),
      ],
      stationId: "st-1",
      canMove: true,
    });
    const cards = cardsIn(el.shadowRoot!);
    expect(cards).toHaveLength(1);
    const [card] = cards;
    expect(card!.dataset.order).toBe("12");
    expect(card!.dataset.cardGroup).toBe("g-2");
    expect([...card!.querySelectorAll(".ticket-head .number")].map(flat)).toEqual(["#12", "#13"]);
    expect([...card!.querySelectorAll(".ticket-head .label")].map(flat)).toEqual(["Table 7"]);
    expect(flat(card!.querySelector(".ticket-head")!)).toContain("#12 · #13");
    expect(dishesOn(card!)).toEqual(["bill-1-dish", "bill-2-dish"]);
    const label = (id: string) =>
      card!.querySelector(`button[data-item="${id}"] .visually-hidden`)!.textContent;
    expect(label("bill-1-dish")).toBe(`${t("station.advance")} #12`);
    expect(label("bill-2-dish")).toBe(`${t("station.advance")} #13`);
    const moved = vi.fn();
    el.addEventListener("move-station", (e) => moved((e as CustomEvent).detail));
    card!.querySelector<HTMLElement>('[data-move-station="bill-2-dish"]')!.click();
    expect(moved).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ workingOrderId: "wo-2", lineId: "wol-bill-2-dish" }),
    );
  });

  it("draws a held group's card dashed in Waiting, with no minutes", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [
        bill("wo-1", 5, [
          dish("held-1", null, { group: sent("g-3", 3, "held") }),
          dish("held-2", null, { group: sent("g-3", 3, "held") }),
          dish("fired", "2026-08-17T10:00:00.000Z", { group: sent("g-4", 4) }),
          dish("kept-back", null, { group: sent("g-4", 4) }),
        ]),
      ],
      stationId: "st-1",
      now: Date.parse("2026-08-17T10:07:00.000Z"),
    });
    const cards = cardsIn(column(el, "queued"));
    expect(cards.map((card) => card.dataset.cardGroup)).toEqual(["g-4", "g-3"]);
    const [mixed, held] = cards;
    expect(held!.classList.contains("held")).toBe(true);
    expect(getComputedStyle(held!).borderTopStyle).toBe("dashed");
    expect(held!.querySelector(".age")).toBeNull();
    expect([...held!.classList].some((name) => name.startsWith("age-"))).toBe(false);
    expect(flat(held!.querySelector(".ticket-head")!)).toContain(t("station.group_held"));
    // The control: a card with one dish fired is timed by it and drawn solid.
    expect(mixed!.classList.contains("held")).toBe(false);
    expect(getComputedStyle(mixed!).borderTopStyle).toBe("solid");
    expect(flat(mixed!.querySelector(".ticket-head .age")!)).toBe(`7 ${t("station.min")}`);
  });

  // A recall un-fires a fired group's dishes; a bill taken to the counter then leaves its group.
  it("says a card is held whenever every dish on it is, in a fired group or in none", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [
        bill("wo-1", 5, [
          dish("recalled", null, { group: sent("g-2", 2) }),
          dish("fired", "2026-08-17T10:00:00.000Z", { group: sent("g-3", 3) }),
          dish("kept-back", null, { group: sent("g-3", 3) }),
        ]),
        { ...groupA, orderId: "wo-2", orderNumber: 6, items: [dish("at-the-counter", null)] },
      ],
      stationId: "st-1",
      now: Date.parse("2026-08-17T10:07:00.000Z"),
    });
    const cards = cardsIn(column(el, "queued"));
    expect(cards.map((card) => card.dataset.cardGroup)).toEqual(["g-3", "g-2", "none"]);
    const [mixed, ...held] = cards;
    for (const card of held) {
      expect(card.classList.contains("held")).toBe(true);
      expect(card.querySelector("[data-card-head]")).toBeNull();
      expect(flat(card.querySelector(".ticket-head")!)).toContain(t("station.group_held"));
    }
    // The control: a fired group's card with one dish fired says it only beside its held dish.
    expect(flat(mixed!.querySelector(".ticket-head")!)).not.toContain(t("station.group_held"));
    expect(flat(mixed!.querySelector('[data-item="kept-back"]')!)).toContain(
      t("station.group_held"),
    );
  });

  const elsewhereDish = {
    id: "other-burger",
    name: "Burger",
    quantity: "1.000",
    unitName: null,
    unitPrecision: null,
    soldInEach: true,
    stationName: "Grill",
    state: "preparing" as const,
    held: false,
  };
  const troubledBill = (
    orderId: string,
    orderNumber: number,
    items: StationQueueItem[],
  ): StationQueueGroup => ({
    ...bill(orderId, orderNumber, items),
    status: "settled",
    kitchenNote: `No salt on ${orderNumber}`,
    printProblem: true,
    elsewhere: [{ ...elsewhereDish, id: `other-${orderNumber}` }],
  });

  it("shows the bill's note, printing problem, other stations' dishes, Collect and Reprint on each of its cards", async () => {
    const twoGroups = [
      troubledBill("wo-1", 12, [
        dish("first", "2026-08-17T10:00:00.000Z", { group: sent("g-1", 1) }),
        dish("second", "2026-08-17T10:20:00.000Z", { group: sent("g-2", 2) }),
      ]),
    ];
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: twoGroups,
      stationId: "st-1",
      showReprint: true,
    });
    const cards = cardsIn(el.shadowRoot!);
    expect(cards.map((card) => card.dataset.cardGroup)).toEqual(["g-1", "g-2"]);
    const collected = vi.fn();
    const reprinted = vi.fn();
    el.addEventListener("mark-collected", (e) => collected((e as CustomEvent).detail));
    el.addEventListener("reprint-order", (e) => reprinted((e as CustomEvent).detail));
    for (const card of cards) {
      expect(flat(card.querySelector("[data-kitchen-note]")!)).toBe(
        `${t("kitchen_note.heading")}: No salt on 12`,
      );
      expect(flat(card.querySelector("[data-print-problem]")!)).toBe(t("station.print_problem"));
      const elsewhere = card.querySelector('[data-elsewhere="wo-1"]')!;
      expect(flat(elsewhere.querySelector("h3")!)).toBe(t("station.elsewhere"));
      expect(flat(elsewhere.querySelector('[data-elsewhere-item="other-12"]')!)).toContain(
        "1× Burger",
      );
      expect(flat(card.querySelector('[data-collect="wo-1"]')!)).toBe(t("station.collect"));
      const reprint = card.querySelector<HTMLElement>('[data-reprint="wo-1"]')!;
      expect(flat(reprint)).toBe(t("station.reprint"));
      card.querySelector<HTMLElement>('[data-collect="wo-1"]')!.click();
      reprint.click();
    }
    expect(collected.mock.calls).toEqual([[{ orderId: "wo-1" }], [{ orderId: "wo-1" }]]);
    expect(reprinted.mock.calls).toEqual([[{ orderId: "wo-1" }], [{ orderId: "wo-1" }]]);
    expect(el.shadowRoot!.querySelector("[data-print-problems]")).toBeNull();

    const device = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: twoGroups,
      stationId: "st-1",
      advanceOnly: true,
    });
    expect(cardsIn(device.el.shadowRoot!)).toHaveLength(2);
    expect(device.el.shadowRoot!.querySelectorAll("[data-print-problem]")).toHaveLength(2);
    expect(device.el.shadowRoot!.querySelector("[data-collect]")).toBeNull();
    expect(device.el.shadowRoot!.querySelector("[data-reprint]")).toBeNull();
  });

  it("on a group's card spanning two bills, names each bill's note, printing problem and Reprint", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [
        troubledBill("wo-1", 12, [
          dish("bill-1-dish", "2026-08-17T10:00:00.000Z", { group: sent("g-2", 2) }),
        ]),
        troubledBill("wo-2", 13, [
          dish("bill-2-dish", "2026-08-17T10:00:00.000Z", { group: sent("g-2", 2) }),
        ]),
      ],
      stationId: "st-1",
      showReprint: true,
    });
    const [card, ...others] = cardsIn(el.shadowRoot!);
    expect(others).toHaveLength(0);
    expect([...card!.querySelectorAll("[data-kitchen-note]")].map(flat)).toEqual([
      `${t("kitchen_note.heading")} #12: No salt on 12`,
      `${t("kitchen_note.heading")} #13: No salt on 13`,
    ]);
    expect([...card!.querySelectorAll("[data-print-problem]")].map(flat)).toEqual([
      `${t("station.print_problem")} #12`,
      `${t("station.print_problem")} #13`,
    ]);
    expect([...card!.querySelectorAll("[data-elsewhere] h3")].map(flat)).toEqual([
      `${t("station.elsewhere")} #12`,
      `${t("station.elsewhere")} #13`,
    ]);
    expect([...card!.querySelectorAll("[data-collect]")].map(flat)).toEqual([
      `${t("station.collect")} #12`,
      `${t("station.collect")} #13`,
    ]);
    const reprints = [...card!.querySelectorAll<HTMLElement>("[data-reprint]")];
    expect(reprints.map(flat)).toEqual([
      `${t("station.reprint")} #12`,
      `${t("station.reprint")} #13`,
    ]);
    const reprinted = vi.fn();
    el.addEventListener("reprint-order", (e) => reprinted((e as CustomEvent).detail));
    for (const reprint of reprints) reprint.click();
    expect(reprinted.mock.calls).toEqual([[{ orderId: "wo-1" }], [{ orderId: "wo-2" }]]);
  });

  const starters = { id: "co-start", name: "Starters", displayOrder: 1 };
  const mains = { id: "co-main", name: "Mains", displayOrder: 2 };
  const fired = "2026-08-17T10:00:00.000Z";
  const stateWord = (card: Element, id: string) =>
    card.querySelector(`[data-item="${id}"] .line-state`);

  it("names the group's course in its heading when its dishes share one", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [
        bill("wo-1", 5, [
          dish("steak", fired, { group: sent("g-2", 2), course: mains }),
          dish("fish", fired, { group: sent("g-2", 2), course: mains }),
        ]),
      ],
      stationId: "st-1",
    });
    const [card] = cardsIn(el.shadowRoot!);
    const head = flat(card!.querySelector(".ticket-head")!);
    expect(head).toContain(t("table.group_n").replace("{n}", "2"));
    expect(head).toContain("Mains");
    expect(card!.querySelector(".course-head")).toBeNull();
    expect(dishesOn(card!)).toEqual(["steak", "fish"]);
  });

  it("puts course heads inside a card whose dishes span two courses, null course first", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [
        bill("wo-1", 5, [
          dish("steak", fired, { group: sent("g-1", 1), course: mains }),
          dish("soup", fired, { group: sent("g-1", 1), course: starters }),
          dish("bread", fired, { group: sent("g-1", 1), course: null }),
        ]),
      ],
      stationId: "st-1",
    });
    const [card] = cardsIn(el.shadowRoot!);
    const sections = [...card!.querySelectorAll<HTMLElement>("[data-course]")];
    expect(sections.map((section) => section.dataset.course)).toEqual([
      "none",
      "co-start",
      "co-main",
    ]);
    expect(sections.map((section) => section.querySelector(".course-head")?.textContent)).toEqual([
      undefined,
      "Starters",
      "Mains",
    ]);
    expect(sections.map(dishesOn)).toEqual([["bread"], ["soup"], ["steak"]]);
    const head = flat(card!.querySelector(".ticket-head")!);
    expect(head).not.toContain("Starters");
    expect(head).not.toContain("Mains");
  });

  it("a dish ahead of its card's column says its state; one at the column says none", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [
        bill("wo-1", 5, [
          dish("waiting", fired, { group: sent("g-1", 1) }),
          dish("cooking", fired, { group: sent("g-1", 1), state: "preparing" }),
        ]),
      ],
      stationId: "st-1",
    });
    const [card] = cardsIn(column(el, "queued"));
    expect(flat(stateWord(card!, "cooking")!)).toBe(t("station.state.preparing"));
    expect(stateWord(card!, "waiting")).toBeNull();
  });

  it("a held dish on a fired card says it is held, and is not a button", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [
        bill("wo-1", 5, [
          dish("fired-by-hand", fired, { group: sent("g-1", 1, "held") }),
          dish("kept-back", null, { group: sent("g-1", 1, "held") }),
          dish("all-held", null, { group: sent("g-2", 2, "held") }),
        ]),
      ],
      stationId: "st-1",
    });
    const [mixed, held] = cardsIn(column(el, "queued"));
    expect(mixed!.dataset.cardGroup).toBe("g-1");
    expect(flat(stateWord(mixed!, "kept-back")!)).toBe(t("station.group_held"));
    expect(mixed!.querySelector('button[data-item="kept-back"]')).toBeNull();
    expect(mixed!.querySelector('button[data-item="fired-by-hand"]')).not.toBeNull();
    expect(stateWord(mixed!, "fired-by-hand")).toBeNull();
    // The control: on a card that is itself held, the heading says it and the dish says nothing.
    expect(held!.dataset.cardGroup).toBe("g-2");
    expect(stateWord(held!, "all-held")).toBeNull();
  });

  it("a Ready dish on a Preparing card reads Ready, in English and in Spanish", async () => {
    const mountMixed = async () =>
      (
        await mountWidget<TillStationQueue>("till-station-queue", {
          groups: [
            bill("wo-1", 5, [
              dish("cooking", fired, { group: sent("g-1", 1), state: "preparing" }),
              dish("plated", fired, { group: sent("g-1", 1), state: "ready" }),
            ]),
          ],
          stationId: "st-1",
        })
      ).el;
    const english = cardsIn(column(await mountMixed(), "preparing"))[0]!;
    expect(flat(stateWord(english, "plated")!)).toBe("Ready");
    expect(stateWord(english, "cooking")).toBeNull();
    cleanupWidgets();
    const previous = currentLocale();
    setLocale("es-ES");
    try {
      const spanish = cardsIn(column(await mountMixed(), "preparing"))[0]!;
      const expected = t("station.state.ready");
      expect(expected).not.toBe("Ready");
      expect(flat(stateWord(spanish, "plated")!)).toBe(expected);
    } finally {
      setLocale(previous);
    }
  });

  it("a long dish name at a 1024 px kitchen display: cut beside Overview, whole without it", async () => {
    await pageAt(1024, 844);
    const atDisplay = async (hidden: ColumnKey[]) => {
      const { el, host } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [
          {
            ...groupA,
            orderNumber: 27,
            formerNumbers: [28, 30],
            label: "Table 91",
            items: [{ ...groupA.items[0]!, name: "Grilled octopus with paprika" }],
          },
        ],
        stationId: "st-1",
        columns: { order: [...STATION_COLUMNS.order], hidden, collapsed: [] },
      });
      // The station screen's own padding, inside the page's.
      host.style.paddingInline = "var(--wt-space-4)";
      el.requestUpdate();
      await el.updateComplete;
      expect(el.getBoundingClientRect().width).toBe(944);
      expect(el.shadowRoot!.querySelector(".kanban")).not.toBeNull();
      const name = el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-1"] .line-name')!;
      expect(flat(name)).toBe("2× Grilled octopus with paprika");
      expect(name.clientWidth).toBeGreaterThan(0);
      const box = name.getBoundingClientRect();
      const card = name.closest("[data-card]")!.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(card.left);
      expect(box.right).toBeLessThanOrEqual(card.right);
      return name.scrollWidth > name.clientWidth;
    };
    expect(STATION_COLUMNS.order[0]).toBe("overview");
    expect(await atDisplay([]), "cut beside Overview").toBe(true);
    cleanupWidgets();
    expect(await atDisplay(["overview"]), "cut without Overview").toBe(false);
  });
});

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateReducedMotion: (reduced: boolean) => Promise<void>;
  }
}

const ageAt = (minute: number) => `2026-08-17T10:${String(minute).padStart(2, "0")}:00.000Z`;
const AGE_NOW = Date.parse(ageAt(20));

function ageDish(
  id: string,
  minute: number,
  overrides: Partial<StationQueueItem> = {},
): StationQueueItem {
  return {
    allergy: null,
    id,
    workingOrderLineId: `line-${id}`,
    state: "queued",
    name: "Octopus",
    quantity: "1.000",
    course: null,
    firedAt: ageAt(minute),
    queuedAt: ageAt(minute),
    ...overrides,
  };
}

function ageBill(
  orderNumber: number,
  items: StationQueueItem[],
  overrides: Partial<StationQueueGroup & { stationId: string }> = {},
): StationQueueGroup & { stationId?: string } {
  return {
    kitchenNote: null,
    orderId: `wo-${orderNumber}`,
    orderNumber,
    label: `Table ${orderNumber}`,
    queuedAt: items[0]!.queuedAt,
    status: "placed",
    thresholds: DEFAULT_THRESHOLDS,
    bumpMode: "line",
    items,
    ...overrides,
  };
}

// At 10:20: 2, 7, 12 and 20 minutes old, and one never fired.
const fresh = ageBill(1, [ageDish("fresh", 18)]);
const warm = ageBill(2, [ageDish("warm", 13)]);
const overdue = ageBill(3, [ageDish("overdue", 8)]);
const forgotten = ageBill(4, [ageDish("forgotten", 0)]);
const heldBill = ageBill(5, [ageDish("held", 0, { firedAt: null })]);

const cardOf = (el: TillStationQueue, orderNumber: number) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-card][data-order="${orderNumber}"]`)!;

const paint = (el: TillStationQueue) => {
  el.style.setProperty("--wt-color-success", "rgb(1, 2, 3)");
  el.style.setProperty("--wt-color-warning", "rgb(4, 5, 6)");
  el.style.setProperty("--wt-color-danger", "rgb(7, 8, 9)");
  el.style.setProperty("--wt-color-danger-pulse-dim", "rgb(10, 11, 12)");
  el.style.setProperty("--wt-color-border", "rgb(13, 14, 15)");
};

describe("till-station-queue: a card's age band", () => {
  afterEach(() => commands.emulateReducedMotion(false));

  it("a card's band is green, then amber, then red as it ages", async () => {
    await commands.emulateReducedMotion(false);
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [fresh, warm, overdue, heldBill],
      stationId: "st-1",
      now: AGE_NOW,
      reducedMotion: false,
    });
    paint(el);
    expect(getComputedStyle(cardOf(el, 1)).borderTopColor).toBe("rgb(1, 2, 3)");
    expect(getComputedStyle(cardOf(el, 1)).borderLeftColor).toBe("rgb(13, 14, 15)");
    expect(getComputedStyle(cardOf(el, 2)).borderTopColor).toBe("rgb(4, 5, 6)");
    expect(getComputedStyle(cardOf(el, 2)).borderLeftColor).toBe("rgb(13, 14, 15)");
    expect(getComputedStyle(cardOf(el, 3)).borderTopColor).toBe("rgb(7, 8, 9)");
    expect(getComputedStyle(cardOf(el, 3)).borderLeftColor).toBe("rgb(7, 8, 9)");
    expect(getComputedStyle(cardOf(el, 5)).borderTopColor).toBe("rgb(13, 14, 15)");
  });

  it("a forgotten card's band pulses to the dim red at the fast pulse token", async () => {
    await commands.emulateReducedMotion(false);
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [forgotten],
      stationId: "st-1",
      now: AGE_NOW,
      reducedMotion: false,
    });
    paint(el);
    const card = cardOf(el, 4);
    expect(getComputedStyle(card).animationName).toBe("age-forgotten-flash");
    expect(getComputedStyle(card).animationDuration).toBe("1s");
    const [animation] = card.getAnimations();
    animation!.pause();
    animation!.currentTime = 500;
    expect(getComputedStyle(card).borderTopColor).toBe("rgb(10, 11, 12)");
    expect(getComputedStyle(card).borderLeftColor).toBe("rgb(10, 11, 12)");
    animation!.currentTime = 0;
    expect(getComputedStyle(card).borderTopColor).toBe("rgb(7, 8, 9)");
    el.style.setProperty("--wt-duration-pulse-fast", "3000ms");
    expect(getComputedStyle(card).animationDuration).toBe("3s");
  });

  it("under reduced motion a forgotten card holds still and stays red", async () => {
    const still = (el: TillStationQueue) => {
      paint(el);
      const card = cardOf(el, 4);
      expect(getComputedStyle(card).animationName).toBe("none");
      expect(getComputedStyle(card).borderTopColor).toBe("rgb(7, 8, 9)");
    };
    const mount = async (reducedMotion: boolean | undefined) =>
      (
        await mountWidget<TillStationQueue>("till-station-queue", {
          groups: [forgotten],
          stationId: "st-1",
          now: AGE_NOW,
          reducedMotion,
        })
      ).el;
    await commands.emulateReducedMotion(false);
    still(await mount(true));
    cleanupWidgets();
    await commands.emulateReducedMotion(true);
    still(await mount(undefined));
    cleanupWidgets();
    // Turned on after the card was drawn, with no redraw: the stylesheet's own gate stops it.
    await commands.emulateReducedMotion(false);
    const drawn = await mount(undefined);
    expect(getComputedStyle(cardOf(drawn, 4)).animationName).toBe("age-forgotten-flash");
    await commands.emulateReducedMotion(true);
    still(drawn);
  });
});

describe("till-station-queue: the dishes-to-make line", () => {
  const counts = (el: TillStationQueue) =>
    el.shadowRoot!.querySelectorAll<HTMLElement>("[data-kitchen-counts]");
  const line = (el: TillStationQueue) => {
    const [only, ...rest] = counts(el);
    expect(rest).toHaveLength(0);
    return only?.textContent!.replace(/\s+/g, " ").trim();
  };

  // 2 + 1.5 (counted in Each) + 1 (a weighed dish) on a fresh card; nothing held or Ready counts.
  const mixed = ageBill(6, [
    ageDish("plain", 18, { quantity: "2.000" }),
    ageDish("each", 18, {
      quantity: "1.500",
      unitName: { "en-GB": "each" },
      soldInEach: true,
      state: "preparing",
    }),
    ageDish("weighed", 18, { quantity: "0.350", unitName: { "en-GB": "kg" } }),
    ageDish("held-dish", 18, { quantity: "3.000", firedAt: null }),
    ageDish("ready", 18, { state: "ready" }),
  ]);

  it("the header says how many dishes are to make and how many cards are late", async () => {
    const board = { groups: [mixed, overdue], stationId: "st-1", now: AGE_NOW };
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", board);
    expect(counts(el)[0]!.classList.contains("kitchen-counts")).toBe(true);
    expect(line(el)).toBe("5.5 dishes to make · 1 late");
    cleanupWidgets();
    const before = currentLocale();
    setLocale("es-ES");
    try {
      const spanishBoard = await mountWidget<TillStationQueue>("till-station-queue", board);
      const spanish = `${t("station.to_make").replace("{n}", "5.5")} · ${t("station.late").replace("{n}", "1")}`;
      expect(spanish).not.toBe("5.5 dishes to make · 1 late");
      expect(line(spanishBoard.el)).toBe(spanish);
    } finally {
      setLocale(before);
    }
    cleanupWidgets();

    const one = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [fresh],
      stationId: "st-1",
      now: AGE_NOW,
    });
    expect(line(one.el)).toBe("1 dish to make");
    cleanupWidgets();

    // Late only counts a card with something to make: an old card all Ready is not late.
    const nothing = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [ageBill(7, [ageDish("done", 0, { state: "ready" })]), heldBill],
      stationId: "st-1",
      now: AGE_NOW,
    });
    expect(counts(nothing.el)).toHaveLength(0);
  });

  it("a merged queue has one header line for every station", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [
        ageBill(8, [ageDish("grill", 18, { quantity: "2.000" })], { stationId: "st-grill" }),
        ageBill(8, [ageDish("fryer", 8)], { stationId: "st-fryer" }),
      ],
      now: AGE_NOW,
    });
    expect(line(el)).toBe("3 dishes to make · 1 late");
  });
});

describe("till-station-queue: a card's heading and whole-ticket taps", () => {
  const head = (el: TillStationQueue, orderNumber: number) =>
    cardOf(el, orderNumber).querySelector<HTMLButtonElement>("button[data-card-head]");
  const listen = (el: TillStationQueue) => {
    const dishes: CustomEvent[] = [];
    const item = vi.fn();
    el.addEventListener("advance-dishes", (e) => dishes.push(e as CustomEvent));
    el.addEventListener("advance-ticket-item", item);
    return { dishes, details: () => dishes.map((e) => e.detail as unknown), item };
  };
  const sentIn = (id: string, position: number) => ({
    id,
    position,
    displayNumber: position,
    numberPartyId: "pa-1",
    state: "fired" as const,
  });

  it("a heading tap sends the card's least advanced dishes on, never one further on", async () => {
    const bill = ageBill(7, [
      ageDish("ti-waiting", 15),
      ageDish("ti-preparing", 15, { state: "preparing" }),
      ageDish("ti-ready", 15, { state: "ready" }),
      ageDish("ti-held", 15, { firedAt: null }),
    ]);
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [bill],
      stationId: "st-1",
      now: AGE_NOW,
    });
    const taps = listen(el);
    head(el, 7)!.click();
    expect(taps.details()).toEqual([
      { itemIds: ["ti-waiting"], stationId: "st-1", to: "preparing" },
    ]);
    expect(taps.dishes.every((e) => e.bubbles && e.composed)).toBe(true);
    expect(taps.item).not.toHaveBeenCalled();
  });

  it("a whole-ticket dish tap sends that card's dishes at the tapped dish's stage", async () => {
    const bill = ageBill(
      7,
      [
        ageDish("ti-waiting", 15),
        ageDish("ti-preparing-1", 15, { state: "preparing" }),
        ageDish("ti-preparing-2", 15, { state: "preparing" }),
      ],
      { bumpMode: "ticket" },
    );
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [bill],
      stationId: "st-1",
      now: AGE_NOW,
    });
    const taps = listen(el);
    el.shadowRoot!.querySelector<HTMLElement>('button[data-item="ti-preparing-1"]')!.click();
    expect(taps.details()).toEqual([
      { itemIds: ["ti-preparing-1", "ti-preparing-2"], stationId: "st-1", to: "ready" },
    ]);
    expect(taps.item).not.toHaveBeenCalled();
  });

  it("a whole-ticket tap on a party's card leaves its other group's card alone", async () => {
    const bill = ageBill(
      7,
      [
        ageDish("ti-first-a", 5, { group: sentIn("gr-1", 1) }),
        ageDish("ti-first-b", 5, { group: sentIn("gr-1", 1) }),
        ageDish("ti-second", 15, { group: sentIn("gr-2", 2) }),
      ],
      { bumpMode: "ticket", party: { id: "pa-1", revision: 1 } },
    );
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [bill],
      stationId: "st-1",
      now: AGE_NOW,
    });
    expect(el.shadowRoot!.querySelectorAll("[data-card]")).toHaveLength(2);
    const taps = listen(el);
    el.shadowRoot!.querySelector<HTMLElement>('button[data-item="ti-first-a"]')!.click();
    expect(taps.details()).toEqual([
      { itemIds: ["ti-first-a", "ti-first-b"], stationId: "st-1", to: "preparing" },
    ]);
  });

  it("a heading is a button only while a tap can move something", async () => {
    const allReady = ageBill(7, [ageDish("ti-ready", 15, { state: "ready" })]);
    const allHeld = ageBill(8, [ageDish("ti-held", 15, { firedAt: null })]);
    const moving = ageBill(9, [ageDish("ti-moving", 15)]);
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [allReady, allHeld, moving],
      stationId: "st-1",
      now: AGE_NOW,
    });
    expect(head(el, 7)).toBeNull();
    expect(head(el, 8)).toBeNull();
    expect(cardOf(el, 7).querySelector(".ticket-head")).not.toBeNull();
    expect(cardOf(el, 8).querySelector(".ticket-head")).not.toBeNull();
    expect(head(el, 9)).not.toBeNull();
  });

  it("a heading's name starts with its words and ends with Advance ticket", async () => {
    const bill = ageBill(7, [ageDish("ti-waiting", 15)]);
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [bill],
      stationId: "st-1",
      now: AGE_NOW,
    });
    const button = head(el, 7)!;
    const advance = `${t("station.bump_ticket")} #7`;
    await expect
      .element(page.elementLocator(button))
      .toHaveAccessibleName(new RegExp(`^Counter #7 Table 7 .*${advance.replace("#", "\\#")}$`));
    const hidden = button.querySelector(".visually-hidden")!;
    expect(hidden.textContent).toBe(advance);
    expect(hidden.getBoundingClientRect().width).toBeLessThanOrEqual(1);
  });

  it("a heading tap with no station sends nothing", async () => {
    const bill = ageBill(7, [ageDish("ti-waiting", 15)]);
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [bill],
      now: AGE_NOW,
    });
    const taps = listen(el);
    head(el, 7)!.click();
    expect(taps.details()).toEqual([]);
  });

  it("a merged heading tap names its own station", async () => {
    const bill = ageBill(7, [ageDish("ti-waiting", 15)], { stationId: "st-2" });
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [bill],
      stationId: "st-9",
      stationNames: new Map([["st-2", "Bar"]]),
      now: AGE_NOW,
    });
    const taps = listen(el);
    head(el, 7)!.click();
    expect(taps.details()).toEqual([
      { itemIds: ["ti-waiting"], stationId: "st-2", to: "preparing" },
    ]);
  });

  describe("a tap sends its dishes in the order the card draws them", () => {
    const starters = { id: "co-start", name: "Starters", displayOrder: 1 };
    const mains = { id: "co-main", name: "Mains", displayOrder: 2 };
    // Read mains first, so the read's order and the card's differ.
    const coursed = (bumpMode: StationQueueGroup["bumpMode"]) =>
      ageBill(
        7,
        [
          ageDish("ti-steak", 15, { course: mains }),
          ageDish("ti-soup", 15, { course: starters }),
          ageDish("ti-bread", 15, { course: null }),
          ageDish("ti-salad", 15, { course: starters }),
        ],
        { bumpMode },
      );
    const drawn = (el: TillStationQueue) =>
      [...cardOf(el, 7).querySelectorAll<HTMLElement>("[data-item]")].map(
        (node) => node.dataset.item,
      );
    const inCardOrder = ["ti-bread", "ti-soup", "ti-salad", "ti-steak"];

    it("a heading tap", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [coursed("line")],
        stationId: "st-1",
        now: AGE_NOW,
      });
      expect(drawn(el)).toEqual(inCardOrder);
      const taps = listen(el);
      head(el, 7)!.click();
      expect(taps.details()).toEqual([
        { itemIds: inCardOrder, stationId: "st-1", to: "preparing" },
      ]);
    });

    it("a whole-ticket dish tap", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [coursed("ticket")],
        stationId: "st-1",
        now: AGE_NOW,
      });
      expect(drawn(el)).toEqual(inCardOrder);
      const taps = listen(el);
      el.shadowRoot!.querySelector<HTMLElement>('button[data-item="ti-steak"]')!.click();
      expect(taps.details()).toEqual([
        { itemIds: inCardOrder, stationId: "st-1", to: "preparing" },
      ]);
    });
  });
});

describe("till-station-queue: a card's layout", () => {
  afterEach(resetPage);

  const fired = {
    id: "g-2",
    position: 2,
    displayNumber: 2,
    numberPartyId: "pa-1",
    state: "fired" as const,
  };
  const token = (el: Element, name: string) =>
    parseFloat(getComputedStyle(el).getPropertyValue(name));
  const rect = (node: Element) => node.getBoundingClientRect();
  /** The width a child that spans the box's content gets: inside its border and padding. */
  const contentWidth = (box: HTMLElement) => {
    const style = getComputedStyle(box);
    return box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  };

  it("a heading's words run from its leading edge, and only its minutes sit at the trailing edge", async () => {
    await pageAt(1280, 800);
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [ageBill(7, [ageDish("waiting", 15, { group: fired })], { label: null })],
      stationId: "st-1",
      now: AGE_NOW,
    });
    const head = cardOf(el, 7).querySelector<HTMLElement>(".ticket-head")!;
    const number = head.querySelector(".number")!;
    const group = head.querySelector(".group-name")!;
    const age = head.querySelector(".age")!;
    expect(head.matches("button")).toBe(true);
    const space3 = token(head, "--wt-space-3");
    expect(space3).toBeGreaterThan(0);
    expect(rect(group).left - rect(number).right).toBeGreaterThanOrEqual(0);
    expect(rect(group).left - rect(number).right).toBeLessThanOrEqual(space3);
    const style = getComputedStyle(head);
    const contentRight =
      rect(head).right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
    expect(Math.abs(rect(age).right - contentRight)).toBeLessThanOrEqual(1);
    expect(rect(age).left - rect(group).right).toBeGreaterThan(space3);
  });

  it.each(["en-GB", "es"])(
    "a long heading wraps inside its card at 390 px, its minutes on one line (%s)",
    async (locale) => {
      const previousLocale = currentLocale();
      setLocale(locale);
      try {
        await pageAt(390, 844);
        const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
          groups: [
            ageBill(9, [ageDish("first-bill", 0, { group: fired })], { label: "T1" }),
            ageBill(11, [ageDish("second-bill", 0, { group: fired })], {
              label: null,
              formerNumbers: [9],
            }),
          ],
          stationId: "st-1",
          now: AGE_NOW,
        });
        el.shadowRoot!.querySelector<HTMLButtonElement>('[data-column-tab="waiting"]')!.click();
        await el.updateComplete;
        const card = cardOf(el, 9);
        const head = card.querySelector<HTMLElement>(".ticket-head")!;
        expect(head.querySelectorAll(".number")).toHaveLength(2);
        expect(head.querySelector(".label")).not.toBeNull();
        expect(head.querySelector(".group-name")).not.toBeNull();
        const age = head.querySelector<HTMLElement>(".age")!;
        expect(age.textContent!.replace(/\s+/g, " ").trim()).toBe(`20 ${t("station.min")}`);
        const style = getComputedStyle(head);
        const contentRight =
          rect(head).right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
        const cardStyle = getComputedStyle(card);
        const cardContentRight =
          rect(card).right -
          parseFloat(cardStyle.borderRightWidth) -
          parseFloat(cardStyle.paddingRight);
        expect(rect(age).right).toBeLessThanOrEqual(contentRight + 0.5);
        expect(rect(age).right).toBeLessThanOrEqual(cardContentRight + 0.5);
        // Its line-height computes to "normal", so count the lines its words are drawn on.
        const words = document.createRange();
        words.selectNodeContents(age);
        const lineTops = new Set([...words.getClientRects()].map((line) => Math.round(line.top)));
        expect(lineTops.size).toBe(1);
      } finally {
        setLocale(previousLocale);
      }
    },
  );

  it.each([
    [1280, 800],
    [390, 844],
  ])(
    "a dish row spans its card's content in Waiting and Preparing at %i px",
    async (width, height) => {
      await pageAt(width, height);
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [
          ageBill(7, [ageDish("waiting", 15)]),
          ageBill(8, [ageDish("preparing", 15, { state: "preparing" })]),
        ],
        stationId: "st-1",
        canMove: true,
        now: AGE_NOW,
      });
      // At 390 px the board draws tabs, so each card is checked under its own tab.
      el.shadowRoot!.querySelector<HTMLButtonElement>('[data-column-tab="waiting"]')?.click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('[data-move-station="waiting"]')).not.toBeNull();
      const spans = async (order: number, item: string, tab: ColumnKey) => {
        el.shadowRoot!.querySelector<HTMLButtonElement>(`[data-column-tab="${tab}"]`)?.click();
        await el.updateComplete;
        const card = cardOf(el, order);
        const row = card.querySelector<HTMLElement>(`[data-item="${item}"]`)!;
        return Math.abs(rect(row).width - contentWidth(card)) <= 1;
      };
      const waiting = await spans(7, "waiting", "waiting");
      const preparing = await spans(8, "preparing", "preparing");
      expect({ waiting, preparing }).toEqual({
        waiting: true,
        preparing: true,
      });
    },
  );
  const twoCards = async () => {
    await pageAt(1280, 800);
    const mounted = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [
        ageBill(7, [ageDish("waiting", 15)]),
        ageBill(8, [ageDish("ready", 15, { state: "ready" })]),
      ],
      stationId: "st-1",
      now: AGE_NOW,
    });
    const head = (order: number) =>
      cardOf(mounted.el, order).querySelector<HTMLElement>(".ticket-head")!;
    expect(head(7).matches("button")).toBe(true);
    expect(head(8).matches("button")).toBe(false);
    return { el: mounted.el, head };
  };

  it("a heading button's words sit at its vertical centre", async () => {
    const { head } = await twoCards();
    const words = [...head(7).querySelectorAll(":scope > :not(.visually-hidden)")].map(rect);
    const middle =
      (Math.min(...words.map((w) => w.top)) + Math.max(...words.map((w) => w.bottom))) / 2;
    const box = rect(head(7));
    expect(box.height).toBeGreaterThan(Math.max(...words.map((w) => w.height)) + 2);
    expect(Math.abs(middle - (box.top + box.bottom) / 2)).toBeLessThanOrEqual(1);
  });

  it("a Ready card's heading is as tall as a Waiting card's", async () => {
    const { head } = await twoCards();
    expect(Math.abs(rect(head(8)).height - rect(head(7)).height)).toBeLessThanOrEqual(1);
  });

  it("a heading is ruled off from its dishes in the card's border colour and width", async () => {
    const { el, head } = await twoCards();
    el.style.setProperty("--wt-color-border", "rgb(13, 14, 15)");
    for (const order of [7, 8]) {
      const style = getComputedStyle(head(order));
      const card = getComputedStyle(cardOf(el, order));
      expect(style.borderBottomStyle).toBe("solid");
      expect(style.borderBottomColor).toBe("rgb(13, 14, 15)");
      expect(style.borderBottomWidth).toBe(card.borderLeftWidth);
    }
  });
});

describe("till-station-queue: a card's place", () => {
  afterEach(cleanupWidgets);

  const party = { id: "party-1", revision: 0 };
  const flat = (el: Element) => el.textContent!.replace(/\s+/g, " ").trim();
  const mount = async (groups: StationQueueGroup[]) =>
    (await mountWidget<TillStationQueue>("till-station-queue", { groups, stationId: "st-1" })).el;
  const headOf = (el: TillStationQueue) =>
    el.shadowRoot!.querySelector("[data-card] .ticket-head")!;
  const placesOf = (el: TillStationQueue) => [...headOf(el).querySelectorAll(".label")].map(flat);

  it("names a table's bill by the table's short name, not its label", async () => {
    const el = await mount([{ ...groupA, party, label: "Terrace 1", tableShortNames: ["T1"] }]);
    expect(placesOf(el)).toEqual(["T1"]);
    expect(flat(headOf(el))).not.toContain("Terrace 1");
    expect(headOf(el).querySelector(".counter")).toBeNull();
  });

  it("names a bill at joined tables by their short names in number order", async () => {
    const el = await mount([{ ...groupA, party, label: null, tableShortNames: ["T5", "T4"] }]);
    expect(placesOf(el)).toEqual(["T4+T5"]);
  });

  it("reads Counter before a counter order's number, in each language", async () => {
    const counter = { ...groupA, label: null };
    const el = await mount([counter]);
    expect(flat(headOf(el)).startsWith("Counter #5")).toBe(true);
    expect(flat(headOf(el).querySelector(".number")!)).toBe("#5");
    cleanupWidgets();
    const previousLocale = currentLocale();
    setLocale("es-ES");
    try {
      const spanish = await mount([counter]);
      const word = flat(headOf(spanish).querySelector(".counter")!);
      expect(word).toBe(t("station.counter"));
      expect(word).not.toBe("Counter");
      expect(flat(headOf(spanish)).startsWith(`${word} #5`)).toBe(true);
    } finally {
      setLocale(previousLocale);
    }
  });

  it("keeps a counter order's label after its number", async () => {
    const el = await mount([{ ...groupA, label: "Ana" }]);
    expect(flat(headOf(el)).startsWith("Counter #5 Ana")).toBe(true);
  });

  it("names a counter order delivered to a table by the table, without Counter", async () => {
    const el = await mount([{ ...groupA, label: "Garden 4", tableShortNames: ["G4"] }]);
    expect(headOf(el).querySelector(".counter")).toBeNull();
    expect(flat(headOf(el)).startsWith("#5 G4")).toBe(true);
    expect(placesOf(el)).toEqual(["G4"]);
  });

  it("names a place two bills of one group share once", async () => {
    const group = {
      id: "g-1",
      position: 1,
      displayNumber: 1,
      numberPartyId: "party-1",
      state: "fired" as const,
    };
    const items = (prefix: string) =>
      groupA.items.map((item) => ({ ...item, id: `${prefix}-${item.id}`, group }));
    const el = await mount([
      { ...groupA, party, label: null, tableShortNames: ["T4"], items: items("a") },
      {
        ...groupA,
        orderId: "wo-9",
        orderNumber: 9,
        party,
        label: null,
        tableShortNames: ["T4"],
        items: items("b"),
      },
    ]);
    expect(el.shadowRoot!.querySelectorAll("[data-card]")).toHaveLength(1);
    expect(placesOf(el)).toEqual(["T4"]);
  });
});

describe("the board's columns", () => {
  const fired = "2026-08-17T10:00:00.000Z";
  const sent = (id: string, position: number, state: "held" | "fired" = "fired") => ({
    id,
    position,
    displayNumber: position,
    numberPartyId: "pa-1",
    state,
  });
  const dish = (
    id: string,
    firedAt: string | null,
    extra: Partial<StationQueueItem> = {},
  ): StationQueueItem => ({
    ...groupA.items[0]!,
    id,
    workingOrderLineId: `wol-${id}`,
    name: `Dish ${id}`,
    firedAt,
    queuedAt: firedAt ?? "2026-08-17T10:00:00.000Z",
    ...extra,
  });
  const bill = (
    orderId: string,
    orderNumber: number,
    items: StationQueueItem[],
  ): StationQueueGroup => ({
    ...groupA,
    orderId,
    orderNumber,
    label: "Table 7",
    party: { id: "pa-1", revision: 1 },
    items,
  });
  const cardsIn = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>("[data-card]")];
  const flat = (node: Element) => node.textContent!.replace(/\s+/g, " ").trim();
  const column = (el: TillStationQueue, state: string) =>
    el.shadowRoot!.querySelector<HTMLElement>(`[data-column="${state}"]`)!;
  const drawn = (el: TillStationQueue) =>
    [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-column]")].map(
      (section) => section.dataset.column,
    );
  const toggle = (el: TillStationQueue, key: string) =>
    el.shadowRoot!.querySelector<HTMLButtonElement>(`[data-column-toggle="${key}"]`)!;
  const asked = (el: TillStationQueue) => {
    const keys: unknown[] = [];
    el.addEventListener("toggle-column", (event) => {
      keys.push((event as CustomEvent<{ key: string }>).detail);
    });
    return keys;
  };
  const open = { order: ["waiting", "preparing", "ready"], hidden: [], collapsed: [] } as const;
  const readyCollapsed = { ...open, collapsed: ["ready"] } as const;
  const state = (value: typeof open | typeof readyCollapsed) => ({
    order: [...value.order],
    hidden: [...value.hidden],
    collapsed: [...value.collapsed],
  });

  it("draws the columns in the order it is given", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      columns: { order: ["ready", "waiting", "preparing"], hidden: [], collapsed: [] },
    });
    expect(drawn(el)).toEqual(["ready", "queued", "preparing"]);
  });

  it("leaves out the columns it cannot draw yet", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      columns: {
        order: ["overview", "held", "waiting", "preparing", "ready"],
        hidden: [],
        collapsed: [],
      },
    });
    expect(drawn(el)).toEqual(["overview", "queued", "preparing", "ready"]);
  });

  it("each heading names its column and counts its cards", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [
        bill("wo-1", 5, [
          dish("cooking", fired, { group: sent("g-1", 1) }),
          dish("kept", null, { group: sent("g-2", 2, "held") }),
        ]),
      ],
      stationId: "st-1",
    });
    expect(cardsIn(column(el, "queued"))).toHaveLength(2);
    expect(flat(column(el, "queued").querySelector("[data-column-count]")!)).toBe("2");
    expect(flat(column(el, "preparing").querySelector("[data-column-count]")!)).toBe("0");
    expect(column(el, "queued").querySelector(".column-title")!.textContent).toBe(
      t("station.state.queued"),
    );
  });

  it("a collapsed column keeps its heading and count and draws no cards", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    await expect.element(page.getByRole("button", { name: "Ready 1" })).toBeInTheDocument();
    expect(toggle(el, "ready").getAttribute("aria-expanded")).toBe("true");
    el.columns = state(readyCollapsed);
    await el.updateComplete;
    const ready = column(el, "ready");
    expect(cardsIn(ready)).toHaveLength(0);
    expect(flat(ready.querySelector(".column-heading")!)).toBe(`${t("station.state.ready")} · 1`);
    expect(toggle(el, "ready").getAttribute("aria-expanded")).toBe("false");
    expect(toggle(el, "waiting").getAttribute("aria-expanded")).toBe("true");
    expect(toggle(el, "preparing").getAttribute("aria-expanded")).toBe("true");
    await expect.element(page.getByRole("button", { name: "Ready 1" })).toBeInTheDocument();
  });

  it("tapping a heading asks for its column to collapse or open, and changes nothing itself", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    const keys = asked(el);
    await userEvent.click(toggle(el, "ready"));
    expect(keys).toEqual([{ key: "ready" }]);
    await el.updateComplete;
    expect(cardsIn(column(el, "ready"))).toHaveLength(1);
    el.columns = state(readyCollapsed);
    await el.updateComplete;
    await userEvent.click(toggle(el, "ready"));
    expect(keys).toEqual([{ key: "ready" }, { key: "ready" }]);
    await el.updateComplete;
    expect(cardsIn(column(el, "ready"))).toHaveLength(0);
    expect(toggle(el, "ready").getAttribute("aria-expanded")).toBe("false");
  });

  it("Enter and Space on a focused heading ask the same, and the focus stays on it", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      columns: state(open),
    });
    const keys = asked(el);
    const button = toggle(el, "ready");
    button.focus();
    await userEvent.keyboard("{Enter}");
    expect(keys).toEqual([{ key: "ready" }]);
    el.columns = state(readyCollapsed);
    await el.updateComplete;
    expect(el.shadowRoot!.activeElement).toBe(toggle(el, "ready"));
    expect(toggle(el, "ready")).toBe(button);
    await userEvent.keyboard(" ");
    expect(keys).toEqual([{ key: "ready" }, { key: "ready" }]);
  });

  it("a collapsed column is a narrow strip with its heading top to bottom", async () => {
    const previous = { width: innerWidth, height: innerHeight };
    await page.viewport(1280, 800);
    try {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups,
        stationId: "st-1",
        columns: state(readyCollapsed),
      });
      el.style.setProperty("--wt-tap-min", "44px");
      await el.updateComplete;
      const ready = column(el, "ready").getBoundingClientRect();
      expect(ready.width).toBe(44);
      expect(getComputedStyle(toggle(el, "ready")).writingMode).toBe("vertical-rl");
      expect(column(el, "queued").getBoundingClientRect().width).toBeGreaterThan(ready.width);
    } finally {
      await page.viewport(previous.width, previous.height);
    }
  });

  it("a dish ahead of its card still says its state when Ready is drawn first", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [
        bill("wo-1", 5, [
          dish("waiting", fired, { group: sent("g-1", 1) }),
          dish("cooking", fired, { group: sent("g-1", 1), state: "preparing" }),
        ]),
      ],
      stationId: "st-1",
      columns: { order: ["ready", "waiting", "preparing"], hidden: [], collapsed: [] },
    });
    expect(drawn(el)[0]).toBe("ready");
    const [card] = cardsIn(column(el, "queued"));
    const word = card!.querySelector('[data-item="cooking"] .line-state');
    expect(flat(word!)).toBe(t("station.state.preparing"));
  });
});

describe("the Overview column", () => {
  const withOverview = {
    order: ["overview", "waiting", "preparing", "ready"],
    hidden: [],
    collapsed: [],
  } as const;
  const layout = (extra: { hidden?: ColumnKey[]; collapsed?: ColumnKey[] } = {}) => ({
    order: [...withOverview.order],
    hidden: extra.hidden ?? [],
    collapsed: extra.collapsed ?? [],
  });
  const named = (name: string, minute: number, extra: Partial<StationQueueItem> = {}) =>
    ageDish(`${name}-${minute}-${extra.quantity ?? "1"}`, minute, { name, ...extra });
  const held = (name: string, extra: Partial<StationQueueItem> = {}) =>
    named(name, 0, { firedAt: null, ...extra });
  // Picture 03's scene (plan slice 9c): T2 the oldest, a Ready card, T5, T9, then T4 and T7 held.
  const scene = () => [
    ageBill(2, [
      named("Sirloin", 0, { state: "preparing" }),
      named("Burger", 0, { state: "preparing" }),
    ]),
    ageBill(11, [named("Croquettes", 8, { quantity: "2.000", state: "ready" })]),
    ageBill(5, [named("Spicy potatoes", 12, { quantity: "2.000" })]),
    ageBill(9, [named("Pork shoulder", 17), named("Spicy potatoes", 17)]),
    ageBill(4, [held("Pork shoulder", { quantity: "2.000" }), held("Spicy potatoes")]),
    ageBill(7, [held("Rib steak")]),
  ];
  const sceneRows = [
    "Sirloin 1",
    "Burger 1",
    "Spicy potatoes 3 +1",
    "Pork shoulder 1 +2",
    "Rib steak 0 +1",
  ];

  const overview = (el: TillStationQueue) =>
    el.shadowRoot!.querySelector<HTMLElement>('[data-column="overview"]')!;
  const overviewRows = (el: TillStationQueue) => [
    ...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-overview-row]"),
  ];
  // What is drawn, leaving out the words only assistive technology hears.
  const drawnText = (row: HTMLElement) =>
    [
      ...row.querySelectorAll<HTMLElement>(
        ".overview-name, [data-overview-making], [data-overview-held]",
      ),
    ]
      .map((part) => part.textContent!.trim())
      .join(" ");
  const mountBoard = (groups: StationQueueGroup[], columns = layout(), extra = {}) =>
    mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      now: AGE_NOW,
      columns,
      ...extra,
    });

  it("Overview lists each dish to make with how many, and the held after a +", async () => {
    const { el } = await mountBoard(scene());
    expect(overviewRows(el).map(drawnText)).toEqual(sceneRows);
  });

  it("Overview's heading counts the dishes with something to make", async () => {
    const { el } = await mountBoard(scene());
    expect(overview(el).querySelector("[data-column-count]")!.textContent!.trim()).toBe("4");
    expect(overview(el).querySelector(".column-title")!.textContent!.trim()).toBe(
      t("station.overview"),
    );
  });

  it("a row tells assistive technology how many are held", async () => {
    const { el } = await mountBoard(scene());
    const pork = overviewRows(el)[3]!;
    expect(pork.querySelector("[data-overview-held]")!.getAttribute("aria-hidden")).toBe("true");
    expect(pork.querySelector(".visually-hidden")!.textContent).toBe(", 2 held");
    expect(pork.textContent!.replace(/\s+/g, " ")).toContain(", 2 held");
  });

  it("Overview collapses by its heading like any column", async () => {
    const { el } = await mountBoard(scene());
    const keys: unknown[] = [];
    el.addEventListener("toggle-column", (event) => keys.push((event as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLButtonElement>('[data-column-toggle="overview"]')!.click();
    expect(keys).toEqual([{ key: "overview" }]);
    cleanupWidgets();
    const { el: folded } = await mountBoard(scene(), layout({ collapsed: ["overview"] }));
    expect(overviewRows(folded)).toHaveLength(0);
    await expect
      .element(
        page.elementLocator(
          folded.shadowRoot!.querySelector<HTMLElement>('[data-column-toggle="overview"]')!,
        ),
      )
      .toHaveAccessibleName(`${t("station.overview")} 4`);
  });

  it("Overview keeps its basis and does not grow, and a long name wraps inside it", async () => {
    const { el } = await mountBoard([
      ...scene(),
      ageBill(12, [named("Grilled octopus with paprika and potatoes", 15)]),
    ]);
    const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const width = overview(el).getBoundingClientRect().width;
    expect(width).toBe(OVERVIEW_COLUMN_REMS * remPx);
    expect(width).toBeLessThan(
      el.shadowRoot!.querySelector('[data-column="queued"]')!.getBoundingClientRect().width,
    );
    const row = overviewRows(el).find((each) =>
      each.textContent!.includes("Grilled octopus with paprika and potatoes"),
    )!;
    const box = el.shadowRoot!.querySelector("[data-overview]")!.getBoundingClientRect();
    const rects = textRects(row.querySelector(".overview-name")!);
    expect(rects.length).toBeGreaterThan(1);
    for (const rect of rects) {
      expect(rect.left).toBeGreaterThanOrEqual(box.left);
      expect(rect.right).toBeLessThanOrEqual(box.right);
    }
  });

  it("with nothing to make or held, Overview shows 0 and no rows", async () => {
    const { el } = await mountBoard([ageBill(11, [named("Croquettes", 8, { state: "ready" })])]);
    expect(overview(el).querySelector("[data-column-count]")!.textContent!.trim()).toBe("0");
    expect(overviewRows(el)).toHaveLength(0);
  });

  it("a hidden column's dishes still count in Overview", async () => {
    const { el } = await mountBoard(scene(), layout({ hidden: ["waiting"] }));
    expect(el.shadowRoot!.querySelector('[data-column="queued"]')).toBeNull();
    expect(overviewRows(el).map(drawnText)).toEqual(sceneRows);
  });

  it("a merged board counts one dish at two stations in one row", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [
        ageBill(1, [named("Sirloin", 10)], { stationId: "st-1" }),
        ageBill(2, [named("Sirloin", 12)], { stationId: "st-2" }),
      ],
      stationNames: new Map([
        ["st-1", "Grill"],
        ["st-2", "Plancha"],
      ]),
      now: AGE_NOW,
      columns: layout(),
    });
    expect(overviewRows(el).map(drawnText)).toEqual(["Sirloin 2"]);
  });

  it("quantities: 1.5 stays exact, and a dish whose unit shows counts one", async () => {
    const { el } = await mountBoard([
      ageBill(1, [
        named("Spicy potatoes", 10, { quantity: "1.500" }),
        named("Octopus", 10, { quantity: "0.350", unitName: { "en-GB": "kg" } }),
      ]),
    ]);
    expect(overviewRows(el).map(drawnText)).toEqual(["Spicy potatoes 1.5", "Octopus 1"]);
  });

  it("Overview reads in Spanish", async () => {
    const before = currentLocale();
    setLocale("es-ES");
    try {
      const { el } = await mountBoard(scene());
      expect(t("station.overview")).not.toBe("Overview");
      expect(overview(el).querySelector(".column-title")!.textContent!.trim()).toBe(
        t("station.overview"),
      );
      expect(overviewRows(el)[3]!.querySelector(".visually-hidden")!.textContent).toBe(
        `, ${t("station.overview_held").replace("{n}", "2")}`,
      );
    } finally {
      setLocale(before);
    }
  });
});

describe("the board's narrow tabs", () => {
  const layout = (collapsed: ColumnKey[] = []) => ({
    order: ["overview", "waiting", "preparing", "ready"] as ColumnKey[],
    hidden: [] as ColumnKey[],
    collapsed,
  });
  // Two cards Waiting, one Preparing, one Ready.
  const board = () => [
    ageBill(1, [ageDish("w1", 15, { name: "Sirloin" })]),
    ageBill(2, [ageDish("w2", 16, { name: "Burger" })]),
    ageBill(3, [ageDish("p1", 10, { name: "Rib steak", state: "preparing" })]),
    ageBill(4, [ageDish("r1", 5, { name: "Croquettes", state: "ready" })]),
  ];
  const mountBoard = (columns = layout(), groups = board()) =>
    mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      now: AGE_NOW,
      columns,
    });
  const shadow = (el: TillStationQueue) => el.shadowRoot!;
  const tabs = (el: TillStationQueue) => [
    ...shadow(el).querySelectorAll<HTMLButtonElement>("[data-column-tab]"),
  ];
  const tab = (el: TillStationQueue, key: string) =>
    shadow(el).querySelector<HTMLButtonElement>(`[data-column-tab="${key}"]`)!;
  const panels = (el: TillStationQueue) => [
    ...shadow(el).querySelectorAll<HTMLElement>("[data-tab-panel]"),
  ];

  it("the board's narrow tabs: at 390 px the board draws a tab per shown column, in order, the first chosen", async () => {
    await pageAt(390, 844);
    const { el } = await mountBoard();
    expect(tabs(el).map((button) => button.dataset.columnTab)).toEqual([
      "overview",
      "waiting",
      "preparing",
      "ready",
    ]);
    expect(tabs(el).map((button) => button.getAttribute("aria-pressed"))).toEqual([
      "true",
      "false",
      "false",
      "false",
    ]);
    const row = shadow(el).querySelector<HTMLElement>("[data-column-tabs]")!;
    expect(row.getAttribute("role")).toBe("group");
    expect(row.getAttribute("aria-label")).toBe(t("station.columns"));
    expect(panels(el).map((panel) => panel.dataset.tabPanel)).toEqual(["overview"]);
    expect(panels(el)[0]!.querySelectorAll("[data-overview-row]")).toHaveLength(3);
    expect(shadow(el).querySelector(".kanban")).toBeNull();
  });

  it("the board's narrow tabs: a tab is named by its column and count", async () => {
    await pageAt(390, 844);
    const { el } = await mountBoard();
    await expect
      .element(page.getByRole("button", { name: "Waiting 2", exact: true }))
      .toBeInTheDocument();
    expect(tab(el, "waiting").textContent!.replace(/\s+/g, " ").trim()).toBe(
      `${t("station.state.queued")} · 2`,
    );
  });

  it("the board's narrow tabs: tapping a tab shows that column's cards", async () => {
    await pageAt(390, 844);
    const { el } = await mountBoard();
    tab(el, "preparing").click();
    await el.updateComplete;
    expect(tab(el, "preparing").getAttribute("aria-pressed")).toBe("true");
    expect(tab(el, "overview").getAttribute("aria-pressed")).toBe("false");
    expect(panels(el)).toHaveLength(1);
    const panel = panels(el)[0]!;
    expect(panel.dataset.column).toBe("preparing");
    expect(
      [...panel.querySelectorAll<HTMLElement>("[data-card]")].map((c) => c.dataset.order),
    ).toEqual(["3"]);
    expect(shadow(el).querySelector("[data-overview-row]")).toBeNull();
  });

  it.each([
    ["1024 × 768 at 100%", "columns", [1024, 768, 100], []],
    ["1024 × 768 at 130%", "tabs", [1024, 768, 130], []],
    ["1280 × 800 at 130%", "columns", [1280, 800, 130], []],
    [
      "1024 × 768 at 130% with Preparing and Ready collapsed",
      "columns",
      [1024, 768, 130],
      ["preparing", "ready"],
    ],
  ] as const)(
    "the board's narrow tabs: at %s the board draws %s",
    async (_, drawn, frame, collapsed) => {
      await pageAt(frame[0], frame[1], frame[2]);
      const { el } = await mountBoard(layout([...collapsed]));
      expect(shadow(el).querySelector(".kanban") === null ? "tabs" : "columns").toBe(drawn);
      expect(tabs(el).length > 0 ? "tabs" : "columns").toBe(drawn);
    },
  );

  it("the board's narrow tabs: the board changes to tabs and back as its width crosses the need", async () => {
    await page.viewport(1280, 900);
    const { el } = await mountBoard();
    expect(shadow(el).querySelector(".kanban")).not.toBeNull();
    await page.viewport(800, 900);
    await vi.waitFor(() => expect(shadow(el).querySelector("[data-column-tabs]")).not.toBeNull());
    expect(shadow(el).querySelector(".kanban")).toBeNull();
    await page.viewport(1280, 900);
    await vi.waitFor(() => expect(shadow(el).querySelector(".kanban")).not.toBeNull());
    expect(shadow(el).querySelector("[data-column-tabs]")).toBeNull();
    expect(document.querySelector("till-station-queue")).toBe(el);
  });

  it("the board's narrow tabs: opening a collapsed column that no longer fits shows its tab", async () => {
    await pageAt(1024, 768, 130);
    const { el } = await mountBoard(layout(["preparing", "ready"]));
    const keys: unknown[] = [];
    el.addEventListener("toggle-column", (event) => keys.push((event as CustomEvent).detail));
    expect(shadow(el).querySelector(".kanban")).not.toBeNull();

    shadow(el).querySelector<HTMLButtonElement>('[data-column-toggle="ready"]')!.click();
    expect(keys).toEqual([{ key: "ready" }]);
    el.columns = layout(["preparing"]);
    await el.updateComplete;
    expect(shadow(el).querySelector(".kanban")).not.toBeNull();

    shadow(el).querySelector<HTMLButtonElement>('[data-column-toggle="preparing"]')!.click();
    el.columns = layout([]);
    await el.updateComplete;
    expect(shadow(el).querySelector(".kanban")).toBeNull();
    expect(tab(el, "preparing").getAttribute("aria-pressed")).toBe("true");
    expect(tab(el, "overview").getAttribute("aria-pressed")).toBe("false");
    expect(panels(el)[0]!.dataset.column).toBe("preparing");
  });

  it.each([
    ["Enter", "{Enter}"],
    ["Space", " "],
  ])(
    "the board's narrow tabs: %s on a focused heading that turns the board to tabs moves the focus to that column's tab",
    async (_, key) => {
      await pageAt(1024, 768, 130);
      const { el } = await mountBoard(layout(["preparing", "ready"]));
      shadow(el).querySelector<HTMLButtonElement>('[data-column-toggle="ready"]')!.click();
      el.columns = layout(["preparing"]);
      await el.updateComplete;
      expect(shadow(el).querySelector(".kanban")).not.toBeNull();

      shadow(el).querySelector<HTMLButtonElement>('[data-column-toggle="preparing"]')!.focus();
      await userEvent.keyboard(key);
      el.columns = layout([]);
      await el.updateComplete;
      expect(shadow(el).querySelector(".kanban")).toBeNull();
      expect(shadow(el).activeElement).toBe(tab(el, "preparing"));
    },
  );

  it("the board's narrow tabs: a heading tap that turns the board to tabs leaves the focus where it was", async () => {
    await pageAt(1024, 768, 130);
    const { el } = await mountBoard(layout(["preparing", "ready"]));
    shadow(el).querySelector<HTMLButtonElement>('[data-column-toggle="ready"]')!.click();
    el.columns = layout(["preparing"]);
    await el.updateComplete;
    const columnsButton = shadow(el).querySelector<HTMLElement>("[data-columns-open]")!;
    columnsButton.focus();

    shadow(el).querySelector<HTMLButtonElement>('[data-column-toggle="preparing"]')!.click();
    el.columns = layout([]);
    await el.updateComplete;
    expect(tab(el, "preparing").getAttribute("aria-pressed")).toBe("true");
    expect(shadow(el).activeElement).toBe(columnsButton);
  });

  it("the board's narrow tabs: with no orders at 390 px there are no tabs, only Nothing in the kitchen", async () => {
    await pageAt(390, 844);
    const { el } = await mountBoard(layout(), []);
    expect(tabs(el)).toHaveLength(0);
    expect(shadow(el).querySelector(".empty")!.textContent!.trim()).toBe(t("station.empty"));
  });

  const chosen = (el: TillStationQueue) =>
    tabs(el)
      .filter((button) => button.getAttribute("aria-pressed") === "true")
      .map((button) => button.dataset.columnTab);
  const choose = async (el: TillStationQueue, key: string) => {
    tab(el, key).click();
    await el.updateComplete;
  };
  const hiding = (hidden: ColumnKey[], collapsed: ColumnKey[] = []) => ({
    ...layout(collapsed),
    hidden,
  });

  it("the board's narrow tabs: the chosen tab survives new orders", async () => {
    await pageAt(390, 844);
    const { el } = await mountBoard();
    await choose(el, "preparing");
    el.groups = [...board(), ageBill(5, [ageDish("w3", 18, { name: "Burger" })])];
    await el.updateComplete;
    expect(chosen(el)).toEqual(["preparing"]);
    expect(tab(el, "waiting").textContent!.replace(/\s+/g, " ").trim()).toBe(
      `${t("station.state.queued")} · 3`,
    );
  });

  it("the board's narrow tabs: the chosen tab survives a wide spell", async () => {
    await pageAt(390, 844);
    const { el } = await mountBoard();
    await choose(el, "ready");
    await page.viewport(1280, 900);
    await vi.waitFor(() => expect(shadow(el).querySelector(".kanban")).not.toBeNull());
    await page.viewport(390, 844);
    await vi.waitFor(() => expect(shadow(el).querySelector("[data-column-tabs]")).not.toBeNull());
    expect(chosen(el)).toEqual(["ready"]);
    expect(panels(el)[0]!.dataset.column).toBe("ready");
  });

  it("the board's narrow tabs: a hidden column has no tab, and a chosen column that is hidden gives way to the first", async () => {
    await pageAt(390, 844);
    const { el } = await mountBoard(hiding(["waiting"]));
    expect(tabs(el).map((button) => button.dataset.columnTab)).toEqual([
      "overview",
      "preparing",
      "ready",
    ]);
    await choose(el, "ready");
    el.columns = hiding(["waiting", "ready"]);
    await el.updateComplete;
    expect(tabs(el).map((button) => button.dataset.columnTab)).toEqual(["overview", "preparing"]);
    expect(chosen(el)).toEqual(["overview"]);
    expect(panels(el).map((panel) => panel.dataset.tabPanel)).toEqual(["overview"]);
  });

  it("the board's narrow tabs: once a hidden column's tab has given way, showing the column again keeps the tab drawn chosen", async () => {
    await pageAt(390, 844);
    const { el } = await mountBoard();
    await choose(el, "ready");
    el.columns = hiding(["ready"]);
    await el.updateComplete;
    expect(chosen(el)).toEqual(["overview"]);
    el.columns = layout();
    await el.updateComplete;
    expect(chosen(el)).toEqual(["overview"]);
    expect(panels(el).map((panel) => panel.dataset.tabPanel)).toEqual(["overview"]);
  });

  it("the board's narrow tabs: with Overview hidden, Waiting is the first tab and chosen", async () => {
    await pageAt(390, 844);
    const { el } = await mountBoard();
    await choose(el, "preparing");
    await choose(el, "overview");
    expect(chosen(el)).toEqual(["overview"]);
    el.columns = hiding(["overview"]);
    await el.updateComplete;
    expect(tabs(el)[0]!.dataset.columnTab).toBe("waiting");
    expect(chosen(el)).toEqual(["waiting"]);
    expect(panels(el)[0]!.dataset.column).toBe("queued");
  });

  it("the board's narrow tabs: with every column hidden there are no tabs, and Columns stays", async () => {
    await pageAt(390, 844);
    const { el } = await mountBoard(hiding(["overview", "waiting", "preparing", "ready"]));
    expect(tabs(el)).toHaveLength(0);
    expect(panels(el)).toHaveLength(0);
    expect(shadow(el).querySelector("[data-columns-open]")).not.toBeNull();
  });

  it("the board's narrow tabs: a collapsed column keeps its tab and shows its cards there, and nothing is asked of the layout", async () => {
    await pageAt(390, 844);
    const { el } = await mountBoard(layout(["ready"]));
    const asked: unknown[] = [];
    el.addEventListener("toggle-column", (event) => asked.push((event as CustomEvent).detail));
    expect(tabs(el).map((button) => button.dataset.columnTab)).toContain("ready");
    await choose(el, "ready");
    expect(chosen(el)).toEqual(["ready"]);
    expect(
      [...panels(el)[0]!.querySelectorAll<HTMLElement>("[data-card]")].map((c) => c.dataset.order),
    ).toEqual(["4"]);
    expect(asked).toEqual([]);
    expect(el.columns.collapsed).toEqual(["ready"]);
  });

  it("the board's narrow tabs: Enter and Space choose a tab", async () => {
    await pageAt(390, 844);
    const { el } = await mountBoard();
    tab(el, "ready").focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(chosen(el)).toEqual(["ready"]));
    tab(el, "waiting").focus();
    await userEvent.keyboard(" ");
    await vi.waitFor(() => expect(chosen(el)).toEqual(["waiting"]));
  });

  it("the board's narrow tabs: the tabs read in Spanish", async () => {
    const english = { overview: t("station.overview"), waiting: t("station.state.queued") };
    const dish = (name: string, minute: number, extra: Partial<StationQueueItem> = {}) =>
      ageDish(`${name}-${minute}`, minute, { name, ...extra });
    // Picture 03's scene (plan slice 9c); its two held cards sit in Waiting until a Held column.
    const scene = [
      ageBill(2, [
        dish("Sirloin", 0, { state: "preparing" }),
        dish("Burger", 0, { state: "preparing" }),
      ]),
      ageBill(11, [dish("Croquettes", 8, { quantity: "2.000", state: "ready" })]),
      ageBill(5, [dish("Spicy potatoes", 12, { quantity: "2.000" })]),
      ageBill(9, [dish("Pork shoulder", 17), dish("Spicy potatoes", 17)]),
      ageBill(4, [
        dish("Pork shoulder", 0, { quantity: "2.000", firedAt: null }),
        dish("Spicy potatoes", 1, { firedAt: null }),
      ]),
      ageBill(7, [dish("Rib steak", 0, { firedAt: null })]),
    ];
    await pageAt(390, 844);
    const previousLocale = currentLocale();
    setLocale("es-ES");
    try {
      const { el } = await mountBoard(layout(), scene);
      const text = (button: HTMLElement) => button.textContent!.replace(/\s+/g, " ").trim();
      expect(t("station.overview")).not.toBe(english.overview);
      expect(t("station.state.queued")).not.toBe(english.waiting);
      expect(text(tabs(el)[0]!)).toBe(`${t("station.overview")} · 4`);
      expect(text(tab(el, "waiting"))).toBe(`${t("station.state.queued")} · 4`);
    } finally {
      setLocale(previousLocale);
    }
  });

  const overviewSpan = (el: TillStationQueue) => {
    const row = shadow(el).querySelector<HTMLElement>("[data-tab-panel] [data-overview-row]")!;
    const name = row.querySelector<HTMLElement>(".overview-name")!.getBoundingClientRect();
    const count = row.querySelector<HTMLElement>("[data-overview-making]")!.getBoundingClientRect();
    return count.right - name.left;
  };

  it("the board's narrow tabs: on a tablet, Overview's tab keeps a dish's name within a card column of its count", async () => {
    await pageAt(975, 768, 130);
    const { el } = await mountBoard();
    expect(panels(el).map((panel) => panel.dataset.tabPanel)).toEqual(["overview"]);
    const cardColumn = CARD_COLUMN_TEXT_WIDTHS * parseFloat(getComputedStyle(el).fontSize);
    expect(overviewSpan(el)).toBeLessThanOrEqual(cardColumn);
  });

  it("the board's narrow tabs: at 390 px Overview's tab still fills the panel", async () => {
    await pageAt(390, 844);
    const { el } = await mountBoard();
    const panel = panels(el)[0]!.getBoundingClientRect();
    const list = shadow(el).querySelector<HTMLElement>("[data-overview]")!.getBoundingClientRect();
    expect(list.width).toBeCloseTo(panel.width, 0);
    expect(overviewSpan(el)).toBeGreaterThan(
      CARD_COLUMN_TEXT_WIDTHS * parseFloat(getComputedStyle(el).fontSize),
    );
  });
});

describe("the board's header row and hidden columns", () => {
  const shadow = (el: TillStationQueue) => el.shadowRoot!;
  const columnsButton = (el: TillStationQueue) =>
    shadow(el).querySelector<HTMLElement>("[data-columns-open]");
  const lateWaiting = ageBill(3, [ageDish("late", 8)]);
  const notice: KitchenNotice = {
    id: "kn-1",
    stationId: "st-1",
    workingOrderId: "wo-3",
    orderLabel: "#3",
    kind: "void",
    lineName: "Octopus",
    unitName: null,
    soldInEach: false,
    quantity: "1.000",
    note: null,
    wasStarted: false,
    movedTo: null,
    reroutedTo: null,
    direction: null,
    cancelledExtra: null,
    createdAt: ageAt(10),
  };

  it("the board's header row comes first: the lead slot, the counts line, then Columns", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [lateWaiting],
      notices: [notice],
      stationId: "st-1",
      now: AGE_NOW,
    });
    const head = shadow(el).querySelector<HTMLElement>("[data-board-head]")!;
    const parts = [...head.children].map((child) =>
      child.matches('slot[name="lead"]')
        ? "lead"
        : child.matches("[data-kitchen-counts]")
          ? "counts"
          : child.matches("[data-columns-open]")
            ? "columns"
            : child.tagName,
    );
    expect(parts).toEqual(["lead", "counts", "columns"]);
    const order = [
      ...shadow(el).querySelectorAll<HTMLElement>(
        '[data-board-head], slot[name="status"], .notices, .kanban',
      ),
    ].map((node) =>
      node.matches("[data-board-head]")
        ? "head"
        : node.matches("slot")
          ? "status"
          : node.matches(".notices")
            ? "notices"
            : "board",
    );
    expect(order).toEqual(["head", "status", "notices", "board"]);
  });

  it("the board's header row: an empty board still offers Columns and no counts", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [],
      stationId: "st-1",
    });
    expect(columnsButton(el)).not.toBeNull();
    expect(shadow(el).querySelector("[data-kitchen-counts]")).toBeNull();
    expect(shadow(el).querySelector(".empty")!.textContent!.trim()).toBe(t("station.empty"));
  });

  it("the board's header row: Columns asks to open the window and changes nothing itself", async () => {
    const columns = { order: [...STATION_COLUMNS.order], hidden: [], collapsed: [] };
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [lateWaiting],
      stationId: "st-1",
      now: AGE_NOW,
      columns,
    });
    const asked: CustomEvent<{ opener: HTMLElement }>[] = [];
    el.addEventListener("open-columns", (event) => {
      asked.push(event as CustomEvent<{ opener: HTMLElement }>);
    });
    await userEvent.click(columnsButton(el)!);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.bubbles).toBe(true);
    expect(asked[0]!.composed).toBe(true);
    expect(asked[0]!.detail.opener).toBe(columnsButton(el));
    expect(el.columns).toBe(columns);
    expect(columns).toEqual({
      order: ["overview", "waiting", "preparing", "ready"],
      hidden: [],
      collapsed: [],
    });
  });

  it("the board's header row: a hidden column is not drawn, and the line still counts its late card", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [lateWaiting],
      stationId: "st-1",
      now: AGE_NOW,
      columns: { order: ["waiting", "preparing", "ready"], hidden: ["waiting"], collapsed: [] },
    });
    expect(shadow(el).querySelector('[data-column="queued"]')).toBeNull();
    expect(shadow(el).querySelectorAll("[data-column]")).toHaveLength(2);
    expect(shadow(el).querySelector("[data-card]")).toBeNull();
    const line = shadow(el).querySelector("[data-kitchen-counts]")!.textContent!;
    expect(line.replace(/\s+/g, " ").trim()).toMatch(/· 1 late$/);
  });

  it("the board's header row: every column hidden draws no column and keeps Columns", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [lateWaiting],
      stationId: "st-1",
      now: AGE_NOW,
      columns: {
        order: ["waiting", "preparing", "ready"],
        hidden: ["waiting", "preparing", "ready"],
        collapsed: [],
      },
    });
    expect(shadow(el).querySelector("[data-column]")).toBeNull();
    expect(columnsButton(el)).not.toBeNull();
  });

  it("the board's header row: the station registers only columns the board draws", () => {
    const names = stationColumnNames();
    expect(STATION_COLUMNS.order.every((key) => names.has(key))).toBe(true);
    expect([...names]).toEqual([
      ["overview", t("station.overview")],
      ["waiting", t("station.state.queued")],
      ["preparing", t("station.state.preparing")],
      ["ready", t("station.state.ready")],
    ]);
  });

  it("the board's header row: Columns reads «Columnas» in Spanish", async () => {
    const before = currentLocale();
    setLocale("es-ES");
    try {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [],
        stationId: "st-1",
      });
      expect(t("station.columns")).not.toBe("Columns");
      expect(columnsButton(el)!.textContent!.trim()).toBe(t("station.columns"));
    } finally {
      setLocale(before);
    }
  });
});

describe("the late bar", () => {
  const layout = (collapsed: ColumnKey[] = [], hidden: ColumnKey[] = []) => ({
    order: ["overview", "waiting", "preparing", "ready"] as ColumnKey[],
    hidden,
    collapsed,
  });
  // At 10:20: a fresh card Waiting, an overdue card Preparing.
  const lateBoard = () => [
    ageBill(1, [ageDish("fresh-dish", 18)]),
    ageBill(3, [ageDish("late-dish", 8, { state: "preparing" })]),
  ];
  const mountBoard = (columns = layout(), groups = lateBoard(), reducedMotion?: boolean) =>
    mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      now: AGE_NOW,
      columns,
      ...(reducedMotion === undefined ? {} : { reducedMotion }),
    });
  const shadow = (el: TillStationQueue) => el.shadowRoot!;
  const tab = (el: TillStationQueue, key: string) =>
    shadow(el).querySelector<HTMLButtonElement>(`[data-column-tab="${key}"]`)!;
  const strip = (el: TillStationQueue, key: string) =>
    shadow(el).querySelector<HTMLButtonElement>(`[data-column-toggle="${key}"]`)!;
  const marked = (el: TillStationQueue) =>
    [...shadow(el).querySelectorAll<HTMLElement>("[data-late]")].map(
      (node) => node.dataset.columnTab ?? node.dataset.columnToggle,
    );
  /** The danger token resolved to the `rgb()` form a computed `box-shadow` carries. */
  const danger = (el: TillStationQueue) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--wt-color-danger)";
    shadow(el).append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    expect(colour).toMatch(/^rgb/);
    return colour;
  };

  it("the late bar: a tab whose column holds a late card carries it and says so", async () => {
    await pageAt(390, 844);
    const { el } = await mountBoard();
    expect(shadow(el).querySelector("[data-column-tabs]")).not.toBeNull();
    expect(marked(el)).toEqual(["preparing"]);
    await expect
      .element(page.getByRole("button", { name: "Preparing 1, 1 late", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Waiting 1", exact: true }))
      .toBeInTheDocument();
    const shadowValue = getComputedStyle(tab(el, "preparing")).boxShadow;
    expect(shadowValue).toContain(danger(el));
    expect(shadowValue).not.toContain("inset");
    expect(getComputedStyle(tab(el, "waiting")).boxShadow).not.toContain(danger(el));
  });

  it("the late bar: the chosen tab keeps its bar", async () => {
    await pageAt(390, 844);
    const { el } = await mountBoard();
    tab(el, "preparing").click();
    await el.updateComplete;
    expect(tab(el, "preparing").getAttribute("aria-pressed")).toBe("true");
    expect(tab(el, "preparing").hasAttribute("data-late")).toBe(true);
    expect(getComputedStyle(tab(el, "preparing")).boxShadow).toContain(danger(el));
  });

  it("the late bar: Overview's tab and a held card's column never carry it", async () => {
    await pageAt(390, 844);
    const { el } = await mountBoard(layout(), [
      ageBill(5, [ageDish("held-dish", 0, { firedAt: null })]),
    ]);
    expect(shadow(el).querySelector("[data-column-tabs]")).not.toBeNull();
    expect(marked(el)).toEqual([]);
  });

  it("the late bar: a collapsed column holding a late card carries the bar on its strip", async () => {
    await pageAt(1280, 800);
    const { el } = await mountBoard(layout(["preparing"]));
    expect(shadow(el).querySelector(".kanban")).not.toBeNull();
    expect(marked(el)).toEqual(["preparing"]);
    await expect
      .element(page.getByRole("button", { name: "Preparing 1, 1 late", exact: true }))
      .toBeInTheDocument();
    const shadowValue = getComputedStyle(strip(el, "preparing")).boxShadow;
    expect(shadowValue).toContain(danger(el));
    expect(shadowValue).toContain("inset");
    el.columns = layout();
    await el.updateComplete;
    expect(marked(el)).toEqual([]);
    expect(getComputedStyle(strip(el, "preparing")).boxShadow).not.toContain(danger(el));
  });

  it("the late bar: a hidden column's late card marks nothing but the header line", async () => {
    for (const width of [390, 1280]) {
      await pageAt(width, 844);
      const { el } = await mountBoard(layout(["preparing"], ["preparing"]));
      expect(marked(el)).toEqual([]);
      expect(shadow(el).querySelector("[data-kitchen-counts]")!.textContent!.trim()).toMatch(
        /· 1 late$/,
      );
      cleanupWidgets();
    }
  });

  it.each([undefined, true, false])(
    "the late bar: the bar holds still (reduced motion %s)",
    async (reducedMotion) => {
      await pageAt(390, 844);
      const narrow = await mountBoard(layout(), lateBoard(), reducedMotion);
      expect(tab(narrow.el, "preparing").hasAttribute("data-late")).toBe(true);
      expect(tab(narrow.el, "preparing").getAnimations()).toEqual([]);
      cleanupWidgets();
      await pageAt(1280, 800);
      const wide = await mountBoard(layout(["preparing"]), lateBoard(), reducedMotion);
      expect(strip(wide.el, "preparing").hasAttribute("data-late")).toBe(true);
      expect(strip(wide.el, "preparing").getAnimations()).toEqual([]);
    },
  );

  it("the late bar: a late tab reads in Spanish", async () => {
    await pageAt(390, 844);
    const before = currentLocale();
    setLocale("es-ES");
    try {
      const { el } = await mountBoard();
      const state = t("station.state.preparing");
      const late = t("station.late").replace("{n}", "1");
      expect(state).not.toBe("Preparing");
      expect(late).not.toBe("1 late");
      expect(tab(el, "preparing").hasAttribute("data-late")).toBe(true);
      await expect
        .element(page.getByRole("button", { name: `${state} 1, ${late}`, exact: true }))
        .toBeInTheDocument();
    } finally {
      setLocale(before);
    }
  });
});

describe("A803 portion grouping: the station queue", () => {
  const portion = (id: string, overrides: Partial<StationQueueItem> = {}): StationQueueItem => ({
    allergy: null,
    id,
    workingOrderLineId: `wol-${id}`,
    state: "queued",
    name: "Burger",
    quantity: "1.000",
    unitName: null,
    unitPrecision: 0,
    soldInEach: true,
    course: null,
    firedAt: "2026-08-17T10:00:00.000Z",
    queuedAt: "2026-08-17T10:00:00.000Z",
    ...overrides,
  });
  const order = (items: StationQueueItem[], bumpMode: "line" | "ticket" = "line") => ({
    ...groupA,
    orderId: "wo-p",
    bumpMode,
    items,
  });
  const lineTexts = (el: TillStationQueue) =>
    [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-item] .line-name")].map((name) =>
      name.textContent!.trim(),
    );

  it("A803 portion grouping: two identical portions show as one row, 2× Burger", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [order([portion("p1"), portion("p2"), portion("f1", { name: "Fish" })])],
      stationId: "st-1",
    });
    expect(lineTexts(el)).toEqual(["2× Burger", "1× Fish"]);
    expect(el.shadowRoot!.querySelectorAll("[data-item]")).toHaveLength(2);
  });

  it("A803 portion grouping: a portion whose extra has another count shows apart, each row with its own count", async () => {
    const cheese = (perDish: number) => [{ descriptions: { "es-ES": "Queso" }, perDish }];
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [
        order([
          portion("p1", { modifiers: cheese(1) }),
          portion("p2", { modifiers: cheese(2) }),
          portion("p3", { modifiers: cheese(1) }),
        ]),
      ],
      stationId: "st-1",
    });
    expect(lineTexts(el)).toEqual(["2× Burger", "1× Burger"]);
    expect(
      [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-item] .modifier")].map((modifier) =>
        modifier.textContent!.trim(),
      ),
    ).toEqual(["+ Queso", "+ Queso x2"]);
  });

  it("A803 portion grouping: a portion in another state shows apart", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [order([portion("p1"), portion("p2", { state: "preparing" })])],
      stationId: "st-1",
    });
    expect(lineTexts(el)).toEqual(["1× Burger", "1× Burger"]);
  });

  it("A803 portion grouping: tapping a grouped row advances every portion in it, in one action", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [order([portion("p1"), portion("f1", { name: "Fish" }), portion("p2")])],
      stationId: "st-1",
    });
    const item = vi.fn();
    const dishes = vi.fn();
    el.addEventListener("advance-ticket-item", (e) => item((e as CustomEvent).detail));
    el.addEventListener("advance-dishes", (e) => dishes((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>('[data-item="p1"]')!.click();
    expect(dishes.mock.calls).toEqual([
      [{ itemIds: ["p1", "p2"], stationId: "st-1", to: "preparing" }],
    ]);
    expect(item).not.toHaveBeenCalled();
    el.shadowRoot!.querySelector<HTMLElement>('[data-item="f1"]')!.click();
    expect(item.mock.calls).toEqual([[{ itemId: "f1", stationId: "st-1", to: "preparing" }]]);
  });

  it("A803 portion grouping: in ticket mode a grouped row moves the card's dishes at its stage, as any row does", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [order([portion("p1"), portion("p2"), portion("f1", { name: "Fish" })], "ticket")],
      stationId: "st-1",
    });
    const dishes = vi.fn();
    el.addEventListener("advance-dishes", (e) => dishes((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>('[data-item="p1"]')!.click();
    expect(dishes.mock.calls).toEqual([
      [{ itemIds: ["p1", "p2", "f1"], stationId: "st-1", to: "preparing" }],
    ]);
  });

  it("A803 portion grouping: Move on a grouped row moves every portion's line", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [order([portion("p1"), portion("p2")])],
      stationId: "st-1",
      canMove: true,
    });
    const moved = vi.fn();
    el.addEventListener("move-station", (e) => moved((e as CustomEvent).detail));
    expect(el.shadowRoot!.querySelectorAll("[data-move-station]")).toHaveLength(1);
    const button = el.shadowRoot!.querySelector<HTMLElement>('[data-move-station="p1"]')!;
    expect(button.getAttribute("aria-label")).toBe(`${t("table.move_station")} · 2× Burger`);
    button.click();
    expect(moved.mock.calls).toEqual([
      [
        {
          workingOrderId: "wo-p",
          lineId: "wol-p1",
          lineIds: ["wol-p1", "wol-p2"],
          name: "2× Burger",
          stationId: "st-1",
        },
      ],
    ]);
  });
});
