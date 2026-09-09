import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import type { BackupStatusView, DashboardApi } from "../api/client.js";
import { BackupScreen } from "./backup-screen.js";

/**
 * The backup admin screen. Its `api` is a stub: `getBackupStatus` returns the running duty, `mintBackupKey`
 * returns a strong key, `applyBackup`/`rotateBackupKey` return the fresh status, and `getBackupRecoveryKey`
 * re-shows the effective key. Assertions cover each behaviour on its own: it loads + renders the status;
 * shows the destination + policy fields; MINTS a key by default and shows it with a copy button, a real
 * download `<a download>`, and a "saved it" checkbox that gates the apply button; an advanced "paste my
 * own" toggle; the managed-by-environment read-only surface; apply sends the composed body and refreshes;
 * a rejected apply surfaces a localised `role="alert"`; and rotate re-shows the OLD key behind its loud
 * warning. Mirrors `diagnostics-screen.test.ts`.
 */

afterEach(cleanupWidgets);

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

function stubApi(
  overrides: Partial<DashboardApi> = {},
  status: BackupStatusView = OFF,
): DashboardApi {
  return {
    getBackupStatus: vi.fn().mockResolvedValue(status),
    mintBackupKey: vi.fn().mockResolvedValue({ key: "MINTED-KEY-abcdef012345" }),
    applyBackup: vi.fn().mockResolvedValue(ENABLED),
    getBackupRecoveryKey: vi.fn().mockResolvedValue({ key: "OLD-KEY-xyz789012345" }),
    rotateBackupKey: vi.fn().mockResolvedValue(ENABLED),
    ...overrides,
  } as unknown as DashboardApi;
}

/** Settles the in-flight load (getBackupStatus + the auto-mint) and the follow-up render. */
async function flush(el: BackupScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  // A second turn: the auto-mint is fired AFTER the status load resolves, so give its render a tick.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const q = (el: BackupScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);
const errorKey = (el: BackupScreen): string | null =>
  (el as unknown as { errorKey: string | null }).errorKey;

function setInput(el: BackupScreen, sel: string, value: string): void {
  q(el, sel)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

function tickCheckbox(el: BackupScreen, sel: string): void {
  const box = q(el, sel) as HTMLInputElement;
  box.checked = true;
  box.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

function selectValue(el: BackupScreen, sel: string, value: string): void {
  const select = q(el, sel) as HTMLSelectElement;
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

function setNativeInput(el: BackupScreen, sel: string, value: string): void {
  const input = q(el, sel) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}

describe("backup-screen", () => {
  it("loads and renders the status view (off, then on)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    expect(api.getBackupStatus).toHaveBeenCalled();
    expect(el.shadowRoot!.querySelectorAll("h1").length).toBe(1);
    expect(q(el, "[data-test=status]")).not.toBeNull();

    const { el: on } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
      api: stubApi({}, ENABLED),
    });
    await flush(on);
    // The on state names where and how fresh.
    expect(on.shadowRoot!.textContent).toContain("/mnt/usb/waitron");
  });

  it("shows the destination and policy fields when configurable", async () => {
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api: stubApi() });
    await flush(el);
    expect(q(el, "[data-test=destination]")).not.toBeNull();
    expect(q(el, "[data-test=days-mode]")).not.toBeNull();
    expect(q(el, "[data-test=time-mode]")).not.toBeNull();
    expect(q(el, "[data-test=retain-count]")).not.toBeNull();
    expect(q(el, "[data-test=retain-days]")).not.toBeNull();
  });

  it("mints a key by default and shows it with copy + download + the saved-it checkbox", async () => {
    const api = stubApi();
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    expect(api.mintBackupKey).toHaveBeenCalled();
    expect(q(el, "[data-test=minted-key]")!.textContent).toContain("MINTED-KEY-abcdef012345");
    expect(q(el, "[data-test=copy-key]")).not.toBeNull();
    const download = q(el, "[data-test=download-key]") as HTMLAnchorElement;
    expect(download).not.toBeNull();
    expect(download.hasAttribute("download")).toBe(true);
    expect(download.getAttribute("download")).toMatch(/^waitron-recovery-key-/);
    expect(download.href).toMatch(/^blob:/);
    expect(q(el, "[data-test=saved-it]")).not.toBeNull();
  });

  it("keeps apply disabled until the saved-it checkbox is ticked", async () => {
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api: stubApi() });
    await flush(el);
    setInput(el, "[data-test=destination]", "/mnt/usb/waitron");
    await el.updateComplete;
    // Destination filled but not yet acknowledged → still disabled.
    expect(q(el, "[data-test=apply]")!.hasAttribute("disabled")).toBe(true);
    tickCheckbox(el, "[data-test=saved-it]");
    await el.updateComplete;
    expect(q(el, "[data-test=apply]")!.hasAttribute("disabled")).toBe(false);
  });

  it("advanced toggle reveals a paste-your-own-key field", async () => {
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api: stubApi() });
    await flush(el);
    expect(q(el, "[data-test=paste-key]")).toBeNull();
    q(el, "[data-test=advanced-toggle]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=paste-key]")).not.toBeNull();
    // The minted reveal is hidden while pasting your own.
    expect(q(el, "[data-test=minted-key]")).toBeNull();
  });

  it("is read-only when backups are managed by the environment", async () => {
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
      api: stubApi({}, MANAGED),
    });
    await flush(el);
    expect(q(el, "[data-test=managed]")).not.toBeNull();
    expect(q(el, "[data-test=destination]")).toBeNull();
    expect(q(el, "[data-test=apply]")).toBeNull();
  });

  it("apply sends the destination + key + policy and refreshes the status", async () => {
    const api = stubApi();
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    setInput(el, "[data-test=destination]", "/mnt/usb/waitron");
    tickCheckbox(el, "[data-test=saved-it]");
    await el.updateComplete;
    q(el, "[data-test=apply]")!.click();
    await flush(el);
    expect(api.applyBackup).toHaveBeenCalledWith({
      destinationDir: "/mnt/usb/waitron",
      recoveryKey: "MINTED-KEY-abcdef012345",
      schedule: { kind: "wall-clock", days: "daily", at: "auto" },
      retention: { count: 7, days: 30 },
    });
    // Refreshed to the enabled status returned by apply.
    expect(el.shadowRoot!.textContent).toContain("/mnt/usb/waitron");
  });

  it("surfaces a rejected apply as a localised role=alert (never the raw code)", async () => {
    const api = stubApi({
      applyBackup: vi.fn().mockRejectedValue({ code: "backup.not_primary" }),
    });
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    setInput(el, "[data-test=destination]", "/mnt/usb/waitron");
    tickCheckbox(el, "[data-test=saved-it]");
    await el.updateComplete;
    q(el, "[data-test=apply]")!.click();
    await flush(el);
    expect(errorKey(el)).toBe("backup.not_primary");
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("backup.not_primary", "es-ES"));
    expect(banner).not.toContain("backup.not_primary");
  });

  it("rotate re-shows the OLD key behind a loud warning before changing it", async () => {
    const api = stubApi({}, ENABLED);
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    // The rotate section is present only once backups are on, with its loud old-key warning.
    expect(q(el, "[data-test=rotate]")).not.toBeNull();
    expect(q(el, "[data-test=rotate-warning]")).not.toBeNull();
    // Re-showing the current key fetches the effective key and reveals it.
    q(el, "[data-test=show-old-key]")!.click();
    await flush(el);
    expect(api.getBackupRecoveryKey).toHaveBeenCalled();
    expect(q(el, "[data-test=old-key]")!.textContent).toContain("OLD-KEY-xyz789012345");
  });

  it("copies the minted key to the clipboard", async () => {
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api: stubApi() });
    await flush(el);
    const spy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    try {
      q(el, "[data-test=copy-key]")!.click();
      expect(spy).toHaveBeenCalledWith("MINTED-KEY-abcdef012345");
    } finally {
      spy.mockRestore();
    }
  });

  it("applies with a pasted key + a weekday/fixed-time policy", async () => {
    const api = stubApi();
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    setInput(el, "[data-test=destination]", "/mnt/disk/waitron");
    q(el, "[data-test=advanced-toggle]")!.click();
    await el.updateComplete;
    setInput(el, "[data-test=paste-key]", "correct-horse-battery-staple");
    selectValue(el, "[data-test=days-mode]", "weekdays");
    selectValue(el, "[data-test=time-mode]", "fixed");
    await el.updateComplete;
    q(el, "[data-test=weekday-6]")!.dispatchEvent(new Event("change", { bubbles: true }));
    q(el, "[data-test=weekday-1]")!.dispatchEvent(new Event("change", { bubbles: true }));
    setNativeInput(el, "[data-test=at-time]", "02:30");
    setNativeInput(el, "[data-test=retain-count]", "5");
    setNativeInput(el, "[data-test=retain-days]", "14");
    tickCheckbox(el, "[data-test=saved-it]");
    await el.updateComplete;
    q(el, "[data-test=apply]")!.click();
    await flush(el);
    expect(api.applyBackup).toHaveBeenCalledWith({
      destinationDir: "/mnt/disk/waitron",
      recoveryKey: "correct-horse-battery-staple",
      schedule: { kind: "wall-clock", days: [2, 3, 4, 5, 6], at: { hour: 2, minute: 30 } },
      retention: { count: 5, days: 14 },
    });
  });

  it("refuses a too-short pasted key with a specific message (and does not call apply)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    setInput(el, "[data-test=destination]", "/mnt/usb/waitron");
    q(el, "[data-test=advanced-toggle]")!.click();
    await el.updateComplete;
    setInput(el, "[data-test=paste-key]", "short");
    tickCheckbox(el, "[data-test=saved-it]");
    await el.updateComplete;
    q(el, "[data-test=apply]")!.click();
    await flush(el);
    expect(errorKey(el)).toBe("backup.recovery_key_too_short");
    expect(api.applyBackup).not.toHaveBeenCalled();
  });

  it("gates rotate on the old key being re-shown first, then confirms with the new minted key", async () => {
    const api = stubApi({}, ENABLED);
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    // Saved-it ticked but the OLD key not yet re-shown → rotate stays disabled (§8 step 1).
    tickCheckbox(el, "[data-test=saved-it]");
    await el.updateComplete;
    expect(q(el, "[data-test=rotate-confirm]")!.hasAttribute("disabled")).toBe(true);
    // Re-show the current key, then it enables and confirms with the new minted key.
    q(el, "[data-test=show-old-key]")!.click();
    await flush(el);
    expect(q(el, "[data-test=rotate-confirm]")!.hasAttribute("disabled")).toBe(false);
    q(el, "[data-test=rotate-confirm]")!.click();
    await flush(el);
    expect(api.rotateBackupKey).toHaveBeenCalledWith({ recoveryKey: "MINTED-KEY-abcdef012345" });
  });

  it("lets an enabled box change its destination through applyBackup, reusing the current key", async () => {
    const rotatedEnabled: BackupStatusView = {
      ...ENABLED,
      keyRotatedAt: "2026-09-05T09:00:00Z",
    };
    const api = stubApi({}, rotatedEnabled);
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    // The configure form is not shown outright on an enabled box; an edit affordance is.
    expect(q(el, "[data-test=destination]")).toBeNull();
    q(el, "[data-test=edit-settings]")!.click();
    await flush(el);
    // Entering edit fetched the current key and prefilled the destination from status.
    expect(api.getBackupRecoveryKey).toHaveBeenCalled();
    expect((q(el, "[data-test=destination]") as HTMLElement & { value: string }).value).toBe(
      "/mnt/usb/waitron",
    );
    setInput(el, "[data-test=destination]", "/mnt/usb/waitron-2");
    await el.updateComplete;
    q(el, "[data-test=save-settings]")!.click();
    await flush(el);
    // Re-applied under the SAME (current) key — the running schedule/retention are preserved.
    expect(api.applyBackup).toHaveBeenCalledWith({
      destinationDir: "/mnt/usb/waitron-2",
      recoveryKey: "OLD-KEY-xyz789012345",
      schedule: { kind: "wall-clock", days: "daily", at: "auto" },
      retention: { count: 7, days: 30 },
    });
  });

  it("surfaces keyRotatedAt and archiveUnderCurrentKey in the status view", async () => {
    const status: BackupStatusView = {
      ...ENABLED,
      keyRotatedAt: "2026-09-05T09:00:00Z",
      archiveUnderCurrentKey: false,
    };
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
      api: stubApi({}, status),
    });
    await flush(el);
    expect(q(el, "[data-test=key-rotated]")).not.toBeNull();
    expect(q(el, "[data-test=archive-current]")!.textContent).toContain(
      t("backup.status.archive_no"),
    );
  });

  it("labels the minted key's download file with the minted key, not the running key's fingerprint", async () => {
    // The running box already has key fingerprint "ab12cd34"; the freshly-minted key's download file
    // must NOT carry that (finding 4 — the old key's fingerprint mislabelling the new key's file).
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
      api: stubApi({}, ENABLED),
    });
    await flush(el);
    const download = q(el, "[data-test=download-key]") as HTMLAnchorElement;
    expect(download.getAttribute("download")).toMatch(/^waitron-recovery-key-/);
    expect(download.getAttribute("download")).not.toContain("ab12cd34");
  });

  it("is read-only on a non-primary node and does not mint a key", async () => {
    const api = stubApi({}, { ...OFF, isPrimary: false });
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    expect(q(el, "[data-test=not-primary]")).not.toBeNull();
    expect(q(el, "[data-test=destination]")).toBeNull();
    expect(q(el, "[data-test=apply]")).toBeNull();
    expect(api.mintBackupKey).not.toHaveBeenCalled();
  });

  it("shows a stale last-backup marker", async () => {
    const stale: BackupStatusView = {
      ...ENABLED,
      backupStatus: {
        configured: true,
        destinations: [
          { id: "primary", lastBackupAt: "2026-08-01T02:00:00Z", ageSeconds: 999999, stale: true },
        ],
      },
    };
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
      api: stubApi({}, stale),
    });
    await flush(el);
    expect(el.shadowRoot!.textContent).toContain(t("backup.status.stale"));
  });
});
