import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setContentLanguages } from "@waitron/ui";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { allergenName } from "../i18n/allergen-names.js";
import { cleanupWidgets, mountWidget, resetPage } from "./test-helpers.js";
import { PASS_COLUMNS } from "../state/kitchen-columns.js";
import type { DietProfile, PassBoard, PassCard, PassCardItem } from "../api/client.js";
import {
  PASS_NOW,
  minutesAgo,
  passBoard,
  passCard,
  passItem,
} from "../../test/pass-board-fixtures.js";
import { allergyBlock } from "../../test/kitchen-allergy-fixtures.js";
import type { TillPassBoard } from "./pass-board.js";
import "./pass-board.js";

beforeEach(async () => {
  await page.viewport(1280, 900);
});
afterEach(resetPage);
afterEach(cleanupWidgets);

async function mountBoard(board: PassBoard) {
  const { el } = await mountWidget<TillPassBoard>("till-pass-board", {
    board,
    mode: "pass",
    runsPass: true,
    columns: PASS_COLUMNS,
    now: PASS_NOW,
    sending: new Set<string>(),
    reducedMotion: false,
  });
  return el;
}

const inProgress = (items: PassCardItem[], card: Partial<PassCard> = {}) =>
  mountBoard(passBoard({ inProgress: [passCard({ items, ...card })] }));
const itemOf = (el: TillPassBoard, id: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-item="${id}"]`)!;
const names = (el: TillPassBoard) =>
  [...el.shadowRoot!.querySelectorAll(".item-name")].map((name) => name.textContent);
const portion = (id: string, overrides: Partial<PassCardItem> = {}) =>
  passItem({
    id,
    name: "Burger",
    qty: "1.000",
    unitName: null,
    unitPrecision: 0,
    soldInEach: true,
    state: "preparing",
    phase: "preparing",
    ...overrides,
  });

describe("A773 pass board widget: dishes", () => {
  it("draws a dish's option answers and extras as indented sub-text after its name", async () => {
    const el = await inProgress([
      passItem({
        id: "ti-9",
        name: "Cortado",
        optionSnapshots: [
          {
            listName: { en: "Size" },
            listCustomerName: { en: "Customer size" },
            listKitchenName: "Kitchen size",
            labelName: { en: "Large" },
            labelCustomerName: { en: "Customer large" },
            labelKitchenName: "Kitchen large",
          },
        ],
        modifiers: [
          { descriptions: { "es-ES": "Leche avena" } },
          { descriptions: { "es-ES": "Sirope" }, perDish: 2 },
        ],
      }),
    ]);
    const item = itemOf(el, "ti-9");
    const subText = item.querySelector<HTMLElement>(".item-modifiers")!;
    expect(subText.querySelector(".modifier-answer")!.textContent).toContain("Kitchen large");
    expect(subText.textContent).not.toContain("Customer large");
    expect(
      [...subText.querySelectorAll(".modifier")].map((modifier) => modifier.textContent!.trim()),
    ).toEqual(["+ Leche avena", "+ Sirope x2"]);
    expect(item.innerHTML.indexOf("Cortado")).toBeLessThan(item.innerHTML.indexOf("Kitchen large"));
  });

  it("A1202 draws a measured extra with its amount and unit, as the paper ticket prints it", async () => {
    const el = await inProgress([
      passItem({
        id: "toast",
        modifiers: [
          {
            descriptions: { "es-ES": "Jamón" },
            amount: "150.000",
            unitName: { "en-GB": "gr", "es-ES": "g" },
          },
          { descriptions: { "es-ES": "Queso" }, amount: "0.250", unitName: { "es-ES": "kg" } },
        ],
      }),
    ]);
    expect(
      [...itemOf(el, "toast").querySelectorAll(".modifier")].map((modifier) =>
        modifier.textContent!.trim(),
      ),
    ).toEqual(["+ Jamón 150 gr", "+ Queso 0.250 kg"]);
  });

  it("A1202 names a measured extra made at another station with its amount and unit", async () => {
    const el = await inProgress([
      passItem({
        id: "with",
        crossRefs: [
          {
            kind: "with",
            name: "JAMÓN",
            amount: "0.250",
            unitName: { "es-ES": "kg" },
            stationName: "Fryer",
          },
        ],
      }),
    ]);
    expect(itemOf(el, "with").querySelector("[data-crossref]")!.textContent).toContain(
      "with JAMÓN 0.250 kg from Fryer",
    );
  });

  it.each(["Tea $& $' $`", "Tea {station}"])(
    "A1006 shows a dish and station named %s exactly as typed in a cross-reference",
    async (name) => {
      const el = await inProgress([
        passItem({
          id: "with",
          crossRefs: [{ kind: "with", name, stationName: `Bar ${name}` }],
        }),
      ]);
      expect(itemOf(el, "with").querySelector("[data-crossref]")!.textContent).toContain(
        `with ${name} from Bar ${name}`,
      );
    },
  );

  it("draws no option sub-text on a dish with none", async () => {
    const el = await inProgress([passItem()]);
    expect(el.shadowRoot!.querySelectorAll(".item-modifiers")).toHaveLength(0);
  });

  it("draws the line's frozen note beneath the dish, and no row for an empty or missing one", async () => {
    const el = await inProgress([
      passItem({ id: "noted", note: "sin sal" }),
      passItem({ id: "empty", note: "" }),
      passItem({ id: "none", note: null }),
      passItem({ id: "keyless" }),
    ]);
    expect(
      itemOf(el, "noted").querySelector('[data-item-customisation="noted"] [data-note]')!
        .textContent,
    ).toContain("sin sal");
    expect(itemOf(el, "empty").querySelector(".item-customisation")).toBeNull();
    expect(itemOf(el, "none").querySelector(".item-customisation")).toBeNull();
    expect(itemOf(el, "keyless").querySelector(".item-customisation")).toBeNull();
  });

  it("draws the dish's own allergen chips and no not-reviewed warning", async () => {
    const el = await inProgress([
      passItem({ id: "milk", asServed: { allergens: { milk: {} }, pending: false } }),
      passItem({ id: "pending", asServed: { allergens: {}, pending: true } }),
      passItem({ id: "plain" }),
    ]);
    const chips = itemOf(el, "milk").querySelector('[data-item-allergens="milk"]')!;
    expect(chips.querySelector(".allergen-chip")!.textContent).toBe(
      allergenName("milk", currentLocale()),
    );
    expect(chips.textContent).toContain(t("allergens.contains"));
    expect(itemOf(el, "pending").querySelector(".item-allergens")).toBeNull();
    expect(itemOf(el, "pending").textContent).not.toMatch(/review|revisi/i);
    expect(itemOf(el, "plain").querySelector(".item-allergens")).toBeNull();
  });

  it("draws diet badges, a contains chip, and the neutral not-reviewed note", async () => {
    const el = await inProgress([
      passItem({ id: "vegan", asServedDiet: { vegan: "yes", vegetarian: "yes", contains: [] } }),
      passItem({ id: "meat", asServedDiet: { vegan: "no", vegetarian: "no", contains: ["meat"] } }),
      passItem({
        id: "unknown",
        asServedDiet: { vegan: "unknown", vegetarian: "unknown", contains: [] },
      }),
      passItem({ id: "plain" }),
    ]);
    expect(itemOf(el, "vegan").querySelector("[data-diet='vegan']")).not.toBeNull();
    expect(itemOf(el, "vegan").querySelector("[data-diet='vegetarian']")).not.toBeNull();
    expect(itemOf(el, "meat").querySelector("[data-diet-contains='meat']")).not.toBeNull();
    expect(itemOf(el, "meat").querySelector("[data-diet='vegan']")).toBeNull();
    expect(itemOf(el, "unknown").querySelector("[data-diet-pending]")).not.toBeNull();
    expect(itemOf(el, "unknown").querySelector("[data-diet='vegan']")).toBeNull();
    expect(itemOf(el, "plain").querySelector(".line-diet")).toBeNull();
  });

  it("names extras made at another station, with the extra's nutrition, and never as a '+' extra", async () => {
    const el = await inProgress([
      passItem({
        id: "with",
        crossRefs: [
          {
            kind: "with",
            name: "CHIPS",
            perDish: 2,
            stationName: "Fryer",
            addAllergens: { gluten: { kinds: ["wheat"] } },
            suitableFor: [],
          },
        ],
      }),
      passItem({ id: "for", crossRefs: [{ kind: "for", name: "BURG", stationName: "Grill" }] }),
      passItem({ id: "plain" }),
    ]);
    const withRef = itemOf(el, "with").querySelector("[data-crossref]")!.textContent!;
    expect(withRef).toContain("with CHIPS x2 from Fryer");
    expect(withRef).toContain(allergenName("gluten", currentLocale()));
    expect(itemOf(el, "for").querySelector("[data-crossref]")!.textContent).toContain(
      "for BURG at Grill",
    );
    expect(itemOf(el, "plain").querySelector("[data-crossref]")).toBeNull();
    expect(el.shadowRoot!.textContent).not.toContain("+ CHIPS");
  });

  describe("in Spanish", () => {
    let previous: string;
    beforeEach(() => {
      previous = currentLocale();
      setLocale("es-ES");
    });
    afterEach(() => setLocale(previous));

    it("A1202 draws a measured extra's unit in Spanish", async () => {
      const el = await inProgress([
        passItem({
          id: "toast",
          modifiers: [
            {
              descriptions: { "es-ES": "Jamón" },
              amount: "150.000",
              unitName: { "en-GB": "gr", "es-ES": "g" },
            },
          ],
        }),
      ]);
      expect(itemOf(el, "toast").querySelector(".modifier")!.textContent!.trim()).toBe(
        "+ Jamón 150 g",
      );
    });

    it("words extras made at another station in Spanish", async () => {
      const el = await inProgress([
        passItem({
          id: "with",
          crossRefs: [{ kind: "with", name: "CHIPS", perDish: 2, stationName: "Fryer" }],
        }),
        passItem({ id: "none", crossRefs: [{ kind: "for", name: "AGUA", stationName: null }] }),
      ]);
      expect(itemOf(el, "with").querySelector("[data-crossref]")!.textContent).toContain(
        "con CHIPS x2 de Fryer",
      );
      expect(itemOf(el, "none").querySelector("[data-crossref]")!.textContent).toContain(
        "para AGUA, sin preparación",
      );
    });
  });

  it("draws identical portions as one row with their count", async () => {
    const el = await inProgress([portion("p1"), portion("f1", { name: "Fish" }), portion("p2")]);
    expect(names(el)).toEqual(["2× Burger", "1× Fish"]);
    expect(el.shadowRoot!.querySelectorAll("[data-item]")).toHaveLength(2);
  });

  it.each<[string, Partial<PassCardItem>]>([
    ["another station", { stationName: "Parrilla" }],
    ["another state", { state: "ready", phase: "ready" }],
    ["another note", { note: "no salt" }],
  ])("draws a portion with %s apart", async (_, overrides) => {
    const el = await inProgress([portion("p1"), portion("p2", overrides)]);
    expect(el.shadowRoot!.querySelectorAll("[data-item]")).toHaveLength(2);
  });

  it("draws a forgotten portion apart from a fresh one, and marks only the forgotten", async () => {
    const el = await inProgress([
      portion("p1"),
      portion("p2", { queuedAt: minutesAgo(20), band: "fresh" }),
    ]);
    expect(names(el)).toEqual(["1× Burger", "1× Burger"]);
    expect(el.shadowRoot!.querySelectorAll("[data-forgotten]")).toHaveLength(1);
    expect(itemOf(el, "p2").querySelector("[data-forgotten]")).not.toBeNull();
  });

  it.each<[string, Partial<PassCardItem>, Partial<PassCardItem>]>([
    [
      "another phase",
      { phase: "requested", state: "queued", firedAt: null },
      { phase: "held", state: "queued", firedAt: null, requestedAt: null },
    ],
    ["one dimmed", {}, { informational: true }],
    ["its station closed", {}, { stationClosed: true }],
  ])("draws a portion with %s apart from an otherwise identical one", async (_, first, second) => {
    const el = await inProgress([portion("p1", first), portion("p2", { ...first, ...second })]);
    expect(names(el)).toEqual(["1× Burger", "1× Burger"]);
  });

  it("draws the same dish in another course apart", async () => {
    const el = await inProgress([
      portion("starter", {
        name: "Chips",
        course: { id: "course-starters", name: "Starters", displayOrder: 1 },
      }),
      portion("main", { name: "Chips" }),
    ]);
    expect(names(el)).toEqual(["1× Chips", "1× Chips"]);
  });

  it("draws the same dish from two bills on one group card apart", async () => {
    const el = await mountBoard(
      passBoard({
        inProgress: [
          passCard({
            key: "group:p3:g3",
            target: { kind: "group", partyId: "p3", groupId: "g3" },
            party: { id: "p3", revision: 2 },
            group: { displayNumber: 4, position: 1 },
            orders: [
              { orderId: "order-21", orderNumber: 21, tableLabel: "T11", kitchenNote: null },
              { orderId: "order-22", orderNumber: 22, tableLabel: "T11", kitchenNote: null },
            ],
            items: [
              portion("ana", { name: "Chips", orderId: "order-21" }),
              portion("clint", { name: "Chips", orderId: "order-22" }),
            ],
          }),
        ],
      }),
    );
    expect(names(el)).toEqual(["1× Chips", "1× Chips"]);
  });

  it("draws each dish's left edge in its kitchen state's colour, held and dimmed dishes included", async () => {
    const el = await mountBoard(
      passBoard({
        held: [
          passCard({
            key: "bill:held",
            kind: "held",
            requestedAt: null,
            items: [passItem({ id: "held", phase: "held", firedAt: null, requestedAt: null })],
          }),
        ],
        inProgress: [
          passCard({
            items: [
              passItem({ id: "queued", name: "Soup" }),
              passItem({ id: "preparing", name: "Fish", state: "preparing", phase: "preparing" }),
              passItem({ id: "ready", name: "Salad", state: "ready", phase: "ready" }),
              passItem({
                id: "dimmed",
                name: "Wine",
                stationName: "Bar",
                state: "preparing",
                phase: "preparing",
                informational: true,
              }),
            ],
          }),
        ],
      }),
    );
    el.style.setProperty("--wt-color-text-muted", "rgb(1, 2, 3)");
    el.style.setProperty("--wt-color-primary", "rgb(4, 5, 6)");
    el.style.setProperty("--wt-color-success", "rgb(7, 8, 9)");
    el.style.setProperty("--wt-space-1", "5px");
    const stripe = (id: string) => {
      const style = getComputedStyle(itemOf(el, id));
      return [style.borderLeftColor, style.borderLeftStyle, style.borderLeftWidth];
    };
    expect(stripe("queued")).toEqual(["rgb(1, 2, 3)", "solid", "5px"]);
    expect(stripe("preparing")).toEqual(["rgb(4, 5, 6)", "solid", "5px"]);
    expect(stripe("ready")).toEqual(["rgb(7, 8, 9)", "solid", "5px"]);
    expect(stripe("held")).toEqual(["rgb(1, 2, 3)", "solid", "5px"]);
    expect(stripe("dimmed")).toEqual(["rgb(4, 5, 6)", "solid", "5px"]);
  });

  it("draws a dimmed dish's dotted box in the muted text colour, not the faint border colour", async () => {
    const el = await inProgress([
      passItem({ id: "dimmed", stationName: "Bar", informational: true }),
      passItem({ id: "own" }),
    ]);
    el.style.setProperty("--wt-color-text-muted", "rgb(1, 2, 3)");
    el.style.setProperty("--wt-color-border", "rgb(4, 5, 6)");
    const box = (id: string) => {
      const style = getComputedStyle(itemOf(el, id));
      return [style.borderTopColor, style.borderRightColor, style.borderBottomColor];
    };
    expect(box("dimmed")).toEqual(["rgb(1, 2, 3)", "rgb(1, 2, 3)", "rgb(1, 2, 3)"]);
    expect(box("own")).toEqual(["rgb(4, 5, 6)", "rgb(4, 5, 6)", "rgb(4, 5, 6)"]);
  });

  it("mutes every part of a dimmed dish's diet line, and only a dimmed dish's", async () => {
    const diet: DietProfile = {
      vegan: "unknown",
      vegetarian: "yes",
      halal: "no",
      kosher: "no",
      contains: ["fish"],
    };
    const el = await inProgress([
      passItem({ id: "dimmed", stationName: "Bar", informational: true, asServedDiet: diet }),
      passItem({ id: "own", asServedDiet: diet }),
    ]);
    el.style.setProperty("--wt-color-text-muted", "rgb(1, 2, 3)");
    el.style.setProperty("--wt-color-text", "rgb(4, 5, 6)");
    el.style.setProperty("--wt-color-success-text", "rgb(7, 8, 9)");
    el.style.setProperty("--wt-color-warning-text", "rgb(10, 11, 12)");
    const colours = (id: string) =>
      [".diet-label", ".diet-badge", ".diet-contains", ".diet-pending"].map(
        (part) => getComputedStyle(itemOf(el, id).querySelector(part)!).color,
      );
    expect(colours("dimmed")).toEqual(Array(4).fill("rgb(1, 2, 3)"));
    expect(colours("own")).toEqual([
      "rgb(1, 2, 3)",
      "rgb(7, 8, 9)",
      "rgb(1, 2, 3)",
      "rgb(10, 11, 12)",
    ]);
  });

  it("marks a forgotten dish in view by its age on the board's clock, dimmed or not, never by the server's band", async () => {
    const el = await inProgress([
      passItem({ id: "own", queuedAt: minutesAgo(20), band: "fresh" }),
      passItem({
        id: "dimmed",
        informational: true,
        stationName: "Bar",
        queuedAt: minutesAgo(20),
        band: "fresh",
      }),
      passItem({ id: "young", queuedAt: minutesAgo(1), band: "forgotten" }),
    ]);
    for (const id of ["own", "dimmed"]) {
      expect(itemOf(el, id).querySelector("[data-forgotten]")!.textContent).toContain(
        t("expo.item_forgotten"),
      );
    }
    expect(itemOf(el, "young").querySelector("[data-forgotten]")).toBeNull();
  });

  it("marks no held dish forgotten, however old", async () => {
    const el = await mountBoard(
      passBoard({
        held: [
          passCard({
            key: "bill:held",
            kind: "held",
            requestedAt: null,
            items: [
              passItem({
                id: "held",
                phase: "held",
                firedAt: null,
                requestedAt: null,
                queuedAt: minutesAgo(60),
                band: "forgotten",
              }),
            ],
          }),
        ],
      }),
    );
    expect(itemOf(el, "held")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-forgotten]")).toBeNull();
  });

  it("heads a card with its former numbers, kitchen note and the allergy line's marker", async () => {
    const el = await inProgress(
      [passItem({ id: "allergic", allergy: allergyBlock }), passItem({ id: "plain" })],
      {
        orders: [
          {
            orderId: "order-1",
            orderNumber: 27,
            formerNumbers: [28, 30],
            tableLabel: "T1",
            kitchenNote: "Birthday, bring candles",
          },
        ],
      },
    );
    const head = el.shadowRoot!.querySelector(".ticket-head")!;
    expect(head.querySelector(".number")!.textContent!.replace(/\s+/g, " ")).toBe(
      "#27 (was 28, 30)",
    );
    expect(head.querySelectorAll("[data-allergy-marker]")).toHaveLength(1);
    expect(el.shadowRoot!.querySelector("[data-kitchen-note]")!.textContent).toContain(
      `${t("kitchen_note.heading")}: Birthday, bring candles`,
    );
    expect(itemOf(el, "allergic").querySelector("[data-kitchen-allergy]")!.textContent).toContain(
      "Captured milk",
    );
    expect(itemOf(el, "plain").querySelector("[data-kitchen-allergy]")).toBeNull();
  });

  it("marks the card head only for an allergy on a dish in the pass's view", async () => {
    const el = await inProgress([
      passItem({ id: "burger", name: "Burger" }),
      passItem({
        id: "chips",
        name: "Chips",
        stationName: "Fryer",
        visible: false,
        informational: true,
        allergy: allergyBlock,
      }),
    ]);
    expect(itemOf(el, "chips")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-allergy-marker]")).toBeNull();
  });

  it("draws each extra's own allergens and diet beside it, apart from the dish's own", async () => {
    const el = await inProgress([
      passItem({
        id: "burger",
        asServed: { allergens: { gluten: { kinds: ["wheat"] } }, pending: false },
        modifiers: [
          {
            descriptions: { "es-ES": "Bacon" },
            addAllergens: { milk: {} },
            suitableFor: ["halal"],
          },
        ],
      }),
    ]);
    const milk = allergenName("milk", currentLocale());
    const extraAllergens = el.shadowRoot!.querySelector(
      '[data-test="item-modifier-allergens-burger-0"]',
    )!;
    expect(extraAllergens.textContent).toContain(milk);
    const extraDiet = el.shadowRoot!.querySelector('[data-test="item-modifier-diet-burger-0"]')!;
    expect(extraDiet.querySelector("[data-diet='halal']")).not.toBeNull();
    const dish = el.shadowRoot!.querySelector('[data-item-allergens="burger"]')!;
    expect(dish.textContent).toContain(allergenName("gluten", currentLocale()));
    expect(dish.textContent).not.toContain(milk);
  });

  it.each([
    ["en-GB", [28], "#27 (was 28)"],
    ["es-ES", [28], "#27 (antes 28)"],
    ["en-GB", [], "#27"],
    ["en-GB", undefined, "#27"],
  ] as const)(
    "heads a card with the numbers its dishes were sent under (%s, %j)",
    async (locale, formerNumbers, text) => {
      const previous = currentLocale();
      setLocale(locale);
      try {
        const el = await inProgress([passItem()], {
          orders: [
            {
              orderId: "order-1",
              orderNumber: 27,
              ...(formerNumbers === undefined ? {} : { formerNumbers: [...formerNumbers] }),
              tableLabel: "T1",
              kitchenNote: null,
            },
          ],
        });
        expect(
          el.shadowRoot!.querySelector(".ticket-head .number")!.textContent!.replace(/\s+/g, " "),
        ).toBe(text);
      } finally {
        setLocale(previous);
      }
    },
  );

  it("keeps a dish's and its extras' receipt snapshots with an unrelated content default", async () => {
    const previous = currentLocale();
    setLocale("en-GB");
    setContentLanguages({ defaultLanguage: "ca", languages: ["ca"] });
    try {
      const el = await inProgress([
        passItem({
          id: "bread",
          name: "Pan",
          qty: "1.000",
          modifiers: [{ descriptions: { "es-ES": "Mantequilla" } }],
        }),
      ]);
      expect(names(el)).toEqual(["1× Pan"]);
      expect(itemOf(el, "bread").querySelector(".item-modifiers")!.textContent).toContain(
        "+ Mantequilla",
      );
    } finally {
      setLocale(previous);
    }
  });

  it("draws a fractional dish with its frozen unit", async () => {
    const el = await inProgress([
      passItem({ name: "Pan", qty: "0.375", unitName: { "es-ES": "kg" }, unitPrecision: 3 }),
    ]);
    expect(names(el)).toEqual(["0.375 kg× Pan"]);
  });

  it("leaves the unit out for a dish sold in Each, and keeps it for every other unit", async () => {
    const el = await inProgress([
      passItem({
        id: "ti-each",
        name: "Croqueta",
        qty: "2.000",
        unitName: { "es-ES": "ud" },
        unitPrecision: 0,
        soldInEach: true,
      }),
      passItem({
        id: "ti-kg",
        name: "Pulpo",
        qty: "0.500",
        unitName: { "es-ES": "kg" },
        unitPrecision: 3,
        soldInEach: false,
      }),
      passItem({
        id: "ti-g",
        name: "Almendras",
        qty: "200.000",
        unitName: { "es-ES": "g" },
        unitPrecision: 0,
        soldInEach: false,
      }),
    ]);
    expect(names(el)).toEqual(["2× Croqueta", "0.5 kg× Pulpo", "200 g× Almendras"]);
  });

  it("draws no allergy marker and no kitchen note on a card without them", async () => {
    const el = await inProgress([passItem()]);
    expect(el.shadowRoot!.querySelector("[data-allergy-marker]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-kitchen-note]")).toBeNull();
  });
});
