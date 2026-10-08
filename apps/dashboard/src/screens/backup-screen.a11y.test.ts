import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./backup-screen.js";
import type { BackupScreen } from "./backup-screen.js";
import type { BackupStatusView, DashboardApi } from "../api/client.js";

/**
 * Scanned in several shapes, including the advanced paste + pick-weekdays + fixed-time branches so every
 * conditional control is scanned. The screen loads on connect, so the stub must resolve or a stray
 * rejection pollutes the run.
 */

const OFF: BackupStatusView = {
  enabled: false,
  isPrimary: true,
  managedByEnvironment: false,
  destinations: [],
  backupStatus: { configured: false },
  archiveUnderCurrentKey: false,
  recoveryKeySet: false,
  recoveryKeyTooShort: false,
};

const ENABLED: BackupStatusView = {
  enabled: true,
  isPrimary: true,
  managedByEnvironment: false,
  destinations: [{ id: "primary", dir: "/mnt/usb/waitron" }],
  schedule: { kind: "wall-clock", days: "daily", at: "auto" },
  retention: { count: 7, days: 30 },
  keyFingerprint: "ab12cd34",
  backupStatus: {
    configured: true,
    destinations: [
      { id: "primary", lastBackupAt: "2026-09-09T02:00:00Z", ageSeconds: 3600, stale: false },
    ],
  },
  archiveUnderCurrentKey: true,
  recoveryKeySet: true,
  recoveryKeyTooShort: false,
};

const MANAGED: BackupStatusView = { ...OFF, managedByEnvironment: true };

function stubApi(status: BackupStatusView, overrides: Partial<DashboardApi> = {}): DashboardApi {
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
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: BackupScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const q = (el: BackupScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("backup-screen a11y (%s theme)", (theme) => {
  it("renders the configure wizard accessibly", async () => {
    const { el, host } = await mountWidget<BackupScreen>(
      "dashboard-backup-screen",
      { api: stubApi(OFF) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders the advanced paste + pick-weekdays + fixed-time branches accessibly", async () => {
    const { el, host } = await mountWidget<BackupScreen>(
      "dashboard-backup-screen",
      { api: stubApi(OFF) },
      theme,
    );
    await flush(el);
    q(el, "[data-test=advanced-toggle]")!.click();
    await chooseOption(q(el, "[data-test=days-mode]")!, "weekdays");
    await chooseOption(q(el, "[data-test=time-mode]")!, "fixed");
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("renders the configure wizard reusing a key the box already holds accessibly", async () => {
    const { el, host } = await mountWidget<BackupScreen>(
      "dashboard-backup-screen",
      { api: stubApi({ ...OFF, recoveryKeySet: true }) },
      theme,
    );
    await flush(el);
    expect(q(el, "[data-test=existing-key]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders the configure wizard replacing a held key too short to use accessibly", async () => {
    const { el, host } = await mountWidget<BackupScreen>(
      "dashboard-backup-screen",
      { api: stubApi({ ...OFF, recoveryKeySet: true, recoveryKeyTooShort: true }) },
      theme,
    );
    await flush(el);
    expect(q(el, "[data-test=short-key]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders the read-only managed surface accessibly", async () => {
    const { el, host } = await mountWidget<BackupScreen>(
      "dashboard-backup-screen",
      { api: stubApi(MANAGED) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders the enabled state with the rotate section + re-shown old key accessibly", async () => {
    const { el, host } = await mountWidget<BackupScreen>(
      "dashboard-backup-screen",
      { api: stubApi(ENABLED) },
      theme,
    );
    await flush(el);
    q(el, "[data-test=show-old-key]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders the enabled edit-settings form accessibly", async () => {
    const { el, host } = await mountWidget<BackupScreen>(
      "dashboard-backup-screen",
      { api: stubApi(ENABLED) },
      theme,
    );
    await flush(el);
    q(el, "[data-test=edit-settings]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders the settings editor accessibly with Save quiet, then with Save ready after an edit", async () => {
    const { el, host } = await mountWidget<BackupScreen>(
      "dashboard-backup-screen",
      { api: stubApi(ENABLED) },
      theme,
    );
    await flush(el);
    q(el, "[data-test=edit-settings]")!.click();
    await flush(el);
    const save = q(el, "[data-test=save-settings]") as HTMLElementTagNameMap["wt-button"];
    expect([save.variant, save.disabled]).toEqual(["secondary", true]);
    await expectNoA11yViolations(host);
    q(el, "[data-test=destination]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "/mnt/usb/waitron-2" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    await save.updateComplete;
    expect([save.variant, save.disabled]).toEqual(["primary", false]);
    await expectNoA11yViolations(host);
  });

  it("renders turning archives on accessibly with Apply quiet, then with Apply ready after an edit", async () => {
    const { el, host } = await mountWidget<BackupScreen>(
      "dashboard-backup-screen",
      { api: stubApi({ ...OFF, recoveryKeySet: true }) },
      theme,
    );
    await flush(el);
    const apply = q(el, "[data-test=apply]") as HTMLElementTagNameMap["wt-button"];
    expect([apply.variant, apply.disabled]).toEqual(["secondary", true]);
    await expectNoA11yViolations(host);
    q(el, "[data-test=destination]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "/mnt/usb/waitron" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    await apply.updateComplete;
    expect([apply.variant, apply.disabled]).toEqual(["primary", false]);
    await expectNoA11yViolations(host);
  });

  it("renders a retention box the form refused accessibly", async () => {
    const { el, host } = await mountWidget<BackupScreen>(
      "dashboard-backup-screen",
      { api: stubApi(ENABLED) },
      theme,
    );
    await flush(el);
    q(el, "[data-test=edit-settings]")!.click();
    await flush(el);
    q(el, "[data-test=retain-count]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    q(el, "[data-test=save-settings]")!.click();
    await flush(el);
    expect((q(el, "[data-test=retain-count]") as HTMLElement & { error: string }).error).not.toBe(
      "",
    );
    await expectNoA11yViolations(host);
  });

  it("renders the error banner accessibly", async () => {
    const { el, host } = await mountWidget<BackupScreen>(
      "dashboard-backup-screen",
      {
        api: stubApi(OFF, {
          getBackupStatus: vi.fn().mockRejectedValue({ code: "server.internal" }),
        }),
      },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
