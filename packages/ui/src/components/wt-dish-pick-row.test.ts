import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, host, mount } from "../test-helpers.js";

import "./wt-dish-pick-row.js";

afterEach(cleanup);

const rowHtml =
  '<wt-dish-pick-row label="Croquetas" name="dish" quantity="3" amount="€12.00" ' +
  'description="With garlic mayonnaise"></wt-dish-pick-row>';

test("a partly selected row can be selected in full from the keyboard", async () => {
  const row = (await mount(rowHtml)) as HTMLElementTagNameMap["wt-dish-pick-row"];
  row.indeterminate = true;
  row.style.setProperty("--wt-color-primary", "rgb(45, 55, 65)");
  await row.updateComplete;
  const checkbox = page.getByRole("checkbox", { name: "3 Croquetas", exact: true });
  const input = checkbox.element() as HTMLInputElement;
  expect(input.indeterminate).toBe(true);
  const mark = row.shadowRoot!.querySelector('[part="mark"]')!;
  expect(getComputedStyle(mark).gridTemplateRows.split(" ")).toHaveLength(1);
  expect(getComputedStyle(mark, "::before").borderBlockStartColor).toBe("rgb(45, 55, 65)");
  expect(input.name).toBe("dish");
  const seen: boolean[] = [];
  host.addEventListener("wt-change", (event) =>
    seen.push((event as CustomEvent<{ checked: boolean }>).detail.checked),
  );

  input.focus();
  await userEvent.keyboard(" ");
  expect(input.checked).toBe(true);
  expect(input.indeterminate).toBe(false);
  expect(seen).toEqual([true]);

  await checkbox.click();
  expect(input.checked).toBe(false);
  expect(seen).toEqual([true, false]);
});

test("a selected row paints its surfaces and text from tokens", async () => {
  const row = (await mount(rowHtml)) as HTMLElementTagNameMap["wt-dish-pick-row"];
  row.checked = true;
  row.style.setProperty("--wt-color-surface-lifted", "rgb(15, 25, 35)");
  row.style.setProperty("--wt-color-primary", "rgb(45, 55, 65)");
  row.style.setProperty("--wt-color-on-primary", "rgb(75, 85, 95)");
  row.style.setProperty("--wt-color-text-muted", "rgb(105, 115, 125)");
  await row.updateComplete;

  const label = row.shadowRoot!.querySelector("label")!;
  const mark = row.shadowRoot!.querySelector('[part="mark"]')!;
  const description = row.shadowRoot!.querySelector('[part="description"]')!;
  expect(getComputedStyle(label).backgroundColor).toBe("rgb(15, 25, 35)");
  expect(getComputedStyle(mark).backgroundColor).toBe("rgb(45, 55, 65)");
  expect(getComputedStyle(mark.querySelector("wt-icon")!).color).toBe("rgb(75, 85, 95)");
  expect(getComputedStyle(description).color).toBe("rgb(105, 115, 125)");
  const name = row.shadowRoot!.querySelector("#dish-label")!;
  expect(description.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    name.getBoundingClientRect().bottom,
  );
});
