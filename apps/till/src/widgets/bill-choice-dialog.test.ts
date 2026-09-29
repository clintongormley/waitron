import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./bill-choice-dialog.js";
import type { BillChoiceDetail, TillBillChoiceDialog } from "./bill-choice-dialog.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

const scope = "Ana (Mesa 4) joins Luis (Mesa 7)";

async function mountDialog(): Promise<TillBillChoiceDialog> {
  const { el } = await mountWidget<TillBillChoiceDialog>("till-bill-choice-dialog", { scope });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return el;
}

const button = (el: TillBillChoiceDialog, name: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-bills-${name}]`)!;

function captured(el: TillBillChoiceDialog) {
  const seen: { chose: BillChoiceDetail[]; cancelled: number } = { chose: [], cancelled: 0 };
  el.addEventListener("bill-choice-confirm", (event) =>
    seen.chose.push((event as CustomEvent<BillChoiceDetail>).detail),
  );
  el.addEventListener("bill-choice-cancel", () => (seen.cancelled += 1));
  return seen;
}

describe("till-bill-choice-dialog", () => {
  it("states what happens to the parties before anything is chosen", async () => {
    const el = await mountDialog();

    expect(el.shadowRoot!.querySelector("wt-dialog")!.heading).toBe(scope);
    expect(button(el, "merge").textContent!.trim()).toBe(t("table.bills_merge"));
    expect(button(el, "separate").textContent!.trim()).toBe(t("table.bills_separate"));
  });

  it("has Merge the bills focused, so it is the default", async () => {
    const el = await mountDialog();

    expect(el.shadowRoot!.activeElement).toBe(button(el, "merge"));
  });

  it("reports each choice, and a cancel without a choice", async () => {
    const el = await mountDialog();
    const seen = captured(el);

    button(el, "merge").click();
    button(el, "separate").click();
    button(el, "cancel").click();

    expect(seen.chose).toEqual([{ bills: "merge" }, { bills: "separate" }]);
    expect(seen.cancelled).toBe(1);
  });

  it("cancels on Escape without a choice", async () => {
    const el = await mountDialog();
    const seen = captured(el);

    await userEvent.keyboard("{Escape}");

    await vi.waitFor(() => expect(seen.cancelled).toBe(1));
    expect(seen.chose).toEqual([]);
  });

  it("wraps a long scope inside the dialog on a 390px phone", async () => {
    await page.viewport(390, 844);
    try {
      const { el } = await mountWidget<TillBillChoiceDialog>("till-bill-choice-dialog", {
        scope: "Ana y los de la boda (Mesa 4, 5, 6, 7) joins Luis y compañía (Terraza 12)",
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(window.innerWidth).toBe(390);
      const dialog = el.shadowRoot!.querySelector("wt-dialog")!.shadowRoot!;
      const box = dialog.querySelector("dialog")!.getBoundingClientRect();
      const heading = dialog.querySelector("h2")!;
      expect(box.right).toBeLessThanOrEqual(390);
      expect(heading.scrollWidth).toBeLessThanOrEqual(heading.clientWidth);
      for (const name of ["cancel", "separate", "merge"])
        expect(button(el, name).getBoundingClientRect().right).toBeLessThanOrEqual(box.right);
    } finally {
      await page.viewport(414, 896);
    }
  });
});
