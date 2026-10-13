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

  it("says the bucket failed when a later upload failed after an earlier one was stored", async () => {
    const { el } = await mount(
      withOutcomes(
        {},
        {
          storedUnderCurrentKey: true,
          uploadErrorCode: "storage.upload_failed",
          lastBackupAt: "2026-10-12T02:00:00Z",
          ageSeconds: 60,
        },
      ),
    );
    const bucket = row(el, "bucket");
    expect(text(bucket)).toContain(t("backup.destination.failed"));
    expect(text(bucket)).not.toContain(t("backup.destination.stored"));
  });

  it("does not call a failed bucket up to date because its last stored backup is recent", async () => {
    const { el } = await mount(
      withOutcomes(
        {},
        {
          uploadErrorCode: "storage.upload_failed",
          lastBackupAt: "2026-10-12T02:00:00Z",
          ageSeconds: 60,
          stale: false,
        },
      ),
    );
    const bucket = row(el, "bucket");
    expect(text(bucket)).toContain(t("backup.destination.failed"));
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

  it("when the saved settings can't be used, shows no refusal and leaves Apply quiet", async () => {
    const off: BackupStatusView = {
      ...LOCAL_ONLY,
      enabled: false,
      source: null,
      revision: null,
      destinations: [],
      backupStatus: { configured: false },
    };
    const unusable: BackupWriteAnswer = {
      ...off,
      loadErrorCode: "backup.archive_settings_invalid",
      backupStatus: { configured: false, loadErrorCode: "backup.archive_settings_invalid" },
      reloadErrorCode: "backup.archive_settings_invalid",
    };
    const { el } = await mount(off, { applyBackup: vi.fn().mockResolvedValue(unusable) });
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
    expect(q(el, "[role=alert]:not([data-test])")).toBeNull();
    const apply = q(el, "[data-test=apply]") as HTMLElementTagNameMap["wt-button"];
    expect(apply).not.toBeNull();
    await apply.updateComplete;
    expect([apply.variant, apply.disabled]).toEqual(["secondary", true]);
  });

  it("after saving settings that can't be used, closes the editor and leaves Apply quiet with the folder kept", async () => {
    const unusable: BackupWriteAnswer = {
      ...LOCAL_ONLY,
      enabled: false,
      destinations: [],
      loadErrorCode: "backup.archive_settings_invalid",
      backupStatus: { configured: false, loadErrorCode: "backup.archive_settings_invalid" },
      reloadErrorCode: "backup.archive_settings_invalid",
    };
    const { el } = await mount(LOCAL_ONLY, { applyBackup: vi.fn().mockResolvedValue(unusable) });
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
    await vi.waitFor(() => expect(q(el, "[data-test=apply]")).not.toBeNull());
    expect(q(el, "[role=alert]:not([data-test])")).toBeNull();
    const apply = q(el, "[data-test=apply]") as HTMLElementTagNameMap["wt-button"];
    await apply.updateComplete;
    expect([apply.variant, apply.disabled]).toEqual(["secondary", true]);
    expect((q(el, "[data-test=destination]") as HTMLElementTagNameMap["wt-input"]).value).toBe(
      "/mnt/usb/other",
    );
  });
});

const STREAM_BUCKET = {
  endpoint: null,
  region: "eu-north-1",
  bucket: "stream-bucket",
  prefix: "venues",
  accessKeyId: "AKIASTREAM",
};

const STREAM_ON = {
  isPrimary: true,
  configured: true,
  bucket: STREAM_BUCKET,
  status: { state: "streaming" },
  recoveryKeySet: true,
  keyFingerprint: "ab12cd34",
  revision: "11111111-2222-4333-8444-555555555555",
};

const OFF_WITH_KEY: BackupStatusView = {
  ...LOCAL_ONLY,
  enabled: false,
  source: null,
  revision: null,
  destinations: [],
  backupStatus: { configured: false },
};

/** Archives on, stored as the same bucket the stream uses. */
const ON_STREAM_BUCKET: BackupStatusView = {
  ...TWO,
  destinations: [
    {
      id: "bucket",
      kind: "s3",
      ...STREAM_BUCKET,
      namespace: `venues/archives/${VENUE}/`,
      credentialPresent: true,
    },
  ],
  backupStatus: { configured: true, destinations: [{ ...quiet, id: "bucket" }] },
};

type Combo = HTMLElementTagNameMap["wt-combobox"];
type Field = HTMLElementTagNameMap["wt-input"];
type Button = HTMLElementTagNameMap["wt-button"];

const choice = (el: BackupScreen) => q(el, "wt-combobox[name=archive-destination]") as Combo | null;

async function choose(el: BackupScreen, value: string) {
  const box = choice(el)!;
  box.value = value;
  box.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

async function typeFolder(el: BackupScreen, value: string) {
  q(el, "[data-test=destination]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

async function buttonState(el: BackupScreen, test: string) {
  await el.updateComplete;
  const button = q(el, `[data-test=${test}]`) as Button;
  await button.updateComplete;
  return [button.variant, button.disabled];
}

async function bottomOf(el: BackupScreen, test: string): Promise<string | null> {
  const actions = q(el, `[data-test=${test}]`) as HTMLElement & {
    updateComplete: Promise<unknown>;
  };
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[role=alert]")?.textContent ?? null;
}

const banner = (el: BackupScreen) => q(el, ".error[role=alert]");

async function openConfigure(overrides: Partial<DashboardApi> = {}) {
  const { el, api } = await mount(OFF_WITH_KEY, {
    getStreamSettings: vi.fn().mockResolvedValue(STREAM_ON),
    ...overrides,
  });
  await vi.waitFor(() => expect(q(el, "[data-test=apply]")).not.toBeNull());
  await vi.waitFor(() =>
    expect(choice(el)!.options.find((o) => o.value === "stream-bucket")?.disabled).toBeFalsy(),
  );
  return { el, api };
}

async function openEdit(status: BackupStatusView, overrides: Partial<DashboardApi> = {}) {
  const { el, api } = await mount(status, {
    getStreamSettings: vi.fn().mockResolvedValue(STREAM_ON),
    ...overrides,
  });
  await vi.waitFor(() => expect(api.getStreamSettings).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 0));
  q(el, "[data-test=edit-settings]")!.click();
  await vi.waitFor(() => expect(q(el, "[data-test=save-settings]")).not.toBeNull());
  return { el, api };
}

describe("choosing where backups go", () => {
  it("offers a local folder or the bucket copy's bucket, as a named choice", async () => {
    const { el } = await openConfigure();
    const box = choice(el)!;
    expect(box.value).toBe("local-fs");
    expect(box.options.map((o) => o.value)).toEqual(["local-fs", "stream-bucket"]);
  });

  it("with no bucket copy set up, the bucket choice is unavailable and the form says why", async () => {
    const { el } = await mount(OFF_WITH_KEY);
    await vi.waitFor(() => expect(choice(el)).not.toBeNull());
    const option = choice(el)!.options.find((o) => o.value === "stream-bucket")!;
    expect(option.disabled).toBe(true);
    expect(option.description).toBe(t("backup.destination.stream_unavailable"));
    expect(text(q(el, "[data-test=stream-unavailable]")!).trim()).toBe(
      t("backup.destination.stream_unavailable"),
    );
  });

  it("names the folder field, marks it required, and hides it for the bucket choice", async () => {
    const { el } = await openConfigure();
    const folder = q(el, "[data-test=destination]") as Field;
    expect(folder.getAttribute("name")).toBe("backup-folder");
    expect(folder.required).toBe(true);
    await choose(el, "stream-bucket");
    expect(q(el, "[data-test=destination]")).toBeNull();
  });

  it("choosing the bucket copy's bucket sends that kind alone, and says what Save copies and where archives go", async () => {
    const { el, api } = await openConfigure();
    await choose(el, "stream-bucket");
    expect(text(q(el, "[data-test=stream-snapshot]")!)).toContain(
      t("backup.destination.stream_snapshot"),
    );
    expect(text(q(el, "[data-test=stream-replaces]")!)).toContain(
      t("backup.destination.stream_replaces"),
    );
    expect(text(q(el, "[data-test=stream-location]")!)).toContain(
      `stream-bucket/venues/archives/${VENUE}/`,
    );
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledOnce());
    const body = vi.mocked(api.applyBackup).mock.calls[0]![0];
    expect(body.destination).toEqual({ kind: "stream-bucket" });
    expect(JSON.stringify(body)).not.toContain("stream-bucket/");
  });

  it("Apply opens quiet, wakes on a choice change, and quiets when changed back; a forced press while unchanged sends nothing", async () => {
    const { el, api } = await openConfigure();
    expect(await buttonState(el, "apply")).toEqual(["secondary", true]);
    await choose(el, "stream-bucket");
    expect(await buttonState(el, "apply")).toEqual(["primary", false]);
    await choose(el, "local-fs");
    expect(await buttonState(el, "apply")).toEqual(["secondary", true]);
    q(el, "[data-test=apply]")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.applyBackup).not.toHaveBeenCalled();
  });

  it("a stored bucket that is the bucket copy's opens on that choice, with Save quiet", async () => {
    const { el } = await openEdit(ON_STREAM_BUCKET);
    expect(choice(el)!.value).toBe("stream-bucket");
    expect(await buttonState(el, "save-settings")).toEqual(["secondary", true]);
  });

  it("a stored bucket that is not the bucket copy's opens on the local folder, empty", async () => {
    const { el } = await openEdit(ON_STREAM_BUCKET, {
      getStreamSettings: vi.fn().mockResolvedValue({
        ...STREAM_ON,
        bucket: { ...STREAM_BUCKET, accessKeyId: "AKIAOTHER" },
      }),
    });
    expect(choice(el)!.value).toBe("local-fs");
    expect((q(el, "[data-test=destination]") as Field).value).toBe("");
  });

  it("an empty folder is held by the form's own check: the field says why, no request goes", async () => {
    const { el, api } = await openEdit(LOCAL_ONLY);
    await typeFolder(el, "");
    expect(await buttonState(el, "save-settings")).toEqual(["primary", false]);
    q(el, "[data-test=save-settings]")!.click();
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.applyBackup).not.toHaveBeenCalled();
    expect((q(el, "[data-test=destination]") as Field).error).toBe(
      t("backup.destination.folder_required"),
    );
    expect(await bottomOf(el, "settings-actions")).toBe(t("form.fix_fields"));
    expect(await buttonState(el, "save-settings")).toEqual(["primary", true]);
    await typeFolder(el, "/mnt/usb/other");
    expect((q(el, "[data-test=destination]") as Field).error).toBe("");
    expect(await buttonState(el, "save-settings")).toEqual(["primary", false]);
  });

  it("a refused folder sits under the folder field with the generic bottom sentence, focus on it, and Save still works", async () => {
    const { el } = await openEdit(LOCAL_ONLY, {
      applyBackup: vi
        .fn()
        .mockRejectedValue({ code: "backup.request_invalid", params: { field: "dir" } }),
    });
    await typeFolder(el, "relative/path");
    q(el, "[data-test=save-settings]")!.click();
    await vi.waitFor(() =>
      expect((q(el, "[data-test=destination]") as Field).error).toBe(
        t("backup.destination.folder_refused"),
      ),
    );
    expect(await bottomOf(el, "settings-actions")).toBe(t("form.fix_fields"));
    await vi.waitFor(() =>
      expect(el.shadowRoot!.activeElement).toBe(q(el, "[data-test=destination]")),
    );
    expect(await buttonState(el, "save-settings")).toEqual(["primary", false]);
    expect(banner(el)).toBeNull();
  });

  it("a namespace overlap sits in the bottom message, never the page banner, and Apply stays enabled", async () => {
    const { el } = await openConfigure({
      applyBackup: vi.fn().mockRejectedValue({ code: "backup.archive_namespace_overlap" }),
    });
    await choose(el, "stream-bucket");
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(async () =>
      expect(await bottomOf(el, "apply-actions")).toBe(
        codeMessage("backup.archive_namespace_overlap"),
      ),
    );
    expect(banner(el)).toBeNull();
    expect(await buttonState(el, "apply")).toEqual(["primary", false]);
  });

  it("a failed bucket test says why in the bottom message", async () => {
    const { el } = await openConfigure({
      applyBackup: vi
        .fn()
        .mockRejectedValue({ code: "backup.archive_test_failed", params: { reason: "timed_out" } }),
    });
    await choose(el, "stream-bucket");
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(async () =>
      expect(await bottomOf(el, "apply-actions")).toBe(
        `${codeMessage("backup.archive_test_failed")} ${t("backup.archive_test.timed_out")}`,
      ),
    );
    expect(banner(el)).toBeNull();
  });

  it("a passive status read with a new revision during an edit leaves the staged choice alone", async () => {
    const { el, api } = await openEdit(LOCAL_ONLY);
    await choose(el, "stream-bucket");
    const reads = vi.mocked(api.getBackupStatus).mock.calls.length;
    vi.mocked(api.getBackupStatus).mockResolvedValue({
      ...ON_STREAM_BUCKET,
      revision: "99999999-2222-4333-8444-555555555555",
    });
    api.liveData.invalidate([{ type: "backup_status" }]);
    await vi.waitFor(() =>
      expect(vi.mocked(api.getBackupStatus).mock.calls.length).toBeGreaterThan(reads),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(choice(el)!.value).toBe("stream-bucket");
    expect(await buttonState(el, "save-settings")).toEqual(["primary", false]);
    await choose(el, "local-fs");
    expect((q(el, "[data-test=destination]") as Field).value).toBe("/mnt/usb/waitron");
  });
});
