import { afterEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { LeaveController, UrlStateController, registerIcons } from "@waitron/ui";
import type { DashboardApi, Printer } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { dashboardPath } from "../navigation.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { PrintersScreen } from "./printers-screen.js";

registerIcons(DASHBOARD_ICONS);
const printer: Printer = {
  id: "p1",
  name: "Kitchen",
  transport: "network_tcp",
  host: "10.0.0.9",
  port: 9100,
  localKey: null,
  pollId: null,
  paperWidth: "80mm",
  resolution: "180dpi",
  hasCashDrawer: false,
  portable: false,
  holder: null,
  pendingJobs: 0,
  lastPrintAt: null,
  lastPrintAgentId: null,
  active: true,
};
class InlinePrinterApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly url = new UrlStateController(this, () => {}, {
    ...dashboardPath,
    leave: {
      isDirty: () => this.leave.coordinator.isDirty(),
      request: (proceed, signal) =>
        this.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed, signal }),
    },
  });
  api!: DashboardApi;
  override render() {
    return html`<dashboard-printers-screen .api=${this.api}></dashboard-printers-screen
      >${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("inline-printer-leave-test-app", InlinePrinterApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
async function mount(overrides: Partial<DashboardApi> = {}) {
  setLocale("en-GB");
  history.replaceState(null, "", "/manage/printers/view/printers/printer/p1");
  const { el: app } = await mountWidget<InlinePrinterApp>("inline-printer-leave-test-app", {
    api: {
      listAgents: async () => [],
      listPrinters: async () => [printer],
      listRecentJobs: async () => [],
      listPrinterProfiles: async () => [],
      listDiscoveredPrinters: async () => [],
      pairingMode: async () => ({
        open: false,
        openUntil: null,
        deviceAddress: "https://waitron.local",
      }),
      joinRequests: async () => [],
      updatePrinter: async () => {},
      ...overrides,
    } as DashboardApi,
  });
  const screen = app.shadowRoot!.querySelector("dashboard-printers-screen")!;
  await expect.poll(() => q(screen, "[data-test=edit-printer-name]")).not.toBeNull();
  return { app, screen };
}
function q(screen: PrintersScreen, selector: string) {
  return screen.shadowRoot!.querySelector<HTMLElement>(selector);
}
function field(screen: PrintersScreen, owner: "name" | "connection") {
  return screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `[name=printer-detail-${owner === "name" ? "name" : "host"}]`,
  )!;
}
async function open(screen: PrintersScreen, owner: "name" | "connection") {
  q(screen, `[data-test=edit-printer-${owner}]`)!.click();
  await screen.updateComplete;
}
function change(screen: PrintersScreen, owner: "name" | "connection", value: string) {
  field(screen, owner).dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function choose(app: InlinePrinterApp, decision: "keep" | "discard") {
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => question.open).toBe(true);
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => question.open).toBe(false);
}
for (const owner of ["name", "connection"] as const) {
  for (const refuses of [false, true]) {
    it(`inline ${owner} departed ${refuses ? "refusal" : "success"} leaves a reopened editor alone`, async () => {
      let finish!: () => void;
      const { app, screen } = await mount({
        updatePrinter: async () => {
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          if (refuses) throw { code: "connection.failed" };
        },
      });
      await open(screen, owner);
      change(screen, owner, owner === "name" ? "Submitted" : "10.0.0.88");
      q(screen, `[data-test=save-printer-${owner}]`)!.click();
      await expect.poll(() => typeof finish).toBe("function");
      screen.remove();
      const reopened = new PrintersScreen();
      reopened.api = app.api;
      app.shadowRoot!.append(reopened);
      await expect.poll(() => q(reopened, "[data-test=edit-printer-name]")).not.toBeNull();
      await open(reopened, owner);
      change(reopened, owner, owner === "name" ? "Reopened" : "10.0.0.99");
      finish();
      await new Promise((resolve) => setTimeout(resolve, 20));
      await reopened.updateComplete;
      expect(field(reopened, owner).value).toBe(owner === "name" ? "Reopened" : "10.0.0.99");
      expect(field(reopened, owner).disabled).toBe(false);
      expect(unload()).toBe(true);
      change(reopened, owner, owner === "name" ? "Kitchen" : "10.0.0.9");
      expect(unload()).toBe(false);
    });
  }
  const original = owner === "name" ? "Kitchen" : "10.0.0.9";
  const edited = owner === "name" ? "New kitchen" : "10.0.0.88";
  it(`inline ${owner} protects unload and shared Cancel decisions, then reopens saved values`, async () => {
    const { app, screen } = await mount();
    await open(screen, owner);
    expect(unload()).toBe(false);
    change(screen, owner, edited);
    expect(unload()).toBe(true);
    q(screen, `[data-test=cancel-printer-${owner}]`)!.click();
    await choose(app, "keep");
    expect(field(screen, owner).value).toBe(edited);
    expect(unload()).toBe(true);
    q(screen, `[data-test=cancel-printer-${owner}]`)!.click();
    await choose(app, "discard");
    await expect.poll(() => field(screen, owner)).toBeNull();
    expect(unload()).toBe(false);
    await open(screen, owner);
    expect(field(screen, owner).value).toBe(original);
  });
  it(`inline ${owner} treats normalized reverts as clean`, async () => {
    const { app, screen } = await mount();
    await open(screen, owner);
    change(screen, owner, edited);
    expect(unload()).toBe(true);
    change(screen, owner, `  ${original}  `);
    expect(unload()).toBe(false);
    q(screen, `[data-test=cancel-printer-${owner}]`)!.click();
    await expect.poll(() => field(screen, owner)).toBeNull();
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  });
}

for (const owner of ["name", "connection"] as const) {
  it(`inline ${owner} success clears only the submitted owner before a failed refresh`, async () => {
    let reads = 0;
    let dirtyAtRefresh: boolean | undefined;
    let body: unknown;
    const { screen } = await mount({
      listPrinters: async () => {
        if (++reads === 1) return [printer];
        dirtyAtRefresh = unload();
        throw { code: "connection.failed" };
      },
      updatePrinter: async (_id, submitted) => {
        body = submitted;
      },
    });
    await open(screen, owner);
    change(screen, owner, owner === "name" ? "  New kitchen  " : "10.0.0.88");
    q(screen, `[data-test=save-printer-${owner}]`)!.click();
    await expect.poll(() => dirtyAtRefresh).toBe(false);
    expect(body).toEqual(
      owner === "name" ? { name: "New kitchen" } : { host: "10.0.0.88", port: 9100 },
    );
    expect(field(screen, owner)).toBeNull();
  });
  it(`inline ${owner} retains newer input after success and commits the submitted baseline`, async () => {
    let finish!: () => void;
    const { screen } = await mount({
      updatePrinter: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    });
    await open(screen, owner);
    const submitted = owner === "name" ? "Submitted" : "10.0.0.88";
    const newer = owner === "name" ? "Newer" : "10.0.0.99";
    change(screen, owner, submitted);
    q(screen, `[data-test=save-printer-${owner}]`)!.click();
    await expect.poll(() => field(screen, owner).disabled).toBe(true);
    change(screen, owner, newer);
    finish();
    await expect.poll(() => field(screen, owner)?.disabled).toBe(false);
    expect(field(screen, owner).value).toBe(newer);
    expect(unload()).toBe(true);
    change(screen, owner, submitted);
    expect(unload()).toBe(false);
  });
  it(`inline ${owner} refusal preserves edits and unload protection`, async () => {
    let refuse!: (reason: unknown) => void;
    const { app, screen } = await mount({
      updatePrinter: () =>
        new Promise<void>((_, reject) => {
          refuse = reject;
        }),
    });
    await open(screen, owner);
    const newer = owner === "name" ? "Newer" : "10.0.0.99";
    change(screen, owner, owner === "name" ? "Submitted" : "10.0.0.88");
    q(screen, `[data-test=save-printer-${owner}]`)!.click();
    await expect.poll(() => field(screen, owner).disabled).toBe(true);
    change(screen, owner, newer);
    refuse({ code: "connection.failed" });
    await expect.poll(() => field(screen, owner).disabled).toBe(false);
    expect(field(screen, owner).value).toBe(newer);
    expect(unload()).toBe(true);
    q(screen, `[data-test=cancel-printer-${owner}]`)!.click();
    await choose(app, "keep");
  });
}
it("saving a printer name leaves the independently edited connection protected", async () => {
  const { screen } = await mount();
  await open(screen, "name");
  await open(screen, "connection");
  change(screen, "name", "New kitchen");
  change(screen, "connection", "10.0.0.88");
  q(screen, "[data-test=save-printer-name]")!.click();
  await expect.poll(() => field(screen, "name")).toBeNull();
  expect(field(screen, "connection").value).toBe("10.0.0.88");
  expect(unload()).toBe(true);
});

for (const owner of ["name", "connection"] as const) {
  for (const route of ["breadcrumb", "back"] as const) {
    it(`inline ${owner} ${route} preserves route and draft on Keep, leaves once on Discard`, async () => {
      const { app, screen } = await mount();
      await app.url.write({ printer: null });
      await app.url.write({ printer: "p1" });
      await expect.poll(() => q(screen, "[data-test=edit-printer-name]")).not.toBeNull();
      await open(screen, owner);
      const edited = owner === "name" ? "Edited" : "10.0.0.88";
      change(screen, owner, edited);
      const leave = () => {
        if (route === "back") history.back();
        else q(screen, "[data-test=all-printers-link]")!.click();
      };
      leave();
      await choose(app, "keep");
      expect(location.pathname).toBe("/manage/printers/view/printers/printer/p1");
      expect(field(screen, owner).value).toBe(edited);
      expect(unload()).toBe(true);
      leave();
      await choose(app, "discard");
      await expect.poll(() => location.pathname).toBe("/manage/printers/view/printers");
      await expect.poll(() => q(screen, "[data-test=printer-status]")).toBeNull();
      expect(unload()).toBe(false);
    });
  }
}

for (const owner of ["name", "connection"] as const) {
  it(`inline ${owner} ignores a detached field from an earlier opening of the same printer`, async () => {
    const { screen } = await mount();
    await open(screen, owner);
    const old = field(screen, owner);
    q(screen, `[data-test=cancel-printer-${owner}]`)!.click();
    await expect.poll(() => field(screen, owner)).toBeNull();
    await open(screen, owner);
    old.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "stale edit" } }));
    await screen.updateComplete;
    expect(field(screen, owner).value).toBe(owner === "name" ? "Kitchen" : "10.0.0.9");
    expect(unload()).toBe(false);
  });
}

it("an inline port-only edit protects leaving, normalizes a revert and sends an explicit cleared port", async () => {
  let submitted: unknown;
  const { screen } = await mount({
    updatePrinter: async (_id, body) => {
      submitted = body;
    },
  });
  await open(screen, "connection");
  const port = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    "[name=printer-detail-port]",
  )!;
  const changePort = (value: string) =>
    port.dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  changePort("9101");
  expect(unload()).toBe(true);
  changePort("09100");
  expect(unload()).toBe(false);
  changePort("");
  expect(unload()).toBe(true);
  q(screen, "[data-test=save-printer-connection]")!.click();
  await expect.poll(() => submitted).toEqual({ host: "10.0.0.9", port: null });
  await expect.poll(() => field(screen, "connection")).toBeNull();
  expect(unload()).toBe(false);
});
