import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi } from "../api/client.js";
import {
  cleanupWidgets,
  mountWidget,
  reattachAfterDetachedUpdate,
} from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./venue-receipt-defaults-editor.js";
class DefaultsDraftHost extends LitElement {
  readonly leave = new LeaveController(this);
  api = {
    getVenueReceiptSettings: async () => ({ settings: { headerSubtitle: "Restaurant" } }),
    putVenueReceiptSettings: async () => {},
  } as unknown as DashboardApi;
  override render() {
    return html`<dashboard-venue-receipt-defaults-editor
        .api=${this.api}
      ></dashboard-venue-receipt-defaults-editor>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("venue-receipt-defaults-draft-test-host", DefaultsDraftHost);
type Editor = HTMLElementTagNameMap["dashboard-venue-receipt-defaults-editor"];
async function mount(api?: DashboardApi) {
  const { el: app } = await mountWidget<DefaultsDraftHost>(
    "venue-receipt-defaults-draft-test-host",
    api ? { api } : {},
  );
  const editor = app.shadowRoot!.querySelector("dashboard-venue-receipt-defaults-editor")!;
  await vi.waitFor(() =>
    expect(editor.shadowRoot?.querySelector("wt-input[name=headerSubtitle]")).toBeTruthy(),
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
    "wt-input[name=headerSubtitle]",
  )!;
}
async function edit(editor: Editor, value: string) {
  const field = input(editor);
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await editor.updateComplete;
}
async function choose(app: DefaultsDraftHost, decision: "keep" | "discard") {
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
it("protects typed venue defaults and removes protection when reverted", async () => {
  const { editor } = await mount();
  expect(unload()).toBe(false);
  await edit(editor, "Typed");
  expect(unload()).toBe(true);
  await edit(editor, "Restaurant");
  expect(unload()).toBe(false);
});
it("Keep preserves the native value and Discard restores the saved default", async () => {
  const { app, editor } = await mount();
  await edit(editor, "Typed");
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
  expect(input(editor).shadowRoot!.querySelector("input")!.value).toBe("Typed");
  expect(left).toBe(0);
  const discarded = request();
  await choose(app, "discard");
  expect(await discarded).toBe("proceeded");
  await editor.updateComplete;
  await input(editor).updateComplete;
  expect(input(editor).shadowRoot!.querySelector("input")!.value).toBe("Restaurant");
  expect(left).toBe(1);
  expect(unload()).toBe(false);
});
it("reconnect registers preserved input against its saved baseline", async () => {
  const { editor } = await mount();
  await edit(editor, "Typed");
  await reattachAfterDetachedUpdate(editor);
  expect(input(editor).shadowRoot!.querySelector("input")!.value).toBe("Typed");
  expect(unload()).toBe(true);
  await edit(editor, "Restaurant");
  expect(unload()).toBe(false);
});

it("surrounding whitespace leaves defaults clean, including after reconnect", async () => {
  const { editor } = await mount();
  await edit(editor, "  Restaurant  ");
  expect(unload()).toBe(false);
  await reattachAfterDetachedUpdate(editor);
  expect(unload()).toBe(false);
});

it("Discard restores the typed field's baseline and the refreshed untouched field", async () => {
  const liveData = new LiveData();
  const getVenueReceiptSettings = vi.fn(async () => ({
    settings: { headerSubtitle: "Restaurant", footerMessage: "Original footer" },
  }));
  const { app, editor } = await mount({
    liveData,
    getVenueReceiptSettings,
    putVenueReceiptSettings: async () => {},
  } as unknown as DashboardApi);
  await edit(editor, "Typed");
  getVenueReceiptSettings.mockResolvedValue({
    settings: { headerSubtitle: "Remote subtitle", footerMessage: "Remote footer" },
  });
  liveData.invalidate([{ type: "tenant_receipts" }]);
  const footer = () =>
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-textarea"]>(
      "wt-textarea[name=footerMessage]",
    )!;
  await vi.waitFor(() => expect(footer().value).toBe("Remote footer"));
  expect(unload()).toBe(true);
  const leaving = app.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {},
  });
  await choose(app, "discard");
  expect(await leaving).toBe("proceeded");
  await editor.updateComplete;
  await input(editor).updateComplete;
  await footer().updateComplete;
  expect(input(editor).shadowRoot!.querySelector("input")!.value).toBe("Restaurant");
  expect(footer().shadowRoot!.querySelector("textarea")!.value).toBe("Remote footer");
  expect(unload()).toBe(false);
});

it("an unchanged live read leaves the outstanding Keep or Discard choice open", async () => {
  const liveData = new LiveData();
  const getVenueReceiptSettings = vi.fn(async () => ({
    settings: { headerSubtitle: "Restaurant" },
  }));
  const { app, editor } = await mount({
    liveData,
    getVenueReceiptSettings,
    putVenueReceiptSettings: async () => {},
  } as unknown as DashboardApi);
  await edit(editor, "Typed");
  let left = 0;
  const leaving = app.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {
      left++;
    },
  });
  await vi.waitFor(() =>
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(true),
  );
  liveData.invalidate([{ type: "tenant_receipts" }]);
  await vi.waitFor(() => expect(getVenueReceiptSettings).toHaveBeenCalledTimes(2));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await editor.updateComplete;
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(true);
  await choose(app, "keep");
  expect(await leaving).toBe("kept");
  expect(left).toBe(0);
  expect(input(editor).shadowRoot!.querySelector("input")!.value).toBe("Typed");
  expect(unload()).toBe(true);
});
