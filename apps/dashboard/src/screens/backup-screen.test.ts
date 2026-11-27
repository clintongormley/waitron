import { useLocale } from "../testing/locale-setup.js";
import { LiveData, hasCodeMessage } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { alertMessage } from "../i18n/alerts.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import type { DashboardApi } from "../api/client.js";
import type {
  BackupStatusView,
  BackupWriteAnswer,
  RecoveryPackStatus,
  StreamSettingsView,
} from "../api/backup-api.js";
import { BackupScreen } from "./backup-screen.js";
import type { BackupSettingsEvidenceDialog } from "../widgets/backup-settings-evidence.js";
import { apiAnswering, deferred, evidence } from "../testing/backup-settings-evidence-fixture.js";
import { en, es } from "../i18n/strings.js";
import type { StreamSettingsPanel } from "./stream-settings-panel.js";
import type { WtInput } from "@waitron/ui";

useLocale("es-ES");

afterEach(cleanupWidgets);

const OFF: BackupStatusView = {
  enabled: false,
  isPrimary: true,

  revision: null,
  storedDisabled: false,
  loadErrorCode: null,
  destinations: [],
  backupStatus: { configured: false },
  archiveUnderCurrentKey: false,
  recoveryKeySet: false,
  recoveryKeyTooShort: false,
};

it.each([
  ["en-GB", "Backups guide", "/help/en/backups", true],
  ["en-GB", "Backups guide", "/help/en/backups", false],
  ["es-ES", "Guía de copias de seguridad", "/help/es/backups", true],
  ["es-ES", "Guía de copias de seguridad", "/help/es/backups", false],
] as const)(
  "offers the Backups guide (%s, %s, %s, manager %s)",
  async (locale, label, href, canManage) => {
    setLocale(locale);
    await mountWidget<BackupScreen>("dashboard-backup-screen", {
      api: stubApi({}, OFF),
      canManage,
    });
    const links = page.getByRole("link", { name: label, exact: true });
    await expect.poll(() => links.all().length).toBe(1);
    await expect.element(links).toBeVisible();
    await expect.element(links).toHaveAttribute("href", href);
  },
);

it("offers the manager the recovery pack card first, even with archives and bucket streaming off", async () => {
  const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
    api: stubApi({}, OFF),
    canManage: true,
  });
  const panel = el.shadowRoot!.querySelector("dashboard-recovery-pack-card");
  expect(panel).not.toBeNull();
  expect(panel!.api).toBe(el.api);
  expect(panel!.canManage).toBe(true);
  expect(el.shadowRoot!.querySelector(".card")!.contains(panel)).toBe(true);
});

it("does not offer key replacement without system.manage", async () => {
  const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
    api: stubApi({}, OFF),
    canManage: false,
  });
  expect(el.shadowRoot!.querySelector("dashboard-recovery-pack-card")).toBeNull();
});

it.each([
  ["prepare", true],
  ["live", true],
  ["demo", false],
  [undefined, false],
] as const)(
  "draws the configuration export card for setup choice %s: %s",
  async (onboardingIntent, shown) => {
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
      api: stubApi({}, OFF),
      canManage: true,
      onboardingIntent,
    });
    expect(el.shadowRoot!.querySelector("#configuration-export-title") !== null).toBe(shown);
    expect(el.shadowRoot!.querySelector("[data-test=configuration-export]") !== null).toBe(shown);
  },
);

it.each([
  ["prepare", true],
  ["live", true],
  [undefined, true],
  ["demo", false],
] as const)(
  "offers the bucket copy for setup choice %s: %s, and otherwise says a Demo venue offers none",
  async (onboardingIntent, offered) => {
    const api = stubApi({}, OFF);
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
      api,
      canManage: true,
      onboardingIntent,
    });
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-stream-settings") !== null).toBe(offered);
    const line = el.shadowRoot!.querySelector<HTMLElement>("[data-test=stream-demo]");
    expect(line !== null).toBe(!offered);
    if (!offered) {
      await expect.element(line!).toBeVisible();
      expect(line!.textContent?.trim()).toBe(t("stream.demo"));
      expect(api.getStreamSettings).not.toHaveBeenCalled();
    }
  },
);

it("words the Demo venue's bucket-copy line in English and Spanish", () => {
  expect(en["stream.demo"]).toBe("A Demo venue does not offer a copy to your bucket.");
  expect(es["stream.demo"]).toBe("Un local en Demostración no ofrece copia en tu bucket.");
});

const ENABLED: BackupStatusView = {
  enabled: true,
  isPrimary: true,

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
  revision: "0123456789abcdef",
};

function stubApi(
  overrides: Partial<DashboardApi> = {},
  status: BackupStatusView = OFF,
): DashboardApi {
  return {
    getBackupStatus: vi.fn().mockResolvedValue(status),
    applyBackup: vi.fn().mockResolvedValue(ENABLED),
    rotateBackupKey: vi.fn().mockResolvedValue(ENABLED),
    getStreamSettings: vi.fn().mockResolvedValue({
      isPrimary: true,
      configured: false,
      bucket: null,
      status: { state: "off" },
      recoveryKeySet: false,
      keyFingerprint: null,
    }),
    getRecoveryPackStatus: vi.fn().mockResolvedValue(NO_PACK),
    liveData: new LiveData(),
    ...overrides,
  } as unknown as DashboardApi;
}

const NO_PACK: RecoveryPackStatus = {
  latest: null,
  upToDate: false,
  incomplete: false,
  unreceived: null,
  reasons: [],
  keep: [],
  backupsUseOlderKey: false,
  masterKey: null,
  keepOldPackUntil: "2026-11-11T12:00:00.000Z",
  timeZone: "Europe/Madrid",
  backupKey: null,
};
const PACK_UP_TO_DATE: RecoveryPackStatus = {
  ...NO_PACK,
  latest: {
    number: 1,
    madeAt: "2026-10-12T10:00:00.000Z",
    madeByName: "Marta Puig",
    received: true,
    parts: [{ part: "bucket", state: "not-set-up" }],
  },
  upToDate: true,
  masterKey: { name: "2026-10-12 · QZJV", pack: 1 },
};
const PACK_OUT_OF_DATE: RecoveryPackStatus = {
  ...PACK_UP_TO_DATE,
  upToDate: false,
  reasons: [{ part: "bucket", kind: "set_up_after" }],
};

const panelOf = (el: BackupScreen) =>
  el.shadowRoot!.querySelector("dashboard-stream-settings")!.shadowRoot!;

async function flush(el: BackupScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const q = (el: BackupScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);
const alertText = (el: BackupScreen) => q(el, "[role=alert]:not([data-test])")?.textContent;
const archiveAlertText = (el: BackupScreen) =>
  el
    .shadowRoot!.querySelector("[data-test=apply-actions], [data-test=settings-actions]")
    ?.shadowRoot?.querySelector("[role=alert]")?.textContent;

async function configurationBottom(el: BackupScreen): Promise<string | null> {
  const actions = q(el, "[data-test=configuration-actions]") as HTMLElement & {
    updateComplete: Promise<unknown>;
  };
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[role=alert]")?.textContent ?? null;
}

const configurationErrors = (el: BackupScreen): (string | null)[] =>
  ["configuration-passphrase", "configuration-confirm"].map((id) =>
    q(el, `[data-test=${id}]`)!.getAttribute("error"),
  );

function setInput(el: BackupScreen, sel: string, value: string): void {
  q(el, sel)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

/** One edit to the settings editor, so its Save can be pressed: an untouched editor's Save is disabled. */
async function editDestination(el: BackupScreen, value = "/mnt/usb/waitron-2"): Promise<void> {
  setInput(el, "[data-test=destination]", value);
  await el.updateComplete;
}

function tickCheckbox(el: BackupScreen, sel: string): void {
  const box = q(el, sel) as HTMLInputElement;
  box.checked = true;
  box.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

describe("backup-screen", () => {
  it.each([
    ["off", { ...OFF, recoveryKeySet: true }],
    ["on", ENABLED],
  ] as const)(
    "Backups shows no key step, no Paste my own key and no Show the current key (backups %s)",
    async (_label, status) => {
      setLocale("en-GB");
      const api = stubApi({}, status);
      const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
      await flush(el);
      const text = el.shadowRoot!.textContent!;
      for (const words of [
        "Backup encryption key",
        "Paste my own key instead",
        "Show the current key",
        "Change the backup encryption key",
        "I have saved this key somewhere safe",
        "Download key file",
      ])
        expect(text).not.toContain(words);
      for (const sel of [
        "minted-key",
        "copy-key",
        "download-key",
        "advanced-toggle",
        "paste-key",
        "saved-it",
        "retry-key",
        "existing-key",
        "rotate",
        "show-old-key",
        "rotate-confirm",
      ])
        expect(q(el, `[data-test=${sel}]`)).toBeNull();
      expect(el.shadowRoot!.querySelector("input[type=checkbox]")).toBeNull();
      if (!status.enabled) {
        const apply = q(el, "[data-test=apply]")!;
        await expect.element(apply).toBeVisible();
        q(el, "[data-test=destination]")!.dispatchEvent(
          new CustomEvent("wt-change", { detail: { value: "/mnt/usb/waitron" } }),
        );
        await flush(el);
        apply.click();
        await flush(el);
        expect(api.applyBackup).toHaveBeenCalledTimes(1);
        expect(vi.mocked(api.applyBackup).mock.calls[0]![0]).not.toHaveProperty("recoveryKey");
      }
    },
  );

  it("turning backups on sends no key: the server uses the one it holds", async () => {
    const api = stubApi({}, { ...OFF, recoveryKeySet: true });
    const invalidate = vi.spyOn(api.liveData, "invalidate");
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    expect((q(el, "[data-test=apply]") as HTMLElement & { disabled: boolean }).disabled).toBe(true);
    setInput(el, "[data-test=destination]", "/mnt/usb/waitron");
    await el.updateComplete;
    q(el, "[data-test=apply]")!.click();
    await flush(el);
    expect(api.applyBackup).toHaveBeenCalledWith({
      destinations: [{ kind: "local-fs", dir: "/mnt/usb/waitron" }],
      schedule: { kind: "wall-clock", days: "daily", at: "auto" },
      retention: { count: 7, days: 30 },
    });
    expect(invalidate).not.toHaveBeenCalledWith([{ type: "backup_status" }]);
    expect(el.shadowRoot!.textContent).toContain("/mnt/usb/waitron");
  });

  it("puts the recovery pack card, which the bucket copy's short-key refusal names, above the bucket-copy panel", async () => {
    const api = stubApi({}, { ...OFF, recoveryKeySet: true, recoveryKeyTooShort: true });
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
      api,
      canManage: true,
    });
    await flush(el);
    expect(t("stream.error.recovery_key_too_short")).toContain(t("recovery_pack.title"));
    const card = q(el, "dashboard-recovery-pack-card")!;
    const panel = q(el, "dashboard-stream-settings") as StreamSettingsPanel;
    expect(card.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("still shows the bucket-copy panel when the status read fails", async () => {
    const api = stubApi({
      getBackupStatus: vi.fn().mockRejectedValue({ code: "connection.failed" }),
    });
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    expect(q(el, "[role=alert]")?.textContent?.trim()).toBe(codeMessage("connection.failed"));
    expect(q(el, "[data-test=apply]")).toBeNull();
    const panel = q(el, "dashboard-stream-settings") as StreamSettingsPanel;
    expect(panel).not.toBeNull();
  });

  it("shows the bucket copy panel, handing it the screen's api", async () => {
    const api = stubApi({}, ENABLED);
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    const panel = q(el, "dashboard-stream-settings") as HTMLElement & { api: DashboardApi };
    expect(panel.api).toBe(api);
    expect(api.getStreamSettings).toHaveBeenCalled();
  });

  it("exports prepared configuration under a confirmed passphrase", async () => {
    const api = stubApi({
      exportConfiguration: vi
        .fn()
        .mockResolvedValue(new Blob(["artifact"], { type: "application/octet-stream" })),
    });
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:configuration");
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
      api,
      onboardingIntent: "live",
    });
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
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
      api: stubApi(),
      onboardingIntent: "live",
    });
    await flush(el);
    setInput(el, "[data-test=configuration-passphrase]", "a strong passphrase");
    setInput(el, "[data-test=configuration-confirm]", "a different passphrase");
    (q(el, "[data-test=configuration-export]") as HTMLElement).click();
    await el.updateComplete;
    expect(await configurationBottom(el)).toBe(t("form.fix_fields"));
    expect(q(el, "[data-test=configuration-error]")).toBeNull();
    const fields = configurationErrors(el);
    expect(fields).toEqual([
      t("backup.configuration.match_error"),
      t("backup.configuration.match_error"),
    ]);
  });

  it("says nothing about the configuration export before it is first pressed, and it works", async () => {
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
      api: stubApi(),
      onboardingIntent: "live",
    });
    await flush(el);
    setInput(el, "[data-test=configuration-passphrase]", "short");
    await el.updateComplete;
    expect(configurationErrors(el)).toEqual(["", ""]);
    expect(await configurationBottom(el)).toBeNull();
    expect(q(el, "[data-test=configuration-export]")!.hasAttribute("disabled")).toBe(false);
  });

  it("focuses the passphrase after a refused configuration export and holds the export until both fields are fixed", async () => {
    const api = stubApi({
      exportConfiguration: vi
        .fn()
        .mockResolvedValue(new Blob(["artifact"], { type: "application/octet-stream" })),
    });
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:configuration");
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
      api,
      onboardingIntent: "live",
    });
    await flush(el);
    q(el, "[data-test=configuration-export]")!.click();
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));
    const passphrase = q(el, "[data-test=configuration-passphrase]")!;
    expect(passphrase.shadowRoot!.activeElement).toBe(
      passphrase.shadowRoot!.querySelector("input"),
    );
    const exportButton = q(el, "[data-test=configuration-export]")!;
    expect(exportButton.hasAttribute("disabled")).toBe(true);

    setInput(el, "[data-test=configuration-passphrase]", "a strong passphrase");
    await el.updateComplete;
    expect(configurationErrors(el)).toEqual([
      t("backup.configuration.match_error"),
      t("backup.configuration.match_error"),
    ]);
    expect(exportButton.hasAttribute("disabled")).toBe(true);

    setInput(el, "[data-test=configuration-confirm]", "a strong passphrase");
    await el.updateComplete;
    expect(configurationErrors(el)).toEqual(["", ""]);
    expect(await configurationBottom(el)).toBeNull();
    expect(exportButton.hasAttribute("disabled")).toBe(false);

    exportButton.click();
    await flush(el);
    expect(api.exportConfiguration).toHaveBeenCalledWith("a strong passphrase");
    expect(configurationErrors(el)).toEqual(["", ""]);
    expect(exportButton.hasAttribute("disabled")).toBe(false);
    createObjectURL.mockRestore();
    click.mockRestore();
  });

  it("lets the operator reveal both configuration export passphrases", async () => {
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
      api: stubApi(),
      onboardingIntent: "live",
    });
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

  it("starts one manual backup and follows live status to the destination result", async () => {
    const request = deferred<void>();
    const runBackupNow = vi.fn(() => request.promise);
    const api = stubApi({ runBackupNow }, ENABLED);
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
      api,
      canManage: true,
    });
    const button = page.getByRole("button", { name: "Hacer copia ahora", exact: true });
    await expect.element(button).toBeEnabled();
    await button.click();
    await expect.element(button).toBeDisabled();
    expect(runBackupNow).toHaveBeenCalledOnce();

    vi.mocked(api.getBackupStatus).mockResolvedValue({
      ...ENABLED,
      activeRun: { kind: "manual", startedAt: "2026-11-20T20:00:00Z" },
    });
    request.resolve();
    await vi.waitFor(() => {
      expect(q(el, "[data-test=backup-run-status]")).toHaveTextContent("Copia manual en curso");
    });
    await expect.element(button).toBeDisabled();

    if (!ENABLED.backupStatus.configured) throw new Error("expected configured backups");
    const [stored] = ENABLED.backupStatus.destinations;
    vi.mocked(api.getBackupStatus).mockResolvedValue({
      ...ENABLED,
      destinations: [
        ...ENABLED.destinations,
        { id: "second", kind: "local-fs", dir: "/mnt/second" },
      ],
      backupStatus: {
        configured: true,
        destinations: [
          stored!,
          { ...stored!, id: "second", uploadErrorCode: "backup.cloud_unavailable" },
        ],
      },
    });
    api.liveData.invalidate([{ type: "backup_status" }]);
    await expect.element(button).toBeEnabled();
    expect(q(el, "[data-destination=primary]")).toHaveTextContent(t("backup.destination.stored"));
    expect(q(el, "[data-destination=second]")).toHaveTextContent(t("backup.destination.failed"));
  });

  it.each([
    { status: OFF, canManage: true },
    { status: ENABLED, canManage: false },
    { status: { ...ENABLED, isPrimary: false }, canManage: true },
  ])(
    "does not offer Back up now when the operator cannot start it",
    async ({ status, canManage }) => {
      const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
        api: stubApi({}, status),
        canManage,
      });
      await flush(el);
      expect(q(el, "[data-test=status]")).not.toBeNull();
      expect(q(el, "[data-test=run-now]")).toBeNull();
    },
  );

  it("explains a busy refusal and refreshes the running backup's status", async () => {
    const api = stubApi(
      {
        runBackupNow: vi.fn().mockRejectedValue({ code: "backup.run_in_progress" }),
      },
      ENABLED,
    );
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
      api,
      canManage: true,
    });
    const button = page.getByRole("button", { name: "Hacer copia ahora", exact: true });
    vi.mocked(api.getBackupStatus).mockResolvedValue({
      ...ENABLED,
      activeRun: { kind: "scheduled", startedAt: "2026-11-20T20:00:00Z" },
    });
    await button.click();
    await vi.waitFor(() =>
      expect(alertText(el)).toContain("Ya había una copia de seguridad en curso"),
    );
    await expect.element(button).toBeDisabled();
    expect(q(el, "[data-test=backup-run-status]")).toHaveTextContent("Copia programada en curso");
  });

  it("starting a backup cancels an armed Turn off confirmation", async () => {
    const disableBackup = vi.fn().mockResolvedValue(OFF);
    const api = stubApi(
      { disableBackup, runBackupNow: vi.fn().mockResolvedValue(undefined) },
      ENABLED,
    );
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
      api,
      canManage: true,
    });
    await flush(el);
    q(el, "[data-test=turn-off]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=turn-off-cancel]")).not.toBeNull();

    await page.getByRole("button", { name: "Hacer copia ahora", exact: true }).click();
    await flush(el);
    q(el, "[data-test=turn-off]")!.click();
    await el.updateComplete;
    expect(disableBackup).not.toHaveBeenCalled();
    expect(q(el, "[data-test=turn-off-cancel]")).not.toBeNull();
  });

  it("shows the existing reason that the last backup stopped before saving a copy", async () => {
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
      api: stubApi({}, { ...ENABLED, runStoppedCode: "backup.staging_space_low" }),
      canManage: true,
    });
    await flush(el);
    expect(q(el, "[data-test=backup-run-status]")?.textContent).toContain(
      "queda poco espacio en el disco",
    );
  });

  it.each([
    ["en-GB", "Check the latest backup at each destination before trying again.", "Back up now"],
    [
      "es-ES",
      "Revisa la última copia de cada destino antes de volver a intentarlo.",
      "Hacer copia ahora",
    ],
  ] as const)(
    "asks the manager to check destinations after a settings change (%s)",
    async (locale, advice, action) => {
      setLocale(locale);
      const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
        api: stubApi({}, { ...ENABLED, runStoppedCode: "backup.settings_changed" }),
        canManage: true,
      });
      await flush(el);
      expect(q(el, "[data-test=backup-run-status]")?.textContent).toContain(advice);
      await expect.element(page.getByRole("button", { name: action, exact: true })).toBeEnabled();
    },
  );

  it("names a bucket destination by its bucket and archive folder, and leaves the folder field empty", async () => {
    const bucket: BackupStatusView = {
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
          namespace: "waitron/",
          credentialPresent: true,
        },
      ],
    };
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
      api: stubApi({}, bucket),
    });
    await flush(el);
    expect(el.shadowRoot!.textContent).toContain("owner-bucket/waitron/");
    expect((q(el, "[data-test=destination]") as { value?: string } | null)?.value ?? "").toBe("");
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

  it("names a retention stepper's buttons by a label holding a replacement pattern as written", async () => {
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api: stubApi() });
    await flush(el);
    const stepper = q(el, "[data-test=retain-count]") as HTMLElementTagNameMap["wt-number-stepper"];
    expect(stepper.decreaseLabel("Copias $&")).toBe(
      t("action.decrease").split("{label}").join("Copias $&"),
    );
    expect(stepper.increaseLabel("Copias $&")).toBe(
      t("action.increase").split("{label}").join("Copias $&"),
    );
  });

  it("apply sends the destination + policy and refreshes the status", async () => {
    const api = stubApi();
    vi.mocked(api.applyBackup).mockImplementation(async () => {
      vi.mocked(api.getBackupStatus).mockResolvedValue(ENABLED);
      return ENABLED;
    });
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    setInput(el, "[data-test=destination]", "/mnt/usb/waitron");
    await el.updateComplete;
    q(el, "[data-test=apply]")!.click();
    await flush(el);
    expect(api.applyBackup).toHaveBeenCalledWith({
      destinations: [{ kind: "local-fs", dir: "/mnt/usb/waitron" }],
      schedule: { kind: "wall-clock", days: "daily", at: "auto" },
      retention: { count: 7, days: 30 },
    });
    // Refreshed to the enabled status.
    expect(el.shadowRoot!.textContent).toContain("/mnt/usb/waitron");
  });

  it("surfaces a rejected apply as a localised role=alert (never the raw code)", async () => {
    const api = stubApi({
      applyBackup: vi.fn().mockRejectedValue({ code: "backup.not_primary" }),
    });
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    setInput(el, "[data-test=destination]", "/mnt/usb/waitron");
    await el.updateComplete;
    q(el, "[data-test=apply]")!.click();
    await flush(el);
    const banner = archiveAlertText(el);
    expect(banner).toContain(codeMessage("backup.not_primary", "es-ES"));
    expect(banner).not.toContain("backup.not_primary");
  });

  it("applies a weekday/fixed-time policy", async () => {
    const api = stubApi();
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    setInput(el, "[data-test=destination]", "/mnt/disk/waitron");
    await chooseOption(q(el, "[data-test=days-mode]")!, "weekdays");
    await chooseOption(q(el, "[data-test=time-mode]")!, "fixed");
    await el.updateComplete;
    q(el, "[data-test=weekday-6]")!.dispatchEvent(new Event("change", { bubbles: true }));
    q(el, "[data-test=weekday-1]")!.dispatchEvent(new Event("change", { bubbles: true }));
    setInput(el, "[data-test=at-time]", "02:30");
    setInput(el, "[data-test=retain-count]", "5");
    setInput(el, "[data-test=retain-days]", "14");
    await el.updateComplete;
    q(el, "[data-test=apply]")!.click();
    await flush(el);
    expect(api.applyBackup).toHaveBeenCalledWith({
      destinations: [{ kind: "local-fs", dir: "/mnt/disk/waitron" }],
      schedule: { kind: "wall-clock", days: [2, 3, 4, 5, 6], at: { hour: 2, minute: 30 } },
      retention: { count: 5, days: 14 },
    });
  });

  it("lets an enabled box change its destination through applyBackup", async () => {
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
    // Editing prefills the destination.
    expect((q(el, "[data-test=destination]") as HTMLElement & { value: string }).value).toBe(
      "/mnt/usb/waitron",
    );
    setInput(el, "[data-test=destination]", "/mnt/usb/waitron-2");
    await el.updateComplete;
    q(el, "[data-test=save-settings]")!.click();
    await flush(el);
    // Re-applied under the SAME (current) key — the running schedule/retention are preserved.
    expect(api.applyBackup).toHaveBeenCalledWith({
      destinations: [{ kind: "local-fs", dir: "/mnt/usb/waitron-2" }],
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

  it("is read-only on a non-primary node", async () => {
    const api = stubApi({}, { ...OFF, isPrimary: false });
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    expect(q(el, "[data-test=not-primary]")).not.toBeNull();
    expect(q(el, "[data-test=destination]")).toBeNull();
    expect(q(el, "[data-test=apply]")).toBeNull();
  });

  it("shows a stale last-backup marker", async () => {
    const stale: BackupStatusView = {
      ...ENABLED,
      backupStatus: {
        configured: true,
        destinations: [
          {
            id: "primary",
            lastBackupAt: "2026-08-01T02:00:00Z",
            ageSeconds: 999999,
            stale: true,
            readErrorCode: null,
            storedUnderCurrentKey: false,
            uploadErrorCode: null,
            pruneErrorCode: null,
          },
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

describe("the status watcher's read alerts", () => {
  function failFirstRead(): DashboardApi {
    return stubApi({
      getBackupStatus: vi
        .fn()
        .mockRejectedValueOnce({ code: "connection.failed" })
        .mockResolvedValue(OFF),
    });
  }

  it("clears the failed-read alert once a later read succeeds", async () => {
    const api = failFirstRead();
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    expect(alertText(el)?.trim()).toBe(codeMessage("connection.failed"));

    api.liveData.invalidate([{ type: "backup_status" }]);
    await vi.waitFor(() => expect(q(el, "[data-test=status]")).not.toBeNull());
    expect(alertText(el)).toBeUndefined();
  });

  it("keeps a refused Apply's alert through a later refresh", async () => {
    const api = stubApi(
      { applyBackup: vi.fn().mockRejectedValue({ code: "backup.recovery_key_missing" }) },
      { ...OFF, recoveryKeySet: true },
    );
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    setInput(el, "[data-test=destination]", "/mnt/usb/waitron");
    await el.updateComplete;
    q(el, "[data-test=apply]")!.click();
    await flush(el);

    api.liveData.invalidate([{ type: "backup_status" }]);
    await vi.waitFor(() => expect(api.getBackupStatus).toHaveBeenCalledTimes(2));
    await flush(el);
    expect(q(el, "[data-test=apply-actions]")!.shadowRoot!.textContent).toContain(
      codeMessage("backup.recovery_key_missing"),
    );
    expect(alertText(el)).toBeUndefined();
    expect(q(el, "[data-test=apply]")!.hasAttribute("disabled")).toBe(false);
  });

  async function mountThenFailARead(api: DashboardApi): Promise<BackupScreen> {
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    vi.mocked(api.getBackupStatus).mockRejectedValue({ code: "connection.failed" });
    api.liveData.invalidate([{ type: "backup_status" }]);
    await vi.waitFor(() => expect(alertText(el)?.trim()).toBe(codeMessage("connection.failed")));
    return el;
  }

  async function startApply(el: BackupScreen): Promise<void> {
    setInput(el, "[data-test=destination]", "/mnt/usb/waitron");
    await el.updateComplete;
    q(el, "[data-test=apply]")!.click();
    await el.updateComplete;
  }

  it("clears the failed-read alert when Apply starts", async () => {
    const api = stubApi({ applyBackup: vi.fn().mockReturnValue(new Promise(() => {})) });
    const el = await mountThenFailARead(api);

    await startApply(el);
    expect(api.applyBackup).toHaveBeenCalledOnce();
    expect(alertText(el)).toBeUndefined();
  });

  it("raises the failed-read alert again when a read after Apply fails", async () => {
    const api = stubApi();
    const el = await mountThenFailARead(api);
    const readsBeforeApply = vi.mocked(api.getBackupStatus).mock.calls.length;

    await startApply(el);
    await flush(el);
    expect(api.applyBackup).toHaveBeenCalledOnce();
    api.liveData.invalidate([{ type: "backup_status" }]);
    await vi.waitFor(() => expect(api.getBackupStatus).toHaveBeenCalledTimes(readsBeforeApply + 1));
    await flush(el);
    expect(alertText(el)?.trim()).toBe(codeMessage("connection.failed"));
  });

  async function enterEditAfterAFailedRead(api: DashboardApi): Promise<BackupScreen> {
    const el = await mountThenFailARead(api);
    q(el, "[data-test=edit-settings]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=save-settings]")).not.toBeNull());
    expect(alertText(el)?.trim()).toBe(codeMessage("connection.failed"));
    return el;
  }

  it("clears the failed-read alert when Save settings starts", async () => {
    const api = stubApi({ applyBackup: vi.fn().mockReturnValue(new Promise(() => {})) }, ENABLED);
    const el = await enterEditAfterAFailedRead(api);
    await editDestination(el);

    q(el, "[data-test=save-settings]")!.click();
    await el.updateComplete;
    expect(api.applyBackup).toHaveBeenCalledOnce();
    expect(alertText(el)).toBeUndefined();
  });

  it("raises the failed-read alert again when a read after Save settings fails", async () => {
    const api = stubApi({}, ENABLED);
    const el = await enterEditAfterAFailedRead(api);
    const readsBeforeSave = vi.mocked(api.getBackupStatus).mock.calls.length;
    await editDestination(el);

    q(el, "[data-test=save-settings]")!.click();
    await flush(el);
    expect(api.applyBackup).toHaveBeenCalledOnce();
    expect(alertText(el)).toBeUndefined();
    api.liveData.invalidate([{ type: "backup_status" }]);
    await vi.waitFor(() => expect(api.getBackupStatus).toHaveBeenCalledTimes(readsBeforeSave + 1));
    await flush(el);
    expect(alertText(el)?.trim()).toBe(codeMessage("connection.failed"));
  });

  it("keeps the failed-read alert through Edit and Cancel edit", async () => {
    const api = stubApi({}, ENABLED);
    const el = await enterEditAfterAFailedRead(api);

    q(el, "[data-test=cancel-edit]")!.click();
    await el.updateComplete;
    expect(alertText(el)?.trim()).toBe(codeMessage("connection.failed"));
  });
});

describe("backup-screen failures and edit-mode prefill", () => {
  async function mountLoaded(api: DashboardApi): Promise<BackupScreen> {
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
      api,
      onboardingIntent: "live",
    });
    await vi.waitFor(() => expect(q(el, "[data-test=status]")).not.toBeNull());
    return el;
  }

  async function enterEdit(status: BackupStatusView) {
    const api = stubApi({}, status);
    const el = await mountLoaded(api);
    await vi.waitFor(() => expect(q(el, "[data-test=edit-settings]")).not.toBeNull());
    q(el, "[data-test=edit-settings]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=save-settings]")).not.toBeNull());
    return { el, api };
  }

  it("offers Cloud as the only destination and saves the choice", async () => {
    const api = stubApi({}, { ...OFF, recoveryKeySet: true, cloudBackups: "available" });
    const el = await mountLoaded(api);
    const choice = q(el, "[data-test=archive-cloud]")!;
    expect(choice).not.toBeNull();
    await page.getByRole("switch", { name: "Waitron Cloud" }).click();
    q(el, "[data-test=archive-folder-on]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { checked: false } }),
    );
    await el.updateComplete;
    q(el, "[data-test=apply]")!.click();
    await vi.waitFor(() =>
      expect(api.applyBackup).toHaveBeenCalledWith(
        expect.objectContaining({ cloud: true, destinations: [] }),
      ),
    );
  });

  it("shows a saved Cloud outcome, hides the unavailable choice and preserves it on a local save", async () => {
    const { el, api } = await enterEdit({
      ...ENABLED,
      cloud: true,
      cloudBackups: "unavailable",
      backupStatus: {
        configured: true,
        destinations: [
          {
            id: "cloud",
            lastBackupAt: null,
            ageSeconds: null,
            stale: true,
            readErrorCode: "cloud.unavailable",
            storedUnderCurrentKey: false,
            uploadErrorCode: null,
            pruneErrorCode: null,
          },
        ],
      },
    });
    expect(q(el, "[data-test=archive-cloud]")).toBeNull();
    expect(q(el, "[data-destination=cloud]")?.textContent).toContain(
      codeMessage("cloud.unavailable"),
    );
    const folder = page.getByText(t("backup.destination.choice_local"), { exact: true });
    await folder.click();
    q(el, "[data-test=save-settings]")!.click();
    await el.updateComplete;
    expect(api.applyBackup).not.toHaveBeenCalled();
    await folder.click();
    await editDestination(el);
    q(el, "[data-test=save-settings]")!.click();
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledOnce());
    expect(vi.mocked(api.applyBackup).mock.calls[0]![0]).not.toHaveProperty("cloud");
  });

  it("removes saved Cloud while unavailable and saves a weekday schedule", async () => {
    const { el, api } = await enterEdit({ ...ENABLED, cloud: true, cloudBackups: "unavailable" });
    await vi.waitFor(() => expect(q(el, "[data-test=remove-cloud]")).not.toBeNull());
    q(el, "[data-test=remove-cloud]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=save-settings]")).toHaveProperty("disabled", false);
    await chooseOption(q(el, "[data-test=days-mode]")!, "weekdays");
    await el.updateComplete;
    q(el, "[data-test=save-settings]")!.click();
    await vi.waitFor(() =>
      expect(api.applyBackup).toHaveBeenLastCalledWith(
        expect.objectContaining({
          cloud: false,
          schedule: { kind: "wall-clock", days: [1, 2, 3, 4, 5], at: "auto" },
        }),
      ),
    );
  });

  it("places the daily refusal under the schedule and fixes the draft when asked", async () => {
    const { el, api } = await enterEdit({
      ...ENABLED,
      cloud: true,
      cloudBackups: "available",
    });
    vi.mocked(api.applyBackup).mockRejectedValueOnce({
      code: "backup.cloud_needs_daily",
      params: { field: "schedule" },
    });
    await chooseOption(q(el, "[data-test=days-mode]")!, "weekdays");
    tickCheckbox(el, "[data-test=weekday-1]");
    await el.updateComplete;
    q(el, "[data-test=save-settings]")!.click();
    await vi.waitFor(() =>
      expect(q(el, "[data-test=days-mode]")).toHaveProperty(
        "error",
        codeMessage("backup.cloud_needs_daily"),
      ),
    );
    expect(archiveAlertText(el)).toBe(t("form.fix_fields"));
    expect(q(el, "[data-test=save-settings]")).toHaveProperty("disabled", false);
    q(el, "[data-test=cloud-daily]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=days-mode]")).toHaveProperty("value", "daily");
    expect(q(el, "[data-test=days-mode]")).toHaveProperty("error", "");
    expect(api.applyBackup).toHaveBeenCalledOnce();
  });

  it("puts a Cloud refusal under the choice and clears it when that choice changes", async () => {
    const { el, api } = await enterEdit({ ...ENABLED, cloudBackups: "available" });
    vi.mocked(api.applyBackup).mockRejectedValueOnce({
      code: "backup.cloud_unavailable",
      params: { field: "cloud" },
    });
    const choice = page.getByRole("switch", { name: "Waitron Cloud" });
    await choice.click();
    q(el, "[data-test=save-settings]")!.click();
    await vi.waitFor(() =>
      expect(q(el, "[data-test=archive-cloud]")).toHaveProperty(
        "description",
        codeMessage("backup.cloud_unavailable"),
      ),
    );
    expect(archiveAlertText(el)).toBe(t("form.fix_fields"));
    const control = q(el, "[data-test=archive-cloud]")!.shadowRoot!;
    await vi.waitFor(() => expect(control.activeElement).toBe(control.querySelector("input")));
    await userEvent.keyboard(" ");
    expect(q(el, "[data-test=archive-cloud]")).toHaveProperty("description", "");
  });

  it("explains a missing key at Save", async () => {
    const { el, api } = await enterEdit(ENABLED);
    vi.mocked(api.applyBackup).mockRejectedValue({ code: "backup.recovery_key_missing" });
    await editDestination(el);
    q(el, "[data-test=save-settings]")!.click();
    await vi.waitFor(() =>
      expect(archiveAlertText(el)).toBe(codeMessage("backup.recovery_key_missing")),
    );
    expect(q(el, "[data-test=edit-title]")).not.toBeNull();
  });

  it("keeps the edit form open with a localized alert when saving settings is rejected", async () => {
    const { el, api } = await enterEdit(ENABLED);
    vi.mocked(api.applyBackup).mockRejectedValue({ code: "connection.failed" });
    await editDestination(el);

    q(el, "[data-test=save-settings]")!.click();

    await vi.waitFor(() => expect(archiveAlertText(el)).toBe(codeMessage("connection.failed")));
    expect(q(el, "[data-test=edit-title]")).not.toBeNull();
  });

  it("does not save settings while the destination is blank", async () => {
    const { el, api } = await enterEdit(ENABLED);
    setInput(el, "[data-test=destination]", "   ");
    await el.updateComplete;
    expect(q(el, "[data-test=save-settings]")!.hasAttribute("disabled")).toBe(false);

    q(el, "[data-test=save-settings]")!.click();
    await el.updateComplete;

    expect(api.applyBackup).not.toHaveBeenCalled();
    expect(q(el, "[data-test=save-settings]")!.hasAttribute("disabled")).toBe(true);
  });

  it("cancels edit mode back to the status view, clearing the banner", async () => {
    const { el, api } = await enterEdit(ENABLED);
    vi.mocked(api.applyBackup).mockRejectedValueOnce({ code: "connection.failed" });
    await editDestination(el);
    q(el, "[data-test=save-settings]")!.click();
    await vi.waitFor(() => expect(archiveAlertText(el)).toBe(codeMessage("connection.failed")));

    q(el, "[data-test=cancel-edit]")!.click();
    await el.updateComplete;

    expect(q(el, "[data-test=edit-title]")).toBeNull();
    expect(q(el, "[data-test=edit-settings]")).not.toBeNull();
    expect(alertText(el)).toBeUndefined();
    q(el, "[data-test=edit-settings]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=save-settings]")).not.toBeNull());
    await editDestination(el);
    q(el, "[data-test=save-settings]")!.click();
    await vi.waitFor(() => expect(api.applyBackup).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.applyBackup).mock.calls[1]![0]).not.toHaveProperty("recoveryKey");
  });

  it("prefills picked weekdays and a fixed time, and re-applies them unchanged beside an edit", async () => {
    const { el, api } = await enterEdit({
      ...ENABLED,
      schedule: { kind: "wall-clock", days: [0, 3], at: { hour: 2, minute: 5 } },
    });

    expect((q(el, "[data-test=days-mode]") as HTMLElement & { value: string }).value).toBe(
      "weekdays",
    );
    expect((q(el, "[data-test=weekday-0]") as HTMLInputElement).checked).toBe(true);
    expect((q(el, "[data-test=weekday-3]") as HTMLInputElement).checked).toBe(true);
    expect((q(el, "[data-test=weekday-1]") as HTMLInputElement).checked).toBe(false);
    expect((q(el, "[data-test=at-time]") as WtInput).value).toBe("02:05");
    // The pre-fill reads back equal to what the box runs: the editor opens with Save quiet.
    const save = q(el, "[data-test=save-settings]") as HTMLElementTagNameMap["wt-button"];
    expect([save.variant, save.disabled]).toEqual(["secondary", true]);

    setInput(el, "[data-test=retain-count]", "8");
    await el.updateComplete;
    q(el, "[data-test=save-settings]")!.click();

    await vi.waitFor(() =>
      expect(api.applyBackup).toHaveBeenCalledExactlyOnceWith({
        destinations: [{ kind: "local-fs", dir: "/mnt/usb/waitron" }],
        schedule: { kind: "wall-clock", days: [0, 3], at: { hour: 2, minute: 5 } },
        retention: { count: 8, days: 30 },
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
        destinations: [{ kind: "local-fs", dir: "/mnt/usb/new" }],
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
    expect(await configurationBottom(el)).toBe(t("form.fix_fields"));
    const fieldErrors = configurationErrors(el);
    expect(fieldErrors).toHaveLength(2);
    expect(fieldErrors[0]).toBe(t("backup.configuration.passphrase_error"));
  });

  it("explains a failed configuration export without blaming the fields, and keeps the passphrase", async () => {
    const api = stubApi({ exportConfiguration: vi.fn().mockRejectedValue(new Error("offline")) });
    const el = await mountLoaded(api);
    setInput(el, "[data-test=configuration-passphrase]", "a strong passphrase");
    setInput(el, "[data-test=configuration-confirm]", "a strong passphrase");

    q(el, "[data-test=configuration-export]")!.click();

    await vi.waitFor(async () =>
      expect(await configurationBottom(el)).toBe(t("backup.configuration.request_error")),
    );
    expect(configurationErrors(el)).toEqual(["", ""]);
    expect(
      (q(el, "[data-test=configuration-passphrase]") as HTMLElement & { value: string }).value,
    ).toBe("a strong passphrase");
    expect(q(el, "[data-test=configuration-export]")!.hasAttribute("disabled")).toBe(false);
  });

  it("drops a failed configuration export's message when the export is pressed again", async () => {
    const api = stubApi({
      exportConfiguration: vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockReturnValueOnce(new Promise(() => {})),
    });
    const el = await mountLoaded(api);
    setInput(el, "[data-test=configuration-passphrase]", "a strong passphrase");
    setInput(el, "[data-test=configuration-confirm]", "a strong passphrase");
    q(el, "[data-test=configuration-export]")!.click();
    await vi.waitFor(async () =>
      expect(await configurationBottom(el)).toBe(t("backup.configuration.request_error")),
    );

    q(el, "[data-test=configuration-export]")!.click();
    await el.updateComplete;
    expect(await configurationBottom(el)).toBeNull();
    expect(api.exportConfiguration).toHaveBeenCalledTimes(2);
  });
});

describe("backup-screen retention boxes", () => {
  async function bottomOf(el: BackupScreen, id: string): Promise<string | null> {
    const actions = q(el, `[data-test=${id}]`) as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await actions.updateComplete;
    return actions.shadowRoot!.querySelector("[role=alert]")?.textContent ?? null;
  }

  const boxError = (el: BackupScreen, box: "count" | "days"): string | null =>
    (q(el, `[data-test=retain-${box}]`) as (HTMLElement & { error: string }) | null)?.error || null;

  async function readyToApply(api: DashboardApi): Promise<BackupScreen> {
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    setInput(el, "[data-test=destination]", "/mnt/usb/waitron");
    await el.updateComplete;
    return el;
  }

  it("a blank time of day sends nothing: the field says why, focus moves to it, and Apply waits until it is filled", async () => {
    const api = stubApi();
    const el = await readyToApply(api);
    await chooseOption(q(el, "[data-test=time-mode]")!, "fixed");
    await el.updateComplete;
    const at = q(el, "[data-test=at-time]") as WtInput;
    expect(at.required).toBe(true);
    setInput(el, "[data-test=at-time]", "");
    await el.updateComplete;

    q(el, "[data-test=apply]")!.click();
    await flush(el);

    expect(api.applyBackup).not.toHaveBeenCalled();
    expect(at.error).toBe(t("backup.schedule.at_required"));
    expect(await bottomOf(el, "apply-actions")).toBe(t("form.fix_fields"));
    expect(el.shadowRoot!.activeElement).toBe(at);
    expect(q(el, "[data-test=apply]")!.hasAttribute("disabled")).toBe(true);

    setInput(el, "[data-test=at-time]", "04:15");
    await el.updateComplete;
    expect(at.error).toBe("");
    expect(q(el, "[data-test=apply]")!.hasAttribute("disabled")).toBe(false);
    q(el, "[data-test=apply]")!.click();
    await flush(el);
    expect(api.applyBackup).toHaveBeenCalledWith(
      expect.objectContaining({
        schedule: { kind: "wall-clock", days: "daily", at: { hour: 4, minute: 15 } },
      }),
    );
  });

  it("a blank box sends nothing: the box says why, focus moves to it, and Apply waits until it is filled", async () => {
    const api = stubApi();
    const el = await readyToApply(api);
    setInput(el, "[data-test=retain-count]", "");
    await el.updateComplete;
    expect(q(el, "[data-test=apply]")!.hasAttribute("disabled")).toBe(false);

    q(el, "[data-test=apply]")!.click();
    await flush(el);

    expect(api.applyBackup).not.toHaveBeenCalled();
    expect(boxError(el, "count")).toBe(t("backup.retention_invalid"));
    expect(
      q(el, "[data-test=retain-count]")!
        .shadowRoot!.querySelector("input")!
        .getAttribute("aria-invalid"),
    ).toBe("true");
    expect(boxError(el, "days")).toBeNull();
    expect(await bottomOf(el, "apply-actions")).toBe(t("form.fix_fields"));
    expect(el.shadowRoot!.activeElement).toBe(q(el, "[data-test=retain-count]"));
    expect(q(el, "[data-test=apply]")!.hasAttribute("disabled")).toBe(true);
    expect(alertText(el)).toBeUndefined();

    setInput(el, "[data-test=retain-count]", "5");
    await el.updateComplete;
    expect(boxError(el, "count")).toBeNull();
    expect(await bottomOf(el, "apply-actions")).toBeNull();
    expect(q(el, "[data-test=apply]")!.hasAttribute("disabled")).toBe(false);
    q(el, "[data-test=apply]")!.click();
    await flush(el);
    expect(api.applyBackup).toHaveBeenCalledWith(
      expect.objectContaining({ retention: { count: 5, days: 30 } }),
    );
  });

  it("zero, a negative and a fraction are refused by the form as a blank is", async () => {
    for (const value of ["0", "-3", "2.5"]) {
      const api = stubApi();
      const el = await readyToApply(api);
      setInput(el, "[data-test=retain-days]", value);
      q(el, "[data-test=apply]")!.click();
      await flush(el);
      expect(api.applyBackup, value).not.toHaveBeenCalled();
      expect(boxError(el, "days"), value).toBe(t("backup.retention_invalid"));
      expect(q(el, "[data-test=retain-days]")!.shadowRoot!.activeElement).toBe(
        q(el, "[data-test=retain-days]")!.shadowRoot!.querySelector("input"),
      );
      cleanupWidgets();
    }
  });

  it("turning backups on with a held key holds a blank box too", async () => {
    const api = stubApi({}, { ...OFF, recoveryKeySet: true });
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    setInput(el, "[data-test=destination]", "/mnt/usb/waitron");
    setInput(el, "[data-test=retain-count]", "");
    await el.updateComplete;

    q(el, "[data-test=apply]")!.click();
    await flush(el);

    expect(api.applyBackup).not.toHaveBeenCalled();
    expect(boxError(el, "count")).toBe(t("backup.retention_invalid"));
    expect(q(el, "[data-test=apply]")!.hasAttribute("disabled")).toBe(true);
  });

  it("the settings editor holds a blank box the same way", async () => {
    const api = stubApi({}, ENABLED);
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    q(el, "[data-test=edit-settings]")!.click();
    await flush(el);
    setInput(el, "[data-test=retain-days]", "");
    await el.updateComplete;

    q(el, "[data-test=save-settings]")!.click();
    await flush(el);

    expect(api.applyBackup).not.toHaveBeenCalled();
    expect(boxError(el, "days")).toBe(t("backup.retention_invalid"));
    expect(await bottomOf(el, "settings-actions")).toBe(t("form.fix_fields"));
    expect(q(el, "[data-test=save-settings]")!.hasAttribute("disabled")).toBe(true);
  });

  it("cancelling the settings editor starts it again with no messages", async () => {
    const api = stubApi(
      {
        applyBackup: vi.fn().mockRejectedValue({
          code: "backup.request_invalid",
          params: { field: "retention" },
          status: 400,
        }),
      },
      ENABLED,
    );
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    q(el, "[data-test=edit-settings]")!.click();
    await flush(el);
    await editDestination(el);
    q(el, "[data-test=save-settings]")!.click();
    await flush(el);
    expect(boxError(el, "days")).toBe(t("backup.retention_invalid"));

    q(el, "[data-test=cancel-edit]")!.click();
    await el.updateComplete;
    q(el, "[data-test=edit-settings]")!.click();
    await flush(el);

    expect(boxError(el, "days")).toBeNull();
    expect(await bottomOf(el, "settings-actions")).toBeNull();
    const save = q(el, "[data-test=save-settings]") as HTMLElementTagNameMap["wt-button"];
    expect([save.variant, save.disabled]).toEqual(["secondary", true]);
    await editDestination(el);
    expect(boxError(el, "days")).toBeNull();
    expect(save.hasAttribute("disabled")).toBe(false);
  });

  it("the server's refusal of the retention shows under both boxes, moves focus to the first, and leaves Apply working", async () => {
    const api = stubApi({
      applyBackup: vi.fn().mockRejectedValue({
        code: "backup.request_invalid",
        params: { field: "retention" },
        status: 400,
      }),
    });
    const el = await readyToApply(api);

    q(el, "[data-test=apply]")!.click();
    await flush(el);

    expect(boxError(el, "count")).toBe(t("backup.retention_invalid"));
    expect(boxError(el, "days")).toBe(t("backup.retention_invalid"));
    expect(el.shadowRoot!.activeElement).toBe(q(el, "[data-test=retain-count]"));
    expect(await bottomOf(el, "apply-actions")).toBe(t("form.fix_fields"));
    expect(alertText(el)).toBeUndefined();
    expect(q(el, "[data-test=apply]")!.hasAttribute("disabled")).toBe(false);

    setInput(el, "[data-test=retain-count]", "8");
    await el.updateComplete;
    expect(boxError(el, "count")).toBeNull();
    expect(boxError(el, "days")).toBeNull();
    expect(await bottomOf(el, "apply-actions")).toBeNull();
  });

  it("the settings editor shows the server's refusal of the retention under both boxes and moves focus to the first", async () => {
    const api = stubApi(
      {
        applyBackup: vi.fn().mockRejectedValue({
          code: "backup.request_invalid",
          params: { field: "retention" },
          status: 400,
        }),
      },
      ENABLED,
    );
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    q(el, "[data-test=edit-settings]")!.click();
    await flush(el);
    await editDestination(el);

    q(el, "[data-test=save-settings]")!.click();
    await flush(el);

    expect(boxError(el, "count")).toBe(t("backup.retention_invalid"));
    expect(boxError(el, "days")).toBe(t("backup.retention_invalid"));
    expect(el.shadowRoot!.activeElement).toBe(q(el, "[data-test=retain-count]"));
    expect(await bottomOf(el, "settings-actions")).toBe(t("form.fix_fields"));
    expect(alertText(el)).toBeUndefined();
    expect(q(el, "[data-test=save-settings]")!.hasAttribute("disabled")).toBe(false);
  });

  it("a whole number written as 7.0 or 1e2 is sent as 7 and 100 when turning backups on", async () => {
    const api = stubApi();
    const el = await readyToApply(api);
    setInput(el, "[data-test=retain-count]", "7.0");
    setInput(el, "[data-test=retain-days]", "1e2");
    await el.updateComplete;

    q(el, "[data-test=apply]")!.click();
    await flush(el);

    expect(boxError(el, "count")).toBeNull();
    expect(boxError(el, "days")).toBeNull();
    expect(api.applyBackup).toHaveBeenCalledWith(
      expect.objectContaining({ retention: { count: 7, days: 100 } }),
    );
  });

  it("a whole number written as 7.0 or 1e2 is sent as 7 and 100 from the settings editor", async () => {
    const api = stubApi({}, ENABLED);
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    q(el, "[data-test=edit-settings]")!.click();
    await flush(el);
    setInput(el, "[data-test=retain-count]", "7.0");
    setInput(el, "[data-test=retain-days]", "1e2");
    await el.updateComplete;

    q(el, "[data-test=save-settings]")!.click();
    await flush(el);

    expect(boxError(el, "count")).toBeNull();
    expect(boxError(el, "days")).toBeNull();
    expect(api.applyBackup).toHaveBeenCalledWith(
      expect.objectContaining({ retention: { count: 7, days: 100 } }),
    );
  });

  it("a refusal naming a field the form does not show goes in the bottom message, not under the boxes", async () => {
    const api = stubApi({
      applyBackup: vi.fn().mockRejectedValue({
        code: "backup.request_invalid",
        params: { field: "schedule" },
        status: 400,
      }),
    });
    const el = await readyToApply(api);

    q(el, "[data-test=apply]")!.click();
    await flush(el);

    expect(await bottomOf(el, "apply-actions")).toBe(codeMessage("backup.request_invalid"));
    expect(alertText(el)).toBeUndefined();
    expect(boxError(el, "count")).toBeNull();
    expect(boxError(el, "days")).toBeNull();
  });
});

describe("backup-screen dates", () => {
  it("writes the last backup and the key rotation in the dashboard's language, not the browser's", async () => {
    const status = ENABLED.backupStatus;
    if (!status.configured) throw new Error("the ENABLED fixture must carry backup freshness");
    const lastBackupAt = status.destinations[0]!.lastBackupAt!;
    const keyRotatedAt = "2026-09-05T09:00:00Z";
    expect(new Date(lastBackupAt).toLocaleString()).not.toBe(
      new Date(lastBackupAt).toLocaleString("es-ES"),
    );
    const before = currentLocale();
    setLocale("es-ES");
    try {
      const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
        api: stubApi({}, { ...ENABLED, keyRotatedAt }),
      });
      await flush(el);
      expect(q(el, "[data-test=key-rotated]")!.textContent!.trim()).toBe(
        new Date(keyRotatedAt).toLocaleString("es-ES"),
      );
      expect(el.shadowRoot!.textContent).toContain(new Date(lastBackupAt).toLocaleString("es-ES"));
    } finally {
      setLocale(before);
    }
  });
});

describe("backup-screen fields", () => {
  type Combobox = HTMLElement & { options: { value: string }[]; value: string };
  type Stepper = HTMLElement & { value: string; min: number; label: string; required: boolean };

  it("the days and time choices are dropdowns showing the stored choice, and a pick shows what it opens", async () => {
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api: stubApi() });
    await flush(el);
    const days = q(el, "wt-combobox[data-test=days-mode]") as Combobox;
    const time = q(el, "wt-combobox[data-test=time-mode]") as Combobox;
    expect(days.options.map((o) => o.value)).toEqual(["daily", "weekdays"]);
    expect(days.value).toBe("daily");
    expect(time.options.map((o) => o.value)).toEqual(["auto", "fixed"]);
    expect(time.value).toBe("auto");

    await chooseOption(days, "weekdays");
    await chooseOption(time, "fixed");
    await el.updateComplete;
    expect(q(el, "[data-test=weekday-1]")).not.toBeNull();
    const at = q(el, "wt-input[data-test=at-time]") as HTMLElement & {
      type: string;
      value: string;
    };
    expect(at.type).toBe("time");
    expect(at.value).toBe("03:00");
    expect(at.getAttribute("label")).toBe(t("backup.schedule.at"));
  });

  it("each retention box is a whole-number stepper from 1 under its own name", async () => {
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api: stubApi() });
    await flush(el);
    for (const box of ["count", "days"] as const) {
      const stepper = q(el, `wt-number-stepper[name=retention-${box}]`) as Stepper;
      expect(stepper, box).not.toBeNull();
      expect(stepper.min).toBe(1);
      expect(stepper.required).toBe(true);
      expect(stepper.label).toBe(t(`backup.retention.${box}`));
    }
    expect((q(el, "wt-number-stepper[name=retention-count]") as Stepper).value).toBe("7");
  });
});

describe("backup-key configuration refusal", () => {
  for (const locale of ["en-GB", "es-ES"] as const) {
    it(`apply explains key uncertainty and keeps the key status after a mismatch in ${locale}`, async () => {
      const before = currentLocale();
      setLocale(locale);
      try {
        const refusal = { code: "backup.effective_mismatch" };
        const write = vi.fn().mockRejectedValueOnce(refusal).mockResolvedValue(ENABLED);
        const api = stubApi({ applyBackup: write }, { ...OFF, recoveryKeySet: true });
        const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
        await flush(el);
        setInput(el, "[data-test=destination]", "/mnt/usb/waitron");
        await el.updateComplete;
        const action = q(el, "[data-test=apply]") as HTMLElementTagNameMap["wt-button"];
        expect(action.disabled).toBe(false);
        action.click();
        await vi.waitFor(() =>
          expect(archiveAlertText(el)?.trim()).toBe(codeMessage(refusal.code)),
        );
        expect(archiveAlertText(el)?.trim()).toBe(
          locale === "en-GB"
            ? "The box could not confirm which backup key its backups use: the key it loaded is not the one it holds. Reload the page and try again. If this message comes back, stop changing backup settings here: this page cannot tell which key is right."
            : "El servidor no ha podido confirmar qué clave usan sus copias: la clave que ha cargado no es la que tiene guardada. Recarga la página y vuelve a intentarlo. Si este mensaje vuelve a salir, no sigas cambiando los ajustes de las copias aquí: esta página no puede saber qué clave es la correcta.",
        );
        expect(write).toHaveBeenCalledTimes(1);
        expect(q(el, ".off")?.textContent?.trim()).toBe(t("backup.status.off"));
        expect(action.disabled).toBe(false);
        action.click();
        await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
        await flush(el);
        expect(archiveAlertText(el)).toBeUndefined();
        expect(el.shadowRoot!.textContent).toContain(ENABLED.keyFingerprint);
      } finally {
        setLocale(before);
      }
    });
  }
});

describe("A1089 unreadable archive settings choices", () => {
  for (const locale of ["en-GB", "es-ES"] as const) {
    it(`explains reconfiguration, keeps a refusal, and applies corrected choices (${locale})`, async () => {
      const previous = currentLocale();
      setLocale(locale);
      try {
        const api = stubApi(
          {},
          {
            ...OFF,
            loadErrorCode: "backup.archive_settings_invalid",
            recoveryKeySet: true,
            keyFingerprint: "ab12cd34",
          },
        );
        vi.mocked(api.applyBackup).mockRejectedValueOnce({
          code: "backup.request_invalid",
          params: { field: "dir" },
        });
        const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
        await flush(el);
        const message = alertMessage("backup.archive_settings_unusable", {}, locale);
        const apply = () => q(el, "[data-test=apply]") as HTMLElement & { disabled: boolean };
        expect(message).toContain(apply().textContent!.trim());
        if (locale === "en-GB") {
          expect(message).toContain("leave without applying");
          expect(message).not.toContain("contact support");
        } else {
          expect(message).toContain("sal sin aplicarlos para conservarlos");
          expect(message).not.toMatch(/instal|soporte|encargad|gerente|responsable/i);
        }
        expect(q(el, "[data-test=load-failed]")!.textContent).toContain(
          codeMessage("backup.archive_settings_invalid"),
        );
        expect(api.applyBackup).not.toHaveBeenCalled();
        setInput(el, "[data-test=destination]", "/mnt/usb/unavailable");
        await el.updateComplete;
        apply().click();
        await flush(el);
        expect(q(el, "[data-test=destination]")!.getAttribute("error")).toBeTruthy();
        expect((q(el, "[data-test=destination]") as WtInput).value).toBe("/mnt/usb/unavailable");
        expect(q(el, "[data-test=load-failed]")!.textContent).toContain(
          codeMessage("backup.archive_settings_invalid"),
        );
        setInput(el, "[data-test=destination]", "/mnt/usb/waitron");
        await el.updateComplete;
        expect(apply().disabled).toBe(false);
        apply().click();
        await flush(el);
        expect(api.applyBackup).toHaveBeenCalledTimes(2);
        expect(api.applyBackup).toHaveBeenLastCalledWith({
          destinations: [{ kind: "local-fs", dir: "/mnt/usb/waitron" }],
          schedule: { kind: "wall-clock", days: "daily", at: "auto" },
          retention: { count: 7, days: 30 },
        });
        expect(q(el, "[data-test=load-failed]")).toBeNull();
        expect(el.shadowRoot!.textContent).toContain("/mnt/usb/waitron");
        expect(api.rotateBackupKey).not.toHaveBeenCalled();
      } finally {
        setLocale(previous);
      }
    });

    it(`names the button that replaces invalid saved settings (${locale})`, async () => {
      const previous = currentLocale();
      setLocale(locale);
      try {
        const api = stubApi({}, { ...OFF, loadErrorCode: "backup.archive_settings_invalid" });
        const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
        await flush(el);
        const message = codeMessage("backup.archive_settings_invalid");
        const apply = q(el, "[data-test=apply]")!.textContent!.trim();
        expect(apply).not.toBe("");
        expect(q(el, "[data-test=load-failed]")!.textContent).toContain(message);
        expect(message).toContain(apply);
        expect(message).not.toMatch(/Save them again|Vuelve a guardarlos/);
      } finally {
        setLocale(previous);
      }
    });

    it(`a load failure with no words of its own says what happened and what each choice does (${locale})`, async () => {
      const previous = currentLocale();
      setLocale(locale);
      try {
        const api = stubApi({}, { ...OFF, loadErrorCode: "credentials.decrypt_failed" });
        const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
        await flush(el);
        const line = q(el, "[data-test=load-failed]")!.textContent!.trim();
        const words = codeMessage("backup.archive_settings_unusable");
        expect(hasCodeMessage("backup.archive_settings_unusable")).toBe(true);
        expect(line).toBe(words);
        expect(line).not.toContain(codeMessage("server.internal"));
        expect(words).toContain(t("backup_evidence.heading"));
        expect(words).toContain(t("backup.apply"));
        expect(words).not.toMatch(/support|soporte|manager|responsable|encargad/i);
      } finally {
        setLocale(previous);
      }
    });

    it(`a load failure with words of its own still shows them (${locale})`, async () => {
      const previous = currentLocale();
      setLocale(locale);
      try {
        const api = stubApi({}, { ...OFF, loadErrorCode: "backup.archive_settings_invalid" });
        const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
        await flush(el);
        const line = q(el, "[data-test=load-failed]")!.textContent!;
        expect(line).toContain(t("backup.status.load_failed"));
        expect(line).toContain(codeMessage("backup.archive_settings_invalid"));
        expect(line).not.toContain(codeMessage("backup.archive_settings_unusable"));
      } finally {
        setLocale(previous);
      }
    });

    it(`explains stopping without replacing unreadable settings (${locale})`, async () => {
      const previous = currentLocale();
      setLocale(locale);
      try {
        const api = stubApi(
          {},
          {
            ...OFF,
            loadErrorCode: "credentials.decrypt_failed",
            recoveryKeySet: true,
          },
        );
        const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
        await flush(el);
        const message = alertMessage("backup.archive_settings_unusable", {}, locale);
        expect(message).toContain(t("backup.apply"));
        const line = q(el, "[data-test=load-failed]")!.textContent!;
        expect(line).toContain(codeMessage("backup.archive_settings_unusable"));
        expect(line).not.toContain(codeMessage("credentials.decrypt_failed"));
        setInput(el, "[data-test=destination]", "/mnt/usb/reconsidered");
        await el.updateComplete;
        el.remove();
        await flush(el);
        expect(api.applyBackup).not.toHaveBeenCalled();
        expect(api.rotateBackupKey).not.toHaveBeenCalled();
      } finally {
        setLocale(previous);
      }
    });

    /** Turns backups on from a box holding a key, answering `answer`; returns the reload line. */
    async function reloadLineAfterApply(answer: BackupWriteAnswer): Promise<{
      el: BackupScreen;
      line: string;
    }> {
      const held = { ...OFF, recoveryKeySet: true, keyFingerprint: "ab12cd34" };
      const api = stubApi({ applyBackup: vi.fn().mockResolvedValue(answer) }, held);
      const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
      await flush(el);
      setInput(el, "[data-test=destination]", "/mnt/usb/waitron");
      await el.updateComplete;
      q(el, "[data-test=apply]")!.click();
      await flush(el);
      expect(api.applyBackup).toHaveBeenCalledOnce();
      const line = q(el, "[data-test=reload-failed]")!.textContent!.replace(/\s+/g, " ").trim();
      return { el, line };
    }

    it(`a save whose reload failed with no words of its own says what retries, not "try again" (${locale})`, async () => {
      const previous = currentLocale();
      setLocale(locale);
      try {
        const { el, line } = await reloadLineAfterApply({
          ...OFF,
          recoveryKeySet: true,
          reloadErrorCode: "unknown",
        });
        expect(hasCodeMessage("unknown")).toBe(false);
        expect(line).not.toContain(codeMessage("unknown"));
        expect(line).toBe(
          `${t("backup.reload_failed_after_save")} ${t("backup.reload_failed_retry")}`,
        );
        expect(line).not.toMatch(/support|soporte|manager|responsable|encargad/i);
        expect(q(el, "[data-test=status]")!.textContent).toContain(t("backup.status.off"));
        expect(q(el, "[data-test=load-failed]")).toBeNull();
      } finally {
        setLocale(previous);
      }
    });

    it(`a save whose reload left settings with no words unusable leaves the explaining to the status line (${locale})`, async () => {
      const previous = currentLocale();
      setLocale(locale);
      try {
        const { el, line } = await reloadLineAfterApply({
          ...OFF,
          recoveryKeySet: true,
          loadErrorCode: "credentials.decrypt_failed",
          backupStatus: { configured: false, loadErrorCode: "credentials.decrypt_failed" },
          reloadErrorCode: "credentials.decrypt_failed",
        });
        expect(line).toBe(t("backup.reload_failed_after_save"));
        expect(q(el, "[data-test=load-failed]")!.textContent!.trim()).toBe(
          codeMessage("backup.archive_settings_unusable"),
        );
      } finally {
        setLocale(previous);
      }
    });

    it(`a save whose reload left settings unusable shows the code's words once, in the status line (${locale})`, async () => {
      const previous = currentLocale();
      setLocale(locale);
      try {
        const { el, line } = await reloadLineAfterApply({
          ...OFF,
          recoveryKeySet: true,
          loadErrorCode: "backup.archive_settings_invalid",
          backupStatus: { configured: false, loadErrorCode: "backup.archive_settings_invalid" },
          reloadErrorCode: "backup.archive_settings_invalid",
        });
        expect(line).toBe(t("backup.reload_failed_after_save"));
        const words = codeMessage("backup.archive_settings_invalid");
        const body = q(el, "#backup-body")!.textContent!;
        expect(body.split(words)).toHaveLength(2);
        expect(q(el, "[data-test=load-failed]")!.textContent).toContain(words);
      } finally {
        setLocale(previous);
      }
    });

    it(`a save whose reload failed with words of its own still shows them (${locale})`, async () => {
      const previous = currentLocale();
      setLocale(locale);
      try {
        const { line } = await reloadLineAfterApply({
          ...OFF,
          recoveryKeySet: true,
          reloadErrorCode: "backup.reload_in_progress",
        });
        expect(line).toBe(
          `${t("backup.reload_failed_after_save")} ${codeMessage("backup.reload_in_progress")}`,
        );
      } finally {
        setLocale(previous);
      }
    });
  }
});

describe("A1089 what the box recorded", () => {
  const evidenceDialog = (el: BackupScreen) =>
    el.shadowRoot!.querySelector<BackupSettingsEvidenceDialog>(
      "dashboard-backup-settings-evidence",
    );
  const evidenceButton = (el: BackupScreen) => q(el, "[data-test=evidence-open]");
  const FAILED: BackupStatusView = {
    ...OFF,
    loadErrorCode: "credentials.decrypt_failed",
    recoveryKeySet: true,
  };

  for (const [locale, words] of [
    ["en-GB", en],
    ["es-ES", es],
  ] as const) {
    it(`offers the dialog beside the load failure, labelled as its heading (${locale})`, async () => {
      const previous = currentLocale();
      setLocale(locale);
      try {
        const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
          api: stubApi({}, FAILED),
          canManage: true,
        });
        await flush(el);
        const button = evidenceButton(el);
        expect(button).not.toBeNull();
        expect(button!.closest("dd")).toBe(q(el, "[data-test=load-failed]")!.closest("dd"));
        expect(button!.textContent!.trim()).toBe(words["backup_evidence.heading"]);
      } finally {
        setLocale(previous);
      }
    });

    it(`the alert for unusable settings names the button (${locale})`, () => {
      expect(alertMessage("backup.archive_settings_unusable", {}, locale)).toContain(
        words["backup_evidence.heading"],
      );
    });
  }

  it("shows no button and no open dialog when the settings loaded", async () => {
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
      api: stubApi({}, OFF),
      canManage: true,
    });
    await flush(el);
    expect(evidenceButton(el)).toBeNull();
    expect(evidenceDialog(el)?.open ?? false).toBe(false);
  });

  it("removes the button once a later status read finds the settings loaded", async () => {
    const api = stubApi({}, FAILED);
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
      api,
      canManage: true,
    });
    await flush(el);
    expect(evidenceButton(el)).not.toBeNull();

    vi.mocked(api.getBackupStatus).mockResolvedValue(OFF);
    api.liveData.invalidate([{ type: "backup_status" }]);
    await vi.waitFor(() => expect(api.getBackupStatus).toHaveBeenCalledTimes(2));
    await flush(el);
    expect(q(el, "[data-test=load-failed]")).toBeNull();
    expect(evidenceButton(el)).toBeNull();
  });

  it("opens the dialog on the screen's api, reading only then, and closes it on its close event", async () => {
    const answers = apiAnswering(() => Promise.resolve(evidence()));
    const api = stubApi(answers, FAILED);
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
      api,
      canManage: true,
    });
    await flush(el);
    expect(answers.getBackupSettingsEvidence).not.toHaveBeenCalled();
    evidenceButton(el)!.click();
    await flush(el);
    const dialog = evidenceDialog(el)!;
    expect(dialog.open).toBe(true);
    expect(dialog.api).toBe(api);
    await vi.waitFor(() => expect(answers.getBackupSettingsEvidence).toHaveBeenCalledOnce());
    dialog.dispatchEvent(new CustomEvent("evidence-close", { bubbles: true, composed: true }));
    await flush(el);
    expect(evidenceDialog(el)?.open ?? false).toBe(false);
    expect(api.applyBackup).not.toHaveBeenCalled();
    expect(api.rotateBackupKey).not.toHaveBeenCalled();
  });

  it("lets the dialog's administrator sign-in reach past the screen", async () => {
    const answers = apiAnswering(() => Promise.reject({ code: "authorization.not_permitted" }));
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
      api: stubApi(answers, FAILED),
      canManage: true,
    });
    await flush(el);
    const heard = vi.fn();
    el.addEventListener("admin-sign-in", heard);
    evidenceButton(el)!.click();
    await flush(el);
    const signIn = () =>
      evidenceDialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-test=admin-sign-in]");
    await expect.poll(signIn).not.toBeNull();
    signIn()!.click();
    expect(heard).toHaveBeenCalledOnce();
  });
});

describe("the recovery pack card after the screen's own writes", () => {
  const packLine = (el: BackupScreen) =>
    (
      el
        .shadowRoot!.querySelector("dashboard-recovery-pack-card")!
        .shadowRoot!.querySelector("[data-test=pack-status]")?.textContent ?? ""
    )
      .replace(/\s+/g, " ")
      .trim();
  const reads = (api: DashboardApi) => vi.mocked(api.getRecoveryPackStatus).mock.calls.length;

  it("turns to out of date after the bucket copy's Save, where the kit used to appear", async () => {
    const api = stubApi({ saveStreamSettings: vi.fn().mockResolvedValue(STREAM_ON) });
    vi.mocked(api.getRecoveryPackStatus).mockResolvedValue(PACK_UP_TO_DATE);
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
      api,
      canManage: true,
    });
    await flush(el);
    await vi.waitFor(() => expect(packLine(el)).not.toBe(""));
    expect(packLine(el)).not.toContain(t("recovery_pack.make_new"));
    vi.mocked(api.getRecoveryPackStatus).mockResolvedValue(PACK_OUT_OF_DATE);
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
    await vi.waitFor(() => expect(packLine(el)).toContain(t("recovery_pack.make_new")), {
      timeout: 2_000,
    });
  });

  it.each([
    [
      "Apply",
      OFF,
      {},
      async (el: BackupScreen) => {
        setInput(el, "[data-test=destination]", "/mnt/usb/waitron");
        await el.updateComplete;
        q(el, "[data-test=apply]")!.click();
      },
    ],
    [
      "Save settings",
      ENABLED,
      {},
      async (el: BackupScreen) => {
        q(el, "[data-test=edit-settings]")!.click();
        await vi.waitFor(() => expect(q(el, "[data-test=save-settings]")).not.toBeNull());
        await editDestination(el);
        q(el, "[data-test=save-settings]")!.click();
      },
    ],
    [
      "Turn off",
      ENABLED,
      { disableBackup: vi.fn().mockResolvedValue({ ...OFF, storedDisabled: true }) },
      async (el: BackupScreen) => {
        q(el, "[data-test=turn-off]")!.click();
        await flush(el);
        q(el, "[data-test=turn-off]")!.click();
      },
    ],
  ] as const)("reads the card's status again after %s", async (_name, status, overrides, act) => {
    const api = stubApi(overrides as Partial<DashboardApi>, status);
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
      api,
      canManage: true,
    });
    await flush(el);
    await vi.waitFor(() => expect(reads(api)).toBe(1));
    await act(el);
    await vi.waitFor(() => expect(reads(api)).toBeGreaterThan(1), { timeout: 2_000 });
  });
});

it.each(["at-time", "retain-count", "retain-days"])(
  "submits backup choices with Enter from %s",
  async (id) => {
    const api = stubApi();
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    setInput(el, "[data-test=destination]", "/mnt/usb/waitron");
    await chooseOption(q(el, "[data-test=time-mode]")!, "fixed");
    await chooseOption(q(el, "[data-test=days-mode]")!, "weekdays");
    await el.updateComplete;
    expect(q(el, "[data-test=weekday-1]")!.getAttribute("name")).toBe("backup-weekday-1");
    const control = q(el, `[data-test=${id}]`)!;
    await (control as WtInput).updateComplete;
    control
      .shadowRoot!.querySelector("input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
    await flush(el);
    expect(api.applyBackup).toHaveBeenCalledOnce();
  },
);

describe("configuration export at phone width", () => {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  afterEach(async () => {
    await page.viewport(viewport.width, viewport.height);
  });

  it.each(["en-GB", "es-ES"])(
    "keeps each passphrase label clear of its show button at 390 px (%s)",
    async (locale) => {
      setLocale(locale);
      await page.viewport(390, 850);
      const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
        api: stubApi(),
        onboardingIntent: "live",
      });
      await flush(el);
      for (const id of ["configuration-passphrase", "configuration-confirm"]) {
        const field = q(el, `[data-test=${id}]`) as WtInput;
        await field.updateComplete;
        const label = field.shadowRoot!.querySelector(".field-label")!.getBoundingClientRect();
        const button = q(el, `[data-test=toggle-${id}]`)!.getBoundingClientRect();
        expect(label.width).toBeGreaterThan(0);
        expect(label.right).toBeLessThanOrEqual(button.left);
      }
    },
  );
});

describe("an archive form's action row in a short scroller", () => {
  it.each([
    {
      form: "turning backups on",
      status: OFF,
      edit: false,
      first: "[data-test=archive-folder-on]",
      row: "[data-test=apply]",
    },
    {
      form: "editing the settings",
      status: ENABLED,
      edit: true,
      first: "[data-test=edit-title]",
      row: "[data-test=save-settings]",
    },
  ])(
    "stays out of view beside the status panel until its form for $form scrolls in",
    async ({ status, edit, first, row }) => {
      const { el, host } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
        api: stubApi({}, status),
        canManage: true,
      });
      await flush(el);
      if (edit) {
        q(el, "[data-test=edit-settings]")!.click();
        await flush(el);
      }
      host.style.height = "300px";
      host.style.overflow = "auto";
      q(el, "[data-test=status]")!.scrollIntoView({ block: "end" });
      const actions = q(el, row)!.closest("wt-form-actions")!;
      const view = host.getBoundingClientRect();
      expect(q(el, first)!.getBoundingClientRect().top).toBeGreaterThanOrEqual(view.bottom);
      expect(actions.getBoundingClientRect().top).toBeGreaterThanOrEqual(view.bottom);

      q(el, first)!.scrollIntoView({ block: "start" });
      const box = actions.getBoundingClientRect();
      expect(host.scrollTop).toBeGreaterThan(0);
      expect(box.top).toBeGreaterThanOrEqual(view.top);
      expect(box.bottom).toBeLessThanOrEqual(view.bottom + 0.5);
    },
  );
});

it("offers one administrator sign-in for permission refusals", async () => {
  const api = stubApi({
    getBackupStatus: vi.fn().mockRejectedValue({
      code: "authorization.not_permitted",
      params: { permission: "system.manage" },
    }),
    getStreamSettings: vi.fn().mockRejectedValue({
      code: "authorization.not_permitted",
      params: { permission: "system.manage" },
    }),
  });
  const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
  await flush(el);
  const buttons = el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=backup-admin-sign-in]");
  expect(buttons).toHaveLength(1);
  expect(buttons[0]!.textContent!.trim()).toBe(t("staff.sign_in_as_admin"));
  const heard = vi.fn();
  document.body.addEventListener("admin-sign-in", heard);
  try {
    buttons[0]!.click();
    expect(heard).toHaveBeenCalledOnce();
  } finally {
    document.body.removeEventListener("admin-sign-in", heard);
  }
});

it("offers administrator sign-in when only the stream panel refuses permission", async () => {
  const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
    api: stubApi(
      {
        getStreamSettings: vi.fn().mockRejectedValue({
          code: "authorization.not_permitted",
          params: { permission: "system.manage" },
        }),
      },
      ENABLED,
    ),
  });
  await flush(el);
  expect(
    q(el, "dashboard-stream-settings")!.parentElement!.querySelector(
      "[data-test=backup-admin-sign-in]",
    ),
  ).not.toBeNull();
});
it.each(["turn-on", "settings"] as const)(
  "a short-key refusal at a %s Save names Change the backup key on the recovery pack card, and offers no key step",
  async (source) => {
    const api = stubApi(
      { applyBackup: vi.fn().mockRejectedValue({ code: "backup.recovery_key_too_short" }) },
      source === "settings" ? ENABLED : { ...OFF, recoveryKeySet: true },
    );
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    if (source === "settings") {
      q(el, "[data-test=edit-settings]")!.click();
      await vi.waitFor(() => expect(q(el, "[data-test=save-settings]")).not.toBeNull());
    }
    await editDestination(el);
    q(el, source === "settings" ? "[data-test=save-settings]" : "[data-test=apply]")!.click();
    await vi.waitFor(() =>
      expect(archiveAlertText(el)).toContain(codeMessage("backup.recovery_key_too_short")),
    );
    for (const words of ["«Cambiar la clave de las copias»", es["recovery_pack.title"]])
      expect(codeMessage("backup.recovery_key_too_short")).toContain(words);
    expect(q(el, "[data-test=recovery-key-action]")).toBeNull();
    expect(api.applyBackup).toHaveBeenCalledOnce();
  },
);

it("does not offer administrator sign-in for a connection failure", async () => {
  const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
    api: stubApi({ getBackupStatus: vi.fn().mockRejectedValue({ code: "connection.failed" }) }),
  });
  await flush(el);
  expect(q(el, "[data-test=backup-admin-sign-in]")).toBeNull();
});

it.each(["settings", "turn-on"])(
  "offers administrator sign-in beside a refused %s Save",
  async (source) => {
    const api = stubApi(
      {
        applyBackup: vi.fn().mockRejectedValue({
          code: "authorization.not_permitted",
          params: { permission: "system.manage" },
        }),
      },
      source === "settings" ? ENABLED : { ...OFF, recoveryKeySet: true },
    );
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", { api });
    await flush(el);
    if (source === "settings") {
      q(el, "[data-test=edit-settings]")!.click();
      await vi.waitFor(() => expect(q(el, "[data-test=save-settings]")).not.toBeNull());
    }
    const action = source === "settings" ? "save-settings" : "apply";
    const actions = source === "settings" ? "settings-actions" : "apply-actions";
    await editDestination(el);
    q(el, `[data-test=${action}]`)!.click();
    await vi.waitFor(() =>
      expect(q(el, `[data-test=${actions}] [data-test=backup-admin-sign-in]`)).not.toBeNull(),
    );
    expect(q(el, "[data-test=backup-admin-sign-in]")!.getAttribute("variant")).toBe("secondary");
    expect(el.shadowRoot!.querySelectorAll("[data-test=backup-admin-sign-in]")).toHaveLength(1);
  },
);

it("opens the existing pack maker for its linked address", async () => {
  const before = location.href;
  history.replaceState(null, "", "/backup?recovery-pack=make");
  try {
    const { el } = await mountWidget<BackupScreen>("dashboard-backup-screen", {
      api: stubApi({}, OFF),
      canManage: true,
    });
    const card = el.shadowRoot!.querySelector("dashboard-recovery-pack-card")!;
    await card.updateComplete;
    const dialog = card.shadowRoot!.querySelector("dashboard-recovery-pack-dialog")!;
    await expect
      .poll(
        () =>
          dialog.shadowRoot?.querySelector("wt-dialog")?.shadowRoot?.querySelector("dialog")?.open,
      )
      .toBe(true);
    expect(new URL(location.href).searchParams.has("recovery-pack")).toBe(false);
  } finally {
    history.replaceState(null, "", before);
  }
});
