import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, registerIcons, type WtModal } from "@waitron/ui";
import type { DashboardApi, DeviceRow, DeviceProfile, Station } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { DevicesScreen } from "./devices-screen.js";
registerIcons(DASHBOARD_ICONS);
const device: DeviceRow = {
  id: "d1",
  label: "Counter",
  kind: "till",
  active: true,
  stationId: null,
  watcherId: null,
  binding: null,
  deviceProfileId: "p1",
  profileRetired: false,
  receiptPrinterId: null,
  paymentSlipPrinterId: null,
  madeHereStationIds: ["s1"],
  enrolledAt: "2026-10-01T00:00:00.000Z",
  lastSeenAt: null,
  batteryLevel: null,
  batteryCharging: null,
  batteryReportedAt: null,
};
const profile: DeviceProfile = {
  id: "p1",
  name: "Counter",
  canvasId: "c1",
  capabilities: [],
  formFactor: "till",
  inactivityTimeoutSeconds: null,
  receiptPrinterIds: [],
  paymentSlipPrinterIds: [],
};
const station: Station = {
  id: "s1",
  name: "Kitchen",
  active: true,
  isDefault: true,
  displayOrder: 0,
  showsRestOfOrder: false,
  warmAfterMinutes: 5,
  overdueAfterMinutes: 10,
  forgottenAfterMinutes: 15,
};
class DeviceLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-devices-screen .api=${this.api} .panels=${[]}></dashboard-devices-screen
      >${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("device-edit-leave-test-app", DeviceLeaveApp);
afterEach(cleanupWidgets);
function q(screen: DevicesScreen, selector: string): HTMLElement | null {
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
  const { el: app } = await mountWidget<DeviceLeaveApp>("device-edit-leave-test-app", {
    api: {
      listDevices: async () => [device, { ...device, id: "d2", label: "Bar" }],
      listStations: async () => [station, { ...station, id: "s2", name: "Bar" }],
      listWatchers: async () => [],
      listPrinters: async () => [],
      listDeviceProfiles: async () => [profile, { ...profile, id: "p2", name: "Phone" }],
      pairingMode: async () => ({
        open: false,
        openUntil: null,
        deviceAddress: "https://waitron.local",
      }),
      joinRequests: async () => [],
      getDeviceReader: async () => ({ readerId: "r1" }),
      listReaders: async () => [
        {
          id: "r1",
          provider: "test",
          name: "Counter",
          active: true,
          canEnable: true,
          deviceCount: 1,
        },
        { id: "r2", provider: "test", name: "Bar", active: true, canEnable: true, deviceCount: 0 },
      ],
      updateDevice: async () => {},
      setDeviceReader: async () => {},
      ...overrides,
    } as DashboardApi,
  });
  const screen = app.shadowRoot!.querySelector("dashboard-devices-screen")!;
  await expect.poll(() => q(screen, "[data-test=edit-device-d1]")).not.toBeNull();
  await open(screen);
  return { app, screen };
}
async function open(screen: DevicesScreen, id = "d1") {
  q(screen, `[data-test=edit-device-${id}]`)!.click();
  await expect.poll(() => modal(screen)).not.toBeNull();
  await screen.updateComplete;
  await modal(screen)!.updateComplete;
  await expect
    .poll(() => (q(screen, "[data-test=edit-reader]") as HTMLInputElement).disabled)
    .toBe(false);
}
function modal(screen: DevicesScreen) {
  return q(screen, "[data-test=edit-device-modal]") as WtModal | null;
}
function change(screen: DevicesScreen, field: string, value: string) {
  q(screen, `[data-test=edit-${field}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
}
function unload() {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}
async function choose(app: DeviceLeaveApp, decision: "keep" | "discard") {
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => question.open).toBe(true);
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => question.open).toBe(false);
}
for (const route of ["cancel", "escape"] as const) {
  it(`device edit ${route} keeps values and focus until explicit Discard`, async () => {
    const { app, screen } = await mount();
    change(screen, "name", "New counter");
    await screen.updateComplete;
    const field = q(screen, "[data-test=edit-name]") as HTMLElementTagNameMap["wt-input"];
    await field.updateComplete;
    const native = field.shadowRoot!.querySelector("input")!;
    native.focus();
    let closes = 0;
    modal(screen)!.addEventListener("wt-close", () => closes++);
    const dismiss = async () =>
      route === "escape"
        ? userEvent.keyboard("{Escape}")
        : q(screen, "[data-test=edit-cancel]")!.click();
    await dismiss();
    await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
    expect(modal(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    await choose(app, "keep");
    expect(field.value).toBe("New counter");
    expect(closes).toBe(0);
    await expect.poll(() => field.shadowRoot!.activeElement).toBe(native);
    await dismiss();
    await choose(app, "discard");
    await expect.poll(() => modal(screen)).toBeNull();
    expect(closes).toBe(1);
    expect(unload()).toBe(false);
    await open(screen);
    expect((q(screen, "[data-test=edit-name]") as HTMLInputElement).value).toBe("Counter");
  });
}
for (const [field, initial, edited] of [
  ["name", "Counter", "New counter"],
  ["profile", "p1", "p2"],
  ["receipt-printer", "", "printer1"],
  ["slip-printer", "", "printer2"],
  ["reader", "r1", "r2"],
] as const) {
  it(`device ${field} compares submitted values and clears a normalized revert`, async () => {
    const { app, screen } = await mount();
    expect(unload()).toBe(false);
    change(screen, field, edited);
    expect(unload()).toBe(true);
    change(screen, field, field === "name" ? `  ${initial}  ` : initial);
    expect(unload()).toBe(false);
    q(screen, "[data-test=edit-cancel]")!.click();
    await expect.poll(() => modal(screen)).toBeNull();
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  });
}
it("device made-here selection compares membership and includes invalid name input", async () => {
  const { screen } = await mount();
  const box = q(screen, 'input[value="s2"]') as HTMLInputElement;
  box.checked = true;
  box.dispatchEvent(new Event("change"));
  expect(unload()).toBe(true);
  box.checked = false;
  box.dispatchEvent(new Event("change"));
  expect(unload()).toBe(false);
  change(screen, "name", "");
  expect(unload()).toBe(true);
});
it("a failed device write keeps both device and reader changes", async () => {
  const { app, screen } = await mount({
    updateDevice: async () => {
      throw { code: "connection.failed" };
    },
  });
  change(screen, "name", "New counter");
  change(screen, "reader", "r2");
  q(screen, "[data-test=edit-save]")!.click();
  await expect
    .poll(() => (q(screen, "[data-test=edit-cancel]") as HTMLButtonElement).disabled)
    .toBe(false);
  expect(unload()).toBe(true);
  q(screen, "[data-test=edit-cancel]")!.click();
  await choose(app, "keep");
  expect((q(screen, "[data-test=edit-name]") as HTMLInputElement).value).toBe("New counter");
  expect((q(screen, "[data-test=edit-reader]") as HTMLInputElement).value).toBe("r2");
});
it("device success commits before reader failure without committing the reader", async () => {
  const sent: unknown[] = [];
  const { app, screen } = await mount({
    updateDevice: async (id, body) => {
      sent.push([id, body]);
    },
    setDeviceReader: async () => {
      throw { code: "connection.failed" };
    },
  });
  change(screen, "name", "New counter");
  change(screen, "reader", "r2");
  q(screen, "[data-test=edit-save]")!.click();
  await expect
    .poll(() => (q(screen, "[data-test=edit-cancel]") as HTMLButtonElement).disabled)
    .toBe(false);
  expect(sent).toEqual([
    [
      "d1",
      {
        name: "New counter",
        profileId: "p1",
        stationId: null,
        watcherId: null,
        receiptPrinterId: null,
        paymentSlipPrinterId: null,
        madeHereStationIds: ["s1"],
      },
    ],
  ]);
  expect(unload()).toBe(true);
  q(screen, "[data-test=edit-cancel]")!.click();
  await choose(app, "keep");
  change(screen, "reader", "r1");
  expect(unload()).toBe(false);
  change(screen, "name", "Counter");
  expect(unload()).toBe(true);
});
it("successful writes clear drafts before a refused list refresh", async () => {
  let reads = 0;
  const { screen } = await mount({
    listDevices: async () => {
      if (reads++) throw { code: "connection.failed" };
      return [device];
    },
  });
  change(screen, "name", "New counter");
  change(screen, "reader", "r2");
  q(screen, "[data-test=edit-save]")!.click();
  await expect.poll(() => modal(screen)).toBeNull();
  expect(unload()).toBe(false);
  await expect.poll(() => q(screen, "[data-test=page-error]")).not.toBeNull();
});
it("newer delivered device input stays dirty against the captured successful write", async () => {
  let finish!: () => void;
  const sent: unknown[] = [];
  const { screen } = await mount({
    updateDevice: async (_id, body) => {
      sent.push(body);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
  });
  change(screen, "name", "Submitted");
  q(screen, "[data-test=edit-save]")!.click();
  await expect.poll(() => sent.length).toBe(1);
  change(screen, "name", "Newer");
  finish();
  await expect
    .poll(() => (q(screen, "[data-test=edit-cancel]") as HTMLButtonElement | null)?.disabled)
    .toBe(false);
  expect(modal(screen)).not.toBeNull();
  expect(unload()).toBe(true);
  change(screen, "name", "Submitted");
  expect(unload()).toBe(false);
});
it("in-flight writes retain nondismissible Escape and disabled Cancel", async () => {
  let finish!: () => void;
  const { app, screen } = await mount({
    updateDevice: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  });
  change(screen, "name", "New counter");
  q(screen, "[data-test=edit-save]")!.click();
  await screen.updateComplete;
  expect(modal(screen)!.dismissible).toBe(false);
  expect((q(screen, "[data-test=edit-cancel]") as HTMLButtonElement).disabled).toBe(true);
  await userEvent.keyboard("{Escape}");
  expect(modal(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  finish();
  await expect.poll(() => modal(screen)).toBeNull();
  expect(unload()).toBe(false);
});
for (const action of ["replace", "disconnect"] as const) {
  it(`device ${action} aborts a pending answer and releases its draft`, async () => {
    const { app, screen } = await mount();
    change(screen, "name", "New counter");
    q(screen, "[data-test=edit-cancel]")!.click();
    await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
    if (action === "replace") await open(screen, "d2");
    else screen.remove();
    await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    expect(unload()).toBe(false);
    if (action === "replace")
      expect((q(screen, "[data-test=edit-name]") as HTMLInputElement).value).toBe("Bar");
  });
}
it("losing reader permission removes only the reader draft", async () => {
  const { screen } = await mount();
  change(screen, "reader", "r2");
  expect(unload()).toBe(true);
  screen.canManageReaders = false;
  await screen.updateComplete;
  expect(unload()).toBe(false);
  change(screen, "name", "New counter");
  expect(unload()).toBe(true);
});
it("loaded reader defaults do not clear a device draft edited while the read was waiting", async () => {
  let ready!: (value: { readerId: string }) => void;
  let called = false;
  const waiting = mount({
    getDeviceReader: () =>
      new Promise((resolve) => {
        ready = resolve;
        called = true;
      }),
  });
  await expect.poll(() => called).toBe(true);
  const screen = document
    .querySelector("device-edit-leave-test-app")!
    .shadowRoot!.querySelector("dashboard-devices-screen")!;
  try {
    change(screen, "name", "New counter");
    expect(unload()).toBe(true);
  } finally {
    ready({ readerId: "r1" });
    await waiting;
  }
  expect(unload()).toBe(true);
  change(screen, "name", "Counter");
  expect(unload()).toBe(false);
});
it("newer reader input remains dirty after the captured reader write succeeds", async () => {
  let finish!: () => void;
  const sent: unknown[] = [];
  const { screen } = await mount({
    setDeviceReader: async (id, readerId) => {
      sent.push([id, readerId]);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
  });
  change(screen, "reader", "r2");
  q(screen, "[data-test=edit-save]")!.click();
  await expect.poll(() => sent.length).toBe(1);
  change(screen, "reader", "r1");
  finish();
  await expect
    .poll(() => (q(screen, "[data-test=edit-cancel]") as HTMLButtonElement | null)?.disabled)
    .toBe(false);
  expect(sent).toEqual([["d1", "r2"]]);
  expect(unload()).toBe(true);
  change(screen, "reader", "r2");
  expect(unload()).toBe(false);
});
for (const result of ["success", "refusal"] as const) {
  it(`a departed device ${result} leaves replacement values and draft intact`, async () => {
    let finish!: () => void;
    let reject!: (reason: unknown) => void;
    const { screen } = await mount({
      updateDevice: () =>
        new Promise<void>((resolve, refuse) => {
          finish = resolve;
          reject = refuse;
        }),
    });
    change(screen, "name", "Submitted");
    q(screen, "[data-test=edit-save]")!.click();
    await screen.updateComplete;
    await open(screen, "d2");
    change(screen, "name", "New bar");
    if (result === "success") finish();
    else reject({ code: "connection.failed" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await screen.updateComplete;
    expect(modal(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect((q(screen, "[data-test=edit-name]") as HTMLInputElement).value).toBe("New bar");
    expect(unload()).toBe(true);
    change(screen, "name", "Bar");
    expect(unload()).toBe(false);
  });
}
it("an old detached reader control cannot change a replacement device", async () => {
  const { screen } = await mount();
  const old = q(screen, "[data-test=edit-reader]")!;
  q(screen, "[data-test=edit-cancel]")!.click();
  await expect.poll(() => modal(screen)).toBeNull();
  await open(screen, "d2");
  old.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "r2" } }));
  await screen.updateComplete;
  expect((q(screen, "[data-test=edit-reader]") as HTMLInputElement).value).toBe("r1");
  expect(unload()).toBe(false);
});
it("an old detached name control cannot change a replacement device", async () => {
  const { screen } = await mount();
  const old = q(screen, "[data-test=edit-name]")!;
  q(screen, "[data-test=edit-cancel]")!.click();
  await expect.poll(() => modal(screen)).toBeNull();
  await open(screen, "d2");
  old.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Old input" } }));
  await screen.updateComplete;
  expect((q(screen, "[data-test=edit-name]") as HTMLInputElement).value).toBe("Bar");
  expect(unload()).toBe(false);
});
it("successful device save finishes before a delayed native close report", async () => {
  const { screen } = await mount();
  const native = modal(screen)!.shadowRoot!.querySelector("dialog")!;
  let held = false;
  native.addEventListener(
    "close",
    (event) => {
      event.stopImmediatePropagation();
      held = true;
    },
    { capture: true, once: true },
  );
  change(screen, "name", "Saved counter");
  q(screen, "[data-test=edit-save]")!.click();
  await expect.poll(() => held).toBe(true);
  await expect.poll(() => modal(screen)).toBeNull();
  expect(unload()).toBe(false);
  await open(screen, "d2");
  change(screen, "name", "New bar");
  native.dispatchEvent(new Event("close"));
  await screen.updateComplete;
  expect(modal(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect((q(screen, "[data-test=edit-name]") as HTMLInputElement).value).toBe("New bar");
  expect(unload()).toBe(true);
});
it("kitchen Shows selection protects the actual station patch and a revert", async () => {
  const sent: unknown[] = [];
  const { screen } = await mount({
    listDevices: async () => [
      {
        ...device,
        kind: "kds_station",
        stationId: "s1",
        binding: { name: "Kitchen", active: true },
      },
    ],
    listDeviceProfiles: async () => [{ ...profile, canvasId: null, formFactor: "kds" }],
    updateDevice: async (id, body) => {
      sent.push([id, body]);
    },
  });
  change(screen, "binding", "station:s2");
  expect(unload()).toBe(true);
  change(screen, "binding", "station:s1");
  expect(unload()).toBe(false);
  change(screen, "binding", "station:s2");
  q(screen, "[data-test=edit-save]")!.click();
  await expect.poll(() => modal(screen)).toBeNull();
  expect(unload()).toBe(false);
  expect(sent).toEqual([
    [
      "d1",
      {
        name: "Counter",
        profileId: "p1",
        stationId: "s2",
        watcherId: null,
        receiptPrinterId: null,
        paymentSlipPrinterId: null,
      },
    ],
  ]);
});
it("device save captures the reader selection before its first write awaits", async () => {
  let finish!: () => void;
  const readers: unknown[] = [];
  const { screen } = await mount({
    updateDevice: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    setDeviceReader: async (id, readerId) => {
      readers.push([id, readerId]);
    },
  });
  change(screen, "reader", "r2");
  q(screen, "[data-test=edit-save]")!.click();
  await screen.updateComplete;
  change(screen, "reader", "r1");
  finish();
  await expect
    .poll(() => (q(screen, "[data-test=edit-cancel]") as HTMLButtonElement | null)?.disabled)
    .toBe(false);
  expect(readers).toEqual([["d1", "r2"]]);
  expect(unload()).toBe(true);
  change(screen, "reader", "r2");
  expect(unload()).toBe(false);
});
