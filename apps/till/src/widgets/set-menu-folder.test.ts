import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { courses, daily } from "../../test/set-menu-widgets.js";

import { TillSetMenuFolder } from "./set-menu-folder.js";

afterEach(cleanupWidgets);

async function mount() {
  return mountWidget<TillSetMenuFolder>("till-set-menu-folder", {
    copy: daily,
    versionId: "lunch",
    courseNames: courses,
  });
}

it("lists each portion dish under its first matching heading with its set-menu price", async () => {
  const { el } = await mount();
  const groups = Array.from(el.shadowRoot?.querySelectorAll("section") ?? [], (section) => [
    section.querySelector("h3")!.textContent!.trim(),
    Array.from(section.querySelectorAll("wt-button"), (button) =>
      button.textContent!.replace(/\s+/g, " ").trim(),
    ),
  ]);
  expect(groups).toEqual([
    ["2 × Starter", ["Soup Included"]],
    ["Main or Starter", ["Sirloin +€5.00"]],
    ["Drink", ["Water Included · Sold out"]],
  ]);
  expect(el.shadowRoot!.querySelector("wt-button[disabled]")!.textContent).toContain("Water");
});

it("draws no button to add a set menu and asks the order to pick the served offer", async () => {
  const { el } = await mount();
  const picked: unknown[] = [];
  el.addEventListener("pick-set-menu-dish", (event) => picked.push((event as CustomEvent).detail));
  const buttons = [...(el.shadowRoot?.querySelectorAll("wt-button") ?? [])];
  expect(buttons.map((button) => button.textContent!.replace(/\s+/g, " ").trim())).toEqual([
    "Soup Included",
    "Sirloin +€5.00",
    "Water Included · Sold out",
  ]);
  await userEvent.click(buttons[1]!);
  expect(picked).toEqual([{ setMenuId: "daily", offer: daily.offers[1], versionId: "lunch" }]);
});

it("uses a listed variant's course and surcharge when a dish is sold as a variant", async () => {
  const base = daily.offers[0]!;
  const glass = {
    ...base,
    id: "glass",
    name: "Glass",
    unitPrice: "2.00",
    menuPrice: null,
    pricingUnit: "each" as const,
  };
  const wine = {
    ...base,
    name: "Wine",
    unitPrice: "12.00",
    countsAsCourseId: null,
    variants: [glass],
    variantCountsAs: { glass: "drink" },
  };
  const { el } = await mountWidget<TillSetMenuFolder>("till-set-menu-folder", {
    copy: { ...daily, offers: [wine] },
    courseNames: courses,
    versionId: "lunch",
  });
  const drink = el.shadowRoot!.querySelectorAll("section")[2]!;
  expect(drink.querySelector("h3")!.textContent!.trim()).toBe("Drink");
  expect(drink.querySelector("wt-button")?.textContent?.replace(/\s+/g, " ").trim()).toBe(
    "Wine +€2.00",
  );
});
