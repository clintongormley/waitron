import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { CurrentOrderRow, CurrentOrders, LineNutrition } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import type { TillSentOrders } from "./sent-orders.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./sent-orders.js";

const now = Date.parse("2026-09-28T20:15:00.000Z");
const nutrition: LineNutrition = {
  allergens: { gluten: { kinds: ["rye"] } },
  dietaryDeclarations: ["kosher"],
};
const dish = (over: Partial<CurrentOrderRow> = {}): CurrentOrderRow => ({
  lineId: "dish",
  workingOrderId: "bill",
  billStatus: "open",
  netAmount: "4.00",
  readyAt: null,
  firedAt: "2026-09-28T20:00:00.000Z",
  lineNo: 1,
  courseId: null,
  name: "Dish",
  quantity: "2.000",
  unitPrecision: 0,
  servedQuantity: "0.000",
  servedAt: null,
  released: true,
  kitchen: null,
  note: null,
  extras: [],
  nutrition,
  ...over,
});
function orders(rows: CurrentOrderRow[], held = false): CurrentOrders {
  return {
    hasGroups: held,
    nextDisplayNumber: 2,
    retainedCourses: [],
    revision: 1,
    reminder: null,
    groups: held
      ? [
          {
            id: "group",
            position: 1,
            displayNumber: 1,
            numberPartyId: "party",
            state: "held",
            firedAt: null,
            remindAt: null,
            sentAt: "2026-09-28T20:00:00.000Z",
            sentBy: "Ana",
            rows,
          },
        ]
      : [],
    ungrouped: held ? [] : rows,
  };
}
async function mount(data: CurrentOrders) {
  const { el } = await mountWidget<TillSentOrders>("till-sent-orders", {
    scope: "party",
    billId: "bill",
    snapshot: { scope: "party", billId: "bill", current: data },
    now,
  });
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-sent-toggle]")!);
  await el.updateComplete;
  return el;
}
async function unfold(el: TillSentOrders, kind: "held" | "served") {
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>(`[data-${kind}-toggle]`)!);
  await el.updateComplete;
}
const icons = (row: Element) =>
  [...row.querySelectorAll("wt-icon")].map((icon) => icon.getAttribute("name"));

afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

describe.each(["en", "es"] as const)("stored nutrition in Sent (%s)", (locale) => {
  it.each(["fired", "held", "served", "cancelled"] as const)(
    "keeps the recorded allergen kind and diet on a %s dish",
    async (kind) => {
      setLocale(locale);
      const el = await mount(
        orders(
          [
            dish({
              released: kind !== "held",
              servedQuantity: kind === "served" ? "2.000" : "0.000",
              cancelledQuantity: kind === "cancelled" ? "2.000" : "0.000",
            }),
          ],
          kind === "held",
        ),
      );
      if (kind !== "fired") await unfold(el, kind === "held" ? "held" : "served");
      const row = el.shadowRoot!.querySelector(
        `[data-${kind === "cancelled" ? "served" : kind}-line="dish"]`,
      )!;
      expect(icons(row)).toEqual(["allergen-gluten", "diet-kosher"]);
      expect(row.querySelector('wt-icon[name="allergen-gluten"]')!.getAttribute("label")).toMatch(
        locale === "en" ? /rye/i : /centeno/i,
      );
    },
  );

  it("keeps a companion's own nutrition separate from this bill's dish", async () => {
    setLocale(locale);
    const el = await mount(
      orders(
        [
          dish({ released: false }),
          dish({
            lineId: "companion",
            workingOrderId: "other-bill",
            released: false,
            nutrition: {
              allergens: { nuts: { kinds: ["hazelnuts"] } },
              dietaryDeclarations: ["halal"],
            },
          }),
        ],
        true,
      ),
    );
    await unfold(el, "held");
    const companion = el.shadowRoot!.querySelector('[data-companion="companion"]')!;
    expect(icons(companion)).toEqual(["allergen-nuts", "diet-halal"]);
    expect(companion.querySelector('wt-icon[name="allergen-nuts"]')!.getAttribute("label")).toMatch(
      locale === "en" ? /hazelnut/i : /avellana/i,
    );
    expect(icons(el.shadowRoot!.querySelector('[data-held-line="dish"]')!)).toEqual([
      "allergen-gluten",
      "diet-kosher",
    ]);
    expect(companion.querySelector(".amount, button, wt-button")).toBeNull();
  });
});

it.each([undefined, { allergens: null, dietaryDeclarations: ["vegan"] }])(
  "draws no nutrition claim for an unreviewed stored dish (%j)",
  async (nutrition) => {
    const el = await mount(orders([dish({ nutrition })]));
    expect(icons(el.shadowRoot!.querySelector('[data-fired-line="dish"]')!)).toEqual([]);
  },
);

it("shows implied diets only from the stored declaration on a reviewed dish", async () => {
  const el = await mount(
    orders([dish({ nutrition: { allergens: {}, dietaryDeclarations: ["vegan"] } })]),
  );
  expect(icons(el.shadowRoot!.querySelector('[data-fired-line="dish"]')!)).toEqual([
    "diet-vegan",
    "diet-vegetarian",
    "diet-no_meat",
    "diet-no_fish",
  ]);
});

it("updates the row's nutrition when a new stored snapshot replaces it", async () => {
  const el = await mount(orders([dish()]));
  expect(icons(el.shadowRoot!.querySelector('[data-fired-line="dish"]')!)).toEqual([
    "allergen-gluten",
    "diet-kosher",
  ]);
  el.snapshot = {
    scope: "party",
    billId: "bill",
    current: orders([
      dish({ nutrition: { allergens: { eggs: {} }, dietaryDeclarations: ["halal"] } }),
    ]),
  };
  await el.updateComplete;
  expect(icons(el.shadowRoot!.querySelector('[data-fired-line="dish"]')!)).toEqual([
    "allergen-eggs",
    "diet-halal",
  ]);
});
