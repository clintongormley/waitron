import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./backup-screen.js";
import type { BackupScreen } from "./backup-screen.js";
import type { BackupStatusView, DashboardApi } from "../api/client.js";

/**
 * The backup admin screen scanned by axe in both themes, in five shapes: the configure wizard (off,
 * with the minted key + download + checkbox + policy controls), the same wizard driven into its
 * advanced paste + pick-weekdays + fixed-time branches (so every conditional control is scanned), the
 * read-only managed-by-environment surface, the enabled state with the rotate section + re-shown old
 * key, and the error state (a rejected status load shows the `role="alert"` banner). Mounted by
 * ASSIGNING the `api` stub as a property; the screen loads on connect, so the stub must resolve or a
 * stray rejection pollutes the run. Every colour is a `--wt-*` token. Mirrors `diagnostics-screen.a11y.test.ts`.
 */

const OFF: BackupStatusView = {
  enabled: false,
  isPrimary: true,
  managedByEnvironment: false,
  destinations: [],
  backupStatus: { configured: false },
  archiveUnderCurrentKey: false,
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
};

const MANAGED: BackupStatusView = { ...OFF, managedByEnvironment: true };

function stubApi(status: BackupStatusView, overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    getBackupStatus: vi.fn().mockResolvedValue(status),
    mintBackupKey: vi.fn().mockResolvedValue({ key: "MINTED-KEY-abcdef012345" }),
    applyBackup: vi.fn().mockResolvedValue(ENABLED),
    getBackupRecoveryKey: vi.fn().mockResolvedValue({ key: "OLD-KEY-xyz789012345" }),
    rotateBackupKey: vi.fn().mockResolvedValue(ENABLED),
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

function selectValue(el: BackupScreen, sel: string, value: string): void {
  const select = q(el, sel) as HTMLSelectElement;
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

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
    selectValue(el, "[data-test=days-mode]", "weekdays");
    selectValue(el, "[data-test=time-mode]", "fixed");
    await el.updateComplete;
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
