import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import { useLocale } from "../testing/locale-setup.js";
import type { DashboardApi } from "../api/client.js";
import { wineDetails } from "./set-menu-dishes.test-fixture.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";

useLocale("en-GB");
afterEach(cleanupWidgets);

class SetMenuVariantsLeaveHost extends LitElement {
  readonly leave = new LeaveController(this);
  readonly api = {
    readSetMenu: vi.fn().mockResolvedValue(wineDetails),
    saveSetMenuVariantChoices: vi.fn(),
    updateMenuItem: vi.fn(),
  };

  override render() {
    return html`<dashboard-set-menu-editor
        .api=${this.api as unknown as DashboardApi}
        menuId="daily"
      ></dashboard-set-menu-editor>
      ${this.leave.render({
        heading: "Unsaved changes",
        message: "Leave without saving?",
        keepLabel: "Keep editing",
        discardLabel: "Discard",
      })}`;
  }
}
customElements.define("set-menu-variants-leave-test", SetMenuVariantsLeaveHost);

it("keeps variant choices on request and discards them without saving", async () => {
  const { el } = await mountWidget<SetMenuVariantsLeaveHost>("set-menu-variants-leave-test", {});
  const open = () => page.getByRole("button", { name: "Edit variants for Wine" }).click();
  const dialog = page.getByRole("dialog", { name: "Variants for Wine" });
  const confirmation = page.getByRole("dialog", { name: "Unsaved changes" });
  const bottle = page.getByRole("switch", { name: "Include Bottle" });
  await open();
  await expect.element(bottle).toBeChecked();
  (bottle.element() as HTMLInputElement).focus();
  await userEvent.keyboard(" ");
  await expect.element(bottle).not.toBeChecked();
  expect(el.leave.coordinator.isDirty()).toBe(true);
  await userEvent.keyboard("{Escape}");
  await expect.element(confirmation).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect.element(bottle).not.toBeChecked();
  await userEvent.keyboard("{Escape}");
  await page.getByRole("button", { name: "Discard" }).click();
  await expect.element(dialog).not.toBeInTheDocument();
  expect(el.api.saveSetMenuVariantChoices).not.toHaveBeenCalled();
  await open();
  await expect.element(bottle).toBeChecked();
});

it("keeps staged surcharges on request and restores them on Discard", async () => {
  const { el } = await mountWidget<SetMenuVariantsLeaveHost>("set-menu-variants-leave-test", {});
  const field = page.getByRole("textbox", { name: "Surcharge for Wine" });
  await field.fill("7.00");
  expect(el.leave.coordinator.isDirty()).toBe(true);
  const leave = () =>
    el.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed: () => {} });
  const staying = leave();
  await page.getByRole("button", { name: "Keep editing" }).click();
  expect(await staying).toBe("kept");
  await expect.element(field).toHaveValue("7.00");
  const leaving = leave();
  await page.getByRole("button", { name: "Discard" }).click();
  expect(await leaving).toBe("proceeded");
  await expect.element(field).toHaveValue("2.00");
  expect(el.api.updateMenuItem).not.toHaveBeenCalled();
});
