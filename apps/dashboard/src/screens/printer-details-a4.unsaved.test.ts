import { afterEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { page, userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import { t } from "../i18n/t.js";
import type { DashboardApi, PagePrinterRow } from "../api/client.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "../widgets/test-helpers.js";
import { PrintersScreen } from "./printers-screen.js";

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
  agentName: "Kitchen agent",
  ...over,
});

class A4DetailsLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly api = {
    listAgents: async () => [],
    listPrinters: async () => [],
    listRecentJobs: async () => [],
    listPrinterProfiles: async () => [],
    listPrinterStationNames: async () => [],
    listDiscoveredPrinters: async () => [],
    listPagePrinters: vi
      .fn()
      .mockResolvedValue([row(), row({ id: "pp2", name: "Back office", host: "10.0.0.57" })]),
    pairingMode: async () => ({
      open: false,
      openUntil: null,
      deviceAddress: "https://waitron.local",
    }),
    joinRequests: async () => [],
    updatePagePrinter: vi.fn().mockResolvedValue(undefined),
  };
  canManage = true;
  override render() {
    return html`<dashboard-printers-screen
        .api=${this.api as unknown as DashboardApi}
        .canManage=${this.canManage}
      ></dashboard-printers-screen
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("printer-details-a4-leave-app", A4DetailsLeaveApp);
afterEach(cleanupWidgets);

type Screen = HTMLElementTagNameMap["dashboard-printers-screen"];

async function mount() {
  history.replaceState(null, "", "/manage/printers/view/printers/printer/pp2");
  const { el: app } = await mountWidget<A4DetailsLeaveApp>("printer-details-a4-leave-app", {});
  const screen = app.shadowRoot!.querySelector("dashboard-printers-screen")!;
  await expect.poll(() => q(screen, "[data-test=edit-page-printer-details]")).not.toBeNull();
  return { app, screen };
}
const q = (screen: Screen, sel: string) => screen.shadowRoot!.querySelector<HTMLElement>(sel);
const nameField = (screen: Screen) =>
  q(screen, "wt-input[name=printer-detail-name]") as unknown as HTMLElementTagNameMap["wt-input"];
const editing = (screen: Screen) => nameField(screen) !== null;
async function openRename(screen: Screen) {
  q(screen, "[data-test=edit-page-printer-details]")!.click();
  await screen.updateComplete;
  await nameField(screen).updateComplete;
}
async function type(screen: Screen, value: string) {
  const field = nameField(screen);
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await screen.updateComplete;
}
async function question(app: A4DetailsLeaveApp) {
  await app.updateComplete;
  const found = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await found.updateComplete;
  await found.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return found;
}
function cancel(screen: Screen) {
  q(screen, "[data-test=cancel-printer-details]")!.click();
}

it("closing a rename with a typed name asks, keeps the name through Keep, and closes after Discard", async () => {
  const { app, screen } = await mount();
  await openRename(screen);
  await type(screen, "Upstairs");
  cancel(screen);
  const q1 = await question(app);
  expect(q1.open).toBe(true);
  q1.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q1.open).toBe(false);
  await closeReportsDelivered();
  expect(editing(screen)).toBe(true);
  expect(nameField(screen).value).toBe("Upstairs");
  cancel(screen);
  await question(app);
  q1.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await expect.poll(() => editing(screen)).toBe(false);
  await closeReportsDelivered();
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("closing an untouched rename does not ask, and a name typed back is no change", async () => {
  const { app, screen } = await mount();
  await openRename(screen);
  await type(screen, "Upstairs");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await type(screen, "Back office");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  cancel(screen);
  await expect.poll(() => editing(screen)).toBe(false);
  expect((await question(app)).open).toBe(false);
});

it("a saved rename closes without asking", async () => {
  const { app, screen } = await mount();
  await openRename(screen);
  await type(screen, "Upstairs");
  q(screen, "[data-test=save-printer-details]")!.click();
  await expect.poll(() => editing(screen)).toBe(false);
  expect(app.api.updatePagePrinter).toHaveBeenCalledWith("pp2", { name: "Upstairs" });
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect((await question(app)).open).toBe(false);
});

it("a refused rename keeps the name as a change, so closing still asks", async () => {
  const { app, screen } = await mount();
  app.api.updatePagePrinter.mockRejectedValueOnce({ code: "page_printer.not_found" });
  await openRename(screen);
  await type(screen, "Upstairs");
  q(screen, "[data-test=save-printer-details]")!.click();
  await expect.poll(() => app.api.updatePagePrinter.mock.calls.length).toBe(1);
  await screen.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(true);
  cancel(screen);
  expect((await question(app)).open).toBe(true);
});

it("losing hardware.manage drops an open rename from the unsaved-changes check", async () => {
  const { app, screen } = await mount();
  await openRename(screen);
  await type(screen, "Upstairs");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  app.canManage = false;
  app.requestUpdate();
  await app.updateComplete;
  await screen.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(false);
  const proceed = vi.fn();
  await app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed });
  expect(proceed).toHaveBeenCalledTimes(1);
  expect((await question(app)).open).toBe(false);
  app.canManage = true;
  app.requestUpdate();
  await app.updateComplete;
  await screen.updateComplete;
  expect(editing(screen)).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

for (const refuses of [false, true]) {
  it(`a departed name ${refuses ? "refusal" : "success"} leaves a reopened form alone`, async () => {
    let finish!: () => void;
    const { app, screen } = await mount();
    app.api.updatePagePrinter.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      if (refuses) throw { code: "connection.failed" };
    });
    await openRename(screen);
    await type(screen, "Submitted");
    q(screen, "[data-test=save-printer-details]")!.click();
    await expect.poll(() => typeof finish).toBe("function");
    screen.remove();
    const reopened = new PrintersScreen();
    reopened.api = app.api as unknown as DashboardApi;
    reopened.canManage = true;
    app.shadowRoot!.append(reopened);
    await expect.poll(() => q(reopened, "[data-test=edit-page-printer-details]")).not.toBeNull();
    await openRename(reopened);
    await type(reopened, "Reopened");
    finish();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await reopened.updateComplete;
    expect(nameField(reopened).value).toBe("Reopened");
    expect(nameField(reopened).disabled).toBe(false);
    expect(app.leave.coordinator.isDirty()).toBe(true);
    await type(reopened, "Back office");
    expect(app.leave.coordinator.isDirty()).toBe(false);
  });
}
