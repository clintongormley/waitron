import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, registerIcons, type WtModal } from "@waitron/ui";
import type { DashboardApi, DiscoveredPrinter, Printer } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { PrintersScreen } from "./printers-screen.js";

registerIcons(DASHBOARD_ICONS);
const address = "00:11:22:33:44:55";
const device: DiscoveredPrinter = {
  agentId: "a1",
  agentName: "Kitchen box",
  transport: "bluetooth",
  localKey: address,
  name: "Kitchen printer",
  printerLike: true,
  alreadyRegistered: false,
  printerId: null,
  lastSeenAt: "2026-10-06T00:00:00.000Z",
};
const other = { ...device, localKey: "66:77:88:99:AA:BB", name: "Bar printer" };
const command = {
  id: "command-1",
  kind: "pair" as const,
  state: "pending" as const,
  address,
  expiresInMs: 120_000,
};
class PrinterPairLeaveApp extends LitElement {
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
customElements.define("printer-pair-leave-test-app", PrinterPairLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
  vi.restoreAllMocks();
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
  const { el: app } = await mountWidget<PrinterPairLeaveApp>("printer-pair-leave-test-app", {
    api: {
      listAgents: async () => [],
      listPrinters: async () => [],
      listRecentJobs: async () => [],
      listPrinterProfiles: async () => [],
      listPrinterStationNames: async () => [],
      joinRequests: async () => [],
      pairingMode: async () => ({
        open: false,
        openUntil: null,
        deviceAddress: "https://waitron.local",
      }),
      listDiscoveredPrinters: async () => [device, other],
      listPagePrinters: async () => [],
      startPrinterDiscovery: async () => {},
      renewPrinterDiscovery: async () => {},
      pairBluetooth: async () => ({ command }),
      ...overrides,
    } as DashboardApi,
  });
  const screen = app.shadowRoot!.querySelector("dashboard-printers-screen")!;
  await expect.poll(() => q(screen, "[data-test=open-add-printer]")).not.toBeNull();
  q(screen, "[data-test=open-add-printer]")!.click();
  await expect.poll(() => q(screen, `[data-test="pair-a1:${address}"]`)).not.toBeNull();
  await open(screen, address);
  return { app, screen };
}
async function open(screen: PrintersScreen, key: string) {
  q(screen, `[data-test="pair-a1:${key}"]`)!.click();
  await screen.updateComplete;
  await modal(screen)!.updateComplete;
}
function modal(screen: PrintersScreen) {
  return q(screen, "[data-test=pair-printer-modal]") as WtModal | null;
}
function field(screen: PrintersScreen) {
  return q(screen, "[data-test=bluetooth-pin]") as HTMLElementTagNameMap["wt-input"];
}
function change(screen: PrintersScreen, value: string) {
  field(screen).dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function choose(app: PrinterPairLeaveApp, decision: "keep" | "discard") {
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => question.open).toBe(true);
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => question.open).toBe(false);
}

for (const route of ["escape"] as const) {
  it(`Bluetooth proof ${route} keeps the exact PIN and focus until Discard`, async () => {
    const { app, screen } = await mount();
    change(screen, " 8A? ");
    await screen.updateComplete;
    await field(screen).updateComplete;
    const input = field(screen).shadowRoot!.querySelector("input")!;
    input.focus();
    const dismiss = async () => {
      await userEvent.keyboard("{Escape}");
    };
    await dismiss();
    await choose(app, "keep");
    expect(modal(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect(field(screen)?.value).toBe(" 8A? ");
    await expect.poll(() => field(screen).shadowRoot!.activeElement).toBe(input);
    expect(unload()).toBe(true);
    await dismiss();
    await choose(app, "discard");
    await expect.poll(() => modal(screen)).toBeNull();
    expect(unload()).toBe(false);
    {
      await open(screen, address);
      expect(field(screen)?.value).toBe("");
    }
  });
}
it("Bluetooth proof clean and exact reverts close without a question", async () => {
  const { app, screen } = await mount();
  expect(unload()).toBe(false);
  change(screen, "8472");
  expect(unload()).toBe(true);
  change(screen, "");
  expect(unload()).toBe(false);
  q(screen, "[data-test=cancel-pair]")!.click();
  await expect.poll(() => modal(screen)).toBeNull();
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
});
it("discarding a Bluetooth proof leaves the parent's edited manual address", async () => {
  const { app, screen } = await mount();
  q(screen, "[data-test=probe-host]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "192.168.20.247" } }),
  );
  change(screen, "8472");
  await userEvent.keyboard("{Escape}");
  await choose(app, "discard");
  await expect.poll(() => modal(screen)).toBeNull();
  expect((q(screen, "[data-test=probe-host]") as HTMLElementTagNameMap["wt-input"]).value).toBe(
    "192.168.20.247",
  );
  expect(unload()).toBe(true);
  await userEvent.keyboard("{Escape}");
  await choose(app, "discard");
  await expect.poll(() => q(screen, "[data-test=new-printer-modal]")).toBeNull();
  expect(unload()).toBe(false);
});
it("Bluetooth proof replacement and disconnect abort old questions and detached input", async () => {
  const { app, screen } = await mount();
  change(screen, "8472");
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  await open(screen, other.localKey!);
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(field(screen)?.value).toBe("");
  expect(unload()).toBe(false);
  const old = field(screen);
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => modal(screen)).toBeNull();
  await open(screen, address);
  old.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "old proof" } }));
  await screen.updateComplete;
  expect(field(screen)?.value).toBe("");
  change(screen, "8472");
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  screen.remove();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(unload()).toBe(false);
});
it("a refused Bluetooth request retains its exact dirty proof", async () => {
  const { app, screen } = await mount({
    pairBluetooth: async () => {
      throw { code: "management.request_invalid", params: { field: "pin" } };
    },
  });
  change(screen, "A?8");
  q(screen, "[data-test=confirm-pair]")!.click();
  await expect.poll(() => field(screen).invalid).toBe(true);
  expect(field(screen)?.value).toBe("A?8");
  expect(unload()).toBe(true);
  await userEvent.keyboard("{Escape}");
  await choose(app, "keep");
});
for (const route of ["cancel", "escape"] as const) {
  it(`submitted Bluetooth request retains its existing ${route} and late command result`, async () => {
    let finish!: (value: { command: typeof command }) => void;
    let received: unknown;
    const { app, screen } = await mount({
      pairBluetooth: (...args) => {
        received = args;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    });
    change(screen, "A?8");
    q(screen, "[data-test=confirm-pair]")!.click();
    await expect.poll(() => field(screen)?.disabled).toBe(true);
    expect(received).toEqual(["a1", address, "A?8"]);
    if (route === "cancel") q(screen, "[data-test=cancel-pair]")!.click();
    else await userEvent.keyboard("{Escape}");
    await expect.poll(() => modal(screen)).toBeNull();
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    expect(unload()).toBe(false);
    finish({ command });
    await expect
      .poll(() => q(screen, `[data-test="discovered-command-a1:${address}"]`)?.textContent)
      .toContain(t("printers.bluetooth_pairing"));
  });
}
it("Bluetooth success commits its submitted proof without clearing the parent address", async () => {
  let received: unknown;
  const { app, screen } = await mount({
    pairBluetooth: async (...args) => {
      received = args;
      return { command };
    },
  });
  q(screen, "[data-test=probe-host]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "192.168.20.247" } }),
  );
  change(screen, "A?8");
  q(screen, "[data-test=confirm-pair]")!.click();
  await expect.poll(() => modal(screen)).toBeNull();
  expect(received).toEqual(["a1", address, "A?8"]);
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(unload()).toBe(true);
  await userEvent.keyboard("{Escape}");
  await choose(app, "discard");
  await expect.poll(() => q(screen, "[data-test=new-printer-modal]")).toBeNull();
  expect(unload()).toBe(false);
});
it("a newer delivered PIN stays dirty against the accepted submitted proof", async () => {
  let finish!: (value: { command: typeof command }) => void;
  let calls = 0;
  const { app, screen } = await mount({
    pairBluetooth: () => {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  change(screen, "A?8");
  q(screen, "[data-test=confirm-pair]")!.click();
  await expect.poll(() => field(screen)?.disabled).toBe(true);
  change(screen, "next proof");
  finish({ command });
  await expect.poll(() => field(screen)?.disabled).toBe(false);
  expect(field(screen)?.value).toBe("next proof");
  expect(unload()).toBe(true);
  expect(calls).toBe(1);
  await userEvent.keyboard("{Escape}");
  await choose(app, "keep");
  change(screen, "A?8");
  expect(unload()).toBe(false);
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => modal(screen)).toBeNull();
});
for (const result of ["success", "refusal"] as const) {
  it(`an old Bluetooth ${result} cannot close or mark another proof`, async () => {
    let finish!: (value: { command: typeof command }) => void;
    let refuse!: (error: unknown) => void;
    const { app, screen } = await mount({
      pairBluetooth: () =>
        new Promise((resolve, reject) => {
          finish = resolve;
          refuse = reject;
        }),
    });
    change(screen, "A?8");
    q(screen, "[data-test=confirm-pair]")!.click();
    await expect.poll(() => field(screen)?.disabled).toBe(true);
    await open(screen, other.localKey!);
    change(screen, "current proof");
    if (result === "success") finish({ command });
    else refuse({ code: "management.request_invalid", params: { field: "pin" } });
    await screen.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(field(screen)?.value).toBe("current proof");
    expect(field(screen)?.invalid).toBe(false);
    expect(field(screen)?.disabled).toBe(false);
    expect(modal(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect(unload()).toBe(true);
    await userEvent.keyboard("{Escape}");
    await choose(app, "keep");
  });
}
it("a delayed Bluetooth native close cannot clear a reopened proof", async () => {
  const { screen } = await mount();
  const dialog = modal(screen)!.shadowRoot!.querySelector("dialog")!;
  dialog.addEventListener("close", (event) => event.stopImmediatePropagation(), {
    capture: true,
    once: true,
  });
  q(screen, "[data-test=cancel-pair]")!.click();
  await expect.poll(() => dialog.open).toBe(false);
  await open(screen, other.localKey!);
  change(screen, "current proof");
  dialog.dispatchEvent(new Event("close"));
  await screen.updateComplete;
  expect(dialog.open).toBe(true);
  expect(field(screen)?.value).toBe("current proof");
  expect(unload()).toBe(true);
});
it("submitted Bluetooth discovery close stays direct and does not track the late command", async () => {
  let finish!: (value: { command: typeof command }) => void;
  const { app, screen } = await mount({
    pairBluetooth: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  change(screen, "A?8");
  q(screen, "[data-test=confirm-pair]")!.click();
  await expect.poll(() => field(screen)?.disabled).toBe(true);
  q(screen, "[data-test=cancel-new-printer]")!.click();
  await expect.poll(() => q(screen, "[data-test=new-printer-modal]")).toBeNull();
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(modal(screen)).not.toBeNull();
  finish({ command });
  await expect.poll(() => modal(screen)).toBeNull();
  expect(unload()).toBe(false);
  q(screen, "[data-test=open-add-printer]")!.click();
  await expect.poll(() => q(screen, `[data-test="pair-a1:${address}"]`)).not.toBeNull();
  expect(q(screen, `[data-test="discovered-command-a1:${address}"]`)).toBeNull();
});
it("a submitted Bluetooth request still protects the parent's independent address", async () => {
  let finish!: (value: { command: typeof command }) => void;
  const { app, screen } = await mount({
    pairBluetooth: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  q(screen, "[data-test=probe-host]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "192.168.20.247" } }),
  );
  change(screen, "A?8");
  q(screen, "[data-test=confirm-pair]")!.click();
  await expect.poll(() => field(screen)?.disabled).toBe(true);
  void (
    q(screen, "[data-test=new-printer-modal]") as HTMLElementTagNameMap["wt-modal"]
  ).requestClose("escape");
  await choose(app, "keep");
  expect((q(screen, "[data-test=probe-host]") as HTMLElementTagNameMap["wt-input"]).value).toBe(
    "192.168.20.247",
  );
  finish({ command });
  await expect.poll(() => modal(screen)).toBeNull();
  expect(unload()).toBe(true);
});
it("Bluetooth success clears its proof before the native close report arrives", async () => {
  const { app, screen } = await mount();
  const dialog = modal(screen)!.shadowRoot!.querySelector("dialog")!;
  dialog.addEventListener("close", (event) => event.stopImmediatePropagation(), {
    capture: true,
    once: true,
  });
  change(screen, "A?8");
  q(screen, "[data-test=confirm-pair]")!.click();
  await expect.poll(() => modal(screen)).toBeNull();
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(unload()).toBe(false);
});
it("replacing discovery clears the old Bluetooth question and proof", async () => {
  const { app, screen } = await mount();
  change(screen, "A?8");
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  q(screen, "[data-test=open-add-printer]")!.click();
  await expect.poll(() => modal(screen)).toBeNull();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(unload()).toBe(false);
});

describe("Pair again", () => {
  const off = {
    id: "p9",
    name: "Bar printer",
    transport: "bluetooth",
    host: null,
    port: null,
    localKey: address,
    pollId: null,
    paperWidth: "58mm",
    resolution: "203dpi",
    hasCashDrawer: false,
    portable: false,
    pickupRoles: [],
    holder: null,
    pendingJobs: 0,
    lastPrintAt: null,
    lastPrintAgentId: null,
    active: false,
  } satisfies Printer;
  const found: DiscoveredPrinter = { ...device, alreadyRegistered: true, printerId: off.id };

  async function mountPairAgain(beforeOpen: (app: PrinterPairLeaveApp) => void = () => {}) {
    const { el: app } = await mountWidget<PrinterPairLeaveApp>("printer-pair-leave-test-app", {
      api: {
        listAgents: async () => [],
        listPrinters: async () => [off],
        listRecentJobs: async () => [],
        listPrinterProfiles: async () => [],
        listPrinterStationNames: async () => [],
        joinRequests: async () => [],
        pairingMode: async () => ({
          open: false,
          openUntil: null,
          deviceAddress: "https://waitron.local",
        }),
        listDiscoveredPrinters: async () => [found],
        listPagePrinters: async () => [],
        startPrinterDiscovery: async () => {},
        renewPrinterDiscovery: async () => {},
        pairBluetooth: async () => ({ command }),
      } as unknown as DashboardApi,
    });
    beforeOpen(app);
    const screen = app.shadowRoot!.querySelector("dashboard-printers-screen")!;
    await expect.poll(() => q(screen, "wt-tabs")).not.toBeNull();
    q(screen, "wt-tabs")!.shadowRoot!.querySelector<HTMLElement>('[data-key="printers"]')!.click();
    await expect.poll(() => q(screen, '[data-test="printers-table"]')).not.toBeNull();
    await expect.poll(() => q(screen, "[data-test=pair-again-p9]")).not.toBeNull();
    q(screen, "[data-test=pair-again-p9]")!.click();
    await expect.poll(() => modal(screen)).not.toBeNull();
    await modal(screen)!.updateComplete;
    return { app, screen };
  }
  const pairAgainModal = (screen: PrintersScreen) => q(screen, "[data-test=pair-again-modal]");

  it("a PIN typed for Pair again asks before it is lost", async () => {
    const { app, screen } = await mountPairAgain();
    change(screen, "8472");
    expect(unload()).toBe(true);
    await userEvent.keyboard("{Escape}");
    await choose(app, "keep");
    expect(field(screen)?.value).toBe("8472");
    await userEvent.keyboard("{Escape}");
    await choose(app, "discard");
    await expect.poll(() => modal(screen)).toBeNull();
    expect(pairAgainModal(screen)).not.toBeNull();
    expect(unload()).toBe(false);
  });

  it("Cancel on Pair again's PIN discards it without asking and keeps the Pair again window", async () => {
    const { app, screen } = await mountPairAgain();
    change(screen, "8472");
    q(screen, "[data-test=cancel-pair]")!.click();
    await expect.poll(() => modal(screen)).toBeNull();
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    expect(pairAgainModal(screen)).not.toBeNull();
    expect(unload()).toBe(false);
  });

  it("closing the Pair again window with a typed PIN asks once, and Discard closes both", async () => {
    const { app, screen } = await mountPairAgain();
    change(screen, "8472");
    void (pairAgainModal(screen) as WtModal).requestClose("escape");
    await choose(app, "keep");
    expect(pairAgainModal(screen)).not.toBeNull();
    expect(field(screen)?.value).toBe("8472");
    void (pairAgainModal(screen) as WtModal).requestClose("escape");
    await choose(app, "discard");
    await expect.poll(() => pairAgainModal(screen)).toBeNull();
    expect(modal(screen)).toBeNull();
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    expect(unload()).toBe(false);
  });

  it("Cancel on the Pair again window with a typed PIN closes both without asking", async () => {
    const { app, screen } = await mountPairAgain();
    change(screen, "8472");
    q(screen, "[data-test=cancel-pair-again]")!.click();
    await expect.poll(() => pairAgainModal(screen)).toBeNull();
    expect(modal(screen)).toBeNull();
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    expect(unload()).toBe(false);
  });

  it("removing the screen releases Pair again's draft scope as well as its PIN's", async () => {
    const disposals: ReturnType<typeof vi.fn>[] = [];
    const { screen } = await mountPairAgain((app) => {
      const coordinator = app.leave.coordinator;
      const register = coordinator.register.bind(coordinator);
      vi.spyOn(coordinator, "register").mockImplementation((owner) => {
        const scope = register(owner);
        const dispose = vi.fn(() => scope.dispose());
        disposals.push(dispose);
        return { ...scope, dispose };
      });
    });
    expect(disposals).toHaveLength(2);
    screen.remove();
    expect(disposals.map((dispose) => dispose.mock.calls.length)).toEqual([1, 1]);
  });
});
