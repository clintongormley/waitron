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

const customField = (el: BackupScreen, name: string) =>
  q(el, `wt-input[name=archive-bucket-${name}]`) as Field;

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
  it("offers a local folder, the bucket copy's bucket or another bucket, as a named choice", async () => {
    const { el } = await openConfigure();
    const box = choice(el)!;
    expect(box.value).toBe("local-fs");
    expect(box.options.map((o) => o.value)).toEqual(["local-fs", "stream-bucket", "custom-s3"]);
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

  it("a stored bucket that is not the bucket copy's opens on another bucket, its settings filled in", async () => {
    const { el } = await openEdit(ON_STREAM_BUCKET, {
      getStreamSettings: vi.fn().mockResolvedValue({
        ...STREAM_ON,
        bucket: { ...STREAM_BUCKET, accessKeyId: "AKIAOTHER" },
      }),
    });
    expect(choice(el)!.value).toBe("custom-s3");
    expect(customField(el, "access-key-id").value).toBe("AKIASTREAM");
    expect(customField(el, "secret-access-key").value).toBe("");
  });

  it.each([
    ["endpoint", { endpoint: "https://s3.example.test" }],
    ["region", { region: "eu-west-1" }],
    ["bucket", { bucket: "other-bucket" }],
    ["prefix", { prefix: "elsewhere" }],
    ["accessKeyId", { accessKeyId: "AKIAOTHER" }],
  ])(
    "a stored bucket differing from the bucket copy's only in its %s opens on another bucket",
    async (_field, differs) => {
      const { el } = await openEdit(ON_STREAM_BUCKET, {
        getStreamSettings: vi
          .fn()
          .mockResolvedValue({ ...STREAM_ON, bucket: { ...STREAM_BUCKET, ...differs } }),
      });
      expect(choice(el)!.value).toBe("custom-s3");
    },
  );

  it("a stored bucket matching the bucket copy opens on that choice when Edit is pressed before the bucket copy's settings arrive", async () => {
    let answer!: (value: unknown) => void;
    const { el } = await mount(ON_STREAM_BUCKET, {
      getStreamSettings: vi.fn().mockReturnValue(new Promise((resolve) => (answer = resolve))),
    });
    q(el, "[data-test=edit-settings]")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    answer(STREAM_ON);
    await vi.waitFor(() => expect(q(el, "[data-test=save-settings]")).not.toBeNull());
    expect(choice(el)!.value).toBe("stream-bucket");
    expect(await buttonState(el, "save-settings")).toEqual(["secondary", true]);
  });

  it("a folder typed as the bucket choice's own name is a change from the bucket choice", async () => {
    const { el } = await openEdit(ON_STREAM_BUCKET);
    await choose(el, "local-fs");
    await typeFolder(el, "stream-bucket");
    expect(await buttonState(el, "save-settings")).toEqual(["primary", false]);
  });

  it("when the bucket copy's settings cannot be read, its bucket cannot be chosen and the form says why, with no page banner", async () => {
    const { el } = await mount(OFF_WITH_KEY, {
      getStreamSettings: vi.fn().mockRejectedValue({ code: "server.unreachable" }),
    });
    await vi.waitFor(() => expect(q(el, "[data-test=stream-unread]")).not.toBeNull());
    const option = choice(el)!.options.find((o) => o.value === "stream-bucket")!;
    expect(option.disabled).toBe(true);
    expect(option.description).toBe(t("backup.destination.stream_unread"));
    expect(text(q(el, "[data-test=stream-unread]")!).trim()).toBe(
      t("backup.destination.stream_unread"),
    );
    expect(banner(el)).toBeNull();
  });

  it("a refused bucket-copy folder for archives sits in the bottom message, never the page banner, and Apply stays enabled", async () => {
    const { el } = await openConfigure({
      applyBackup: vi
        .fn()
        .mockRejectedValue({ code: "backup.request_invalid", params: { field: "prefix" } }),
    });
    await choose(el, "stream-bucket");
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(async () =>
      expect(await bottomOf(el, "apply-actions")).toBe(
        t("backup.destination.stream_prefix_refused"),
      ),
    );
    expect(banner(el)).toBeNull();
    expect(await buttonState(el, "apply")).toEqual(["primary", false]);
  });

  it("after a refused folder, choosing the bucket copy's bucket drops the fix-the-fields sentence", async () => {
    const { el } = await openEdit(LOCAL_ONLY, {
      applyBackup: vi
        .fn()
        .mockRejectedValue({ code: "backup.request_invalid", params: { field: "dir" } }),
    });
    await typeFolder(el, "/mnt/usb\tother");
    q(el, "[data-test=save-settings]")!.click();
    await vi.waitFor(async () =>
      expect(await bottomOf(el, "settings-actions")).toBe(t("form.fix_fields")),
    );
    await choose(el, "stream-bucket");
    expect(await bottomOf(el, "settings-actions")).toBeNull();
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
    await typeFolder(el, "/mnt/usb\tother");
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

/** Archives on, stored as a bucket of the owner's own, not the bucket copy's. */
const ON_CUSTOM: BackupStatusView = {
  ...TWO,
  destinations: [TWO.destinations[1]!],
  backupStatus: { configured: true, destinations: [{ ...quiet, id: "bucket" }] },
};

async function typeCustom(el: BackupScreen, name: string, value: string) {
  customField(el, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

async function fillCustom(el: BackupScreen, secret: string) {
  await typeCustom(el, "region", "eu-west-3");
  await typeCustom(el, "name", "my-bucket");
  await typeCustom(el, "prefix", "/shop/");
  await typeCustom(el, "access-key-id", "AKIAMINE");
  await typeCustom(el, "secret-access-key", secret);
}

async function setRetainCount(el: BackupScreen, value: string) {
  q(el, "[data-test=retain-count]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("another S3-compatible bucket", () => {
  it("names its fields, marks the required ones, and keeps the secret write-only with a reveal button", async () => {
    const { el } = await openConfigure();
    await choose(el, "custom-s3");
    const names = [...el.shadowRoot!.querySelectorAll<Field>("wt-input")]
      .map((f) => f.getAttribute("name"))
      .filter((n) => n?.startsWith("archive-bucket-"));
    expect(names).toEqual([
      "archive-bucket-endpoint",
      "archive-bucket-region",
      "archive-bucket-name",
      "archive-bucket-prefix",
      "archive-bucket-access-key-id",
      "archive-bucket-secret-access-key",
    ]);
    expect(
      ["endpoint", "region", "name", "prefix", "access-key-id", "secret-access-key"].map(
        (n) => customField(el, n).required,
      ),
    ).toEqual([false, true, true, false, true, true]);
    const secret = customField(el, "secret-access-key");
    expect(secret.type).toBe("password");
    expect(secret.autocomplete).toBe("new-password");
    const reveal = secret.querySelector<Button>("wt-button[slot=end]")!;
    expect(reveal.getAttribute("aria-label")).toBe(t("stream.form.show_secret"));
    expect(reveal.querySelector("svg[aria-hidden=true]")).not.toBeNull();
    expect(text(reveal).trim()).toBe("");
    reveal.click();
    await el.updateComplete;
    expect(customField(el, "secret-access-key").type).toBe("text");
  });

  it("shows where in the bucket backups will be stored", async () => {
    const { el } = await openConfigure();
    await choose(el, "custom-s3");
    await fillCustom(el, "SECRET-1");
    expect(text(q(el, "[data-test=custom-location]")!)).toContain(
      `my-bucket/shop/archives/${VENUE}/`,
    );
  });

  it("a first save with no secret is held by the form's own check: the secret is marked, no request goes", async () => {
    const { el, api } = await openConfigure();
    await choose(el, "custom-s3");
    await fillCustom(el, "");
    q(el, "[data-test=apply]")!.click();
    await el.updateComplete;
    await settle();
    expect(api.applyBackup).not.toHaveBeenCalled();
    expect(customField(el, "secret-access-key").error).toBe(
      t("stream.form.secret_access_key_required"),
    );
    expect(await bottomOf(el, "apply-actions")).toBe(t("form.fix_fields"));
  });

  it("a first save with the required fields empty marks each one, and no request goes", async () => {
    const { el, api } = await openConfigure();
    await choose(el, "custom-s3");
    q(el, "[data-test=apply]")!.click();
    await el.updateComplete;
    await settle();
    expect(api.applyBackup).not.toHaveBeenCalled();
    expect(customField(el, "region").error).toBe(t("stream.form.region_required"));
    expect(customField(el, "name").error).toBe(t("stream.form.bucket_required"));
    expect(customField(el, "access-key-id").error).toBe(t("stream.form.access_key_id_required"));
    expect(customField(el, "endpoint").error).toBe("");
  });

  it("sends only this kind's fields, as strings, with the endpoint and folder trimmed of spaces", async () => {
    const { el, api } = await openConfigure();
    await choose(el, "custom-s3");
    await fillCustom(el, "SECRET-1");
    await typeCustom(el, "endpoint", " https://s3.example.test ");
    await typeCustom(el, "prefix", " /shop/ ");
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledOnce());
    expect(vi.mocked(api.applyBackup).mock.calls[0]![0].destination).toEqual({
      kind: "custom-s3",
      endpoint: "https://s3.example.test",
      region: "eu-west-3",
      bucket: "my-bucket",
      prefix: "/shop/",
      accessKeyId: "AKIAMINE",
      secretAccessKey: "SECRET-1",
    });
  });

  it("bucket fields typed and then left for a folder are not sent", async () => {
    const { el, api } = await openConfigure();
    await choose(el, "custom-s3");
    await fillCustom(el, "SECRET-1");
    await choose(el, "local-fs");
    await typeFolder(el, "/mnt/usb/waitron");
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledOnce());
    expect(vi.mocked(api.applyBackup).mock.calls[0]![0].destination).toEqual({
      kind: "local-fs",
      dir: "/mnt/usb/waitron",
    });
  });

  it("switching to another choice and back keeps the typed bucket fields", async () => {
    const { el } = await openConfigure();
    await choose(el, "custom-s3");
    await fillCustom(el, "SECRET-1");
    await choose(el, "stream-bucket");
    await choose(el, "custom-s3");
    expect(customField(el, "region").value).toBe("eu-west-3");
    expect(customField(el, "name").value).toBe("my-bucket");
    expect(customField(el, "secret-access-key").value).toBe("SECRET-1");
  });

  it("a stored bucket opens filled in, with an empty secret whose hint says it is kept, and Save quiet", async () => {
    const { el } = await openEdit(ON_CUSTOM);
    expect(choice(el)!.value).toBe("custom-s3");
    expect(customField(el, "endpoint").value).toBe("");
    expect(customField(el, "region").value).toBe("eu-north-1");
    expect(customField(el, "name").value).toBe("owner-bucket");
    expect(customField(el, "prefix").value).toBe("waitron");
    expect(customField(el, "access-key-id").value).toBe("AKIAOWNER");
    const secret = customField(el, "secret-access-key");
    expect(secret.value).toBe("");
    expect(secret.required).toBe(false);
    expect(secret.hint).toBe(t("backup.destination.secret_keep"));
    expect(await buttonState(el, "save-settings")).toEqual(["secondary", true]);
  });

  it("with the stored bucket unchanged, an empty secret keeps the saved one and the save is sent without it", async () => {
    const { el, api } = await openEdit(ON_CUSTOM);
    await setRetainCount(el, "9");
    q(el, "[data-test=save-settings]")!.click();
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledOnce());
    const destination = vi.mocked(api.applyBackup).mock.calls[0]![0].destination;
    expect(destination).toEqual({
      kind: "custom-s3",
      region: "eu-north-1",
      bucket: "owner-bucket",
      prefix: "waitron",
      accessKeyId: "AKIAOWNER",
    });
  });

  it("a folder spelled with extra slashes is still the stored bucket's folder, so the secret is kept", async () => {
    const { el, api } = await openEdit(ON_CUSTOM);
    await typeCustom(el, "prefix", "/waitron/");
    q(el, "[data-test=save-settings]")!.click();
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledOnce());
    expect(customField(el, "secret-access-key").error).toBe("");
  });

  it.each([
    ["endpoint", "https://s3.example.test"],
    ["region", "eu-west-1"],
    ["name", "other-bucket"],
    ["prefix", "elsewhere"],
    ["access-key-id", "AKIAOTHER"],
  ])("changing the stored bucket's %s makes the secret required again", async (name, value) => {
    const { el, api } = await openEdit(ON_CUSTOM);
    await typeCustom(el, name, value);
    expect(customField(el, "secret-access-key").required).toBe(true);
    q(el, "[data-test=save-settings]")!.click();
    await el.updateComplete;
    await settle();
    expect(api.applyBackup).not.toHaveBeenCalled();
    expect(customField(el, "secret-access-key").error).toBe(t("backup.destination.secret_needed"));
    expect(await bottomOf(el, "settings-actions")).toBe(t("form.fix_fields"));
  });

  it("the server asking for the secret puts the refusal under the secret, and Save waits for one", async () => {
    const { el } = await openEdit(ON_CUSTOM, {
      applyBackup: vi.fn().mockRejectedValue({
        code: "backup.request_invalid",
        params: { field: "secretAccessKey" },
      }),
    });
    await setRetainCount(el, "9");
    q(el, "[data-test=save-settings]")!.click();
    await vi.waitFor(() =>
      expect(customField(el, "secret-access-key").error).toBe(
        t("stream.form.secret_access_key_required"),
      ),
    );
    expect(customField(el, "secret-access-key").required).toBe(true);
    expect(customField(el, "secret-access-key").hint).toBe("");
    expect(await bottomOf(el, "settings-actions")).toBe(t("form.fix_fields"));
    expect(await buttonState(el, "save-settings")).toEqual(["primary", true]);
    expect(banner(el)).toBeNull();
    await typeCustom(el, "secret-access-key", "SECRET-2");
    expect(customField(el, "secret-access-key").error).toBe("");
    expect(await buttonState(el, "save-settings")).toEqual(["primary", false]);
  });

  it.each([
    ["endpoint", "endpoint", "stream.form.endpoint_invalid"],
    ["region", "region", "stream.field.check"],
    ["bucket", "name", "stream.field.bucket_characters"],
    ["prefix", "prefix", "stream.field.check"],
    ["accessKeyId", "access-key-id", "stream.field.key_characters"],
  ] as const)(
    "the server refusing %s puts the refusal under that field",
    async (field, name, key) => {
      const { el } = await openConfigure({
        applyBackup: vi
          .fn()
          .mockRejectedValue({ code: "backup.request_invalid", params: { field } }),
      });
      await choose(el, "custom-s3");
      await fillCustom(el, "SECRET-1");
      q(el, "[data-test=apply]")!.click();
      await vi.waitFor(() => expect(customField(el, name).error).toBe(t(key)));
      expect(await bottomOf(el, "apply-actions")).toBe(t("form.fix_fields"));
      expect(await buttonState(el, "apply")).toEqual(["primary", false]);
      expect(banner(el)).toBeNull();
    },
  );

  it("a failed bucket test for another bucket says why in the bottom message", async () => {
    const { el } = await openConfigure({
      applyBackup: vi
        .fn()
        .mockRejectedValue({ code: "backup.archive_test_failed", params: { reason: "timed_out" } }),
    });
    await choose(el, "custom-s3");
    await fillCustom(el, "SECRET-1");
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(async () =>
      expect(await bottomOf(el, "apply-actions")).toBe(
        `${codeMessage("backup.archive_test_failed")} ${t("backup.archive_test.timed_out")}`,
      ),
    );
    expect(await buttonState(el, "apply")).toEqual(["primary", false]);
  });

  it("after a save with a new secret the editor closes clean, and reopening shows the secret empty with Save quiet", async () => {
    const { el, api } = await openEdit(ON_CUSTOM);
    await typeCustom(el, "secret-access-key", "SECRET-NEW");
    expect(await buttonState(el, "save-settings")).toEqual(["primary", false]);
    q(el, "[data-test=save-settings]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=save-settings]")).toBeNull());
    expect(vi.mocked(api.applyBackup).mock.calls[0]![0].destination).toMatchObject({
      secretAccessKey: "SECRET-NEW",
    });
    q(el, "[data-test=edit-settings]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=save-settings]")).not.toBeNull());
    expect(customField(el, "secret-access-key").value).toBe("");
    expect(await buttonState(el, "save-settings")).toEqual(["secondary", true]);
  });

  it("leaving the screen forgets a typed secret, but not the other bucket fields", async () => {
    const { el } = await openConfigure();
    await choose(el, "custom-s3");
    await fillCustom(el, "SECRET-1");
    const parent = el.parentNode!;
    el.remove();
    parent.appendChild(el);
    await vi.waitFor(() => expect(customField(el, "secret-access-key")).not.toBeNull());
    await el.updateComplete;
    expect(customField(el, "secret-access-key").value).toBe("");
    expect(customField(el, "name").value).toBe("my-bucket");
  });

  it("a save that leaves another change staged clears the secret from the field", async () => {
    let answer!: (value: BackupWriteAnswer) => void;
    const { el } = await openEdit(ON_CUSTOM, {
      applyBackup: vi.fn().mockReturnValue(new Promise((resolve) => (answer = resolve))),
    });
    await typeCustom(el, "secret-access-key", "SECRET-NEW");
    q(el, "[data-test=save-settings]")!.click();
    await settle();
    await setRetainCount(el, "9");
    answer(ON_CUSTOM);
    await vi.waitFor(async () =>
      expect(await buttonState(el, "save-settings")).toEqual(["primary", false]),
    );
    expect(customField(el, "secret-access-key").value).toBe("");
  });

  it('a refused folder holding an empty, "." or ".." folder says those cannot be used', async () => {
    const { el } = await openConfigure({
      applyBackup: vi
        .fn()
        .mockRejectedValue({ code: "backup.request_invalid", params: { field: "prefix" } }),
    });
    await choose(el, "custom-s3");
    await fillCustom(el, "SECRET-1");
    await typeCustom(el, "prefix", "shop//daily");
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(() =>
      expect(customField(el, "prefix").error).toBe(t("stream.field.prefix_folders")),
    );
  });

  it("a refused typed secret for the stored bucket says which characters work, sent as typed, with no keep hint", async () => {
    const { el, api } = await openEdit(ON_CUSTOM, {
      applyBackup: vi.fn().mockRejectedValue({
        code: "backup.request_invalid",
        params: { field: "secretAccessKey" },
      }),
    });
    await typeCustom(el, "secret-access-key", "SECRET-1 ");
    q(el, "[data-test=save-settings]")!.click();
    await vi.waitFor(() =>
      expect(customField(el, "secret-access-key").error).toBe(
        t("backup.destination.secret_characters"),
      ),
    );
    expect(vi.mocked(api.applyBackup).mock.calls[0]![0].destination).toMatchObject({
      secretAccessKey: "SECRET-1 ",
    });
    expect(customField(el, "secret-access-key").hint).toBe("");
    expect(await bottomOf(el, "settings-actions")).toBe(t("form.fix_fields"));
  });

  it("a refused typed secret on a first save says which characters work", async () => {
    const { el, api } = await openConfigure({
      applyBackup: vi.fn().mockRejectedValue({
        code: "backup.request_invalid",
        params: { field: "secretAccessKey" },
      }),
    });
    await choose(el, "custom-s3");
    await fillCustom(el, "SECRET-1 ");
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(() =>
      expect(customField(el, "secret-access-key").error).toBe(
        t("backup.destination.secret_characters"),
      ),
    );
    expect(vi.mocked(api.applyBackup).mock.calls[0]![0].destination).toMatchObject({
      secretAccessKey: "SECRET-1 ",
    });
  });

  it("after the server refuses to keep the saved secret, the secret stays required until the bucket's place changes", async () => {
    const { el, api } = await openEdit(ON_CUSTOM, {
      applyBackup: vi.fn().mockRejectedValue({
        code: "backup.request_invalid",
        params: { field: "secretAccessKey" },
      }),
    });
    await setRetainCount(el, "9");
    q(el, "[data-test=save-settings]")!.click();
    await vi.waitFor(() => expect(customField(el, "secret-access-key").error).not.toBe(""));
    q(el, "[data-test=save-settings]")!.click();
    await el.updateComplete;
    await settle();
    expect(api.applyBackup).toHaveBeenCalledOnce();
    const secret = customField(el, "secret-access-key");
    expect(secret.required).toBe(true);
    expect(secret.hint).toBe("");
    expect(secret.error).toBe(t("stream.form.secret_access_key_required"));
    await typeCustom(el, "region", "eu-west-1");
    await typeCustom(el, "region", "eu-north-1");
    expect(customField(el, "secret-access-key").required).toBe(false);
    expect(customField(el, "secret-access-key").hint).toBe(t("backup.destination.secret_keep"));
    expect(customField(el, "secret-access-key").error).toBe("");
  });

  it("a first save with a new secret moves past set-up, and the form shown again later holds no secret, with Apply quiet", async () => {
    const SAVED: BackupStatusView = {
      ...ON_CUSTOM,
      destinations: [
        {
          id: "bucket",
          kind: "s3",
          endpoint: null,
          region: "eu-west-3",
          bucket: "my-bucket",
          prefix: "shop",
          accessKeyId: "AKIAMINE",
          namespace: `shop/archives/${VENUE}/`,
          credentialPresent: true,
        },
      ],
    };
    const { el, api } = await openConfigure();
    vi.mocked(api.applyBackup).mockImplementation(async () => {
      vi.mocked(api.getBackupStatus).mockResolvedValue(SAVED);
      return SAVED;
    });
    await choose(el, "custom-s3");
    await fillCustom(el, "SECRET-1");
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=apply]")).toBeNull());
    expect(vi.mocked(api.applyBackup).mock.calls[0]![0].destination).toMatchObject({
      secretAccessKey: "SECRET-1",
    });
    vi.mocked(api.getBackupStatus).mockResolvedValue(OFF_WITH_KEY);
    api.liveData.invalidate([{ type: "backup_status" }]);
    await vi.waitFor(() => expect(q(el, "[data-test=apply]")).not.toBeNull());
    await el.updateComplete;
    expect(choice(el)!.value).toBe("custom-s3");
    expect(customField(el, "secret-access-key").value).toBe("");
    expect(await buttonState(el, "apply")).toEqual(["secondary", true]);
  });

  it("reopening the editor after the server refused to keep the saved secret lets it be kept again", async () => {
    const { el } = await openEdit(ON_CUSTOM, {
      applyBackup: vi.fn().mockRejectedValue({
        code: "backup.request_invalid",
        params: { field: "secretAccessKey" },
      }),
    });
    await setRetainCount(el, "9");
    q(el, "[data-test=save-settings]")!.click();
    await vi.waitFor(() => expect(customField(el, "secret-access-key").required).toBe(true));
    q(el, "[data-test=cancel-edit]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=save-settings]")).toBeNull());
    q(el, "[data-test=edit-settings]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=save-settings]")).not.toBeNull());
    expect(customField(el, "secret-access-key").required).toBe(false);
    expect(customField(el, "secret-access-key").hint).toBe(t("backup.destination.secret_keep"));
  });

  it("once a secret the server asked for is saved, the next save may keep it", async () => {
    let answer!: (value: BackupWriteAnswer) => void;
    const applyBackup = vi
      .fn()
      .mockRejectedValueOnce({
        code: "backup.request_invalid",
        params: { field: "secretAccessKey" },
      })
      .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const { el } = await openEdit(ON_CUSTOM, { applyBackup });
    await setRetainCount(el, "9");
    q(el, "[data-test=save-settings]")!.click();
    await vi.waitFor(() => expect(customField(el, "secret-access-key").required).toBe(true));
    await typeCustom(el, "secret-access-key", "SECRET-NEW");
    q(el, "[data-test=save-settings]")!.click();
    await settle();
    await setRetainCount(el, "10");
    answer(ON_CUSTOM);
    await vi.waitFor(async () =>
      expect(await buttonState(el, "save-settings")).toEqual(["primary", false]),
    );
    expect(customField(el, "secret-access-key").required).toBe(false);
    expect(customField(el, "secret-access-key").hint).toBe(t("backup.destination.secret_keep"));
  });
});
