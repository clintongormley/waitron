import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, registerIcons, type WtModal } from "@waitron/ui";
import type { DashboardApi, DiscoveredPrinter } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { PrintersScreen } from "./printers-screen.js";

registerIcons(DASHBOARD_ICONS);
const network: DiscoveredPrinter = {
  agentId: "a1",
  agentName: "Kitchen box",
  transport: "network_tcp",
  host: "192.168.20.247",
  port: 9100,
  name: "Kitchen printer",
  make: "Epson",
  model: "TM-T20",
  alreadyRegistered: false,
  printerId: null,
  lastSeenAt: "2026-10-06T00:00:00.000Z",
};
class PrinterAddressLeaveApp extends LitElement {
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
customElements.define("printer-address-leave-test-app", PrinterAddressLeaveApp);
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
  const { el: app } = await mountWidget<PrinterAddressLeaveApp>("printer-address-leave-test-app", {
    api: {
      listAgents: async () => [],
      listPrinters: async () => [],
      listRecentJobs: async () => [],
      listPrinterProfiles: async () => [],
      joinRequests: async () => [],
      pairingMode: async () => ({
        open: false,
        openUntil: null,
        deviceAddress: "https://waitron.local",
      }),
      listDiscoveredPrinters: async () => [network],
      startPrinterDiscovery: async () => {},
      renewPrinterDiscovery: async () => {},
      createPrinter: async () => ({ id: "p1" }),
      ...overrides,
    } as DashboardApi,
  });
  const screen = app.shadowRoot!.querySelector("dashboard-printers-screen")!;
  await expect.poll(() => q(screen, "[data-test=open-add-printer]")).not.toBeNull();
  q(screen, "[data-test=open-add-printer]")!.click();
  await expect.poll(() => q(screen, "[data-test=probe-host]")).not.toBeNull();
  (q(screen, "[data-test=probe-panel]") as HTMLDetailsElement).open = true;
  await screen.updateComplete;
  await modal(screen)!.updateComplete;
  return { app, screen };
}
function modal(screen: PrintersScreen) {
  return q(screen, "[data-test=new-printer-modal]") as WtModal | null;
}
function field(screen: PrintersScreen, key: "host" | "port") {
  return q(screen, `[data-test=probe-${key}]`) as HTMLElementTagNameMap["wt-input"];
}
function change(screen: PrintersScreen, key: "host" | "port", value: string) {
  field(screen, key).dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
}
function unload() {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}
async function choose(app: PrinterAddressLeaveApp, decision: "keep" | "discard") {
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => question.open).toBe(true);
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => question.open).toBe(false);
}
for (const route of ["cancel", "escape"] as const) {
  it(`manual printer address ${route} preserves values and focus until Discard`, async () => {
    const { app, screen } = await mount();
    change(screen, "host", "192.168.20.247");
    change(screen, "port", "9200");
    await screen.updateComplete;
    await field(screen, "host").updateComplete;
    const input = field(screen, "host").shadowRoot!.querySelector("input")!;
    input.focus();
    const close = async () =>
      route === "escape"
        ? userEvent.keyboard("{Escape}")
        : q(screen, "[data-test=cancel-new-printer]")!.click();
    await close();
    await choose(app, "keep");
    expect(modal(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect(field(screen, "host").value).toBe("192.168.20.247");
    expect(field(screen, "port").value).toBe("9200");
    await expect.poll(() => field(screen, "host").shadowRoot!.activeElement).toBe(input);
    expect(unload()).toBe(true);
    await close();
    await choose(app, "discard");
    await expect.poll(() => modal(screen)).toBeNull();
    expect(unload()).toBe(false);
    q(screen, "[data-test=open-add-printer]")!.click();
    await screen.updateComplete;
    expect(field(screen, "host").value).toBe("");
    expect(field(screen, "port").value).toBe("9100");
  });
}
it("address normalization accepts a reverted numeric port but retains invalid and empty input", async () => {
  const { app, screen } = await mount();
  expect(unload()).toBe(false);
  change(screen, "host", "192.168.20.247");
  expect(unload()).toBe(true);
  change(screen, "host", "  ");
  change(screen, "port", "09100");
  expect(unload()).toBe(false);
  change(screen, "port", "");
  expect(unload()).toBe(true);
  change(screen, "port", "not a port");
  expect(unload()).toBe(true);
  change(screen, "port", "9100");
  expect(unload()).toBe(false);
  q(screen, "[data-test=cancel-new-printer]")!.click();
  await expect.poll(() => modal(screen)).toBeNull();
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("closing a nested name leaves the edited address, while discovery Discard covers both", async () => {
  const { app, screen } = await mount();
  change(screen, "host", "192.168.20.247");
  await expect.poll(() => q(screen, '[data-test="register-192.168.20.247:9100"]')).not.toBeNull();
  q(screen, '[data-test="register-192.168.20.247:9100"]')!.click();
  await screen.updateComplete;
  const name = q(screen, "[name=new-printer-name]") as HTMLElementTagNameMap["wt-input"];
  name.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Changed kitchen" } }));
  q(screen, "[data-test=cancel-printer-name]")!.click();
  await choose(app, "discard");
  await expect.poll(() => q(screen, "[data-test=name-printer-modal]")).toBeNull();
  expect(field(screen, "host").value).toBe("192.168.20.247");
  expect(unload()).toBe(true);
  q(screen, '[data-test="register-192.168.20.247:9100"]')!.click();
  await screen.updateComplete;
  (q(screen, "[name=new-printer-name]") as HTMLElementTagNameMap["wt-input"]).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "New name" } }),
  );
  q(screen, "[data-test=cancel-new-printer]")!.click();
  await choose(app, "discard");
  await expect.poll(() => modal(screen)).toBeNull();
  expect(q(screen, "[data-test=name-printer-modal]")).toBeNull();
  expect(unload()).toBe(false);
});
it("address replacement and disconnect invalidate the old discard question and detached input", async () => {
  const { app, screen } = await mount();
  change(screen, "host", "192.168.20.247");
  q(screen, "[data-test=cancel-new-printer]")!.click();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  q(screen, "[data-test=open-add-printer]")!.click();
  await screen.updateComplete;
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  const old = field(screen, "host");
  q(screen, "[data-test=cancel-new-printer]")!.click();
  await expect.poll(() => modal(screen)).toBeNull();
  q(screen, "[data-test=open-add-printer]")!.click();
  await screen.updateComplete;
  old.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Old address" } }));
  await screen.updateComplete;
  expect(field(screen, "host").value).toBe("");
  expect(unload()).toBe(false);
  change(screen, "host", "192.168.20.247");
  q(screen, "[data-test=cancel-new-printer]")!.click();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  screen.remove();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(unload()).toBe(false);
});
it("a successful address check submits normalized values and keeps the registration draft dirty", async () => {
  let submitted: unknown;
  const { app, screen } = await mount({
    probePrinterAddress: async (body) => {
      submitted = body;
      return {
        ...body,
        requestedAt: Date.parse(network.lastSeenAt),
        expiresAt: Date.parse(network.lastSeenAt) + 10000,
      };
    },
  });
  change(screen, "host", " 192.168.20.247 ");
  change(screen, "port", "09100");
  q(screen, "[data-test=probe-printer]")!.click();
  await expect
    .poll(() => q(screen, "[data-test=probe-status]")!.textContent)
    .toContain(t("printers.probe_found"));
  expect(submitted).toEqual({ host: "192.168.20.247", port: 9100 });
  expect(unload()).toBe(true);
  q(screen, "[data-test=cancel-new-printer]")!.click();
  await choose(app, "keep");
  expect(field(screen, "host").value).toBe(" 192.168.20.247 ");
});
async function register(screen: PrintersScreen) {
  await expect.poll(() => q(screen, '[data-test="register-192.168.20.247:9100"]')).not.toBeNull();
  q(screen, '[data-test="register-192.168.20.247:9100"]')!.click();
  await screen.updateComplete;
  q(screen, "[data-test=confirm-add-printer]")!.click();
}
it("network registration commits the matching address before a refused refresh", async () => {
  let reads = 0;
  let dirtyAtRefresh: boolean | undefined;
  let submitted: unknown;
  const { app, screen } = await mount({
    listPrinters: async () => {
      if (++reads === 1) return [];
      dirtyAtRefresh = unload();
      throw { code: "connection.failed" };
    },
    createPrinter: async (body) => {
      submitted = body;
      return { id: "p1" };
    },
  });
  change(screen, "host", " 192.168.20.247 ");
  change(screen, "port", "09100");
  expect(unload()).toBe(true);
  await register(screen);
  await expect.poll(() => dirtyAtRefresh).toBe(false);
  expect(submitted).toEqual({
    name: "Kitchen printer",
    transport: "network_tcp",
    host: "192.168.20.247",
    port: 9100,
  });
  expect(modal(screen)).toBeNull();
  expect(q(screen, "[data-test=edit-printer-modal]")).not.toBeNull();
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
});
it("registering another address keeps the manual draft while opening its calibration result", async () => {
  const { app, screen } = await mount();
  change(screen, "host", "192.168.20.248");
  await register(screen);
  await expect.poll(() => q(screen, "[data-test=edit-printer-modal]")).not.toBeNull();
  expect(modal(screen)).not.toBeNull();
  expect(modal(screen)!.open).toBe(true);
  expect(field(screen, "host").value).toBe("192.168.20.248");
  expect(unload()).toBe(true);
  expect(q(screen, "[data-test=name-printer-modal]")).toBeNull();
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
});
it("refused registration retains the address and name for one parent question", async () => {
  const { app, screen } = await mount({
    createPrinter: async () => {
      throw { code: "connection.failed" };
    },
  });
  change(screen, "host", "192.168.20.247");
  await register(screen);
  await expect
    .poll(
      () => (q(screen, "[name=new-printer-name]") as HTMLElementTagNameMap["wt-input"]).disabled,
    )
    .toBe(false);
  expect(unload()).toBe(true);
  q(screen, "[data-test=cancel-new-printer]")!.click();
  await choose(app, "keep");
  expect(field(screen, "host").value).toBe("192.168.20.247");
  expect(q(screen, "[data-test=name-printer-modal]")).not.toBeNull();
});
it("a later address edit remains dirty after the submitted registration succeeds", async () => {
  let finish!: (result: { id: string }) => void;
  const { screen } = await mount({
    createPrinter: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  change(screen, "host", "192.168.20.247");
  await register(screen);
  change(screen, "host", "192.168.20.248");
  finish({ id: "p1" });
  await expect.poll(() => q(screen, "[data-test=edit-printer-modal]")).not.toBeNull();
  expect(modal(screen)).not.toBeNull();
  expect(field(screen, "host").value).toBe("192.168.20.248");
  expect(unload()).toBe(true);
  change(screen, "host", " 192.168.20.247 ");
  expect(unload()).toBe(false);
});
for (const route of ["cancel", "escape"] as const) {
  it(`submitted registration permits discovery ${route} and reloads without reopening it`, async () => {
    let finish!: (result: { id: string }) => void;
    let reads = 0;
    const { app, screen } = await mount({
      listPrinters: async () => {
        reads++;
        return [];
      },
      createPrinter: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    change(screen, "host", "192.168.20.247");
    await register(screen);
    // Escape closes the top naming dialog first; the discovery action closes both.
    if (route === "escape") {
      await userEvent.keyboard("{Escape}");
      await userEvent.keyboard("{Escape}");
    } else q(screen, "[data-test=cancel-new-printer]")!.click();
    await expect.poll(() => modal(screen)).toBeNull();
    expect(unload()).toBe(false);
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    finish({ id: "p1" });
    await expect.poll(() => reads).toBe(2);
    expect(q(screen, "[data-test=edit-printer-modal]")).toBeNull();
  });
}
it("an earlier discovery native close cannot dispose a reopened address scope", async () => {
  const { app, screen } = await mount();
  const owner = modal(screen)!;
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
  change(screen, "host", "192.168.20.247");
  native.dispatchEvent(new Event("close"));
  await screen.updateComplete;
  expect(modal(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect(field(screen, "host").value).toBe("192.168.20.247");
  expect(unload()).toBe(true);
  expect(app.leave.coordinator.isDirty()).toBe(true);
});
