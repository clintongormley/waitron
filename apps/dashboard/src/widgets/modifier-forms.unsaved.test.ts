import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, registerIcons } from "@waitron/ui";
import type { ExtraList, OptionList, ExtraListInput, OptionListInput } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { setLocale, t } from "../i18n/t.js";
import {
  cleanupWidgets,
  closeReportsDelivered,
  mountWidget,
  reattachAfterDetachedUpdate,
} from "./test-helpers.js";
import "./extra-list-form.js";
import "./option-list-form.js";
registerIcons(DASHBOARD_ICONS);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
const extras: ExtraList = {
  id: "extras",
  name: "Extras",
  customerName: { en: "For diners" },
  kitchenName: "PREP",
  minPicks: 0,
  maxPicks: null,
  active: false,
  items: [],
};
const options: OptionList = {
  id: "options",
  name: "Options",
  customerName: { en: "Your choice" },
  kitchenName: "CHOICE",
  active: true,
  defaultLabelId: "rare",
  labels: [
    {
      id: "rare",
      name: "Rare",
      customerName: { en: "Lightly cooked" },
      kitchenName: "R",
      available: true,
    },
    { id: "well", name: "Well", customerName: {}, kitchenName: null, available: true },
  ],
};
class ModifierApp extends LitElement {
  readonly leave = new LeaveController(this);
  kind: "extras" | "options" = "extras";
  value: ExtraList | OptionList = extras;
  open = true;
  cancelled = 0;
  submitted: (ExtraListInput | OptionListInput)[] = [];
  readonly cancel = () => {
    this.cancelled++;
    this.open = false;
    this.requestUpdate();
  };
  override render() {
    const languages = { defaultLanguage: "en", languages: ["en", "es"] };
    const submit = (event: CustomEvent<{ value: ExtraListInput | OptionListInput }>) =>
      this.submitted.push(event.detail.value);
    return html`${this.kind === "extras" ? html`<dashboard-extra-list-form .open=${this.open} .value=${this.value as ExtraList} .languages=${languages} @wt-cancel=${this.cancel} @wt-submit=${submit}></dashboard-extra-list-form>` : html`<dashboard-option-list-form .open=${this.open} .value=${this.value as OptionList} .languages=${languages} @wt-cancel=${this.cancel} @wt-submit=${submit}></dashboard-option-list-form>`}${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("modifier-leave-test-app", ModifierApp);
async function mount(
  kind: "extras" | "options",
  value: ExtraList | OptionList = kind === "extras" ? extras : options,
) {
  const { el: app } = await mountWidget<ModifierApp>("modifier-leave-test-app", { kind, value });
  const form =
    app.shadowRoot!.querySelector("dashboard-extra-list-form") ??
    app.shadowRoot!.querySelector("dashboard-option-list-form")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return { app, form };
}
async function edit(form: HTMLElement, name: string, value: string) {
  const field = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `[name="${name}"]`,
  )!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await (form as LitElement).updateComplete;
}
async function question(app: ModifierApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
function cancel(form: HTMLElement) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
}
for (const kind of ["extras", "options"] as const) {
  for (const route of ["cancel", "escape"] as const) {
    it(`${kind} ${route} keeps edits until Discard and reports cancellation once`, async () => {
      const { app, form } = await mount(kind);
      await edit(form, "name", "Draft list");
      if (route === "cancel") cancel(form);
      else await userEvent.keyboard("{Escape}");
      const q = await question(app);
      expect(q.open).toBe(true);
      expect(app.cancelled).toBe(0);
      expect(
        form.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector("dialog")!.open,
      ).toBe(true);
      q.shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!.click();
      await expect.poll(() => q.open).toBe(false);
      await closeReportsDelivered();
      expect(
        form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="name"]')!.value,
      ).toBe("Draft list");
      cancel(form);
      await question(app);
      q.shadowRoot!.querySelector<HTMLElement>('[data-choice="discard"]')!.click();
      await expect.poll(() => app.cancelled).toBe(1);
      await closeReportsDelivered();
      expect(app.cancelled).toBe(1);
      expect(app.submitted).toEqual([]);
    });
  }
  it(`${kind} reverted values close without a question`, async () => {
    const { app, form } = await mount(kind);
    await edit(form, "name", "Changed");
    await edit(form, "name", kind === "extras" ? " Extras " : " Options ");
    cancel(form);
    await expect.poll(() => app.cancelled).toBe(1);
    expect((await question(app)).open).toBe(false);
  });
  it(`${kind} refused write preserves normalized submitted values and asks on Cancel`, async () => {
    const { app, form } = await mount(kind);
    await edit(form, "name", " Saved list ");
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    expect(app.submitted[0]).toMatchObject({
      name: "Saved list",
      active: kind === "options",
      kitchenName: kind === "extras" ? "PREP" : "CHOICE",
    });
    form.fieldErrors = { name: "Refused" };
    await form.updateComplete;
    cancel(form);
    expect((await question(app)).open).toBe(true);
    expect(app.cancelled).toBe(0);
  });
}
it("a dirty option label blocks its clean ancestor and Keep retains the label text", async () => {
  const { app, form } = await mount("options");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=open-label-0]")!.click();
  await form.updateComplete;
  const label = form.shadowRoot!.querySelector("dashboard-option-label-form")!;
  await label.updateComplete;
  await edit(label, "label-name", "Child draft");
  expect(app.leave.coordinator.isDirty([form])).toBe(true);
  let left = false;
  const leaving = app.leave.coordinator.request({
    scopes: [form],
    reason: "navigation",
    proceed() {
      left = true;
    },
  });
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!.click();
  expect(await leaving).toBe("kept");
  expect(left).toBe(false);
  expect(
    label.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="label-name"]')!
      .value,
  ).toBe("Child draft");
});
it("option label Cancel protects the child and Discard leaves parent edits intact", async () => {
  const { app, form } = await mount("options");
  await edit(form, "name", "Parent draft");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=open-label-0]")!.click();
  await form.updateComplete;
  const label = form.shadowRoot!.querySelector("dashboard-option-label-form")!;
  await label.updateComplete;
  await edit(label, "label-name", "Child draft");
  cancel(label);
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>('[data-choice="discard"]')!.click();
  await expect.poll(() => label.open).toBe(false);
  expect(app.cancelled).toBe(0);
  expect(app.leave.coordinator.isDirty([form])).toBe(true);
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="name"]')!.value,
  ).toBe("Parent draft");
});
for (const kind of ["extras", "options"] as const) {
  it(`${kind} submitted baseline invalidates a question but retains newer edits`, async () => {
    const { app, form } = await mount(kind);
    await edit(form, "name", "Saved name");
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    const submitted = app.submitted[0]!;
    await edit(form, "name", "Newer draft");
    cancel(form);
    const q = await question(app);
    expect(q.open).toBe(true);
    if (kind === "extras")
      (form as HTMLElementTagNameMap["dashboard-extra-list-form"]).commitSaved(
        submitted as ExtraListInput,
      );
    else
      (form as HTMLElementTagNameMap["dashboard-option-list-form"]).commitSaved(
        submitted as OptionListInput,
      );
    await expect.poll(() => q.open).toBe(false);
    expect(app.cancelled).toBe(0);
    expect(app.leave.coordinator.isDirty()).toBe(true);
    await edit(form, "name", "Saved name");
    expect(app.leave.coordinator.isDirty()).toBe(false);
    cancel(form);
    await expect.poll(() => app.cancelled).toBe(1);
  });
  it(`${kind} replacement invalidates its old question while a same-id refresh retains edits`, async () => {
    const { app, form } = await mount(kind);
    await edit(form, "name", "Draft");
    app.value = { ...app.value, name: "Background name" };
    app.requestUpdate();
    await app.updateComplete;
    await form.updateComplete;
    expect(
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="name"]')!.value,
    ).toBe("Draft");
    cancel(form);
    const q = await question(app);
    expect(q.open).toBe(true);
    app.value = { ...app.value, id: "replacement", name: "Replacement" };
    app.requestUpdate();
    await app.updateComplete;
    await form.updateComplete;
    await expect.poll(() => q.open).toBe(false);
    expect(app.cancelled).toBe(0);
    expect(app.leave.coordinator.isDirty()).toBe(false);
    expect(
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="name"]')!.value,
    ).toBe("Replacement");
  });
}
it("saving an option label commits only that child and the parent submits the changed label", async () => {
  const { app, form } = await mount("options");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=open-label-0]")!.click();
  await form.updateComplete;
  const label = form.shadowRoot!.querySelector("dashboard-option-label-form")!;
  await label.updateComplete;
  await edit(label, "label-name", "New label");
  expect(app.leave.coordinator.isDirty([label])).toBe(true);
  label.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  expect(app.leave.coordinator.isDirty([label])).toBe(false);
  await expect.poll(() => label.open).toBe(false);
  expect(app.leave.coordinator.isDirty([label])).toBe(false);
  expect(app.leave.coordinator.isDirty([form])).toBe(true);
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  expect((app.submitted[0] as OptionListInput).labels[0]).toEqual({
    id: "rare",
    name: "New label",
    customerName: { en: "Lightly cooked" },
    kitchenName: "R",
    available: true,
  });
  cancel(form);
  expect((await question(app)).open).toBe(true);
});
it("option order and default choice each keep their submitted meaning", async () => {
  const { app, form } = await mount("options");
  const radio = form.shadowRoot!.querySelector<HTMLInputElement>("[data-test=label-1-default]")!;
  radio.click();
  await form.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(true);
  form.shadowRoot!.querySelector<HTMLInputElement>("[data-test=label-0-default]")!.click();
  await form.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(false);
  const handle = form.shadowRoot!.querySelector<HTMLElement>("[data-test=drag-rare]");
  handle!.focus();
  await userEvent.keyboard("{ArrowDown}");
  await form.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(true);
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  expect((app.submitted[0] as OptionListInput).labels.map((label) => label.id)).toEqual([
    "well",
    "rare",
  ]);
  handle!.focus();
  await userEvent.keyboard("{ArrowUp}");
  await form.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("invalid extras pick limits remain distinct from empty/default limits", async () => {
  const { app, form } = await mount("extras");
  const min = form.shadowRoot!.querySelector("wt-number-stepper[name=min-picks]")!;
  min.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "oops" }, bubbles: true, composed: true }),
  );
  await form.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(true);
  min.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "" }, bubbles: true, composed: true }),
  );
  await form.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("extras prices compare exact value while inherited, invalid and rounded values remain distinct", async () => {
  const { app, form } = await mount("extras", {
    ...extras,
    items: [
      { id: "item", productId: "product", maxQuantity: 1, preselected: false, price: "2.00" },
    ],
  });
  const price = form.shadowRoot!.querySelector("wt-price-input")!;
  const change = async (value: string) => {
    price.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
    await form.updateComplete;
  };
  await change("2");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  await change("");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await change("2.001");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await change("2.0");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("a same-label background value does not overwrite typed names or abort a pending question", async () => {
  const { app, form } = await mount("options");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=open-label-0]")!.click();
  await form.updateComplete;
  const label = form.shadowRoot!.querySelector("dashboard-option-label-form")!;
  await label.updateComplete;
  await edit(label, "label-name", "Draft label");
  cancel(label);
  const q = await question(app);
  expect(q.open).toBe(true);
  label.value = { ...label.value!, name: "Background name" };
  await label.updateComplete;
  expect(q.open).toBe(true);
  expect(
    label.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="label-name"]')!
      .value,
  ).toBe("Draft label");
});

it("an unchanged or reverted option label closes directly without clearing its parent", async () => {
  const { app, form } = await mount("options");
  await edit(form, "name", "Parent draft");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=open-label-0]")!.click();
  await form.updateComplete;
  const label = form.shadowRoot!.querySelector("dashboard-option-label-form")!;
  await label.updateComplete;
  await edit(label, "label-name", "Changed");
  await edit(label, "label-name", "Rare");
  cancel(label);
  await expect.poll(() => label.open).toBe(false);
  expect((await question(app)).open).toBe(false);
  expect(app.leave.coordinator.isDirty([form])).toBe(true);
  expect(app.cancelled).toBe(0);
});
it("extras keep positional rows distinct after a move and restore them on Discard", async () => {
  const { app, form } = await mount("extras", {
    ...extras,
    items: [
      { id: "one", productId: "product-one", maxQuantity: 1, preselected: false, price: "2.00" },
      { id: "two", productId: "product-two", maxQuantity: null, preselected: true, price: null },
    ],
  });
  const handle = form.shadowRoot!.querySelector<HTMLElement>("[data-test=drag-one]")!;
  handle.focus();
  await userEvent.keyboard("{ArrowDown}");
  await form.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(true);
  expect(
    [...form.shadowRoot!.querySelectorAll("tr[data-item]")].map((row) =>
      row.getAttribute("data-item"),
    ),
  ).toEqual(["two", "one"]);
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>('[data-choice="discard"]')!.click();
  await expect.poll(() => app.cancelled).toBe(1);
  expect(
    [...form.shadowRoot!.querySelectorAll("tr[data-item]")].map((row) =>
      row.getAttribute("data-item"),
    ),
  ).toEqual(["one", "two"]);
});
for (const kind of ["extras", "options"] as const) {
  it(`${kind} put back after a detached update still asks before Cancel discards an edit`, async () => {
    const { app, form } = await mount(kind);
    await reattachAfterDetachedUpdate(form);
    await edit(form, "name", "Draft list");
    expect(app.leave.coordinator.isDirty()).toBe(true);
    cancel(form);
    expect((await question(app)).open).toBe(true);
    expect(app.cancelled).toBe(0);
  });
}
it("an option label put back after a detached update still asks before Cancel discards an edit", async () => {
  const { app, form } = await mount("options");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=open-label-0]")!.click();
  await form.updateComplete;
  const label = form.shadowRoot!.querySelector("dashboard-option-label-form")!;
  await label.updateComplete;
  await reattachAfterDetachedUpdate(label);
  // Put back, the child's dialog is open but not modal and a typed edit fires no change event there,
  // so the edit is sent as the field's own change event.
  label
    .shadowRoot!.querySelector('[name="label-name"]')!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Child draft" } }));
  await label.updateComplete;
  expect(app.leave.coordinator.isDirty([label])).toBe(true);
  cancel(label);
  expect((await question(app)).open).toBe(true);
  expect(label.open).toBe(true);
});
