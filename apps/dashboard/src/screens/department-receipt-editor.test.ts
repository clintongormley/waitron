import { LitElement, html } from "lit";
import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController, type WtInput } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { receiptApi } from "../testing/department-receipt-dialog-fixture.js";
import type { DepartmentReceiptEditor } from "./department-receipt-editor.js";
import "./department-receipt-editor.js";

class ReceiptEditorHost extends LitElement {
  readonly leave = new LeaveController(this);
  api = receiptApi();
  override render() {
    return html`<dashboard-department-receipt-editor
        .api=${this.api}
        .subject=${{ id: "bar", name: "Bar" }}
      ></dashboard-department-receipt-editor
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("receipt-editor-test-host", ReceiptEditorHost);

beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

async function mountEditor() {
  const api = receiptApi();
  const { el: host } = await mountWidget<ReceiptEditorHost>("receipt-editor-test-host", { api });
  const el = host.shadowRoot!.querySelector<DepartmentReceiptEditor>(
    "dashboard-department-receipt-editor",
  )!;
  await expect.poll(() => el.shadowRoot?.querySelector("[name=email]")).toBeTruthy();
  const events: string[] = [];
  for (const name of [
    "department-receipt-saved",
    "department-receipt-cancel",
    "department-receipt-closed",
  ])
    host.addEventListener(name, (event) =>
      events.push(
        `${name}:${(event as CustomEvent<{ departmentId: string }>).detail.departmentId}`,
      ),
    );
  return { host, el, api, events };
}
const field = (el: DepartmentReceiptEditor, name: string) =>
  el.shadowRoot!.querySelector<WtInput>(`[name="${name}"]`)!;
const save = (el: DepartmentReceiptEditor) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-receipt]")!;
async function edit(el: DepartmentReceiptEditor, name: string, value: string) {
  const input = field(el, name);
  await input.updateComplete;
  await userEvent.fill(page.elementLocator(input.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}

it("after Save the editor stays, shows the saved values with Save quiet, and reports saved", async () => {
  const { el, api, events } = await mountEditor();
  await edit(el, "phone", " +34 600 000 000 ");
  expect(save(el).variant).toBe("primary");
  await userEvent.click(page.elementLocator(save(el)));
  await expect.poll(() => events).toEqual(["department-receipt-saved:bar"]);
  expect(api.putDepartmentReceipt).toHaveBeenCalledExactlyOnceWith(
    "bar",
    expect.objectContaining({
      receipt: expect.objectContaining({ phone: "+34 600 000 000" }),
    }),
  );
  await el.updateComplete;
  expect(el.isConnected).toBe(true);
  expect(field(el, "phone").value).toBe("+34 600 000 000");
  expect(save(el).variant).toBe("secondary");
  expect(save(el).disabled).toBe(true);
  expect(el.saving).toBe(false);
  expect(el.hasUnsavedChanges).toBe(false);
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.getAttribute("slot")).toBeNull();
});

it("Cancel reports cancel and changes nothing", async () => {
  const { el, api, events } = await mountEditor();
  await edit(el, "email", "bar@example.com");
  await userEvent.click(
    page.elementLocator(el.shadowRoot!.querySelector("[data-test=cancel-receipt]")!),
  );
  expect(events).toEqual(["department-receipt-cancel:bar"]);
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
  expect(el.isConnected).toBe(true);
  expect(field(el, "email").value).toBe("bar@example.com");
  expect(el.hasUnsavedChanges).toBe(true);
});

it("leaveScope is dirty after an edit and clean after Save", async () => {
  const { host, el } = await mountEditor();
  const scope = el.leaveScope;
  expect(scope).toBeDefined();
  expect(el.hasUnsavedChanges).toBe(false);
  expect(host.leave.coordinator.isDirty([scope!])).toBe(false);
  await edit(el, "phone", "+34 600 000 000");
  expect(el.hasUnsavedChanges).toBe(true);
  expect(host.leave.coordinator.isDirty([scope!])).toBe(true);
  await userEvent.click(page.elementLocator(save(el)));
  await expect.poll(() => el.hasUnsavedChanges).toBe(false);
  expect(el.leaveScope).toBe(scope);
  expect(host.leave.coordinator.isDirty([scope!])).toBe(false);
});
