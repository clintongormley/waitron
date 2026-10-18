import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { draftScopeFor, type DraftScope } from "@waitron/ui";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import {
  cleanupDepartmentEditors,
  mountDepartmentEditor,
  editDepartmentField,
  departmentSave,
  selectDepartmentTab,
} from "../testing/department-edit-fixture.js";

class ReceiptEditorStub extends LitElement {
  departmentId = "d1";
  value = "";
  hold = false;
  busy = false;
  finish?: () => void;
  #scope?: DraftScope<string>;
  override connectedCallback() {
    super.connectedCallback();
    this.#scope = draftScopeFor(this, {
      id: this,
      current: () => this.value,
      snapshot: (value) => value,
      equal: (a, b) => a === b,
      restore: (value) => {
        this.value = value;
        this.requestUpdate();
      },
    }).scope;
  }
  override disconnectedCallback() {
    this.#scope?.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }
  get leaveScope(): object | undefined {
    return this.#scope?.id;
  }
  get hasUnsavedChanges(): boolean {
    return this.#scope?.isDirty() ?? false;
  }
  get saving(): boolean {
    return this.busy;
  }
  async save() {
    this.busy = true;
    if (this.hold)
      await new Promise<void>((resolve) => {
        this.finish = resolve;
      });
    this.#scope!.commit(this.value);
    this.busy = false;
    this.notify("department-receipt-saved");
  }
  notify(type: string) {
    this.dispatchEvent(
      new CustomEvent(type, {
        detail: { departmentId: this.departmentId },
        bubbles: true,
        composed: true,
      }),
    );
  }
  override render() {
    return html`<input
        type="text"
        name="receiptSubtitle"
        .value=${this.value}
        @input=${(event: Event) => {
          this.value = (event.target as HTMLInputElement).value;
          this.#scope?.changed();
        }}
      /><button data-test="save-receipt" @click=${() => void this.save()}>Save</button
      ><button data-test="cancel-receipt" @click=${() => this.notify("department-receipt-cancel")}>
        Cancel
      </button>`;
  }
}
customElements.define("dashboard-department-receipt-editor", ReceiptEditorStub);
async function supplyReceiptEditor(
  el: HTMLElementTagNameMap["department-edit-dialog"],
  form: HTMLElementTagNameMap["department-settings"],
) {
  const editor = document.createElement("dashboard-department-receipt-editor") as ReceiptEditorStub;
  el.receiptEditor = editor;
  await el.updateComplete;
  await form.updateComplete;
  await editor.updateComplete;
  return editor;
}
async function editReceipt(editor: ReceiptEditorStub, value: string) {
  await userEvent.fill(page.elementLocator(editor.shadowRoot!.querySelector("input")!), value);
}
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupDepartmentEditors();
  setLocale("en");
});
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupDepartmentEditors();
  setLocale("en");
});
it("Escape asks about this dialog's draft; Keep retains and Discard closes without writing", async () => {
  const { el, app, form, modal, writes } = await mountDepartmentEditor();
  await editDepartmentField(form, "tradingName", "Trading draft");
  const closing = modal.requestClose("escape");
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  expect(await closing).toBe(false);
  expect(modal.open).toBe(true);
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=tradingName]")!.value,
  ).toBe("Trading draft");
  const discard = modal.requestClose("escape");
  await expect.poll(() => question.open).toBe(true);
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  expect(await discard).toBe(true);
  expect(modal.open).toBe(false);
  expect(writes).toEqual([]);
  expect(el.departmentId).toBe("d1");
});
it("a pending Save prevents Escape and preserves a newer native draft after the submitted values commit", async () => {
  let finish!: () => void;
  const { form, modal, app } = await mountDepartmentEditor((async (path, method = "GET") => {
    if (method === "GET")
      return path.endsWith("/profiles")
        ? []
        : { receivingProfileId: null, destinationDepartmentIds: [], profiles: [] };
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  }) as DashboardRequest);
  await editDepartmentField(form, "name", "Submitted");
  departmentSave(form).click();
  await expect.poll(() => !!finish).toBe(true);
  expect(await modal.requestClose("escape")).toBe(false);
  expect(modal.open).toBe(true);
  await editDepartmentField(form, "name", "Later draft");
  finish();
  await expect.poll(() => departmentSave(form).disabled).toBe(false);
  expect(modal.open).toBe(true);
  expect(app.leave.coordinator.isDirty()).toBe(true);
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
  ).toBe("Later draft");
});
it("Escape with both drafts dirty asks one question; Discard closes without writing either", async () => {
  const { el, app, form, modal, writes } = await mountDepartmentEditor();
  const editor = await supplyReceiptEditor(el, form);
  await editDepartmentField(form, "name", "Restaurant draft");
  await selectDepartmentTab(form, "receipt");
  await editReceipt(editor, "Thanks");
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  const closing = modal.requestClose("escape");
  await expect.poll(() => question.open).toBe(true);
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  expect(await closing).toBe(true);
  expect(modal.open).toBe(false);
  expect(question.open).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(editor.hasUnsavedChanges).toBe(false);
  expect(form.hasUnsavedChanges).toBe(false);
  expect(writes).toEqual([]);
});
it("a pending receipt Save blocks Escape and Cancel", async () => {
  const { el, form, modal } = await mountDepartmentEditor();
  const editor = await supplyReceiptEditor(el, form);
  await selectDepartmentTab(form, "receipt");
  await editReceipt(editor, "Thanks");
  editor.hold = true;
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=save-receipt]")!.click();
  await expect.poll(() => !!editor.finish).toBe(true);
  expect(await modal.requestClose("escape")).toBe(false);
  expect(await modal.requestClose("cancel")).toBe(false);
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-receipt]")!.click();
  await selectDepartmentTab(form, "details");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await form.updateComplete;
  expect(modal.open).toBe(true);
  editor.finish!();
  await expect.poll(() => modal.open).toBe(false);
});
