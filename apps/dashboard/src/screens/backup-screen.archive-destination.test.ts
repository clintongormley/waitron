import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import type {
  BackupDestinationStatus,
  BackupStatusView,
  BackupWriteAnswer,
  DashboardApi,
  StreamSettingsView,
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
      expect.objectContaining({ destinations: [{ kind: "local-fs", dir: "/mnt/usb/waitron" }] }),
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
type Switch = HTMLElementTagNameMap["wt-switch"];

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

const folderSwitch = (el: BackupScreen) =>
  q(el, "wt-switch[data-test=archive-folder-on]") as Switch | null;

async function setFolder(el: BackupScreen, on: boolean) {
  const box = folderSwitch(el)!;
  box.checked = on;
  box.dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked: on }, bubbles: true, composed: true }),
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
  it("offers a folder switch, on at first, and a bucket choice of none, the bucket copy's bucket or another bucket", async () => {
    const { el } = await openConfigure();
    const folder = folderSwitch(el)!;
    expect(folder.checked).toBe(true);
    expect(folder.label).toBe(t("backup.destination.choice_local"));
    expect(folder.getAttribute("name")).toBe("archive-folder");
    const box = choice(el)!;
    expect(box.label).toBe(t("backup.destination.bucket"));
    expect(box.value).toBe("none");
    expect(box.options.map((o) => o.value)).toEqual(["none", "stream-bucket", "custom-s3"]);
    expect(box.options[0]!.label).toBe(t("backup.destination.bucket_none"));
  });

  it("with no bucket copy set up, the bucket choice is unavailable and its own description says why", async () => {
    const { el } = await mount(OFF_WITH_KEY);
    await vi.waitFor(() => expect(choice(el)).not.toBeNull());
    const option = choice(el)!.options.find((o) => o.value === "stream-bucket")!;
    expect(option.disabled).toBe(true);
    expect(option.description).toBe(t("backup.destination.stream_unavailable"));
  });

  it.each(["none", "custom-s3"])(
    "with no bucket copy set up and %s chosen, no line under the choice talks about the bucket copy",
    async (value) => {
      const { el } = await mount(OFF_WITH_KEY);
      await vi.waitFor(() => expect(choice(el)).not.toBeNull());
      await settle();
      await choose(el, value);
      expect(q(el, "[data-test=stream-unavailable]")).toBeNull();
    },
  );

  it("names the bucket copy's bucket in natural Spanish", () => {
    const before = currentLocale();
    try {
      setLocale("es");
      expect(t("backup.destination.choice_stream")).toBe("El bucket de la copia continua");
    } finally {
      setLocale(before);
    }
  });

  it("names the folder field, marks it required, and hides it when the folder switch is off", async () => {
    const { el } = await openConfigure();
    const folder = q(el, "[data-test=destination]") as Field;
    expect(folder.getAttribute("name")).toBe("backup-folder");
    expect(folder.required).toBe(true);
    await setFolder(el, false);
    expect(q(el, "[data-test=destination]")).toBeNull();
  });

  it("choosing the bucket copy's bucket sends that kind alone, and says what Save copies and where archives go", async () => {
    const { el, api } = await openConfigure();
    await setFolder(el, false);
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
    expect(body.destinations).toEqual([{ kind: "stream-bucket" }]);
    expect(JSON.stringify(body)).not.toContain("stream-bucket/");
  });

  it("Apply opens quiet, wakes on a choice change, and quiets when changed back; a forced press while unchanged sends nothing", async () => {
    const { el, api } = await openConfigure();
    expect(await buttonState(el, "apply")).toEqual(["secondary", true]);
    await choose(el, "stream-bucket");
    expect(await buttonState(el, "apply")).toEqual(["primary", false]);
    await choose(el, "none");
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
    await setFolder(el, true);
    await typeFolder(el, "stream-bucket");
    expect(await buttonState(el, "save-settings")).toEqual(["primary", false]);
  });

  it("when the bucket copy's settings cannot be read, its bucket cannot be chosen and the form says why, with no page banner", async () => {
    const { el } = await mount(OFF_WITH_KEY, {
      getStreamSettings: vi.fn().mockRejectedValue({ code: "server.unreachable" }),
    });
    await vi.waitFor(() =>
      expect(choice(el)!.options.find((o) => o.value === "stream-bucket")!.description).toBe(
        t("backup.destination.stream_unread"),
      ),
    );
    const option = choice(el)!.options.find((o) => o.value === "stream-bucket")!;
    expect(option.disabled).toBe(true);
    expect(q(el, "[data-test=stream-unread]")).toBeNull();
    expect(banner(el)).toBeNull();
  });

  it("a refused bucket-copy folder for archives sits in the bottom message, never the page banner, and Apply stays enabled", async () => {
    const { el } = await openConfigure({
      applyBackup: vi
        .fn()
        .mockRejectedValue({ code: "backup.request_invalid", params: { field: "prefix" } }),
    });
    await setFolder(el, false);
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
    await setFolder(el, false);
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
    await setFolder(el, false);
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
    await choose(el, "none");
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
    await setFolder(el, false);
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
    await setFolder(el, false);
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
    await setFolder(el, false);
    await choose(el, "custom-s3");
    await fillCustom(el, "SECRET-1");
    await typeCustom(el, "endpoint", " https://s3.example.test ");
    await typeCustom(el, "prefix", " /shop/ ");
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledOnce());
    expect(vi.mocked(api.applyBackup).mock.calls[0]![0].destinations).toEqual([
      {
        kind: "custom-s3",
        endpoint: "https://s3.example.test",
        region: "eu-west-3",
        bucket: "my-bucket",
        prefix: "/shop/",
        accessKeyId: "AKIAMINE",
        secretAccessKey: "SECRET-1",
      },
    ]);
  });

  it("bucket fields typed and then left for a folder are not sent", async () => {
    const { el, api } = await openConfigure();
    await choose(el, "custom-s3");
    await fillCustom(el, "SECRET-1");
    await choose(el, "none");
    await typeFolder(el, "/mnt/usb/waitron");
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledOnce());
    expect(vi.mocked(api.applyBackup).mock.calls[0]![0].destinations).toEqual([
      {
        kind: "local-fs",
        dir: "/mnt/usb/waitron",
      },
    ]);
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
    const destinations = vi.mocked(api.applyBackup).mock.calls[0]![0].destinations;
    expect(destinations).toEqual([
      {
        kind: "custom-s3",
        region: "eu-north-1",
        bucket: "owner-bucket",
        prefix: "waitron",
        accessKeyId: "AKIAOWNER",
      },
    ]);
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
      await setFolder(el, false);
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
    await setFolder(el, false);
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
    expect(vi.mocked(api.applyBackup).mock.calls[0]![0].destinations).toMatchObject([
      {
        secretAccessKey: "SECRET-NEW",
      },
    ]);
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
    await setFolder(el, false);
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
    expect(vi.mocked(api.applyBackup).mock.calls[0]![0].destinations).toMatchObject([
      {
        secretAccessKey: "SECRET-1 ",
      },
    ]);
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
    await setFolder(el, false);
    await choose(el, "custom-s3");
    await fillCustom(el, "SECRET-1 ");
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(() =>
      expect(customField(el, "secret-access-key").error).toBe(
        t("backup.destination.secret_characters"),
      ),
    );
    expect(vi.mocked(api.applyBackup).mock.calls[0]![0].destinations).toMatchObject([
      {
        secretAccessKey: "SECRET-1 ",
      },
    ]);
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
    await setFolder(el, false);
    await choose(el, "custom-s3");
    await fillCustom(el, "SECRET-1");
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=apply]")).toBeNull());
    expect(vi.mocked(api.applyBackup).mock.calls[0]![0].destinations).toMatchObject([
      {
        secretAccessKey: "SECRET-1",
      },
    ]);
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

const PACK_FILE = [
  "Waitron archive recovery pack.",
  "Keep this file secret: it opens this venue's archived backups made under its recovery key.",
  "",
  "WAITRON-ARCHIVE-PACK-1:eyJ2ZXJzaW9uIjoxfQ",
  "",
].join("\n");

const PACK = {
  pack: PACK_FILE,
  keyFingerprint: "ab12cd34",
  revision: TWO.revision!,
};

const displayedPack = (el: BackupScreen) => q(el, "[data-test=pack]")?.textContent ?? null;

async function showPack(el: BackupScreen) {
  q(el, "[data-test=show-pack]")!.click();
  await vi.waitFor(() => expect(q(el, "[data-test=pack]")).not.toBeNull());
  await el.updateComplete;
}

async function read(el: BackupScreen, api: DashboardApi, status: BackupStatusView) {
  const reads = vi.mocked(api.getBackupStatus).mock.calls.length;
  vi.mocked(api.getBackupStatus).mockResolvedValue(status);
  api.liveData.invalidate([{ type: "backup_status" }]);
  await vi.waitFor(() =>
    expect(vi.mocked(api.getBackupStatus).mock.calls.length).toBeGreaterThan(reads),
  );
  await settle();
  await el.updateComplete;
}

describe("recovery pack", () => {
  it("asks for the pack only when its action is pressed, then shows it behind a warning with Copy and a download", async () => {
    const getArchiveRecoveryPack = vi.fn().mockResolvedValue(PACK);
    const { el } = await mount(TWO, { getArchiveRecoveryPack });
    await settle();
    expect(getArchiveRecoveryPack).not.toHaveBeenCalled();
    expect(displayedPack(el)).toBeNull();
    await showPack(el);
    expect(getArchiveRecoveryPack).toHaveBeenCalledTimes(1);
    expect(displayedPack(el)).toBe(PACK_FILE);
    expect(q(el, "[data-test=pack-warning]")!.getAttribute("role")).toBe("note");
    expect(text(q(el, "[data-test=pack-warning]")!)).toContain(t("backup.pack.warning"));
    expect(q(el, "[data-test=copy-pack]")).not.toBeNull();
    const link = q(el, "[data-test=download-pack]") as HTMLAnchorElement;
    expect(link.getAttribute("download")).toContain("ab12cd34");
    const body = await (await fetch(link.href)).text();
    expect(body).toBe(PACK_FILE);
  });

  it("names its action for showing the pack, which the download link then saves", async () => {
    const { el } = await mount(TWO);
    expect(text(q(el, "[data-test=show-pack]")!).trim()).toBe(t("backup.pack.show"));
    const before = currentLocale();
    try {
      setLocale("en");
      expect(t("backup.pack.show")).toBe("Show archive recovery pack");
      setLocale("es");
      expect(t("backup.pack.show")).toBe("Mostrar el paquete de recuperación de las copias");
    } finally {
      setLocale(before);
    }
  });

  it("sits below the settings actions, so they do not read as part of it", async () => {
    const { el } = await mount(TWO);
    const pack = q(el, "[data-test=show-pack]")!;
    for (const action of ["edit-settings", "turn-off"]) {
      const position = q(el, `[data-test=${action}]`)!.compareDocumentPosition(pack);
      expect(position & Node.DOCUMENT_POSITION_FOLLOWING, action).toBeTruthy();
    }
  });

  it("wraps the pack's sentences at spaces, breaking only a word longer than the line", async () => {
    const { el } = await mount(TWO, { getArchiveRecoveryPack: vi.fn().mockResolvedValue(PACK) });
    await showPack(el);
    const style = getComputedStyle(q(el, "[data-test=pack]")!);
    expect(style.wordBreak).toBe("normal");
    expect(style.overflowWrap).toBe("break-word");
    expect(style.whiteSpace).toBe("pre-wrap");
  });

  it("copies the pack's text as the server wrote it", async () => {
    const { el } = await mount(TWO, { getArchiveRecoveryPack: vi.fn().mockResolvedValue(PACK) });
    await showPack(el);
    const spy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    try {
      q(el, "[data-test=copy-pack]")!.click();
      expect(spy).toHaveBeenCalledWith(PACK_FILE);
    } finally {
      spy.mockRestore();
    }
  });

  it("offers no pack when no destination is a bucket", async () => {
    const { el } = await mount(LOCAL_ONLY);
    expect(q(el, "[data-test=show-pack]")).toBeNull();
  });

  it("offers the pack when the environment owns the backup settings", async () => {
    const { el } = await mount(
      { ...TWO, managedByEnvironment: true, source: "environment", revision: null },
      { getArchiveRecoveryPack: vi.fn().mockResolvedValue({ ...PACK, revision: undefined }) },
    );
    await showPack(el);
    expect(displayedPack(el)).toBe(PACK_FILE);
  });

  it.each([
    ["a new settings revision", { revision: "99999999-2222-4333-8444-555555555555" }],
    ["a new key fingerprint", { keyFingerprint: "ffee0011" }],
    ["a new key rotation time", { keyRotatedAt: "2026-10-13T09:00:00Z" }],
  ] as const)(
    "drops the shown pack on a status read with %s, and leaves the staged edit alone",
    async (_what, change) => {
      const { el, api } = await openEdit(TWO, {
        getArchiveRecoveryPack: vi.fn().mockResolvedValue(PACK),
      });
      await setRetainCount(el, "9");
      const staged = (q(el, "[data-test=retain-count]") as Field).value;
      await showPack(el);
      const revoke = vi.spyOn(URL, "revokeObjectURL");
      const href = (q(el, "[data-test=download-pack]") as HTMLAnchorElement).href;
      try {
        await read(el, api, { ...TWO, ...change });
        expect(displayedPack(el)).toBeNull();
        expect(revoke).toHaveBeenCalledWith(href);
      } finally {
        revoke.mockRestore();
      }
      expect((q(el, "[data-test=retain-count]") as Field).value).toBe(staged);
      expect(staged).toBe("9");
      expect(await buttonState(el, "save-settings")).toEqual(["primary", false]);
    },
  );

  it("keeps the shown pack on a status read that changes none of them", async () => {
    const { el, api } = await mount(TWO, {
      getArchiveRecoveryPack: vi.fn().mockResolvedValue(PACK),
    });
    await showPack(el);
    await read(el, api, withOutcomes({ storedUnderCurrentKey: true }, {}));
    expect(displayedPack(el)).toBe(PACK_FILE);
  });

  it("under environment management, a status read with the same key keeps the pack it has no revision for", async () => {
    const managed = { ...TWO, managedByEnvironment: true, source: "environment", revision: null };
    const { el, api } = await mount(managed as BackupStatusView, {
      getArchiveRecoveryPack: vi.fn().mockResolvedValue({ ...PACK, revision: undefined }),
    });
    await showPack(el);
    await read(el, api, managed as BackupStatusView);
    expect(displayedPack(el)).toBe(PACK_FILE);
    await read(el, api, { ...(managed as BackupStatusView), keyFingerprint: "ffee0011" });
    expect(displayedPack(el)).toBeNull();
  });

  it("an answer that arrives after a status read changed the key is not shown", async () => {
    let answer!: (value: typeof PACK) => void;
    const { el, api } = await mount(TWO, {
      getArchiveRecoveryPack: vi.fn().mockReturnValue(new Promise((r) => (answer = r))),
    });
    q(el, "[data-test=show-pack]")!.click();
    await read(el, api, { ...TWO, keyFingerprint: "ffee0011" });
    answer(PACK);
    await settle();
    await el.updateComplete;
    expect(displayedPack(el)).toBeNull();
  });

  it("revokes the pack's download link when the screen is left", async () => {
    const { el } = await mount(TWO, { getArchiveRecoveryPack: vi.fn().mockResolvedValue(PACK) });
    await showPack(el);
    const href = (q(el, "[data-test=download-pack]") as HTMLAnchorElement).href;
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    try {
      el.remove();
      expect(revoke).toHaveBeenCalledWith(href);
    } finally {
      revoke.mockRestore();
    }
  });

  it("says a box with no recovery key has no pack, not to enter a key", async () => {
    const { el } = await mount(TWO, {
      getArchiveRecoveryPack: vi.fn().mockRejectedValue({ code: "backup.recovery_key_missing" }),
    });
    q(el, "[data-test=show-pack]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=pack-failure]")).not.toBeNull());
    const message = text(q(el, "[data-test=pack-failure]")!).trim();
    expect(message).toBe(t("backup.pack.key_missing"));
    expect(message).not.toContain("Enter a recovery key");
  });

  it.each([
    ["archives on", TWO, "backup.pack.key_too_short"],
    [
      "archives off",
      { ...TWO, enabled: false, storedDisabled: true },
      "backup.pack.key_too_short_off",
    ],
    [
      "the environment owning the settings",
      { ...TWO, managedByEnvironment: true, source: "environment", revision: null },
      "backup.pack.key_too_short_managed",
    ],
  ] as const)(
    "with %s, a too-short key's refusal points at what replaces the key",
    async (_what, status, key) => {
      const { el } = await mount(status as BackupStatusView, {
        getArchiveRecoveryPack: vi
          .fn()
          .mockRejectedValue({ code: "backup.recovery_key_too_short", params: { min: 12 } }),
      });
      q(el, "[data-test=show-pack]")!.click();
      await vi.waitFor(() => expect(q(el, "[data-test=pack-failure]")).not.toBeNull());
      expect(text(q(el, "[data-test=pack-failure]")!).trim()).toBe(t(key));
    },
  );

  it("names the action that replaces a too-short key: Change the recovery key with archives on, Turn on backups with them off", () => {
    expect(t("backup.pack.key_too_short")).toContain(t("backup.rotate.title"));
    expect(t("backup.pack.key_too_short_off")).toContain(t("backup.apply"));
    expect(t("backup.pack.key_too_short_managed")).not.toContain(t("backup.apply"));
  });

  it("says a box whose backups go to no bucket has no pack, as the code says it", async () => {
    const { el } = await mount(TWO, {
      getArchiveRecoveryPack: vi
        .fn()
        .mockRejectedValue({ code: "backup.archive_bucket_not_configured" }),
    });
    q(el, "[data-test=show-pack]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=pack-failure]")).not.toBeNull());
    expect(text(q(el, "[data-test=pack-failure]")!).trim()).toBe(
      codeMessage("backup.archive_bucket_not_configured"),
    );
  });
});

describe("recovery pack after a key change", () => {
  it("a key change whose settings record failed drops the shown pack", async () => {
    const { el } = await mount(TWO, {
      getArchiveRecoveryPack: vi.fn().mockResolvedValue(PACK),
      rotateBackupKey: vi.fn().mockRejectedValue({
        code: "backup.rotation_metadata_failed",
        params: { effectiveKeyChanged: true, keyFingerprint: "ffee0011" },
      }),
    });
    q(el, "[data-test=show-pack]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=pack]")).not.toBeNull());
    q(el, "[data-test=show-old-key]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=old-key]")).not.toBeNull());
    const box = q(el, "[data-test=saved-it]") as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await el.updateComplete;
    q(el, "[data-test=rotate-confirm]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=old-key]")).toBeNull());
    expect(q(el, "[data-test=pack]")).toBeNull();
  });
});

const NEW_REVISION = "99999999-2222-4333-8444-555555555555";

/** A pack fetch that answers only when the test says so. */
function heldPack() {
  let answer!: (value: typeof PACK) => void;
  const fetch = vi.fn().mockReturnValue(new Promise<typeof PACK>((r) => (answer = r)));
  return { fetch, answer: (value: typeof PACK = PACK) => answer(value) };
}

async function arrive(el: BackupScreen) {
  await settle();
  await el.updateComplete;
}

describe("a pack fetch still running when a write answers", () => {
  it("a settings save answering with a new revision discards it, and leaves the draft staged since", async () => {
    const pack = heldPack();
    let answerSave!: (value: BackupStatusView) => void;
    const saved = { ...TWO, revision: NEW_REVISION, retention: { count: 9, days: 30 } };
    const { el, api } = await openEdit(TWO, {
      getArchiveRecoveryPack: pack.fetch,
      applyBackup: vi.fn().mockReturnValue(new Promise((r) => (answerSave = r))),
    });
    q(el, "[data-test=show-pack]")!.click();
    await setRetainCount(el, "9");
    q(el, "[data-test=save-settings]")!.click();
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledOnce());
    await setRetainCount(el, "10");
    vi.mocked(api.getBackupStatus).mockResolvedValue(saved);
    answerSave(saved);
    await arrive(el);
    pack.answer();
    await arrive(el);
    expect(displayedPack(el)).toBeNull();
    expect((q(el, "[data-test=retain-count]") as Field).value).toBe("10");
    expect(await buttonState(el, "save-settings")).toEqual(["primary", false]);
  });

  it("a turn-on answering with a new revision discards it, and leaves the draft staged since", async () => {
    const off = { ...TWO, enabled: false, storedDisabled: true };
    const pack = heldPack();
    let answerApply!: (value: BackupStatusView) => void;
    const on = { ...TWO, revision: NEW_REVISION, retention: { count: 9, days: 30 } };
    const { el, api } = await mount(off, {
      getStreamSettings: vi.fn().mockResolvedValue(STREAM_ON),
      getArchiveRecoveryPack: pack.fetch,
      applyBackup: vi.fn().mockReturnValue(new Promise((r) => (answerApply = r))),
    });
    await vi.waitFor(() => expect(q(el, "[data-test=apply]")).not.toBeNull());
    q(el, "[data-test=show-pack]")!.click();
    await typeFolder(el, "/mnt/usb/waitron");
    await setRetainCount(el, "9");
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledOnce());
    await setRetainCount(el, "10");
    vi.mocked(api.getBackupStatus).mockResolvedValue(on);
    answerApply(on);
    await arrive(el);
    pack.answer();
    await arrive(el);
    expect(displayedPack(el)).toBeNull();
    expect((q(el, "[data-test=retain-count]") as Field).value).toBe("10");
    expect(await buttonState(el, "apply")).toEqual(["primary", false]);
  });

  it("a key change answering with a new key discards it", async () => {
    const pack = heldPack();
    const rotated = {
      ...TWO,
      keyFingerprint: "ffee0011",
      keyRotatedAt: "2026-10-13T09:00:00Z",
      revision: NEW_REVISION,
    };
    const { el, api } = await mount(TWO, {
      getArchiveRecoveryPack: pack.fetch,
      rotateBackupKey: vi.fn().mockResolvedValue(rotated),
    });
    q(el, "[data-test=show-pack]")!.click();
    q(el, "[data-test=show-old-key]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=old-key]")).not.toBeNull());
    const box = q(el, "[data-test=saved-it]") as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await el.updateComplete;
    vi.mocked(api.getBackupStatus).mockResolvedValue(rotated);
    q(el, "[data-test=rotate-confirm]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=old-key]")).toBeNull());
    expect(api.rotateBackupKey).toHaveBeenCalledOnce();
    await arrive(el);
    pack.answer();
    await arrive(el);
    expect(displayedPack(el)).toBeNull();
  });

  it("a second press with a pack shown revokes the shown pack's download link", async () => {
    const { el } = await mount(TWO, { getArchiveRecoveryPack: vi.fn().mockResolvedValue(PACK) });
    await showPack(el);
    const href = (q(el, "[data-test=download-pack]") as HTMLAnchorElement).href;
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    try {
      q(el, "[data-test=show-pack]")!.click();
      await vi.waitFor(() => {
        const link = q(el, "[data-test=download-pack]") as HTMLAnchorElement | null;
        expect(link?.href ?? href).not.toBe(href);
      });
      expect(revoke).toHaveBeenCalledWith(href);
    } finally {
      revoke.mockRestore();
    }
  });
});

describe("a pack refusal or pack the status no longer supports", () => {
  const refused = () => vi.fn().mockRejectedValue({ code: "backup.recovery_key_missing" });

  async function refuse(el: BackupScreen) {
    q(el, "[data-test=show-pack]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=pack-failure]")).not.toBeNull());
  }

  it("a status read with a new key and revision takes a refusal away", async () => {
    const { el, api } = await mount(TWO, { getArchiveRecoveryPack: refused() });
    await refuse(el);
    await read(el, api, { ...TWO, keyFingerprint: "ffee0011", revision: NEW_REVISION });
    expect(q(el, "[data-test=pack-failure]")).toBeNull();
  });

  it("a status read that changes neither key nor revision keeps the refusal", async () => {
    const { el, api } = await mount(TWO, { getArchiveRecoveryPack: refused() });
    await refuse(el);
    await read(el, api, withOutcomes({ storedUnderCurrentKey: true }, {}));
    expect(q(el, "[data-test=pack-failure]")).not.toBeNull();
  });

  const managed = {
    ...TWO,
    managedByEnvironment: true,
    source: "environment",
    revision: null,
  } as BackupStatusView;
  const managedLocal = { ...LOCAL_ONLY, ...managed, destinations: LOCAL_ONLY.destinations };

  it("a status read listing no bucket drops the pack and revokes its link, so it does not come back with the bucket", async () => {
    const { el, api } = await mount(managed, {
      getArchiveRecoveryPack: vi.fn().mockResolvedValue({ ...PACK, revision: undefined }),
    });
    await showPack(el);
    const href = (q(el, "[data-test=download-pack]") as HTMLAnchorElement).href;
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    try {
      await read(el, api, managedLocal);
      expect(q(el, "[data-test=show-pack]")).toBeNull();
      expect(revoke).toHaveBeenCalledWith(href);
    } finally {
      revoke.mockRestore();
    }
    await read(el, api, managed);
    expect(q(el, "[data-test=show-pack]")).not.toBeNull();
    expect(displayedPack(el)).toBeNull();
  });

  it("a status read listing no bucket takes a refusal away, so it does not come back with the bucket", async () => {
    const { el, api } = await mount(managed, { getArchiveRecoveryPack: refused() });
    await refuse(el);
    await read(el, api, managedLocal);
    await read(el, api, managed);
    expect(q(el, "[data-test=show-pack]")).not.toBeNull();
    expect(q(el, "[data-test=pack-failure]")).toBeNull();
  });
});

const OFF_REVISION = "77777777-2222-4333-8444-555555555555";

/** What the box answers to a turn-off: the record kept, switched off. */
const storedOff = (status: BackupStatusView): BackupStatusView => ({
  ...status,
  enabled: false,
  storedDisabled: true,
  revision: OFF_REVISION,
  backupStatus: { configured: false },
});

/** A box whose later status reads answer what its turn-off left, as a real box's do. */
function turnsOff(
  status: BackupStatusView,
  answer: Promise<BackupStatusView> = Promise.resolve(storedOff(status)),
): Partial<DashboardApi> {
  const getBackupStatus = vi.fn().mockResolvedValue(status);
  return {
    getBackupStatus,
    disableBackup: vi.fn(() => {
      getBackupStatus.mockResolvedValue(storedOff(status));
      return answer;
    }),
  };
}

async function press(el: BackupScreen, test: string) {
  q(el, `[data-test=${test}]`)!.click();
  await el.updateComplete;
}

describe("switching off", () => {
  it("needs two presses, explaining what happens on the first, and sends one turn-off", async () => {
    const { el, api } = await mount(LOCAL_ONLY, turnsOff(LOCAL_ONLY));
    expect(q(el, "[data-test=turn-off-explain]")).toBeNull();
    await press(el, "turn-off");
    expect(api.disableBackup).toHaveBeenCalledTimes(0);
    expect(q(el, "[data-test=turn-off]")!.dataset.armed).toBe("true");
    expect(text(q(el, "[data-test=turn-off-explain]")!)).toContain(t("backup.turn_off.explain"));
    await press(el, "turn-off");
    await vi.waitFor(() => expect(api.disableBackup).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(text(q(el, "[data-test=status]")!)).toContain(t("backup.status.stored_off")),
    );
    expect(text(row(el, "primary"))).toContain("/mnt/usb/waitron");
    expect(q(el, "[data-test=turn-off]")).toBeNull();
  });

  it("Cancel disarms it and sends nothing", async () => {
    const { el, api } = await mount(LOCAL_ONLY, { disableBackup: vi.fn() });
    await press(el, "turn-off");
    await press(el, "turn-off-cancel");
    expect(q(el, "[data-test=turn-off]")!.dataset.armed).toBeUndefined();
    expect(q(el, "[data-test=turn-off-explain]")).toBeNull();
    expect(q(el, "[data-test=turn-off-cancel]")).toBeNull();
    await settle();
    expect(api.disableBackup).not.toHaveBeenCalled();
  });

  it("keeps its own colour while its own request is sent", async () => {
    const { el } = await mount(LOCAL_ONLY, {
      disableBackup: vi.fn().mockReturnValue(new Promise(() => undefined)),
    });
    await press(el, "turn-off");
    await press(el, "turn-off");
    expect(await buttonState(el, "turn-off")).toEqual(["danger", true]);
  });

  it("while its request is out, Edit settings and Show the current key cannot be pressed", async () => {
    const { el } = await mount(LOCAL_ONLY, {
      disableBackup: vi.fn().mockReturnValue(new Promise(() => undefined)),
    });
    await press(el, "turn-off");
    await press(el, "turn-off");
    expect(await buttonState(el, "edit-settings")).toEqual(["secondary", true]);
    expect(await buttonState(el, "show-old-key")).toEqual(["secondary", true]);
  });

  it("keeps its own colour while its own request is sent, whatever else is pressed", async () => {
    const { el, api } = await mount(TWO, {
      disableBackup: vi.fn().mockReturnValue(new Promise(() => undefined)),
      getArchiveRecoveryPack: vi.fn().mockReturnValue(new Promise(() => undefined)),
    });
    await press(el, "turn-off");
    await press(el, "turn-off");
    for (const other of ["edit-settings", "show-old-key", "show-pack", "configuration-export"]) {
      await press(el, other);
      expect(await buttonState(el, "turn-off"), other).toEqual(["danger", true]);
    }
    await settle();
    expect(api.getBackupRecoveryKey).not.toHaveBeenCalled();
  });

  it("an Edit pressed while the turn-off is out does not open the settings editor once backups are back on", async () => {
    let answer!: (value: BackupStatusView) => void;
    const { el, api } = await mount(
      LOCAL_ONLY,
      turnsOff(LOCAL_ONLY, new Promise<BackupStatusView>((resolve) => (answer = resolve))),
    );
    await press(el, "turn-off");
    await press(el, "turn-off");
    await press(el, "edit-settings");
    answer(storedOff(LOCAL_ONLY));
    await vi.waitFor(() => expect(q(el, "[data-test=apply]")).not.toBeNull());
    await settle();
    await el.updateComplete;
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(q(el, "[data-test=edit-settings]")).not.toBeNull());
    expect(q(el, "[data-test=edit-title]")).toBeNull();
  });

  for (const [other, overrides] of [
    [
      "show-pack",
      { getArchiveRecoveryPack: vi.fn().mockReturnValue(new Promise(() => undefined)) },
    ],
    ["show-old-key", {}],
    ["configuration-export", {}],
  ] as const) {
    it(`pressing ${other} disarms it`, async () => {
      const { el, api } = await mount(TWO, { disableBackup: vi.fn(), ...overrides });
      await press(el, "turn-off");
      await press(el, other);
      expect(await buttonState(el, "turn-off")).toEqual(["ghost", false]);
      expect(q(el, "[data-test=turn-off-explain]")).toBeNull();
      expect(api.disableBackup).not.toHaveBeenCalled();
    });
  }

  it("an answer whose reload failed says the box could not load the settings", async () => {
    const { el } = await mount(LOCAL_ONLY, {
      disableBackup: vi.fn().mockResolvedValue({
        ...storedOff(LOCAL_ONLY),
        reloadErrorCode: "backup.archive_settings_invalid",
      }),
    });
    await press(el, "turn-off");
    await press(el, "turn-off");
    await vi.waitFor(() => expect(q(el, "[data-test=reload-failed]")).not.toBeNull());
    expect(text(q(el, "[data-test=reload-failed]")!)).toContain(
      t("backup.reload_failed_after_save"),
    );
  });

  it("a refusal shows its wording and leaves the button usable", async () => {
    const { el, api } = await mount(LOCAL_ONLY, {
      disableBackup: vi.fn().mockRejectedValue({ code: "backup.archive_settings_unreadable" }),
    });
    await press(el, "turn-off");
    await press(el, "turn-off");
    await vi.waitFor(() =>
      expect(text(banner(el)!)).toContain(codeMessage("backup.archive_settings_unreadable")),
    );
    expect(await buttonState(el, "turn-off")).toEqual(["ghost", false]);
    await press(el, "turn-off");
    await press(el, "turn-off");
    await vi.waitFor(() => expect(api.disableBackup).toHaveBeenCalledTimes(2));
  });

  it("is not offered when the environment manages backups", async () => {
    const { el } = await mount({
      ...TWO,
      managedByEnvironment: true,
      source: "environment",
      revision: null,
    } as BackupStatusView);
    expect(q(el, "[data-test=show-pack]")).not.toBeNull();
    expect(q(el, "[data-test=turn-off]")).toBeNull();
    expect(q(el, "[data-test=edit-settings]")).toBeNull();
  });

  it("is not offered on a node that is not the primary", async () => {
    const { el } = await mount({ ...TWO, isPrimary: false });
    expect(q(el, "[data-test=not-primary]")).not.toBeNull();
    expect(q(el, "[data-test=show-pack]")).not.toBeNull();
    expect(q(el, "[data-test=turn-off]")).toBeNull();
    expect(q(el, "[data-test=edit-settings]")).toBeNull();
  });
});

describe("turning stored settings back on", () => {
  async function openOff(status: BackupStatusView, overrides: Partial<DashboardApi> = {}) {
    const opened = await mount(storedOff(status), {
      getStreamSettings: vi.fn().mockResolvedValue(STREAM_ON),
      ...overrides,
    });
    await vi.waitFor(() => expect(q(opened.el, "[data-test=apply]")).not.toBeNull());
    await settle();
    await opened.el.updateComplete;
    return opened;
  }

  it("a stored folder opens filled in, with Turn on ready, and sends that folder", async () => {
    const { el, api } = await openOff({
      ...LOCAL_ONLY,
      schedule: { kind: "wall-clock", days: [1, 3], at: { hour: 4, minute: 30 } },
      retention: { count: 5, days: 20 },
    });
    expect(folderSwitch(el)!.checked).toBe(true);
    expect(choice(el)!.value).toBe("none");
    expect((q(el, "[data-test=destination]") as Field).value).toBe("/mnt/usb/waitron");
    expect((q(el, "[data-test=retain-count]") as Field).value).toBe("5");
    expect(await buttonState(el, "apply")).toEqual(["primary", false]);
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledOnce());
    const body = vi.mocked(api.applyBackup).mock.calls[0]![0];
    expect(body.destinations).toEqual([{ kind: "local-fs", dir: "/mnt/usb/waitron" }]);
    expect(body.schedule).toEqual({
      kind: "wall-clock",
      days: [1, 3],
      at: { hour: 4, minute: 30 },
    });
    expect(body.retention).toEqual({ count: 5, days: 20 });
    expect(body.recoveryKey).toBeUndefined();
  });

  it("a stored bucket that is the bucket copy's opens on that choice and sends it", async () => {
    const { el, api } = await openOff(ON_STREAM_BUCKET);
    expect(choice(el)!.value).toBe("stream-bucket");
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledOnce());
    expect(vi.mocked(api.applyBackup).mock.calls[0]![0].destinations).toEqual([
      {
        kind: "stream-bucket",
      },
    ]);
  });

  it("another stored bucket opens filled in with an empty secret that is kept, and is sent without one", async () => {
    const { el, api } = await openOff(ON_CUSTOM);
    expect(choice(el)!.value).toBe("custom-s3");
    expect(customField(el, "name").value).toBe("owner-bucket");
    expect(customField(el, "access-key-id").value).toBe("AKIAOWNER");
    const secret = customField(el, "secret-access-key");
    expect(secret.value).toBe("");
    expect(secret.required).toBe(false);
    expect(secret.hint).toBe(t("backup.destination.secret_keep"));
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledOnce());
    expect(vi.mocked(api.applyBackup).mock.calls[0]![0].destinations).toEqual([
      {
        kind: "custom-s3",
        region: "eu-north-1",
        bucket: "owner-bucket",
        prefix: "waitron",
        accessKeyId: "AKIAOWNER",
      },
    ]);
  });

  it("after a turn-off, the form opens with the stored folder", async () => {
    const { el } = await mount(LOCAL_ONLY, turnsOff(LOCAL_ONLY));
    await press(el, "turn-off");
    await press(el, "turn-off");
    await vi.waitFor(() => expect(q(el, "[data-test=apply]")).not.toBeNull());
    await settle();
    await el.updateComplete;
    expect((q(el, "[data-test=destination]") as Field).value).toBe("/mnt/usb/waitron");
    expect(await buttonState(el, "apply")).toEqual(["primary", false]);
  });

  it("a later read does not overwrite a folder typed since", async () => {
    const { el, api } = await openOff(LOCAL_ONLY);
    await typeFolder(el, "/mnt/usb/other");
    await read(el, api, { ...storedOff(LOCAL_ONLY), revision: NEW_REVISION });
    expect((q(el, "[data-test=destination]") as Field).value).toBe("/mnt/usb/other");
  });

  it("a later read naming other stored settings, with nothing typed, fills the form in from them", async () => {
    const { el, api } = await openOff(LOCAL_ONLY);
    await read(el, api, {
      ...storedOff(LOCAL_ONLY),
      revision: NEW_REVISION,
      destinations: [{ id: "primary", kind: "local-fs", dir: "/mnt/usb/moved" }],
    });
    expect((q(el, "[data-test=destination]") as Field).value).toBe("/mnt/usb/moved");
    expect(await buttonState(el, "apply")).toEqual(["primary", false]);
  });

  it("a later read naming the same stored settings leaves the untouched form as it is, not filled in again", async () => {
    const { el, api } = await openOff(LOCAL_ONLY);
    const draft = () => (el as unknown as { custom: object }).custom;
    const before = draft();
    await read(el, api, storedOff(LOCAL_ONLY));
    expect(draft(), "the form's bucket fields, filled in again").toBe(before);
    expect((q(el, "[data-test=destination]") as Field).value).toBe("/mnt/usb/waitron");
    expect(await buttonState(el, "apply")).toEqual(["primary", false]);
  });
});

describe("the bucket copy turned off on the same page", () => {
  const STREAM_GONE: StreamSettingsView = {
    isPrimary: true,
    configured: false,
    bucket: null,
    status: { state: "off" },
    recoveryKeySet: true,
    keyFingerprint: "ab12cd34",
    revision: null,
  };

  /** The panel's turn-off answers, and later reads of its settings find, no bucket copy. */
  function streamTurnsOff(): Partial<DashboardApi> {
    const getStreamSettings = vi.fn().mockResolvedValue(STREAM_ON);
    return {
      getStreamSettings,
      turnOffStream: vi.fn(() => {
        getStreamSettings.mockResolvedValue(STREAM_GONE);
        return Promise.resolve(STREAM_GONE);
      }),
    };
  }

  async function turnOffStreamInPanel(el: BackupScreen) {
    const panel = q(el, "dashboard-stream-settings")!;
    for (let i = 0; i < 2; i++) {
      await vi.waitFor(() =>
        expect(panel.shadowRoot!.querySelector("[data-test=turn-off]")).not.toBeNull(),
      );
      panel.shadowRoot!.querySelector<HTMLElement>("[data-test=turn-off]")!.click();
      await settle();
      await el.updateComplete;
    }
  }

  async function streamOption(el: BackupScreen) {
    await el.updateComplete;
    return choice(el)!.options.find((o) => o.value === "stream-bucket")!;
  }

  async function mountReady(status: BackupStatusView, overrides: Partial<DashboardApi>) {
    const opened = await mount(status, overrides);
    await vi.waitFor(() => expect(q(opened.el, "[data-test=apply]")).not.toBeNull());
    await vi.waitFor(async () => expect((await streamOption(opened.el)).disabled).toBeFalsy());
    await settle();
    await opened.el.updateComplete;
    return opened;
  }

  async function comboError(el: BackupScreen): Promise<string> {
    const box = choice(el)!;
    await box.updateComplete;
    return box.error;
  }

  it("the destination choice learns at once that the bucket copy's bucket is gone", async () => {
    const { el } = await mountReady(OFF_WITH_KEY, streamTurnsOff());
    await turnOffStreamInPanel(el);
    await vi.waitFor(async () => expect((await streamOption(el)).disabled).toBe(true));
    expect((await streamOption(el)).description).toBe(t("backup.destination.stream_unavailable"));
  });

  it("stored settings on the bucket copy's bucket, untouched, open again on another bucket with its values and an empty secret, and turn on as that bucket", async () => {
    const { el, api } = await mountReady(storedOff(ON_STREAM_BUCKET), streamTurnsOff());
    expect(choice(el)!.value).toBe("stream-bucket");
    await turnOffStreamInPanel(el);
    await vi.waitFor(() => expect(choice(el)!.value).toBe("custom-s3"));
    expect(customField(el, "name").value).toBe("stream-bucket");
    expect(customField(el, "access-key-id").value).toBe("AKIASTREAM");
    expect(customField(el, "secret-access-key").value).toBe("");
    expect(q(el, "[data-test=stream-location]")).toBeNull();
    expect(await buttonState(el, "apply")).toEqual(["primary", false]);
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledOnce());
    expect(vi.mocked(api.applyBackup).mock.calls[0]![0].destinations).toEqual([
      {
        kind: "custom-s3",
        region: "eu-north-1",
        bucket: "stream-bucket",
        prefix: "venues",
        accessKeyId: "AKIASTREAM",
      },
    ]);
  });

  it("stored settings on the bucket copy's bucket open again on another bucket when only the bucket copy's read has answered", async () => {
    const { el, api } = await mountReady(storedOff(ON_STREAM_BUCKET), {
      getStreamSettings: vi.fn().mockResolvedValue(STREAM_ON),
    });
    expect(choice(el)!.value).toBe("stream-bucket");
    vi.mocked(api.getBackupStatus).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.getStreamSettings).mockResolvedValue(STREAM_GONE);
    api.liveData.invalidate([{ type: "backup_status" }]);
    await vi.waitFor(() => expect(choice(el)!.value).toBe("custom-s3"));
    expect(customField(el, "access-key-id").value).toBe("AKIASTREAM");
  });

  it("a bucket-copy choice the owner made stays chosen, says it is unavailable, and Save sends nothing", async () => {
    const { el, api } = await mountReady(OFF_WITH_KEY, streamTurnsOff());
    await setFolder(el, false);
    await choose(el, "stream-bucket");
    await turnOffStreamInPanel(el);
    await vi.waitFor(async () => expect((await streamOption(el)).disabled).toBe(true));
    expect(choice(el)!.value).toBe("stream-bucket");
    expect(text(q(el, "[data-test=stream-unavailable]")!).trim()).toBe(
      t("backup.destination.stream_unavailable"),
    );
    expect(q(el, "[data-test=stream-location]")).toBeNull();
    q(el, "[data-test=apply]")!.click();
    await settle();
    await el.updateComplete;
    expect(api.applyBackup).not.toHaveBeenCalled();
    expect(await comboError(el)).toBe(t("backup.destination.stream_unavailable"));
    expect(await bottomOf(el, "apply-actions")).toBe(t("form.fix_fields"));
    expect(await buttonState(el, "apply")).toEqual(["primary", true]);
    await setFolder(el, true);
    await choose(el, "none");
    expect(await comboError(el)).toBe("");
  });

  it("stored settings the owner has changed since keep the bucket-copy choice and their change, and Save sends nothing", async () => {
    const { el, api } = await mountReady(storedOff(ON_STREAM_BUCKET), streamTurnsOff());
    await setRetainCount(el, "9");
    await turnOffStreamInPanel(el);
    await vi.waitFor(async () => expect((await streamOption(el)).disabled).toBe(true));
    expect(choice(el)!.value).toBe("stream-bucket");
    expect((q(el, "[data-test=retain-count]") as Field).value).toBe("9");
    q(el, "[data-test=apply]")!.click();
    await settle();
    await el.updateComplete;
    expect(api.applyBackup).not.toHaveBeenCalled();
    expect(await comboError(el)).toBe(t("backup.destination.stream_unavailable"));
  });

  it("an untouched settings editor on the bucket copy's bucket opens again on another bucket, with Save quiet", async () => {
    const { el } = await openEdit(ON_STREAM_BUCKET, streamTurnsOff());
    expect(choice(el)!.value).toBe("stream-bucket");
    await turnOffStreamInPanel(el);
    await vi.waitFor(() => expect(choice(el)!.value).toBe("custom-s3"));
    expect(customField(el, "access-key-id").value).toBe("AKIASTREAM");
    expect(await buttonState(el, "save-settings")).toEqual(["secondary", true]);
  });
});

describe("a key change whose settings record failed", () => {
  it("takes a shown pack refusal away", async () => {
    const { el } = await mount(TWO, {
      getArchiveRecoveryPack: vi.fn().mockRejectedValue({ code: "backup.recovery_key_missing" }),
      rotateBackupKey: vi.fn().mockRejectedValue({
        code: "backup.rotation_metadata_failed",
        params: { effectiveKeyChanged: true, keyFingerprint: "ffee0011" },
      }),
    });
    q(el, "[data-test=show-pack]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=pack-failure]")).not.toBeNull());
    q(el, "[data-test=show-old-key]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=old-key]")).not.toBeNull());
    const box = q(el, "[data-test=saved-it]") as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await el.updateComplete;
    q(el, "[data-test=rotate-confirm]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=old-key]")).toBeNull());
    expect(q(el, "[data-test=pack-failure]")).toBeNull();
  });
});

describe("a status read that began before a write answers after it", () => {
  /** A read the test answers by hand, begun now as the 10-second refresh would begin one. */
  async function heldRead(api: DashboardApi) {
    let answer!: (value: BackupStatusView) => void;
    const reads = vi.mocked(api.getBackupStatus).mock.calls.length;
    vi.mocked(api.getBackupStatus).mockReturnValueOnce(
      new Promise<BackupStatusView>((r) => (answer = r)),
    );
    api.liveData.invalidate([{ type: "backup_status" }]);
    await vi.waitFor(() => expect(api.getBackupStatus).toHaveBeenCalledTimes(reads + 1));
    return (value: BackupStatusView) => answer(value);
  }

  it("does not undo a Turn off, and the screen asks for a fresh read after the turn-off", async () => {
    const { el, api } = await mount(LOCAL_ONLY, turnsOff(LOCAL_ONLY));
    const answerOldRead = await heldRead(api);
    const getBackupStatus = vi.mocked(api.getBackupStatus);
    const reads = getBackupStatus.mock.calls.length;
    await press(el, "turn-off");
    await press(el, "turn-off");
    await vi.waitFor(() => expect(q(el, "[data-test=apply]")).not.toBeNull());
    // The fresh read is still on its way when the old one answers, as on a real network.
    getBackupStatus.mockReturnValueOnce(new Promise(() => undefined));
    answerOldRead(LOCAL_ONLY);
    await arrive(el);
    expect(text(q(el, "[data-test=status]")!), "the turn-off's answer").toContain(
      t("backup.status.stored_off"),
    );
    expect(q(el, "[data-test=apply]")).not.toBeNull();
    await vi.waitFor(() => expect(getBackupStatus).toHaveBeenCalledTimes(reads + 1));
  });

  it("does not replace the answer to Save settings", async () => {
    const saved: BackupStatusView = {
      ...LOCAL_ONLY,
      revision: NEW_REVISION,
      destinations: [{ id: "primary", kind: "local-fs", dir: "/mnt/usb/new" }],
    };
    const { el, api } = await openEdit(LOCAL_ONLY, {
      applyBackup: vi.fn().mockResolvedValue(saved),
    });
    const answerOldRead = await heldRead(api);
    await typeFolder(el, "/mnt/usb/new");
    await press(el, "save-settings");
    await vi.waitFor(() => expect(q(el, "[data-test=edit-settings]")).not.toBeNull());
    expect(text(row(el, "primary"))).toContain("/mnt/usb/new");
    answerOldRead(LOCAL_ONLY);
    await arrive(el);
    expect(text(row(el, "primary")), "the save's answer").toContain("/mnt/usb/new");
  });
});

describe("an Edit whose key arrives while Turn off is out", () => {
  it("does not open the editor, and the usual actions are back once backups are turned on again", async () => {
    let answerKey!: (value: { key: string }) => void;
    let answerOff!: (value: BackupStatusView) => void;
    const getBackupStatus = vi.fn().mockResolvedValue(LOCAL_ONLY);
    const { el, api } = await mount(LOCAL_ONLY, {
      getBackupStatus,
      getBackupRecoveryKey: vi.fn().mockReturnValue(new Promise((r) => (answerKey = r))),
      disableBackup: vi.fn().mockReturnValue(new Promise((r) => (answerOff = r))),
      applyBackup: vi.fn(() => {
        getBackupStatus.mockResolvedValue(LOCAL_ONLY);
        return Promise.resolve(LOCAL_ONLY);
      }),
    });
    await press(el, "edit-settings");
    await vi.waitFor(() => expect(api.getBackupRecoveryKey).toHaveBeenCalledOnce());
    await press(el, "turn-off");
    await press(el, "turn-off");
    await vi.waitFor(() => expect(api.disableBackup).toHaveBeenCalledOnce());
    answerKey({ key: "OLD-KEY-xyz789012345" });
    await arrive(el);
    expect(q(el, "[data-test=edit-title]"), "the editor, while the turn-off is out").toBeNull();
    getBackupStatus.mockResolvedValue(storedOff(LOCAL_ONLY));
    answerOff(storedOff(LOCAL_ONLY));
    await vi.waitFor(() => expect(q(el, "[data-test=apply]")).not.toBeNull());
    await arrive(el);
    await press(el, "apply");
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledOnce());
    await arrive(el);
    expect(q(el, "[data-test=edit-title]")).toBeNull();
    expect(q(el, "[data-test=edit-settings]"), "Edit settings").not.toBeNull();
    expect(q(el, "[data-test=turn-off]"), "Turn off").not.toBeNull();
    expect(q(el, "[data-test=rotate]"), "the key change").not.toBeNull();
  });
});

describe("a refusal naming nothing the form shows a field for", () => {
  for (const [what, params] of [
    ["the schedule", { field: "schedule" }],
    ["no field", undefined],
  ] as const) {
    it(`naming ${what} sits in the bottom message, never the page banner, and Save stays enabled`, async () => {
      const { el } = await openEdit(LOCAL_ONLY, {
        applyBackup: vi.fn().mockRejectedValue({ code: "backup.request_invalid", params }),
      });
      await setRetainCount(el, "9");
      await press(el, "save-settings");
      await arrive(el);
      expect(await bottomOf(el, "settings-actions"), "bottom message").toBe(
        codeMessage("backup.request_invalid"),
      );
      expect(banner(el)).toBeNull();
      expect(await buttonState(el, "save-settings")).toEqual(["primary", false]);
    });
  }

  it("on turning backups on, sits in the bottom message", async () => {
    const { el } = await openConfigure({
      applyBackup: vi
        .fn()
        .mockRejectedValue({ code: "backup.request_invalid", params: { field: "schedule" } }),
    });
    await typeFolder(el, "/mnt/usb/waitron");
    await press(el, "apply");
    await arrive(el);
    expect(await bottomOf(el, "apply-actions")).toBe(codeMessage("backup.request_invalid"));
    expect(banner(el)).toBeNull();
  });
});

describe("the secret's reveal button", () => {
  it("is back to hidden when the editor is opened again after Cancel", async () => {
    const { el } = await openEdit(ON_CUSTOM);
    await press(el, "toggle-archive-secret");
    expect(customField(el, "secret-access-key").type).toBe("text");
    await press(el, "cancel-edit");
    await vi.waitFor(() => expect(q(el, "[data-test=edit-settings]")).not.toBeNull());
    await press(el, "edit-settings");
    await vi.waitFor(() => expect(q(el, "[data-test=save-settings]")).not.toBeNull());
    await typeCustom(el, "secret-access-key", "NEW-SECRET-2");
    expect(customField(el, "secret-access-key").type).toBe("password");
  });

  it("is back to hidden when the editor is opened again after a save", async () => {
    const { el, api } = await openEdit(ON_CUSTOM);
    await press(el, "toggle-archive-secret");
    await typeCustom(el, "secret-access-key", "NEW-SECRET-1");
    await press(el, "save-settings");
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(q(el, "[data-test=edit-settings]")).not.toBeNull());
    await press(el, "edit-settings");
    await vi.waitFor(() => expect(q(el, "[data-test=save-settings]")).not.toBeNull());
    await typeCustom(el, "secret-access-key", "NEW-SECRET-2");
    expect(customField(el, "secret-access-key").type).toBe("password");
  });
});

describe("Enter in another bucket's fields", () => {
  async function enterIn(el: BackupScreen, name: string) {
    const input = customField(el, name).shadowRoot!.querySelector("input")!;
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );
    await arrive(el);
  }

  it("turns backups on, as Apply does", async () => {
    const { el, api } = await openConfigure();
    await setFolder(el, false);
    await choose(el, "custom-s3");
    await fillCustom(el, "SECRET-1");
    await enterIn(el, "name");
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledOnce());
  });

  it("saves the settings editor, as Save does", async () => {
    const { el, api } = await openEdit(ON_CUSTOM);
    await typeCustom(el, "region", "eu-west-3");
    await typeCustom(el, "secret-access-key", "SECRET-1");
    await enterIn(el, "secret-access-key");
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledOnce());
  });

  it("in the folder field, saves the settings editor too", async () => {
    const { el, api } = await openEdit(LOCAL_ONLY);
    await typeFolder(el, "/mnt/usb/new");
    const input = q(el, "[data-test=destination]")!.shadowRoot!.querySelector("input")!;
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledOnce());
  });
});

describe("the first recovery key", () => {
  it("is asked for while the bucket copy's settings are still being read", async () => {
    const { api } = await mount(
      { ...OFF_WITH_KEY, recoveryKeySet: false, keyFingerprint: undefined },
      { getStreamSettings: vi.fn().mockReturnValue(new Promise(() => undefined)) },
    );
    await vi.waitFor(() => expect(api.mintBackupKey).toHaveBeenCalledOnce());
  });
});

describe("a folder on this box and a bucket together", () => {
  it("a folder kept on beside another bucket sends both, the folder first", async () => {
    const { el, api } = await openConfigure();
    await typeFolder(el, "/mnt/usb/waitron");
    await choose(el, "custom-s3");
    await fillCustom(el, "SECRET-1");
    expect(q(el, "[data-test=destination]")).not.toBeNull();
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledOnce());
    expect(vi.mocked(api.applyBackup).mock.calls[0]![0].destinations).toEqual([
      { kind: "local-fs", dir: "/mnt/usb/waitron" },
      {
        kind: "custom-s3",
        region: "eu-west-3",
        bucket: "my-bucket",
        prefix: "/shop/",
        accessKeyId: "AKIAMINE",
        secretAccessKey: "SECRET-1",
      },
    ]);
  });

  it("with the folder switched off, the folder field is hidden and only the bucket copy's bucket is sent", async () => {
    const { el, api } = await openConfigure();
    await typeFolder(el, "/mnt/usb/waitron");
    await setFolder(el, false);
    expect(q(el, "[data-test=destination]")).toBeNull();
    await choose(el, "stream-bucket");
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledOnce());
    expect(vi.mocked(api.applyBackup).mock.calls[0]![0].destinations).toEqual([
      { kind: "stream-bucket" },
    ]);
  });

  it("with the folder on and no bucket, only the folder is sent", async () => {
    const { el, api } = await openConfigure();
    await typeFolder(el, "/mnt/usb/waitron");
    expect(choice(el)!.value).toBe("none");
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledOnce());
    expect(vi.mocked(api.applyBackup).mock.calls[0]![0].destinations).toEqual([
      { kind: "local-fs", dir: "/mnt/usb/waitron" },
    ]);
  });

  it("neither a folder nor a bucket is held by the form's own check until the folder is back with a path", async () => {
    const { el, api } = await openConfigure();
    await setFolder(el, false);
    expect(await buttonState(el, "apply")).toEqual(["primary", false]);
    q(el, "[data-test=apply]")!.click();
    await el.updateComplete;
    await settle();
    expect(api.applyBackup).not.toHaveBeenCalled();
    expect(choice(el)!.error).toBe(t("backup.destination.nothing_chosen"));
    expect(await bottomOf(el, "apply-actions")).toBe(t("form.fix_fields"));
    expect(await buttonState(el, "apply")).toEqual(["primary", true]);
    await setFolder(el, true);
    expect(choice(el)!.error).toBe("");
    expect(await buttonState(el, "apply")).toEqual(["secondary", true]);
    await typeFolder(el, "/mnt/usb/waitron");
    expect(await buttonState(el, "apply")).toEqual(["primary", false]);
  });

  it("neither a folder nor a bucket, once refused, is fixed by choosing a bucket", async () => {
    const { el, api } = await openConfigure();
    await setFolder(el, false);
    q(el, "[data-test=apply]")!.click();
    await el.updateComplete;
    await settle();
    expect(choice(el)!.error).toBe(t("backup.destination.nothing_chosen"));
    await choose(el, "stream-bucket");
    expect(choice(el)!.error).toBe("");
    expect(await bottomOf(el, "apply-actions")).toBeNull();
    expect(await buttonState(el, "apply")).toEqual(["primary", false]);
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledOnce());
  });

  it("a missing bucket field beside a filled folder marks only the bucket field", async () => {
    const { el, api } = await openConfigure();
    await typeFolder(el, "/mnt/usb/waitron");
    await choose(el, "custom-s3");
    await fillCustom(el, "SECRET-1");
    await typeCustom(el, "region", "");
    q(el, "[data-test=apply]")!.click();
    await el.updateComplete;
    await settle();
    expect(api.applyBackup).not.toHaveBeenCalled();
    expect(customField(el, "region").error).toBe(t("stream.form.region_required"));
    expect((q(el, "[data-test=destination]") as Field).error).toBe("");
  });
});
