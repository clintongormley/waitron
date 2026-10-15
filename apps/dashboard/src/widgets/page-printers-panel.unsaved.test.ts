import { afterEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { page, userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import { t } from "../i18n/t.js";
import type { PagePrinterRow } from "../api/client.js";
import {
  cleanupWidgets,
  closeReportsDelivered,
  mountWidget,
  reattachAfterDetachedUpdate,
} from "./test-helpers.js";
import "./page-printers-panel.js";

const row = (over: Partial<PagePrinterRow> = {}): PagePrinterRow => ({
  id: "pp1",
  name: "Office",
  host: "10.0.0.56",
  port: 631,
  resourcePath: "/ipp/print",
  documentFormat: "application/pdf",
  supportedFormats: ["application/pdf"],
  media: "iso_a4_210x297mm",
  resolutionDpi: 300,
  active: true,
  agentId: "a1",
  agentName: "Cocina agent",
  ...over,
});

class PanelLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly api = {
    updatePagePrinter: vi.fn().mockResolvedValue(undefined),
  };
  readonly reload = vi.fn().mockResolvedValue(undefined);
  rows = [row(), row({ id: "pp2", name: "Back office", host: "10.0.0.57" })];
  canManage = true;
  override render() {
    return html`<dashboard-page-printers-panel
        .api=${this.api}
        .rows=${this.rows}
        .canManage=${this.canManage}
        .reload=${this.reload}
      ></dashboard-page-printers-panel
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("page-printers-panel-leave-app", PanelLeaveApp);
afterEach(cleanupWidgets);

type Panel = HTMLElementTagNameMap["dashboard-page-printers-panel"];

async function mount() {
  const { el: app } = await mountWidget<PanelLeaveApp>("page-printers-panel-leave-app", {});
  const panel = app.shadowRoot!.querySelector("dashboard-page-printers-panel")!;
  await panel.updateComplete;
  return { app, panel };
}
function deepQuery(root: ShadowRoot | HTMLElement, sel: string): HTMLElement | null {
  const found = root.querySelector<HTMLElement>(sel);
  if (found) return found;
  for (const node of root.querySelectorAll<HTMLElement>("*")) {
    if (node.shadowRoot) {
      const nested = deepQuery(node.shadowRoot, sel);
      if (nested) return nested;
    }
  }
  return null;
}
const q = (panel: Panel, sel: string) => deepQuery(panel.shadowRoot!, sel);
const modal = (panel: Panel) =>
  q(panel, "[data-test=rename-page-printer-modal]") as unknown as HTMLElementTagNameMap["wt-modal"];
const nameField = (panel: Panel) =>
  q(
    panel,
    "[data-test=rename-page-printer-modal] wt-input[name=name]",
  ) as unknown as HTMLElementTagNameMap["wt-input"];
async function openRename(panel: Panel, id = "pp2") {
  q(panel, `[data-test=rename-page-printer-${id}]`)!.click();
  await panel.updateComplete;
  await modal(panel).updateComplete;
}
async function type(panel: Panel, value: string) {
  const field = nameField(panel);
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await panel.updateComplete;
}
async function question(app: PanelLeaveApp) {
  await app.updateComplete;
  const found = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await found.updateComplete;
  await found.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return found;
}
function cancel(panel: Panel) {
  q(panel, "[data-test=cancel-rename-page-printer]")!.click();
}

it("closing a rename with a typed name asks, keeps the name through Keep, and closes after Discard", async () => {
  const { app, panel } = await mount();
  await openRename(panel);
  await type(panel, "Upstairs");
  cancel(panel);
  const q1 = await question(app);
  expect(q1.open).toBe(true);
  q1.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q1.open).toBe(false);
  await closeReportsDelivered();
  expect(modal(panel).open).toBe(true);
  expect(nameField(panel).value).toBe("Upstairs");
  cancel(panel);
  await question(app);
  q1.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await expect.poll(() => modal(panel).open).toBe(false);
  await closeReportsDelivered();
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("closing an untouched rename does not ask, and a name typed back is no change", async () => {
  const { app, panel } = await mount();
  await openRename(panel);
  await type(panel, "Upstairs");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await type(panel, "Back office");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  cancel(panel);
  await expect.poll(() => modal(panel).open).toBe(false);
  expect((await question(app)).open).toBe(false);
});

it("a saved rename closes without asking", async () => {
  const { app, panel } = await mount();
  await openRename(panel);
  await type(panel, "Upstairs");
  q(panel, "[data-test=confirm-rename-page-printer]")!.click();
  await expect.poll(() => modal(panel).open).toBe(false);
  expect(app.api.updatePagePrinter).toHaveBeenCalledWith("pp2", { name: "Upstairs" });
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect((await question(app)).open).toBe(false);
});

it("a refused rename keeps the name as a change, so closing still asks", async () => {
  const { app, panel } = await mount();
  app.api.updatePagePrinter.mockRejectedValueOnce({ code: "page_printer.not_found" });
  await openRename(panel);
  await type(panel, "Upstairs");
  q(panel, "[data-test=confirm-rename-page-printer]")!.click();
  await expect.poll(() => app.api.updatePagePrinter.mock.calls.length).toBe(1);
  await panel.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(true);
  cancel(panel);
  expect((await question(app)).open).toBe(true);
});

it("a name typed before the panel is taken out of the page still counts once it is put back", async () => {
  const { app, panel } = await mount();
  await openRename(panel);
  await type(panel, "Upstairs");
  await reattachAfterDetachedUpdate(panel);
  expect(nameField(panel).value).toBe("Upstairs");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  cancel(panel);
  expect((await question(app)).open).toBe(true);
});

it("losing printer.manage drops an open rename from the unsaved-changes check", async () => {
  const { app, panel } = await mount();
  await openRename(panel);
  await type(panel, "Upstairs");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  app.canManage = false;
  app.requestUpdate();
  await app.updateComplete;
  await panel.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(false);
  const proceed = vi.fn();
  await app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed });
  expect(proceed).toHaveBeenCalledTimes(1);
  expect((await question(app)).open).toBe(false);
  app.canManage = true;
  app.requestUpdate();
  await app.updateComplete;
  await panel.updateComplete;
  expect(modal(panel).open).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
