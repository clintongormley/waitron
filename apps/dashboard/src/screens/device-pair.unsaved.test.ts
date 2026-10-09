import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, registerIcons, type WtModal } from "@waitron/ui";
import type { DashboardApi, DeviceProfile, JoinRequestRow, Station } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "../widgets/test-helpers.js";
import { DevicesScreen } from "./devices-screen.js";
import { LiveData } from "@waitron/dashboard-kit";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";

registerIcons(DASHBOARD_ICONS);
const request: JoinRequestRow = {
  id: "j1",
  kind: "device",
  label: "Counter",
  createdAt: "2026-10-06T00:00:00.000Z",
  pairingBy: { name: "Manager", mine: true },
  returning: {
    name: "Counter",
    profileId: "p1",
    stationId: null,
    watcherId: null,
    profileRetired: false,
  },
};
const profile: DeviceProfile = {
  startingScreen: null,
  departmentId: null,
  allowedZoneIds: null,
  startingZoneId: null,
  admittedRoles: ["staff", "supervisor", "manager", "admin"],
  personExceptions: [],
  id: "p1",
  name: "Counter",
  canvasId: "c1",
  capabilities: [],
  formFactor: "till",
  inactivityTimeoutSeconds: null,
  receiptPrinterIds: [],
  paymentSlipPrinterIds: [],
  cashDrawerPrinterIds: [],
  receiptPrinterDefaultId: null,
  paymentSlipPrinterDefaultId: null,
  cashDrawerPrinterDefaultId: null,
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
class PairLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-devices-screen
        .api=${this.api}
        .panels=${[]}
        .qrFor=${async () => ""}
      ></dashboard-devices-screen
      >${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("device-pair-leave-test-app", PairLeaveApp);
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
function modal(screen: DevicesScreen, kind = "pair") {
  return q(
    screen,
    `[data-test=${kind === "pair" ? "pair" : "add-device"}-modal]`,
  ) as WtModal | null;
}
function change(screen: DevicesScreen, field: string, value: string) {
  q(screen, `[data-test=pair-${field}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function choose(app: PairLeaveApp, decision: "keep" | "discard") {
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => question.open).toBe(true);
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => question.open).toBe(false);
}
async function open(screen: DevicesScreen, id = "j1") {
  q(screen, `[data-test=pair-${id}]`)!.click();
  await expect.poll(() => modal(screen)).not.toBeNull();
  await screen.updateComplete;
  await modal(screen)!.updateComplete;
}
async function mount(overrides: Partial<DashboardApi> = {}) {
  setLocale("en-GB");
  const deny = vi.fn(async () => {}),
    release = vi.fn(async () => {});
  const accept = vi.fn(async () => ({
    deviceId: "d1",
    name: "Renamed",
    formFactor: "till" as const,
  }));
  const api = {
    listDevices: async () => [],
    listStations: async () => [station],
    listWatchers: async () => [],
    listPrinters: async () => [],
    listProfileKitchenScreens: async () => [],
    listDeviceProfiles: async () => [
      profile,
      { ...profile, id: "p2", name: "Kitchen", canvasId: null, formFactor: "kds" },
    ],
    pairingMode: async () => ({
      open: false,
      openUntil: null,
      deviceAddress: "https://waitron.local",
    }),
    joinRequests: async () => [
      request,
      { ...request, id: "j2", label: "Bar", returning: { ...request.returning!, name: "Bar" } },
    ],
    takePairingHold: async () => ({ holdId: "h1", openUntil: "2026-10-06T12:00:00.000Z" }),
    renewPairingHold: async () => ({ openUntil: "2026-10-06T12:00:00.000Z" }),
    releasePairingHold: release,
    denyJoinRequest: deny,
    acceptDeviceJoinRequest: accept,
    joinChallenge: async () => ({ choices: ["12", "47", "83"] }),
    checkDeviceJoinNumber: async () => {},
    ...overrides,
  } as DashboardApi;
  const { el: app } = await mountWidget<PairLeaveApp>("device-pair-leave-test-app", { api });
  const screen = app.shadowRoot!.querySelector("dashboard-devices-screen")!;
  await expect.poll(() => q(screen, "[data-test=open-add-device]")).not.toBeNull();
  q(screen, "[data-test=open-add-device]")!.click();
  await expect.poll(() => q(screen, "[data-test=pair-j1]")).not.toBeNull();
  await open(screen);
  return { app, screen, api, deny, release, accept };
}

for (const route of ["cancel", "escape", "add-close"] as const) {
  it(`pair settings ${route} keeps its draft and hold until Discard`, async () => {
    const { app, screen, deny, release } = await mount();
    change(screen, "name", "Renamed");
    await screen.updateComplete;
    const field = q(screen, "[data-test=pair-name]") as HTMLElementTagNameMap["wt-input"];
    await field.updateComplete;
    const input = field.shadowRoot!.querySelector("input")!;
    input.focus();
    const dismiss = async () =>
      route === "escape"
        ? userEvent.keyboard("{Escape}")
        : q(
            screen,
            `[data-test=${route === "cancel" ? "pair-cancel" : "add-device-close"}]`,
          )!.click();
    await dismiss();
    await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
    expect(modal(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect(deny).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    await choose(app, "keep");
    expect(field.value).toBe("Renamed");
    await expect.poll(() => field.shadowRoot!.activeElement).toBe(input);
    await dismiss();
    await choose(app, "discard");
    await expect.poll(() => modal(screen)).toBeNull();
    expect(deny).toHaveBeenCalledExactlyOnceWith("j1", { createdAt: request.createdAt });
    if (route === "add-close") {
      await expect.poll(() => modal(screen, "add")).toBeNull();
      expect(release).toHaveBeenCalledExactlyOnceWith("h1");
    } else {
      expect(modal(screen, "add")!.open).toBe(true);
      expect(release).not.toHaveBeenCalled();
    }
    expect(unload()).toBe(false);
  });
}
for (const field of ["name", "profile", "binding"] as const) {
  it(`pair ${field} changes and normalized reverts track the submitted settings`, async () => {
    const { screen, deny } = await mount();
    expect(unload()).toBe(false);
    if (field === "binding") {
      change(screen, "profile", "p2");
      await screen.updateComplete;
      change(screen, "binding", "station:s1");
    } else change(screen, field, field === "name" ? "Renamed" : "p2");
    expect(unload()).toBe(true);
    change(
      screen,
      field === "binding" ? "profile" : field,
      field === "name" ? "  Counter  " : "p1",
    );
    expect(unload()).toBe(false);
    q(screen, "[data-test=pair-cancel]")!.click();
    await expect.poll(() => modal(screen)).toBeNull();
    expect(deny).toHaveBeenCalledTimes(1);
  });
}
it("new-device settings start clean after number proof and retain invalid edits", async () => {
  const checks = vi.fn(async () => {});
  const { app, screen, deny } = await mount({
    joinRequests: async () => [{ ...request, returning: null, pairingBy: null }],
    checkDeviceJoinNumber: checks,
  });
  expect(unload()).toBe(false);
  q(screen, '[data-choice="47"]')!.click();
  await expect.poll(() => q(screen, "[data-test=pair-name]")).not.toBeNull();
  expect(checks).toHaveBeenCalledExactlyOnceWith("j1", {
    choice: "47",
    holdId: "h1",
    createdAt: request.createdAt,
  });
  expect(unload()).toBe(false);
  change(screen, "name", "");
  q(screen, "[data-test=pair-cancel]")!.click();
  await choose(app, "keep");
  expect((q(screen, "[data-test=pair-name]") as HTMLInputElement).value).toBe("");
  expect(deny).not.toHaveBeenCalled();
});
it("successful pairing commits its exact payload before a failed refresh and opens confirmation", async () => {
  let reads = 0;
  const { screen, accept, deny, release } = await mount({
    listDevices: async () => {
      if (reads++ > 0) throw { code: "connection.failed" };
      return [];
    },
  });
  change(screen, "name", " Renamed ");
  change(screen, "profile", "p2");
  await screen.updateComplete;
  change(screen, "binding", "station:s1");
  q(screen, "[data-test=pair-submit]")!.click();
  await expect.poll(() => modal(screen)).toBeNull();
  expect(accept).toHaveBeenCalledExactlyOnceWith("j1", {
    name: "Renamed",
    profileId: "p2",
    stationId: "s1",
  });
  expect(deny).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
  expect(unload()).toBe(false);
  expect(modal(screen, "add")).toBeNull();
  expect(q(screen, "[data-test=joined-modal]")!.shadowRoot!.querySelector("dialog")!.open).toBe(
    true,
  );
  await expect
    .poll(() => q(screen, "[data-test=joined-modal]")?.getAttribute("heading"))
    .toBe(t("devices.enabled").replace("{name}", "Renamed"));
});
it("refused pairing retains changed settings and asks before cleanup", async () => {
  const { app, screen, deny } = await mount({
    acceptDeviceJoinRequest: async () => {
      throw { code: "connection.failed" };
    },
  });
  change(screen, "name", "Renamed");
  q(screen, "[data-test=pair-submit]")!.click();
  await expect
    .poll(() => (q(screen, "[data-test=pair-cancel]") as HTMLButtonElement).disabled)
    .toBe(false);
  expect(unload()).toBe(true);
  q(screen, "[data-test=pair-cancel]")!.click();
  await choose(app, "keep");
  expect(deny).not.toHaveBeenCalled();
  expect((q(screen, "[data-test=pair-name]") as HTMLInputElement).value).toBe("Renamed");
});
it("submitted pairing remains nondismissible and newer delivered input stays dirty", async () => {
  let resolve!: (value: { deviceId: string; name: string; formFactor: "till" }) => void;
  const accept = vi.fn(
    () =>
      new Promise<{ deviceId: string; name: string; formFactor: "till" }>((r) => {
        resolve = r;
      }),
  );
  const { app, screen, deny } = await mount({ acceptDeviceJoinRequest: accept });
  change(screen, "name", "Renamed");
  q(screen, "[data-test=pair-submit]")!.click();
  await expect.poll(() => accept.mock.calls.length).toBe(1);
  try {
    await screen.updateComplete;
    await userEvent.keyboard("{Escape}");
    expect(modal(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect((q(screen, "[data-test=pair-cancel]") as HTMLButtonElement).disabled).toBe(true);
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    change(screen, "name", "Newer");
  } finally {
    resolve({ deviceId: "d1", name: "Renamed", formFactor: "till" });
  }
  await expect
    .poll(() => (q(screen, "[data-test=pair-cancel]") as HTMLButtonElement | null)?.disabled)
    .toBe(false);
  expect((q(screen, "[data-test=pair-name]") as HTMLInputElement).value).toBe("Newer");
  expect(unload()).toBe(true);
  expect((q(screen, "[data-test=pair-submit]") as HTMLButtonElement).disabled).toBe(true);
  expect(q(screen, "[data-test=waiting-empty]")).toBeNull();
  expect(q(screen, "[data-test=waiting-table]")).toBeNull();
  expect(q(screen, "[data-test=joined-modal]")).toBeNull();
  q(screen, "[data-test=pair-cancel]")!.click();
  await choose(app, "discard");
  await expect.poll(() => modal(screen)).toBeNull();
  expect(deny).not.toHaveBeenCalled();
});
for (const outcome of ["success", "refusal"] as const) {
  it(`a departed pairing ${outcome} leaves the replacement baseline and message alone`, async () => {
    let resolve!: (value: { deviceId: string; name: string; formFactor: "till" }) => void;
    let reject!: (error: unknown) => void;
    const accept = vi.fn(
      () =>
        new Promise<{ deviceId: string; name: string; formFactor: "till" }>((yes, no) => {
          resolve = yes;
          reject = no;
        }),
    );
    const reads = vi.fn(async () => []);
    const { screen } = await mount({ acceptDeviceJoinRequest: accept, listDevices: reads });
    change(screen, "name", "Renamed");
    q(screen, "[data-test=pair-submit]")!.click();
    await expect.poll(() => accept.mock.calls.length).toBe(1);
    try {
      await open(screen, "j2");
    } finally {
      if (outcome === "success") resolve({ deviceId: "d1", name: "Renamed", formFactor: "till" });
      else reject({ code: "connection.failed" });
    }
    await screen.updateComplete;
    await closeReportsDelivered();
    expect((q(screen, "[data-test=pair-name]") as HTMLInputElement).value).toBe("Bar");
    expect(unload()).toBe(false);
    expect(q(screen, "[data-test=added-device]")).toBeNull();
    expect(reads).toHaveBeenCalledTimes(1);
    expect((q(screen, "[data-test=pair-submit]") as HTMLButtonElement).disabled).toBe(false);
    expect(
      await formMessageOf(
        q(screen, "[data-test=pair-actions]") as HTMLElementTagNameMap["wt-form-actions"],
      ),
    ).toBeNull();
  });
}
it("a new knock invalidates settings and its question without denying the replaced request", async () => {
  const liveData = new LiveData();
  let current = request;
  const { app, screen, deny } = await mount({ liveData, joinRequests: async () => [current] });
  change(screen, "name", "Renamed");
  q(screen, "[data-test=pair-cancel]")!.click();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  current = { ...request, createdAt: "2026-10-06T01:00:00.000Z", label: "New ask" };
  liveData.refresh();
  await expect.poll(() => modal(screen)).toBeNull();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(deny).not.toHaveBeenCalled();
  expect(unload()).toBe(false);
  await open(screen);
  expect((q(screen, "[data-test=pair-name]") as HTMLInputElement).value).toBe("Counter");
});
it("same-request reads do not overwrite edited settings or their baseline", async () => {
  const liveData = new LiveData();
  let current = request;
  const { app, screen } = await mount({ liveData, joinRequests: async () => [current] });
  change(screen, "name", "Renamed");
  current = { ...request, returning: { ...request.returning!, name: "Refreshed label" } };
  liveData.refresh();
  await expect
    .poll(() => q(screen, "[data-test=waiting-table]")!.shadowRoot!.textContent)
    .toContain("Refreshed label");
  expect((q(screen, "[data-test=pair-name]") as HTMLInputElement).value).toBe("Renamed");
  expect(unload()).toBe(true);
  q(screen, "[data-test=pair-cancel]")!.click();
  await choose(app, "keep");
  change(screen, "name", "Counter");
  expect(unload()).toBe(false);
});
it("an unanswered number check has direct cleanup and cannot register settings after departure", async () => {
  let resolve!: () => void;
  const checks = vi.fn(
    () =>
      new Promise<void>((yes) => {
        resolve = yes;
      }),
  );
  const { app, screen, deny } = await mount({
    joinRequests: async () => [{ ...request, returning: null, pairingBy: null }],
    checkDeviceJoinNumber: checks,
  });
  q(screen, '[data-choice="47"]')!.click();
  await expect.poll(() => checks.mock.calls.length).toBe(1);
  try {
    q(screen, "[data-test=pair-cancel]")!.click();
    await expect.poll(() => modal(screen)).toBeNull();
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    expect(deny).toHaveBeenCalledExactlyOnceWith("j1", { createdAt: request.createdAt });
  } finally {
    resolve();
  }
  await screen.updateComplete;
  await closeReportsDelivered();
  expect(modal(screen)).toBeNull();
  expect(unload()).toBe(false);
});
it("closing Add while a Pair opening awaits render cannot revive the departed child", async () => {
  const { screen } = await mount();
  q(screen, "[data-test=pair-cancel]")!.click();
  await expect.poll(() => modal(screen)).toBeNull();
  q(screen, "[data-test=pair-j2]")!.click();
  modal(screen, "add")!.dispatchEvent(
    new CustomEvent("wt-close", { bubbles: true, composed: true }),
  );
  await screen.updateComplete;
  await closeReportsDelivered();
  expect(modal(screen, "add")).toBeNull();
  expect(modal(screen)).toBeNull();
  expect(unload()).toBe(false);
});
it("replacement and disconnect invalidate a pending settings decision and detached input", async () => {
  const { app, screen, deny } = await mount();
  change(screen, "name", "Renamed");
  const old = q(screen, "[data-test=pair-name]")!;
  q(screen, "[data-test=pair-cancel]")!.click();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  await open(screen, "j2");
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  old.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Detached" } }));
  expect((q(screen, "[data-test=pair-name]") as HTMLInputElement).value).toBe("Bar");
  expect(unload()).toBe(false);
  expect(deny).toHaveBeenCalledExactlyOnceWith("j1", { createdAt: request.createdAt });
  change(screen, "name", "Changed bar");
  q(screen, "[data-test=pair-cancel]")!.click();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  screen.remove();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(unload()).toBe(false);
  expect(deny).toHaveBeenCalledTimes(2);
});
it("late native close reports cannot discard a reopened settings owner", async () => {
  const { screen, deny } = await mount();
  const previous = modal(screen)!;
  q(screen, "[data-test=pair-cancel]")!.click();
  await previous.updateComplete;
  await open(screen, "j2");
  await closeReportsDelivered();
  expect(modal(screen)).not.toBeNull();
  expect(modal(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect((q(screen, "[data-test=pair-name]") as HTMLInputElement).value).toBe("Bar");
  expect(deny).toHaveBeenCalledExactlyOnceWith("j1", { createdAt: request.createdAt });
});
