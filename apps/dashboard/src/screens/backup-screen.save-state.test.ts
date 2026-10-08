import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { BackupStatusView, DashboardApi } from "../api/client.js";
import "./backup-screen.js";
import type { BackupScreen } from "./backup-screen.js";

afterEach(cleanupWidgets);

const OFF_WITH_KEY: BackupStatusView = {
  enabled: false,
  isPrimary: true,
  managedByEnvironment: false,
  destinations: [],
  backupStatus: { configured: false },
  archiveUnderCurrentKey: false,
  recoveryKeySet: true,
  recoveryKeyTooShort: false,
};

// Every field the settings editor shows holds something other than its default, in the shapes the
// status read returns, so a field that rewrites its value on first draw would show as a change.
const ENABLED: BackupStatusView = {
  enabled: true,
  isPrimary: true,
  managedByEnvironment: false,
  destinations: [{ id: "primary", dir: "/mnt/usb/waitron" }],
  schedule: { kind: "wall-clock", days: [3, 0], at: { hour: 2, minute: 5 } },
  retention: { count: 5, days: 14 },
  keyFingerprint: "ab12cd34",
  backupStatus: { configured: true, destinations: [] },
  archiveUnderCurrentKey: true,
  recoveryKeySet: true,
  recoveryKeyTooShort: false,
};

const STORED_BODY = {
  destinationDir: "/mnt/usb/waitron",
  recoveryKey: "OLD-KEY-xyz789012345",
  schedule: { kind: "wall-clock", days: [3, 0], at: { hour: 2, minute: 5 } },
  retention: { count: 5, days: 14 },
};

function stubApi(status: BackupStatusView): DashboardApi {
  return {
    getBackupStatus: vi.fn().mockResolvedValue(status),
    mintBackupKey: vi.fn().mockResolvedValue({ key: "MINTED-KEY-abcdef012345" }),
    applyBackup: vi.fn().mockResolvedValue(ENABLED),
    getBackupRecoveryKey: vi.fn().mockResolvedValue({ key: "OLD-KEY-xyz789012345" }),
    rotateBackupKey: vi.fn().mockResolvedValue(ENABLED),
    getStreamSettings: vi.fn().mockResolvedValue({
      isPrimary: true,
      configured: false,
      bucket: null,
      status: { state: "off" },
      recoveryKeySet: false,
      keyFingerprint: null,
    }),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
}

const q = <T extends HTMLElement = HTMLElement>(el: BackupScreen, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);

async function openSettings() {
  const api = stubApi(ENABLED);
  const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
  await vi.waitFor(() => expect(q(el, "[data-test=edit-settings]")).not.toBeNull());
  q(el, "[data-test=edit-settings]")!.click();
  await vi.waitFor(() => expect(q(el, "[data-test=save-settings]")).not.toBeNull());
  return { el, api };
}

async function openConfigure() {
  const api = stubApi(OFF_WITH_KEY);
  const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
  await vi.waitFor(() => expect(q(el, "[data-test=apply]")).not.toBeNull());
  return { el, api };
}

const action = (el: BackupScreen, test: string) =>
  q<HTMLElementTagNameMap["wt-button"]>(el, `[data-test=${test}]`)!;

/** What the action looks like and whether a person can press it: the host's state and its inner button's. */
async function state(el: BackupScreen, test: string) {
  await el.updateComplete;
  const button = action(el, test);
  await button.updateComplete;
  return {
    variant: button.variant,
    disabled: button.disabled,
    innerDisabled: button.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };

/** A real pointer press on the inner button; `force` presses a disabled one too. */
async function press(el: BackupScreen, test: string) {
  await userEvent.click(
    page.elementLocator(action(el, test).shadowRoot!.querySelector("button")!),
    {
      force: true,
    },
  );
  await el.updateComplete;
}

type Edit = (el: BackupScreen) => Promise<void>;
function typeInto(test: string, value: string): Edit {
  return async (el) => {
    const field = q<HTMLElement & { updateComplete: Promise<unknown> }>(el, `[data-test=${test}]`)!;
    await field.updateComplete;
    await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
    await el.updateComplete;
  };
}
function toggleWeekday(n: number): Edit {
  return async (el) => {
    await userEvent.click(page.elementLocator(q(el, `[data-test=weekday-${n}]`)!));
    await el.updateComplete;
  };
}
function pick(test: string, value: string): Edit {
  return async (el) => {
    await chooseOption(q(el, `[data-test=${test}]`)!, value);
    await el.updateComplete;
  };
}

describe("the backup settings editor's Save", () => {
  it("opens on the running settings with Save quiet, and a press sends nothing", async () => {
    const { el, api } = await openSettings();
    expect(q<HTMLElementTagNameMap["wt-input"]>(el, "[data-test=at-time]")!.value).toBe("02:05");
    expect(q<HTMLInputElement>(el, "[data-test=weekday-3]")!.checked).toBe(true);
    expect(await state(el, "save-settings")).toEqual(quiet);
    await press(el, "save-settings");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.applyBackup).not.toHaveBeenCalled();
    expect(q(el, "[data-test=edit-title]")).not.toBeNull();
  });

  it.each<[string, Edit, Edit]>([
    [
      "destination",
      typeInto("destination", "/mnt/usb/other"),
      typeInto("destination", "/mnt/usb/waitron"),
    ],
    ["a weekday", toggleWeekday(5), toggleWeekday(5)],
    ["the days", pick("days-mode", "daily"), pick("days-mode", "weekdays")],
    ["the time", typeInto("at-time", "04:30"), typeInto("at-time", "02:05")],
    ["the time mode", pick("time-mode", "auto"), pick("time-mode", "fixed")],
    ["the kept count", typeInto("retain-count", "6"), typeInto("retain-count", "5")],
    ["the kept days", typeInto("retain-days", "21"), typeInto("retain-days", "14")],
  ])(
    "one edit to %s wakes Save, and putting the running value back quiets it",
    async (_, edit, revert) => {
      const { el } = await openSettings();
      await edit(el);
      expect(await state(el, "save-settings")).toEqual(ready);
      await revert(el);
      expect(await state(el, "save-settings")).toEqual(quiet);
    },
  );

  it("a press after one edit sends that edit and every other field as it was read", async () => {
    const { el, api } = await openSettings();
    await typeInto("retain-days", "21")(el);
    await press(el, "save-settings");
    await vi.waitFor(() =>
      expect(api.applyBackup).toHaveBeenCalledExactlyOnceWith({
        ...STORED_BODY,
        retention: { count: 5, days: 21 },
      }),
    );
  });

  it("a press that reaches an untouched Save's handler sends nothing", async () => {
    const { el, api } = await openSettings();
    // A host `.click()` reaches the listener even while the inner button is disabled.
    action(el, "save-settings").click();
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.applyBackup).not.toHaveBeenCalled();
  });

  it("an edit made while the save is in flight keeps the editor open, measured from what was sent", async () => {
    const { el, api } = await openSettings();
    let finish!: (status: BackupStatusView) => void;
    vi.mocked(api.applyBackup).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await typeInto("destination", "/mnt/usb/second")(el);
    await press(el, "save-settings");
    await typeInto("destination", "/mnt/usb/third")(el);
    finish({ ...ENABLED, destinations: [{ id: "primary", dir: "/mnt/usb/second" }] });
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(q(el, "[data-test=edit-title]")).not.toBeNull();
    expect(await state(el, "save-settings")).toEqual(ready);
    await typeInto("destination", "/mnt/usb/second")(el);
    expect(await state(el, "save-settings")).toEqual(quiet);
  });
});

describe("turning archives on: Apply", () => {
  it("opens quiet, and wakes once a destination is typed", async () => {
    const { el } = await openConfigure();
    expect(await state(el, "apply")).toEqual(quiet);
    await typeInto("destination", "/mnt/usb/waitron")(el);
    expect(await state(el, "apply")).toEqual(ready);
    await typeInto("destination", "")(el);
    expect(await state(el, "apply")).toEqual(quiet);
  });

  it("after an apply the person kept editing through, Apply quiets once the applied values are back", async () => {
    const { el, api } = await openConfigure();
    let finish!: (status: BackupStatusView) => void;
    vi.mocked(api.applyBackup).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await typeInto("destination", "/mnt/usb/first")(el);
    await press(el, "apply");
    await typeInto("destination", "/mnt/usb/second")(el);
    finish({ ...ENABLED, destinations: [{ id: "primary", dir: "/mnt/usb/first" }] });
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await state(el, "apply")).toEqual(ready);
    await typeInto("destination", "/mnt/usb/first")(el);
    expect(await state(el, "apply")).toEqual(quiet);
    await press(el, "apply");
    action(el, "apply").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.applyBackup).toHaveBeenCalledOnce();
  });
});
