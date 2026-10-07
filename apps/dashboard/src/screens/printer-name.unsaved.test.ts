import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, registerIcons, type WtModal } from "@waitron/ui";
import type { DashboardApi, DiscoveredPrinter } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { PrintersScreen } from "./printers-screen.js";

registerIcons(DASHBOARD_ICONS);
const device: DiscoveredPrinter = {
  agentId: "a1",
  agentName: "Kitchen box",
  transport: "usb",
  localKey: "SN-1",
  name: "Kitchen printer",
  make: "Epson",
  model: "TM-T20",
  alreadyRegistered: false,
  printerId: null,
  lastSeenAt: "2026-10-06T00:00:00.000Z",
};
const other = { ...device, localKey: "SN-2", name: "Bar printer" };
class PrinterNameLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
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
customElements.define("printer-name-leave-test-app", PrinterNameLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
function q(screen: PrintersScreen, selector: string): HTMLElement | null {
  function find(root: ShadowRoot | HTMLElement): HTMLElement | null {
    const found = root.querySelector<HTMLElement>(selector);
    if (found) return found;
    for (const child of root.querySelectorAll<HTMLElement>("*")) {
      if (child.shadowRoot) {
        const nested = find(child.shadowRoot);
        if (nested) return nested;
      }
    }
    return null;
  }
  return find(screen.shadowRoot!);
}
async function mount(overrides: Partial<DashboardApi> = {}) {
  setLocale("en-GB");
  const { el: app } = await mountWidget<PrinterNameLeaveApp>("printer-name-leave-test-app", {
    api: {
      listAgents: async () => [],
      listPrinters: async () => [],
      listRecentJobs: async () => [],
      listPrinterProfiles: async () => [],
      pairingMode: async () => ({
        open: false,
        openUntil: null,
        deviceAddress: "https://waitron.local",
      }),
      joinRequests: async () => [],
      listDiscoveredPrinters: async () => [device, other],
      startPrinterDiscovery: async () => {},
      renewPrinterDiscovery: async () => {},
      createPrinter: async () => ({ id: "p1" }),
      ...overrides,
    } as DashboardApi,
  });
  const screen = app.shadowRoot!.querySelector("dashboard-printers-screen")!;
  await expect.poll(() => q(screen, "[data-test=open-add-printer]")).not.toBeNull();
  q(screen, "[data-test=open-add-printer]")!.click();
  await expect.poll(() => q(screen, "[data-test=register-SN-1]")).not.toBeNull();
  await open(screen, "SN-1");
  return { app, screen };
}
async function open(screen: PrintersScreen, id: string) {
  q(screen, `[data-test=register-${id}]`)!.click();
  await screen.updateComplete;
  await modal(screen)!.updateComplete;
}
function modal(screen: PrintersScreen) {
  return q(screen, "[data-test=name-printer-modal]") as WtModal | null;
}
function input(screen: PrintersScreen) {
  return q(screen, "[data-test=discovered-name-SN-1]") as HTMLElementTagNameMap["wt-input"];
}
function change(screen: PrintersScreen, value: string) {
  input(screen).dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
}
function unload() {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}
async function choose(app: PrinterNameLeaveApp, decision: "keep" | "discard") {
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => question.open).toBe(true);
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => question.open).toBe(false);
}

for (const route of ["cancel", "escape", "parent"] as const) {
  it(`printer name ${route} keeps edits and focus until Discard`, async () => {
    const { app, screen } = await mount();
    change(screen, "New kitchen");
    await screen.updateComplete;
    await input(screen).updateComplete;
    const native = input(screen).shadowRoot!.querySelector("input")!;
    native.focus();
    let closes = 0;
    modal(screen)!.addEventListener("wt-close", () => closes++);
    const dismiss = async () => {
      if (route === "escape") await userEvent.keyboard("{Escape}");
      else if (route === "parent") q(screen, "[data-test=cancel-new-printer]")!.click();
      else q(screen, "[data-test=cancel-printer-name]")!.click();
    };
    await dismiss();
    await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
    expect(modal(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    await choose(app, "keep");
    expect(input(screen).value).toBe("New kitchen");
    expect(closes).toBe(0);
    await expect.poll(() => input(screen).shadowRoot!.activeElement).toBe(native);
    await dismiss();
    await choose(app, "discard");
    await expect.poll(() => modal(screen)).toBeNull();
    if (route !== "parent") expect(closes).toBe(1);
    expect(unload()).toBe(false);
    if (route !== "parent") {
      await open(screen, "SN-1");
      expect(input(screen).value).toBe("Kitchen printer");
    }
  });
}
it("printer name normalized reverts close directly and unchanged parent stays direct", async () => {
  const { app, screen } = await mount();
  expect(unload()).toBe(false);
  change(screen, "New kitchen");
  expect(unload()).toBe(true);
  change(screen, "  Kitchen printer  ");
  expect(unload()).toBe(false);
  q(screen, "[data-test=cancel-printer-name]")!.click();
  await expect.poll(() => modal(screen)).toBeNull();
  expect(q(screen, "[data-test=new-printer-modal]")).not.toBeNull();
  q(screen, "[data-test=cancel-new-printer]")!.click();
  await expect.poll(() => q(screen, "[data-test=new-printer-modal]")).toBeNull();
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
});
it("a refused registration keeps the disabled-while-writing name dirty", async () => {
  let refuse!: (reason: unknown) => void;
  const { app, screen } = await mount({
    createPrinter: () =>
      new Promise((_, reject) => {
        refuse = reject;
      }),
  });
  change(screen, "New kitchen");
  q(screen, "[data-test=confirm-add-printer]")!.click();
  await screen.updateComplete;
  expect(input(screen).disabled).toBe(true);
  refuse({ code: "connection.failed" });
  await expect.poll(() => input(screen).disabled).toBe(false);
  expect(input(screen).value).toBe("New kitchen");
  expect(unload()).toBe(true);
  q(screen, "[data-test=cancel-printer-name]")!.click();
  await choose(app, "keep");
});
for (const route of ["cancel", "escape"] as const) {
  it(`registration in flight retains its existing ${route} and completed result`, async () => {
    let finish!: (value: { id: string }) => void;
    const { app, screen } = await mount({
      createPrinter: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    change(screen, "New kitchen");
    q(screen, "[data-test=confirm-add-printer]")!.click();
    await screen.updateComplete;
    expect(input(screen).disabled).toBe(true);
    expect(modal(screen)!.dismissible).toBe(true);
    if (route === "cancel") q(screen, "[data-test=cancel-printer-name]")!.click();
    else await userEvent.keyboard("{Escape}");
    await expect.poll(() => modal(screen)).toBeNull();
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    expect(unload()).toBe(false);
    finish({ id: "p1" });
    await expect.poll(() => q(screen, "[data-test=edit-printer-modal]")).not.toBeNull();
  });
}
it("registration commits the submitted name before a refused refresh without asking", async () => {
  let reads = 0;
  let dirtyAtRefresh: boolean | undefined;
  let received: unknown;
  const { app, screen } = await mount({
    listPrinters: async () => {
      if (++reads === 1) return [];
      dirtyAtRefresh = unload();
      throw { code: "connection.failed" };
    },
    createPrinter: async (body) => {
      received = body;
      return { id: "p1" };
    },
  });
  change(screen, "  Saved kitchen  ");
  expect(unload()).toBe(true);
  q(screen, "[data-test=confirm-add-printer]")!.click();
  await expect.poll(() => dirtyAtRefresh).toBe(false);
  expect(received).toEqual({ name: "Saved kitchen", transport: "usb", localKey: "SN-1" });
  expect(modal(screen)).toBeNull();
  expect(q(screen, "[data-test=edit-printer-modal]")).not.toBeNull();
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(q(screen, "[data-test=printer-refresh-error]")?.textContent).toContain(
    t("printers.refresh_failed"),
  );
});
it("newer delivered input stays dirty against registered name without repeating registration", async () => {
  let finish!: (value: { id: string }) => void;
  let calls = 0;
  const { screen } = await mount({
    createPrinter: () => {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  change(screen, "Saved kitchen");
  q(screen, "[data-test=confirm-add-printer]")!.click();
  await screen.updateComplete;
  change(screen, "Newer kitchen");
  finish({ id: "p1" });
  await expect.poll(() => input(screen)?.disabled).toBe(false);
  expect(modal(screen)!.open).toBe(true);
  expect(input(screen).value).toBe("Newer kitchen");
  expect(unload()).toBe(true);
  change(screen, "Saved kitchen");
  expect(unload()).toBe(false);
  q(screen, "[data-test=confirm-add-printer]")!.click();
  expect(calls).toBe(1);
});
it("changing the named printer invalidates the old decision", async () => {
  const { app, screen } = await mount();
  change(screen, "New kitchen");
  q(screen, "[data-test=cancel-printer-name]")!.click();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  await open(screen, "SN-2");
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(q(screen, "[data-test=discovered-name-SN-2]")!.getAttribute("name")).toBe(
    "new-printer-name",
  );
  expect(
    (q(screen, "[data-test=discovered-name-SN-2]") as HTMLElementTagNameMap["wt-input"]).value,
  ).toBe("Bar printer");
  expect(unload()).toBe(false);
});
for (const result of ["success", "refusal"] as const) {
  it(`a disconnected registration ${result} cannot reopen or mark a departed screen`, async () => {
    let reads = 0;
    let finish!: (value: { id: string }) => void;
    let refuse!: (reason: unknown) => void;
    const { app, screen } = await mount({
      listPrinters: async () => {
        reads++;
        return [];
      },
      createPrinter: () =>
        new Promise((resolve, reject) => {
          finish = resolve;
          refuse = reject;
        }),
    });
    change(screen, "New kitchen");
    expect(unload()).toBe(true);
    q(screen, "[data-test=confirm-add-printer]")!.click();
    await screen.updateComplete;
    screen.remove();
    expect(unload()).toBe(false);
    if (result === "success") finish({ id: "p1" });
    else refuse({ code: "connection.failed" });
    await expect.poll(() => input(screen).disabled).toBe(false);
    expect(q(screen, "[data-test=edit-printer-modal]")).toBeNull();
    expect(screen.shadowRoot!.textContent).not.toContain(codeMessage("connection.failed"));
    expect(app.leave.coordinator.isDirty()).toBe(false);
    expect(reads).toBe(1);
  });
}

for (const target of ["name", "parent"] as const) {
  it(`registration completes despite delayed ${target} native close`, async () => {
    let reads = 0;
    const { app, screen } = await mount({
      listPrinters: async () => {
        reads++;
        return [];
      },
    });
    const owner =
      target === "name" ? modal(screen)! : (q(screen, "[data-test=new-printer-modal]") as WtModal);
    const native = owner.shadowRoot!.querySelector("dialog")!;
    let held = false;
    native.addEventListener(
      "close",
      (event) => {
        event.stopImmediatePropagation();
        held = true;
      },
      { capture: true, once: true },
    );
    change(screen, "Saved kitchen");
    q(screen, "[data-test=confirm-add-printer]")!.click();
    await expect.poll(() => held).toBe(true);
    await expect.poll(() => reads).toBeGreaterThan(1);
    await expect.poll(() => modal(screen)).toBeNull();
    expect(q(screen, "[data-test=new-printer-modal]")).toBeNull();
    expect(q(screen, "[data-test=edit-printer-modal]")).not.toBeNull();
    expect(app.leave.coordinator.isDirty()).toBe(false);
    native.dispatchEvent(new Event("close"));
    await screen.updateComplete;
    expect(q(screen, "[data-test=edit-printer-modal]")).not.toBeNull();
  });
}

it("an earlier discovery close cannot dismiss a reopened naming editor", async () => {
  const { app, screen } = await mount();
  const owner = q(screen, "[data-test=new-printer-modal]") as WtModal;
  const native = owner.shadowRoot!.querySelector("dialog")!;
  let held = false;
  native.addEventListener(
    "close",
    (event) => {
      event.stopImmediatePropagation();
      held = true;
    },
    { capture: true, once: true },
  );
  q(screen, "[data-test=cancel-new-printer]")!.click();
  await expect.poll(() => held).toBe(true);
  q(screen, "[data-test=open-add-printer]")!.click();
  await screen.updateComplete;
  await owner.updateComplete;
  expect(owner.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  await open(screen, "SN-1");
  change(screen, "New kitchen");
  native.dispatchEvent(new Event("close"));
  await screen.updateComplete;
  expect(modal(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect(input(screen).value).toBe("New kitchen");
  expect(app.leave.coordinator.isDirty()).toBe(true);
});

it("a detached name input cannot change a reopened printer draft", async () => {
  const { app, screen } = await mount();
  const old = input(screen);
  q(screen, "[data-test=cancel-printer-name]")!.click();
  await expect.poll(() => modal(screen)).toBeNull();
  await open(screen, "SN-1");
  old.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Stale kitchen" } }));
  await screen.updateComplete;
  expect(input(screen).value).toBe("Kitchen printer");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
