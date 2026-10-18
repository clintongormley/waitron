import { afterEach, beforeEach, expect, it } from "vitest";
import { decimal, formatMoney } from "@waitron/shared";
import { DraftStore } from "../state/draft-sync.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { beer, mount, resized } from "./till-table-order-screen.test-helpers.js";
import {
  storedDish,
  storedExtra,
  storedServed,
} from "./till-table-order-screen.sent-fallback.test-helpers.js";

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

const stored = [storedDish, storedExtra, storedServed];
const fresh = {
  product: beer,
  quantity: "2",
  extras: [{ listId: "extras", productId: "sauce", name: "Sauce", quantity: 1, price: "0.25" }],
};
const recalled = {
  product: { ...beer, unitPrice: "999.00" },
  quantity: "2.000",
  noMerge: true as const,
  source: { line: storedDish, extras: [storedExtra], netAmount: "8.00" },
};

it.each(["en", "es"] as const)(
  "shows the stored amount plus fresh unsent dishes and extras, counting recalled food once (%s)",
  async (locale) => {
    setLocale(locale);
    const draft = new DraftStore();
    draft.appendLines([fresh, recalled]);
    const { el } = await mount({ lines: stored, draftStore: draft });
    el.style.width = "1280px";
    await resized(el);
    const total = el.shadowRoot!.querySelector<HTMLElement>("[data-order-total]");
    expect(total, "the panel has a total without opening the drawer").not.toBeNull();
    expect(total!.checkVisibility()).toBe(true);
    expect(total!.textContent!.trim()).toBe(formatMoney(decimal("16.50"), locale));
    draft.clear();
    await el.updateComplete;
    expect(total!.textContent!.trim()).toBe(formatMoney(decimal("10.00"), locale));
    el.lines = [storedServed];
    await el.updateComplete;
    expect(total!.textContent!.trim()).toBe(formatMoney(decimal("2.00"), locale));
  },
);

it("includes a colleague's saved fresh food and counts their recalled food once", async () => {
  const draft = new DraftStore();
  draft.lockEdits();
  const { el } = await mount({
    lines: stored,
    draftStore: draft,
    otherDrafts: [
      { id: "other", revision: 2, ownerName: "Ana", takenFromYou: false, lines: [fresh, recalled] },
    ],
  });
  const total = el.shadowRoot!.querySelector("[data-order-total]");
  expect(total).not.toBeNull();
  expect(total!.textContent!.trim()).toBe("€16.50");
  el.otherDrafts = [];
  await el.updateComplete;
  expect(total!.textContent!.trim()).toBe("€10.00");
});

it("shows an empty bill's zero total and its first unsent estimate", async () => {
  const draft = new DraftStore();
  const { el } = await mount({ draftStore: draft });
  const total = el.shadowRoot!.querySelector("[data-order-total]");
  expect(total).not.toBeNull();
  expect(total!.textContent!.trim()).toBe("€0.00");
  draft.appendLines([fresh]);
  await el.updateComplete;
  expect(total!.textContent!.trim()).toBe("€6.50");
});

it("keeps the separate local recovery candidate out of the displayed bill amount", async () => {
  const { el } = await mount({
    lines: stored,
    retainedDraft: {
      personId: "me",
      partyId: "party",
      billId: "wo-4",
      base: { billId: "wo-4", editorVersion: 2, draftId: "draft", draftRevision: 3 },
      localGeneration: 4,
      lines: [fresh],
    },
  });
  const total = el.shadowRoot!.querySelector("[data-order-total]");
  expect(total).not.toBeNull();
  expect(total!.textContent!.trim()).toBe("€10.00");
  expect(el.shadowRoot!.querySelectorAll("[data-candidate-line]")).toHaveLength(1);
});
