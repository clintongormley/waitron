import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { setLocale, t } from "../i18n/t.js";
import type { Unit, UnitInput } from "../api/client.js";
import {
  cleanupWidgets,
  closeReportsDelivered,
  mountWidget,
  reattachAfterDetachedUpdate,
} from "./test-helpers.js";
import "./unit-form.js";
import "./category-color-form.js";

registerIcons(DASHBOARD_ICONS);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
const unit: Unit = {
  id: "kg",
  name: { en: "Kilogram", es: "Kilogramo", fr: "Kilogramme" },
  abbreviation: { en: "kg", es: "kg", fr: "kg" },
  precision: 3,
};
class CatalogueFormsApp extends LitElement {
  readonly leave = new LeaveController(this);
  kind: "unit" | "category-color" = "unit";
  value: Unit | null = unit;
  open = true;
  cancelled = 0;
  submitted: unknown[] = [];
  chosen: unknown[] = [];
  readonly cancel = () => {
    this.cancelled++;
    this.open = false;
    this.requestUpdate();
  };
  override render() {
    return html`${
      this.kind === "unit"
        ? html`<dashboard-unit-form
            .open=${this.open}
            .value=${this.value}
            .locales=${["en", "es"]}
            @wt-cancel=${this.cancel}
            @wt-submit=${(event: CustomEvent<{ value: UnitInput }>) =>
              this.submitted.push(event.detail.value)}
          ></dashboard-unit-form>`
        : html`<dashboard-category-color-form
            .open=${this.open}
            heading="Category colour"
            .color=${"#b12525"}
            @wt-cancel=${this.cancel}
            @wt-choose=${(event: CustomEvent<{ color: string | null }>) =>
              this.chosen.push(event.detail.color)}
          ></dashboard-category-color-form>`
    }${this.leave.render({
      heading: t("unsaved.heading"),
      message: t("unsaved.message"),
      keepLabel: t("unsaved.keep"),
      discardLabel: t("unsaved.discard"),
    })}`;
  }
}
customElements.define("catalogue-forms-leave-test-app", CatalogueFormsApp);
async function mount(props: Partial<CatalogueFormsApp> = {}) {
  const { el: app } = await mountWidget<CatalogueFormsApp>("catalogue-forms-leave-test-app", props);
  const form = app.shadowRoot!.querySelector("dashboard-unit-form")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return { app, form };
}
async function edit(form: HTMLElement, name: string, value: string) {
  const field = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `wt-input[name="${name}"]`,
  )!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await (form as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
}
async function question(app: CatalogueFormsApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
function cancel(form: HTMLElement) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
}
for (const route of ["cancel", "escape"] as const) {
  it(`Unit ${route} retains edited input through Keep and reports Discard once`, async () => {
    const { app, form } = await mount();
    await edit(form, "name-en", "Edited kilogram");
    if (route === "cancel") cancel(form);
    else await userEvent.keyboard("{Escape}");
    const q = await question(app);
    expect(app.cancelled).toBe(0);
    expect(q.open).toBe(true);
    expect(
      form.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector("dialog")!.open,
    ).toBe(true);
    q.shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!.click();
    await expect.poll(() => q.open).toBe(false);
    await closeReportsDelivered();
    expect(
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="name-en"]')!.value,
    ).toBe("Edited kilogram");
    cancel(form);
    await question(app);
    q.shadowRoot!.querySelector<HTMLElement>('[data-choice="discard"]')!.click();
    await expect.poll(() => app.cancelled).toBe(1);
    await closeReportsDelivered();
    expect(app.cancelled).toBe(1);
    expect(app.leave.coordinator.isDirty()).toBe(false);
  });
}
it("Unit change/revert uses trimmed translations and updates unload protection immediately", async () => {
  const { app, form } = await mount();
  await edit(form, "abbreviation-es", "kilo");
  const dirty = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(dirty);
  expect(dirty.defaultPrevented).toBe(true);
  await edit(form, "abbreviation-es", " kg ");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  const clean = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(clean);
  expect(clean.defaultPrevented).toBe(false);
  cancel(form);
  await expect.poll(() => app.cancelled).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("an Add Unit starts clean, protects the first name and retains refused submissions", async () => {
  const { app, form } = await mount({ value: null });
  expect(app.leave.coordinator.isDirty()).toBe(false);
  await edit(form, "name-en", " Each ");
  await edit(form, "abbreviation-en", " ea ");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
  expect(app.submitted).toEqual([
    { name: { en: "Each" }, abbreviation: { en: "ea" }, precision: 0 },
  ]);
  form.fieldErrors = { name: "Refused by server" };
  await form.updateComplete;
  cancel(form);
  expect((await question(app)).open).toBe(true);
  expect(app.cancelled).toBe(0);
});
it("replacing an open Unit invalidates its old question and starts with the replacement values", async () => {
  const { app, form } = await mount();
  await edit(form, "name-en", "Old edit");
  cancel(form);
  expect((await question(app)).open).toBe(true);
  app.value = { ...unit, id: "g", name: { en: "Gram" }, precision: 0 };
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="name-en"]')!.value,
  ).toBe("Gram");
  expect(app.cancelled).toBe(0);
});

it("invalid Unit precision remains dirty instead of becoming the default zero", async () => {
  const { app, form } = await mount({ value: { ...unit, precision: 0 } });
  const field = form.shadowRoot!.querySelector("[name=precision]")!;
  field.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "" }, bubbles: true, composed: true }),
  );
  await form.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(true);
  field.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "0" }, bubbles: true, composed: true }),
  );
  await form.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("Unit success commits submitted translations without clearing edits made during the write", async () => {
  const { app, form } = await mount();
  await edit(form, "name-en", " Saved name ");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
  const submitted = app.submitted[0] as UnitInput;
  expect(submitted).toEqual({
    name: { en: "Saved name", es: "Kilogramo", fr: "Kilogramme" },
    abbreviation: { en: "kg", es: "kg", fr: "kg" },
    precision: 3,
  });
  await edit(form, "name-en", "Newer name");
  form.commitSaved(submitted);
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await edit(form, "name-en", "Saved name");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  cancel(form);
  await expect.poll(() => app.cancelled).toBe(1);
  expect((await question(app)).open).toBe(false);
});

async function mountCategoryColor() {
  const { el: app } = await mountWidget<CatalogueFormsApp>("catalogue-forms-leave-test-app", {
    kind: "category-color",
  });
  const category = app.shadowRoot!.querySelector("dashboard-category-color-form")!;
  await category.updateComplete;
  await category.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  expect(
    category.shadowRoot!.querySelector('[data-color="#b12525"]')!.getAttribute("aria-checked"),
  ).toBe("true");
  return { app, category };
}
function chooseColor(form: HTMLElement, color: string) {
  form.shadowRoot!.querySelector<HTMLElement>(`[data-color="${color}"]`)!.click();
}
it("category colour choices submit immediately and Cancel remains direct without a second warning", async () => {
  const { app, category } = await mountCategoryColor();
  chooseColor(category, "#256bb1");
  await category.updateComplete;
  expect(app.chosen).toEqual(["#256bb1"]);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  cancel(category);
  await expect.poll(() => app.cancelled).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("a Unit put back after a detached update still asks before Cancel discards an edit", async () => {
  const { app, form } = await mount();
  await reattachAfterDetachedUpdate(form);
  await edit(form, "name-en", "Edited kilogram");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  cancel(form);
  expect((await question(app)).open).toBe(true);
  expect(app.cancelled).toBe(0);
});
async function unitSaveState(form: HTMLElement & { updateComplete: Promise<unknown> }) {
  await form.updateComplete;
  const save = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "wt-button[data-test=submit]",
  )!;
  await save.updateComplete;
  return {
    variant: save.variant,
    disabled: save.disabled,
    innerDisabled: save.shadowRoot!.querySelector("button")!.disabled,
  };
}
const unitInput: UnitInput = {
  name: unit.name,
  abbreviation: unit.abbreviation,
  precision: unit.precision,
};
const quietUnitSave = { variant: "secondary", disabled: true, innerDisabled: true };
function unitNameEn(form: HTMLElement) {
  return form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="name-en"]')!
    .value;
}
it("a Unit keeps an edit made before it was taken out and put back, and still asks", async () => {
  const { app, form } = await mount();
  await edit(form, "name-en", "Edited kilogram");
  await reattachAfterDetachedUpdate(form);
  expect(unitNameEn(form)).toBe("Edited kilogram");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  expect(await unitSaveState(form)).toEqual({
    variant: "primary",
    disabled: false,
    innerDisabled: false,
  });
  cancel(form);
  expect((await question(app)).open).toBe(true);
  expect(app.cancelled).toBe(0);
});
it("a Unit reopened on another unit after a put-back save opens quiet with that unit", async () => {
  const { app, form } = await mount();
  await edit(form, "name-en", "Edited kilogram");
  await reattachAfterDetachedUpdate(form);
  form.closeSaved({ ...unitInput, name: { ...unit.name, en: "Edited kilogram" } });
  expect(form.open).toBe(false);
  await closeReportsDelivered();
  form.value = { ...unit, id: "g", name: { en: "Gram", es: "Gramo" }, precision: 0 };
  form.open = true;
  await form.updateComplete;
  expect(unitNameEn(form)).toBe("Gram");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(await unitSaveState(form)).toEqual(quietUnitSave);
  await edit(form, "name-en", "Grams");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await edit(form, "name-en", "Gram");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("a Unit saved while open and then taken out and put back stays quiet", async () => {
  const { app, form } = await mount();
  await edit(form, "name-en", "Saved kilogram");
  form.commitSaved({ ...unitInput, name: { ...unit.name, en: "Saved kilogram" } });
  await reattachAfterDetachedUpdate(form);
  expect(unitNameEn(form)).toBe("Saved kilogram");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(await unitSaveState(form)).toEqual(quietUnitSave);
});
