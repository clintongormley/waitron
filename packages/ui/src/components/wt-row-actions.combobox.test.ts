import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { html, render } from "lit";
import { cleanup, mount } from "../test-helpers.js";
import "./wt-button.js";
import "./wt-combobox.js";
import "./wt-dialog.js";
import "./wt-form-actions.js";
import "./wt-row-actions.js";
import type { WtCombobox } from "./wt-combobox.js";
import type { WtRowActions } from "./wt-row-actions.js";

afterEach(cleanup);

test("a boxed dropdown inside the menu sheet picks, then picks a held device and answers Take it? while the sheet stays open, and hide() closes it", async () => {
  const [width, height] = [innerWidth, innerHeight];
  await page.viewport(390, 844);
  try {
    const el = (await mount(
      `<wt-row-actions label="Devices" bottom-sheet sheet-variant="menu">
        <div data-keep-open>
          <wt-combobox variant="boxed" label="Card reader" search="never"></wt-combobox>
          <div class="confirm"></div>
        </div>
        <button>Done</button>
      </wt-row-actions>`,
    )) as WtRowActions;
    const combobox = el.querySelector<WtCombobox>("wt-combobox")!;
    combobox.options = [
      { value: "r2", label: "Reader 2" },
      { value: "r3", label: "Reader 3" },
    ];
    await combobox.updateComplete;
    const sheet = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
    const list = combobox.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
    // Built as the till's equipmentTakeover is, and placed where it must be: inside the
    // data-keep-open element, since one opened beside the sheet closes it.
    const confirm = el.querySelector<HTMLElement>(".confirm")!;
    const close = () => render(html``, confirm);
    combobox.addEventListener("wt-change", () => {
      if (combobox.value !== "r3") return;
      render(
        html`<wt-dialog .open=${true} .heading=${"Take it?"}>
          <p>Reader 3 is on another phone.</p>
          <wt-form-actions slot="footer">
            <wt-button slot="cancel" variant="secondary" @click=${close}>Cancel</wt-button>
            <wt-button data-take variant="primary" @click=${close}>Take</wt-button>
          </wt-form-actions>
        </wt-dialog>`,
        confirm,
      );
    });
    await userEvent.click(el.shadowRoot!.querySelector("button")!);

    for (const label of ["Reader 2", "Reader 3"]) {
      await userEvent.click(combobox.shadowRoot!.querySelector(".trigger")!);
      await expect.poll(() => list.matches(":popover-open")).toBe(true);
      const option = [...combobox.shadowRoot!.querySelectorAll('[role="option"]')].find((row) =>
        row.textContent?.includes(label),
      )!;
      await userEvent.click(option);
      await expect.poll(() => list.matches(":popover-open")).toBe(false);
      expect(sheet.matches(":popover-open")).toBe(true);
    }

    const take = confirm.querySelector<HTMLElement>("[data-take]")!;
    await expect.poll(() => take.checkVisibility()).toBe(true);
    expect(sheet.matches(":popover-open")).toBe(true);
    await userEvent.click(take);
    expect(confirm.querySelector("wt-dialog")).toBeNull();
    expect(sheet.matches(":popover-open")).toBe(true);
    expect(combobox.value).toBe("r3");

    el.hide();
    expect(sheet.matches(":popover-open")).toBe(false);
  } finally {
    await page.viewport(width, height);
  }
});
