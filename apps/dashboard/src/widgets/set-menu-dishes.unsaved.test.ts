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
