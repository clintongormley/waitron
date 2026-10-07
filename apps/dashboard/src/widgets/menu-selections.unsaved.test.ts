import { afterEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { page, userEvent } from "vitest/browser";
import { LeaveController, registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { t } from "../i18n/t.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "./test-helpers.js";
import "./add-to-menus.js";
import "./section-add-products.js";
import type { LeaveReason } from "@waitron/ui";
registerIcons(DASHBOARD_ICONS);
class MenuSelectionLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  open = true;
  cancelled = 0;
  submitted: string[][] = [];
  override render() {
    return html`<dashboard-add-to-menus
        .open=${this.open}
        productName="Soup"
        .menus=${[{ id: "menu", name: "Dinner", rootSectionId: "root", sections: [{ id: "starter", name: "Starters", sharedWith: [], children: [] }] }]}
        @wt-cancel=${() => {
          this.cancelled++;
          this.open = false;
          this.requestUpdate();
        }}
        @wt-submit=${(event: CustomEvent<{ sectionIds: string[] }>) => this.submitted.push(event.detail.sectionIds)}
      ></dashboard-add-to-menus
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("menu-selection-leave-test-app", MenuSelectionLeaveApp);
afterEach(cleanupWidgets);
async function mount() {
  const { el: app } = await mountWidget<MenuSelectionLeaveApp>("menu-selection-leave-test-app", {});
  const form = app.shadowRoot!.querySelector("dashboard-add-to-menus")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return { app, form };
}
async function toggle(form: HTMLElementTagNameMap["dashboard-add-to-menus"], id: string) {
  form.shadowRoot!.querySelector<HTMLInputElement>(`input[value="${id}"]`)!.click();
  await form.updateComplete;
}
async function question(app: MenuSelectionLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
function cancel(form: HTMLElement) {
  (form.shadowRoot!.querySelector<HTMLElement>("[data-test=skip]") ??
    form.querySelector<HTMLElement>("[data-test=cancel]"))!.click();
}
for (const route of ["cancel", "escape"] as const) {
  it(`Add to menus ${route} keeps selected sections and discards once`, async () => {
    const { app, form } = await mount();
    await toggle(form, "starter");
    if (route === "cancel") cancel(form);
    else await userEvent.keyboard("{Escape}");
    const q = await question(app);
    expect(q.open).toBe(true);
    expect(app.cancelled).toBe(0);
    expect(
      form.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector("dialog")!.open,
    ).toBe(true);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => q.open).toBe(false);
    await closeReportsDelivered();
    expect(
      form.shadowRoot!.querySelector<HTMLInputElement>('input[value="starter"]')!.checked,
    ).toBe(true);
    cancel(form);
    await question(app);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => app.cancelled).toBe(1);
    await closeReportsDelivered();
    expect(app.cancelled).toBe(1);
    expect(app.leave.coordinator.isDirty()).toBe(false);
  });
}
it("Add to menus selection installs unload protection and reverting closes directly", async () => {
  const { app, form } = await mount();
  expect(app.leave.coordinator.isDirty()).toBe(false);
  await toggle(form, "root");
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  await toggle(form, "root");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  cancel(form);
  await expect.poll(() => app.cancelled).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("Add to menus refused choices remain dirty and busy Escape does not dismiss", async () => {
  const { app, form } = await mount();
  await toggle(form, "root");
  await toggle(form, "starter");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=add-to-menus]")!.click();
  expect(app.submitted).toEqual([["root", "starter"]]);
  form.busy = true;
  await form.updateComplete;
  await userEvent.keyboard("{Escape}");
  expect((await question(app)).open).toBe(false);
  expect(app.cancelled).toBe(0);
  form.busy = false;
  form.failures = [{ sectionId: "starter", reason: "Refused" }];
  await form.updateComplete;
  cancel(form);
  expect((await question(app)).open).toBe(true);
  expect(form.shadowRoot!.querySelector<HTMLInputElement>('input[value="starter"]')!.checked).toBe(
    true,
  );
});

it("accepted placements clear only successful destinations before a failed retry", async () => {
  const { app, form } = await mount();
  await toggle(form, "root");
  await toggle(form, "starter");
  const commit = (form as typeof form & { commitAdded?: (ids: string[]) => void }).commitAdded;
  commit?.call(form, ["root"]);
  await form.updateComplete;
  expect(form.shadowRoot!.querySelector<HTMLInputElement>('input[value="root"]')!.checked).toBe(
    false,
  );
  expect(form.shadowRoot!.querySelector<HTMLInputElement>('input[value="starter"]')!.checked).toBe(
    true,
  );
  expect(app.leave.coordinator.isDirty()).toBe(true);
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=add-to-menus]")!.click();
  expect(app.submitted).toEqual([["starter"]]);
  commit?.call(form, ["starter"]);
  await form.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(false);
  cancel(form);
  await expect.poll(() => app.cancelled).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("placement menu refresh and ordering leave a retained selection intact", async () => {
  const { app, form } = await mount();
  await toggle(form, "starter");
  form.menus = [
    {
      id: "menu",
      name: "New dinner name",
      rootSectionId: "root",
      sections: [{ id: "starter", name: "New starters name", sharedWith: [], children: [] }],
    },
  ];
  await form.updateComplete;
  cancel(form);
  expect((await question(app)).open).toBe(true);
  expect(form.shadowRoot!.querySelector<HTMLInputElement>('input[value="starter"]')!.checked).toBe(
    true,
  );
});

class SectionSelectionLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  open = true;
  cancelled = 0;
  submitted: string[][] = [];
  beforeClose = async (reason: LeaveReason) =>
    (await this.leave.coordinator.request({
      scopes: [this.shadowRoot!.querySelector("dashboard-section-add-products")!],
      reason,
      proceed() {},
    })) === "proceeded";
  override render() {
    return html`<wt-modal
        .open=${this.open}
        .beforeClose=${this.beforeClose}
        heading="Add products"
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          this.cancelled++;
          this.open = false;
          this.requestUpdate();
        }}
      >
        <dashboard-section-add-products
          .products=${[
            { id: "soup", name: "Soup", categoryId: null },
            { id: "bread", name: "Bread", categoryId: null },
          ]}
          @wt-add-products=${(event: CustomEvent<{ productIds: string[] }>) => this.submitted.push(event.detail.productIds)}
        >
          <wt-button
            slot="cancel"
            data-test="cancel"
            @click=${() => void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel")}
            >Cancel</wt-button
          >
        </dashboard-section-add-products></wt-modal
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("section-selection-leave-test-app", SectionSelectionLeaveApp);
async function mountSection() {
  const { el: app } = await mountWidget<SectionSelectionLeaveApp>(
    "section-selection-leave-test-app",
    {},
  );
  const form = app.shadowRoot!.querySelector("dashboard-section-add-products")!;
  await form.updateComplete;
  await app.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return { app, form };
}
async function selectProduct(
  form: HTMLElementTagNameMap["dashboard-section-add-products"],
  id: string,
) {
  form.shadowRoot!.querySelector<HTMLInputElement>(`input[value="${id}"]`)!.click();
  await form.updateComplete;
}
async function sectionQuestion(app: SectionSelectionLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
for (const route of ["cancel", "escape"] as const) {
  it(`Section Add products ${route} preserves hidden picks through Keep and Discard`, async () => {
    const { app, form } = await mountSection();
    await selectProduct(form, "soup");
    const search =
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=search]")!;
    await search.updateComplete;
    await userEvent.fill(page.elementLocator(search.shadowRoot!.querySelector("input")!), "Bread");
    await form.updateComplete;
    expect(form.shadowRoot!.querySelector('input[value="soup"]')).toBeNull();
    if (route === "cancel") cancel(form);
    else await userEvent.keyboard("{Escape}");
    const q = await sectionQuestion(app);
    expect(q.open).toBe(true);
    expect(app.cancelled).toBe(0);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => q.open).toBe(false);
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=add]")!.click();
    expect(app.submitted).toEqual([["soup"]]);
    cancel(form);
    await sectionQuestion(app);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => app.cancelled).toBe(1);
    await closeReportsDelivered();
    expect(app.cancelled).toBe(1);
    expect(app.leave.coordinator.isDirty()).toBe(false);
  });
}
it("Section filters stay exempt while select-all and revert update unload protection", async () => {
  const { app, form } = await mountSection();
  const search =
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=search]")!;
  await search.updateComplete;
  await userEvent.fill(page.elementLocator(search.shadowRoot!.querySelector("input")!), "Soup");
  await form.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(false);
  form.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-listed]")!.click();
  await form.updateComplete;
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  expect(e.defaultPrevented).toBe(true);
  await selectProduct(form, "soup");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  cancel(form);
  await expect.poll(() => app.cancelled).toBe(1);
  expect((await sectionQuestion(app)).open).toBe(false);
});
it("Section success compares submitted membership independently of offered order and later picks", async () => {
  const { app, form } = await mountSection();
  await selectProduct(form, "soup");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=add]")!.click();
  expect(app.submitted).toEqual([["soup"]]);
  (form as typeof form & { commitSaved?: (ids: string[]) => void }).commitSaved?.(["soup"]);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  form.products = [
    { id: "soup", name: "A soup", categoryId: null },
    { id: "bread", name: "Z bread", categoryId: null },
  ];
  await form.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(false);
  await selectProduct(form, "bread");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await selectProduct(form, "bread");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
