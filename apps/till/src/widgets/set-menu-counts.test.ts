import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { bill, daily, seaBass, special } from "../../test/set-menu-widgets.js";

import { TillSetMenuCounts } from "./set-menu-counts.js";

afterEach(cleanupWidgets);

async function mount(saveCount: (id: string, count: number) => Promise<string | undefined>) {
  return mountWidget<TillSetMenuCounts>("till-set-menu-counts", {
    bill,
    onSale: [daily, { ...daily, menuId: "brunch", name: "Brunch" }],
    draft: [seaBass],
    saveCount,
  });
}

it("shows held set menus and those on sale without duplicating a type", async () => {
  const { el } = await mount(async () => undefined);
  expect(
    Array.from(el.shadowRoot?.querySelectorAll("wt-number-stepper") ?? [], ({ label, value }) => [
      label,
      value,
    ]),
  ).toEqual([
    ["Daily menu", "2"],
    ["Special menu", "1"],
    ["Brunch", "0"],
  ]);
});

it("sends plus immediately and restores the saved number beside a server refusal", async () => {
  const save = vi.fn(async () => "Wait for the other change to finish.");
  const { el } = await mount(save);
  const stepper = el.shadowRoot?.querySelector("wt-number-stepper");
  expect(stepper?.value).toBe("2");
  await userEvent.click(stepper!.shadowRoot!.querySelector('[data-step="1"]')!);
  expect(save).toHaveBeenCalledExactlyOnceWith(daily.menuId, 3);
  await vi.waitFor(() => {
    expect(stepper!.value).toBe("2");
    expect(stepper!.shadowRoot!.querySelector("[data-error]")?.textContent).toBe(
      "Wait for the other change to finish.",
    );
  });
});

it("keeps the only set menu the unsent sea bass fits without sending a removal", async () => {
  const save = vi.fn(async () => undefined);
  const { el } = await mount(save);
  const stepper = el.shadowRoot?.querySelectorAll("wt-number-stepper")[1];
  expect(stepper?.label).toBe(special.name);
  await userEvent.click(stepper!.shadowRoot!.querySelector('[data-step="-1"]')!);
  expect(save).not.toHaveBeenCalled();
  expect(stepper!.value).toBe("1");
  expect(stepper!.error).toContain("Only Special menu has a place for Sea bass");
});

it("previews removing the latest empty menu if two copies of that type are on the bill", async () => {
  const save = vi.fn(async () => undefined);
  const first = bill.copies[0]!;
  const later = { ...bill.copies[1]!, setMenuId: first.setMenuId, versionId: "new-lunch" };
  const { el } = await mountWidget<TillSetMenuCounts>("till-set-menu-counts", {
    bill: {
      ...bill,
      copies: [first, later],
      setMenus: [bill.setMenus[0]!, { ...bill.setMenus[1]!, copyId: later.id }],
      dishes: [],
    },
    draft: [seaBass],
    saveCount: save,
  });
  const stepper = el.shadowRoot!.querySelector("wt-number-stepper")!;
  expect(stepper.value).toBe("2");
  await userEvent.click(stepper.shadowRoot!.querySelector('[data-step="-1"]')!);
  expect(save).not.toHaveBeenCalled();
  expect(stepper.error).toContain("Sea bass");
});

it.each(["before", "after"] as const)(
  "keeps a refreshed count clear of a refusal arriving %s the refresh",
  async (arrival) => {
    const refusal = Promise.withResolvers<string>();
    const { el } = await mount(() => refusal.promise);
    const stepper = el.shadowRoot!.querySelector("wt-number-stepper")!;
    await userEvent.click(stepper.shadowRoot!.querySelector('[data-step="1"]')!);
    const message = "The bill changed before the count was saved.";
    if (arrival === "before") {
      refusal.resolve(message);
      await vi.waitFor(() => expect(stepper.error).toBe(message));
    }
    el.bill = {
      ...bill,
      setMenus: [...bill.setMenus, { lineId: "daily-3", lineNo: 4, copyId: daily.key }],
    };
    await el.updateComplete;
    if (arrival === "after") {
      expect(stepper.disabled).toBe(true);
      refusal.resolve(message);
      await vi.waitFor(() => expect(stepper.disabled).toBe(false));
    }
    expect(stepper.value).toBe("3");
    expect(stepper.error).toBe("");
  },
);
