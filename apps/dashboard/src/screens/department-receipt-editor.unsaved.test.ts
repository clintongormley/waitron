import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import type { DashboardApi } from "../api/client.js";
import {
  cleanupWidgets,
  mountWidget,
  reattachAfterDetachedUpdate,
} from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./department-receipt-editor.js";
class ReceiptDraftHost extends LitElement {
  readonly leave = new LeaveController(this);
  api = {
    getDepartmentReceipt: async () => ({
      receipt: {},
      venueDefaults: {},
      languages: ["es-ES"],
      warningLanguages: [],
      venueAddress: [],
    }),
    putDepartmentReceipt: async () => {},
  } as unknown as DashboardApi;
  override render() {
    return html`<dashboard-department-receipt-editor
        .api=${this.api}
        departmentId="bar"
        departmentName="Bar"
        receiptLanguage="es-ES"
      ></dashboard-department-receipt-editor>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("department-receipt-draft-test-host", ReceiptDraftHost);
type Editor = HTMLElementTagNameMap["dashboard-department-receipt-editor"];
async function mount() {
  const { el: app } = await mountWidget<ReceiptDraftHost>("department-receipt-draft-test-host", {});
  const editor = app.shadowRoot!.querySelector("dashboard-department-receipt-editor")!;
  await vi.waitFor(() =>
    expect(editor.shadowRoot?.querySelector("wt-input[name=email]")).toBeTruthy(),
  );
  return { app, editor };
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
function input(editor: Editor) {
  return editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    "wt-input[name=email]",
  )!;
}
async function edit(editor: Editor, text: string) {
  const field = input(editor);
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), text);
  await editor.updateComplete;
}
async function choose(app: ReceiptDraftHost, decision: "keep" | "discard") {
  await vi.waitFor(() =>
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(true),
  );
  app
    .shadowRoot!.querySelector("wt-unsaved-changes")!
    .dispatchEvent(
      new CustomEvent("wt-unsaved-choice", { detail: { decision }, bubbles: true, composed: true }),
    );
}
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
it("protects typed department input and stops protection on its real-control revert", async () => {
  const { editor } = await mount();
  expect(unload()).toBe(false);
  await edit(editor, "bar@example.com");
  expect(unload()).toBe(true);
  await edit(editor, "");
  expect(unload()).toBe(false);
});
it("Keep preserves the draft and Discard resets the native input before proceeding", async () => {
  const { app, editor } = await mount();
  await edit(editor, "bar@example.com");
  let left = 0;
  const request = () =>
    app.leave.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed() {
        left++;
      },
    });
  const kept = request();
  await choose(app, "keep");
  expect(await kept).toBe("kept");
  expect(input(editor).shadowRoot!.querySelector("input")!.value).toBe("bar@example.com");
  expect(left).toBe(0);
  const discarded = request();
  await choose(app, "discard");
  expect(await discarded).toBe("proceeded");
  await editor.updateComplete;
  await input(editor).updateComplete;
  expect(input(editor).shadowRoot!.querySelector("input")!.value).toBe("");
  expect(left).toBe(1);
  expect(unload()).toBe(false);
});
it("reconnect preserves an edit made before removal and registers it against its saved baseline", async () => {
  const { editor } = await mount();
  await edit(editor, "bar@example.com");
  await reattachAfterDetachedUpdate(editor);
  expect(input(editor).shadowRoot!.querySelector("input")!.value).toBe("bar@example.com");
  expect(unload()).toBe(true);
  await edit(editor, "");
  expect(unload()).toBe(false);
  await edit(editor, "second@example.com");
  expect(unload()).toBe(true);
});
