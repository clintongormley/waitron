import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import type {
  BackupDestinationStatus,
  BackupStatusView,
  BackupWriteAnswer,
  DashboardApi,
} from "../api/client.js";
import "./backup-screen.js";
import type { BackupScreen } from "./backup-screen.js";

afterEach(cleanupWidgets);

const VENUE = "c0000000-0000-4000-8000-000000000002";
const NAMESPACE = `waitron/archives/${VENUE}/`;

const quiet: BackupDestinationStatus = {
  id: "primary",
  lastBackupAt: null,
  ageSeconds: null,
  stale: false,
  readErrorCode: null,
  storedUnderCurrentKey: false,
  uploadErrorCode: null,
  pruneErrorCode: null,
};

const TWO: BackupStatusView = {
  venueId: VENUE,
  enabled: true,
  isPrimary: true,
  managedByEnvironment: false,
  source: "dashboard",
  revision: "6f1c2a43-8a49-4d0f-9b51-4d4f4c7c2a10",
  storedDisabled: false,
  loadErrorCode: null,
  destinations: [
    { id: "primary", kind: "local-fs", dir: "/mnt/usb/waitron" },
    {
      id: "bucket",
      kind: "s3",
      endpoint: null,
      region: "eu-north-1",
      bucket: "owner-bucket",
      prefix: "waitron",
      accessKeyId: "AKIAOWNER",
      namespace: NAMESPACE,
      credentialPresent: true,
    },
  ],
  schedule: { kind: "wall-clock", days: "daily", at: "auto" },
  retention: { count: 7, days: 30 },
  keyFingerprint: "ab12cd34",
  backupStatus: {
    configured: true,
    destinations: [
      { ...quiet, id: "primary" },
      { ...quiet, id: "bucket" },
    ],
  },
  archiveUnderCurrentKey: false,
  recoveryKeySet: true,
  recoveryKeyTooShort: false,
};

const LOCAL_ONLY: BackupStatusView = {
  ...TWO,
  destinations: [TWO.destinations[0]!],
  backupStatus: { configured: true, destinations: [{ ...quiet, id: "primary" }] },
};

function withOutcomes(
  primary: Partial<BackupDestinationStatus>,
  bucket: Partial<BackupDestinationStatus>,
): BackupStatusView {
  return {
    ...TWO,
    backupStatus: {
      configured: true,
      destinations: [
        { ...quiet, id: "primary", ...primary },
        { ...quiet, id: "bucket", ...bucket },
      ],
    },
  };
}

function stubApi(status: BackupStatusView, overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    getBackupStatus: vi.fn().mockResolvedValue(status),
    mintBackupKey: vi.fn().mockResolvedValue({ key: "MINTED-KEY-abcdef012345" }),
    applyBackup: vi.fn().mockResolvedValue(status),
    getBackupRecoveryKey: vi.fn().mockResolvedValue({ key: "OLD-KEY-xyz789012345" }),
    rotateBackupKey: vi.fn().mockResolvedValue(status),
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

const q = (el: BackupScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);

async function mount(status: BackupStatusView, overrides: Partial<DashboardApi> = {}) {
  const api = stubApi(status, overrides);
  const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
  await vi.waitFor(() => expect(q(el, "[data-test=status]")).not.toBeNull());
  await el.updateComplete;
  return { el, api };
}

function row(el: BackupScreen, id: string): HTMLElement {
  const found = q(el, `[data-test=destination-row][data-destination="${id}"]`);
  expect(found, `a status row for ${id}`).not.toBeNull();
  return found!;
}

const text = (node: HTMLElement) => node.textContent ?? "";

describe("what each destination did", () => {
  it("lists the local folder and the bucket on rows of their own, labelled on the box and off it", async () => {
    const { el } = await mount(TWO);
    const local = row(el, "primary");
    const bucket = row(el, "bucket");
    expect(local.dataset.place).toBe("local");
    expect(bucket.dataset.place).toBe("off-box");
    expect(text(local)).toContain(t("backup.destination.local"));
    expect(text(local)).toContain("/mnt/usb/waitron");
    expect(text(bucket)).toContain(t("backup.destination.off_box"));
    expect(text(bucket)).toContain(`owner-bucket/${NAMESPACE}`);
    expect(text(local)).not.toContain("owner-bucket");
  });

  it("says the bucket's upload failed while the local folder stored one, and claims no off-box success", async () => {
    const { el } = await mount({
      ...withOutcomes(
        { storedUnderCurrentKey: true, lastBackupAt: "2026-10-12T02:00:00Z", ageSeconds: 60 },
        { uploadErrorCode: "storage.upload_failed" },
      ),
      archiveUnderCurrentKey: true,
    });
    const local = row(el, "primary");
    const bucket = row(el, "bucket");
    expect(text(local)).toContain(t("backup.destination.stored"));
    expect(text(bucket)).toContain(t("backup.destination.failed"));
    expect(text(bucket)).toContain(codeMessage("storage.upload_failed"));
    expect(text(bucket)).not.toContain(t("backup.destination.stored"));
    expect(text(bucket)).not.toContain(t("backup.status.fresh"));
  });

  it("does not call a bucket stored because another destination stored one", async () => {
    const { el } = await mount({
      ...withOutcomes({ storedUnderCurrentKey: true }, {}),
      archiveUnderCurrentKey: true,
    });
    expect(text(row(el, "bucket"))).not.toContain(t("backup.destination.stored"));
  });

  it("says a destination that could not be listed could not be checked, not that nothing has run", async () => {
    const { el } = await mount(
      withOutcomes({}, { readErrorCode: "storage.unreachable", stale: true }),
    );
    const bucket = row(el, "bucket");
    expect(text(bucket)).toContain(t("backup.destination.unreadable"));
    expect(text(bucket)).not.toContain(t("backup.status.never"));
    expect(text(row(el, "primary"))).toContain(t("backup.status.never"));
  });

  it("shows a destination whose old backups could not be removed", async () => {
    const { el } = await mount(
      withOutcomes(
        {},
        {
          storedUnderCurrentKey: true,
          lastBackupAt: "2026-10-12T02:00:00Z",
          pruneErrorCode: "storage.delete_failed",
        },
      ),
    );
    const bucket = row(el, "bucket");
    expect(text(bucket)).toContain(t("backup.destination.prune_failed"));
    expect(text(bucket)).toContain(codeMessage("storage.delete_failed"));
    expect(text(row(el, "primary"))).not.toContain(t("backup.destination.prune_failed"));
  });

  it("says archives are off because the saved settings can't be used, and why", async () => {
    const { el } = await mount({
      ...TWO,
      enabled: false,
      loadErrorCode: "backup.archive_settings_invalid",
      backupStatus: { configured: false, loadErrorCode: "backup.archive_settings_invalid" },
    });
    const status = text(q(el, "[data-test=status]")!);
    expect(text(q(el, "[data-test=load-failed]")!)).toContain(t("backup.status.load_failed"));
    expect(status).toContain(codeMessage("backup.archive_settings_invalid"));
  });

  it("reads a stored-off record as switched off, still naming the saved destination", async () => {
    const { el } = await mount({
      ...LOCAL_ONLY,
      enabled: false,
      storedDisabled: true,
      backupStatus: { configured: false },
    });
    const status = text(q(el, "[data-test=status]")!);
    expect(status).toContain(t("backup.status.stored_off"));
    expect(text(row(el, "primary"))).toContain("/mnt/usb/waitron");
  });
});

describe("a write whose reload failed", () => {
  const reloadFailed = (status: BackupStatusView): BackupWriteAnswer => ({
    ...status,
    reloadErrorCode: "backup.archive_settings_invalid",
  });

  it("closes the editor, keeps the saved draft, and says the box could not load the settings", async () => {
    const { el, api } = await mount(LOCAL_ONLY, {
      applyBackup: vi.fn().mockResolvedValue(reloadFailed(LOCAL_ONLY)),
    });
    q(el, "[data-test=edit-settings]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=save-settings]")).not.toBeNull());
    q(el, "[data-test=destination]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "/mnt/usb/other" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    q(el, "[data-test=save-settings]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=save-settings]")).toBeNull());
    expect(api.applyBackup).toHaveBeenCalledOnce();
    const notice = q(el, "[data-test=reload-failed]");
    expect(notice).not.toBeNull();
    expect(text(notice!)).toContain(t("backup.reload_failed_after_save"));
    expect(text(notice!)).toContain(codeMessage("backup.archive_settings_invalid"));
    expect(q(el, "[role=alert]:not([data-test])")).toBeNull();
    expect(q(el, "[data-test=edit-settings]")).not.toBeNull();
  });

  it("after a first Apply, does not offer Apply again", async () => {
    const off: BackupStatusView = {
      ...LOCAL_ONLY,
      enabled: false,
      source: null,
      revision: null,
      destinations: [],
      backupStatus: { configured: false },
    };
    const { el, api } = await mount(off, {
      applyBackup: vi.fn().mockResolvedValue(reloadFailed({ ...LOCAL_ONLY })),
    });
    await vi.waitFor(() => expect(q(el, "[data-test=apply]")).not.toBeNull());
    q(el, "[data-test=destination]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "/mnt/usb/waitron" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=reload-failed]")).not.toBeNull());
    expect(api.applyBackup).toHaveBeenCalledWith(
      expect.objectContaining({ destination: { kind: "local-fs", dir: "/mnt/usb/waitron" } }),
    );
    expect(q(el, "[data-test=apply]")).toBeNull();
    expect(q(el, "[role=alert]:not([data-test])")).toBeNull();
  });
});
