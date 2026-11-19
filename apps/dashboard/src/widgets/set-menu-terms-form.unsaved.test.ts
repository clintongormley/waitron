import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { useLocale } from "../testing/locale-setup.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "../screens/menus-screen.js";

useLocale("en-GB");
afterEach(cleanupWidgets);

const lines = [{ id: "first", count: 1, courseIds: ["starters"] }];
const courses = [{ id: "starters", name: "Starters" }];
const fixture = {
  id: "daily",
  name: "Daily menu",
  names: {},
  price: "14.00",
  vatClass: "reduced",
  takeawayVatClass: null,
};

class SetMenuLeaveHost extends LitElement {
  readonly leave = new LeaveController(this);
  creating = false;

  override render() {
    return html`<dashboard-set-menu-terms-form
        .creating=${this.creating}
        .value=${this.creating ? null : fixture}
      ></dashboard-set-menu-terms-form>
      <dashboard-set-menu-lines-form
        .lines=${lines}
        .courses=${courses}
      ></dashboard-set-menu-lines-form>
      ${this.leave.render({
        heading: "Unsaved changes",
        message: "Leave without saving?",
        keepLabel: "Keep editing",
        discardLabel: "Discard",
      })}`;
  }
}
customElements.define("set-menu-leave-test-host", SetMenuLeaveHost);

it.each([
  ["price", "dashboard-set-menu-terms-form", '[name="setPrice"]', "15.50"],
  ["line count", "dashboard-set-menu-lines-form", '[name="count"]', "2"],
] as const)(
  "asks before leaving a changed %s and keeps the edit when asked",
  async (_name, tag, selector, value) => {
    const { el } = await mountWidget<SetMenuLeaveHost>("set-menu-leave-test-host", {});
    const field = el
      .shadowRoot!.querySelector(tag)
      ?.shadowRoot?.querySelector<
        HTMLElementTagNameMap["wt-price-input"] | HTMLElementTagNameMap["wt-input"]
      >(selector);
    expect(field).toBeDefined();
    await field!.updateComplete;
    await userEvent.fill(page.elementLocator(field!.shadowRoot!.querySelector("input")!), value);
    const outcome = el.leave.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed() {},
    });
    await expect.element(page.getByRole("dialog", { name: "Unsaved changes" })).toBeVisible();
    await page.getByRole("button", { name: "Keep editing" }).click();
    expect(await outcome).toBe("kept");
    expect(field!.value).toBe(value);
  },
);

it("keeps the new set menu's draft when Escape is followed by Keep editing", async () => {
  await mountWidget<SetMenuLeaveHost>("set-menu-leave-test-host", { creating: true });
  const name = page.getByRole("textbox", { name: /^Name/ }).first();
  await name.fill("Daily menu");
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("dialog", { name: "Unsaved changes" })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect.element(name).toHaveValue("Daily menu");
});
