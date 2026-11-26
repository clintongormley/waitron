import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeMasterKeyCode } from "@waitron/shared";
import type { LitElement } from "lit";
import type { WtDialog, WtMasterKeyInput } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi } from "../api/client.js";
import type { RecoveryPackStatus } from "../api/backup-api.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import type { BackupKeyDialog } from "./backup-key-dialog.js";
import "./backup-key-dialog.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
  vi.restoreAllMocks();
});

const STATUS: RecoveryPackStatus = {
  latest: null,
  upToDate: false,
  incomplete: false,
  unreceived: null,
  reasons: [],
  keep: [],
  backupsUseOlderKey: false,
  masterKey: { name: "2026-11-23 · QZJV", pack: 1 },
  keepOldPackUntil: "2026-12-23T12:00:00.000Z",
  timeZone: "Europe/Madrid",
  backupKey: { number: 3, fingerprint: "4f9a21c0", changedAt: null, fromCurrentMasterKey: true },
};

type State =
  "empty" | "typed" | "busy" | "wrong key" | "refused" | "done" | "done, settings unrecorded";

function rotateFor(state: State) {
  if (state === "busy") return vi.fn(() => new Promise(() => undefined));
  if (state === "wrong key")
    return vi.fn().mockRejectedValue({
      code: "master_key.wrong",
      params: { keyName: "2026-11-23 · QZJV" },
      status: 400,
    });
  if (state === "refused")
    return vi.fn().mockRejectedValue({ code: "backup.effective_mismatch", status: 500 });
  if (state === "done, settings unrecorded")
    return vi.fn().mockRejectedValue({ code: "backup.rotation_metadata_failed", status: 500 });
  return vi.fn().mockResolvedValue({ enabled: true });
}

const STATES: State[] = [
  "empty",
  "typed",
  "busy",
  "wrong key",
  "refused",
  "done",
  "done, settings unrecorded",
];

describe.each(["light", "dark"] as const)("backup key dialog accessibility (%s)", (theme) => {
  it.each(
    STATES.flatMap((state) => [
      { state, locale: "en-GB" },
      { state, locale: "es-ES" },
    ]),
  )("draws $state in $locale", async ({ state, locale }) => {
    setLocale(locale);
    const api = {
      rotateBackupKey: rotateFor(state),
      getRecoveryPackStatus: vi.fn().mockResolvedValue({
        ...STATUS,
        backupKey: { ...STATUS.backupKey!, number: 4 },
      }),
      liveData: new LiveData(),
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<BackupKeyDialog>(
      "dashboard-backup-key-dialog",
      { api },
      theme,
    );
    el.show(STATUS);
    await el.updateComplete;
    const root = el.shadowRoot!;
    const dialog = root.querySelector<WtDialog>("wt-dialog")!;
    await expect.poll(() => dialog.open).toBe(true);
    if (state !== "empty") {
      const field = root.querySelector<WtMasterKeyInput>("wt-master-key-input")!;
      const input = field.shadowRoot!.querySelector<LitElement>("wt-input")!;
      await input.updateComplete;
      input.dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: encodeMasterKeyCode(new Uint8Array(16).fill(7)) },
          bubbles: true,
          composed: true,
        }),
      );
      await field.updateComplete;
      await el.updateComplete;
    }
    if (state !== "empty" && state !== "typed")
      root.querySelector<HTMLElement>("wt-button[data-test=change-backup-key]")!.click();
    if (state === "busy") await expect.poll(() => api.rotateBackupKey).toHaveBeenCalled();
    if (state === "wrong key")
      await expect
        .poll(() => root.querySelector<WtMasterKeyInput>("wt-master-key-input")!.error)
        .not.toBe("");
    if (state === "refused")
      await expect.poll(() => root.querySelector("wt-form-actions")!.error).not.toBe("");
    if (state.startsWith("done"))
      await expect.poll(() => root.querySelector("[data-test=done]")).toBeTruthy();
    await el.updateComplete;
    await root.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")
      ?.updateComplete;
    await dialog.updateComplete;
    expect(dialog.shadowRoot!.querySelector("dialog")!.matches(":modal")).toBe(true);
    await expectNoA11yViolations(host);
  });
});
