import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, mount } from "../test-helpers.js";
import "./wt-combobox.js";
import "./wt-row-actions.js";
import type { WtCombobox } from "./wt-combobox.js";
import type { WtRowActions } from "./wt-row-actions.js";

afterEach(cleanup);

test("a boxed dropdown inside the menu sheet picks twice while the sheet stays open, and hide() closes it", async () => {
  await page.viewport(390, 844);
  const el = (await mount(
    `<wt-row-actions label="Devices" bottom-sheet sheet-variant="menu">
      <div data-keep-open>
        <wt-combobox look="boxed" label="Card reader" search="never"></wt-combobox>
      </div>
      <button>Done</button>
    </wt-row-actions>`,
  )) as WtRowActions;
  const combobox = el.querySelector<WtCombobox>("wt-combobox")!;
  combobox.options = [
    { value: "r2", label: "Reader 2" },
    { value: "r3", label: "Reader 3" },
  ];
  combobox.value = "r2";
  const picks: string[] = [];
  combobox.addEventListener("wt-change", () => picks.push(combobox.value));
  await combobox.updateComplete;
  const sheet = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  const list = combobox.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  const trigger = combobox.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!;
  await userEvent.click(el.shadowRoot!.querySelector("button")!);
  expect(sheet.matches(":popover-open")).toBe(true);

  const pick = async (label: string) => {
    await userEvent.click(trigger);
    await expect.poll(() => list.matches(":popover-open")).toBe(true);
    expect(sheet.matches(":popover-open")).toBe(true);
    const row = [...combobox.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (option) => option.textContent?.includes(label),
    )!;
    await userEvent.click(row);
    await expect.poll(() => list.matches(":popover-open")).toBe(false);
    expect(sheet.matches(":popover-open")).toBe(true);
  };
  await pick("Reader 3");
  expect(combobox.value).toBe("r3");
  await pick("Reader 2");
  expect(combobox.value).toBe("r2");
  expect(picks).toEqual(["r3", "r2"]);

  el.hide();
  expect(sheet.matches(":popover-open")).toBe(false);
});
