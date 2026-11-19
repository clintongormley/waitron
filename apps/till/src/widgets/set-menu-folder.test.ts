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

it("asks the order to add the menu or pick the served offer and its version", async () => {
  const { el } = await mount();
  const added: unknown[] = [];
  const picked: unknown[] = [];
  el.addEventListener("add-set-menu", (event) => added.push((event as CustomEvent).detail));
  el.addEventListener("pick-set-menu-dish", (event) => picked.push((event as CustomEvent).detail));
  const buttons = [...(el.shadowRoot?.querySelectorAll("wt-button") ?? [])];
  expect(buttons.map((button) => button.textContent)).toHaveLength(4);
  await userEvent.click(buttons[0]!);
  await userEvent.click(buttons[2]!);
  expect(added).toEqual([{ setMenuId: "daily" }]);
  expect(picked).toEqual([{ setMenuId: "daily", offer: daily.offers[1], versionId: "lunch" }]);
});
