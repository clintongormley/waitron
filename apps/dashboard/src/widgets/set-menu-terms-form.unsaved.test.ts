import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { DashboardApi } from "../api/client.js";
import { useLocale } from "../testing/locale-setup.js";
import { cleanupWidgets, dialogClosed, mountWidget, putBack } from "./test-helpers.js";
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
  api?: DashboardApi;

  override render() {
    return html`<dashboard-set-menu-terms-form
        .api=${this.api}
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

it("keeps the new set menu dialog open on Escape while it is being created, then closes once it is", async () => {
  let finish!: (row: { id: string }) => void;
  const createMenu = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { el } = await mountWidget<SetMenuLeaveHost>("set-menu-leave-test-host", {
    creating: true,
    api: { createMenu } as unknown as DashboardApi,
  });
  const form = el.shadowRoot!.querySelector("dashboard-set-menu-terms-form")!;
  const modal = form.shadowRoot!.querySelector("wt-modal")!;
  const events: string[] = [];
  form.addEventListener("set-menu-terms-saved", () => events.push("saved"));
  form.addEventListener("set-menu-terms-cancelled", () => events.push("cancelled"));
  const dialog = page.getByRole("dialog", { name: "Add set menu" });
  await page.getByRole("textbox", { name: /^Name/ }).first().fill("Daily lunch");
  await page.getByRole("textbox", { name: /^Price per set menu/ }).fill("15.00");
  await page.elementLocator(form.shadowRoot!.querySelector("[data-test=save]")!).click();
  await vi.waitFor(() => expect(createMenu).toHaveBeenCalledOnce());

  const requestClose = vi.spyOn(modal, "requestClose");
  await userEvent.keyboard("{Escape}");
  expect(requestClose).toHaveBeenCalledExactlyOnceWith("escape");
  await expect(requestClose.mock.results[0]!.value).resolves.toBe(false);
  await expect.element(dialog).toBeVisible();
  expect(page.getByRole("dialog", { name: "Unsaved changes" }).elements()).toHaveLength(0);
  expect(events).toEqual([]);

  const closed = dialogClosed(modal);
  finish({ id: "daily" });
  await closed;
  expect(events).toEqual(["saved"]);
  expect(createMenu).toHaveBeenCalledOnce();
  await expect.element(dialog).not.toBeInTheDocument();
});

it("does not ask about unsaved changes when a close is asked for as Save is pressed", async () => {
  let finish!: (row: { id: string }) => void;
  const createMenu = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { el } = await mountWidget<SetMenuLeaveHost>("set-menu-leave-test-host", {
    creating: true,
    api: { createMenu } as unknown as DashboardApi,
  });
  const form = el.shadowRoot!.querySelector("dashboard-set-menu-terms-form")!;
  const modal = form.shadowRoot!.querySelector("wt-modal")!;
  const events: string[] = [];
  form.addEventListener("set-menu-terms-saved", () => events.push("saved"));
  form.addEventListener("set-menu-terms-cancelled", () => events.push("cancelled"));
  const dialog = page.getByRole("dialog", { name: "Add set menu" });
  await page.getByRole("textbox", { name: /^Name/ }).first().fill("Daily lunch");
  await page.getByRole("textbox", { name: /^Price per set menu/ }).fill("15.00");
  const save =
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!;
  await expect.element(page.elementLocator(save)).toBeEnabled();

  save.click();
  const close = modal.requestClose("escape");
  expect(createMenu).toHaveBeenCalledOnce();
  await expect(close).resolves.toBe(false);
  expect(page.getByRole("dialog", { name: "Unsaved changes" }).elements()).toHaveLength(0);
  await expect.element(dialog).toBeVisible();

  const closed = dialogClosed(modal);
  finish({ id: "daily" });
  await closed;
  expect(events).toEqual(["saved"]);
  expect(createMenu).toHaveBeenCalledOnce();
});

it.each([
  ["price", "dashboard-set-menu-terms-form", '[name="setPrice"]', "15.50", "14.00"],
  ["line count", "dashboard-set-menu-lines-form", '[name="count"]', "2", "1"],
] as const)(
  "puts back the saved %s when leaving discards the edit",
  async (_name, tag, selector, value, saved) => {
    const { el } = await mountWidget<SetMenuLeaveHost>("set-menu-leave-test-host", {});
    const form = el.shadowRoot!.querySelector(tag)!;
    const field = form.shadowRoot!.querySelector<
      HTMLElementTagNameMap["wt-price-input"] | HTMLElementTagNameMap["wt-input"]
    >(selector)!;
    await field.updateComplete;
    await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
    const outcome = el.leave.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed() {},
    });
    await expect.element(page.getByRole("dialog", { name: "Unsaved changes" })).toBeVisible();
    await page.getByRole("button", { name: "Discard" }).click();
    expect(await outcome).toBe("proceeded");
    await expect
      .element(page.elementLocator(field.shadowRoot!.querySelector("input")!))
      .toHaveValue(tag === "dashboard-set-menu-lines-form" ? Number(saved) : saved);
    expect(
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!
        .disabled,
    ).toBe(true);
  },
);

it("still asks, and Discard still puts back the saved price, after the edited form is moved", async () => {
  const { el } = await mountWidget<SetMenuLeaveHost>("set-menu-leave-test-host", {});
  const form = el.shadowRoot!.querySelector("dashboard-set-menu-terms-form")!;
  const price = form.shadowRoot!.querySelector("wt-price-input")!;
  await price.updateComplete;
  const input = page.elementLocator(price.shadowRoot!.querySelector("input")!);
  await userEvent.fill(input, "15.50");
  await putBack(form, "at once");

  const outcome = el.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {},
  });
  await expect.element(page.getByRole("dialog", { name: "Unsaved changes" })).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();
  expect(await outcome).toBe("proceeded");
  await expect.element(input).toHaveValue("14.00");
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!
      .disabled,
  ).toBe(true);
});
