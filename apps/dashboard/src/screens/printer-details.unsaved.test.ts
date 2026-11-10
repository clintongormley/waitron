import { afterEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { LeaveController, UrlStateController, registerIcons } from "@waitron/ui";
import type { DashboardApi, Printer } from "../api/client.js";
import { LiveData } from "@waitron/dashboard-kit";
import { DASHBOARD_ICONS } from "../icons.js";
import { dashboardPath } from "../navigation.js";
import { setLocale, t } from "../i18n/t.js";
import {
  cancelDetailsEdit,
  cleanupWidgets,
  mountWidget,
  saveDetailsEdit,
} from "../widgets/test-helpers.js";
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
  pickupRoles: ["receipt", "payment_slip"],
  holder: null,
  pendingJobs: 0,
  lastPrintAt: null,
  lastPrintAgentId: null,
  active: true,
};
class PrinterDetailsApp extends LitElement {
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
customElements.define("printer-details-leave-test-app", PrinterDetailsApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
async function mount(overrides: Partial<DashboardApi> = {}) {
  setLocale("en-GB");
  history.replaceState(null, "", "/manage/printers/view/printers/printer/p1");
  const { el: app } = await mountWidget<PrinterDetailsApp>("printer-details-leave-test-app", {
    api: {
      listAgents: async () => [],
      listPrinters: async () => [printer],
      listRecentJobs: async () => [],
      listPrinterProfiles: async () => [],
      listPrinterStationNames: async () => [],
      listDiscoveredPrinters: async () => [],
      listPagePrinters: async () => [],
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
  await expect.poll(() => q(screen, "[data-test=edit-printer-details]")).not.toBeNull();
  return { app, screen };
}
function q(screen: PrintersScreen, selector: string) {
  return screen.shadowRoot!.querySelector<HTMLElement>(selector);
}
type Field = "name" | "host";
function field(screen: PrintersScreen, name: Field | "port") {
  return screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `[name=printer-detail-${name}]`,
  )!;
}
async function open(screen: PrintersScreen) {
  q(screen, "[data-test=edit-printer-details]")!.click();
  await screen.updateComplete;
}
function change(screen: PrintersScreen, name: Field | "port", value: string) {
  field(screen, name).dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function choose(app: PrinterDetailsApp, decision: "keep" | "discard") {
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => question.open).toBe(true);
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => question.open).toBe(false);
}
const saved: Record<Field, string> = { name: "Kitchen", host: "10.0.0.9" };

for (const owner of ["name", "host"] as const) {
  for (const refuses of [false, true]) {
    it(`a departed ${owner} ${refuses ? "refusal" : "success"} leaves a reopened form alone`, async () => {
      let finish!: () => void;
      const { app, screen } = await mount({
        updatePrinter: async () => {
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          if (refuses) throw { code: "connection.failed" };
        },
      });
      await open(screen);
      change(screen, owner, owner === "name" ? "Submitted" : "10.0.0.88");
      saveDetailsEdit(screen);
      await expect.poll(() => typeof finish).toBe("function");
      screen.remove();
      const reopened = new PrintersScreen();
      reopened.api = app.api;
      app.shadowRoot!.append(reopened);
      await expect.poll(() => q(reopened, "[data-test=edit-printer-details]")).not.toBeNull();
      await open(reopened);
      change(reopened, owner, owner === "name" ? "Reopened" : "10.0.0.99");
      finish();
      await new Promise((resolve) => setTimeout(resolve, 20));
      await reopened.updateComplete;
      expect(field(reopened, owner).value).toBe(owner === "name" ? "Reopened" : "10.0.0.99");
      expect(field(reopened, owner).disabled).toBe(false);
      expect(unload()).toBe(true);
      change(reopened, owner, saved[owner]);
      expect(unload()).toBe(false);
    });
  }
  const edited = owner === "name" ? "New kitchen" : "10.0.0.88";
  it(`a ${owner} edit protects navigation and Cancel reopens saved values without asking`, async () => {
    const { app, screen } = await mount();
    await open(screen);
    expect(unload()).toBe(false);
    change(screen, owner, edited);
    expect(unload()).toBe(true);
    void app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed() {} });
    await choose(app, "keep");
    expect(field(screen, owner).value).toBe(edited);
    expect(unload()).toBe(true);
    cancelDetailsEdit(screen);
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    await expect.poll(() => field(screen, owner)).toBeNull();
    expect(unload()).toBe(false);
    await open(screen);
    expect(field(screen, owner).value).toBe(saved[owner]);
  });
  it(`a ${owner} edit reverted with spaces around it is clean`, async () => {
    const { app, screen } = await mount();
    await open(screen);
    change(screen, owner, edited);
    expect(unload()).toBe(true);
    change(screen, owner, `  ${saved[owner]}  `);
    expect(unload()).toBe(false);
    cancelDetailsEdit(screen);
    await expect.poll(() => field(screen, owner)).toBeNull();
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  });
  it(`a ${owner} save's success clears the draft before a failed refresh`, async () => {
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
    await open(screen);
    change(screen, owner, owner === "name" ? "  New kitchen  " : "10.0.0.88");
    saveDetailsEdit(screen);
    await expect.poll(() => dirtyAtRefresh).toBe(false);
    expect(body).toEqual(
      owner === "name" ? { name: "New kitchen" } : { host: "10.0.0.88", port: 9100 },
    );
    expect(field(screen, owner)).toBeNull();
  });
  it(`a ${owner} typed during the save stays dirty against the submitted value`, async () => {
    let finish!: () => void;
    const { screen } = await mount({
      updatePrinter: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    });
    await open(screen);
    const submitted = owner === "name" ? "Submitted" : "10.0.0.88";
    const newer = owner === "name" ? "Newer" : "10.0.0.99";
    change(screen, owner, submitted);
    saveDetailsEdit(screen);
    await expect.poll(() => field(screen, owner).disabled).toBe(true);
    change(screen, owner, newer);
    finish();
    await expect.poll(() => field(screen, owner)?.disabled).toBe(false);
    expect(field(screen, owner).value).toBe(newer);
    expect(unload()).toBe(true);
    change(screen, owner, submitted);
    expect(unload()).toBe(false);
  });
  it(`a refused ${owner} save keeps the edits and unload protection`, async () => {
    let refuse!: (reason: unknown) => void;
    const { app, screen } = await mount({
      updatePrinter: () =>
        new Promise<void>((_, reject) => {
          refuse = reject;
        }),
    });
    await open(screen);
    const newer = owner === "name" ? "Newer" : "10.0.0.99";
    change(screen, owner, owner === "name" ? "Submitted" : "10.0.0.88");
    saveDetailsEdit(screen);
    await expect.poll(() => field(screen, owner).disabled).toBe(true);
    change(screen, owner, newer);
    refuse({ code: "connection.failed" });
    await expect.poll(() => field(screen, owner).disabled).toBe(false);
    expect(field(screen, owner).value).toBe(newer);
    expect(unload()).toBe(true);
    void app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed() {} });
    await choose(app, "keep");
  });
}

it("draws no Used by link while editing, so no link can leave a draft", async () => {
  const { screen } = await mount({
    listPrinterProfiles: async () => [
      {
        printerId: "p1",
        pagePrinterId: null,
        profileId: "dp1",
        profileName: "Waiters",
        roles: ["receipt"],
        departmentId: "d1",
        departmentName: "Dining room",
      },
    ],
  });
  screen.canOpen = () => true;
  await screen.updateComplete;
  expect(q(screen, "[data-test=printer-section-used-by] a")).not.toBeNull();
  await open(screen);
  change(screen, "name", "Bar");
  await screen.updateComplete;
  expect(q(screen, "[data-test=printer-section-used-by]")).toBeNull();
  expect(q(screen, "[data-test=printer-details-body] a")).toBeNull();
});

it("a save whose refresh fails shows the failed read and its retry inside the details window", async () => {
  let reads = 0;
  const { screen } = await mount({
    listPrinters: async () => {
      if (++reads === 1) return [printer];
      throw { code: "connection.failed" };
    },
  });
  await open(screen);
  change(screen, "name", "New kitchen");
  saveDetailsEdit(screen);
  await expect.poll(() => reads).toBe(2);
  await expect
    .poll(() => q(screen, "[data-test=printer-details-body] [data-test=printer-refresh-error]"))
    .not.toBeNull();
  expect(screen.shadowRoot!.querySelectorAll("[data-test=printer-refresh-error]")).toHaveLength(1);
  expect(
    q(screen, "[data-test=printer-details-body] [data-test=refresh-printer-lists]"),
  ).not.toBeNull();
});

it("a save whose refresh fails keeps both fields' newer input dirty", async () => {
  let finish!: () => void;
  let reads = 0;
  const { screen } = await mount({
    listPrinters: async () => {
      if (++reads === 1) return [printer];
      throw { code: "connection.failed" };
    },
    updatePrinter: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  });
  await open(screen);
  change(screen, "name", "Submitted");
  change(screen, "host", "10.0.0.88");
  saveDetailsEdit(screen);
  await expect.poll(() => field(screen, "name").disabled).toBe(true);
  change(screen, "name", "Newer");
  change(screen, "host", "10.0.0.99");
  finish();
  await expect.poll(() => reads).toBe(2);
  await expect.poll(() => field(screen, "name")?.disabled).toBe(false);
  expect(field(screen, "name").value).toBe("Newer");
  expect(field(screen, "host").value).toBe("10.0.0.99");
  expect(unload()).toBe(true);
  change(screen, "name", "Submitted");
  expect(unload()).toBe(true);
  change(screen, "host", "10.0.0.88");
  expect(unload()).toBe(false);
});

it("a Save whose draft a live change has made equal to the printer sends nothing and shows the details", async () => {
  const liveData = new LiveData();
  let current: Printer = printer;
  let sent = 0;
  const { screen } = await mount({
    liveData,
    listPrinters: async () => [current],
    updatePrinter: async () => {
      sent++;
    },
  } as Partial<DashboardApi>);
  await open(screen);
  change(screen, "name", "New kitchen");
  current = { ...printer, name: "New kitchen" };
  liveData.invalidate([{ type: "printers", id: "p1" }]);
  await expect
    .poll(() => q(screen, "[data-test=printer-details-modal]")?.getAttribute("heading"))
    .toBe("New kitchen");
  const save = q(screen, "[data-test=save-printer-details]") as HTMLElementTagNameMap["wt-button"];
  expect(save.disabled).toBe(false);
  save.click();
  await expect.poll(() => q(screen, "[data-test=printer-details-form]")).toBeNull();
  expect(q(screen, "[data-test=edit-printer-details]")).not.toBeNull();
  expect(sent).toBe(0);
  expect(unload()).toBe(false);
});

for (const owner of ["name", "host"] as const) {
  const other = owner === "name" ? "host" : "name";
  it(`a ${owner}-only Save keeps the ${other} another session changed while the form was open`, async () => {
    const liveData = new LiveData();
    let current: Printer = printer;
    let reads = 0;
    let submitted: unknown;
    const { screen } = await mount({
      liveData,
      listPrinters: async () => {
        reads++;
        return [current];
      },
      updatePrinter: async (_id, body) => {
        submitted = body;
      },
    } as Partial<DashboardApi>);
    await open(screen);
    change(screen, owner, owner === "name" ? "New kitchen" : "10.0.0.88");
    current =
      owner === "name" ? { ...printer, host: "10.0.0.77" } : { ...printer, name: "Remote name" };
    const before = reads;
    liveData.invalidate([{ type: "printers", id: "p1" }]);
    await expect.poll(() => reads).toBeGreaterThan(before);
    await screen.updateComplete;
    saveDetailsEdit(screen);
    await expect.poll(() => submitted).not.toBeUndefined();
    expect(submitted).toEqual(
      owner === "name" ? { name: "New kitchen" } : { host: "10.0.0.88", port: 9100 },
    );
  });
}

for (const owner of ["name", "host"] as const) {
  for (const route of ["close", "back", "navigation"] as const) {
    it(`a ${owner} edit: leaving by ${route} keeps the window and draft on Keep, leaves once on Discard`, async () => {
      const { app, screen } = await mount();
      await app.url.write({ printer: null });
      await app.url.write({ printer: "p1" });
      await expect.poll(() => q(screen, "[data-test=edit-printer-details]")).not.toBeNull();
      await open(screen);
      const edited = owner === "name" ? "Edited" : "10.0.0.88";
      change(screen, owner, edited);
      const leave = () => {
        if (route === "back") history.back();
        else if (route === "navigation")
          void app.url.write({ dashboard: "devices", view: null, printer: null });
        else
          void (
            q(screen, "[data-test=printer-details-modal]") as HTMLElementTagNameMap["wt-modal"]
          ).requestClose("escape");
      };
      leave();
      await choose(app, "keep");
      expect(location.pathname).toBe("/manage/printers/view/printers/printer/p1");
      expect(field(screen, owner).value).toBe(edited);
      expect(unload()).toBe(true);
      leave();
      await choose(app, "discard");
      await expect
        .poll(() => location.pathname)
        .toBe(route === "navigation" ? "/manage/devices" : "/manage/printers/view/printers");
      if (route !== "navigation")
        await expect.poll(() => q(screen, "[data-test=printer-details-form]")).toBeNull();
      expect(unload()).toBe(false);
      expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    });
  }
}

for (const owner of ["name", "host"] as const) {
  it(`a detached ${owner} field from an earlier opening of the same printer changes nothing`, async () => {
    const { screen } = await mount();
    await open(screen);
    const old = field(screen, owner);
    cancelDetailsEdit(screen);
    await expect.poll(() => field(screen, owner)).toBeNull();
    await open(screen);
    old.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "stale edit" } }));
    await screen.updateComplete;
    expect(field(screen, owner).value).toBe(saved[owner]);
    expect(unload()).toBe(false);
  });
}

it("a port-only edit protects leaving, treats 09100 as 9100 and sends an explicit cleared port", async () => {
  let submitted: unknown;
  const { screen } = await mount({
    updatePrinter: async (_id, body) => {
      submitted = body;
    },
  });
  await open(screen);
  change(screen, "port", "9101");
  expect(unload()).toBe(true);
  change(screen, "port", "09100");
  expect(unload()).toBe(false);
  change(screen, "port", "");
  expect(unload()).toBe(true);
  saveDetailsEdit(screen);
  await expect.poll(() => submitted).toEqual({ host: "10.0.0.9", port: null });
  await expect.poll(() => field(screen, "host")).toBeNull();
  expect(unload()).toBe(false);
});
