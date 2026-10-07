import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { DashboardApi } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./staff-screen.js";

registerIcons(DASHBOARD_ICONS);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
class StaffCreateApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-staff-screen .api=${this.api}></dashboard-staff-screen
      >${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("staff-create-leave-test-app", StaffCreateApp);
async function mount(api: Partial<DashboardApi>) {
  setLocale("en-GB");
  const { el: app } = await mountWidget<StaffCreateApp>("staff-create-leave-test-app", {
    api: api as DashboardApi,
  });
  const screen = app.shadowRoot!.querySelector("dashboard-staff-screen")!;
  await screen.updateComplete;
  screen.shadowRoot!.querySelector<HTMLElement>(".header [data-test=add]")!.click();
  await screen.updateComplete;
  const form = screen.shadowRoot!.querySelector("dashboard-person-form")!;
  await form.updateComplete;
  for (const [name, value] of [
    ["first-names", "Ada"],
    ["last-names", "Lovelace"],
    ["display-name", "Ada"],
    ["email", "ada@example.com"],
  ]) {
    const field = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      `[data-test=${name}]`,
    )!;
    await field.updateComplete;
    await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  }
  await form.updateComplete;
  return { app, screen, form };
}
it("staff creation commits before a refused list refresh and clears the saved inputs", async () => {
  let dirtyAtRefresh: boolean | undefined;
  let reads = 0;
  const mounted = await mount({
    listStaff: async () => {
      if (++reads === 1) return [];
      dirtyAtRefresh = app.leave.coordinator.isDirty();
      throw { code: "connection.failed" };
    },
    createPerson: async () => ({ id: "p3", invitationSent: true }),
  });
  const app = mounted.app;
  const { screen, form } = mounted;
  expect(app.leave.coordinator.isDirty()).toBe(true);
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
  await expect.poll(() => dirtyAtRefresh).toBe(false);
  await expect.poll(() => form.open).toBe(false);
  expect(screen.shadowRoot!.querySelector(".error")!.textContent).toContain(
    codeMessage("connection.failed"),
  );
  screen.shadowRoot!.querySelector<HTMLElement>(".header [data-test=add]")!.click();
  await screen.updateComplete;
  await form.updateComplete;
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=email]")!.value,
  ).toBe("");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("a pending staff write blocks close, then a refusal retains the same details for Keep", async () => {
  let refuse!: (e: unknown) => void;
  const { app, screen, form } = await mount({
    listStaff: async () => [],
    createPerson: () =>
      new Promise((_, reject) => {
        refuse = reject;
      }),
  });
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
  await screen.updateComplete;
  await form.updateComplete;
  expect(form.busy).toBe(true);
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
  await app.updateComplete;
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(form.open).toBe(true);
  refuse({ code: "connection.failed" });
  await expect.poll(() => form.busy).toBe(false);
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  expect(q.open).toBe(true);
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=email]")!.value,
  ).toBe("ada@example.com");
});
it("a delivered field change during staff creation survives the submitted-value commit", async () => {
  let finish!: (value: { id: string; invitationSent: boolean }) => void;
  const { app, screen, form } = await mount({
    listStaff: async () => [],
    createPerson: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
  await screen.updateComplete;
  await form.updateComplete;
  form
    .shadowRoot!.querySelector("[data-test=telephone]")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "+44 20" } }));
  finish({ id: "p3", invitationSent: true });
  await expect.poll(() => form.busy).toBe(false);
  expect(form.open).toBe(true);
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=telephone]")!
      .value,
  ).toBe("+44 20");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!.click();
  await expect.poll(() => q.open).toBe(false);
  form
    .shadowRoot!.querySelector("[data-test=telephone]")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "" } }));
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
