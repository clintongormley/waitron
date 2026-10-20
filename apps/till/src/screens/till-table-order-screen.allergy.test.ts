import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { PartyAllergyRead } from "@waitron/module";
import type { TableParty } from "../api/client.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import type { TillSentOrders } from "../widgets/sent-orders.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { mount, resized } from "./till-table-order-screen.test-helpers.js";
import { DraftStore } from "../state/draft-sync.js";
import { current, row } from "./till-table-order-screen.current-orders.test-helpers.js";
import { storedDish, storedExtra } from "./till-table-order-screen.sent-fallback.test-helpers.js";

const originalLocale = currentLocale();
beforeEach(() => setLocale("en"));
afterEach(async () => {
  cleanupWidgets();
  setLocale(originalLocale);
  await page.viewport(1280, 768);
});
const party: TableParty = {
  id: "party",
  revision: 7,
  guestCount: 3,
  state: "open",
  name: null,
  displayName: "4",
  mainBillId: "wo-4",
  outstanding: "0.00",
  billCount: 2,
  tableIds: ["table"],
  unsentDrafts: [],
  reminder: null,
  kitchenNote: { scope: { partyId: "party" }, note: "Together", revision: 0, ownerRevision: 7 },
};
const allergy = (answer: null | "none" | "allergies" = "allergies"): PartyAllergyRead => ({
  partyId: "party",
  snapshot: {
    answer,
    revision: 7,
    changedAt: null,
    changedBy: null,
    guests:
      answer === "allergies"
        ? [{ id: "guest", position: 0, who: "Blue shirt", allergens: { milk: {} }, note: "Severe" }]
        : [],
    ticks:
      answer === "allergies"
        ? [
            { guestId: "guest", draftLineId: "same-id", workingLineId: null },
            { guestId: "guest", draftLineId: null, workingLineId: "sent" },
          ]
        : [],
  },
  dishes: [],
});

it("marks a recalled dish by its source assignment without borrowing its new draft id", async () => {
  await page.viewport(1280, 900);
  const draftStore = new DraftStore();
  draftStore.appendLines([
    {
      product: {
        id: "retired",
        name: "Recorded dish",
        unitPrice: "4.00",
        vatClass: "general",
        category: null,
        allergens: null,
      },
      quantity: "2.000",
      draftLineId: "same-id",
      noMerge: true,
      source: { line: storedDish, extras: [storedExtra], netAmount: "8.00" },
    },
  ]);
  const view = allergy();
  view.snapshot.guests.push({
    id: "other-guest",
    position: 1,
    who: "Red hat",
    allergens: { eggs: {} },
    note: null,
  });
  view.snapshot.ticks.push({
    guestId: "other-guest",
    draftLineId: null,
    workingLineId: storedDish.id,
  });
  const { el } = await mount({
    party,
    draftStore,
    allergyView: view,
    billEdit: { billId: "wo-4", editorVersion: 1, draftId: "draft", draftRevision: 1 },
  });
  el.style.width = "1280px";
  await resized(el);
  expect(
    el.shadowRoot!.querySelector('[data-draft-select="0"] [data-allergy-tag]')?.textContent,
  ).toBe("Red hat");
});

it.each([null, "none", "allergies"] as const)(
  "shows the recorded %s answer beside the independent kitchen note",
  async (answer) => {
    const { el } = await mount({ party, allergyView: allergy(answer), kitchenNote: "Together" });
    const heading = el.shadowRoot!.querySelector("[data-allergy-heading]");
    if (answer === null) expect(heading).toBeNull();
    else {
      expect(heading!.textContent).toContain(
        t(answer === "none" ? "allergy.none" : "allergy.banner"),
      );
      if (answer === "allergies") {
        expect(heading!.textContent).toContain("Blue shirt");
        expect(heading!.textContent).toContain("Severe");
      }
      const events: Event[] = [];
      el.addEventListener("edit-party-allergy", (event) => events.push(event));
      await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-allergy-change]")!);
      expect(events).toHaveLength(1);
      expect(events[0]!.bubbles).toBe(true);
      expect(events[0]!.composed).toBe(true);
    }
    expect(el.kitchenNote).toBe("Together");
  },
);
it("never renders the answer from a different party", async () => {
  const { el } = await mount({ party, allergyView: { ...allergy(), partyId: "other" } });
  expect(el.shadowRoot!.querySelector("[data-allergy-heading]")).toBeNull();
});
it("offers Allergies first in Actions even before an answer or dish exists", async () => {
  const { el } = await mount({ party, allergyView: allergy(null) });
  el.style.width = "1280px";
  await resized(el);
  const events: Event[] = [];
  el.addEventListener("edit-party-allergy", (event) => events.push(event));
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!);
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-move-split]")!);
  const controls = el.shadowRoot!.querySelectorAll<HTMLElement>("[data-action-menu] [data-action]");
  expect(controls[0]!.dataset.action).toBe("allergy");
  await userEvent.click(controls[0]!);
  expect(events).toHaveLength(1);
});
it("marks the saved draft and sent dish without borrowing a same-id working assignment", async () => {
  await page.viewport(1280, 900);
  const draftStore = new DraftStore();
  draftStore.addProduct(
    {
      id: "toast",
      name: "Toast",
      unitPrice: "2.00",
      vatClass: "general",
      pricingUnit: "each",
      category: null,
      allergens: null,
    },
    "1",
  );
  draftStore.lines[0]!.draftLineId = "same-id";
  const { el } = await mount({
    party,
    draftStore,
    billEdit: { billId: "wo-4", editorVersion: 1, draftId: "draft", draftRevision: 1 },
    allergyView: allergy(),
    currentOrders: current({
      groups: [],
      reminder: null,
      ungrouped: [row("sent", "Soup", "1"), row("same-id", "Bread", "1")],
    }),
  });
  el.style.width = "1280px";
  await resized(el);
  expect(
    el.shadowRoot!.querySelector('[data-draft-select="0"] [data-allergy-tag]')?.textContent,
  ).toBe("Blue shirt");
  const sent = el.shadowRoot!.querySelector<TillSentOrders>("till-sent-orders")!;
  await sent.updateComplete;
  await userEvent.click(sent.shadowRoot!.querySelector<HTMLElement>("[data-sent-toggle]")!);
  await sent.updateComplete;
  expect(
    sent.shadowRoot!.querySelector('[data-fired-line="sent"] [data-allergy-tag]')?.textContent,
  ).toBe("Blue shirt");
  expect(
    sent.shadowRoot!.querySelector('[data-fired-line="same-id"] [data-allergy-tag]'),
  ).toBeNull();
});

for (const width of [390, 1280])
  for (const theme of ["light", "dark"] as const)
    for (const locale of ["en", "es"] as const)
      it(`renders accessible allergy heading in ${locale}/${theme}/${width}`, async () => {
        await page.viewport(width, 800);
        setLocale(locale);
        const { el, host } = await mountWidget<TillTableOrderScreen>(
          "till-table-order-screen",
          {
            products: [],
            menus: [],
            lines: [],
            orderId: "wo-4",
            party,
            allergyView: allergy(),
          },
          theme,
        );
        host.style.width = `${width}px`;
        el.style.width = "100%";
        await resized(el);
        const heading = el.shadowRoot!.querySelector<HTMLElement>("[data-allergy-heading]")!;
        const box = heading.getBoundingClientRect();
        expect(Math.round(el.getBoundingClientRect().width)).toBe(width);
        expect(box.width).toBeGreaterThan(0);
        expect(box.right).toBeLessThanOrEqual(window.innerWidth + 1);
        expect(heading.textContent).toContain(t("allergy.banner"));
        expect(heading.textContent).toContain(t("allergy.change"));
        await expectNoA11yViolations(host);
        await page.screenshot({
          path: `../../__screenshots__/a669-table/heading-${locale}-${theme}-${width}.png`,
        });
      });
