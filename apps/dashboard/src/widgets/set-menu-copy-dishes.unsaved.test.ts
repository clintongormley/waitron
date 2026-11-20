import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import { useLocale } from "../testing/locale-setup.js";
import type { DashboardApi } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./set-menu-copy-dishes.js";

useLocale("en-GB");
afterEach(cleanupWidgets);

const daily = {
  id: "daily",
  name: "Daily menu",
  kind: "set_menu",
  active: true,
  setPrice: "14.00",
  setVatClass: "reduced",
};
const special = { ...daily, id: "special", name: "Special menu", setPrice: "20.00" };

class CopyLeaveHost extends LitElement {
  readonly leave = new LeaveController(this);
  readonly api = {
    listMenus: vi.fn().mockResolvedValue([daily, special]),
    copySetMenuDishes: vi.fn(),
  };
  closed = 0;

  override render() {
    return html`<dashboard-set-menu-copy-dishes
        .api=${this.api as unknown as DashboardApi}
        menuId="daily"
        @set-menu-dish-dialog-closed=${() => this.closed++}
      ></dashboard-set-menu-copy-dishes>
      ${this.leave.render({
        heading: "Unsaved changes",
        message: "Leave without saving?",
        keepLabel: "Keep editing",
        discardLabel: "Discard",
      })}`;
  }
}
customElements.define("set-menu-copy-leave-test", CopyLeaveHost);

it("asks before Escape drops a chosen set menu, and Cancel puts the choice back and closes", async () => {
  const { el } = await mountWidget<CopyLeaveHost>("set-menu-copy-leave-test", {});
  const copy = el.shadowRoot!.querySelector("dashboard-set-menu-copy-dishes")!;
  const confirmation = page.getByRole("dialog", { name: "Unsaved changes" });
  await page.getByRole("combobox", { name: /^Set menu/ }).click();
  await page.getByRole("option", { name: "Special menu" }).click();
  await userEvent.keyboard("{Escape}");
  await expect.element(confirmation).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect.element(confirmation).not.toBeInTheDocument();
  await expect
    .element(page.getByRole("combobox", { name: /^Set menu.*Special menu/ }))
    .toBeVisible();
  expect(el.closed).toBe(0);

  const closed = new Promise((resolve) =>
    copy.addEventListener("set-menu-dish-dialog-closed", resolve, { once: true }),
  );
  await page.getByRole("button", { name: "Cancel" }).click();
  await closed;
  expect(el.closed).toBe(1);
  expect(confirmation.elements()).toHaveLength(0);
  expect(copy.shadowRoot!.querySelector("wt-combobox")!.value).toBe("");
  expect(el.api.copySetMenuDishes).not.toHaveBeenCalled();
});
