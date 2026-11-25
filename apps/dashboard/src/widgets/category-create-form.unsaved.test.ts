import { afterEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./category-create-form.js";

class CategoryLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  seed = "Hot dishes";
  readonly submit = vi.fn();
  readonly cancel = vi.fn();
  override render() {
    return html`<dashboard-category-create-form
        .open=${true}
        .seed=${this.seed}
        @wt-submit=${this.submit}
        @wt-cancel=${this.cancel}
      ></dashboard-category-create-form>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("category-leave-test-app", CategoryLeaveApp);
afterEach(cleanupWidgets);

async function open(seed?: string) {
  const { el } = await mountWidget<CategoryLeaveApp>(
    "category-leave-test-app",
    seed === undefined ? {} : { seed },
  );
  const form = el.shadowRoot!.querySelector("dashboard-category-create-form")!;
  expect(form.shadowRoot, "the Add category dialog renders").not.toBeNull();
  const root = form.shadowRoot!;
  await root.querySelector("wt-modal")!.updateComplete;
  const name = root.querySelector("wt-input")!;
  await name.updateComplete;
  return {
    el,
    form,
    root,
    name,
    input: name.shadowRoot!.querySelector("input")!,
    add: root.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="add"]')!,
  };
}

it("can add its suggested name without editing it", async () => {
  const { el, input, add } = await open();
  expect(input.getRootNode()).toHaveProperty("activeElement", input);
  expect(el.leave.coordinator.isDirty()).toBe(false);
  await userEvent.click(add);
  expect(el.submit.mock.calls.map(([event]) => event.detail.value)).toEqual([
    { name: "Hot dishes", parentId: null, color: null },
  ]);
});

it("keeps Add disabled for a blank name and closes a clean draft on Escape", async () => {
  const { el, add } = await open("");
  expect(add.disabled).toBe(true);
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => el.cancel.mock.calls.length).toBe(1);
  expect(el.submit).not.toHaveBeenCalled();
  expect(el.leave.coordinator.isDirty()).toBe(false);
});

it("asks before discarding an edited name on Escape", async () => {
  const { el, input, name } = await open();
  await userEvent.fill(input, "Cold dishes");
  await expect.poll(() => name.value).toBe("Cold dishes");
  await userEvent.keyboard("{Escape}");
  const reminder = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => reminder.open).toBe(true);
  expect(el.cancel).not.toHaveBeenCalled();
  await userEvent.click(reminder.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!);
  await expect.poll(() => el.cancel.mock.calls.length).toBe(1);
  expect(el.leave.coordinator.isDirty()).toBe(false);
});

it("Cancel discards an edited name without asking", async () => {
  const { el, root, input, name } = await open();
  await userEvent.fill(input, "Cold dishes");
  await expect.poll(() => name.value).toBe("Cold dishes");
  await userEvent.click(root.querySelector<HTMLElement>('wt-button[slot="cancel"]')!);
  await expect.poll(() => el.cancel.mock.calls.length).toBe(1);
  expect(el.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(el.leave.coordinator.isDirty()).toBe(false);
});

it("shows Name and Inside refusals beside the fields and lets the manager retry", async () => {
  const { el, form, root, name, add } = await open();
  Object.assign(form, { fieldErrors: { name: codeMessage("category.name_taken") } });
  await expect.poll(() => name.error).toBe(codeMessage("category.name_taken"));
  Object.assign(form, { fieldErrors: { parent: codeMessage("category.not_found") } });
  const inside = root.querySelector("wt-combobox")!;
  await expect.poll(() => inside.error).toBe(codeMessage("category.not_found"));
  expect(name.error).toBe("");
  await userEvent.click(add);
  expect(el.submit).toHaveBeenCalledOnce();
});
