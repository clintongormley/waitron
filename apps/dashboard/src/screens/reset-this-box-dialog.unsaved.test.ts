import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import type { DashboardApi } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { ResetThisBoxDialog } from "./reset-this-box-dialog.js";
import "./reset-this-box-dialog.js";

const locale = currentLocale();
beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

async function mount(
  sendsReset = vi.fn<DashboardApi["resetThisBox"]>(),
  canExportConfiguration = false,
) {
  const { el } = await mountWidget<ResetThisBoxDialog>("dashboard-reset-this-box-dialog", {
    api: { resetThisBox: sendsReset },
    canExportConfiguration,
  });
  const root = el.shadowRoot!;
  const dialog = root.querySelector("wt-dialog")!;
  const field = root.querySelector("wt-input")!;
  const confirm = root.querySelector<HTMLElementTagNameMap["wt-button"]>("wt-button:not([slot])")!;
  await expect.poll(() => dialog.shadowRoot!.querySelector(":modal")).not.toBeNull();
  return { el, root, field, confirm, sendsReset };
}

it("keeps Reset disabled while the word differs and allows the exact word", async () => {
  const { field, confirm } = await mount();
  const input = page.elementLocator(field.shadowRoot!.querySelector("input")!);
  await input.fill("Reset");
  expect(confirm.disabled).toBe(true);
  await input.fill("reset");
  expect(confirm.disabled).toBe(false);
});

it("stops after typing without requesting a reset", async () => {
  const { el, root, field, sendsReset } = await mount();
  expect(root.querySelector('a[href="/backup"]')).toBeNull();
  await page.elementLocator(field.shadowRoot!.querySelector("input")!).fill("reset");
  const closed = new Promise((resolve) => el.addEventListener("wt-close", resolve, { once: true }));
  await userEvent.click(root.querySelector('wt-button[slot="cancel"]')!);
  await closed;
  expect(sendsReset).not.toHaveBeenCalled();
});

it("leaves a refused reset in the dialog with the reason and lets the operator try again", async () => {
  const send = vi.fn<DashboardApi["resetThisBox"]>().mockRejectedValue({
    code: "membership.self_reset_unavailable",
    params: { reason: "remove_other_boxes" },
  });
  const { root, field, confirm } = await mount(send, true);
  expect(root.querySelector('a[href="/backup"]')).not.toBeNull();
  await page.elementLocator(field.shadowRoot!.querySelector("input")!).fill("reset");
  await userEvent.click(confirm);
  await vi.waitFor(async () => {
    const message = await formMessageOf(root.querySelector("wt-form-actions")!);
    expect(message?.textContent).toContain("Remove the other boxes");
    expect(confirm.disabled).toBe(false);
  });
});
