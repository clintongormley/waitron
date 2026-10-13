import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./backup-screen.js";
import type { BackupScreen } from "./backup-screen.js";
import type { BackupStatusView, BackupWriteAnswer, DashboardApi } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";

/**
 * Scanned in several shapes, including the advanced paste + pick-weekdays + fixed-time branches so every
 * conditional control is scanned. The screen loads on connect, so the stub must resolve or a stray
 * rejection pollutes the run.
 */

const OFF: BackupStatusView = {
  venueId: "c0000000-0000-4000-8000-000000000002",
  enabled: false,
  isPrimary: true,
  managedByEnvironment: false,
  source: null,
  revision: null,
  storedDisabled: false,
  loadErrorCode: null,
  destinations: [],
  backupStatus: { configured: false },
  archiveUnderCurrentKey: false,
  recoveryKeySet: false,
  recoveryKeyTooShort: false,
};

const ENABLED: BackupStatusView = {
  venueId: "c0000000-0000-4000-8000-000000000002",
  enabled: true,
  isPrimary: true,
  managedByEnvironment: false,
  source: "dashboard",
  revision: "6f1c2a43-8a49-4d0f-9b51-4d4f4c7c2a10",
  storedDisabled: false,
  loadErrorCode: null,
  destinations: [{ id: "primary", kind: "local-fs", dir: "/mnt/usb/waitron" }],
  schedule: { kind: "wall-clock", days: "daily", at: "auto" },
  retention: { count: 7, days: 30 },
  keyFingerprint: "ab12cd34",
  backupStatus: {
    configured: true,
    destinations: [
      {
        id: "primary",
        lastBackupAt: "2026-09-09T02:00:00Z",
        ageSeconds: 3600,
        stale: false,
        readErrorCode: null,
        storedUnderCurrentKey: true,
        uploadErrorCode: null,
        pruneErrorCode: null,
      },
    ],
  },
  archiveUnderCurrentKey: true,
  recoveryKeySet: true,
  recoveryKeyTooShort: false,
};

const MANAGED: BackupStatusView = { ...OFF, managedByEnvironment: true };

const FAILING: BackupWriteAnswer = {
  ...ENABLED,
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
      namespace: `waitron/archives/${ENABLED.venueId}/`,
      credentialPresent: true,
    },
  ],
  backupStatus: {
    configured: true,
    destinations: [
      {
        id: "primary",
        lastBackupAt: "2026-09-09T02:00:00Z",
        ageSeconds: 3600,
        stale: false,
        readErrorCode: null,
        storedUnderCurrentKey: true,
        uploadErrorCode: "storage.upload_failed",
        pruneErrorCode: "storage.delete_failed",
      },
      {
        id: "bucket",
        lastBackupAt: null,
        ageSeconds: null,
        stale: true,
        readErrorCode: "storage.unreachable",
        storedUnderCurrentKey: false,
        uploadErrorCode: null,
        pruneErrorCode: null,
      },
    ],
  },
  reloadErrorCode: "backup.archive_settings_invalid",
};

function change(el: BackupScreen, sel: string, value: string): void {
  q(el, sel)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

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
  it("renders the destination choice with the bucket copy unavailable accessibly", async () => {
    const { el, host } = await mountWidget<BackupScreen>(
      "dashboard-backup-screen",
      { api: stubApi(OFF) },
      theme,
    );
    await flush(el);
    const box = q(el, "[data-test=archive-destination]") as HTMLElementTagNameMap["wt-combobox"];
    expect(box.options.find((o) => o.value === "stream-bucket")?.disabled).toBe(true);
    await expectNoA11yViolations(host);
  });

  it("renders a chosen bucket-copy bucket that has gone, marked after Save, accessibly", async () => {
    const getStreamSettings = vi.fn().mockResolvedValue({
      isPrimary: true,
      configured: true,
      bucket: {
        endpoint: null,
        region: "eu-north-1",
        bucket: "stream-bucket",
        prefix: "venues",
        accessKeyId: "AKIASTREAM",
      },
      status: { state: "streaming" },
      recoveryKeySet: true,
      keyFingerprint: "ab12cd34",
      revision: "11111111-2222-4333-8444-555555555555",
    });
    const api = stubApi({ ...OFF, recoveryKeySet: true }, { getStreamSettings });
    const { el, host } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api }, theme);
    await flush(el);
    await chooseOption(q(el, "[data-test=archive-destination]")!, "stream-bucket");
    getStreamSettings.mockResolvedValue({
      isPrimary: true,
      configured: false,
      bucket: null,
      status: { state: "off" },
      recoveryKeySet: true,
      keyFingerprint: "ab12cd34",
      revision: null,
    });
    api.liveData.invalidate([{ type: "backup_status" }]);
    await flush(el);
    q(el, "[data-test=apply]")!.click();
    await flush(el);
    expect(q(el, "[data-test=stream-unavailable]")).toBeNull();
    const box = q(el, "[data-test=archive-destination]") as HTMLElementTagNameMap["wt-combobox"];
    expect(box.error).not.toBe("");
    await expectNoA11yViolations(host);
  });

  it("renders the bucket copy's bucket chosen, with its location, accessibly", async () => {
    const { el, host } = await mountWidget<BackupScreen>(
      "dashboard-backup-screen",
      {
        api: stubApi(OFF, {
          getStreamSettings: vi.fn().mockResolvedValue({
            isPrimary: true,
            configured: true,
            bucket: {
              endpoint: null,
              region: "eu-north-1",
              bucket: "stream-bucket",
              prefix: "venues",
              accessKeyId: "AKIASTREAM",
            },
            status: { state: "streaming" },
            recoveryKeySet: true,
            keyFingerprint: "ab12cd34",
            revision: "11111111-2222-4333-8444-555555555555",
          }),
        }),
      },
      theme,
    );
    await flush(el);
    await chooseOption(q(el, "[data-test=archive-destination]")!, "stream-bucket");
    await el.updateComplete;
    expect(q(el, "[data-test=stream-location]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders another bucket's fields, with the secret refused, accessibly", async () => {
    const { el, host } = await mountWidget<BackupScreen>(
      "dashboard-backup-screen",
      {
        api: stubApi(
          { ...OFF, recoveryKeySet: true },
          {
            applyBackup: vi.fn().mockRejectedValue({
              code: "backup.request_invalid",
              params: { field: "secretAccessKey" },
            }),
          },
        ),
      },
      theme,
    );
    await flush(el);
    await chooseOption(q(el, "[data-test=archive-destination]")!, "custom-s3");
    await el.updateComplete;
    for (const [name, value] of [
      ["region", "eu-west-3"],
      ["name", "my-bucket"],
      ["access-key-id", "AKIAMINE"],
      ["secret-access-key", "SECRET-1"],
    ] as const) {
      q(el, `[data-test=archive-bucket-${name}]`)!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
      );
    }
    await el.updateComplete;
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(() =>
      expect(
        (q(el, "[data-test=archive-bucket-secret-access-key]") as HTMLElementTagNameMap["wt-input"])
          .error,
      ).not.toBe(""),
    );
    expect(q(el, "[data-test=custom-location]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

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

  it("renders an armed Turn off with its explanation and Cancel accessibly", async () => {
    const { el, host } = await mountWidget<BackupScreen>(
      "dashboard-backup-screen",
      { api: stubApi(ENABLED) },
      theme,
    );
    await flush(el);
    q(el, "[data-test=turn-off]")!.click();
    await flush(el);
    expect(q(el, "[data-test=turn-off-explain]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders stored settings that are switched off, ready to turn back on, accessibly", async () => {
    const { el, host } = await mountWidget<BackupScreen>(
      "dashboard-backup-screen",
      { api: stubApi({ ...ENABLED, enabled: false, storedDisabled: true }) },
      theme,
    );
    await flush(el);
    expect(q(el, "[data-test=apply]")).not.toBeNull();
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

  it("renders a shown archive recovery pack, with its warning, Copy and download, accessibly", async () => {
    const WITH_BUCKET: BackupStatusView = {
      ...ENABLED,
      destinations: [
        {
          id: "bucket",
          kind: "s3",
          endpoint: null,
          region: "eu-north-1",
          bucket: "owner-bucket",
          prefix: "waitron",
          accessKeyId: "AKIAOWNER",
          namespace: `waitron/archives/${ENABLED.venueId}/`,
          credentialPresent: true,
        },
      ],
      backupStatus: { configured: false },
    };
    const { el, host } = await mountWidget<BackupScreen>(
      "dashboard-backup-screen",
      {
        api: stubApi(WITH_BUCKET, {
          getArchiveRecoveryPack: vi.fn().mockResolvedValue({
            pack: "Waitron archive recovery pack.\n\nWAITRON-ARCHIVE-PACK-1:eyJ2ZXJzaW9uIjoxfQ\n",
            keyFingerprint: "ab12cd34",
            revision: ENABLED.revision,
          }),
        }),
      },
      theme,
    );
    await flush(el);
    q(el, "[data-test=show-pack]")!.click();
    await flush(el);
    expect(q(el, "[data-test=pack]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders a refused archive recovery pack accessibly", async () => {
    const { el, host } = await mountWidget<BackupScreen>(
      "dashboard-backup-screen",
      {
        api: stubApi(
          {
            ...ENABLED,
            destinations: [
              {
                id: "bucket",
                kind: "s3",
                endpoint: null,
                region: "eu-north-1",
                bucket: "owner-bucket",
                prefix: "waitron",
                accessKeyId: "AKIAOWNER",
                namespace: `waitron/archives/${ENABLED.venueId}/`,
                credentialPresent: true,
              },
            ],
            backupStatus: { configured: false },
          },
          {
            getArchiveRecoveryPack: vi
              .fn()
              .mockRejectedValue({ code: "backup.recovery_key_missing" }),
          },
        ),
      },
      theme,
    );
    await flush(el);
    q(el, "[data-test=show-pack]")!.click();
    await flush(el);
    expect(q(el, "[data-test=pack-failure]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders destinations whose upload failed, could not be checked and could not remove old backups, after a save the box could not load, accessibly", async () => {
    const { el, host } = await mountWidget<BackupScreen>(
      "dashboard-backup-screen",
      {
        api: stubApi(
          { ...OFF, recoveryKeySet: true },
          { applyBackup: vi.fn().mockResolvedValue(FAILING) },
        ),
      },
      theme,
    );
    await flush(el);
    change(el, "[data-test=destination]", "/mnt/usb/waitron");
    await el.updateComplete;
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=reload-failed]")).not.toBeNull());
    expect(q(el, "[data-test=reload-failed]")!.textContent).toContain(
      t("backup.reload_failed_after_save"),
    );
    const local = q(el, '[data-test=destination-row][data-destination="primary"]')!.textContent;
    expect(local).toContain(t("backup.destination.failed"));
    expect(local).toContain(codeMessage("storage.upload_failed"));
    expect(local).toContain(t("backup.destination.prune_failed"));
    const bucket = q(el, '[data-test=destination-row][data-destination="bucket"]')!.textContent;
    expect(bucket).toContain(t("backup.destination.unreadable"));
    await expectNoA11yViolations(host);
  });

  it("renders a required folder beside a failed bucket test's bottom message accessibly", async () => {
    const { el, host } = await mountWidget<BackupScreen>(
      "dashboard-backup-screen",
      {
        api: stubApi(
          { ...OFF, recoveryKeySet: true },
          {
            applyBackup: vi.fn().mockRejectedValue({
              code: "backup.archive_test_failed",
              params: { reason: "timed_out" },
            }),
          },
        ),
      },
      theme,
    );
    await flush(el);
    await chooseOption(q(el, "[data-test=archive-destination]")!, "custom-s3");
    await el.updateComplete;
    for (const [name, value] of [
      ["region", "eu-west-3"],
      ["name", "my-bucket"],
      ["access-key-id", "AKIAMINE"],
      ["secret-access-key", "SECRET-1"],
    ] as const)
      change(el, `[data-test=archive-bucket-${name}]`, value);
    await el.updateComplete;
    q(el, "[data-test=apply]")!.click();
    const actions = () =>
      q(el, "[data-test=apply-actions]") as HTMLElementTagNameMap["wt-form-actions"];
    await vi.waitFor(() =>
      expect(actions().error).toContain(codeMessage("backup.archive_test_failed")),
    );
    await chooseOption(q(el, "[data-test=archive-destination]")!, "local-fs");
    await el.updateComplete;
    const folder = q(el, "[data-test=destination]") as HTMLElementTagNameMap["wt-input"];
    expect(folder.error).toBe(t("backup.destination.folder_required"));
    expect(actions().error).toBe(
      `${codeMessage("backup.archive_test_failed")} ${t("backup.archive_test.timed_out")} ${t("form.fix_fields")}`,
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
