import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import type { BackupStatusView, DashboardApi, StreamSettingsView } from "../api/client.js";
import { BackupScreen } from "./backup-screen.js";

afterEach(cleanupWidgets);

const OFF: BackupStatusView = {
  enabled: false,
  isPrimary: true,
  managedByEnvironment: false,
  destinations: [],
  backupStatus: { configured: false },
  archiveUnderCurrentKey: false,
  recoveryKeySet: false,
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
};

const MANAGED: BackupStatusView = { ...OFF, managedByEnvironment: true };

const STREAM_ON: StreamSettingsView = {
  isPrimary: true,
  configured: true,
  bucket: {
    endpoint: null,
    region: "eu-west-1",
    bucket: "venue-copy",
    prefix: "",
    accessKeyId: "AKIAEXAMPLE",
  },
  status: { state: "off" },
  recoveryKeySet: true,
  keyFingerprint: "ab12cd34",
};

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
    getStreamSettings: vi.fn().mockResolvedValue({
      isPrimary: true,
      configured: false,
      bucket: null,
      status: { state: "off" },
      recoveryKeySet: false,
      keyFingerprint: null,
    }),
    getRecoveryKit: vi
      .fn()
      .mockResolvedValue({ kit: "WAITRON-RECOVERY-KIT-1:abc", keyFingerprint: "ffee0011" }),
    liveData: new LiveData(),
    ...overrides,
  } as unknown as DashboardApi;
}

const panelOf = (el: BackupScreen) =>
  el.shadowRoot!.querySelector("dashboard-stream-settings")!.shadowRoot!;

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
  it("turning backups on with a recovery key already held mints none and sends none", async () => {
    const api = stubApi({}, { ...OFF, recoveryKeySet: true });
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    expect(api.mintBackupKey).not.toHaveBeenCalled();
    expect(q(el, "[data-test=minted-key]")).toBeNull();
    expect(q(el, "[data-test=saved-it]")).toBeNull();
    expect(q(el, "[data-test=existing-key]")!.textContent!.trim()).toBe(t("backup.key.existing"));
    expect((q(el, "[data-test=apply]") as HTMLElement & { disabled: boolean }).disabled).toBe(true);
    setInput(el, "[data-test=destination]", "/mnt/usb/waitron");
    await el.updateComplete;
    q(el, "[data-test=apply]")!.click();
    await flush(el);
    // No `recoveryKey` at all: the server uses the one it holds.
    expect(api.applyBackup).toHaveBeenCalledWith({
      destinationDir: "/mnt/usb/waitron",
      schedule: { kind: "wall-clock", days: "daily", at: "auto" },
      retention: { count: 7, days: 30 },
    });
  });

  it("explains a refused second recovery key in words", async () => {
    const api = stubApi(
      { applyBackup: vi.fn().mockRejectedValue({ code: "backup.recovery_key_exists" }) },
      { ...OFF, recoveryKeySet: true },
    );
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    setInput(el, "[data-test=destination]", "/mnt/usb/waitron");
    await el.updateComplete;
    q(el, "[data-test=apply]")!.click();
    await flush(el);
    expect(q(el, "[role=alert]")!.textContent).toContain(codeMessage("backup.recovery_key_exists"));
  });

  it("shows the bucket copy under the archive settings, handing it the api and the running key's fingerprint", async () => {
    const api = stubApi({}, ENABLED);
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    const panel = q(el, "dashboard-stream-settings") as HTMLElement & { api: DashboardApi };
    expect(panel.api).toBe(api);
    expect(api.getStreamSettings).toHaveBeenCalled();
  });

  it("stops offering its minted key as soon as the bucket copy's Save has given the box one", async () => {
    const api = stubApi({ saveStreamSettings: vi.fn().mockResolvedValue(STREAM_ON) });
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    expect(q(el, "[data-test=minted-key]")).not.toBeNull();
    vi.mocked(api.getBackupStatus).mockResolvedValue({ ...OFF, recoveryKeySet: true });
    const panel = panelOf(el);
    for (const [name, value] of [
      ["bucket-region", "eu-west-1"],
      ["bucket-name", "venue-copy"],
      ["bucket-access-key-id", "AKIAEXAMPLE"],
      ["bucket-secret-access-key", "not-a-real-secret-0123456789"],
    ]) {
      panel
        .querySelector(`wt-input[name=${name}]`)!
        .dispatchEvent(
          new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
        );
    }
    await el.updateComplete;
    panel.querySelector<HTMLElement>("[data-test=save]")!.click();
    // Well inside the status's own refresh interval, so only the Save's word can have done it.
    await vi.waitFor(() => expect(q(el, "[data-test=existing-key]")).not.toBeNull(), {
      timeout: 2_000,
    });
    expect(q(el, "[data-test=minted-key]")).toBeNull();
  });

  it("lets the bucket copy re-issue its kit when the key changes while archives are off", async () => {
    const api = stubApi(
      { getStreamSettings: vi.fn().mockResolvedValue(STREAM_ON) },
      { ...OFF, recoveryKeySet: true },
    );
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    vi.mocked(api.getStreamSettings).mockResolvedValue({
      ...STREAM_ON,
      keyFingerprint: "ffee0011",
    });
    api.liveData.invalidate([{ type: "backup_status" }]);
    await vi.waitFor(() =>
      expect(panelOf(el).querySelector("[data-test=kit-reissued]")).not.toBeNull(),
    );
    expect(api.getRecoveryKit).toHaveBeenCalledOnce();
  });

  it("has the bucket copy re-issue its kit as soon as a rotate here changes the key", async () => {
    const api = stubApi(
      {
        getStreamSettings: vi.fn().mockResolvedValue(STREAM_ON),
        rotateBackupKey: vi.fn().mockResolvedValue({ ...ENABLED, keyFingerprint: "ffee0011" }),
      },
      ENABLED,
    );
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    q(el, "[data-test=show-old-key]")!.click();
    await flush(el);
    tickCheckbox(el, "[data-test=saved-it]");
    await el.updateComplete;
    vi.mocked(api.getStreamSettings).mockResolvedValue({
      ...STREAM_ON,
      keyFingerprint: "ffee0011",
    });
    q(el, "[data-test=rotate-confirm]")!.click();
    await vi.waitFor(
      () => expect(panelOf(el).querySelector("[data-test=kit-reissued]")).not.toBeNull(),
      { timeout: 2_000 },
    );
    expect(api.getRecoveryKit).toHaveBeenCalledOnce();
  });

  it("exports prepared configuration under a confirmed passphrase", async () => {
    const api = stubApi({
      exportConfiguration: vi
        .fn()
        .mockResolvedValue(new Blob(["artifact"], { type: "application/octet-stream" })),
    });
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:configuration");
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    setInput(el, "[data-test=configuration-passphrase]", "a strong passphrase");
    setInput(el, "[data-test=configuration-confirm]", "a strong passphrase");
    (q(el, "[data-test=configuration-export]") as HTMLElement).click();
    await flush(el);
    expect(api.exportConfiguration).toHaveBeenCalledWith("a strong passphrase");
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    createObjectURL.mockRestore();
    click.mockRestore();
  });

  it("explains a configuration export passphrase mismatch beside both fields", async () => {
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api: stubApi() });
    await flush(el);
    setInput(el, "[data-test=configuration-passphrase]", "a strong passphrase");
    setInput(el, "[data-test=configuration-confirm]", "a different passphrase");
    (q(el, "[data-test=configuration-export]") as HTMLElement).click();
    await el.updateComplete;
    expect(q(el, "[data-test=configuration-error]")?.textContent?.trim()).not.toBe("");
    const fields = el.shadowRoot!.querySelectorAll("[data-test=configuration-field-error]");
    expect(fields).toHaveLength(2);
    expect(fields[0]?.textContent).toBe(fields[1]?.textContent);
  });

  it("lets the operator reveal both configuration export passphrases", async () => {
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api: stubApi() });
    await flush(el);
    const passphrase = q(el, "[data-test=configuration-passphrase]")!;
    const confirmation = q(el, "[data-test=configuration-confirm]")!;
    q(el, "[data-test=toggle-configuration-passphrase]")!.click();
    q(el, "[data-test=toggle-configuration-confirm]")!.click();
    await el.updateComplete;
    expect(passphrase.getAttribute("type")).toBe("text");
    expect(confirmation.getAttribute("type")).toBe("text");
  });

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
    // Saved-it ticked but the OLD key not yet re-shown → rotate stays disabled.
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
    // must NOT carry that.
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

it("refreshes backup status without minting another recovery key", async () => {
  const api = stubApi();
  const { liveData } = api;
  const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
  await flush(el);
  expect(api.mintBackupKey).toHaveBeenCalledOnce();
  vi.mocked(api.getBackupStatus).mockResolvedValue(ENABLED);
  liveData.invalidate([{ type: "backup_status" }]);
  await vi.waitFor(() =>
    expect((el as unknown as { status: BackupStatusView }).status).toEqual(ENABLED),
  );
  expect(api.mintBackupKey).toHaveBeenCalledOnce();
});

describe("backup-screen failures and edit-mode prefill", () => {
  async function mountLoaded(api: DashboardApi): Promise<BackupScreen> {
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await vi.waitFor(() => expect(q(el, "[data-test=status]")).not.toBeNull());
    return el;
  }

  const alertText = (el: BackupScreen) => q(el, "[role=alert]:not([data-test])")?.textContent;

  async function enterEdit(status: BackupStatusView) {
    const api = stubApi({}, status);
    const el = await mountLoaded(api);
    await vi.waitFor(() => expect(q(el, "[data-test=edit-settings]")).not.toBeNull());
    q(el, "[data-test=edit-settings]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=save-settings]")).not.toBeNull());
    return { el, api };
  }

  it("shows a localized alert and keeps apply disabled when no key can be minted", async () => {
    const api = stubApi({
      mintBackupKey: vi.fn().mockRejectedValue({ code: "connection.failed" }),
    });
    const el = await mountLoaded(api);
    await vi.waitFor(() => expect(alertText(el)).toBe(codeMessage("connection.failed")));

    setInput(el, "[data-test=destination]", "/mnt/usb/waitron");
    tickCheckbox(el, "[data-test=saved-it]");
    await el.updateComplete;

    expect(q(el, "[data-test=minted-key]")).toBeNull();
    expect(q(el, "[data-test=apply]")!.hasAttribute("disabled")).toBe(true);
  });

  it("shows a localized alert when the current key cannot be re-shown", async () => {
    const api = stubApi(
      { getBackupRecoveryKey: vi.fn().mockRejectedValue({ code: "connection.failed" }) },
      ENABLED,
    );
    const el = await mountLoaded(api);

    q(el, "[data-test=show-old-key]")!.click();

    await vi.waitFor(() => expect(alertText(el)).toBe(codeMessage("connection.failed")));
    expect(q(el, "[data-test=old-key]")).toBeNull();
  });

  it("copies the re-shown old key to the clipboard", async () => {
    const el = await mountLoaded(stubApi({}, ENABLED));
    q(el, "[data-test=show-old-key]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=copy-old-key]")).not.toBeNull());
    const spy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    try {
      q(el, "[data-test=copy-old-key]")!.click();
      expect(spy).toHaveBeenCalledWith("OLD-KEY-xyz789012345");
    } finally {
      spy.mockRestore();
    }
  });

  it("names an empty re-shown key's download file with the box fallback", async () => {
    const el = await mountLoaded(
      stubApi({ getBackupRecoveryKey: vi.fn().mockResolvedValue({ key: "" }) }, ENABLED),
    );

    q(el, "[data-test=show-old-key]")!.click();

    await vi.waitFor(() => expect(q(el, "[data-test=download-old-key]")).not.toBeNull());
    expect(q(el, "[data-test=download-old-key]")!.getAttribute("download")).toMatch(
      /^waitron-recovery-key-box-/,
    );
  });

  it("shows a localized alert and keeps the re-shown key when a rotate is rejected", async () => {
    const api = stubApi(
      { rotateBackupKey: vi.fn().mockRejectedValue({ code: "connection.failed" }) },
      ENABLED,
    );
    const el = await mountLoaded(api);
    q(el, "[data-test=show-old-key]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=old-key]")).not.toBeNull());
    tickCheckbox(el, "[data-test=saved-it]");
    await el.updateComplete;

    q(el, "[data-test=rotate-confirm]")!.click();

    await vi.waitFor(() => expect(alertText(el)).toBe(codeMessage("connection.failed")));
    expect(q(el, "[data-test=old-key]")).not.toBeNull();
    expect(api.mintBackupKey).toHaveBeenCalledTimes(1);
  });

  it("refuses to rotate to a too-short pasted key", async () => {
    const api = stubApi({}, ENABLED);
    const el = await mountLoaded(api);
    q(el, "[data-test=show-old-key]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=old-key]")).not.toBeNull());
    q(el, "[data-test=advanced-toggle]")!.click();
    await el.updateComplete;
    setInput(el, "[data-test=paste-key]", "short");
    tickCheckbox(el, "[data-test=saved-it]");
    await el.updateComplete;

    q(el, "[data-test=rotate-confirm]")!.click();
    await el.updateComplete;

    expect(api.rotateBackupKey).not.toHaveBeenCalled();
    expect(alertText(el)).toBe(codeMessage("backup.recovery_key_too_short"));
  });

  it("refuses to edit settings when the box reports no current key", async () => {
    const api = stubApi(
      { getBackupRecoveryKey: vi.fn().mockResolvedValue({ key: null }) },
      ENABLED,
    );
    const el = await mountLoaded(api);

    q(el, "[data-test=edit-settings]")!.click();

    await vi.waitFor(() => expect(alertText(el)).toBe(codeMessage("backup.recovery_key_missing")));
    expect(q(el, "[data-test=edit-title]")).toBeNull();
    expect(q(el, "[data-test=edit-settings]")).not.toBeNull();
  });

  it("shows a localized alert when entering edit mode fails", async () => {
    const api = stubApi(
      { getBackupRecoveryKey: vi.fn().mockRejectedValue({ code: "connection.failed" }) },
      ENABLED,
    );
    const el = await mountLoaded(api);

    q(el, "[data-test=edit-settings]")!.click();

    await vi.waitFor(() => expect(alertText(el)).toBe(codeMessage("connection.failed")));
    expect(q(el, "[data-test=edit-title]")).toBeNull();
  });

  it("keeps the edit form open with a localized alert when saving settings is rejected", async () => {
    const { el, api } = await enterEdit(ENABLED);
    vi.mocked(api.applyBackup).mockRejectedValue({ code: "connection.failed" });

    q(el, "[data-test=save-settings]")!.click();

    await vi.waitFor(() => expect(alertText(el)).toBe(codeMessage("connection.failed")));
    expect(q(el, "[data-test=edit-title]")).not.toBeNull();
  });

  it("does not save settings while the destination is blank", async () => {
    const { el, api } = await enterEdit(ENABLED);
    setInput(el, "[data-test=destination]", "   ");
    await el.updateComplete;
    expect(q(el, "[data-test=save-settings]")!.hasAttribute("disabled")).toBe(true);

    q(el, "[data-test=save-settings]")!.click();
    await el.updateComplete;

    expect(api.applyBackup).not.toHaveBeenCalled();
  });

  it("cancels edit mode back to the status view, clearing the banner", async () => {
    const { el, api } = await enterEdit(ENABLED);
    vi.mocked(api.applyBackup).mockRejectedValueOnce({ code: "connection.failed" });
    q(el, "[data-test=save-settings]")!.click();
    await vi.waitFor(() => expect(alertText(el)).toBe(codeMessage("connection.failed")));

    q(el, "[data-test=cancel-edit]")!.click();
    await el.updateComplete;

    expect(q(el, "[data-test=edit-title]")).toBeNull();
    expect(q(el, "[data-test=edit-settings]")).not.toBeNull();
    expect(alertText(el)).toBeUndefined();
    q(el, "[data-test=edit-settings]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=save-settings]")).not.toBeNull());
    q(el, "[data-test=save-settings]")!.click();
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.applyBackup).mock.calls[1]![0].recoveryKey).toBe("OLD-KEY-xyz789012345");
  });

  it("prefills picked weekdays and a fixed time, and re-applies them unchanged", async () => {
    const { el, api } = await enterEdit({
      ...ENABLED,
      schedule: { kind: "wall-clock", days: [0, 3], at: { hour: 2, minute: 5 } },
    });

    expect((q(el, "[data-test=days-mode]") as HTMLSelectElement).value).toBe("weekdays");
    expect((q(el, "[data-test=weekday-0]") as HTMLInputElement).checked).toBe(true);
    expect((q(el, "[data-test=weekday-3]") as HTMLInputElement).checked).toBe(true);
    expect((q(el, "[data-test=weekday-1]") as HTMLInputElement).checked).toBe(false);
    expect((q(el, "[data-test=at-time]") as HTMLInputElement).value).toBe("02:05");

    q(el, "[data-test=save-settings]")!.click();

    await vi.waitFor(() =>
      expect(api.applyBackup).toHaveBeenCalledWith({
        destinationDir: "/mnt/usb/waitron",
        recoveryKey: "OLD-KEY-xyz789012345",
        schedule: { kind: "wall-clock", days: [0, 3], at: { hour: 2, minute: 5 } },
        retention: { count: 7, days: 30 },
      }),
    );
  });

  it("leaves the schedule and retention at their defaults when the running policy is not one the form can author", async () => {
    const { el, api } = await enterEdit({
      ...ENABLED,
      destinations: [],
      schedule: { kind: "interval", ms: 3_600_000 },
      retention: undefined,
    });

    expect((q(el, "[data-test=destination]") as HTMLElement & { value: string }).value).toBe("");
    setInput(el, "[data-test=destination]", "/mnt/usb/new");
    await el.updateComplete;
    q(el, "[data-test=save-settings]")!.click();

    await vi.waitFor(() =>
      expect(api.applyBackup).toHaveBeenCalledWith({
        destinationDir: "/mnt/usb/new",
        recoveryKey: "OLD-KEY-xyz789012345",
        schedule: { kind: "wall-clock", days: "daily", at: "auto" },
        retention: { count: 7, days: 30 },
      }),
    );
  });

  it("says no backup has run when the destination has not received one yet", async () => {
    const el = await mountLoaded(
      stubApi({}, {
        ...ENABLED,
        backupStatus: {
          configured: true,
          destinations: [{ id: "primary", lastBackupAt: null, ageSeconds: null, stale: true }],
        },
      } as BackupStatusView),
    );

    expect(el.shadowRoot!.textContent).toContain(t("backup.status.never"));
    expect(el.shadowRoot!.textContent).not.toContain(t("backup.status.stale"));
  });

  it("says no backup has run when a configured duty reports no destinations", async () => {
    const el = await mountLoaded(
      stubApi({}, { ...ENABLED, backupStatus: { configured: true, destinations: [] } }),
    );

    expect(el.shadowRoot!.textContent).toContain(t("backup.status.never"));
  });

  it("refuses a configuration export passphrase below the minimum length", async () => {
    const api = stubApi({ exportConfiguration: vi.fn() });
    const el = await mountLoaded(api);
    setInput(el, "[data-test=configuration-passphrase]", "short");
    setInput(el, "[data-test=configuration-confirm]", "short");

    q(el, "[data-test=configuration-export]")!.click();
    await el.updateComplete;

    expect(api.exportConfiguration).not.toHaveBeenCalled();
    expect(q(el, "[data-test=configuration-error]")!.textContent!.trim()).toBe(
      t("backup.configuration.form_error"),
    );
    const fieldErrors = el.shadowRoot!.querySelectorAll("[data-test=configuration-field-error]");
    expect(fieldErrors).toHaveLength(2);
    expect(fieldErrors[0]!.textContent).toBe(t("backup.configuration.passphrase_error"));
  });

  it("explains a failed configuration export without blaming the fields, and keeps the passphrase", async () => {
    const api = stubApi({ exportConfiguration: vi.fn().mockRejectedValue(new Error("offline")) });
    const el = await mountLoaded(api);
    setInput(el, "[data-test=configuration-passphrase]", "a strong passphrase");
    setInput(el, "[data-test=configuration-confirm]", "a strong passphrase");

    q(el, "[data-test=configuration-export]")!.click();

    await vi.waitFor(() =>
      expect(q(el, "[data-test=configuration-error]")?.textContent?.trim()).toBe(
        t("backup.configuration.request_error"),
      ),
    );
    expect(q(el, "[data-test=configuration-field-error]")).toBeNull();
    expect(
      (q(el, "[data-test=configuration-passphrase]") as HTMLElement & { value: string }).value,
    ).toBe("a strong passphrase");
    expect(q(el, "[data-test=configuration-export]")!.hasAttribute("disabled")).toBe(false);
  });
});

it("keeps the minted key on screen when the clipboard refuses the copy", async () => {
  const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api: stubApi() });
  await vi.waitFor(() => expect(q(el, "[data-test=copy-key]")).not.toBeNull());
  // A plain function, not a vi spy: a spy observes the promise it returns, which would mark the
  // refusal handled and hide a missing catch.
  const copied: string[] = [];
  Object.defineProperty(navigator.clipboard, "writeText", {
    configurable: true,
    value: (text: string) => {
      copied.push(text);
      return Promise.reject(new DOMException("denied", "NotAllowedError"));
    },
  });
  const unhandled: unknown[] = [];
  const onRejection = (event: PromiseRejectionEvent) => {
    unhandled.push(event.reason);
    event.preventDefault();
  };
  window.addEventListener("unhandledrejection", onRejection);
  try {
    q(el, "[data-test=copy-key]")!.click();
    expect(copied).toEqual(["MINTED-KEY-abcdef012345"]);
    // Rejections are reported in the order they went unhandled, so once this marker arrives any
    // unhandled clipboard refusal from the click above has been reported too.
    const marker = new Error("marker");
    void Promise.reject(marker);
    await vi.waitFor(() => expect(unhandled).toContain(marker));

    expect(unhandled).toEqual([marker]);
    expect(q(el, "[data-test=minted-key]")!.textContent).toBe("MINTED-KEY-abcdef012345");
    expect(q(el, "[role=alert]")).toBeNull();
  } finally {
    window.removeEventListener("unhandledrejection", onRejection);
    delete (navigator.clipboard as unknown as Record<string, unknown>)["writeText"];
  }
});
