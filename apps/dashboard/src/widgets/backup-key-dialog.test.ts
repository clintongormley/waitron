import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeMasterKeyCode } from "@waitron/shared";
import type { WtDialog, WtMasterKeyInput } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi } from "../api/client.js";
import type { BackupWriteAnswer, RecoveryPackStatus } from "../api/backup-api.js";
import { codeMessage } from "../i18n/codes.js";
import { fill, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, dialogClosed, dialogMessageOf, mountWidget } from "./test-helpers.js";
import type { BackupKeyDialog } from "./backup-key-dialog.js";
import "./backup-key-dialog.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
  vi.restoreAllMocks();
});

const KEY = encodeMasterKeyCode(new Uint8Array(16).fill(7));

function status(number: number | null): RecoveryPackStatus {
  return {
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
    backupKey:
      number === null
        ? null
        : { number, fingerprint: "4f9a21c0", changedAt: null, fromCurrentMasterKey: true },
  };
}

const ANSWER = { enabled: true } as unknown as BackupWriteAnswer;

function stubApi(rotate: ReturnType<typeof vi.fn>, after: RecoveryPackStatus | Error = status(4)) {
  const liveData = new LiveData();
  vi.spyOn(liveData, "invalidate");
  return {
    rotateBackupKey: rotate,
    getRecoveryPackStatus: vi
      .fn()
      .mockImplementation(() =>
        after instanceof Error ? Promise.reject(after) : Promise.resolve(after),
      ),
    liveData,
  };
}

async function open(api: ReturnType<typeof stubApi>, held: number | null = 3) {
  const { el } = await mountWidget<BackupKeyDialog>("dashboard-backup-key-dialog", {
    api: api as unknown as DashboardApi,
  });
  el.show(status(held));
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
  await expect.poll(() => dialog.open).toBe(true);
  return { el, dialog };
}

const field = (el: BackupKeyDialog) =>
  el.shadowRoot!.querySelector<WtMasterKeyInput>("wt-master-key-input")!;
const button = (el: BackupKeyDialog, test: string) =>
  el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(`wt-button[data-test=${test}]`);
const words = (node: Element | null | undefined) =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim();

async function type(el: BackupKeyDialog, text: string) {
  const input = field(el).shadowRoot!.querySelector<
    HTMLElement & { updateComplete: Promise<unknown> }
  >("wt-input")!;
  await input.updateComplete;
  input.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: text }, bubbles: true, composed: true }),
  );
  await field(el).updateComplete;
  await el.updateComplete;
}

describe.each([
  [
    "en-GB",
    "New backups will use backup key 4. A box you removed can't read them.",
    "Change the backup key",
    "Cancel",
  ],
  [
    "es-ES",
    "Las copias nuevas usarán la clave de las copias número 4. Un servidor que hayas quitado no podrá leerlas.",
    "Cambiar la clave de las copias",
    "Cancelar",
  ],
] as const)("the backup key dialog in %s", (locale, text, change, cancel) => {
  it("names the next backup key, and keeps Change the backup key off until a whole key is typed", async () => {
    setLocale(locale);
    const { el, dialog } = await open(stubApi(vi.fn()));
    expect(dialog.getAttribute("heading")).toBe(change);
    expect(words(el.shadowRoot!.querySelector("[data-test=intro]"))).toBe(text);
    expect(words(button(el, "change-backup-key"))).toBe(change);
    expect(words(button(el, "cancel-backup-key"))).toBe(cancel);
    expect(field(el).required).toBe(true);
    expect(button(el, "change-backup-key")!.disabled).toBe(true);
    await type(el, KEY.slice(0, 10));
    expect(button(el, "change-backup-key")!.disabled).toBe(true);
    await type(el, KEY);
    expect(button(el, "change-backup-key")!.disabled).toBe(false);
  });
});

it("Change the backup key sends the typed master key and shows 'Backups now use backup key N+1.'", async () => {
  const rotate = vi.fn().mockResolvedValue(ANSWER);
  const api = stubApi(rotate);
  const { el } = await open(api);
  const changed = vi.fn();
  el.addEventListener("backup-key-changed", changed);
  await type(el, KEY);
  button(el, "change-backup-key")!.click();
  await expect
    .poll(() => words(el.shadowRoot!.querySelector("[data-test=done]")))
    .toBe("Backups now use backup key 4.");
  expect(rotate).toHaveBeenCalledWith({ masterKey: KEY });
  expect(api.liveData.invalidate).toHaveBeenCalledWith([{ type: "backup_status" }]);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(el.shadowRoot!.querySelector("wt-master-key-input")).toBeNull();
  expect(button(el, "change-backup-key")).toBeNull();
  expect(words(button(el, "close-backup-key"))).toBe(t("action.close"));
});

it("names the number the box reports once the key has changed", async () => {
  const rotate = vi.fn().mockResolvedValue(ANSWER);
  const { el } = await open(stubApi(rotate, status(7)));
  await type(el, KEY);
  button(el, "change-backup-key")!.click();
  await expect
    .poll(() => words(el.shadowRoot!.querySelector("[data-test=done]")))
    .toBe(fill("backup_key_dialog.done", { number: "7" }));
});

it("offers backup key 1 when the box holds none", async () => {
  const { el } = await open(stubApi(vi.fn()), null);
  expect(words(el.shadowRoot!.querySelector("[data-test=intro]"))).toBe(
    fill("backup_key_dialog.text", { number: "1" }),
  );
});

it.each([
  ["en-GB", "Wrong master key. Use the one dated 2026-11-23 · QZJV."],
  ["es-ES", "Clave maestra incorrecta. Usa la del 2026-11-23 · QZJV."],
] as const)(
  "a wrong master key shows 'Wrong master key. Use the one dated {name}.' (%s)",
  async (locale, sentence) => {
    setLocale(locale);
    const rotate = vi.fn().mockRejectedValue({
      code: "master_key.wrong",
      params: { keyName: "2026-11-23 · QZJV" },
      status: 400,
    });
    const api = stubApi(rotate);
    const { el, dialog } = await open(api);
    const changed = vi.fn();
    el.addEventListener("backup-key-changed", changed);
    await type(el, KEY);
    button(el, "change-backup-key")!.click();
    await expect.poll(() => field(el).error).toBe(sentence);
    expect(await dialogMessageOf(dialog)).toBe("");
    expect(el.shadowRoot!.querySelector("[data-test=done]")).toBeNull();
    expect(changed).not.toHaveBeenCalled();
    expect(api.liveData.invalidate).not.toHaveBeenCalled();
    await type(el, encodeMasterKeyCode(new Uint8Array(16).fill(9)));
    expect(field(el).error).toBe("");
  },
);

it("explains another refusal on the form's own line, and changes nothing", async () => {
  const rotate = vi.fn().mockRejectedValue({ code: "backup.effective_mismatch", status: 500 });
  const api = stubApi(rotate);
  const { el, dialog } = await open(api);
  const changed = vi.fn();
  el.addEventListener("backup-key-changed", changed);
  await type(el, KEY);
  button(el, "change-backup-key")!.click();
  await expect.poll(() => dialogMessageOf(dialog)).toBe(codeMessage("backup.effective_mismatch"));
  expect(field(el).error).toBe("");
  expect(changed).not.toHaveBeenCalled();
  expect(button(el, "change-backup-key")!.disabled).toBe(false);
});

it("treats a key change whose settings record failed as done, and says so", async () => {
  const rotate = vi.fn().mockRejectedValue({
    code: "backup.rotation_metadata_failed",
    params: { effectiveKeyChanged: true, keyFingerprint: "aa", keyRotatedAt: "x" },
    status: 500,
  });
  const api = stubApi(rotate);
  const { el } = await open(api);
  const changed = vi.fn();
  el.addEventListener("backup-key-changed", changed);
  await type(el, KEY);
  button(el, "change-backup-key")!.click();
  await expect
    .poll(() => words(el.shadowRoot!.querySelector("[data-test=done]")))
    .toBe("Backups now use backup key 4.");
  expect(words(el.shadowRoot!.querySelector("[data-test=done-warning]"))).toBe(
    codeMessage("backup.rotation_metadata_failed"),
  );
  expect(api.liveData.invalidate).toHaveBeenCalledWith([{ type: "backup_status" }]);
  expect(changed).toHaveBeenCalledTimes(1);
});

it("says when the box changed the key but could not load the settings again", async () => {
  const rotate = vi
    .fn()
    .mockResolvedValue({ ...ANSWER, reloadErrorCode: "backup.reload_in_progress" });
  const { el } = await open(stubApi(rotate));
  await type(el, KEY);
  button(el, "change-backup-key")!.click();
  await expect
    .poll(() => words(el.shadowRoot!.querySelector("[data-test=done-warning]")))
    .toBe(`${t("backup.reload_failed_after_save")} ${codeMessage("backup.reload_in_progress")}`);
});

it("a lost answer may have changed the key, so the card and Backups read again", async () => {
  const rotate = vi.fn().mockRejectedValue({ code: "connection.failed" });
  const api = stubApi(rotate);
  const { el, dialog } = await open(api);
  const changed = vi.fn();
  el.addEventListener("backup-key-changed", changed);
  await type(el, KEY);
  button(el, "change-backup-key")!.click();
  await expect.poll(() => dialogMessageOf(dialog)).toBe(codeMessage("connection.failed"));
  expect(api.liveData.invalidate).toHaveBeenCalledWith([{ type: "backup_status" }]);
  expect(changed).toHaveBeenCalledTimes(1);
});

it("Close after the change closes without asking", async () => {
  const { el, dialog } = await open(stubApi(vi.fn().mockResolvedValue(ANSWER)));
  await type(el, KEY);
  button(el, "change-backup-key")!.click();
  await expect.poll(() => button(el, "close-backup-key")).not.toBeNull();
  const closed = dialogClosed(dialog);
  button(el, "close-backup-key")!.click();
  await closed;
  expect(el.isOpen).toBe(false);
});
